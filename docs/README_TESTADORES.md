# MCP AgilePoint — instalação e uso

Versão **1.2.0** — inclui envio de Dica de Mestre com documentação e anexos, além do kit APF e da contagem guiada. Envie este ZIP à sua IA e escreva:

> Instale esse MCP

A IA deve ler este `README.md`, extrair o pacote e executar o instalador da raiz. Ele prepara uma pasta permanente, instala as dependências, cria as pastas privadas e configura o cliente sem salvar login ou senha. Você não precisa editar caminhos manualmente. Depois de conectar o MCP, a IA solicita suas credenciais do AgilePoint.

Este fluxo requer um cliente compatível com **MCP local**, acesso a arquivos e execução de comandos no Windows. Enviar o ZIP a uma IA web sem esses recursos não instala o MCP.

## Instalação pela IA

Após extrair o ZIP, execute na raiz do pacote:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Instalar.ps1
```

No Windows, se o Node.js compatível não existir, esse instalador baixa uma versão LTS oficial, confere o SHA-256 publicado e prepara o runtime na pasta do usuário, sem exigir instalação global.

Se o **Node.js 22 ou superior** já estiver disponível, também é possível executar diretamente:

```powershell
node instalar.mjs --cliente detectar
```

O instalador aceita `claude-desktop`, `claude-code`, `cursor`, `vscode`, `codex` ou `detectar`. Use o cliente onde a pessoa utilizará o MCP. O retorno em JSON informa o resultado e os caminhos preparados. A opção `--preparar` apenas prepara a instalação e gera a configuração, sem registrá-la em um cliente; ela não conclui a conexão com a IA.

O programa já está pronto para executar. O instalador executa `npm ci --omit=dev`; não é necessário compilar ou instalar Chromium, Python ou LibreOffice.

Se o cliente exigir reinício, oriente a pessoa a reiniciar ou reconectar o MCP e continuar a conversa. **Solicite as credenciais somente depois que o MCP estiver conectado e a ferramenta `autenticar_agilepoint` estiver disponível.** Se o ambiente não permitir instalar ou conectar MCP local, explique essa limitação sem solicitar a senha.

O instalador confere automaticamente a inicialização e a descoberta das ferramentas locais. Essa checagem não testa o login nem operações reais no AgilePoint. O retorno inclui `node_executavel` e `pasta_aprovacoes`, para a IA montar os comandos seguintes com caminhos completos mesmo quando não há Node.js global.

## Entrar e utilizar

Com o MCP conectado, informe suas credenciais individuais quando a IA solicitar. Ela deve chamar `autenticar_agilepoint`. **A senha pode ficar no histórico ou nos registros do cliente de IA**; use um cliente aprovado para esse uso e nunca inclua a senha em um relato de erro.

Cada processo MCP usa uma conta. Para trocar de conta, reinicie o processo MCP e autentique novamente. A instalação e suas pastas privadas são individuais.

Este MCP consulta informações e executa as operações já suportadas pelo pacote. Você pode pedir: “Liste as telas disponíveis para minha conta”, “Consulte minhas contagens” ou “Mostre as funções da contagem de ID ...”. O AgilePoint continua definindo as telas e operações às quais sua conta tem acesso. A cobertura varia por tela e ação; consulte `LIMITACOES_CONHECIDAS.md` para entender os botões que podem estar bloqueados.

## Enviar uma Dica de Mestre

Peça: **“Quero enviar uma Dica de Mestre com este título, esta descrição e a documentação Markdown anexada. Inclua estes arquivos de apoio e mostre a prévia antes de enviar.”** A IA deve usar o fluxo especializado de simulação e publicação, sem clicar genericamente em Incluir Nova. Título, descrição e documentação são obrigatórios; anexos de apoio são opcionais. A aprovação configurada é mantida e o MCP confere a inscrição e a documentação após enviar.

O resultado é uma inscrição submetida ao processo de avaliação do AgilePoint. O MCP não concede aprovação nem força publicação no catálogo. A preparação pode ser cancelada sem criar registros; uma execução já enviada ou incerta exige consulta e reconciliação. Consulte `DICA_DE_MESTRE.md` para limites, formatos e tratamento de falhas.

Após instalar a atualização, reinicie a conexão MCP e peça `verificar_conexao`: a versão informada deve ser **1.2.0**. Se o cliente mantiver a conexão antiga registrada, desabilite-a após conferir a nova para evitar usar ferramentas de uma versão anterior. A configuração padrão 1.2.0 inclui a capacidade específica do formulário; políticas personalizadas precisam autorizá-la explicitamente.

## Preparar uma contagem com o kit APF

Se os responsáveis ou percentuais não forem informados, a IA deve perguntar antes de criar a contagem ou importar funções. Não deve presumir o usuário autenticado nem uma divisão igual. Você pode responder, por exemplo: “Jéssica com 60% e Bruno com 40% em todas as funções”, ou definir distribuições diferentes por grupo. Cada função deve somar 100%. A IA deve resolver as identidades, conferir a cobertura das funções e apresentar a divisão no resumo. Após importar, conduz a associação e confere as contribuições. A associação substitui os vínculos atuais das funções selecionadas e exige aprovação própria, inclusive no modo delegado.

Você pode pedir apenas: **“Faça a contagem de PF da tela X e cadastre a contagem no Agile.”** A ferramenta `iniciar_contagem_guiada` e as instruções do MCP orientam a IA a aproveitar o contexto, perguntar o que faltar, analisar as fontes com o kit e conduzir o cadastro na aba Funções. A aplicação, versão/sprint, escopo e metodologia precisam estar definidos antes de concluir a contagem; não é necessário fornecer um comando técnico completo. A aprovação de gravação segue o procedimento abaixo. O cliente de IA precisa seguir as instruções do servidor e ter acesso aos requisitos ou código necessários.

Peça, por exemplo: “Prepare uma contagem APF para a aplicação X, versão Y, usando estas funções e evidências; valide os dados e gere a planilha”. A IA precisa informar grupos, funções, tipos, atividades, TD, AR/TR e justificativas. A metodologia e sua referência contratual devem ser explícitas. O MCP calcula a complexidade e o PF base; o PF equivalente depende dos fatores de atividade informados com sua fonte. Fator ausente deixa o equivalente pendente, sem adotar uma regra contratual por conta própria.

As ferramentas `preparar_contagem_apf`, `validar_contagem_apf` e `gerar_planilha_apf` não gravam registros no AgilePoint. A planilha gerada conserva o formato de importação da aba **Funções**, em C:K, e as justificativas e evidências ficam nos artefatos de conferência. Consulte `KIT_APF.md` para o formato dos dados e o procedimento de importação.

Para cadastrar os dados, identifique uma contagem aberta, consulte seus fatores com `consultar_fatores_contagem` e peça uma simulação com `simular_importacao_rapida`. Mantenha o XLSX e o `.apf.json` juntos. Para o pacote gerado, o MCP confere a integridade, a aplicação/versão e os fatores na simulação e na execução; fatores ausentes, divergentes ou fixos bloqueiam a importação. Confira a prévia e siga a aprovação abaixo antes de `importar_contagem_rapida`. A importação acrescenta funções; não substitui as anteriores nem deve ser repetida para o mesmo conjunto. As observações fora de C:K não são importadas para campos do AgilePoint por esse fluxo.

## Aprovar uma gravação

O pacote usa aprovação **externa** para operações de escrita. A IA primeiro simula a operação e apresenta a prévia e o ID de aprovação. Confira os registros e os valores antes de aprovar.

Para aprovar, abra um terminal na **pasta permanente** do MCP. A IA deve apresentar o comando abaixo já preenchido com a pasta de aprovações criada pelo instalador e o ID retornado pela simulação:

```powershell
$env:APF_APPROVAL_DIR='C:\mesmo\caminho\de\aprovacoes\da\configuracao'
& 'CAMINHO_NODE_EXECUTAVEL' 'CAMINHO_DA_PASTA_PERMANENTE\scripts\approve.mjs' ID_DA_APROVACAO
```

Use os valores retornados pelo instalador: `node_executavel`, `pasta` e `pasta_aprovacoes`. A IA deve substituir todos os exemplos acima antes de apresentar o comando. O comando apresenta a prévia e solicita a confirmação. Depois de aprovar, volte à IA e peça para concluir a operação simulada. A aprovação expira em dez minutos, é de uso único e vale somente para aquela operação. Se expirar ou os dados mudarem, peça uma nova simulação.

Realize os primeiros testes em registros descartáveis identificados claramente, confira o resultado por nova consulta e remova os registros de teste ao terminar. Veja as limitações e como relatar problemas em `LIMITACOES_CONHECIDAS.md`.
