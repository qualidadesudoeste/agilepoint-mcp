import type { FunctionSimulation } from "./points.js";

export type ActivityConvention = {
  codigo: string;
  nome: string;
  atividade: string;
  fator: number;
};

const allowedActivities = new Set(["I", "A", "E", "T", "AV", "MI", "AD", "MA", "AP"]);

export function parseActivityConventions(raw: string): ActivityConvention[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("O AgilePoint não publicou convenções de atividade em JSON válido."); }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100) {
    throw new Error("O AgilePoint não publicou uma lista válida de convenções de atividade.");
  }
  const seen = new Set<string>();
  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Uma convenção de atividade do AgilePoint é inválida.");
    }
    const value = entry as Record<string, unknown>;
    const codigo = String(value.CON_COD ?? "").trim();
    const nome = String(value.CON_NOME ?? "").trim();
    const atividade = String(value.CON_SIGLA ?? "").trim().toUpperCase();
    const fator = value.CON_VALOR;
    if (!/^\d+$/.test(codigo) || !nome || nome.length > 100 || !allowedActivities.has(atividade)
      || typeof fator !== "number" || !Number.isFinite(fator) || fator <= 0 || fator > 100
      || seen.has(atividade)) {
      throw new Error("O AgilePoint publicou uma convenção de atividade ambígua ou inválida.");
    }
    seen.add(atividade);
    return { codigo, nome, atividade, fator };
  });
}

export function assertPointFactorsMatchConventions(
  functions: FunctionSimulation[], conventions: ActivityConvention[],
): void {
  const byActivity = new Map(conventions.map((item) => [item.atividade, item.fator]));
  for (const funcao of functions) for (const item of funcao.itens) {
    const official = byActivity.get(item.atividade);
    if (official === undefined) {
      throw new Error(`A atividade ${item.atividade} não possui fator publicado nas convenções desta contagem. O lançamento foi bloqueado.`);
    }
    if (Math.abs(official - item.fator_aplicado) > 0.000001) {
      throw new Error(`O fator da atividade ${item.atividade} diverge da convenção publicada pelo AgilePoint. Esperado: ${official}.`);
    }
  }
}
