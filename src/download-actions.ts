import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CustomActionParameter } from "./custom-actions.js";

export type DownloadPathSource =
  | { source: "rule_return"; ruleName: string; pType: "1" | "2"; parentRID: string; parameters: CustomActionParameter[] }
  | { source: "literal"; value: string }
  | { source: "component_value"; componentId: string; display?: boolean };

export type DownloadActionContract = {
  formId: string;
  componentId: string;
  path: DownloadPathSource;
  allowedPathPrefixes: string[];
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxBytes: number;
  requiresRecordId: boolean;
  source: string;
  fingerprint: string;
};

export type DownloadActionRegistry = Map<string, DownloadActionContract>;

export async function loadDownloadActionRegistry(): Promise<DownloadActionRegistry> {
  const file = process.env.APF_DOWNLOAD_ACTIONS_FILE?.trim();
  if (!file) return new Map();
  return parseDownloadActionRegistry(await readFile(file, "utf8"), file);
}

export function parseDownloadActionRegistry(source: string, sourceName = "configuração local"): DownloadActionRegistry {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error(`O registro de downloads em ${sourceName} não contém JSON válido.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("O registro de downloads deve ser um objeto JSON.");
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || !Array.isArray(root.downloads)) throw new Error("O registro de downloads deve usar version=1 e possuir downloads[].");
  const registry: DownloadActionRegistry = new Map();
  for (const [index, raw] of root.downloads.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`O download ${index + 1} é inválido.`);
    const item = raw as Record<string, unknown>;
    const formId = numeric(item.formId, `formId do download ${index + 1}`);
    const componentId = numeric(item.componentId, `componentId do download ${index + 1}`);
    const pathSource = parsePathSource(item.path, index);
    const allowedPathPrefixes = stringList(item.allowedPathPrefixes, `allowedPathPrefixes do download ${index + 1}`, true)
      .map(normalizePrefix);
    const allowedExtensions = stringList(item.allowedExtensions, `allowedExtensions do download ${index + 1}`, true)
      .map((extension) => extension.toLocaleLowerCase("pt-BR"));
    if (allowedExtensions.some((extension) => !/^\.[a-z0-9]{1,12}$/.test(extension))) {
      throw new Error(`allowedExtensions do download ${index + 1} contém uma extensão inválida.`);
    }
    const allowedMimeTypes = stringList(item.allowedMimeTypes ?? [], `allowedMimeTypes do download ${index + 1}`, false)
      .map((mime) => mime.toLocaleLowerCase("pt-BR"));
    if (allowedMimeTypes.some((mime) => !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime))) {
      throw new Error(`allowedMimeTypes do download ${index + 1} contém um MIME inválido.`);
    }
    const maxBytes = Number(item.maxBytes ?? 100 * 1024 * 1024);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
      throw new Error(`maxBytes do download ${index + 1} deve estar entre 1 e 104857600.`);
    }
    const normalized = {
      formId,
      componentId,
      path: pathSource,
      allowedPathPrefixes: [...new Set(allowedPathPrefixes)].sort(),
      allowedExtensions: [...new Set(allowedExtensions)].sort(),
      allowedMimeTypes: [...new Set(allowedMimeTypes)].sort(),
      maxBytes,
      requiresRecordId: item.requiresRecordId === true,
      source: sourceName,
    };
    if (pathSource.source === "literal") validateDownloadServerPath(pathSource.value, normalized);
    const key = downloadActionKey(formId, componentId);
    if (registry.has(key)) throw new Error(`Existe mais de um contrato de download para ${key}.`);
    const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    registry.set(key, { ...normalized, fingerprint });
  }
  return registry;
}

export function downloadActionKey(formId: string, componentId: string): string { return `${formId}:${componentId}`; }

export function validateDownloadServerPath(
  value: string,
  contract: Pick<DownloadActionContract, "allowedPathPrefixes" | "allowedExtensions">,
): string {
  const serverPath = String(value ?? "").trim();
  if (!serverPath || serverPath.length > 2000 || /[\r\n\0?#]/.test(serverPath)) throw new Error("O caminho retornado para download é inválido.");
  if (/^[a-z][a-z0-9+.-]*:/i.test(serverPath) && !/^[a-z]:[\\/]/i.test(serverPath)) throw new Error("Downloads por URL externa não são permitidos.");
  if (/^(?:\\\\|\/\/)/.test(serverPath)) throw new Error("Caminhos de rede não são permitidos para download.");
  const normalized = serverPath.replace(/\\/g, "/");
  if (normalized.split("/").some((segment) => segment === ".." || segment === ".")) throw new Error("O caminho retornado contém navegação relativa.");
  const comparable = normalized.toLocaleLowerCase("pt-BR");
  if (!contract.allowedPathPrefixes.some((prefix) => comparable.startsWith(prefix.toLocaleLowerCase("pt-BR")))) {
    throw new Error("O caminho retornado está fora dos prefixos autorizados pelo contrato.");
  }
  const extension = path.posix.extname(normalized).toLocaleLowerCase("pt-BR");
  if (!contract.allowedExtensions.includes(extension)) throw new Error(`A extensão ${extension || "[sem extensão]"} não é permitida para este download.`);
  return serverPath;
}

export function validateDownloadedContent(
  contentTypeHeader: string | null,
  bodyLength: number,
  contract: Pick<DownloadActionContract, "allowedMimeTypes" | "maxBytes">,
): string {
  if (!Number.isSafeInteger(bodyLength) || bodyLength < 0 || bodyLength > contract.maxBytes) {
    throw new Error(`O arquivo baixado excede o limite de ${contract.maxBytes} bytes deste contrato.`);
  }
  const mimeType = (contentTypeHeader ?? "application/octet-stream").split(";", 1)[0].trim().toLocaleLowerCase("pt-BR") || "application/octet-stream";
  if (/^(?:text\/html|application\/(?:xhtml\+xml|javascript))$/.test(mimeType)) throw new Error("O endpoint de download retornou conteúdo executável ou HTML em vez de arquivo.");
  if (contract.allowedMimeTypes.length && !contract.allowedMimeTypes.includes(mimeType)) {
    throw new Error(`O tipo ${mimeType} não é permitido para este download.`);
  }
  return mimeType;
}

export function safeDownloadFilename(contentDisposition: string | null, serverPath: string): string {
  let candidate = "";
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(contentDisposition ?? "")?.[1];
  if (encoded) {
    try { candidate = decodeURIComponent(encoded); } catch { candidate = ""; }
  }
  if (!candidate) candidate = /filename\s*=\s*"([^"]+)"/i.exec(contentDisposition ?? "")?.[1]
    ?? /filename\s*=\s*([^;\s]+)/i.exec(contentDisposition ?? "")?.[1]
    ?? path.posix.basename(serverPath.replace(/\\/g, "/"));
  const sanitized = candidate.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/^\.+/, "").trim();
  return (sanitized || "download.bin").slice(0, 180);
}

function parsePathSource(value: unknown, index: number): DownloadPathSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`path do download ${index + 1} é inválido.`);
  const item = value as Record<string, unknown>;
  if (item.source === "literal") return { source: "literal", value: text(item.value, "caminho literal", 2000) };
  if (item.source === "component_value") {
    return { source: "component_value", componentId: numeric(item.componentId, "componente do caminho"), display: item.display === true };
  }
  if (item.source === "rule_return") {
    const pType = item.pType === undefined ? "2" : String(item.pType);
    if (pType !== "1" && pType !== "2") throw new Error(`pType do download ${index + 1} deve ser 1 ou 2.`);
    const parentRID = item.parentRID === undefined ? "-1" : String(item.parentRID);
    if (!/^-?\d+$/.test(parentRID)) throw new Error(`parentRID do download ${index + 1} deve ser numérico.`);
    return {
      source: "rule_return",
      ruleName: text(item.ruleName, `ruleName do download ${index + 1}`, 200),
      pType: pType as "1" | "2",
      parentRID,
      parameters: parseParameters(item.parameters ?? [], index),
    };
  }
  throw new Error(`Fonte de caminho não autorizada no download ${index + 1}.`);
}

function parseParameters(value: unknown, downloadIndex: number): CustomActionParameter[] {
  if (!Array.isArray(value)) throw new Error(`parameters do download ${downloadIndex + 1} deve ser uma lista.`);
  const parameters = value.map((raw, parameterIndex): CustomActionParameter => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Parâmetro ${parameterIndex + 1} do download ${downloadIndex + 1} é inválido.`);
    const item = raw as Record<string, unknown>;
    const name = text(item.name, "nome do parâmetro", 30);
    if (!/^(?:P_\d+|F_\d+_\d+)$/.test(name)) throw new Error(`Parâmetro de download não autorizado: ${name}.`);
    if (item.source === "literal") return { name, source: "literal", value: String(item.value ?? "") };
    if (item.source === "record_id") return { name, source: "record_id" };
    if (item.source === "component_value") return { name, source: "component_value", componentId: numeric(item.componentId, "componente do parâmetro"), display: item.display === true };
    throw new Error(`Fonte não autorizada para o parâmetro ${name}.`);
  });
  if (new Set(parameters.map(({ name }) => name)).size !== parameters.length) throw new Error(`O download ${downloadIndex + 1} contém parâmetros duplicados.`);
  return parameters;
}

function normalizePrefix(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  if ((!normalized.startsWith("/") && !/^[a-z]:\//i.test(normalized)) || !normalized.endsWith("/") || normalized.includes("../") || /[\r\n\0?#]/.test(normalized)) {
    throw new Error(`Prefixo de download inválido: ${value}.`);
  }
  return normalized;
}

function stringList(value: unknown, label: string, required: boolean): string[] {
  if (!Array.isArray(value) || (required && !value.length)) throw new Error(`${label} deve ser uma lista${required ? " não vazia" : ""}.`);
  return value.map((entry) => text(entry, label, 2000));
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
