import { createMacPairingRoutes } from "../../src/app/mac-pairing.js";

export const POST = createMacPairingRoutes(() => process.env).status;
