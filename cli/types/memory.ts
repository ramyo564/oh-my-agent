export interface MemoryObservePayload {
  sessionId: string;
  content: string;
  source: string;
}

export interface MemoryProviderStatus {
  provider: "agentmemory" | "none";
  reachable: boolean;
  endpoint?: string;
  version?: string;
  reason?: string;
}

export interface MemoryProvider {
  name: "agentmemory" | "none";
  status(): Promise<MemoryProviderStatus>;
  observe(payload: MemoryObservePayload): Promise<boolean>;
}

export interface AgentMemoryProviderOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  healthTimeoutMs?: number;
  observeTimeoutMs?: number;
}

export interface AgentMemoryEndpointConfig {
  port?: number;
  url?: string;
  socket?: string;
  source?: "oma" | "agentmemory" | "user";
  updatedAt?: string;
}

export interface MemorySetupResult {
  homeDir: string;
  configDir: string;
  endpointPath: string;
  endpoint: string | null;
  endpointConfigured: boolean;
  wroteEndpoint: boolean;
  dryRun: boolean;
  installRequested: boolean;
  installExitCode?: number | null;
  installSkipped?: boolean;
  installError?: string;
  startRequested: boolean;
  daemon?: MemoryDaemonResult;
  installCommand: string;
  startCommand: string;
  status: MemoryProviderStatus;
}

export interface MemoryDaemonResult {
  action: "status" | "start" | "stop" | "restart";
  homeDir: string;
  pidPath: string;
  ownedPid?: number;
  ownedProcessRunning: boolean;
  endpoint: string | null;
  startedPid?: number;
  stoppedPid?: number;
  attemptedFallbackStop?: boolean;
  fallbackStopCode?: number | null;
  status: MemoryProviderStatus;
  dryRun: boolean;
  message?: string;
}

export interface MemoryServiceResult {
  action: "install";
  platform: NodeJS.Platform;
  supported: boolean;
  dryRun: boolean;
  servicePath?: string;
  message: string;
}
