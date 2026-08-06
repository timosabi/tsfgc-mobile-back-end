import { argv, env, exit } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/integrations/supabase/types.js";
import AuthService from "../../../src/services/AuthService.js";

export const devSeedPassword = "Password123!";

export type DevScenarioUserRole =
  | "owner"
  | "member"
  | "pending-member"
  | "standalone";

export type DevScenarioUser = {
  id: string;
  email: string;
  displayName: string;
  role: DevScenarioUserRole;
  description: string;
};

export type DevScenarioRun = {
  runId: string;
  suffix: string;
  numericSeed: number;
};

export type CliPrompts = Interface;

export function createCliPrompts() {
  return createInterface({ input, output });
}

export function createDevScenarioRun(): DevScenarioRun {
  const runId = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);
  const randomPart = Math.random().toString(36).slice(2, 8);
  const numericSeed = Number(`${Date.now()}`.slice(-9));

  return {
    runId,
    suffix: `${runId}-${randomPart}`,
    numericSeed,
  };
}

export function assertLocalSupabaseUrl(rawUrl?: string) {
  if (!rawUrl) throw new Error("LOVABLE_SUPABASE_URL is required");
  if (env.SEED_ALLOW_NON_LOCAL_DB === "true") return;

  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing to seed non-local Supabase URL: ${rawUrl}. ` +
        "Set SEED_ALLOW_NON_LOCAL_DB=true only when intentional."
    );
  }
}

export async function assertSupabaseApiReachable(rawUrl?: string) {
  if (!rawUrl) throw new Error("LOVABLE_SUPABASE_URL is required");

  const healthUrl = new URL("/auth/v1/health", rawUrl).toString();
  try {
    await fetch(healthUrl, {
      signal: AbortSignal.timeout(2_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Cannot reach Supabase at ${rawUrl}.`,
        "",
        "Start Docker Desktop, then start local Supabase:",
        "  npm run supabase:start",
        "",
        "If the database also needs migrations, run:",
        "  npm run db:reset",
        "",
        `Original error: ${detail}`,
      ].join("\n")
    );
  }
}

export function printDevScenarioErrorAndExit(error: unknown): never {
  console.error("");
  console.error("DEV SCENARIO FAILED");
  console.error("------------------------------------------------------------");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  exit(1);
}

export function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = argv.find((arg) => arg.startsWith(prefix));
  return raw?.slice(prefix.length).trim() || undefined;
}

export function slugify(inputValue: string) {
  return inputValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export async function askString(params: {
  rl: CliPrompts;
  argName: string;
  label: string;
  defaultValue: string;
}) {
  const argValue = readArg(params.argName);
  if (argValue !== undefined) return argValue;

  const answer = (
    await params.rl.question(`${params.label} [${params.defaultValue}]: `)
  ).trim();
  return answer || params.defaultValue;
}

export async function askInteger(params: {
  rl: CliPrompts;
  argName: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
}) {
  const raw = readArg(params.argName);
  const value =
    raw === undefined
      ? Number(
          (
            await params.rl.question(
              `${params.label} [${params.defaultValue}]: `
            )
          ).trim() || params.defaultValue
        )
      : Number(raw);

  if (!Number.isInteger(value) || value < params.min || value > params.max) {
    throw new Error(
      `${params.argName} must be an integer from ${params.min} to ${params.max}`
    );
  }

  return value;
}

export async function askChoice<const T extends string>(params: {
  rl: CliPrompts;
  argName: string;
  label: string;
  choices: readonly T[];
  defaultValue: T;
}) {
  const raw = readArg(params.argName);
  const value =
    raw === undefined
      ? (
          (
            await params.rl.question(
              `${params.label} (${params.choices.join("/")}) [${params.defaultValue}]: `
            )
          ).trim() || params.defaultValue
        )
      : raw;

  if (!params.choices.includes(value as T)) {
    throw new Error(`${params.argName} must be one of: ${params.choices.join(", ")}`);
  }

  return value as T;
}

export async function askRadioChoice<const T extends string>(params: {
  rl: CliPrompts;
  argName: string;
  label: string;
  choices: readonly T[];
  defaultValue: T;
  formatChoice?: (choice: T, index: number) => string;
}) {
  const raw = readArg(params.argName);
  if (raw !== undefined) {
    if (!params.choices.includes(raw as T)) {
      throw new Error(
        `${params.argName} must be one of: ${params.choices.join(", ")}`
      );
    }

    return raw as T;
  }

  if (!input.isTTY || !output.isTTY) {
    return askChoice(params);
  }

  let selectedIndex = Math.max(
    0,
    params.choices.findIndex((choice) => choice === params.defaultValue)
  );
  const promptLineCount = params.choices.length + 2;

  const render = () => {
    output.write(`\x1B[${promptLineCount}F`);
    output.write("\x1B[J");
    output.write(`${params.label}\n`);
    params.choices.forEach((choice, index) => {
      const marker = index === selectedIndex ? "(*) " : "( ) ";
      const cursor = index === selectedIndex ? "> " : "  ";
      const label = params.formatChoice?.(choice, index) ?? choice;
      output.write(`${cursor}${marker}${label}\n`);
    });
    output.write("Use arrows, press Enter to select.\n");
  };

  params.rl.pause();
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write("\n".repeat(promptLineCount));
  render();

  let onKeypress: ((_str: string, key: { name?: string; ctrl?: boolean }) => void) | null =
    null;
  try {
    return await new Promise<T>((resolve, reject) => {
      onKeypress = (_str, key) => {
        if (key.ctrl && key.name === "c") {
          reject(new Error("Prompt cancelled"));
          return;
        }

        if (key.name === "up") {
          selectedIndex =
            selectedIndex === 0 ? params.choices.length - 1 : selectedIndex - 1;
          render();
          return;
        }

        if (key.name === "down") {
          selectedIndex =
            selectedIndex === params.choices.length - 1 ? 0 : selectedIndex + 1;
          render();
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          resolve(params.choices[selectedIndex]);
        }
      };

      input.on("keypress", onKeypress);
    });
  } finally {
    if (onKeypress) {
      input.off("keypress", onKeypress);
    }
    input.setRawMode(false);
    params.rl.resume();
    output.write(`Selected: ${params.choices[selectedIndex]}\n`);
  }
}

export async function createDevUser(params: {
  client: SupabaseClient<Database>;
  auth: AuthService;
  suffix: string;
  role: DevScenarioUserRole;
  label: string;
  description: string;
  index?: number;
}): Promise<DevScenarioUser> {
  const indexedLabel =
    params.index === undefined ? params.label : `${params.label} ${params.index}`;
  const emailRole =
    params.index === undefined ? params.role : `${params.role}-${params.index}`;
  const displayName = `Dev Seed ${params.role} - ${indexedLabel} - ${params.suffix}`;
  const email = `dev-seed-${emailRole}-${params.suffix}@example.com`;
  const { data, error } = await params.client.auth.admin.createUser({
    email,
    password: devSeedPassword,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (error) throw new Error(`Create ${params.role} user failed: ${error.message}`);
  if (!data.user) throw new Error(`Create ${params.role} user failed: missing user`);

  await params.auth.upsertProfileForUser({
    userId: data.user.id,
    email,
    displayName,
  });

  return {
    id: data.user.id,
    email,
    displayName,
    role: params.role,
    description: params.description,
  };
}

export function printUserBlock(user: DevScenarioUser) {
  console.log(`${user.role.toUpperCase()}`);
  console.log(`name: ${user.displayName}`);
  console.log(`email: ${user.email}`);
  console.log(`password: ${devSeedPassword}`);
  console.log(`userId: ${user.id}`);
  console.log(`state: ${user.description}`);
  console.log("");
}
