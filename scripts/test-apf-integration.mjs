import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertApfImportTarget, apfImportRows, verifyApfManifest, saveApfArtifacts } from "../dist/apf-artifacts.js";
import { prepareApfCount } from "../dist/apf-kit.js";
import { planGuidedApf } from "../dist/apf-guided.js";
import { readQuickImportWorkbook, createQuickImportSimulation, consumeQuickImportSimulation, quickImportHash } from "../dist/quick-import.js";
import { load } from "cheerio";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const root = await mkdtemp(path.join(tmpdir(), "apf-kit-integration-"));
const previous = { APF_EXPORT_DIR: process.env.APF_EXPORT_DIR, APF_UPLOAD_DIR: process.env.APF_UPLOAD_DIR };
process.env.APF_EXPORT_DIR = path.join(root, "exports");
process.env.APF_UPLOAD_DIR = path.join(root, "imports");
const input = {
  aplicacao: "Projeto teste MCP", versao: "KIT-TESTE", metodologia: "Referência de teste expressamente selecionada",
  grupos: [
    { nome: "Cadastro", funcoes: [{ nome: "Criar cliente", tipo: "EE", atividade: "I", td: 4, ar_tr: 1, justificativa: "Processo elementar de cadastro", evidencias: ["HU-001"] }] },
    { nome: "Dados", funcoes: [{ nome: "Clientes", tipo: "ALI", atividade: "A", td: 20, ar_tr: 2, justificativa: "Arquivo lógico mantido na aplicação", evidencias: ["Modelo de dados"] }] },
  ],
  fatores: { I: { modo: "multiplicador", valor: 1, fonte: "Convenção de teste" }, A: { modo: "multiplicador", valor: 0.5, fonte: "Convenção de teste" } },
};
const conventions = [{ atividade: "I", fator: 1, codigo: "1", nome: "Inclusão" }, { atividade: "A", fator: 0.5, codigo: "2", nome: "Alteração" }];
const target = { application: input.aplicacao, version: input.versao };
const client = new Client({ name: "apf-kit-offline-integration", version: "1.1.0" });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: {
    ...process.env, APF_AUTH_MODE: "chat", APF_BASE_URL: "https://example.invalid",
  } }));
  const listed = (await client.listTools()).tools;
  assert(listed.some((tool) => tool.name === "iniciar_contagem_guiada"));
  assert.match(client.getInstructions(), /iniciar_contagem_guiada/);
  const minimal = await client.callTool({ name: "iniciar_contagem_guiada", arguments: { tela: "Cadastro de clientes" } });
  assert(!minimal.isError, JSON.stringify(minimal));
  assert.equal(minimal.structuredContent.proxima_etapa, "completar_contexto");
  assert.deepEqual(minimal.structuredContent.pendencias.map((item) => item.campo), ["aplicacao", "versao", "escopo", "metodologia", "fontes", "distribuicao"]);
  assert.equal(minimal.structuredContent.distribuicao_completa, false);
  assert.equal(minimal.structuredContent.cadastro_realizado, false);
  assert.equal(minimal.structuredContent.aprovacao_escrita, "external");
  const contextual = await client.callTool({ name: "iniciar_contagem_guiada", arguments: {
    tela: "Cadastro de clientes", aplicacao: input.aplicacao, versao: input.versao, escopo: "Somente inclusão de cliente",
    metodologia: input.metodologia, fontes: ["HU-001 disponível na conversa"],
    distribuicao: [{ usuarios: [{ usuario: "Jessica teste", percentual: 60 }, { usuario: "Bruno teste", percentual: 40 }] }],
  } });
  assert.equal(contextual.structuredContent.pendencias.length, 0);
  assert.equal(contextual.structuredContent.proxima_etapa, "analisar_fontes");
  assert.equal(contextual.structuredContent.distribuicao_completa, true);
  assert.equal(contextual.structuredContent.cadastro_realizado, false, "Contexto completo ainda exige análise e ferramentas de execução");
  const partial = await client.callTool({ name: "iniciar_contagem_guiada", arguments: { tela: "Cadastro", aplicacao: input.aplicacao } });
  assert(!partial.structuredContent.pendencias.some((item) => item.campo === "aplicacao"));
  const missingPercent = await client.callTool({ name: "iniciar_contagem_guiada", arguments: { tela: "Cadastro", distribuicao: [{ usuarios: [{ usuario: "Jessica teste" }] }] } });
  assert(missingPercent.structuredContent.pendencias.some((item) => item.campo === "distribuicao.0.usuarios.0.percentual"));
  assert(!missingPercent.structuredContent.pendencias.some((item) => item.campo === "distribuicao.0.usuarios.0.usuario"));
  const missingUser = planGuidedApf({ tela: "Cadastro", distribuicao: [{ usuarios: [{ percentual: 100 }] }] }, "external");
  assert(missingUser.pendencias.some((item) => item.campo === "distribuicao.0.usuarios.0.usuario"));
  const invalidSum = planGuidedApf({ tela: "Cadastro", distribuicao: [{ usuarios: [{ usuario: "A", percentual: 60 }, { usuario: "B", percentual: 30 }] }] }, "external");
  assert(invalidSum.pendencias.some((item) => item.campo === "distribuicao.0.percentual_total" && item.pergunta.includes("90%")));
  assert.equal(invalidSum.distribuicao_completa, false);
  const duplicated = planGuidedApf({ tela: "Cadastro", distribuicao: [{ usuarios: [{ usuario: "Jéssica", percentual: 50 }, { usuario: "jessica", percentual: 50 }] }] }, "external");
  assert.equal(duplicated.distribuicao_completa, false);
  const byGroup = planGuidedApf({ tela: "Cadastro", distribuicao: [
    { funcoes: ["Cadastro"], usuarios: [{ usuario: "A", percentual: 100 }] },
    { funcoes: ["Consultas"], usuarios: [{ usuario: "B", percentual: 100 }] },
  ] }, "delegated");
  assert.equal(byGroup.distribuicao_completa, true);
  assert.equal(byGroup.aprovacao_associacao, "external", "Substituições continuam exigindo aprovação humana mesmo com delegação");
  const overlaps = planGuidedApf({ tela: "Cadastro", distribuicao: [
    { funcoes: ["Cadastro"], usuarios: [{ usuario: "A", percentual: 100 }] },
    { funcoes: ["cadastro"], usuarios: [{ usuario: "B", percentual: 100 }] },
  ] }, "external");
  assert.equal(overlaps.distribuicao_completa, false);
  const ambiguousScope = planGuidedApf({ tela: "Cadastro", distribuicao: [
    { usuarios: [{ usuario: "A", percentual: 100 }] },
    { funcoes: ["Consultas"], usuarios: [{ usuario: "B", percentual: 100 }] },
  ] }, "external");
  assert(ambiguousScope.pendencias.some((item) => item.campo === "distribuicao.0.funcoes"));
  assert.match(client.getInstructions(), /Antes de cadastrar qualquer registro/);
  assert.match(client.getInstructions(), /simular_associacao_usuarios_funcoes/);
  const prompts = await client.listPrompts();
  assert(prompts.prompts.some((prompt) => prompt.name === "contar_tela_e_cadastrar"));
  const prompt = await client.getPrompt({ name: "contar_tela_e_cadastrar", arguments: { tela: "Cadastro de clientes" } });
  assert.match(prompt.messages[0].content.text, /aba Funções/);
  assert.match(prompt.messages[0].content.text, /aprovação/);
  assert.match(prompt.messages[0].content.text, /Cadastro de clientes/);
  for (const name of ["preparar_contagem_apf", "validar_contagem_apf", "gerar_planilha_apf"]) {
    const tool = listed.find((item) => item.name === name);
    assert(tool, `${name} must be discoverable`);
    assert.equal(tool.inputSchema.properties.contagem.properties.grupos.type, "array");
    assert(tool.inputSchema.properties.contagem.properties.grupos.items.properties.funcoes.items.properties.evidencias.items.type === "string");
  }
  const preparedResult = await client.callTool({ name: "preparar_contagem_apf", arguments: { contagem: input } });
  assert(!preparedResult.isError, JSON.stringify(preparedResult));
  assert.deepEqual(preparedResult.structuredContent.totais, { funcoes: 2, grupos: 2, pf_base: 13, pf_equivalente: 8 });
  const mismatch = await client.callTool({ name: "validar_contagem_apf", arguments: { contagem: input, totais_esperados: { pf_base: 14 } } });
  assert.equal(mismatch.structuredContent.valido, false);
  const rejected = await client.callTool({ name: "gerar_planilha_apf", arguments: { contagem: input, totais_esperados: { pf_equivalente: 9 } } });
  assert.equal(rejected.structuredContent.arquivos_gerados, false);
  const generated = await client.callTool({ name: "gerar_planilha_apf", arguments: { contagem: input, totais_esperados: { pf_base: 13, pf_equivalente: 8 } } });
  assert(!generated.isError, JSON.stringify(generated));
  const bundle = generated.structuredContent;
  assert.equal(bundle.gravado_no_agilepoint, false);
  assert.deepEqual(await readFile(bundle.exportacao.planilha), await readFile(bundle.importacao.caminho_planilha));
  const preview = await readQuickImportWorkbook(bundle.importacao.caminho_planilha);
  assert.equal(preview.kit_apf.pf_base, 13);
  assert.equal(preview.kit_apf.pf_equivalente, 8);
  assert.equal(preview.linhas.filter((row) => row.tipo).length, 2);
  assertApfImportTarget(preview.kit_apf, target, conventions);
  assert.throws(() => assertApfImportTarget(preview.kit_apf, { ...target, version: "outra" }, conventions), /aplicação\/versão/);
  assert.throws(() => assertApfImportTarget(preview.kit_apf, target, [{ ...conventions[0], fator: 0.5 }, conventions[1]]), /diverge/);
  const missing = structuredClone(preview.kit_apf); missing.pf_equivalente = null;
  assert.throws(() => assertApfImportTarget(missing, target, conventions), /pendente/);
  const fixed = structuredClone(preview.kit_apf); fixed.fatores.I.modo = "fixo";
  assert.throws(() => assertApfImportTarget(fixed, target, conventions), /Valores fixos/);
  const controlFile = bundle.importacao.conferencia;
  const control = JSON.parse(await readFile(controlFile, "utf8"));
  const prepared = prepareApfCount(input);
  assert.throws(() => verifyApfManifest(control, "0".repeat(64), apfImportRows(prepared), "hash"), /diverge/);
  const changedRows = apfImportRows(prepared); changedRows[1].descricao = "Outra função";
  assert.throws(() => verifyApfManifest(control, bundle.sha256, changedRows, "hash"), /C:K/);
  const simulation = createQuickImportSimulation("123", bundle.importacao.caminho_planilha, preview);
  assert.equal(consumeQuickImportSimulation(simulation.confirmacao_token).kit_apf.manifesto_sha256, bundle.manifesto_sha256);
  const changedSimulation = structuredClone(simulation.simulacao); changedSimulation.kit_apf.fatores.A.valor = 1;
  assert.notEqual(quickImportHash(simulation.simulacao), quickImportHash(changedSimulation));
  await rename(controlFile, `${controlFile}.temporary`);
  await assert.rejects(() => readQuickImportWorkbook(bundle.importacao.caminho_planilha), /está ausente/);
  // A genuine external C:K spreadsheet remains compatible without a kit control file.
  const legacyZip = unzipSync(await readFile(bundle.importacao.caminho_planilha));
  const $ = load(strFromU8(legacyZip["xl/worksheets/sheet2.xml"]), { xml: true });
  $('c[r="B4"] t').text("Planilha externa de teste");
  legacyZip["xl/worksheets/sheet2.xml"] = strToU8($.xml());
  const legacyPath = path.join(process.env.APF_UPLOAD_DIR, "legacy.xlsx");
  await writeFile(legacyPath, zipSync(legacyZip));
  assert.equal((await readQuickImportWorkbook(legacyPath)).kit_apf, undefined);
  await rename(`${controlFile}.temporary`, controlFile);
  control.planilha_sha256 = "0".repeat(64);
  await writeFile(controlFile, JSON.stringify(control));
  await assert.rejects(() => readQuickImportWorkbook(bundle.importacao.caminho_planilha), /diverge/);
  // No caller-controlled names become paths; simultaneous generations get separate bundles.
  const concurrent = await Promise.all([saveApfArtifacts(prepared), saveApfArtifacts(prepared)]);
  assert.notEqual(concurrent[0].artefato_id, concurrent[1].artefato_id);
  assert.equal(createHash("sha256").update(await readFile(concurrent[0].exportacao.planilha)).digest("hex"), concurrent[0].sha256);
  const tooLarge = structuredClone(input);
  tooLarge.grupos = [{ nome: "Grande", funcoes: Array.from({ length: 700 }, (_, i) => ({ ...input.grupos[0].funcoes[0], nome: `Função ${i}`, justificativa: "J".repeat(6000), evidencias: Array.from({ length: 30 }, (_, e) => `${e}:`.padEnd(1000, "E")) })) }];
  await assert.rejects(() => saveApfArtifacts(prepareApfCount(tooLarge)), /8 MiB/);
  console.log("APF integration: STDIO discovery/schema, calculation, local generation, quick-import roundtrip, controls/target/factors, tamper/missing rejection, legacy input, concurrency and size limits passed; no remote writes.");
} finally {
  await client.close().catch(() => {});
  for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("apf-kit-integration-")) throw new Error("Unsafe test cleanup path");
  await rm(resolved, { recursive: true, force: true });
}
