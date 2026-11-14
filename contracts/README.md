# Contract fixtures

These fixtures are fictional examples of Spectr's frozen wire format. Swift targets must decode them unchanged. Contract changes go through Poorav.

| File | Schema | Meaning |
| --- | --- | --- |
| `task.example.json` | `Task` | Newly accepted task |
| `task.waitingForUser.json` | `Task` | Task paused for clarification |
| `task.succeeded.json` | `Task` | Task completed after slide verification |
| `task.cancelled.json` | `Task` | Task stopped by the user |
| `create-task.request.json` | `CreateTaskRequest` | Start a task from iMessage |
| `create-task.response.json` | `CreateTaskResponse` | Accepted task identifier and revision |
| `command.openDemoDeck.json` | `Command` | Open the demo presentation |
| `command.goToSlide.json` | `Command` | Navigate to slide four |
| `command.stop.json` | `Command` | Stop the task |
| `correction.request.json` | `PostInstructionRequest` | Correct the target slide |
| `stop.request.json` | `PostInstructionRequest` | Stop at the current revision |
| `correction.response.json` | `PostInstructionResponse` | Acknowledge the new instruction revision |
| `result.succeeded.json` | `DeviceResult` | Report the observed slide as successful |
| `result.failed.json` | `DeviceResult` | Report a mismatch between requested and observed slides |
| `receipt.recorded.json` | `Receipt` | Acknowledge a newly recorded result |
| `receipt.stale.json` | `Receipt` | Acknowledge a stale command result |
| `event.json` | `Event` | Record a completed command result |
| `error.staleRevision.json` | `ApiError` | Reject an outdated revision |
| `mac-step.request.json` | `MacStepRequest` | Send a screenshot and previous action results to the Mac agent endpoint |
| `mac-step.response.actions.json` | `MacStepResponse` | Return a validated batch of Mac actions |
| `mac-step.response.waiting.json` | `MacStepResponse` | Pause until the user answers a question |
| `mac-step.response.finished.json` | `MacStepResponse` | Report a terminal task result |
| `mac-task.response.json` | `MacTaskResponse` | Return the paired Mac's active task |
| `error.staleStep.json` | `ApiError` | Reject a step based on stale task state |
| `inbound-message.json` | `InboundMessage` | Normalized provider-neutral inbound message |
