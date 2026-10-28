import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.APF_USERNAME || !process.env.APF_PASSWORD) {
  console.error("Configure APF_USERNAME e APF_PASSWORD no ambiente privado da conta de teste.");
  process.exit(2);
}
const testCountId = process.env.APF_HOMOLOGATION_COUNT_ID?.trim();
const simulateMonth = process.env.APF_HOMOLOGATION_SIMULATE_MONTH === "true";
const month = process.env.APF_HOMOLOGATION_MONTH?.trim() || String(new Date().getMonth() + 1);
if (simulateMonth && (!testCountId || !/^(?:[1-9]|1[0-2])$/.test(month))) {
  console.error("Para simular Mês, informe APF_HOMOLOGATION_COUNT_ID e um mês de 1 a 12.");
  process.exit(2);
}
if (testCountId && !/^\d+$/.test(testCountId)) {
  console.error("APF_HOMOLOGATION_COUNT_ID deve ser numérico.");
  process.exit(2);
}
const exportFormat = process.env.APF_HOMOLOGATION_EXPORT_FORMAT?.trim();
if (exportFormat && !["pdf", "analitico", "excel"].includes(exportFormat)) {
  console.error("APF_HOMOLOGATION_EXPORT_FORMAT deve ser pdf, analitico ou excel.");
  process.exit(2);
}
if (exportFormat && (!testCountId || !process.env.APF_EXPORT_DIR)) {
  console.error("Para testar exportação, configure APF_HOMOLOGATION_COUNT_ID e APF_EXPORT_DIR privado.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    APF_USERNAME: process.env.APF_USERNAME,
    APF_PASSWORD: process.env.APF_PASSWORD,
    APF_MCP_ROLE: process.env.APF_MCP_ROLE || "desenvolvedor",
    APF_WRITE_ENABLED: "false",
    ...(simulateMonth ? { APF_WRITE_APPROVAL_MODE: "delegated" } : {}),
    ...(process.env.APF_BASE_URL ? { APF_BASE_URL: process.env.APF_BASE_URL } : {}),
    ...(process.env.APF_EXPORT_DIR ? { APF_EXPORT_DIR: process.env.APF_EXPORT_DIR } : {}),
    ...(process.env.APF_COLLABORATOR_ID ? { APF_COLLABORATOR_ID: process.env.APF_COLLABORATOR_ID } : {}),
    ...(process.env.APF_CAPABILITIES_FILE ? { APF_CAPABILITIES_FILE: process.env.APF_CAPABILITIES_FILE } : {}),
  },
});
const client = new Client({ name: "agilepoint-apf-live-smoke", version: "1.0.0" });

async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) {
    const message = response.content?.filter((item) => item.type === "text").map((item) => item.text).join(" ") ?? "";
    const category = /não foi publicada|não foi publicado/i.test(message) ? "opcao_ou_componente_nao_publicado"
      : /não foi encontrado|não foi encontrada/i.test(message) && message.includes("component:1135977") ? "campo_mes_nao_encontrado"
      : /não foi encontrado|não foi encontrada/i.test(message) && message.includes("Cancelar") ? "acao_cancelar_nao_encontrada"
      : /não foi encontrado|não foi encontrada/i.test(message) && message.includes("Incluir") ? "acao_incluir_nao_encontrada"
      : /não foi encontrado|não foi encontrada/i.test(message) ? "alvo_nao_encontrado"
      : /capacidade local/i.test(message) ? "capacidade_local_negada"
      : /token CSRF/i.test(message) ? "csrf_ausente"
      : /modo include|modo incluir|modo edit|modo alterar/i.test(message) ? "transicao_modo_recusada"
      : /formulário diferente|formulário mudou/i.test(message) ? "formulario_diferente"
      : /não está disponível|acesso negado|permiss/i.test(message) ? "acesso_negado"
      : "erro_nao_classificado";
    throw new Error(`Falha na ferramenta ${name} (${category}).`);
  }
  const value = response.structuredContent;
  if (!value || typeof value !== "object") throw new Error(`Resposta inválida de ${name}.`);
  return value;
}

try {
  await client.connect(transport);
  const connection = await call("verificar_conexao");
  if (!connection.conectado || !connection.autenticado) {
    throw new Error("A conta de teste não foi autenticada no AgilePoint.");
  }
  const menu = await call("listar_telas_disponiveis");
  if (!Array.isArray(menu.telas)) throw new Error("O menu autorizado não foi retornado.");
  const forbiddenFormIds = (process.env.APF_HOMOLOGATION_FORBIDDEN_FORM_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (forbiddenFormIds.some((formId) => !/^\d+$/.test(formId))) {
    throw new Error("APF_HOMOLOGATION_FORBIDDEN_FORM_IDS deve conter IDs numéricos separados por vírgulas.");
  }
  const unexpected = menu.telas.filter((screen) => forbiddenFormIds.includes(screen.formulario_id));
  if (unexpected.length) throw new Error("Uma tela declarada como proibida apareceu no menu desta conta.");

  let contagens = "sem_permissao";
  if (connection.formularios?.formulario_26) {
    const response = await call("listar_contagens", { limite: 1 });
    if (!Array.isArray(response.contagens)) throw new Error("A listagem de contagens não foi retornada.");
    contagens = "leitura_ok";
  }
  let contagemTeste = "nao_configurada";
  let exportacao = "nao_configurada";
  let simulacaoMes = "nao_configurada";
  if (testCountId) {
    const detail = await call("listar_funcoes_contagem", { contagem_id: testCountId });
    if (detail.contagem?.contagem_id_origem !== testCountId || !Array.isArray(detail.funcoes)) {
      throw new Error("A contagem descartável não foi confirmada pelo ID informado.");
    }
    const expectedApplication = process.env.APF_HOMOLOGATION_APPLICATION?.trim();
    const expectedVersion = process.env.APF_HOMOLOGATION_VERSION?.trim();
    if (expectedApplication && detail.contagem.aplicacao !== expectedApplication) {
      throw new Error("A aplicação da contagem descartável não corresponde à esperada.");
    }
    if (expectedVersion && detail.contagem.versao !== expectedVersion) {
      throw new Error("A versão da contagem descartável não corresponde à esperada.");
    }
    contagemTeste = detail.contagem.situacao === "Aberta" ? "leitura_ok_aberta" : "leitura_ok_fechada";
    if (simulateMonth) {
      const filters = { aplicacao: detail.contagem.aplicacao, versao: detail.contagem.versao, limite: 100 };
      const before = await call("listar_contagens", filters);
      const beforeIds = before.contagens?.map((item) => item.contagem_id_origem).sort();
      if (!Array.isArray(beforeIds) || !beforeIds.includes(testCountId) || !before.metadados?.paginacao?.completo) {
        throw new Error("A listagem anterior à simulação não está completa ou não inclui a contagem descartável.");
      }
      const preview = await call("simular_operacao_tela", { tela: "Contagem", operacoes: [
        { tipo: "clicar", alvo: "Incluir" },
        { tipo: "selecionar", alvo: "component:1135977", valor: month },
        { tipo: "clicar", alvo: "Cancelar" },
      ] });
      if (preview.validacoes?.length !== 3 || !preview.confirmacao_token) {
        throw new Error("A simulação do seletor Mês não confirmou as três operações esperadas.");
      }
      const after = await call("listar_contagens", filters);
      const afterIds = after.contagens?.map((item) => item.contagem_id_origem).sort();
      if (!Array.isArray(afterIds) || !after.metadados?.paginacao?.completo || JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) {
        throw new Error("A lista de contagens mudou durante a simulação; verifique o AgilePoint antes de repetir.");
      }
      simulacaoMes = "ok_sem_nova_contagem";
    }
    if (exportFormat) {
      const report = await call("exportar_relatorio_contagem", { contagem_id: testCountId, formato: exportFormat });
      if (!report.arquivo || !report.formato) throw new Error("A exportação não confirmou o arquivo gerado.");
      exportacao = `ok_${report.formato}`;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    perfil_local: process.env.APF_MCP_ROLE || "nao_configurado",
    formularios: connection.formularios,
    telas_no_menu: menu.telas.length,
    contagens,
    contagem_teste: contagemTeste,
    exportacao,
    simulacao_mes: simulacaoMes,
    telas_proibidas_checadas: forbiddenFormIds.length,
    versao_extrator: connection.versao_extrator,
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha na homologação de leitura.");
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
