import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { TEAM_CONFIG } from "../worker/index.js";
import { readSiteImages } from "./site-images.mjs";
import { generateLeaguePdfs } from "./league-pdfs.mjs";
import { copyPublishedLeaguePdfs, loadPublishedCalendar, loadPublishedInstagramPost, validateCalendarSnapshot } from "./published-snapshot.mjs";

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
    const imageUrls = post.edge_sidecar_to_children?.edges
      ?.map((edge) => decodeEscapes(edge?.node?.display_url || edge?.node?.display_resources?.at(-1)?.src || ""))
      .filter(Boolean) || [];
    if (!imageUrls?.length && post.display_url) imageUrls.push(decodeEscapes(post.display_url));
    const caption = decodeEscapes(post.edge_media_to_caption?.edges?.[0]?.node?.text).trim();
    const timestamp = Number(post.taken_at_timestamp);
    const downloadedImages = [];
    let totalImageBytes = 0;
    const images = [];
    for (const [index, imageUrl] of (imageUrls || []).entries()) {
      try {
        const parsedImageUrl = new URL(imageUrl);
        if (parsedImageUrl.protocol !== "https:" || !(parsedImageUrl.hostname === "cdninstagram.com" || parsedImageUrl.hostname.endsWith(".cdninstagram.com"))) {
          throw new Error("Instagram returned an unexpected image host");
        }
        const imageResponse = await fetch(parsedImageUrl, {
          headers: { accept: "image/avif,image/webp,image/*,*/*;q=0.8", "user-agent": "Mozilla/5.0", referer: "https://www.instagram.com/" },
          signal: AbortSignal.timeout(20000),
        });
        const contentType = imageResponse.headers.get("content-type") || "";
        if (!imageResponse.ok || !contentType.startsWith("image/")) throw new Error("Instagram image could not be downloaded");
        const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
        if (imageBytes.length > 15 * 1024 * 1024 || totalImageBytes + imageBytes.length > 50 * 1024 * 1024) {
          throw new Error("Instagram carousel images are too large to snapshot");
        }
        totalImageBytes += imageBytes.length;
        const extension = contentType.includes("webp") ? "webp" : contentType.includes("png") ? "png" : contentType.includes("avif") ? "avif" : contentType.includes("gif") ? "gif" : "jpg";
        const imageFile = `instagram-latest-${index + 1}.${extension}`;
        downloadedImages.push({ imageFile, imageBytes });
        images.push("./images/" + imageFile);
      } catch (error) {
        console.warn(`Could not snapshot Instagram image ${index + 1}: ` + (error instanceof Error ? error.message : String(error)));
        images.push(imageUrl);
      }
    }

    return {
      post: {
        permalink: "https://www.instagram.com/p/" + shortcode + "/",
        caption,
        publishedAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : "",
        isVideo: Boolean(post.is_video),
        images,
        image: images[0] || "",
      },
      downloadedImages,
    };
  } catch (error) {
    console.warn("Could not resolve the latest Instagram post: " + (error instanceof Error ? error.message : String(error)));
    return { post: { permalink: "", caption: "", publishedAt: "", isVideo: false, images: [], image: "" }, downloadedImages: [] };
  }
}

const [sourcePage, siteImages] = await Promise.all([
  readFile(resolve(projectRoot, "site/index.html"), "utf8"),
  readSiteImages(projectRoot),
]);
function replaceOnce(source, from, to) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exactly one occurrence of ${JSON.stringify(from)}`);
  }
  return `${source.slice(0, first)}${to}${source.slice(first + from.length)}`;
}

const pageWithRelativeImages = sourcePage.replace(
  /\b(src|srcset)="([^"]*)"/g,
  (_, attribute, value) => `${attribute}="${value.replace(/(^|,\s*)\/images\//g, "$1./images/")}"`,
);
const page = replaceOnce(pageWithRelativeImages, '"/api/data"', '"./api/data.json"');

const event = process.env.GITHUB_EVENT_NAME;
const allowPublishedFallback = event === "push" || event === "workflow_dispatch" ||
  (!event && process.env.AHC_USE_PUBLISHED_SNAPSHOT === "1");
const expectedTeams = new Set(TEAM_CONFIG.map(({ key }) => key));
let data;
let hasFullRounds;
try {
  const response = await worker.fetch(new Request("https://amics-hc.invalid/api/data"), {}, {});
  if (!response.ok) throw new Error(`Could not fetch club data for the Pages snapshot (${response.status})`);
  data = await response.json();
  hasFullRounds = validateCalendarSnapshot(data, expectedTeams);
} catch (error) {
  if (!allowPublishedFallback) throw error;
  console.warn(`Live calendars unavailable: ${error.message}`);
  ({ data, hasFullRounds } = await loadPublishedCalendar(expectedTeams));
  console.warn(`Reusing published calendar data from ${data.generatedAt}`);
}

let instagramSnapshot = await fetchLatestInstagramPost();
if (allowPublishedFallback && !instagramSnapshot.post.permalink) {
  try {
    const previous = await loadPublishedInstagramPost();
    if (previous) {
      instagramSnapshot = previous;
      console.warn("Reusing the published Instagram post");
    }
  } catch (error) {
    console.warn(`Could not preserve the published Instagram post: ${error.message}`);
  }
}

await rm(distRoot, { recursive: true, force: true });
await Promise.all([
  mkdir(resolve(distRoot, "api"), { recursive: true }),
  mkdir(resolve(distRoot, "images"), { recursive: true }),
]);
if (hasFullRounds) await generateLeaguePdfs(data, distRoot);
else await copyPublishedLeaguePdfs(data, distRoot);
// The PDFs need all league matches, but the page only uses the round selector and download links.
for (const team of data.teams) {
  if (!Array.isArray(team.league?.rounds)) continue;
  team.league.rounds = team.league.rounds.map(({ number, date, progress, pdfUrls }) => ({ number, date, progress, pdfUrls }));
}
await Promise.all([
  writeFile(resolve(distRoot, "index.html"), page, "utf8"),
  writeFile(resolve(distRoot, "api/data.json"), `${JSON.stringify(data)}\n`, "utf8"),
  ...siteImages.map(({ file, bytes }) => writeFile(resolve(distRoot, "images", file), bytes)),
  writeFile(resolve(distRoot, "api/instagram.json"), JSON.stringify(instagramSnapshot.post) + "\n", "utf8"),
  ...instagramSnapshot.downloadedImages.map(({ imageFile, imageBytes }) => writeFile(resolve(distRoot, "images", imageFile), imageBytes)),
  writeFile(resolve(distRoot, ".nojekyll"), ""),
]);
console.log(`Built GitHub Pages snapshot in ${distRoot}`);
