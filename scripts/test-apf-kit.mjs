import assert from "node:assert/strict";
import { z } from "zod";
import { apfPreparationSchema, calculateApfFunction, prepareApfCount, validateApfCount } from "../dist/apf-kit.js";

// Independent 3x3 tables from the supplied kit: [AR/TR band][TD band].
const matrix = [["Baixa", "Baixa", "Média"], ["Baixa", "Média", "Alta"], ["Média", "Alta", "Alta"]];
const weights = { ALI: [7, 10, 15], AIE: [5, 7, 10], EE: [3, 4, 6], CE: [3, 4, 6], SE: [4, 5, 7] };
const levels = ["Baixa", "Média", "Alta"];
let boundaryChecks = 0;
for (const tipo of ["ALI", "AIE", "EE", "CE", "SE"]) {
  const data = tipo === "ALI" || tipo === "AIE";
  const input = tipo === "EE";
  const tdBands = data ? [[1, 19], [20, 50], [51, 1_000_000]] : input ? [[1, 4], [5, 15], [16, 1_000_000]] : [[1, 5], [6, 19], [20, 1_000_000]];
  const arBands = data ? [[1], [2, 5], [6, 1_000_000]] : input ? [[0, 1], [2], [3, 1_000_000]] : [[0, 1], [2, 3], [4, 1_000_000]];
  arBands.forEach((ars, arBand) => tdBands.forEach((tds, tdBand) => {
    for (const ar of ars) for (const td of tds) {
      const complexity = matrix[arBand][tdBand];
      assert.deepEqual(calculateApfFunction(tipo, td, ar), { complexidade: complexity, pf_base: weights[tipo][levels.indexOf(complexity)] }, `${tipo} TD=${td} AR/TR=${ar}`);
      boundaryChecks += 1;
    }
  }));
}

const item = (overrides = {}) => ({ nome: "Incluir pessoa", tipo: "EE", atividade: "I", td: 4, ar_tr: 1, justificativa: "Dados de entrada mantêm pessoa.", evidencias: ["Requisito HU-1, seção cadastro."], ...overrides });
const sample = () => ({ aplicacao: "Teste MCP", versao: "KIT-1.1.0", metodologia: "Regra contratual de teste, referência informada pelo responsável", grupos: [{ nome: "Cadastro", funcoes: [item()] }] });
assert.equal(prepareApfCount(sample()).totais.pf_base, 3);
assert.equal(prepareApfCount(sample()).totais.pf_equivalente, null);
assert.equal(prepareApfCount(sample()).grupos[0].funcoes[0].fator_aplicado, null);
const mixed = sample();
mixed.grupos[0].funcoes.push(item({ nome: "Ajuste cosmético", atividade: "MI" }));
mixed.fatores = { I: { modo: "multiplicador", valor: 0.3, fonte: "Convenção de teste I" }, MI: { modo: "fixo", valor: 0.6, fonte: "Regra contratual de teste MI" } };
const result = prepareApfCount(mixed);
assert.deepEqual(result.totais, { funcoes: 2, grupos: 1, pf_base: 6, pf_equivalente: 1.5 });
assert.equal(result.grupos[0].funcoes[0].pf_equivalente, 0.9);
assert.equal(result.grupos[0].funcoes[1].pf_equivalente, 0.6);
assert.deepEqual(result.grupos[0].funcoes[1].fator_aplicado, mixed.fatores.MI);
assert.equal(result.fonte.versao, "1.1.0");
assert.ok(!Number.isNaN(Date.parse(result.preparado_em)));
assert.equal(validateApfCount(mixed, { pf_base: 6, pf_equivalente: 1.5 }).valido, true);
assert.equal(validateApfCount(mixed, { pf_base: 7 }).valido, false);
assert.equal(validateApfCount(sample(), { pf_equivalente: 3 }).valido, false);
assert.equal(validateApfCount(mixed, { pf_base: NaN }).valido, false);
assert.equal(validateApfCount({}).contagem, null);
delete mixed.fatores.I;
assert.equal(prepareApfCount(mixed).totais.pf_equivalente, null, "Missing factors must not be silently treated as zero or one.");

for (const bad of [
  { td: 0 }, { td: -1 }, { td: 1.2 }, { td: Infinity }, { td: 1_000_001 }, { ar_tr: -1 }, { ar_tr: 1.5 }, { tipo: "ALI", ar_tr: 0 }, { tipo: "AIE", ar_tr: 0 },
  { tipo: "SQL" }, { atividade: "DELETE" }, { nome: " " }, { nome: "bad\u0000name" }, { justificativa: "" }, { evidencias: [] }, { evidencias: [" "] }, { evidencias: ["Req1", " req1 "] },
]) {
  const value = sample(); value.grupos[0].funcoes = [item(bad)];
  assert.equal(apfPreparationSchema.safeParse(value).success, false, JSON.stringify(bad));
}
for (const values of [["ALI", 1, 0], ["AIE", 1, 0], ["EE", 0, 0], ["SE", 1, -1], ["CE", NaN, 1], ["INVALID", 1, 1]]) assert.throws(() => calculateApfFunction(...values));
assert.deepEqual(calculateApfFunction("EE", 1, 0), { complexidade: "Baixa", pf_base: 3 });
for (const factor of [
  { modo: "multiplicador", valor: 101, fonte: "Ref" }, { modo: "fixo", valor: -1, fonte: "Ref" }, { modo: "fixo", valor: NaN, fonte: "Ref" }, { modo: "fixo", valor: 1, fonte: "" },
]) {
  const value = sample(); value.fatores = { I: factor }; assert.equal(apfPreparationSchema.safeParse(value).success, false);
}
const zero = sample(); zero.fatores = { I: { modo: "fixo", valor: 0, fonte: "Valor explicitamente aprovado" } };
assert.equal(prepareApfCount(zero).totais.pf_equivalente, 0);
const rounded = sample(); rounded.fatores = { I: { modo: "multiplicador", valor: 1 / 3, fonte: "Regra de teste" } };
assert.equal(prepareApfCount(rounded).totais.pf_equivalente, 1);
const duplicate = sample(); duplicate.grupos[0].funcoes.push(item({ nome: " incluir pessoa " }));
assert.equal(apfPreparationSchema.safeParse(duplicate).success, false);
const duplicateGroup = sample(); duplicateGroup.grupos.push({ nome: " cadastro ", funcoes: [item()] });
assert.equal(apfPreparationSchema.safeParse(duplicateGroup).success, false);
const acrossGroups = sample(); acrossGroups.grupos.push({ nome: "Outro módulo", funcoes: [item()] });
assert.ok(prepareApfCount(acrossGroups).avisos.some((text) => text.includes("dupla contagem")));
const formulaText = sample(); formulaText.grupos[0].funcoes[0].nome = '=HYPERLINK("https://example.invalid","literal")';
assert.equal(prepareApfCount(formulaText).grupos[0].funcoes[0].nome, formulaText.grupos[0].funcoes[0].nome, "Names remain text; workbook writer must use literal string cells.");
const large = sample(); large.grupos[0].funcoes = Array.from({ length: 700 }, (_, n) => item({ nome: `Função ${n}` }));
assert.equal(prepareApfCount(large).totais.funcoes, 700);
large.grupos[0].funcoes.push(item({ nome: "Uma a mais" }));
assert.equal(apfPreparationSchema.safeParse(large).success, false);
const overflow = sample(); overflow.grupos = Array.from({ length: 250 }, (_, n) => ({ nome: `Módulo ${n}`, funcoes: [item(), item({ nome: "Outra" })] }));
assert.equal(apfPreparationSchema.safeParse(overflow).success, false, "Group/separator rows must count toward model capacity.");
const strict = sample(); strict.executar_codigo = "forbidden";
assert.equal(apfPreparationSchema.safeParse(strict).success, false);
const exportedSchema = z.toJSONSchema(apfPreparationSchema, { io: "input" });
assert.equal(exportedSchema.properties.grupos.type, "array", "MCP input JSON schema must preserve the group shape despite early resource guard.");
assert.equal(exportedSchema.properties.grupos.items.properties.funcoes.items.properties.tipo.enum.length, 5);
const oversized = sample();
const neverInspect = { get nome() { throw new Error("Oversized arrays must be refused before child parsing."); } };
oversized.grupos[0].funcoes = Array(100_000).fill(neverInspect);
const oversizedResult = apfPreparationSchema.safeParse(oversized);
assert.equal(oversizedResult.success, false);
assert.ok(oversizedResult.error.issues.length <= 2);
const tooManyEvidence = sample();
tooManyEvidence.grupos[0].funcoes[0].evidencias = Array(100_000).fill(neverInspect);
assert.equal(apfPreparationSchema.safeParse(tooManyEvidence).success, false);
const tooManyFactors = sample();
tooManyFactors.fatores = Object.fromEntries(Array.from({ length: 10_000 }, (_, n) => [`invalid_${n}`, neverInspect]));
const tooManyFactorsResult = apfPreparationSchema.safeParse(tooManyFactors);
assert.equal(tooManyFactorsResult.success, false);
assert.ok(tooManyFactorsResult.error.issues.length <= 2);
const trimmed = sample(); trimmed.aplicacao = "  Teste MCP  ";
assert.equal(prepareApfCount(trimmed).aplicacao, "Teste MCP");
console.log(`Kit APF: ${boundaryChecks} boundary calculations and validation/factor/duplicate/capacity checks passed.`);
