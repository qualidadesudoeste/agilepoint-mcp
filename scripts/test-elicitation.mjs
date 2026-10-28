import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { requestClientApproval } from "../dist/write-authorization.js";

const preview = { tela: "Funcionalidade", registro_id: "2100", titulo_esperado: "Teste MCP", operacoes: [{ tipo: "clicar", alvo: "Excluir registro" }] };
const hash = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
const phrase = `APROVAR ${hash.slice(0, 16).toUpperCase()}`;

async function exerciseClient(reply, supportsForm = true) {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "apf-elicitation-test", version: "1.0.0" });
  const client = new Client({ name: "apf-elicitation-test-client", version: "1.0.0" }, {
    capabilities: supportsForm ? { elicitation: { form: {} } } : {},
  });
  let prompted = false;
  if (supportsForm) client.setRequestHandler(ElicitRequestSchema, async (request) => {
    prompted = true;
    assert.equal(request.params.mode, "form");
    assert.match(request.params.message, /registro_id.*2100/);
    assert.match(request.params.message, /Excluir registro/);
    return reply;
  });
  server.registerTool("aprovar_teste", { inputSchema: {} }, async () => {
    try {
      await requestClientApproval("executar_operacao_tela", hash, preview, (request) =>
        server.server.elicitInput(request, { timeout: 2_000 }));
      return { content: [{ type: "text", text: "aprovado" }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "falha" }] };
    }
  });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "aprovar_teste", arguments: {} });
    return { result, prompted };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const accepted = await exerciseClient({ action: "accept", content: { confirmacao: phrase } });
assert.equal(accepted.prompted, true);
assert.equal(accepted.result.isError, undefined);
assert.equal(accepted.result.content[0].text, "aprovado");

for (const reply of [
  { action: "decline" },
  { action: "cancel" },
  { action: "accept", content: { confirmacao: "APROVAR ERRADO" } },
]) {
  const denied = await exerciseClient(reply);
  assert.equal(denied.prompted, true);
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.content[0].text, /não foi aprovada|does not match requested schema/);
}

const unsupported = await exerciseClient(undefined, false);
assert.equal(unsupported.prompted, false);
assert.equal(unsupported.result.isError, true);
assert.match(unsupported.result.content[0].text, /does not support form elicitation/);

console.log("elicitation MCP: ok");
