import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSiteImages } from "./site-images.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
if (dirname(distRoot) !== projectRoot || distRoot === projectRoot) {
  throw new Error(`Refusing to clear output outside this project: ${distRoot}`);
}

const [workerSource, page, manifest, siteImages] = await Promise.all([
  readFile(resolve(projectRoot, "worker/index.js"), "utf8"),
  readFile(resolve(projectRoot, "site/index.html"), "utf8"),
  readFile(resolve(projectRoot, ".openai/hosting.json"), "utf8"),
  readSiteImages(projectRoot),
]);
JSON.parse(manifest);

const marker = 'const PAGE_HTML = "";';
if (workerSource.split(marker).length !== 2) throw new Error("Worker must contain exactly one PAGE_HTML marker");
const photoMarker = "const SITE_IMAGES_BASE64 = {};";
if (workerSource.split(photoMarker).length !== 2) throw new Error("Worker must contain exactly one SITE_IMAGES_BASE64 marker");
const siteImagesBase64 = Object.fromEntries(siteImages.map(({ file, bytes }) => [`/images/${file}`, bytes.toString("base64")]));
const bundledWorker = workerSource
  .replace(marker, () => `const PAGE_HTML = ${JSON.stringify(page)};`)
  .replace(photoMarker, () => `const SITE_IMAGES_BASE64 = ${JSON.stringify(siteImagesBase64)};`);

await rm(distRoot, { recursive: true, force: true });
await mkdir(resolve(distRoot, "server"), { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });
await Promise.all([
  writeFile(resolve(distRoot, "server/index.js"), bundledWorker, "utf8"),
  writeFile(resolve(distRoot, ".openai/hosting.json"), manifest, "utf8"),
]);
console.log(`Built Worker artifact in ${distRoot}`);
