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
  },
  stderr: "inherit",
});
const client = new Client({ name: "agilepoint-universal-smoke", version: "1.0.0" }, { capabilities: {} });
try {
  await client.connect(transport);
  const response = await client.callTool(
    { name: "listar_telas_disponiveis", arguments: {} },
    undefined,
    { timeout: 10 * 60_000 },
  );
  if (response.isError) {
    const message = response.content?.find((item) => item.type === "text")?.text;
    throw new Error(message || "Falha ao listar telas.");
  }
  const screens = Array.isArray(response.structuredContent?.telas) ? response.structuredContent.telas : [];
  if (process.env.APF_TEST_SCREEN) {
    const description = await client.callTool(
      { name: "descrever_tela", arguments: { tela: process.env.APF_TEST_SCREEN } },
      undefined,
      { timeout: 10 * 60_000 },
    );
    if (description.isError) {
      const message = description.content?.find((item) => item.type === "text")?.text;
      throw new Error(message || "Falha ao descrever tela.");
    }
    const data = description.structuredContent ?? {};
    process.stdout.write(`${JSON.stringify({
      quantidade_telas: screens.length,
      tela: data.nome,
      formulario_id: data.formulario_id,
      campos: Array.isArray(data.campos) ? data.campos.length : 0,
      acoes: Array.isArray(data.acoes) ? data.acoes.length : 0,
      tabelas: Array.isArray(data.tabelas) ? data.tabelas.length : 0,
      alertas: data.alertas,
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ quantidade: screens.length, telas: screens }, null, 2)}\n`);
  }
} finally {
  await client.close().catch(() => undefined);
}
