import type { currentActor } from "./access.js";
import { createHash } from "node:crypto";

export function auditValuesEnabled(): boolean {
  return process.env.APF_AUDIT_INCLUDE_VALUES === "true";
}

export function auditActor(actor: ReturnType<typeof currentActor>): ReturnType<typeof currentActor> {
  return auditValuesEnabled() ? actor : {
    role: actor.role,
    colaborador_id: actor.colaborador_id ? digest(`colaborador:${actor.colaborador_id}`) : null,
    nome: null,
  };
}

export function auditIdempotencyKey(key: string): string {
  return auditValuesEnabled() ? key : `sha256:${digest(key)}`;
}

export function auditValue<T>(value: T): T {
  return (auditValuesEnabled() ? value : redact(value)) as T;
}

export function auditError(error: string | undefined, maximum: number): string | undefined {
  if (!error) return undefined;
  return auditValuesEnabled() ? error.slice(0, maximum) : "[detalhes omitidos; consulte o hash e o estado da operação]";
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "string") return "[valor omitido]";
  if (typeof value === "number" || typeof value === "bigint") return "[número omitido]";
  if (Array.isArray(value)) return { quantidade: value.length, valores: value.map(() => "[item omitido]") };
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => {
      if (key === "role" && typeof child === "string") return [key, child];
      if (/^(?:status|modo|acao|tipo|destrutiva|situacao)$/i.test(key) && typeof child === "string") return [key, child];
      if (/^(?:quantidade|total|percentual_total|operacoes_executadas)$/i.test(key) && typeof child === "number") return [key, child];
      return [key, redact(child)];
    }));
  }
  return "[valor omitido]";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
