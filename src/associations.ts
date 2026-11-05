import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";
import { auditActor, auditError, auditIdempotencyKey, auditValue } from "./audit-redaction.js";
import { BoundedPendingStore } from "./pending-simulations.js";

export type AssociationUser = { usuario: string; percentual: number };
export type AssociationInput = {
  contagem: {
    aplicacao: string;
    versao_sprint: string;
    tipo_contagem?: string;
    situacao?: "Aberta" | "Fechada";
    criada_em?: string;
  };
  funcoes?: string[];
  usuarios: AssociationUser[];
  modo: "substituir";
};

export type AssociationSimulation = AssociationInput & {
  alvos_verificados?: { contagem_id: string; funcoes: Array<{ id: string; nome: string; associacoes_atuais: Array<{ userId: string; percentage: number }> }>; usuarios: Array<{ userId: string; percentage: number }> };
  colaborador_id: string | null;
  colaborador_nome: string | null;
  quantidade_funcoes_solicitadas: number | "todas";
  percentual_total: number;
};

type Pending = { expiresAt: number; value: AssociationSimulation };
type AssociationAudit = {
  evento_id: string;
  ocorrido_em: string;
  ator: ReturnType<typeof currentActor>;
  chave_idempotencia: string;
  payload_hash: string;
  status: "sucesso" | "falha";
  resultado?: unknown;
  erro?: string;
  simulacao: AssociationSimulation;
};

const pending = new BoundedPendingStore<AssociationSimulation>();

export function createAssociationSimulation(input: AssociationInput) {
  const actor = currentActor();
  if (!actor.colaborador_id && actor.role !== "administrador") {
    throw new Error("O responsável pela instalação deve definir APF_COLLABORATOR_ID com o identificador estável da própria conta antes de associar usuários.");
  }
  const duplicateUsers = duplicates(input.usuarios.map((item) => normalize(item.usuario)));
  if (duplicateUsers.length) throw new Error("A lista de usuários contém nomes duplicados.");
  const duplicateFunctions = duplicates((input.funcoes ?? []).map(normalize));
  if (duplicateFunctions.length) throw new Error("A lista de funções contém nomes duplicados.");
  const total = round(input.usuarios.reduce((sum, item) => sum + item.percentual, 0));
  if (total !== 100) throw new Error(`A soma dos percentuais deve ser 100%. Soma recebida: ${total}%.`);

  const value: AssociationSimulation = {
    ...input,
    funcoes: input.funcoes?.map((name) => name.trim()),
    usuarios: input.usuarios.map((item) => ({ usuario: item.usuario.trim(), percentual: item.percentual })),
    colaborador_id: actor.colaborador_id,
    colaborador_nome: actor.nome,
    quantidade_funcoes_solicitadas: input.funcoes?.length ?? "todas",
    percentual_total: total,
  };
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return {
    confirmacao_token: token,
    expira_em: new Date(expiresAt).toISOString(),
    simulacao: value,
    aviso: "Nenhuma associação foi alterada. No modo substituir, as associações atuais das funções selecionadas serão removidas e recriadas.",
  };
}

export function consumeAssociationSimulation(token: string): AssociationSimulation {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("Token inexistente ou expirado. Execute simular_associacao_usuarios_funcoes novamente.");
  }
  return entry.value;
}

export function markAssociationConsumed(token: string): void {
  pending.delete(token);
}

export function associationHash(value: AssociationSimulation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function findSuccessfulAssociation(key: string): Promise<AssociationAudit | null> {
  const entries = await readAudit();
  return entries.find((entry) => (entry.chave_idempotencia === key || entry.chave_idempotencia === auditIdempotencyKey(key)) && entry.status === "sucesso") ?? null;
}

export async function recordAssociationAudit(
  key: string,
  simulation: AssociationSimulation,
  outcome: { status: "sucesso" | "falha"; resultado?: unknown; erro?: string },
): Promise<AssociationAudit> {
  const entry: AssociationAudit = {
    evento_id: randomUUID(),
    ocorrido_em: new Date().toISOString(),
    ator: auditActor(currentActor()),
    chave_idempotencia: auditIdempotencyKey(key),
    payload_hash: associationHash(simulation),
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
  return path.join(directory, "associacoes-usuarios.jsonl");
}

async function readAudit(): Promise<AssociationAudit[]> {
  try {
    const content = await readFile(auditFile(), "utf8");
    return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as AssociationAudit]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
