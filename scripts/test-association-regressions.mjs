import assert from "node:assert/strict";
import { ApfSession } from "../dist/session.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { createWriteAuthorization, verifyWriteAuthorization, consumeWriteAuthorization, writeApprovalMode } from "../dist/write-authorization.js";
import { buildContributionUserLookupSearchUrl } from "../dist/internal-api.js";
assert.throws(() => buildContributionUserLookupSearchUrl("https://example.test", "1 OR 1=1"), /numérico/);

const input = {
  contagem: { aplicacao: "Projeto sintético", versao_sprint: "TESTE" },
  funcoes: ["Consultar cliente"], usuarios: [{ usuario: "Pessoa Alfa", percentual: 100 }], modo: "substituir",
  colaborador_id: "login:teste", colaborador_nome: "Teste", quantidade_funcoes_solicitadas: 1, percentual_total: 100,
};
function fixture() {
  const session = new ApfSession();
  let functions = [{ _record_id: "9001", field743: "Consultar cliente", _contributions: [] }];
  let options = [{ id: "7002", label: "Pessoa Alfa (empresa) 000.000.000-01" }];
  let complete = true;
  const writes = [];
  session.resolveExactCountIdHttp = async () => "17331";
  session.countFunctionsById = async () => ({ count: { closed: false }, functions });
  session.lookupOptions = async () => { throw new Error("A associação não deve usar o catálogo sem contexto de função"); };
  session.http = { get: async requested => {
    const url = new URL(requested);
    if (url.pathname === "/openform.do") return { status: 200, text: () => "d.c_1026478 = new HTMLLookup('APF', 59, 1026478, 0, 0, 100, 35, 'Usuário', '', '');" };
    if (url.pathname === "/gridEdit.do") {
      const action = url.searchParams.get("param");
      assert(["insert", "cancelinsert"].includes(action), "a prévia não pode gravar nem excluir vínculos");
      return { status: 200, text: () => action === "insert" ? "d.c_2087974631 = new HTMLHidden('APF', 59, 2087974631, '9001');" : "" };
    }
    assert.equal(url.pathname, "/search.do");
    assert.equal(url.searchParams.get("formID"), "59");
    assert.equal(url.searchParams.get("componentID"), "1026478");
    assert.equal(url.searchParams.get("WFRInput2087974631"), "9001");
    assert.equal(url.searchParams.get("type"), "2");
    return { status: 200, text: () => `<r>${options.map(option => `<d v="${option.id}">${option.label}</d>`).join("")}<navigation><next enabled="${!complete}"/></navigation></r>` };
  } };
  session.fetchDependentGridEndpointHttp = async () => [];
  session.openCountDocumentById = async () => ({ url: "https://example.test/openform.do?formID=26", body: "" });
  session.replaceFunctionContributionsHttp = async (...args) => writes.push(args);
  return { session, writes, setOptions: value => { options = value; }, setFunctions: value => { functions = value; }, setComplete: value => { complete = value; } };
}
const previous = process.env.APF_WRITE_ENABLED;
const previousMode = process.env.APF_WRITE_APPROVAL_MODE;
process.env.APF_WRITE_ENABLED = "true";
try {
  process.env.APF_WRITE_APPROVAL_MODE = "automatic";
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  assert.equal(writeApprovalMode(true), "automatic");
  const authorization = await createWriteAuthorization("associar_usuarios_funcoes", hash, input, true);
  assert.equal(authorization.requer_aprovacao_humana, false);
  assert.equal("aprovacao_id" in authorization, false);
  await verifyWriteAuthorization(undefined, "associar_usuarios_funcoes", hash, "teste-automatico", true, true, input);
  await consumeWriteAuthorization(undefined, "associar_usuarios_funcoes", hash, "teste-automatico", true);
  await assert.rejects(verifyWriteAuthorization(undefined, "associar_usuarios_funcoes", hash, "teste-automatico", true, true, { ...input, funcoes: ["outra"] }), /não corresponde/);
  process.env.APF_WRITE_ENABLED = "false";
  await assert.rejects(verifyWriteAuthorization(undefined, "associar_usuarios_funcoes", hash, "teste-automatico", true, true, input), /desabilitada/);
  process.env.APF_WRITE_ENABLED = "true";
  const success = fixture();
  const preview = await success.session.previewFunctionUsers(input);
  assert.deepEqual(preview.usuarios, [{ userId: "7002", percentage: 100 }]);
  assert.deepEqual(success.writes, [], "a prévia não deve executar mutações");
  const result = await success.session.associateFunctionUsers({ ...input, alvos_verificados: preview });
  assert.equal(result.funcoes_alteradas.length, 1);
  assert.deepEqual(success.writes[0].slice(1), [1, "9001", [{ userId: "7002", percentage: 100 }]]);
  const homonym = fixture();
  homonym.setOptions([{ id: "7002", label: "Pessoa Alfa 000.000.000-01" }, { id: "7003", label: "Pessoa Alfa 000.000.000-02" }]);
  await assert.rejects(homonym.session.previewFunctionUsers(input), /2 correspondências/);
  const byId = await homonym.session.previewFunctionUsers({ ...input, usuarios: [{ usuario: "id:7003", percentual: 100 }] });
  assert.equal(byId.usuarios[0].userId, "7003");
  const incomplete = fixture();
  incomplete.setComplete(false);
  await assert.rejects(incomplete.session.previewFunctionUsers(input), /incompleta/);
  const duplicatedIdentity = fixture();
  await assert.rejects(duplicatedIdentity.session.previewFunctionUsers({ ...input, usuarios: [
    { usuario: "Pessoa Alfa", percentual: 50 }, { usuario: "id:7002", percentual: 50 },
  ] }), /mesma pessoa/);
  const duplicatedFunction = fixture();
  duplicatedFunction.setFunctions([{ _record_id: "9001", field743: "Consultar cliente" }, { _record_id: "9002", field743: "Consultar cliente" }]);
  await assert.rejects(duplicatedFunction.session.associateFunctionUsers(input), /2 correspondências/);
  assert.deepEqual(duplicatedFunction.writes, []);
  const changed = fixture();
  const approved = await changed.session.previewFunctionUsers(input);
  changed.setFunctions([{ _record_id: "9001", field743: "Consultar cliente", _contributions: [{ field806: 100, _foreign_ids: { usuario: "7005" } }] }]);
  await assert.rejects(changed.session.associateFunctionUsers({ ...input, alvos_verificados: approved }), /mudaram desde/);
  assert.deepEqual(changed.writes, []);
  const outsideApplication = fixture();
  outsideApplication.setOptions([]);
  await assert.rejects(outsideApplication.session.associateFunctionUsers(input), /não foi encontrado/);
  assert.deepEqual(outsideApplication.writes, []);
  const badResponse = fixture();
  const originalHttp = badResponse.session.http;
  badResponse.session.http = { get: async url => new URL(url).pathname === "/search.do" ? { status: 200, text: () => '<root><error message="falha"/></root>' } : originalHttp.get(url) };
  await assert.rejects(badResponse.session.previewFunctionUsers(input), /resposta inválida/);
  const wrongFunction = fixture();
  const originalWrongHttp = wrongFunction.session.http;
  let cancelledWrongFunction = false;
  wrongFunction.session.http = { get: async requested => {
    const url = new URL(requested);
    if (url.searchParams.get("param") === "insert") return { status: 200, text: () => "d.c_2087974631 = new HTMLHidden('APF', 59, 2087974631, '9999');" };
    if (url.searchParams.get("param") === "cancelinsert") cancelledWrongFunction = true;
    return originalWrongHttp.get(requested);
  } };
  await assert.rejects(wrongFunction.session.previewFunctionUsers(input), /função diferente/);
  assert.equal(cancelledWrongFunction, true, "cancelar o modo de inclusão mesmo quando a identidade não conferir");
} finally {
  if (previous === undefined) delete process.env.APF_WRITE_ENABLED; else process.env.APF_WRITE_ENABLED = previous;
  if (previousMode === undefined) delete process.env.APF_WRITE_APPROVAL_MODE; else process.env.APF_WRITE_APPROVAL_MODE = previousMode;
}
const client = new Client({ name: "regressao-remocao-kit", version: "1.3.0" });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, APF_AUTH_MODE: "chat" } }));
  const { tools } = await client.listTools();
  for (const name of ["preparar_contagem_apf", "validar_contagem_apf", "gerar_planilha_apf", "iniciar_contagem_guiada"]) {
    assert(!tools.some(tool => tool.name === name), `${name} deveria ter sido removida`);
  }
  for (const name of ["simular_associacao_usuarios_funcoes", "associar_usuarios_funcoes", "simular_importacao_rapida", "importar_contagem_rapida"]) {
    assert(tools.some(tool => tool.name === name), `${name} deveria ter sido preservada`);
  }
  assert.equal(client.getServerCapabilities()?.prompts, undefined, "o prompt do kit também deve ser removido");
} finally { await client.close(); }
console.log("Associações: nomes com complementos, ID, homônimos, catálogo incompleto, duplicidades, prévia e mudança após aprovação conferidos. Kit ausente no MCP. Testes locais com backend virtualizado; sem gravação real no AgilePoint.");
