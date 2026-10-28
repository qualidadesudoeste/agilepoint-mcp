import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export type CustomActionParameter =
  | { name: string; source: "literal"; value: string }
  | { name: string; source: "component_value"; componentId: string; display?: boolean }
  | { name: string; source: "record_id" };

export type CustomActionContract = {
  formId: string;
  componentId: string;
  ruleName: string;
  pType: "1" | "2";
  parentRID: string;
  parameters: CustomActionParameter[];
  destructive: boolean;
  requiresRecordId: boolean;
  refreshAfter: boolean;
  source: string;
  fingerprint: string;
};

export type CustomActionRegistry = Map<string, CustomActionContract>;

export async function loadCustomActionRegistry(): Promise<CustomActionRegistry> {
  const file = process.env.APF_CUSTOM_ACTIONS_FILE?.trim();
  if (!file) return new Map();
  const source = await readFile(file, "utf8");
  return parseCustomActionRegistry(source, file);
}

export function parseCustomActionRegistry(source: string, sourceName = "configuração local"): CustomActionRegistry {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error(`O registro de ações personalizadas em ${sourceName} não contém JSON válido.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("O registro de ações personalizadas deve ser um objeto JSON.");
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || !Array.isArray(root.actions)) throw new Error("O registro de ações personalizadas deve usar version=1 e possuir actions[].");
  const registry: CustomActionRegistry = new Map();
  for (const [index, raw] of root.actions.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`A ação ${index + 1} é inválida.`);
    const item = raw as Record<string, unknown>;
    const formId = numeric(item.formId, `formId da ação ${index + 1}`);
    const componentId = numeric(item.componentId, `componentId da ação ${index + 1}`);
    const ruleName = text(item.ruleName, `ruleName da ação ${index + 1}`, 200);
    const pType = item.pType === undefined ? "2" : String(item.pType);
    if (pType !== "1" && pType !== "2") throw new Error(`pType da ação ${index + 1} deve ser 1 ou 2.`);
    const parentRID = item.parentRID === undefined ? "-1" : String(item.parentRID);
    if (!/^-?\d+$/.test(parentRID)) throw new Error(`parentRID da ação ${index + 1} deve ser numérico.`);
    if (!Array.isArray(item.parameters)) throw new Error(`parameters da ação ${index + 1} deve ser uma lista.`);
    const parameters = item.parameters.map((parameter, parameterIndex) => parseParameter(parameter, index, parameterIndex));
    const names = parameters.map(({ name }) => name);
    if (new Set(names).size !== names.length) throw new Error(`A ação ${index + 1} contém parâmetros duplicados.`);
    const normalized = {
      formId, componentId, ruleName, pType: pType as "1" | "2", parentRID, parameters,
      destructive: item.destructive === true,
      requiresRecordId: item.requiresRecordId === true,
      refreshAfter: item.refreshAfter !== false,
      source: sourceName,
    };
    const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const key = `${formId}:${componentId}`;
    if (registry.has(key)) throw new Error(`Existe mais de um contrato para o botão ${key}.`);
    registry.set(key, { ...normalized, fingerprint });
  }
  return registry;
}

export function customActionKey(formId: string, componentId: string): string { return `${formId}:${componentId}`; }

function parseParameter(value: unknown, actionIndex: number, parameterIndex: number): CustomActionParameter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Parâmetro ${parameterIndex + 1} da ação ${actionIndex + 1} é inválido.`);
  const item = value as Record<string, unknown>;
  const name = text(item.name, "nome do parâmetro", 30);
  if (!/^(?:P_\d+|F_\d+_\d+)$/.test(name)) throw new Error(`Parâmetro não autorizado: ${name}.`);
  if (item.source === "literal") return { name, source: "literal", value: String(item.value ?? "") };
  if (item.source === "record_id") return { name, source: "record_id" };
  if (item.source === "component_value") {
    return { name, source: "component_value", componentId: numeric(item.componentId, "componente do parâmetro"), display: item.display === true };
  }
  throw new Error(`Fonte não autorizada para o parâmetro ${name}.`);
}

function numeric(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} deve ser numérico.`);
  return normalized;
}

function text(value: unknown, label: string, max: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || /[\r\n\0]/.test(normalized)) throw new Error(`${label} é inválido.`);
  return normalized;
}
