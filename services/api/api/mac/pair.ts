import { createMacPairingDispatcher } from "../../src/app/mac-pairing.js";

export const POST = createMacPairingDispatcher(() => process.env);
