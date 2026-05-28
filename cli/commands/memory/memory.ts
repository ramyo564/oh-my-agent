import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { ensureMemorySchema } from "../../io/memory.js";
import { type OmaEvent, retryObservePath } from "../../state/events.js";
import {
  createAgentMemoryProvider,
  resolveAgentMemoryEndpoint,
} from "../../state/memory-provider.js";
import type {
  AgentMemoryEndpointConfig,
  MemoryDaemonResult,
  MemoryProvider,
  MemoryProviderStatus,
  MemoryServiceResult,
  MemorySetupResult,
} from "../../types/memory.js";

export interface MemoryRetryDrainResult {
  retryPath: string;
  total: number;
  drained: number;
  retained: number;
  invalid: number;
  dryRun: boolean;
}

const AGENTMEMORY_INSTALL_COMMAND = "bun install -g @agentmemory/agentmemory";
const AGENTMEMORY_START_COMMAND = "agentmemory";
const DEFAULT_AGENTMEMORY_PORT = 3111;
const OMA_AGENTMEMORY_PID_FILE = "oma-agentmemory.pid";

type AgentMemoryInstaller = () => Promise<{
  status: number | null;
  error?: string;
}>;

function defaultAgentMemoryInstaller(): Promise<{
  status: number | null;
  error?: string;
}> {
  const result = spawnSync(
    "bun",
    ["install", "-g", "@agentmemory/agentmemory"],
    {
      encoding: "utf-8",
      stdio: "inherit",
    },
  );
  return Promise.resolve({
    status: result.status,
    error: result.error?.message,
  });
}

function agentMemoryConfigDir(homeDir: string): string {
  return join(homeDir, ".agentmemory");
}

function agentMemoryEndpointPath(homeDir: string): string {
  return join(agentMemoryConfigDir(homeDir), "endpoint.json");
}

function agentMemoryPidPath(homeDir: string): string {
  return join(agentMemoryConfigDir(homeDir), OMA_AGENTMEMORY_PID_FILE);
}

function endpointFromConfig(config: AgentMemoryEndpointConfig): string | null {
  if (typeof config.port === "number") return `http://127.0.0.1:${config.port}`;
  if (typeof config.url === "string" && config.url.trim()) return config.url;
  return null;
}

function readEndpointConfig(homeDir: string): AgentMemoryEndpointConfig | null {
  const endpointPath = agentMemoryEndpointPath(homeDir);
  if (!existsSync(endpointPath)) return null;
  try {
    return JSON.parse(readFileSync(endpointPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeEndpointConfig(
  homeDir: string,
  config: AgentMemoryEndpointConfig,
): void {
  const endpointPath = agentMemoryEndpointPath(homeDir);
  mkdirSync(dirname(endpointPath), { recursive: true, mode: 0o700 });
  writeFileSync(endpointPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function parsePositivePort(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid AgentMemory port: ${value}`);
  }
  return port;
}

function readOwnedPid(homeDir: string): number | undefined {
  const pidPath = agentMemoryPidPath(homeDir);
  if (!existsSync(pidPath)) return undefined;
  const pid = Number(readFileSync(pidPath, "utf-8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  return pid;
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeOwnedPid(homeDir: string, pid: number): void {
  const pidPath = agentMemoryPidPath(homeDir);
  mkdirSync(dirname(pidPath), { recursive: true, mode: 0o700 });
  writeFileSync(pidPath, `${pid}\n`, { encoding: "utf-8", mode: 0o600 });
}

export async function initMemory(
  jsonMode = false,
  forceMode = false,
): Promise<void> {
  const cwd = process.cwd();
  const result = ensureMemorySchema(cwd, { force: forceMode });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.clear();
  p.intro(pc.bgMagenta(pc.white(" 🧠 oh-my-agent memory:init ")));

  const summaryLines = [
    `Memories dir: ${pc.cyan(result.memoriesDir)}`,
    `Session ID: ${pc.cyan(result.sessionId)}`,
    "",
    pc.bold("Created:"),
    result.created.length > 0
      ? result.created.map((f) => `  + ${f}`).join("\n")
      : "  (none)",
    "",
    pc.bold("Updated:"),
    result.updated.length > 0
      ? result.updated.map((f) => `  ~ ${f}`).join("\n")
      : "  (none)",
    "",
    pc.bold("Skipped:"),
    result.skipped.length > 0
      ? result.skipped.map((f) => `  - ${f}`).join("\n")
      : "  (none)",
  ].join("\n");

  p.note(summaryLines, "Memory Schema");
  p.outro(pc.green("Memory schema ready!"));
}

export async function getAgentMemoryStatus(
  provider: MemoryProvider = createAgentMemoryProvider(),
): Promise<MemoryProviderStatus> {
  return provider.status();
}

export async function setupAgentMemory(
  args: {
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    endpoint?: string;
    port?: number | string;
    dryRun?: boolean;
    install?: boolean;
    start?: boolean;
    installer?: AgentMemoryInstaller;
  } = {},
): Promise<MemorySetupResult> {
  const homeDir = args.homeDir ?? homedir();
  const configDir = agentMemoryConfigDir(homeDir);
  const endpointPath = agentMemoryEndpointPath(homeDir);
  const port = parsePositivePort(args.port);
  let wroteEndpoint = false;
  let installExitCode: number | null | undefined;
  let installSkipped: boolean | undefined;
  let installError: string | undefined;
  let daemon: MemoryDaemonResult | undefined;

  const nextConfig: AgentMemoryEndpointConfig | null = args.endpoint
    ? { url: args.endpoint, source: "oma", updatedAt: new Date().toISOString() }
    : port
      ? { port, source: "oma", updatedAt: new Date().toISOString() }
      : null;

  if (!args.dryRun) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    if (nextConfig) {
      writeEndpointConfig(homeDir, nextConfig);
      wroteEndpoint = true;
    }
  }

  if (args.install) {
    if (args.dryRun) {
      installSkipped = true;
    } else {
      const installResult = await (
        args.installer ?? defaultAgentMemoryInstaller
      )();
      installExitCode = installResult.status;
      installError = installResult.error;
      if (installExitCode !== 0) {
        throw new Error(
          installError ??
            `AgentMemory install failed with exit code ${installExitCode}`,
        );
      }
    }
  }

  if (args.start) {
    daemon = await controlAgentMemoryDaemon({
      action: "start",
      homeDir,
      env: args.env,
      port: port ?? DEFAULT_AGENTMEMORY_PORT,
      dryRun: args.dryRun,
    });
  }

  const endpoint =
    endpointFromConfig(nextConfig ?? readEndpointConfig(homeDir) ?? {}) ??
    resolveAgentMemoryEndpoint({ env: args.env, homeDir });
  const provider = createAgentMemoryProvider({
    env: args.env,
    homeDir,
  });
  const status = await provider.status();

  return {
    homeDir,
    configDir,
    endpointPath,
    endpoint,
    endpointConfigured: endpoint !== null,
    wroteEndpoint,
    dryRun: args.dryRun === true,
    installRequested: args.install === true,
    installExitCode,
    installSkipped,
    installError,
    startRequested: args.start === true,
    daemon,
    installCommand: AGENTMEMORY_INSTALL_COMMAND,
    startCommand: AGENTMEMORY_START_COMMAND,
    status,
  };
}

async function daemonStatus(args: {
  homeDir: string;
  env?: NodeJS.ProcessEnv;
  action?: MemoryDaemonResult["action"];
  dryRun?: boolean;
  message?: string;
}): Promise<MemoryDaemonResult> {
  const ownedPid = readOwnedPid(args.homeDir);
  const provider = createAgentMemoryProvider({
    env: args.env,
    homeDir: args.homeDir,
  });
  const status = await provider.status();
  return {
    action: args.action ?? "status",
    homeDir: args.homeDir,
    pidPath: agentMemoryPidPath(args.homeDir),
    ownedPid,
    ownedProcessRunning: isProcessRunning(ownedPid),
    endpoint: resolveAgentMemoryEndpoint({
      env: args.env,
      homeDir: args.homeDir,
    }),
    status,
    dryRun: args.dryRun === true,
    message: args.message,
  };
}

export async function controlAgentMemoryDaemon(args: {
  action: "status" | "start" | "stop" | "restart";
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  bin?: string;
  port?: number | string;
  dryRun?: boolean;
}): Promise<MemoryDaemonResult> {
  const homeDir = args.homeDir ?? homedir();
  const env = args.env ?? process.env;
  const bin = args.bin ?? env.AGENTMEMORY_BIN ?? "agentmemory";
  const port = parsePositivePort(args.port) ?? DEFAULT_AGENTMEMORY_PORT;

  if (args.action === "status") {
    return daemonStatus({
      homeDir,
      env,
      action: "status",
      dryRun: args.dryRun,
    });
  }

  if (args.action === "stop" || args.action === "restart") {
    const ownedPid = readOwnedPid(homeDir);
    let stoppedPid: number | undefined;
    let attemptedFallbackStop = false;
    let fallbackStopCode: number | null | undefined;

    if (!args.dryRun && ownedPid && isProcessRunning(ownedPid)) {
      process.kill(ownedPid, "SIGTERM");
      stoppedPid = ownedPid;
    }

    if (!args.dryRun && !stoppedPid) {
      attemptedFallbackStop = true;
      const result = spawnSync(bin, ["stop"], {
        env,
        timeout: 5000,
        encoding: "utf-8",
      });
      fallbackStopCode = result.status;
    }

    if (args.action === "stop") {
      return {
        ...(await daemonStatus({
          homeDir,
          env,
          action: "stop",
          dryRun: args.dryRun,
        })),
        stoppedPid,
        attemptedFallbackStop,
        fallbackStopCode,
      };
    }
  }

  if (args.action === "start" || args.action === "restart") {
    if (args.dryRun) {
      return daemonStatus({
        homeDir,
        env,
        action: args.action,
        dryRun: true,
        message: `${bin} would be started on port ${port}`,
      });
    }

    mkdirSync(agentMemoryConfigDir(homeDir), { recursive: true, mode: 0o700 });
    writeEndpointConfig(homeDir, {
      port,
      source: "oma",
      updatedAt: new Date().toISOString(),
    });

    const child = spawn(bin, [], {
      detached: true,
      env: { ...env, III_REST_PORT: String(port) },
      stdio: "ignore",
    });

    const startedPid = await new Promise<number>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };
      child.once("error", (error) => {
        settle(() => reject(error));
      });
      child.once("exit", (code) => {
        settle(() =>
          reject(
            new Error(`agentmemory exited during startup with code ${code}`),
          ),
        );
      });
      setTimeout(() => {
        settle(() => resolve(child.pid ?? 0));
      }, 250);
    });

    if (startedPid > 0) {
      child.unref();
      writeOwnedPid(homeDir, startedPid);
    }

    return {
      ...(await daemonStatus({
        homeDir,
        env,
        action: args.action,
        dryRun: false,
      })),
      startedPid,
    };
  }

  return daemonStatus({
    homeDir,
    env,
    action: args.action,
    dryRun: args.dryRun,
  });
}

export function installAgentMemoryService(
  args: { homeDir?: string; platform?: NodeJS.Platform; dryRun?: boolean } = {},
): MemoryServiceResult {
  const homeDir = args.homeDir ?? homedir();
  const platform = args.platform ?? process.platform;
  const servicePath =
    platform === "darwin"
      ? join(homeDir, "Library", "LaunchAgents", "dev.oma.agentmemory.plist")
      : platform === "linux"
        ? join(homeDir, ".config", "systemd", "user", "oma-agentmemory.service")
        : undefined;

  return {
    action: "install",
    platform,
    supported: servicePath !== undefined,
    dryRun: args.dryRun === true,
    servicePath,
    message:
      servicePath === undefined
        ? `AgentMemory service install is not supported on ${platform}`
        : "AgentMemory service file generation is deferred to PR6; use memory:daemon start for now",
  };
}

function parseRetryLine(line: string): OmaEvent | null {
  try {
    const parsed = JSON.parse(line) as Partial<OmaEvent>;
    if (
      typeof parsed.sid === "string" &&
      typeof parsed.kind === "string" &&
      typeof parsed.eventId === "string" &&
      typeof parsed.ts === "string"
    ) {
      return parsed as OmaEvent;
    }
    return null;
  } catch {
    return null;
  }
}

export async function drainMemoryRetryQueue(
  args: {
    projectDir?: string;
    provider?: MemoryProvider;
    dryRun?: boolean;
  } = {},
): Promise<MemoryRetryDrainResult> {
  const projectDir = args.projectDir ?? process.cwd();
  const provider = args.provider ?? createAgentMemoryProvider();
  const retryPath = retryObservePath(projectDir);
  if (!existsSync(retryPath)) {
    return {
      retryPath,
      total: 0,
      drained: 0,
      retained: 0,
      invalid: 0,
      dryRun: args.dryRun === true,
    };
  }

  const lines = readFileSync(retryPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim());
  const retainedLines: string[] = [];
  let drained = 0;
  let invalid = 0;

  for (const line of lines) {
    const event = parseRetryLine(line);
    if (!event) {
      invalid += 1;
      retainedLines.push(line);
      continue;
    }

    if (args.dryRun) {
      retainedLines.push(line);
      continue;
    }

    const observed = await provider.observe({
      sessionId: event.sid,
      content: `${JSON.stringify(event)}\n`,
      source: "oma-workflow",
    });
    if (observed) {
      drained += 1;
    } else {
      retainedLines.push(line);
    }
  }

  if (!args.dryRun) {
    const tmp = `${retryPath}.${process.pid}.${Date.now()}.tmp`;
    const content =
      retainedLines.length > 0 ? `${retainedLines.join("\n")}\n` : "";
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, retryPath);
  }

  return {
    retryPath,
    total: lines.length,
    drained,
    retained: retainedLines.length,
    invalid,
    dryRun: args.dryRun === true,
  };
}

export async function printAgentMemoryStatus(jsonMode = false): Promise<void> {
  const status = await getAgentMemoryStatus();
  if (jsonMode) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  const reachable = status.reachable
    ? pc.green("reachable")
    : pc.red("offline");
  p.note(
    [
      `Status: ${reachable}`,
      status.endpoint ? `Endpoint: ${pc.cyan(status.endpoint)}` : null,
      status.version ? `Version: ${pc.cyan(status.version)}` : null,
      status.reason ? `Reason: ${status.reason}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    "AgentMemory",
  );
}

export async function printAgentMemorySetup(
  jsonMode = false,
  args: {
    endpoint?: string;
    port?: number | string;
    dryRun?: boolean;
    install?: boolean;
    start?: boolean;
  } = {},
): Promise<void> {
  const result = await setupAgentMemory(args);
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const lines = [
    `Config dir: ${pc.cyan(result.configDir)}`,
    `Endpoint file: ${pc.cyan(result.endpointPath)}`,
    `Endpoint: ${result.endpoint ? pc.cyan(result.endpoint) : pc.yellow("(not configured)")}`,
    `Wrote endpoint: ${result.wroteEndpoint ? pc.green("yes") : "no"}`,
    result.dryRun ? pc.dim("Dry run: files unchanged") : null,
    `Install: ${pc.cyan(result.installCommand)}`,
  ];
  if (result.installRequested) {
    const installState = result.installSkipped
      ? pc.yellow("skipped")
      : result.installExitCode === 0
        ? pc.green("ok")
        : pc.red(String(result.installExitCode ?? "unknown"));
    lines.push(`Install result: ${installState}`);
  }
  lines.push(`Start: ${pc.cyan(result.startCommand)}`);
  if (result.daemon?.startedPid)
    lines.push(`Started PID: ${result.daemon.startedPid}`);
  if (result.daemon?.message) lines.push(result.daemon.message);
  if (result.status.reason) lines.push(`Status: ${result.status.reason}`);
  p.note(
    lines.filter((line): line is string => line !== null).join("\n"),
    "AgentMemory setup",
  );
}

export async function printAgentMemoryDaemon(
  action: "status" | "start" | "stop" | "restart",
  jsonMode = false,
  args: {
    port?: number | string;
    dryRun?: boolean;
  } = {},
): Promise<void> {
  const result = await controlAgentMemoryDaemon({ action, ...args });
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const lines = [
    `Endpoint: ${result.endpoint ? pc.cyan(result.endpoint) : pc.yellow("(not configured)")}`,
    `Reachable: ${result.status.reachable ? pc.green("yes") : pc.red("no")}`,
  ];
  if (result.startedPid) lines.push(`Started PID: ${result.startedPid}`);
  if (result.stoppedPid) lines.push(`Stopped PID: ${result.stoppedPid}`);
  if (result.ownedPid) {
    lines.push(
      `OMA-owned PID: ${result.ownedPid} (${result.ownedProcessRunning ? "running" : "not running"})`,
    );
  }
  if (result.attemptedFallbackStop) {
    lines.push(`Fallback stop exit: ${result.fallbackStopCode ?? "unknown"}`);
  }
  if (result.message) lines.push(result.message);
  if (result.status.reason) lines.push(`Reason: ${result.status.reason}`);
  p.note(lines.join("\n"), `AgentMemory daemon: ${action}`);
}

export function printAgentMemoryServiceInstall(
  jsonMode = false,
  dryRun = false,
): void {
  const result = installAgentMemoryService({ dryRun });
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  p.note(
    [
      `Platform: ${result.platform}`,
      result.servicePath ? `Path: ${pc.cyan(result.servicePath)}` : null,
      result.supported ? pc.yellow(result.message) : pc.red(result.message),
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    "AgentMemory service: install",
  );
}

export async function printMemoryRetryDrain(
  jsonMode = false,
  dryRun = false,
): Promise<void> {
  const result = await drainMemoryRetryQueue({ dryRun });
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const lines = [
    `Path: ${pc.cyan(result.retryPath)}`,
    `Total: ${result.total}`,
    `Drained: ${pc.green(String(result.drained))}`,
    `Retained: ${pc.yellow(String(result.retained))}`,
  ];
  if (result.invalid > 0)
    lines.push(`Invalid: ${pc.red(String(result.invalid))}`);
  if (result.dryRun) lines.push(pc.dim("Dry run: retry file unchanged"));
  p.note(lines.join("\n"), "Retry queue");
}
