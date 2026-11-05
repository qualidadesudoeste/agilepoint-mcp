import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { enrichRankingRepositorio, extractContagensHtml, loadAvailableFunctionalityDetails, stableId } from "../dist/extractors.js";
import { ApfSession, extractQueryFormParameters, parseCountSearchResponse, validateReportContent } from "../dist/session.js";
import { assertPointFactorsMatchConventions, parseActivityConventions } from "../dist/factors.js";
import { specializedActionTool } from "../dist/coverage.js";
import { parseQuickImportRows, readQuickImportWorkbook } from "../dist/quick-import.js";
import {
  associationHash,
  consumeAssociationSimulation,
  createAssociationSimulation,
  markAssociationConsumed,
} from "../dist/associations.js";
import {
  applicationDeveloperHash,
  consumeApplicationDeveloperSimulation,
  createApplicationDeveloperSimulation,
  markApplicationDeveloperSimulationConsumed,
} from "../dist/application-developers.js";
import {
  consumePointSimulation,
  createPointSimulation,
  listOwnPointAudit,
  markPointSimulationConsumed,
  pointHash,
  recordPointAudit,
} from "../dist/points.js";
import {
  consumeUiSimulation,
  createUiSimulation,
  markUiSimulationConsumed,
  uiHash,
  validateUniversalInput,
} from "../dist/universal.js";
import { isCredentialExchange, sanitizeBody, sanitizeHeaders, sanitizeUrl } from "../dist/network-discovery.js";
import {
  APPLICATION_DEVELOPER_GRID_CONTRACT,
  COUNT_FUNCTION_GRID_CONTRACT,
  COUNT_FORM_WRITE_CONTRACT,
  FUNCTION_CONTRIBUTION_GRID_CONTRACT,
  FUNCTION_ITEM_GRID_CONTRACT,
  FUNCTION_DEPENDENT_GRID_CONTRACTS,
  COUNT_REPORT_CONTRACTS,
  APF_RANKING_CONTRACT,
  REPOSITORY_RANKING_CONTRACT,
  REPOSITORY_CATALOG_CONTRACT,
  MAIN_MENU_CONTRACT,
  LOOKUP_CONTRACTS,
  buildApplicationDeveloperGridInsertUrl,
  buildApplicationDeveloperGridPostUrl,
  buildApplicationOpenUrl,
  buildFormOpenUrl,
  buildGenericFormActionRequestBody,
  buildGenericLookupSearchUrl,
  buildConfiguredRuleRequestBody,
  buildRuleUploadUrl,
  buildMainMenuRequestBody,
  parseWebrunMenuRuleReturn,
  buildCountFunctionGridInsertUrl,
  buildCountFunctionGridPostUrl,
  buildCountIncludeRequestBody,
  buildCountCancelRequestBody,
  buildCountCreateRequestBody,
  buildCountDeleteRequestBody,
  buildFunctionContributionGridInsertUrl,
  buildFunctionContributionGridPostUrl,
  buildFunctionItemGridInsertUrl,
  buildFunctionItemGridPostUrl,
  buildLookupSearchUrl,
  buildCountOpenUrl,
  buildCountQueryResultsUrl,
  buildCountQueryUrl,
  buildCountSearchOpenUrl,
  buildFunctionDependentGridUrl,
  buildCountReportRequestBody,
  buildRankingApplicationsRequestBody,
  buildRankingUpdateRequestBody,
  buildRepositoryCatalogRequestBody,
  buildRepositoryRankingRequestBody,
  buildGeneratedReportDownloadUrl,
  buildGenericDownloadUrl,
  buildLoginRequestBody,
  buildGridCancelUrl,
  buildGridRowDeleteUrl,
  buildGridRowEditUrl,
  buildInternalUrl,
  parseWebrunAssignment,
  parseWebrunSetValue,
  parseWebrunHiddenValue,
  parseWebrunLookupValue,
  parseFormRecordIdentity,
  parseGeneratedReportPath,
  parseWebrunRuleReturn,
  parseWebrunRuleReturnValue,
  parseWebrunRuleReturnFirstString,
  parseLookupXml,
  recordsHash,
  validateInternalUrl,
} from "../dist/internal-api.js";
import {
  extractWebrunStringProperty,
  parseAuthorizedMenuXml,
  parseWebrunScreenDescription,
  parseWebrunFormState,
} from "../dist/webrun-metadata.js";
import { encodeMultipartFormData, isAuthenticatedDocument, isLoginDocument, validateSecureBaseUrl, WebrunHttpSession } from "../dist/http-session.js";
import { inferRoleFromMenu, requireRole } from "../dist/access.js";
import { parseCustomActionRegistry } from "../dist/custom-actions.js";
import { detectContentMime, parseUploadActionRegistry, parseWebrunUploadForm, validateUploadFile } from "../dist/upload-actions.js";
import { assertUniversalCapability } from "../dist/capabilities.js";
import { consumeHumanApproval, createApprovalRequest, verifyHumanApproval } from "../dist/approval.js";
import { createWriteAuthorization, verifyWriteAuthorization, writeApprovalMode } from "../dist/write-authorization.js";
import { claimIdempotency, completeIdempotency, markIdempotencyAuditProjected } from "../dist/idempotency.js";
import { BoundedPendingStore } from "../dist/pending-simulations.js";
import {
  parseDownloadActionRegistry,
  safeDownloadFilename,
  validateDownloadedContent,
  validateDownloadServerPath,
} from "../dist/download-actions.js";

const loginBody = buildLoginRequestBody("usuario.teste", "senha ç");
assert.match(loginBody, /ruleName=Template\+-\+Login\+-\+Autenticar\+Usuario/);
assert.match(loginBody, /P_0=usuario\.teste/);
assert.match(loginBody, /P_1=senha\+%E7/);
assert.equal(isAuthenticatedDocument('<iframe src="openform.do?sys=APF&formID=20"></iframe>'), true);
assert.equal(isLoginDocument('<iframe src="openform.do?sys=APF&formID=19"></iframe>'), true);

assert.equal(APF_RANKING_CONTRACT.formId, "7153");
assert.equal(APF_RANKING_CONTRACT.gridComponentId, "1026496");
const rankingApplicationsBody = buildRankingApplicationsRequestBody();
assert.match(rankingApplicationsBody, /ruleName=Ranking\+-\+Obter\+todas\+aplica%E7%F5es/);
assert.match(rankingApplicationsBody, /F_29_1136067=M/);
const rankingUpdateBody = buildRankingUpdateRequestBody("28/09/2026", "diario", "101,102", "RULE_TEST");
assert.match(rankingUpdateBody, /ruleName=Ranking\+-\+atualizar\+consulta/);
assert.match(rankingUpdateBody, /P_0=28%2F09%2F2026/);
assert.match(rankingUpdateBody, /P_1=D/);
assert.match(rankingUpdateBody, /F_6_1136074=101%2C102/);
assert.equal(parseWebrunRuleReturn("$mainform().document._ruleReturn = '101,102';"), "101,102");
assert.throws(() => buildRankingUpdateRequestBody("2026-09-28", "mensal", ""), /DD\/MM\/AAAA/);

assert.equal(REPOSITORY_RANKING_CONTRACT.formId, "9127");
assert.equal(REPOSITORY_CATALOG_CONTRACT.formId, "500000385");
const repositoryRankingBody = buildRepositoryRankingRequestBody(
  "01/09/2026",
  "28/09/2026",
  ["Dica de Mestre", "Fluxo", "Dica de Mestre"],
  "RULE_REPOSITORY_TEST",
);
assert.match(repositoryRankingBody, /ruleName=Ranking\+do\+reposit%F3rio\+-\+Mostrar\+ranking/);
assert.match(repositoryRankingBody, /P_0=01%2F09%2F2026/);
assert.match(repositoryRankingBody, /P_1=28%2F09%2F2026/);
assert.match(repositoryRankingBody, /P_2=2%2C1/);
assert.match(repositoryRankingBody, /F_0_1135884=2%2C1/);
assert.match(buildRepositoryCatalogRequestBody(), /ruleName=Dica\+de\+Mestre\+-\+Obter\+funcionalidades/);
assert.deepEqual(
  parseWebrunRuleReturnValue("$mainform().document._ruleReturn = [{id: '1095', titulo: 'Teste'}];"),
  [{ id: "1095", titulo: "Teste" }],
);
assert.deepEqual(
  parseWebrunRuleReturnValue("$mainform().document._ruleReturn = '[{id: \\\"1095\\\"}]';"),
  [{ id: "1095" }],
);
assert.throws(() => buildRepositoryRankingRequestBody("2026-09-01", "", ["Fluxo"]), /data inicial/);
assert.throws(() => buildRepositoryRankingRequestBody("", "", []), /ao menos uma categoria/);

assert.equal(stableId("colaborador", "João Silva"), stableId("colaborador", "  joao   silva "));
assert.notEqual(stableId("colaborador", "João Silva"), stableId("projeto", "João Silva"));

const details = new Map([
  ["1095", {
    conteudo_id_origem: "1095",
    colaborador_id_origem: "23218",
    data_publicacao: "27/08/2026 18:37:21",
    categoria_id_origem: "2",
    projeto_origem: null,
    versao_conteudo: "1.0.0",
  }],
]);

const enriched = enrichRankingRepositorio(
  [{ posicao: 1, titulo: "BI CUSTOMIZÁVEL", descricao: "Conteúdo", desenvolvedor: "Henrique", nota: 29 }],
  [{ id: "1095", titulo: " BI CUSTOMIZÁVEL ", descricao: "Conteúdo", categoria: "Dica de Mestre", media_estrelas: 5, quantidade_avaliacoes: 21 }],
  details,
);

assert.equal(enriched[0].conteudo_id, "apf:conteudo:1095");
assert.equal(enriched[0].colaborador_id, "apf:colaborador:23218");
assert.equal(enriched[0].categoria, "Dica de Mestre");
assert.equal(enriched[0].media_estrelas, 5);
assert.equal(enriched[0].quantidade_eu_nao_sabia, null);

const partiallyAvailableDetails = await loadAvailableFunctionalityDetails(
  [
    { posicao: 1, titulo: "Conteúdo disponível", descricao: "A", desenvolvedor: "Ana", nota: 10 },
    { posicao: 2, titulo: "Conteúdo removido", descricao: "B", desenvolvedor: "Bia", nota: 8 },
  ],
  [
    { id: "1095", titulo: "Conteúdo disponível", descricao: "A", categoria: "Dica de Mestre", media_estrelas: 5, quantidade_avaliacoes: 2 },
    { id: "1096", titulo: "Conteúdo removido", descricao: "B", categoria: "Dica de Mestre", media_estrelas: 4, quantidade_avaliacoes: 1 },
  ],
  async (id) => {
    if (id === "1096") throw new Error("O AgilePoint não abriu o conteúdo 1096.");
    return {
      conteudo_id_origem: id,
      colaborador_id_origem: "23218",
      data_publicacao: "27/08/2026 18:37:21",
      categoria_id_origem: "2",
      projeto_origem: null,
      versao_conteudo: "1.0.0",
    };
  },
);
assert.equal(partiallyAvailableDetails.details.size, 1);
assert.equal(partiallyAvailableDetails.details.get("1095")?.conteudo_id_origem, "1095");
assert.deepEqual(partiallyAvailableDetails.unavailable, [{
  id: "1096",
  titulo: "Conteúdo removido",
  motivo: "O AgilePoint não abriu o conteúdo 1096.",
}]);

const session = new ApfSession();
const order = [];
await Promise.all([
  session.serialized(async () => {
    order.push("a-start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("a-end");
  }),
  session.serialized(async () => {
    order.push("b-start");
    order.push("b-end");
  }),
]);
assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);

const limitedAccessSession = new ApfSession();
limitedAccessSession.http = {
  get: async (url) => {
    const formId = new URL(url).searchParams.get("formID");
    return { status: 200, text: () => formId === "9127" ? "Acesso negado" : "<html>Formulário autorizado</html>" };
  },
};
const limitedAccessCheck = await limitedAccessSession.verifyHttpConnection(["7153", "9127"]);
assert.equal(limitedAccessCheck.connected, true);
assert.equal(limitedAccessCheck.authenticated, true);
assert.deepEqual(limitedAccessCheck.checks, { formulario_7153: true, formulario_9127: false });

const menuFormBody = `
var idForm = '20';
var formDescription = 'Template - Formulário Principal';
d.c_579 = new HTMLMakerFlowComponent('APF', 20, 579, 0, 64, 217, 353, '', '', '');
d.c_579.XMLMenu = 'eJzAbc==\\n';
`;
const menuXml = `<?xml version="1.0"?><ROOT>
<MENU CODE="1"><DESCRIPTION>APF</DESCRIPTION>
  <MENU CODE="2"><DESCRIPTION>Contagem</DESCRIPTION><FORM>26</FORM><VISIBLE>true</VISIBLE><READONLY>false</READONLY></MENU>
  <MENU CODE="3"><DESCRIPTION>Oculta</DESCRIPTION><FORM>999</FORM><VISIBLE>false</VISIBLE></MENU>
</MENU>
<MENU CODE="4"><DESCRIPTION>Aplicação</DESCRIPTION><FORM>47</FORM><VISIBLE>true</VISIBLE></MENU>
</ROOT>`;
const menuRuleBody = `$mainform().document._ruleReturn = ['${menuXml.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}', 'N', 'http://example.test', new Map(), true];`;
assert.equal(MAIN_MENU_CONTRACT.componentId, "579");
assert.equal(extractWebrunStringProperty(menuFormBody, "579", "XMLMenu"), "eJzAbc==\n");
assert.match(buildMainMenuRequestBody("eJzAbc==\n"), /ruleName=Menu\+-\+Obter\+Dados\+no\+Servidor/);
assert.match(buildMainMenuRequestBody("eJzAbc==\n"), /P_1=eJzAbc%3D%3D/);
assert.equal(parseWebrunRuleReturnFirstString(menuRuleBody), menuXml);
assert.deepEqual(parseWebrunMenuRuleReturn(menuRuleBody)?.permissions.size, 0);
assert.deepEqual(parseAuthorizedMenuXml(menuXml, new Map()).map(({ ref, nome }) => ({ ref, nome })), [
  { ref: "form:47", nome: "Aplicação" },
  { ref: "form:26", nome: "Contagem" },
]);

const permissionMenuXml = `<?xml version="1.0"?><ROOT>
<MENU CODE="1"><DESCRIPTION>Dica de Mestre</DESCRIPTION><FORM>500000385</FORM></MENU>
<MENU CODE="2"><DESCRIPTION>APF</DESCRIPTION>
  <MENU CODE="3"><DESCRIPTION>Contagem</DESCRIPTION><FORM>26</FORM></MENU>
  <MENU CODE="4"><DESCRIPTION>Consulta geral</DESCRIPTION><FORM>56</FORM></MENU>
  <MENU CODE="5"><DESCRIPTION>Aplicação</DESCRIPTION><FORM>47</FORM></MENU>
</MENU>
<MENU CODE="6"><DESCRIPTION>Relatórios</DESCRIPTION>
  <MENU CODE="7"><DESCRIPTION>Relatório de Acompanhamento</DESCRIPTION><FORM>9148</FORM></MENU>
  <MENU CODE="8"><DESCRIPTION>Acompanhamento apf de Sprints</DESCRIPTION><FORM>500000382</FORM></MENU>
  <MENU CODE="9"><DESCRIPTION>Desempenho de Entrega APF</DESCRIPTION><FORM>500000393</FORM></MENU>
</MENU>
</ROOT>`;
const menuResponse = (xml, map) => `$mainform().document._ruleReturn = ['${xml.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}', 'N', 'http://example.test', ${map}, true];`;
const developerMenuResponse = menuResponse(permissionMenuXml, "new Map().add(6,['', '']).add(7,['', '']).add(8,['', '']).add(9,['', ''])");
const managerMenuResponse = menuResponse(permissionMenuXml, "new Map().add(7,['S', 'S']).add(8,['S', 'S']).add(9,['', ''])");
const devMenu = parseWebrunMenuRuleReturn(developerMenuResponse);
const managerMenu = parseWebrunMenuRuleReturn(managerMenuResponse);
assert.ok(devMenu && managerMenu);
assert.deepEqual(parseAuthorizedMenuXml(devMenu.xml, devMenu.permissions).map((item) => item.formulario_id).sort(), ["26", "47", "56", "500000385"].sort());
assert.deepEqual(parseAuthorizedMenuXml(managerMenu.xml, managerMenu.permissions).map((item) => item.formulario_id).sort(), ["26", "47", "56", "9148", "500000382", "500000385"].sort());
assert.equal(parseWebrunMenuRuleReturn(menuResponse(permissionMenuXml, "new Map().add(9,['S', ''])"))?.permissions.get("9")?.enabled, false);
assert.equal(parseWebrunMenuRuleReturn(menuResponse(permissionMenuXml, "new Map().add(9,['S', ''])garbage")), null);
assert.equal(parseWebrunMenuRuleReturn(menuResponse(permissionMenuXml, "new Map().add(9,['S', 'S']).add(9,['S', 'S'])")), null);
assert.equal(parseWebrunMenuRuleReturn(menuResponse(permissionMenuXml, "new Map().add(09,['S', 'S']).add(9,['S', 'S'])")), null);
assert.equal(parseAuthorizedMenuXml(permissionMenuXml.replace('CODE="9"', 'CODE="0009"'), new Map([["9", { visible: false, enabled: false }]])).some((item) => item.formulario_id === "500000393"), false);

let currentMenuResponse = developerMenuResponse;
const permissionSession = new ApfSession();
permissionSession.http = {
  get: async () => ({ status: 200, text: () => menuFormBody }),
  post: async () => ({ status: 200, text: () => currentMenuResponse }),
};
assert.equal((await permissionSession.listAccessibleScreensHttp()).length, 4);
await assert.rejects(() => permissionSession.describeAccessibleScreenHttp("Relatório de Acompanhamento"), /não está disponível/);
currentMenuResponse = managerMenuResponse;
assert.equal((await permissionSession.listAccessibleScreensHttp()).length, 6);
await assert.rejects(() => permissionSession.describeAccessibleScreenHttp("Desempenho de Entrega APF"), /não está disponível/);

const applicationFormBody = `
var idForm = '47'; var formDescription = 'Aplicação'; var pkeys = '149662';
<input name="WEBRUN-CSRFTOKEN" value="csrf-universal">
d.n = new HTMLNavigationForm('APF', 47, 2, 3);
d.n.btDelete.setEnabled(false);
d.t.add('Cadastro'); d.t.add('Configuração de Agente');
d.c_664 = new HTMLEdit('APF', 47, 664, 16, 40, 56, 35, 'Código', '149662'); d.c_664.readonly = true; d.c_664.id = 'EDTAPL_COD';
d.c_665 = new HTMLEdit('APF', 47, 665, 96, 40, 593, 35, 'Nome', 'Teste MCP'); d.c_665.required = true; d.c_665.id = 'EDTAPL_NOME';
d.c_1026479 = new HTMLLookup('APF', 47, 1026479, 15, 182, 346, 35, 'Gerente', '23314', 'Pessoa Alfa');
d.c_1136114 = new HTMLEdit('APF', 47, 1136114, 1, 1, 1, 1, 'Senha', 'segredo');
d.c_9 = new HTMLEdit('APF', 47, 9, 1, 1, 1, 1, '', 'segredo-api'); d.c_9.label = 'Senha de API';
d.c_1136100 = new HTMLButton('APF', 47, 1136100, 1, 1, 1, 1, '<i></i> Sincronizar', '');
d.c_1026480 = new HTMLGrid('APF', 47, 1026480, 16, 237, 673, 284, 7152);
d.c_1026480.totalRows = 2;
cols_1026480 = [{name:'field1026477',title:'Desenvolvedor',visible:true}];
data_1026480 = [{field1026477:'Pessoa Alfa',row:0}];
`;
const screenDescription = parseWebrunScreenDescription(applicationFormBody, "https://example.test/openform.do?formID=47", "47");
assert.equal(screenDescription.nome, "Aplicação");
assert.equal(screenDescription.formulario_id, "47");
assert.equal(screenDescription.registro_id_origem, "149662");
assert.equal(screenDescription.campos.find((field) => field.ref === "component:665").valor, "Teste MCP");
assert.equal(screenDescription.campos.find((field) => field.ref === "component:665").obrigatorio, true);
assert.equal(screenDescription.campos.find((field) => field.ref === "component:1136114").valor, "[PROTEGIDO]");
assert.equal(screenDescription.campos.find((field) => field.ref === "component:1136114").sensivel, true);
assert.equal(screenDescription.campos.find((field) => field.ref === "component:9").rotulo, "Senha de API");
assert.equal(screenDescription.campos.find((field) => field.ref === "component:9").sensivel, true);
assert.equal(screenDescription.campos.find((field) => field.ref === "component:9").valor, "[PROTEGIDO]");
assert.equal(screenDescription.acoes.find((action) => action.ref === "nav:delete").desabilitado, true);
assert.equal(screenDescription.acoes.find((action) => action.ref === "component:1136100").rotulo, "Sincronizar");
assert.deepEqual(screenDescription.tabelas[0].linhas, [["Pessoa Alfa"]]);
assert.equal(new URL(buildFormOpenUrl("https://example.test", 47)).searchParams.get("formID"), "47");
assert.equal(parseWebrunFormState(applicationFormBody).csrfToken, "csrf-universal");
assert.equal(parseWebrunFormState(applicationFormBody).fields.find((field) => field.componentId === "665").inputName, "WFRInput665");
assert.equal(new URL(buildGenericLookupSearchUrl("https://example.test", "47", "1026479", "Jessica")).searchParams.get("componentID"), "1026479");
assert.equal(new URLSearchParams(buildGenericFormActionRequestBody({
  formId: "47", csrfToken: "csrf-universal", action: "postcancel", fields: { WFRInput665: "Teste" },
})).get("WFRInput665"), "Teste");
assert.equal(new URLSearchParams(buildGenericFormActionRequestBody({
  formId: "7156", csrfToken: "csrf-universal", action: "delete",
})).get("pType"), "1");
assert.match(buildConfiguredRuleRequestBody({
  formId: "47", ruleName: "Aplicação - Sincronizar", pType: "2", parentRID: "-1", parameters: { P_0: "Teste" },
}), /ruleName=Aplica%E7%E3o\+-\+Sincronizar/);
assert.match(buildConfiguredRuleRequestBody({
  formId: "35", ruleName: "Importar", pType: "2", parentRID: "-1", parameters: { P_0: "Texto – modelo" },
}), /P_0=Texto\+%96\+modelo/);
assert.throws(() => buildConfiguredRuleRequestBody({
  formId: "35", ruleName: "Importar", pType: "2", parentRID: "-1", parameters: { P_0: "emoji 😀" },
}), /n[aã]o represent[aá]vel/);
assert.match(buildRuleUploadUrl("https://example.test", {
  formId: "47", ruleName: "Aplicação - Anexar", validationRule: "Validar arquivo", multiple: false, parameters: { P_0: "149662" },
}), /ruleName=Aplica%E7%E3o\+-\+Anexar/);
const parsedUploadForm = parseWebrunUploadForm('<form method="post" enctype="multipart/form-data" action="upload.jsp?ok=1"><input type="hidden" name="WEBRUN-CSRFTOKEN" value="csrf"><input type="file" name="uploadFile"></form>', "https://example.test/upload.jsp?sys=APF");
assert.equal(parsedUploadForm.fileField, "uploadFile");
assert.equal(parsedUploadForm.hiddenFields["WEBRUN-CSRFTOKEN"], "csrf");
const multipart = encodeMultipartFormData({ token: "abc" }, { fieldName: "uploadFile", filename: "teste.png", mimeType: "image/png", body: Buffer.from([1, 2, 3]) }, "----AgilePointMcpBoundary123");
assert.match(multipart.contentType, /boundary=----AgilePointMcpBoundary123/);
assert.match(multipart.body.toString("latin1"), /filename="teste\.png"/);
assert.equal(new URL(buildGenericDownloadUrl("https://example.test", "47", "/tmp/arquivo.pdf")).searchParams.get("download_file"), "/tmp/arquivo.pdf");
assert.equal(safeDownloadFilename('attachment; filename="relatorio.pdf"', "/tmp/outro.pdf"), "relatorio.pdf");
assert.equal(validateDownloadedContent("application/pdf", 100, { allowedMimeTypes: ["application/pdf"], maxBytes: 1024 }), "application/pdf");

const customActionConfig = {
  version: 1,
  actions: [{
    formId: "47",
    componentId: "1136100",
    ruleName: "Aplicação - Sincronizar",
    parameters: [
      { name: "P_0", source: "component_value", componentId: "665" },
      { name: "P_1", source: "record_id" },
    ],
    requiresRecordId: true,
    destructive: false,
    refreshAfter: false,
  }],
};
assert.equal(parseCustomActionRegistry(JSON.stringify(customActionConfig)).get("47:1136100").ruleName, "Aplicação - Sincronizar");
const customActionDirectory = await mkdtemp(path.join(tmpdir(), "apf-actions-"));
const customActionFile = path.join(customActionDirectory, "actions.json");
await writeFile(customActionFile, JSON.stringify(customActionConfig), "utf8");
const previousCustomActionsFile = process.env.APF_CUSTOM_ACTIONS_FILE;
process.env.APF_CUSTOM_ACTIONS_FILE = customActionFile;
const uploadActionConfig = {
  version: 1,
  uploads: [{
    formId: "47",
    componentId: "1136100",
    ruleName: "Aplicação - Anexar",
    validationRule: "Aplicação - Validar anexo",
    multiple: true,
    parameters: [{ name: "P_0", source: "record_id" }],
    allowedExtensions: [".png"],
    allowedMimeTypes: ["image/png"],
    maxBytes: 1024,
    requiresRecordId: true,
    refreshAfter: false,
  }],
};
assert.equal(parseUploadActionRegistry(JSON.stringify(uploadActionConfig)).get("47:1136100").ruleName, "Aplicação - Anexar");
const uploadActionFile = path.join(customActionDirectory, "uploads.json");
const uploadTestFile = path.join(customActionDirectory, "evidencia.png");
const uploadTestFile2 = path.join(customActionDirectory, "evidencia-2.png");
await writeFile(uploadActionFile, JSON.stringify(uploadActionConfig), "utf8");
await writeFile(uploadTestFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
await writeFile(uploadTestFile2, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
const previousUploadActionsFile = process.env.APF_UPLOAD_ACTIONS_FILE;
const previousUploadDir = process.env.APF_UPLOAD_DIR;
process.env.APF_UPLOAD_ACTIONS_FILE = uploadActionFile;
process.env.APF_UPLOAD_DIR = customActionDirectory;
const downloadActionConfig = {
  version: 1,
  downloads: [{
    formId: "47",
    componentId: "1136100",
    path: {
      source: "rule_return",
      ruleName: "Aplicacao - Gerar download",
      parameters: [{ name: "P_0", source: "record_id" }],
    },
    allowedPathPrefixes: ["/tmp/"],
    allowedExtensions: [".pdf"],
    allowedMimeTypes: ["application/pdf"],
    maxBytes: 2048,
    requiresRecordId: true,
  }],
};
const parsedDownloadRegistry = parseDownloadActionRegistry(JSON.stringify(downloadActionConfig));
assert.equal(parsedDownloadRegistry.get("47:1136100").path.ruleName, "Aplicacao - Gerar download");
assert.equal(validateDownloadServerPath("/tmp/arquivo.pdf", parsedDownloadRegistry.get("47:1136100")), "/tmp/arquivo.pdf");
assert.throws(() => validateDownloadServerPath("/etc/passwd", parsedDownloadRegistry.get("47:1136100")), /prefixos autorizados/);
const downloadActionFile = path.join(customActionDirectory, "downloads.json");
await writeFile(downloadActionFile, JSON.stringify(downloadActionConfig), "utf8");
const previousDownloadActionsFile = process.env.APF_DOWNLOAD_ACTIONS_FILE;
const previousExportDir = process.env.APF_EXPORT_DIR;
process.env.APF_DOWNLOAD_ACTIONS_FILE = downloadActionFile;
process.env.APF_EXPORT_DIR = customActionDirectory;

process.env.APF_MCP_ROLE = "administrador";
const endpointScreenSession = new ApfSession();
let activeMenuRuleBody = menuRuleBody;
const endpointScreenPosts = [];
let conditionalMonthOptions = false;
let monthOptionValue = "10";
let postcancelReturnsOldId = false;
const monthControl = `
d.c_777 = new HTMLCombo('APF', 47, 777, 1, 1, 1, 1, 'Mês', '');
d.c_777.keys = ['10']; d.c_777.values = ['Outubro'];
`;
const customActionPosts = [];
const uploadPosts = [];
endpointScreenSession.http = {
  get: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/download") {
      const body = Buffer.from("%PDF-1.7\nconteudo de teste", "utf8");
      return {
        status: 200,
        url: parsed.toString(),
        headers: new Headers({ "content-type": "application/pdf", "content-disposition": 'attachment; filename="arquivo.pdf"' }),
        body,
        text: () => body.toString("latin1"),
      };
    }
    if (parsed.pathname === "/upload.jsp") {
      return {
        status: 200,
        url: parsed.toString(),
        text: () => '<form method="post" enctype="multipart/form-data" action="upload.jsp"><input type="hidden" name="WEBRUN-CSRFTOKEN" value="csrf-upload"><input type="file" name="uploadFile"></form>',
      };
    }
    if (parsed.pathname === "/navigate.do") {
      const first = parsed.searchParams.get("param") === "first";
      return {
        status: 200,
        text: () => first
          ? "data_1026480 = [{field1026477:'Pessoa Alfa',row:0}]; d.c_1026480.setGridPageIni(0); d.c_1026480.setGridPageEnd(1); d.c_1026480.isLastPage = false;"
          : "data_1026480 = [{field1026477:'Pessoa Beta',row:1}]; d.c_1026480.setGridPageIni(1); d.c_1026480.setGridPageEnd(2); d.c_1026480.isLastPage = true;",
      };
    }
    return {
      status: 200,
      text: () => parsed.searchParams.get("formID") === "20" ? menuFormBody
        : conditionalMonthOptions ? applicationFormBody + monthControl.replace("keys = ['10']", `keys = ['${monthOptionValue}']`)
        : applicationFormBody,
    };
  },
  getLimited: async (url, maxBytes) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/download");
    const body = Buffer.from("%PDF-1.7\nconteudo de teste", "utf8");
    assert.ok(body.length <= maxBytes);
    return {
      status: 200,
      url: parsed.toString(),
      headers: new Headers({ "content-type": "application/pdf", "content-disposition": 'attachment; filename="arquivo.pdf"' }),
      body,
      text: () => body.toString("latin1"),
    };
  },
  post: async (url, body) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/executeRule.do") {
      const parameters = new URLSearchParams(body);
      if (parameters.get("ruleName") === "Menu - Obter Dados no Servidor") return { status: 200, text: () => activeMenuRuleBody };
      if (parameters.get("ruleName") === "Aplicacao - Gerar download") {
        return { status: 200, text: () => "$mainform().document._ruleReturn = '/tmp/arquivo.pdf';" };
      }
      customActionPosts.push({ parameters, body });
      return { status: 200, text: () => "$mainform().document._ruleReturn = 'ok';" };
    }
    const parameters = new URLSearchParams(body);
    endpointScreenPosts.push(parameters);
    if (conditionalMonthOptions) {
      return { status: 200, text: () => parameters.get("param") === "include"
        ? `d.c_777.setValue('${monthOptionValue}');`
        : parameters.get("param") === "postcancel"
          ? applicationFormBody.replace("pkeys = '149662'", "pkeys = '149663'")
          : applicationFormBody };
    }
    return { status: 200, text: () => applicationFormBody
      .replace("Teste MCP", parameters.get("WFRInput665") ?? "Teste MCP")
      .replace("pkeys = '149662'", parameters.get("param") === "postcancel" && !postcancelReturnsOldId
        ? "pkeys = '149663'" : "pkeys = '149662'") };
  },
  postMultipart: async (url, fields, file, headers) => {
    uploadPosts.push({ url, fields, file, headers });
    return { status: 200, text: () => "<html><script>window.close();</script></html>" };
  },
};
const endpointScreens = await endpointScreenSession.listAccessibleScreensHttp();
assert.deepEqual(endpointScreens.map((screen) => screen.ref), ["form:47", "form:26"]);
const endpointDescription = await endpointScreenSession.describeAccessibleScreenHttp("Aplicação");
assert.equal(endpointDescription.formulario_id, "47");
assert.equal(endpointDescription.acoes.find((action) => action.ref === "component:1136100").endpoint_disponivel, true);
assert.match(endpointDescription.acoes.find((action) => action.ref === "component:1136100").contrato_fingerprint, /^[a-f0-9]{64}$/);
assert.equal(endpointDescription.acoes.find((action) => action.ref === "nav:include").endpoint_disponivel, true);
process.env.APF_MCP_ROLE = "desenvolvedor";
const devDescription = await endpointScreenSession.describeAccessibleScreenHttp("Aplicação");
assert.equal(devDescription.acoes.find((action) => action.ref === "nav:include").endpoint_disponivel, false);
assert.equal(devDescription.acoes.find((action) => action.ref === "nav:edit").endpoint_disponivel, false);
process.env.APF_MCP_ROLE = "administrador";

const recordOpenSession = new ApfSession();
recordOpenSession.listAccessibleScreensHttp = async () => [
  { ref: "form:47", nome: "Aplicação", formulario_id: "47", visivel: true, origem: "menu" },
  { ref: "form:26", nome: "Contagem", formulario_id: "26", visivel: true, origem: "menu" },
];
const recordOpenUrls = [];
let recordResponse = applicationFormBody;
recordOpenSession.http = { get: async (url) => {
  recordOpenUrls.push(new URL(url));
  return { status: 200, text: () => recordResponse };
} };
assert.equal((await recordOpenSession.describeAccessibleScreenHttp("form:47")).registro_id_origem, "149662");
recordOpenUrls.length = 0;
await recordOpenSession.validateScreenOperationsHttp({ tela: "form:47", registro_id: "149662", operacoes: [{ tipo: "clicar", alvo: "Atualizar" }] });
assert.equal(recordOpenUrls[0].searchParams.get("goto"), "-1");
assert.equal(recordOpenUrls[0].searchParams.get("filter"), "APF_APLICACAO.APL_COD=149662@long");
recordResponse = "var idForm = '26'; var formDescription = 'Contagem'; var pkeys = '3452'; <input name=\"WEBRUN-CSRFTOKEN\" value=\"csrf\">";
recordOpenUrls.length = 0;
await recordOpenSession.describeAccessibleScreenHttp("form:26");
await assert.rejects(() => recordOpenSession.validateScreenOperationsHttp({ tela: "form:26", registro_id: "3452", operacoes: [{ tipo: "clicar", alvo: "Atualizar" }] }), /não foi encontrado/);
assert.equal(recordOpenUrls.at(-1).searchParams.get("filter"), "APF_CONTAGEM.CTG_COD=3452@long");
recordResponse = "var idForm = '26'; var pkeys = '9999';";
await assert.rejects(() => recordOpenSession.validateScreenOperationsHttp({ tela: "form:26", registro_id: "3452", operacoes: [{ tipo: "clicar", alvo: "Atualizar" }] }), /abriu o registro 9999/);
recordResponse = "var idForm = '26';";
await assert.rejects(() => recordOpenSession.validateScreenOperationsHttp({ tela: "form:26", registro_id: "3452", operacoes: [{ tipo: "clicar", alvo: "Atualizar" }] }), /não retornou um ID/);
recordResponse = "Acesso negado";
await assert.rejects(() => recordOpenSession.validateScreenOperationsHttp({ tela: "form:26", registro_id: "3452", operacoes: [{ tipo: "clicar", alvo: "Atualizar" }] }), /negou acesso/);
const endpointRead = await endpointScreenSession.readAccessibleScreenHttp("Aplicação", 10);
assert.deepEqual(endpointRead.tabelas[0].linhas, [["Pessoa Alfa"], ["Pessoa Beta"]]);
assert.deepEqual(endpointRead.leitura, {
  completa: true,
  limite_linhas_por_grade: 10,
  grades: [{
    grade_ref: "component:1026480",
    paginas_consultadas: 2,
    linhas_disponiveis: 2,
    linhas_retornadas: 2,
    completa: true,
    truncada_por_limite: false,
  }],
});
const limitedEndpointRead = await endpointScreenSession.readAccessibleScreenHttp("Aplicação", 1);
assert.equal(limitedEndpointRead.tabelas[0].truncada, true);
assert.equal(limitedEndpointRead.leitura.completa, false);
assert.equal(limitedEndpointRead.leitura.grades[0].truncada_por_limite, true);
const endpointValidation = await endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação",
  operacoes: [
    { tipo: "preencher", alvo: "Nome", valor: "Novo nome" },
    { tipo: "clicar", alvo: "Sincronizar" },
  ],
});
assert.deepEqual(endpointValidation.alvos, ["component:665", "component:1136100"]);
assert.deepEqual(endpointValidation.validacoes.map(({ resultado }) => resultado), ["valido", "valido"]);
await assert.rejects(() => endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação",
  operacoes: [{ tipo: "marcar", alvo: "Nome", valor: true }],
}), /não é um campo de marcação/);
await assert.rejects(() => endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação",
  operacoes: [{ tipo: "preencher", alvo: "component:1136114", valor: "segredo-novo" }],
}), /campos sensíveis/);
const previousUniversalWriteEnabled = process.env.APF_WRITE_ENABLED;
process.env.APF_WRITE_ENABLED = "true";
const endpointUiPreview = createUiSimulation({
  tela: "Aplicação",
  operacoes: [
    { tipo: "clicar", alvo: "Incluir" },
    { tipo: "preencher", alvo: "Nome", valor: "Criado por endpoint" },
    { tipo: "clicar", alvo: "Gravar registro" },
  ],
}, ["nav:include", "component:665", "nav:save"], screenDescription);
const endpointUiSimulation = consumeUiSimulation(endpointUiPreview.confirmacao_token);
assert.deepEqual(endpointUiSimulation.registro_alvo, { formulario_id: "47", registro_id_origem: "149662" });
activeMenuRuleBody = menuResponse(menuXml, "new Map().add(4,['', ''])");
await assert.rejects(() => endpointScreenSession.readAccessibleScreenHttp("Aplicação"), /não está disponível/);
await assert.rejects(() => endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação", operacoes: [{ tipo: "preencher", alvo: "Nome", valor: "Novo nome" }],
}), /não está disponível/);
await assert.rejects(() => endpointScreenSession.executeScreenOperationsHttp(endpointUiSimulation), /não está disponível/);
assert.equal(endpointScreenPosts.length, 0);
activeMenuRuleBody = menuRuleBody;
const endpointExecution = await endpointScreenSession.executeScreenOperationsHttp(endpointUiSimulation);
assert.equal(endpointExecution.transporte_dados, "endpoint_interno");
assert.equal(endpointScreenPosts.length, 4);
assert.equal(endpointScreenPosts[0].get("param"), "include");
assert.equal(endpointScreenPosts[1].get("param"), "cancel");
assert.equal(endpointScreenPosts[2].get("param"), "include");
assert.equal(endpointScreenPosts[3].get("param"), "postcancel");
assert.equal(endpointScreenPosts[3].get("WFRInput665"), "Criado por endpoint");
markUiSimulationConsumed(endpointUiPreview.confirmacao_token);
endpointScreenPosts.length = 0;
postcancelReturnsOldId = true;
await assert.rejects(() => endpointScreenSession.executeScreenOperationsHttp(endpointUiSimulation), /sem confirmar o ID estável esperado/);
assert.equal(endpointScreenPosts.some((post) => post.get("param") === "postcancel"), true);
postcancelReturnsOldId = false;
endpointScreenPosts.length = 0;
conditionalMonthOptions = true;
const monthInput = { tela: "Aplicação", operacoes: [
  { tipo: "clicar", alvo: "Incluir" },
  { tipo: "selecionar", alvo: "Mês", valor: "10" },
  { tipo: "clicar", alvo: "Gravar registro" },
] };
process.env.APF_MCP_ROLE = "desenvolvedor";
await assert.rejects(() => endpointScreenSession.validateScreenOperationsHttp(monthInput), /não possui capacidade local para include/);
assert.equal(endpointScreenPosts.length, 0);
process.env.APF_MCP_ROLE = "administrador";
const monthValidation = await endpointScreenSession.validateScreenOperationsHttp(monthInput);
assert.deepEqual(monthValidation.alvos, ["nav:include", "component:777", "nav:save"]);
assert.deepEqual(endpointScreenPosts.map((post) => post.get("param")), ["include", "cancel"]);
endpointScreenPosts.length = 0;
await assert.rejects(() => endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação", operacoes: [
    { tipo: "clicar", alvo: "Incluir" },
    { tipo: "selecionar", alvo: "Mês", valor: "13" },
  ],
}), /não foi publicada/);
assert.deepEqual(endpointScreenPosts.map((post) => post.get("param")), ["include", "cancel"]);
const monthPreview = createUiSimulation(monthInput, monthValidation.alvos, monthValidation.tela, monthValidation.contratos_acoes);
endpointScreenPosts.length = 0;
await endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(monthPreview.confirmacao_token));
assert.deepEqual(endpointScreenPosts.map((post) => post.get("param")), ["include", "cancel", "include", "postcancel"]);
assert.equal(endpointScreenPosts[3].get("WFRInput777"), "10");
markUiSimulationConsumed(monthPreview.confirmacao_token);
endpointScreenPosts.length = 0;
const monthByLabelInput = { tela: "Aplicação", operacoes: [
  { tipo: "clicar", alvo: "Incluir" },
  { tipo: "selecionar", alvo: "Mês", valor: "Outubro" },
  { tipo: "clicar", alvo: "Gravar registro" },
] };
const monthByLabelValidation = await endpointScreenSession.validateScreenOperationsHttp(monthByLabelInput);
const monthByLabelPreview = createUiSimulation(monthByLabelInput, monthByLabelValidation.alvos, monthByLabelValidation.tela, monthByLabelValidation.contratos_acoes);
endpointScreenPosts.length = 0;
monthOptionValue = "11";
await assert.rejects(
  () => endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(monthByLabelPreview.confirmacao_token)),
  /parâmetros resolvidos mudaram/,
);
assert.equal(endpointScreenPosts.some((post) => post.get("param") === "postcancel"), false);
markUiSimulationConsumed(monthByLabelPreview.confirmacao_token);
monthOptionValue = "10";
endpointScreenPosts.length = 0;
conditionalMonthOptions = false;
const configuredActionInput = {
  tela: "Aplicação",
  operacoes: [{ tipo: "clicar", alvo: "Sincronizar" }],
};
const configuredActionValidation = await endpointScreenSession.validateScreenOperationsHttp(configuredActionInput);
const configuredActionPreview = createUiSimulation(
  configuredActionInput,
  configuredActionValidation.alvos,
  configuredActionValidation.tela,
  configuredActionValidation.contratos_acoes,
);
assert.equal(configuredActionPreview.simulacao.formulario_alvo_id, "47");
assert.equal(configuredActionPreview.simulacao.resolved_inputs["0"].P_0, "Teste MCP");
assert.equal(configuredActionPreview.simulacao.resolved_inputs["0"].P_1, "149662");
const configuredActionExecution = await endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(configuredActionPreview.confirmacao_token));
assert.equal(configuredActionExecution.operacoes_executadas, 1);
assert.match(customActionPosts.at(-1).body, /ruleName=Aplica%E7%E3o\+-\+Sincronizar/);
assert.equal(customActionPosts.at(-1).parameters.get("P_0"), "Teste MCP");
assert.equal(customActionPosts.at(-1).parameters.get("P_1"), "149662");
markUiSimulationConsumed(configuredActionPreview.confirmacao_token);
const driftPreview = createUiSimulation(
  configuredActionInput,
  configuredActionValidation.alvos,
  configuredActionValidation.tela,
  configuredActionValidation.contratos_acoes,
);
consumeUiSimulation(driftPreview.confirmacao_token).resolved_input_digests["0"] = "0".repeat(64);
await assert.rejects(() => endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(driftPreview.confirmacao_token)), /parâmetros resolvidos mudaram/);
markUiSimulationConsumed(driftPreview.confirmacao_token);
const formDriftPreview = createUiSimulation(
  configuredActionInput,
  configuredActionValidation.alvos,
  configuredActionValidation.tela,
  configuredActionValidation.contratos_acoes,
);
consumeUiSimulation(formDriftPreview.confirmacao_token).formulario_alvo_id = "999";
await assert.rejects(() => endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(formDriftPreview.confirmacao_token)), /formulário resolvido mudou/);
markUiSimulationConsumed(formDriftPreview.confirmacao_token);
const editedParameterValidation = await endpointScreenSession.validateScreenOperationsHttp({
  tela: "Aplicação",
  operacoes: [
    { tipo: "clicar", alvo: "nav:edit" },
    { tipo: "preencher", alvo: "Nome", valor: "Nome alterado" },
    { tipo: "clicar", alvo: "nav:save" },
    { tipo: "clicar", alvo: "Sincronizar" },
  ],
});
assert.equal(editedParameterValidation.contratos_acoes.resolvedInputs["3"].P_0, "Nome alterado");
const configuredUploadInput = {
  tela: "Aplicação",
  operacoes: [{ tipo: "anexar", alvo: "Sincronizar", caminho: uploadTestFile }],
};
const configuredUploadValidation = await endpointScreenSession.validateScreenOperationsHttp(configuredUploadInput);
const configuredUploadPreview = createUiSimulation(
  configuredUploadInput,
  configuredUploadValidation.alvos,
  configuredUploadValidation.tela,
  configuredUploadValidation.contratos_acoes,
);
const configuredUploadExecution = await endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(configuredUploadPreview.confirmacao_token));
assert.equal(configuredUploadExecution.operacoes_executadas, 1);
assert.equal(uploadPosts.length, 1);
assert.equal(uploadPosts[0].fields["WEBRUN-CSRFTOKEN"], "csrf-upload");
assert.equal(uploadPosts[0].file.fieldName, "uploadFile");
assert.equal(uploadPosts[0].file.filename, "evidencia.png");
assert.equal(new URL(uploadPosts[0].url).pathname, "/upload.jsp");
markUiSimulationConsumed(configuredUploadPreview.confirmacao_token);
const multipleUploadInput = {
  tela: "Aplicação",
  operacoes: [
    { tipo: "anexar", alvo: "Sincronizar", caminho: uploadTestFile },
    { tipo: "anexar", alvo: "Sincronizar", caminho: uploadTestFile2 },
  ],
};
const multipleUploadValidation = await endpointScreenSession.validateScreenOperationsHttp(multipleUploadInput);
assert.notEqual(multipleUploadValidation.contratos_acoes.uploadDigests["0"], multipleUploadValidation.contratos_acoes.uploadDigests["1"]);
const multipleUploadPreview = createUiSimulation(multipleUploadInput, multipleUploadValidation.alvos, multipleUploadValidation.tela, multipleUploadValidation.contratos_acoes);
const multipleUploadExecution = await endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(multipleUploadPreview.confirmacao_token));
assert.equal(multipleUploadExecution.operacoes_executadas, 2);
assert.equal(uploadPosts.length, 3);
markUiSimulationConsumed(multipleUploadPreview.confirmacao_token);
const configuredDownloadInput = {
  tela: "Aplicação",
  operacoes: [{ tipo: "baixar", alvo: "Sincronizar" }],
};
const configuredDownloadValidation = await endpointScreenSession.validateScreenOperationsHttp(configuredDownloadInput);
const configuredDownloadPreview = createUiSimulation(
  configuredDownloadInput,
  configuredDownloadValidation.alvos,
  configuredDownloadValidation.tela,
  configuredDownloadValidation.contratos_acoes,
);
process.env.APF_WRITE_ENABLED = "false";
const configuredDownloadExecution = await endpointScreenSession.executeScreenOperationsHttp(consumeUiSimulation(configuredDownloadPreview.confirmacao_token));
assert.equal(configuredDownloadExecution.downloads.length, 1);
assert.match(path.basename(configuredDownloadExecution.downloads[0]), /-arquivo\.pdf$/);
markUiSimulationConsumed(configuredDownloadPreview.confirmacao_token);
process.env.APF_WRITE_ENABLED = "true";

let genericRecordDeleted = false;
let targetedDeleteOpened = false;
const deleteSession = new ApfSession();
deleteSession.http = {
  get: async (url) => {
    const parsed = new URL(url);
    if (parsed.searchParams.get("formID") === "20") return { status: 200, text: () => menuFormBody };
    if (parsed.searchParams.get("formID") === "47" && parsed.searchParams.get("filter") === "APF_APLICACAO.APL_COD=149662@long") targetedDeleteOpened = true;
    const enabledDeleteBody = applicationFormBody
      .replace("d.n.btDelete.setEnabled(false);", "")
      .replace("var pkeys = '149662';", `var pkeys = '${genericRecordDeleted ? "150000" : "149662"}';`);
    return { status: 200, text: () => enabledDeleteBody };
  },
  post: async (url, body) => {
    if (new URL(url).pathname === "/executeRule.do") return { status: 200, text: () => menuRuleBody };
    const parameters = new URLSearchParams(body);
    assert.equal(parameters.get("param"), "delete");
    assert.equal(parameters.get("pType"), "1");
    genericRecordDeleted = true;
    return { status: 200, text: () => applicationFormBody.replace("var pkeys = '149662';", "var pkeys = '150000';") };
  },
};
const deletePreview = createUiSimulation({
  tela: "Aplicação",
  registro_id: "149662",
  operacoes: [{ tipo: "clicar", alvo: "Excluir registro" }],
}, ["nav:delete"], { formulario_id: "47", registro_id_origem: "149662" });
const deleteExecution = await deleteSession.executeScreenOperationsHttp(consumeUiSimulation(deletePreview.confirmacao_token));
assert.equal(genericRecordDeleted, true);
assert.equal(targetedDeleteOpened, true);
assert.notEqual(deleteExecution.tela.registro_id_origem, "149662");
markUiSimulationConsumed(deletePreview.confirmacao_token);
if (previousUniversalWriteEnabled === undefined) delete process.env.APF_WRITE_ENABLED;
else process.env.APF_WRITE_ENABLED = previousUniversalWriteEnabled;
if (previousCustomActionsFile === undefined) delete process.env.APF_CUSTOM_ACTIONS_FILE;
else process.env.APF_CUSTOM_ACTIONS_FILE = previousCustomActionsFile;
if (previousUploadActionsFile === undefined) delete process.env.APF_UPLOAD_ACTIONS_FILE;
else process.env.APF_UPLOAD_ACTIONS_FILE = previousUploadActionsFile;
if (previousUploadDir === undefined) delete process.env.APF_UPLOAD_DIR;
else process.env.APF_UPLOAD_DIR = previousUploadDir;
if (previousDownloadActionsFile === undefined) delete process.env.APF_DOWNLOAD_ACTIONS_FILE;
else process.env.APF_DOWNLOAD_ACTIONS_FILE = previousDownloadActionsFile;
if (previousExportDir === undefined) delete process.env.APF_EXPORT_DIR;
else process.env.APF_EXPORT_DIR = previousExportDir;
await rm(customActionDirectory, { recursive: true, force: true });

const previousWriteEnabled = process.env.APF_WRITE_ENABLED;
process.env.APF_WRITE_ENABLED = "true";
const endpointAssociationSession = new ApfSession();
endpointAssociationSession.resolveExactCountIdHttp = async () => "17331";
endpointAssociationSession.countFunctionsById = async () => ({
  count: { recordId: "17331", application: "Projeto", version: "1.0.0", closed: false },
  functions: [{
    _record_id: "9001",
    _primary_keys: ["9001"],
    field743: "Consultar cliente",
    _contributions: [{ field806: 100, _foreign_ids: { usuario: "7001" } }],
  }],
});
endpointAssociationSession.resolveContributionUsersHttp = async () => [{ userId: "7002", percentage: 100 }];
endpointAssociationSession.openCountDocumentById = async () => ({ url: "https://example.test/openform.do?formID=26", body: "" });
const endpointAssociationCalls = [];
endpointAssociationSession.replaceFunctionContributionsHttp = async (...args) => endpointAssociationCalls.push(args);
const endpointAssociationResult = await endpointAssociationSession.associateFunctionUsers({
  contagem: { aplicacao: "Projeto", versao_sprint: "1.0.0", situacao: "Aberta" },
  funcoes: ["Consultar cliente"],
  usuarios: [{ usuario: "Pessoa", percentual: 100 }],
  modo: "substituir",
  colaborador_id: null,
  colaborador_nome: null,
  quantidade_funcoes_solicitadas: 1,
  percentual_total: 100,
});
assert.equal(endpointAssociationResult.contagem_id, "17331");
assert.deepEqual(endpointAssociationResult.funcoes_alteradas, [{
  funcao: "Consultar cliente",
  associacoes_anteriores: 1,
  usuarios_associados: 1,
}]);
assert.deepEqual(endpointAssociationCalls[0].slice(1), [1, "9001", [{ userId: "7002", percentage: 100 }]]);
if (previousWriteEnabled === undefined) delete process.env.APF_WRITE_ENABLED;
else process.env.APF_WRITE_ENABLED = previousWriteEnabled;

process.env.APF_WRITE_ENABLED = "true";
const applicationDeveloperSession = new ApfSession();
applicationDeveloperSession.resolveExactLookupHttp = async () => ({ id: "149662", label: "Teste MCP" });
applicationDeveloperSession.resolveApplicationDevelopersHttp = async () => [
  { id: "23314", label: "Pessoa Alfa 000.000.000-01" },
  { id: "23524", label: "Pessoa Beta 000.000.000-02" },
];
let applicationRows = [{ _record_id: "8001", _foreign_ids: { desenvolvedor: "23314" } }];
applicationDeveloperSession.applicationDevelopersById = async () => applicationRows;
applicationDeveloperSession.openApplicationDocumentById = async () => ({ url: "https://example.test/openform.do?formID=47", body: "" });
const insertedApplicationDevelopers = [];
applicationDeveloperSession.insertApplicationDeveloperHttp = async (_referer, _applicationId, developerId) => {
  insertedApplicationDevelopers.push(developerId);
  applicationRows = [...applicationRows, { _record_id: "8002", _foreign_ids: { desenvolvedor: developerId } }];
};
const applicationDeveloperResult = await applicationDeveloperSession.associateApplicationDevelopers({
  aplicacao: "Teste MCP",
  desenvolvedores: ["Pessoa Alfa 000.000.000-01", "Pessoa Beta 000.000.000-02"],
  modo: "adicionar",
  colaborador_id: null,
  colaborador_nome: null,
  quantidade_desenvolvedores: 2,
});
assert.equal(applicationDeveloperResult.aplicacao_id, "149662");
assert.deepEqual(insertedApplicationDevelopers, ["23524"]);
assert.deepEqual(applicationDeveloperResult.desenvolvedores_ja_associados, [{ id: "23314", nome: "Pessoa Alfa 000.000.000-01" }]);

const applicationDeveloperRollbackSession = new ApfSession();
applicationDeveloperRollbackSession.resolveExactLookupHttp = async () => ({ id: "149662", label: "Teste MCP" });
applicationDeveloperRollbackSession.resolveApplicationDevelopersHttp = async () => [
  { id: "23314", label: "Pessoa Alfa 000.000.000-01" },
  { id: "23524", label: "Pessoa Beta 000.000.000-02" },
];
let rollbackApplicationRows = [];
applicationDeveloperRollbackSession.applicationDevelopersById = async () => rollbackApplicationRows;
applicationDeveloperRollbackSession.openApplicationDocumentById = async () => ({ url: "https://example.test/openform.do?formID=47", body: "" });
let applicationInsertAttempt = 0;
applicationDeveloperRollbackSession.insertApplicationDeveloperHttp = async (_referer, _applicationId, developerId) => {
  applicationInsertAttempt += 1;
  if (applicationInsertAttempt === 2) throw new Error("falha simulada");
  rollbackApplicationRows = [{ _record_id: "8001", _foreign_ids: { desenvolvedor: developerId } }];
};
const rolledBackDeveloperIds = [];
applicationDeveloperRollbackSession.deleteApplicationDeveloperByIdHttp = async (_applicationId, developerId) => {
  rolledBackDeveloperIds.push(developerId);
  rollbackApplicationRows = rollbackApplicationRows.filter((row) => row._foreign_ids.desenvolvedor !== developerId);
};
await assert.rejects(() => applicationDeveloperRollbackSession.associateApplicationDevelopers({
  aplicacao: "Teste MCP",
  desenvolvedores: ["Pessoa Alfa 000.000.000-01", "Pessoa Beta 000.000.000-02"],
  modo: "adicionar",
  colaborador_id: null,
  colaborador_nome: null,
  quantidade_desenvolvedores: 2,
}), /foram removidas/);
assert.deepEqual(rolledBackDeveloperIds, ["23314"]);
if (previousWriteEnabled === undefined) delete process.env.APF_WRITE_ENABLED;
else process.env.APF_WRITE_ENABLED = previousWriteEnabled;

process.env.APF_MCP_ROLE = "administrador";
const preview = createAssociationSimulation({
  contagem: { aplicacao: "Aplicação de teste", versao_sprint: "1.0.0", situacao: "Aberta" },
  usuarios: [{ usuario: "Usuário de teste", percentual: 100 }],
  modo: "substituir",
});
const recovered = consumeAssociationSimulation(preview.confirmacao_token);
assert.equal(recovered.quantidade_funcoes_solicitadas, "todas");
assert.equal(recovered.percentual_total, 100);
assert.equal(associationHash(recovered), associationHash(recovered));
markAssociationConsumed(preview.confirmacao_token);
assert.throws(() => consumeAssociationSimulation(preview.confirmacao_token), /inexistente ou expirado/);

const applicationDeveloperPreview = createApplicationDeveloperSimulation({
  aplicacao: "Teste MCP",
  desenvolvedores: ["Pessoa Alfa 000.000.000-01"],
  modo: "adicionar",
});
const applicationDeveloperSimulation = consumeApplicationDeveloperSimulation(applicationDeveloperPreview.confirmacao_token);
assert.equal(applicationDeveloperSimulation.quantidade_desenvolvedores, 1);
assert.equal(applicationDeveloperHash(applicationDeveloperSimulation), applicationDeveloperHash(applicationDeveloperSimulation));
markApplicationDeveloperSimulationConsumed(applicationDeveloperPreview.confirmacao_token);
assert.throws(() => consumeApplicationDeveloperSimulation(applicationDeveloperPreview.confirmacao_token), /inexistente ou expirado/);
assert.throws(() => createApplicationDeveloperSimulation({
  aplicacao: "Teste MCP",
  desenvolvedores: ["Pessoa", " pessoa "],
  modo: "adicionar",
}), /duplicados/);

assert.throws(() => createAssociationSimulation({
  contagem: { aplicacao: "Projeto", versao_sprint: "1.0", situacao: "Aberta" },
  usuarios: [
    { usuario: "Usuário", percentual: 50 },
    { usuario: " usuario ", percentual: 50 },
  ],
  modo: "substituir",
}), /duplicados/);

assert.throws(() => createAssociationSimulation({
  contagem: { aplicacao: "Projeto", versao_sprint: "1.0", situacao: "Aberta" },
  usuarios: [{ usuario: "Usuário", percentual: 99 }],
  modo: "substituir",
}), /deve ser 100%/);

const pointPreview = createPointSimulation({
  contagem: {
    acao: "usar_existente",
    aplicacao: "Projeto de teste",
    versao_sprint: "1.0.0",
    situacao: "Aberta",
  },
  funcoes: [{
    nome: "Consultar cliente",
    itens: [{
      descricao: "Consulta cadastral",
      tipo: "CE",
      atividade: "I",
      td: 4,
      ar_tr: 1,
      complexidade: "Baixa",
      pf: 3,
      fator_aplicado: 1.25,
    }],
  }],
  referencia_externa: "TESTE-1",
});
const pointSimulation = consumePointSimulation(pointPreview.confirmacao_token);
assert.match(specializedActionTool("26", "508"), /exportar_relatorio_contagem/);
assert.equal(specializedActionTool("500000382", "1136078"), "exportar_relatorio_sprint");
assert.equal(specializedActionTool("9148", "1135991"), "exportar_relatorio_acompanhamento");
assert.equal(specializedActionTool("9146", "1135975"), "exportar_relatorio_premiacao");
assert.equal(specializedActionTool("500000385", "1136126"), "publicar_dica_mestre");
const previousReportDirectory = process.env.APF_EXPORT_DIR;
process.env.APF_EXPORT_DIR = tmpdir();
try {
  const reportValidationSession = new ApfSession();
  await assert.rejects(() => reportValidationSession.exportAwardsReport("31/02/2026", "08/10/2026"), /inválida/);
  await assert.rejects(() => reportValidationSession.exportAwardsReport("09/10/2026", "08/10/2026"), /posterior/);
  await assert.rejects(() => reportValidationSession.exportTrackingReport(2026, 13, "Teste"), /inválido/);
  reportValidationSession.listAccessibleScreensHttp = async () => [];
  await assert.rejects(() => reportValidationSession.exportSprintReport("Teste MCP"), /não está no menu/);
  await assert.rejects(() => reportValidationSession.exportTrackingReport(2026, 10, "Teste MCP"), /não está no menu/);
  await assert.rejects(() => reportValidationSession.exportAwardsReport("01/10/2026", "08/10/2026"), /não está no menu/);
} finally {
  if (previousReportDirectory === undefined) delete process.env.APF_EXPORT_DIR;
  else process.env.APF_EXPORT_DIR = previousReportDirectory;
}
const publishedConventions = [
  { CON_COD: 1, CON_NOME: "Inclusão", CON_SIGLA: "I", CON_VALOR: 1 },
  { CON_COD: 2, CON_NOME: "Alteração", CON_SIGLA: "A", CON_VALOR: 0.8 },
  { CON_COD: 3, CON_NOME: "Exclusão", CON_SIGLA: "E", CON_VALOR: 0.3 },
  { CON_COD: 4, CON_NOME: "Teste", CON_SIGLA: "T", CON_VALOR: 0.5 },
  { CON_COD: 5, CON_NOME: "Man. em Interface", CON_SIGLA: "MI", CON_VALOR: 0.2 },
];
const conventionsJson = JSON.stringify(publishedConventions);
const conventions = parseActivityConventions(conventionsJson);
assert.deepEqual(conventions.map(({ atividade, fator }) => [atividade, fator]), [["I", 1], ["A", 0.8], ["E", 0.3], ["T", 0.5], ["MI", 0.2]]);
assert.throws(() => parseActivityConventions("[]"), /lista válida/);
assert.throws(() => parseActivityConventions(JSON.stringify([...publishedConventions, publishedConventions[0]])), /ambígua/);
assert.throws(() => assertPointFactorsMatchConventions(pointSimulation.funcoes, conventions), /diverge/);
const validPointFunctions = [{ ...pointSimulation.funcoes[0], itens: [{ ...pointSimulation.funcoes[0].itens[0], fator_aplicado: 1 }] }];
assert.doesNotThrow(() => assertPointFactorsMatchConventions(validPointFunctions, conventions));
assert.throws(() => assertPointFactorsMatchConventions([{ ...validPointFunctions[0], itens: [{ ...validPointFunctions[0].itens[0], atividade: "AV" }] }], conventions), /não possui fator publicado/);
assert.throws(() => createPointSimulation({
  contagem: { acao: "criar", aplicacao: "Teste MCP", versao_sprint: "MCP-HOMOLOG-20261007-FIX1", tipo_contagem: "Projeto de Desenvolvimento", mes_competencia: 10, ano_competencia: 2026, fator_equivalencia: "Desenvolvimento do zero" },
  funcoes: [{ nome: "Teste", itens: [{ descricao: "Teste", tipo: "EE", atividade: "I", td: 1, ar_tr: 1, complexidade: "Baixa", pf: 3, fator_aplicado: 1 }] }],
}), /20 caracteres/);
assert.equal(pointSimulation.total_pf, 3);
assert.equal(pointSimulation.total_pf_equivalente, 3.75);
assert.equal(pointSimulation.funcoes[0].itens[0].pf_equivalente, 3.75);
assert.equal(pointHash(pointSimulation), pointHash(pointSimulation));
markPointSimulationConsumed(pointPreview.confirmacao_token);
assert.throws(() => consumePointSimulation(pointPreview.confirmacao_token), /inexistente ou expirado/);

process.env.APF_WRITE_ENABLED = "true";
const endpointPointSession = new ApfSession();
endpointPointSession.resolveExactCountIdHttp = async () => "17331";
endpointPointSession.countFunctionsById = async () => ({
  count: { recordId: "17331", application: "Projeto de teste", version: "1.0.0", closed: false },
  functions: [],
});
endpointPointSession.openCountDocumentById = async () => ({ url: "https://example.test/openform.do?formID=26", body: `d.c_1895236190.setValue('${conventionsJson}');` });
const endpointPointCalls = [];
endpointPointSession.insertCountFunctionHttp = async (_referer, _countId, funcao) => {
  endpointPointCalls.push(["funcao", funcao.nome]);
  return { id: "9001", position: 1 };
};
endpointPointSession.insertFunctionItemsHttp = async (_referer, _countId, functionId, position, items) => {
  endpointPointCalls.push(["itens", functionId, position, items.length]);
};
const endpointPointResult = await endpointPointSession.submitPointFunctions({ ...pointSimulation, funcoes: validPointFunctions });
assert.equal(endpointPointResult.lancamento_id, "17331");
assert.equal(endpointPointResult.contagem_criada, false);
assert.equal(endpointPointResult.transporte_dados, "endpoint_interno");
assert.deepEqual(endpointPointCalls, [["funcao", "Consultar cliente"], ["itens", "9001", 1, 1]]);

const countCreationSession = new ApfSession();
countCreationSession.lookupOptions = async (kind, query) => ({
  options: [{
    id: kind === "aplicacao" ? "149662" : kind === "tipo_contagem" ? "2" : kind === "ano_competencia" ? "2026" : "1",
    label: query,
  }],
  complete: true,
  source: { endpoint: "/search.do", contract: kind },
});
const countCreationPosts = [];
countCreationSession.http = {
  get: async () => ({ status: 200, text: () => '<input name="WEBRUN-CSRFTOKEN" value="csrf-teste">' }),
  post: async (_url, body) => {
    countCreationPosts.push(new URLSearchParams(body));
    return countCreationPosts.length === 1
      ? { status: 200, text: () => `d.c_1897093694.setValue('29/09/2026 12:00:00');d.c_1645652289.setValue('');d.c_627836279.setValue('');d.c_1895236190.setValue('${conventionsJson}');d.c_1323048149.setValue('7001'); try { doNothing(); } catch(e) { handleException(e) }` }
      : { status: 200, text: () => "pkeys = '17332'; d.c_416.setValue('149662');" };
  },
};
countCreationSession.openCountDocumentById = async () => ({
  url: "https://example.test/openform.do?formID=26",
  body: "d.c_416 = new HTMLLookup('APF', 26, 416, 0, 0, 100, 35, 'Aplicação', '149662', 'Teste MCP'); d.c_409 = new HTMLEdit('APF', 26, 409, 0, 0, 100, 35, 'Versão', 'MCP-2.0.0'); pkeys='17332';",
});
const createdCountId = await countCreationSession.createCountHttp({
  ...pointSimulation,
  funcoes: validPointFunctions,
  contagem: {
    acao: "criar",
    aplicacao: "Teste MCP",
    versao_sprint: "MCP-2.0.0",
    situacao: "Aberta",
    tipo_contagem: "Projeto de Desenvolvimento",
    mes_competencia: 9,
    ano_competencia: 2026,
    fator_equivalencia: "Desenvolvimento do zero",
  },
});
assert.equal(createdCountId, "17332");
assert.equal(countCreationPosts[0].get("param"), "include");
assert.equal(countCreationPosts[1].get("param"), "postcancel");
assert.equal(countCreationPosts[1].get("WFRInput1323048149"), "7001");
const rejectedCountPosts = [];
countCreationSession.http.post = async (_url, body) => {
  const submitted = new URLSearchParams(body);
  rejectedCountPosts.push(submitted);
  return { status: 200, text: () => submitted.get("param") === "include"
    ? `d.c_1897093694.setValue('29/09/2026 12:00:00');d.c_1895236190.setValue('${conventionsJson}');d.c_1323048149.setValue('7001');`
    : "" };
};
await assert.rejects(() => countCreationSession.createCountHttp({
  ...pointSimulation,
  contagem: {
    acao: "criar", aplicacao: "Teste MCP", versao_sprint: "MCP-2.0.1", situacao: "Aberta",
    tipo_contagem: "Projeto de Desenvolvimento", mes_competencia: 9, ano_competencia: 2026,
    fator_equivalencia: "Desenvolvimento do zero",
  },
}), /diverge/);
assert.deepEqual(rejectedCountPosts.map((body) => body.get("param")), ["include", "cancel"]);
countCreationSession.http.post = async () => ({ status: 200, text: () => "<script>parent.interactionError('Erro não especificado!', null, null);</script>" });
await assert.rejects(() => countCreationSession.createCountHttp({
  ...pointSimulation,
  funcoes: validPointFunctions,
  contagem: {
    acao: "criar", aplicacao: "Teste MCP", versao_sprint: "MCP-2.0.1", situacao: "Aberta",
    tipo_contagem: "Projeto de Desenvolvimento", mes_competencia: 9, ano_competencia: 2026,
    fator_equivalencia: "Desenvolvimento do zero",
  },
}), /recusou/);

const endpointNewCountSession = new ApfSession();
endpointNewCountSession.createCountHttp = async () => "17332";
endpointNewCountSession.countFunctionsById = endpointPointSession.countFunctionsById;
endpointNewCountSession.openCountDocumentById = endpointPointSession.openCountDocumentById;
endpointNewCountSession.insertCountFunctionHttp = endpointPointSession.insertCountFunctionHttp;
endpointNewCountSession.insertFunctionItemsHttp = endpointPointSession.insertFunctionItemsHttp;
const endpointNewCountResult = await endpointNewCountSession.submitPointFunctions({
  ...pointSimulation,
  funcoes: validPointFunctions,
  contagem: {
    acao: "criar", aplicacao: "Teste MCP", versao_sprint: "MCP-2.0.0", situacao: "Aberta",
    tipo_contagem: "Projeto de Desenvolvimento", mes_competencia: 9, ano_competencia: 2026,
    fator_equivalencia: "Desenvolvimento do zero",
  },
});
assert.equal(endpointNewCountResult.contagem_criada, true);
assert.equal(endpointNewCountResult.transporte_dados, "endpoint_interno");

const rollbackPointSession = new ApfSession();
rollbackPointSession.resolveExactCountIdHttp = async () => "17331";
rollbackPointSession.countFunctionsById = endpointPointSession.countFunctionsById;
rollbackPointSession.openCountDocumentById = endpointPointSession.openCountDocumentById;
let generatedFunctionId = 9000;
rollbackPointSession.insertCountFunctionHttp = async () => ({ id: String(++generatedFunctionId), position: generatedFunctionId - 9000 });
rollbackPointSession.insertFunctionItemsHttp = async (_referer, _countId, functionId) => {
  if (functionId === "9002") throw new Error("falha simulada no item");
};
const rolledBackIds = [];
rollbackPointSession.deleteFunctionByIdHttp = async (_countId, functionId) => rolledBackIds.push(functionId);
await assert.rejects(() => rollbackPointSession.submitPointFunctions({
  ...pointSimulation,
  funcoes: [validPointFunctions[0], { ...validPointFunctions[0], nome: "Consultar fornecedor" }],
}), /foram removidas/);
assert.deepEqual(rolledBackIds, ["9002", "9001"]);
if (previousWriteEnabled === undefined) delete process.env.APF_WRITE_ENABLED;
else process.env.APF_WRITE_ENABLED = previousWriteEnabled;

assert.throws(() => createPointSimulation({
  contagem: { acao: "criar", aplicacao: "Projeto", versao_sprint: "2.0.0" },
  funcoes: [{
    nome: "Função",
    itens: [{ descricao: "Item", tipo: "EE", atividade: "I", td: 1, ar_tr: 1, complexidade: "Baixa", pf: 3, fator_aplicado: 1 }],
  }],
}), /Para criar a contagem/);

const uiPreview = createUiSimulation({
  tela: "Cadastro de teste",
  operacoes: [
    { tipo: "preencher", alvo: "Descrição", valor: "Valor de teste" },
    { tipo: "clicar", alvo: "Salvar" },
  ],
  justificativa: "Teste automatizado",
}, ["id:WFRInput1", "id:saveButton"]);
const uiSimulation = consumeUiSimulation(uiPreview.confirmacao_token);
assert.equal(uiSimulation.destrutiva, false);
assert.equal(uiSimulation.alvos_validados.length, 2);
assert.equal(uiHash(uiSimulation), uiHash(uiSimulation));
markUiSimulationConsumed(uiPreview.confirmacao_token);
assert.throws(() => consumeUiSimulation(uiPreview.confirmacao_token), /inexistente ou expirado/);

const destructivePreview = createUiSimulation({
  tela: "Cadastro de teste",
  operacoes: [{ tipo: "clicar", alvo: "Excluir registro" }],
}, ["id:removeButton"]);
assert.equal(destructivePreview.requer_confirmacao_exclusao, true);
assert.throws(() => validateUniversalInput({
  tela: "Cadastro",
  operacoes: [{ tipo: "preencher", alvo: "Senha", valor: "não registrar" }],
}), /campos sensíveis/);
assert.throws(() => validateUniversalInput({ tela: "Funcionalidade", registro_id: "2100x", operacoes: [{ tipo: "clicar", alvo: "Excluir" }] }), /numérico/);
assert.throws(() => validateUniversalInput({ tela: "Funcionalidade", titulo_esperado: "Teste", operacoes: [{ tipo: "clicar", alvo: "Excluir" }] }), /exige ID/);

const sanitizedUrl = sanitizeUrl("https://example.test/action.do?formID=26&cpf=000.000.000-03&nome=Pessoa");
assert.match(sanitizedUrl, /formID=26/);
assert.match(sanitizedUrl, /cpf=%5BOMITIDO%5D/);
assert.doesNotMatch(sanitizedUrl, /111\.222/);
assert.doesNotMatch(sanitizedUrl, /Pessoa/);

const sanitizedJson = sanitizeBody(JSON.stringify({ action: "save", password: "segredo", cpf: "11122233344", nome: "Pessoa" }), "application/json");
assert.deepEqual(sanitizedJson, { action: "save", password: "[OMITIDO]", cpf: "[OMITIDO]", nome: "[string:6]" });

const headers = sanitizeHeaders({ authorization: "Bearer segredo", cookie: "sid=segredo", "content-type": "application/json", "x-requested-with": "XMLHttpRequest" });
assert.deepEqual(headers, { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" });

const javascript = sanitizeBody("cols_123 = [{name: 'Pessoa', total: 42}];", "text/plain");
assert.equal(javascript.formato, "javascript-assignment");
assert.equal(javascript.destino, "cols_123");
assert.doesNotMatch(javascript.estrutura, /Pessoa|42/);

const internalUrl = buildInternalUrl("https://example.test", "/navigate.do", { sys: "APF", formID: 7153, inner: true });
assert.equal(internalUrl, "https://example.test/navigate.do?sys=APF&formID=7153&inner=true");
assert.throws(() => buildInternalUrl("https://example.test", "/fora.do", {}), /não autorizado/);
assert.equal(validateInternalUrl("https://example.test", "https://example.test/navigate.do?q=teste"), "https://example.test/navigate.do?q=teste");
assert.throws(() => validateInternalUrl("https://example.test", "https://outro.test/navigate.do"), /mesmo domínio/);
assert.equal(APPLICATION_DEVELOPER_GRID_CONTRACT.formId, "47");
assert.equal(APPLICATION_DEVELOPER_GRID_CONTRACT.childFormId, "7152");
assert.match(buildApplicationOpenUrl("https://example.test", 149662), /filter=APF_APLICACAO.APL_COD%3D149662%40long/);
assert.equal(
  buildApplicationDeveloperGridInsertUrl("https://example.test"),
  "https://example.test/gridEdit.do?sys=APF&action=gridEdit&param=insert&formID=47&comID=1026480&gt=-1",
);
const developerPost = new URL(buildApplicationDeveloperGridPostUrl("https://example.test", {
  applicationId: 101,
  developerId: 202,
  line: 0,
}));
assert.equal(developerPost.pathname, "/gridEdit.do");
assert.equal(developerPost.searchParams.get("param"), "post");
assert.equal(developerPost.searchParams.get("WFRInput966896522"), "101");
assert.equal(developerPost.searchParams.get("WFRInput1026477"), "202");
assert.equal(developerPost.searchParams.get("WFRInput1111357777"), "");
assert.throws(() => buildApplicationDeveloperGridPostUrl("https://example.test", {
  applicationId: "101&admin=true",
  developerId: 202,
  line: 0,
}), /deve ser numérico/);
assert.equal(COUNT_FUNCTION_GRID_CONTRACT.componentId, "505");
assert.match(buildCountFunctionGridInsertUrl("https://example.test"), /comID=505/);
const functionPost = new URL(buildCountFunctionGridPostUrl("https://example.test", {
  countId: 17331, name: "MCP_ENDPOINT_TESTE_01", functionPoints: 3,
}));
assert.equal(functionPost.searchParams.get("WFRInput2014322866"), "17331");
assert.equal(functionPost.searchParams.get("WFRInput743"), "MCP_ENDPOINT_TESTE_01");
assert.equal(functionPost.searchParams.get("WFRInput1135868"), "3");

assert.equal(COUNT_FORM_WRITE_CONTRACT.formId, "26");
const includeCountBody = new URLSearchParams(buildCountIncludeRequestBody("csrf-teste"));
assert.equal(includeCountBody.get("param"), "include");
assert.equal(includeCountBody.get("goto"), "0");
assert.equal(includeCountBody.get("WEBRUN-CSRFTOKEN"), "csrf-teste");
assert.equal(new URLSearchParams(buildCountCancelRequestBody("csrf-teste")).get("param"), "cancel");
const createCountBody = new URLSearchParams(buildCountCreateRequestBody({
  csrfToken: "csrf-teste",
  application: { id: "149662", label: "Teste MCP" },
  version: "MCP-2.0.0",
  countType: { id: "2", label: "Projeto de Desenvolvimento" },
  month: 9,
  year: { id: "2026", label: "2026" },
  equivalenceFactor: { id: "1", label: "Desenvolvimento do zero" },
  purpose: "Homologação",
  scope: "Teste",
  defaults: { createdAt: "29/09/2026 12:00:00", userId: "7001", conventionsJson: "[]" },
}));
assert.equal(createCountBody.get("param"), "postcancel");
assert.equal(createCountBody.get("goto"), "0");
assert.equal(createCountBody.has("filter"), false);
assert.equal(createCountBody.has("forceGetResponse"), false);
assert.equal(createCountBody.get("WFRInput476Show"), "");
assert.equal(createCountBody.get("WFRInput416"), "149662");
assert.equal(createCountBody.get("WFRInput409"), "MCP-2.0.0");
assert.equal(createCountBody.get("WFRInput1135977"), "9");
assert.equal(createCountBody.get("WFRInput1026485"), "149662");
assert.equal(createCountBody.get("WFRInput1026486"), "MCP-2.0.0");
assert.throws(() => buildCountCreateRequestBody({
  csrfToken: "csrf-teste", application: { id: "149662", label: "Teste MCP" }, version: "MCP-HOMOLOG-20261007-FIX1",
  countType: { id: "2", label: "Projeto de Desenvolvimento" }, month: 10,
  year: { id: "2026", label: "2026" }, equivalenceFactor: { id: "2", label: "Desenvolvimento do zero" },
}), /20 caracteres/);
assert.equal(new URLSearchParams(buildCountDeleteRequestBody("csrf-teste")).get("param"), "delete");

assert.equal(FUNCTION_ITEM_GRID_CONTRACT.componentId, "1026482");
assert.match(buildFunctionItemGridInsertUrl("https://example.test"), /comID=1026482/);
const itemPost = new URL(buildFunctionItemGridPostUrl("https://example.test", {
  functionId: 123,
  description: "MCP_ITEM_TESTE_01",
  activityType: "EE",
  activity: "I",
  dataElements: 1,
  filesReferenced: 1,
  complexity: "Baixa",
  functionPoints: 3,
  equivalentFunctionPoints: 3,
}));
assert.equal(itemPost.searchParams.get("WFRInput2086822907"), "123");
assert.equal(itemPost.searchParams.get("WFRInput429"), "MCP_ITEM_TESTE_01");
assert.equal(itemPost.searchParams.get("WFRInput762"), "I");
assert.equal(itemPost.searchParams.get("WFRInput433"), "Baixa");
assert.equal(itemPost.searchParams.get("WFRInput435"), "3");

assert.equal(FUNCTION_CONTRIBUTION_GRID_CONTRACT.componentId, "1026483");
assert.match(buildFunctionContributionGridInsertUrl("https://example.test"), /comID=1026483/);
const contributionPost = new URL(buildFunctionContributionGridPostUrl("https://example.test", {
  functionId: 123, userId: 456, percentage: 100,
}));
assert.equal(contributionPost.searchParams.get("WFRInput2087974631"), "123");
assert.equal(contributionPost.searchParams.get("WFRInput1026478"), "456");
assert.equal(contributionPost.searchParams.get("WFRInput806"), "100");
assert.throws(() => buildFunctionContributionGridPostUrl("https://example.test", {
  functionId: 123, userId: 456, percentage: 101,
}), /entre 1 e 100/);
assert.equal(LOOKUP_CONTRACTS.aplicacao.componentId, "416");
assert.equal(LOOKUP_CONTRACTS.desenvolvedor_aplicacao.formId, "7152");
assert.equal(new URL(buildLookupSearchUrl("https://example.test", "desenvolvedor_aplicacao", "")).searchParams.get("componentID"), "1026477");
assert.match(buildCountOpenUrl("https://example.test", 3633), /filter=APF_CONTAGEM.CTG_COD%3D3633%40long/);
assert.equal(new URL(buildCountSearchOpenUrl("https://example.test")).searchParams.get("formID"), "26");
assert.equal(new URL(buildCountQueryUrl("https://example.test")).pathname, "/basic_query.jsp");
assert.equal(new URL(buildCountQueryResultsUrl("https://example.test")).searchParams.get("componentID"), "-1");
assert.throws(() => buildCountQueryResultsUrl("https://example.test", "pagina-invalida"), /inválida/);
assert.equal(FUNCTION_DEPENDENT_GRID_CONTRACTS.itens.componentId, "1026482");
const dependentUrl = new URL(buildFunctionDependentGridUrl("https://example.test", "contribuicoes", 2));
assert.equal(dependentUrl.searchParams.get("param"), "refreshDependence");
assert.equal(dependentUrl.searchParams.get("gt"), "2");
assert.equal(dependentUrl.searchParams.get("dependentGrid"), "gdContribuicao");
assert.throws(() => buildFunctionDependentGridUrl("https://example.test", "itens", 0), /começar em 1/);
const lookupUrl = new URL(buildLookupSearchUrl("https://example.test", "usuario_contribuicao", "Pessoa"));
assert.equal(lookupUrl.pathname, "/search.do");
assert.equal(lookupUrl.searchParams.get("formID"), "59");
assert.equal(lookupUrl.searchParams.get("componentID"), "1026478");
assert.equal(lookupUrl.searchParams.get("q"), "Pessoa");
assert.deepEqual(
  parseLookupXml('<r><d v=""><d v="456"><![CDATA[Pessoa de Teste]]></d></d><navigation><next enabled="false"/></navigation></r>'),
  [{ id: "456", label: "Pessoa de Teste" }],
);
const assigned = parseWebrunAssignment("var data_123 = [{\"field1\":\"valor; ]\",\"field2\":2}]; other();", "data_123");
assert.deepEqual(assigned, [{ field1: "valor; ]", field2: 2 }]);
assert.equal(recordsHash(assigned), recordsHash([{ field1: "valor; ]", field2: 2 }]));
assert.deepEqual(parseWebrunAssignment("data_123 = [{field1: 'valor', field2: 2,}];", "data_123"), [{ field1: "valor", field2: 2 }]);
assert.deepEqual(
  parseWebrunAssignment("data_505 = [{field743:'Função A',field1135780:d.c_505.gridCheckBox(0, 'true', 'false'),field1026504:d.c_505.gridButton('openForm({form: \\'7155\\'})', 1),row:0}];", "data_505"),
  [{ field743: "Função A", field1135780: null, field1026504: null, row: 0 }],
);
assert.equal(parseWebrunSetValue("d.c_416.setValue('149662');", "416"), "149662");
assert.equal(parseWebrunHiddenValue("d.c_418349335 = new HTMLHidden('APF', 30, 418349335, '81415');", "418349335"), "81415");
assert.equal(parseWebrunLookupValue("d.c_1026478 = new HTMLLookup('APF', 59, 1026478, 23, 72, 506, 35, 'Usuário', '7001', 'Pessoa');", "1026478"), "7001");
assert.deepEqual(
  parseFormRecordIdentity("d.c_416.setValue('149662'); pkeys = '3633';"),
  { recordId: "3633", applicationId: "149662" },
);
assert.equal(parseFormRecordIdentity("pkeys = 'valor-invalido';"), null);
assert.equal(COUNT_REPORT_CONTRACTS.excel.ruleName, "apf - preencher xlsx");
assert.equal(parseGeneratedReportPath("$mainform().__jasperOpenReportConnectionAdd('tmp/11111111-2222-3333-4444-555555555555.pdf');"), "/tmp/11111111-2222-3333-4444-555555555555.pdf");
assert.equal(parseGeneratedReportPath("$mainform().ebfDonwloadStart('/tmp/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.xlsx',false);"), "/tmp/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.xlsx");
assert.equal(parseGeneratedReportPath("ebfDonwloadStart('/tmp/../../segredo.xlsx',false);"), null);
assert.match(buildCountReportRequestBody("pdf", 3633), /ruleName=apf\+-\+emitir\+relat%F3rio/);
assert.match(buildCountReportRequestBody("excel", 3633), /P_0=3633/);
assert.equal(
  buildGeneratedReportDownloadUrl("https://example.test", "/tmp/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.xlsx"),
  "https://example.test/download?download_file=%2Ftmp%2FAAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.xlsx&sys=APF&formID=26",
);
assert.equal(buildGeneratedReportDownloadUrl("https://example.test", "/tmp/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.pdf"), "https://example.test/tmp/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE.pdf");
assert.throws(() => buildGeneratedReportDownloadUrl("https://example.test", "/tmp/../segredo.pdf"), /inválido/);
const editItemUrl = new URL(buildGridRowEditUrl("https://example.test", "item", 2));
assert.equal(editItemUrl.searchParams.get("param"), "edit");
assert.equal(editItemUrl.searchParams.get("comID"), "1026482");
assert.equal(editItemUrl.searchParams.get("gt"), "2");
assert.equal(new URL(buildGridRowDeleteUrl("https://example.test", "contribuicao", 1)).searchParams.get("param"), "delete");
assert.equal(new URL(buildGridCancelUrl("https://example.test", "funcao", "edit")).searchParams.get("param"), "canceledit");
assert.throws(() => buildGridRowEditUrl("https://example.test", "funcao", 0), /começar em 1/);

const queryForm = extractQueryFormParameters(`
  <form name="WFRQueryForm" method="get" action="search.do" target="WFRQueryResults">
    <input name="type$0" value="2"><input name="q$0" value="1.0.0">
    <input name="type$1" value="0"><input name="q$1" value="">
    <input name="type$2" value="2"><input name="q$2" value="Projeto">
    <input name="type$3" value="2"><input name="q$3" value="">
    <input name="type$4" value="2"><input name="q$4" value="Aberta">
    <input name="fieldNum" value="5"><input name="type" value="1">
    <input name="sys" value="APF"><input name="action" value="search">
    <input name="formID" value="26"><input name="componentID" value="-1">
    <input name="showResults" value="true">
  </form>`);
assert.equal(queryForm.get("q$0"), "1.0.0");
assert.equal(queryForm.get("q$2"), "Projeto");
assert.equal(queryForm.get("componentID"), "-1");

const countHtml = `<table id="results-table"><tbody><tr><td>1.0.0</td><td>01/09/2026</td><td>Projeto</td><td>Desenvolvimento</td><td>Aberta</td></tr></tbody></table><li id="nav-item-next" class="disabled"><a>Próxima</a></li>`;
const parsedCounts = extractContagensHtml(countHtml, 10);
assert.equal(parsedCounts.contagens.length, 1);
assert.equal(parsedCounts.contagens[0].versao, "1.0.0");
assert.equal(parsedCounts.contagens[0].contagem_id_origem, null);
assert.equal(parsedCounts.possuiProximaPagina, false);
const encodedCounts = extractContagensHtml('<table id="results-table"><tbody><tr><td>1.0.0</td><td>01/09/2026</td><td>&amp;nbsp;</td><td>Desenvolvimento</td><td>Aberta</td></tr></tbody></table>', 10);
assert.equal(encodedCounts.contagens[0].aplicacao, "");
const countSearchSession = new ApfSession();
let countNavigations = 0;
countSearchSession.http = {
  get: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/openform.do") return { status: 200, text: () => '<input name="WEBRUN-CSRFTOKEN" value="csrf">' };
    if (parsed.pathname === "/basic_query.jsp") return { status: 200, text: () => `<form name="WFRQueryForm" action="search.do"><input name="sys" value="APF"><input name="formID" value="26"><input name="action" value="search"><input name="componentID" value="-1"><input name="q$0" value=""><input name="q$1" value=""><input name="q$2" value=""><input name="q$3" value=""><input name="q$4" value=""></form>` };
    if (parsed.pathname === "/search.do") {
      assert.equal(parsed.searchParams.get("q$0"), "MCP-TESTE-20260929");
      return { status: 200, text: () => `<html><body><script>n.clearGrid(); n.addGridRow(["MCP-TESTE-20260929","29/09/2026 11:22:39","Teste MCP","Projeto de Desenvolvimento","Aberta",]); n.setPaginationState(false, false, false, false);</script></body></html>` };
    }
    if (parsed.pathname === "/navigate.do") countNavigations += 1;
    return { status: 200, text: () => '<table id="results-table"><tbody></tbody></table>' };
  },
  post: async () => ({ status: 200, text: () => "d.c_416.setValue('149662'); pkeys = '3633';" }),
};
const foundCount = await countSearchSession.queryCountsHttp({ versao: "MCP-TESTE-20260929", aplicacao: "Teste MCP" }, 2);
assert.equal(extractContagensHtml(foundCount.html, 2).contagens.length, 1);
assert.equal(foundCount.identities[0].recordId, "3633");
assert.equal(countNavigations, 0);
assert.equal(parseCountSearchResponse("<script>n.clearGrid(); n.setPaginationState(false,false,false,false);</script>", 10).rowCount, 0);
assert.throws(() => parseCountSearchResponse("<html></html>", 10), /grade de contagens válida/);
const importHeader = Array(11).fill(null);
importHeader[2] = "Função Transacional (EE, CE, SE) ou Função de Dados (ALI, AIE)";
importHeader[7] = "Tipo";
importHeader[8] = "(I/A/E/T/AV/MI/AD/MA/AP)";
importHeader[9] = "TD";
importHeader[10] = "AR/TR";
const importLine = (description, type = null, activity = null, td = null, arTr = null) => {
  const row = Array(11).fill(null);
  row[2] = description;
  row[7] = type;
  row[8] = activity;
  row[9] = td;
  row[10] = arTr;
  return row;
};
const importRows = [Array(11).fill(null), importHeader, importLine("Grupo"), importLine("Função A", "EE", "I", 4, 1), Array(11).fill(null), importLine("Função B", "CE", "I", 2, 1)];
const quick = parseQuickImportRows(importRows, "modelo.xlsx", "hash");
assert.equal(quick.intervalo, "C3:K6");
assert.equal(quick.linhas.length, 4);
assert.equal(quick.linhas_separadoras, 1);
assert.deepEqual(JSON.parse(quick.tabela_json)[1], { field0: "Função A", field1: "EE", field2: "I", field3: "4", field4: "1" });
assert.match(quick.tabela_webrun, /^ArrayInstance\(\[\{"field0":'Grupo',"field1":null,"field2":null,"field3":null,"field4":null,JSONInstanceJS:true\}/);
assert.match(quick.tabela_html, /<td colspan="5">Função A<\/td><td>EE<\/td><td>I<\/td><td>4<\/td><td>1<\/td>/);
assert.throws(() => parseQuickImportRows([importHeader, importLine("Inválida", "X")], "modelo.xlsx", "hash"), /tipo da linha/);
assert.throws(() => parseQuickImportRows([importHeader, importLine(null, "EE")], "modelo.xlsx", "hash"), /sem descrição/);
const quickImportSession = new ApfSession();
let quickImportPosted = null;
let quickImportRawBody = "";
const quickImportPosts = [];
quickImportSession.countFunctionsById = async () => ({
  count: { recordId: "3633", application: "Teste MCP", version: "MCP-TESTE-20260929", closed: false },
  functions: quickImportPosted ? [{ _items: [{}, {}] }] : [],
});
quickImportSession.http = {
  get: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/openform.do" && parsed.searchParams.get("formID") === "35") {
      assert.match(parsed.searchParams.get("filter"), /3633/);
      return { status: 200, text: () => "<html><title>Função - excel</title><input id='WFRInput698064244' value='3633'></html>" };
    }
    throw new Error(`Endpoint inesperado: ${parsed.pathname}`);
  },
  post: async (url, body) => {
    assert.equal(new URL(url).pathname, "/executeRule.do");
    quickImportRawBody = body;
    quickImportPosted = new URLSearchParams(body);
    quickImportPosts.push(quickImportPosted);
    return { status: 200, text: () => "$mainform().document._ruleReturn = 'ok';" };
  },
};
const quickImported = await quickImportSession.importQuickCountTable("3633", quick.tabela_webrun, quick.tabela_html, 1, 2);
assert.equal(quickImported.funcoes_depois, 1);
assert.equal(quickImported.itens_depois, 2);
assert.equal(quickImportPosts.length, 2);
assert.equal(quickImportPosts[0].get("formID"), "35");
assert.match(quickImportPosts[0].get("P_0"), /^ArrayInstance\(/);
assert.equal(quickImportPosts[0].get("F_24_698064244"), "3633");
assert.match(quickImportPosts[0].get("F_5_469"), /<table>/);
assert.equal(quickImportPosts[1].get("P_0"), "3633");
assert.match(quickImportRawBody, /ruleName=APF\+-\+recalcular\+contagem/);
if (process.env.APF_TEST_MODEL_XLSX) {
  const previousUploadDir = process.env.APF_UPLOAD_DIR;
  process.env.APF_UPLOAD_DIR = path.dirname(process.env.APF_TEST_MODEL_XLSX);
  try {
    const model = await readQuickImportWorkbook(process.env.APF_TEST_MODEL_XLSX);
    assert.equal(model.intervalo, "C12:K94");
    assert.equal(model.linhas_com_dados, 76);
  } finally {
    if (previousUploadDir === undefined) delete process.env.APF_UPLOAD_DIR;
    else process.env.APF_UPLOAD_DIR = previousUploadDir;
  }
}

assert.equal(validateSecureBaseUrl("https://example.test").origin, "https://example.test");
assert.throws(() => validateSecureBaseUrl("http://example.test"), /HTTPS/);
assert.equal(isCredentialExchange(new URL("https://example.test/executeRule.do"), buildLoginRequestBody("usuario-secreto", "senha-secreta")), true);
assert.equal(inferRoleFromMenu([]), "leitura");
assert.equal(inferRoleFromMenu(["26", "47"]), "desenvolvedor");
assert.equal(inferRoleFromMenu(["26", "9148"]), "gerente");
assert.equal(inferRoleFromMenu(["26", "9148", "7156"]), "administrador");
const priorAuthUser = process.env.APF_USERNAME;
const priorAuthPassword = process.env.APF_PASSWORD;
delete process.env.APF_USERNAME;
delete process.env.APF_PASSWORD;
assert.throws(() => requireRole(["desenvolvedor"], "teste"), /Autentique-se/);
if (priorAuthUser === undefined) delete process.env.APF_USERNAME; else process.env.APF_USERNAME = priorAuthUser;
if (priorAuthPassword === undefined) delete process.env.APF_PASSWORD; else process.env.APF_PASSWORD = priorAuthPassword;
const chatHttp = new WebrunHttpSession("https://example.test");
assert.equal(chatHttp.hasCredentials(), false);
chatHttp.setCredentialsOnce(" usuaria.teste ", "senha-sintetica");
assert.equal(chatHttp.hasCredentials(), true);
assert.throws(() => chatHttp.setCredentialsOnce("outra", "senha"), /já possui uma identidade/);
chatHttp.clearCredentials();
assert.equal(chatHttp.hasCredentials(), false);
assert.equal(chatHttp.cookies.size, 0);

const previousFetch = globalThis.fetch;
const previousHttpTimeout = process.env.APF_HTTP_TIMEOUT_MS;
try {
  const observed = [];
  const guardedSession = new WebrunHttpSession("https://example.test", "u", "p", (exchange) => observed.push(exchange));
  globalThis.fetch = async () => new Response(null, { status: 307, headers: { location: "https://evil.test/capture", "set-cookie": "sid=secret" } });
  await assert.rejects(() => guardedSession.request("https://example.test/start", { method: "POST", body: "secret=1", sensitive: true }), /origem HTTPS/);
  assert.equal(guardedSession.cookies.size, 0);
  assert.equal(observed.length, 0);
  globalThis.fetch = async () => new Response(Buffer.from("12345"), { status: 200, headers: { "content-length": "5" } });
  await assert.rejects(() => guardedSession.request("https://example.test/data", { method: "GET", maxResponseBytes: 4 }), /excede o limite/);
  process.env.APF_HTTP_TIMEOUT_MS = "1000";
  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(null, { status: 307, headers: { location: "https://example.test/next" } })), 600);
    init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
  const timeoutStartedAt = Date.now();
  await assert.rejects(() => guardedSession.request("https://example.test/slow", { method: "GET" }), /limite total/);
  assert.ok(Date.now() - timeoutStartedAt < 1400);
} finally {
  globalThis.fetch = previousFetch;
  if (previousHttpTimeout === undefined) delete process.env.APF_HTTP_TIMEOUT_MS; else process.env.APF_HTTP_TIMEOUT_MS = previousHttpTimeout;
}

const securityDirectory = await mkdtemp(path.join(tmpdir(), "apf-security-"));
const previousApprovalDir = process.env.APF_APPROVAL_DIR;
const previousAuditDir = process.env.APF_AUDIT_DIR;
const previousCapabilitiesFile = process.env.APF_CAPABILITIES_FILE;
const previousSecurityUploadDir = process.env.APF_UPLOAD_DIR;
const previousSecurityRole = process.env.APF_MCP_ROLE;
const previousSecurityCollaborator = process.env.APF_COLLABORATOR_ID;
try {
  process.env.APF_APPROVAL_DIR = path.join(securityDirectory, "approvals");
  process.env.APF_AUDIT_DIR = path.join(securityDirectory, "audit");
  process.env.APF_UPLOAD_DIR = securityDirectory;
  const previousWriteApprovalMode = process.env.APF_WRITE_APPROVAL_MODE;
  const previousWriteEnabled = process.env.APF_WRITE_ENABLED;
  const previousTrustedElicitation = process.env.APF_TRUSTED_CLIENT_ELICITATION;
  try {
    delete process.env.APF_WRITE_APPROVAL_MODE;
    assert.equal(writeApprovalMode(), "automatic");
    process.env.APF_WRITE_APPROVAL_MODE = "invalid";
    assert.throws(() => writeApprovalMode(), /external, delegated ou elicitation/);
    process.env.APF_WRITE_APPROVAL_MODE = "delegated";
    assert.equal(writeApprovalMode(), "delegated");
    assert.equal(writeApprovalMode(true), "external");
    const delegatedPreview = { acao: "criar", alvo: "contagem" };
    const delegatedHash = createHash("sha256").update(JSON.stringify(delegatedPreview)).digest("hex");
    const delegated = await createWriteAuthorization("lancar_pontos_funcao", delegatedHash, delegatedPreview);
    assert.equal(delegated.requer_aprovacao_humana, false);
    assert.equal("aprovacao_id" in delegated, false);
    process.env.APF_WRITE_ENABLED = "false";
    await assert.rejects(() => verifyWriteAuthorization(undefined, "lancar_pontos_funcao", delegatedHash, "chave-delegada"), /gravação está desabilitada/);
    process.env.APF_WRITE_ENABLED = "true";
    await verifyWriteAuthorization(undefined, "lancar_pontos_funcao", delegatedHash, "chave-delegada");
    await assert.rejects(() => verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-destrutiva", true), /exige aprovacao_id/);
    const destructive = await createWriteAuthorization("executar_operacao_tela", delegatedHash, delegatedPreview, true);
    assert.equal(destructive.requer_aprovacao_humana, true);
    process.env.APF_WRITE_APPROVAL_MODE = "elicitation";
    assert.equal(writeApprovalMode(), "elicitation");
    assert.equal(writeApprovalMode(true), "elicitation");
    await assert.rejects(() => createWriteAuthorization("executar_operacao_tela", delegatedHash, delegatedPreview, true), /APF_TRUSTED_CLIENT_ELICITATION/);
    process.env.APF_TRUSTED_CLIENT_ELICITATION = "true";
    const interactive = await createWriteAuthorization("executar_operacao_tela", delegatedHash, delegatedPreview, true);
    assert.equal(interactive.modo, "elicitation");
    assert.equal(interactive.requer_aprovacao_humana, true);
    assert.equal("aprovacao_id" in interactive, false);
    const fakeElicitor = async (request) => {
      assert.match(request.message, /executar_operacao_tela/);
      assert.match(request.message, /"alvo": "contagem"/);
      assert.equal(request.requestedSchema.properties.confirmacao.type, "string");
      return { action: "accept", content: { confirmacao: `APROVAR ${delegatedHash.slice(0, 16).toUpperCase()}` } };
    };
    await verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, delegatedPreview, fakeElicitor);
    await assert.rejects(() => verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, { alvo: "outro" }, fakeElicitor), /não corresponde/);
    await assert.rejects(() => verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, delegatedPreview, async () => ({ action: "decline" })), /não foi aprovada/);
    await assert.rejects(() => verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, delegatedPreview, async () => ({ action: "accept", content: { confirmacao: "APROVAR ERRADO" } })), /não foi aprovada/);
    await assert.rejects(() => verifyWriteAuthorization(undefined, "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, delegatedPreview), /não está disponível/);
    await assert.rejects(() => verifyWriteAuthorization("11111111-1111-4111-8111-111111111111", "executar_operacao_tela", delegatedHash, "chave-interativa", true, true, delegatedPreview, fakeElicitor), /Não envie aprovacao_id/);
  } finally {
    if (previousWriteApprovalMode === undefined) delete process.env.APF_WRITE_APPROVAL_MODE;
    else process.env.APF_WRITE_APPROVAL_MODE = previousWriteApprovalMode;
    if (previousWriteEnabled === undefined) delete process.env.APF_WRITE_ENABLED;
    else process.env.APF_WRITE_ENABLED = previousWriteEnabled;
    if (previousTrustedElicitation === undefined) delete process.env.APF_TRUSTED_CLIENT_ELICITATION;
    else process.env.APF_TRUSTED_CLIENT_ELICITATION = previousTrustedElicitation;
  }
  const approvalPreview = { operacao: "teste", valor: "exato" };
  const approvalHash = createHash("sha256").update(JSON.stringify(approvalPreview)).digest("hex");
  const approval = await createApprovalRequest("teste_seguro", approvalHash, approvalPreview);
  await assert.rejects(() => consumeHumanApproval(approval.aprovacao_id, "teste_seguro", approvalHash, "key-approval"), /ainda não foi aprovada/);
  const approvalFile = path.join(process.env.APF_APPROVAL_DIR, `${approval.aprovacao_id}.json`);
  const approvalCli = spawnSync(process.execPath, ["scripts/approve.mjs", approval.aprovacao_id], {
    cwd: process.cwd(),
    env: { ...process.env, APF_APPROVAL_DIR: process.env.APF_APPROVAL_DIR },
    input: `APROVAR ${approval.aprovacao_id}\n`,
    encoding: "utf8",
  });
  assert.equal(approvalCli.status, 0, approvalCli.stderr);
  assert.match(approvalCli.stdout, /OPERAÇÃO A SER AUTORIZADA/);
  assert.match(approvalCli.stdout, /"valor": "exato"/);
  await consumeHumanApproval(approval.aprovacao_id, "teste_seguro", approvalHash, "key-approval");
  await assert.rejects(() => consumeHumanApproval(approval.aprovacao_id, "teste_seguro", approvalHash, "key-approval"), /já foi utilizada|não existe/);
  const boundPreview = { operacao: "vinculo", alvo: "registro-1" };
  const boundHash = createHash("sha256").update(JSON.stringify(boundPreview)).digest("hex");
  const boundApproval = await createApprovalRequest("teste_vinculo", boundHash, boundPreview);
  const boundFile = path.join(process.env.APF_APPROVAL_DIR, `${boundApproval.aprovacao_id}.json`);
  const boundRecord = JSON.parse(await readFile(boundFile, "utf8"));
  await writeFile(boundFile, JSON.stringify({ ...boundRecord, status: "approved", approved_at: new Date().toISOString() }));
  await verifyHumanApproval(boundApproval.aprovacao_id, "teste_vinculo", boundHash, "key-a");
  await assert.rejects(() => verifyHumanApproval(boundApproval.aprovacao_id, "teste_vinculo", boundHash, "key-b"), /outra chave/);
  const tamperedApproval = await createApprovalRequest("teste_adulteracao", boundHash, boundPreview);
  const tamperedFile = path.join(process.env.APF_APPROVAL_DIR, `${tamperedApproval.aprovacao_id}.json`);
  const tamperedRecord = JSON.parse(await readFile(tamperedFile, "utf8"));
  await writeFile(tamperedFile, JSON.stringify({ ...tamperedRecord, status: "approved", preview: { operacao: "alterada" } }));
  await assert.rejects(() => verifyHumanApproval(tamperedApproval.aprovacao_id, "teste_adulteracao", boundHash, "key-tampered"), /alterada|não corresponde/);
  const normalApprovalDir = process.env.APF_APPROVAL_DIR;
  process.env.APF_APPROVAL_DIR = path.join(securityDirectory, "approval-quota");
  process.env.APF_MAX_APPROVAL_RECORDS = "1";
  await createApprovalRequest("teste_cota", boundHash, boundPreview);
  await assert.rejects(() => createApprovalRequest("teste_cota", boundHash, boundPreview), /limite de retenção/);
  process.env.APF_APPROVAL_DIR = normalApprovalDir;
  delete process.env.APF_MAX_APPROVAL_RECORDS;

  const firstClaim = await claimIdempotency("teste", "chave-segura", "b".repeat(64));
  assert.equal(firstClaim.claimed, true);
  const concurrentClaim = await claimIdempotency("teste", "chave-segura", "b".repeat(64));
  assert.equal(concurrentClaim.claimed, false);
  assert.equal(concurrentClaim.record.status, "pending");
  await completeIdempotency("teste", "chave-segura", "b".repeat(64), "success", undefined, { status: "sucesso", resultado: "omitido" });
  assert.equal((await claimIdempotency("teste", "chave-segura", "b".repeat(64))).record.status, "success");
  assert.equal((await claimIdempotency("teste", "chave-segura", "b".repeat(64))).record.audit_projection.status, "pending");
  await markIdempotencyAuditProjected("teste", "chave-segura", "b".repeat(64));
  assert.equal((await claimIdempotency("teste", "chave-segura", "b".repeat(64))).record.audit_projection.status, "written");
  await assert.rejects(() => claimIdempotency("teste", "chave-segura", "c".repeat(64)), /outro conteúdo/);
  const uncertainClaim = await claimIdempotency("teste-falha-rede", "chave-incerta", "d".repeat(64));
  assert.equal(uncertainClaim.claimed, true);
  const fetchBeforeFault = globalThis.fetch;
  let acceptedPosts = 0;
  const faultServer = createServer((request) => {
    request.on("end", () => {
      if (request.method === "POST") acceptedPosts += 1;
      request.socket.destroy();
    });
    request.resume();
  });
  try {
    await new Promise((resolve) => faultServer.listen(0, "127.0.0.1", resolve));
    const address = faultServer.address();
    assert.ok(address && typeof address === "object");
    globalThis.fetch = (_url, init) => fetchBeforeFault(`http://127.0.0.1:${address.port}/form.do`, init);
    const faultSession = new WebrunHttpSession("https://example.test", "u", "p");
    await assert.rejects(() => faultSession.request("https://example.test/form.do", {
      method: "POST", body: "action=postcancel", sensitive: true,
    }), error => error.origin === "transporte" && ["FALHA_DE_CONEXAO", "RESPOSTA_INTERROMPIDA"].includes(error.code));
  } finally {
    globalThis.fetch = fetchBeforeFault;
    await new Promise((resolve, reject) => faultServer.close((error) => error ? reject(error) : resolve()));
  }
  assert.equal(acceptedPosts, 1, "o cliente HTTP não pode repetir um POST após a resposta se perder");
  await completeIdempotency("teste-falha-rede", "chave-incerta", "d".repeat(64), "outcome_unknown", "A conexão caiu após o envio.");
  const uncertainRetry = await claimIdempotency("teste-falha-rede", "chave-incerta", "d".repeat(64));
  assert.equal(uncertainRetry.claimed, false);
  assert.equal(uncertainRetry.record.status, "outcome_unknown");

  const previousPendingMax = process.env.APF_MAX_PENDING_SIMULATIONS;
  process.env.APF_MAX_PENDING_SIMULATIONS = "1";
  const bounded = new BoundedPendingStore();
  bounded.set("a", { expiresAt: Date.now() + 60_000, value: { grande: "x" } });
  assert.throws(() => bounded.set("b", { expiresAt: Date.now() + 60_000, value: { grande: "y" } }), /limite de simulações/);
  bounded.delete("a");
  bounded.set("b", { expiresAt: Date.now() + 60_000, value: { grande: "y" } });
  if (previousPendingMax === undefined) delete process.env.APF_MAX_PENDING_SIMULATIONS; else process.env.APF_MAX_PENDING_SIMULATIONS = previousPendingMax;

  const capabilitiesFile = path.join(securityDirectory, "capabilities.json");
  await writeFile(capabilitiesFile, JSON.stringify({ version: 1, roles: { desenvolvedor: [{ formIds: ["26"], capabilities: ["field_write"] }] } }));
  process.env.APF_CAPABILITIES_FILE = capabilitiesFile;
  await assertUniversalCapability("desenvolvedor", "26", [{ tipo: "preencher", alvo: "Nome", valor: "x" }]);
  await assert.rejects(() => assertUniversalCapability("desenvolvedor", "47", [{ tipo: "preencher", alvo: "Nome", valor: "x" }]), /não possui capacidade/);
  await assert.rejects(() => assertUniversalCapability("desenvolvedor", "26", [{ tipo: "clicar", alvo: "Excluir" }], ["nav:delete"]), /delete/);
  await assertUniversalCapability("leitura", "47", [{ tipo: "baixar", alvo: "Relatório" }]);
  process.env.APF_CAPABILITIES_FILE = path.resolve("capabilities.developer-all-accessible.example.json");
  for (const role of ["desenvolvedor", "gerente"]) for (const formId of ["26", "47", "500000385"]) {
    await assertUniversalCapability(role, formId, [
      { tipo: "clicar", alvo: "Incluir" },
      { tipo: "preencher", alvo: "Nome", valor: "teste" },
      { tipo: "clicar", alvo: "Gravar" },
      { tipo: "clicar", alvo: "Alterar" },
      { tipo: "clicar", alvo: "Excluir" },
    ], ["nav:include", "component:1", "nav:save", "nav:edit", "nav:delete"]);
    await assert.rejects(() => assertUniversalCapability(role, formId,
      [{ tipo: "clicar", alvo: "Ação personalizada" }], ["component:1136122"]), /custom_action/);
  }
  await assert.rejects(() => assertUniversalCapability("leitura", "26",
    [{ tipo: "clicar", alvo: "Excluir" }], ["nav:delete"]), /delete/);
  await assert.rejects(() => permissionSession.describeAccessibleScreenHttp("form:500000393"), /não está disponível/);

  process.env.APF_AUDIT_INCLUDE_VALUES = "false";
  process.env.APF_MCP_ROLE = "desenvolvedor";
  process.env.APF_COLLABORATOR_ID = "000.000.000-02";
  await recordPointAudit("CPF-000.000.000-02", pointSimulation, { status: "falha", erro: "Projeto de teste contém CPF 000.000.000-02" });
  const auditBody = await readFile(path.join(process.env.APF_AUDIT_DIR, "lancamentos-pf.jsonl"), "utf8");
  assert.doesNotMatch(auditBody, /Projeto de teste|000\.000\.000-02|Consultar cliente|Consulta cadastral/);
  assert.equal((await listOwnPointAudit(10)).length, 1);

  const spoofedFile = path.join(securityDirectory, "falso.png");
  await writeFile(spoofedFile, "isto não é uma imagem", "utf8");
  await assert.rejects(() => validateUploadFile(spoofedFile, parseUploadActionRegistry(JSON.stringify(uploadActionConfig)).get("47:1136100")), /conteúdo do arquivo/);
  const validPdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n");
  assert.equal(detectContentMime(validPdf, ".pdf"), "application/pdf");
  assert.doesNotThrow(() => validateReportContent("pdf", "application/pdf", validPdf));
  assert.throws(() => validateReportContent("pdf", "application/pdf", Buffer.from("%PDF<html><script>alert(1)</script>")), /não corresponde/);
  assert.throws(() => validateReportContent("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.from("PK\u0003\u0004garbage xl/ marker")), /não corresponde/);
  const fakeOle = Buffer.alloc(520);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(fakeOle);
  fakeOle.writeUInt16LE(0xfffe, 28);
  fakeOle.writeUInt16LE(9, 30);
  assert.equal(detectContentMime(fakeOle, ".xls"), "application/octet-stream");
  assert.throws(() => validateReportContent("pdf", "text/html", Buffer.from("<html>login</html>")), /não corresponde/);
} finally {
  if (previousApprovalDir === undefined) delete process.env.APF_APPROVAL_DIR; else process.env.APF_APPROVAL_DIR = previousApprovalDir;
  if (previousAuditDir === undefined) delete process.env.APF_AUDIT_DIR; else process.env.APF_AUDIT_DIR = previousAuditDir;
  if (previousCapabilitiesFile === undefined) delete process.env.APF_CAPABILITIES_FILE; else process.env.APF_CAPABILITIES_FILE = previousCapabilitiesFile;
  if (previousSecurityUploadDir === undefined) delete process.env.APF_UPLOAD_DIR; else process.env.APF_UPLOAD_DIR = previousSecurityUploadDir;
  if (previousSecurityRole === undefined) delete process.env.APF_MCP_ROLE; else process.env.APF_MCP_ROLE = previousSecurityRole;
  if (previousSecurityCollaborator === undefined) delete process.env.APF_COLLABORATOR_ID; else process.env.APF_COLLABORATOR_ID = previousSecurityCollaborator;
  await rm(securityDirectory, { recursive: true, force: true });
}

console.log("testes locais: ok");
