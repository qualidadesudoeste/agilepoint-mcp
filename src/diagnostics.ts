import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { authenticationStatus } from "./access.js";
import { writeApprovalMode } from "./write-authorization.js";

export type ErrorOrigin = "mcp_local" | "agilepoint" | "transporte" | "indeterminada";
export class DiagnosticError extends Error {
  constructor(public code: string, public origin: ErrorOrigin, message: string, public action: string) { super(message); }
}

export function errorDiagnostic(error: unknown, outcomeUnknown = false) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  let code = "ERRO_NAO_CLASSIFICADO", origin: ErrorOrigin = "indeterminada";
  let action = "Informe o código, a versão e a operação ao suporte, sem credenciais. Não repita gravações sem consultar o resultado.";
  if (error instanceof DiagnosticError) { code = error.code; origin = error.origin; action = error.action; }
  else if (/Autentique-se com autenticar_agilepoint/.test(message)) { code = "AUTENTICACAO_NECESSARIA"; origin = "mcp_local"; action = "Chame autenticar_agilepoint com as credenciais individuais. Não edite APF_MCP_ROLE ou APF_COLLABORATOR_ID."; }
  else if (/exige um dos perfis|APF_COLLABORATOR_ID|não possui capacidade local|APF_MCP_ROLE/.test(message)) { code = "POLITICA_LOCAL"; origin = "mcp_local"; action = "Chame diagnosticar_configuracao, confira a versão e o modo de autenticação e atualize/reconecte uma instalação legada. Uma capacidade local não comprova permissão no AgilePoint."; }
  else if (/gravação está desabilitada/.test(message)) { code = "GRAVACAO_LOCAL_DESABILITADA"; origin = "mcp_local"; action = "A política local desabilitou escrita. Preserve essa decisão e solicite revisão da instalação; isso não é uma recusa do AgilePoint."; }
  else if (/exige aprovacao_id|ainda não foi aprovada|não foi aprovada na confirmação|aprovação.*expir|APF_TRUSTED_CLIENT_ELICITATION/.test(message)) { code = "APROVACAO_LOCAL"; origin = "mcp_local"; action = "Confira o modo efetivo em diagnosticar_configuracao. Em external/elicitation, respeite a aprovação configurada. Em automatic, não envie aprovacao_id. Não contorne bloqueios do cliente de IA."; }
  else if (/Token inexistente|Token inexistente ou expirado|simulação.*expir|simulação mudou|planilha mudou|não foi encontrado entre os responsáveis elegíveis|soma dos percentuais|lista de responsáveis.*incompleta/i.test(message)) { code = "VALIDACAO_DA_OPERACAO"; origin = "mcp_local"; action = "Confira os dados e o registro atual. Quando for seguro, gere uma nova simulação; não amplie o catálogo nem repita gravações de resultado incerto."; }
  else if (/^Informe |^Defina |^O alvo .*não foi encontrado|^A opção .*não foi resolvida|^A sequência terminou|^A lista .*duplicad|^A planilha precisa|^A célula |^O ID .*numérico|^As? contagens?.*fechada/i.test(message)) { code = "VALIDACAO_DA_OPERACAO"; origin = "mcp_local"; action = "Confira os campos e seletores publicados e os dados solicitados. Esclareça ambiguidades antes de simular novamente; não altere o perfil da conta para contornar a validação."; }
  else if (/^O AgilePoint (?:recusou|negou acesso|não permitiu)/.test(message)) { code = "RECUSA_AGILEPOINT"; origin = "agilepoint"; action = "Respeite a recusa do sistema. Confira as permissões da conta e os dados com o administrador do AgilePoint, sem tentar outra rota para contorná-la."; }
  if (outcomeUnknown) { code = "RESULTADO_INCERTO"; origin = "indeterminada"; action = "Consulte o registro e a auditoria antes de nova tentativa. Não troque a chave de idempotência para repetir a operação."; }
  const safeMessage = code === "ERRO_NAO_CLASSIFICADO" ? "Falha não classificada; detalhes técnicos e valores não são retornados pelo diagnóstico."
    : message.replace(/https?:\/\/[^\s"<>]+/gi, "[URL omitida]").replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, "[documento omitido]")
      .replace(/(?:password|senha|token|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "[credencial omitida]").replace(/"[^"\r\n]*"/g, '"[valor omitido]"').slice(0, 700);
  return { evento_id: randomUUID(), codigo: code, origem: origin, mensagem: safeMessage, orientacao: action, repeticao_automatica_permitida: false };
}

async function expectedVersion() {
  const file = process.env.APF_INSTALL_STATE_FILE?.trim();
  if (!file) return null;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error();
    const state = JSON.parse(await readFile(file, "utf8"));
    if (!/^\d+\.\d+\.\d+$/.test(state.version)) throw new Error();
    return state.version as string;
  } catch {
    throw new DiagnosticError("ESTADO_INSTALACAO_INVALIDO", "mcp_local", "O estado local da instalação não pôde ser validado.", "Execute novamente o instalador do pacote e reconecte o MCP. Não altere perfil nem credenciais em arquivos.");
  }
}

export async function configurationDiagnostic(version: string) {
  const expected = await expectedVersion();
  const authentication = authenticationStatus();
  return {
    versao_em_execucao: version, versao_instalada_esperada: expected, reconexao_necessaria: Boolean(expected && expected !== version),
    ambiente: { sistema: process.platform, arquitetura: process.arch, node: process.versions.node },
    autenticacao: authentication,
    escrita: { habilitada: process.env.APF_WRITE_ENABLED === "true", modo_comum: writeApprovalMode(), modo_destrutivo: writeApprovalMode(true) },
    orientacao: expected && expected !== version ? "Reconecte o MCP: o processo atual ainda executa outra versão. Gravações estão bloqueadas até reconectar."
      : authentication.modo === "ambiente_legado" ? "Atualize e reconecte a instalação para autenticar pelo chat. Não adicione perfil ou identificador manualmente para contornar bloqueios."
        : authentication.autenticado_pelo_chat ? "Use as ferramentas conforme a tarefa, respeitando as permissões efetivas retornadas pelo AgilePoint." : "Chame autenticar_agilepoint; após autenticar, pergunte o que a pessoa deseja fazer se a tarefa ainda não foi informada.",
    limite_cliente_ia: "O MCP não consegue detectar ou desativar as aprovações e recusas impostas pelo cliente de IA. Uma recusa desse cliente precisa ser tratada nele, sem contornar sua política.",
    senhas_tokens_e_cookies_retornados: false,
  };
}

export async function assertCurrentInstallation(version: string) {
  const expected = await expectedVersion();
  if (expected && expected !== version) throw new DiagnosticError("RECONECTAR_MCP", "mcp_local", "O processo MCP ainda executa uma versão diferente da instalação atualizada.", "Reconecte o MCP e confira diagnosticar_configuracao antes de gravar.");
}
