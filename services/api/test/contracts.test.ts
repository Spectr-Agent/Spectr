import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionSchema,
  ApiErrorSchema,
  CommandSchema,
  CreateTaskRequestSchema,
  CreateTaskResponseSchema,
  DeviceResultSchema,
  EventSchema,
  InboundMessageSchema,
  PostInstructionRequestSchema,
  PostInstructionResponseSchema,
  ReceiptSchema,
  TaskSchema,
} from "../src/contracts.js";
import { describe, expect, it } from "vitest";

const contractsDirectory = fileURLToPath(
  new URL("../../../contracts/", import.meta.url),
);

const schemaByFile: Record<string, { parse(input: unknown): unknown }> = {
  "task.example.json": TaskSchema,
  "task.waitingForUser.json": TaskSchema,
  "task.succeeded.json": TaskSchema,
  "task.cancelled.json": TaskSchema,
  "create-task.request.json": CreateTaskRequestSchema,
  "create-task.response.json": CreateTaskResponseSchema,
  "command.openDemoDeck.json": CommandSchema,
  "command.goToSlide.json": CommandSchema,
  "command.stop.json": CommandSchema,
  "correction.request.json": PostInstructionRequestSchema,
  "stop.request.json": PostInstructionRequestSchema,
  "correction.response.json": PostInstructionResponseSchema,
  "result.succeeded.json": DeviceResultSchema,
  "result.failed.json": DeviceResultSchema,
  "receipt.recorded.json": ReceiptSchema,
  "receipt.stale.json": ReceiptSchema,
  "event.json": EventSchema,
  "error.staleRevision.json": ApiErrorSchema,
  "inbound-message.json": InboundMessageSchema,
};

function readFixture(fileName: string): unknown {
  return JSON.parse(
    readFileSync(join(contractsDirectory, fileName), "utf8"),
  ) as unknown;
}

describe("contract fixtures", () => {
  it("parses every JSON fixture with its explicitly mapped schema", () => {
    const files = readdirSync(contractsDirectory)
      .filter((fileName) => fileName.endsWith(".json"))
      .sort();

    for (const fileName of files) {
      const schema = schemaByFile[fileName];
      if (!schema) {
        throw new Error(`No schema mapping for ${fileName}`);
      }

      expect(() => schema.parse(readFixture(fileName)), fileName).not.toThrow();
    }
  });

  it("rejects unknown task fields", () => {
    const task = readFixture("task.example.json");
    expect(
      TaskSchema.safeParse({ ...(task as object), unexpected: true }).success,
    ).toBe(false);
  });

  it("rejects a goToSlide action with a non-positive slide number", () => {
    expect(
      ActionSchema.safeParse({ type: "goToSlide", number: 0 }).success,
    ).toBe(false);
  });

  it("rejects text on a stop request", () => {
    expect(
      PostInstructionRequestSchema.safeParse({
        taskId: "tsk_demo_001",
        expectedRevision: 1,
        kind: "stop",
        text: "unexpected",
      }).success,
    ).toBe(false);
  });
});
