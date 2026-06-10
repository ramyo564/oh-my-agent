/**
 * findings-cache.ts
 *
 * Session-scoped shared findings cache for multi-agent sessions.
 * Allows agent B to reuse symbols/patterns/files already discovered by agent A,
 * cutting redundant tool calls and token usage.
 *
 * Storage: .serena/memories/findings-{sessionId}.md via the shared
 * MarkdownRecordStore (see io/markdown-records.ts).
 */

import { createMarkdownRecordStore } from "./markdown-records.js";

/** A single cached discovery made by an agent during a session. */
export interface FindingRecord {
  /** Identifier -- e.g. "ModelSpec" or "src/foo.ts:42" */
  symbol: string;
  /** Category of finding */
  kind: "symbol" | "pattern" | "file";
  /** JSON-serializable payload returned by the tool */
  result: unknown;
  /** ISO 8601 timestamp when the record was created */
  recordedAt: string;
  /** Which agent discovered it (optional) */
  agentId?: string;
}

const store = createMarkdownRecordStore<FindingRecord>({
  filePrefix: "findings",
  title: "Findings",
  isRecordValid: (value) => {
    const record = value as FindingRecord | null;
    return !!record && typeof record.symbol === "string" && !!record.kind;
  },
});

/**
 * Record a finding to the session's findings file.
 * Creates the file with YAML frontmatter on first write.
 * Uses appendFileSync for concurrent-safe (POSIX atomic) appends.
 *
 * @throws if record.result is not JSON-serializable
 */
export function recordFinding(sessionId: string, record: FindingRecord): void {
  try {
    JSON.stringify(record);
  } catch (err) {
    throw new Error(
      `FindingsCache: result for symbol "${record.symbol}" is not JSON-serializable. ` +
        `Wrap the payload in a plain object before recording. Original error: ${String(err)}`,
    );
  }
  store.append(sessionId, record);
}

/**
 * Look up an existing finding by symbol (and optionally kind).
 * Returns the most recently recorded matching record, or null if not found.
 */
export function lookupFinding(
  sessionId: string,
  symbol: string,
  kind?: FindingRecord["kind"],
): FindingRecord | null {
  const matches = store
    .load(sessionId)
    .filter(
      (r) => r.symbol === symbol && (kind === undefined || r.kind === kind),
    );

  return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}

/**
 * Return all findings recorded in the session, in order of recording.
 */
export function listFindings(sessionId: string): FindingRecord[] {
  return store.load(sessionId);
}

/**
 * Delete the session findings file entirely.
 * Intended for use in tests only -- production sessions should persist for debugging.
 */
export function clearSession(sessionId: string): void {
  store.remove(sessionId);
}
