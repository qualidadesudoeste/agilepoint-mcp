import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";

const approvalId = process.argv[2]?.trim();
if (!approvalId || !/^[0-9a-f-]{36}$/i.test(approvalId)) {
  console.error("Uso: npm run approve -- <aprovacao_id>");
  process.exitCode = 2;
} else {
  const configured = process.env.APF_APPROVAL_DIR?.trim();
  if (!configured) throw new Error("Defina APF_APPROVAL_DIR antes de aprovar.");
  const directory = path.resolve(configured);
  const source = path.join(directory, `${approvalId}.json`);
  const record = JSON.parse(await readFile(source, "utf8"));
  if (record.version !== 2 || record.approval_id !== approvalId || record.status !== "pending") {
    throw new Error("A solicitação não existe, já foi aprovada ou já foi consumida.");
  }
  if (Date.parse(record.expires_at) <= Date.now()) throw new Error("A solicitação expirou. Peça uma nova simulação à IA.");
  const previewHash = createHash("sha256").update(JSON.stringify(record.preview)).digest("hex");
  if (previewHash !== record.preview_hash || previewHash !== record.payload_hash) {
    throw new Error("A prévia da aprovação foi alterada ou não corresponde ao payload.");
  }
  console.log("\n=== OPERAÇÃO A SER AUTORIZADA ===");
  console.log(`Operação: ${record.operation}`);
  console.log(`Destrutiva: ${record.destructive ? "SIM" : "não"}`);
  console.log(`Expira em: ${record.expires_at}`);
  console.log(JSON.stringify(record.preview, null, 2));
  console.log("=== FIM DA PRÉVIA ===\n");
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await prompt.question(`Digite APROVAR ${approvalId} para autorizar exatamente esta operação: `);
  prompt.close();
  if (confirmation.trim() !== `APROVAR ${approvalId}`) throw new Error("A aprovação foi cancelada.");
  const approved = { ...record, status: "approved", approved_at: new Date().toISOString() };
  const temporary = path.join(directory, `${approvalId}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(approved)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, source);
  console.log(`Aprovação ${approvalId} registrada. Volte à IA e peça a execução.`);
}
