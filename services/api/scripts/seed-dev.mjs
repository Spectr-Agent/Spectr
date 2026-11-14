import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const args = process.argv.slice(2);
const phoneIndex = args.indexOf("--phone");
const phone = phoneIndex >= 0 ? args[phoneIndex + 1] : undefined;
const validArgs =
  phone &&
  args.length === 2 &&
  phoneIndex === 0 &&
  phone.startsWith("+");
const databaseUrl = process.env.POSTGRES_URL;

if (!validArgs || !databaseUrl) {
  process.stderr.write(
    "Usage: POSTGRES_URL=postgres://localhost/... node scripts/seed-dev.mjs --phone +14704249734\n",
  );
  process.exitCode = 1;
} else {
  let host = "";
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    process.stderr.write("POSTGRES_URL must be a valid local URL.\n");
    process.exitCode = 1;
    host = "";
  }

  if (host && host !== "localhost" && host !== "127.0.0.1") {
    process.stderr.write(
      "Refusing to seed a database that is not on localhost or 127.0.0.1.\n",
    );
    process.exitCode = 1;
  } else if (host) {
    const ownerId = randomUUID();
    const deviceId = "mac-demo";
    const token = `spd_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const sql = postgres(databaseUrl, { prepare: false, max: 1 });
    try {
      await sql.begin(async (tx) => {
        await tx`insert into auth.users (id) values (${ownerId})`;
        await tx`
          insert into public.devices (id, owner_id, kind, name, token_hash)
          values (${deviceId}, ${ownerId}, 'mac', 'Mock Mac', ${tokenHash})
          on conflict (id) do update
          set owner_id = excluded.owner_id,
              kind = excluded.kind,
              name = excluded.name,
              token_hash = excluded.token_hash,
              revoked_at = null
        `;
        await tx`
          insert into public.messaging_identities (owner_id, provider, handle)
          values (${ownerId}, 'sendblue', ${phone})
          on conflict (provider, handle) do update
          set owner_id = excluded.owner_id
        `;
      });
      process.stdout.write(
        `Owner: ${ownerId}\nDevice: ${deviceId}\nSPECTR_DEVICE_TOKEN=${token}\n`,
      );
    } catch {
      process.stderr.write("Could not seed the local development database.\n");
      process.exitCode = 1;
    } finally {
      await sql.end();
    }
  }
}
