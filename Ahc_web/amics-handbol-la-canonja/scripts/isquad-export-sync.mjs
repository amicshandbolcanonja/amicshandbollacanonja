import { readFile } from "node:fs/promises";
import { parsePrintableCalendar } from "./isquad-calendar-pdf.mjs";

const EXPORT_URL = "https://balonmano.isquad.es/imprimir_calendario_v3.php";
const MAX_PDF_BYTES = 2 * 1024 * 1024;
const bootstrapDetails = new URL("./data/league-details-2026-11-04.json", import.meta.url);

const nameKey = (name) => String(name ?? "").normalize("NFKD").toLowerCase()
  .replace(/\p{M}/gu, "").replace(/\uFFFD/g, "?").replace(/[^\p{L}\p{N}?]/gu, "");

function sameName(exported, known) {
  const left = [...nameKey(exported)];
  const right = [...nameKey(known)];
  return left.length > 0 && left.length === right.length &&
    left.every((letter, index) => letter === right[index] || letter === "?" || right[index] === "?");
}

const sameMatch = (exported, known) =>
  sameName(exported.homeName, known.homeName) && sameName(exported.awayName, known.awayName);
const hasResult = (match) => /^\d{1,3}$/.test(String(match.homeScore)) && /^\d{1,3}$/.test(String(match.awayScore));
const wasPlayed = (match) => match.state === "played" && hasResult(match);

function oneMatch(matches, fixture, context) {
  const found = matches.filter((candidate) => sameMatch(fixture, candidate));
  if (found.length > 1) throw new Error(`Ambiguous fixture in ${context}: ${fixture.homeName} / ${fixture.awayName}`);
  return found[0];
}

function mergeTournament(team, printable, supplemental, sourceUrl) {
  const previousRounds = new Map(team.league.rounds.map((round) => [round.number, round]));
  if (printable.rounds.length !== previousRounds.size) throw new Error(`Round count changed for ${team.key}`);
  const clubNames = [team.clubLabel, ...team.standings.filter((entry) => entry.isClub).map((entry) => entry.name)];
  const knownNames = [...new Set([
    ...team.standings.map((entry) => entry.name),
    ...team.fixtures.flatMap((fixture) => [fixture.homeName, fixture.awayName]),
  ])];
  const isClubName = (name) => clubNames.some((club) => sameName(name, club));
  const displayName = (name) => {
    const matches = knownNames.filter((known) => sameName(name, known));
    return matches.length === 1 ? matches[0] : name;
  };
  const clubFixtures = [];
  const rounds = printable.rounds.map((round) => {
    const before = previousRounds.get(round.number);
    const context = `${team.key}, round ${round.number}`;
    if (!before || round.fixtures.length !== (before.fixtures?.length ?? before.progress?.total)) {
      throw new Error(`Unexpected fixture count for ${context}`);
    }
    const oldClubFixtures = team.fixtures.filter((fixture) => fixture.round === round.number);
    const seenClubFixtures = new Set();
    const participants = new Set();
    const fixtures = round.fixtures.map((match) => {
      const isClub = isClubName(match.homeName) || isClubName(match.awayName);
      const oldClub = oneMatch(oldClubFixtures, match, context);
      if (isClub && !oldClub) throw new Error(`Club fixture could not be matched in ${context}`);
      if (oldClub && seenClubFixtures.has(oldClub)) throw new Error(`Repeated club fixture in ${context}`);
      if (oldClub) seenClubFixtures.add(oldClub);
      const oldMatch = oldClub || oneMatch(before.fixtures || [], match, context);
      const details = oldMatch || oneMatch(supplemental?.[round.number] || [], match, context);
      // The export has no hours, venues, actas or explicit postponement flag.
      // Keep previously confirmed details only for the same round and pairing.
      // Without an explicit final status, a printed 0–0 can be a placeholder.
      const hasExportScore = hasResult(match) && Number(match.homeScore) + Number(match.awayScore) > 0;
      const result = hasExportScore ? match : oldMatch && wasPlayed(oldMatch) ? oldMatch : null;
      const merged = {
        ...oldMatch,
        homeId: oldMatch?.homeId || nameKey(match.homeName),
        awayId: oldMatch?.awayId || nameKey(match.awayName),
        homeName: details?.homeName || displayName(match.homeName),
        awayName: details?.awayName || displayName(match.awayName),
        date: details?.date || "",
        time: details?.time || "",
        venue: details?.venue || "",
        round: round.number,
        homeScore: result ? String(result.homeScore) : "",
        awayScore: result ? String(result.awayScore) : "",
        state: result ? "played" : oldMatch?.state === "suspended" ? "suspended" : "pending",
        actaUrl: result && oldMatch && String(result.homeScore) === String(oldMatch.homeScore) &&
          String(result.awayScore) === String(oldMatch.awayScore) ? oldMatch.actaUrl || "" : "",
      };
      for (const name of [merged.homeName, merged.awayName]) {
        const key = nameKey(name);
        if (!key || participants.has(key)) throw new Error(`Repeated or missing participant in ${context}`);
        participants.add(key);
      }
      if (oldClub) clubFixtures.push(merged);
      return merged;
    });
    if (seenClubFixtures.size !== oldClubFixtures.length) throw new Error(`Missing club fixture in ${context}`);
    const previousPlayed = before.progress?.played ?? before.fixtures.filter(wasPlayed).length;
    if (fixtures.filter(wasPlayed).length < previousPlayed) throw new Error(`Result count decreased in ${context}`);
    return { ...round, fixtures, byes: round.byes.map(displayName) };
  });
  if (!clubFixtures.length || clubFixtures.length !== team.fixtures.length) {
    throw new Error(`Incomplete club calendar for ${team.key}`);
  }
  return {
    ...team,
    fixtures: clubFixtures,
    league: { ...team.league, rounds, printableUrl: sourceUrl },
  };
}

export function makeLeagueDetails(data) {
  return {
    generatedAt: data.detailsGeneratedAt || data.generatedAt,
    teams: Object.fromEntries(data.teams.map((team) => [
      team.key,
      Object.fromEntries(team.league.rounds.map((round) => [
        round.number,
        round.fixtures.filter(({ date, time, venue }) => date || time || venue)
          .map(({ homeName, awayName, date, time, venue }) => ({ homeName, awayName, date, time, venue })),
      ])),
    ])),
  };
}

export async function readBootstrapLeagueDetails() {
  try { return JSON.parse(await readFile(bootstrapDetails, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export async function updateFromPrintableCalendars(previous, knownDetails) {
  const detailsGeneratedAt = previous.detailsGeneratedAt || previous.generatedAt;
  const supplemental = knownDetails?.generatedAt === detailsGeneratedAt ? knownDetails.teams : null;
  const teams = [];
  for (let offset = 0; offset < previous.teams.length; offset += 3) {
    teams.push(...await Promise.all(previous.teams.slice(offset, offset + 3).map(async (team) => {
      const tournament = String(team.league.tournamentId);
      if (!/^\d{5,12}$/.test(tournament)) throw new Error(`Invalid official tournament for ${team.key}`);
      const url = new URL(EXPORT_URL);
      url.searchParams.set("id", tournament);
      const response = await fetch(url, {
        headers: { accept: "application/pdf" },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/pdf") ||
          Number(response.headers.get("content-length")) > MAX_PDF_BYTES) {
        throw new Error(`Official PDF unavailable for ${team.key} (HTTP ${response.status})`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_PDF_BYTES || bytes.toString("ascii", 0, 5) !== "%PDF-") {
        throw new Error(`Invalid official PDF for ${team.key}`);
      }
      const calendar = await parsePrintableCalendar(new Uint8Array(bytes));
      return mergeTournament(team, calendar, supplemental?.[team.key], url.href);
    })));
  }
  const matchCount = teams.flatMap((team) => team.league.rounds).flatMap((round) => round.fixtures);
  console.log(`Imported ${teams.length} official iSquad PDFs: ${matchCount.length} matches, ${matchCount.filter(wasPlayed).length} results`);
  return { ...previous, teams, generatedAt: new Date().toISOString(), detailsGeneratedAt, sourceMode: "isquad-printable" };
}
