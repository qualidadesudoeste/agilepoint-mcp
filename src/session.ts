import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { DicaMestreEndpoint, DICA_FORM_ID, checkDicaResponse, type DicaSubmission } from "./dica-mestre.js";
import JSON5 from "json5";
import type { AssociationSimulation } from "./associations.js";
import type { ApplicationDeveloperSimulation } from "./application-developers.js";
import type { PointSimulation } from "./points.js";
import { assertPointFactorsMatchConventions, parseActivityConventions, type ActivityConvention } from "./factors.js";
import { specializedActionTool } from "./coverage.js";
import type { UiOperationInput, UiSimulation } from "./universal.js";
import { writeConfigurationStatus } from "./access.js";
import { currentRole } from "./access.js";
import { allowedUniversalCapabilities, assertUniversalCapability, type Capability } from "./capabilities.js";
import { NetworkDiscoveryLogger, type NetworkDiscoveryStatus } from "./network-discovery.js";
import { isLoginDocument, validateSecureBaseUrl, WebrunHttpSession } from "./http-session.js";
import {
  buildInternalUrl,
  buildFormOpenUrl,
  buildGenericFormActionRequestBody,
  buildGenericLookupSearchUrl,
  buildConfiguredRuleRequestBody,
  buildRuleUploadUrl,
  buildMainMenuRequestBody,
  buildApplicationOpenUrl,
  buildApplicationDeveloperGridInsertUrl,
  buildApplicationDeveloperGridPostUrl,
  buildCountOpenUrl,
  buildCountIncludeRequestBody,
  buildCountCancelRequestBody,
  buildCountCreateRequestBody,
  buildCountDeleteRequestBody,
  buildCountQueryResultsUrl,
  buildCountQueryUrl,
  buildCountSearchOpenUrl,
  buildGridCancelUrl,
  buildGridRowDeleteUrl,
  buildGridRowEditUrl,
  buildCountFunctionGridInsertUrl,
  buildCountFunctionGridPostUrl,
  buildFunctionItemGridInsertUrl,
  buildFunctionItemGridPostUrl,
  buildFunctionContributionGridInsertUrl,
  buildFunctionContributionGridPostUrl,
  buildFunctionDependentGridUrl,
  buildCountReportRequestBody,
  buildGeneratedReportDownloadUrl,
  buildGenericDownloadUrl,
  buildRankingApplicationsRequestBody,
  buildRankingUpdateRequestBody,
  buildRepositoryCatalogRequestBody,
  buildRepositoryRankingRequestBody,
  parseGeneratedReportPath,
  buildLookupSearchUrl,
  buildContributionUserLookupSearchUrl,
  parseLookupXml,
  parseFormRecordIdentity,
  parseWebrunHiddenValue,
  parseWebrunLookupValue,
  parseWebrunSetValue,
  parseWebrunAssignment,
  parseWebrunRuleReturn,
  parseWebrunRuleReturnFirstString,
  parseWebrunMenuRuleReturn,
  parseWebrunRuleReturnValue,
  recordsHash,
  validateInternalUrl,
  type LookupKind,
  type LookupOption,
  type FormRecordIdentity,
  type CountReportKind,
  type GridContractKind,
  type ApfRankingAnalysisType,
  type RepositoryCategory,
} from "./internal-api.js";
import {
  deniedDocument,
  extractWebrunStringProperty,
  parseAuthorizedMenuXml,
  parseWebrunScreenDescription,
  parseWebrunScreenTable,
  parseWebrunFormState,
  type WebrunFormState,
} from "./webrun-metadata.js";
import { customActionKey, loadCustomActionRegistry, type CustomActionParameter } from "./custom-actions.js";
import {
  loadUploadActionRegistry,
  parseWebrunUploadForm,
  uploadActionKey,
  validateUploadFile,
  detectContentMime,
} from "./upload-actions.js";
import {
  downloadActionKey,
  loadDownloadActionRegistry,
  safeDownloadFilename,
  validateDownloadedContent,
  validateDownloadServerPath,
  type DownloadActionContract,
} from "./download-actions.js";

const MAIN_FORM_ID = "20";

export class ApfSession {
  masterTipEndpoint(): DicaMestreEndpoint {
    return new DicaMestreEndpoint({ baseUrl: this.baseUrl, http: this.http,
      open: async () => {
        const allowed = await allowedUniversalCapabilities(currentRole(), DICA_FORM_ID);
        if (!allowed.has("publicar_dica_mestre")) throw new Error("A publicação de Dica de Mestre não foi autorizada na política local desta instalação.");
        return this.openAccessibleScreenDocumentHttp(`form:${DICA_FORM_ID}`);
      },
      submissions: () => this.masterTipSubmissionsHttp(),
      resolveId: (row) => this.resolveMasterTipIdHttp(row),
    });
  }

  async masterTipSubmissionsHttp(): Promise<DicaSubmission[]> {
    const parent = await this.openAccessibleScreenDocumentHttp(`form:${DICA_FORM_ID}`);
    if (!/form:\s*['"]500000386['"]/.test(parent.body)) throw new Error("A tela autorizada não publicou a consulta Minhas Inscrições.");
    const url = buildInternalUrl(this.baseUrl, "/openform.do", { sys: "APF", action: "openform", formID: "500000386", mode: -1, goto: -1, filter: "", scrolling: "yes" });
    const body = checkDicaResponse(await this.http.get(url, { Referer: parent.url }), "consultar minhas inscrições");
    if (!/new HTMLGrid\('APF',\s*500000386,\s*1136147,/.test(body) || !/field1136144/.test(body) || !/field1136145/.test(body)) throw new Error("O contrato da grade Minhas Inscrições mudou.");
    const grid = await this.readGridPagesHttp("500000386", "1136147", url, body, 5000);
    if (!grid.complete) throw new Error("A consulta de inscrições está incompleta; a verificação e o envio foram bloqueados.");
    return grid.rows.map((row, index) => ({ titulo: String(row.field1136144 ?? ""), descricao: String(row.field1136145 ?? ""), avaliacao: String(row.field1136146 ?? ""), posicao: index + 1 }));
  }

  private async resolveMasterTipIdHttp(row: DicaSubmission): Promise<string> {
    const referer = buildInternalUrl(this.baseUrl, "/openform.do", { sys: "APF", action: "openform", formID: "500000386" });
    const response = await this.http.get(buildGridRowEditUrl(this.baseUrl, "inscricao_dica", row.posicao), { Referer: referer });
    try {
      const body = checkDicaResponse(response, "identificar inscrição submetida");
      const state = parseWebrunFormState(body);
      const title = state.fields.find(f => f.componentId === "1136144")?.value;
      const description = state.fields.find(f => f.componentId === "1136145")?.value;
      const id = parseWebrunHiddenValue(body, "1493714144");
      if (!id || !/^\d+$/.test(id) || title?.trim() !== row.titulo.trim() || description?.trim() !== row.descricao.trim()) throw new Error("A identificação da inscrição não confirmou o mesmo título/descrição. Não repita o envio.");
      return id;
    } finally {
      checkDicaResponse(await this.http.get(buildGridCancelUrl(this.baseUrl, "inscricao_dica", "edit"), { Referer: referer }), "fechar identificação da inscrição");
    }
  }

  private operationQueue: Promise<void> = Promise.resolve();
  private readonly functionalityCache = new Map<string, { expiresAt: number; value: FunctionalityDetails }>();
  private screenCatalog = new Map<string, ScreenSummary>();

  private readonly baseUrl = validateSecureBaseUrl(process.env.APF_BASE_URL ?? "https://agilepoint.techpulseglobal.com.br").toString().replace(/\/$/, "");
  private readonly username = process.env.APF_AUTH_MODE === "chat" ? undefined : process.env.APF_USERNAME;
  private readonly password = process.env.APF_AUTH_MODE === "chat" ? undefined : process.env.APF_PASSWORD;
  private readonly networkDiscovery = new NetworkDiscoveryLogger(this.baseUrl);
  private readonly http = new WebrunHttpSession(
    this.baseUrl,
    this.username,
    this.password,
    (exchange) => this.networkDiscovery.recordHttpExchange(exchange),
  );

  async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  get sourceBaseUrl(): string {
    return this.baseUrl;
  }

  async authenticateFromChat(username: string, password: string): Promise<ScreenSummary[]> {
    if (this.http.hasCredentials()) throw new Error("Esta sessão MCP já possui uma identidade; reinicie o processo para trocar de conta.");
    this.http.setCredentialsOnce(username, password);
    try {
      const verification = await this.verifyHttpConnection([]);
      if (!verification.authenticated) throw new Error("Autenticação não confirmada.");
      return await this.listAccessibleScreensHttp();
    } catch {
      this.http.clearCredentials();
      this.screenCatalog.clear();
      throw new Error("Não foi possível autenticar no AgilePoint. Confira as credenciais e tente novamente.");
    }
  }

  discoveryStatus(): NetworkDiscoveryStatus {
    return this.networkDiscovery.status();
  }

  async analyzeDiscovery() {
    return this.networkDiscovery.analyze();
  }

  async verifyHttpConnection(formIds: string[]): Promise<{ connected: boolean; authenticated: boolean; checks: Record<string, boolean>; version: string | null }> {
    const checks: Record<string, boolean> = {};
    let version: string | null = null;
    let connected = false;
    let authenticated = false;
    try {
      const response = await this.http.get(buildFormOpenUrl(this.baseUrl, MAIN_FORM_ID));
      const body = response.text();
      connected = response.status >= 200 && response.status < 300;
      authenticated = connected && !isLoginDocument(body) && !deniedDocument(body);
      version = /webrunVersion\s*=\s*["']([^"']+)["']/.exec(body)?.[1] ?? null;
    } catch {
      return { connected, authenticated, checks, version };
    }
    if (!authenticated) return { connected, authenticated, checks, version };
    for (const formId of formIds) {
      if (!/^\d+$/.test(formId)) throw new Error("O formulário interno deve ser numérico.");
      try {
        const url = buildInternalUrl(this.baseUrl, "/openform.do", {
          sys: "APF", action: "openform", formID: formId, mode: -1, goto: -1,
          filter: "", scrolling: false, firstLoad: true,
        });
        const response = await this.http.get(url);
        const body = response.text();
        const denied = isLoginDocument(body) || /Acesso negado|WFRUserNotLogged|sem permiss.o|n.o possui permiss.o/i.test(body);
        checks[`formulario_${formId}`] = response.status >= 200 && response.status < 300 && !denied;
        version ??= /webrunVersion\s*=\s*["']([^"']+)["']/.exec(body)?.[1] ?? null;
      } catch {
        checks[`formulario_${formId}`] = false;
      }
    }
    return { connected, authenticated, checks, version };
  }

  async listAccessibleScreensHttp(): Promise<ScreenSummary[]> {
    const formUrl = buildFormOpenUrl(this.baseUrl, MAIN_FORM_ID);
    const form = await this.http.get(formUrl);
    const formBody = form.text();
    if (form.status < 200 || form.status >= 300 || isLoginDocument(formBody) || deniedDocument(formBody)) {
      throw new Error(`O menu principal não pôde ser aberto por endpoint (${form.status}).`);
    }
    const compressedMenu = extractWebrunStringProperty(formBody, "579", "XMLMenu");
    if (!compressedMenu) throw new Error("O AgilePoint não retornou o catálogo compactado do menu principal.");
    const response = await this.http.post(
      buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
      buildMainMenuRequestBody(compressedMenu),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl },
    );
    const responseBody = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(responseBody) || deniedDocument(responseBody)) {
      throw new Error(`A regra do menu autorizado respondeu HTTP ${response.status}.`);
    }
    const menu = parseWebrunMenuRuleReturn(responseBody);
    if (!menu || !/<ROOT\b/i.test(menu.xml)) throw new Error("A regra do menu não retornou catálogo e permissões válidos.");
    const screens = parseAuthorizedMenuXml(menu.xml, menu.permissions);
    this.screenCatalog = new Map(screens.map((screen) => [screen.ref, screen]));
    return screens;
  }

  async describeAccessibleScreenHttp(screenRef: string): Promise<ScreenDescription> {
    const { target, url, body } = await this.openAccessibleScreenDocumentHttp(screenRef);
    const description = parseWebrunScreenDescription(body, url, target.formulario_id!);
    if (description.formulario_id !== target.formulario_id) {
      throw new Error("O AgilePoint retornou um formulário diferente do item autorizado selecionado.");
    }
    return this.enrichScreenActionsHttp(description);
  }

  async readAccessibleScreenHttp(screenRef: string, rowLimit = 1000): Promise<ScreenRead> {
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 5000) {
      throw new Error("O limite de linhas por grade deve estar entre 1 e 5000.");
    }
    const { target, url, body } = await this.openAccessibleScreenDocumentHttp(screenRef);
    const description = parseWebrunScreenDescription(body, url, target.formulario_id!);
    if (description.formulario_id !== target.formulario_id) {
      throw new Error("O AgilePoint retornou um formulário diferente do item autorizado selecionado.");
    }
    const enrichedDescription = await this.enrichScreenActionsHttp(description);
    const tables: ScreenTable[] = [];
    const grades: ScreenRead["leitura"]["grades"] = [];
    for (const table of description.tabelas) {
      const componentId = /^component:(\d+)$/.exec(table.ref)?.[1];
      if (!componentId) continue;
      const grid = await this.readGridPagesHttp(target.formulario_id!, componentId, url, body, rowLimit);
      const parsed = parseWebrunScreenTable(`${body}\n${grid.firstPageBody}`, componentId, grid.rows, rowLimit);
      if (parsed) tables.push({ ...parsed, truncada: !grid.complete || grid.truncated });
      grades.push({
        grade_ref: table.ref,
        paginas_consultadas: grid.pages,
        linhas_disponiveis: grid.totalRows,
        linhas_retornadas: grid.rows.length,
        completa: grid.complete,
        truncada_por_limite: grid.truncated,
      });
    }
    return {
      ...enrichedDescription,
      tabelas: tables,
      leitura: {
        completa: grades.every((grid) => grid.completa),
        limite_linhas_por_grade: rowLimit,
        grades,
      },
    };
  }

  private async enrichScreenActionsHttp(description: ScreenDescription): Promise<ScreenDescription> {
    const registry = await loadCustomActionRegistry();
    const uploads = await loadUploadActionRegistry();
    const downloads = await loadDownloadActionRegistry();
    const allowed = description.formulario_id
      ? await allowedUniversalCapabilities(currentRole(), description.formulario_id)
      : new Set<Capability>();
    const navigationCapability: Record<string, Capability> = {
      "nav:include": "include", "nav:edit": "edit", "nav:delete": "delete",
      "nav:refresh": "refresh", "nav:save": "save", "nav:cancel": "cancel",
    };
    return {
      ...description,
      campos: description.campos.map((field) => {
        const componentId = field.ref.startsWith("component:") ? field.ref.slice("component:".length) : null;
        const upload = componentId && description.formulario_id
          ? uploads.get(uploadActionKey(description.formulario_id, componentId))
          : undefined;
        return {
          ...field,
          ...(field.tipo === "file" ? { endpoint_disponivel: Boolean(upload && allowed.has("upload")) } : {}),
          ...(upload ? { upload_contrato_fingerprint: upload.fingerprint } : {}),
        };
      }),
      acoes: description.acoes.map((action) => {
        if (!action.ref.startsWith("component:") || !description.formulario_id) {
          const capability = navigationCapability[action.ref];
          return { ...action, endpoint_disponivel: Boolean(capability && allowed.has(capability) && !action.desabilitado) };
        }
        const componentId = action.ref.slice("component:".length);
        const contract = registry.get(customActionKey(description.formulario_id, componentId));
        const upload = uploads.get(uploadActionKey(description.formulario_id, componentId));
        const download = downloads.get(downloadActionKey(description.formulario_id, componentId));
        const specialized = specializedActionTool(description.formulario_id, componentId);
        return {
          ...action,
          endpoint_disponivel: Boolean(!action.desabilitado && ((contract && allowed.has("custom_action"))
            || (upload && allowed.has("upload")) || (download && allowed.has("download")))),
          ...(specialized ? { ferramenta_especializada: specialized } : {}),
          ...(contract ? {
            contrato_fingerprint: contract.fingerprint,
            destrutiva: contract.destructive,
          } : {}),
          ...(upload ? { upload_contrato_fingerprint: upload.fingerprint } : {}),
          ...(download ? { download_contrato_fingerprint: download.fingerprint } : {}),
        };
      }),
    };
  }

  private async openAccessibleScreenDocumentHttp(screenRef: string, recordId?: string): Promise<{
    target: ScreenSummary & { formulario_id: string };
    url: string;
    body: string;
  }> {
    const screens = await this.listAccessibleScreensHttp();
    const normalized = normalize(screenRef);
    const matches = screens.filter((screen) => screen.ref === screenRef || normalize(screen.nome) === normalized);
    if (matches.length !== 1) {
      throw new Error(matches.length ? `A tela "${screenRef}" é ambígua no menu do usuário.` : `A tela "${screenRef}" não está disponível no menu deste usuário.`);
    }
    const target = matches[0];
    if (!target.formulario_id) throw new Error(`A tela "${target.nome}" não possui formulário associado.`);
    if (recordId !== undefined && !/^\d+$/.test(recordId)) throw new Error("O ID do registro deve ser numérico.");
    const url = recordId === undefined ? buildFormOpenUrl(this.baseUrl, target.formulario_id)
      : target.formulario_id === "26" ? buildCountOpenUrl(this.baseUrl, recordId)
        : target.formulario_id === "47" ? buildApplicationOpenUrl(this.baseUrl, recordId)
          : buildInternalUrl(this.baseUrl, "/openform.do", {
            sys: "APF", action: "openform", formID: target.formulario_id, mode: -1, goto: recordId,
            filter: "", scrolling: false, firstLoad: true,
          });
    const response = await this.http.get(url, { Referer: buildFormOpenUrl(this.baseUrl, MAIN_FORM_ID) });
    const body = response.text();
    if (isLoginDocument(body)) throw new Error("A sessão AgilePoint expirou ao abrir o registro; autentique-se novamente.");
    if (deniedDocument(body) || response.status === 401 || response.status === 403) {
      throw new Error(`O AgilePoint negou acesso ao formulário ${target.formulario_id} para a conta autenticada (${response.status}).`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`A abertura do formulário ${target.formulario_id} falhou com HTTP ${response.status}.`);
    }
    if (recordId !== undefined) {
      const openedId = parseFormRecordIdentity(body)?.recordId;
      if (!openedId) throw new Error(`O formulário ${target.formulario_id} não retornou um ID de registro ao abrir ${recordId}; o registro pode não existir ou não estar visível para esta conta.`);
      if (openedId !== recordId) throw new Error(`O formulário ${target.formulario_id} abriu o registro ${openedId}, não o ID solicitado ${recordId}; nenhuma alteração foi autorizada.`);
    }
    return { target: target as ScreenSummary & { formulario_id: string }, url, body };
  }

  async lookupOptions(kind: LookupKind, query = "", limit = 50): Promise<{
    options: LookupOption[];
    complete: boolean;
    source: { endpoint: string; contract: LookupKind };
  }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("O limite do lookup deve estar entre 1 e 200.");
    const url = buildLookupSearchUrl(this.baseUrl, kind, query);
    const response = await this.http.get(url);
    if (response.status < 200 || response.status >= 300) throw new Error(`O lookup ${kind} respondeu HTTP ${response.status}.`);
    const body = response.text();
    if (isLoginDocument(body)) throw new Error("A sessão do lookup expirou e retornou a tela de autenticação.");
    if (deniedDocument(body)) throw new Error(`O AgilePoint negou acesso ao lookup ${kind}. A resposta não indica registro inexistente.`);
    const all = parseLookupXml(body);
    return {
      options: all.slice(0, limit),
      complete: all.length <= limit,
      source: { endpoint: "/search.do", contract: kind },
    };
  }

  async queryCountsHttp(filters: {
    versao?: string;
    data_criacao?: string;
    aplicacao?: string;
    tipo?: string;
    situacao?: "Aberta" | "Fechada";
  }, limit: number): Promise<{ html: string; identities: FormRecordIdentity[] }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("O limite de contagens deve estar entre 1 e 100.");
    const formUrl = buildCountSearchOpenUrl(this.baseUrl);
    const form = await this.http.get(formUrl);
    const formBody = form.text();
    if (form.status < 200 || form.status >= 300 || isLoginDocument(formBody)) {
      throw new Error(`O formulário de contagem não pôde ser aberto por HTTP (${form.status}).`);
    }

    const queryUrl = buildCountQueryUrl(this.baseUrl);
    const query = await this.http.get(queryUrl, { Referer: formUrl });
    const queryBody = query.text();
    if (query.status < 200 || query.status >= 300 || isLoginDocument(queryBody)) {
      throw new Error(`A pesquisa de contagens não pôde ser inicializada por HTTP (${query.status}).`);
    }
    const parameters = extractQueryFormParameters(queryBody);
    const values = [filters.versao, filters.data_criacao, filters.aplicacao, filters.tipo, filters.situacao];
    values.forEach((value, index) => parameters.set(`q$${index}`, value?.trim() ?? ""));
    const searchUrl = buildInternalUrl(this.baseUrl, "/search.do", Object.fromEntries(parameters));
    const searched = await this.http.get(searchUrl, { Referer: queryUrl });
    const searchedBody = searched.text();
    if (searched.status < 200 || searched.status >= 300 || isLoginDocument(searchedBody)) {
      throw new Error(`O filtro de contagens respondeu HTTP ${searched.status}.`);
    }

    // No Webrun, /search.do já devolve a tabela filtrada. Uma chamada posterior
    // a /navigate.do pode voltar à listagem anterior e produzir falso "zero".
    const parsed = parseCountSearchResponse(searchedBody, limit);
    const html = parsed.html;
    const returnedRows = parsed.rowCount;
    const identities = await this.resolveFormRecordsHttp(formUrl, formBody, Math.min(returnedRows, limit));
    return { html, identities };
  }

  async validateRankingEndpoint(): Promise<{
    endpoint: string;
    status_http: number;
    content_type: string;
    bytes: number;
    registros_endpoint: number;
    campos_endpoint: string[];
    paginacao_completa: boolean;
    paginas_consultadas: number;
    variaveis_resposta: string[];
  }> {
    const direct = await this.rankingApfHttp(formatSaoPauloDate(new Date()), "mensal");
    return {
      endpoint: "/navigate.do",
      status_http: direct.status,
      content_type: direct.contentType,
      bytes: direct.bytes,
      registros_endpoint: direct.rows.length,
      campos_endpoint: direct.rows[0] ? Object.keys(direct.rows[0]).sort() : [],
      paginacao_completa: direct.pagination.complete,
      paginas_consultadas: direct.pagination.pages,
      variaveis_resposta: direct.variables,
    };
  }

  async rankingApfHttp(date: string | undefined, analysisType: ApfRankingAnalysisType): Promise<{
    rows: Array<Record<string, unknown>>;
    effectiveDate: string;
    analysisType: ApfRankingAnalysisType;
    pagination: { pages: number; rows: number; complete: boolean; hasNextPage: boolean };
    status: number;
    contentType: string;
    bytes: number;
    variables: string[];
  }> {
    const effectiveDate = date ?? formatSaoPauloDate(new Date());
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(effectiveDate)) throw new Error("A data do ranking deve estar no formato DD/MM/AAAA.");
    const paginationBudget = paginatedResponseBudget();
    const budgetState = { bytes: 0, rows: 0 };
    const formUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "7153", mode: -1, goto: -1,
      filter: "", scrolling: false, firstLoad: true,
    });
    const form = await this.http.get(formUrl);
    const formBody = form.text();
    consumeRankingBudget("ranking de APF", budgetState, paginationBudget, formBody);
    if (form.status < 200 || form.status >= 300 || isLoginDocument(formBody)) {
      throw new Error(`O ranking de APF não pôde ser aberto por HTTP (${form.status}).`);
    }
    if (/Acesso negado|sem permiss.o|n.o possui permiss.o/i.test(formBody)) {
      throw new Error("O usuário autenticado não possui acesso ao ranking de APF.");
    }

    const ruleUrl = buildInternalUrl(this.baseUrl, "/executeRule.do", {});
    const applicationsResponse = await this.http.post(ruleUrl, buildRankingApplicationsRequestBody(), {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: formUrl,
    });
    const applicationsBody = applicationsResponse.text();
    consumeRankingBudget("ranking de APF", budgetState, paginationBudget, applicationsBody);
    if (applicationsResponse.status < 200 || applicationsResponse.status >= 300 || isLoginDocument(applicationsBody)) {
      throw new Error(`A obtenção das aplicações do ranking respondeu HTTP ${applicationsResponse.status}.`);
    }
    const applications = parseWebrunRuleReturn(applicationsBody);
    if (applications === null) throw new Error("O AgilePoint não retornou a lista de aplicações autorizadas para o ranking.");

    const updateResponse = await this.http.post(
      ruleUrl,
      buildRankingUpdateRequestBody(effectiveDate, analysisType, applications, `RULE_MCP_RANKING_${Date.now()}`),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl },
    );
    const updateBody = updateResponse.text();
    consumeRankingBudget("ranking de APF", budgetState, paginationBudget, updateBody);
    if (updateResponse.status < 200 || updateResponse.status >= 300 || isLoginDocument(updateBody)) {
      throw new Error(`A atualização do ranking respondeu HTTP ${updateResponse.status}.`);
    }

    const rows: Array<Record<string, unknown>> = [];
    const pageKeys = new Set<string>();
    const variables = new Set<string>();
    let param: "first" | "next" = "first";
    let goto = 0;
    let status = 0;
    let contentType = "";
    let complete = false;
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.http.get(buildInternalUrl(this.baseUrl, "/navigate.do", {
        sys: "APF", formID: "7153", componentID: "1026496", action: "navigate",
        param, inner: true, gt: goto,
      }), { Referer: formUrl });
      const body = response.text();
      status = response.status;
      contentType = response.headers.get("content-type") ?? "";
      if (response.status < 200 || response.status >= 300) throw new Error(`O endpoint do ranking respondeu HTTP ${response.status}.`);
      if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao consultar o ranking.");
      consumeRankingBudget("ranking de APF", budgetState, paginationBudget, body);
      for (const match of body.matchAll(/(?:^|[;\s])(?:var\s+)?([A-Za-z_$][\w$]*)\s*=/gm)) {
        if (variables.size < 50) variables.add(match[1]);
      }
      const pageRows = parseWebrunAssignment<Array<Record<string, unknown>>>(body, "data_1026496") ?? [];
      const interval = parseGridPageInterval(body, "1026496");
      const pageKey = recordsHash({ interval, rows: pageRows });
      if (!pageRows.length || pageKeys.has(pageKey)) {
        complete = true;
        break;
      }
      pageKeys.add(pageKey);
      consumeRankingBudget("ranking de APF", budgetState, paginationBudget, "", pageRows.length);
      rows.push(...pageRows);
      goto = interval?.end ?? (goto + pageRows.length);
      param = "next";
    }
    if (!complete) throw new Error("O ranking excedeu o limite de 100 páginas; a resposta foi interrompida para não retornar dados incompletos.");
    return {
      rows,
      effectiveDate,
      analysisType,
      pagination: { pages: pageKeys.size, rows: rows.length, complete: true, hasNextPage: false },
      status,
      contentType,
      bytes: budgetState.bytes,
      variables: [...variables],
    };
  }

  async rankingRepositoryHttp(filters: {
    startDate?: string;
    endDate?: string;
    categories: RepositoryCategory[];
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    catalog: Array<{
      id: string;
      titulo: string;
      descricao: string;
      categoria: string;
      media_estrelas: number | null;
      quantidade_avaliacoes: number;
    }>;
    effectivePeriod: { data_inicial: string; data_final: string; categorias: RepositoryCategory[] };
    pagination: { pages: number; rows: number; complete: boolean; hasNextPage: boolean };
  }> {
    const startDate = filters.startDate?.trim() ?? "";
    const endDate = filters.endDate?.trim() ?? "";
    const categories = [...new Set(filters.categories)];
    const paginationBudget = paginatedResponseBudget();
    const budgetState = { bytes: 0, rows: 0 };
    const formUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "9127", mode: -1, goto: -1,
      filter: "", scrolling: false, firstLoad: true,
    });
    const form = await this.http.get(formUrl);
    const formBody = form.text();
    consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, formBody);
    if (form.status < 200 || form.status >= 300 || isLoginDocument(formBody)) {
      throw new Error(`O ranking do repositório não pôde ser aberto por HTTP (${form.status}).`);
    }
    if (/Acesso negado|sem permiss.o|n.o possui permiss.o/i.test(formBody)) {
      throw new Error("O usuário autenticado não possui acesso ao ranking do repositório.");
    }

    const ruleUrl = buildInternalUrl(this.baseUrl, "/executeRule.do", {});
    const update = await this.http.post(
      ruleUrl,
      buildRepositoryRankingRequestBody(startDate, endDate, categories, `RULE_MCP_REPOSITORY_${Date.now()}`),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl },
    );
    const updateBody = update.text();
    consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, updateBody);
    if (update.status < 200 || update.status >= 300 || isLoginDocument(updateBody)) {
      throw new Error(`A atualização do ranking do repositório respondeu HTTP ${update.status}.`);
    }

    const rows: Array<Record<string, unknown>> = [];
    const pageKeys = new Set<string>();
    let param: "first" | "next" = "first";
    let goto = 0;
    let complete = false;
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.http.get(buildInternalUrl(this.baseUrl, "/navigate.do", {
        sys: "APF", formID: "9127", componentID: "1135890", action: "navigate",
        param, inner: true, gt: goto,
      }), { Referer: formUrl });
      const body = response.text();
      if (response.status < 200 || response.status >= 300) throw new Error(`A grade do ranking do repositório respondeu HTTP ${response.status}.`);
      if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao consultar o ranking do repositório.");
      consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, body);
      const pageRows = parseWebrunAssignment<Array<Record<string, unknown>>>(body, "data_1135890") ?? [];
      const interval = parseGridPageInterval(body, "1135890");
      const pageKey = recordsHash({ interval, rows: pageRows });
      if (!pageRows.length || pageKeys.has(pageKey)) {
        complete = true;
        break;
      }
      pageKeys.add(pageKey);
      consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, "", pageRows.length);
      rows.push(...pageRows);
      goto = interval?.end ?? (goto + pageRows.length);
      param = "next";
    }
    if (!complete) throw new Error("O ranking do repositório excedeu 100 páginas; nenhum resultado parcial foi retornado.");

    const catalogUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "500000385", mode: -1, goto: -1,
      filter: "", scrolling: false, firstLoad: true,
    });
    const catalogForm = await this.http.get(catalogUrl);
    const catalogFormBody = catalogForm.text();
    consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, catalogFormBody);
    if (catalogForm.status < 200 || catalogForm.status >= 300 || isLoginDocument(catalogFormBody)) {
      throw new Error(`O catálogo do repositório não pôde ser aberto por HTTP (${catalogForm.status}).`);
    }
    const catalogResponse = await this.http.post(
      ruleUrl,
      buildRepositoryCatalogRequestBody(`RULE_MCP_CATALOG_${Date.now()}`),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: catalogUrl },
    );
    const catalogBody = catalogResponse.text();
    consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, catalogBody);
    if (catalogResponse.status < 200 || catalogResponse.status >= 300 || isLoginDocument(catalogBody)) {
      throw new Error(`A listagem do catálogo respondeu HTTP ${catalogResponse.status}.`);
    }
    const catalogValue = parseWebrunRuleReturnValue<unknown>(catalogBody);
    const catalog = normalizeRepositoryCatalog(catalogValue);
    consumeRankingBudget("ranking do repositório", budgetState, paginationBudget, "", catalog.length);
    if (rows.length && !catalog.length) {
      throw new Error("O AgilePoint retornou o ranking, mas não retornou o catálogo necessário para identificar categoria e conteúdo.");
    }
    return {
      rows,
      catalog,
      effectivePeriod: { data_inicial: startDate, data_final: endDate, categorias: categories },
      pagination: { pages: pageKeys.size, rows: rows.length, complete: true, hasNextPage: false },
    };
  }

  async countFunctionsById(countId: string): Promise<{
    count: { recordId: string; application: string; version: string; closed: boolean };
    functions: Array<Record<string, unknown>>;
  }> {
    const detail = await this.openCountDocumentById(countId);
    const direct = await this.fetchGridEndpointHttp("26", "505", detail.url, detail.body);
    const functions = await this.resolveGridRowIdsHttp(
      detail.url,
      "funcao",
      direct.rows.map((row, index) => ({ ...row, _primary_keys: direct.keys[index] ?? [] })),
      "416960411",
      { contagem: { componentId: "2014322866", type: "hidden" } },
    );
    const detailedFunctions: Array<Record<string, unknown>> = [];
    for (let index = 0; index < functions.length; index += 1) {
      const items = await this.resolveGridRowIdsHttp(
        detail.url,
        "item",
        await this.fetchDependentGridEndpointHttp(detail.url, index + 1, "itens", "1026482"),
        "418349335",
        { funcao: { componentId: "2086822907", type: "hidden" } },
      );
      const contributions = await this.resolveGridRowIdsHttp(
        detail.url,
        "contribuicao",
        await this.fetchDependentGridEndpointHttp(detail.url, index + 1, "contribuicoes", "1026483"),
        "481313862",
        {
          funcao: { componentId: "2087974631", type: "hidden" },
          usuario: { componentId: "1026478", type: "lookup" },
        },
      );
      detailedFunctions.push({ ...functions[index], _items: items, _contributions: contributions });
    }
    return {
      count: readCountHeader(detail.body, countId),
      functions: detailedFunctions,
    };
  }

  async countFunctionSummaryById(countId: string): Promise<{
    count: { recordId: string; application: string; version: string; closed: boolean };
    functionCount: number;
  }> {
    const detail = await this.openCountDocumentById(countId);
    const grid = await this.fetchGridEndpointHttp("26", "505", detail.url, detail.body);
    return {
      count: readCountHeader(detail.body, countId),
      functionCount: grid.rows.length,
    };
  }

  async countActivityConventionsById(countId: string): Promise<{
    count: { recordId: string; application: string; version: string; closed: boolean };
    conventions: ActivityConvention[];
  }> {
    const detail = await this.openCountDocumentById(countId);
    return { count: readCountHeader(detail.body, countId), conventions: publishedActivityConventions(detail.body) };
  }

  async importQuickCountTable(countId: string, tableWebrun: string, tableHtml: string, expectedGroups: number, expectedItems: number): Promise<{
    contagem_id: string;
    funcoes_antes: number;
    funcoes_depois: number;
    grupos_esperados: number;
    itens_antes: number;
    itens_depois: number;
    itens_esperados: number;
    endpoint: string;
  }> {
    if (!/^\d+$/.test(countId)) throw new Error("O ID da contagem deve ser numérico.");
    if (!Number.isInteger(expectedGroups) || expectedGroups < 1 || !Number.isInteger(expectedItems) || expectedItems < 1) {
      throw new Error("A quantidade de grupos ou itens é inválida.");
    }
    const before = await this.countFunctionsById(countId);
    if (before.count.closed) throw new Error("A contagem está fechada; a importação foi bloqueada.");
    const itemsBefore = before.functions.reduce((sum, item) => sum + ((item._items as unknown[] | undefined)?.length ?? 0), 0);
    const modalUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "35", mode: -1, goto: -1,
      filter: `APF_CONTAGEM.CTG_COD=${countId}@long`, scrolling: "yes",
    });
    const modal = await this.http.get(modalUrl, { Referer: buildCountOpenUrl(this.baseUrl, countId) });
    const modalBody = modal.text();
    if (modal.status < 200 || modal.status >= 300 || isLoginDocument(modalBody) || deniedDocument(modalBody)) {
      throw new Error(`O formulário de importação rápida não pôde ser aberto pela conta autenticada (${modal.status}).`);
    }
    if (!/Função\s*-\s*excel/i.test(modalBody) || !/698064244/.test(modalBody)) {
      throw new Error("O formulário 35 não publicou o contrato esperado de importação rápida. Nenhum dado foi enviado.");
    }
    const formFields: Record<string, string> = {
      F_5_469: tableHtml,
      F_19_470: "",
      F_20_498: "",
      F_21_497: "",
      F_22_471: "",
      F_23_499: "Copie a tabela e cole numa planilha de contagem. (Obs: se o formato da planilha for xlsx não cole em célula mesclada)",
      F_24_698064244: countId,
      F_25_473: "",
    };
    const ruleUrl = buildInternalUrl(this.baseUrl, "/executeRule.do", {});
    const response = await this.http.post(
      ruleUrl,
      buildConfiguredRuleRequestBody({
        formId: "35", ruleName: "apf - criar funções com tabela", pType: "2", parentRID: "-1",
        parameters: { P_0: tableWebrun, ...formFields },
      }),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: modalUrl },
    );
    const body = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)) {
      throw new Error(`A importação rápida respondeu HTTP ${response.status} ou perdeu a sessão.`);
    }
    const error = extractWebrunServerError(body);
    if (error) throw new Error(`O AgilePoint recusou a importação rápida: ${error}`);
    const recalculated = await this.http.post(
      ruleUrl,
      buildConfiguredRuleRequestBody({
        formId: "35", ruleName: "APF - recalcular contagem", pType: "2", parentRID: "-1",
        parameters: { P_0: countId, ...formFields },
      }),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: modalUrl },
    );
    const recalcBody = recalculated.text();
    if (recalculated.status < 200 || recalculated.status >= 300 || isLoginDocument(recalcBody) || deniedDocument(recalcBody)) {
      throw new Error(`O recálculo após a importação respondeu HTTP ${recalculated.status} ou perdeu a sessão.`);
    }
    const recalcError = extractWebrunServerError(recalcBody);
    if (recalcError) throw new Error(`O AgilePoint recusou o recálculo da contagem: ${recalcError}`);
    const after = await this.countFunctionsById(countId);
    const itemsAfter = after.functions.reduce((sum, item) => sum + ((item._items as unknown[] | undefined)?.length ?? 0), 0);
    if (after.functions.length - before.functions.length !== expectedGroups || itemsAfter - itemsBefore !== expectedItems) {
      throw new Error(`O AgilePoint não confirmou toda a importação: grupos ${before.functions.length}→${after.functions.length} (esperados +${expectedGroups}), itens ${itemsBefore}→${itemsAfter} (esperados +${expectedItems}). Não repita automaticamente; verifique a contagem.`);
    }
    return {
      contagem_id: countId,
      funcoes_antes: before.functions.length,
      funcoes_depois: after.functions.length,
      grupos_esperados: expectedGroups,
      itens_antes: itemsBefore,
      itens_depois: itemsAfter,
      itens_esperados: expectedItems,
      endpoint: "/executeRule.do",
    };
  }

  async exportCountReport(countId: string, kind: CountReportKind): Promise<{
    arquivo: string;
    formato: "pdf" | "xlsx";
    endpoint_regra: string;
    endpoint_download: string;
  }> {
    const detail = await this.openCountDocumentById(countId);
    const body = buildCountReportRequestBody(kind, countId, `RULE_MCP_${Date.now()}`);
    const response = await this.http.post(buildInternalUrl(this.baseUrl, "/executeRule.do", {}), body, {
      "Content-Type": "application/x-www-form-urlencoded", Referer: detail.url,
    });
    const responseBody = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`A regra do relatório respondeu HTTP ${response.status}.`);
    const reportPath = parseGeneratedReportPath(responseBody);
    if (!reportPath) throw new Error("O AgilePoint não retornou um caminho temporário de relatório válido.");
    const downloadUrl = buildGeneratedReportDownloadUrl(this.baseUrl, reportPath);
    const maxBytes = reportMaxBytes();
    const download = await this.http.getLimited(downloadUrl, maxBytes, { Referer: detail.url });
    if (download.status < 200 || download.status >= 300) throw new Error(`O download do relatório respondeu HTTP ${download.status}.`);
    const format = reportPath.toLowerCase().endsWith(".xlsx") ? "xlsx" : "pdf";
    const reportContentType = download.headers.get("content-type");
    if (/(?:text|html|xml)/i.test(reportContentType ?? "") && (isLoginDocument(download.text()) || deniedDocument(download.text()))) {
      throw new Error("O AgilePoint retornou login ou acesso negado no lugar do relatório.");
    }
    validateReportContent(format, reportContentType, download.body);
    const directory = exportDirectory();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `contagem-${countId}-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}.${format}`);
    await writeFile(destination, download.body, { flag: "wx", mode: 0o600 });
    return { arquivo: destination, formato: format, endpoint_regra: "/executeRule.do", endpoint_download: new URL(downloadUrl).pathname };
  }

  async exportSprintReport(applicationSprint: string): Promise<{
    arquivo: string;
    formato: "pdf";
    aplicacao_sprint: string;
    formulario_id: "500000382";
    endpoint_regra: "/executeRule.do";
  }> {
    const directory = exportDirectory();
    const requested = applicationSprint.trim();
    if (!requested || requested.length > 300) throw new Error("Informe o nome exato da aplicação/sprint do relatório.");
    const screen = (await this.listAccessibleScreensHttp()).find((item) => item.formulario_id === "500000382");
    if (!screen) throw new Error("O relatório de acompanhamento de sprint não está no menu desta conta.");
    const opened = await this.openAccessibleScreenDocumentHttp(screen.ref);
    const description = parseWebrunScreenDescription(opened.body, opened.url, "500000382");
    const field = description.campos.find((item) => item.ref === "component:1136079");
    if (!field || field.desabilitado || !field.opcoes?.length) throw new Error("O AgilePoint não publicou o filtro Aplicação deste relatório.");
    const matches = field.opcoes.filter((option) => normalize(option.texto) === normalize(requested) || option.valor === requested);
    if (matches.length !== 1) throw new Error("A aplicação/sprint do relatório deve corresponder a uma única opção exata da tela.");
    const response = await this.http.post(buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
      buildConfiguredRuleRequestBody({
        formId: "500000382", ruleName: "Relatório de Acompanhamento de sprint - Gerar Relatório",
        pType: "2", parentRID: "-1", parameters: { P_0: matches[0].valor },
      }), { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url });
    const body = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)) {
      throw new Error(`O AgilePoint recusou a geração do relatório de sprint (HTTP ${response.status}).`);
    }
    const reportPath = parseGeneratedReportPath(body);
    if (!reportPath || !reportPath.toLowerCase().endsWith(".pdf")) {
      throw new Error("O AgilePoint não retornou um caminho temporário de PDF válido para o relatório de sprint.");
    }
    const downloadUrl = buildGeneratedReportDownloadUrl(this.baseUrl, reportPath);
    const download = await this.http.getLimited(downloadUrl, reportMaxBytes(), { Referer: opened.url });
    if (download.status < 200 || download.status >= 300) throw new Error(`O download do relatório de sprint respondeu HTTP ${download.status}.`);
    validateReportContent("pdf", download.headers.get("content-type"), download.body);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `sprint-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`);
    await writeFile(destination, download.body, { flag: "wx", mode: 0o600 });
    return { arquivo: destination, formato: "pdf", aplicacao_sprint: matches[0].texto,
      formulario_id: "500000382", endpoint_regra: "/executeRule.do" };
  }

  async exportTrackingReport(year: number, month: number, application: string): Promise<{
    arquivo: string;
    formato: "pdf";
    ano: number;
    mes: number;
    aplicacao: string;
    formulario_id: "9148";
    endpoint_regra: "/executeRule.do";
  }> {
    const directory = exportDirectory();
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error("Ano ou mês do relatório é inválido.");
    }
    const requestedApplication = application.trim();
    if (!requestedApplication || requestedApplication.length > 300) throw new Error("Informe a aplicação exata do relatório.");
    const screen = (await this.listAccessibleScreensHttp()).find((item) => item.formulario_id === "9148");
    if (!screen) throw new Error("O relatório de acompanhamento não está no menu desta conta.");
    const opened = await this.openAccessibleScreenDocumentHttp(screen.ref);
    const description = parseWebrunScreenDescription(opened.body, opened.url, "9148");
    const yearField = description.campos.find((item) => item.ref === "component:1135988");
    const monthField = description.campos.find((item) => item.ref === "component:1135989");
    const applicationField = description.campos.find((item) => item.ref === "component:1135990");
    if (!yearField || yearField.desabilitado || !monthField || monthField.desabilitado
      || !applicationField || applicationField.desabilitado) {
      throw new Error("O AgilePoint não publicou os três filtros necessários ao relatório.");
    }
    const lookup = await this.http.get(buildGenericLookupSearchUrl(this.baseUrl, "9148", "1135988", String(year)), { Referer: opened.url });
    const lookupBody = lookup.text();
    if (lookup.status < 200 || lookup.status >= 300 || isLoginDocument(lookupBody)) {
      throw new Error(`O lookup do ano de competência respondeu HTTP ${lookup.status}.`);
    }
    const years = parseLookupXml(lookupBody).filter((option) => option.label === String(year));
    const months = monthField.opcoes?.filter((option) => option.valor === String(month)) ?? [];
    const applications = applicationField.opcoes?.filter((option) => normalize(option.texto) === normalize(requestedApplication)
      || option.valor === requestedApplication) ?? [];
    if (years.length !== 1 || months.length !== 1 || applications.length !== 1) {
      throw new Error("Ano, mês e aplicação precisam corresponder cada um a uma única opção publicada pela tela.");
    }
    const response = await this.http.post(buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
      buildConfiguredRuleRequestBody({
        formId: "9148", ruleName: "Relatório de Acompanhamento - Gerar Relatório", pType: "2", parentRID: "-1",
        parameters: { P_0: years[0].id, P_1: months[0].valor, P_2: applications[0].valor },
      }), { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url });
    const body = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)) {
      throw new Error(`O AgilePoint recusou a geração do relatório de acompanhamento (HTTP ${response.status}).`);
    }
    const reportPath = parseGeneratedReportPath(body);
    if (!reportPath || !reportPath.toLowerCase().endsWith(".pdf")) {
      throw new Error("O AgilePoint não retornou um caminho temporário de PDF válido para o relatório de acompanhamento.");
    }
    const downloadUrl = buildGeneratedReportDownloadUrl(this.baseUrl, reportPath);
    const download = await this.http.getLimited(downloadUrl, reportMaxBytes(), { Referer: opened.url });
    if (download.status < 200 || download.status >= 300) throw new Error(`O download do relatório respondeu HTTP ${download.status}.`);
    validateReportContent("pdf", download.headers.get("content-type"), download.body);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `acompanhamento-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`);
    await writeFile(destination, download.body, { flag: "wx", mode: 0o600 });
    return { arquivo: destination, formato: "pdf", ano: year, mes: month,
      aplicacao: applications[0].texto, formulario_id: "9148", endpoint_regra: "/executeRule.do" };
  }

  async exportAwardsReport(startDate: string, endDate: string): Promise<{
    arquivo: string;
    formato: "pdf";
    periodo: { inicio: string; fim: string };
    formulario_id: "9146";
    endpoint_regra: "/executeRule.do";
  }> {
    const directory = exportDirectory();
    const parseDate = (value: string): number => {
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
      if (!match) throw new Error("As datas devem estar no formato DD/MM/AAAA.");
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const instant = Date.UTC(year, month - 1, day);
      const parsed = new Date(instant);
      if (year < 2000 || year > 2200 || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new Error("A data do relatório de premiação é inválida.");
      }
      return instant;
    };
    if (parseDate(startDate) > parseDate(endDate)) throw new Error("A data inicial não pode ser posterior à final.");
    const screen = (await this.listAccessibleScreensHttp()).find((item) => item.formulario_id === "9146");
    if (!screen) throw new Error("O relatório de premiação não está no menu desta conta.");
    const opened = await this.openAccessibleScreenDocumentHttp(screen.ref);
    const description = parseWebrunScreenDescription(opened.body, opened.url, "9146");
    for (const componentId of ["1135973", "1135974"]) {
      const field = description.campos.find((item) => item.ref === `component:${componentId}`);
      if (!field || field.desabilitado) throw new Error("O AgilePoint não publicou os filtros de data do relatório de premiação.");
    }
    const response = await this.http.post(buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
      buildConfiguredRuleRequestBody({ formId: "9146", ruleName: "Relatório de Premiação - Gerar Relatório",
        pType: "2", parentRID: "-1", parameters: { P_0: startDate, P_1: endDate } }),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url });
    const body = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)) {
      throw new Error(`O AgilePoint recusou a geração do relatório de premiação (HTTP ${response.status}).`);
    }
    const reportPath = parseGeneratedReportPath(body);
    if (!reportPath || !reportPath.toLowerCase().endsWith(".pdf")) {
      throw new Error("O AgilePoint não retornou um caminho temporário de PDF válido para o relatório de premiação.");
    }
    const downloadUrl = buildGeneratedReportDownloadUrl(this.baseUrl, reportPath);
    const download = await this.http.getLimited(downloadUrl, reportMaxBytes(), { Referer: opened.url });
    if (download.status < 200 || download.status >= 300) throw new Error(`O download do relatório respondeu HTTP ${download.status}.`);
    validateReportContent("pdf", download.headers.get("content-type"), download.body);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, `premiacao-${Date.now()}-${randomUUID().slice(0, 8)}.pdf`);
    await writeFile(destination, download.body, { flag: "wx", mode: 0o600 });
    return { arquivo: destination, formato: "pdf", periodo: { inicio: startDate, fim: endDate },
      formulario_id: "9146", endpoint_regra: "/executeRule.do" };
  }

  private async resolveFormRecordsHttp(referer: string, formBody: string, count: number): Promise<FormRecordIdentity[]> {
    if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error("A quantidade de contagens deve estar entre 0 e 100.");
    if (count === 0) return [];
    const $ = load(formBody);
    const csrfToken = $('input[name="WEBRUN-CSRFTOKEN"]').attr("value")?.trim();
    if (!csrfToken) throw new Error("O token da sessão Webrun não foi encontrado no formulário de contagem.");
    const identities: FormRecordIdentity[] = [];
    for (let position = 1; position <= count; position += 1) {
      const parameters = new URLSearchParams({
        sys: "APF", action: "form", param: "goto", formID: "26", align: "-1", mode: "",
        goto: String(position), filter: "", forceGetResponse: "true", "WEBRUN-CSRFTOKEN": csrfToken,
      });
      const response = await this.http.post(buildInternalUrl(this.baseUrl, "/form.do", {}), parameters.toString(), {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer,
      });
      const body = response.text();
      if (response.status < 200 || response.status >= 300) throw new Error(`A resolução da contagem ${position} respondeu HTTP ${response.status}.`);
      if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao resolver uma contagem.");
      const identity = parseFormRecordIdentity(body);
      if (!identity) throw new Error(`O AgilePoint não retornou o ID estável da contagem na posição ${position}.`);
      identities.push(identity);
    }
    return identities;
  }

  private async openCountDocumentById(countId: string): Promise<{ url: string; body: string }> {
    if (!/^\d+$/.test(countId)) throw new Error("O ID da contagem deve ser numérico.");
    const url = buildCountOpenUrl(this.baseUrl, countId);
    const response = await this.http.get(url);
    const body = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`A abertura da contagem respondeu HTTP ${response.status}.`);
    if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao abrir a contagem.");
    const identity = parseFormRecordIdentity(body);
    if (!identity || identity.recordId !== countId) {
      throw new Error("O AgilePoint não abriu a contagem solicitada pelo filtro de ID.");
    }
    return { url, body };
  }

  private async fetchDependentGridEndpointHttp(
    referer: string,
    functionPosition: number,
    kind: "itens" | "contribuicoes",
    componentId: "1026482" | "1026483",
  ): Promise<Array<Record<string, unknown>>> {
    const response = await this.http.get(buildFunctionDependentGridUrl(this.baseUrl, kind, functionPosition), { Referer: referer });
    const body = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`A dependência ${kind} respondeu HTTP ${response.status}.`);
    if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao consultar uma grade dependente.");
    const rows = parseWebrunAssignment<Array<Record<string, unknown>>>(body, `data_${componentId}`) ?? [];
    const keys = parseWebrunAssignment<unknown[][]>(body, `d.c_${componentId}.keys`) ?? [];
    return rows.map((row, index) => ({ ...row, _primary_keys: keys[index] ?? [] }));
  }

  private async resolveGridRowIdsHttp(
    referer: string,
    kind: GridContractKind,
    rows: Array<Record<string, unknown>>,
    relationComponentId: string,
    foreignComponents: Record<string, { componentId: string; type: "hidden" | "lookup" }> = {},
  ): Promise<Array<Record<string, unknown>>> {
    const resolved: Array<Record<string, unknown>> = [];
    for (let index = 0; index < rows.length; index += 1) {
      const existingKeys = Array.isArray(rows[index]._primary_keys) ? rows[index]._primary_keys as unknown[] : [];
      let recordId = existingKeys.map(String).find((value) => /^\d+$/.test(value)) ?? null;
      const foreignIds: Record<string, string | null> = {};
      if (!recordId || Object.keys(foreignComponents).length > 0) {
        const edit = await this.http.get(buildGridRowEditUrl(this.baseUrl, kind, index + 1), { Referer: referer });
        const editBody = edit.text();
        try {
          if (edit.status < 200 || edit.status >= 300) throw new Error(`A identificação da linha ${index + 1} respondeu HTTP ${edit.status}.`);
          if (isLoginDocument(editBody)) throw new Error("A sessão HTTP expirou ao identificar uma linha da grade.");
          recordId = parseWebrunHiddenValue(editBody, relationComponentId) ?? recordId;
          if (!recordId || !/^\d+$/.test(recordId)) throw new Error(`O AgilePoint não retornou o ID estável da linha ${index + 1}.`);
          for (const [name, component] of Object.entries(foreignComponents)) {
            foreignIds[name] = component.type === "hidden"
              ? parseWebrunHiddenValue(editBody, component.componentId)
              : parseWebrunLookupValue(editBody, component.componentId);
          }
        } finally {
          await this.http.get(buildGridCancelUrl(this.baseUrl, kind, "edit"), { Referer: referer }).catch(() => undefined);
        }
      }
      resolved.push({ ...rows[index], _record_id: recordId, _primary_keys: [recordId], _foreign_ids: foreignIds });
    }
    return resolved;
  }

  private async fetchGridEndpointHttp(formId: string, componentId: string, referer: string, seedBody = ""): Promise<{
    rows: Array<Record<string, unknown>>;
    keys: unknown[][];
    body: string;
  }> {
    const seedRows = parseWebrunAssignment<Array<Record<string, unknown>>>(seedBody, `data_${componentId}`) ?? [];
    const totalRows = parseGridTotalRows(seedBody, componentId) ?? seedRows.length;
    const response = await this.http.get(buildInternalUrl(this.baseUrl, "/navigate.do", {
      sys: "APF", formID: formId, componentID: componentId, action: "navigate", param: "first", inner: true,
      gt: totalRows,
    }), { Referer: referer });
    const body = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`O endpoint da grade ${componentId} respondeu HTTP ${response.status}.`);
    if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao consultar a grade.");
    return {
      rows: parseWebrunAssignment<Array<Record<string, unknown>>>(body, `data_${componentId}`) ?? seedRows,
      keys: parseWebrunAssignment<unknown[][]>(body, `d.c_${componentId}.keys`) ?? [],
      body,
    };
  }

  private async readGridPagesHttp(
    formId: string,
    componentId: string,
    referer: string,
    seedBody: string,
    rowLimit: number,
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    pages: number;
    totalRows: number | null;
    complete: boolean;
    truncated: boolean;
    firstPageBody: string;
  }> {
    const rows: Array<Record<string, unknown>> = [];
    const pageKeys = new Set<string>();
    const totalRows = parseGridTotalRows(seedBody, componentId);
    let param: "first" | "next" = "first";
    let goto = 0;
    let complete = false;
    let truncated = false;
    let firstPageBody = "";
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.http.get(buildInternalUrl(this.baseUrl, "/navigate.do", {
        sys: "APF", formID: formId, componentID: componentId, action: "navigate", param, inner: true, gt: goto,
      }), { Referer: referer });
      const responseBody = response.text();
      if (page === 1) firstPageBody = responseBody;
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`A leitura da grade ${componentId} respondeu HTTP ${response.status}.`);
      }
      if (isLoginDocument(responseBody)) throw new Error("A sessão HTTP expirou durante a leitura da grade.");
      const pageRows = parseWebrunAssignment<Array<Record<string, unknown>>>(responseBody, `data_${componentId}`) ?? [];
      const interval = parseGridPageInterval(responseBody, componentId);
      const lastPage = parseGridIsLastPage(responseBody, componentId);
      const pageKey = recordsHash({ interval, rows: pageRows });
      if (!pageRows.length) {
        complete = true;
        break;
      }
      if (pageKeys.has(pageKey)) {
        complete = totalRows === null || rows.length >= totalRows;
        if (!complete) throw new Error(`A grade ${componentId} repetiu uma página antes de atingir as ${totalRows} linhas informadas pelo servidor.`);
        break;
      }
      pageKeys.add(pageKey);
      const remaining = rowLimit - rows.length;
      rows.push(...pageRows.slice(0, Math.max(remaining, 0)));
      if (lastPage === true || (totalRows !== null && rows.length >= totalRows)) {
        truncated = pageRows.length > remaining;
        complete = !truncated;
        break;
      }
      if (rows.length >= rowLimit) {
        truncated = true;
        break;
      }
      goto = interval?.end ?? (goto + pageRows.length);
      param = "next";
    }
    if (!complete && !truncated) {
      throw new Error(`A grade ${componentId} excedeu o limite de 100 páginas; nenhum resultado parcial foi retornado.`);
    }
    return {
      rows,
      pages: pageKeys.size,
      totalRows: totalRows ?? (complete ? rows.length : null),
      complete,
      truncated,
      firstPageBody,
    };
  }

  async close(): Promise<void> {
    await this.networkDiscovery.close();
    this.http.invalidate();
    this.screenCatalog.clear();
  }

  async validateScreenOperationsHttp(input: UiOperationInput): Promise<{
    alvos: string[];
    tela: ScreenDescription;
    validacoes: Array<{ operacao: number; alvo_ref: string; resultado: "valido" }>;
    contratos_acoes: { destructive: boolean; fingerprints: Record<string, string>; uploadDigests: Record<string, string>; resolvedInputDigests: Record<string, string>; resolvedInputs: Record<string, Record<string, string>> };
  }> {
    const opened = await this.openAccessibleScreenDocumentHttp(input.tela, input.registro_id);
    assertExpectedFunctionalityTitle(opened.body, opened.target.formulario_id, input.titulo_esperado);
    const parsedDescription = parseWebrunScreenDescription(opened.body, opened.url, opened.target.formulario_id);
    if (parsedDescription.formulario_id !== opened.target.formulario_id) {
      throw new Error("O AgilePoint retornou um formulário diferente do item autorizado selecionado.");
    }
    const description = await this.enrichScreenActionsHttp(parsedDescription);
    let activeDescription = description;
    let snapshotState = parseWebrunFormState(opened.body);
    let previewMode: "view" | "include" | "edit" = "view";
    const previewTransition = async (action: "include" | "edit" | "cancel") => {
      if (!snapshotState.csrfToken) throw new Error("O formulário não publicou o token CSRF necessário para simular a mudança de modo.");
      const requestBody = description.formulario_id === "26" && action === "include"
        ? buildCountIncludeRequestBody(snapshotState.csrfToken)
        : description.formulario_id === "26" && action === "cancel" && previewMode === "include"
          ? buildCountCancelRequestBody(snapshotState.csrfToken)
          : buildGenericFormActionRequestBody({ formId: description.formulario_id!, csrfToken: snapshotState.csrfToken, action });
      const response = await this.http.post(
        buildInternalUrl(this.baseUrl, "/form.do", {}),
        requestBody,
        { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url },
      );
      const body = response.text();
      if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body) || /\binteractionError\s*\(/i.test(body)) {
        throw new Error(`O AgilePoint recusou a simulação do modo ${action}.`);
      }
      const serverError = extractWebrunServerError(body);
      if (serverError) throw new Error(`O AgilePoint recusou a simulação: ${serverError}`);
      // Se a resposta de Incluir/Alterar for malformada, ainda precisamos cancelar o estado aberto.
      if (action !== "cancel") previewMode = action;
      const next = parseWebrunScreenDescription(body, opened.url, description.formulario_id!);
      if (next.formulario_id !== description.formulario_id) throw new Error("O formulário mudou durante a simulação.");
      // /form.do pode devolver somente comandos de atualização, sem construtores nem token.
      snapshotState = mergeWebrunFormState(snapshotState, body);
      activeDescription = await this.enrichScreenActionsHttp(
        next.campos.length || next.acoes.length ? next : parseWebrunScreenDescription(`${opened.body}\n${body}`, opened.url, description.formulario_id!),
      );
      previewMode = action === "cancel" ? "view" : action;
    };
    const customActions = await loadCustomActionRegistry();
    const uploadActions = await loadUploadActionRegistry();
    const downloadActions = await loadDownloadActionRegistry();
    const targets: string[] = [];
    const validations: Array<{ operacao: number; alvo_ref: string; resultado: "valido" }> = [];
    const fingerprints: Record<string, string> = {};
    const uploadDigests: Record<string, string> = {};
    const resolvedInputDigests: Record<string, string> = {};
    const resolvedInputs: Record<string, Record<string, string>> = {};
    let destructive = false;
    try {
    for (let index = 0; index < input.operacoes.length; index += 1) {
      const operation = input.operacoes[index];
      const target = operation.tipo === "clicar" || operation.tipo === "baixar"
        ? uniqueDescriptor(operation.alvo, activeDescription.acoes)
        : operation.tipo === "anexar"
          ? uniqueDescriptor(operation.alvo, [...activeDescription.campos, ...activeDescription.acoes])
          : uniqueDescriptor(operation.alvo, activeDescription.campos);
      if (!target) {
        throw new Error(`O alvo "${operation.alvo}" não foi encontrado de forma única nos metadados da tela ${description.nome}.`);
      }
      if (target.desabilitado) {
        throw new Error(`O campo ou ação "${operation.alvo}" está desabilitado.`);
      }
      if (operation.tipo === "clicar" && target.ref === "nav:delete") {
        if (!input.registro_id || description.registro_id_origem !== input.registro_id) {
          throw new Error("A exclusão exige registro_id explícito e correspondente ao registro aberto.");
        }
        if (description.formulario_id === "7156" && !input.titulo_esperado) {
          throw new Error("A exclusão de Funcionalidade exige titulo_esperado para conferência exata.");
        }
      }
      if (operation.tipo === "clicar" && (target.ref === "nav:include" || target.ref === "nav:edit")) {
        if (previewMode !== "view") throw new Error("Finalize ou cancele a edição atual antes de iniciar outra.");
        if (target.ref === "nav:edit" && !description.registro_id_origem) throw new Error("A alteração exige um ID estável do registro.");
        await assertUniversalCapability(currentRole(), description.formulario_id, [operation], [target.ref]);
        await previewTransition(target.ref === "nav:include" ? "include" : "edit");
      } else if (operation.tipo === "clicar" && (target.ref === "nav:save" || target.ref === "nav:cancel")) {
        if (previewMode === "view") throw new Error("Não há inclusão ou alteração pendente para finalizar.");
        const enteredValues = target.ref === "nav:save"
          ? new Map(snapshotState.fields.map((field) => [field.componentId, { value: field.value, displayValue: field.displayValue }]))
          : null;
        await previewTransition("cancel");
        // Após Gravar, as operações seguintes veem os valores enviados, sem efetuar a gravação na simulação.
        if (enteredValues) for (const field of snapshotState.fields) {
          const entered = enteredValues.get(field.componentId);
          if (entered) { field.value = entered.value; field.displayValue = entered.displayValue; }
        }
      }
      if (operation.tipo === "anexar") {
        const componentId = /^component:(\d+)$/.exec(target.ref)?.[1];
        const contract = componentId && description.formulario_id
          ? uploadActions.get(uploadActionKey(description.formulario_id, componentId))
          : undefined;
        if (!contract) throw new Error(`O alvo "${operation.alvo}" não possui contrato autorizado em APF_UPLOAD_ACTIONS_FILE.`);
        if (contract.requiresRecordId && !description.registro_id_origem) {
          throw new Error(`O upload "${operation.alvo}" exige um ID estável do registro.`);
        }
        const file = await validateUploadFile(operation.caminho, contract);
        uploadDigests[String(index)] = file.sha256;
        fingerprints[target.ref] = contract.fingerprint;
        resolvedInputs[String(index)] = configuredInputsValues(contract.parameters, snapshotState.fields, description.registro_id_origem);
        resolvedInputDigests[String(index)] = objectDigest(resolvedInputs[String(index)]);
      }
      if (operation.tipo === "baixar") {
        const componentId = /^component:(\d+)$/.exec(target.ref)?.[1];
        const contract = componentId && description.formulario_id
          ? downloadActions.get(downloadActionKey(description.formulario_id, componentId))
          : undefined;
        if (!contract) throw new Error(`O download "${operation.alvo}" não possui contrato autorizado em APF_DOWNLOAD_ACTIONS_FILE.`);
        if (contract.requiresRecordId && !description.registro_id_origem) {
          throw new Error(`O download "${operation.alvo}" exige um ID estável do registro.`);
        }
        fingerprints[target.ref] = contract.fingerprint;
        resolvedInputs[String(index)] = downloadInputsValues(contract, snapshotState.fields, description.registro_id_origem);
        resolvedInputDigests[String(index)] = objectDigest(resolvedInputs[String(index)]);
      }
      if (operation.tipo === "marcar" && target.tipo !== "checkbox" && target.tipo !== "radio") {
        throw new Error(`O alvo "${operation.alvo}" não é um campo de marcação.`);
      }
      if (operation.tipo === "selecionar" && target.tipo !== "select" && target.tipo !== "lookup" && target.tipo !== "radio") {
        throw new Error(`O alvo "${operation.alvo}" não é um campo de seleção.`);
      }
      const publishedOptions = (target as ScreenField).opcoes;
      if (operation.tipo === "selecionar" && publishedOptions?.length) {
        const requested = normalize(operation.valor);
        const optionExists = publishedOptions.some((option) => normalize(option.valor) === requested || normalize(option.texto) === requested);
        if (!optionExists) throw new Error(`A opção "${operation.valor}" não foi publicada para o campo "${operation.alvo}".`);
      }
      if (operation.tipo === "preencher" && (target.tipo === "password" || (target as ScreenField).sensivel === true)) {
        throw new Error(`O MCP universal não preenche campos sensíveis de autenticação: ${target.rotulo}.`);
      }
      if (operation.tipo === "preencher" && ["file", "checkbox", "radio", "select", "lookup"].includes(target.tipo)) {
        throw new Error(`O alvo "${operation.alvo}" não aceita preenchimento textual; use a operação apropriada para ${target.tipo}.`);
      }
      if (operation.tipo === "preencher" || operation.tipo === "marcar" || operation.tipo === "selecionar") {
        const componentId = /^component:(\d+)$/.exec(target.ref)?.[1];
        const stateField = componentId ? snapshotState.fields.find((field) => field.componentId === componentId) : undefined;
        if (!stateField) throw new Error(`O componente resolvido para "${operation.alvo}" não foi publicado no estado da simulação.`);
        if (operation.tipo === "preencher") {
          stateField.value = operation.valor;
        } else if (operation.tipo === "marcar") {
          stateField.value = operation.valor ? "true" : "false";
        } else if (/Lookup/i.test(stateField.className)) {
          const lookup = await this.http.get(
            buildGenericLookupSearchUrl(this.baseUrl, description.formulario_id!, componentId!, operation.valor),
            { Referer: opened.url },
          );
          const lookupBody = lookup.text();
          if (lookup.status < 200 || lookup.status >= 300 || isLoginDocument(lookupBody)) {
            throw new Error(`O lookup ${operation.alvo} não pôde ser validado durante a simulação.`);
          }
          const requested = normalize(operation.valor);
          const matches = parseLookupXml(lookupBody).filter((option) => normalize(option.label) === requested || option.id === operation.valor.trim());
          if (matches.length !== 1) throw new Error(`A opção "${operation.valor}" não foi resolvida de forma única no lookup ${operation.alvo}.`);
          stateField.value = matches[0].id;
          stateField.displayValue = matches[0].label;
        } else {
          const requested = normalize(operation.valor);
          const option = (target as ScreenField).opcoes?.find((item) => normalize(item.valor) === requested || normalize(item.texto) === requested);
          if (!option) throw new Error(`A opção "${operation.valor}" não foi publicada para ${operation.alvo}.`);
          stateField.value = option.valor;
          resolvedInputs[String(index)] = { selected_value: option.valor };
          resolvedInputDigests[String(index)] = objectDigest(resolvedInputs[String(index)]);
        }
      }
      if (operation.tipo === "clicar" && target.ref.startsWith("component:")) {
        const componentId = target.ref.slice("component:".length);
        const contract = description.formulario_id ? customActions.get(customActionKey(description.formulario_id, componentId)) : undefined;
        if (!contract) throw new Error(`A ação personalizada "${operation.alvo}" não possui contrato autorizado em APF_CUSTOM_ACTIONS_FILE.`);
        if (contract.requiresRecordId && !description.registro_id_origem) {
          throw new Error(`A ação personalizada "${operation.alvo}" exige um ID estável do registro.`);
        }
        fingerprints[target.ref] = contract.fingerprint;
        resolvedInputs[String(index)] = configuredInputsValues(contract.parameters, snapshotState.fields, description.registro_id_origem);
        resolvedInputDigests[String(index)] = objectDigest(resolvedInputs[String(index)]);
        destructive ||= contract.destructive;
      }
      targets.push(target.ref);
      validations.push({ operacao: index + 1, alvo_ref: target.ref, resultado: "valido" });
    }
    } finally {
      // Incluir/Alterar na simulação apenas abre o estado transitório; nunca o grava.
      if (previewMode !== "view") await previewTransition("cancel");
    }
    await assertUniversalCapability(currentRole(), description.formulario_id, input.operacoes, targets);
    return { alvos: targets, tela: description, validacoes: validations, contratos_acoes: { destructive, fingerprints, uploadDigests, resolvedInputDigests, resolvedInputs } };
  }

  async executeScreenOperationsHttp(simulation: UiSimulation): Promise<{
    tela: ScreenDescription;
    operacoes_executadas: number;
    alertas: string[];
    downloads: string[];
    transporte_dados: "endpoint_interno";
    endpoints: string[];
    verificacao: "resposta_servidor_sem_erro";
  }> {
    const status = writeConfigurationStatus();
    const requiresWrite = simulation.operacoes.some((operation) => operation.tipo !== "baixar");
    if (requiresWrite && !status.habilitada) throw new Error("A gravação está desabilitada. Defina APF_WRITE_ENABLED=true somente no ambiente autorizado.");
    const validated = await this.validateScreenOperationsHttp(simulation);
    if (JSON.stringify(validated.alvos) !== JSON.stringify(simulation.alvos_validados)) {
      throw new Error("Os alvos resolvidos mudaram desde a simulação. Simule e aprove novamente.");
    }
    const customActions = await loadCustomActionRegistry();
    const uploadActions = await loadUploadActionRegistry();
    const downloadActions = await loadDownloadActionRegistry();
    const opened = await this.openAccessibleScreenDocumentHttp(simulation.tela, simulation.registro_id);
    assertExpectedFunctionalityTitle(opened.body, opened.target.formulario_id, simulation.titulo_esperado);
    const formId = opened.target.formulario_id;
    let source = opened.body;
    const openedDescription = parseWebrunScreenDescription(source, opened.url, formId);
    if (simulation.formulario_alvo_id !== formId) {
      throw new Error("O formulário resolvido mudou desde a simulação. Simule e aprove novamente.");
    }
    if (simulation.registro_alvo) {
      if (simulation.registro_alvo.formulario_id !== formId || simulation.registro_alvo.registro_id_origem !== openedDescription.registro_id_origem) {
        throw new Error("O registro aberto mudou desde a simulação. Execute simular_operacao_tela novamente antes de gravar.");
      }
    }
    let formState = parseWebrunFormState(source);
    if (!formState.csrfToken) throw new Error(`O formulário ${formId} não publicou um token CSRF; a execução por endpoint foi bloqueada.`);
    let mode: "view" | "include" | "edit" = "view";
    let fields = Object.fromEntries(formState.fields.flatMap((field) => [
      [field.inputName, field.value],
      ...(field.displayInputName ? [[field.displayInputName, field.displayValue ?? ""] as [string, string]] : []),
    ]));
    const downloads: string[] = [];

    const postAction = async (action: "include" | "edit" | "delete" | "cancel" | "postcancel", submittedFields?: Record<string, string>) => {
      const requestBody = formId === "26" && action === "include"
        ? buildCountIncludeRequestBody(formState.csrfToken)
        : formId === "26" && action === "cancel" && mode === "include"
          ? buildCountCancelRequestBody(formState.csrfToken)
          : formId === "26" && action === "postcancel" && mode === "include" && submittedFields
            ? buildCountCreateRequestBody({
              csrfToken: formState.csrfToken,
              application: { id: submittedFields.WFRInput416 ?? "", label: submittedFields.WFRInput416Show ?? "" },
              version: submittedFields.WFRInput409 ?? "",
              countType: { id: submittedFields.WFRInput415 ?? "", label: submittedFields.WFRInput415Show ?? "" },
              month: Number(submittedFields.WFRInput1135977),
              year: { id: submittedFields.WFRInput1135978 ?? "", label: submittedFields.WFRInput1135978Show ?? "" },
              equivalenceFactor: { id: submittedFields.WFRInput1135984 ?? "", label: submittedFields.WFRInput1135984Show ?? "" },
              purpose: submittedFields.WFRInput504,
              scope: submittedFields.WFRInput411,
              defaults: {
                createdAt: submittedFields.WFRInput1897093694 ?? "",
                pointValue: submittedFields.WFRInput1645652289 ?? "",
                pointCost: submittedFields.WFRInput627836279 ?? "",
                conventionsJson: submittedFields.WFRInput1895236190 ?? "",
                userId: submittedFields.WFRInput1323048149 ?? "",
              },
            })
            : buildGenericFormActionRequestBody({
              formId, csrfToken: formState.csrfToken, action, fields: submittedFields,
            });
      const response = await this.http.post(
        buildInternalUrl(this.baseUrl, "/form.do", {}),
        requestBody,
        { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url },
      );
      const responseBody = response.text();
      if (response.status < 200 || response.status >= 300) throw new Error(`A ação ${action} do formulário ${formId} respondeu HTTP ${response.status}.`);
      if (isLoginDocument(responseBody)) throw new Error("A sessão HTTP expirou durante a execução da operação universal.");
      if (deniedDocument(responseBody) || /\binteractionError\s*\(/i.test(responseBody)) throw new Error("O AgilePoint recusou a operação para a conta autenticada.");
      const serverError = extractWebrunServerError(responseBody);
      if (serverError) throw new Error(`O AgilePoint recusou a operação: ${serverError}`);
      const responseDescription = parseWebrunScreenDescription(responseBody, opened.url, formId);
      source = responseDescription.campos.length || responseDescription.acoes.length
        ? responseBody : `${opened.body}\n${responseBody}`;
      formState = mergeWebrunFormState(formState, responseBody);
      return responseBody;
    };

    try {
      for (let index = 0; index < simulation.operacoes.length; index += 1) {
        const operation = simulation.operacoes[index];
        const targetRef = validated.alvos[index];
      if (operation.tipo === "clicar") {
        if (targetRef === "nav:include" || targetRef === "nav:edit") {
          if (mode !== "view") throw new Error("O formulário já está em modo de edição; cancele ou grave antes de iniciar outra operação.");
          if (targetRef === "nav:edit" && !simulation.registro_alvo) {
            throw new Error("A alteração universal exige que a simulação esteja vinculada ao ID estável do registro.");
          }
          const action = targetRef === "nav:include" ? "include" : "edit";
          await postAction(action);
          mode = action;
          if (!formState.csrfToken) throw new Error(`O modo ${action} não retornou o token CSRF esperado.`);
          fields = Object.fromEntries(formState.fields.flatMap((field) => [
            [field.inputName, field.value],
            ...(field.displayInputName ? [[field.displayInputName, field.displayValue ?? ""] as [string, string]] : []),
          ]));
          continue;
        }
        if (targetRef === "nav:save") {
          if (mode === "view") throw new Error("Não há inclusão ou alteração pendente para gravar.");
          const savingMode = mode;
          const savedBody = await postAction("postcancel", fields);
          const savedIdentity = parseFormRecordIdentity(savedBody);
          if (!savedIdentity || (savingMode === "include" && savedIdentity.recordId === openedDescription.registro_id_origem)
            || (savingMode === "edit" && savedIdentity.recordId !== simulation.registro_alvo?.registro_id_origem)) {
            throw new Error("O AgilePoint respondeu à gravação sem confirmar o ID estável esperado. Verifique o registro antes de repetir.");
          }
          if (formId === "26") {
            const verified = await this.openCountDocumentById(savedIdentity.recordId);
            const verifiedVersion = parseWebrunFormState(verified.body).fields.find((field) => field.componentId === "409")?.value
              ?? parseWebrunSetValue(verified.body, "409") ?? "";
            if (savingMode === "include" && normalize(verifiedVersion) !== normalize(fields.WFRInput409 ?? "")) {
              throw new Error("A contagem foi criada, mas a versão gravada não corresponde à solicitada. Verifique antes de repetir.");
            }
          }
          mode = "view";
          continue;
        }
        if (targetRef === "nav:cancel") {
          if (mode === "view") throw new Error("Não há edição pendente para cancelar.");
          await postAction("cancel");
          mode = "view";
          continue;
        }
        if (targetRef === "nav:refresh") {
          const refreshed = await this.openAccessibleScreenDocumentHttp(simulation.tela);
          source = refreshed.body;
          formState = parseWebrunFormState(source);
          continue;
        }
        if (targetRef === "nav:delete") {
          const boundRecord = simulation.registro_alvo;
          if (!boundRecord || boundRecord.formulario_id !== formId || !boundRecord.registro_id_origem) {
            throw new Error("A exclusão universal exige que a simulação esteja vinculada ao ID estável do registro.");
          }
          if (formId === "7156" && simulation.titulo_esperado) {
            const beforeIds = await this.searchFunctionalityIdsByTitleHttp(simulation.titulo_esperado);
            if (beforeIds.length !== 1 || beforeIds[0] !== boundRecord.registro_id_origem) {
              throw new Error("A pesquisa da funcionalidade não confirmou exclusivamente o registro alvo; exclusão cancelada.");
            }
          }
          await postAction("delete");
          const verificationUrl = formId === "26" ? buildCountOpenUrl(this.baseUrl, boundRecord.registro_id_origem)
            : formId === "47" ? buildApplicationOpenUrl(this.baseUrl, boundRecord.registro_id_origem)
              : buildInternalUrl(this.baseUrl, "/openform.do", {
                sys: "APF", action: "openform", formID: formId, mode: -1, goto: boundRecord.registro_id_origem,
                filter: "", scrolling: false, firstLoad: true,
              });
          const verificationResponse = await this.http.get(verificationUrl, { Referer: opened.url });
          const verificationBody = verificationResponse.text();
          if (verificationResponse.status < 200 || verificationResponse.status >= 300 || isLoginDocument(verificationBody)) {
            throw new Error("A exclusão foi enviada, mas a releitura do registro não pôde ser concluída; não repita automaticamente.");
          }
          if (parseFormRecordIdentity(verificationBody)?.recordId === boundRecord.registro_id_origem) {
            throw new Error("O AgilePoint não confirmou a exclusão: o mesmo ID de registro continua carregado.");
          }
          if (formId === "7156" && simulation.titulo_esperado) {
            const remainingIds = await this.searchFunctionalityIdsByTitleHttp(simulation.titulo_esperado);
            if (remainingIds.includes(boundRecord.registro_id_origem)) {
              throw new Error("O AgilePoint ainda lista a funcionalidade excluída; não repita automaticamente.");
            }
          }
          source = verificationBody;
          formState = parseWebrunFormState(source);
          continue;
        }
        const componentId = /^component:(\d+)$/.exec(targetRef)?.[1];
        const contract = componentId ? customActions.get(customActionKey(formId, componentId)) : undefined;
        if (!contract) throw new Error(`A ação ${operation.alvo} não possui contrato autorizado em APF_CUSTOM_ACTIONS_FILE.`);
        if (mode !== "view") throw new Error("Ações personalizadas só podem ser executadas fora do modo de inclusão/alteração.");
        if (simulation.contratos_acoes?.[targetRef] !== contract.fingerprint) {
          throw new Error(`O contrato da ação ${operation.alvo} mudou desde a simulação. Simule novamente.`);
        }
        if (contract.destructive && !simulation.destrutiva) {
          throw new Error(`A ação ${operation.alvo} passou a ser destrutiva. Simule novamente e confirme a exclusão.`);
        }
        if (contract.requiresRecordId && simulation.registro_alvo?.registro_id_origem !== openedDescription.registro_id_origem) {
          throw new Error(`A ação ${operation.alvo} exige o mesmo ID estável validado na simulação.`);
        }
        const ruleParameters: Record<string, string> = {};
        for (const parameter of contract.parameters) {
          if (parameter.source === "literal") ruleParameters[parameter.name] = parameter.value;
          else if (parameter.source === "record_id") ruleParameters[parameter.name] = simulation.registro_alvo?.registro_id_origem ?? "";
          else {
            const component = formState.fields.find((field) => field.componentId === parameter.componentId);
            if (!component) throw new Error(`O componente ${parameter.componentId} exigido por ${operation.alvo} não foi publicado.`);
            ruleParameters[parameter.name] = parameter.display ? component.displayValue ?? "" : component.value;
          }
        }
        assertResolvedInputsUnchanged(simulation, index, ruleParameters);
        const ruleResponse = await this.http.post(
          buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
          buildConfiguredRuleRequestBody({
            formId,
            ruleName: contract.ruleName,
            pType: contract.pType,
            parentRID: contract.parentRID,
            parameters: ruleParameters,
          }),
          { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url },
        );
        const ruleBody = ruleResponse.text();
        if (ruleResponse.status < 200 || ruleResponse.status >= 300) throw new Error(`A regra ${contract.ruleName} respondeu HTTP ${ruleResponse.status}.`);
        if (isLoginDocument(ruleBody)) throw new Error("A sessão HTTP expirou durante a ação personalizada.");
        const ruleError = extractWebrunServerError(ruleBody);
        if (ruleError) throw new Error(`O AgilePoint recusou a ação personalizada: ${ruleError}`);
        if (contract.refreshAfter) {
          const refreshed = await this.openAccessibleScreenDocumentHttp(simulation.tela);
          source = refreshed.body;
          formState = parseWebrunFormState(source);
          fields = Object.fromEntries(formState.fields.flatMap((field) => [
            [field.inputName, field.value],
            ...(field.displayInputName ? [[field.displayInputName, field.displayValue ?? ""] as [string, string]] : []),
          ]));
        }
        continue;
      }
      if (operation.tipo === "baixar") {
        if (mode !== "view") throw new Error("Downloads configurados só podem ser executados fora do modo de inclusão/alteração.");
        const componentId = /^component:(\d+)$/.exec(targetRef)?.[1];
        const contract = componentId ? downloadActions.get(downloadActionKey(formId, componentId)) : undefined;
        if (!contract) throw new Error(`O download ${operation.alvo} não possui contrato autorizado em APF_DOWNLOAD_ACTIONS_FILE.`);
        if (simulation.contratos_acoes?.[targetRef] !== contract.fingerprint) {
          throw new Error(`O contrato do download ${operation.alvo} mudou desde a simulação. Simule novamente.`);
        }
        if (contract.requiresRecordId && simulation.registro_alvo?.registro_id_origem !== openedDescription.registro_id_origem) {
          throw new Error(`O download ${operation.alvo} exige o mesmo ID estável validado na simulação.`);
        }
        let serverPath: string;
        if (contract.path.source === "literal") {
          serverPath = contract.path.value;
          assertResolvedInputsUnchanged(simulation, index, { path: serverPath });
        } else if (contract.path.source === "component_value") {
          const pathSource = contract.path;
          const component = formState.fields.find((field) => field.componentId === pathSource.componentId);
          if (!component) throw new Error(`O componente ${pathSource.componentId} que contém o caminho do download não foi publicado.`);
          serverPath = pathSource.display ? component.displayValue ?? "" : component.value;
          assertResolvedInputsUnchanged(simulation, index, { path: serverPath });
        } else {
          const ruleParameters: Record<string, string> = {};
          for (const parameter of contract.path.parameters) {
            if (parameter.source === "literal") ruleParameters[parameter.name] = parameter.value;
            else if (parameter.source === "record_id") ruleParameters[parameter.name] = simulation.registro_alvo?.registro_id_origem ?? "";
            else {
              const component = formState.fields.find((field) => field.componentId === parameter.componentId);
              if (!component) throw new Error(`O componente ${parameter.componentId} exigido por ${operation.alvo} não foi publicado.`);
              ruleParameters[parameter.name] = parameter.display ? component.displayValue ?? "" : component.value;
            }
          }
          assertResolvedInputsUnchanged(simulation, index, ruleParameters);
          const ruleResponse = await this.http.post(
            buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
            buildConfiguredRuleRequestBody({
              formId,
              ruleName: contract.path.ruleName,
              pType: contract.path.pType,
              parentRID: contract.path.parentRID,
              parameters: ruleParameters,
            }),
            { "Content-Type": "application/x-www-form-urlencoded", Referer: opened.url },
          );
          const ruleBody = ruleResponse.text();
          if (ruleResponse.status < 200 || ruleResponse.status >= 300) throw new Error(`A regra ${contract.path.ruleName} respondeu HTTP ${ruleResponse.status}.`);
          if (isLoginDocument(ruleBody)) throw new Error("A sessão HTTP expirou durante a preparação do download.");
          const ruleError = extractWebrunServerError(ruleBody);
          if (ruleError) throw new Error(`O AgilePoint recusou a preparação do download: ${ruleError}`);
          serverPath = parseWebrunRuleReturnFirstString(ruleBody) ?? parseWebrunRuleReturn(ruleBody) ?? "";
        }
        serverPath = validateDownloadServerPath(serverPath, contract);
        const downloadUrl = buildGenericDownloadUrl(this.baseUrl, formId, serverPath);
        const response = await this.http.getLimited(downloadUrl, contract.maxBytes, { Referer: opened.url });
        if (response.status < 200 || response.status >= 300) throw new Error(`O download ${operation.alvo} respondeu HTTP ${response.status}.`);
        const contentType = response.headers?.get?.("content-type") ?? null;
        validateDownloadedContent(contentType, response.body.length, contract);
        if (isLoginDocument(response.text()) || deniedDocument(response.text())) throw new Error("O AgilePoint retornou login ou acesso negado no lugar do arquivo.");
        const directory = exportDirectory();
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const filename = safeDownloadFilename(response.headers?.get?.("content-disposition") ?? null, serverPath);
        const filenameExtension = path.extname(filename).toLocaleLowerCase("pt-BR");
        if (!contract.allowedExtensions.includes(filenameExtension)) {
          throw new Error(`O nome sugerido pelo servidor usa a extensão não autorizada ${filenameExtension || "[sem extensão]"}.`);
        }
        const destination = path.join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}-${filename}`);
        const relative = path.relative(directory, destination);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("O nome do arquivo de download é inválido.");
        await writeFile(destination, response.body, { flag: "wx", mode: 0o600 });
        downloads.push(destination);
        continue;
      }
      if (operation.tipo === "anexar") {
        if (mode !== "view") throw new Error("Uploads configurados só podem ser executados fora do modo de inclusão/alteração.");
        const componentId = /^component:(\d+)$/.exec(targetRef)?.[1];
        const contract = componentId ? uploadActions.get(uploadActionKey(formId, componentId)) : undefined;
        if (!contract) throw new Error(`O upload ${operation.alvo} não possui contrato autorizado em APF_UPLOAD_ACTIONS_FILE.`);
        if (simulation.contratos_acoes?.[targetRef] !== contract.fingerprint) {
          throw new Error(`O contrato do upload ${operation.alvo} mudou desde a simulação. Simule novamente.`);
        }
        if (contract.requiresRecordId && simulation.registro_alvo?.registro_id_origem !== openedDescription.registro_id_origem) {
          throw new Error(`O upload ${operation.alvo} exige o mesmo ID estável validado na simulação.`);
        }
        const ruleParameters: Record<string, string> = {};
        for (const parameter of contract.parameters) {
          if (parameter.source === "literal") ruleParameters[parameter.name] = parameter.value;
          else if (parameter.source === "record_id") ruleParameters[parameter.name] = simulation.registro_alvo?.registro_id_origem ?? "";
          else {
            const component = formState.fields.find((field) => field.componentId === parameter.componentId);
            if (!component) throw new Error(`O componente ${parameter.componentId} exigido por ${operation.alvo} não foi publicado.`);
            ruleParameters[parameter.name] = parameter.display ? component.displayValue ?? "" : component.value;
          }
        }
        assertResolvedInputsUnchanged(simulation, index, ruleParameters);
        const uploadUrl = buildRuleUploadUrl(this.baseUrl, {
          formId,
          ruleName: contract.ruleName,
          validationRule: contract.validationRule,
          multiple: contract.multiple,
          parameters: ruleParameters,
        });
        const uploadPage = await this.http.get(uploadUrl, { Referer: opened.url });
        const uploadPageBody = uploadPage.text();
        if (uploadPage.status < 200 || uploadPage.status >= 300 || isLoginDocument(uploadPageBody)) {
          throw new Error(`A abertura do upload ${operation.alvo} respondeu HTTP ${uploadPage.status}.`);
        }
        const uploadForm = parseWebrunUploadForm(uploadPageBody, uploadPage.url || uploadUrl);
        const file = await validateUploadFile(operation.caminho, contract);
        if (simulation.upload_digests?.[String(index)] !== file.sha256) {
          throw new Error(`O conteúdo do arquivo de upload ${operation.alvo} mudou desde a simulação. Simule e aprove novamente.`);
        }
        const uploadResponse = await this.http.postMultipart(
          uploadForm.actionUrl,
          uploadForm.hiddenFields,
          {
            fieldName: uploadForm.fileField,
            filename: file.filename,
            mimeType: file.mimeType,
            body: file.body,
          },
          { Referer: uploadUrl },
        );
        const uploadBody = uploadResponse.text();
        if (uploadResponse.status < 200 || uploadResponse.status >= 300) throw new Error(`O upload ${operation.alvo} respondeu HTTP ${uploadResponse.status}.`);
        if (isLoginDocument(uploadBody)) throw new Error("A sessão HTTP expirou durante o upload.");
        if (deniedDocument(uploadBody)) throw new Error("O AgilePoint recusou o upload para a conta autenticada.");
        const uploadError = extractWebrunServerError(uploadBody);
        if (uploadError) throw new Error(`O AgilePoint recusou o upload: ${uploadError}`);
        if (contract.refreshAfter) {
          const refreshed = await this.openAccessibleScreenDocumentHttp(simulation.tela);
          source = refreshed.body;
          formState = parseWebrunFormState(source);
          fields = Object.fromEntries(formState.fields.flatMap((field) => [
            [field.inputName, field.value],
            ...(field.displayInputName ? [[field.displayInputName, field.displayValue ?? ""] as [string, string]] : []),
          ]));
        }
        continue;
      }
      if (mode === "view") throw new Error("Inicie a sequência com Incluir ou Alterar antes de modificar campos.");
      const componentId = /^component:(\d+)$/.exec(targetRef)?.[1];
      if (!componentId) throw new Error(`O alvo ${operation.alvo} não possui componente Webrun estável.`);
      const stateField = formState.fields.find((field) => field.componentId === componentId);
      if (!stateField) throw new Error(`O componente ${componentId} não foi publicado no modo ${mode}.`);
      if (operation.tipo === "preencher") {
        fields[stateField.inputName] = operation.valor;
      } else if (operation.tipo === "marcar") {
        fields[stateField.inputName] = operation.valor ? "true" : "false";
      } else if (/Lookup/i.test(stateField.className)) {
        const lookup = await this.http.get(buildGenericLookupSearchUrl(this.baseUrl, formId, componentId, operation.valor), { Referer: opened.url });
        const lookupBody = lookup.text();
        if (lookup.status < 200 || lookup.status >= 300 || isLoginDocument(lookupBody)) {
          throw new Error(`O lookup ${operation.alvo} respondeu HTTP ${lookup.status}.`);
        }
        const requested = normalize(operation.valor);
        const matches = parseLookupXml(lookupBody).filter((option) => normalize(option.label) === requested || option.id === operation.valor.trim());
        if (matches.length !== 1) throw new Error(`A opção "${operation.valor}" não foi resolvida de forma única no lookup ${operation.alvo}.`);
        fields[stateField.inputName] = matches[0].id;
        if (stateField.displayInputName) fields[stateField.displayInputName] = matches[0].label;
      } else {
        const currentDescription = parseWebrunScreenDescription(source, opened.url, formId);
        const screenField = uniqueDescriptor(operation.alvo, currentDescription.campos);
        const requested = normalize(operation.valor);
        const option = screenField?.opcoes?.find((item) => normalize(item.valor) === requested || normalize(item.texto) === requested);
        if (!option) throw new Error(`A opção "${operation.valor}" não foi publicada para ${operation.alvo}.`);
        assertResolvedInputsUnchanged(simulation, index, { selected_value: option.valor });
        fields[stateField.inputName] = option.valor;
      }
      }
      if (mode !== "view") throw new Error("A sequência terminou com alterações não gravadas. Inclua a ação Gravar registro no final.");
    } catch (error) {
      if (mode !== "view") await postAction("cancel").catch(() => undefined);
      throw error;
    }
    const finalDescription = await this.enrichScreenActionsHttp(parseWebrunScreenDescription(source, opened.url, formId));
    return {
      tela: finalDescription,
      operacoes_executadas: simulation.operacoes.length,
      alertas: finalDescription.alertas,
      downloads,
      transporte_dados: "endpoint_interno",
      endpoints: ["/openform.do", "/executeRule.do", "/form.do", "/search.do", "/upload.jsp", "/download"],
      verificacao: "resposta_servidor_sem_erro",
    };
  }

  private async searchFunctionalityIdsByTitleHttp(title: string): Promise<string[]> {
    const queryUrl = buildInternalUrl(this.baseUrl, "/basic_query.jsp", { sys: "APF", formID: "7156" });
    const query = await this.http.get(queryUrl);
    if (query.status < 200 || query.status >= 300 || isLoginDocument(query.text())) {
      throw new Error("A pesquisa da funcionalidade não pôde ser aberta.");
    }
    const $ = load(query.text());
    const form = $('form[name="WFRQueryForm"]');
    if (form.length !== 1 || form.attr("action")?.replace(/^\.\//, "") !== "search.do") {
      throw new Error("O contrato da pesquisa de funcionalidades mudou.");
    }
    const parameters = new URLSearchParams();
    form.find("input[name], select[name], textarea[name]").each((_, element) => {
      const item = $(element);
      const name = item.attr("name")?.trim();
      if (!name || item.is(":disabled")) return;
      parameters.set(name, element.tagName.toLowerCase() === "select"
        ? item.find("option:selected").attr("value") ?? ""
        : item.attr("value") ?? "");
    });
    if (parameters.get("sys") !== "APF" || parameters.get("formID") !== "7156"
      || !parameters.has("q$2") || !parameters.get("field")?.includes("FUN_TITULO")) {
      throw new Error("A pesquisa não publicou o campo de título esperado.");
    }
    parameters.set("q$2", title);
    const searched = await this.http.get(buildInternalUrl(this.baseUrl, "/search.do", Object.fromEntries(parameters)), { Referer: queryUrl });
    const body = searched.text();
    if (searched.status < 200 || searched.status >= 300 || isLoginDocument(body) || !/n\.clearGrid\(\s*\)/.test(body)) {
      throw new Error("A pesquisa de funcionalidades não retornou uma grade válida.");
    }
    const pagination = /n\.setPaginationState\(\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/i.exec(body);
    if (!pagination || pagination[3] === "true" || pagination[4] === "true") {
      throw new Error("A pesquisa de funcionalidades não confirmou uma página completa.");
    }
    const ids: string[] = [];
    for (const match of body.matchAll(/n\.addGridRow\(\s*(\[[\s\S]*?\])\s*\)\s*;/g)) {
      const row: unknown = JSON5.parse(match[1]);
      if (!Array.isArray(row) || row.length < 3 || !/^\d+$/.test(String(row[0]))) {
        throw new Error("A pesquisa de funcionalidades retornou uma linha inválida.");
      }
      if (row[2] === title) ids.push(String(row[0]));
    }
    return ids;
  }

  async functionalityDetails(id: string): Promise<FunctionalityDetails> {
    const cached = this.functionalityCache.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    if (!/^\d+$/.test(id)) throw new Error("O ID do conteúdo deve ser numérico.");
    const url = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "7156", mode: -1, goto: id,
      filter: "", scrolling: false, firstLoad: true,
    });
    const response = await this.http.get(url);
    const body = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`O conteúdo ${id} respondeu HTTP ${response.status}.`);
    if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao consultar o conteúdo.");
    const identity = parseFormRecordIdentity(body);
    if (!identity || identity.recordId !== id) throw new Error(`O AgilePoint não abriu o conteúdo ${id}.`);
    const get = (componentId: string) => parseWebrunSetValue(body, componentId);
    const value = {
      conteudo_id_origem: identity.recordId,
      colaborador_id_origem: get("1135727"),
      data_publicacao: get("1135728"),
      categoria_id_origem: get("1135729"),
      projeto_origem: get("1135730"),
      versao_conteudo: get("1135731"),
    };
    this.functionalityCache.set(id, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  async submitPointFunctions(simulation: PointSimulation): Promise<{
    lancamento_id: string;
    contagem_criada: boolean;
    funcoes_inseridas: Array<{ nome: string; itens: number; total_pf_equivalente: number }>;
    transporte_dados: "endpoint_interno";
    endpoints: string[];
  }> {
    const status = writeConfigurationStatus();
    if (!status.habilitada) {
      throw new Error("A gravação está desabilitada. Defina APF_WRITE_ENABLED=true somente no ambiente autorizado.");
    }
    const created = simulation.contagem.acao === "criar";
    const countId = created
      ? await this.createCountHttp(simulation)
      : await this.resolveExactCountIdHttp(simulation.contagem);
    const inserted: Array<{ id: string; nome: string; itens: number; total_pf_equivalente: number }> = [];
    try {
      const initial = await this.countFunctionsById(countId);
      if (initial.count.closed) throw new Error("A contagem está fechada e não pode receber pontos de função.");
      const existingNames = initial.functions.map((row) => cleanText(String(row.field743 ?? "")));
      const duplicates = simulation.funcoes.filter((item) => existingNames.some((name) => normalize(name) === normalize(item.nome)));
      if (duplicates.length) throw new Error(`As funções a seguir já existem na contagem; nada foi inserido: ${duplicates.map((item) => item.nome).join(", ")}.`);
      const detail = await this.openCountDocumentById(countId);
      assertPointFactorsMatchConventions(simulation.funcoes, publishedActivityConventions(detail.body));
      for (const funcao of simulation.funcoes) {
        const createdFunction = await this.insertCountFunctionHttp(detail.url, countId, funcao);
        inserted.push({ id: createdFunction.id, nome: funcao.nome, itens: funcao.itens.length, total_pf_equivalente: funcao.total_pf_equivalente });
        await this.insertFunctionItemsHttp(detail.url, countId, createdFunction.id, createdFunction.position, funcao.itens);
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const funcao of [...inserted].reverse()) {
        try { await this.deleteFunctionByIdHttp(countId, funcao.id, funcao.nome); }
        catch (rollbackError) {
          rollbackErrors.push(`${funcao.nome}: ${rollbackError instanceof Error ? rollbackError.message : "falha desconhecida"}`);
        }
      }
      if (created) {
        try { await this.deleteCountByIdHttp(countId); }
        catch (rollbackError) {
          rollbackErrors.push(`contagem ${countId}: ${rollbackError instanceof Error ? rollbackError.message : "falha desconhecida"}`);
        }
      }
      const original = error instanceof Error ? error.message : "Falha ao lançar pontos de função.";
      if (rollbackErrors.length) throw new Error(`${original} Rollback incompleto: ${rollbackErrors.join("; ")}`);
      throw new Error(created
        ? `${original} A contagem e as funções inseridas nesta tentativa foram removidas.`
        : `${original} As funções inseridas nesta tentativa foram removidas.`);
    }
    return {
      lancamento_id: countId,
      contagem_criada: created,
      funcoes_inseridas: inserted.map(({ id: _id, ...item }) => item),
      transporte_dados: "endpoint_interno",
      endpoints: ["/basic_query.jsp", "/search.do", "/form.do", "/openform.do", "/navigate.do", "/gridEdit.do"],
    };
  }

  private async createCountHttp(simulation: PointSimulation): Promise<string> {
    const target = simulation.contagem;
    if (target.acao !== "criar") throw new Error("A criação HTTP exige uma simulação configurada com acao=criar.");
    const application = await this.resolveExactLookupHttp("aplicacao", target.aplicacao);
    const countType = await this.resolveExactLookupHttp("tipo_contagem", target.tipo_contagem!);
    const year = await this.resolveExactLookupHttp("ano_competencia", String(target.ano_competencia));
    const factor = await this.resolveExactLookupHttp("fator_equivalencia", target.fator_equivalencia!);
    const formUrl = buildCountSearchOpenUrl(this.baseUrl);
    const form = await this.http.get(formUrl);
    const formBody = form.text();
    if (form.status < 200 || form.status >= 300 || isLoginDocument(formBody)) {
      throw new Error(`O formulário de criação da contagem respondeu HTTP ${form.status}.`);
    }
    const csrfToken = load(formBody)('input[name="WEBRUN-CSRFTOKEN"]').attr("value")?.trim();
    if (!csrfToken) throw new Error("O token CSRF da criação da contagem não foi encontrado.");
    const formEndpoint = buildInternalUrl(this.baseUrl, "/form.do", {});
    const include = await this.http.post(formEndpoint, buildCountIncludeRequestBody(csrfToken), {
      "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl,
    });
    const includeBody = include.text();
    assertSuccessfulFormMutation(include.status, includeBody, "iniciar a criação da contagem");
    const defaults = {
      createdAt: parseWebrunSetValue(includeBody, "1897093694") ?? "",
      pointValue: parseWebrunSetValue(includeBody, "1645652289") ?? "",
      pointCost: parseWebrunSetValue(includeBody, "627836279") ?? "",
      conventionsJson: parseWebrunSetValue(includeBody, "1895236190") ?? "",
      userId: parseWebrunSetValue(includeBody, "1323048149") ?? "",
    };
    if (!defaults.createdAt || !defaults.userId) {
      await this.http.post(formEndpoint, buildCountCancelRequestBody(csrfToken), {
        "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl,
      }).catch(() => undefined);
      throw new Error("O AgilePoint não retornou os valores padrão de data e usuário para criar a contagem.");
    }
    try {
      assertPointFactorsMatchConventions(simulation.funcoes, parseActivityConventions(defaults.conventionsJson));
    } catch (error) {
      await this.http.post(formEndpoint, buildCountCancelRequestBody(csrfToken), {
        "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl,
      }).catch(() => undefined);
      throw error;
    }
    const post = await this.http.post(formEndpoint, buildCountCreateRequestBody({
      csrfToken,
      application,
      version: target.versao_sprint,
      countType,
      month: target.mes_competencia!,
      year,
      equivalenceFactor: factor,
      purpose: target.proposito,
      scope: target.escopo,
      defaults,
    }), { "Content-Type": "application/x-www-form-urlencoded", Referer: formUrl });
    const postBody = post.text();
    assertSuccessfulFormMutation(post.status, postBody, "gravar a nova contagem");
    const identity = parseFormRecordIdentity(postBody);
    if (!identity) throw new Error("O AgilePoint recebeu a criação, mas não retornou o CTG_COD; a operação não será repetida automaticamente.");
    const verified = await this.openCountDocumentById(identity.recordId);
    const verifiedFields = parseWebrunFormState(verified.body).fields;
    const verifiedApplication = verifiedFields.find((field) => field.componentId === "416")?.value ?? parseWebrunSetValue(verified.body, "416");
    const verifiedVersion = verifiedFields.find((field) => field.componentId === "409")?.value ?? parseWebrunSetValue(verified.body, "409");
    if (normalize(verifiedApplication ?? "") !== normalize(application.id)
      || normalize(verifiedVersion ?? "") !== normalize(target.versao_sprint)) {
      throw new Error(`A contagem ${identity.recordId} foi criada, mas seus dados não puderam ser confirmados. Não repita o lançamento automaticamente.`);
    }
    return identity.recordId;
  }

  private async resolveExactLookupHttp(kind: LookupKind, label: string): Promise<LookupOption> {
    const lookup = await this.lookupOptions(kind, label, 200);
    const exact = lookup.options.filter((option) => normalize(option.label) === normalize(label));
    if (exact.length !== 1) {
      throw new Error(exact.length
        ? `O valor "${label}" possui ${exact.length} correspondências exatas no lookup ${kind}.`
        : `O valor "${label}" não foi encontrado exatamente no lookup ${kind}.`);
    }
    return exact[0];
  }

  private async deleteCountByIdHttp(countId: string): Promise<void> {
    const detail = await this.openCountDocumentById(countId);
    const csrfToken = load(detail.body)('input[name="WEBRUN-CSRFTOKEN"]').attr("value")?.trim();
    if (!csrfToken) throw new Error("O token CSRF para remover a contagem de rollback não foi encontrado.");
    const response = await this.http.post(buildInternalUrl(this.baseUrl, "/form.do", {}), buildCountDeleteRequestBody(csrfToken), {
      "Content-Type": "application/x-www-form-urlencoded", Referer: detail.url,
    });
    assertSuccessfulFormMutation(response.status, response.text(), `remover a contagem ${countId}`);
    const reopened = await this.http.get(buildCountOpenUrl(this.baseUrl, countId));
    if (parseFormRecordIdentity(reopened.text())?.recordId === countId) {
      throw new Error(`O AgilePoint não confirmou a remoção da contagem ${countId}.`);
    }
  }

  private async insertCountFunctionHttp(
    referer: string,
    countId: string,
    funcao: PointSimulation["funcoes"][number],
  ): Promise<{ id: string; position: number }> {
    const insert = await this.http.get(buildCountFunctionGridInsertUrl(this.baseUrl), { Referer: referer });
    assertSuccessfulGridMutation(insert.status, insert.text(), `iniciar a inclusão da função ${funcao.nome}`);
    let posted = false;
    try {
      const post = await this.http.get(buildCountFunctionGridPostUrl(this.baseUrl, {
        countId,
        name: funcao.nome,
        functionPoints: funcao.total_pf_equivalente,
        reviewed: false,
        line: 0,
      }), { Referer: referer });
      assertSuccessfulGridMutation(post.status, post.text(), `gravar a função ${funcao.nome}`);
      posted = true;
      const refreshed = await this.countFunctionsById(countId);
      const exact = refreshed.functions.map((row, index) => ({ row, index })).filter(({ row }) => normalize(String(row.field743 ?? "")) === normalize(funcao.nome));
      if (exact.length !== 1) throw new Error(`O AgilePoint não confirmou de forma única a função ${funcao.nome}.`);
      const id = stableGridRecordId(exact[0].row);
      if (!id) throw new Error(`O AgilePoint não retornou o ID estável da função ${funcao.nome}.`);
      return { id, position: exact[0].index + 1 };
    } catch (error) {
      if (!posted) {
        await this.http.get(buildGridCancelUrl(this.baseUrl, "funcao", "insert"), { Referer: referer }).catch(() => undefined);
      } else {
        try {
          const current = await this.countFunctionsById(countId);
          const positions = current.functions.map((row, index) => ({ row, index })).filter(({ row }) => normalize(String(row.field743 ?? "")) === normalize(funcao.nome));
          for (const candidate of positions.reverse()) {
            const deletion = await this.http.get(buildGridRowDeleteUrl(this.baseUrl, "funcao", candidate.index + 1), { Referer: referer });
            assertSuccessfulGridMutation(deletion.status, deletion.text(), `reverter a função não confirmada ${funcao.nome}`);
          }
        } catch (rollbackError) {
          const original = error instanceof Error ? error.message : `Falha ao confirmar a função ${funcao.nome}.`;
          const rollback = rollbackError instanceof Error ? rollbackError.message : "falha desconhecida";
          throw new Error(`${original} Rollback incompleto da função ainda não confirmada: ${rollback}`);
        }
      }
      throw error;
    }
  }

  private async insertFunctionItemsHttp(
    referer: string,
    countId: string,
    functionId: string,
    functionPosition: number,
    items: PointSimulation["funcoes"][number]["itens"],
  ): Promise<void> {
    await this.fetchDependentGridEndpointHttp(referer, functionPosition, "itens", "1026482");
    for (const item of items) {
      const insert = await this.http.get(buildFunctionItemGridInsertUrl(this.baseUrl), { Referer: referer });
      assertSuccessfulGridMutation(insert.status, insert.text(), `iniciar a inclusão do item ${item.descricao}`);
      try {
        const post = await this.http.get(buildFunctionItemGridPostUrl(this.baseUrl, {
          functionId,
          description: item.descricao,
          activityType: item.tipo,
          activity: item.atividade,
          dataElements: item.td,
          filesReferenced: item.ar_tr,
          complexity: item.complexidade,
          functionPoints: item.pf,
          equivalentFunctionPoints: item.pf_equivalente,
          active: true,
          line: 0,
        }), { Referer: referer });
        assertSuccessfulGridMutation(post.status, post.text(), `gravar o item ${item.descricao}`);
      } catch (error) {
        await this.http.get(buildGridCancelUrl(this.baseUrl, "item", "insert"), { Referer: referer }).catch(() => undefined);
        throw error;
      }
    }
    await this.recalculateCountAfterPointLaunchHttp(countId);
    const rows = await this.fetchDependentGridEndpointHttp(referer, functionPosition, "itens", "1026482");
    if (functionItemSetKey(rows) !== functionItemSetKey(items.map((item) => ({
      field429: item.descricao,
      field761: item.tipo,
      field762: item.atividade,
      field431: item.td,
      field432: item.ar_tr,
      field433: item.complexidade,
      field434: item.pf,
      field435: item.pf_equivalente,
    })))) {
      throw new Error("O AgilePoint não confirmou exatamente os itens enviados para a nova função.");
    }
  }

  private async recalculateCountAfterPointLaunchHttp(countId: string): Promise<void> {
    const modalUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "35", mode: -1, goto: -1,
      filter: `APF_CONTAGEM.CTG_COD=${countId}@long`, scrolling: "yes",
    });
    const modal = await this.http.get(modalUrl, { Referer: buildCountOpenUrl(this.baseUrl, countId) });
    const modalBody = modal.text();
    if (modal.status < 200 || modal.status >= 300 || isLoginDocument(modalBody) || deniedDocument(modalBody)
      || !/Função\s*-\s*excel/i.test(modalBody) || !/698064244/.test(modalBody)) {
      throw new Error("O formulário de recálculo da contagem não está disponível para esta conta.");
    }
    const response = await this.http.post(
      buildInternalUrl(this.baseUrl, "/executeRule.do", {}),
      buildConfiguredRuleRequestBody({
        formId: "35", ruleName: "APF - recalcular contagem", pType: "2", parentRID: "-1",
        parameters: {
          P_0: countId, F_5_469: "", F_19_470: "", F_20_498: "", F_21_497: "", F_22_471: "",
          F_23_499: "Copie a tabela e cole numa planilha de contagem. (Obs: se o formato da planilha for xlsx não cole em célula mesclada)",
          F_24_698064244: countId, F_25_473: "",
        },
      }),
      { "Content-Type": "application/x-www-form-urlencoded", Referer: modalUrl },
    );
    const body = response.text();
    if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body) || extractWebrunServerError(body)) {
      throw new Error("O AgilePoint recusou o recálculo da contagem após incluir o item.");
    }
  }

  private async deleteFunctionByIdHttp(countId: string, functionId: string, functionName: string): Promise<void> {
    const current = await this.countFunctionsById(countId);
    const position = current.functions.findIndex((row) => stableGridRecordId(row) === functionId);
    if (position < 0) return;
    const detail = await this.openCountDocumentById(countId);
    const response = await this.http.get(buildGridRowDeleteUrl(this.baseUrl, "funcao", position + 1), { Referer: detail.url });
    assertSuccessfulGridMutation(response.status, response.text(), `remover a função ${functionName}`);
    const verified = await this.countFunctionsById(countId);
    if (verified.functions.some((row) => stableGridRecordId(row) === functionId)) {
      throw new Error(`O AgilePoint não confirmou a remoção da função ${functionName}.`);
    }
  }

  async previewFunctionUsers(simulation: AssociationSimulation) {
    const countId = await this.resolveExactCountIdHttp(simulation.contagem);
    const initial = await this.countFunctionsById(countId);
    if (initial.count.closed) throw new Error("A contagem está fechada e não pode receber novas associações.");
    const available = initial.functions.map(row => ({ id: stableGridRecordId(row), nome: String(row.field743 ?? "").replace(/\s+/g, " ").trim(), associacoes_atuais: contributionSnapshot(Array.isArray(row._contributions) ? row._contributions as Array<Record<string, unknown>> : []) }));
    const requested = simulation.funcoes?.length ? simulation.funcoes : available.map(item => item.nome);
    if (!requested.length) throw new Error("A contagem não possui funções para associar.");
    const selected = requested.map(name => {
      const matches = available.filter(item => normalize(item.nome) === normalize(name));
      if (matches.length !== 1) throw new Error(`A função "${name}" possui ${matches.length} correspondências. Informe uma função inequívoca. Nenhuma associação foi iniciada.`);
      if (!matches[0].id || !/^\d+$/.test(matches[0].id)) throw new Error("O AgilePoint não retornou o ID estável da função.");
      return { id: matches[0].id, nome: matches[0].nome, associacoes_atuais: matches[0].associacoes_atuais };
    });
    const users = await this.resolveContributionUsersHttp(simulation.usuarios, {
      functionId: selected[0].id, countId, position: initial.functions.findIndex(row => stableGridRecordId(row) === selected[0].id) + 1,
    });
    return { contagem_id: countId, funcoes: selected, usuarios: users };
  }

  async associateFunctionUsers(simulation: AssociationSimulation): Promise<{
    contagem_id: string;
    funcoes_alteradas: Array<{ funcao: string; associacoes_anteriores: number; usuarios_associados: number }>;
    transporte_dados: "endpoint_interno";
    endpoints: string[];
  }> {
    const status = writeConfigurationStatus();
    if (!status.habilitada) {
      throw new Error("A gravação está desabilitada. Defina APF_WRITE_ENABLED=true somente depois de validar o fluxo em homologação.");
    }

    const checked = await this.previewFunctionUsers(simulation);
    if (simulation.alvos_verificados && JSON.stringify(checked) !== JSON.stringify(simulation.alvos_verificados)) {
      throw new Error("A contagem, as funções ou os usuários mudaram desde a simulação. Simule e aprove novamente antes de gravar.");
    }
    const countId = checked.contagem_id;
    const initial = await this.countFunctionsById(countId);
    if (initial.count.closed) throw new Error("A contagem está fechada e não pode receber novas associações.");
    const available = initial.functions.map((row, index) => ({
      index,
      id: String(row._record_id ?? (Array.isArray(row._primary_keys) ? row._primary_keys[0] : "") ?? "").trim(),
      name: String(row.field743 ?? "").replace(/\s+/g, " ").trim(),
      contributions: Array.isArray(row._contributions) ? row._contributions as Array<Record<string, unknown>> : [],
    }));
    if (available.some((item) => !/^\d+$/.test(item.id))) throw new Error("O AgilePoint não retornou o ID estável de todas as funções.");
    const requested = simulation.funcoes?.length ? simulation.funcoes : available.map((item) => item.name);
    const targets = requested.map((name) => available.find((item) => normalize(item.name) === normalize(name)) ?? null);
    const missing = requested.filter((_, index) => !targets[index]);
    if (missing.length) throw new Error(`Funções não encontradas na contagem: ${missing.join(", ")}. Nenhuma associação foi iniciada.`);
    const resolvedUsers = checked.usuarios;
    const detail = await this.openCountDocumentById(countId);

    const changed: Array<{ funcao: string; associacoes_anteriores: number; usuarios_associados: number }> = [];
    const snapshots: Array<{
      index: number;
      functionId: string;
      functionName: string;
      users: Array<{ userId: string; percentage: number }>;
    }> = [];
    try {
      for (const target of targets) {
        const item = target!;
        const priorUsers = contributionSnapshot(item.contributions);
        snapshots.push({ index: item.index, functionId: item.id, functionName: item.name, users: priorUsers });
        await this.replaceFunctionContributionsHttp(detail.url, item.index + 1, item.id, resolvedUsers);
        changed.push({ funcao: item.name, associacoes_anteriores: priorUsers.length, usuarios_associados: resolvedUsers.length });
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const snapshot of snapshots.reverse()) {
        try {
          await this.replaceFunctionContributionsHttp(detail.url, snapshot.index + 1, snapshot.functionId, snapshot.users);
        } catch (rollbackError) {
          rollbackErrors.push(`${snapshot.functionName}: ${rollbackError instanceof Error ? rollbackError.message : "falha desconhecida"}`);
        }
      }
      const original = error instanceof Error ? error.message : "Falha ao associar usuários.";
      if (rollbackErrors.length) throw new Error(`${original} Rollback incompleto: ${rollbackErrors.join("; ")}`);
      throw new Error(`${original} As alterações anteriores foram revertidas.`);
    }
    return {
      contagem_id: countId,
      funcoes_alteradas: changed,
      transporte_dados: "endpoint_interno",
      endpoints: ["/basic_query.jsp", "/search.do", "/form.do", "/openform.do", "/gridEdit.do", "/navigate.do"],
    };
  }

  async associateApplicationDevelopers(simulation: ApplicationDeveloperSimulation): Promise<{
    aplicacao_id: string;
    desenvolvedores_inseridos: Array<{ id: string; nome: string }>;
    desenvolvedores_ja_associados: Array<{ id: string; nome: string }>;
    transporte_dados: "endpoint_interno";
    endpoints: string[];
  }> {
    const status = writeConfigurationStatus();
    if (!status.habilitada) {
      throw new Error("A gravação está desabilitada. Defina APF_WRITE_ENABLED=true somente depois de validar o fluxo em homologação.");
    }

    const application = await this.resolveExactLookupHttp("aplicacao", simulation.aplicacao);
    const developers = await this.resolveApplicationDevelopersHttp(simulation.desenvolvedores);
    const initial = await this.applicationDevelopersById(application.id);
    const existingIds = new Set(initial.map((row) => applicationDeveloperId(row)));
    if (existingIds.has(null)) throw new Error("O AgilePoint não retornou o ID estável de todos os desenvolvedores já associados.");
    const alreadyAssociated = developers.filter((developer) => existingIds.has(developer.id));
    const missing = developers.filter((developer) => !existingIds.has(developer.id));
    if (!missing.length) {
      return {
        aplicacao_id: application.id,
        desenvolvedores_inseridos: [],
        desenvolvedores_ja_associados: alreadyAssociated.map(({ id, label }) => ({ id, nome: label })),
        transporte_dados: "endpoint_interno",
        endpoints: ["/search.do", "/openform.do", "/navigate.do", "/gridEdit.do"],
      };
    }

    const detail = await this.openApplicationDocumentById(application.id);
    const inserted: LookupOption[] = [];
    try {
      for (const developer of missing) {
        await this.insertApplicationDeveloperHttp(detail.url, application.id, developer.id);
        const verified = await this.applicationDevelopersById(application.id);
        if (!verified.some((row) => applicationDeveloperId(row) === developer.id)) {
          throw new Error(`O AgilePoint não confirmou a associação do desenvolvedor "${developer.label}".`);
        }
        inserted.push(developer);
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const developer of [...inserted].reverse()) {
        try { await this.deleteApplicationDeveloperByIdHttp(application.id, developer.id); }
        catch (rollbackError) {
          rollbackErrors.push(`${developer.label}: ${rollbackError instanceof Error ? rollbackError.message : "falha desconhecida"}`);
        }
      }
      const original = error instanceof Error ? error.message : "Falha ao associar desenvolvedores à aplicação.";
      if (rollbackErrors.length) throw new Error(`${original} Rollback incompleto: ${rollbackErrors.join("; ")}`);
      throw new Error(`${original} As associações inseridas nesta tentativa foram removidas.`);
    }

    return {
      aplicacao_id: application.id,
      desenvolvedores_inseridos: inserted.map(({ id, label }) => ({ id, nome: label })),
      desenvolvedores_ja_associados: alreadyAssociated.map(({ id, label }) => ({ id, nome: label })),
      transporte_dados: "endpoint_interno",
      endpoints: ["/search.do", "/openform.do", "/navigate.do", "/gridEdit.do"],
    };
  }

  private async openApplicationDocumentById(applicationId: string): Promise<{ url: string; body: string }> {
    if (!/^\d+$/.test(applicationId)) throw new Error("O ID da aplicação deve ser numérico.");
    const url = buildApplicationOpenUrl(this.baseUrl, applicationId);
    const response = await this.http.get(url);
    const body = response.text();
    if (response.status < 200 || response.status >= 300) throw new Error(`A abertura da aplicação respondeu HTTP ${response.status}.`);
    if (isLoginDocument(body)) throw new Error("A sessão HTTP expirou ao abrir a aplicação.");
    const identity = parseFormRecordIdentity(body);
    if (!identity || identity.recordId !== applicationId) {
      throw new Error("O AgilePoint não abriu a aplicação solicitada pelo filtro de ID.");
    }
    return { url, body };
  }

  private async applicationDevelopersById(applicationId: string): Promise<Array<Record<string, unknown>>> {
    const detail = await this.openApplicationDocumentById(applicationId);
    const grid = await this.fetchGridEndpointHttp("47", "1026480", detail.url, detail.body);
    const rows = grid.rows.map((row, index) => ({ ...row, _primary_keys: grid.keys[index] ?? [] }));
    return this.resolveGridRowIdsHttp(
      detail.url,
      "desenvolvedor_aplicacao",
      rows,
      "1111357777",
      {
        aplicacao: { componentId: "966896522", type: "hidden" },
        desenvolvedor: { componentId: "1026477", type: "lookup" },
      },
    );
  }

  private async resolveApplicationDevelopersHttp(labels: string[]): Promise<LookupOption[]> {
    // Este lookup somente retorna o catálogo completo quando q está vazio no Webrun 5.0.0.29.
    const lookup = await this.lookupOptions("desenvolvedor_aplicacao", "", 200);
    return labels.map((label) => {
      const exact = lookup.options.filter((option) => normalize(option.label) === normalize(label));
      if (exact.length !== 1) {
        throw new Error(exact.length
          ? `O desenvolvedor "${label}" possui ${exact.length} correspondências exatas no AgilePoint.`
          : `O desenvolvedor "${label}" não foi encontrado exatamente no AgilePoint.`);
      }
      return exact[0];
    });
  }

  private async insertApplicationDeveloperHttp(referer: string, applicationId: string, developerId: string): Promise<void> {
    const insert = await this.http.get(buildApplicationDeveloperGridInsertUrl(this.baseUrl), { Referer: referer });
    assertSuccessfulGridMutation(insert.status, insert.text(), "iniciar a associação do desenvolvedor");
    try {
      const post = await this.http.get(buildApplicationDeveloperGridPostUrl(this.baseUrl, {
        applicationId,
        developerId,
        line: 0,
      }), { Referer: referer });
      assertSuccessfulGridMutation(post.status, post.text(), `associar o desenvolvedor ${developerId}`);
    } catch (error) {
      await this.http.get(buildGridCancelUrl(this.baseUrl, "desenvolvedor_aplicacao", "insert"), { Referer: referer }).catch(() => undefined);
      throw error;
    }
  }

  private async deleteApplicationDeveloperByIdHttp(applicationId: string, developerId: string): Promise<void> {
    const current = await this.applicationDevelopersById(applicationId);
    const position = current.findIndex((row) => applicationDeveloperId(row) === developerId);
    if (position < 0) return;
    const detail = await this.openApplicationDocumentById(applicationId);
    const response = await this.http.get(buildGridRowDeleteUrl(this.baseUrl, "desenvolvedor_aplicacao", position + 1), { Referer: detail.url });
    assertSuccessfulGridMutation(response.status, response.text(), `remover a associação do desenvolvedor ${developerId}`);
    const verified = await this.applicationDevelopersById(applicationId);
    if (verified.some((row) => applicationDeveloperId(row) === developerId)) {
      throw new Error(`O AgilePoint não confirmou a remoção da associação do desenvolvedor ${developerId}.`);
    }
  }

  private async resolveExactCountIdHttp(target: AssociationSimulation["contagem"] | PointSimulation["contagem"]): Promise<string> {
    const query = await this.queryCountsHttp({
      versao: target.versao_sprint,
      data_criacao: target.criada_em,
      aplicacao: target.aplicacao,
      tipo: target.tipo_contagem,
      situacao: target.situacao ?? "Aberta",
    }, 100);
    const $ = load(query.html);
    const rows = $("#results-table tbody tr").toArray().map((row, index) => ({
      index,
      cells: $(row).find("td").toArray().map((cell) => $(cell).text().replace(/\s+/g, " ").trim()),
    })).filter(({ cells }) => cells.length >= 5 && cells.some(Boolean));
    if ($("#nav-item-next:not(.disabled) a").length > 0) {
      throw new Error("A pesquisa da contagem possui mais de uma página. Refine tipo_contagem e/ou criada_em antes de gravar.");
    }
    const exact = rows.filter(({ cells }) =>
      normalize(cells[0] ?? "") === normalize(target.versao_sprint)
      && normalize(cells[2] ?? "") === normalize(target.aplicacao)
      && (!target.criada_em || normalize(cells[1] ?? "") === normalize(target.criada_em))
      && (!target.tipo_contagem || normalize(cells[3] ?? "") === normalize(target.tipo_contagem))
      && normalize(cells[4] ?? "") === normalize(target.situacao ?? "Aberta")
    );
    if (exact.length !== 1) {
      if (!exact.length) throw new Error("Nenhuma contagem corresponde exatamente aos filtros informados.");
      throw new Error(`A busca encontrou ${exact.length} contagens exatas. Informe tipo_contagem e/ou criada_em para desambiguar.`);
    }
    const identity = query.identities[exact[0].index];
    if (!identity) throw new Error("O AgilePoint não retornou o ID estável da contagem selecionada.");
    return identity.recordId;
  }

  private async resolveContributionUsersHttp(
    users: AssociationSimulation["usuarios"],
    target: { functionId: string; countId: string; position: number },
  ): Promise<Array<{ userId: string; percentage: number }>> {
    const resolved: Array<{ userId: string; percentage: number }> = [];
    const contextualLookup = await this.contributionUserOptionsHttp(target);
    for (const user of users) {
      const id = /^id:(\d+)$/i.exec(user.usuario.trim())?.[1];
      const lookup = contextualLookup;
      const nameOnly = (label: string) => normalize(label.replace(/\s*\d{3}\.\d{3}\.\d{3}-\d{2}\s*$/, "").replace(/\s*\([^)]*\)\s*$/, ""));
      const exactLabel = lookup.options.filter(option => normalize(option.label) === normalize(user.usuario));
      const exact = id ? lookup.options.filter(option => option.id === id)
        : exactLabel.length ? exactLabel : lookup.options.filter(option => nameOnly(option.label) === normalize(user.usuario));
      if (!id && !lookup.complete) throw new Error("A consulta de usuários está incompleta. Refine o nome ou informe id: seguido do ID estável antes de associar.");
      if (exact.length !== 1) {
        throw new Error(exact.length
          ? `O usuário "${user.usuario}" possui ${exact.length} correspondências exatas no AgilePoint.`
          : `O usuário "${user.usuario}" não foi encontrado entre os responsáveis elegíveis da aplicação para esta função. Confira o vínculo do desenvolvedor na aplicação; o MCP não amplia o catálogo autorizado.`);
      }
      resolved.push({ userId: exact[0].id, percentage: user.percentual });
    }
    if (new Set(resolved.map(user => user.userId)).size !== resolved.length) throw new Error("Dois responsáveis informados correspondem à mesma pessoa. Consolide seus percentuais antes de associar.");
    return resolved;
  }

  private async contributionUserOptionsHttp(target: { functionId: string; countId: string; position: number }): Promise<{ options: LookupOption[]; complete: boolean }> {
    const detail = await this.openCountDocumentById(target.countId);
    await this.fetchDependentGridEndpointHttp(detail.url, target.position, "contribuicoes", "1026483");
    const selector = await this.http.get(buildFormOpenUrl(this.baseUrl, "59"), { Referer: detail.url });
    const selectorBody = selector.text();
    if (selector.status < 200 || selector.status >= 300 || isLoginDocument(selectorBody) || deniedDocument(selectorBody)
      || !/new HTMLLookup\(['"]APF['"],\s*59,\s*1026478,/.test(selectorBody)) {
      throw new Error("O AgilePoint não publicou o seletor autorizado de responsáveis da função.");
    }
    try {
      const insertion = await this.http.get(buildFunctionContributionGridInsertUrl(this.baseUrl), { Referer: detail.url });
      const insertedBody = insertion.text();
      assertSuccessfulGridMutation(insertion.status, insertedBody, "abrir o seletor de responsáveis");
      if (parseWebrunHiddenValue(insertedBody, "2087974631") !== target.functionId) throw new Error("O seletor de responsáveis abriu para uma função diferente. Nenhuma associação foi iniciada.");
      const response = await this.http.get(buildContributionUserLookupSearchUrl(this.baseUrl, target.functionId), { Referer: detail.url });
      const body = response.text();
      if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)) {
        throw new Error("O AgilePoint não permitiu consultar os responsáveis elegíveis desta função.");
      }
      const $ = load(body, { xmlMode: true });
      if ($("error").length || $("r").length !== 1) throw new Error("O seletor de responsáveis retornou uma resposta inválida; nenhuma associação foi iniciada.");
      const options = parseLookupXml(body);
      if ($('next[enabled="true"]').length || options.length > 200) {
        throw new Error("A lista de responsáveis elegíveis desta função está incompleta; nenhuma associação foi iniciada.");
      }
      return { options, complete: true };
    } finally {
      const cancel = await this.http.get(buildGridCancelUrl(this.baseUrl, "contribuicao", "insert"), { Referer: detail.url });
      assertSuccessfulGridMutation(cancel.status, cancel.text(), "cancelar a preparação do seletor de responsáveis");
    }
  }

  private async replaceFunctionContributionsHttp(
    referer: string,
    functionPosition: number,
    functionId: string,
    users: Array<{ userId: string; percentage: number }>,
  ): Promise<void> {
    const current = await this.fetchDependentGridEndpointHttp(referer, functionPosition, "contribuicoes", "1026483");
    for (let position = current.length; position >= 1; position -= 1) {
      const response = await this.http.get(buildGridRowDeleteUrl(this.baseUrl, "contribuicao", position), { Referer: referer });
      assertSuccessfulGridMutation(response.status, response.text(), `remover a contribuição ${position}`);
    }
    for (const user of users) {
      const insert = await this.http.get(buildFunctionContributionGridInsertUrl(this.baseUrl), { Referer: referer });
      assertSuccessfulGridMutation(insert.status, insert.text(), "iniciar a inclusão da contribuição");
      try {
        const post = await this.http.get(buildFunctionContributionGridPostUrl(this.baseUrl, {
          functionId,
          userId: user.userId,
          percentage: user.percentage,
          line: 0,
        }), { Referer: referer });
        assertSuccessfulGridMutation(post.status, post.text(), `associar o usuário ${user.userId}`);
      } catch (error) {
        await this.http.get(buildGridCancelUrl(this.baseUrl, "contribuicao", "insert"), { Referer: referer }).catch(() => undefined);
        throw error;
      }
    }
    const verified = await this.loadContributionSnapshotHttp(referer, functionPosition);
    if (contributionSetKey(verified) !== contributionSetKey(users)) {
      throw new Error("O AgilePoint não confirmou exatamente os usuários e percentuais enviados para a função.");
    }
  }

  private async loadContributionSnapshotHttp(
    referer: string,
    functionPosition: number,
  ): Promise<Array<{ userId: string; percentage: number }>> {
    const rows = await this.fetchDependentGridEndpointHttp(referer, functionPosition, "contribuicoes", "1026483");
    const resolved = await this.resolveGridRowIdsHttp(
      referer,
      "contribuicao",
      rows,
      "481313862",
      { usuario: { componentId: "1026478", type: "lookup" } },
    );
    return contributionSnapshot(resolved);
  }

}

type ResolvedField = { componentId: string; value: string; displayValue?: string };

function configuredInputsValues(parameters: CustomActionParameter[], fields: ResolvedField[], recordId: string | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of parameters) {
    if (parameter.source === "literal") values[parameter.name] = parameter.value;
    else if (parameter.source === "record_id") values[parameter.name] = recordId ?? "";
    else {
      const component = fields.find((field) => field.componentId === parameter.componentId);
      if (!component) throw new Error(`O componente ${parameter.componentId} exigido pelo contrato não foi publicado.`);
      values[parameter.name] = parameter.display ? component.displayValue ?? "" : component.value;
    }
  }
  return values;
}

function downloadInputsValues(contract: DownloadActionContract, fields: ResolvedField[], recordId: string | null): Record<string, string> {
  if (contract.path.source === "literal") return { path: contract.path.value };
  if (contract.path.source === "component_value") {
    const pathSource = contract.path;
    const component = fields.find((field) => field.componentId === pathSource.componentId);
    if (!component) throw new Error(`O componente ${pathSource.componentId} que contém o caminho do download não foi publicado.`);
    return { path: pathSource.display ? component.displayValue ?? "" : component.value };
  }
  return configuredInputsValues(contract.path.parameters, fields, recordId);
}

function assertResolvedInputsUnchanged(simulation: UiSimulation, operationIndex: number, values: Record<string, string>): void {
  const expected = simulation.resolved_input_digests?.[String(operationIndex)];
  if (!expected || expected !== objectDigest(values)) {
    throw new Error("Os parâmetros resolvidos mudaram desde a simulação. Simule e aprove novamente.");
  }
}

function mergeWebrunFormState(previous: WebrunFormState, responseBody: string): WebrunFormState {
  const parsed = parseWebrunFormState(responseBody);
  const fields = (parsed.fields.length ? parsed.fields : previous.fields).map((field) => {
    const value = parseWebrunSetValue(responseBody, field.componentId);
    return value === null ? { ...field } : { ...field, value };
  });
  return { csrfToken: parsed.csrfToken || previous.csrfToken, fields };
}

function objectDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function reportMaxBytes(): number {
  const raw = process.env.APF_REPORT_MAX_BYTES?.trim();
  if (!raw) return 50 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 100 * 1024 * 1024) {
    throw new Error("APF_REPORT_MAX_BYTES deve ser um inteiro entre 1024 e 104857600.");
  }
  return value;
}

function paginatedResponseBudget(): { maxBytes: number; maxRows: number } {
  return {
    maxBytes: configuredBudget("APF_PAGINATION_MAX_BYTES", 64 * 1024 * 1024, 1024 * 1024, 256 * 1024 * 1024),
    maxRows: configuredBudget("APF_PAGINATION_MAX_ROWS", 100_000, 1_000, 500_000),
  };
}

function configuredBudget(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

function consumeRankingBudget(
  label: string,
  state: { bytes: number; rows: number },
  budget: { maxBytes: number; maxRows: number },
  body: string,
  rows = 0,
): void {
  state.bytes += Buffer.byteLength(body);
  state.rows += rows;
  if (state.bytes > budget.maxBytes) throw new Error(`O ${label} excedeu o limite agregado de ${budget.maxBytes} bytes.`);
  if (state.rows > budget.maxRows) throw new Error(`O ${label} excedeu o limite agregado de ${budget.maxRows} linhas.`);
}

function exportDirectory(): string {
  const configured = process.env.APF_EXPORT_DIR?.trim();
  if (!configured) throw new Error("Downloads e relatórios exigem APF_EXPORT_DIR em um diretório privado e exclusivo deste usuário.");
  return path.resolve(configured);
}

export function validateReportContent(format: "pdf" | "xlsx", contentType: string | null, body: Buffer): void {
  const declaredMime = (contentType ?? "").split(";", 1)[0].trim().toLocaleLowerCase("pt-BR");
  const detectedMime = detectContentMime(body, `.${format}`);
  const expectedMime = format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (detectedMime !== expectedMime) throw new Error(`O conteúdo retornado não corresponde a um relatório ${format.toUpperCase()}.`);
  if (declaredMime && declaredMime !== expectedMime && declaredMime !== "application/octet-stream") {
    throw new Error(`O AgilePoint declarou o tipo inesperado ${declaredMime} para o relatório.`);
  }
}

export function extractQueryFormParameters(source: string): URLSearchParams {
  const $ = load(source);
  const form = $('form[name="WFRQueryForm"]');
  if (!form.length) throw new Error("O formulário interno de pesquisa não foi encontrado.");
  const action = form.attr("action")?.trim() ?? "";
  if (!/^\.?\/?search\.do(?:\?|$)/i.test(action)) throw new Error("O formulário de pesquisa apontou para um endpoint inesperado.");
  const parameters = new URLSearchParams();
  form.find("input[name], select[name], textarea[name]").each((_, element) => {
    const field = $(element);
    const name = field.attr("name")?.trim();
    if (!name || field.is(":disabled")) return;
    const type = (field.attr("type") ?? "").toLowerCase();
    if ((type === "checkbox" || type === "radio") && !field.is(":checked")) return;
    if (element.tagName.toLowerCase() === "select") {
      const option = field.find("option:selected").first();
      parameters.set(name, option.attr("value") ?? option.text());
      return;
    }
    parameters.set(name, field.attr("value") ?? field.text() ?? "");
  });
  if (parameters.get("sys") !== "APF" || parameters.get("formID") !== "26") {
    throw new Error("O formulário interno de pesquisa não corresponde à consulta de contagens do APF.");
  }
  return parameters;
}

export function parseCountSearchResponse(source: string, limit: number): { html: string; rowCount: number; hasNext: boolean } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("O limite de contagens deve estar entre 1 e 100.");
  const existing = load(source);
  if (existing("#results-table").length) {
    const rows = existing("#results-table tbody tr").toArray().filter((row) => existing(row).find("td").length >= 5).length;
    const hasNext = existing("#nav-item-next:not(.disabled) a").length > 0 || rows > limit;
    return { html: source, rowCount: rows, hasNext };
  }
  if (!/n\.clearGrid\(\s*\)/.test(source)) {
    throw new Error("O AgilePoint não retornou uma grade de contagens válida; a consulta não pode ser tratada como vazia.");
  }
  const pageMatch = /n\.setPaginationState\(\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/i.exec(source);
  if (!pageMatch) throw new Error("O AgilePoint não informou o estado de paginação da pesquisa de contagens.");
  const rows: string[][] = [];
  for (const match of source.matchAll(/n\.addGridRow\(\s*(\[[\s\S]*?\])\s*\)\s*;/g)) {
    let parsed: unknown;
    try { parsed = JSON5.parse(match[1]); }
    catch { throw new Error("Uma linha da pesquisa de contagens não pôde ser interpretada como dados."); }
    if (!Array.isArray(parsed) || parsed.length < 5 || parsed.length > 20) {
      throw new Error("Uma linha da pesquisa de contagens possui formato inesperado.");
    }
    const cells = parsed.slice(0, 5).map((value) => {
      if (value === null || value === undefined) return "";
      if (typeof value !== "string" && typeof value !== "number") throw new Error("A pesquisa de contagens retornou um tipo de célula inesperado.");
      const cell = String(value);
      if (cell.length > 1_000) throw new Error("Uma célula da pesquisa de contagens excede o tamanho permitido.");
      return cell;
    });
    rows.push(cells);
    if (rows.length > 1_000) throw new Error("A pesquisa de contagens retornou linhas demais.");
  }
  const hasNext = pageMatch[3].toLowerCase() === "true" || pageMatch[4].toLowerCase() === "true" || rows.length > limit;
  const safe = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<table id="results-table"><tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${safe(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table><li id="nav-item-next" class="${hasNext ? "" : "disabled"}">${hasNext ? "<a>Próxima</a>" : ""}</li>`;
  return { html, rowCount: rows.length, hasNext };
}

function uniqueDescriptor<T extends { ref: string; rotulo: string }>(target: string, values: T[]): T | undefined {
  const exactRef = values.filter((value) => value.ref === target);
  if (exactRef.length === 1) return exactRef[0];
  const exactLabel = values.filter((value) => normalize(value.rotulo) === normalize(target));
  return exactLabel.length === 1 ? exactLabel[0] : undefined;
}

function parseGridTotalRows(source: string, componentId: string): number | null {
  if (!/^\d+$/.test(componentId)) return null;
  const patterns = [
    new RegExp(`d\\.c_${componentId}\\.totalRows\\s*=\\s*(\\d+)`),
    new RegExp(`c_${componentId}[^;\\n]*?totalRows[^;\\n]*?(\\d+)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parseGridPageInterval(source: string, componentId: string): { start: number; end: number } | null {
  if (!/^\d+$/.test(componentId)) return null;
  const start = new RegExp(`d\\.c_${componentId}\\.setGridPageIni\\(\\s*(\\d+)\\s*\\)`).exec(source);
  const end = new RegExp(`d\\.c_${componentId}\\.setGridPageEnd\\(\\s*(\\d+)\\s*\\)`).exec(source);
  if (!start || !end) return null;
  return { start: Number.parseInt(start[1], 10), end: Number.parseInt(end[1], 10) };
}

function parseGridIsLastPage(source: string, componentId: string): boolean | null {
  if (!/^\d+$/.test(componentId)) return null;
  const match = new RegExp(`d\\.c_${componentId}\\.isLastPage\\s*=\\s*(true|false)`, "i").exec(source);
  return match ? match[1].toLocaleLowerCase() === "true" : null;
}

function extractWebrunServerError(source: string): string | null {
  const candidates = [...source.matchAll(/(?:alert|showError|setError)\(\s*((?:'(?:(?:\\.)|[^'\\])*')|(?:"(?:(?:\\.)|[^"\\])*"))/gi)]
    .flatMap((match) => {
      try {
        const value = JSON5.parse(match[1]);
        return typeof value === "string" ? [value.replace(/\s+/g, " ").trim()] : [];
      } catch {
        return [];
      }
    });
  return candidates.find((message) => /erro|obrigat[oó]ri|inv[aá]lid|n[aã]o permitido|falha|recusad/i.test(message)) ?? null;
}

function assertExpectedFunctionalityTitle(source: string, formId: string, expected?: string): void {
  if (expected === undefined) return;
  if (formId !== "7156") throw new Error("titulo_esperado está disponível apenas para o formulário Funcionalidade.");
  const actual = parseWebrunFormState(source).fields.find((field) => field.componentId === "1135718")?.value;
  if (actual !== expected) throw new Error("O título da funcionalidade mudou ou não corresponde ao valor esperado.");
}

function publishedActivityConventions(source: string): ActivityConvention[] {
  const field = parseWebrunFormState(source).fields.find((item) => item.componentId === "1895236190");
  return parseActivityConventions(field?.value ?? parseWebrunSetValue(source, "1895236190") ?? "");
}

function formatSaoPauloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.day}/${value.month}/${value.year}`;
}

function normalizeRepositoryCatalog(value: unknown): Array<{
  id: string;
  titulo: string;
  descricao: string;
  categoria: string;
  media_estrelas: number | null;
  quantidade_avaliacoes: number;
}> {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (value && typeof value === "object") {
    const firstArray = Object.values(value as Record<string, unknown>).find(Array.isArray);
    if (Array.isArray(firstArray)) items = firstArray;
  }
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? record.codigo ?? "").trim();
    if (!/^\d+$/.test(id)) return [];
    const rawCategory = String(record.categoria ?? record.category ?? "").trim();
    const category = rawCategory === "1" ? "Fluxo" : rawCategory === "2" ? "Dica de Mestre" : rawCategory;
    const rating = Number(record.avaliacao ?? record.media_estrelas ?? record.mediaAvaliacao);
    const count = Number(record.qtdAvaliacao ?? record.quantidade_avaliacoes ?? record.quantidadeAvaliacoes);
    return [{
      id,
      titulo: String(record.titulo ?? record.title ?? "").trim(),
      descricao: String(record.descricao ?? record.description ?? "").trim(),
      categoria: category,
      media_estrelas: Number.isFinite(rating) ? rating : null,
      quantidade_avaliacoes: Number.isFinite(count) ? count : 0,
    }];
  });
}

function contributionSnapshot(rows: Array<Record<string, unknown>>): Array<{ userId: string; percentage: number }> {
  return rows.map((row, index) => {
    const foreignIds = row._foreign_ids && typeof row._foreign_ids === "object"
      ? row._foreign_ids as Record<string, unknown>
      : {};
    const userId = String(foreignIds.usuario ?? "").trim();
    const percentage = Number(String(row.field806 ?? "").replace(",", "."));
    if (!/^\d+$/.test(userId)) throw new Error(`O AgilePoint não retornou o ID do usuário na contribuição ${index + 1}.`);
    if (!Number.isInteger(percentage) || percentage < 1 || percentage > 100) {
      throw new Error(`O percentual da contribuição ${index + 1} é inválido.`);
    }
    return { userId, percentage };
  });
}

function contributionSetKey(users: Array<{ userId: string; percentage: number }>): string {
  return users
    .map((user) => `${user.userId}:${user.percentage}`)
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .join("|");
}

function applicationDeveloperId(row: Record<string, unknown>): string | null {
  const foreignIds = row._foreign_ids && typeof row._foreign_ids === "object"
    ? row._foreign_ids as Record<string, unknown>
    : {};
  const value = String(foreignIds.desenvolvedor ?? "").trim();
  return /^\d+$/.test(value) ? value : null;
}

function stableGridRecordId(row: Record<string, unknown>): string | null {
  const direct = String(row._record_id ?? "").trim();
  if (/^\d+$/.test(direct)) return direct;
  const keys = Array.isArray(row._primary_keys) ? row._primary_keys : [];
  return keys.map(String).map((value) => value.trim()).find((value) => /^\d+$/.test(value)) ?? null;
}

function functionItemSetKey(rows: Array<Record<string, unknown>>): string {
  const number = (value: unknown) => {
    const parsed = Number(String(value ?? "").replace(",", "."));
    return Number.isFinite(parsed) ? String(Number(parsed.toFixed(6))) : String(value ?? "").trim();
  };
  return rows.map((row) => [
    normalize(String(row.field429 ?? "")),
    normalize(String(row.field761 ?? "")),
    normalize(String(row.field762 ?? "")),
    number(row.field431),
    number(row.field432),
    normalize(String(row.field433 ?? "")),
    number(row.field434),
    number(row.field435),
  ].join("\u001f")).sort((left, right) => left.localeCompare(right, "pt-BR")).join("\u001e");
}

function assertSuccessfulGridMutation(status: number, body: string, operation: string): void {
  if (status < 200 || status >= 300) throw new Error(`O AgilePoint respondeu HTTP ${status} ao ${operation}.`);
  if (isLoginDocument(body)) throw new Error(`A sessão HTTP expirou ao ${operation}.`);
  if (/Acesso negado|sem permiss.o|n.o possui permiss.o|ActNewErrorMessage|handleException\s*\(/i.test(body)) {
    throw new Error(`O AgilePoint recusou a operação ao ${operation}.`);
  }
}

function assertSuccessfulFormMutation(status: number, body: string, operation: string): void {
  if (status < 200 || status >= 300) throw new Error(`O AgilePoint respondeu HTTP ${status} ao ${operation}.`);
  if (isLoginDocument(body)) throw new Error(`A sessão HTTP expirou ao ${operation}.`);
  if (/Acesso negado|sem permiss.o|n.o possui permiss.o|ActNewErrorMessage|hasRuleErrors\s*=\s*true|\binteractionError\s*\(/i.test(body) || extractWebrunServerError(body)) {
    throw new Error(`O AgilePoint recusou a operação ao ${operation}.`);
  }
}

function readCountHeader(body: string, recordId: string): { recordId: string; application: string; version: string; closed: boolean } {
  const fields = parseWebrunFormState(body).fields;
  const find = (componentId: string) => fields.find((field) => field.componentId === componentId);
  const application = find("416");
  const closed = find("750");
  return {
    recordId,
    application: application?.displayValue || application?.value || parseWebrunSetValue(body, "416") || "",
    version: find("409")?.value || parseWebrunSetValue(body, "409") || "",
    closed: closed ? /^(?:true|1|S|Sim)$/i.test(closed.value.trim()) : parseWebrunCheckbox(body, "750"),
  };
}

function parseWebrunCheckbox(source: string, componentId: string): boolean {
  if (!/^\d+$/.test(componentId)) return false;
  const escaped = `(?:d\\.)?c_${componentId}`;
  return new RegExp(`${escaped}(?:\\.setValue\\(\\s*|\\.(?:checked|value)\\s*=\\s*)(?:true|1|['"](?:true|1|S|Sim)['"])`, "i").test(source);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function cleanText(value: string): string { return value.replace(/\s+/g, " ").trim(); }

export type FunctionalityDetails = {
  conteudo_id_origem: string | null;
  colaborador_id_origem: string | null;
  data_publicacao: string | null;
  categoria_id_origem: string | null;
  projeto_origem: string | null;
  versao_conteudo: string | null;
};

export type ScreenSummary = {
  ref: string;
  nome: string;
  formulario_id: string | null;
  visivel: boolean;
  origem: "menu";
};

export type ScreenField = {
  ref: string;
  rotulo: string;
  tipo: string;
  sensivel?: boolean;
  valor: string;
  obrigatorio: boolean;
  desabilitado: boolean;
  opcoes?: Array<{ valor: string; texto: string; selecionada: boolean }>;
  endpoint_disponivel?: boolean;
  upload_contrato_fingerprint?: string;
  download_contrato_fingerprint?: string;
};

export type ScreenAction = {
  ref: string;
  rotulo: string;
  tipo: string;
  desabilitado: boolean;
  endpoint_disponivel?: boolean;
  ferramenta_especializada?: string;
  contrato_fingerprint?: string;
  destrutiva?: boolean;
  upload_contrato_fingerprint?: string;
  download_contrato_fingerprint?: string;
};

export type ScreenTable = {
  ref: string;
  colunas: string[];
  linhas: string[][];
  linhas_visiveis: number;
  truncada: boolean;
};

export type ScreenDescription = {
  nome: string;
  url: string;
  formulario_id: string | null;
  registro_id_origem: string | null;
  abas_ativas: string[];
  campos: ScreenField[];
  acoes: ScreenAction[];
  tabelas: ScreenTable[];
  alertas: string[];
  consultado_em: string;
};

export type ScreenRead = ScreenDescription & {
  leitura: {
    completa: boolean;
    limite_linhas_por_grade: number;
    grades: Array<{
      grade_ref: string;
      paginas_consultadas: number;
      linhas_disponiveis: number | null;
      linhas_retornadas: number;
      completa: boolean;
      truncada_por_limite: boolean;
    }>;
  };
};
