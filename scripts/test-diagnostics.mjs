import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { DiagnosticError, errorDiagnostic } from "../dist/diagnostics.js";
import { authenticationStatus } from "../dist/access.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
assert.equal(errorDiagnostic(new Error("A solicitação ainda não foi aprovada por uma pessoa.")).origem, "mcp_local");
assert.equal(errorDiagnostic(new Error("A gravação está desabilitada.")).codigo, "GRAVACAO_LOCAL_DESABILITADA");
assert.equal(errorDiagnostic(new DiagnosticError("FALHA_DE_CONEXAO", "transporte", "Falha", "Confira rede")).origem, "transporte");
assert.equal(errorDiagnostic(new DiagnosticError("CREDENCIAIS_RECUSADAS", "agilepoint", "Recusado", "Confira login")).origem, "agilepoint");
assert.equal(errorDiagnostic(new Error("segredo-sem-classificação")).mensagem.includes("segredo-sem-classificação"), false);
assert.equal(errorDiagnostic(new Error("O usuário X"), true).codigo, "RESULTADO_INCERTO");
const previous = { mode: process.env.APF_AUTH_MODE, user: process.env.APF_USERNAME, password: process.env.APF_PASSWORD, role: process.env.APF_MCP_ROLE };
try {
  process.env.APF_AUTH_MODE = "environment";
  process.env.APF_USERNAME = "synthetic-user";
  process.env.APF_PASSWORD = "synthetic-secret";
  process.env.APF_MCP_ROLE = "leitura";
  assert.equal(authenticationStatus().origem_perfil, "variavel_legada");
  assert.equal(authenticationStatus().perfil_local, "leitura");
  assert.equal(JSON.stringify(authenticationStatus()).includes("synthetic-secret"), false);
} finally {
  for (const [key, value] of [["APF_AUTH_MODE", previous.mode], ["APF_USERNAME", previous.user], ["APF_PASSWORD", previous.password], ["APF_MCP_ROLE", previous.role]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
const root = await mkdtemp(path.join(tmpdir(), "apf-diagnostics-"));
const state = path.join(root, "instalacao.json");
await writeFile(state, JSON.stringify({ version: "1.2.1" }));
const client = new Client({ name: "diagnostico-offline", version: "1.2.1" });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, APF_AUTH_MODE: "chat", APF_INSTALL_STATE_FILE: state, APF_USERNAME: "synthetic-user", APF_PASSWORD: "synthetic-secret", APF_WRITE_ENABLED: "true", APF_WRITE_APPROVAL_MODE: "automatic" } }));
  const local = await client.callTool({ name: "diagnosticar_configuracao", arguments: {} });
  assert.equal(Boolean(local.isError), false);
  assert.equal(local.structuredContent.versao_em_execucao, "1.2.1");
  assert.equal(local.structuredContent.autenticacao.autenticado_pelo_chat, false);
  assert.equal(local.structuredContent.autenticacao.credenciais_do_ambiente_ignoradas, true);
  assert.equal(JSON.stringify(local).includes("synthetic-secret"), false);
  assert.equal(JSON.stringify(local).includes("synthetic-user"), false);
  const noAuth = await client.callTool({ name: "configurar_contexto_trabalho", arguments: { projeto: "Teste", sprint: "1" } });
  assert.equal(noAuth.isError, true);
  assert.equal(noAuth.structuredContent.diagnostico.codigo, "AUTENTICACAO_NECESSARIA");
  assert.equal(noAuth.structuredContent.diagnostico.origem, "mcp_local");
  await writeFile(state, JSON.stringify({ version: "1.2.2" }));
  const stale = await client.callTool({ name: "diagnosticar_configuracao", arguments: {} });
  assert.equal(stale.structuredContent.reconexao_necessaria, true);
  const write = await client.callTool({ name: "cancelar_publicacao_dica_mestre", arguments: { confirmacao_token: "00000000-0000-4000-8000-000000000001" } });
  assert.equal(write.isError, true);
  assert.equal(write.structuredContent.diagnostico.codigo, "RECONECTAR_MCP");
  await writeFile(state, "invalid");
  const invalid = await client.callTool({ name: "diagnosticar_configuracao", arguments: {} });
  assert.equal(invalid.structuredContent.diagnostico.codigo, "ESTADO_INSTALACAO_INVALIDO");
} finally {
  await client.close();
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("apf-diagnostics-")) throw new Error("Destino de limpeza inválido");
  await rm(root, { recursive: true, force: true });
}
console.log("Diagnósticos MCP reais offline: versão ativa/esperada, reconexão, origens, autenticação e ausência de credenciais: ok.");
