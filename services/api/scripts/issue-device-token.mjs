import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const [deviceId, ...extraArgs] = process.argv.slice(2);
const databaseUrl = process.env.POSTGRES_URL;

if (!deviceId || extraArgs.length > 0 || !databaseUrl) {
  process.stderr.write(
    "Usage: POSTGRES_URL=... node scripts/issue-device-token.mjs <deviceId>\n",
  );
  process.exitCode = 1;
} else {
  const token = `spd_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const rows = await sql`
      update public.devices
      set token_hash = ${tokenHash}
      where id = ${deviceId}
        and kind = 'mac'
        and revoked_at is null
      returning id
    `;
    if (rows.length !== 1) {
      process.stderr.write("No active Mac device matched that deviceId.\n");
      process.exitCode = 1;
    } else {
      process.stdout.write(`${token}\n`);
    }
  } catch {
    process.stderr.write("Could not issue device token.\n");
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
