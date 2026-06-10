import { spawnSync } from "node:child_process";
import type {
  MemoryCommandStatus,
  MemoryServiceCommand,
  MemoryServiceCommandPlanOptions,
  MemoryServiceCommandResult,
  MemoryServiceCommandRunOptions,
} from "../../types/memory.js";
import { LAUNCHD_AGENTMEMORY_LABEL } from "./service-files.js";

/**
 * AgentMemory service activation commands: per-platform install/uninstall
 * command plans (launchctl / systemctl / schtasks) and their runner. Split
 * out of `platform/agentmemory-service.ts` (D43).
 */

export const WINDOWS_TASK_NAME = "OMA AgentMemory";

export function defaultServiceCommandRunner(
  command: MemoryServiceCommand,
): MemoryCommandStatus {
  const result = spawnSync(command.bin, command.args, {
    encoding: "utf-8",
    stdio: "pipe",
    timeout: 10000,
  });
  return {
    status: result.status,
    error: result.error?.message ?? result.stderr?.trim() ?? undefined,
  };
}

function serviceDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

export function serviceCommands(
  args: MemoryServiceCommandPlanOptions,
): MemoryServiceCommand[] {
  if (args.platform === "darwin") {
    const domain = serviceDomain();
    const serviceId = `${domain}/${LAUNCHD_AGENTMEMORY_LABEL}`;
    return args.action === "install"
      ? [
          {
            bin: "launchctl",
            args: ["bootout", domain, args.servicePath],
            optional: true,
          },
          { bin: "launchctl", args: ["bootstrap", domain, args.servicePath] },
          { bin: "launchctl", args: ["enable", serviceId] },
          { bin: "launchctl", args: ["kickstart", "-k", serviceId] },
        ]
      : [
          { bin: "launchctl", args: ["disable", serviceId], optional: true },
          {
            bin: "launchctl",
            args: ["bootout", domain, args.servicePath],
            optional: true,
          },
        ];
  }

  if (args.platform === "linux") {
    return args.action === "install"
      ? [
          { bin: "systemctl", args: ["--user", "daemon-reload"] },
          {
            bin: "systemctl",
            args: ["--user", "enable", "--now", "oma-agentmemory.service"],
          },
        ]
      : [
          {
            bin: "systemctl",
            args: ["--user", "disable", "--now", "oma-agentmemory.service"],
            optional: true,
          },
          { bin: "systemctl", args: ["--user", "daemon-reload"] },
        ];
  }

  if (args.platform === "win32") {
    return args.action === "install"
      ? [
          {
            bin: "schtasks",
            args: [
              "/create",
              "/tn",
              WINDOWS_TASK_NAME,
              "/xml",
              args.servicePath,
              "/f",
            ],
          },
          {
            bin: "schtasks",
            args: ["/run", "/tn", WINDOWS_TASK_NAME],
          },
        ]
      : [
          {
            bin: "schtasks",
            args: ["/end", "/tn", WINDOWS_TASK_NAME],
            optional: true,
          },
          {
            bin: "schtasks",
            args: ["/delete", "/tn", WINDOWS_TASK_NAME, "/f"],
            optional: true,
          },
        ];
  }

  return [];
}

export function formatServiceCommand(command: MemoryServiceCommand): string {
  return [command.bin, ...command.args].join(" ");
}

export function runServiceCommands(
  args: MemoryServiceCommandRunOptions,
): MemoryServiceCommandResult {
  for (const command of args.commands) {
    const result = args.runner(command);
    if (result.status === 0 || command.optional) continue;
    return {
      activated: false,
      commandExitCode: result.status,
      commandError: result.error,
    };
  }

  return { activated: true };
}
