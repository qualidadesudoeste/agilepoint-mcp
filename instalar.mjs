import { promises as fs, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const clients = ["claude-desktop", "claude-code", "cursor", "vscode", "codex"];
const markerBegin = "# BEGIN AGILEPOINT MCP MANAGED";
const markerEnd = "# END AGILEPOINT MCP MANAGED";

export function configurationPath(client, { platform = process.platform, userHome = homedir(), env = process.env } = {}) {
  if (client === "claude-code") return path.join(userHome, ".claude.json");
  if (client === "cursor") return path.join(userHome, ".cursor", "mcp.json");
  if (client === "codex") return path.join(env.CODEX_HOME || path.join(userHome, ".codex"), "config.toml");
  if (client === "vscode") return path.join(env.COPILOT_HOME || path.join(userHome, ".copilot"), "mcp-config.json");
  if (client === "claude-desktop") {
    if (platform === "win32") return path.join(env.APPDATA || path.join(userHome, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    if (platform === "darwin") return path.join(userHome, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    return path.join(env.XDG_CONFIG_HOME || path.join(userHome, ".config"), "Claude", "claude_desktop_config.json");
  }
  throw new Error("Cliente MCP não suportado.");
}

export function runtimeConfiguration(destination, dataDirectory, nodePath = process.execPath) {
  return {
    type: "stdio",
    command: nodePath,
    args: [path.join(destination, "dist", "index.js")],
    env: {
      APF_AUTH_MODE: "chat",
      APF_CAPABILITIES_FILE: path.join(destination, "capabilities.json"),
      APF_WRITE_ENABLED: "true",
      APF_WRITE_APPROVAL_MODE: "external",
      APF_AUDIT_DIR: path.join(dataDirectory, "auditoria"),
      APF_APPROVAL_DIR: path.join(dataDirectory, "aprovacoes"),
      APF_EXPORT_DIR: path.join(dataDirectory, "exportacoes"),
      APF_UPLOAD_DIR: path.join(dataDirectory, "importacao"),
    },
  };
}

function installedEntry(entry, destination) {
  return Boolean(entry && Array.isArray(entry.args) && entry.args.includes(path.join(destination, "dist", "index.js")));
}

export function mergeJsonConfiguration(document, entry, destination) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("A configuração do cliente não é um objeto JSON.");
  const updated = structuredClone(document);
  if (updated.mcpServers !== undefined && (!updated.mcpServers || typeof updated.mcpServers !== "object" || Array.isArray(updated.mcpServers))) {
    throw new Error("O campo mcpServers existente é inválido; nenhum ajuste foi feito.");
  }
  updated.mcpServers ??= {};
  const names = ["agilepoint", "agilepoint-apf", "agilepoint-apf-v1"];
  const name = names.find((candidate) => !updated.mcpServers[candidate] || installedEntry(updated.mcpServers[candidate], destination));
  if (!name) throw new Error("Há registros conflitantes do AgilePoint no cliente; nenhum deles foi substituído.");
  updated.mcpServers[name] = entry;
  return { text: `${JSON.stringify(updated, null, 2)}\n`, name };
}

export function mergeCodexConfiguration(text, entry) {
  const rootKey = '(?:mcp_servers|"mcp_servers"|\'mcp_servers\')';
  if (new RegExp(`^\\s*(?:${rootKey}\\s*=|\\[\\s*${rootKey}\\s*\\])`, "m").test(text)) {
    throw new Error("A configuração do Codex usa uma tabela MCP alternativa. Use o registro oficial do cliente com configuracao-gerada.json; o arquivo existente foi preservado.");
  }
  const beginCount = text.split(markerBegin).length - 1;
  const endCount = text.split(markerEnd).length - 1;
  if (beginCount !== endCount || beginCount > 1) throw new Error("Bloco gerenciado do AgilePoint inválido; configuração preservada.");
  let existing = text;
  if (beginCount) {
    const start = text.indexOf(markerBegin);
    const end = text.indexOf(markerEnd, start);
    if (end < start) throw new Error("Bloco gerenciado inválido.");
    existing = text.slice(0, start) + text.slice(end + markerEnd.length).replace(/^\r?\n/, "");
  }
  const name = ["agilepoint", "agilepoint_apf", "agilepoint_apf_v1"].find((candidate) => {
    const key = `(?:${candidate}|"${candidate}"|'${candidate}')`;
    return !new RegExp(`^\\s*(?:\\[\\[?\\s*${rootKey}\\s*\\.\\s*${key}\\s*(?:\\.|\\])|${rootKey}\\s*\\.\\s*${key}\\s*(?:\\.|=))`, "m").test(existing);
  });
  if (!name) throw new Error("Há registros conflitantes do AgilePoint no Codex; nenhum deles foi substituído.");
  const quoted = (value) => JSON.stringify(value);
  const lines = [markerBegin, `[mcp_servers.${name}]`, `command = ${quoted(entry.command)}`,
    `args = [${entry.args.map(quoted).join(", ")}]`, "startup_timeout_sec = 30", "tool_timeout_sec = 1800",
    `[mcp_servers.${name}.env]`, ...Object.entries(entry.env).map(([key, value]) => `${key} = ${quoted(value)}`), markerEnd];
  return { text: `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${lines.join("\n")}\n`, name };
}

async function readOptional(file) {
  try {
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024) throw new Error("Arquivo de configuração não é regular ou excede o tamanho permitido.");
    return await fs.readFile(file, "utf8");
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomicWrite(file, contents, expected) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.agilepoint-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (await readOptional(file) !== expected) throw new Error("A configuração mudou durante a instalação; execute o instalador novamente.");
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function run(executable, args, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, APF_AUTH_MODE: "chat" };
    for (const key of Object.keys(environment)) if (key.toLowerCase() === "path") delete environment[key];
    environment.PATH = `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`;
    const child = spawn(executable, args, {
      cwd, windowsHide: true, shell: false,
      env: environment,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (data) => { if (capture) { if (output.length < 200_000) output += data.toString(); } else process.stderr.write(data); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error("A instalação excedeu o tempo permitido.")); }, 10 * 60_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => { clearTimeout(timeout); code === 0 ? resolve(output) : reject(new Error(`O comando de instalação terminou com código ${code}.`)); });
  });
}

async function npmCli() {
  const directory = path.dirname(process.execPath);
  const candidates = [path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
  for (const folder of (process.env.PATH || "").split(path.delimiter)) candidates.push(path.join(folder, "npm"));
  for (const candidate of candidates) {
    try {
      const resolved = await fs.realpath(candidate);
      if (resolved.endsWith(".js")) return resolved;
    } catch {}
  }
  throw new Error("npm não foi encontrado junto ao Node.js. No Windows, execute Instalar.ps1.");
}

async function detectClient() {
  if (process.env.CLAUDECODE) return "claude-code";
  if (process.env.CODEX_THREAD_ID || process.env.CODEX_HOME) return "codex";
  if (process.env.CURSOR_TRACE_ID) return "cursor";
  if (process.env.VSCODE_PID) return "vscode";
  const present = [];
  for (const client of clients) if (await readOptional(configurationPath(client)) !== null) present.push(client);
  if (present.length === 1) return present[0];
  throw new Error(`A IA instaladora deve informar --cliente com seu próprio cliente: ${present.length ? present.join(", ") : clients.join(", ")}.`);
}

async function copyRuntime(source, destination) {
  const fileNames = ["package.json", "package-lock.json", "capabilities.json", "README.md", "LIMITACOES_CONHECIDAS.md", "KIT_APF.md", "DICA_DE_MESTRE.md", "assets/apf/FPA-MODELO.xlsx", "instalar.mjs", "Instalar.ps1", "scripts/approve.mjs", "scripts/smoke.mjs"];
  for (const entry of await fs.readdir(path.join(source, "dist"), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) fileNames.push(`dist/${entry.name}`);
  }
  for (const relative of fileNames) {
    const from = path.join(source, relative), to = path.join(destination, relative);
    const info = await fs.lstat(from);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("O pacote contém um arquivo de execução inválido.");
    await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
  }
}

export async function install(options = {}) {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("É necessário Node.js 22 ou superior; no Windows execute Instalar.ps1.");
  const source = path.resolve(options.source || packageRoot);
  const manifest = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
  if (manifest.name !== "agilepoint-apf-mcp" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Pacote AgilePoint inválido.");
  const userRoot = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "AgilePointMCP")
    : process.platform === "darwin" ? path.join(homedir(), "Library", "Application Support", "AgilePointMCP")
    : path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "agilepoint-mcp");
  const client = options.client === "detectar" || !options.client ? await detectClient() : options.client;
  if (!clients.includes(client)) throw new Error("Cliente não suportado.");
  const destination = path.resolve(options.destination || path.join(userRoot, "app", manifest.version));
  const dataDirectory = path.resolve(options.dataDirectory || path.join(userRoot, "dados", client));
  if (source === destination) throw new Error("A pasta permanente deve ser diferente da pasta temporária do ZIP.");
  const digest = createHash("sha256").update(await fs.readFile(path.join(source, "package-lock.json"))).update(await fs.readFile(path.join(source, "dist", "index.js"))).digest("hex");
  const markerFile = path.join(destination, ".agilepoint-install.json");
  const previous = await readOptional(markerFile);
  let installed = false;
  if (previous) {
    const marker = JSON.parse(previous);
    if (marker.version !== manifest.version || marker.digest !== digest) throw new Error("Já existe uma instalação diferente nesse destino; utilize outra pasta.");
    installed = marker.status === "ready";
  } else {
    try { await fs.lstat(destination); throw new Error("O destino já existe; nenhum arquivo foi sobrescrito."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const staging = await fs.mkdtemp(path.join(path.dirname(destination), ".agilepoint-instalar-"));
    try {
      await copyRuntime(source, staging);
      await fs.writeFile(path.join(staging, ".agilepoint-install.json"), `${JSON.stringify({ version: manifest.version, digest, status: "preparing" })}\n`, { mode: 0o600 });
      await fs.rename(staging, destination);
    } finally {
      if (path.dirname(staging) !== path.dirname(destination) || !path.basename(staging).startsWith(".agilepoint-instalar-")) throw new Error("Pasta temporária inesperada.");
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
  for (const name of ["auditoria", "aprovacoes", "exportacoes", "importacao"]) await fs.mkdir(path.join(dataDirectory, name), { recursive: true, mode: 0o700 });
  if (!installed || !await readOptional(path.join(destination, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))) {
    await run(process.execPath, [await npmCli(), "ci", "--omit=dev", "--ignore-scripts"], destination);
  }
  const tools = await run(process.execPath, ["scripts/smoke.mjs"], destination, true);
  if (!tools.split(/\r?\n/).includes("autenticar_agilepoint")) throw new Error("O diagnóstico não confirmou a ferramenta de login.");
  await fs.writeFile(markerFile, `${JSON.stringify({ version: manifest.version, digest, status: "ready" }, null, 2)}\n`, { mode: 0o600 });
  const entry = runtimeConfiguration(destination, dataDirectory);
  const configFile = path.resolve(options.configFile || configurationPath(client));
  let serverName = "agilepoint";
  const generatedFile = path.join(destination, "configuracao-gerada.json");
  await fs.writeFile(generatedFile, `${JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2)}\n`, { mode: 0o600 });
  if (!options.prepareOnly) {
    const prior = await readOptional(configFile);
    let merged;
    if (client === "codex") merged = mergeCodexConfiguration(prior || "", entry);
    else {
      const require = createRequire(path.join(destination, "package.json"));
      const JSON5 = require("json5");
      let document;
      try { document = prior ? JSON5.parse(prior) : {}; } catch { throw new Error("A configuração existente não pôde ser lida; foi preservada."); }
      merged = mergeJsonConfiguration(document, entry, destination);
    }
    await atomicWrite(configFile, merged.text, prior);
    serverName = merged.name;
  }
  await fs.writeFile(generatedFile, `${JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2)}\n`, { mode: 0o600 });
  return {
    instalado: true, registrado_no_cliente: !options.prepareOnly, versao: manifest.version, cliente: client,
    servidor: serverName, pasta: destination, dados: dataDirectory, configuracao: options.prepareOnly ? generatedFile : configFile,
    node_executavel: process.execPath, pasta_aprovacoes: entry.env.APF_APPROVAL_DIR,
    credenciais_configuradas: false, diagnostico: "ok",
    proximo_passo: options.prepareOnly ? "Registre a configuração gerada no cliente antes de pedir credenciais."
      : "Reconecte o MCP no cliente. Quando autenticar_agilepoint estiver disponível, solicite ao usuário o login e a senha do AgilePoint e autentique nesta conversa. Se o cliente exigir reinício, informe essa única etapa e continue depois da reconexão.",
  };
}

function parseArguments(args) {
  const parsed = {};
  const flags = { "--cliente": "client", "--destino": "destination", "--dados": "dataDirectory", "--config": "configFile" };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--preparar") parsed.prepareOnly = true;
    else if (flags[args[index]] && args[index + 1] && !args[index + 1].startsWith("--")) parsed[flags[args[index]]] = args[++index];
    else throw new Error("Argumento inválido. Use --cliente, --destino, --dados, --config ou --preparar.");
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await install(parseArguments(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(JSON.stringify({ instalado: false, erro: error.message })); process.exitCode = 1; }
}
