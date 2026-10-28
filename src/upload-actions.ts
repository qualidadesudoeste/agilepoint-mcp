import { createHash } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { CustomActionParameter } from "./custom-actions.js";

export type UploadActionContract = {
  formId: string;
  componentId: string;
  ruleName: string;
  validationRule: string;
  multiple: boolean;
  parameters: CustomActionParameter[];
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  maxBytes: number;
  requiresRecordId: boolean;
  refreshAfter: boolean;
  source: string;
  fingerprint: string;
};

export type UploadActionRegistry = Map<string, UploadActionContract>;

export async function loadUploadActionRegistry(): Promise<UploadActionRegistry> {
  const file = process.env.APF_UPLOAD_ACTIONS_FILE?.trim();
  if (!file) return new Map();
  return parseUploadActionRegistry(await readFile(file, "utf8"), file);
}

export function parseUploadActionRegistry(source: string, sourceName = "configuração local"): UploadActionRegistry {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error(`O registro de uploads em ${sourceName} não contém JSON válido.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("O registro de uploads deve ser um objeto JSON.");
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || !Array.isArray(root.uploads)) throw new Error("O registro de uploads deve usar version=1 e possuir uploads[].");
  const registry: UploadActionRegistry = new Map();
  for (const [index, raw] of root.uploads.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`O upload ${index + 1} é inválido.`);
    const item = raw as Record<string, unknown>;
    const formId = numeric(item.formId, `formId do upload ${index + 1}`);
    const componentId = numeric(item.componentId, `componentId do upload ${index + 1}`);
    const ruleName = text(item.ruleName, `ruleName do upload ${index + 1}`, 200);
    const validationRule = item.validationRule === undefined || item.validationRule === null ? "" : text(item.validationRule, `validationRule do upload ${index + 1}`, 200);
    const parameters = item.parameters === undefined ? [] : parseParameters(item.parameters, index);
    const allowedExtensions = stringList(item.allowedExtensions, `allowedExtensions do upload ${index + 1}`, true)
      .map((extension) => extension.toLocaleLowerCase("pt-BR"));
    if (allowedExtensions.some((extension) => !/^\.[a-z0-9]{1,12}$/.test(extension))) {
      throw new Error(`allowedExtensions do upload ${index + 1} contém uma extensão inválida.`);
    }
    const allowedMimeTypes = stringList(item.allowedMimeTypes ?? [], `allowedMimeTypes do upload ${index + 1}`, false)
      .map((mime) => mime.toLocaleLowerCase("pt-BR"));
    if (allowedMimeTypes.some((mime) => !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime))) {
      throw new Error(`allowedMimeTypes do upload ${index + 1} contém um MIME inválido.`);
    }
    const maxBytes = Number(item.maxBytes ?? 25 * 1024 * 1024);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) {
      throw new Error(`maxBytes do upload ${index + 1} deve estar entre 1 e 104857600.`);
    }
    const normalized = {
      formId,
      componentId,
      ruleName,
      validationRule,
      multiple: item.multiple === true,
      parameters,
      allowedExtensions: [...new Set(allowedExtensions)].sort(),
      allowedMimeTypes: [...new Set(allowedMimeTypes)].sort(),
      maxBytes,
      requiresRecordId: item.requiresRecordId === true,
      refreshAfter: item.refreshAfter !== false,
      source: sourceName,
    };
    const key = uploadActionKey(formId, componentId);
    if (registry.has(key)) throw new Error(`Existe mais de um contrato de upload para ${key}.`);
    const fingerprint = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    registry.set(key, { ...normalized, fingerprint });
  }
  return registry;
}

export function uploadActionKey(formId: string, componentId: string): string { return `${formId}:${componentId}`; }

export async function validateUploadFile(file: string, contract: UploadActionContract): Promise<{
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
  body: Buffer;
}> {
  const configured = process.env.APF_UPLOAD_DIR?.trim();
  if (!configured) throw new Error("Uploads estão desativados. Defina APF_UPLOAD_DIR para um diretório local restrito.");
  const root = await realpath(path.resolve(configured));
  const target = await realpath(path.resolve(file));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    if (target === root) throw new Error("Informe um arquivo, não o diretório de upload.");
    throw new Error("O arquivo precisa estar dentro de APF_UPLOAD_DIR.");
  }
  const extension = path.extname(target).toLocaleLowerCase("pt-BR");
  if (!contract.allowedExtensions.includes(extension)) throw new Error(`A extensão ${extension || "[sem extensão]"} não é permitida para este upload.`);
  const handle = await open(target, "r");
  try {
    const openedMetadata = await handle.stat();
    const currentTarget = await realpath(target);
    const pathMetadata = await stat(currentTarget);
    if (currentTarget !== target || !openedMetadata.isFile() || openedMetadata.dev !== pathMetadata.dev || openedMetadata.ino !== pathMetadata.ino) {
      throw new Error("O arquivo de upload mudou ou passou a apontar para outro local durante a validação.");
    }
    if (openedMetadata.size > contract.maxBytes) throw new Error(`O arquivo excede o limite de ${contract.maxBytes} bytes deste contrato.`);
    const body = await handle.readFile();
    const afterRead = await handle.stat();
    if (body.length !== openedMetadata.size || afterRead.size !== openedMetadata.size || afterRead.mtimeMs !== openedMetadata.mtimeMs) {
      throw new Error("O arquivo de upload foi alterado durante a leitura. Simule novamente.");
    }
    const mimeType = detectContentMime(body, extension);
    if (contract.allowedMimeTypes.length && !contract.allowedMimeTypes.includes(mimeType)) {
      throw new Error(`O conteúdo do arquivo é ${mimeType}, que não é permitido para este upload.`);
    }
    return {
      path: target,
      filename: path.basename(target),
      mimeType,
      size: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      body,
    };
  } finally {
    await handle.close();
  }
}

export function parseWebrunUploadForm(source: string, currentUrl: string): {
  actionUrl: string;
  fileField: string;
  hiddenFields: Record<string, string>;
} {
  const $ = load(source);
  const form = $("form").filter((_, element) => {
    const enctype = ($(element).attr("enctype") ?? "").toLocaleLowerCase("pt-BR");
    return enctype.includes("multipart/form-data") && $(element).find('input[type="file"]').length > 0;
  }).first();
  if (!form.length) throw new Error("O Webrun não publicou o formulário multipart esperado.");
  const method = (form.attr("method") ?? "post").toLocaleLowerCase("pt-BR");
  if (method !== "post") throw new Error("O formulário de upload não usa POST.");
  const fileInput = form.find('input[type="file"]').first();
  const fileField = fileInput.attr("name")?.trim() ?? "";
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(fileField)) throw new Error("O campo de arquivo publicado pelo Webrun é inválido.");
  const actionUrl = new URL(form.attr("action") || currentUrl, currentUrl);
  const origin = new URL(currentUrl).origin;
  if (actionUrl.origin !== origin || actionUrl.pathname !== "/upload.jsp") throw new Error("O formulário de upload tentou enviar para um endpoint não autorizado.");
  const hiddenFields: Record<string, string> = {};
  form.find('input[type="hidden"][name]').each((_, element) => {
    const name = $(element).attr("name")?.trim() ?? "";
    if (/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(name)) hiddenFields[name] = $(element).attr("value") ?? "";
  });
  return { actionUrl: actionUrl.toString(), fileField, hiddenFields };
}

function parseParameters(value: unknown, uploadIndex: number): CustomActionParameter[] {
  if (!Array.isArray(value)) throw new Error(`parameters do upload ${uploadIndex + 1} deve ser uma lista.`);
  const parameters = value.map((raw, parameterIndex): CustomActionParameter => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Parâmetro ${parameterIndex + 1} do upload ${uploadIndex + 1} é inválido.`);
    const item = raw as Record<string, unknown>;
    const name = text(item.name, "nome do parâmetro", 30);
    if (!/^P_\d+$/.test(name)) throw new Error(`Parâmetro de upload não autorizado: ${name}.`);
    if (item.source === "literal") return { name, source: "literal", value: String(item.value ?? "") };
    if (item.source === "record_id") return { name, source: "record_id" };
    if (item.source === "component_value") return { name, source: "component_value", componentId: numeric(item.componentId, "componente do parâmetro"), display: item.display === true };
    throw new Error(`Fonte não autorizada para o parâmetro ${name}.`);
  });
  if (new Set(parameters.map(({ name }) => name)).size !== parameters.length) throw new Error(`O upload ${uploadIndex + 1} contém parâmetros duplicados.`);
  return parameters;
}

function stringList(value: unknown, label: string, required: boolean): string[] {
  if (!Array.isArray(value) || (required && !value.length)) throw new Error(`${label} deve ser uma lista${required ? " não vazia" : ""}.`);
  return value.map((entry) => text(entry, label, 100));
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

export function detectContentMime(body: Buffer, extension = ""): string {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (body.subarray(0, 6).toString("ascii") === "GIF87a" || body.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (isValidPdf(body)) return "application/pdf";
  if (body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const entries = validZipEntryNames(body);
    if (!entries) return "application/octet-stream";
    if (entries.includes("[Content_Types].xml") && entries.some((name) => name.startsWith("word/"))) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (entries.includes("[Content_Types].xml") && entries.some((name) => name.startsWith("xl/"))) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/zip";
  }
  if (isStructuredOle(body)) {
    if (containsUtf16Name(body, "Workbook") || containsUtf16Name(body, "Book")) return "application/vnd.ms-excel";
    if (containsUtf16Name(body, "WordDocument")) return "application/msword";
    return "application/octet-stream";
  }
  const text = body.toString("utf8");
  if (!text.includes("\ufffd") && !text.includes("\0")) {
    const trimmed = text.trimStart();
    if (extension === ".json") {
      try { JSON.parse(text); return "application/json"; } catch { return "text/plain"; }
    }
    if (extension === ".svg" && /^<svg\b/i.test(trimmed.replace(/^<\?xml[^>]*>\s*/i, ""))) return "image/svg+xml";
    if (extension === ".csv") return "text/csv";
    return "text/plain";
  }
  return "application/octet-stream";
}

function isValidPdf(body: Buffer): boolean {
  if (body.length < 32 || !/^%PDF-1\.[0-9]/.test(body.subarray(0, 16).toString("ascii"))) return false;
  const tail = body.subarray(Math.max(0, body.length - 4096)).toString("latin1");
  const eof = tail.lastIndexOf("%%EOF");
  return eof >= 0 && /startxref\s+\d+\s+%%EOF[\s\0]*$/.test(tail.slice(Math.max(0, tail.lastIndexOf("startxref"))));
}

function validZipEntryNames(body: Buffer): string[] | null {
  const minimum = Math.max(0, body.length - 65_557);
  let eocd = -1;
  for (let offset = body.length - 22; offset >= minimum; offset -= 1) {
    if (body.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0 || eocd + 22 > body.length) return null;
  const entries = body.readUInt16LE(eocd + 10);
  const centralSize = body.readUInt32LE(eocd + 12);
  const centralOffset = body.readUInt32LE(eocd + 16);
  if (!entries || entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize > eocd) return null;
  const names: string[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > body.length || body.readUInt32LE(cursor) !== 0x02014b50) return null;
    const nameLength = body.readUInt16LE(cursor + 28);
    const extraLength = body.readUInt16LE(cursor + 30);
    const commentLength = body.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (!nameLength || next > body.length) return null;
    names.push(body.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replace(/\\/g, "/"));
    cursor = next;
  }
  return cursor <= centralOffset + centralSize ? names : null;
}

function isStructuredOle(body: Buffer): boolean {
  if (body.length < 512 || !body.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return false;
  const byteOrder = body.readUInt16LE(28);
  const sectorShift = body.readUInt16LE(30);
  return byteOrder === 0xfffe && (sectorShift === 9 || sectorShift === 12);
}

function containsUtf16Name(body: Buffer, name: string): boolean {
  return body.indexOf(Buffer.from(name, "utf16le"), 512) >= 0;
}
