import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
if (dirname(distRoot) !== projectRoot || distRoot === projectRoot) {
  throw new Error(`Refusing to write output outside this project: ${distRoot}`);
}

async function fetchLatestInstagramPosts() {
  try {
    const response = await fetch("https://www.instagram.com/amicshandbolcanonja/embed/", {
      headers: { accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Instagram returned HTTP " + response.status);

    const html = await response.text();
    const mediaIndex = html.indexOf("graphql_media");
    if (mediaIndex < 0) throw new Error("Instagram did not return profile media");
    const media = html.slice(mediaIndex, mediaIndex + 50000)
      .replaceAll(String.fromCharCode(92) + '"', '"');
    const shortcodes = [...media.matchAll(/"shortcode":"([A-Za-z0-9_-]+)"/g)]
      .map((match) => match[1]);
    const uniqueShortcodes = [...new Set(shortcodes)].slice(0, 3);
    if (!uniqueShortcodes.length) throw new Error("Instagram did not return a post shortcode");

    return { posts: uniqueShortcodes.map((shortcode) => "https://www.instagram.com/p/" + shortcode + "/") };
  } catch (error) {
    console.warn("Could not resolve the latest Instagram post: " + (error instanceof Error ? error.message : String(error)));
    return { posts: [] };
  }
}

const [workerSource, sourcePage, heroPhoto] = await Promise.all([
  readFile(resolve(projectRoot, "worker/index.js"), "utf8"),
  readFile(resolve(projectRoot, "site/index.html"), "utf8"),
  readFile(resolve(projectRoot, "site/ascenso_ahcjpeg.jpeg")),
]);
function replaceOnce(source, from, to) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(from)}`);
  }
  return `${source.slice(0, first)}${to}${source.slice(first + from.length)}`;
}

let workerBundle = replaceOnce(workerSource, 'const PAGE_HTML = "";', `const PAGE_HTML = ${JSON.stringify(sourcePage)};`);
workerBundle = replaceOnce(
  workerBundle,
  'const HERO_PHOTO_BASE64 = "";',
  `const HERO_PHOTO_BASE64 = ${JSON.stringify(heroPhoto.toString("base64"))};`,
);

let page = replaceOnce(sourcePage, 'src="/images/ascenso_ahcjpeg.jpeg"', 'src="./images/ascenso_ahcjpeg.jpeg"');
page = replaceOnce(
  page,
  'fetch(force ? "/api/data?refresh=1" : "/api/data", { cache: "no-store" })',
  'fetch(force ? "./api/data.json?refresh=1" : "./api/data.json", { cache: "no-store" })',
);

const workerUrl = `data:text/javascript;base64,${Buffer.from(workerBundle).toString("base64")}`;
const { default: worker } = await import(workerUrl);
const response = await worker.fetch(new Request("https://amics-hc.invalid/api/data"), {}, {});
if (!response.ok) throw new Error(`Could not fetch club data for the Pages snapshot (${response.status})`);
const data = await response.json();
if (!Array.isArray(data.teams)) throw new Error("The data endpoint returned an invalid payload");
const instagramPosts = await fetchLatestInstagramPosts();

await rm(distRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(distRoot, "api"), { recursive: true }),
  mkdir(resolve(distRoot, "images"), { recursive: true }),
]);
await Promise.all([
  writeFile(resolve(distRoot, "index.html"), page, "utf8"),
  writeFile(resolve(distRoot, "api/data.json"), `${JSON.stringify(data)}\n`, "utf8"),
  writeFile(resolve(distRoot, "images/ascenso_ahcjpeg.jpeg"), heroPhoto),
  writeFile(resolve(distRoot, "api/instagram.json"), JSON.stringify(instagramPosts) + "\n", "utf8"),
  writeFile(resolve(distRoot, ".nojekyll"), ""),
]);
console.log(`Built GitHub Pages snapshot in ${distRoot}`);
