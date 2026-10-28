import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";

export type IdempotencyRecord = {
  version: 1;
  scope: string;
  key_hash: string;
  payload_hash: string;
  actor_hash: string;
  status: "pending" | "success" | "outcome_unknown";
  claimed_at: string;
  completed_at?: string;
  error_digest?: string;
  audit_projection?: {
    status: "pending" | "written";
    recovery: unknown;
    updated_at: string;
  };
};

export async function claimIdempotency(scope: string, key: string, payloadHash: string): Promise<{ claimed: boolean; record: IdempotencyRecord }> {
  const directory = idempotencyDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actorHash = digest(JSON.stringify(currentActor()));
  const keyHash = digest(`${scope}\0${actorHash}\0${key}`);
  const file = path.join(directory, `${keyHash}.json`);
  const record: IdempotencyRecord = {
    version: 1,
    scope,
    key_hash: keyHash,
    payload_hash: payloadHash,
    actor_hash: actorHash,
    status: "pending",
    claimed_at: new Date().toISOString(),
  };
  try {
    await durableExclusiveWrite(file, record);
    await syncDirectory(directory);
    return { claimed: true, record };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(file, "utf8")) as IdempotencyRecord;
    if (existing.version !== 1 || existing.scope !== scope || existing.key_hash !== keyHash || existing.actor_hash !== actorHash) {
      throw new Error("O registro de idempotência está corrompido ou não corresponde ao escopo atual.");
    }
    if (existing.payload_hash !== payloadHash) throw new Error("A chave de idempotência já foi usada com outro conteúdo.");
    return { claimed: false, record: existing };
  }
}

export async function completeIdempotency(scope: string, key: string, payloadHash: string, status: "success" | "outcome_unknown", error?: string, auditRecovery?: unknown): Promise<IdempotencyRecord> {
  const directory = idempotencyDirectory();
  const actorHash = digest(JSON.stringify(currentActor()));
  const keyHash = digest(`${scope}\0${actorHash}\0${key}`);
  const file = path.join(directory, `${keyHash}.json`);
  const current = JSON.parse(await readFile(file, "utf8")) as IdempotencyRecord;
  if (current.scope !== scope || current.key_hash !== keyHash || current.payload_hash !== payloadHash || current.actor_hash !== actorHash) {
    throw new Error("O registro de idempotência não corresponde à operação concluída.");
  }
  if (current.status !== "pending") return current;
  const completed: IdempotencyRecord = {
    ...current,
    status,
    completed_at: new Date().toISOString(),
    ...(error ? { error_digest: digest(error) } : {}),
    ...(auditRecovery !== undefined ? {
      audit_projection: { status: "pending" as const, recovery: auditRecovery, updated_at: new Date().toISOString() },
    } : {}),
  };
  const temporary = path.join(directory, `${keyHash}.${randomUUID()}.tmp`);
  await durableExclusiveWrite(temporary, completed);
  await rename(temporary, file);
  await syncDirectory(directory);
  return completed;
}

export async function markIdempotencyAuditProjected(scope: string, key: string, payloadHash: string): Promise<IdempotencyRecord> {
  const directory = idempotencyDirectory();
  const actorHash = digest(JSON.stringify(currentActor()));
  const keyHash = digest(`${scope}\0${actorHash}\0${key}`);
  const file = path.join(directory, `${keyHash}.json`);
  const current = JSON.parse(await readFile(file, "utf8")) as IdempotencyRecord;
  if (current.scope !== scope || current.key_hash !== keyHash || current.payload_hash !== payloadHash || current.actor_hash !== actorHash || current.status !== "success") {
    throw new Error("O journal de idempotência não corresponde à auditoria concluída.");
  }
  if (!current.audit_projection || current.audit_projection.status === "written") return current;
  const updated: IdempotencyRecord = {
    ...current,
    audit_projection: { ...current.audit_projection, status: "written", updated_at: new Date().toISOString() },
  };
  const temporary = path.join(directory, `${keyHash}.${randomUUID()}.tmp`);
  await durableExclusiveWrite(temporary, updated);
  await rename(temporary, file);
  await syncDirectory(directory);
  return updated;
}

function idempotencyDirectory(): string {
  const base = process.env.APF_AUDIT_DIR?.trim();
  if (!base) throw new Error("Defina APF_AUDIT_DIR para persistir idempotência em um diretório privado e exclusivo deste usuário.");
  return path.join(path.resolve(base), "idempotency");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function durableExclusiveWrite(file: string, value: unknown): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform !== "win32") throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (!new Set(["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(code ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}
