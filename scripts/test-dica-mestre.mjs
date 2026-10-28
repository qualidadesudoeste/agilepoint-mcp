import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { DicaMestreEndpoint, assertDicaContract, prepareDica, validateDicaFiles, dicaFields, dicaRuleBody, parseDicaGuid,
  createDicaSimulation, getDicaSimulation, cancelDicaSimulation, dicaHash, recordDicaAudit, checkDicaResponse } from "../dist/dica-mestre.js";
import { ApfSession } from "../dist/session.js";
import { buildGridRowEditUrl } from "../dist/internal-api.js";

// Minimal, synthetic fixtures preserving the contracts observed in the official client.
const html = `var idForm='500000385';
<script src="jsRule/system_apf/webrunRules.js?hash=123"></script>
d.c_1136122 = new HTMLButton('APF',500000385,1136122,0,0,100,30,'Incluir Nova','');
d.c_1136122.onclick = function(){return executeRule('APF',500000385,'Dica de Mestre - Iniciar Envio de Funcionalidade',[],[]);};
d.c_1136126.onclick = function(){return executeJSRule('APF',500000385,'DicaDeMestreSubmeterInscricao',[1136137,1136124,1136125],false,arguments);};
d.c_1136135.onclick = function(){return executeJSRule('APF',500000385,'DicaDeMestreCancelarEnvio',[],false,arguments);};
d.c_1136137.onchange = function(){return executeRule('APF',500000385,'GitSudo - Definir guid na sessao',[1136137],[]);};
d.c_1136137 = new HTMLEdit('APF',500000385,1136137,0,0,1,1,'guid','');
d.c_1136124 = new HTMLEdit('APF',500000385,1136124,0,0,1,1,'Título','');
d.c_1136125 = new HTMLEdit('APF',500000385,1136125,0,0,1,1,'Descrição','');
d.c_1136141.onclick = function(){return openForm({sys:'APF',form:'500000386'});};`;
const rules = `function DicaDeMestreSubmeterInscricao(){}
DicaDeMestreSubmeterInscricao.prototype.run=function(){executeSyncJavaRule.call(this,this.getSystem(),this.getForm(),'Dica de Mestre - Inserir',[this.context['guid'],this.context['titulo'],this.context['descricao'],this.context['documentacao']]);};
function runDicaDeMestreSubmeterInscricao(){}
function DicaDeMestreCancelarEnvio(){}; new DicaDeMestreResetarEnvio();
function runDicaDeMestreCancelarEnvio(){}
function DicaDeMestreResetarEnvio(){};
function runDicaDeMestreResetarEnvio(){}
function DicaDeMestreRepositorioUpload(){}; ebfUploadMultipleFiles2(null,null,'Dica de Mestre - Ao Enviar');
function runDicaDeMestreRepositorioUpload(){}`;
const guid = "11111111-2222-4333-8444-555555555555";
const response = (text, status = 200) => ({ status, headers: new Headers({ "content-type": "text/html; charset=UTF-8" }), body: Buffer.from(text), url: "https://example.test/executeRule.do", text: () => text });
const returnValue = value => `$mainform().document._ruleReturn=${JSON.stringify(value)};`;
const root = await mkdtemp(path.join(tmpdir(), "dica-mcp-test-"));
const previous = { upload: process.env.APF_UPLOAD_DIR, audit: process.env.APF_AUDIT_DIR, role: process.env.APF_MCP_ROLE, actor: process.env.APF_COLLABORATOR_ID, policy: process.env.APF_CAPABILITIES_FILE };
process.env.APF_UPLOAD_DIR = root;
process.env.APF_AUDIT_DIR = root;
process.env.APF_MCP_ROLE = "desenvolvedor";
process.env.APF_COLLABORATOR_ID = "synthetic-actor";
const baseInput = { titulo: "Dica teste & segurança", descricao: "Descrição de teste", documentacao_markdown: "# Guia\n\nDocumentação UTF-8: ação ✓ e código `x = 1`." };

function fixture(options = {}) {
  const calls = [], uploaded = [], rows = [];
  let savedDocument, submitted = 0;
  const transport = {
    async get(url) {
      calls.push({ method: "GET", url });
      if (url.includes("webrunRules.js")) return response(options.changedContract ? rules.replace("this.context['descricao']", "this.context['outro']") : rules);
      if (url.includes("upload.jsp")) return response(`<script>xhr.open("POST","uploadMultipleFiles.do?sys=APF&formID=500000385"); formData.append(name, file);</script>`);
      throw new Error("Unexpected GET");
    },
    async post(url, body, headers) {
      const params = new URLSearchParams(body);
      calls.push({ method: "POST", url, params, headers });
      assert.equal(params.get("decodedParams"), "true");
      const name = params.get("ruleName");
      if (name === "Dica de Mestre - Iniciar Envio de Funcionalidade") return response(`ebfFormChangeComponentValue('form','guid','${guid}');`);
      if (name === "GitSudo - Definir guid na sessao") { assert.equal(params.get("P_0"), guid); return response(returnValue("")); }
      if (name === "Lista Anexo - Obter Arquivos") return response(returnValue(options.missingUpload ? [] : uploaded));
      if (name === "Dica de Mestre - Inserir") {
        assert.equal(params.get("P_0"), guid);
        assert.equal(params.get("F_20_1136124"), params.get("P_1"));
        savedDocument = params.get("P_3"); submitted++;
        rows.push({ titulo: params.get("P_1"), descricao: params.get("P_2"), avaliacao: "Pendente", posicao: 1 });
        if (options.connectionLoss) throw new Error("Conexão encerrada após receber o POST");
        if (options.rejected) return response("ActNewErrorMessage(null,'Permissão negada',5);");
        return response(returnValue(""));
      }
      if (name === "Dica de Mestre - Obter documentação") { assert.equal(params.get("P_0"), "9001"); return response(returnValue(options.wrongDocument ? "Outro texto" : savedDocument)); }
      throw new Error(`Unexpected rule ${name}`);
    },
    async postMultipart(url, fields, file) {
      calls.push({ method: "UPLOAD", url, file });
      assert.equal(new URL(url).pathname, "/uploadMultipleFiles.do");
      assert.equal(file.fieldName, "upload1");
      assert.deepEqual(fields, {});
      uploaded.push(file.filename);
      return response("<script>/* callback normal */</script>");
    },
  };
  const endpoint = new DicaMestreEndpoint({ baseUrl: "https://example.test", http: transport,
    open: async () => ({ body: html, url: "https://example.test/openform.do?formID=500000385" }),
    submissions: async () => options.duplicate ? [{ titulo: baseInput.titulo, descricao: "Existente", avaliacao: "Pendente", posicao: 1 }] : rows,
    resolveId: async row => { assert.equal(row.titulo, baseInput.titulo); return "9001"; },
  });
  return { endpoint, calls, rows, count: () => submitted };
}

try {
  const content = await prepareDica(baseInput);
  assert.equal((await prepareDica({ ...baseInput, documentacao_markdown: "    codigo indentado\n\n" })).documentacao, "    codigo indentado\n\n", "Não remover indentação significativa do Markdown");
  const fingerprint = assertDicaContract(html, rules);
  assert.throws(() => assertDicaContract(html + "\nd.c_1136122.enabled=false;", rules), /desabilitou/);
  assert.throws(() => assertDicaContract(html, rules.replace("this.context['guid']", "this.context['titulo']")), /contrato de submissão/);
  assert.equal(parseDicaGuid(`ebfFormChangeComponentValue('form','guid','${guid}');`), guid);
  assert.throws(() => parseDicaGuid("<html>Login</html>"), /GUID/);
  assert.throws(() => dicaRuleBody("Regra arbitrária", [], {}), /fora do contrato/);
  assert.equal(new URLSearchParams(dicaRuleBody("Dica de Mestre - Inserir", [guid, "a&b", "ação", "✓"], dicaFields(html))).get("P_3"), "✓");
  assert.throws(() => checkDicaResponse(response("", 403), "teste"), /recusou/);
  assert.throws(() => checkDicaResponse(response("ActNewErrorMessage(null,'Erro',5)"), "teste"), /recusou/);
  assert.throws(() => checkDicaResponse(response("formID=19"), "teste"), /recusou/);
  await assert.rejects(() => prepareDica({ ...baseInput, caminho_documentacao: path.join(root, "guia.md") }), /exatamente/);
  await assert.rejects(() => prepareDica({ ...baseInput, documentacao_markdown: " " }), /./);
  const md = path.join(root, "guia.md"); await writeFile(md, "# Markdown\r\n\r\nTeste de arquivo UTF-8.");
  const fromFile = await prepareDica({ titulo: "Arquivo", descricao: "Teste", caminho_documentacao: md });
  assert(!fromFile.documentacao.includes("\r"));
  await writeFile(md, "Outro conteúdo");
  await assert.rejects(() => validateDicaFiles(fromFile), /documentação mudou/);
  const attachment = path.join(root, "exemplo.txt"); await writeFile(attachment, "Arquivo sintético de apoio");
  const withFile = await prepareDica({ ...baseInput, anexos: [attachment] });
  await assert.rejects(() => prepareDica({ ...baseInput, anexos: [attachment, attachment] }), /duplicados/);
  const pending = createDicaSimulation(content, fingerprint);
  const fixtureNoWrite = fixture();
  await fixtureNoWrite.endpoint.inspect(); await fixtureNoWrite.endpoint.ensureUnique(content.titulo);
  assert(!fixtureNoWrite.calls.some(call => call.method !== "GET"));
  const cancelled = cancelDicaSimulation(pending.confirmacao_token);
  assert.equal(cancelled.gravado_no_agilepoint, false);
  assert.throws(() => getDicaSimulation(pending.confirmacao_token), /cancelada/);
  const actorPending = createDicaSimulation(content, fingerprint);
  process.env.APF_COLLABORATOR_ID = "other-synthetic-actor";
  assert.throws(() => getDicaSimulation(actorPending.confirmacao_token), /identidade/);
  process.env.APF_COLLABORATOR_ID = "synthetic-actor";
  const simulation = { conteudo: content, contrato_sha256: fingerprint, ator_sha256: dicaHash({}) };
  const good = fixture(), progress = [];
  const published = await good.endpoint.publish(simulation, async value => progress.push(value));
  assert.equal(published.inscricao_id, "9001");
  assert.equal(published.documentacao_verificada, true);
  assert.equal(published.avaliacao, "Pendente", "O MCP não transforma uma inscrição pendente em aprovação");
  assert.equal(good.count(), 1);
  assert.deepEqual(good.calls.filter(c => c.method === "POST").map(c => c.params.get("ruleName")), ["Dica de Mestre - Iniciar Envio de Funcionalidade", "GitSudo - Definir guid na sessao", "Dica de Mestre - Inserir", "Dica de Mestre - Obter documentação"]);
  const uploadGood = fixture();
  await uploadGood.endpoint.publish({ ...simulation, conteudo: withFile }, async () => {});
  assert.equal(uploadGood.calls.filter(c => c.method === "UPLOAD").length, 1);
  assert(uploadGood.calls.findIndex(c => c.method === "UPLOAD") > uploadGood.calls.findIndex(c => c.params?.get("ruleName") === "GitSudo - Definir guid na sessao"));
  const duplicate = fixture({ duplicate: true });
  await assert.rejects(() => duplicate.endpoint.publish(simulation, async () => {}), /Já existe/);
  assert(!duplicate.calls.some(c => c.method === "POST"));
  const changed = fixture({ changedContract: true });
  await assert.rejects(() => changed.endpoint.publish(simulation, async () => {}), /contrato/);
  assert(!changed.calls.some(c => c.method === "POST"));
  const missingUpload = fixture({ missingUpload: true });
  await assert.rejects(() => missingUpload.endpoint.publish({ ...simulation, conteudo: withFile }, async () => {}), /anexos esperados/);
  assert.equal(missingUpload.count(), 0);
  const wrongDoc = fixture({ wrongDocument: true });
  await assert.rejects(() => wrongDoc.endpoint.publish(simulation, async () => {}), /documentação gravada/);
  assert.equal(wrongDoc.count(), 1);
  const lost = fixture({ connectionLoss: true });
  await assert.rejects(() => lost.endpoint.publish(simulation, async () => {}), /Conexão encerrada/);
  assert.equal(lost.count(), 1, "Falha após POST não pode provocar reenvio");
  const forbidden = fixture({ rejected: true });
  await assert.rejects(() => forbidden.endpoint.publish(simulation, async () => {}), /recusou/);
  await writeFile(attachment, "Conteúdo alterado");
  const tampered = fixture();
  await assert.rejects(() => tampered.endpoint.publish({ ...simulation, conteudo: withFile }, async () => {}), /anexo mudou/);
  assert(!tampered.calls.some(c => c.method === "POST"));
  const audit = await recordDicaAudit("synthetic-key", simulation, "progresso", { etapa: "envio_iniciado", guid_envio: guid, titulo: baseInput.titulo, documentacao: baseInput.documentacao_markdown });
  const auditText = await readFile(path.join(root, "dicas-mestre.jsonl"), "utf8");
  assert(!auditText.includes(baseInput.titulo) && !auditText.includes(baseInput.documentacao_markdown));
  assert.equal(audit.recuperacao.guid_envio, guid);
  const session = new ApfSession();
  const policy = path.join(root, "policy.json"); process.env.APF_CAPABILITIES_FILE = policy;
  await writeFile(policy, JSON.stringify({ version: 1, roles: { desenvolvedor: [] } }));
  await assert.rejects(() => session.masterTipEndpoint().inspect(), /política local/);
  const row = { titulo: "Título sintético", descricao: "Descrição sintética", avaliacao: "Pendente", posicao: 1 };
  const rowSource = `d.c_1136144=new HTMLEdit('APF',500000387,1136144,0,0,1,1,'Título','${row.titulo}'); d.c_1136145=new HTMLEdit('APF',500000387,1136145,0,0,1,1,'Descrição','${row.descricao}'); d.c_1493714144=new HTMLHidden('APF',500000387,1493714144,'9001');`;
  const rowRequests = [];
  session.http.get = async url => { rowRequests.push(url); return response(new URL(url).searchParams.get("param") === "edit" ? rowSource : ""); };
  assert.equal(await session.resolveMasterTipIdHttp(row), "9001");
  assert.equal(new URL(rowRequests[0]).searchParams.get("formID"), "500000386");
  assert.equal(new URL(rowRequests.at(-1)).searchParams.get("param"), "canceledit");
  assert.equal(new URL(buildGridRowEditUrl("https://example.test", "inscricao_dica", 1)).searchParams.get("comID"), "1136147");
  console.log("Dica de Mestre: contratos capturados, simulação/cancelamento sem escrita, identidade, Markdown UTF-8, anexos, duplicidade, alteração de arquivos, perda de conexão, submissão pendente, leitura por ID e auditoria privada: ok. Backend AgilePoint virtualizado; nenhuma dica real publicada.");
} finally {
  for (const [env, value] of [["APF_UPLOAD_DIR", previous.upload], ["APF_AUDIT_DIR", previous.audit], ["APF_MCP_ROLE", previous.role], ["APF_COLLABORATOR_ID", previous.actor], ["APF_CAPABILITIES_FILE", previous.policy]]) { if (value === undefined) delete process.env[env]; else process.env[env] = value; }
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("dica-mcp-test-")) throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
}
