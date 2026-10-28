import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApfSession } from "./session.js";
import {
  enrichRankingRepositorio,
  extractContagensHtml,
  loadAvailableFunctionalityDetails,
  mapRankingApfRows,
  mapRankingRepositorioRaw,
  stableId,
} from "./extractors.js";
import { activateChatActor, currentActor, inferRoleFromMenu, requireRole } from "./access.js";
import { createWriteAuthorization, consumeWriteAuthorization, verifyWriteAuthorization, writeApprovalMode, type ApprovalElicitor } from "./write-authorization.js";
import { claimIdempotency, completeIdempotency, markIdempotencyAuditProjected } from "./idempotency.js";
import { auditValue } from "./audit-redaction.js";
import { apfPreparationSchema, prepareApfCount, validateApfCount } from "./apf-kit.js";
import { assertApfImportTarget, saveApfArtifacts } from "./apf-artifacts.js";
import { guidedApfSchema, planGuidedApf, GUIDED_APF_INSTRUCTIONS } from "./apf-guided.js";
import { dicaInputSchema, prepareDica, createDicaSimulation, getDicaSimulation, cancelDicaSimulation, consumeDicaSimulation, dicaHash, recordDicaAudit, validateDicaFiles, DICA_FLOW_INSTRUCTIONS } from "./dica-mestre.js";
import {
  associationHash,
  consumeAssociationSimulation,
  createAssociationSimulation,
  findSuccessfulAssociation,
  markAssociationConsumed,
  recordAssociationAudit,
} from "./associations.js";
import {
  applicationDeveloperHash,
  consumeApplicationDeveloperSimulation,
  createApplicationDeveloperSimulation,
  findSuccessfulApplicationDeveloperAssociation,
  markApplicationDeveloperSimulationConsumed,
  recordApplicationDeveloperAudit,
} from "./application-developers.js";
import {
  consumePointSimulation,
  createPointSimulation,
  findSuccessfulPointLaunch,
  listOwnPointAudit,
  markPointSimulationConsumed,
  pointHash,
  recordPointAudit,
} from "./points.js";
import {
  consumeQuickImportSimulation,
  createQuickImportSimulation,
  markQuickImportSimulationConsumed,
  quickImportHash,
  readQuickImportWorkbook,
  recordQuickImportAudit,
} from "./quick-import.js";
import {
  consumeUiSimulation,
  createUiSimulation,
  findSuccessfulUiOperation,
  markUiSimulationConsumed,
  recordUiAudit,
  uiHash,
} from "./universal.js";

const EXTRACTOR_VERSION = "1.2.0";
const apf = new ApfSession();

const server = new McpServer(
  { name: "agilepoint-apf", version: EXTRACTOR_VERSION },
  {
    instructions: DICA_FLOW_INSTRUCTIONS +
      "Servidor AgilePoint APF com chamadas serializadas. Sem credenciais pré-configuradas, chame autenticar_agilepoint uma vez com as credenciais informadas pelo usuário; não repita nem registre a senha. Simule antes de executar. No modo delegated, a IA pode executar criações e edições após conferir a simulação; operações destrutivas ainda exigem aprovação humana. No modo external, toda escrita exige aprovação externa. No modo elicitation, o cliente MCP deve apresentar uma confirmação interativa à pessoa. Datas devem estar no formato DD/MM/AAAA. " + GUIDED_APF_INSTRUCTIONS,
  },
);

const elicitApproval: ApprovalElicitor = async (request) => {
  if (!server.server.getClientCapabilities()?.elicitation?.form) {
    throw new Error("Este cliente MCP não oferece confirmação interativa de formulário; a operação foi bloqueada.");
  }
  return server.server.elicitInput(request, { timeout: 120_000, maxTotalTimeout: 120_000 });
};

const expectedApfTotals = z.object({
  pf_base: z.number().finite().nonnegative().optional(),
  pf_equivalente: z.number().finite().nonnegative().optional(),
}).strict();

server.registerTool("consultar_minhas_dicas_mestre", {
  title: "Consultar minhas inscrições de Dica de Mestre",
  description: "Consulta por endpoint a grade Minhas Inscrições vinculada à tela Dica de Mestre da conta autenticada. Retorna a avaliação publicada pelo AgilePoint sem presumir aprovação ou visibilidade no catálogo.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => apf.serialized(async () => result({ inscricoes: await apf.masterTipSubmissionsHttp(), consultado_em: new Date().toISOString(), formulario_id: "500000386" })));

server.registerTool("simular_publicacao_dica_mestre", {
  title: "Preparar e simular publicação de Dica de Mestre",
  description: "Valida título, descrição, documentação Markdown e anexos de apoio locais, confere o contrato da tela e duplicidade nas suas inscrições e solicita a aprovação configurada. Não inicia um envio nem transfere arquivos ao servidor. Para anexos e .md use APF_UPLOAD_DIR. A submissão posterior segue a avaliação do AgilePoint.",
  inputSchema: { publicacao: dicaInputSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ publicacao }) => {
  requireRole(["desenvolvedor", "gerente", "administrador"], "simular_publicacao_dica_mestre");
  return apf.serialized(async () => {
    const prepared = await prepareDica(publicacao);
    const endpoint = apf.masterTipEndpoint();
    const contract = await endpoint.inspect();
    await endpoint.ensureUnique(prepared.titulo);
    const preview = createDicaSimulation(prepared, contract.fingerprint);
    const approval = await createWriteAuthorization("publicar_dica_mestre", dicaHash(preview.simulacao), preview.simulacao);
    return result({ ...preview, aprovacao: approval, gravado_no_agilepoint: false, aviso: "Confira título, descrição, documentação integral e anexos. A execução submete uma inscrição; não concede aprovação nem altera sua avaliação." });
  });
});

server.registerTool("cancelar_publicacao_dica_mestre", {
  title: "Cancelar preparação local de Dica de Mestre",
  description: "Descarta uma simulação ainda pendente. Como a simulação não envia arquivos nem cria inscrição, nada precisa ser excluído no AgilePoint. Não desfaz uma publicação já executada ou de resultado incerto.",
  inputSchema: { confirmacao_token: z.string().uuid() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ confirmacao_token }) => apf.serialized(async () => result(cancelDicaSimulation(confirmacao_token))));

server.registerTool("publicar_dica_mestre", {
  title: "Submeter inscrição de Dica de Mestre por endpoint",
  description: "Executa uma simulação aprovada: inicia GUID, vincula anexos à sessão, transfere arquivos aprovados e submete título/descrição/Markdown. Confere a inscrição por ID e relê a documentação. Mantém a avaliação/aprovação do AgilePoint. Não repita automaticamente em caso de resultado incerto nem troque a chave de idempotência para contornar a proteção.",
  inputSchema: { confirmacao_token: z.string().uuid(), chave_idempotencia: z.string().trim().min(8).max(200), aprovacao_id: z.string().uuid().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
  requireRole(["desenvolvedor", "gerente", "administrador"], "publicar_dica_mestre");
  return apf.serialized(async () => {
    const simulation = getDicaSimulation(confirmacao_token), hash = dicaHash(simulation);
    await verifyWriteAuthorization(aprovacao_id, "publicar_dica_mestre", hash, chave_idempotencia, false, true, simulation, elicitApproval);
    if (dicaHash(getDicaSimulation(confirmacao_token)) !== hash) throw new Error("A simulação mudou durante a confirmação. Simule novamente.");
    await validateDicaFiles(simulation.conteudo);
    const claim = await claimIdempotency("publicar_dica_mestre", chave_idempotencia, hash);
    if (!claim.claimed) {
      if (claim.record.status === "success") return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
      throw new Error(`A publicação está em estado ${claim.record.status}. Consulte Minhas Inscrições e não repita o envio automaticamente.`);
    }
    await consumeWriteAuthorization(aprovacao_id, "publicar_dica_mestre", hash, chave_idempotencia);
    let lastProgress: unknown = { etapa: "execucao_iniciada" };
    try {
      const submitted = await apf.masterTipEndpoint().publish(simulation, async progress => { lastProgress = progress; await recordDicaAudit(chave_idempotencia, simulation, "progresso", progress); });
      const audit = await finalizeSuccessfulAudit("publicar_dica_mestre", chave_idempotencia, hash, submitted, () => recordDicaAudit(chave_idempotencia, simulation, "sucesso", submitted));
      consumeDicaSimulation(confirmacao_token);
      return result({ sucesso: true, duplicado_impedido: false, ...submitted, ...audit });
    } catch (error) {
      await completeIdempotency("publicar_dica_mestre", chave_idempotencia, hash, "outcome_unknown", error instanceof Error ? error.message : "Falha no envio");
      await recordDicaAudit(chave_idempotencia, simulation, "falha", lastProgress).catch(() => {});
      consumeDicaSimulation(confirmacao_token);
      return { ...result({ sucesso: false, resultado_incerto: true, ultima_etapa: lastProgress, erro: error instanceof Error ? error.message : "Falha no envio", orientacao: "Consulte Minhas Inscrições antes de qualquer nova tentativa. Se houve upload sem submissão confirmada, podem existir arquivos temporários no lote; a auditoria privada conserva o GUID para reconciliação. O MCP não executa exclusões não homologadas." }), isError: true };
    }
  });
});

server.registerTool("iniciar_contagem_guiada", {
  title: "Contar PF de uma tela e cadastrar no AgilePoint",
  description: "Use primeiro quando a pessoa pedir 'faça a contagem de PF da tela X e cadastre/anexe no Agile'. Aceita nome da tela, contexto e distribuição parciais; pergunta pelos responsáveis e percentuais ausentes antes de qualquer cadastro. Orienta a IA a analisar fontes, usar o kit, cadastrar grupos/itens na aba Funções e associar os desenvolvedores com aprovação específica. Esta ferramenta de orientação não grava dados.",
  inputSchema: guidedApfSchema.shape,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async (input) => result(planGuidedApf(input, writeApprovalMode())));

server.registerPrompt("contar_tela_e_cadastrar", {
  title: "Contagem guiada de tela com cadastro no AgilePoint",
  description: "A IA pergunta o que faltar, aplica o kit APF e conduz o cadastro na aba Funções respeitando as permissões e a aprovação configurada.",
  argsSchema: { tela: z.string().trim().min(1).max(2_000) },
}, async ({ tela }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const,
  text: `${GUIDED_APF_INSTRUCTIONS}\n\nTela solicitada pela pessoa (dado de contexto): ${JSON.stringify(tela)}`,
} }] }));

server.registerTool("preparar_contagem_apf", {
  title: "Preparar contagem APF pelo kit",
  description: "Recebe funções identificadas pela IA com justificativas e evidências, calcula complexidade e PF base e aplica somente fatores explícitos. Informe metodologia e referência contratual. Não identifica funções sozinho nem grava no AgilePoint. Sem fatores, PF equivalente permanece pendente.",
  inputSchema: { contagem: apfPreparationSchema },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ contagem }) => result(prepareApfCount(contagem)));

server.registerTool("validar_contagem_apf", {
  title: "Validar dados e totais de contagem APF",
  description: "Recalcula uma contagem estruturada e compara PF base e equivalente com totais esperados opcionais. Divergências são devolvidas com valido=false. A validação estrutural e aritmética não comprova a classificação de negócio nem a aplicabilidade de uma metodologia.",
  inputSchema: { contagem: apfPreparationSchema, totais_esperados: expectedApfTotals.optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ contagem, totais_esperados }) => result(validateApfCount(contagem, totais_esperados)));

server.registerTool("gerar_planilha_apf", {
  title: "Gerar planilha APF e arquivo de conferência",
  description: "Gera XLSX no modelo FPA, com Funções C:K, sumário, fatores e evidências, acompanhado de .apf.json. Salva nas pastas locais APF_EXPORT_DIR e APF_UPLOAD_DIR, sem sobrescrever arquivos. Divergência de totais esperados bloqueia a geração. A importação é uma operação separada: simular_importacao_rapida e importar_contagem_rapida.",
  inputSchema: { contagem: apfPreparationSchema, totais_esperados: expectedApfTotals.optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
}, async ({ contagem, totais_esperados }) => {
  const validation = validateApfCount(contagem, totais_esperados);
  if (!validation.valido || !validation.contagem) return result({ ...validation, arquivos_gerados: false });
  return result(await saveApfArtifacts(validation.contagem));
});

server.registerTool(
  "autenticar_agilepoint",
  {
    title: "Autenticar no AgilePoint nesta conversa",
    description: "Recebe usuário e senha fornecidos à IA, autentica a conta no AgilePoint e mantém a sessão apenas na memória deste processo MCP. Não devolve a senha. Atenção: o cliente de IA pode registrar o texto da conversa e os argumentos da ferramenta; use somente um cliente aprovado pela organização.",
    inputSchema: {
      usuario: z.string().trim().min(1).max(150),
      senha: z.string().min(1).max(1024),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ usuario, senha }) => apf.serialized(async () => {
    const screens = await apf.authenticateFromChat(usuario, senha);
    const role = inferRoleFromMenu(screens.map((screen) => screen.formulario_id ?? ""));
    activateChatActor(usuario, role);
    if (process.env.APF_WRITE_ENABLED === undefined) process.env.APF_WRITE_ENABLED = "true";
    return result({
      autenticado: true,
      perfil_local_inferido: role,
      telas_no_menu: screens.length,
      identidade_auditoria: "login_autenticado",
      credenciais_persistidas_pelo_mcp: false,
      aprovacao_escrita: writeApprovalMode(),
      aviso: "A permissão de cada tela continua sendo verificada no AgilePoint. A senha não é devolvida pelo MCP, mas pode permanecer no histórico do cliente de IA.",
    });
  }),
);

server.registerTool(
  "ranking_apf",
  {
    title: "Consultar Ranking de APF",
    description: "Consulta o ranking de pontos de função com identificadores estáveis, auditoria do fator e garantia explícita de completude.",
    inputSchema: {
      data_referencia: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
      tipo_analise: z.enum(["diario", "mensal"]).default("mensal"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ data_referencia, tipo_analise }) => apf.serialized(async () => {
    const endpoint = await apf.rankingApfHttp(data_referencia, tipo_analise);
    const ranking = mapRankingApfRows(endpoint.rows);
    return result({
      metadados: {
        consultado_em: new Date().toISOString(),
        periodo_efetivo: { data_referencia: endpoint.effectiveDate, tipo_analise: endpoint.analysisType },
        fonte: { ...source("7153", "1026496"), versao_contrato: "captured-live-2026-09-28" },
        paginacao: {
          pagina: 1,
          paginas_consultadas: endpoint.pagination.pages,
          linhas_retornadas: endpoint.pagination.rows,
          completo: endpoint.pagination.complete,
          possui_proxima_pagina: endpoint.pagination.hasNextPage,
        },
        transporte_dados: "endpoint_interno",
        endpoints: ["/openform.do", "/executeRule.do", "/navigate.do"],
      },
      ranking,
      limitacoes: [
        "A grade agregada não expõe o ID original de aplicação, sprint ou colaborador; os IDs correspondentes são determinísticos e derivados dos nomes.",
        "O tipo de atividade não é exposto por esta grade.",
        "O fator aplicado é auditado pela razão entre PF equivalente e PF gerado do agregado.",
      ],
    });
  }),
);

server.registerTool(
  "ranking_repositorio",
  {
    title: "Consultar Ranking do repositório",
    description: "Consulta publicações por período e categoria, incluindo IDs, categoria, data e métricas disponíveis.",
    inputSchema: {
      data_inicial: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
      data_final: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
      categorias: z.array(z.enum(["Fluxo", "Dica de Mestre"])).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ data_inicial, data_final, categorias }) => apf.serialized(async () => {
    const requestedCategories: Array<"Fluxo" | "Dica de Mestre"> = categorias?.length
      ? [...new Set(categorias)]
      : ["Fluxo", "Dica de Mestre"];
    const endpoint = await apf.rankingRepositoryHttp({
      startDate: data_inicial,
      endDate: data_final,
      categories: requestedCategories,
    });
    const rawRanking = mapRankingRepositorioRaw(endpoint.rows);
    const catalog = endpoint.catalog;
    const { details, unavailable } = await loadAvailableFunctionalityDetails(
      rawRanking,
      catalog,
      (id) => apf.functionalityDetails(id),
    );
    const ranking = enrichRankingRepositorio(rawRanking, catalog, details);

    return result({
      metadados: {
        consultado_em: new Date().toISOString(),
        periodo_efetivo: endpoint.effectivePeriod,
        fonte: { ...source("9127", "1135890"), versao_contrato: "captured-live-2026-09-28" },
        paginacao: {
          pagina: 1,
          paginas_consultadas: endpoint.pagination.pages,
          linhas_retornadas: endpoint.pagination.rows,
          completo: endpoint.pagination.complete,
          possui_proxima_pagina: endpoint.pagination.hasNextPage,
        },
        transporte_dados: "endpoint_interno",
        endpoints: ["/openform.do", "/executeRule.do", "/navigate.do"],
      },
      ranking,
      limitacoes: [
        "Aprovação do CTO, quantidade de 'Eu não sabia disso', indicação de instrutor e percentual de aprovação do Tech Pulse não são expostos pelas telas/regras consultáveis desta fonte; esses campos são retornados como null.",
        "A nota e a ordem das linhas são calculadas pela regra interna do AgilePoint. O MCP não expõe a fórmula nem um critério de desempate; a posição é apenas a ordem recebida da grade.",
        ...unavailable.map((item) =>
          `Os detalhes do conteúdo ${item.id} (${item.titulo}) não puderam ser abertos; a linha do ranking foi preservada com os dados disponíveis no catálogo.`
        ),
      ],
    });
  }),
);

server.registerTool(
  "listar_contagens",
  {
    title: "Listar Contagens",
    description: "Localiza contagens e informa explicitamente se a página retornada cobre todo o resultado.",
    inputSchema: {
      versao: z.string().optional(),
      data_criacao: z.string().optional(),
      aplicacao: z.string().optional(),
      tipo: z.string().optional(),
      situacao: z.enum(["Aberta", "Fechada"]).optional(),
      limite: z.number().int().min(1).max(100).default(50),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ versao, data_criacao, aplicacao, tipo, situacao, limite }) => apf.serialized(async () => {
    const query = await apf.queryCountsHttp({ versao, data_criacao, aplicacao, tipo, situacao }, limite);
    const endpointResult = extractContagensHtml(query.html, limite);
    const contagens = endpointResult.contagens;
    const identities = query.identities;
    for (let index = 0; index < contagens.length; index += 1) {
      const identity = identities[index];
      if (!identity) continue;
      contagens[index].contagem_id_origem = identity.recordId;
      contagens[index].contagem_id = `apf:contagem:${identity.recordId}`;
      if (identity.applicationId) {
        contagens[index].aplicacao_id_origem = identity.applicationId;
        contagens[index].aplicacao_id = `apf:aplicacao:${identity.applicationId}`;
      }
    }
    const nextVisible = endpointResult.possuiProximaPagina;
    return result({
      metadados: {
        consultado_em: new Date().toISOString(),
        periodo_efetivo: { versao, data_criacao, aplicacao, tipo, situacao },
        fonte: { ...source("26", "basic_query"), transporte_dados: "endpoint_interno", endpoint: "/navigate.do" },
        paginacao: {
          pagina: 1,
          linhas_retornadas: contagens.length,
          completo: !nextVisible && contagens.length <= limite,
          possui_proxima_pagina: nextVisible,
        },
      },
      contagens,
    });
  }),
);

server.registerTool(
  "verificar_conexao",
  {
    title: "Verificar conexão com AgilePoint",
    description: "Valida autenticação, versão e acesso aos formulários sem retornar registros ou credenciais.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => {
    const startedAt = Date.now();
    const { connected, authenticated, checks, version } = await apf.verifyHttpConnection(["7153", "9127", "500000385", "26"]);
    return result({
      conectado: connected,
      transporte: "http_endpoint",
      autenticado: authenticated,
      identidade_lancamento_configurada: Boolean(currentActor().colaborador_id),
      autorizacao_escrita: {
        gravacao_habilitada: process.env.APF_WRITE_ENABLED === "true",
        modo_comum: writeApprovalMode(),
        modo_destrutivo: writeApprovalMode(true),
        confirmacao_interativa: {
          cliente_suporta_formulario: Boolean(server.server.getClientCapabilities()?.elicitation?.form),
          cliente_confiavel_declarado: process.env.APF_TRUSTED_CLIENT_ELICITATION === "true",
          aviso: "A capacidade declarada pelo cliente não comprova que uma pessoa, e não o agente, responderá à confirmação.",
        },
      },
      formularios: checks,
      versao_webrun: version,
      versao_extrator: EXTRACTOR_VERSION,
      latencia_ms: Date.now() - startedAt,
      consultado_em: new Date().toISOString(),
      fonte: { sistema: "AgilePoint APF", base_url: apf.sourceBaseUrl },
    });
  }),
);

server.registerTool(
  "listar_funcoes_contagem",
  {
    title: "Listar funções de uma contagem",
    description: "Localiza uma contagem de forma exata e retorna as funções com os IDs primários expostos pelo endpoint interno do Webrun.",
    inputSchema: {
      contagem_id: z.string().regex(/^\d+$/).optional(),
      aplicacao: z.string().trim().min(1).optional(),
      versao: z.string().trim().min(1).optional(),
      situacao: z.enum(["Aberta", "Fechada"]).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ contagem_id, aplicacao, versao, situacao }) => apf.serialized(async () => {
    if (contagem_id) {
      const endpoint = await apf.countFunctionsById(contagem_id);
      const functions = mapCountFunctions(endpoint.functions, endpoint.count.recordId);
      return result({
        metadados: {
          consultado_em: new Date().toISOString(),
          periodo_efetivo: { contagem_id },
          fonte: { ...source("26", "505"), transporte_dados: "endpoint_interno", endpoints: ["/openform.do", "/navigate.do"] },
          paginacao: { pagina: 1, linhas_retornadas: functions.length, completo: true, possui_proxima_pagina: false },
        },
        contagem: {
          contagem_id: `apf:contagem:${endpoint.count.recordId}`,
          contagem_id_origem: endpoint.count.recordId,
          aplicacao: endpoint.count.application,
          versao: endpoint.count.version,
          situacao: endpoint.count.closed ? "Fechada" : "Aberta",
        },
        funcoes: functions,
      });
    }
    if (!aplicacao || !versao) throw new Error("Informe contagem_id ou, alternativamente, aplicacao e versao.");
    const query = await apf.queryCountsHttp({ versao, aplicacao, situacao }, 2);
    const matches = extractContagensHtml(query.html, 2);
    if (matches.contagens.length !== 1 || matches.possuiProximaPagina) {
      throw new Error(`A consulta deve identificar exatamente uma contagem; foram encontrados ${matches.contagens.length}${matches.possuiProximaPagina ? " ou mais" : ""}.`);
    }
    const identity = query.identities[0];
    if (!identity) throw new Error("O AgilePoint não retornou o ID da contagem localizada.");
    const endpoint = await apf.countFunctionsById(identity.recordId);
    const functions = mapCountFunctions(endpoint.functions, identity.recordId);
    return result({
      metadados: {
        consultado_em: new Date().toISOString(),
        periodo_efetivo: { aplicacao, versao, situacao: situacao ?? null },
        fonte: { ...source("26", "505"), transporte_dados: "endpoint_interno", endpoints: ["/navigate.do", "/form.do"] },
        paginacao: { pagina: 1, linhas_retornadas: functions.length, completo: true, possui_proxima_pagina: false },
      },
      contagem: {
        ...matches.contagens[0],
        contagem_id: `apf:contagem:${identity.recordId}`,
        contagem_id_origem: identity.recordId,
        aplicacao_id: identity.applicationId ? `apf:aplicacao:${identity.applicationId}` : matches.contagens[0].aplicacao_id,
        aplicacao_id_origem: identity.applicationId,
      },
      funcoes: functions,
    });
  }),
);

function mapCountFunctions(rows: Array<Record<string, unknown>>, countId: string) {
  return rows.map((row, index) => {
    const sourceId = Array.isArray(row._primary_keys) ? String(row._primary_keys[0] ?? "").trim() : "";
    const functionId = /^\d+$/.test(sourceId) ? `apf:funcao:${sourceId}` : `apf:funcao:${countId}:${index + 1}`;
    const items = Array.isArray(row._items) ? row._items as Array<Record<string, unknown>> : [];
    const contributions = Array.isArray(row._contributions) ? row._contributions as Array<Record<string, unknown>> : [];
    return {
      posicao: index + 1,
      funcao_id: functionId,
      funcao_id_origem: /^\d+$/.test(sourceId) ? sourceId : null,
      nome: String(row.field743 ?? "").trim(),
      revisada: String(row.field1135780 ?? "").toLowerCase() === "true",
      pf: row.field1135868 ?? null,
      itens: items.map((item, itemIndex) => {
        const description = String(item.field429 ?? "").trim();
        const sourceItemId = Array.isArray(item._primary_keys) ? String(item._primary_keys[0] ?? "").trim() : "";
        const pf = Number(String(item.field434 ?? "").replace(",", "."));
        const pfEquivalent = Number(String(item.field435 ?? "").replace(",", "."));
        return {
          item_id: /^\d+$/.test(sourceItemId) ? `apf:item:${sourceItemId}` : stableId("item", `${functionId}|${description}|${itemIndex}`),
          item_id_origem: /^\d+$/.test(sourceItemId) ? sourceItemId : null,
          descricao: description,
          tipo_funcao: String(item.field761 ?? "").trim() || null,
          tipo_atividade: String(item.field762 ?? "").trim() || null,
          fator_aplicado: Number.isFinite(pf) && pf > 0 && Number.isFinite(pfEquivalent) ? Number((pfEquivalent / pf).toFixed(6)) : null,
          td: item.field431 ?? null,
          ar_tr: item.field432 ?? null,
          complexidade: String(item.field433 ?? "").trim() || null,
          pf: item.field434 ?? null,
          pf_equivalente: item.field435 ?? null,
        };
      }),
      contribuicoes: contributions.map((contribution, contributionIndex) => {
        const collaborator = String(contribution.field1026478 ?? "").trim();
        const sourceContributionId = Array.isArray(contribution._primary_keys) ? String(contribution._primary_keys[0] ?? "").trim() : "";
        const foreignIds = contribution._foreign_ids && typeof contribution._foreign_ids === "object"
          ? contribution._foreign_ids as Record<string, unknown>
          : {};
        const sourceCollaboratorId = String(foreignIds.usuario ?? "").trim();
        return {
          contribuicao_id: /^\d+$/.test(sourceContributionId) ? `apf:contribuicao:${sourceContributionId}` : stableId("contribuicao", `${functionId}|${collaborator}|${contributionIndex}`),
          contribuicao_id_origem: /^\d+$/.test(sourceContributionId) ? sourceContributionId : null,
          colaborador: collaborator,
          colaborador_id: /^\d+$/.test(sourceCollaboratorId) ? `apf:colaborador:${sourceCollaboratorId}` : stableId("colaborador", collaborator),
          colaborador_id_origem: /^\d+$/.test(sourceCollaboratorId) ? sourceCollaboratorId : null,
          percentual: contribution.field806 ?? null,
        };
      }),
    };
  });
}

server.registerTool(
  "exportar_relatorio_contagem",
  {
    title: "Exportar relatório de uma contagem",
    description: "Valida o acesso à contagem e gera diretamente pelo endpoint interno um PDF, PDF analítico ou Excel.",
    inputSchema: {
      contagem_id: z.string().regex(/^\d+$/),
      formato: z.enum(["pdf", "analitico", "excel"]),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ contagem_id, formato }) => apf.serialized(async () => result({
    ...(await apf.exportCountReport(contagem_id, formato)),
    contagem_id: `apf:contagem:${contagem_id}`,
    contagem_id_origem: contagem_id,
    gerado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "exportar_relatorio_sprint",
  {
    title: "Exportar relatório de acompanhamento de sprint",
    description: "Seleciona uma opção exata de Aplicação na tela autorizada de Acompanhamento apf de Sprints e exporta o PDF validado para APF_EXPORT_DIR.",
    inputSchema: { aplicacao_sprint: z.string().trim().min(1).max(300) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ aplicacao_sprint }) => apf.serialized(async () => result({
    ...(await apf.exportSprintReport(aplicacao_sprint)),
    gerado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "exportar_relatorio_acompanhamento",
  {
    title: "Exportar relatório de acompanhamento",
    description: "Seleciona ano, mês e aplicação exatos na tela autorizada de Relatório de Acompanhamento e exporta o PDF validado para APF_EXPORT_DIR.",
    inputSchema: {
      ano: z.number().int().min(2000).max(2200),
      mes: z.number().int().min(1).max(12),
      aplicacao: z.string().trim().min(1).max(300),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ ano, mes, aplicacao }) => apf.serialized(async () => result({
    ...(await apf.exportTrackingReport(ano, mes, aplicacao)),
    gerado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "exportar_relatorio_premiacao",
  {
    title: "Exportar relatório de premiação",
    description: "Gera o PDF do relatório de premiação para um período válido, somente quando a tela estiver no menu da conta autenticada, e salva em APF_EXPORT_DIR.",
    inputSchema: {
      data_inicial: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
      data_final: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ data_inicial, data_final }) => apf.serialized(async () => result({
    ...(await apf.exportAwardsReport(data_inicial, data_final)),
    gerado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "resolver_identificadores",
  {
    title: "Resolver identificadores do AgilePoint",
    description: "Busca diretamente no lookup interno e retorna os IDs estáveis que a conta autenticada pode visualizar, sem abrir o seletor da tela.",
    inputSchema: {
      tipo: z.enum(["aplicacao", "tipo_contagem", "ano_competencia", "fator_equivalencia", "usuario_contribuicao", "desenvolvedor_aplicacao"]),
      consulta: z.string().trim().max(300).default(""),
      limite: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ tipo, consulta, limite }) => apf.serialized(async () => result({
    tipo,
    consulta,
    ...(await apf.lookupOptions(tipo, consulta, limite)),
    consultado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "verificar_diagnostico_rede",
  {
    title: "Verificar diagnóstico de rede",
    description: "Informa se a captura sanitizada de tráfego está habilitada, sem retornar credenciais, cookies ou conteúdo sensível.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => result({
    diagnostico: apf.discoveryStatus(),
    consultado_em: new Date().toISOString(),
    instrucoes: process.env.APF_DISCOVERY_MODE === "true"
      ? "Execute as operações de homologação que deseja mapear. O arquivo JSONL será atualizado durante a sessão."
      : "Defina APF_DISCOVERY_MODE=true e reinicie o processo MCP para iniciar a captura.",
  })),
);

server.registerTool(
  "analisar_diagnostico_rede",
  {
    title: "Analisar diagnóstico de rede",
    description: "Agrupa as chamadas sanitizadas capturadas e aponta possíveis webservices. A classificação é preliminar até ser validada em múltiplas sessões.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => result({
    ...(await apf.analyzeDiscovery()),
    diagnostico: apf.discoveryStatus(),
    analisado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "validar_endpoint_ranking_apf",
  {
    title: "Validar endpoint do ranking de APF",
    description: "Valida, sem retornar registros, o fluxo HTTP direto das regras e da grade do ranking de APF.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => result({
    validacao: await apf.validateRankingEndpoint(),
    consultado_em: new Date().toISOString(),
  })),
);

server.registerTool(
  "listar_telas_disponiveis",
  {
    title: "Listar telas disponíveis",
    description: "Lista por endpoint apenas telas visíveis e habilitadas no menu da conta autenticada, conforme o mapa de permissões atual. Não concede acesso adicional.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => result({
    telas: await apf.listAccessibleScreensHttp(),
    consultado_em: new Date().toISOString(),
    observacao: "A lista reflete o menu entregue pelo AgilePoint para esta conta.",
    transporte_dados: "endpoint_interno",
    endpoints: ["/openform.do", "/executeRule.do"],
  })),
);

server.registerTool(
  "descrever_tela",
  {
    title: "Descrever uma tela",
    description: "Abre por endpoint uma tela presente no menu do usuário e descreve campos, opções, ações, abas, tabelas e alertas publicados pelo Webrun.",
    inputSchema: { tela: z.string().trim().min(1).max(300) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ tela }) => apf.serialized(async () => result({
    ...(await apf.describeAccessibleScreenHttp(tela)),
    transporte_dados: "endpoint_interno",
    endpoints: ["/openform.do", "/executeRule.do"],
  })),
);

server.registerTool(
  "verificar_cobertura_telas",
  {
    title: "Verificar cobertura das telas autorizadas",
    description: "Inventaria, sem alterar dados, as ações com contrato direto, as cobertas por ferramenta especializada e as que ainda exigem homologação por formulário. Usa somente o menu da conta autenticada.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async () => apf.serialized(async () => {
    const screens = await apf.listAccessibleScreensHttp();
    const unique = new Map(screens.filter((screen) => /^\d+$/.test(screen.formulario_id ?? ""))
      .map((screen) => [screen.formulario_id, screen]));
    if (unique.size > 100) throw new Error("O menu contém mais de 100 formulários; o inventário foi interrompido.");
    const forms = [];
    for (const screen of unique.values()) {
      try {
        const detail = await apf.describeAccessibleScreenHttp(screen.ref);
        forms.push({
          formulario_id: detail.formulario_id,
          nome: screen.nome,
          acoes_com_contrato: detail.acoes.filter((action) => action.endpoint_disponivel)
            .map(({ ref, rotulo }) => ({ ref, rotulo })),
          acoes_especializadas: detail.acoes.filter((action) => action.ferramenta_especializada)
            .map(({ ref, rotulo, ferramenta_especializada }) => ({ ref, rotulo, ferramenta_especializada })),
          acoes_pendentes: detail.acoes.filter((action) => action.ref.startsWith("component:")
            && !action.desabilitado && !action.endpoint_disponivel && !action.ferramenta_especializada)
            .map(({ ref, rotulo }) => ({ ref, rotulo })),
          uploads_pendentes: detail.campos.filter((field) => field.tipo === "file" && !field.desabilitado && !field.endpoint_disponivel)
            .map(({ ref, rotulo }) => ({ ref, rotulo })),
        });
      } catch {
        forms.push({ formulario_id: screen.formulario_id, nome: screen.nome, erro: "descricao_indisponivel" });
      }
    }
    return result({ formularios: forms, formularios_no_menu: unique.size, consultado_em: new Date().toISOString(),
      observacao: "Ações pendentes permanecem bloqueadas. Ferramentas especializadas não habilitam o clique genérico." });
  }),
);

server.registerTool(
  "ler_tela",
  {
    title: "Ler dados de uma tela",
    description: "Lê por endpoint os valores e todas as páginas das grades de uma tela autorizada, informando explicitamente quando o limite interrompe a leitura.",
    inputSchema: {
      tela: z.string().trim().min(1).max(300),
      limite_linhas: z.number().int().min(1).max(5000).default(1000),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ tela, limite_linhas }) => apf.serialized(async () => result({
    ...(await apf.readAccessibleScreenHttp(tela, limite_linhas)),
    transporte_dados: "endpoint_interno",
    endpoints: ["/openform.do", "/executeRule.do", "/navigate.do"],
  })),
);

const universalOperationSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("preencher"), alvo: z.string().trim().min(1).max(300), valor: z.string().max(20_000) }),
  z.object({ tipo: z.literal("selecionar"), alvo: z.string().trim().min(1).max(300), valor: z.string().max(2_000) }),
  z.object({ tipo: z.literal("marcar"), alvo: z.string().trim().min(1).max(300), valor: z.boolean() }),
  z.object({ tipo: z.literal("clicar"), alvo: z.string().trim().min(1).max(300) }),
  z.object({ tipo: z.literal("anexar"), alvo: z.string().trim().min(1).max(300), caminho: z.string().trim().min(1).max(2000) }),
  z.object({ tipo: z.literal("baixar"), alvo: z.string().trim().min(1).max(300) }),
]);

server.registerTool(
  "simular_operacao_tela",
  {
    title: "Simular operação em tela",
    description: "Valida por endpoint, sem executar, uma sequência de preenchimentos, seleções, marcações, anexos e cliques em uma tela disponível ao usuário.",
    inputSchema: {
      tela: z.string().trim().min(1).max(300),
      registro_id: z.string().regex(/^\d+$/).optional(),
      titulo_esperado: z.string().trim().min(1).max(500).optional(),
      operacoes: z.array(universalOperationSchema).min(1).max(100),
      justificativa: z.string().trim().max(1000).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    const validated = await apf.serialized(() => apf.validateScreenOperationsHttp(input));
    const preview = createUiSimulation(input, validated.alvos, validated.tela, validated.contratos_acoes);
    const approval = await createWriteAuthorization("executar_operacao_tela", uiHash(preview.simulacao), preview.simulacao, preview.simulacao.destrutiva);
    return result({
      ...preview,
      aprovacao: approval,
      tela_atual: validated.tela,
      validacoes: validated.validacoes,
      transporte_dados: "endpoint_interno",
      endpoints: ["/openform.do", "/executeRule.do", "/upload.jsp", "/download"],
    });
  },
);

server.registerTool(
  "executar_operacao_tela",
  {
    title: "Executar operação em tela",
    description: "Executa por endpoint inclusão, alteração, exclusão, botões autorizados e uploads multipart publicados pelo Webrun, vinculando os contratos à simulação.",
    inputSchema: {
      confirmacao_token: z.string().uuid(),
      chave_idempotencia: z.string().trim().min(8).max(200),
      aprovacao_id: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
    requireRole(["leitura", "desenvolvedor", "gerente", "administrador"], "executar_operacao_tela");
    return apf.serialized(async () => {
      const simulation = consumeUiSimulation(confirmacao_token);
      const existing = await findSuccessfulUiOperation(chave_idempotencia);
      if (existing) {
        if (existing.payload_hash !== uiHash(simulation)) throw new Error("A chave de idempotência já foi usada com outra operação.");
        markUiSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: true, resultado: existing.resultado, ocorrido_em: existing.ocorrido_em });
      }
      const payloadHash = uiHash(simulation);
      await verifyWriteAuthorization(aprovacao_id, "executar_operacao_tela", payloadHash, chave_idempotencia, simulation.destrutiva, simulation.operacoes.some((operation) => operation.tipo !== "baixar"), simulation, elicitApproval);
      if (uiHash(consumeUiSimulation(confirmacao_token)) !== payloadHash) throw new Error("A simulação mudou durante a confirmação; simule novamente.");
      const claim = await claimIdempotency("executar_operacao_tela", chave_idempotencia, payloadHash);
      if (!claim.claimed) {
        if (claim.record.status === "success") {
          markUiSimulationConsumed(confirmacao_token);
          return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
        }
        throw new Error(`A chave de idempotência já está registrada com estado ${claim.record.status}; a execução automática foi bloqueada para evitar duplicidade.`);
      }
      await consumeWriteAuthorization(aprovacao_id, "executar_operacao_tela", payloadHash, chave_idempotencia, simulation.destrutiva);
      try {
        const executed = await apf.executeScreenOperationsHttp(simulation);
        const auditResult = {
          operacoes_executadas: executed.operacoes_executadas,
          tela: { nome: executed.tela.nome, formulario_id: executed.tela.formulario_id },
          alertas: executed.alertas,
          downloads: executed.downloads,
        };
        const audit = await finalizeSuccessfulAudit(
          "executar_operacao_tela", chave_idempotencia, payloadHash, auditResult,
          () => recordUiAudit(chave_idempotencia, simulation, { status: "sucesso", resultado: auditResult }),
        );
        markUiSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: false, ...executed, ...audit });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida na operação universal.";
        await completeIdempotency("executar_operacao_tela", chave_idempotencia, payloadHash, "outcome_unknown", message);
        await recordUiAudit(chave_idempotencia, simulation, { status: "falha", erro: message });
        throw error;
      }
    });
  },
);

server.registerTool(
  "simular_importacao_rapida",
  {
    title: "Simular importação rápida de contagem",
    description: "Lê a aba Funções de uma planilha XLSX no APF_UPLOAD_DIR, extrai C:K abaixo do cabeçalho do modelo e mostra uma prévia sem gravar.",
    inputSchema: {
      contagem_id: z.string().regex(/^\d+$/),
      caminho_planilha: z.string().trim().min(1),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ contagem_id, caminho_planilha }) => {
    requireRole(["desenvolvedor", "administrador"], "simular_importacao_rapida");
    return apf.serialized(async () => {
      const count = await apf.countFunctionSummaryById(contagem_id);
      if (count.count.closed) throw new Error("A contagem está fechada; não é possível importar funções.");
      const workbook = await readQuickImportWorkbook(caminho_planilha);
      if (workbook.kit_apf) {
        const conventions = await apf.countActivityConventionsById(contagem_id);
        assertApfImportTarget(workbook.kit_apf, conventions.count, conventions.conventions);
      }
      const simulation = createQuickImportSimulation(contagem_id, caminho_planilha, workbook);
      const approval = await createWriteAuthorization("importar_contagem_rapida", quickImportHash(simulation.simulacao), simulation.simulacao);
      return result({
        ...simulation,
        contagem: count.count,
        planilha: {
          nome: workbook.arquivo,
          sha256: workbook.sha256,
          aba: workbook.aba,
          intervalo: workbook.intervalo,
          linhas_com_dados: workbook.linhas_com_dados,
          linhas_separadoras: workbook.linhas_separadoras,
          grupos: simulation.simulacao.grupos,
          itens: simulation.simulacao.itens,
          amostra: workbook.linhas.filter((row) => row.descricao).slice(0, 10),
          ...(workbook.kit_apf ? { kit_apf: workbook.kit_apf } : {}),
        },
        aprovacao: approval,
        aviso: "Prévia somente. Confira a contagem e a planilha antes de executar; a importação adiciona funções.",
      });
    });
  },
);

server.registerTool(
  "importar_contagem_rapida",
  {
    title: "Importar contagem rapidamente",
    description: "Executa pelo endpoint interno a mesma regra do botão Inserir Tabela do formulário Função - excel, com idempotência e verificação da grade.",
    inputSchema: {
      confirmacao_token: z.string().uuid(),
      chave_idempotencia: z.string().trim().min(8).max(200),
      aprovacao_id: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
    requireRole(["desenvolvedor", "administrador"], "importar_contagem_rapida");
    return apf.serialized(async () => {
      const simulation = consumeQuickImportSimulation(confirmacao_token);
      const payloadHash = quickImportHash(simulation);
      await verifyWriteAuthorization(aprovacao_id, "importar_contagem_rapida", payloadHash, chave_idempotencia, false, true, simulation, elicitApproval);
      if (quickImportHash(consumeQuickImportSimulation(confirmacao_token)) !== payloadHash) throw new Error("A simulação mudou durante a confirmação; simule novamente.");
      const workbook = await readQuickImportWorkbook(simulation.caminho_planilha);
      if (workbook.sha256 !== simulation.sha256 || workbook.intervalo !== simulation.intervalo) {
        throw new Error("A planilha mudou desde a simulação. Simule novamente.");
      }
      if (JSON.stringify(workbook.kit_apf) !== JSON.stringify(simulation.kit_apf)) {
        throw new Error("A conferência do kit mudou desde a simulação. Simule novamente.");
      }
      if (workbook.kit_apf) {
        const conventions = await apf.countActivityConventionsById(simulation.contagem_id);
        assertApfImportTarget(workbook.kit_apf, conventions.count, conventions.conventions);
      }
      const claim = await claimIdempotency("importar_contagem_rapida", chave_idempotencia, payloadHash);
      if (!claim.claimed) {
        if (claim.record.status === "success") {
          markQuickImportSimulationConsumed(confirmacao_token);
          return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
        }
        throw new Error(`A chave de idempotência está em estado ${claim.record.status}; verifique a contagem antes de repetir.`);
      }
      await consumeWriteAuthorization(aprovacao_id, "importar_contagem_rapida", payloadHash, chave_idempotencia);
      try {
        const imported = await apf.importQuickCountTable(
          simulation.contagem_id, workbook.tabela_webrun, workbook.tabela_html, simulation.grupos, simulation.itens,
        );
        const audit = await finalizeSuccessfulAudit(
          "importar_contagem_rapida", chave_idempotencia, payloadHash, imported,
          () => recordQuickImportAudit(chave_idempotencia, simulation, "sucesso", imported),
        );
        markQuickImportSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: false, ...imported, ...audit });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida na importação rápida.";
        await completeIdempotency("importar_contagem_rapida", chave_idempotencia, payloadHash, "outcome_unknown", message);
        await recordQuickImportAudit(chave_idempotencia, simulation, "falha", { erro: message });
        throw error;
      }
    });
  },
);

server.registerTool(
  "consultar_fatores_contagem",
  {
    title: "Consultar fatores de atividade da contagem",
    description: "Lê as convenções de atividade e seus fatores publicadas pelo formulário 26 para uma contagem acessível ao usuário autenticado.",
    inputSchema: { contagem_id: z.string().regex(/^\d+$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ contagem_id }) => apf.serialized(async () => {
    const published = await apf.countActivityConventionsById(contagem_id);
    return result({
      contagem: published.count,
      fatores: published.conventions,
      fonte: source("26", "1895236190"),
      consultado_em: new Date().toISOString(),
    });
  }),
);

server.registerTool(
  "simular_lancamento_pf",
  {
    title: "Simular lançamento de pontos de função",
    description: "Valida uma contagem nova ou existente, calcula o PF equivalente e gera uma prévia sem alterar o AgilePoint. Antes da gravação, o fator informado será conferido com a convenção publicada pelo formulário; consulte consultar_fatores_contagem para contagens existentes.",
    inputSchema: {
      contagem: z.object({
        acao: z.enum(["usar_existente", "criar"]),
        aplicacao: z.string().trim().min(1).max(300),
        versao_sprint: z.string().trim().min(1).max(20),
        tipo_contagem: z.string().trim().min(1).max(100).optional(),
        situacao: z.enum(["Aberta", "Fechada"]).default("Aberta"),
        criada_em: z.string().trim().max(30).optional(),
        mes_competencia: z.number().int().min(1).max(12).optional(),
        ano_competencia: z.number().int().min(2000).max(2200).optional(),
        fator_equivalencia: z.string().trim().min(1).max(100).optional(),
        proposito: z.string().trim().max(4000).optional(),
        escopo: z.string().trim().max(4000).optional(),
      }),
      funcoes: z.array(z.object({
        nome: z.string().trim().min(2).max(300),
        itens: z.array(z.object({
          descricao: z.string().trim().min(1).max(1000),
          tipo: z.enum(["ALI", "AIE", "EE", "SE", "CE"]),
          atividade: z.enum(["I", "A", "E", "T", "AV", "MI", "AD", "MA", "AP"]),
          td: z.number().int().min(0),
          ar_tr: z.number().int().min(0),
          complexidade: z.enum(["Baixa", "Média", "Alta"]),
          pf: z.number().positive(),
          fator_aplicado: z.number().positive(),
        })).min(1).max(500),
      })).min(1).max(100),
      referencia_externa: z.string().trim().max(300).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    requireRole(["desenvolvedor", "administrador"], "simular_lancamento_pf");
    const preview = createPointSimulation(input);
    const approval = await createWriteAuthorization("lancar_pontos_funcao", pointHash(preview.simulacao), preview.simulacao);
    return result({ ...preview, aprovacao: approval });
  },
);

server.registerTool(
  "lancar_pontos_funcao",
  {
    title: "Lançar pontos de função",
    description: "Grava no formulário 26 a contagem, as funções e os itens de uma simulação usando endpoints internos. Exige chave de idempotência; a aprovação externa depende do modo configurado.",
    inputSchema: {
      confirmacao_token: z.string().uuid(),
      chave_idempotencia: z.string().trim().min(8).max(200),
      aprovacao_id: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
    requireRole(["desenvolvedor", "administrador"], "lancar_pontos_funcao");
    return apf.serialized(async () => {
      const simulation = consumePointSimulation(confirmacao_token);
      const existing = await findSuccessfulPointLaunch(chave_idempotencia);
      if (existing) {
        if (existing.payload_hash !== pointHash(simulation)) throw new Error("A chave de idempotência já foi usada com outro lançamento.");
        markPointSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: true, resultado: existing.resultado, ocorrido_em: existing.ocorrido_em });
      }
      const payloadHash = pointHash(simulation);
      await verifyWriteAuthorization(aprovacao_id, "lancar_pontos_funcao", payloadHash, chave_idempotencia, false, true, simulation, elicitApproval);
      if (pointHash(consumePointSimulation(confirmacao_token)) !== payloadHash) throw new Error("A simulação mudou durante a confirmação; simule novamente.");
      const claim = await claimIdempotency("lancar_pontos_funcao", chave_idempotencia, payloadHash);
      if (!claim.claimed) {
        if (claim.record.status === "success") {
          markPointSimulationConsumed(confirmacao_token);
          return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
        }
        throw new Error(`A chave de idempotência já está registrada com estado ${claim.record.status}; o lançamento foi bloqueado para evitar duplicidade.`);
      }
      await consumeWriteAuthorization(aprovacao_id, "lancar_pontos_funcao", payloadHash, chave_idempotencia);
      try {
        const submitted = await apf.submitPointFunctions(simulation);
        const audit = await finalizeSuccessfulAudit(
          "lancar_pontos_funcao", chave_idempotencia, payloadHash, submitted,
          () => recordPointAudit(chave_idempotencia, simulation, {
            status: "sucesso", lancamento_id: submitted.lancamento_id, resultado: submitted,
          }),
        );
        markPointSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: false, ...submitted, ...audit });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida ao lançar pontos de função.";
        await completeIdempotency("lancar_pontos_funcao", chave_idempotencia, payloadHash, "outcome_unknown", message);
        await recordPointAudit(chave_idempotencia, simulation, { status: "falha", erro: message });
        throw error;
      }
    });
  },
);

server.registerTool(
  "consultar_meus_lancamentos",
  {
    title: "Consultar meus lançamentos",
    description: "Consulta a auditoria local dos lançamentos feitos por este MCP. Desenvolvedores veem apenas sua própria identidade configurada.",
    inputSchema: { limite: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ limite }) => {
    requireRole(["desenvolvedor", "administrador"], "consultar_meus_lancamentos");
    return result({ lancamentos: await listOwnPointAudit(limite), consultado_em: new Date().toISOString() });
  },
);

server.registerTool(
  "simular_associacao_usuarios_funcoes",
  {
    title: "Simular associação de usuários às funções",
    description: "Valida uma associação em lote para todas as funções ou para uma lista de nomes, sem alterar o AgilePoint. Os percentuais devem somar 100%.",
    inputSchema: {
      contagem: z.object({
        aplicacao: z.string().trim().min(1).max(300),
        versao_sprint: z.string().trim().min(1).max(100),
        tipo_contagem: z.string().trim().min(1).max(100).optional(),
        situacao: z.enum(["Aberta", "Fechada"]).default("Aberta"),
        criada_em: z.string().trim().max(30).optional(),
      }),
      funcoes: z.array(z.string().trim().min(2).max(300)).min(1).max(100).optional(),
      usuarios: z.array(z.object({
        usuario: z.string().trim().min(2).max(300),
        percentual: z.number().int().min(1).max(100),
      })).min(1).max(20),
      modo: z.literal("substituir").default("substituir"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    requireRole(["desenvolvedor", "administrador"], "simular_associacao_usuarios_funcoes");
    const preview = createAssociationSimulation(input);
    const approval = await createWriteAuthorization("associar_usuarios_funcoes", associationHash(preview.simulacao), preview.simulacao, true);
    return result({ ...preview, aprovacao: approval });
  },
);

server.registerTool(
  "associar_usuarios_funcoes",
  {
    title: "Associar usuários às funções",
    description: "Substitui em lote as associações atuais das funções selecionadas e grava usuário/percentual na grade de contribuição. Exige token, aprovação humana externa e idempotência.",
    inputSchema: {
      confirmacao_token: z.string().uuid(),
      chave_idempotencia: z.string().trim().min(8).max(200),
      aprovacao_id: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
    requireRole(["desenvolvedor", "administrador"], "associar_usuarios_funcoes");
    return apf.serialized(async () => {
      const simulation = consumeAssociationSimulation(confirmacao_token);
      const existing = await findSuccessfulAssociation(chave_idempotencia);
      if (existing) {
        if (existing.payload_hash !== associationHash(simulation)) throw new Error("A chave de idempotência já foi usada com outra associação.");
        markAssociationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: true, resultado: existing.resultado, ocorrido_em: existing.ocorrido_em });
      }
      const payloadHash = associationHash(simulation);
      await verifyWriteAuthorization(aprovacao_id, "associar_usuarios_funcoes", payloadHash, chave_idempotencia, true, true, simulation, elicitApproval);
      if (associationHash(consumeAssociationSimulation(confirmacao_token)) !== payloadHash) throw new Error("A simulação mudou durante a confirmação; simule novamente.");
      const claim = await claimIdempotency("associar_usuarios_funcoes", chave_idempotencia, payloadHash);
      if (!claim.claimed) {
        if (claim.record.status === "success") {
          markAssociationConsumed(confirmacao_token);
          return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
        }
        throw new Error(`A chave de idempotência já está registrada com estado ${claim.record.status}; a associação foi bloqueada para evitar duplicidade.`);
      }
      await consumeWriteAuthorization(aprovacao_id, "associar_usuarios_funcoes", payloadHash, chave_idempotencia, true);
      try {
        const submitted = await apf.associateFunctionUsers(simulation);
        const audit = await finalizeSuccessfulAudit(
          "associar_usuarios_funcoes", chave_idempotencia, payloadHash, submitted,
          () => recordAssociationAudit(chave_idempotencia, simulation, { status: "sucesso", resultado: submitted }),
        );
        markAssociationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: false, ...submitted, ...audit });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida ao associar usuários.";
        await completeIdempotency("associar_usuarios_funcoes", chave_idempotencia, payloadHash, "outcome_unknown", message);
        await recordAssociationAudit(chave_idempotencia, simulation, { status: "falha", erro: message });
        throw error;
      }
    });
  },
);

server.registerTool(
  "simular_associacao_desenvolvedores_aplicacao",
  {
    title: "Simular associação de desenvolvedores à aplicação",
    description: "Resolve a aplicação e valida uma lista de desenvolvedores sem alterar o AgilePoint. A execução posterior adiciona somente os ausentes.",
    inputSchema: {
      aplicacao: z.string().trim().min(1).max(300),
      desenvolvedores: z.array(z.string().trim().min(2).max(300)).min(1).max(200),
      modo: z.literal("adicionar").default("adicionar"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async (input) => {
    requireRole(["gerente", "administrador"], "simular_associacao_desenvolvedores_aplicacao");
    const preview = createApplicationDeveloperSimulation(input);
    const approval = await createWriteAuthorization("associar_desenvolvedores_aplicacao", applicationDeveloperHash(preview.simulacao), preview.simulacao);
    return result({ ...preview, aprovacao: approval });
  },
);

server.registerTool(
  "associar_desenvolvedores_aplicacao",
  {
    title: "Associar desenvolvedores à aplicação",
    description: "Adiciona por endpoint os desenvolvedores ausentes na grade da aplicação. Exige simulação, aprovação humana externa e chave de idempotência.",
    inputSchema: {
      confirmacao_token: z.string().uuid(),
      chave_idempotencia: z.string().trim().min(8).max(200),
      aprovacao_id: z.string().uuid().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  async ({ confirmacao_token, chave_idempotencia, aprovacao_id }) => {
    requireRole(["gerente", "administrador"], "associar_desenvolvedores_aplicacao");
    return apf.serialized(async () => {
      const simulation = consumeApplicationDeveloperSimulation(confirmacao_token);
      const existing = await findSuccessfulApplicationDeveloperAssociation(chave_idempotencia);
      if (existing) {
        if (existing.payload_hash !== applicationDeveloperHash(simulation)) {
          throw new Error("A chave de idempotência já foi usada com outra associação de desenvolvedores.");
        }
        markApplicationDeveloperSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: true, resultado: existing.resultado, ocorrido_em: existing.ocorrido_em });
      }
      const payloadHash = applicationDeveloperHash(simulation);
      await verifyWriteAuthorization(aprovacao_id, "associar_desenvolvedores_aplicacao", payloadHash, chave_idempotencia, false, true, simulation, elicitApproval);
      if (applicationDeveloperHash(consumeApplicationDeveloperSimulation(confirmacao_token)) !== payloadHash) throw new Error("A simulação mudou durante a confirmação; simule novamente.");
      const claim = await claimIdempotency("associar_desenvolvedores_aplicacao", chave_idempotencia, payloadHash);
      if (!claim.claimed) {
        if (claim.record.status === "success") {
          markApplicationDeveloperSimulationConsumed(confirmacao_token);
          return result({ sucesso: true, duplicado_impedido: true, ocorrido_em: claim.record.completed_at });
        }
        throw new Error(`A chave de idempotência já está registrada com estado ${claim.record.status}; a associação foi bloqueada para evitar duplicidade.`);
      }
      await consumeWriteAuthorization(aprovacao_id, "associar_desenvolvedores_aplicacao", payloadHash, chave_idempotencia);
      try {
        const submitted = await apf.associateApplicationDevelopers(simulation);
        const audit = await finalizeSuccessfulAudit(
          "associar_desenvolvedores_aplicacao", chave_idempotencia, payloadHash, submitted,
          () => recordApplicationDeveloperAudit(chave_idempotencia, simulation, { status: "sucesso", resultado: submitted }),
        );
        markApplicationDeveloperSimulationConsumed(confirmacao_token);
        return result({ sucesso: true, duplicado_impedido: false, ...submitted, ...audit });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida ao associar desenvolvedores à aplicação.";
        await completeIdempotency("associar_desenvolvedores_aplicacao", chave_idempotencia, payloadHash, "outcome_unknown", message);
        await recordApplicationDeveloperAudit(chave_idempotencia, simulation, { status: "falha", erro: message });
        throw error;
      }
    });
  },
);

function result(data: unknown) {
  return {
    structuredContent: data as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function finalizeSuccessfulAudit(
  scope: string,
  key: string,
  payloadHash: string,
  recoveryResult: unknown,
  writeAudit: () => Promise<{ evento_id: string }>,
): Promise<{ auditoria_id: string | null; auditoria_pendente: boolean; aviso_auditoria?: string }> {
  await completeIdempotency(scope, key, payloadHash, "success", undefined, auditValue({
    scope,
    status: "sucesso",
    resultado: recoveryResult,
  }));
  try {
    const audit = await writeAudit();
    await markIdempotencyAuditProjected(scope, key, payloadHash);
    return { auditoria_id: audit.evento_id, auditoria_pendente: false };
  } catch {
    return {
      auditoria_id: null,
      auditoria_pendente: true,
      aviso_auditoria: "A operação foi concluída e preservada no journal, mas a projeção da auditoria precisa ser reconciliada.",
    };
  }
}

function source(formId: string, gridId: string) {
  return {
    sistema: "AgilePoint APF",
    base_url: apf.sourceBaseUrl,
    formulario_id: formId,
    grade_id: gridId,
    identificador: `APF:form-${formId}:source-${gridId}`,
    versao_extrator: EXTRACTOR_VERSION,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);

const shutdown = async () => {
  await apf.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
