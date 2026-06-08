import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_PATHS = [
  join(homedir(), ".commandcode", "config.json"),
  join(homedir(), ".commandcode", "auth.json"),
];

/**
 * Checks whether the user is authenticated for Command Code.
 *
 * Command Code stores credentials under `~/.commandcode/`. It also supports
 * the `COMMANDCODE_API_KEY` environment variable for headless/CI use.
 */
export function isCommandCodeAuthenticated(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.COMMANDCODE_API_KEY?.trim()) {
    return true;
  }

  return AUTH_PATHS.some(existsSync);
}
