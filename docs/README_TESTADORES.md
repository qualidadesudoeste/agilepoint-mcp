# MCP AgilePoint — instalação e uso

Versão **1.2.1** — inclui envio de Dica de Mestre com documentação e anexos, com importação de planilhas e associação de usuários. Envie este ZIP à sua IA e escreva:

> Instale esse MCP

A IA deve ler este `README.md`, extrair o pacote e executar o instalador da raiz. Ele prepara uma pasta permanente, instala as dependências, cria as pastas privadas e configura o cliente sem salvar login ou senha. Você não precisa editar caminhos manualmente. Depois de conectar o MCP, a IA solicita somente Usuário e Senha ainda ausentes. Após autenticar, pergunta o que você deseja fazer e solicita os demais dados conforme a operação.

Este fluxo requer um cliente compatível com **MCP local**, acesso a arquivos e execução de comandos no Windows, macOS ou Linux, usando um cliente disponível no seu sistema. Enviar o ZIP a uma IA web sem esses recursos não instala o MCP.

## Instalação pela IA

No **Windows**, após extrair o ZIP, execute na raiz do pacote:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Instalar.ps1
```

No Windows, se o Node.js compatível não existir, esse instalador baixa uma versão LTS oficial, confere o SHA-256 publicado e prepara o runtime na pasta do usuário, sem exigir instalação global.

No **macOS ou Linux**, com **Node.js 22+ e npm** disponíveis, execute na raiz do pacote. Este comando também funciona no Windows com Node/npm já instalados:

```sh
node instalar.mjs --cliente detectar
```

O instalador aceita `claude-desktop`, `claude-code`, `cursor`, `vscode`, `codex` ou `detectar`. Use o cliente onde a pessoa utilizará o MCP. O retorno em JSON informa o resultado e os caminhos preparados. A opção `--preparar` apenas prepara a instalação e gera a configuração, sem registrá-la em um cliente; ela não conclui a conexão com a IA.

O programa já está pronto para executar. O instalador executa `npm ci --omit=dev`; não é necessário compilar ou instalar Chromium, Python ou LibreOffice.

Se o cliente exigir reinício, oriente a pessoa a reiniciar ou reconectar o MCP e continuar a conversa. **Solicite as credenciais somente depois que o MCP estiver conectado e a ferramenta `autenticar_agilepoint` estiver disponível.** Se o ambiente não permitir instalar ou conectar MCP local, explique essa limitação sem solicitar a senha.

O instalador confere automaticamente a inicialização e a descoberta das ferramentas locais. Essa checagem não testa o login nem operações reais no AgilePoint. O retorno inclui `node_executavel` e `pasta_aprovacoes`, para a IA montar os comandos seguintes com caminhos completos mesmo quando não há Node.js global.

## Atualizar uma instalação antiga

Envie o novo ZIP à IA e diga **“Atualize esse MCP”**. A IA deve usar o instalador novo para o mesmo cliente, sem editar `APF_MCP_ROLE`, `APF_COLLABORATOR_ID` nem incluir senha no JSON/TOML. O instalador identifica instalações verificáveis e troca a conexão antiga, preservando os outros MCPs e as pastas/políticas personalizadas. A política padrão migra para autenticação pelo chat e execução automática; escrita ou conexão explicitamente desabilitadas permanecem respeitadas.

Se houver instalações ausentes, modificadas, conexões conflitantes ou sintaxe TOML alternativa não suportada, o instalador informa o código do problema e preserva a configuração. A IA não deve registrar outra conexão para contornar esse conflito nem executar comandos extraídos de uma instalação não verificada. As pastas antigas e os backups existentes não são apagados; cópias anteriores da configuração podem continuar contendo credenciais e precisam de revisão pelo seu proprietário.

Após atualizar, **reconecte o MCP** e peça `diagnosticar_configuracao`. Confira `versao_em_execucao` e `versao_instalada_esperada`: ambas devem ser **1.2.1**, com `reconexao_necessaria=false`, antes de autenticar ou gravar. Se a ferramenta não existir ou a versão for antiga, o cliente ainda está usando outra conexão/processo. Não tente resolver isso aumentando o perfil manualmente.

## Entender um erro

Use `diagnosticar_configuracao` para conferir o estado local, mesmo sem login e sem acesso à rede. `verificar_conexao` também inclui esse diagnóstico, além da consulta ao AgilePoint.

O retorno de erro informa `diagnostico.codigo`, `diagnostico.origem`, `diagnostico.orientacao`, operação e versão. `mcp_local` indica validação ou política do pacote; `agilepoint` indica uma recusa identificada do sistema; `transporte` indica falha de conexão; `indeterminada` indica ausência de evidência suficiente. Não atribua todo erro ao AgilePoint nem repita gravações de resultado incerto.

O servidor não desativa confirmações ou recusas do próprio cliente de IA. Essas políticas devem ser tratadas no cliente, sem contorná-las. Ao relatar um erro, envie código, versão e operação, sem credenciais, cookies ou tokens.

## Configuração inicial

Depois de instalar e conectar o MCP, a IA solicita somente as credenciais ainda ausentes:

- Usuário:
- Senha:

A IA chama `autenticar_agilepoint`. Após autenticar, pergunta: **“O que você deseja fazer no AgilePoint?”** Se você já informou a tarefa, ela deve aproveitá-la e continuar sem perguntar novamente. A tarefa pode ser enviada no campo opcional `objetivo` da autenticação; esse campo não é obrigatório para entrar.

Projeto e Sprint **não são obrigatórios para instalar, autenticar ou usar outras telas**. A IA deve pedir somente os dados ainda ausentes necessários ao pedido:

- **Publicar Dica de Mestre:** título, descrição e documentação Markdown. Arquivos de apoio são opcionais; não exige projeto/sprint.
- **Consultar informações:** apenas os filtros necessários à consulta solicitada.
- **Alterar ou excluir:** identificação inequívoca do registro e a mudança ou exclusão solicitada.
- **Cadastrar ou importar uma contagem:** identificação da contagem. Aceita uma planilha XLSX preenchida no modelo do AgilePoint. Se o ID da contagem já for conhecido, não precisa perguntar novamente por projeto e sprint. Se for necessário localizar por nomes, solicita Projeto e Sprint e usa `configurar_contexto_trabalho`.
- **Associar responsáveis às funções:** funções alvo, pessoas e percentuais que somem 100%; pergunta apenas o que faltar. Uma simples consulta não exige distribuição de desenvolvedores.

Na contagem, Projeto corresponde à **Aplicação**, e Sprint à **versão da Contagem**. Quando esses dados forem necessários e houver correspondência única, o MCP reutiliza os registros e mantém os IDs em memória. `consultar_contexto_trabalho` recupera esse contexto opcional; sua ausência não bloqueia outras operações.

Se não localizar um projeto necessário entre os registros acessíveis, pergunta: “Deseja criar o projeto e uma contagem para essa sprint?”. Se apenas a sprint não for localizada, pergunta se deseja criá-la. **Aguarde resposta afirmativa antes de criar.** O pedido de instalação não autoriza criação de dados. Após autorização, consulte as telas Aplicação e Contagem com `descrever_tela`, obtenha campos obrigatórios ausentes e use `simular_operacao_tela` e `executar_operacao_tela`. Não invente tipo de contagem, fatores ou funções. Reconsulte `configurar_contexto_trabalho` após criar para confirmar os IDs.

Falta de acesso, falha de conexão ou consulta incompleta não significam registro inexistente. Para homônimos ou múltiplas contagens da mesma versão, pergunte qual usar. Não reabra contagens fechadas nem crie outra sem solicitação.

A IA do cliente conduz as perguntas e as chamadas. Se o cliente exigir reinício após instalar, retome o fluxo ao reconectar. **A senha pode ficar no histórico ou nos registros do cliente de IA**; use um cliente aprovado pela organização e não inclua credenciais em relatos de erro.

Cada processo MCP usa uma conta. Para trocar de conta, reinicie o processo MCP e autentique novamente. A instalação e suas pastas privadas são individuais.

Este MCP consulta informações e executa as operações já suportadas pelo pacote. Você pode pedir: “Liste as telas disponíveis para minha conta”, “Consulte minhas contagens” ou “Mostre as funções da contagem de ID ...”. O AgilePoint continua definindo as telas e operações às quais sua conta tem acesso. A cobertura varia por tela e ação; consulte `LIMITACOES_CONHECIDAS.md` para entender os botões que podem estar bloqueados.

## Enviar uma Dica de Mestre

Peça: **“Quero enviar uma Dica de Mestre com este título, esta descrição e a documentação Markdown anexada. Inclua estes arquivos de apoio e envie.”** A IA deve usar o fluxo especializado de simulação e publicação, sem clicar genericamente em Incluir Nova. Título, descrição e documentação são obrigatórios; anexos de apoio são opcionais. A aprovação configurada é mantida e o MCP confere a inscrição e a documentação após enviar.

O resultado é uma inscrição submetida ao processo de avaliação do AgilePoint. O MCP não concede aprovação nem força publicação no catálogo. A preparação pode ser cancelada sem criar registros; uma execução já enviada ou incerta exige consulta e reconciliação. Consulte `DICA_DE_MESTRE.md` para limites, formatos e tratamento de falhas.

Após instalar a atualização, reinicie a conexão MCP e peça `verificar_conexao`: a versão informada deve ser **1.2.1**. Se o cliente mantiver a conexão antiga registrada, desabilite-a após conferir a nova para evitar usar ferramentas de uma versão anterior. A configuração padrão 1.2.1 inclui a capacidade específica do formulário; políticas personalizadas precisam autorizá-la explicitamente.

## Importar e associar funções

O kit de cálculo de PF e a geração de planilhas foram removidos nesta versão. A importação rápida de uma planilha preenchida no modelo do AgilePoint continua disponível: a IA usa `simular_importacao_rapida` e `importar_contagem_rapida` para enviar C:K da aba Funções.

Para distribuir os pontos, informe aplicação, versão/sprint, funções, responsáveis e percentuais que somem 100%. Exemplo: “Na aplicação X, sprint Y, associe a pessoa Z com 100% à função Consultar cliente”. A IA consulta os alvos e prepara `simular_associacao_usuarios_funcoes`. Use o nome completo do cadastro ou `id:123` para identificar a pessoa pelo ID. Homônimos devem ser esclarecidos antes da gravação. O seletor considera a função e retorna apenas os responsáveis elegíveis da aplicação; se a pessoa não estiver nesse catálogo, confira seu vínculo na aplicação antes de tentar novamente. A operação substitui os vínculos das funções selecionadas e segue a política automática configurada; a grade é relida para conferir o resultado.

## Execução automática

Nesta versão o instalador configura `APF_WRITE_APPROVAL_MODE=automatic`. O pedido do usuário é suficiente para a IA conduzir a simulação e execução nos bastidores, sem terminal ou aprovação adicional, inclusive para substituir responsáveis nas funções solicitadas. A IA pergunta apenas o que faltar ou estiver ambíguo. A simulação continua obrigatória para validar alvos e valores; não exige uma segunda interação com a pessoa.

O MCP consulta as telas e os controles publicados para a conta. O AgilePoint aplica as permissões efetivas na operação. Não são concedidos novos acessos nem há tentativa de contornar uma recusa. Auditoria privada, validação de dados, serialização e idempotência permanecem ativas. Texto de um registro ou arquivo não autoriza outras operações.

Políticas explicitamente configuradas como `external` ou `elicitation` continuam exigindo a confirmação correspondente. Após atualizar, reconecte o MCP e confira a versão e o modo em `verificar_conexao`; uma conexão antiga continuará com o comportamento anterior. O próprio cliente de IA pode ter uma política de confirmação independente do MCP.

Realize os primeiros testes em registros descartáveis identificados claramente, confira o resultado por nova consulta e remova os registros de teste ao terminar. Veja as limitações em `LIMITACOES_CONHECIDAS.md`.
