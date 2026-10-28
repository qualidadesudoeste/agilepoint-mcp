import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { readSheet } from "read-excel-file/node";
import { load } from "cheerio";
import { strFromU8, unzipSync } from "fflate";
import { prepareApfCount } from "../dist/apf-kit.js";
import { generateApfWorkbook } from "../dist/apf-workbook.js";
import { parseQuickImportRows } from "../dist/quick-import.js";

const input = {
  aplicacao: "Teste & MCP [1]",
  versao: "1.1.0",
  metodologia: "Contrato de teste — fatores expressos",
  grupos: [{ nome: "Cadastro <pessoa>", funcoes: [
    { nome: '=HYPERLINK("https://example.invalid","literal") [1]', tipo: "EE", atividade: "I", td: 4, ar_tr: 1, justificativa: "Um processo elementar de entrada.", evidencias: ["Requisito R1 [1]", "src/cadastro.ts:1"] },
    { nome: "Consulta", tipo: "CE", atividade: "MI", td: 20, ar_tr: 4, justificativa: "Processo com arquivos referenciados.", evidencias: ["R2"] },
    { nome: "Arquivo", tipo: "ALI", atividade: "A", td: 51, ar_tr: 6, justificativa: "Grupo lógico de dados.", evidencias: ["R3"] },
  ] }],
  fatores: { I: { modo: "multiplicador", valor: 1, fonte: "Convenção teste" }, MI: { modo: "fixo", valor: 0.6, fonte: "Convenção teste" } },
};
const prepared = prepareApfCount(input);
const buffer = await generateApfWorkbook(prepared);
assert(buffer.length > 1_000);
const functions = await readSheet(buffer, "Funções");
const parsed = parseQuickImportRows(functions, "preparacao.xlsx", "test");
assert.equal(parsed.cabecalho_linha, 11);
assert.equal(parsed.linhas.filter((row) => row.tipo).length, 3);
assert.equal(parsed.linhas[0].descricao, input.grupos[0].nome);
assert.deepEqual(parsed.linhas.filter((row) => row.tipo).map(({ descricao, tipo, atividade, td, ar_tr }) => ({ descricao, tipo, atividade, td, ar_tr })), input.grupos[0].funcoes.map((item) => ({ descricao: item.nome, tipo: item.tipo, atividade: item.atividade, td: String(item.td), ar_tr: String(item.ar_tr) })));
assert.equal(functions[12][14], 3);
assert.equal(functions[12][15], 3);
assert.equal(functions[13][14], 6);
assert.equal(functions[13][15], 0.6);
assert.equal(functions[14][14], 15);
assert.equal(functions[14][15] ?? "", "");
assert.match(functions[12][17], /Requisito R1 \[1\]/);
const summary = await readSheet(buffer, "Sumário");
assert.equal(summary[4][1], 3);
assert.equal(summary[5][1], 24);
assert.equal(summary[6][1], "Pendente");
const metadata = await readSheet(buffer, "Contagem");
assert.equal(metadata[1][1], input.aplicacao);
assert.equal(metadata[3][1], input.metodologia);
assert.equal(metadata[9][2], 1);
const evidence = await readSheet(buffer, "Evidências");
assert.equal(evidence[1][1], input.grupos[0].funcoes[0].nome);
assert.match(evidence.find((row) => row[1] === "Consulta")[6], /fixo 0.6/);
const zip = unzipSync(buffer);
assert(!Object.keys(zip).some((name) => /external|macro|vba|comments|media|drawing|docProps|calcChain/i.test(name)));
for (const [name, content] of Object.entries(zip)) {
  if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
  const document = load(strFromU8(content), { xml: true });
  assert.equal(document('Relationship[TargetMode="External"]').length, 0);
  document("f").each((_, node) => assert(!document(node).text().includes("["), "External formula reference must not survive"));
}
const fsheet = load(strFromU8(zip["xl/worksheets/sheet2.xml"]), { xml: true });
assert.equal(fsheet('c[r="C13"]').attr("t"), "inlineStr");
assert.equal(fsheet('c[r="C13"] f').length, 0);
assert.equal(fsheet('c[r="C13"] t').text(), input.grupos[0].funcoes[0].nome);
assert.equal(fsheet('c[r="T7"] v').length, 0, "No original default pricing should remain");
assert.equal(fsheet('c[r="P13"] f').length, 1);
assert.equal(fsheet('c[r="P15"] f').length, 1, "Missing factors remain explicit and recalculable");
for (const column of ["M", "N", "O"]) {
  const expression = fsheet(`c[r="${column}13"] f`).text();
  assert(!/[!\[\]]/.test(expression), "Complexity/PF expressions depend only on the current function row and embedded constants");
}
assert.equal(fsheet('c[r="L13"] f').text(), "H13&M13");

const complete = prepareApfCount({ ...input, fatores: { ...input.fatores, A: { modo: "multiplicador", valor: 0.5, fonte: "Contrato teste" } } });
const completeSummary = await readSheet(await generateApfWorkbook(complete), "Sumário");
assert.equal(completeSummary[6][1], 11.1);
if (process.argv[2]) await writeFile(process.argv[2], await generateApfWorkbook(complete), { flag: "wx" });

const long = structuredClone(input);
long.grupos[0].funcoes[0].justificativa = "J".repeat(6_000);
long.grupos[0].funcoes[0].evidencias = Array.from({ length: 30 }, (_, i) => `${i}:`.padEnd(1_000, "E"));
const longBuffer = await generateApfWorkbook(prepareApfCount(long));
const longFunctions = await readSheet(longBuffer, "Funções");
assert(longFunctions[12][17].length < 32_767);
assert.match(longFunctions[12][17], /Texto completo na aba Evidências/);
const longEvidence = await readSheet(longBuffer, "Evidências");
const continuedEvidence = longEvidence.filter((row) => row[1] === input.grupos[0].funcoes[0].nome);
assert.equal(continuedEvidence.map((row) => row[4] ?? "").join(""), long.grupos[0].funcoes[0].justificativa);
assert.deepEqual(continuedEvidence.map((row) => row[5]), long.grupos[0].funcoes[0].evidencias);
const longZip = unzipSync(longBuffer);
const longStyle = load(strFromU8(longZip["xl/styles.xml"]), { xml: true });
assert.equal(longStyle("cellXfs > xf").eq(169).find("alignment").attr("wrapText"), "1");
const evidenceSheet = load(strFromU8(longZip["xl/worksheets/sheet4.xml"]), { xml: true });
assert(Number(evidenceSheet('row[r="2"]').attr("ht")) >= 300);
console.log("APF workbook: template, import C:K, PF caches, factors, literal strings, evidence, summaries and closed package parts passed.");
