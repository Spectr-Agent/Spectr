import { createAppApi } from "../../src/app/routes.js";

export const GET = createAppApi(() => process.env).task;
