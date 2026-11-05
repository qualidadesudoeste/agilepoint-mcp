import assert from "node:assert/strict";
import path from "node:path";
import { configurationPath, mergeJsonConfiguration, mergeCodexConfiguration, runtimeConfiguration, verifiedManagedEntries } from "../instalar.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { environmentCredentialsAvailable } from "../dist/access.js";
import { ApfSession } from "../dist/session.js";

const destination = path.resolve("fixture-install");
const entry = runtimeConfiguration(destination, path.resolve("fixture-data"));
assert.equal(entry.env.APF_AUTH_MODE, "chat");
assert.equal(entry.env.APF_WRITE_APPROVAL_MODE, "automatic");
assert.equal("APF_PASSWORD" in entry.env, false);
assert.equal("APF_USERNAME" in entry.env, false);
assert.equal(path.isAbsolute(entry.command), true);
const original = { theme: "dark", mcpServers: { outro: { command: "keep", env: { TOKEN: "synthetic" } } } };
const merged = mergeJsonConfiguration(original, entry, destination);
assert.deepEqual(JSON.parse(merged.text).mcpServers.outro, original.mcpServers.outro);
assert.equal(original.mcpServers.agilepoint, undefined);
assert.equal(merged.name, "agilepoint");
assert.equal(mergeJsonConfiguration(JSON.parse(merged.text), entry, destination).text, merged.text);
const collision = mergeJsonConfiguration({ mcpServers: { agilepoint: { command: "unrelated" } } }, entry, destination);
assert.equal(collision.name, "agilepoint-apf");
assert.equal(JSON.parse(collision.text).mcpServers.agilepoint.command, "unrelated");
assert.throws(() => mergeJsonConfiguration({ mcpServers: [] }, entry, destination), /inválido/);
const toml = '# keep comment\nmodel = "configured-model"\n[mcp_servers.other]\ncommand = "keep"\n';
const codex = mergeCodexConfiguration(toml, entry);
assert.ok(codex.text.startsWith(toml));
assert.equal(mergeCodexConfiguration(codex.text, entry).text, codex.text);
const occupied = mergeCodexConfiguration('[mcp_servers.agilepoint]\ncommand = "keep"\n', entry);
assert.equal(occupied.name, "agilepoint_apf");
assert.ok(occupied.text.includes('command = "keep"'));
for (const table of ['[mcp_servers . agilepoint]', '[ "mcp_servers" . "agilepoint" ]', "['mcp_servers' . 'agilepoint']"]) {
  assert.equal(mergeCodexConfiguration(`${table}\ncommand = "keep"\n`, entry).name, "agilepoint_apf");
}
assert.equal(mergeCodexConfiguration('mcp_servers.agilepoint.command = "keep"\n', entry).name, "agilepoint_apf");
assert.throws(() => mergeCodexConfiguration('[mcp_servers]\nagilepoint = {}\n', entry), /preservado/);
assert.throws(() => mergeCodexConfiguration('["mcp_servers"]\nagilepoint = {}\n', entry), /preservado/);
assert.throws(() => mergeCodexConfiguration('# BEGIN AGILEPOINT MCP MANAGED\n', entry), /inválido/);
assert.equal(configurationPath("vscode", { userHome: "/person", platform: "linux", env: {} }), path.posix.join("/person", ".copilot", "mcp-config.json"));
assert.equal(configurationPath("codex", { userHome: "/person", env: { CODEX_HOME: "/custom-codex" } }), path.join("/custom-codex", "config.toml"));
const previous = { mode: process.env.APF_AUTH_MODE, user: process.env.APF_USERNAME, password: process.env.APF_PASSWORD };
try {
  process.env.APF_USERNAME = "synthetic-login";
  process.env.APF_PASSWORD = "synthetic-secret";
  process.env.APF_AUTH_MODE = "chat";
  assert.equal(environmentCredentialsAvailable(), false);
  const session = new ApfSession();
  assert.equal(session.http.hasCredentials(), false, "o modo chat não reutiliza credenciais herdadas do ambiente");
} finally {
  for (const [key, value] of [["APF_AUTH_MODE", previous.mode], ["APF_USERNAME", previous.user], ["APF_PASSWORD", previous.password]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.log("instalador: configurações preservadas, caminhos e autenticação por chat: ok");
const upgradeRoot = await mkdtemp(path.join(tmpdir(), "apf-upgrade-test-"));
try {
  const oldRoot = path.join(upgradeRoot, "1.2.0");
  await mkdir(path.join(oldRoot, "dist"), { recursive: true });
  const lock = "synthetic-lock", code = "// synthetic-index";
  await writeFile(path.join(oldRoot, "package.json"), JSON.stringify({ name: "agilepoint-apf-mcp", version: "1.2.0" }));
  await writeFile(path.join(oldRoot, "package-lock.json"), lock);
  await writeFile(path.join(oldRoot, "dist", "index.js"), code);
  await writeFile(path.join(oldRoot, ".agilepoint-install.json"), JSON.stringify({ version: "1.2.0", status: "ready", digest: createHash("sha256").update(lock).update(code).digest("hex") }));
  const oldEntry = runtimeConfiguration(oldRoot, path.join(upgradeRoot, "dados"));
  oldEntry.env.APF_WRITE_APPROVAL_MODE = "external";
  const document = { mcpServers: { agilepoint: oldEntry, "agilepoint-apf": structuredClone(oldEntry), unrelated: { command: "keep" } } };
  const managed = await verifiedManagedEntries(document);
  assert.deepEqual(managed, ["agilepoint", "agilepoint-apf"]);
  const upgraded = JSON.parse(mergeJsonConfiguration(document, entry, destination, managed).text);
  assert.equal(Object.keys(upgraded.mcpServers).length, 2);
  assert.deepEqual(upgraded.mcpServers.unrelated, { command: "keep" });
  assert.deepEqual(upgraded.mcpServers.agilepoint, entry);
  await writeFile(path.join(oldRoot, "dist", "index.js"), "changed");
  assert.deepEqual(await verifiedManagedEntries(document), [], "uma instalação modificada não deve ser substituída automaticamente");
} finally {
  if (path.dirname(upgradeRoot) !== path.resolve(tmpdir()) || !path.basename(upgradeRoot).startsWith("apf-upgrade-test-")) throw new Error("Destino de limpeza inválido");
  await rm(upgradeRoot, { recursive: true, force: true });
}
console.log("Atualização JSON: troca da instalação validada, remoção de conexões antigas duplicadas e preservação de outros MCPs: ok");
