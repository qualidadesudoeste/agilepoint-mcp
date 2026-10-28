import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";

type ApprovalRecord = {
  version: 2;
  approval_id: string;
  operation: string;
  payload_hash: string;
  actor_hash: string;
  destructive: boolean;
  preview_hash: string;
  preview: unknown;
  requested_at: string;
  expires_at: string;
  status: "pending" | "approved";
  approved_at?: string;
};

export async function createApprovalRequest(operation: string, payloadHash: string, preview: unknown, destructive = false) {
  const directory = approvalDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await maintainApprovalDirectory(directory);
  const previewHash = digest(JSON.stringify(preview));
  if (previewHash !== payloadHash) throw new Error("A prévia da aprovação não corresponde ao conteúdo simulado.");
  const approvalId = randomUUID();
  const requestedAt = new Date();
  const record: ApprovalRecord = {
    version: 2,
    approval_id: approvalId,
    operation,
    payload_hash: payloadHash,
    actor_hash: actorHash(),
    destructive,
    preview_hash: previewHash,
    preview,
    requested_at: requestedAt.toISOString(),
    expires_at: new Date(requestedAt.getTime() + 10 * 60_000).toISOString(),
    status: "pending",
  };
  await writeFile(recordPath(directory, approvalId), `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    aprovacao_id: approvalId,
    expira_em: record.expires_at,
    requer_aprovacao_humana: true,
    instrucao: `No computador onde o MCP está instalado, execute: npm run approve -- ${approvalId}`,
  };
}

export async function consumeHumanApproval(approvalId: string, operation: string, payloadHash: string, idempotencyKey: string): Promise<void> {
  const source = await verifyHumanApproval(approvalId, operation, payloadHash, idempotencyKey);
  const directory = approvalDirectory();
  try { await rename(source, path.join(directory, `${approvalId}.consumed.json`)); }
  catch { throw new Error("A aprovação humana já foi consumida por outra execução."); }
}

export async function verifyHumanApproval(approvalId: string, operation: string, payloadHash: string, idempotencyKey: string): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new Error("Identificador de aprovação inválido.");
  const directory = approvalDirectory();
  const source = recordPath(directory, approvalId);
  let record: ApprovalRecord;
  try { record = JSON.parse(await readFile(source, "utf8")) as ApprovalRecord; }
  catch { throw new Error("A aprovação humana não existe, expirou ou já foi utilizada."); }
  if (record.version !== 2 || record.approval_id !== approvalId || record.status !== "approved") {
    throw new Error(`A solicitação ${approvalId} ainda não foi aprovada por uma pessoa.`);
  }
  if (record.preview_hash !== digest(JSON.stringify(record.preview)) || record.preview_hash !== record.payload_hash) {
    throw new Error("A prévia da aprovação humana foi alterada ou não corresponde ao conteúdo autorizado.");
  }
  if (record.operation !== operation || record.payload_hash !== payloadHash || record.actor_hash !== actorHash()) {
    throw new Error("A aprovação humana não corresponde exatamente à operação, ao conteúdo e ao usuário atuais.");
  }
  if (Date.parse(record.expires_at) <= Date.now()) throw new Error("A aprovação humana expirou. Simule a operação novamente.");
  await bindApprovalToIdempotencyKey(directory, approvalId, idempotencyKey);
  return source;
}

function approvalDirectory(): string {
  const configured = process.env.APF_APPROVAL_DIR?.trim();
  if (!configured) throw new Error("Operações de escrita exigem APF_APPROVAL_DIR em um diretório privado, acessível ao usuário humano e não à IA.");
  return path.resolve(configured);
}

function recordPath(directory: string, approvalId: string): string {
  return path.join(directory, `${approvalId}.json`);
}

function actorHash(): string {
  return digest(JSON.stringify(currentActor()));
}

async function bindApprovalToIdempotencyKey(directory: string, approvalId: string, idempotencyKey: string): Promise<void> {
  const keyHash = digest(idempotencyKey);
  const file = path.join(directory, `${approvalId}.key`);
  try {
    await writeFile(file, `${keyHash}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = (await readFile(file, "utf8")).trim();
    if (existing !== keyHash) throw new Error("A aprovação humana já foi vinculada a outra chave de idempotência.");
  }
}

async function maintainApprovalDirectory(directory: string): Promise<void> {
  const names = await readdir(directory);
  const now = Date.now();
  const retentionMs = configuredInteger("APF_APPROVAL_RETENTION_DAYS", 30, 1, 365) * 24 * 60 * 60_000;
  for (const name of names) {
    const match = /^([0-9a-f-]{36})(\.consumed)?\.json$/i.exec(name);
    if (!match) continue;
    const file = path.join(directory, name);
    let remove = false;
    if (match[2]) {
      try { remove = now - (await stat(file)).mtimeMs > retentionMs; } catch { continue; }
    } else {
      try {
        const record = JSON.parse(await readFile(file, "utf8")) as Partial<ApprovalRecord>;
        remove = typeof record.expires_at !== "string" || Date.parse(record.expires_at) <= now;
      } catch {
        remove = true;
      }
    }
    if (remove) {
      await unlink(file).catch(() => undefined);
      await unlink(path.join(directory, `${match[1]}.key`)).catch(() => undefined);
    }
  }
  const retained = await readdir(directory);
  const recordNames = retained.filter((name) => /^[0-9a-f-]{36}(?:\.consumed)?\.json$/i.test(name));
  const relatedNames = retained.filter((name) => /^[0-9a-f-]{36}(?:(?:\.consumed)?\.json|\.key)$/i.test(name));
  let retainedBytes = 0;
  for (const name of relatedNames) {
    try { retainedBytes += (await stat(path.join(directory, name))).size; } catch { /* Arquivo removido concorrentemente. */ }
  }
  const maximum = configuredInteger("APF_MAX_APPROVAL_RECORDS", 100, 1, 1000);
  const maximumBytes = configuredInteger("APF_MAX_APPROVAL_STORAGE_BYTES", 50 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024);
  if (recordNames.length >= maximum || retainedBytes >= maximumBytes) {
    throw new Error("O limite de retenção das aprovações foi atingido. Arquive registros consumidos conforme a política da organização.");
  }
}

function configuredInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
