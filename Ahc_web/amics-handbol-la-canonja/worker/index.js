const PAGE_HTML = "";
const HERO_PHOTO_BASE64 = "";
const HERO_PHOTO_BYTES = Uint8Array.from(atob(HERO_PHOTO_BASE64), (character) => character.charCodeAt(0));

const CLUB_URL = "https://resultadosbalonmano.isquad.es/club.php?id=100639&id_superficie=1&id_temp=2627";
const CLUB_ID = "100639";
const SEASON_ID = "2627";
const CACHE_TTL_SECONDS = 300;
const SOURCE_ORIGIN = "https://resultadosbalonmano.isquad.es";
const ACTA_ORIGIN = "https://balonmano.isquad.es";
const BADGE_URL = "https://balonmano.isquad.es/images/afiliacion_clubs/100639/square_73326d626f6b37737763.jpg";
const INSTAGRAM_EMBED_URL = "https://www.instagram.com/amicshandbolcanonja/embed/";
const INSTAGRAM_CACHE_TTL_SECONDS = 900;

// Cloudflare's default Cache API is disabled in Sites Workers. Keep the latest
// successful sync in this isolate's memory and share concurrent refreshes.
let cachedData = null;
let cachedAt = 0;
let inFlightRefresh = null;
let cachedInstagramPosts = null;
let instagramCachedAt = 0;

const TEAM_CONFIG = [
  { id: "222243", key: "senior-masculi", category: "3077", competition: "211808", tournament: "1038562", nameCa: "Sènior masculí", nameEs: "Sénior masculino", competitionCa: "Segona Catalana · Grup B", competitionEs: "Segunda Catalana · Grupo B" },
  { id: "222242", key: "senior-femeni", category: "3076", competition: "211803", tournament: "1038568", nameCa: "Sènior femení", nameEs: "Sénior femenino", competitionCa: "Primera Catalana · Grup A", competitionEs: "Primera Catalana · Grupo A" },
  { id: "222245", key: "juvenil-femeni", category: "3078", competition: "211813", tournament: "1038687", nameCa: "Juvenil femení", nameEs: "Juvenil femenino", competitionCa: "Primera Catalana juvenil femenina", competitionEs: "Primera Catalana juvenil femenina" },
  { id: "222246", key: "juvenil-masculi", category: "3079", competition: "211822", tournament: "1038769", nameCa: "Juvenil masculí", nameEs: "Juvenil masculino", competitionCa: "Primera Catalana juvenil masculina", competitionEs: "Primera Catalana juvenil masculina" },
  { id: "222247", key: "cadet-femeni", category: "3080", competition: "211816", tournament: "1038692", nameCa: "Cadet femení", nameEs: "Cadete femenino", competitionCa: "Primera Catalana cadet femenina", competitionEs: "Primera Catalana cadete femenina" },
  { id: "222248", key: "cadet-masculi", category: "3081", competition: "211826", tournament: "1038761", nameCa: "Cadet masculí", nameEs: "Cadete masculino", competitionCa: "Primera Catalana cadet masculina", competitionEs: "Primera Catalana cadete masculina" },
  { id: "222251", key: "infantil-femeni", category: "3082", competition: "211819", tournament: "1038699", nameCa: "Infantil femení", nameEs: "Infantil femenino", competitionCa: "Primera Catalana infantil femenina", competitionEs: "Primera Catalana infantil femenina" },
  { id: "222252", key: "infantil-mixt", category: "3084", competition: "211830", tournament: "1038777", nameCa: "Infantil mixt", nameEs: "Infantil mixto", competitionCa: "Segona Catalana infantil mixta", competitionEs: "Segunda Catalana infantil mixta" },
  { id: "225572", key: "infantil-masculi", category: "3083", competition: "211829", tournament: "1038753", nameCa: "Infantil masculí", nameEs: "Infantil masculino", competitionCa: "Primera Catalana infantil masculina", competitionEs: "Primera Catalana infantil masculina" },
];

const namedEntities = {
  amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü",
  Auml: "Ä", Euml: "Ë", Iuml: "Ï", Ouml: "Ö", Uuml: "Ü",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç",
  iexcl: "¡", iquest: "¿", ordm: "º", deg: "°", rsquo: "’", ldquo: "“", rdquo: "”",
};

function decodeEntities(value) {
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const number = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
    }
    return namedEntities[code] ?? entity;
  });
}

function textFromHtml(value) {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`iSquad returned ${response.status}`);
  return response.text();
}

function parseClubTeams(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  return rows.flatMap((row) => {
    if (!row.includes(`id_club=${CLUB_ID}`) && !row.includes(`id_club=${CLUB_ID}&`)) return [];
    if (!row.includes("Temporada 2026/2027")) return [];
    const id = row.match(/id_equipo=(\d+)/i)?.[1];
    if (!id) return [];
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const categoryLabel = textFromHtml(cells[1] ?? "");
    const clubLabel = row.match(/-->\s*([^<]+)</)?.[1]?.trim() ?? "Amics H.C.";
    return [{ id, categoryLabel, clubLabel }];
  });
}

function parseRoster(html) {
  const table = html.match(/<table\b[^>]*\btabla-plantilla\b[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const players = [];
  const guests = [];
  for (const row of rows) {
    if (/second-table-info/i.test(row)) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 2) continue;
    const role = textFromHtml(cells[1]);
    if (!/^(jugador|invitado)$/i.test(role)) continue;
    const name = row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]
      ? decodeEntities(row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)[1]).trim()
      : textFromHtml(cells[0]);
    if (name) (role.toLowerCase() === "invitado" ? guests : players).push(name);
  }
  return {
    players: [...new Set(players)].sort((a, b) => a.localeCompare(b, "ca")),
    guests: [...new Set(guests)].sort((a, b) => a.localeCompare(b, "ca")),
  };
}

function parseStaff(html) {
  const table = html.match(/<table\b[^>]*\btabla-plantilla\b[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const staff = [];
  const seen = new Set();
  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const role = textFromHtml(cells[1] ?? "");
    if (!role || /^(jugador|invitado)$/i.test(role)) continue;
    const imageAlt = row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1] ?? "";
    const name = imageAlt ? decodeEntities(imageAlt).trim() : textFromHtml(cells[0] ?? "");
    const key = name.toLowerCase() + "|" + role.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    staff.push({ name, role });
  }
  return staff;
}

function parseStandings(html, team) {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const clubName = (team.clubLabel || "Amics H.C.").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let fallbackStandings = [];

  for (const table of tables) {
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
    const standings = rows.flatMap((row) => {
      const cells = [...row.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi)].map((match) => match[0]);
      if (cells.length < 9) return [];

      const linkedTeamId = row.match(/<a\b[^>]*href=["'][^"']*\bid_equipo=(\d+)/i)?.[1] ?? "";
      const teamCellIndex = cells.findIndex((cell) => /<a\b[^>]*href=["'][^"']*\bid_equipo=\d+/i.test(cell) && textFromHtml(cell));
      const teamCell = teamCellIndex >= 0 ? cells[teamCellIndex] : "";
      const teamName = textFromHtml(teamCell);
      const normalizedName = teamName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const isClub = linkedTeamId === team.id || (clubName && (normalizedName.includes(clubName) || normalizedName.includes("amicshc")));
      const position = Number.parseInt(textFromHtml(cells[0]).match(/^\s*(\d+)/)?.[1] ?? "", 10);
      if (!teamName || !Number.isFinite(position)) return [];

      // The classification table contains form and movement columns too. Read
      // the numeric statistics after the team link so those decorative cells
      // do not affect the points and match totals.
      const stats = cells.slice(teamCellIndex >= 0 ? teamCellIndex + 1 : 1)
        .map((cell) => textFromHtml(cell).match(/^\s*(-?\d+)\b/)?.[1])
        .filter((value) => value !== undefined)
        .map(Number);
      if (stats.length < 8) return [];

      return [{
        position,
        name: teamName,
        isClub,
        points: stats[0],
        played: stats[1],
        wins: stats[2],
        draws: stats[3],
        losses: stats[4],
        goalsFor: stats[5],
        goalsAgainst: stats[6],
        goalDifference: stats[7],
      }];
    });
    if (standings.length && standings.some((entry) => entry.isClub)) return standings;
    if (!fallbackStandings.length && standings.length) fallbackStandings = standings;
  }
  return fallbackStandings;
}

function parseTeamScorers(html, team) {
  const table = html.match(/<table\b[^>]*\btabla_goleadores\b[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const scorersByName = new Map();
  for (const row of rows) {
    const teamId = row.match(/<a\b[^>]*href=["'][^"']*\bid_equipo=(\d+)/i)?.[1] ?? "";
    if (teamId !== team.id) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    const name = textFromHtml(cells[1] ?? "");
    const goals = Number(textFromHtml(cells[3] ?? ""));
    if (!name || !Number.isFinite(goals)) continue;
    const key = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const previous = scorersByName.get(key);
    if (!previous || goals > previous.goals) scorersByName.set(key, { name, goals });
  }
  return [...scorersByName.values()];
}

function parseTopScorers(scorers) {
  if (!scorers.length) return [];
  const maximumGoals = Math.max(...scorers.map((scorer) => scorer.goals));
  return scorers.filter((scorer) => scorer.goals === maximumGoals).map((scorer) => scorer.name);
}

function parseDate(value) {
  const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function numberFixtures(fixtures) {
  fixtures.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31") || a.sourceOrder - b.sourceOrder);
  return fixtures.map(({ sourceOrder, ...fixture }, index) => ({ ...fixture, round: index + 1 }));
}

function parseTeamBadgeUrls(html) {
  const badgeUrls = new Map();
  const slides = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bdiv_escudos_cabecera\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  for (const [, slide] of slides) {
    const teamId = slide.match(/\bid_equipo=(\d+)/i)?.[1];
    const imageSource = slide.match(/<img\b[^>]*?\bsrc=["']([^"']+)["']/i)?.[1];
    if (!teamId || !imageSource) continue;
    try {
      const badgeUrl = new URL(imageSource.startsWith("//") ? `https:${imageSource}` : imageSource, SOURCE_ORIGIN);
      if (badgeUrl.protocol === "https:" && badgeUrl.hostname === "balonmano.isquad.es" && /^\/images\/afiliacion_clubs\/\d+\//i.test(badgeUrl.pathname)) {
        badgeUrls.set(teamId, badgeUrl.href);
      }
    } catch {}
  }
  return badgeUrls;
}

function fixtureFromRow(row, team, scoreClass, dateClass, venueClass, badgeUrls = new Map()) {
  const namesBlock = row.match(/<div\b[^>]*class=["']nombres-equipos["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const sides = [...namesBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    id: match[1].match(/id_equipo=(\d+)/i)?.[1] ?? "",
    name: textFromHtml(match[2]),
  }));
  if (sides.length < 2 || (team && !sides.some((side) => side.id === team.id))) return null;

  const scoreCell = row.match(new RegExp(`<td\\b[^>]*class=["']${scoreClass}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] ?? "";
  const score = textFromHtml(scoreCell).match(/(\d+)\s*[-–]\s*(\d+)/);
  const dateCell = row.match(new RegExp(`<td\\b[^>]*class=["']${dateClass}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] ?? "";
  const dateDivs = [...dateCell.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => textFromHtml(match[1]));
  const date = parseDate(dateDivs[0] ?? row);
  const fallbackTime = row.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? "";
  const timeText = dateDivs[1] ?? fallbackTime;
  const time = /^\d{1,2}:\d{2}$/.test(timeText) && !/^0?0:00$/.test(timeText) ? timeText : "";
  const venueCell = row.match(new RegExp(`<td\\b[^>]*class=["']${venueClass}["'][^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] ?? "";
  const venue = textFromHtml(venueCell);
  const rawState = row.match(/data-estado=["']([^"']+)["']/i)?.[1] ?? "";
  const stateText = `${rawState} ${textFromHtml(row)}`.toLowerCase();
  const actaMatchId = row.match(/mostrarActaFormal\((\d+)\)/i)?.[1] ?? "";
  const explicitFinal = /finaliz|terminad|played|homologad/.test(stateText);
  const confirmedScore = score && (Number(score[1]) + Number(score[2]) > 0 || explicitFinal || actaMatchId);
  const state = /suspend|ajorn|aplaz|cancel|anul/.test(stateText)
    ? "suspended"
    : confirmedScore || explicitFinal ? "played" : "pending";
  return {
    homeId: sides[0].id,
    homeName: sides[0].name,
    homeBadgeUrl: badgeUrls.get(sides[0].id) ?? "",
    awayId: sides[1].id,
    awayName: sides[1].name,
    awayBadgeUrl: badgeUrls.get(sides[1].id) ?? "",
    homeScore: score?.[1] ?? "",
    awayScore: score?.[2] ?? "",
    date,
    time,
    venue,
    state,
    actaUrl: state === "played" && score && actaMatchId
      ? `${ACTA_ORIGIN}/acta_completa_pdf.php?id_partido=${actaMatchId}`
      : "",
  };
}

function parseTeamFixtures(html, team) {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bpartido\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const badgeUrls = parseTeamBadgeUrls(html);
  let sourceOrder = 0;
  const fixtures = rows.flatMap((row) => {
    const fixture = fixtureFromRow(row, team, "col-marcador", "fecha", "col-lugar", badgeUrls);
    return fixture ? [{ ...fixture, sourceOrder: sourceOrder++ }] : [];
  });
  return numberFixtures(fixtures);
}

function parseCalendar(html, team) {
  return parseLeagueCalendar(html).flatMap((round) => round.fixtures.filter((fixture) => fixture.homeId === team.id || fixture.awayId === team.id));
}

export function parseLeagueCalendar(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const badgeUrls = parseTeamBadgeUrls(html);
  const rounds = new Map();
  let currentRound = null;
  for (const row of rows) {
    const heading = textFromHtml(row).match(/^JORNADA\s+(\d+)\b(.*)$/i);
    if (heading) {
      const number = Number(heading[1]);
      if (!rounds.has(number)) rounds.set(number, { number, date: parseDate(heading[2]), fixtures: [], byes: [] });
      currentRound = rounds.get(number);
      continue;
    }
    if (!currentRound) continue;
    const namesBlock = row.match(/<div\b[^>]*class=["']nombres-equipos["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    if (/\bdescansa\b|\bdescans\b/i.test(textFromHtml(namesBlock))) {
      const names = [...namesBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => textFromHtml(match[1])).filter((name) => name && !/\bdescansa\b|\bdescans\b/i.test(name));
      currentRound.byes = [...new Set([...currentRound.byes, ...names])];
      continue;
    }
    if (!/class=["']fecha["']/i.test(row)) continue;
    const fixture = fixtureFromRow(row, null, "marcador", "fecha", "lugar", badgeUrls);
    if (fixture && !currentRound.fixtures.some((item) => item.homeId === fixture.homeId && item.awayId === fixture.awayId)) {
      currentRound.fixtures.push({ ...fixture, round: currentRound.number });
    }
  }
  const result = [...rounds.values()].sort((a, b) => a.number - b.number);
  const clubs = new Map(result.flatMap((round) => round.fixtures.flatMap((fixture) => [[fixture.homeId, fixture.homeName], [fixture.awayId, fixture.awayName]])));
  // iSquad omits bye rows in odd-sized groups. Only infer a bye when the
  // round has the expected number of fixtures for the complete group.
  if (clubs.size % 2 === 1 && clubs.size > 1) {
    for (const round of result) {
      if (round.fixtures.length !== Math.floor(clubs.size / 2)) continue;
      const participants = new Set(round.fixtures.flatMap((fixture) => [fixture.homeId, fixture.awayId]));
      round.byes = [...new Set([...round.byes, ...[...clubs].filter(([id]) => !participants.has(id)).map(([, name]) => name)])];
    }
  }
  return result;
}

function fixtureKey(fixture) {
  return [fixture.homeId, fixture.awayId, fixture.date, fixture.homeScore, fixture.awayScore].join("|");
}

function parseFormalActas(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const actas = new Map();
  for (const row of rows) {
    const actaMatchId = row.match(/mostrarActaFormal\((\d+)\)/i)?.[1] ?? "";
    if (!actaMatchId) continue;

    const namesBlock = row.match(/<div\b[^>]*class=["']nombres-equipos["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const sides = [...namesBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
      id: match[1].match(/id_equipo=(\d+)/i)?.[1] ?? "",
      name: textFromHtml(match[2]),
    }));
    if (sides.length < 2 || !sides[0].id || !sides[1].id) continue;

    const scoreCell = row.match(/<td\b[^>]*class=["'][^"']*\bcol-marcador\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const score = textFromHtml(scoreCell).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!score) continue;

    const state = (row.match(/data-estado=["']([^"']+)["']/i)?.[1] ?? textFromHtml(row)).toLowerCase();
    if (/suspend|ajorn|aplaz|cancel|anul/.test(state)) continue;

    const fixture = {
      homeId: sides[0].id,
      awayId: sides[1].id,
      date: parseDate(row),
      homeScore: score[1],
      awayScore: score[2],
    };
    actas.set(fixtureKey(fixture), `${ACTA_ORIGIN}/acta_completa_pdf.php?id_partido=${actaMatchId}`);
  }
  return actas;
}

function addFormalActas(fixtures, actas) {
  return fixtures.map((fixture) => {
    const actaUrl = fixture.actaUrl || actas.get(fixtureKey(fixture)) || "";
    return {
      ...fixture,
      state: actaUrl && fixture.state !== "suspended" ? "played" : fixture.state,
      actaUrl,
    };
  });
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function pageUrlForTeam(team, includeCompetition = true) {
  const params = new URLSearchParams({
    seleccion: "0",
    id_superficie: "1",
    id_equipo: team.id,
    id: team.tournament ?? "",
    id_temp: SEASON_ID,
    id_territorial: "17",
    id_club: CLUB_ID,
    id_categoria: team.category ?? "",
    id_ambito: "0",
    iframe: "0",
  });
  if (includeCompetition && team.competition) params.set("id_competicion", team.competition);
  return `${SOURCE_ORIGIN}/equipo.php?${params}`;
}

function calendarUrlForTeam(team, tournament = team.tournament) {
  const params = new URLSearchParams({
    id_categoria: team.category,
    id_competicion: team.competition,
    id_superficie: "1",
    id_territorial: "17",
    id_temp: SEASON_ID,
    id_ambito: "0",
    seleccion: "0",
  });
  if (tournament) params.set("id", tournament);
  return `${SOURCE_ORIGIN}/calendario.php?${params}`;
}

function statisticsUrlForTeam(team) {
  const params = new URLSearchParams({
    id: team.tournament,
    id_ambito: "0",
    id_categoria: team.category,
    id_competicion: team.competition,
    id_superficie: "1",
    id_territorial: "17",
    iframe: "0",
    seleccion: "0",
  });
  return SOURCE_ORIGIN + "/estadisticas.php?" + params.toString();
}

function classificationUrlForTeam(team, tournament = team.tournament) {
  const params = new URLSearchParams({
    id: tournament ?? "",
    id_ambito: "0",
    id_categoria: team.category,
    id_competicion: team.competition,
    id_superficie: "1",
    id_territorial: "17",
    iframe: "0",
    seleccion: "0",
  });
  return `${SOURCE_ORIGIN}/clasificacion.php?${params}`;
}

function parseTournamentOptions(html) {
  const select = html.match(/<select\b[^>]*\bid=["']torneos["'][^>]*>[\s\S]*?<\/select>/i)?.[0] ?? "";
  const options = [...select.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].flatMap((match) => {
    const id = match[1].match(/\bvalue=["'](\d+)["']/i)?.[1];
    return id ? [{ id, label: textFromHtml(match[2]), selected: /\bselected\b/i.test(match[1]) }] : [];
  });
  return {
    selected: options.find((option) => option.selected)?.id ?? "",
    label: options.find((option) => option.selected)?.label ?? "",
    ids: options.map((option) => option.id),
  };
}

async function fetchTeamCalendar(team) {
  // The federation separates some divisions into several groups. Discover the
  // current groups, then select the calendar that actually contains this club.
  const firstHtml = await fetchHtml(calendarUrlForTeam(team, ""));
  const firstFixtures = parseCalendar(firstHtml, team);
  const { selected, ids, label } = parseTournamentOptions(firstHtml);
  if (firstFixtures.length) return { fixtures: firstFixtures, tournamentId: selected || team.tournament, rounds: parseLeagueCalendar(firstHtml), label };

  const candidates = [...new Set([...ids, team.tournament].filter((id) => id && id !== selected))];
  for (const tournament of candidates) {
    const html = await fetchHtml(calendarUrlForTeam(team, tournament));
    const fixtures = parseCalendar(html, team);
    if (fixtures.length) return { fixtures, tournamentId: tournament, rounds: parseLeagueCalendar(html), label: parseTournamentOptions(html).label };
  }
  return { fixtures: [], tournamentId: selected || team.tournament, rounds: [], label };
}

async function fetchFormalActas(tournamentId) {
  if (!tournamentId) return new Map();
  try {
    const params = new URLSearchParams({ id: tournamentId, seleccion: "0" });
    const html = await fetchHtml(`${SOURCE_ORIGIN}/resultados_completos.php?${params}`);
    return parseFormalActas(html);
  } catch {
    return new Map();
  }
}

async function buildData() {
  const clubHtml = await fetchHtml(CLUB_URL);
  const clubRows = parseClubTeams(clubHtml);
  const currentIds = new Set(clubRows.map((team) => team.id));
  const currentSeasonTeams = TEAM_CONFIG.filter((team) => currentIds.has(team.id));
  const byId = new Map(clubRows.map((team) => [team.id, team]));

  const teams = await mapLimit(currentSeasonTeams, 3, async (team) => {
    const hasScorersPage = team.key === "senior-masculi";
    const [rosterResult, scheduleResult, scorersResult] = await Promise.allSettled([
      fetchHtml(pageUrlForTeam(team)),
      fetchTeamCalendar(team),
      hasScorersPage ? fetchHtml(statisticsUrlForTeam(team)) : Promise.resolve(""),
    ]);
    const sourceRow = byId.get(team.id);
    const rosterHtml = rosterResult.status === "fulfilled" ? rosterResult.value : "";
    const roster = rosterHtml ? parseRoster(rosterHtml) : { players: [], guests: [] };
    const schedule = scheduleResult.status === "fulfilled" ? scheduleResult.value : { fixtures: [], tournamentId: "" };
    const calendarFixtures = schedule.fixtures;
    const [standingsResult, formalActas] = await Promise.all([
      schedule.tournamentId ? fetchHtml(classificationUrlForTeam(team, schedule.tournamentId)).catch(() => "") : Promise.resolve(""),
      fetchFormalActas(schedule.tournamentId),
    ]);
    const scorersHtml = scorersResult.status === "fulfilled" ? scorersResult.value : "";
    const scorers = scorersHtml ? parseTeamScorers(scorersHtml, team) : [];
    return {
      ...team,
      clubLabel: sourceRow?.clubLabel ?? "Amics H.C.",
      categoryLabel: sourceRow?.categoryLabel ?? "",
      teamUrl: pageUrlForTeam(team),
      standingsUrl: classificationUrlForTeam(team, schedule.tournamentId),
      tournamentId: schedule.tournamentId,
      standings: parseStandings(standingsResult || rosterHtml, { ...team, clubLabel: sourceRow?.clubLabel ?? "Amics H.C." }),
      players: roster.players,
      guests: roster.guests,
      staff: rosterHtml ? parseStaff(rosterHtml) : [],
      scorers,
      scorersAvailable: hasScorersPage && /tabla_goleadores/i.test(scorersHtml),
      topScorers: parseTopScorers(scorers),
      scorersUrl: hasScorersPage ? statisticsUrlForTeam(team) : "",
      fixtures: addFormalActas(rosterHtml ? parseTeamFixtures(rosterHtml, team) : [], formalActas),
      calendarFixtures: addFormalActas(calendarFixtures, formalActas),
      league: {
        tournamentId: schedule.tournamentId,
        label: schedule.label || "",
        sourceUrl: calendarUrlForTeam(team, schedule.tournamentId),
        rounds: (schedule.rounds || []).map((round) => ({ ...round, fixtures: addFormalActas(round.fixtures, formalActas) })),
      },
      rosterAvailable: rosterResult.status === "fulfilled",
      scheduleAvailable: scheduleResult.status === "fulfilled",
    };
  });

  for (const team of teams) {
    // The official round must stay attached to a postponed match even when
    // its new date falls after later rounds. The team page numbers by date.
    if (team.calendarFixtures.length) team.fixtures = team.calendarFixtures;
    delete team.calendarFixtures;
  }

  return {
    club: "Amics Handbol La Canonja",
    season: "2026/27",
    badge: BADGE_URL,
    generatedAt: new Date().toISOString(),
    teams,
    sourceAvailable: true,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function getData(forceRefresh) {
  if (!forceRefresh && cachedData && Date.now() - cachedAt < CACHE_TTL_SECONDS * 1000) {
    return cachedData;
  }
  if (inFlightRefresh) return inFlightRefresh;

  const refresh = buildData()
    .then((data) => {
      cachedData = data;
      cachedAt = Date.now();
      return data;
    })
    .finally(() => {
      if (inFlightRefresh === refresh) inFlightRefresh = null;
    });
  inFlightRefresh = refresh;
  return refresh;
}

function parseInstagramMedia(html) {
  const mediaIndex = html.indexOf("graphql_media");
  if (mediaIndex < 0) return null;
  const media = html.slice(mediaIndex, mediaIndex + 250000).replaceAll(String.fromCharCode(92) + '"', '"');
  const markerIndex = media.indexOf('"shortcode_media":');
  const objectStart = media.indexOf("{", markerIndex);
  if (markerIndex < 0 || objectStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
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
    else if (character === "}" && --depth === 0) {
      try { return JSON.parse(media.slice(objectStart, index + 1)); } catch { return null; }
    }
  }
  return null;
}

function parseInstagramPosts(html) {
  const mediaIndex = html.indexOf("graphql_media");
  const media = mediaIndex < 0 ? "" : html.slice(mediaIndex, mediaIndex + 250000).replaceAll(String.fromCharCode(92) + '"', '"');
  const post = parseInstagramMedia(html);
  const shortcode = String(post?.shortcode || media.match(/"shortcode":"([A-Za-z0-9_-]+)"/)?.[1] || "");
  if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;

  const isInstagramImageUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (url.hostname === "cdninstagram.com" || url.hostname.endsWith(".cdninstagram.com"));
    } catch { return false; }
  };
  const images = post?.edge_sidecar_to_children?.edges
    ?.map((edge) => String(edge?.node?.display_url || edge?.node?.display_resources?.at(-1)?.src || ""))
    .filter(isInstagramImageUrl) || [];
  if (!images.length && isInstagramImageUrl(post?.display_url)) images.push(post.display_url);
  const timestamp = Number(post?.taken_at_timestamp);
  return {
    permalink: `https://www.instagram.com/p/${shortcode}/`,
    caption: typeof post?.edge_media_to_caption?.edges?.[0]?.node?.text === "string" ? post.edge_media_to_caption.edges[0].node.text : "",
    publishedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : "",
    isVideo: Boolean(post?.is_video),
    images,
    image: images[0] || "",
  };
}

async function getInstagramPosts() {
  if (cachedInstagramPosts && Date.now() - instagramCachedAt < INSTAGRAM_CACHE_TTL_SECONDS * 1000) {
    return cachedInstagramPosts;
  }
  const response = await fetch(INSTAGRAM_EMBED_URL, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Instagram returned ${response.status}`);
  const post = parseInstagramPosts(await response.text());
  if (!post?.permalink) throw new Error("Instagram did not return any posts");
  cachedInstagramPosts = post;
  instagramCachedAt = Date.now();
  return cachedInstagramPosts;
}

export default {
  async fetch(request, env, ctx) {
    void env;
    void ctx;
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    if (url.pathname === "/api/data") {
      try {
        const data = await getData(url.searchParams.get("refresh") === "1");
        return jsonResponse(data);
      } catch (error) {
        console.error("iSquad sync failed", error instanceof Error ? error.message : error);
        return jsonResponse({ error: "No s'han pogut consultar ara les dades d'iSquad." }, 502);
      }
    }

    if (url.pathname === "/api/instagram.json") {
      try {
        return jsonResponse(await getInstagramPosts());
      } catch (error) {
        console.error("Instagram sync failed", error instanceof Error ? error.message : error);
        return jsonResponse({ permalink: "", images: [] }, 502);
      }
    }

    if (url.pathname === "/images/ascenso_ahcjpeg.jpeg") {
      return new Response(HERO_PHOTO_BYTES, {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "public, max-age=86400",
          "x-content-type-options": "nosniff",
        },
      });
    }

    if (url.pathname !== "/" && url.pathname !== "/index.html") return new Response("Not found", { status: 404 });
    return new Response(PAGE_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
