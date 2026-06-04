import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateClaudeMdLocal } from "./004-claude-md-local.js";

describe("migrateClaudeMdLocal (004)", () => {
  const tempRoots: string[] = [];
  let originalHome: string | undefined;

  function setup(): string {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-004-"));
    tempRoots.push(root);
    originalHome = process.env.HOME;
    process.env.HOME = root;
    return root;
  }

  afterEach(() => {
    process.env.HOME = originalHome;
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("does nothing when ~/.claude/CLAUDE.md does not exist", () => {
    setup();
    const actions = migrateClaudeMdLocal.up("/unused");
    expect(actions).toHaveLength(0);
  });

  it("does nothing when no OMA block exists", () => {
    const home = setup();
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "CLAUDE.md"), "# My global notes\n");

    const actions = migrateClaudeMdLocal.up("/unused");
    expect(actions).toHaveLength(0);
    expect(readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8")).toBe(
      "# My global notes\n",
    );
  });

  it("removes OMA block and keeps user content", () => {
    const home = setup();
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "CLAUDE.md"),
      "# My notes\n\n<!-- OMA:START -->\noma stuff\n<!-- OMA:END -->\n\n# More notes\n",
    );

    const actions = migrateClaudeMdLocal.up("/unused");

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain("OMA block removed");
    const content = readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# My notes");
    expect(content).toContain("# More notes");
    expect(content).not.toContain("OMA:START");
    expect(content).not.toContain("oma stuff");
  });

  it("deletes file when OMA block was only content", () => {
    const home = setup();
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "CLAUDE.md"),
      "<!-- OMA:START -->\noma stuff\n<!-- OMA:END -->",
    );

    const actions = migrateClaudeMdLocal.up("/unused");

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain("removed");
    expect(existsSync(join(claudeDir, "CLAUDE.md"))).toBe(false);
  });

  it("handles full OMA:START marker with description", () => {
    const home = setup();
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "CLAUDE.md"),
      "# Notes\n<!-- OMA:START — managed by oh-my-agent. Do not edit this block manually. -->\nblock\n<!-- OMA:END -->\n",
    );

    const actions = migrateClaudeMdLocal.up("/unused");

    expect(actions).toHaveLength(1);
    const content = readFileSync(join(claudeDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("# Notes");
    expect(content).not.toContain("OMA:START");
  });
});
