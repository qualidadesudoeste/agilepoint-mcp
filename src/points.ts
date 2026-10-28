import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { currentActor } from "./access.js";
import { auditActor, auditError, auditIdempotencyKey, auditValue } from "./audit-redaction.js";
import { BoundedPendingStore } from "./pending-simulations.js";

export type FunctionItemInput = {
  descricao: string;
  tipo: "ALI" | "AIE" | "EE" | "SE" | "CE";
  atividade: "I" | "A" | "E" | "T" | "AV" | "MI" | "AD" | "MA" | "AP";
  td: number;
  ar_tr: number;
  complexidade: "Baixa" | "Média" | "Alta";
  pf: number;
  fator_aplicado: number;
};

export type FunctionItemSimulation = FunctionItemInput & { pf_equivalente: number };
export type FunctionInput = { nome: string; itens: FunctionItemInput[] };
export type FunctionSimulation = { nome: string; itens: FunctionItemSimulation[]; total_pf_equivalente: number };

export type CountTarget = {
  acao: "usar_existente" | "criar";
  aplicacao: string;
  versao_sprint: string;
  tipo_contagem?: string;
  situacao?: "Aberta" | "Fechada";
  criada_em?: string;
  mes_competencia?: number;
  ano_competencia?: number;
  fator_equivalencia?: string;
  proposito?: string;
  escopo?: string;
};

export type PointInput = { contagem: CountTarget; funcoes: FunctionInput[]; referencia_externa?: string };
export type PointSimulation = Omit<PointInput, "funcoes"> & {
  funcoes: FunctionSimulation[];
  total_pf: number;
  total_pf_equivalente: number;
  colaborador_id: string | null;
  colaborador_nome: string | null;
};

type Pending = { expiresAt: number; value: PointSimulation };
export type PointAudit = {
  evento_id: string;
  ocorrido_em: string;
  ator: ReturnType<typeof currentActor>;
  chave_idempotencia: string;
  payload_hash: string;
  status: "sucesso" | "falha";
  lancamento_id: string | null;
  resultado?: unknown;
  erro?: string;
  simulacao: PointSimulation;
};

const pending = new BoundedPendingStore<PointSimulation>();

export function createPointSimulation(input: PointInput) {
  const actor = currentActor();
  if (!actor.colaborador_id && actor.role !== "administrador") {
    throw new Error("O responsável pela instalação deve definir APF_COLLABORATOR_ID com o identificador estável da própria conta desenvolvedora antes de lançar PF.");
  }
  validateTarget(input.contagem);
  if (!input.funcoes.length) throw new Error("Informe ao menos uma função.");
  const functionNames = input.funcoes.map((item) => normalize(item.nome));
  if (functionNames.some((name) => !name)) throw new Error("O nome da função não pode ficar vazio.");
  if (new Set(functionNames).size !== functionNames.length) throw new Error("Há funções duplicadas no lançamento.");

  const functions: FunctionSimulation[] = input.funcoes.map((funcao) => {
    if (!funcao.itens.length) throw new Error(`A função ${funcao.nome} não possui itens.`);
    const items = funcao.itens.map((item) => {
      if (!item.descricao.trim()) throw new Error(`Há item sem descrição na função ${funcao.nome}.`);
      if (!["I", "A", "E", "T", "AV", "MI", "AD", "MA", "AP"].includes(item.atividade)) throw new Error(`Atividade inválida no item ${item.descricao}.`);
      if (!Number.isFinite(item.pf) || item.pf <= 0) throw new Error(`PF inválido no item ${item.descricao}.`);
      if (!Number.isFinite(item.fator_aplicado) || item.fator_aplicado <= 0) throw new Error(`Fator inválido no item ${item.descricao}.`);
      if (!Number.isInteger(item.td) || item.td < 0 || !Number.isInteger(item.ar_tr) || item.ar_tr < 0) {
        throw new Error(`TD e AR/TR devem ser inteiros não negativos no item ${item.descricao}.`);
      }
      return {
        ...item,
        descricao: item.descricao.trim(),
        fator_aplicado: round(item.fator_aplicado),
        pf_equivalente: round(item.pf * item.fator_aplicado),
      };
    });
    return {
      nome: funcao.nome.trim(),
      itens: items,
      total_pf_equivalente: round(items.reduce((sum, item) => sum + item.pf_equivalente, 0)),
    };
  });
  const allItems = functions.flatMap((funcao) => funcao.itens);
  const value: PointSimulation = {
    ...input,
    contagem: { ...input.contagem, situacao: input.contagem.situacao ?? "Aberta" },
    funcoes: functions,
    total_pf: round(allItems.reduce((sum, item) => sum + item.pf, 0)),
    total_pf_equivalente: round(allItems.reduce((sum, item) => sum + item.pf_equivalente, 0)),
    colaborador_id: actor.colaborador_id,
    colaborador_nome: actor.nome,
  };
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return {
    confirmacao_token: token,
    expira_em: new Date(expiresAt).toISOString(),
    simulacao: value,
    aviso: "Nenhum dado foi gravado. Confira a contagem, as funções, os itens, o PF e o PF equivalente antes de confirmar.",
  };
}

export function consumePointSimulation(token: string): PointSimulation {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("Token inexistente ou expirado. Execute simular_lancamento_pf novamente.");
  }
  return entry.value;
}

export function markPointSimulationConsumed(token: string): void { pending.delete(token); }
export function pointHash(value: PointSimulation): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function findSuccessfulPointLaunch(key: string): Promise<PointAudit | null> {
  const entries = await readAudit();
  return entries.find((entry) => (entry.chave_idempotencia === key || entry.chave_idempotencia === auditIdempotencyKey(key)) && entry.status === "sucesso") ?? null;
}

export async function recordPointAudit(
  key: string,
  simulation: PointSimulation,
  outcome: { status: "sucesso" | "falha"; lancamento_id?: string | null; resultado?: unknown; erro?: string },
): Promise<PointAudit> {
  const entry: PointAudit = {
    evento_id: randomUUID(),
    ocorrido_em: new Date().toISOString(),
    ator: auditActor(currentActor()),
    chave_idempotencia: auditIdempotencyKey(key),
    payload_hash: pointHash(simulation),
    status: outcome.status,
    lancamento_id: outcome.lancamento_id ?? null,
    ...(outcome.resultado !== undefined ? { resultado: auditValue(outcome.resultado) } : {}),
    ...(auditError(outcome.erro, 500) ? { erro: auditError(outcome.erro, 500) } : {}),
    simulacao: auditValue(simulation),
  };
  const file = auditFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

export async function listOwnPointAudit(limit: number): Promise<PointAudit[]> {
  const actor = currentActor();
  const entries = await readAudit();
  const auditedActor = auditActor(actor);
  return entries.filter((entry) => actor.role === "administrador" || entry.ator.colaborador_id === actor.colaborador_id || entry.ator.colaborador_id === auditedActor.colaborador_id).slice(-limit).reverse();
}

function validateTarget(target: CountTarget): void {
  if (!target.aplicacao.trim() || !target.versao_sprint.trim()) throw new Error("Aplicação e versão/sprint são obrigatórias.");
  if (target.versao_sprint.trim().length > 20) throw new Error("A versão/sprint da contagem excede o limite de 20 caracteres do AgilePoint.");
  if (target.situacao === "Fechada") throw new Error("Não é permitido lançar pontos em contagem fechada.");
  if (target.acao === "criar") {
    const missing = [
      !target.tipo_contagem?.trim() && "tipo_contagem",
      !target.mes_competencia && "mes_competencia",
      !target.ano_competencia && "ano_competencia",
      !target.fator_equivalencia?.trim() && "fator_equivalencia",
    ].filter(Boolean);
    if (missing.length) throw new Error(`Para criar a contagem, informe: ${missing.join(", ")}.`);
  }
}

function auditFile(): string {
  const directory = process.env.APF_AUDIT_DIR?.trim();
  if (!directory) throw new Error("Defina APF_AUDIT_DIR para um diretório privado e exclusivo deste usuário.");
  return path.join(directory, "lancamentos-pf.jsonl");
}

async function readAudit(): Promise<PointAudit[]> {
  try {
    const content = await readFile(auditFile(), "utf8");
    return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as PointAudit]; } catch { return []; }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function round(value: number): number { return Number(value.toFixed(6)); }
