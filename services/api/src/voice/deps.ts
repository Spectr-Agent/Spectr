// Narrow seams for the speech endpoint. The real auth and task-lookup
// implementations live in Poorav's Supabase workstream; see the TODO below.

export interface AuthVerifier {
  ownerIdFrom(req: Request): Promise<string | null>;
}

// `text` is the agent status/completion string derived from observedSlide for
// one event, or null when that event has none.
export interface StatusText {
  ownerId: string;
  text: string | null;
}

export interface StatusTextSource {
  // Resolves to null when the task does not exist.
  get(taskId: string, seq: number): Promise<StatusText | null>;
}

export interface FixtureStatusTextRow {
  taskId: string;
  ownerId: string;
  seq: number;
  text: string | null;
}

// In-memory source for tests and local dev. A taskId present in any row counts
// as an existing task, so a seq with no row resolves to { ownerId, text: null }.
export function createFixtureStatusTextSource(
  rows: readonly FixtureStatusTextRow[],
): StatusTextSource {
  const ownerIdByTaskId = new Map<string, string>();
  const textByKey = new Map<string, string | null>();

  for (const row of rows) {
    ownerIdByTaskId.set(row.taskId, row.ownerId);
    textByKey.set(`${row.taskId}#${row.seq}`, row.text);
  }

  return {
    async get(taskId, seq) {
      const ownerId = ownerIdByTaskId.get(taskId);
      if (ownerId === undefined) {
        return null;
      }

      const key = `${taskId}#${seq}`;
      return {
        ownerId,
        text: textByKey.has(key) ? (textByKey.get(key) ?? null) : null,
      };
    },
  };
}

// TODO(Poorav): Supabase-backed implementation.
// Verify the Authorization bearer token against Supabase Auth and return the
// owner's user id.
export function createSupabaseAuthVerifier(): AuthVerifier {
  throw new Error("not implemented");
}

// TODO(Poorav): Supabase-backed implementation.
// Read public.tasks.owner_id plus the status text for public.events (task_id,
// seq) under owner-scoped RLS.
export function createSupabaseStatusTextSource(): StatusTextSource {
  throw new Error("not implemented");
}
