import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const publishedSite = new URL("https://amicshandbolcanonja.github.io/amicshandbollacanonja/");
const languages = ["ca", "es"];
const MiB = 1024 * 1024;

async function fetchPublished(relativePath, accept) {
  const url = new URL(relativePath, publishedSite);
  if (url.origin !== publishedSite.origin || !url.pathname.startsWith(publishedSite.pathname)) {
    throw new Error("Snapshot assets must belong to the published club site");
  }
  const response = await fetch(url, {
    headers: { accept },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Published ${relativePath} returned HTTP ${response.status}`);
  return response;
}

async function readAsset(relativePath, mime, maxBytes) {
  const response = await fetchPublished(relativePath, mime === "image/" ? "image/*" : mime);
  const type = (response.headers.get("content-type") || "").split(";")[0].trim();
  if ((mime === "image/" ? !type.startsWith(mime) : type !== mime) || Number(response.headers.get("content-length")) > maxBytes) {
    throw new Error(`Unexpected type or size for ${relativePath}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error(`Unexpected size for ${relativePath}`);
  return bytes;
}

function pdfFilename(round, language) {
  return `jornada-${String(round.number).padStart(2, "0")}-${language}.pdf`;
}

function pdfPath(team, round, language) {
  return `./pdfs/${team.key}/${pdfFilename(round, language)}`;
}

export function validateCalendarSnapshot(data, expectedTeams, { published = false } = {}) {
  if (!Array.isArray(data?.teams) || data.teams.length !== expectedTeams.size || typeof data.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(data.generatedAt)) || typeof data.club !== "string" || typeof data.season !== "string") {
    throw new Error("The calendar snapshot has an invalid shape or is missing teams");
  }
  const missing = new Set(expectedTeams);
  let hasFullRounds = true;
  for (const team of data.teams) {
    if (!missing.delete(team?.key)) throw new Error("The calendar snapshot contains an unexpected or duplicate team");
    if (team.scheduleAvailable !== true || !Array.isArray(team.fixtures) || !Array.isArray(team.league?.rounds) || !team.league.rounds.length) {
      throw new Error(`Calendar unavailable for ${team.key}`);
    }
    const roundNumbers = new Set();
    for (const round of team.league.rounds) {
      if (!Number.isSafeInteger(round?.number) || round.number < 1 || round.number > 999 || roundNumbers.has(round.number)) {
        throw new Error(`Invalid league round for ${team.key}`);
      }
      roundNumbers.add(round.number);
      if (!Array.isArray(round.fixtures) || !Array.isArray(round.byes)) hasFullRounds = false;
    }
  }
  if (missing.size) throw new Error("The calendar snapshot is missing teams");
  if (hasFullRounds) return true;
  if (!published) throw new Error("The live calendar snapshot is missing league fixtures");

  for (const team of data.teams) {
    for (const round of team.league.rounds) {
      const progress = round.progress;
      if (!progress || ![progress.total, progress.played, progress.pending].every((count) => Number.isSafeInteger(count) && count >= 0) ||
          progress.played + progress.pending !== progress.total || typeof progress.complete !== "boolean" ||
          !languages.every((language) => round.pdfUrls?.[language] === pdfPath(team, round, language))) {
        throw new Error(`Incomplete published PDF metadata for ${team.key}, round ${round.number}`);
      }
    }
  }
  return false;
}

export async function loadPublishedCalendar(expectedTeams) {
  const response = await fetchPublished("./api/data.json", "application/json");
  const data = await response.json();
  const hasFullRounds = validateCalendarSnapshot(data, expectedTeams, { published: true });
  return { data, hasFullRounds };
}

export async function loadPublishedLeagueDetails() {
  const bytes = await readAsset("./api/league-details.json", "application/json", 2 * MiB);
  return JSON.parse(bytes.toString("utf8"));
}

export async function copyPublishedLeaguePdfs(data, distRoot) {
  const files = [];
  for (const team of data.teams) {
    const folder = resolve(distRoot, "pdfs", team.key);
    await mkdir(folder, { recursive: true });
    for (const round of team.league.rounds) {
      for (const language of languages) {
        files.push({ path: pdfPath(team, round, language), destination: resolve(folder, pdfFilename(round, language)) });
      }
    }
  }
  const batchSize = 6;
  for (let offset = 0; offset < files.length; offset += batchSize) {
    await Promise.all(files.slice(offset, offset + batchSize).map(async ({ path, destination }) => {
      const bytes = await readAsset(path, "application/pdf", 3 * MiB);
      if (bytes.toString("ascii", 0, 5) !== "%PDF-") throw new Error(`Invalid published PDF: ${path}`);
      await writeFile(destination, bytes);
    }));
  }
  console.log(`Preserved ${files.length} league round PDFs from the published snapshot`);
}

export async function loadPublishedInstagramPost() {
  const response = await fetchPublished("./api/instagram.json", "application/json");
  const previous = await response.json();
  if (typeof previous?.permalink !== "string" || !/^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/$/.test(previous.permalink)) return null;
  const candidates = Array.isArray(previous.images) ? previous.images : [previous.image];
  const localPaths = [...new Set(candidates)].filter((path) => typeof path === "string" &&
    /^\.\/images\/instagram-latest-[1-9][0-9]*\.(?:avif|gif|jpg|png|webp)$/.test(path)).slice(0, 20);
  const images = [];
  const downloadedImages = [];
  let totalBytes = 0;
  for (const path of localPaths) {
    try {
      const imageBytes = await readAsset(path, "image/", 15 * MiB);
      if (totalBytes + imageBytes.length > 50 * MiB) break;
      totalBytes += imageBytes.length;
      images.push(path);
      downloadedImages.push({ imageFile: path.slice("./images/".length), imageBytes });
    } catch (error) {
      console.warn(`Could not preserve ${path}: ${error.message}`);
    }
  }
  return {
    post: {
      permalink: previous.permalink,
      caption: typeof previous.caption === "string" ? previous.caption : "",
      publishedAt: typeof previous.publishedAt === "string" ? previous.publishedAt : "",
      isVideo: previous.isVideo === true,
      images,
      image: images[0] || "",
    },
    downloadedImages,
  };
}
