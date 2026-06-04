import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateGeminiCliCompat } from "./006-gemini-cli-compat.js";

describe("migrateGeminiCliCompat (006)", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("sanitizes legacy Gemini MCP keys and normalizes hooks", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-006-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".gemini"), { recursive: true });
    writeFileSync(
      join(root, ".gemini", "settings.json"),
      `${JSON.stringify(
        {
          general: { enableNotifications: true },
          experimental: {},
          mcpServers: {
            serena: {
              command: "uvx",
              args: ["serena"],
              available_tools: ["find_symbol"],
            },
          },
          hooks: {
            BeforeAgent: [
              {
                hooks: [
                  {
                    command:
                      'bun "$GEMINI_PROJECT_DIR/.gemini/hooks/keyword-detector.ts"',
                    timeout: 5,
                  },
                ],
              },
            ],
            BeforeTool: [
              {
                matcher: "Bash",
                hooks: [
                  {
                    command:
                      'bun "$GEMINI_PROJECT_DIR/.gemini/hooks/test-filter.ts"',
                    timeout: 5,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const actions = migrateGeminiCliCompat.up(root);
    const result = JSON.parse(
      readFileSync(join(root, ".gemini", "settings.json"), "utf-8"),
    );

    expect(actions).toContain(
      ".gemini/settings.json (Gemini CLI compatibility updated)",
    );
    expect(actions).toContain(
      ".gemini/settings.json hooks (Gemini matcher/timeout normalized)",
    );
    expect(result.experimental).toEqual({ enableAgents: true });
    expect(result.mcpServers.serena).toEqual({
      command: "uvx",
      args: ["serena"],
      includeTools: ["find_symbol"],
    });
    expect(result.hooks.BeforeTool[0].matcher).toBe("run_shell_command");
    expect(result.hooks.BeforeTool[0].hooks[0].name).toBe("test-filter");
    expect(result.hooks.BeforeTool[0].hooks[0].timeout).toBe(5000);
    expect(result.hooks.BeforeAgent[0].hooks[0].name).toBe("keyword-detector");
    expect(result.hooks.BeforeAgent[0].hooks[0].timeout).toBe(5000);
  });

  it("is idempotent on the second run", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-006-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".gemini"), { recursive: true });
    writeFileSync(
      join(root, ".gemini", "settings.json"),
      `${JSON.stringify(
        {
          general: { enableNotifications: true },
          experimental: { enableAgents: true },
          privacy: { usageStatisticsEnabled: false },
          mcpServers: {
            "chrome-devtools": {
              command: "npx",
              args: [
                "-y",
                "chrome-devtools-mcp@latest",
                "--no-usage-statistics",
                "--isolated",
              ],
            },
            serena: {
              command: "serena",
              args: [
                "start-mcp-server",
                "--context",
                "ide",
                "--project",
                ".",
                "--open-web-dashboard",
                "false",
              ],
              env: { SERENA_LOG_LEVEL: "info" },
              includeTools: ["find_symbol"],
            },
          },
          hooks: {
            BeforeAgent: [
              {
                hooks: [
                  {
                    name: "keyword-detector",
                    command:
                      'bun "$GEMINI_PROJECT_DIR/.gemini/hooks/keyword-detector.ts"',
                    timeout: 5000,
                  },
                ],
              },
            ],
            BeforeTool: [
              {
                matcher: "run_shell_command",
                hooks: [
                  {
                    name: "test-filter",
                    command:
                      'bun "$GEMINI_PROJECT_DIR/.gemini/hooks/test-filter.ts"',
                    timeout: 5000,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const first = migrateGeminiCliCompat.up(root);
    expect(first).toHaveLength(0);

    const second = migrateGeminiCliCompat.up(root);
    expect(second).toHaveLength(0);
  });
});
