import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function installationRoot({ platform = process.platform, userHome, env = process.env }) {
  const p = platform === "win32" ? path.win32 : path.posix;
  return platform === "win32" ? p.join(env.LOCALAPPDATA || p.join(userHome, "AppData", "Local"), "AgilePointMCP")
    : platform === "darwin" ? p.join(userHome, "Library", "Application Support", "AgilePointMCP")
      : p.join(env.XDG_DATA_HOME || p.join(userHome, ".local", "share"), "agilepoint-mcp");
}

export async function inspectRegistrations(document) {
  const verified = [], suspicious = [];
  for (const [name, entry] of Object.entries(document?.mcpServers ?? {})) {
    const scripts = Array.isArray(entry?.args) ? entry.args.filter(arg => typeof arg === "string" && path.isAbsolute(arg) && /[\\/]dist[\\/]index\.js$/.test(arg)) : [];
    const looksOurs = /agilepoint/i.test(name) && (scripts.some(arg => /agilepoint/i.test(arg)) || Object.keys(entry?.env ?? {}).some(key => key.startsWith("APF_")));
    if (scripts.length !== 1) { if (looksOurs) suspicious.push(name); continue; }
    const root = path.dirname(path.dirname(scripts[0]));
    try {
      const manifest = JSON.parse(await regularText(path.join(root, "package.json")));
      if (manifest.name !== "agilepoint-apf-mcp" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) { if (looksOurs) suspicious.push(name); continue; }
      const code = await regularText(path.join(root, "dist", "index.js"));
      let marker;
      try { marker = JSON.parse(await regularText(path.join(root, ".agilepoint-install.json"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (marker) {
        const digest = createHash("sha256").update(await regularText(path.join(root, "package-lock.json"))).update(code).digest("hex");
        if (marker.status !== "ready" || marker.version !== manifest.version || marker.digest !== digest) throw new Error("Instalação alterada");
      } else if (!/name\s*:\s*["']agilepoint-apf["']/.test(code) || !/McpServer/.test(code)) {
        throw new Error("Instalação sem identificação verificável");
      }
      let stockPolicy = false;
      if (entry.env?.APF_CAPABILITIES_FILE && path.resolve(entry.env.APF_CAPABILITIES_FILE) === path.join(root, "capabilities.json")) {
        try {
          const hash = createHash("sha256").update(await regularText(entry.env.APF_CAPABILITIES_FILE)).digest("hex");
          stockPolicy = ["0ea426979d6c7b8820843ad67e2b6861f502e548e83498eba23aa92f32fcf6ed", "11b67054a466d3a3244a759aafbba2b17d30ea7aad37838abc353590a922f664"].includes(hash);
        } catch { /* Não ampliar acesso quando a política antiga não puder ser validada. */ }
      }
      verified.push({ name, root, version: manifest.version, entry, legacy: !marker, stockPolicy });
    } catch { if (looksOurs || scripts[0].toLowerCase().includes("agilepoint")) suspicious.push(name); }
  }
  return { verified, suspicious };
}

async function regularText(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024) throw new Error("Arquivo de instalação inválido");
  return fs.readFile(file, "utf8");
}

const retainedKeys = new Set(["APF_BASE_URL", "APF_INSTALL_STATE_FILE", "APF_AUDIT_DIR", "APF_APPROVAL_DIR", "APF_EXPORT_DIR", "APF_UPLOAD_DIR", "APF_CUSTOM_ACTIONS_FILE", "APF_UPLOAD_ACTIONS_FILE", "APF_DOWNLOAD_ACTIONS_FILE", "APF_AUDIT_INCLUDE_VALUES", "APF_HTTP_TIMEOUT_MS", "APF_HTTP_MAX_RESPONSE_BYTES", "APF_REPORT_MAX_BYTES", "APF_PAGINATION_MAX_BYTES", "APF_PAGINATION_MAX_ROWS", "APF_MAX_PENDING_SIMULATIONS", "APF_MAX_PENDING_SIMULATION_BYTES", "APF_MAX_APPROVAL_RECORDS", "APF_MAX_APPROVAL_STORAGE_BYTES", "APF_APPROVAL_RETENTION_DAYS"]);

export function migratedConfiguration(entry, registrations) {
  const clientPolicy = {};
  for (const key of ["enabled_tools", "disabled_tools", "alwaysAllow", "autoApprove", "timeout", "startup_timeout_sec", "tool_timeout_sec"]) {
    const values = registrations.map(item => item.entry[key]).filter(value => value !== undefined);
    if (new Set(values.map(value => JSON.stringify(value))).size > 1) throw new Error("MIGRACAO_CONFLITANTE: conexões antigas usam políticas diferentes no cliente de IA; configuração preservada.");
    if (values.length) clientPolicy[key] = values[0];
  }
  const customEnvironments = registrations.map(registration => {
    const env = Object.fromEntries(Object.entries(registration.entry.env ?? {}).filter(([key]) => retainedKeys.has(key)));
    const policy = registration.entry.env?.APF_CAPABILITIES_FILE;
    if (policy && (!registration.stockPolicy || path.resolve(policy) !== path.join(registration.root, "capabilities.json"))) env.APF_CAPABILITIES_FILE = policy;
    if (registration.entry.env?.APF_WRITE_ENABLED === "false" || registration.entry.env?.APF_WRITE_ENABLED === false) env.APF_WRITE_ENABLED = "false";
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string") throw new Error("MIGRACAO_ENV_INVALIDO: uma configuração antiga possui tipo inválido; arquivo preservado.");
      if (/(?:_DIR|_FILE)$/.test(key) && !path.isAbsolute(value)) throw new Error("MIGRACAO_DIRETORIO_INVALIDO: há um caminho antigo relativo; identifique o destino correto antes de atualizar.");
    }
    if (env.APF_BASE_URL) {
      let url;
      try { url = new URL(env.APF_BASE_URL); } catch {}
      if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        throw new Error("MIGRACAO_URL_INVALIDA: a origem antiga não é HTTPS válida ou contém credenciais/caminho; configuração preservada sem copiar esse valor.");
      }
    }
    return env;
  });
  const allKeys = [...new Set(customEnvironments.flatMap(env => Object.keys(env)))];
  for (const key of allKeys) {
    const values = new Set(customEnvironments.map(env => env[key]).filter(value => value !== undefined));
    if (values.size > 1) throw new Error("MIGRACAO_CONFLITANTE: conexões antigas usam pastas ou políticas diferentes; nenhuma conexão foi alterada. Identifique qual instalação deve ser atualizada.");
  }
  const disabled = new Set(registrations.map(item => Boolean(item.entry.disabled || item.entry.enabled === false)));
  if (disabled.size > 1) throw new Error("MIGRACAO_CONFLITANTE: conexões antigas possuem estados de ativação diferentes; configuração preservada.");
  return { ...entry, ...clientPolicy, ...(disabled.has(true) ? { disabled: true } : {}), env: { ...entry.env, ...Object.assign({}, ...customEnvironments) } };
}

// Lê somente o formato de tabelas padrão do cliente. Formatos TOML alternativos
// são preservados e recusados, sem interpretar comandos ou reescrever o documento.
export function codexRegistrationDocument(text) {
  const headers = [];
  let offset = 0, multiline = null;
  for (const line of text.split(/(?<=\n)/)) {
    if (!multiline) {
      const header = /^\s*\[([^\[\]\r\n]+)\]\s*(?:#.*)?$/.exec(line.trimEnd());
      if (header) headers.push({ start: offset, header: header[1] });
    }
    let quoted = null;
    for (let i = 0; i < line.length; i++) {
      if (multiline) { if (line.startsWith(multiline, i) && line[i - 1] !== "\\") { i += 2; multiline = null; } continue; }
      if (quoted) { if (line[i] === quoted && (quoted === "'" || line[i - 1] !== "\\")) quoted = null; continue; }
      if (line[i] === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { multiline = line.slice(i, i + 3); i += 2; }
      else if (line[i] === '"' || line[i] === "'") quoted = line[i];
    }
    offset += line.length;
  }
  if (multiline) throw new Error("MIGRACAO_TOML_INVALIDO: texto multilinha não encerrado; arquivo preservado.");
  const mcpServers = Object.create(null), ranges = [];
  for (let index = 0; index < headers.length; index++) {
    const header = headers[index];
    const match = /^\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))(\s*\.\s*(?:env|"env"|'env'))?\s*$/.exec(header.header);
    if (!match) {
      const nested = /^\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*\./.exec(header.header);
      if (nested) (mcpServers[nested[1] ?? nested[2] ?? nested[3]] ??= Object.create(null)).__unsupported = true;
      continue;
    }
    const name = match[1] ?? match[2] ?? match[3];
    const end = headers[index + 1]?.start ?? text.length;
    const section = text.slice(header.start, end);
    const body = section.slice(section.indexOf("\n") + 1);
    const server = mcpServers[name] ??= Object.create(null);
    const target = match[4] ? (server.env ??= Object.create(null)) : server;
    const lines = body.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const assignment = /^\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*=\s*(.*?)\s*$/.exec(line);
      if (!assignment) { target.__unsupported = true; continue; }
      const key = assignment[1] ?? assignment[2] ?? assignment[3];
      let value = assignment[4];
      if (value.trimStart().startsWith("[")) {
        while (!stripTomlComments(value).trimEnd().endsWith("]") && lineIndex + 1 < lines.length) value += "\n" + lines[++lineIndex];
      }
      try {
        target[key] = basicTomlValue(stripTomlComments(value).trim());
      } catch { target.__unsupported = true; }
    }
    ranges.push({ name, start: header.start, end });
  }
  return { mcpServers, ranges };
}

function stripTomlComments(text) {
  let result = "", quote = null, comment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (comment) { if (char === "\n") { comment = false; result += char; } continue; }
    if (!quote && char === "#") { comment = true; continue; }
    result += char;
    if (quote === '"' && char === "\\") { result += text[++index] ?? ""; continue; }
    if (quote && char === quote) quote = null;
    else if (!quote && (char === '"' || char === "'")) quote = char;
  }
  return result;
}

function basicTomlValue(value) {
  if (value.startsWith("'")) { if (!/^'[^'\r\n]*'$/.test(value)) throw new Error("Literal não suportado"); return value.slice(1, -1); }
  if (!value.startsWith("[")) return JSON.parse(value);
  if (!value.endsWith("]")) throw new Error("Array incompleto");
  const items = []; let token = "", quote = null;
  for (let index = 1; index < value.length - 1; index++) {
    const char = value[index];
    if (!quote && char === ",") { if (!token.trim()) throw new Error("Item vazio"); items.push(basicTomlValue(token.trim())); token = ""; continue; }
    token += char;
    if (quote === '"' && char === "\\") { token += value[++index] ?? ""; continue; }
    if (quote === char) quote = null;
    else if (!quote && (char === "'" || char === '"')) quote = char;
  }
  if (quote) throw new Error("Texto incompleto");
  if (token.trim()) items.push(basicTomlValue(token.trim()));
  return items;
}

export function removeCodexRegistrations(text, ranges, names) {
  for (const range of [...ranges].filter(range => names.includes(range.name)).sort((a, b) => b.start - a.start)) text = text.slice(0, range.start) + text.slice(range.end);
  return text;
}

export function removeManagedCodexBlock(text) {
  const begin = "# BEGIN AGILEPOINT MCP MANAGED", end = "# END AGILEPOINT MCP MANAGED";
  const starts = text.split(begin).length - 1, ends = text.split(end).length - 1;
  if (!starts && !ends) return text;
  const first = text.indexOf(begin), last = text.indexOf(end);
  if (starts !== 1 || ends !== 1 || last < first) throw new Error("MIGRACAO_TOML_INVALIDO: bloco gerenciado inválido; configuração preservada.");
  return text.slice(0, first) + text.slice(last + end.length).replace(/^\r?\n/, "");
}
