import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "apf-network-discovery-"));
process.env.APF_DISCOVERY_MODE = "true";
process.env.APF_DISCOVERY_INCLUDE_VALUES = "false";
process.env.APF_NETWORK_LOG_DIR = directory;

const { NetworkDiscoveryLogger } = await import("../dist/network-discovery.js");
const baseUrl = "https://agilepoint.example.test";
const logger = new NetworkDiscoveryLogger(baseUrl);
try {
  await logger.start();
  await logger.recordHttpExchange({
    method: "POST",
    url: `${baseUrl}/api/save?action=save&cpf=111.222.333-44&nome=Pessoa`,
    requestHeaders: {
      "content-type": "application/json",
      cookie: "sid=cookie-secreto",
      authorization: "Bearer token-secreto",
    },
    requestBody: JSON.stringify({
      action: "save",
      password: "senha-secreta",
      cpf: "111.222.333-44",
      nome: "Pessoa",
    }),
    status: 200,
    responseHeaders: { "content-type": "application/json" },
    responseBody: Buffer.from(JSON.stringify({
      ok: true,
      cpf: "111.222.333-44",
      nome: "Pessoa de Teste",
    })),
  });
  await logger.recordHttpExchange({
    method: "POST",
    url: `${baseUrl}/executeRule.do`,
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    requestBody: "sys=APF&action=executeRule&formID=19&ruleName=Template+-+Login+-+Autenticar+Usuario&P_0=usuario-secreto&P_1=senha-secreta",
    status: 200,
    responseHeaders: { "content-type": "text/html" },
    responseBody: Buffer.from("login concluído"),
  });
  const analysis = await logger.analyze();
  assert(analysis.candidatos.some((candidate) =>
    candidate.rota === "/api/save" && candidate.classificacao === "candidato_webservice"
  ));
  await logger.close();
  const status = logger.status();
  assert.equal(status.requisicoes_registradas, 1);
  assert(status.arquivo);
  const log = await readFile(status.arquivo, "utf8");
  assert.doesNotMatch(log, /senha-secreta|111\.222\.333-44|cookie-secreto|token-secreto|Pessoa de Teste|"Pessoa"/);
  assert.match(log, /\/api\/save/);
  assert.match(log, /"transporte":"http"/);
  console.log("diagnostico HTTP: ok");
} finally {
  await logger.close();
  await rm(directory, { recursive: true, force: true });
}
