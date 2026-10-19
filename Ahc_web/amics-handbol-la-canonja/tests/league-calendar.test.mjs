import assert from "node:assert/strict";
import test from "node:test";
import { parseLeagueCalendar } from "../worker/index.js";
import { createLeagueRoundPdf, roundProgress } from "../scripts/league-pdfs.mjs";
import { PDFDocument } from "pdf-lib";

const heading = (number, date = "18-10-2026") => `<tr class="second-table-info"><td><i-t>JORNADA</i-t> ${number} (${date})</td></tr>`;
const row = (home, away, score = " - ", date = "18/10/2026", state = "") => `<tr data-estado="${state}"><td><div class="nombres-equipos"><a href="equipo.php?id_equipo=${home}">CLUB ${home}</a> - <a href="equipo.php?id_equipo=${away}">CLUB ${away}</a></div></td><td class="marcador"><span>${score}</span></td><td class="fecha"><div>${date}</div><div>18:30</div></td><td class="lugar">Pavelló municipal</td></tr>`;

test("keeps every club and the official round when a match is postponed", () => {
  const rounds = parseLeagueCalendar(heading(2, "04-10-2026") + row("1", "2", "", "25/10/2026") + row("3", "4", "31 - 29") + heading(3) + row("1", "3", "25 - 24") + row("2", "4"));
  assert.deepEqual(rounds.map((round) => round.number), [2, 3]);
  assert.equal(rounds[0].fixtures.length, 2);
  assert.equal(rounds[0].fixtures[0].round, 2);
  assert.equal(rounds[0].fixtures[0].date, "2026-10-25");
  assert.equal(rounds[0].date, "2026-10-04");
  assert.deepEqual(roundProgress(rounds[0]), { total: 2, played: 1, pending: 1, complete: false });
});

test("detects byes omitted by iSquad in a complete odd-sized group", () => {
  const rounds = parseLeagueCalendar(heading(1) + row("1", "2") + row("3", "4") + heading(2) + row("5", "1") + row("2", "3"));
  assert.deepEqual(rounds[0].byes, ["CLUB 5"]);
  assert.deepEqual(rounds[1].byes, ["CLUB 4"]);
});

test("explicit byes need no date cell and duplicate match rows are ignored", () => {
  const bye = '<tr><td><div class="nombres-equipos"><a href="equipo.php?id_equipo=5">CLUB 5</a> - DESCANSA</div></td></tr>';
  const rounds = parseLeagueCalendar(heading(1) + row("1", "2") + row("1", "2") + bye);
  assert.equal(rounds[0].fixtures.length, 1);
  assert.deepEqual(rounds[0].byes, ["CLUB 5"]);
});

test("a round becomes complete only after every result has been published", () => {
  const round = parseLeagueCalendar(heading(4) + row("1", "2", "30 - 29") + row("3", "4", "", "", "Aplazado"))[0];
  assert.equal(round.fixtures[1].state, "suspended");
  assert.equal(round.fixtures[1].date, "");
  assert.equal(roundProgress(round).complete, false);
  round.fixtures[1] = { ...round.fixtures[1], state: "played", homeScore: "0", awayScore: "0" };
  assert.deepEqual(roundProgress(round), { total: 2, played: 2, pending: 0, complete: true });
});

test("an unconfirmed 0-0 is pending, while an explicit final 0-0 is complete", () => {
  const round = parseLeagueCalendar(heading(4) + row("1", "2", "0 - 0") + row("3", "4", "0 - 0", "18/10/2026", "Finalizado"))[0];
  assert.equal(round.fixtures[0].state, "pending");
  assert.equal(round.fixtures[1].state, "played");
  assert.equal(roundProgress(round).played, 1);
});

test("PDF generation paginates long names and records the publication time", async () => {
  const fixtures = Array.from({ length: 24 }, (_, index) => ({ homeName: `CLUB HANDBOL SANT JOAN DESPÍ ${index} / nom molt llarg per comprovar la paginació`, awayName: "AMICS H.C. / C.E. TORTOSA - CHMLN - SERVEIS LEGALS ENA SCCL", venue: "Pavelló Municipal de Sant Salvador Tarragona, carrer Stadium 12", date: "2026-10-18", time: "18:30", state: index % 2 ? "pending" : "played", homeScore: index % 2 ? "" : "31", awayScore: index % 2 ? "" : "30" }));
  const data = { club: "Amics Handbol La Canonja", season: "2026/27", generatedAt: "2026-10-19T10:15:00Z" };
  const team = { nameCa: "Sènior masculí", nameEs: "Sénior masculino", competitionCa: "Segona Catalana", competitionEs: "Segunda Catalana", league: { tournamentId: "123", label: "PRIMERA FASE - Grup B", sourceUrl: "https://resultadosbalonmano.isquad.es/calendario.php?id=123" } };
  for (const language of ["ca", "es"]) {
    const bytes = await createLeagueRoundPdf(data, team, { number: 4, fixtures, byes: ["CLUB 25"] }, language);
    assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    assert.ok(pdf.getPageCount() >= 3);
    assert.equal(pdf.getModificationDate().toISOString(), data.generatedAt.replace("Z", ".000Z"));
    assert.match(pdf.getTitle(), /Jornada 04/);
  }
});
