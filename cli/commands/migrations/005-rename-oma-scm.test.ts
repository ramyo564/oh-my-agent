import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateRenameOmaScm } from "./005-rename-oma-scm.js";

describe("migrateRenameOmaScm (005)", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("renames oma-commit skill directory to oma-scm", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-005-"));
    tempRoots.push(root);

    const oldSkillDir = join(root, ".agents", "skills", "oma-commit");
    mkdirSync(oldSkillDir, { recursive: true });
    writeFileSync(join(oldSkillDir, "SKILL.md"), "name: oma-commit\n", "utf-8");

    const actions = migrateRenameOmaScm.up(root);

    expect(actions).toContain("skills/oma-commit → skills/oma-scm");
    expect(existsSync(join(root, ".agents", "skills", "oma-commit"))).toBe(
      false,
    );
    expect(existsSync(join(root, ".agents", "skills", "oma-scm"))).toBe(true);
  });

  it("removes legacy commit workflow even when skill rename is not needed", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-005-"));
    tempRoots.push(root);

    const workflowDir = join(root, ".agents", "workflows");
    mkdirSync(workflowDir, { recursive: true });
    writeFileSync(
      join(workflowDir, "commit.md"),
      "# legacy workflow\n",
      "utf-8",
    );

    const actions = migrateRenameOmaScm.up(root);

    expect(actions).toContain("workflows/commit.md (removed legacy workflow)");
    expect(existsSync(join(workflowDir, "commit.md"))).toBe(false);
  });

  it("removes oma-commit when oma-scm already exists", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-005-"));
    tempRoots.push(root);

    const oldSkillDir = join(root, ".agents", "skills", "oma-commit");
    const newSkillDir = join(root, ".agents", "skills", "oma-scm");
    mkdirSync(oldSkillDir, { recursive: true });
    mkdirSync(newSkillDir, { recursive: true });

    const actions = migrateRenameOmaScm.up(root);

    expect(actions).toContain(
      "skills/oma-commit (removed, replaced by oma-scm)",
    );
    expect(existsSync(oldSkillDir)).toBe(false);
    expect(existsSync(newSkillDir)).toBe(true);
  });
});
