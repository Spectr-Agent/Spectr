import { createChertWebhookRoute } from "../../src/chert/route.js";

export const POST = createChertWebhookRoute(() => process.env);
