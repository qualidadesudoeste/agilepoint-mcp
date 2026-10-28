import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [runtimeSource, testDirectory, destination] = process.argv.slice(2).map((value) => path.resolve(value));
if (!runtimeSource || !testDirectory || !destination) throw new Error("Informe pacote extraído, pasta isolada de testes e destino.");
const { install } = await import(pathToFileURL(path.join(runtimeSource, "instalar.mjs")).href);
const runtimeManifest = JSON.parse(await fs.readFile(path.join(runtimeSource, "package.json"), "utf8"));
await fs.mkdir(testDirectory, { recursive: true });
let generated;
for (const client of ["claude-desktop", "claude-code", "cursor", "vscode", "codex"]) {
  const file = path.join(testDirectory, client === "codex" ? "codex.toml" : `${client}.json`);
  const original = client === "codex" ? '# preserve comment\nmodel = "keep"\n[mcp_servers . agilepoint]\ncommand = "keep"\n'
    : JSON.stringify({ setting: "keep", mcpServers: { other: { command: "keep" } } });
  await fs.writeFile(file, original, { flag: "wx" });
  const options = { source: runtimeSource, destination, dataDirectory: path.join(testDirectory, "dados", client), configFile: file, client };
  const result = await install(options);
  assert.equal(result.registrado_no_cliente, true);
  assert.equal(result.credenciais_configuradas, false);
  assert.equal(result.node_executavel, process.execPath);
  const first = await fs.readFile(file, "utf8");
  await install(options);
  assert.equal(await fs.readFile(file, "utf8"), first, "a reinstalação não deve duplicar nem alterar configurações externas");
  if (client === "codex") {
    assert.ok(first.startsWith(original));
    assert.equal(result.servidor, "agilepoint_apf");
  } else {
    const config = JSON.parse(first);
    assert.equal(config.setting, "keep");
    assert.deepEqual(config.mcpServers.other, { command: "keep" });
    const entry = config.mcpServers[result.servidor];
    assert.equal(entry.env.APF_AUTH_MODE, "chat");
    assert.equal("APF_USERNAME" in entry.env || "APF_PASSWORD" in entry.env, false);
    generated = entry;
  }
  console.log(JSON.stringify({ cliente: client, registro: "ok", preservacao: "ok", reinstalacao: "ok" }));
}

const client = new Client({ name: "agilepoint-installation-check", version: runtimeManifest.version });
try {
  await client.connect(new StdioClientTransport({ command: generated.command, args: generated.args,
    env: { ...process.env, APF_USERNAME: "synthetic-user", APF_PASSWORD: "synthetic-secret", ...generated.env } }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "autenticar_agilepoint"));
  const status = await client.callTool({ name: "verificar_conexao", arguments: {} });
  assert.equal(status.structuredContent?.autenticado, false, "a instalação deve aguardar as credenciais no chat");
  assert.equal(status.structuredContent?.versao_extrator, runtimeManifest.version);
  for (const name of ["iniciar_contagem_guiada", "preparar_contagem_apf", "validar_contagem_apf", "gerar_planilha_apf"]) {
    assert.ok(tools.tools.some((tool) => tool.name === name), `ferramenta do kit ausente: ${name}`);
  }
  await fs.access(path.join(destination, "assets", "apf", "FPA-MODELO.xlsx"));
  await fs.access(path.join(destination, "KIT_APF.md"));
  await fs.access(path.join(destination, "DICA_DE_MESTRE.md"));
  for (const name of ["consultar_minhas_dicas_mestre", "simular_publicacao_dica_mestre", "cancelar_publicacao_dica_mestre", "publicar_dica_mestre"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `ferramenta Dica de Mestre ausente: ${name}`);
  }
  const installedPolicy = JSON.parse(await fs.readFile(path.join(destination, "capabilities.json"), "utf8"));
  assert.ok(installedPolicy.roles.desenvolvedor.some(rule => rule.formIds.includes("500000385") && rule.capabilities.includes("publicar_dica_mestre")));
  const guided = await client.callTool({ name: "iniciar_contagem_guiada", arguments: { tela: "Tela de teste" } });
  assert.equal(guided.structuredContent.proxima_etapa, "completar_contexto");
  assert.equal(guided.structuredContent.cadastro_realizado, false);
  assert.equal(guided.structuredContent.distribuicao_completa, false);
  assert.ok(guided.structuredContent.pendencias.some((item) => item.campo === "distribuicao"));
  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((item) => item.name === "contar_tela_e_cadastrar"));
  const kitInput = {
    aplicacao: "Teste local do pacote", versao: "KIT-1.1", metodologia: "Referência exclusiva de teste local",
    grupos: [{ nome: "Cadastro", funcoes: [{ nome: "Incluir", tipo: "EE", atividade: "I", td: 4, ar_tr: 1,
      justificativa: "Processo de entrada de teste", evidencias: ["Requisito de teste"] }] }],
    fatores: { I: { modo: "multiplicador", valor: 1, fonte: "Convenção de teste" } },
  };
  const artifact = await client.callTool({ name: "gerar_planilha_apf", arguments: { contagem: kitInput, totais_esperados: { pf_base: 3, pf_equivalente: 3 } } });
  assert.equal(Boolean(artifact.isError), false, JSON.stringify(artifact));
  assert.equal(artifact.structuredContent.gravado_no_agilepoint, false);
  const { readQuickImportWorkbook } = await import(pathToFileURL(path.join(destination, "dist", "quick-import.js")).href);
  const priorUpload = process.env.APF_UPLOAD_DIR;
  process.env.APF_UPLOAD_DIR = generated.env.APF_UPLOAD_DIR;
  try {
    const preview = await readQuickImportWorkbook(artifact.structuredContent.importacao.caminho_planilha);
    assert.equal(preview.kit_apf.pf_base, 3);
    assert.equal(preview.kit_apf.pf_equivalente, 3);
  } finally {
    if (priorUpload === undefined) delete process.env.APF_UPLOAD_DIR; else process.env.APF_UPLOAD_DIR = priorUpload;
  }
  console.log(JSON.stringify({ kit_apf_instalado: "geração e importação local conferidas", gravado_no_agilepoint: false }));
  console.log(JSON.stringify({ mcp: "ok", versao: runtimeManifest.version, aguardando_credenciais: true, kit_apf: "ok" }));
} finally { await client.close().catch(() => {}); }
