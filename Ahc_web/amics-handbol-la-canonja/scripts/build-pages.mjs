import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(projectRoot, "dist");
if (dirname(distRoot) !== projectRoot || distRoot === projectRoot) {
  throw new Error(`Refusing to write output outside this project: ${distRoot}`);
}

async function fetchLatestInstagramPost() {
  try {
    const response = await fetch("https://www.instagram.com/amicshandbolcanonja/embed/", {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Instagram returned HTTP " + response.status);

    const html = await response.text();
    const mediaIndex = html.indexOf("graphql_media");
    if (mediaIndex < 0) throw new Error("Instagram did not return profile media");
    const media = html.slice(mediaIndex, mediaIndex + 80000)
      .replaceAll(String.fromCharCode(92) + '"', '"');
    const markerIndex = media.indexOf('"shortcode_media":');
    const objectStart = media.indexOf("{", markerIndex);
    if (markerIndex < 0 || objectStart < 0) throw new Error("Instagram did not return a post");

    let depth = 0;
    let inString = false;
    let escaped = false;
    let objectEnd = -1;
    for (let index = objectStart; index < media.length; index += 1) {
      const character = media[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          objectEnd = index + 1;
          break;
        }
      }
    }
    if (objectEnd < 0) throw new Error("Instagram returned incomplete post data");

    const post = JSON.parse(media.slice(objectStart, objectEnd));
    const shortcode = String(post.shortcode || "");
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) throw new Error("Instagram returned an invalid post link");
    const decodeEscapes = (value) => String(value || "")
      .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\//g, "/")
      .replace(/\\\\/g, "\\");
    const imageUrl = decodeEscapes(post.display_url || "");
    const caption = decodeEscapes(post.edge_media_to_caption?.edges?.[0]?.node?.text).trim();
    const timestamp = Number(post.taken_at_timestamp);
    let imageBytes = null;
    let imageFile = "";
    if (imageUrl) {
      try {
        const parsedImageUrl = new URL(imageUrl);
        if (parsedImageUrl.protocol !== "https:" || !parsedImageUrl.hostname.endsWith("cdninstagram.com")) {
          throw new Error("Instagram returned an unexpected image host");
        }
        const imageResponse = await fetch(parsedImageUrl, {
          headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8", "user-agent": "Mozilla/5.0", referer: "https://www.instagram.com/" },
          signal: AbortSignal.timeout(20000),
        });
        const contentType = imageResponse.headers.get("content-type") || "";
        if (!imageResponse.ok || !contentType.startsWith("image/")) throw new Error("Instagram image could not be downloaded");
        imageBytes = Buffer.from(await imageResponse.arrayBuffer());
        if (imageBytes.length > 15 * 1024 * 1024) throw new Error("Instagram image is too large to snapshot");
        imageFile = contentType.includes("webp") ? "instagram-latest.webp" : contentType.includes("png") ? "instagram-latest.png" : "instagram-latest.jpg";
      } catch (error) {
        console.warn("Could not snapshot the latest Instagram image: " + (error instanceof Error ? error.message : String(error)));
      }
    }

    return {
      post: {
        permalink: "https://www.instagram.com/p/" + shortcode + "/",
        caption,
        publishedAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : "",
        isVideo: Boolean(post.is_video),
        image: imageFile ? "./images/" + imageFile : imageUrl,
      },
      imageFile,
      imageBytes,
    };
  } catch (error) {
    console.warn("Could not resolve the latest Instagram post: " + (error instanceof Error ? error.message : String(error)));
    return { post: { permalink: "", caption: "", publishedAt: "", isVideo: false, image: "" }, imageFile: "", imageBytes: null };
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
const instagramSnapshot = await fetchLatestInstagramPost();

await rm(distRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(distRoot, "api"), { recursive: true }),
  mkdir(resolve(distRoot, "images"), { recursive: true }),
]);
await Promise.all([
  writeFile(resolve(distRoot, "index.html"), page, "utf8"),
  writeFile(resolve(distRoot, "api/data.json"), `${JSON.stringify(data)}\n`, "utf8"),
  writeFile(resolve(distRoot, "images/ascenso_ahcjpeg.jpeg"), heroPhoto),
  writeFile(resolve(distRoot, "api/instagram.json"), JSON.stringify(instagramSnapshot.post) + "\n", "utf8"),
  ...(instagramSnapshot.imageBytes ? [writeFile(resolve(distRoot, "images", instagramSnapshot.imageFile), instagramSnapshot.imageBytes)] : []),
  writeFile(resolve(distRoot, ".nojekyll"), ""),
]);
console.log(`Built GitHub Pages snapshot in ${distRoot}`);
