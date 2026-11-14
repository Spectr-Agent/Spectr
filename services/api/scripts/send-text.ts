import { randomUUID } from "node:crypto";

function parseArgs(args: string[]): {
  api: string;
  from: string;
  text: string;
} {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--api", "--from", "--text"].includes(name) || !value) {
      throw new Error(
        "Usage: npm run send-text -- --from +14704249734 --text \"...\" [--api URL]",
      );
    }
    values[name] = value;
  }
  if (!values["--from"] || !values["--text"]) {
    throw new Error(
      "Usage: npm run send-text -- --from +14704249734 --text \"...\" [--api URL]",
    );
  }
  return {
    api: values["--api"] ?? process.env.API ?? "http://localhost:3000",
    from: values["--from"],
    text: values["--text"],
  };
}

async function main(): Promise<void> {
  const secret = process.env.SENDBLUE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("SENDBLUE_WEBHOOK_SECRET is required.");
  }
  const options = parseArgs(process.argv.slice(2));
  const response = await fetch(new URL("/api/sendblue/webhook", options.api), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sb-signing-secret": secret,
    },
    body: JSON.stringify({
      message_handle: randomUUID().toUpperCase(),
      from_number: options.from,
      content: options.text,
      is_outbound: false,
      status: "RECEIVED",
      group_id: "",
      date_sent: new Date().toISOString(),
      media_url: "",
    }),
  });
  const text = await response.text();
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Send-text failed.");
  process.exitCode = 1;
});
