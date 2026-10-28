import JSON5 from "json5";
import { load } from "cheerio";
import { parseWebrunAssignment, type MenuPermission } from "./internal-api.js";
import type { ScreenAction, ScreenDescription, ScreenField, ScreenSummary, ScreenTable } from "./session.js";

type Component = { id: string; className: string; args: unknown[] };

export type WebrunFormFieldState = {
  componentId: string;
  inputName: string;
  displayInputName?: string;
  className: string;
  value: string;
  displayValue?: string;
};

export type WebrunFormState = {
  csrfToken: string;
  fields: WebrunFormFieldState[];
};

export function extractWebrunStringProperty(source: string, componentId: string, property: string): string | null {
  if (!/^\d+$/.test(componentId) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(property)) return null;
  const match = new RegExp(`d\\.c_${componentId}\\.${property}\\s*=\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))\\s*;`).exec(source);
  if (!match) return null;
  try {
    const value = JSON5.parse(match[1]);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function parseAuthorizedMenuXml(xml: string, permissions: Map<string, MenuPermission>): ScreenSummary[] {
  const $ = load(xml, { xmlMode: true });
  const unique = new Map<string, ScreenSummary>();
  $("MENU").each((_, element) => {
    const current = $(element);
    const ancestors = current.parents("MENU").addBack();
    const allowed = ancestors.toArray().every((node) => {
      const item = $(node);
      const code = item.attr("CODE")?.trim() ?? "";
      if (!/^\d{1,19}$/.test(code)) return false;
      const permission = permissions.get(BigInt(code).toString());
      const xmlVisible = item.children("VISIBLE").first().text().trim().toLocaleLowerCase("pt-BR") !== "false";
      return xmlVisible && (!permission || (permission.visible && permission.enabled));
    });
    const formId = current.children("FORM").first().text().trim();
    const name = cleanText(current.children("DESCRIPTION").first().text());
    if (!/^\d+$/.test(formId) || !name || !allowed) return;
    if (/^(sair|logout|logoff|entrar|senha|alterar senha)\b/i.test(name)) return;
    const key = `form:${formId}`;
    if (!unique.has(key)) unique.set(key, { ref: key, nome: name, formulario_id: formId, visivel: true, origem: "menu" });
  });
  return [...unique.values()].sort((left, right) => left.nome.localeCompare(right.nome, "pt-BR"));
}

export function parseWebrunScreenDescription(source: string, url: string, requestedFormId: string): ScreenDescription {
  const formId = quotedVariable(source, "idForm") ?? requestedFormId;
  const name = quotedVariable(source, "formDescription") ?? `Formulário ${formId}`;
  const components = parseComponents(source);
  const fields = components.flatMap((component) => componentField(source, component));
  const actions = [
    ...navigationActions(source),
    ...components.flatMap((component) => componentAction(source, component)),
  ];
  const tables = components
    .filter((component) => /Grid|Table/i.test(component.className))
    .map((component) => componentTable(source, component))
    .filter((table): table is ScreenTable => table !== null);
  const tabs = [...source.matchAll(/d\.t\.add\(\s*((?:'(?:(?:\\.)|[^'\\])*')|(?:"(?:(?:\\.)|[^"\\])*"))/g)]
    .flatMap((match) => parseString(match[1]) ?? [])
    .map(cleanText)
    .filter(Boolean);
  return {
    nome: name,
    url,
    formulario_id: formId,
    registro_id_origem: stableRecordId(source),
    abas_ativas: tabs.length ? [tabs[0]] : [],
    campos: deduplicate(fields, (field) => field.ref),
    acoes: deduplicate(actions, (action) => action.ref),
    tabelas: deduplicate(tables, (table) => table.ref),
    alertas: deniedDocument(source) ? ["O servidor informou que a conta não possui acesso a este formulário."] : [],
    consultado_em: new Date().toISOString(),
  };
}

function stableRecordId(source: string): string | null {
  const value = quotedVariable(source, "pkeys")?.trim() ?? "";
  return value && value.length <= 500 && /^[A-Za-z0-9_.:,|+-]+$/.test(value) ? value : null;
}

export function deniedDocument(source: string): boolean {
  return /Acesso negado|WFRUserNotLogged|sem permiss.o|n.o possui permiss.o/i.test(source);
}

export function parseWebrunFormState(source: string): WebrunFormState {
  const $ = load(source);
  const csrfToken = $('input[name="WEBRUN-CSRFTOKEN"]').attr("value")?.trim() ?? "";
  const fields = parseComponents(source).flatMap((component): WebrunFormFieldState[] => {
    if (/Button|Grid|Table|Label|Image|Container|Navigation/i.test(component.className)) return [];
    const explicitValue = assignedCallString(source, component.id, "setValue");
    if (/Hidden/i.test(component.className)) {
      return [{
        componentId: component.id,
        inputName: `WFRInput${component.id}`,
        className: component.className,
        value: explicitValue ?? String(component.args[3] ?? ""),
      }];
    }
    const lookup = /Lookup/i.test(component.className);
    const value = explicitValue ?? String(component.args[8] ?? "");
    return [{
      componentId: component.id,
      inputName: `WFRInput${component.id}`,
      ...(lookup ? { displayInputName: `WFRInput${component.id}Show` } : {}),
      className: component.className,
      value,
      ...(lookup ? { displayValue: String(component.args[9] ?? "") } : {}),
    }];
  });
  return { csrfToken, fields };
}

function parseComponents(source: string): Component[] {
  const components: Component[] = [];
  const pattern = /d\.c_(\d+)\s*=\s*new\s+(HTML[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  for (const match of source.matchAll(pattern)) {
    try {
      const args = JSON5.parse(`[${match[3]}]`) as unknown[];
      components.push({ id: match[1], className: match[2], args });
    } catch {
      // Componentes com expressões de cliente não são executados nem inferidos.
    }
  }
  return components;
}

function componentField(source: string, component: Component): ScreenField[] {
  if (!/(Edit|Lookup|Combo|Select|Check|Radio|Memo|TextArea|Date|Time|Upload|File|Password)/i.test(component.className)) return [];
  if (/Hidden|Button|Grid|Table|Label|Image|Container/i.test(component.className)) return [];
  const constructorLabel = cleanText(String(component.args[7] ?? ""));
  const label = constructorLabel || cleanText(String(assignedString(source, component.id, "label") ?? `Componente ${component.id}`));
  const assignedId = assignedString(source, component.id, "id");
  const sensitive = /senha|password|token|secret/i.test(`${label} ${assignedId ?? ""} ${component.className}`);
  const lookup = /Lookup/i.test(component.className);
  const value = sensitive ? "[PROTEGIDO]" : cleanText(String(lookup ? component.args[9] ?? "" : component.args[8] ?? ""));
  const options = parseOptions(source, component.id, value);
  return [{
    ref: `component:${component.id}`,
    rotulo: label,
    tipo: componentType(component.className),
    sensivel: sensitive,
    valor: value,
    obrigatorio: new RegExp(`d\\.c_${component.id}\\.(?:required|obrigatorio)\\s*=\\s*true`, "i").test(source),
    desabilitado: new RegExp(`d\\.c_${component.id}\\.(?:readonly|disabled)\\s*=\\s*true|d\\.c_${component.id}\\.enabled\\s*=\\s*false`, "i").test(source),
    ...(options.length ? { opcoes: options } : {}),
  }];
}

function componentAction(source: string, component: Component): ScreenAction[] {
  if (!/(?:Button|Link)/i.test(component.className)) return [];
  const rawLabel = String(component.args[7] ?? assignedString(source, component.id, "label") ?? "");
  const label = cleanText(stripHtml(rawLabel));
  if (!label) return [];
  return [{
    ref: `component:${component.id}`,
    rotulo: label,
    tipo: /Link/i.test(component.className) ? "link" : "button",
    desabilitado: new RegExp(`d\\.c_${component.id}\\.(?:disabled\\s*=\\s*true|enabled\\s*=\\s*false|setEnabled\\(\\s*false)`, "i").test(source),
  }];
}

function componentTable(source: string, component: Component): ScreenTable | null {
  return parseWebrunScreenTable(source, component.id);
}

export function parseWebrunScreenTable(
  source: string,
  componentId: string,
  rowsOverride?: Array<Record<string, unknown>>,
  maxRows = 100,
): ScreenTable | null {
  if (!/^\d+$/.test(componentId) || !Number.isInteger(maxRows) || maxRows < 1) return null;
  const columns = parseWebrunAssignment<Array<Record<string, unknown>>>(source, `cols_${componentId}`) ?? [];
  const rows = rowsOverride ?? parseWebrunAssignment<Array<Record<string, unknown>>>(source, `data_${componentId}`) ?? [];
  if (!columns.length && !rows.length) return null;
  const visibleColumns = columns.filter((column) => column.visible !== false && column.visible !== "false");
  const names = visibleColumns.map((column) => String(column.name ?? ""));
  const titles = visibleColumns.map((column, index) => cleanText(stripHtml(String(column.title ?? names[index] ?? ""))));
  const limited = rows.slice(0, maxRows);
  return {
    ref: `component:${componentId}`,
    colunas: titles,
    linhas: limited.map((row) => names.map((name) => cleanText(stripHtml(String(row[name] ?? ""))))),
    linhas_visiveis: limited.length,
    truncada: rows.length > limited.length,
  };
}

function navigationActions(source: string): ScreenAction[] {
  if (!/new\s+HTMLNavigationForm\s*\(/.test(source) || /d\.n\.hideButtons\s*=\s*true/i.test(source)) return [];
  const definitions = [
    ["nav:include", "Incluir", "btInclude"],
    ["nav:edit", "Alterar registro", "btEdit"],
    ["nav:delete", "Excluir registro", "btDelete"],
    ["nav:refresh", "Atualizar", "btRefresh"],
    ["nav:log", "Log", "btLog"],
    ["nav:defaults", "Valores padrão", "btDefaultValues"],
    ["nav:save", "Gravar registro", "btSave"],
    ["nav:cancel", "Cancelar", "btCancel"],
  ] as const;
  return definitions.map(([ref, label, property]) => ({
    ref,
    rotulo: label,
    tipo: "navigation",
    desabilitado: new RegExp(`d\\.n\\.${property}\\.setEnabled\\(\\s*false\\s*\\)`, "i").test(source),
  }));
}

function parseOptions(source: string, componentId: string, selected: string): NonNullable<ScreenField["opcoes"]> {
  const options: NonNullable<ScreenField["opcoes"]> = [];
  const keys = assignedArray(source, componentId, "keys");
  const values = assignedArray(source, componentId, "values");
  if (keys && values && keys.length === values.length && keys.length <= 500) {
    for (let index = 0; index < keys.length; index += 1) {
      const value = keys[index];
      const label = values[index];
      if ((typeof value !== "string" && typeof value !== "number") || (typeof label !== "string" && typeof label !== "number")) continue;
      const optionValue = String(value);
      const optionLabel = cleanText(String(label));
      options.push({ valor: optionValue, texto: optionLabel, selecionada: normalize(optionValue) === normalize(selected) || normalize(optionLabel) === normalize(selected) });
    }
  }
  const pattern = new RegExp(`d\\.c_${componentId}\\.(?:addOption|addItem)\\(\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))\\s*,\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))`, "g");
  for (const match of source.matchAll(pattern)) {
    const value = parseString(match[1]);
    const text = parseString(match[2]);
    if (value === null || text === null) continue;
    options.push({ valor: value, texto: cleanText(text), selecionada: normalize(value) === normalize(selected) || normalize(text) === normalize(selected) });
  }
  return deduplicate(options, (option) => `${option.valor}\0${option.texto}`);
}

function assignedArray(source: string, componentId: string, property: string): unknown[] | null {
  const match = new RegExp(`d\\.c_${componentId}\\.${property}\\s*=\\s*(\\[[^;]{0,20000}\\])\\s*;`).exec(source);
  if (!match) return null;
  try {
    const value: unknown = JSON5.parse(match[1]);
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

function componentType(className: string): string {
  if (/Lookup/i.test(className)) return "lookup";
  if (/Check/i.test(className)) return "checkbox";
  if (/Radio/i.test(className)) return "radio";
  if (/Combo|Select/i.test(className)) return "select";
  if (/Memo|TextArea/i.test(className)) return "textarea";
  if (/Date/i.test(className)) return "date";
  if (/Time/i.test(className)) return "time";
  if (/Upload|File/i.test(className)) return "file";
  if (/Password/i.test(className)) return "password";
  return "text";
}

function quotedVariable(source: string, name: string): string | null {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return null;
  const match = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))`).exec(source);
  return match ? parseString(match[1]) : null;
}

function assignedString(source: string, componentId: string, property: string): string | null {
  const match = new RegExp(`d\\.c_${componentId}\\.${property}\\s*=\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))`).exec(source);
  return match ? parseString(match[1]) : null;
}

function assignedCallString(source: string, componentId: string, method: string): string | null {
  const match = new RegExp(`d\\.c_${componentId}\\.${method}\\(\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))\\s*\\)`).exec(source);
  return match ? parseString(match[1]) : null;
}

function parseString(source: string): string | null {
  try {
    const value = JSON5.parse(source);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return load(`<div>${value}</div>`)("div").text();
}

function cleanText(value: string): string { return value.replace(/\s+/g, " ").trim(); }

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function deduplicate<T>(items: T[], key: (item: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const item of items) if (!unique.has(key(item))) unique.set(key(item), item);
  return [...unique.values()];
}
