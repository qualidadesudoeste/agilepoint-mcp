import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const engines = { node: ">=22" };
let output;
if (process.argv[2] === "manifest") {
  output = {
    name: manifest.name,
    version: manifest.version,
    private: true,
    type: "module",
    description: manifest.description,
    engines,
    scripts: {
      instalar: "node instalar.mjs",
      start: "node dist/index.js",
      approve: "node scripts/approve.mjs",
      diagnostico: "node scripts/smoke.mjs",
    },
    dependencies: manifest.dependencies,
  };
} else if (process.argv[2] === "lock") {
  output = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  if (output.version !== manifest.version || output.packages[""].version !== manifest.version) {
    throw new Error("Versões divergentes no manifesto e lockfile.");
  }
  delete output.packages[""].devDependencies;
  output.packages[""].engines = engines;
  for (const [name, entry] of Object.entries(output.packages)) {
    if (name && entry.dev === true) delete output.packages[name];
  }
} else {
  throw new Error("Use manifest ou lock.");
}
// JSON ASCII preserva os textos ao atravessar o stdout do Windows PowerShell 5.
const json = JSON.stringify(output, null, 2).replace(/[\u007f-\uffff]/g, (character) =>
  `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
process.stdout.write(`${json}\n`);
