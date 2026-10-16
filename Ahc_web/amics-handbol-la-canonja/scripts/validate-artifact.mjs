import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");
const [source, manifestText] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
const manifest = JSON.parse(manifestText);
assert.equal(manifest.project_id, "appgprj_6ac8aefd915481919005a02b05884168");
assert.equal("static" in manifest, false);

const workerModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
assert.equal(typeof workerModule.default?.fetch, "function", `${pathToFileURL(workerPath)} must export default.fetch`);
assert.match(source, /\/api\/data/);
console.log("Artifact is valid ESM, serves the site, and exposes the live data endpoint");
