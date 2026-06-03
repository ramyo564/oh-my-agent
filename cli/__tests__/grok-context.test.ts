import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearGrokContext,
  syncGrokContext,
} from "../../.agents/hooks/core/grok-context.ts";

const REL = join(".grok", "rules", "oma-state.md");

describe("grok-context", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oma-grok-ctx-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the OMA context to a dedicated .grok/rules file (not a user instruction file)", () => {
    syncGrokContext(dir, "[OMA STATE SNAPSHOT]\nsid: oma-1");
    const path = join(dir, REL);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toContain("[OMA STATE SNAPSHOT]");
    // never touches AGENTS.md-family user instruction files
    expect(existsSync(join(dir, "CLAUDE.local.md"))).toBe(false);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("overwrites on resync (single managed file)", () => {
    syncGrokContext(dir, "first");
    syncGrokContext(dir, "second");
    expect(readFileSync(join(dir, REL), "utf-8").trim()).toBe("second");
  });

  it("clearGrokContext removes the file", () => {
    syncGrokContext(dir, "x");
    expect(existsSync(join(dir, REL))).toBe(true);
    clearGrokContext(dir);
    expect(existsSync(join(dir, REL))).toBe(false);
  });

  it("clear is a no-op when the file is absent", () => {
    expect(() => clearGrokContext(dir)).not.toThrow();
  });
});
