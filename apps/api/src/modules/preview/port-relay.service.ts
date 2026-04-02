import { 
  forwardPortWithRange,
  forwardPortViaSsh,
  unforwardPort, 
  autoForwardPorts, 
  getPortStatus,
  PortStatus,
  PortInfo
} from './port-forwarder.js';
import { projectsService } from '../projects/projects.service.js';
import { BridgePortsUpdate } from '@apex/orchestrator';

export interface PortRelayState {
  projectId: string;
  sandboxId: string;
  autoForwardEnabled: boolean;
  lastKnownPorts: PortInfo[];
  activeForwards: Map<number, number>; // remotePort -> localPort
  provider: string;
}

export interface PortRelayEvent {
  type: 'port_forwards_updated' | 'auto_forward_status_changed';
  projectId: string;
  payload: {
    forwards?: Array<{ remotePort: number; localPort: number; status: string }>;
    autoForwardEnabled?: boolean;
    error?: string;
  };
}

export interface PortRelayConfig {
  enableAutoForward: boolean;
  excludedPorts: number[];
  maxAutoForwards: number;
  supportedProviders: string[];
}

/**
 * Service to coordinate port relay operations between WebSocket events and port forwarding
 */
export class PortRelayService {
  private projectStates = new Map<string, PortRelayState>();
  private eventEmitters = new Set<(event: PortRelayEvent) => void>();
  private config: PortRelayConfig;

  constructor(config?: Partial<PortRelayConfig>) {
    this.config = {
      enableAutoForward: true,
      excludedPorts: [],
      maxAutoForwards: 20,
      supportedProviders: ['docker', 'apple-container', 'daytona', 'local'],
      ...config
    };
  }

  /**
   * Subscribe to port relay events
   */
  onEvent(callback: (event: PortRelayEvent) => void): () => void {
    this.eventEmitters.add(callback);
    return () => this.eventEmitters.delete(callback);
  }

  /**
   * Emit event to all subscribers
   */
  private emit(event: PortRelayEvent): void {
    for (const emitter of this.eventEmitters) {
      try {
        emitter(event);
      } catch (error) {
        console.warn('[port-relay] Error emitting event:', error);
      }
    }
  }

  /**
   * Initialize or update project state for port relaying
   */
  async initializeProject(projectId: string): Promise<void> {
    try {
      const project = await projectsService.findById(projectId);
      
      if (!project.sandboxId) {
        console.warn(`[port-relay] Project ${projectId} has no sandbox ID`);
        return;
      }

      const state: PortRelayState = {
        projectId,
        sandboxId: project.sandboxId,
        autoForwardEnabled: true,
        lastKnownPorts: [],
        activeForwards: new Map(),
        provider: project.provider
      };

      this.projectStates.set(projectId, state);
      console.log(`[port-relay] Initialized project ${projectId} with sandbox ${project.sandboxId.slice(0, 12)}`);

    } catch (error) {
      console.error(`[port-relay] Failed to initialize project ${projectId}:`, error);
    }
  }

  /**
   * Clean up project state and stop all forwards
   */
  cleanupProject(projectId: string): void {
    const state = this.projectStates.get(projectId);
    if (!state) return;

    console.log(`[port-relay] Cleaning up project ${projectId}`);

    // Stop all active forwards
    for (const remotePort of state.activeForwards.keys()) {
      try {
        unforwardPort(state.sandboxId, remotePort);
      } catch (error) {
        console.warn(`[port-relay] Error stopping forward for port ${remotePort}:`, error);
      }
    }

    this.projectStates.delete(projectId);
    
    this.emit({
      type: 'port_forwards_updated',
      projectId,
      payload: { forwards: [] }
    });
  }

  /**
   * Enable/disable automatic port forwarding for a project
   */
  async setAutoForward(projectId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    const state = this.projectStates.get(projectId);
    if (!state) {
      return { success: false, error: 'Project not initialized' };
    }

    state.autoForwardEnabled = enabled;
    
    console.log(`[port-relay] Auto-forward ${enabled ? 'enabled' : 'disabled'} for project ${projectId}`);

    this.emit({
      type: 'auto_forward_status_changed',
      projectId,
      payload: { autoForwardEnabled: enabled }
    });

    // If enabling and we have known ports, start forwarding them
    if (enabled && state.lastKnownPorts.length > 0) {
      await this.processPortsUpdate(projectId, state.lastKnownPorts);
    }

    return { success: true };
  }

  /**
   * Manually forward a specific port
   */
  async forwardPort(
    projectId: string, 
    remotePort: number, 
    preferredLocalPort?: number
  ): Promise<{ success: boolean; localPort?: number; error?: string }> {
    const state = this.projectStates.get(projectId);
    if (!state) {
      return { success: false, error: 'Project not initialized' };
    }

    try {
      const project = await projectsService.findById(projectId);
      const manager = projectsService.getSandboxManager(project.provider);
      
      if (!manager) {
        return { success: false, error: 'Sandbox manager not available' };
      }

      let localPort: number;
      const preferred = preferredLocalPort ?? remotePort;

      if (project.provider === 'daytona') {
        const ssh = await manager.createSshAccess(state.sandboxId);
        localPort = await forwardPortViaSsh(
          state.sandboxId,
          remotePort,
          { user: ssh.sshUser, host: ssh.sshHost, port: ssh.sshPort },
          preferred,
        );
      } else {
        const { url } = await manager.getPortPreviewUrl(state.sandboxId, remotePort);
        const remoteHost = new URL(url).hostname;
        localPort = await forwardPortWithRange(
          state.sandboxId,
          remoteHost,
          remotePort,
          preferred,
        );
      }

      state.activeForwards.set(remotePort, localPort);

      console.log(`[port-relay] Forward: ${projectId.slice(0, 8)}:${remotePort} → localhost:${localPort} (${project.provider})`);

      this.emitForwardsUpdate(projectId);

      return { success: true, localPort };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[port-relay] Failed to forward port ${remotePort}:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Stop forwarding a specific port
   */
  async unforwardPort(projectId: string, remotePort: number): Promise<{ success: boolean; error?: string }> {
    const state = this.projectStates.get(projectId);
    if (!state) {
      return { success: false, error: 'Project not initialized' };
    }

    try {
      const result = unforwardPort(state.sandboxId, remotePort);
      
      if (result) {
        state.activeForwards.delete(remotePort);
        console.log(`[port-relay] Stopped forward: ${projectId.slice(0, 8)}:${remotePort}`);
        
        // Emit update
        this.emitForwardsUpdate(projectId);
        
        return { success: true };
      } else {
        return { success: false, error: 'Port was not being forwarded' };
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[port-relay] Failed to unforward port ${remotePort}:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get current forwarding status for a project
   */
  getRelayStatus(projectId: string): {
    autoForwardEnabled: boolean;
    forwards: Array<{ remotePort: number; localPort: number; status: string }>;
    lastKnownPorts: PortInfo[];
  } | null {
    const state = this.projectStates.get(projectId);
    if (!state) return null;

    const portStatuses = getPortStatus(state.sandboxId);
    const forwards = portStatuses.map(status => ({
      remotePort: status.remotePort,
      localPort: status.localPort,
      status: status.status
    }));

    return {
      autoForwardEnabled: state.autoForwardEnabled,
      forwards,
      lastKnownPorts: state.lastKnownPorts
    };
  }

  /**
   * Handle ports update from bridge - main entry point for auto-forwarding
   */
  async handlePortsUpdate(projectId: string, portsUpdate: BridgePortsUpdate): Promise<void> {
    const state = this.projectStates.get(projectId);
    if (!state) {
      // Attempt to initialize if not already done
      await this.initializeProject(projectId);
      const newState = this.projectStates.get(projectId);
      if (!newState) {
        console.warn(`[port-relay] Could not initialize project ${projectId} for ports update`);
        return;
      }
    }

    await this.processPortsUpdate(projectId, portsUpdate.ports);
  }

  /**
   * Process ports update and handle auto-forwarding
   */
  private async processPortsUpdate(projectId: string, ports: PortInfo[]): Promise<void> {
    const state = this.projectStates.get(projectId);
    if (!state) return;

    // Update known ports
    state.lastKnownPorts = [...ports];

    // Only auto-forward if enabled
    if (!state.autoForwardEnabled) {
      console.log(`[port-relay] Auto-forward disabled for ${projectId}, skipping ${ports.length} ports`);
      return;
    }

    try {
      const newTcpPorts = ports.filter(p => 
        p.protocol === 'tcp' && 
        !state.activeForwards.has(p.port) &&
        !this.config.excludedPorts.includes(p.port)
      );

      if (newTcpPorts.length === 0) return;

      const portsToForward = newTcpPorts.slice(0, this.config.maxAutoForwards);
      console.log(`[port-relay] Auto-forwarding ${portsToForward.length} ports for ${projectId}:`, portsToForward.map(p => p.port));

      const results = await Promise.allSettled(
        portsToForward.map(p => this.forwardPort(projectId, p.port))
      );

      const successful = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
      console.log(`[port-relay] Auto-forwarded ${successful}/${portsToForward.length} ports for ${projectId}`);

    } catch (error) {
      console.error(`[port-relay] Error processing ports update for ${projectId}:`, error);
      
      this.emit({
        type: 'port_forwards_updated',
        projectId,
        payload: { 
          error: error instanceof Error ? error.message : 'Unknown error processing ports update'
        }
      });
    }
  }

  /**
   * Emit current forwards status
   */
  private emitForwardsUpdate(projectId: string): void {
    const state = this.projectStates.get(projectId);
    if (!state) return;

    const portStatuses = getPortStatus(state.sandboxId);
    const forwards = portStatuses.map(status => ({
      remotePort: status.remotePort,
      localPort: status.localPort,
      status: status.status
    }));

    this.emit({
      type: 'port_forwards_updated',
      projectId,
      payload: { forwards }
    });
  }

  /**
   * Get configuration
   */
  getConfig(): PortRelayConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PortRelayConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[port-relay] Configuration updated:', this.config);
  }

  /**
   * Get all project states (for debugging)
   */
  getAllStates(): Map<string, PortRelayState> {
    return new Map(this.projectStates);
  }
}

// Singleton instance
export const portRelayService = new PortRelayService();