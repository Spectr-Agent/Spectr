import {
  MacStepRequestSchema,
  MacStepResponseSchema,
  MacTaskResponseSchema,
  type MacAction,
  type MacStepRequest,
  type MacStepResponse,
} from "../contracts.js";
import type {
  ActionResult,
  MockMacExecutor,
  MockMacScreenshot,
} from "./executors.js";

interface MockMacTask {
  taskId: string;
  revision: number;
  state: string;
  instruction: string;
  step: number;
}

export interface RunMockMacOptions {
  apiUrl: string;
  token: string;
  executor: MockMacExecutor;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (line: string) => void;
  once?: boolean;
  pollMs?: number;
}

const sleepFor = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function actionLine(step: number, action: MacAction): string {
  switch (action.type) {
    case "click":
      return `step ${step}: click ${action.x},${action.y} ${action.button} x${action.clicks}`;
    case "mouseMove":
      return `step ${step}: move ${action.x},${action.y}`;
    case "drag":
      return `step ${step}: drag ${action.fromX},${action.fromY} to ${action.toX},${action.toY}`;
    case "scroll":
      return `step ${step}: scroll ${action.direction} ${action.amount}`;
    case "type":
      return `step ${step}: type (${action.text.length} chars)`;
    case "key":
      return `step ${step}: key ${action.keys} x${action.repeat}`;
    case "wait":
      return `step ${step}: wait ${action.seconds}s`;
    case "openApp":
      return `step ${step}: open app ${action.name}`;
    case "openUrl":
      return `step ${step}: open URL ${action.url}`;
    case "screenshot":
      return `step ${step}: screenshot`;
  }
}

function responseErrorMessage(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return "Mock Mac request failed.";
}

async function readTask(
  apiUrl: string,
  token: string,
  fetcher: typeof fetch,
  sleep: (milliseconds: number) => Promise<void>,
  log: (line: string) => void,
): Promise<MockMacTask | null> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(new URL("/api/mac/task", apiUrl), {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (attempt === 5) {
        log(
          `task poll failed after ${attempt} tries: ${
            error instanceof Error ? error.message : "network error"
          }`,
        );
        return null;
      }
      await sleep(3000);
      continue;
    }
    if (response.status === 401) {
      throw new Error("Mock Mac authorization failed (HTTP 401).");
    }
    if (response.status >= 500) {
      if (attempt === 5) {
        log(
          `task poll failed with HTTP ${response.status} after ${attempt} tries`,
        );
        return null;
      }
      await sleep(3000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Mock Mac task poll failed with HTTP ${response.status}.`);
    }
    return MacTaskResponseSchema.parse(await response.json()).task;
  }
  return null;
}

function resultsForExecutedActions(
  actions: MacStepResponse & { kind: "actions" },
  executor: MockMacExecutor,
  log: (line: string) => void,
): Promise<MacStepRequest["results"]> {
  return (async () => {
    const results: MacStepRequest["results"] = [];
    for (const { actionId, action } of actions.actions) {
      log(actionLine(actions.step, action));
      let result: ActionResult;
      try {
        result = await executor.execute(action);
      } catch (error) {
        result = {
          ok: false,
          error:
            error instanceof Error ? error.message : "Mock Mac action failed.",
        };
      }
      if (result.ok) {
        results.push({
          actionId,
          ok: true,
          ...(result.output ? { output: result.output.slice(0, 1000) } : {}),
        });
      } else {
        results.push({
          actionId,
          ok: false,
          error: (result.error ?? "Mock Mac action failed.").slice(0, 500),
        });
        break;
      }
    }
    return results;
  })();
}

async function postStep(
  apiUrl: string,
  token: string,
  request: MacStepRequest,
  fetcher: typeof fetch,
): Promise<Response> {
  return fetcher(new URL("/api/mac/step", apiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

export async function runMockMac(
  options: RunMockMacOptions,
): Promise<MacStepResponse | undefined> {
  const apiUrl = options.apiUrl.endsWith("/") ? options.apiUrl : `${options.apiUrl}/`;
  const fetcher = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? sleepFor;
  const log = options.log ?? console.log;
  const pollMs = options.pollMs ?? 2000;

  for (;;) {
    const task = await readTask(apiUrl, options.token, fetcher, sleep, log);
    if (!task) {
      await sleep(pollMs);
      continue;
    }

    let afterStep = task.step;
    let results: MacStepRequest["results"] = [];
    const loggedQuestions = new Set<string>();
    let goBackToPolling = false;

    while (!goBackToPolling) {
      const screenshot: MockMacScreenshot = await options.executor.screenshot();
      const request = MacStepRequestSchema.parse({
        taskId: task.taskId,
        afterStep,
        screenshot,
        results,
      });
      let attempts = 0;
      let response: Response | undefined;
      let shouldPollAgain = false;

      while (!response) {
        attempts += 1;
        try {
          const candidate = await postStep(
            apiUrl,
            options.token,
            request,
            fetcher,
          );
          if (candidate.status === 401) {
            throw new Error("Mock Mac authorization failed (HTTP 401).");
          }
          if (candidate.status === 409) {
            const latest = await readTask(
              apiUrl,
              options.token,
              fetcher,
              sleep,
              log,
            );
            if (!latest) {
              shouldPollAgain = true;
              break;
            }
            afterStep = latest.step;
            results = [];
            break;
          }
          if (candidate.status >= 500) {
            if (attempts >= 5) {
              log(
                `step ${afterStep}: request failed with HTTP ${candidate.status} after ${attempts} tries`,
              );
              shouldPollAgain = true;
              break;
            }
            await sleep(3000);
            continue;
          }
          if (!candidate.ok) {
            let body: unknown;
            try {
              body = await candidate.json();
            } catch {
              body = undefined;
            }
            throw new Error(
              `Mock Mac step failed with HTTP ${candidate.status}: ${responseErrorMessage(body)}`,
            );
          }
          response = candidate;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Mock Mac authorization failed (HTTP 401)."
          ) {
            throw error;
          }
          if (attempts >= 5) {
            log(
              `step ${afterStep}: request failed after ${attempts} tries: ${
                error instanceof Error ? error.message : "network error"
              }`,
            );
            shouldPollAgain = true;
            break;
          }
          await sleep(3000);
        }
      }

      if (shouldPollAgain) {
        goBackToPolling = true;
        await sleep(pollMs);
        continue;
      }
      if (!response) {
        continue;
      }
      const stepResponse = MacStepResponseSchema.parse(await response.json());
      if (stepResponse.kind === "actions") {
        results = await resultsForExecutedActions(
          stepResponse,
          options.executor,
          log,
        );
        afterStep = stepResponse.step;
        continue;
      }
      if (stepResponse.kind === "waiting") {
        if (!loggedQuestions.has(stepResponse.question)) {
          log(`waiting: ${stepResponse.question}`);
          loggedQuestions.add(stepResponse.question);
        }
        results = [];
        afterStep = stepResponse.step;
        await sleep(3000);
        continue;
      }
      log(`finished ${stepResponse.state}: ${stepResponse.summary}`);
      if (options.once) {
        return stepResponse;
      }
      goBackToPolling = true;
    }
  }
}
