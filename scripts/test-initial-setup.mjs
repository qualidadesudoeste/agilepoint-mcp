import assert from "node:assert/strict";
import { InitialSetup, initialSetupSchema, afterAuthenticationFlow } from "../dist/initial-setup.js";
const firstLogin = afterAuthenticationFlow();
assert.equal(firstLogin.proxima_etapa, "identificar_operacao");
assert.equal(firstLogin.pergunta, "O que você deseja fazer no AgilePoint?");
assert.equal(firstLogin.projeto_sprint_obrigatorios, false);
for (const task of ["Publicar uma Dica de Mestre", "Consultar o ranking", "Alterar a descrição do registro 123", "Importar esta planilha na contagem 67"]) {
  const guidance = afterAuthenticationFlow(task);
  assert.equal(guidance.proxima_etapa, "coletar_dados_da_operacao");
  assert.equal(guidance.objetivo, task);
  assert.equal("pergunta" in guidance, false, "não perguntar novamente por uma tarefa já informada");
  assert.equal(guidance.projeto_sprint_obrigatorios, false);
}
const input = { projeto: "Projeto teste", sprint: "1.0.0" };
const row = '<tr><td>1.0.0</td><td>04/11/2026</td><td>Projeto teste</td><td>Desenvolvimento</td><td>Aberta</td></tr>';
const table = (rows = row) => `<table id="results-table"><tbody>${rows}</tbody></table>`;
function fixture() {
  const state = { screens: [{ formulario_id: "26" }], options: [{ id: "45", label: "Projeto teste" }], complete: true, html: table(), identities: [{ recordId: "67", applicationId: "45" }], error: null, queries: 0 };
  const setup = new InitialSetup({
    listAccessibleScreensHttp: async () => state.screens,
    lookupOptions: async () => ({ options: state.options, complete: state.complete }),
    queryCountsHttp: async filters => {
      state.queries++;
      assert.equal(filters.situacao, undefined, "consultar também contagens fechadas evita criação duplicada");
      if (state.error) throw state.error;
      return { html: state.html, identities: state.identities };
    },
  });
  return { state, setup };
}
assert.equal(initialSetupSchema.safeParse({ ...input, sprint: "x".repeat(21) }).success, false);
const existing = fixture();
assert.equal(existing.setup.getContext().pronto, false);
assert.equal(existing.setup.getContext().contexto_contagem_obrigatorio, false);
assert.equal("proxima_etapa" in existing.setup.getContext(), false, "contexto ausente não deve obrigar seleção de projeto/sprint");
const ready = await existing.setup.configure(input);
assert.equal(ready.pronto, true);
assert.equal(ready.contexto.aplicacao_id, "45");
assert.equal(ready.contexto.contagem_id, "67");
assert.equal(JSON.stringify(ready).includes("senha"), false);
existing.state.error = new Error("acesso negado");
await assert.rejects(existing.setup.configure(input), /acesso negado/);
assert.equal(existing.setup.getContext().pronto, false, "não manter contexto anterior após falha");
const absentProject = fixture();
absentProject.state.options = [];
const createProject = await absentProject.setup.configure(input);
assert.equal(createProject.estado, "perguntar_criacao_projeto_e_sprint");
assert.equal(createProject.criacao_autorizada, false);
assert.equal(absentProject.state.queries, 0);
const absentSprint = fixture();
absentSprint.state.html = table("");
assert.equal((await absentSprint.setup.configure(input)).estado, "perguntar_criacao_sprint");
const denied = fixture();
denied.state.screens = [];
assert.equal((await denied.setup.configure(input)).estado, "sem_acesso_contagem");
const incomplete = fixture();
incomplete.state.complete = false;
assert.equal((await incomplete.setup.configure(input)).estado, "consulta_incompleta");
incomplete.state.complete = true;
incomplete.state.html += '<li id="nav-item-next"><a>Próxima</a></li>';
assert.equal((await incomplete.setup.configure(input)).estado, "consulta_incompleta");
const ambiguous = fixture();
ambiguous.state.options.push({ id: "46", label: "Projeto teste" });
assert.equal((await ambiguous.setup.configure(input)).estado, "projeto_ambiguo");
ambiguous.state.options.pop();
ambiguous.state.html = table(row + row);
ambiguous.state.identities.push({ recordId: "68", applicationId: "45" });
assert.equal((await ambiguous.setup.configure(input)).estado, "sprint_ambigua");
const wrongId = fixture();
wrongId.state.identities[0].applicationId = "99";
await assert.rejects(wrongId.setup.configure(input), /identidade/);
const unexpected = fixture();
unexpected.state.html = "acesso negado";
await assert.rejects(unexpected.setup.configure(input), /tabela/);
const closed = fixture();
closed.state.html = table(row.replace("Aberta", "Fechada"));
assert.equal((await closed.setup.configure(input)).contexto.situacao, "Fechada");
console.log("Configuração inicial: contexto em memória, projeto/sprint existentes, perguntas de criação sem escrita, permissões negadas, consulta incompleta, identidades e ambiguidades: ok. Backend virtualizado.");
