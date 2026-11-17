import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const siteImageFiles = ["ascens-640.webp", "ascens-1120.webp", "escut-128.png"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readPlayerPortraits(projectRoot) {
  let source;
  try {
    source = await readFile(resolve(projectRoot, "site/player-portraits.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const portraits = JSON.parse(source);
  if (!isRecord(portraits)) throw new Error("Player portraits must be keyed by team");
  for (const [team, players] of Object.entries(portraits)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(team) || !isRecord(players)) {
      throw new Error("Invalid team in player-portraits.json");
    }
    for (const [key, file] of Object.entries(players)) {
      if (!/^[a-z0-9]+$/.test(key) || typeof file !== "string" || !/^[a-f0-9]+\.webp$/.test(file)) {
        throw new Error(`Invalid portrait entry for team ${team} in player-portraits.json`);
      }
    }
  }
  return portraits;
}

export async function readSiteAssets(projectRoot) {
  const playerPortraits = await readPlayerPortraits(projectRoot);
  const portraitFiles = new Set(Object.values(playerPortraits).flatMap((players) => Object.values(players)));
  const imageFiles = [...siteImageFiles, ...Array.from(portraitFiles, (file) => `portraits/${file}`)];
  const siteImages = await Promise.all(imageFiles.map(async (file) => ({
    file,
    bytes: await readFile(resolve(projectRoot, "site", file)),
  })));
  return { siteImages, playerPortraits };
}

export function embedPlayerPortraits(page, playerPortraits) {
  if (!Object.keys(playerPortraits).length) return page;
  const marker = "const playerPortraits = {};";
  if (page.split(marker).length !== 2) throw new Error("Page must contain exactly one playerPortraits marker");
  return page.replace(marker, () => `const playerPortraits = ${JSON.stringify(playerPortraits)};`);
}
