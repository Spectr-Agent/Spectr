import { createTaskScreenshotRoute } from "../../src/agent/routes.js";

export const GET = createTaskScreenshotRoute(() => process.env);
