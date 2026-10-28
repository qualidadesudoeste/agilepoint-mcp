import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";
import { auditActor, auditError, auditIdempotencyKey, auditValue } from "./audit-redaction.js";
import { BoundedPendingStore } from "./pending-simulations.js";

export type ApplicationDeveloperInput = {
  aplicacao: string;
  desenvolvedores: string[];
  modo: "adicionar";
};

export type ApplicationDeveloperSimulation = ApplicationDeveloperInput & {
  colaborador_id: string | null;
  colaborador_nome: string | null;
  quantidade_desenvolvedores: number;
};

type Pending = { expiresAt: number; value: ApplicationDeveloperSimulation };
type ApplicationDeveloperAudit = {
  evento_id: string;
  ocorrido_em: string;
  ator: ReturnType<typeof currentActor>;
  chave_idempotencia: string;
  payload_hash: string;
  status: "sucesso" | "falha";
  resultado?: unknown;
  erro?: string;
  simulacao: ApplicationDeveloperSimulation;
};

const pending = new BoundedPendingStore<ApplicationDeveloperSimulation>();

export function createApplicationDeveloperSimulation(input: ApplicationDeveloperInput) {
  const actor = currentActor();
  if (!actor.colaborador_id && actor.role !== "administrador") {
    throw new Error("O responsável pela instalação deve definir APF_COLLABORATOR_ID com o identificador estável da própria conta antes de associar desenvolvedores.");
  }
  const application = input.aplicacao.trim();
  if (!application) throw new Error("A aplicação é obrigatória.");
  const developers = input.desenvolvedores.map((value) => value.trim()).filter(Boolean);
  if (!developers.length) throw new Error("Informe ao menos um desenvolvedor.");
  const normalized = developers.map(normalize);
  if (new Set(normalized).size !== normalized.length) throw new Error("A lista de desenvolvedores contém nomes duplicados.");

  const value: ApplicationDeveloperSimulation = {
    aplicacao: application,
    desenvolvedores: developers,
    modo: "adicionar",
    colaborador_id: actor.colaborador_id,
    colaborador_nome: actor.nome,
    quantidade_desenvolvedores: developers.length,
  };
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return {
    confirmacao_token: token,
    expira_em: new Date(expiresAt).toISOString(),
    simulacao: value,
    aviso: "Nenhum desenvolvedor foi associado. A execução adiciona somente os ausentes e preserva as associações atuais.",
  };
}

export function consumeApplicationDeveloperSimulation(token: string): ApplicationDeveloperSimulation {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("Token inexistente ou expirado. Execute simular_associacao_desenvolvedores_aplicacao novamente.");
  }
  return entry.value;
}

export function markApplicationDeveloperSimulationConsumed(token: string): void {
  pending.delete(token);
}

export function applicationDeveloperHash(value: ApplicationDeveloperSimulation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function findSuccessfulApplicationDeveloperAssociation(key: string): Promise<ApplicationDeveloperAudit | null> {
  return (await readAudit()).find((entry) => (entry.chave_idempotencia === key || entry.chave_idempotencia === auditIdempotencyKey(key)) && entry.status === "sucesso") ?? null;
}

export async function recordApplicationDeveloperAudit(
  key: string,
  simulation: ApplicationDeveloperSimulation,
  outcome: { status: "sucesso" | "falha"; resultado?: unknown; erro?: string },
): Promise<ApplicationDeveloperAudit> {
  const entry: ApplicationDeveloperAudit = {
    evento_id: randomUUID(),
    ocorrido_em: new Date().toISOString(),
    ator: auditActor(currentActor()),
    chave_idempotencia: auditIdempotencyKey(key),
    payload_hash: applicationDeveloperHash(simulation),
    status: outcome.status,
    ...(outcome.resultado !== undefined ? { resultado: auditValue(outcome.resultado) } : {}),
    ...(auditError(outcome.erro, 500) ? { erro: auditError(outcome.erro, 500) } : {}),
    simulacao: auditValue(simulation),
  };
  const file = auditFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

function auditFile(): string {
  const directory = process.env.APF_AUDIT_DIR?.trim();
  if (!directory) throw new Error("Defina APF_AUDIT_DIR para um diretório privado e exclusivo deste usuário.");
  return path.join(directory, "associacoes-desenvolvedores-aplicacao.jsonl");
}

async function readAudit(): Promise<ApplicationDeveloperAudit[]> {
  try {
    const content = await readFile(auditFile(), "utf8");
    return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as ApplicationDeveloperAudit]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}
