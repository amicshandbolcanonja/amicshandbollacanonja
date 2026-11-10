import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const siteImageFiles = ["ascens-640.webp", "ascens-1120.webp", "escut-128.png"];

export function readSiteImages(projectRoot) {
  return Promise.all(siteImageFiles.map(async (file) => ({
    file,
    bytes: await readFile(resolve(projectRoot, "site", file)),
  })));
}
