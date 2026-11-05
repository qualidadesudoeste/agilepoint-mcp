import { createHash } from "node:crypto";
import JSON5 from "json5";
import { load } from "cheerio";

const ALLOWED_INTERNAL_PATHS = new Set([
  "/basic_query.jsp",
  "/executeRule.do",
  "/form.do",
  "/form.jsp",
  "/gridEdit.do",
  "/open.do",
  "/download",
  "/navigate.do",
  "/openform.do",
  "/refresh.do",
  "/search.do",
  "/upload.jsp",
  "/uploadMultipleFiles.do",
  "/jsRule/system_apf/webrunRules.js",
]);

export const APPLICATION_DEVELOPER_GRID_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-29",
  formId: "47",
  childFormId: "7152",
  componentId: "1026480",
  route: "/gridEdit.do",
  fields: Object.freeze({
    relationId: "WFRInput1111357777",
    applicationId: "WFRInput966896522",
    developerId: "WFRInput1026477",
  }),
});

export const COUNT_FUNCTION_GRID_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-29",
  formId: "26",
  componentId: "505",
  route: "/gridEdit.do",
  fields: Object.freeze({
    relationId: "WFRInput416960411",
    countId: "WFRInput2014322866",
    reviewed: "WFRInput1135780",
    name: "WFRInput743",
    functionPoints: "WFRInput1135868",
    openAction: "WFRInput1026504",
  }),
});

export const COUNT_FORM_WRITE_CONTRACT = Object.freeze({
  source: "captured-client-runtime-2026-09-29",
  formId: "26",
  route: "/form.do",
  fields: Object.freeze({
    applicationId: "WFRInput416",
    applicationLabel: "WFRInput416Show",
    version: "WFRInput409",
    closed: "WFRInput750",
    countTypeId: "WFRInput415",
    countTypeLabel: "WFRInput415Show",
    countId: "WFRInput476",
    countIdLabel: "WFRInput476Show",
    month: "WFRInput1135977",
    yearId: "WFRInput1135978",
    yearLabel: "WFRInput1135978Show",
    equivalenceFactorId: "WFRInput1135984",
    equivalenceFactorLabel: "WFRInput1135984Show",
    purpose: "WFRInput504",
    scope: "WFRInput411",
    createdAt: "WFRInput1897093694",
    pointValue: "WFRInput1645652289",
    pointCost: "WFRInput627836279",
    conventionsJson: "WFRInput1895236190",
    userId: "WFRInput1323048149",
    applicationName: "WFRInput793332034",
    countTypeName: "WFRInput710499245",
    statusLabel: "WFRInput316864464",
    mirroredApplicationId: "WFRInput1026485",
    mirroredApplicationLabel: "WFRInput1026485Show",
    mirroredVersion: "WFRInput1026486",
    mirroredClosed: "WFRInput1026484",
  }),
});

export const FUNCTION_DEPENDENT_GRID_CONTRACTS = Object.freeze({
  itens: Object.freeze({
    source: "captured-live-2026-09-29",
    parentComponentId: "505",
    dependentGrid: "grItensFuncoes",
    componentId: "1026482",
    filter: "APF_ITEM_FUNCAO.FUN_COD=FUN_COD",
  }),
  contribuicoes: Object.freeze({
    source: "captured-live-2026-09-29",
    parentComponentId: "505",
    dependentGrid: "gdContribuicao",
    componentId: "1026483",
    filter: "APF_FUNCAO_RESPONSAVEL.FUN_COD=FUN_COD",
  }),
});

export type FunctionDependentGridKind = keyof typeof FUNCTION_DEPENDENT_GRID_CONTRACTS;

export const FUNCTION_ITEM_GRID_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-29",
  formId: "26",
  componentId: "1026482",
  route: "/gridEdit.do",
  fields: Object.freeze({
    relationId: "WFRInput418349335",
    functionId: "WFRInput2086822907",
    reservedA: "WFRInput1845986074",
    active: "WFRInput1694905426",
    reservedB: "WFRInput2004825476",
    reservedC: "WFRInput573407451",
    description: "WFRInput429",
    activityType: "WFRInput761",
    activity: "WFRInput762",
    dataElements: "WFRInput431",
    filesReferenced: "WFRInput432",
    complexity: "WFRInput433",
    functionPoints: "WFRInput434",
    equivalentFunctionPoints: "WFRInput435",
  }),
});

export const FUNCTION_CONTRIBUTION_GRID_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-29",
  formId: "26",
  componentId: "1026483",
  route: "/gridEdit.do",
  fields: Object.freeze({
    relationId: "WFRInput481313862",
    functionId: "WFRInput2087974631",
    userId: "WFRInput1026478",
    percentage: "WFRInput806",
  }),
});

export const COUNT_REPORT_CONTRACTS = Object.freeze({
  analitico: Object.freeze({
    source: "captured-live-2026-09-29",
    route: "/executeRule.do",
    formId: "26",
    ruleName: "apf - emitir relatório analítico",
    output: "pdf",
  }),
  pdf: Object.freeze({
    source: "captured-live-2026-09-29",
    route: "/executeRule.do",
    formId: "26",
    ruleName: "apf - emitir relatório",
    output: "pdf",
  }),
  excel: Object.freeze({
    source: "captured-live-2026-09-29",
    route: "/executeRule.do",
    formId: "26",
    ruleName: "apf - preencher xlsx",
    output: "xlsx",
  }),
});

export const APF_RANKING_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-28",
  formId: "7153",
  gridComponentId: "1026496",
  dateComponentId: "1136066",
  analysisTypeComponentId: "1136067",
  applicationsComponentId: "1136074",
  applicationsRule: "Ranking - Obter todas aplicações",
  updateRule: "Ranking - atualizar consulta",
});

export type ApfRankingAnalysisType = "diario" | "mensal";

export const REPOSITORY_RANKING_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-28",
  formId: "9127",
  gridComponentId: "1135890",
  categoriesComponentId: "1135884",
  startDateComponentId: "1135885",
  endDateComponentId: "1135886",
  updateRule: "Ranking do repositório - Mostrar ranking",
  categoryIds: Object.freeze({ Fluxo: "1", "Dica de Mestre": "2" }),
});

export const REPOSITORY_CATALOG_CONTRACT = Object.freeze({
  source: "captured-from-client-rule-2026-09-29",
  formId: "500000385",
  listRule: "Dica de Mestre - Obter funcionalidades",
});

export const MAIN_MENU_CONTRACT = Object.freeze({
  source: "captured-live-2026-09-29",
  formId: "20",
  componentId: "579",
  ruleName: "Menu - Obter Dados no Servidor",
  compressedProperty: "XMLMenu",
});

export type RepositoryCategory = keyof typeof REPOSITORY_RANKING_CONTRACT.categoryIds;

export type CountReportKind = keyof typeof COUNT_REPORT_CONTRACTS;

const GRID_CONTRACTS = Object.freeze({
  inscricao_dica: Object.freeze({ formId: "500000386", componentId: "1136147", childFormId: "500000387", route: "/gridEdit.do" }),
  funcao: COUNT_FUNCTION_GRID_CONTRACT,
  item: FUNCTION_ITEM_GRID_CONTRACT,
  contribuicao: FUNCTION_CONTRIBUTION_GRID_CONTRACT,
  desenvolvedor_aplicacao: APPLICATION_DEVELOPER_GRID_CONTRACT,
});

export type GridContractKind = keyof typeof GRID_CONTRACTS;

export const LOOKUP_CONTRACTS = Object.freeze({
  aplicacao: Object.freeze({ formId: "26", componentId: "416", returnInput: "WFRInput416Show" }),
  tipo_contagem: Object.freeze({ formId: "26", componentId: "415", returnInput: "WFRInput415Show" }),
  ano_competencia: Object.freeze({ formId: "26", componentId: "1135978", returnInput: "WFRInput1135978Show" }),
  fator_equivalencia: Object.freeze({ formId: "26", componentId: "1135984", returnInput: "WFRInput1135984Show" }),
  usuario_contribuicao: Object.freeze({ formId: "59", componentId: "1026478", returnInput: "WFRInput1026478Show" }),
  desenvolvedor_aplicacao: Object.freeze({ formId: "7152", componentId: "1026477", returnInput: "WFRInput1026477Show" }),
});

export type LookupKind = keyof typeof LOOKUP_CONTRACTS;
export type LookupOption = { id: string; label: string };

export type FormRecordIdentity = {
  recordId: string;
  applicationId: string | null;
};

export function buildLoginRequestBody(username: string, password: string, iframeId = "RULE_MCP_LOGIN"): string {
  if (!username.trim()) throw new Error("O usuário do AgilePoint não foi informado.");
  if (!password) throw new Error("A senha do AgilePoint não foi informada.");
  const parameters = {
    iframeId,
    sys: "APF",
    formID: "19",
    action: "executeRule",
    ruleName: "Template - Login - Autenticar Usuario",
    P_0: username,
    P_1: password,
    P_2: "",
  };
  return Object.entries(parameters).map(([key, value]) => `${encodeWindows1252FormValue(key)}=${encodeWindows1252FormValue(value)}`).join("&");
}

export function buildLookupSearchUrl(baseUrl: string, kind: LookupKind, query = ""): string {
  const contract = LOOKUP_CONTRACTS[kind];
  const normalizedQuery = query.trim();
  if (normalizedQuery.length > 300) throw new Error("A consulta do lookup deve ter no máximo 300 caracteres.");
  return buildInternalUrl(baseUrl, "/search.do", {
    inputRetornoName: contract.returnInput,
    sys: "APF",
    action: "search",
    formID: contract.formId,
    componentID: contract.componentId,
    xml: true,
    type: 1,
    q: normalizedQuery,
  });
}

export function buildContributionUserLookupSearchUrl(baseUrl: string, functionId: string | number): string {
  const url = new URL(buildLookupSearchUrl(baseUrl, "usuario_contribuicao", ""));
  // HTMLLookup.lookupDoSearch envia as dependências do componente. Sem FUN_COD,
  // o servidor devolve uma lista vazia em vez dos desenvolvedores da aplicação.
  url.searchParams.set("WFRInput2087974631", numericId(functionId, "função"));
  url.searchParams.set("type", "2");
  return url.toString();
}

export function buildCountOpenUrl(baseUrl: string, countId: string | number): string {
  const normalized = numericId(countId, "contagem");
  return buildInternalUrl(baseUrl, "/openform.do", {
    sys: "APF", action: "openform", formID: "26", mode: -1, goto: -1,
    filter: `APF_CONTAGEM.CTG_COD=${normalized}@long`, scrolling: false, firstLoad: true,
  });
}

export function buildFormOpenUrl(baseUrl: string, formId: string | number): string {
  const normalized = numericId(formId, "formulário");
  return buildInternalUrl(baseUrl, "/openform.do", {
    sys: "APF", action: "openform", formID: normalized, mode: -1, goto: -1,
    filter: "", scrolling: false, firstLoad: true,
  });
}

export function buildGenericLookupSearchUrl(baseUrl: string, formId: string, componentId: string, query: string): string {
  const normalizedFormId = numericId(formId, "formulário");
  const normalizedComponentId = numericId(componentId, "componente");
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > 300) throw new Error("A consulta do lookup deve ter entre 1 e 300 caracteres.");
  return buildInternalUrl(baseUrl, "/search.do", {
    inputRetornoName: `WFRInput${normalizedComponentId}Show`,
    sys: "APF",
    action: "search",
    formID: normalizedFormId,
    componentID: normalizedComponentId,
    xml: true,
    type: 1,
    q: normalizedQuery,
  });
}

export function buildGenericFormActionRequestBody(input: {
  formId: string;
  csrfToken: string;
  action: "include" | "edit" | "delete" | "cancel" | "postcancel";
  goto?: number;
  fields?: Record<string, string>;
}): string {
  const formId = numericId(input.formId, "formulário");
  if (!input.csrfToken.trim()) throw new Error("O token CSRF do formulário é obrigatório.");
  const goto = input.goto ?? 1;
  if (!Number.isInteger(goto) || goto < 0) throw new Error("A posição do formulário deve ser um inteiro não negativo.");
  const fields = input.fields ?? {};
  for (const [name, value] of Object.entries(fields)) {
    if (!/^WFRInput\d+(?:Show)?$/.test(name)) throw new Error(`Campo Webrun não autorizado: ${name}.`);
    if (typeof value !== "string") throw new Error(`O valor de ${name} deve ser textual.`);
  }
  return encodeWindows1252Form({
    sys: "APF",
    formID: formId,
    action: "form",
    param: input.action,
    ...(input.action === "delete" ? { pType: "1" } : {}),
    filter: "",
    goto: String(goto),
    forceGetResponse: "true",
    "WEBRUN-CSRFTOKEN": input.csrfToken,
    ...(input.action === "postcancel" ? {
      invisibleFields: "",
      storedProcedureName: "",
      storedProcedureParams: "",
    } : {}),
    ...fields,
  });
}

export function buildMainMenuRequestBody(compressedMenu: string): string {
  const normalized = compressedMenu.replace(/\r?\n/g, "").trim();
  if (!normalized || normalized.length > 500_000 || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("O catálogo compactado do menu principal é inválido.");
  }
  return encodeWindows1252Form({
    action: "executeRule",
    pType: "2",
    ruleName: MAIN_MENU_CONTRACT.ruleName,
    sys: "APF",
    formID: MAIN_MENU_CONTRACT.formId,
    parentRID: "-1",
    P_0: "false",
    P_1: normalized,
  });
}

export function buildConfiguredRuleRequestBody(input: {
  formId: string;
  ruleName: string;
  pType: "1" | "2";
  parentRID: string;
  parameters: Record<string, string>;
}): string {
  const formId = numericId(input.formId, "formulário");
  if (!input.ruleName.trim() || input.ruleName.length > 200 || /[\r\n\0]/.test(input.ruleName)) throw new Error("O nome da regra personalizada é inválido.");
  if (!/^-?\d+$/.test(input.parentRID)) throw new Error("O parentRID da regra personalizada é inválido.");
  for (const [name, value] of Object.entries(input.parameters)) {
    if (!/^(?:P_\d+|F_\d+_\d+)$/.test(name)) throw new Error(`Parâmetro de regra não autorizado: ${name}.`);
    if (typeof value !== "string") throw new Error(`O valor de ${name} deve ser textual.`);
  }
  return encodeWindows1252Form({
    action: "executeRule",
    pType: input.pType,
    ruleName: input.ruleName.trim(),
    sys: "APF",
    formID: formId,
    parentRID: input.parentRID,
    ...input.parameters,
  });
}

export function buildApplicationOpenUrl(baseUrl: string, applicationId: string | number): string {
  const normalized = numericId(applicationId, "aplicação");
  return buildInternalUrl(baseUrl, "/openform.do", {
    sys: "APF", action: "openform", formID: "47", mode: -1, goto: -1,
    filter: `APF_APLICACAO.APL_COD=${normalized}@long`, scrolling: false, firstLoad: true,
  });
}

export function buildCountSearchOpenUrl(baseUrl: string): string {
  return buildInternalUrl(baseUrl, "/openform.do", {
    sys: "APF", action: "openform", formID: "26", mode: -1, goto: -1,
    filter: "", scrolling: false, firstLoad: true,
  });
}

export function buildCountQueryUrl(baseUrl: string): string {
  return buildInternalUrl(baseUrl, "/basic_query.jsp", { sys: "APF", formID: "26" });
}

export function buildCountQueryResultsUrl(baseUrl: string, param = "first"): string {
  if (!/^(?:first|previous|next|last)$/.test(param)) throw new Error("A navegação da consulta de contagens é inválida.");
  return buildInternalUrl(baseUrl, "/navigate.do", {
    sys: "APF", action: "navigate", formID: "26", componentID: -1,
    type: 1, showResults: true, param, q: "",
  });
}

export function buildCountIncludeRequestBody(csrfToken: string, goto = 0): string {
  if (!csrfToken.trim()) throw new Error("O token CSRF do formulário de contagem é obrigatório.");
  if (!Number.isInteger(goto) || goto < 0) throw new Error("A posição do formulário deve ser um inteiro não negativo.");
  return encodeWindows1252Form({
    sys: "APF",
    formID: COUNT_FORM_WRITE_CONTRACT.formId,
    param: "include",
    filter: "",
    goto: String(goto),
    "WEBRUN-CSRFTOKEN": csrfToken,
    forceGetResponse: "true",
  });
}

export function buildCountCancelRequestBody(csrfToken: string, goto = 0): string {
  if (!csrfToken.trim()) throw new Error("O token CSRF do formulário de contagem é obrigatório.");
  if (!Number.isInteger(goto) || goto < 0) throw new Error("A posição do formulário deve ser um inteiro não negativo.");
  return encodeWindows1252Form({
    sys: "APF",
    formID: COUNT_FORM_WRITE_CONTRACT.formId,
    param: "cancel",
    filter: "",
    goto: String(goto),
    "WEBRUN-CSRFTOKEN": csrfToken,
    forceGetResponse: "true",
  });
}

export function buildCountCreateRequestBody(input: {
  csrfToken: string;
  application: LookupOption;
  version: string;
  countType: LookupOption;
  month: number;
  year: LookupOption;
  equivalenceFactor: LookupOption;
  purpose?: string;
  scope?: string;
  defaults?: Record<string, string>;
  goto?: number;
}): string {
  if (!input.csrfToken.trim()) throw new Error("O token CSRF do formulário de contagem é obrigatório.");
  if (!input.version.trim()) throw new Error("A versão/sprint da contagem é obrigatória.");
  if (input.version.trim().length > 20) throw new Error("A versão/sprint da contagem excede o limite de 20 caracteres do AgilePoint.");
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new Error("O mês de competência deve estar entre 1 e 12.");
  const applicationId = numericId(input.application.id, "aplicação");
  const countTypeId = numericId(input.countType.id, "tipo de contagem");
  const yearId = numericId(input.year.id, "ano de competência");
  const factorId = numericId(input.equivalenceFactor.id, "fator de equivalência");
  const fields = COUNT_FORM_WRITE_CONTRACT.fields;
  const defaults = input.defaults ?? {};
  const parameters: Record<string, string> = {
    [fields.applicationId]: applicationId,
    [fields.applicationLabel]: input.application.label,
    [fields.version]: input.version.trim(),
    [fields.closed]: "false",
    [fields.countTypeId]: countTypeId,
    [fields.countTypeLabel]: input.countType.label,
    [fields.countId]: "",
    [fields.countIdLabel]: "",
    [fields.month]: String(input.month),
    [fields.yearId]: yearId,
    [fields.yearLabel]: input.year.label,
    [fields.equivalenceFactorId]: factorId,
    [fields.equivalenceFactorLabel]: input.equivalenceFactor.label,
    [fields.purpose]: input.purpose?.trim() ?? "",
    [fields.scope]: input.scope?.trim() ?? "",
    [fields.createdAt]: defaults.createdAt ?? "",
    [fields.pointValue]: defaults.pointValue ?? "",
    [fields.pointCost]: defaults.pointCost ?? "",
    [fields.conventionsJson]: defaults.conventionsJson ?? "",
    [fields.userId]: defaults.userId ?? "",
    [fields.applicationName]: input.application.label,
    [fields.countTypeName]: input.countType.label,
    [fields.statusLabel]: "Aberta",
    [fields.mirroredApplicationId]: applicationId,
    [fields.mirroredApplicationLabel]: input.application.label,
    [fields.mirroredVersion]: input.version.trim(),
    [fields.mirroredClosed]: "false",
  };
  return encodeWindows1252Form({
    sys: "APF",
    formID: COUNT_FORM_WRITE_CONTRACT.formId,
    action: "form",
    param: "postcancel",
    "WEBRUN-CSRFTOKEN": input.csrfToken,
    goto: String(input.goto ?? 0),
    invisibleFields: "",
    storedProcedureName: "",
    storedProcedureParams: "",
    ...parameters,
  });
}

export function buildCountDeleteRequestBody(csrfToken: string, goto = 1): string {
  if (!csrfToken.trim()) throw new Error("O token CSRF do formulário de contagem é obrigatório.");
  if (!Number.isInteger(goto) || goto < 1) throw new Error("A posição da contagem deve começar em 1.");
  return encodeWindows1252Form({
    sys: "APF", formID: COUNT_FORM_WRITE_CONTRACT.formId, action: "form", param: "delete",
    forceGetResponse: "true", filter: "", pType: "1", goto: String(goto), "WEBRUN-CSRFTOKEN": csrfToken,
  });
}

export function buildFunctionDependentGridUrl(baseUrl: string, kind: FunctionDependentGridKind, functionPosition: number): string {
  if (!Number.isInteger(functionPosition) || functionPosition < 1) throw new Error("A posição da função deve começar em 1.");
  const contract = FUNCTION_DEPENDENT_GRID_CONTRACTS[kind];
  return buildInternalUrl(baseUrl, "/gridEdit.do", {
    sys: "APF", param: "refreshDependence", formID: "26", comID: contract.parentComponentId,
    gt: functionPosition, dependentGrid: contract.dependentGrid, dependentGridFilter: contract.filter,
  });
}

export function parseLookupXml(source: string): LookupOption[] {
  const $ = load(source, { xmlMode: true });
  const options: LookupOption[] = [];
  $("d").each((_, element) => {
    const id = ($(element).attr("v") ?? "").trim();
    const label = $(element).text().replace(/\s+/g, " ").trim();
    if (id && label) options.push({ id, label });
  });
  return options;
}

export function parseWebrunSetValue(source: string, componentId: string): string | null {
  if (!/^\d+$/.test(componentId)) throw new Error("O componente interno deve ser numérico.");
  const match = new RegExp(`d\\.c_${componentId}\\.setValue\\(\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:\"(?:(?:\\\\.)|[^\"\\\\])*\"))\\s*\\)`).exec(source);
  if (!match) return null;
  try {
    const parsed = JSON5.parse(match[1]);
    return parsed === null || parsed === undefined ? null : String(parsed);
  } catch {
    return null;
  }
}

export function parseWebrunHiddenValue(source: string, componentId: string): string | null {
  if (!/^\d+$/.test(componentId)) throw new Error("O componente interno deve ser numérico.");
  const match = new RegExp(`d\\.c_${componentId}\\s*=\\s*new\\s+HTMLHidden\\(\\s*['"][^'"]*['"]\\s*,\\s*\\d+\\s*,\\s*${componentId}\\s*,\\s*((?:'(?:(?:\\\\.)|[^'\\\\])*')|(?:"(?:(?:\\\\.)|[^"\\\\])*"))\\s*\\)`).exec(source);
  if (!match) return null;
  try {
    const parsed = JSON5.parse(match[1]);
    return parsed === null || parsed === undefined ? null : String(parsed);
  } catch {
    return null;
  }
}

export function parseWebrunLookupValue(source: string, componentId: string): string | null {
  if (!/^\d+$/.test(componentId)) throw new Error("O componente interno deve ser numérico.");
  const match = new RegExp(`d\\.c_${componentId}\\s*=\\s*new\\s+HTMLLookup\\(([^;]*)\\)\\s*;`).exec(source);
  if (!match) return null;
  try {
    const args = JSON5.parse(`[${match[1]}]`) as unknown[];
    const value = args.at(-2);
    return value === null || value === undefined || value === "" ? null : String(value);
  } catch {
    return null;
  }
}

export function parseFormRecordIdentity(source: string): FormRecordIdentity | null {
  const primaryKeyMatch = /(?:^|[;\s])pkeys\s*=\s*((?:'(?:(?:\\.)|[^'\\])*')|(?:"(?:(?:\\.)|[^"\\])*"))/m.exec(source);
  if (!primaryKeyMatch) return null;
  try {
    const recordId = String(JSON5.parse(primaryKeyMatch[1])).trim();
    if (!/^\d+$/.test(recordId)) return null;
    const applicationId = parseWebrunSetValue(source, "416");
    return {
      recordId,
      applicationId: applicationId && /^\d+$/.test(applicationId) ? applicationId : null,
    };
  } catch {
    return null;
  }
}

export function parseGeneratedReportPath(source: string): string | null {
  const match = /(?:__jasperOpenReportConnectionAdd|ebfDonwloadStart)\(\s*['"](\/?tmp\/[0-9A-Fa-f-]+\.(?:pdf|xlsx))['"]/i.exec(source);
  if (!match) return null;
  const normalized = `/${match[1].replace(/^\//, "")}`;
  return /^\/tmp\/[0-9A-Fa-f-]+\.(?:pdf|xlsx)$/i.test(normalized) ? normalized : null;
}

export function buildCountReportRequestBody(kind: CountReportKind, countId: string | number, iframeId = "RULE_MCP_ENDPOINT"): string {
  const contract = COUNT_REPORT_CONTRACTS[kind];
  const parameters = {
    iframeId,
    sys: "APF",
    formID: contract.formId,
    action: "executeRule",
    ruleName: contract.ruleName,
    P_0: numericId(countId, "contagem"),
  };
  return Object.entries(parameters).map(([key, value]) => `${encodeWindows1252FormValue(key)}=${encodeWindows1252FormValue(value)}`).join("&");
}

export function buildRankingApplicationsRequestBody(): string {
  return encodeWindows1252Form({
    action: "executeRule",
    pType: "2",
    ruleName: APF_RANKING_CONTRACT.applicationsRule,
    sys: "APF",
    formID: APF_RANKING_CONTRACT.formId,
    parentRID: "-1",
    F_5_1026496: "",
    F_8_1136067: "M",
    F_9_1136066: "",
    F_10_1136070: "",
    F_11_1136071: "",
    F_12_1136075: "",
    F_13_1136072: "",
    F_27_1026488: "",
    F_28_1026497: "",
    F_29_1136067: "M",
    F_30_1026490: "",
    F_31_1026498: "",
    F_32_1135986: "",
    F_33_1136068: "",
    F_34_1136073: "Histórico",
    F_35_1136074: "",
    F_36_1136074: "",
    F_37_1136072: "",
    F_38_1136069: "",
  });
}

export function buildRankingUpdateRequestBody(
  date: string,
  analysisType: ApfRankingAnalysisType,
  applications: string,
  iframeId = "RULE_MCP_RANKING",
): string {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) throw new Error("A data do ranking deve estar no formato DD/MM/AAAA.");
  const typeCode = analysisType === "diario" ? "D" : "M";
  return encodeWindows1252Form({
    iframeId,
    sys: "APF",
    formID: APF_RANKING_CONTRACT.formId,
    action: "executeRule",
    ruleName: APF_RANKING_CONTRACT.updateRule,
    P_0: date,
    P_1: typeCode,
    F_0_1026488: "",
    F_1_1026496: "",
    F_2_1026497: "",
    F_3_1136073: "Histórico",
    F_4_1136070: date,
    F_5_1136071: date,
    F_6_1136074: applications,
    F_7_1136075: "",
    F_8_1136072: "",
    F_9_1136069: "",
    F_10_1136067: typeCode,
    F_11_1136066: date,
    F_12_1026490: "",
    F_13_1026498: "",
    F_14_1135986: "",
    F_15_1136068: "",
  });
}

export function buildRepositoryRankingRequestBody(
  startDate: string,
  endDate: string,
  categories: RepositoryCategory[],
  iframeId = "RULE_MCP_REPOSITORY_RANKING",
): string {
  if (startDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(startDate)) throw new Error("A data inicial deve estar no formato DD/MM/AAAA.");
  if (endDate && !/^\d{2}\/\d{2}\/\d{4}$/.test(endDate)) throw new Error("A data final deve estar no formato DD/MM/AAAA.");
  const uniqueCategories = [...new Set(categories)];
  if (!uniqueCategories.length) throw new Error("Selecione ao menos uma categoria do repositório.");
  const categoryIds = uniqueCategories.map((category) => REPOSITORY_RANKING_CONTRACT.categoryIds[category]).join(",");
  return encodeWindows1252Form({
    iframeId,
    sys: "APF",
    formID: REPOSITORY_RANKING_CONTRACT.formId,
    action: "executeRule",
    ruleName: REPOSITORY_RANKING_CONTRACT.updateRule,
    P_0: startDate,
    P_1: endDate,
    P_2: categoryIds,
    F_0_1135884: categoryIds,
    F_1_1135885: startDate,
    F_2_1135886: endDate,
    F_3_1135889: "",
    F_4_1135890: "",
    F_5_1135865: "",
  });
}

export function buildRepositoryCatalogRequestBody(iframeId = "RULE_MCP_REPOSITORY_CATALOG"): string {
  return encodeWindows1252Form({
    action: "executeRule",
    pType: "2",
    ruleName: REPOSITORY_CATALOG_CONTRACT.listRule,
    sys: "APF",
    formID: REPOSITORY_CATALOG_CONTRACT.formId,
    parentRID: "-1",
    iframeId,
  });
}

export function parseWebrunRuleReturn(source: string): string | null {
  const match = /\$mainform\(\)\.document\._ruleReturn\s*=\s*((?:'(?:(?:\\.)|[^'\\])*')|(?:"(?:(?:\\.)|[^"\\])*"))/m.exec(source);
  if (!match) return null;
  try {
    const value = JSON5.parse(match[1]);
    return value === null || value === undefined ? null : String(value);
  } catch {
    return null;
  }
}

export function parseWebrunRuleReturnValue<T = unknown>(source: string): T | null {
  const structured = parseWebrunAssignment<T>(source, "$mainform().document._ruleReturn");
  if (structured !== null) return structured;
  const scalar = parseWebrunRuleReturn(source);
  if (scalar === null) return null;
  try {
    return JSON5.parse(scalar) as T;
  } catch {
    return scalar as T;
  }
}

export function parseWebrunRuleReturnFirstString(source: string): string | null {
  const match = /\$mainform\(\)\.document\._ruleReturn\s*=\s*\[\s*((?:'(?:(?:\\.)|[^'\\])*')|(?:"(?:(?:\\.)|[^"\\])*"))/m.exec(source);
  if (!match) return null;
  try {
    const parsed = JSON5.parse(match[1]);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export type MenuPermission = { visible: boolean; enabled: boolean };

// The Webrun menu rule returns the full XML catalog followed by the current
// user's permission map. Parse the narrow response grammar without evaluating JS.
export function parseWebrunMenuRuleReturn(source: string): { xml: string; permissions: Map<string, MenuPermission> } | null {
  const assignment = /\$mainform\(\)\.document\._ruleReturn\s*=\s*\[\s*/m.exec(source);
  if (!assignment) return null;
  let position = assignment.index + assignment[0].length;
  const quoted = /^(?:'(?:(?:\\.)|[^'\\])*'|"(?:(?:\\.)|[^"\\])*")/;
  const readString = (): string | null => {
    const literal = quoted.exec(source.slice(position))?.[0];
    if (!literal) return null;
    position += literal.length;
    try {
      const value = JSON5.parse(literal);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  };
  const consume = (pattern: RegExp): boolean => {
    const match = pattern.exec(source.slice(position));
    if (!match) return false;
    position += match[0].length;
    return true;
  };
  const xml = readString();
  if (xml === null || !consume(/^\s*,\s*/)) return null;
  const mode = readString();
  if (mode !== "N" || !consume(/^\s*,\s*/)) return null;
  if (readString() === null || !consume(/^\s*,\s*new Map\(\)/)) return null;
  const permissions = new Map<string, MenuPermission>();
  const entry = /^\s*\.add\(\s*(\d{1,19})\s*,\s*\[\s*('(?:(?:\\.)|[^'\\])*'|"(?:(?:\\.)|[^"\\])*")\s*,\s*('(?:(?:\\.)|[^'\\])*'|"(?:(?:\\.)|[^"\\])*")\s*\]\s*\)/;
  while (source.slice(position).trimStart().startsWith(".add(")) {
    const match = entry.exec(source.slice(position));
    if (!match || permissions.size >= 10_000) return null;
    const code = BigInt(match[1]).toString();
    if (permissions.has(code)) return null;
    try {
      const visible = JSON5.parse(match[2]);
      const enabled = JSON5.parse(match[3]);
      if (typeof visible !== "string" || typeof enabled !== "string") return null;
      permissions.set(code, { visible: visible === "S", enabled: enabled === "S" });
    } catch {
      return null;
    }
    position += match[0].length;
  }
  if (!consume(/^\s*,\s*(?:true|false)\s*\]\s*;/)) return null;
  return { xml, permissions };
}

export function buildGeneratedReportDownloadUrl(baseUrl: string, reportPath: string): string {
  if (!/^\/tmp\/[0-9A-Fa-f-]+\.(?:pdf|xlsx)$/i.test(reportPath)) throw new Error("O caminho temporário do relatório é inválido.");
  if (reportPath.toLowerCase().endsWith(".xlsx")) {
    return buildInternalUrl(baseUrl, "/download", { download_file: reportPath, sys: "APF", formID: "26" });
  }
  const base = new URL(baseUrl);
  return new URL(reportPath, base).toString();
}

export function buildGenericDownloadUrl(baseUrl: string, formId: string, serverPath: string): string {
  if (!/^\d+$/.test(formId)) throw new Error("O formulário do download deve ser numérico.");
  if (!serverPath || serverPath.length > 2000 || /[\r\n\0]/.test(serverPath)) throw new Error("O caminho do download é inválido.");
  return buildInternalUrl(baseUrl, "/download", { download_file: serverPath, sys: "APF", formID: formId });
}

type GridPostBase = { line?: number; relationId?: string | number | null };

function buildGridInsertUrl(baseUrl: string, contract: { route: string; formId: string; componentId: string }): string {
  return buildInternalUrl(baseUrl, contract.route, {
    sys: "APF", action: "gridEdit", param: "insert", formID: contract.formId, comID: contract.componentId, gt: -1,
  });
}

function gridPostParameters(contract: { formId: string; componentId: string }, input: GridPostBase) {
  const line = input.line ?? 0;
  if (!Number.isInteger(line) || line < 0) throw new Error("A linha da grade deve ser um inteiro não negativo.");
  return {
    sys: "APF", action: "gridEdit", param: "post", formID: contract.formId, comID: contract.componentId,
    line, gt: -1, gridComID: -1, storedProcedureName: "", storedProcedureParams: "", align: 0,
  };
}

export function buildCountFunctionGridInsertUrl(baseUrl: string): string {
  return buildGridInsertUrl(baseUrl, COUNT_FUNCTION_GRID_CONTRACT);
}

export function buildCountFunctionGridPostUrl(baseUrl: string, input: GridPostBase & {
  countId: string | number; name: string; functionPoints: number; reviewed?: boolean;
}): string {
  const fields = COUNT_FUNCTION_GRID_CONTRACT.fields;
  const name = input.name.trim();
  if (!name) throw new Error("O nome da função é obrigatório.");
  if (!Number.isFinite(input.functionPoints) || input.functionPoints < 0) throw new Error("O total de PF deve ser um número não negativo.");
  return buildInternalUrl(baseUrl, COUNT_FUNCTION_GRID_CONTRACT.route, {
    ...gridPostParameters(COUNT_FUNCTION_GRID_CONTRACT, input),
    [fields.relationId]: optionalNumericId(input.relationId, "função"),
    [fields.countId]: numericId(input.countId, "contagem"),
    [fields.reviewed]: input.reviewed ?? false,
    [fields.name]: name,
    [fields.functionPoints]: input.functionPoints,
    [fields.openAction]: "",
  });
}

export function buildFunctionItemGridInsertUrl(baseUrl: string): string {
  return buildGridInsertUrl(baseUrl, FUNCTION_ITEM_GRID_CONTRACT);
}

export function buildFunctionItemGridPostUrl(baseUrl: string, input: GridPostBase & {
  functionId: string | number; description: string; activityType: "ALI" | "AIE" | "EE" | "SE" | "CE";
  activity: "I" | "A" | "E" | "T" | "AV" | "MI" | "AD" | "MA" | "AP"; dataElements: number; filesReferenced: number; complexity: "Baixa" | "Média" | "Alta";
  functionPoints: number; equivalentFunctionPoints: number; active?: boolean;
}): string {
  const fields = FUNCTION_ITEM_GRID_CONTRACT.fields;
  const description = input.description.trim();
  if (!description) throw new Error("A descrição do item é obrigatória.");
  for (const [label, value] of [["TD", input.dataElements], ["AR/TR", input.filesReferenced], ["PF", input.functionPoints], ["PF equivalente", input.equivalentFunctionPoints]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} deve ser um número não negativo.`);
  }
  return buildInternalUrl(baseUrl, FUNCTION_ITEM_GRID_CONTRACT.route, {
    ...gridPostParameters(FUNCTION_ITEM_GRID_CONTRACT, input),
    [fields.relationId]: optionalNumericId(input.relationId, "item"),
    [fields.functionId]: numericId(input.functionId, "função"),
    [fields.reservedA]: "",
    [fields.active]: input.active ?? true,
    [fields.reservedB]: "",
    [fields.reservedC]: "",
    [fields.description]: description,
    [fields.activityType]: input.activityType,
    [fields.activity]: input.activity,
    [fields.dataElements]: input.dataElements,
    [fields.filesReferenced]: input.filesReferenced,
    [fields.complexity]: input.complexity,
    [fields.functionPoints]: input.functionPoints,
    [fields.equivalentFunctionPoints]: input.equivalentFunctionPoints,
  });
}

export function buildFunctionContributionGridInsertUrl(baseUrl: string): string {
  return buildGridInsertUrl(baseUrl, FUNCTION_CONTRIBUTION_GRID_CONTRACT);
}

export function buildFunctionContributionGridPostUrl(baseUrl: string, input: GridPostBase & {
  functionId: string | number; userId: string | number; percentage: number;
}): string {
  if (!Number.isInteger(input.percentage) || input.percentage < 1 || input.percentage > 100) {
    throw new Error("O percentual deve ser um inteiro entre 1 e 100.");
  }
  const fields = FUNCTION_CONTRIBUTION_GRID_CONTRACT.fields;
  return buildInternalUrl(baseUrl, FUNCTION_CONTRIBUTION_GRID_CONTRACT.route, {
    ...gridPostParameters(FUNCTION_CONTRIBUTION_GRID_CONTRACT, input),
    [fields.relationId]: optionalNumericId(input.relationId, "contribuição"),
    [fields.functionId]: numericId(input.functionId, "função"),
    [fields.userId]: numericId(input.userId, "usuário"),
    [fields.percentage]: input.percentage,
  });
}

export function buildGridRowEditUrl(baseUrl: string, kind: GridContractKind, position: number): string {
  return buildGridRowActionUrl(baseUrl, kind, "edit", position);
}

export function buildGridRowDeleteUrl(baseUrl: string, kind: GridContractKind, position: number): string {
  return buildGridRowActionUrl(baseUrl, kind, "delete", position);
}

export function buildGridCancelUrl(baseUrl: string, kind: GridContractKind, operation: "edit" | "insert"): string {
  const contract = GRID_CONTRACTS[kind];
  return buildInternalUrl(baseUrl, contract.route, {
    sys: "APF", action: "gridEdit", param: operation === "edit" ? "canceledit" : "cancelinsert",
    formID: contract.formId, comID: contract.componentId, gt: -1,
  });
}

function buildGridRowActionUrl(baseUrl: string, kind: GridContractKind, action: "edit" | "delete", position: number): string {
  if (!Number.isInteger(position) || position < 1) throw new Error("A posição da grade deve começar em 1.");
  const contract = GRID_CONTRACTS[kind];
  return buildInternalUrl(baseUrl, contract.route, {
    sys: "APF", action: "gridEdit", param: action, formID: contract.formId,
    comID: contract.componentId, gridComID: -1, gt: position,
  });
}

export function buildApplicationDeveloperGridInsertUrl(baseUrl: string): string {
  return buildInternalUrl(baseUrl, APPLICATION_DEVELOPER_GRID_CONTRACT.route, {
    sys: "APF",
    action: "gridEdit",
    param: "insert",
    formID: APPLICATION_DEVELOPER_GRID_CONTRACT.formId,
    comID: APPLICATION_DEVELOPER_GRID_CONTRACT.componentId,
    gt: -1,
  });
}

export function buildApplicationDeveloperGridPostUrl(
  baseUrl: string,
  input: { applicationId: string | number; developerId: string | number; line: number; relationId?: string | number | null },
): string {
  const applicationId = numericId(input.applicationId, "aplicação");
  const developerId = numericId(input.developerId, "desenvolvedor");
  const relationId = input.relationId === null || input.relationId === undefined || input.relationId === ""
    ? ""
    : numericId(input.relationId, "associação");
  if (!Number.isInteger(input.line) || input.line < 0) throw new Error("A linha da grade deve ser um inteiro não negativo.");
  const fields = APPLICATION_DEVELOPER_GRID_CONTRACT.fields;
  return buildInternalUrl(baseUrl, APPLICATION_DEVELOPER_GRID_CONTRACT.route, {
    sys: "APF",
    action: "gridEdit",
    param: "post",
    formID: APPLICATION_DEVELOPER_GRID_CONTRACT.formId,
    comID: APPLICATION_DEVELOPER_GRID_CONTRACT.componentId,
    line: input.line,
    gt: -1,
    gridComID: -1,
    storedProcedureName: "",
    storedProcedureParams: "",
    align: 0,
    [fields.relationId]: relationId,
    [fields.applicationId]: applicationId,
    [fields.developerId]: developerId,
  });
}

export function buildInternalUrl(baseUrl: string, pathname: string, parameters: Record<string, string | number | boolean | null | undefined>): string {
  if (!ALLOWED_INTERNAL_PATHS.has(pathname)) throw new Error(`Endpoint interno não autorizado: ${pathname}`);
  const base = new URL(baseUrl);
  const url = new URL(pathname, base);
  if (url.origin !== base.origin) throw new Error("O endpoint interno deve usar o mesmo domínio configurado para o AgilePoint.");
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function buildRuleUploadUrl(baseUrl: string, input: {
  formId: string;
  ruleName: string;
  validationRule: string;
  multiple: boolean;
  parameters: Record<string, string>;
}): string {
  if (!/^\d+$/.test(input.formId)) throw new Error("O formulário do upload deve ser numérico.");
  for (const name of Object.keys(input.parameters)) {
    if (!/^P_\d+$/.test(name)) throw new Error(`Parâmetro de upload não autorizado: ${name}.`);
  }
  const endpoint = buildInternalUrl(baseUrl, "/upload.jsp", {});
  return `${endpoint}?${encodeWindows1252Form({
    sys: "APF",
    formID: input.formId,
    ruleName: input.ruleName,
    url: "",
    ...input.parameters,
    ruleValidation: input.validationRule,
    ruleUpload: "true",
    multiple: input.multiple ? "true" : "false",
  })}`;
}

function encodeWindows1252FormValue(value: string): string {
  const extended = new Map<number, number>([
    [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
    [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
    [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
    [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
    [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
    [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
    [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
  ]);
  let encoded = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || "_.*-".includes(character)) {
      encoded += character;
    } else if (character === " ") {
      encoded += "+";
    } else if (extended.has(code) || (code <= 0xff && (code < 0x80 || code >= 0xa0))) {
      encoded += `%${(extended.get(code) ?? code).toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      throw new Error("O valor contém caractere não representável em Windows-1252.");
    }
  }
  return encoded;
}

function encodeWindows1252Form(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .map(([key, value]) => `${encodeWindows1252FormValue(key)}=${encodeWindows1252FormValue(value)}`)
    .join("&");
}

export function validateInternalUrl(baseUrl: string, rawUrl: string): string {
  const base = new URL(baseUrl);
  const url = new URL(rawUrl, base);
  if (url.origin !== base.origin) throw new Error("O endpoint interno deve usar o mesmo domínio configurado para o AgilePoint.");
  if (!ALLOWED_INTERNAL_PATHS.has(url.pathname)) throw new Error(`Endpoint interno não autorizado: ${url.pathname}`);
  return url.toString();
}

export function parseWebrunAssignment<T = unknown>(source: string, variableName: string): T | null {
  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[;\\s])(?:var\\s+)?${escaped}\\s*=\\s*`, "m").exec(source);
  if (!match) return null;
  let position = match.index + match[0].length;
  while (/\s/.test(source[position] ?? "")) position += 1;
  const opening = source[position];
  if (opening !== "[" && opening !== "{") return null;
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let quote: string | null = null;
  let escapedCharacter = false;
  for (let index = position; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escapedCharacter) escapedCharacter = false;
      else if (character === "\\") escapedCharacter = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opening) depth += 1;
    if (character === closing) depth -= 1;
    if (depth === 0) {
      const literal = source.slice(position, index + 1);
      try {
        return JSON.parse(literal) as T;
      } catch {
        try {
          return JSON5.parse(literal) as T;
        } catch {
          try {
            return JSON5.parse(replaceWebrunExpressions(literal)) as T;
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function replaceWebrunExpressions(literal: string): string {
  let output = "";
  let index = 0;
  let quote: string | null = null;
  let escaped = false;
  while (index < literal.length) {
    const character = literal[index];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    const expression = /^(?:d\.c_\d+\.[A-Za-z_$][\w$]*|new\s+[A-Za-z_$][\w$]*)\s*\(/.exec(literal.slice(index));
    if (!expression) {
      output += character;
      index += 1;
      continue;
    }
    const opening = index + expression[0].lastIndexOf("(");
    let depth = 0;
    let innerQuote: string | null = null;
    let innerEscaped = false;
    let cursor = opening;
    for (; cursor < literal.length; cursor += 1) {
      const current = literal[cursor];
      if (innerQuote) {
        if (innerEscaped) innerEscaped = false;
        else if (current === "\\") innerEscaped = true;
        else if (current === innerQuote) innerQuote = null;
        continue;
      }
      if (current === "'" || current === '"') innerQuote = current;
      else if (current === "(") depth += 1;
      else if (current === ")" && --depth === 0) {
        cursor += 1;
        break;
      }
    }
    output += "null";
    index = cursor;
  }
  return output;
}

export function recordsHash(records: unknown): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

function numericId(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`O ID de ${label} deve ser numérico.`);
  return normalized;
}

function optionalNumericId(value: string | number | null | undefined, label: string): string {
  return value === null || value === undefined || value === "" ? "" : numericId(value, label);
}
