import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";

const maxPdfBytes = 2 * 1024 * 1024;
const standardFontDataUrl = fileURLToPath(new URL("./standard_fonts/", import.meta.resolve("pdfjs-dist/package.json"))).replaceAll("\\", "/");
const roundHeading = /^JORNADA\s+(\d+)\s*\((\d{1,2})[-/](\d{1,2})[-/](\d{4})\)$/i;
const lineTolerance = 0.85;
// TCPDF aligns each score near the first line of its team cells, even when
// the names wrap. Allow for the small difference in their font baselines.
const rowTopInset = 3;

const normalizeSpace = (text) => text.replace(/\s+/g, " ").trim();
const normalizeName = (name) => name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^\p{L}\p{N}?]/gu, "");
const isBye = (name) => /^(?:descansa|descanso|descans|bye)$/i.test(name);

function textLines(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.at(-1);
    if (!line || line.y - item.y > lineTolerance) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    let text = "";
    let previous;
    for (const item of line.items) {
      if (previous && !/\s$/.test(previous.text) && !/^\s/.test(item.text) && item.x - previous.end > 0.45) text += " ";
      text += item.text;
      previous = item;
    }
    line.text = normalizeSpace(text);
  }
  return lines;
}

function isoDate(day, month, year) {
  const value = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`iSquad printable calendar contains an invalid date: ${value}`);
  }
  return value;
}

function nameFromCell(items) {
  return textLines(items).map(({ text }) => text).reduce((name, line) =>
    name ? name + (name.endsWith("-") ? "" : " ") + line : line, "");
}

function columnSections(items, pageWidth, side) {
  const inColumn = items.filter(({ center }) => (center < pageWidth / 2 ? 0 : 1) === side);
  const headings = textLines(inColumn).flatMap((line) => {
    const match = roundHeading.exec(line.text);
    if (!match) return [];
    const [, number, day, month, year] = match;
    return [{ ...line, type: "round", number: Number(number), date: isoDate(day, month, year) }];
  });
  return { inColumn, headings };
}

function readColumn({ inColumn, headings }, pageWidth, side, activeRound, rounds, ignore) {
  const headingItems = new Set(headings.flatMap(({ items }) => items));
  const body = inColumn.filter((item) => !ignore.has(item) && !headingItems.has(item));
  // A4 print layout: each league column has 40% / 20% / 40% cells.
  const center = pageWidth * (side === 0 ? 0.25714 : 0.74286);
  const scoreHalfWidth = pageWidth * 0.0469;
  const homeItems = body.filter((item) => item.center < center - scoreHalfWidth);
  const awayItems = body.filter((item) => item.center > center + scoreHalfWidth);
  const scoreItems = body.filter((item) => Math.abs(item.center - center) <= scoreHalfWidth);
  const scores = textLines(scoreItems).map((line) => {
    const match = /^(?:(\d+)\s*)?[-–−](?:\s*(\d+))?$/.exec(line.text);
    if (!match || Boolean(match[1]) !== Boolean(match[2])) {
      throw new Error(`Unrecognized score in iSquad printable calendar: ${line.text}`);
    }
    return { ...line, type: "score", homeScore: match[1] ?? "", awayScore: match[2] ?? "" };
  });
  const events = [...headings, ...scores].sort((a, b) => b.y - a.y);
  const assigned = new Set();
  for (const [index, event] of events.entries()) {
    if (event.type === "round") {
      if (event.number < 1 || event.number > 999 || rounds.has(event.number)) {
        throw new Error(`Duplicate or invalid round in iSquad printable calendar: ${event.number}`);
      }
      activeRound = { number: event.number, date: event.date, fixtures: [], byes: [] };
      rounds.set(activeRound.number, activeRound);
      continue;
    }
    if (!activeRound) throw new Error("iSquad printable calendar has a score before its round");
    const top = event.y + rowTopInset;
    const next = events[index + 1];
    const bottom = next ? next.y + rowTopInset : -Infinity;
    const takeCell = (items) => {
      const cell = items.filter(({ y }) => y <= top && y > bottom);
      cell.forEach((item) => assigned.add(item));
      return nameFromCell(cell);
    };
    const homeName = takeCell(homeItems);
    const awayName = takeCell(awayItems);
    if (isBye(homeName) || isBye(awayName)) {
      const team = isBye(homeName) ? awayName : homeName;
      if (!/\p{L}/u.test(team) || isBye(team) || event.homeScore) {
        throw new Error(`Invalid bye in iSquad printable calendar round ${activeRound.number}`);
      }
      activeRound.byes.push(team);
    } else if (!/\p{L}/u.test(homeName) || !/\p{L}/u.test(awayName)) {
      throw new Error(`Incomplete fixture in iSquad printable calendar round ${activeRound.number}`);
    } else {
      activeRound.fixtures.push({ homeName, awayName, homeScore: event.homeScore, awayScore: event.awayScore });
    }
  }
  if (assigned.size !== homeItems.length + awayItems.length) {
    throw new Error("Unassigned team text in iSquad printable calendar");
  }
  return activeRound;
}

function completeRounds(rounds) {
  const result = [...rounds.values()].sort((a, b) => a.number - b.number);
  if (!result.length || result.some((round) => !round.fixtures.length)) {
    throw new Error("iSquad printable calendar is missing fixtures");
  }
  const teams = new Map();
  for (const round of result) {
    const participants = new Set();
    for (const fixture of round.fixtures) {
      const home = normalizeName(fixture.homeName);
      const away = normalizeName(fixture.awayName);
      if (!home || !away || home === away || participants.has(home) || participants.has(away)) {
        throw new Error(`Duplicate or invalid fixture in iSquad printable calendar round ${round.number}`);
      }
      participants.add(home);
      participants.add(away);
      teams.set(home, fixture.homeName);
      teams.set(away, fixture.awayName);
    }
    for (const name of round.byes) {
      const normalized = normalizeName(name);
      if (!normalized || participants.has(normalized)) {
        throw new Error(`Duplicate or invalid bye in iSquad printable calendar round ${round.number}`);
      }
      participants.add(normalized);
      teams.set(normalized, name);
    }
  }
  // Odd groups omit the bye row in their printout. A complete round can
  // identify its absent team unambiguously; do not infer from a partial round.
  if (teams.size % 2 === 1) {
    for (const round of result) {
      const participants = new Set(round.fixtures.flatMap(({ homeName, awayName }) => [normalizeName(homeName), normalizeName(awayName)]));
      if (!round.byes.length && round.fixtures.length === Math.floor(teams.size / 2) && participants.size === teams.size - 1) {
        round.byes.push(...[...teams].filter(([name]) => !participants.has(name)).map(([, name]) => name));
      }
    }
  }
  return result;
}

export async function parsePrintableCalendar(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxPdfBytes ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("Invalid iSquad printable calendar PDF");
  }
  const loading = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    standardFontDataUrl,
  });
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > 30) throw new Error("Unexpected iSquad printable calendar page count");
    const rounds = new Map();
    const activeRounds = [null, null];
    let label = "";
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      if (page.rotate !== 0 || width >= height) throw new Error("Unexpected iSquad printable calendar orientation");
      const content = await page.getTextContent();
      const items = content.items.filter((item) => typeof item.str === "string" && item.str.trim()).map((item) => ({
        text: item.str, x: item.transform[4], y: item.transform[5],
        end: item.transform[4] + item.width, center: item.transform[4] + item.width / 2,
      }));
      const ignore = new Set(textLines(items).filter(({ text }) => /^Powered by TCPDF\b/i.test(text)).flatMap(({ items }) => items));
      const columns = [0, 1].map((side) => columnSections(items.filter((item) => !ignore.has(item)), width, side));
      if (number === 1) {
        const headingY = Math.max(...columns.flatMap(({ headings }) => headings.map(({ y }) => y)));
        const header = textLines(items.filter(({ y }) => y > headingY + lineTolerance));
        if (!Number.isFinite(headingY) || !header.some(({ text }) => /^FEDERACI[ÓO]N CATALANA$/i.test(text)) ||
            !header.some(({ text }) => /^TEMPORADA\s+\d{4}\s*\/\s*\d{4}$/i.test(text))) {
          throw new Error("Unexpected iSquad printable calendar header");
        }
        label = header.at(-1).text;
        header.flatMap(({ items }) => items).forEach((item) => ignore.add(item));
      }
      for (const side of [0, 1]) {
        activeRounds[side] = readColumn(columns[side], width, side, activeRounds[side], rounds, ignore);
      }
      page.cleanup();
    }
    return { label, rounds: completeRounds(rounds) };
  } finally {
    await loading.destroy();
  }
}
