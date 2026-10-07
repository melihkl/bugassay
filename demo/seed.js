// Copies the sample recording into ./bugassay-recordings (or the recordingsDir from config.json).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../src/core/config.js";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "recordings");
await fs.mkdir(ROOT, { recursive: true });
await fs.cp(src, ROOT, { recursive: true, force: false, errorOnExist: false });
console.log(`Sample recording copied to ${ROOT}`);
console.log("1) node demo/server.js   2) npx bugassay replay --all   3) DEMO_FIXED=1 node demo/server.js, replay again -> FIXED");
