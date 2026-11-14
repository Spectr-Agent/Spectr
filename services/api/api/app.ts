import { createAppDispatcher } from "../src/app/routes.js";

const handler = createAppDispatcher(() => process.env);
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
