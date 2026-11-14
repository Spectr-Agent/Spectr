import { createSendblueWebhookRoute } from "../../src/sendblue/route.js";

export const POST = createSendblueWebhookRoute(() => process.env);
