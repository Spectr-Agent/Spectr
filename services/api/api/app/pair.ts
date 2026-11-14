import { createAppApi } from "../../src/app/routes.js";

export const POST = createAppApi(() => process.env).pair;
