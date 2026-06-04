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
import { migrateOmaConfig } from "./003-oma-config.js";

describe("migrateOmaConfig (003)", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tempRoots.length = 0;
  });

  it("migrates legacy user-preferences.yaml to oma-config.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      "language: ko\n",
      "utf-8",
    );

    const actions = migrateOmaConfig.up(root);

    expect(actions).toContain(
      ".agents/config/user-preferences.yaml → .agents/oma-config.yaml",
    );
    expect(existsSync(join(root, ".agents", "oma-config.yaml"))).toBe(true);
    expect(
      readFileSync(join(root, ".agents", "oma-config.yaml"), "utf-8"),
    ).toBe("language: ko\n");
    expect(existsSync(join(legacyDir, "user-preferences.yaml"))).toBe(false);
  });

  it("overwrites template oma-config.yaml when legacy file also exists", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    // Simulate: cpSync created template oma-config.yaml
    mkdirSync(join(root, ".agents"), { recursive: true });
    writeFileSync(
      join(root, ".agents", "oma-config.yaml"),
      "language: en\n",
      "utf-8",
    );

    // User's actual config at legacy path
    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      "language: ko\n",
      "utf-8",
    );

    const actions = migrateOmaConfig.up(root);

    expect(actions).toContain(
      ".agents/config/user-preferences.yaml → .agents/oma-config.yaml",
    );
    // User's config takes precedence over template
    expect(
      readFileSync(join(root, ".agents", "oma-config.yaml"), "utf-8"),
    ).toBe("language: ko\n");
    expect(existsSync(join(legacyDir, "user-preferences.yaml"))).toBe(false);
  });

  it("removes empty config/ directory after migration", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      "language: en\n",
      "utf-8",
    );

    const actions = migrateOmaConfig.up(root);

    expect(actions).toContain(".agents/config/ (removed empty dir)");
    expect(existsSync(legacyDir)).toBe(false);
  });

  it("does nothing when only oma-config.yaml exists", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".agents"), { recursive: true });
    writeFileSync(
      join(root, ".agents", "oma-config.yaml"),
      "language: en\n",
      "utf-8",
    );

    const actions = migrateOmaConfig.up(root);

    expect(actions).toHaveLength(0);
  });

  it("does nothing when neither file exists", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    mkdirSync(join(root, ".agents"), { recursive: true });

    const actions = migrateOmaConfig.up(root);

    expect(actions).toHaveLength(0);
  });

  it("preserves config/ dir when other files remain after migration", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      "language: ko\n",
      "utf-8",
    );
    writeFileSync(join(legacyDir, "other-config.yaml"), "key: val\n", "utf-8");

    const actions = migrateOmaConfig.up(root);

    expect(actions).toContain(
      ".agents/config/user-preferences.yaml → .agents/oma-config.yaml",
    );
    expect(actions).not.toContain(".agents/config/ (removed empty dir)");
    expect(existsSync(legacyDir)).toBe(true);
    expect(existsSync(join(legacyDir, "other-config.yaml"))).toBe(true);
  });

  it("is idempotent — second run is a no-op", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      "language: ko\n",
      "utf-8",
    );

    const first = migrateOmaConfig.up(root);
    expect(first.length).toBeGreaterThan(0);

    const second = migrateOmaConfig.up(root);
    expect(second).toHaveLength(0);

    // Content preserved after both runs
    expect(
      readFileSync(join(root, ".agents", "oma-config.yaml"), "utf-8"),
    ).toBe("language: ko\n");
  });

  it("preserves full user config content when overwriting template", () => {
    const root = mkdtempSync(join(tmpdir(), "oma-migrate-003-"));
    tempRoots.push(root);

    const userConfig = [
      "language: ja",
      "date_format: ISO",
      "timezone: Asia/Tokyo",
      "default_cli: claude",
      "vendors:",
      "  - claude",
      "  - gemini",
      "",
    ].join("\n");

    mkdirSync(join(root, ".agents"), { recursive: true });
    writeFileSync(
      join(root, ".agents", "oma-config.yaml"),
      "language: en\ndefault_cli: gemini\n",
      "utf-8",
    );

    const legacyDir = join(root, ".agents", "config");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "user-preferences.yaml"),
      userConfig,
      "utf-8",
    );

    migrateOmaConfig.up(root);

    const result = readFileSync(
      join(root, ".agents", "oma-config.yaml"),
      "utf-8",
    );
    expect(result).toBe(userConfig);
    expect(result).toContain("timezone: Asia/Tokyo");
    expect(result).toContain("default_cli: claude");
  });
});
