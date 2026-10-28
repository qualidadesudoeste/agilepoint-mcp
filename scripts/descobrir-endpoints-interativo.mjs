import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.APF_USERNAME || !process.env.APF_PASSWORD) throw new Error("Credenciais não informadas.");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    APF_BASE_URL: process.env.APF_BASE_URL ?? "https://agilepoint.techpulseglobal.com.br",
    APF_USERNAME: process.env.APF_USERNAME,
    APF_PASSWORD: process.env.APF_PASSWORD,
    APF_MCP_ROLE: "leitura",
    APF_WRITE_ENABLED: "false",
    APF_DISCOVERY_MODE: "true",
    APF_DISCOVERY_INCLUDE_VALUES: "false",
    APF_NETWORK_LOG_DIR: process.env.APF_NETWORK_LOG_DIR ?? "data/network-discovery",
  },
  stderr: "inherit",
});

const client = new Client({ name: "agilepoint-endpoint-discovery", version: "1.0.0" }, { capabilities: {} });
const calls = process.env.APF_DISCOVERY_QUICK === "counts" ? [
  { name: "listar_contagens", arguments: { versao: "1.0.0", limite: 5 } },
] : process.env.APF_DISCOVERY_QUICK === "validate" ? [
  { name: "validar_endpoint_ranking_apf", arguments: {} },
] : process.env.APF_DISCOVERY_QUICK === "true" ? [
  { name: "validar_endpoint_ranking_apf", arguments: {} },
  { name: "ranking_apf", arguments: { tipo_analise: "mensal" } },
  { name: "ranking_repositorio", arguments: {} },
] : [
  { name: "verificar_conexao", arguments: {} },
  { name: "listar_contagens", arguments: { limite: 5 } },
  { name: "ranking_apf", arguments: { tipo_analise: "mensal" } },
];
try {
  await client.connect(transport);
  const operations = [];
  for (const call of calls) {
    try {
      const response = await client.callTool(call, undefined, { timeout: 10 * 60_000 });
      operations.push({
        ferramenta: call.name,
        sucesso: !response.isError,
        ...(response.isError ? { erro: response.content?.find((item) => item.type === "text")?.text ?? "Falha sem detalhe" } : {}),
        ...(call.name.startsWith("validar_") ? { detalhes: response.structuredContent } : {}),
      });
    } catch (error) {
      operations.push({ ferramenta: call.name, sucesso: false, erro: error instanceof Error ? error.message : String(error) });
    }
  }
  const analysis = await client.callTool(
    { name: "analisar_diagnostico_rede", arguments: {} },
    undefined,
    { timeout: 2 * 60_000 },
  );
  if (analysis.isError) throw new Error(analysis.content?.find((item) => item.type === "text")?.text ?? "Falha ao analisar diagnóstico.");
  process.stdout.write(`${JSON.stringify({ operacoes: operations, analise: analysis.structuredContent }, null, 2)}\n`);
} finally {
  await client.close().catch(() => undefined);
}
