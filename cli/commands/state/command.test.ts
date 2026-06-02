import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerState } from "./command.js";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerState(program);
  return program;
}

describe("state command registration", () => {
  it("registers state:repair with dry-run support", () => {
    const program = buildProgram();
    const command = program.commands.find(
      (cmd) => cmd.name() === "state:repair",
    );

    expect(command).toBeDefined();
    expect(command?.options.some((option) => option.long === "--dry-run")).toBe(
      true,
    );
  });

  it("keeps the state command repair alias reachable through [sid]", () => {
    const program = buildProgram();
    const command = program.commands.find((cmd) => cmd.name() === "state");

    expect(command).toBeDefined();
    expect(command?.registeredArguments[0]?.name()).toBe("sid");
    expect(command?.options.some((option) => option.long === "--dry-run")).toBe(
      true,
    );
  });
});
