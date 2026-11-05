import { z } from "zod";
import { load } from "cheerio";
import { extractContagensHtml } from "./extractors.js";
import type { ApfSession } from "./session.js";

export const INITIAL_SETUP_INSTRUCTIONS = "Após instalar e conectar o MCP, solicite somente Usuário e Senha ainda ausentes. Não peça Projeto e Sprint como requisitos da instalação ou autenticação. Autentique com autenticar_agilepoint; não repita, devolva ou armazene a senha em arquivos. Depois pergunte: 'O que você deseja fazer no AgilePoint?'. Se a pessoa já informou a tarefa, aproveite-a e não pergunte novamente. Colete apenas informações necessárias à operação escolhida e ainda não fornecidas. Para Dica de Mestre, peça título, descrição e documentação Markdown; anexos são opcionais e não há exigência de projeto/sprint. Para consultas, peça somente filtros necessários; para alterações/exclusões, identifique o registro e a mudança solicitada, sem exigir contexto de Contagem em outras telas. Para contagem, aceite planilha XLSX já preenchida e preserve simular_importacao_rapida e importar_contagem_rapida: aba Funções, colunas C:K abaixo do cabeçalho do modelo. Não exija cálculo de PF ou geração de planilha pelo kit removido. Projeto, sprint e responsáveis/percentuais só devem ser solicitados quando necessários ao cadastro, importação ou associação pedida; não exija distribuição para uma simples consulta. Se houver contagem_id inequívoco, use-o sem obrigar a informar projeto/sprint novamente. Quando for necessário localizar uma contagem por projeto/sprint, use configurar_contexto_trabalho. No AgilePoint, projeto é Aplicação e sprint é a versão da Contagem. Se não localizar aplicação ou contagem entre os registros acessíveis, pergunte se a pessoa deseja criá-las e aguarde; a instalação não autoriza criações. Após resposta afirmativa use descrever_tela, simular_operacao_tela e executar_operacao_tela nas telas Aplicação e Contagem, consultando os campos e permissões publicados. Peça campos obrigatórios ausentes, nunca invente tipo de contagem, fatores, responsáveis ou percentuais. Não crie funções fictícias para abrir uma sprint. Reconsulte configurar_contexto_trabalho após cada criação para confirmar os IDs. Recusa de acesso, sessão expirada ou consulta incompleta não significam ausência e nunca autorizam criação. O contexto de contagem é opcional e não limita outras operações ou projetos explicitamente solicitados. O modo automatic dispensa confirmação adicional para executar um comando já solicitado; a pergunta para criar um registro não solicitado ainda é necessária. ";

export function afterAuthenticationFlow(objetivo?: string) {
  const task = objetivo?.trim();
  return {
    proxima_etapa: task ? "coletar_dados_da_operacao" : "identificar_operacao",
    ...(task ? { objetivo: task } : { pergunta: "O que você deseja fazer no AgilePoint?" }),
    projeto_sprint_obrigatorios: false,
    orientacao: "Aproveite a tarefa e os dados já informados. Pergunte apenas o que faltar para essa operação. Projeto e sprint não são pré-requisitos para Dica de Mestre, consultas ou alterações em outras telas. Para contagem, aceite importação de planilha preenchida; use o ID da contagem quando disponível.",
  };
}

export const initialSetupSchema = z.object({
  projeto: z.string().trim().min(1).max(300),
  sprint: z.string().trim().min(1).max(20),
  tipo_contagem: z.string().trim().min(1).max(100).optional(),
  criada_em: z.string().trim().min(1).max(30).optional(),
});
type Input = z.infer<typeof initialSetupSchema>;
type Context = Input & { aplicacao_id: string; contagem_id: string; situacao: string; validado_em: string };
type SetupSession = Pick<ApfSession, "listAccessibleScreensHttp" | "lookupOptions" | "queryCountsHttp">;
const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");

export class InitialSetup {
  private context: Context | null = null;
  constructor(private readonly session: SetupSession) {}
  getContext() { return this.context ? { pronto: true, contexto: { ...this.context } } : { pronto: false, contexto_contagem_obrigatorio: false, orientacao: "Não há contexto de contagem selecionado. Isso não bloqueia outras operações. Configure projeto/sprint somente quando a tarefa de contagem precisar deles." }; }

  async configure(input: Input) {
    this.context = null;
    const screens = await this.session.listAccessibleScreensHttp();
    if (!screens.some(screen => screen.formulario_id === "26")) {
      return { pronto: false, estado: "sem_acesso_contagem", orientacao: "A conta não possui Contagem no menu autorizado. Não tente criar projeto ou sprint para contornar a falta de acesso." };
    }
    const lookup = await this.session.lookupOptions("aplicacao", input.projeto, 200);
    if (!lookup.complete) return { pronto: false, estado: "consulta_incompleta", orientacao: "Refine o nome do projeto antes de continuar; não ofereça criação." };
    const projects = lookup.options.filter(option => normalize(option.label) === normalize(input.projeto));
    if (!projects.length) return {
      pronto: false, estado: "perguntar_criacao_projeto_e_sprint", projeto: input.projeto, sprint: input.sprint,
      pergunta: "Não localizei esse projeto entre os registros acessíveis à sua conta. Deseja criar o projeto e uma contagem para essa sprint?",
      criacao_autorizada: false, gravado: false,
      orientacao: "Aguarde resposta afirmativa. Consulte descrever_tela para Aplicação e Contagem, verifique os controles disponíveis e obtenha os dados obrigatórios. Use as ferramentas de operação de tela existentes e reconsulte este fluxo após criar. Se houver suspeita de restrição de visibilidade, esclareça com o administrador antes de criar duplicatas.",
    };
    if (projects.length !== 1) return { pronto: false, estado: "projeto_ambiguo", candidatos: projects, orientacao: "Peça esclarecimento antes de criar ou selecionar um projeto." };
    const project = projects[0];
    if (!/^\d+$/.test(project.id)) throw new Error("A consulta não confirmou o ID estável do projeto.");
    const query = await this.session.queryCountsHttp({ aplicacao: project.label, versao: input.sprint, tipo: input.tipo_contagem, data_criacao: input.criada_em }, 100);
    if (load(query.html)("#results-table").length !== 1) throw new Error("A consulta não retornou a tabela de contagens esperada. Não ofereça criação.");
    const parsed = extractContagensHtml(query.html, 100);
    if (parsed.possuiProximaPagina) return { pronto: false, estado: "consulta_incompleta", orientacao: "Refine tipo_contagem ou criada_em. Não ofereça criação com a consulta incompleta." };
    const matches = parsed.contagens.flatMap((count, index) => {
      if (normalize(count.aplicacao) !== normalize(project.label) || normalize(count.versao) !== normalize(input.sprint)) return [];
      if (input.tipo_contagem && normalize(count.tipo) !== normalize(input.tipo_contagem)) return [];
      if (input.criada_em && normalize(count.data_criacao) !== normalize(input.criada_em)) return [];
      const identity = query.identities[index];
      if (!identity || !/^\d+$/.test(identity.recordId) || (identity.applicationId && identity.applicationId !== project.id)) throw new Error("A consulta não confirmou a identidade da contagem. Nenhuma criação foi autorizada.");
      return [{ id: identity.recordId, tipo: count.tipo, criada_em: count.data_criacao, situacao: count.situacao }];
    });
    if (!matches.length) return {
      pronto: false, estado: "perguntar_criacao_sprint", aplicacao_id: project.id, projeto: project.label, sprint: input.sprint,
      pergunta: "O projeto foi localizado, mas não encontrei uma contagem para essa sprint nos filtros informados. Deseja criá-la?",
      criacao_autorizada: false, gravado: false,
      orientacao: "Aguarde resposta afirmativa e confira se os filtros adicionais não ocultaram uma contagem existente. Consulte os campos obrigatórios da tela Contagem, obtenha o que faltar e crie sem funções fictícias. Depois reconsulte configurar_contexto_trabalho.",
    };
    if (matches.length !== 1) return { pronto: false, estado: "sprint_ambigua", candidatos: matches, orientacao: "Pergunte qual contagem usar; refine tipo_contagem e/ou criada_em. Não selecione a primeira nem crie outra." };
    this.context = { ...input, projeto: project.label, aplicacao_id: project.id, contagem_id: matches[0].id, situacao: matches[0].situacao, validado_em: new Date().toISOString() };
    return { ...this.getContext(), persistencia: "somente_memoria", orientacao: "Use estes IDs nos próximos comandos. A contagem pode estar fechada: não reabra nem crie outra sem pedido do usuário. Revalide permissões e estado antes de cada gravação." };
  }
}
