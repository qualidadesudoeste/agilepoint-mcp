import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";
import { auditActor, auditError, auditIdempotencyKey, auditValue, auditValuesEnabled } from "./audit-redaction.js";
import { BoundedPendingStore } from "./pending-simulations.js";

export type UiOperation =
  | { tipo: "preencher"; alvo: string; valor: string }
  | { tipo: "selecionar"; alvo: string; valor: string }
  | { tipo: "marcar"; alvo: string; valor: boolean }
  | { tipo: "clicar"; alvo: string }
  | { tipo: "anexar"; alvo: string; caminho: string }
  | { tipo: "baixar"; alvo: string };

export type UiOperationInput = {
  tela: string;
  registro_id?: string;
  titulo_esperado?: string;
  operacoes: UiOperation[];
  justificativa?: string;
};

export type UiSimulation = UiOperationInput & {
  destrutiva: boolean;
  alvos_validados: string[];
  ator: ReturnType<typeof currentActor>;
  registro_alvo?: { formulario_id: string; registro_id_origem: string };
  formulario_alvo_id?: string;
  contratos_acoes?: Record<string, string>;
  upload_digests?: Record<string, string>;
  resolved_input_digests?: Record<string, string>;
  resolved_inputs?: Record<string, Record<string, string>>;
};

type Pending = { expiresAt: number; value: UiSimulation };
type UiAudit = {
  evento_id: string;
  ocorrido_em: string;
  ator: ReturnType<typeof currentActor>;
  chave_idempotencia: string;
  payload_hash: string;
  status: "sucesso" | "falha";
  resultado?: unknown;
  erro?: string;
  simulacao: UiSimulation;
};

const pending = new BoundedPendingStore<UiSimulation>();
const destructivePattern = /\b(excluir|exclus[aã]o|apagar|remover|deletar|delete|remove)\b/i;
const sensitiveTargetPattern = /\b(senha|password|token|segredo|secret|otp|c[oó]digo de autentica[cç][aã]o)\b/i;

export function isDestructiveOperation(operation: UiOperation): boolean {
  return operation.tipo === "clicar" && destructivePattern.test(operation.alvo);
}

export function validateUniversalInput(input: UiOperationInput): void {
  if (!input.tela.trim()) throw new Error("Informe a tela de destino.");
  if (input.registro_id !== undefined && !/^\d+$/.test(input.registro_id)) throw new Error("O ID do registro deve ser numérico.");
  if (input.titulo_esperado !== undefined && (!input.registro_id || !input.titulo_esperado.trim())) {
    throw new Error("O título esperado exige ID de registro e valor não vazio.");
  }
  if (!input.operacoes.length) throw new Error("Informe ao menos uma operação.");
  if (input.operacoes.length > 100) throw new Error("Uma execução pode conter no máximo 100 operações.");
  for (const operation of input.operacoes) {
    if (!operation.alvo.trim()) throw new Error("Toda operação precisa de um alvo.");
    if (sensitiveTargetPattern.test(operation.alvo)) {
      throw new Error(`O MCP universal não preenche campos sensíveis de autenticação: ${operation.alvo}.`);
    }
  }
}

export function createUiSimulation(
  input: UiOperationInput,
  validatedTargets: string[],
  targetRecord?: { formulario_id: string | null; registro_id_origem: string | null },
  customActions?: { destructive: boolean; fingerprints: Record<string, string>; uploadDigests?: Record<string, string>; resolvedInputDigests?: Record<string, string>; resolvedInputs?: Record<string, Record<string, string>> },
) {
  validateUniversalInput(input);
  const actor = currentActor();
  if (actor.role !== "leitura" && actor.role !== "administrador" && !actor.colaborador_id) {
    throw new Error("O responsável pela instalação deve definir APF_COLLABORATOR_ID com o identificador estável da própria conta antes de operar telas.");
  }
  const value: UiSimulation = {
    ...input,
    tela: input.tela.trim(),
    operacoes: input.operacoes.map((operation) => ({ ...operation, alvo: operation.alvo.trim() })),
    destrutiva: input.operacoes.some(isDestructiveOperation) || customActions?.destructive === true,
    alvos_validados: validatedTargets,
    ator: actor,
    ...(targetRecord?.formulario_id ? { formulario_alvo_id: targetRecord.formulario_id } : {}),
    ...(targetRecord?.formulario_id && targetRecord.registro_id_origem ? {
      registro_alvo: {
        formulario_id: targetRecord.formulario_id,
        registro_id_origem: targetRecord.registro_id_origem,
      },
    } : {}),
    ...(customActions && Object.keys(customActions.fingerprints).length ? { contratos_acoes: customActions.fingerprints } : {}),
    ...(customActions?.uploadDigests && Object.keys(customActions.uploadDigests).length ? { upload_digests: customActions.uploadDigests } : {}),
    ...(customActions?.resolvedInputDigests && Object.keys(customActions.resolvedInputDigests).length ? { resolved_input_digests: customActions.resolvedInputDigests } : {}),
    ...(customActions?.resolvedInputs && Object.keys(customActions.resolvedInputs).length ? { resolved_inputs: customActions.resolvedInputs } : {}),
  };
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return {
    confirmacao_token: token,
    expira_em: new Date(expiresAt).toISOString(),
    simulacao: value,
    requer_confirmacao_exclusao: value.destrutiva,
    aviso: "Nenhuma alteração foi executada. Confirme somente após revisar a tela, os alvos e os valores.",
  };
}

export function consumeUiSimulation(token: string): UiSimulation {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("Token inexistente ou expirado. Execute simular_operacao_tela novamente.");
  }
  return entry.value;
}

export function markUiSimulationConsumed(token: string): void { pending.delete(token); }
export function uiHash(value: UiSimulation): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function findSuccessfulUiOperation(key: string): Promise<UiAudit | null> {
  const entries = await readAudit();
  return entries.find((entry) => (entry.chave_idempotencia === key || entry.chave_idempotencia === auditIdempotencyKey(key)) && entry.status === "sucesso") ?? null;
}

export async function recordUiAudit(
  key: string,
  simulation: UiSimulation,
  outcome: { status: "sucesso" | "falha"; resultado?: unknown; erro?: string },
): Promise<UiAudit> {
  const entry: UiAudit = {
    evento_id: randomUUID(),
    ocorrido_em: new Date().toISOString(),
    ator: auditActor(currentActor()),
    chave_idempotencia: auditIdempotencyKey(key),
    payload_hash: uiHash(simulation),
    status: outcome.status,
    ...(outcome.resultado !== undefined ? { resultado: auditValue(outcome.resultado) } : {}),
    ...(auditError(outcome.erro, 1000) ? { erro: auditError(outcome.erro, 1000) } : {}),
    simulacao: auditSimulation(simulation),
  };
  const file = auditFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

function auditFile(): string {
  const directory = process.env.APF_AUDIT_DIR?.trim();
  if (!directory) throw new Error("Defina APF_AUDIT_DIR para um diretório privado e exclusivo deste usuário.");
  return path.join(directory, "operacoes-universais.jsonl");
}

function auditSimulation(simulation: UiSimulation): UiSimulation {
  if (auditValuesEnabled()) return simulation;
  return {
    ...simulation,
    tela: "[valor omitido]",
    justificativa: simulation.justificativa ? "[valor omitido]" : undefined,
    ator: auditActor(simulation.ator),
    registro_alvo: simulation.registro_alvo ? { formulario_id: simulation.registro_alvo.formulario_id, registro_id_origem: "[valor omitido]" } : undefined,
    resolved_inputs: simulation.resolved_inputs
      ? Object.fromEntries(Object.entries(simulation.resolved_inputs).map(([index, values]) => [index,
        Object.fromEntries(Object.keys(values).map((key) => [key, "[valor omitido; hash preservado]"])),
      ]))
      : undefined,
    operacoes: simulation.operacoes.map((operation) => {
      if (operation.tipo === "preencher" || operation.tipo === "selecionar") {
        return { ...operation, alvo: "[valor omitido]", valor: "[valor omitido; hash do payload preservado]" };
      }
      if (operation.tipo === "anexar") return { ...operation, alvo: "[valor omitido]", caminho: "[caminho omitido; hash do payload preservado]" };
      return { ...operation, alvo: "[valor omitido]" };
    }),
  };
}

async function readAudit(): Promise<UiAudit[]> {
  try {
    const content = await readFile(auditFile(), "utf8");
    return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as UiAudit]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
