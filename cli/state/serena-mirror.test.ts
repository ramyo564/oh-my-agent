import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMemoriesPath } from "../io/memory.js";
import { activateWorkflowSession, emitEvent, readEvents } from "./events.js";
import {
  buildSessionMirror,
  mirrorMemoryName,
  mirrorSessionToSerena,
} from "./serena-mirror.js";

function seedSession(projectDir: string, sid: string): void {
  activateWorkflowSession({
    projectDir,
    workflow: "ultrawork",
    sid,
    vendor: "claude-code",
    vendorSid: "vendor-1",
  });
  emitEvent(projectDir, sid, {
    kind: "decision.made",
    payload: {
      subject: "JWT expiry",
      decision: "24h",
      rationale: "mobile-first",
    },
  });
  emitEvent(projectDir, sid, {
    kind: "gate.passed",
    payload: { gate: "phase-1-design", by: "architecture-reviewer-01" },
  });
  emitEvent(projectDir, sid, {
    kind: "session.ended",
    payload: { status: "completed" },
  });
}

describe("serena-mirror", () => {
  let projectDir: string;
  const sid = "01HXZKTESTSID";

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "oma-serena-mirror-"));
    seedSession(projectDir, sid);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe("mirrorMemoryName", () => {
    it("builds a sanitized session memory name", () => {
      expect(mirrorMemoryName("ultrawork", sid)).toBe(
        `session-ultrawork-${sid.toLowerCase()}`,
      );
      expect(mirrorMemoryName("Deep Sec!", "AB/CD")).toBe(
        "session-deep-sec-ab-cd",
      );
    });
  });

  describe("buildSessionMirror", () => {
    it("includes decisions, gates, and recent events", () => {
      const events = readEvents(projectDir, sid);
      const content = buildSessionMirror(
        sid,
        {
          sid,
          schemaVersion: 1,
          workflow: "ultrawork",
          category: "main",
          status: "completed",
          gatesPassedBy: [],
          pendingPeerReviews: [],
        },
        events,
      );
      expect(content).toContain(`# OMA Session Mirror: ultrawork ${sid}`);
      expect(content).toContain("**JWT expiry** → 24h");
      expect(content).toContain("mobile-first");
      expect(content).toContain("phase-1-design by architecture-reviewer-01");
      expect(content).toContain("`session.ended`");
    });
  });

  describe("mirrorSessionToSerena", () => {
    it("writes a direct-fs mirror when no MCP writer is supplied", async () => {
      const result = await mirrorSessionToSerena({ projectDir, sid });
      expect(result).toMatchObject({
        sid,
        workflow: "ultrawork",
        method: "direct-fs",
        written: true,
      });
      const expectedPath = join(
        getMemoriesPath(projectDir),
        `${mirrorMemoryName("ultrawork", sid)}.md`,
      );
      expect(result.path).toBe(expectedPath);
      expect(existsSync(expectedPath)).toBe(true);
      expect(readFileSync(expectedPath, "utf-8")).toContain("**JWT expiry**");
    });

    it("prefers the Serena MCP writer when it succeeds", async () => {
      const calls: Array<{ name: string; content: string }> = [];
      const result = await mirrorSessionToSerena({
        projectDir,
        sid,
        writer: {
          write(name, content) {
            calls.push({ name, content });
            return true;
          },
        },
      });
      expect(result.method).toBe("serena-mcp");
      expect(result.written).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe(mirrorMemoryName("ultrawork", sid));
      // MCP succeeded, so no direct-fs file is written.
      expect(existsSync(result.path)).toBe(false);
    });

    it("falls back to direct-fs when the MCP writer returns false", async () => {
      const result = await mirrorSessionToSerena({
        projectDir,
        sid,
        writer: {
          write() {
            return false;
          },
        },
      });
      expect(result.method).toBe("direct-fs");
      expect(result.written).toBe(true);
      expect(existsSync(result.path)).toBe(true);
    });

    it("falls back to direct-fs when the MCP writer throws", async () => {
      const result = await mirrorSessionToSerena({
        projectDir,
        sid,
        writer: {
          write() {
            throw new Error("mcp unavailable");
          },
        },
      });
      expect(result.method).toBe("direct-fs");
      expect(result.written).toBe(true);
    });

    it("emits a warning event and never throws when both paths fail", async () => {
      // Make `.serena/memories` unwritable by making it a read-only file path.
      const serenaDir = join(projectDir, ".serena");
      // Create `.serena` as a read-only directory so memories/ cannot be made.
      mkdirSync(serenaDir, { recursive: true });
      chmodSync(serenaDir, 0o400);

      let result: Awaited<ReturnType<typeof mirrorSessionToSerena>>;
      try {
        result = await mirrorSessionToSerena({ projectDir, sid });
      } finally {
        chmodSync(serenaDir, 0o700);
      }

      expect(result.written).toBe(false);
      expect(result.method).toBe("none");
      expect(result.warning).toBeTruthy();

      const warnings = readEvents(projectDir, sid).filter(
        (event) => event.kind === "mirror.warning",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.payload?.memoryName).toBe(
        mirrorMemoryName("ultrawork", sid),
      );
    });
  });
});
