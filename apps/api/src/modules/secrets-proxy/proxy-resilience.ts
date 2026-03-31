/**
 * Proxy resilience utilities for handling connection failures and retries
 */

import * as http from 'http';
import * as net from 'net';

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  timeout: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelay: 100,
  maxDelay: 2000,
  backoffFactor: 2,
  timeout: 5000,
};

/**
 * Retry a connection with exponential backoff
 */
export async function retryConnection(
  host: string,
  port: number,
  options: Partial<RetryOptions> = {}
): Promise<net.Socket> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | null = null;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const socket = await attemptConnection(host, port, opts.timeout);
      return socket;
    } catch (err) {
      lastError = err as Error;
      console.warn(`[secrets-proxy] Connection attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}`);
      
      if (attempt < opts.maxAttempts) {
        await sleep(delay);
        delay = Math.min(delay * opts.backoffFactor, opts.maxDelay);
      }
    }
  }

  throw new Error(`Failed to connect after ${opts.maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Attempt a single connection with timeout
 */
function attemptConnection(host: string, port: number, timeout: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    
    const timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Connection timeout after ${timeout}ms`));
    }, timeout);

    socket.once('connect', () => {
      clearTimeout(timeoutId);
      resolve(socket);
    });

    socket.once('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Check if a port is reachable
 */
export async function isPortReachable(host: string, port: number, timeout: number = 1000): Promise<boolean> {
  try {
    const socket = await attemptConnection(host, port, timeout);
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a service to become available
 */
export async function waitForService(
  host: string,
  port: number,
  maxWaitTime: number = 30000,
  checkInterval: number = 500
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitTime) {
    if (await isPortReachable(host, port)) {
      return;
    }
    await sleep(checkInterval);
  }
  
  throw new Error(`Service at ${host}:${port} did not become available within ${maxWaitTime}ms`);
}

/**
 * Create a resilient HTTP request with retries
 */
export async function resilientHttpRequest(
  options: http.RequestOptions,
  body?: Buffer | string,
  retryOptions: Partial<RetryOptions> = {}
): Promise<http.IncomingMessage> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  let lastError: Error | null = null;
  let delay = opts.initialDelay;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const response = await attemptHttpRequest(options, body, opts.timeout);
      return response;
    } catch (err) {
      lastError = err as Error;
      console.warn(`[secrets-proxy] HTTP request attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}`);
      
      if (attempt < opts.maxAttempts) {
        await sleep(delay);
        delay = Math.min(delay * opts.backoffFactor, opts.maxDelay);
      }
    }
  }

  throw new Error(`HTTP request failed after ${opts.maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Attempt a single HTTP request with timeout
 */
function attemptHttpRequest(
  options: http.RequestOptions,
  body?: Buffer | string,
  timeout: number = 5000
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const proto = options.protocol === 'https:' ? require('https') : http;
    const req = proto.request(options, (res: http.IncomingMessage) => {
      resolve(res);
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`HTTP request timeout after ${timeout}ms`));
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a circuit breaker for proxy connections
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly failureThreshold: number = 5,
    private readonly resetTimeout: number = 60000,
    private readonly successThreshold: number = 2
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.failureCount = Math.max(0, this.failureCount - 1);
      if (this.failureCount <= this.failureThreshold - this.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      console.warn('[secrets-proxy] Circuit breaker opened due to repeated failures');
    }
  }

  getState(): string {
    return this.state;
  }

  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
  }
}