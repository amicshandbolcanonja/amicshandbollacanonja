const PAGE_HTML = "";
const HERO_PHOTO_BASE64 = "";
const HERO_PHOTO_BYTES = Uint8Array.from(atob(HERO_PHOTO_BASE64), (character) => character.charCodeAt(0));

const CLUB_URL = "https://resultadosbalonmano.isquad.es/club.php?id=100639&id_superficie=1&id_temp=2627";
const CLUB_ID = "100639";
const SEASON_ID = "2627";
const CACHE_TTL_SECONDS = 300;
const SOURCE_ORIGIN = "https://resultadosbalonmano.isquad.es";
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

function parsePlayers(html) {
  const table = html.match(/<table\b[^>]*\btabla-plantilla\b[^>]*>[\s\S]*?<\/table>/i)?.[0] ?? "";
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  const players = [];
  for (const row of rows) {
    if (/second-table-info/i.test(row)) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
    if (cells.length < 2 || !/jugador/i.test(textFromHtml(cells[1]))) continue;
    const name = row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]
      ? decodeEntities(row.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)[1]).trim()
      : textFromHtml(cells[0]);
    if (name) players.push(name);
  }
  return [...new Set(players)].sort((a, b) => a.localeCompare(b, "ca"));
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
  const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function numberFixtures(fixtures) {
  fixtures.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31") || a.sourceOrder - b.sourceOrder);
  return fixtures.map(({ sourceOrder, ...fixture }, index) => ({ ...fixture, round: index + 1 }));
}

function fixtureFromRow(row, team, scoreClass, dateClass, venueClass) {
  const namesBlock = row.match(/<div\b[^>]*class=["']nombres-equipos["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const sides = [...namesBlock.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    id: match[1].match(/id_equipo=(\d+)/i)?.[1] ?? "",
    name: textFromHtml(match[2]),
  }));
  if (sides.length < 2 || !sides.some((side) => side.id === team.id)) return null;

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
  const state = /suspend|ajorn|aplaz|cancel|anul/.test(stateText)
    ? "suspended"
    : score || /finaliz|terminad|played/.test(stateText) ? "played" : "pending";
  return {
    homeId: sides[0].id,
    homeName: sides[0].name,
    awayId: sides[1].id,
    awayName: sides[1].name,
    homeScore: score?.[1] ?? "",
    awayScore: score?.[2] ?? "",
    date,
    time,
    venue,
    state,
  };
}

function parseTeamFixtures(html, team) {
  const rows = [...html.matchAll(/<tr\b[^>]*class=["'][^"']*\bpartido\b[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  let sourceOrder = 0;
  const fixtures = rows.flatMap((row) => {
    const fixture = fixtureFromRow(row, team, "col-marcador", "fecha", "col-lugar");
    return fixture ? [{ ...fixture, sourceOrder: sourceOrder++ }] : [];
  });
  return numberFixtures(fixtures);
}

function parseCalendar(html, team) {
  const rows = [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  let sourceOrder = 0;
  const fixtures = rows.flatMap((row) => {
    if (!row.includes(`id_equipo=${team.id}`) || !/class=["']fecha["']/i.test(row)) return [];
    const fixture = fixtureFromRow(row, team, "marcador", "fecha", "lugar");
    return fixture ? [{ ...fixture, sourceOrder: sourceOrder++ }] : [];
  });
  return numberFixtures(fixtures);
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

function parseTournamentOptions(html) {
  const select = html.match(/<select\b[^>]*\bid=["']torneos["'][^>]*>[\s\S]*?<\/select>/i)?.[0] ?? "";
  const options = [...select.matchAll(/<option\b([^>]*)>/gi)].flatMap((match) => {
    const id = match[1].match(/\bvalue=["'](\d+)["']/i)?.[1];
    return id ? [{ id, selected: /\bselected\b/i.test(match[1]) }] : [];
  });
  return {
    selected: options.find((option) => option.selected)?.id ?? "",
    ids: options.map((option) => option.id),
  };
}

async function fetchTeamCalendar(team) {
  // The federation separates some divisions into several groups. Discover the
  // current groups, then select the calendar that actually contains this club.
  const firstHtml = await fetchHtml(calendarUrlForTeam(team, ""));
  const firstFixtures = parseCalendar(firstHtml, team);
  if (firstFixtures.length) return firstFixtures;

  const { selected, ids } = parseTournamentOptions(firstHtml);
  const candidates = [...new Set([...ids, team.tournament].filter((id) => id && id !== selected))];
  for (const tournament of candidates) {
    const html = await fetchHtml(calendarUrlForTeam(team, tournament));
    const fixtures = parseCalendar(html, team);
    if (fixtures.length) return fixtures;
  }
  return [];
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
    const calendarFixtures = scheduleResult.status === "fulfilled" ? scheduleResult.value : [];
    const scorersHtml = scorersResult.status === "fulfilled" ? scorersResult.value : "";
    const scorers = scorersHtml ? parseTeamScorers(scorersHtml, team) : [];
    return {
      ...team,
      clubLabel: sourceRow?.clubLabel ?? "Amics H.C.",
      categoryLabel: sourceRow?.categoryLabel ?? "",
      players: rosterHtml ? parsePlayers(rosterHtml) : [],
      staff: rosterHtml ? parseStaff(rosterHtml) : [],
      scorers,
      scorersAvailable: hasScorersPage && /tabla_goleadores/i.test(scorersHtml),
      topScorers: parseTopScorers(scorers),
      scorersUrl: hasScorersPage ? statisticsUrlForTeam(team) : "",
      fixtures: rosterHtml ? parseTeamFixtures(rosterHtml, team) : [],
      calendarFixtures,
      rosterAvailable: rosterResult.status === "fulfilled",
      scheduleAvailable: scheduleResult.status === "fulfilled",
    };
  });

  for (const team of teams) {
    if (!team.fixtures.length) team.fixtures = team.calendarFixtures;
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

function parseInstagramPosts(html) {
  const mediaIndex = html.indexOf("graphql_media");
  if (mediaIndex < 0) return [];
  const media = html.slice(mediaIndex, mediaIndex + 50000).replaceAll(String.fromCharCode(92) + '"', '"');
  const shortcodes = [...media.matchAll(/"shortcode":"([A-Za-z0-9_-]+)"/g)].map((match) => match[1]);
  return [...new Set(shortcodes)].slice(0, 3).map((shortcode) => `https://www.instagram.com/p/${shortcode}/`);
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
  const posts = parseInstagramPosts(await response.text());
  if (!posts.length) throw new Error("Instagram did not return any posts");
  cachedInstagramPosts = { posts };
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
        return jsonResponse({ posts: [] }, 502);
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
