import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultIndex,
  getActiveSid,
  indexPath,
  readIndex,
  setActiveSession,
  setLastSession,
  updateIndex,
} from "../../.agents/hooks/core/state-marker.ts";

describe("hook state-marker", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "oma-state-marker-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns a default index when none exists", () => {
    expect(readIndex(projectDir)).toEqual(defaultIndex());
  });

  it("writes and reads the active map and last marker", () => {
    setActiveSession(projectDir, "main", "oma-1");
    setLastSession(projectDir, "claude", "claude-session-1");
    const index = readIndex(projectDir);
    expect(index.active.main).toBe("oma-1");
    expect(index.lastSession).toMatchObject({
      vendor: "claude",
      vendorSid: "claude-session-1",
    });
  });

  it("falls back to main when a category is absent", () => {
    setActiveSession(projectDir, "main", "oma-main");
    const index = readIndex(projectDir);
    expect(getActiveSid(index, "tool.deepsec")).toBe("oma-main");
    expect(getActiveSid(index, "main")).toBe("oma-main");
  });

  it("retries the CAS write when _index.json mtime changes mid-update", () => {
    setActiveSession(projectDir, "main", "seed");
    let calls = 0;
    const result = updateIndex(projectDir, (index) => {
      index.active.main = "oma-updated";
      calls += 1;
      if (calls === 1) {
        // Simulate a concurrent writer bumping mtime between read and write.
        const future = new Date(Date.now() + 100_000);
        utimesSync(indexPath(projectDir), future, future);
      }
    });
    expect(calls).toBe(2);
    expect(result.active.main).toBe("oma-updated");
    expect(readIndex(projectDir).active.main).toBe("oma-updated");
  });

  it("leaves _index.json stale (no throw, no corruption) when CAS is exhausted (D69)", () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true as unknown as boolean);
    setActiveSession(projectDir, "main", "seed");
    const original = readFileSync(indexPath(projectDir), "utf-8");

    let attempts = 0;
    const result = updateIndex(
      projectDir,
      (index) => {
        index.active.main = "never-persisted";
        attempts += 1;
        // Bump mtime to a fresh value every attempt so the CAS check always
        // detects a concurrent change and never settles.
        const future = new Date(Date.now() + attempts * 100_000);
        utimesSync(indexPath(projectDir), future, future);
      },
      3,
    );

    expect(attempts).toBe(3);
    // Stale, not corrupted: content is unchanged and still valid.
    expect(result.active.main).toBe("seed");
    expect(readFileSync(indexPath(projectDir), "utf-8")).toBe(original);
    expect(readIndex(projectDir).active.main).toBe("seed");
    // A diagnostic with the repair hint is surfaced.
    const messages = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(messages).toContain("CAS retries exhausted");
    expect(messages).toContain("oma state repair");
  });

  it("keeps the index file valid JSON after concurrent-style updates", () => {
    setActiveSession(projectDir, "main", "a");
    setActiveSession(projectDir, "tool.recap", "b");
    expect(existsSync(indexPath(projectDir))).toBe(true);
    expect(() =>
      JSON.parse(readFileSync(indexPath(projectDir), "utf-8")),
    ).not.toThrow();
    expect(statSync(indexPath(projectDir)).isFile()).toBe(true);
  });
});
