import { readFile } from "node:fs/promises";
import type { McpRole } from "./access.js";
import type { UiOperation } from "./universal.js";

export type Capability = "field_write" | "include" | "edit" | "save" | "delete" | "cancel" | "refresh" | "custom_action" | "upload" | "download" | "publicar_dica_mestre";
type Rule = { formIds: string[]; capabilities: Array<Capability | "*"> };
type Policy = { version: 1; roles: Partial<Record<McpRole, Rule[]>> };

const capabilityTypes = new Set<Capability>(["field_write", "include", "edit", "save", "delete", "cancel", "refresh", "custom_action", "upload", "download", "publicar_dica_mestre"]);

export async function assertUniversalCapability(role: McpRole, formId: string | null, operations: UiOperation[], targetRefs: string[] = []): Promise<void> {
  if (!formId || !/^\d+$/.test(formId)) throw new Error("A operação universal exige um identificador estável de formulário.");
  const requested = [...new Set(operations.map((operation, index) => operationCapability(operation, targetRefs[index])))];
  if (requested.every((capability) => capability === "download")) return;
  const allowed = await allowedUniversalCapabilities(role, formId);
  const denied = requested.filter((capability) => !allowed.has(capability));
  if (denied.length) {
    throw new Error(`O perfil ${role} não possui capacidade local para ${denied.join(", ")} no formulário ${formId}. O responsável pela instalação deve autorizar explicitamente em APF_CAPABILITIES_FILE, após confirmar as permissões da conta no AgilePoint.`);
  }
}

export async function allowedUniversalCapabilities(role: McpRole, formId: string): Promise<Set<Capability>> {
  if (!/^\d+$/.test(formId)) throw new Error("O ID do formulário deve ser numérico.");
  if (role === "administrador") return new Set(capabilityTypes);
  const policy = await loadPolicy();
  const rules = policy.roles[role] ?? [];
  return new Set([...capabilityTypes].filter((capability) => capability === "download" || rules.some((rule) =>
    (rule.formIds.includes("*") || rule.formIds.includes(formId))
    && (rule.capabilities.includes("*") || rule.capabilities.includes(capability)))));
}

export async function loadPolicy(): Promise<Policy> {
  const file = process.env.APF_CAPABILITIES_FILE?.trim();
  if (!file) return { version: 1, roles: {} };
  let value: unknown;
  try { value = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error(`APF_CAPABILITIES_FILE (${file}) não contém JSON válido ou não pode ser lido.`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("A política de capacidades deve ser um objeto JSON.");
  const root = value as Record<string, unknown>;
  if (root.version !== 1 || !root.roles || typeof root.roles !== "object" || Array.isArray(root.roles)) {
    throw new Error("A política de capacidades deve usar version=1 e possuir roles.");
  }
  const roles: Policy["roles"] = {};
  for (const role of ["leitura", "desenvolvedor", "gerente", "administrador"] as McpRole[]) {
    const rawRules = (root.roles as Record<string, unknown>)[role];
    if (rawRules === undefined) continue;
    if (!Array.isArray(rawRules)) throw new Error(`roles.${role} deve ser uma lista.`);
    roles[role] = rawRules.map((raw, index) => parseRule(raw, `${role}[${index}]`));
  }
  return { version: 1, roles };
}

function parseRule(raw: unknown, label: string): Rule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`A regra ${label} é inválida.`);
  const item = raw as Record<string, unknown>;
  if (!Array.isArray(item.formIds) || !item.formIds.length || !Array.isArray(item.capabilities) || !item.capabilities.length) {
    throw new Error(`A regra ${label} deve possuir formIds e capabilities não vazios.`);
  }
  const formIds = item.formIds.map(String);
  if (formIds.some((id) => id !== "*" && !/^\d+$/.test(id))) throw new Error(`A regra ${label} contém formId inválido.`);
  const capabilities = item.capabilities.map(String) as Array<Capability | "*">;
  if (capabilities.some((capability) => capability !== "*" && !capabilityTypes.has(capability))) {
    throw new Error(`A regra ${label} contém uma capacidade inválida.`);
  }
  return { formIds: [...new Set(formIds)], capabilities: [...new Set(capabilities)] };
}

function operationCapability(operation: UiOperation, targetRef?: string): Capability {
  if (operation.tipo === "baixar") return "download";
  if (operation.tipo === "anexar") return "upload";
  if (operation.tipo !== "clicar") return "field_write";
  return ({
    "nav:include": "include",
    "nav:edit": "edit",
    "nav:save": "save",
    "nav:delete": "delete",
    "nav:cancel": "cancel",
    "nav:refresh": "refresh",
  } as Record<string, Capability>)[targetRef ?? ""] ?? "custom_action";
}
