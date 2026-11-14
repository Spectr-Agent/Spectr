import { createFaceTimeRoute } from "../../src/facetime/incoming.js";

export const POST = createFaceTimeRoute(() => process.env);
