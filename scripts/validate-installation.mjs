import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [runtimeSource, testDirectory, destination] = process.argv.slice(2).map((value) => path.resolve(value));
if (!runtimeSource || !testDirectory || !destination) throw new Error("Informe pacote extraído, pasta isolada de testes e destino.");
const { install, runtimeConfiguration } = await import(pathToFileURL(path.join(runtimeSource, "instalar.mjs")).href);
const runtimeManifest = JSON.parse(await fs.readFile(path.join(runtimeSource, "package.json"), "utf8"));
await fs.mkdir(testDirectory, { recursive: true });
let generated;
for (const client of ["claude-desktop", "claude-code", "cursor", "vscode", "codex"]) {
  const file = path.join(testDirectory, client === "codex" ? "codex.toml" : `${client}.json`);
  const original = client === "codex" ? '# preserve comment\nmodel = "keep"\n[mcp_servers . agilepoint]\ncommand = "keep"\n'
    : JSON.stringify({ setting: "keep", mcpServers: { other: { command: "keep" } } });
  const legacyRoot = path.join(testDirectory, "legacy", client, "AgilePointMCP", "1.0.0");
  await fs.mkdir(path.join(legacyRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, "package.json"), JSON.stringify({ name: "agilepoint-apf-mcp", version: "1.0.0" }));
  await fs.writeFile(path.join(legacyRoot, "dist", "index.js"), "new McpServer({ name: 'agilepoint-apf', version: '1.0.0' });");
  await fs.copyFile(path.join(runtimeSource, "capabilities.json"), path.join(legacyRoot, "capabilities.json"));
  const legacy = runtimeConfiguration(legacyRoot, path.join(testDirectory, "dados", client));
  Object.assign(legacy.env, { APF_USERNAME: "synthetic-login", APF_PASSWORD: "synthetic-secret", APF_MCP_ROLE: "leitura", APF_COLLABORATOR_ID: "123", APF_WRITE_APPROVAL_MODE: "external" });
  const legacyText = client === "codex" ? original + '[mcp_servers.agilepoint_apf]\ncommand = ' + JSON.stringify(legacy.command) + '\nargs = ' + JSON.stringify(legacy.args) + '\n[mcp_servers.agilepoint_apf.env]\n' + Object.entries(legacy.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join("\n") + "\n"
    : JSON.stringify({ ...JSON.parse(original), mcpServers: { ...JSON.parse(original).mcpServers, agilepoint: legacy } });
  await fs.writeFile(file, legacyText, { flag: "wx" });
  const options = { source: runtimeSource, destination, dataDirectory: path.join(testDirectory, "dados", client), configFile: file, client };
  const result = await install(options);
  assert.equal(result.registrado_no_cliente, true);
  assert.equal(result.credenciais_configuradas, false);
  assert.equal(result.atualizacao.conexoes_substituidas.length, 1);
  assert.equal(result.atualizacao.conexoes_substituidas[0].versao_anterior, "1.0.0");
  assert.equal(result.atualizacao.credenciais_legadas_removidas_da_conexao, true);
  assert.match(result.proximo_passo, /solicite somente Usuário e Senha/);
  assert.match(result.proximo_passo, /O que você deseja fazer no AgilePoint/);
  assert.equal(result.node_executavel, process.execPath);
  const first = await fs.readFile(file, "utf8");
  assert.equal(first.includes("synthetic-secret"), false);
  assert.equal(first.includes("APF_MCP_ROLE"), false);
  assert.equal(first.includes("APF_COLLABORATOR_ID"), false);
  await fs.access(path.join(legacyRoot, "package.json"));
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
    assert.equal(entry.env.APF_WRITE_APPROVAL_MODE, "automatic");
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
  assert.ok(tools.tools.some(tool => tool.name === "diagnosticar_configuracao"));
  const diagnostic = await client.callTool({ name: "diagnosticar_configuracao", arguments: {} });
  assert.equal(diagnostic.structuredContent.versao_em_execucao, runtimeManifest.version);
  assert.equal(diagnostic.structuredContent.versao_instalada_esperada, runtimeManifest.version);
  assert.equal(diagnostic.structuredContent.reconexao_necessaria, false);
  assert.ok(tools.tools.some((tool) => tool.name === "autenticar_agilepoint"));
  const authentication = tools.tools.find(tool => tool.name === "autenticar_agilepoint");
  assert.deepEqual([...authentication.inputSchema.required].sort(), ["senha", "usuario"], "a autenticação deve exigir somente as credenciais");
  assert.equal(authentication.inputSchema.properties.projeto, undefined);
  assert.equal(authentication.inputSchema.properties.sprint, undefined);
  assert.ok(authentication.inputSchema.properties.objetivo, "tarefa já informada pode ser reaproveitada sem ser obrigatória");
  const status = await client.callTool({ name: "verificar_conexao", arguments: {} });
  assert.equal(status.structuredContent?.autenticado, false, "a instalação deve aguardar as credenciais no chat");
  assert.equal(status.structuredContent?.versao_extrator, runtimeManifest.version);
  for (const name of ["configurar_contexto_trabalho", "consultar_contexto_trabalho"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `fluxo inicial ausente: ${name}`);
  }
  const unauthenticatedSetup = await client.callTool({ name: "configurar_contexto_trabalho", arguments: { projeto: "Projeto teste", sprint: "TESTE" } });
  assert.equal(unauthenticatedSetup.isError, true, "configuração do contexto exige autenticação");
  for (const name of ["iniciar_contagem_guiada", "preparar_contagem_apf", "validar_contagem_apf", "gerar_planilha_apf"]) {
    assert.ok(!tools.tools.some(tool => tool.name === name), `ferramenta removida ainda publicada: ${name}`);
  }
  for (const file of ["KIT_APF.md", "assets/apf/FPA-MODELO.xlsx", "dist/apf-kit.js", "dist/apf-guided.js", "dist/apf-artifacts.js", "dist/apf-workbook.js"]) {
    await assert.rejects(fs.access(path.join(destination, file)), { code: "ENOENT" });
  }
  await fs.access(path.join(destination, "DICA_DE_MESTRE.md"));
  for (const name of ["consultar_minhas_dicas_mestre", "simular_publicacao_dica_mestre", "cancelar_publicacao_dica_mestre", "publicar_dica_mestre"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `ferramenta Dica de Mestre ausente: ${name}`);
  }
  const installedPolicy = JSON.parse(await fs.readFile(path.join(destination, "capabilities.json"), "utf8"));
  assert.ok(installedPolicy.roles.desenvolvedor.some(rule => rule.formIds.includes("500000385") && rule.capabilities.includes("publicar_dica_mestre")));
  for (const name of ["simular_associacao_usuarios_funcoes", "associar_usuarios_funcoes", "simular_importacao_rapida", "importar_contagem_rapida"]) {
    assert.ok(tools.tools.some(tool => tool.name === name), `operação preservada ausente: ${name}`);
  }
  console.log(JSON.stringify({ mcp: "ok", versao: runtimeManifest.version, aguardando_credenciais: true, kit_apf_removido: true }));
} finally { await client.close().catch(() => {}); }
