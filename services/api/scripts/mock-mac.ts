import {
  desktopExecutor,
  fixtureExecutor,
  macExecutor,
} from "../src/mock-mac/executors.js";
import { runMockMac } from "../src/mock-mac/loop.js";

interface Options {
  api: string;
  executor: "fixture" | "desktop" | "mac";
  screenshot?: string;
  once: boolean;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    api: process.env.API ?? "http://localhost:3000",
    executor: process.platform === "darwin" ? "mac" : "desktop",
    once: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      options.once = true;
    } else if (arg === "--api" || arg === "--executor" || arg === "--screenshot") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value.`);
      }
      index += 1;
      if (arg === "--api") {
        options.api = value;
      } else if (arg === "--executor") {
        if (value !== "fixture" && value !== "desktop" && value !== "mac") {
          throw new Error("--executor must be fixture, desktop, or mac.");
        }
        options.executor = value;
      } else {
        options.screenshot = value;
      }
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<void> {
  const token = process.env.SPECTR_DEVICE_TOKEN;
  if (!token) {
    throw new Error("SPECTR_DEVICE_TOKEN is required.");
  }
  const options = parseArgs(process.argv.slice(2));
  const executor =
    options.executor === "mac"
      ? macExecutor()
      : options.executor === "desktop"
        ? desktopExecutor()
        : options.screenshot
          ? fixtureExecutor({ screenshotPath: options.screenshot })
          : (() => {
              throw new Error("--screenshot is required for the fixture executor.");
            })();
  await runMockMac({
    apiUrl: options.api,
    token,
    executor,
    once: options.once,
    log: (line) => console.log(line),
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Mock Mac failed.");
  process.exitCode = 1;
});
