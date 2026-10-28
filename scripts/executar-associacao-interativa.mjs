import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const required = ["APF_USERNAME", "APF_PASSWORD", "APF_TARGET_APPLICATION", "APF_TARGET_SPRINT", "APF_TARGET_USER", "APF_APPROVAL_DIR"];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Variáveis ausentes: ${missing.join(", ")}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    APF_BASE_URL: process.env.APF_BASE_URL ?? "https://agilepoint.techpulseglobal.com.br",
    APF_USERNAME: process.env.APF_USERNAME,
    APF_PASSWORD: process.env.APF_PASSWORD,
    APF_MCP_ROLE: "administrador",
    APF_WRITE_ENABLED: "true",
    APF_AUDIT_DIR: process.env.APF_AUDIT_DIR ?? `${process.cwd()}\\data`,
    APF_APPROVAL_DIR: process.env.APF_APPROVAL_DIR,
  },
  stderr: "inherit",
});

const client = new Client({ name: "agilepoint-association-runner", version: "1.0.0" }, { capabilities: {} });
const requestOptions = { timeout: 30 * 60_000 };

try {
  await client.connect(transport);
  if (process.env.APF_DIAGNOSTIC_ONLY === "true") {
    const diagnostic = await client.callTool({
      name: "listar_contagens",
      arguments: {
        aplicacao: process.env.APF_TARGET_APPLICATION,
        versao: process.env.APF_TARGET_SPRINT,
        situacao: "Aberta",
        limite: 20,
      },
    }, undefined, requestOptions);
    if (diagnostic.isError) {
      const message = diagnostic.content?.find((item) => item.type === "text")?.text;
      throw new Error(message || "A consulta de diagnóstico falhou.");
    }
    process.stdout.write(`${JSON.stringify(diagnostic.structuredContent, null, 2)}\n`);
    process.exitCode = 0;
  } else {
  const preview = await client.callTool({
    name: "simular_associacao_usuarios_funcoes",
    arguments: {
      contagem: {
        aplicacao: process.env.APF_TARGET_APPLICATION,
        versao_sprint: process.env.APF_TARGET_SPRINT,
        situacao: "Aberta",
      },
      usuarios: [{ usuario: process.env.APF_TARGET_USER, percentual: 100 }],
      modo: "substituir",
    },
  }, undefined, requestOptions);
  if (preview.isError) throw new Error("A simulação da associação falhou.");
  const token = preview.structuredContent?.confirmacao_token;
  const approvalId = preview.structuredContent?.aprovacao?.aprovacao_id;
  if (typeof token !== "string") throw new Error("A simulação não retornou um token de confirmação.");
  if (typeof approvalId !== "string") throw new Error("A simulação não retornou uma solicitação de aprovação humana.");

  process.stdout.write(`${JSON.stringify(preview.structuredContent?.simulacao, null, 2)}\n`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await prompt.question(`Revise a simulação. Para aprovar, digite APROVAR ${approvalId}: `);
  prompt.close();
  if (confirmation.trim() !== `APROVAR ${approvalId}`) throw new Error("A operação não foi aprovada.");
  const approvalFile = path.join(path.resolve(process.env.APF_APPROVAL_DIR), `${approvalId}.json`);
  const approval = JSON.parse(await readFile(approvalFile, "utf8"));
  const previewHash = createHash("sha256").update(JSON.stringify(preview.structuredContent?.simulacao)).digest("hex");
  if (approval.version !== 2 || approval.status !== "pending" || Date.parse(approval.expires_at) <= Date.now()) throw new Error("A solicitação de aprovação não está pendente ou expirou.");
  if (approval.payload_hash !== previewHash || approval.preview_hash !== previewHash) throw new Error("A prévia local não corresponde à operação exibida.");
  const temporary = path.join(path.dirname(approvalFile), `${approvalId}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify({ ...approval, status: "approved", approved_at: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, approvalFile);
  const result = await client.callTool({
    name: "associar_usuarios_funcoes",
    arguments: {
      confirmacao_token: token,
      chave_idempotencia: `associacao-${randomUUID()}`,
      aprovacao_id: approvalId,
    },
  }, undefined, requestOptions);
  if (result.isError) {
    const message = result.content?.find((item) => item.type === "text")?.text;
    throw new Error(message || "A associação falhou.");
  }
  const data = result.structuredContent ?? {};
  process.stdout.write(`${JSON.stringify({
    sucesso: data.sucesso,
    contagem_id: data.contagem_id,
    funcoes_alteradas: Array.isArray(data.funcoes_alteradas) ? data.funcoes_alteradas.length : 0,
    auditoria_id: data.auditoria_id,
  }, null, 2)}\n`);
  }
} finally {
  await client.close().catch(() => undefined);
}
