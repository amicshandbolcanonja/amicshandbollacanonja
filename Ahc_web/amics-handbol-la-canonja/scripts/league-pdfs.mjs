import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE = [595.28, 841.89];
const MARGIN = 36;
const INK = rgb(.098, .094, .212);
const BLUE = rgb(.204, .224, .718);
const MUTED = rgb(.37, .37, .45);
const PALE = rgb(.96, .95, .99);

export function roundProgress(round) {
  const played = round.fixtures.filter((fixture) => fixture.state === "played" && fixture.homeScore !== "" && fixture.homeScore != null && fixture.awayScore !== "" && fixture.awayScore != null).length;
  return { total: round.fixtures.length, played, pending: round.fixtures.length - played, complete: round.fixtures.length > 0 && played === round.fixtures.length };
}

export async function createLeagueRoundPdf(data, team, round, language = "es") {
  const ca = language === "ca";
  const labels = ca ? {
    all: "Tots els clubs de la lliga", finished: "finalitzats", pending: "pendents", complete: "JORNADA COMPLETA", partial: "JORNADA AMB PARTITS PENDENTS",
    date: "DATA / HORA", clubs: "LOCAL / VISITANT", result: "RESULTAT", played: "Finalitzat", waiting: "Pendent", postponed: "Ajornat", bye: "Descansa", noDate: "Data pendent", noTime: "Hora pendent", noVenue: "Pista per confirmar", updated: "Actualitzat",
    source: "Font: Federació Catalana d'Handbol / iSquad", copy: "Els nous resultats s'incorporen a la web. Torna a descarregar el PDF per obtenir la darrera versió.", page: "Pàgina",
  } : {
    all: "Todos los clubes de la liga", finished: "finalizados", pending: "pendientes", complete: "JORNADA COMPLETA", partial: "JORNADA CON PARTIDOS PENDIENTES",
    date: "FECHA / HORA", clubs: "LOCAL / VISITANTE", result: "RESULTADO", played: "Finalizado", waiting: "Pendiente", postponed: "Aplazado", bye: "Descansa", noDate: "Fecha pendiente", noTime: "Hora pendiente", noVenue: "Pista por confirmar", updated: "Actualizado",
    source: "Fuente: Federació Catalana d'Handbol / iSquad", copy: "Los nuevos resultados se incorporan a la web. Vuelve a descargar el PDF para obtener la última versión.", page: "Página",
  };
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  const clean = (value) => [...String(value ?? "").normalize("NFC").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim()].map((character) => supported.has(character.codePointAt(0)) ? character : "-").join("");
  const wrap = (value, font, size, width) => {
    const lines = [];
    let line = "";
    for (const word of clean(value).split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const title = `Jornada ${String(round.number).padStart(2, "0")}`;
  const category = ca ? team.nameCa : team.nameEs;
  const competition = ca ? team.competitionCa : team.competitionEs;
  const updated = new Intl.DateTimeFormat(ca ? "ca-ES" : "es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(data.generatedAt));
  const scheduled = round.date ? new Intl.DateTimeFormat(ca ? "ca-ES" : "es-ES", { dateStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(`${round.date}T12:00:00Z`)) : "";
  const progress = roundProgress(round);
  pdf.setTitle(`${competition} - ${category} - ${title}`);
  pdf.setAuthor(data.club);
  pdf.setSubject(`${labels.all}. ${team.league.sourceUrl}`);
  pdf.setLanguage(ca ? "ca-ES" : "es-ES");
  pdf.setCreationDate(new Date(data.generatedAt));
  pdf.setModificationDate(new Date(data.generatedAt));
  let page;
  let y;
  const text = (value, x, baseline, size = 10, font = regular, color = INK) => page.drawText(clean(value), { x, y: baseline, size, font, color });
  const newPage = () => {
    page = pdf.addPage(PAGE);
    text(data.club.toUpperCase(), MARGIN, 799, 8, bold, BLUE);
    text(data.season, 515, 799, 8, bold, MUTED);
    text(title, MARGIN, 762, 28, bold);
    text(labels.all, 230, 766, 11, regular, MUTED);
    let headerY = 737;
    for (const line of wrap(`${category} / ${competition}`, bold, 11, 520)) { text(line, MARGIN, headerY, 11, bold); headerY -= 15; }
    if (team.league.label) for (const line of wrap(team.league.label, regular, 9, 520)) { text(line, MARGIN, headerY, 9, regular, MUTED); headerY -= 12; }
    text(`${labels.updated}: ${updated} (Europe/Madrid)${scheduled ? ` / ${ca ? "Data de jornada" : "Fecha de jornada"}: ${scheduled}` : ""}`, MARGIN, headerY - 5, 8.5, regular, MUTED);
    const bandY = headerY - 52;
    page.drawRectangle({ x: MARGIN, y: bandY, width: PAGE[0] - MARGIN * 2, height: 31, color: PALE });
    text(`${progress.played}/${progress.total} ${labels.finished}   /   ${progress.pending} ${labels.pending}`, MARGIN + 10, bandY + 11, 10, bold, BLUE);
    const status = progress.complete ? labels.complete : labels.partial;
    text(status, PAGE[0] - MARGIN - 10 - bold.widthOfTextAtSize(clean(status), 7), bandY + 12, 7, bold, MUTED);
    y = bandY - 25;
    text(labels.date, MARGIN + 9, y, 7.5, bold, MUTED);
    text(labels.clubs, 131, y, 7.5, bold, MUTED);
    text(labels.result, 480, y, 7.5, bold, MUTED);
    y -= 14;
  };
  newPage();
  const fixtures = [...round.fixtures].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "99:99").padStart(5, "0").localeCompare((b.time || "99:99").padStart(5, "0")) || a.homeName.localeCompare(b.homeName));
  fixtures.forEach((fixture, index) => {
    const home = wrap(fixture.homeName, bold, 9.5, 326);
    const away = wrap(fixture.awayName, regular, 9.5, 326);
    const venue = wrap(fixture.venue || labels.noVenue, regular, 8, 326);
    const height = Math.max(64, (home.length + away.length) * 12 + venue.length * 10 + 20);
    if (y - height < 80) newPage();
    if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - height, width: PAGE[0] - MARGIN * 2, height, color: PALE });
    let rowY = y - 17;
    const date = fixture.date ? new Intl.DateTimeFormat(ca ? "ca-ES" : "es-ES", { day: "2-digit", month: "short", timeZone: "Europe/Madrid" }).format(new Date(`${fixture.date}T12:00:00Z`)) : labels.noDate;
    text(date, MARGIN + 9, rowY, 8.5, bold);
    text(fixture.time ? `${fixture.time} h` : labels.noTime, MARGIN + 9, rowY - 15, 8, regular, MUTED);
    for (const line of home) { text(line, 131, rowY, 9.5, bold); rowY -= 12; }
    for (const line of away) { text(line, 131, rowY, 9.5); rowY -= 12; }
    rowY -= 4;
    for (const line of venue) { text(line, 131, rowY, 8, regular, MUTED); rowY -= 10; }
    const finished = roundProgress({ fixtures: [fixture] }).complete;
    const result = finished ? `${fixture.homeScore} - ${fixture.awayScore}` : '-';
    const status = finished ? labels.played : fixture.state === "suspended" ? labels.postponed : labels.waiting;
    const centerX = 512;
    text(result, centerX - bold.widthOfTextAtSize(clean(result), 14) / 2, y - 28, 14, bold, BLUE);
    text(status, centerX - regular.widthOfTextAtSize(clean(status), 8) / 2, y - 43, 8, regular, MUTED);
    y -= height + 2;
  });
  if (round.byes?.length) {
    const lines = wrap(`${labels.bye}: ${round.byes.join(" / ")}`, regular, 9, 520);
    if (y - lines.length * 13 < 90) newPage();
    for (const line of lines) { y -= 13; text(line, MARGIN, y, 9, regular, MUTED); }
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    page = item;
    page.drawLine({ start: { x: MARGIN, y: 68 }, end: { x: PAGE[0] - MARGIN, y: 68 }, thickness: .5, color: rgb(.82, .82, .86) });
    text(`${labels.source} / ${team.league.tournamentId}`, MARGIN, 54, 7, regular, MUTED);
    text(`${labels.page} ${index + 1}/${pages.length}`, 507, 54, 7, regular, MUTED);
    wrap(labels.copy, regular, 7.2, 520).forEach((line, lineIndex) => text(line, MARGIN, 40 - lineIndex * 9, 7.2, regular, MUTED));
  });
  return pdf.save();
}

export async function generateLeaguePdfs(data, distRoot) {
  let count = 0;
  for (const team of data.teams) {
    if (!team.league?.rounds?.length) continue;
    const folder = resolve(distRoot, "pdfs", team.key);
    await mkdir(folder, { recursive: true });
    for (const round of team.league.rounds) {
      round.progress = roundProgress(round);
      round.pdfUrls = {};
      for (const language of ["ca", "es"]) {
        const filename = `jornada-${String(round.number).padStart(2, "0")}-${language}.pdf`;
        const bytes = await createLeagueRoundPdf(data, team, round, language);
        await writeFile(resolve(folder, filename), bytes);
        round.pdfUrls[language] = `./pdfs/${team.key}/${filename}`;
        count++;
      }
    }
  }
  console.log(`Generated ${count} league round PDFs (Catalan and Spanish)`);
}
