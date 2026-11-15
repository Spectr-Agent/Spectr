// Database access for the iPhone app routes. Every read is scoped to the signed-in owner.
// Task rows never include the stored Claude conversation (it holds screenshots).

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { InboundRow, TaskRow } from "./views.js";

export interface MacRow {
  id: string;
  name: string;
  last_seen_at: Date | string | null;
}

export interface PairingStart {
  pairingId: string;
  code: string;
  pollSecret: string;
  expiresAt: string;
}

export type PairingPoll =
  | { status: "pending"; expiresAt: string }
  | { status: "paired"; deviceId: string; deviceToken: string }
  | { status: "expired" };

export type ApproveResult =
  | { status: "paired"; deviceId: string; name: string }
  | { status: "notFound" };

export type LinkResult =
  | { status: "linked" }
  | { status: "pending"; expiresAt: string }
  | { status: "taken" };

export interface AppStore {
  macs(ownerId: string): Promise<MacRow[]>;
  phones(ownerId: string): Promise<string[]>;
  pendingPhone(ownerId: string, now: Date): Promise<{ phone: string; expiresAt: string } | null>;
  recentTasks(ownerId: string, limit: number): Promise<TaskRow[]>;
  task(ownerId: string, taskId: string): Promise<TaskRow | null>;
  /** A chat's tasks (oldest first) and the messages routed to them; empty when it isn't the owner's. */
  session(ownerId: string, sessionId: string): Promise<{ tasks: TaskRow[]; inbound: InboundRow[] }>;
  startPairing(macName: string, now: Date): Promise<PairingStart>;
  pollPairing(pairingId: string, pollSecret: string, now: Date): Promise<PairingPoll>;
  approvePairing(ownerId: string, code: string, now: Date): Promise<ApproveResult>;
  requestPhoneLink(ownerId: string, phone: string, now: Date): Promise<LinkResult>;
  unlinkPhone(ownerId: string, phone: string): Promise<void>;
}

export const PAIRING_TTL_MS = 10 * 60_000;
export const PHONE_LINK_TTL_MS = 15 * 60_000;

/** Unambiguous characters: no 0/O, 1/I/L. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newPairingCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/** Accepts "k7p 4qx", "K7P-4QX" and so on. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Seals the device token for the Mac to collect once. The key never sits in the database. */
export function sealToken(token: string, secret: string): string {
  const key = createHash("sha256").update(`spectr-pairing:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

export function openToken(sealed: string, secret: string): string {
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body) throw new Error("Malformed sealed token");
  const key = createHash("sha256").update(`spectr-pairing:${secret}`).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

const TASK_COLUMNS = (sql: postgres.Sql) => sql`
  id, device_id, state, revision, instruction, question, summary, step_count,
  last_step_response, reply_provider, created_at, updated_at, session_id,
  (final_screenshot is not null) as has_screenshot
`;

export class PostgresAppStore implements AppStore {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly sealSecret: string,
  ) {}

  async macs(ownerId: string): Promise<MacRow[]> {
    return (await this.sql`
      select id, name, last_seen_at
      from public.devices
      where owner_id = ${ownerId} and kind = 'mac' and revoked_at is null
      order by
        -- Same order as calls and texts use: an online real Mac first, the hosted
        -- browser ("cloud-") only when no real Mac is online.
        (last_seen_at is not null and last_seen_at > now() - interval '60 seconds') desc,
        (id like 'cloud-%') asc,
        last_seen_at desc nulls last,
        created_at desc
    `) as unknown as MacRow[];
  }

  async phones(ownerId: string): Promise<string[]> {
    const rows = await this.sql`
      select handle from public.messaging_identities
      where owner_id = ${ownerId} and provider = 'sendblue'
      order by created_at
    `;
    return rows.map((row) => row.handle as string);
  }

  async pendingPhone(ownerId: string, now: Date) {
    const [row] = await this.sql`
      select phone, expires_at from public.phone_link_requests
      where owner_id = ${ownerId} and expires_at > ${now}
      order by created_at desc limit 1
    `;
    return row ? { phone: row.phone as string, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }

  async recentTasks(ownerId: string, limit: number): Promise<TaskRow[]> {
    return (await this.sql`
      select ${TASK_COLUMNS(this.sql)} from public.tasks
      where owner_id = ${ownerId}
      order by created_at desc limit ${limit}
    `) as unknown as TaskRow[];
  }

  async task(ownerId: string, taskId: string): Promise<TaskRow | null> {
    const [row] = await this.sql`
      select ${TASK_COLUMNS(this.sql)} from public.tasks
      where owner_id = ${ownerId} and id = ${taskId}
    `;
    return (row as TaskRow | undefined) ?? null;
  }

  async session(ownerId: string, sessionId: string): Promise<{ tasks: TaskRow[]; inbound: InboundRow[] }> {
    const tasks = (await this.sql`
      select ${TASK_COLUMNS(this.sql)} from public.tasks
      where owner_id = ${ownerId} and session_id = ${sessionId}
      order by created_at
    `) as unknown as TaskRow[];
    if (tasks.length === 0) return { tasks, inbound: [] };
    const inbound = (await this.sql`
      select task_id, kind, text, created_at from public.inbound_messages
      where task_id in ${this.sql(tasks.map((task) => task.id))}
      order by created_at
    `) as unknown as InboundRow[];
    return { tasks, inbound };
  }

  async startPairing(macName: string, now: Date): Promise<PairingStart> {
    const pollSecret = randomBytes(32).toString("base64url");
    const pairingId = `pair_${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    await this.sql`delete from public.device_pairings where expires_at < ${now} and approved_at is null`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = newPairingCode();
      const inserted = await this.sql`
        insert into public.device_pairings (id, code, poll_secret_hash, mac_name, expires_at, created_at)
        values (${pairingId}, ${code}, ${sha256(pollSecret)}, ${macName}, ${expiresAt}, ${now})
        on conflict do nothing
        returning id
      `;
      if (inserted.length > 0) return { pairingId, code, pollSecret, expiresAt: expiresAt.toISOString() };
    }
    throw new Error("Could not allocate a pairing code");
  }

  async pollPairing(pairingId: string, pollSecret: string, now: Date): Promise<PairingPoll> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx`
        select device_id, token_ciphertext, expires_at, approved_at, delivered_at
        from public.device_pairings
        where id = ${pairingId} and poll_secret_hash = ${sha256(pollSecret)}
        for update
      `;
      if (!row || row.delivered_at) return { status: "expired" } as const;
      if (row.approved_at && row.token_ciphertext) {
        await tx`
          update public.device_pairings
          set token_ciphertext = null, delivered_at = ${now}
          where id = ${pairingId}
        `;
        return {
          status: "paired",
          deviceId: row.device_id as string,
          deviceToken: openToken(row.token_ciphertext as string, this.sealSecret),
        } as const;
      }
      if (new Date(row.expires_at) <= now) return { status: "expired" } as const;
      return { status: "pending", expiresAt: new Date(row.expires_at).toISOString() } as const;
    });
  }

  async approvePairing(ownerId: string, code: string, now: Date): Promise<ApproveResult> {
    return this.sql.begin(async (tx) => {
      const [pairing] = await tx`
        select id, mac_name from public.device_pairings
        where code = ${normalizeCode(code)} and approved_at is null and expires_at > ${now}
        for update
      `;
      if (!pairing) return { status: "notFound" } as const;
      const deviceId = `mac-${randomBytes(6).toString("hex")}`;
      const token = `spd_${randomBytes(32).toString("base64url")}`;
      const name = String(pairing.mac_name);
      await tx`
        insert into public.devices (id, owner_id, kind, name, token_hash, created_at)
        values (${deviceId}, ${ownerId}, 'mac', ${name}, ${sha256(token)}, ${now})
      `;
      await tx`
        update public.device_pairings
        set owner_id = ${ownerId}, device_id = ${deviceId}, approved_at = ${now},
            token_ciphertext = ${sealToken(token, this.sealSecret)}
        where id = ${pairing.id}
      `;
      return { status: "paired", deviceId, name } as const;
    });
  }

  async requestPhoneLink(ownerId: string, phone: string, now: Date): Promise<LinkResult> {
    return this.sql.begin(async (tx) => {
      const [existing] = await tx`
        select owner_id from public.messaging_identities
        where provider = 'sendblue' and handle = ${phone}
      `;
      if (existing) return existing.owner_id === ownerId ? ({ status: "linked" } as const) : ({ status: "taken" } as const);
      const expiresAt = new Date(now.getTime() + PHONE_LINK_TTL_MS);
      await tx`delete from public.phone_link_requests where owner_id = ${ownerId} and phone <> ${phone}`;
      await tx`
        insert into public.phone_link_requests (phone, owner_id, created_at, expires_at)
        values (${phone}, ${ownerId}, ${now}, ${expiresAt})
        on conflict (phone) do update
          set owner_id = excluded.owner_id, created_at = excluded.created_at, expires_at = excluded.expires_at
      `;
      return { status: "pending", expiresAt: expiresAt.toISOString() } as const;
    });
  }

  async unlinkPhone(ownerId: string, phone: string): Promise<void> {
    await this.sql`delete from public.messaging_identities where owner_id = ${ownerId} and handle = ${phone}`;
    await this.sql`delete from public.phone_link_requests where owner_id = ${ownerId} and phone = ${phone}`;
  }
}
