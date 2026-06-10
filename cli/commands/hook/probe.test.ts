import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROBE_VENDORS,
  type ProbeVendor,
  renderProbeMatrix,
  renderProbeMatrixMarkdown,
  runHookProbe,
} from "./probe.js";

const repoRoot = join(__dirname, "..", "..", "..");

describe("hook compatibility probe", () => {
  // Cover the stdout-injection styles and the newer project-hook vendors.
  const vendors: ProbeVendor[] = ["claude", "codex", "cursor", "grok", "kiro"];

  it("reports verified L1 compatibility for supported vendors", () => {
    const matrix = runHookProbe({ vendors, projectDir: repoRoot });
    expect(matrix.results.map((result) => result.vendor)).toEqual(vendors);

    for (const result of matrix.results) {
      expect(result.invoked, `${result.vendor} invoked`).toBe(true);
      expect(result.stdinAccepted, `${result.vendor} stdin`).toBe(true);
      expect(result.injection.ok, `${result.vendor} injection`).toBe(true);
      expect(result.eventsRecorded, `${result.vendor} events`).toBe(true);
      expect(result.reopenFlush, `${result.vendor} reopen`).toBe(true);
      expect(result.chainOrder).toEqual([
        "keyword-detector.ts",
        "state-boundary.ts",
        "skill-injector.ts",
        "serena-primer.ts",
      ]);
      expect(result.status, `${result.vendor} status`).toBe("verified");
      expect(result.notes).toEqual([]);
    }
  }, 30000);

  it("records the vendor-specific injection field", () => {
    const matrix = runHookProbe({ vendors: ["codex"], projectDir: repoRoot });
    expect(matrix.results[0]?.injection.field).toBe(
      "hookSpecificOutput.additionalContext",
    );
  }, 15000);

  it("renders text and markdown matrices", () => {
    const matrix = runHookProbe({ vendors: ["claude"], projectDir: repoRoot });
    const text = renderProbeMatrix(matrix);
    expect(text).toContain("OMA hook compatibility probe");
    expect(text).toContain("claude");
    expect(text).toContain("PASS");

    const markdown = renderProbeMatrixMarkdown(matrix);
    expect(markdown).toContain("# OMA Hook Compatibility Matrix");
    expect(markdown).toContain(
      "keyword-detector.ts → state-boundary.ts → skill-injector.ts",
    );
  }, 15000);

  it("exposes the default vendor set", () => {
    expect(PROBE_VENDORS).toContain("claude");
    expect(PROBE_VENDORS).toContain("codex");
    expect(PROBE_VENDORS).toContain("grok");
    expect(PROBE_VENDORS).toContain("kiro");
    expect(PROBE_VENDORS).toContain("qwen");
  });

  it("throws a helpful error when hooks are missing", () => {
    expect(() =>
      runHookProbe({ hooksDir: join(repoRoot, "does", "not", "exist") }),
    ).toThrow(/OMA hooks not found/);
  });
});
