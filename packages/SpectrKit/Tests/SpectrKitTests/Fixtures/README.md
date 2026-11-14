# Native consumer fixtures (PROVISIONAL)

Fictional examples used only by native tests. They are not the canonical contract.

- Envelopes (task, command, result, receipt, event, error) follow Poorav's frozen
  contract on `origin/devin/1794614215-wire-format` (`contracts/*.json`).
- General-control fields are native proposals awaiting backend adoption:
  `action` types other than `stop`, `observed` / `lastObserved`, and outcome `unverified`.
- `task.backendFrozen.json` copies the backend's current task shape to prove the
  native decoder tolerates the slide-specific field it does not use.

Replace these with `contracts/` once the general-control contract is published.
