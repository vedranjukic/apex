import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PortRelayService, type PortRelayEvent } from './port-relay.service.js';
import { cleanup as cleanupForwarder } from './port-forwarder.js';

vi.mock('../projects/projects.service', () => ({
  projectsService: {
    findById: vi.fn(),
    getSandboxManager: vi.fn(),
  },
}));

import { projectsService } from '../projects/projects.service.js';

const mockFindById = vi.mocked(projectsService.findById);
const mockGetSandboxManager = vi.mocked(projectsService.getSandboxManager);

describe('PortRelayService', () => {
  let service: PortRelayService;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupForwarder();
    service = new PortRelayService({
      supportedProviders: ['docker', 'apple-container'],
      excludedPorts: [8080],
      maxAutoForwards: 5,
    });
  });

  afterEach(() => {
    cleanupForwarder();
  });

  describe('initializeProject', () => {
    it('should initialize a project with a supported provider', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);

      await service.initializeProject('project-1');
      const status = service.getRelayStatus('project-1');
      expect(status).not.toBeNull();
      expect(status!.autoForwardEnabled).toBe(false);
      expect(status!.forwards).toHaveLength(0);
    });

    it('should initialize Daytona projects for SSH tunnel relay', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'daytona',
      } as any);

      await service.initializeProject('project-1');
      const status = service.getRelayStatus('project-1');
      expect(status).not.toBeNull();
      expect(status!.autoForwardEnabled).toBe(false);
    });

    it('should skip projects without a sandboxId', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: null,
        provider: 'docker',
      } as any);

      await service.initializeProject('project-1');
      const status = service.getRelayStatus('project-1');
      expect(status).toBeNull();
    });
  });

  describe('setAutoForward', () => {
    beforeEach(async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);
      await service.initializeProject('project-1');
    });

    it('should enable auto-forward for an initialized project', async () => {
      const result = await service.setAutoForward('project-1', true);
      expect(result.success).toBe(true);

      const status = service.getRelayStatus('project-1');
      expect(status!.autoForwardEnabled).toBe(true);
    });

    it('should fail for an uninitialized project', async () => {
      const result = await service.setAutoForward('nonexistent', true);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should emit auto_forward_status_changed event', async () => {
      const events: PortRelayEvent[] = [];
      service.onEvent((e) => events.push(e));

      await service.setAutoForward('project-1', true);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('auto_forward_status_changed');
      expect(events[0].payload.autoForwardEnabled).toBe(true);
    });
  });

  describe('cleanupProject', () => {
    it('should clean up project state and emit event', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);
      await service.initializeProject('project-1');

      const events: PortRelayEvent[] = [];
      service.onEvent((e) => events.push(e));

      service.cleanupProject('project-1');

      expect(service.getRelayStatus('project-1')).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('port_forwards_updated');
      expect(events[0].payload.forwards).toEqual([]);
    });

    it('should be a no-op for unknown projects', () => {
      expect(() => service.cleanupProject('nonexistent')).not.toThrow();
    });
  });

  describe('handlePortsUpdate', () => {
    it('should auto-initialize the project if not already initialized', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);

      await service.handlePortsUpdate('project-1', { ports: [{ port: 3000, protocol: 'tcp' }] } as any);

      const status = service.getRelayStatus('project-1');
      expect(status).not.toBeNull();
    });

    it('should not forward if auto-forward is disabled', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);
      await service.initializeProject('project-1');

      await service.handlePortsUpdate('project-1', { ports: [{ port: 3000, protocol: 'tcp' }] } as any);

      const status = service.getRelayStatus('project-1');
      expect(status!.forwards).toHaveLength(0);
    });
  });

  describe('event system', () => {
    it('should support subscribing and unsubscribing', async () => {
      mockFindById.mockResolvedValue({
        id: 'project-1',
        sandboxId: 'sandbox-abc',
        provider: 'docker',
      } as any);
      await service.initializeProject('project-1');

      const events: PortRelayEvent[] = [];
      const unsub = service.onEvent((e) => events.push(e));

      await service.setAutoForward('project-1', true);
      expect(events).toHaveLength(1);

      unsub();
      await service.setAutoForward('project-1', false);
      expect(events).toHaveLength(1);
    });
  });

  describe('getConfig / updateConfig', () => {
    it('should return the initial config', () => {
      const cfg = service.getConfig();
      expect(cfg.excludedPorts).toContain(8080);
      expect(cfg.maxAutoForwards).toBe(5);
      expect(cfg.supportedProviders).toEqual(['docker', 'apple-container']);
    });

    it('should update config partially', () => {
      service.updateConfig({ maxAutoForwards: 20 });
      const cfg = service.getConfig();
      expect(cfg.maxAutoForwards).toBe(20);
      expect(cfg.excludedPorts).toContain(8080);
    });
  });
});
