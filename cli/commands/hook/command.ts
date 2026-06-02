import type { Command } from "commander";
import { runAction } from "../../utils/cli-framework.js";
import {
  PROBE_VENDORS,
  type ProbeVendor,
  renderProbeMatrix,
  renderProbeMatrixMarkdown,
  runHookProbe,
} from "./probe.js";

const PROBE_FORMATS = ["text", "md", "json"] as const;
type ProbeFormat = (typeof PROBE_FORMATS)[number];

function parseFormat(value: string | undefined): ProbeFormat {
  const normalized = (value ?? "text").trim().toLowerCase();
  if (!PROBE_FORMATS.includes(normalized as ProbeFormat)) {
    throw new Error(
      `invalid format: ${value}. Expected one of ${PROBE_FORMATS.join(", ")}`,
    );
  }
  return normalized as ProbeFormat;
}

function parseVendors(value: string | undefined): ProbeVendor[] | undefined {
  if (!value) return undefined;
  const requested = value
    .split(",")
    .map((vendor) => vendor.trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter(
    (vendor) => !PROBE_VENDORS.includes(vendor as ProbeVendor),
  );
  if (invalid.length > 0) {
    throw new Error(
      `unknown vendor(s): ${invalid.join(", ")}. Valid: ${PROBE_VENDORS.join(", ")}`,
    );
  }
  return requested as ProbeVendor[];
}

export function registerHook(program: Command): void {
  program
    .command("hook:probe")
    .description(
      "Probe per-vendor L1 hook compatibility and print a matrix (D63)",
    )
    .option(
      "--vendor <list>",
      `Comma-separated vendors (default: ${PROBE_VENDORS.join(",")})`,
    )
    .option("--format <fmt>", "Output format: text | md | json", "text")
    .option("--hooks-dir <dir>", "Override the .agents/hooks/core directory")
    .action(
      runAction(async (options) => {
        const format = parseFormat(options.format as string | undefined);
        const matrix = runHookProbe({
          vendors: parseVendors(options.vendor as string | undefined),
          hooksDir: options.hooksDir as string | undefined,
        });

        if (format === "json") {
          console.log(JSON.stringify(matrix, null, 2));
        } else if (format === "md") {
          console.log(renderProbeMatrixMarkdown(matrix));
        } else {
          console.log(renderProbeMatrix(matrix));
        }

        if (matrix.results.some((result) => result.status === "failed")) {
          process.exitCode = 1;
        }
      }),
    );
}
