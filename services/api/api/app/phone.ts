import { createAppApi } from "../../src/app/routes.js";

const api = createAppApi(() => process.env);
export const POST = api.phone;
export const DELETE = api.phone;
