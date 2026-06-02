import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getMemoriesPath } from "../io/memory.js";
import {
  deriveMeta,
  emitEvent,
  type OmaEvent,
  eventPayloadText as payloadText,
  readEvents,
  type SessionMeta,
} from "./events.js";

/**
 * Post-completion Serena memory mirror (D25 / D67).
 *
 * On terminal sessions OMA mirrors a human-readable summary into
 * `.serena/memories/session-{workflow}-{sid}.md`. Per D67 the mirror tries a
 * Serena MCP `write_memory` first (when a writer is injected by an MCP-capable
 * caller) and falls back to a direct filesystem write. Both failures emit a
 * local warning event; neither path affects L1 correctness.
 */

export interface SerenaMirrorWriter {
  /** Returns true when the MCP write succeeds. */
  write(name: string, content: string): Promise<boolean> | boolean;
}

export type SerenaMirrorMethod = "serena-mcp" | "direct-fs" | "none";

export interface SerenaMirrorResult {
  sid: string;
  workflow: string;
  /** Serena memory name without extension, e.g. `session-ultrawork-01HXZK`. */
  memoryName: string;
  /** Filesystem path written by the direct-fs fallback. */
  path: string;
  method: SerenaMirrorMethod;
  written: boolean;
  warning?: string;
}

const MIRROR_WARNING_KIND = "mirror.warning";

/** Keep memory names filesystem- and Serena-safe. */
function sanitizeSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "session";
}

export function mirrorMemoryName(workflow: string, sid: string): string {
  return `session-${sanitizeSegment(workflow)}-${sanitizeSegment(sid)}`;
}

export function buildSessionMirror(
  sid: string,
  meta: SessionMeta,
  events: OmaEvent[],
): string {
  const gates = events.filter((event) => event.kind === "gate.passed");
  const decisions = events.filter((event) => event.kind === "decision.made");
  const boundaries = events.filter((event) => event.kind === "boundary");

  const lines: string[] = [
    `# OMA Session Mirror: ${meta.workflow || "(unknown)"} ${sid}`,
    "",
    `- workflow: ${meta.workflow || "(unknown)"}`,
    `- status: ${meta.status}`,
    `- phase: ${meta.currentPhase || "(none)"}`,
    `- created: ${meta.createdAt || "(unknown)"}`,
    `- events: ${events.length}`,
    "",
    "## Decisions",
  ];

  if (decisions.length === 0) {
    lines.push("- (none recorded)");
  } else {
    for (const event of decisions) {
      const subject = payloadText(event, "subject", "(unspecified)");
      const decision = payloadText(event, "decision", "(unspecified)");
      const rationale = payloadText(event, "rationale");
      lines.push(
        `- **${subject}** → ${decision}${rationale ? ` _(${rationale})_` : ""}`,
      );
    }
  }

  lines.push("", "## Gates");
  if (gates.length === 0) {
    lines.push("- (none recorded)");
  } else {
    for (const event of gates) {
      const gate = payloadText(event, "gate", "(unnamed)");
      const by = payloadText(event, "by");
      lines.push(`- ${gate}${by ? ` by ${by}` : ""} (${event.ts})`);
    }
  }

  if (boundaries.length > 0) {
    lines.push("", "## Vendor Boundaries");
    for (const event of boundaries) {
      const from = payloadText(event, "fromVendor", "(new)");
      const to = payloadText(event, "toVendor", event.vendor ?? "(unknown)");
      lines.push(`- ${from} → ${to} (${event.ts})`);
    }
  }

  lines.push("", "## Recent Events");
  for (const event of events.slice(-20)) {
    lines.push(`- ${event.ts} \`${event.kind}\``);
  }
  lines.push("");

  return lines.join("\n");
}

export async function mirrorSessionToSerena(args: {
  sid: string;
  projectDir?: string;
  writer?: SerenaMirrorWriter;
}): Promise<SerenaMirrorResult> {
  const projectDir = args.projectDir ?? process.cwd();
  const events = readEvents(projectDir, args.sid);
  const meta = deriveMeta(args.sid, events);
  const workflow = meta.workflow || "session";
  const memoryName = mirrorMemoryName(workflow, args.sid);
  const path = join(getMemoriesPath(projectDir), `${memoryName}.md`);
  const content = buildSessionMirror(args.sid, meta, events);

  const base = { sid: args.sid, workflow, memoryName, path };

  // D67: prefer Serena MCP when a writer is available.
  if (args.writer) {
    try {
      const ok = await args.writer.write(memoryName, content);
      if (ok) {
        return { ...base, method: "serena-mcp", written: true };
      }
    } catch {
      // Fall through to the direct-fs fallback.
    }
  }

  // D67 fallback: direct filesystem write under `.serena/memories/`.
  try {
    mkdirSync(getMemoriesPath(projectDir), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return { ...base, method: "direct-fs", written: true };
  } catch (error) {
    const warning = error instanceof Error ? error.message : String(error);
    await emitMirrorWarning(projectDir, args.sid, memoryName, warning);
    return { ...base, method: "none", written: false, warning };
  }
}

async function emitMirrorWarning(
  projectDir: string,
  sid: string,
  memoryName: string,
  warning: string,
): Promise<void> {
  // The warning is L1-local and must never throw out of the mirror path.
  try {
    emitEvent(projectDir, sid, {
      kind: MIRROR_WARNING_KIND,
      payload: { memoryName, warning },
    });
  } catch {
    process.stderr.write(
      `[oma] Serena mirror failed and warning event could not be written: ${warning}\n`,
    );
  }
}

export function renderSerenaMirrorResult(result: SerenaMirrorResult): string {
  if (result.written) {
    return `Mirrored ${result.sid} → ${result.memoryName} (${result.method})\n  ${result.path}`;
  }
  return `Serena mirror skipped for ${result.sid}: ${result.warning ?? "unknown error"}`;
}
