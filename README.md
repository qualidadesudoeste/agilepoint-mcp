# AgilePoint Universal MCP

## Baixar e instalar

Baixe o pacote **agilepoint-mcp-1.2.1.zip** na [release 1.2.1 para testes controlados](https://github.com/qualidadesudoeste/agilepoint-mcp/releases/tag/v1.2.1). Envie o ZIP à sua IA compatível com MCP local e peça **“Instale esse MCP”** ou **“Atualize esse MCP”**. Após conectar, a IA solicita somente as credenciais individuais e pergunta o que você deseja fazer. O guia de uso e as limitações acompanham o pacote.

O botão **Code → Download ZIP** baixa o código-fonte, que exige instalação das dependências e compilação. Para instalação pelo usuário, use o ZIP anexado à release. Não envie credenciais para este repositório nem para issues.

Para desenvolvimento, com Node.js 22 ou superior: `npm ci`, `npm test` e `npm run test:discovery`. Os testes padrão usam dados locais/sintéticos; os scripts de homologação real são separados e exigem configuração explícita. `npm run package:release` gera a distribuição de execução sem fontes, testes ou notas internas.

Versão **1.2.1**. Permite que cada usuário opere, pela própria IA compatível com MCP, as telas que sua conta consegue acessar no AgilePoint/Webrun. O catálogo XML é filtrado pelo mapa de permissões atual da conta antes de liberar as ferramentas universais. A simulação valida seletores publicados depois de abrir Incluir/Alterar, sem gravar, e verifica a capacidade local antes desse POST transitório. Esta versão mantém a importação de planilhas e o envio especializado de Dica de Mestre, sem o kit de cálculo de PF.

## Dica de Mestre

Use `simular_publicacao_dica_mestre` e `publicar_dica_mestre` para enviar título, descrição, Markdown obrigatório e anexos opcionais. `cancelar_publicacao_dica_mestre` descarta uma preparação ainda local; `consultar_minhas_dicas_mestre` consulta as inscrições da conta. A capacidade local `publicar_dica_mestre` é restrita ao formulário `500000385` no modelo de instalação, sem liberar ações personalizadas genéricas. A execução preserva a aprovação configurada e o processo de avaliação do AgilePoint, confere arquivos, consulta o ID da inscrição e relê a documentação. Veja [o guia e os limites de verificação](docs/DICA_DE_MESTRE.md). Os contratos foram capturados no cliente oficial; testes automatizados virtualizam o backend, sem substituir homologação de gravação real com cada perfil.

## Importar e associar funções

O kit de cálculo de PF e a geração de planilhas foram removidos nesta versão. A importação rápida de uma planilha preenchida no modelo do AgilePoint continua disponível: a IA usa `simular_importacao_rapida` e `importar_contagem_rapida` para enviar C:K da aba Funções.

Para distribuir os pontos, informe aplicação, versão/sprint, funções, responsáveis e percentuais que somem 100%. Exemplo: “Na aplicação X, sprint Y, associe a pessoa Z com 100% à função Consultar cliente”. A IA consulta os alvos e prepara `simular_associacao_usuarios_funcoes`. Use o nome completo do cadastro ou `id:123` para identificar a pessoa pelo ID. Homônimos devem ser esclarecidos antes da gravação. A operação substitui os vínculos das funções selecionadas e segue a política de execução automática configurada; a grade é relida para conferir o resultado.


Correções da 2.30.19: a abertura universal por `registro_id` usa os filtros de chave primária já homologados para Aplicação (47) e Contagem (26), em vez de tratar o ID como posição de navegação. `descrever_tela` só marca uma ação universal como disponível quando a capacidade local permite seu uso e a própria tela não a desabilitou. A listagem de contagens normaliza entidades HTML duplamente escapadas, como `&amp;nbsp;`. `verificar_conexao` informa, sem mostrar o ID, se a identidade de lançamento está configurada. Essas correções têm testes locais; o reteste com a conta desenvolvedora no AgilePoint permanece necessário.

## Transporte por endpoints internos

O MCP possui um cliente HTTP interno com autenticação própria por `JSESSIONID` e lista fechada de rotas do Webrun. A senha permanece somente no ambiente do processo. Respostas JavaScript do Webrun são interpretadas como dados com JSON/JSON5; o código retornado pelo servidor não é executado.

Situação atual da migração:

- `listar_telas_disponiveis`: abre o formulário principal 20, extrai o catálogo compactado publicado no componente de menu e chama a regra `Menu - Obter Dados no Servidor`; combina o XML com o mapa de permissões da resposta para retornar apenas itens visíveis e habilitados, respeitando também as permissões dos grupos ancestrais. Respostas sem mapa válido são recusadas;
- `descrever_tela`: valida o formulário contra esse menu, abre `/openform.do` diretamente e interpreta metadados de campos, abas, botões, navegação e grades sem executar o JavaScript devolvido pelo Webrun; valores de senha/token são substituídos por `[PROTEGIDO]`. Para cada botão, informa `endpoint_disponivel` e, quando configurado, a impressão digital do contrato;
- `verificar_cobertura_telas`: percorre apenas as telas do menu autenticado e separa ações com contrato direto, ações cobertas por ferramentas especializadas e ações ainda pendentes de homologação. O inventário de 08/10/2026 está em `COBERTURA_PENDENTE.md`;
- `ler_tela`: abre a tela autorizada por `/openform.do` e percorre cada grade por `/navigate.do`; devolve páginas consultadas, total informado pelo servidor e marca explicitamente leituras interrompidas por `limite_linhas`;
- `simular_operacao_tela`: valida por endpoint a tela, os alvos, os tipos de controle, o estado habilitado, as opções publicadas, o diretório, extensão, MIME e tamanho dos arquivos permitidos; ao encontrar Incluir/Alterar, abre o modo transitório por `/form.do`, lê as opções desse modo e envia Cancelar antes de retornar. Não grava o registro. O valor efetivo de cada seleção fica vinculado ao token e é conferido novamente na execução;
- `executar_operacao_tela`: executa por `/form.do` inclusões, alterações e exclusões padrão publicadas pelo Webrun (`include`, `edit`, `postcancel`, `delete` e `cancel`), resolve lookups por `/search.do`, preserva campos ocultos e CSRF e cancela a edição quando uma etapa falha. Alteração e exclusão exigem que o `pkeys` atual seja o mesmo ID estável vinculado ao token de simulação; após excluir, a tela é reaberta para confirmar que o ID removido não continua carregado. Botões personalizados podem chamar `/executeRule.do` somente quando o contrato exato estiver na lista local permitida;
- `ranking_apf`: abre o formulário, obtém as aplicações autorizadas, aplica data e tipo de análise pela regra `Ranking - atualizar consulta` e percorre a grade por `/navigate.do`, tudo por HTTP. A paginação avança até o servidor retornar uma página vazia ou repetida; se exceder 100 páginas, a chamada falha em vez de declarar um resultado incompleto como completo;
- `ranking_repositorio`: envia período e as categorias exatas pela regra `Ranking do repositório - Mostrar ranking`, percorre a grade por `/navigate.do`, obtém o catálogo pela regra `Dica de Mestre - Obter funcionalidades` e abre os detalhes (`formID=7156`), tudo pela sessão HTTP;
- `listar_contagens`: inicializa `/basic_query.jsp`, envia os filtros para `/search.do`, interpreta as linhas `n.addGridRow(...)` da própria resposta como dados (sem executar o JavaScript) e resolve os IDs originais por `POST /form.do`, tudo na sessão HTTP. A versão 2.28 corrige a falsa listagem vazia provocada por uma navegação posterior que descartava o resultado da busca;
- `listar_funcoes_contagem`: aceita o ID original da contagem, abre diretamente por filtro de chave primária e retorna funções, itens e contribuições. As grades dependentes são lidas por `/gridEdit.do?param=refreshDependence`, com cursor Webrun começando em 1. A versão 2.8 resolve também os IDs originais de itens, contribuições e usuários pelo contrato de edição, cancelando a edição sem gravar;
- `resolver_identificadores`: usa `/search.do` para resolver IDs de aplicação, tipo de contagem, ano de competência, fator de equivalência, usuário de contribuição e desenvolvedor da aplicação;
- `associar_desenvolvedores_aplicacao`: abre a aplicação pelo filtro estável `APF_APLICACAO.APL_COD`, resolve desenvolvedores no lookup do subformulário `7152` e inclui somente ausentes pela grade `/gridEdit.do` (`formID=47`, `comID=1026480`). A operação verifica o estado persistido e tenta remover somente os vínculos criados na tentativa se houver falha; exige perfil gerente/administrador, simulação, autorização conforme o modo, idempotência e `APF_WRITE_ENABLED=true`;
- grade **Funções da contagem**: contrato de inclusão/gravação registrado em `/gridEdit.do` (`formID=26`, `comID=505`), incluindo o ID estável da contagem, revisão, nome e total de PF;
- registro principal da **Contagem**: contrato do cliente Webrun capturado em 29/09/2026. A criação usa `POST /form.do` com `param=include`, preserva os valores padrão de data/usuário/convenções retornados pelo servidor e grava com `param=postcancel`; aplicação, tipo, ano e fator são resolvidos previamente por IDs estáveis;
- grade **Itens da função**: contrato validado com gravação de teste em 07/10/2026 (`formID=26`, `comID=1026482`); inclui ID da função, descrição, tipo de função, código de atividade, TD, AR/TR, complexidade, PF e PF equivalente. O campo `WFRInput762` recebe o código de atividade, não o fator numérico;
- grade **Contribuição/usuários da função**: contrato validado por gravação real em 29/09/2026 (`formID=26`, `comID=1026483`); inclui IDs estáveis de função e usuário e percentual;
- `associar_usuarios_funcoes`: localiza a contagem e os usuários por HTTPS, seleciona as grades dependentes, substitui contribuições por `/gridEdit.do`, verifica IDs/percentuais e tenta restaurar o estado anterior se qualquer função falhar. Exige simulação, aprovação humana externa ou interativa em cliente MCP confiável, idempotência e `APF_WRITE_ENABLED=true`;
- `consultar_fatores_contagem`: lê a tabela de convenções e fatores publicada pelo formulário 26 de uma contagem acessível à conta autenticada; não altera dados;
- `lancar_pontos_funcao`: tanto `acao=usar_existente` quanto `acao=criar` usam somente HTTP. A ferramenta bloqueia contagens fechadas e nomes duplicados, limita a versão a 20 caracteres, cria a contagem por `/form.do`, inclui funções e itens por `/gridEdit.do`, executa o recálculo por `/executeRule.do` e verifica os dados persistidos. Cada item exige `atividade` (`I`, `A`, `E`, `T`, `AV`, `MI`, `AD`, `MA` ou `AP`) e `fator_aplicado` numérico esperado; o fator informado é conferido com a convenção publicada pelo formulário antes da inserção; atividades sem convenção são bloqueadas. Uma divergência no PF equivalente provoca falha, não confirmação falsa. A criação de contagem, função e item foi confirmada por leitura independente com a conta administrativa em 07/10/2026;
- `simular_importacao_rapida` e `importar_contagem_rapida`: leem uma planilha `.xlsx` local autorizada, extraem C:K da aba `Funções` logo abaixo do cabeçalho do modelo, reproduzem pelo endpoint `/executeRule.do` as regras `apf - criar funções com tabela` e `APF - recalcular contagem` do formulário 35, e verificam a quantidade de grupos e itens gravados. O contrato foi capturado e validado com uma tabela sintética na contagem descartável `Teste MCP` em 30/09/2026;
- relatórios **Analítico**, **PDF** e **Excel**: replay direto validado ao vivo em 29/09/2026 usando apenas o ID da contagem. A ferramenta `exportar_relatorio_contagem` chama `/executeRule.do` em Windows-1252, valida o caminho temporário e grava o resultado em `APF_EXPORT_DIR`;
- relatórios **Acompanhamento apf de Sprints**, **Relatório de Acompanhamento** e **Relatório de premiações**: ferramentas especializadas exigem os filtros exatos publicados na tela autorizada, chamam `/executeRule.do`, validam o PDF recebido e salvam em `APF_EXPORT_DIR`. Os três contratos foram executados com contas autorizadas em 08/10/2026, sem salvar o arquivo durante a homologação;
- autenticação HTTP: executada diretamente por `GET /open.do`, `GET /openform.do` e `POST /executeRule.do`;
- todas as ferramentas, inclusive diagnóstico de rotas, usam somente HTTPS. A versão 2.24.0 removeu o Playwright, o Chromium e os antigos caminhos de interface;
- uploads multipart: contratos autorizados em `APF_UPLOAD_ACTIONS_FILE` abrem `/upload.jsp`, interpretam o formulário multipart publicado pelo próprio Webrun e enviam o arquivo pela sessão HTTP autenticada. O caminho precisa estar dentro de `APF_UPLOAD_DIR`; extensão, MIME e tamanho são validados antes da simulação e novamente antes do envio;
- downloads genéricos: contratos autorizados em `APF_DOWNLOAD_ACTIONS_FILE` podem obter o caminho por retorno de regra, valor de componente ou valor literal autorizado e baixar por `/download`. Prefixo do caminho no servidor, extensão, MIME e tamanho são validados; a resposta é gravada somente em `APF_EXPORT_DIR`;
- botões, uploads ou downloads sem contrato autorizado e alteração/exclusão sem identificador estável são bloqueados em vez de recorrer à interface. Os contratos são vinculados à simulação por SHA-256, impedindo que uma configuração alterada seja executada com um token antigo;
- respostas de grades que contêm expressões JavaScript são interpretadas como dados sem executar o código retornado;

Isso não é uma API REST oficial do AgilePoint: são endpoints internos e stateful do Webrun. Mudanças na versão do sistema exigem nova validação de contrato.

O AgilePoint continua sendo a autoridade de acesso. As ferramentas universais consultam o menu e suas permissões a cada operação, sem reutilizar uma lista antiga após alterações nos grupos. Atalhos APF especializados têm fluxos de acesso próprios e não são autorizados apenas por esta lista; devem ser homologados separadamente por perfil. O MCP não eleva permissões e bloqueia navegação para outros domínios.

## Ferramentas universais

- `listar_telas_disponiveis`: descobre por endpoint os módulos e telas presentes no menu autorizado do usuário.
- `descrever_tela`: abre por endpoint uma tela autorizada e mapeia campos, opções, botões, abas, tabelas e alertas.
- `ler_tela`: retorna dados e valores por endpoint, pagina as grades e informa se a leitura está completa ou truncada pelo limite.
- `simular_operacao_tela`: valida operações por endpoint, sem executá-las, e gera um token temporário de confirmação.
- `executar_operacao_tela`: executa por endpoint somente uma simulação confirmada e auditada; contratos personalizados desconhecidos são recusados.

Operações suportadas:

- `preencher`: campos de texto, números e datas;
- `selecionar`: selects e seletores Webrun;
- `marcar`: checkbox e controles equivalentes;
- `clicar`: navegação padrão `Incluir`, `Alterar`, `Excluir`, `Gravar`, `Cancelar` e `Atualizar`, além de botões personalizados presentes na lista local permitida; ações destrutivas ficam destacadas na solicitação de aprovação humana;
- `anexar`: envia um arquivo por `/upload.jsp` quando o componente possui contrato autorizado; aceita como alvo campos de arquivo ou botões de upload publicados pela tela;
- `baixar`: gera e baixa arquivos por `/executeRule.do` e `/download` quando o botão possui contrato autorizado; relatórios específicos continuam disponíveis pelos atalhos existentes;
- botões personalizados não configurados e alterações/exclusões sem ID estável são recusados antes do envio.

As ferramentas específicas de APF continuam disponíveis como atalhos para ranking, contagens, pontos de função e associação de responsáveis.

## Modelo de uso

Cada usuário deve executar sua própria instância local do MCP com sua própria conta AgilePoint. No pacote público, a IA solicita as credenciais após a conexão e chama `autenticar_agilepoint`; elas ficam em memória no processo MCP. O cliente de IA pode reter os dados no histórico, como explicado na seção de autenticação. A configuração privada por ambiente continua disponível como alternativa fora de `APF_AUTH_MODE=chat`.

Em uma implantação centralizada, crie um processo MCP isolado por usuário. Nunca compartilhe sessão ou credenciais entre pessoas. A sessão HTTP stateful do Webrun também deve permanecer isolada por processo e por usuário.

## Instalação

Requer Node.js 22 ou superior.

```powershell
npm ci
npm run build
npm test
npm run test:discovery
npm run smoke
npm audit --omit=dev
```

Essa instalação é suficiente para todas as ferramentas por endpoint, inclusive criar a contagem, lançar funções, descobrir contratos HTTP e executar inclusões, alterações e exclusões universais padrão. O pacote não possui dependência de navegador.

Os testes locais não substituem a homologação por perfil no AgilePoint. Para conferir também a leitura da planilha de referência, execute `npm test` com `APF_TEST_MODEL_XLSX` apontando para uma cópia local de `FPA - MODELO.xlsx`. Em 07/10/2026, a conta desenvolvedora gravou uma função de teste e importou a planilha-modelo com 8 grupos e 68 itens na contagem descartável 4672; a releitura confirmou os dados, a idempotência bloqueou repetições e as funções de teste foram removidas. A conta gerente exportou PDF e a administrativa simulou o mês sem criar contagem. Em 08/10/2026, a desenvolvedora criou uma contagem completa, a gerente associou uma conta de teste à aplicação e a administradora criou uma contagem pela sequência universal Incluir → preencher → Gravar; os três registros/vínculos foram conferidos e removidos. Uma falha de resposta injetada confirmou que POST não é repetido automaticamente e que a chave de idempotência permanece bloqueada em estado incerto. Esses resultados não provam todas as telas e operações de cada perfil.

Depois de configurar `APF_USERNAME` e `APF_PASSWORD` no ambiente privado de **cada** conta de teste, execute `npm run smoke:live` em uma instância separada por perfil. Ele consulta conexão, permissões dos formulários, menu e, se autorizado, uma página de contagens; imprime apenas indicadores e quantidades, sem nomes, registros ou credenciais. O teste não grava nada. Falta de acesso a uma tela específica é registrada como permissão ausente, não como falha de autenticação.

Para ampliar a homologação de leitura, configure opcionalmente `APF_HOMOLOGATION_COUNT_ID` com o ID de uma contagem descartável acessível à conta. Defina também `APF_HOMOLOGATION_APPLICATION` e `APF_HOMOLOGATION_VERSION` para exigir correspondência exata, e `APF_HOMOLOGATION_FORBIDDEN_FORM_IDS` com IDs separados por vírgula para verificar telas que o perfil não deve ver. Para testar exportação, configure ainda `APF_HOMOLOGATION_EXPORT_FORMAT=pdf|analitico|excel` e um `APF_EXPORT_DIR` privado. O script usa `APF_WRITE_ENABLED=false`, não imprime dados da contagem nem caminho do arquivo exportado e falha se uma expectativa não for atendida. Execute-o separadamente com cada conta; ele não substitui os testes reais de gravação.

No Windows, `scripts/homologar-perfil-interativo.ps1` solicita usuário e senha no terminal, com a senha oculta, executa `smoke:live` e restaura as variáveis do processo ao terminar. Ele não grava credenciais no projeto ou no ZIP. Exemplo para uma contagem descartável já identificada:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/homologar-perfil-interativo.ps1 -Perfil desenvolvedor -ContagemId 4672 -Aplicacao 'Teste MCP' -Versao 'MCP-FIX6-20261007'
```

Rode de novo com `-Perfil gerente` e a conta individual correspondente. Para exportação, acrescente `-Exportar pdf -DiretorioExportacao 'C:\caminho\privado'`. Para lançamento descartável, acrescente `-GravarTeste` ou `-CriarContagemTeste` com a conta desenvolvedora; para testar a planilha-modelo local, acrescente `-ImportarTeste -PlanilhaTeste 'C:\caminho\FPA - MODELO.xlsx'`. Com gerente, `-GravarGerenteTeste` pede no terminal uma conta desenvolvedora de teste não associada. Com administrador, `-GravarUniversalTeste` testa a criação pela ferramenta universal. Os scripts verificam a limpeza e mantêm a auditoria; não os execute sobre registros de produção. Não cole a senha no comando nem no chat. Os fatores de PF além dos já capturados continuam sujeitos à confirmação da regra oficial do AgilePoint.

Após as verificações, `npm run package:release` gera `agilepoint-mcp-VERSAO.zip` no diretório pai e imprime seu SHA-256. A distribuição usa uma lista fechada: programa compilado, manifesto/lock somente de execução, configuração sem credenciais, política padrão, aprovação/diagnóstico, documentação de usuário de `docs/`. Fontes, fixtures, testes, scripts de desenvolvimento, `COBERTURA_PENDENTE.md` e `INSTRUCOES_OUTRO_CHAT.md` permanecem apenas na pasta de desenvolvimento. O ZIP é conferido contra a lista antes de ser entregue. Se já existir um ZIP com a mesma versão, a geração é recusada.

## Autenticação pelo chat (credenciais opcionais na instalação)

Instale o servidor MCP por STDIO sem `APF_USERNAME` e `APF_PASSWORD`. Na conversa, o usuário informa seu login e senha do AgilePoint; a IA chama `autenticar_agilepoint` uma vez com esses valores. O MCP autentica por HTTPS, mantém a sessão somente na memória do processo e não devolve nem salva a senha. Para trocar de conta, reinicie o processo MCP. O perfil local é inferido do menu da conta: Funcionalidade (7156) identifica administrador; Relatório de Acompanhamento (9148) ou Acompanhamento de sprint (500000382) identificam gerente; outros menus não vazios recebem desenvolvedor. Essa classificação apenas seleciona as capacidades locais; o AgilePoint continua decidindo o acesso a cada tela e operação. A identidade usada na auditoria é o login autenticado, sem exigir `APF_COLLABORATOR_ID` neste modo.

**Atenção:** ao digitar a senha no chat, o cliente de IA pode guardá-la no histórico e nos registros das chamadas de ferramenta. O MCP não controla essa retenção. Use esse modo somente em cliente aprovado pela organização, com histórico e acesso adequadamente protegidos. Em ambientes que não possam aceitar esse risco, mantenha a configuração privada de credenciais fora do chat. Nunca peça nem repita a senha na resposta do MCP.

O login por chat dispensa a configuração individual de credenciais, mas não substitui as políticas da instalação. O administrador do pacote ainda define `APF_CAPABILITIES_FILE` para habilitar escrita padrão de desenvolvedor/gerente e os diretórios privados de auditoria/aprovação. Após login por chat, `APF_WRITE_ENABLED` passa a `true` se estava indefinido; uma configuração explícita `false` permanece bloqueada. O instalador configura `automatic`; configurações de aprovação explícitas continuam disponíveis. Ações personalizadas e uploads continuam dependendo de contratos homologados.

## Variáveis

```env
APF_BASE_URL=https://agilepoint.techpulseglobal.com.br
# APF_USERNAME=usuario_individual   # opcional; omita para usar autenticar_agilepoint
# APF_PASSWORD=senha_individual     # opcional; omita para usar autenticar_agilepoint
APF_MCP_ROLE=desenvolvedor
APF_COLLABORATOR_ID=id_estavel_do_usuario
APF_COLLABORATOR_NAME=nome_do_usuario
APF_WRITE_ENABLED=false
APF_WRITE_APPROVAL_MODE=automatic
APF_AUDIT_DIR=C:\diretorio-privado\auditoria
APF_APPROVAL_DIR=C:\diretorio-privado\aprovacoes
APF_UPLOAD_DIR=C:\diretorio-restrito\uploads
APF_EXPORT_DIR=C:\diretorio-restrito\exports
APF_CUSTOM_ACTIONS_FILE=C:\diretorio-privado\custom-actions.json
APF_UPLOAD_ACTIONS_FILE=C:\diretorio-privado\upload-actions.json
APF_DOWNLOAD_ACTIONS_FILE=C:\diretorio-privado\download-actions.json
APF_CAPABILITIES_FILE=C:\diretorio-privado\capabilities.json
APF_AUDIT_INCLUDE_VALUES=false
APF_HTTP_TIMEOUT_MS=30000
APF_HTTP_MAX_RESPONSE_BYTES=26214400
APF_REPORT_MAX_BYTES=52428800
APF_PAGINATION_MAX_BYTES=67108864
APF_PAGINATION_MAX_ROWS=100000
APF_MAX_PENDING_SIMULATIONS=20
APF_MAX_PENDING_SIMULATION_BYTES=10485760
APF_MAX_APPROVAL_RECORDS=100
APF_MAX_APPROVAL_STORAGE_BYTES=52428800
APF_APPROVAL_RETENTION_DAYS=30
APF_DISCOVERY_MODE=false
APF_NETWORK_LOG_DIR=C:\diretorio-privado\diagnostico
APF_NETWORK_LOG_MAX_BYTES=52428800
APF_DISCOVERY_INCLUDE_VALUES=false
```

Use `APF_WRITE_ENABLED=true` somente em instalações homologadas. Downloads isolados não exigem essa chave porque não alteram registros; sequências que contenham qualquer outra operação continuam bloqueadas quando ela está desligada. `APF_AUDIT_INCLUDE_VALUES=false` omite valores, nomes, documentos e caminhos em todas as auditorias; o hash integral permanece disponível para idempotência. `APF_BASE_URL` aceita somente HTTPS. `APF_AUDIT_DIR` e `APF_EXPORT_DIR` são obrigatórios nos fluxos correspondentes. `APF_APPROVAL_DIR` é obrigatório apenas para operações com aprovação externa. As pastas devem ser privadas e diferentes para cada usuário. Os limites `APF_PAGINATION_*`, `APF_MAX_PENDING_*` e `APF_MAX_APPROVAL_RECORDS` evitam exaustão de memória e disco; não os aumente sem dimensionamento e monitoramento.

Copie `capabilities.example.json` para uma pasta privada e configure `APF_CAPABILITIES_FILE`. Administradores podem usar a camada universal; desenvolvedores e gerentes recebem por padrão somente downloads e precisam de autorização explícita por formulário e tipo de operação. O AgilePoint continua aplicando as permissões da conta autenticada.

Se a política da organização permitir que os perfis **desenvolvedor** e **gerente** incluam, alterem e excluam em todos os formulários publicados no menu da própria conta, use `capabilities.developer-all-accessible.example.json` como modelo para um arquivo privado e configure seu caminho em `APF_CAPABILITIES_FILE`. O nome do arquivo foi mantido por compatibilidade; o conteúdo agora contempla ambos os perfis. O coringa `formIds: ["*"]` cobre também formulários que sejam concedidos ao usuário no futuro; revise a política quando o menu mudar. Ele **não** torna acessível uma tela fora do menu, não habilita botões desabilitados pelo Webrun e não concede `custom_action` nem `upload`. Para concluir inclusão/edição, o modelo também inclui `field_write`, `save` e `cancel`. A aprovação de escrita configurada (por padrão, externa) continua obrigatória.

Não conceda `include`, `edit` ou `delete` a um perfil apenas porque o botão aparece na tela. Valide a permissão real da conta e aprove cada capacidade/formulário separadamente. No modo de credenciais por ambiente, o responsável pela instalação deve configurar `APF_COLLABORATOR_ID` para lançar PF; no login pelo chat, o MCP usa o login autenticado como identidade estável de auditoria, sem apresentá-lo como ID numérico do cadastro do AgilePoint. Evite armazenar `APF_PASSWORD` em texto puro no arquivo de configuração do cliente de IA; use um mecanismo privado de credenciais do ambiente.

A política opcional `APF_WRITE_APPROVAL_MODE=external` exige aprovação humana fora do canal controlado pela IA. A simulação cria uma solicitação em `APF_APPROVAL_DIR`; o comando local mostra a prévia canônica completa e só aprova quando a pessoa digita a confirmação que contém o ID:

```powershell
$env:APF_APPROVAL_DIR='C:\diretorio-privado\aprovacoes'
npm run approve -- ID_DA_APROVACAO
```

A aprovação é vinculada ao usuário, à operação e ao hash integral da simulação, expira em dez minutos e só pode ser usada uma vez.

Para permitir que um pedido à IA crie contagens ou edite registros sem voltar ao terminal, configure **na instalação individual** `APF_WRITE_APPROVAL_MODE=delegated` e `APF_WRITE_ENABLED=true`. Reinicie o cliente MCP. A IA chama a simulação e, se ela for válida, chama a ferramenta de execução com `confirmacao_token` e `chave_idempotencia`, sem `aprovacao_id`. Essa delegação é uma decisão explícita do responsável pela instalação; texto encontrado em telas ou relatórios não deve ser tratado pela IA como autorização do usuário. O MCP não consegue comprovar sozinho que uma chamada de ferramenta veio de um pedido humano direto. Por isso, use conta individual com acesso mínimo, capacidades locais limitadas, auditoria privada e homologação prévia. O AgilePoint continua negando ações não permitidas à conta.

Mesmo em `delegated`, exclusões e ações personalizadas marcadas como destrutivas exigem aprovação externa. `associar_usuarios_funcoes` também exige aprovação externa, pois substitui as associações atuais em lote. O modo `automatic`, configurado pelo instalador 1.2.1, permite executar também essas operações após a simulação interna e o comando do usuário, sem confirmação adicional.

Para aprovar **na interface da IA, sem terminal**, configure `APF_WRITE_APPROVAL_MODE=elicitation`, `APF_TRUSTED_CLIENT_ELICITATION=true` e `APF_WRITE_ENABLED=true` na instalação individual; depois reinicie o cliente MCP. A IA simula e chama a execução **sem** `aprovacao_id`. O servidor envia ao cliente uma solicitação de confirmação de formulário com a prévia integral (até 12.000 caracteres), operação e SHA-256. A pessoa precisa digitar a frase exibida. Recusa, cancelamento, frase incorreta, prévia divergente ou cliente sem suporte a `elicitation.form` bloqueiam a gravação. A confirmação vale somente para a execução atual; a simulação e a chave de idempotência continuam obrigatórias. Prévia maior que o limite exige o modo `external`.

**Limite de confiança:** o protocolo MCP não comprova criptograficamente que foi uma pessoa, e não o agente, quem respondeu ao formulário. Ative esse modo apenas em clientes que apresentem a solicitação diretamente ao usuário e não permitam resposta automática pelo modelo. A mera frase “aprovado” no chat não satisfaz o controle no servidor. Homologue o comportamento do cliente antes de usar em produção; se ele não oferecer essa garantia, mantenha `external`. O AgilePoint continua aplicando as permissões da conta autenticada.

`verificar_conexao` informa o modo de aprovação configurado, se a gravação está habilitada e se o cliente MCP declarou suporte a `elicitation.form`, sem devolver credenciais. O suporte declarado é apenas um diagnóstico técnico; confirme visualmente, no cliente real, que a solicitação é exibida à pessoa. `npm test` também exercita a troca MCP de confirmação com cliente local simulado, incluindo recusa, cancelamento e cliente sem suporte.

## Ações personalizadas por endpoint

Alguns botões Webrun chamam regras Java internas com parâmetros próprios. Para não executar JavaScript arbitrário recebido da tela, o MCP aceita somente contratos declarados em um arquivo JSON local. Copie `custom-actions.example.json` para uma pasta privada, ajuste os valores a partir de uma captura validada em homologação e indique o caminho em `APF_CUSTOM_ACTIONS_FILE`.

```json
{
  "version": 1,
  "actions": [
    {
      "formId": "47",
      "componentId": "1136100",
      "ruleName": "REGRA_VALIDADA",
      "pType": "2",
      "parentRID": "-1",
      "parameters": [
        { "name": "P_0", "source": "component_value", "componentId": "665" },
        { "name": "P_1", "source": "record_id" }
      ],
      "destructive": false,
      "requiresRecordId": true,
      "refreshAfter": true
    }
  ]
}
```

As fontes aceitas são `literal`, `component_value` e `record_id`; nomes de parâmetros ficam restritos a `P_N` e `F_N_N`. Não coloque credenciais nem dados pessoais em valores literais. Use `destructive: true` quando a regra alterar ou remover dados. Qualquer mudança no arquivo invalida a simulação anterior, portanto a IA precisa simular novamente antes de executar.

## Uploads multipart por endpoint

Copie `upload-actions.example.json` para uma pasta privada e configure `APF_UPLOAD_ACTIONS_FILE`. Cada contrato identifica exatamente o formulário e o componente que inicia o upload, a regra de recebimento, a regra opcional de validação, parâmetros e limites do arquivo. Os contratos devem ser capturados e validados em homologação.

Ao executar `anexar`, o MCP:

1. confirma que a tela está no menu do usuário e que o registro estável continua sendo o mesmo da simulação;
2. restringe o arquivo a `APF_UPLOAD_DIR` e valida extensão, MIME e até 100 MB por contrato;
3. abre o popup `/upload.jsp` usando os parâmetros oficiais de `ebfUploadFile2` ou `ebfUploadMultipleFiles2`;
4. extrai do HTML real o destino, o campo `file` e os campos ocultos/CSRF;
5. envia o multipart na mesma sessão autenticada e recusa redirecionamento para login, erro ou acesso negado.

O caminho do arquivo é omitido da auditoria. O conteúdo não é armazenado pelo MCP; ele é lido somente no momento do envio.

## Downloads genéricos por endpoint

Copie `download-actions.example.json` para uma pasta privada e configure `APF_DOWNLOAD_ACTIONS_FILE`. O contrato associa um botão ao modo de obter o caminho do arquivo: `rule_return`, `component_value` ou `literal`. Para `rule_return`, parâmetros podem vir de valores literais, componentes da tela ou do ID estável do registro.

O MCP aceita somente caminhos retornados dentro de `allowedPathPrefixes`, rejeita URL externa, caminho de rede e navegação `..`, e chama a rota oficial `/download?download_file=...`. Antes de gravar em `APF_EXPORT_DIR`, valida status HTTP, sessão, acesso, MIME, extensão, nome sugerido e limite máximo de 100 MB. A leitura da resposta também é interrompida assim que o limite do contrato é ultrapassado.

## Diagnóstico de webservices internos

O modo de diagnóstico é desligado por padrão. Para mapear as requisições que o próprio AgilePoint faz, defina `APF_DISCOVERY_MODE=true`, escolha uma pasta privada em `APF_NETWORK_LOG_DIR` e reinicie o MCP. Consulte `verificar_diagnostico_rede` e execute apenas operações controladas de homologação.

O MCP cria um arquivo JSONL contendo método, rota, tipo de recurso, status, formato dos corpos e hashes. Use `analisar_diagnostico_rede` depois do fluxo para agrupar as rotas e destacar candidatos a webservice. A captura:

- limita-se ao domínio de `APF_BASE_URL`;
- ignora o envio do formulário de login;
- não registra cookies, cabeçalhos de autorização ou tokens;
- omite chaves de senha, CPF, CNPJ, documento, telefone e e-mail;
- registra apenas a estrutura dos valores por padrão;
- limita corpos de resposta a 1 MB.

Mantenha `APF_DISCOVERY_INCLUDE_VALUES=false` em produção. Mesmo sanitizado, o arquivo deve ser tratado como informação técnica restrita. Ao terminar a análise, volte `APF_DISCOVERY_MODE=false`, reinicie o MCP e remova os arquivos conforme a política de retenção da organização.

Para executar uma descoberta somente de leitura pelo terminal, use `npm run discover:endpoints`. O script solicita usuário e senha interativamente, não grava as credenciais e consulta conexão, contagens e ranking de APF antes de apresentar os candidatos encontrados.

## Conectar à IA

### Codex

```toml
[mcp_servers.agilepoint]
command = "node"
args = ["C:\\CAMINHO\\agilepoint-mcp\\dist\\index.js"]
env_vars = ["APF_BASE_URL", "APF_USERNAME", "APF_PASSWORD", "APF_MCP_ROLE", "APF_COLLABORATOR_ID", "APF_COLLABORATOR_NAME", "APF_WRITE_ENABLED", "APF_WRITE_APPROVAL_MODE", "APF_AUDIT_DIR", "APF_APPROVAL_DIR", "APF_UPLOAD_DIR", "APF_EXPORT_DIR", "APF_CUSTOM_ACTIONS_FILE", "APF_UPLOAD_ACTIONS_FILE", "APF_DOWNLOAD_ACTIONS_FILE", "APF_CAPABILITIES_FILE", "APF_AUDIT_INCLUDE_VALUES", "APF_HTTP_TIMEOUT_MS", "APF_HTTP_MAX_RESPONSE_BYTES", "APF_REPORT_MAX_BYTES", "APF_PAGINATION_MAX_BYTES", "APF_PAGINATION_MAX_ROWS", "APF_MAX_PENDING_SIMULATIONS", "APF_MAX_PENDING_SIMULATION_BYTES", "APF_MAX_APPROVAL_RECORDS", "APF_MAX_APPROVAL_STORAGE_BYTES", "APF_APPROVAL_RETENTION_DAYS", "APF_DISCOVERY_MODE", "APF_NETWORK_LOG_DIR", "APF_NETWORK_LOG_MAX_BYTES", "APF_DISCOVERY_INCLUDE_VALUES"]
startup_timeout_sec = 30
tool_timeout_sec = 1800
```

### Claude Desktop, Cursor e outros clientes MCP

```json
{
  "mcpServers": {
    "agilepoint": {
      "command": "node",
      "args": ["C:\\CAMINHO\\agilepoint-mcp\\dist\\index.js"]
    }
  }
}
```

O processo herda somente as variáveis opcionais configuradas pelo administrador. Sem `APF_USERNAME` e `APF_PASSWORD`, peça à IA que chame `autenticar_agilepoint` com as credenciais informadas na conversa antes de consultar ou gravar. Reinicie a IA após alterar a instalação.

## Exemplo universal

Primeiro, a IA consulta `listar_telas_disponiveis` e `descrever_tela`. Depois simula:

```json
{
  "tela": "Cadastro de exemplo",
  "operacoes": [
    { "tipo": "preencher", "alvo": "Descrição", "valor": "Novo registro" },
    { "tipo": "selecionar", "alvo": "Situação", "valor": "Ativo" },
    { "tipo": "clicar", "alvo": "Gravar registro (Ctrl+S)" }
  ],
  "justificativa": "Cadastro solicitado pelo usuário"
}
```

Em `external`, `simular_operacao_tela` retorna o token e um `aprovacao_id`. Após revisar a prévia, a pessoa executa `npm run approve -- ID_DA_APROVACAO`; só então a IA chama:

```json
{
  "confirmacao_token": "TOKEN_DA_SIMULACAO",
  "chave_idempotencia": "chave-unica-do-sistema",
  "aprovacao_id": "ID_APROVADO_FORA_DA_IA"
}
```

Em `delegated`, para uma criação ou edição não destrutiva, a simulação retorna `requer_aprovacao_humana: false` e a IA pode chamar a execução imediatamente, omitindo `aprovacao_id`. O usuário pode dar um único comando em linguagem natural; as duas chamadas MCP acontecem nos bastidores.

Em `elicitation`, a simulação retorna `requer_aprovacao_humana: true` sem `aprovacao_id`. A IA chama a execução com `confirmacao_token` e `chave_idempotencia`; o próprio cliente MCP apresenta a prévia e solicita a confirmação. Isso também se aplica às exclusões, desde que o cliente seja confiável e tenha suporte ao formulário interativo.

Para alterar ou excluir um registro específico, informe `registro_id` na simulação. Na tela **Funcionalidade**, a exclusão também exige `titulo_esperado` igual ao título publicado para o ID; o MCP relê o registro e pesquisa a grade antes e depois da operação. Em `automatic`, exclusões solicitadas pelo usuário executam após validação sem confirmação extra. Exclusões nunca usam o modo `delegated`: em `external`, a pessoa aprova com `npm run approve -- ID_DA_APROVACAO`; em `elicitation`, confirma no formulário apresentado pelo cliente MCP. Um HTTP 200 sem desaparecimento confirmado do registro é tratado como falha, sem repetição automática.

```json
{
  "tela": "Funcionalidade",
  "registro_id": "2100",
  "titulo_esperado": "Título exato do registro",
  "operacoes": [{ "tipo": "clicar", "alvo": "Excluir registro" }]
}
```

## Atalhos de APF

- `simular_importacao_rapida`
- `importar_contagem_rapida`
- `simular_lancamento_pf`
- `lancar_pontos_funcao`
- `consultar_meus_lancamentos`
- `listar_contagens`
- `listar_funcoes_contagem`
- `exportar_relatorio_contagem`
- `resolver_identificadores`
- `ranking_apf`
- `ranking_repositorio`
- `simular_associacao_usuarios_funcoes`
- `associar_usuarios_funcoes`
- `simular_associacao_desenvolvedores_aplicacao`
- `associar_desenvolvedores_aplicacao`
- `verificar_conexao` (informa conexão, autenticação e acesso a cada formulário separadamente; falta de acesso a uma tela não é falha de login)
- `verificar_diagnostico_rede`
- `analisar_diagnostico_rede`
- `validar_endpoint_ranking_apf`

### Importação rápida a partir do modelo FPA

1. Coloque o `.xlsx` em uma pasta privada deste usuário e configure `APF_UPLOAD_DIR` para essa pasta. O arquivo precisa estar dentro dela; o MCP não lê caminhos externos nem envia o `.xlsx` ao AgilePoint.
2. Informe à IA o ID original da contagem e o caminho absoluto da planilha. Ela deve chamar `simular_importacao_rapida` com `contagem_id` e `caminho_planilha`, conferir aplicação, versão, intervalo, grupos, itens e amostra.
3. Para gravar, chame `importar_contagem_rapida` com o `confirmacao_token`, uma `chave_idempotencia` exclusiva e, no modo `external`, o `aprovacao_id` aprovado fora da IA. A gravação requer `APF_WRITE_ENABLED=true` e acesso da conta ao formulário.

O extrator procura na coluna C da aba `Funções` o cabeçalho `Função Transacional (EE, CE, SE) ou Função de Dados (ALI, AIE)`. Copia as linhas seguintes de C a K, incluindo separadores internos, até a última linha preenchida. C:G mescladas formam a descrição; H é o tipo, I a atividade, J o TD e K o AR/TR. Linhas com apenas a descrição criam grupos; linhas com tipo criam itens. A planilha de referência `FPA - MODELO.xlsx` produz `C12:K94`, com 8 grupos, 68 itens e 7 linhas separadoras. A prévia não grava nada. A execução relê o arquivo e rejeita mudanças de hash antes de escrever. Não repita automaticamente se a resposta ficar incerta: consulte a contagem e use uma nova simulação somente após conferir o estado real.

### Critérios de liberação

Antes de distribuir a cada equipe, valide com contas individuais de desenvolvedor e gerente em homologação as telas efetivamente usadas por cada equipe. A criação completa de contagem, a sequência universal Incluir → selecionar Mês → Gravar, a importação rápida, a escrita de associação pela gerente e a exportação PDF passaram em testes descartáveis. Uma conexão TCP de teste foi encerrada após receber o POST; a operação não foi repetida e a chave ficou em estado incerto. O formulário 26 publicou fatores por atividade em uma contagem real, que passaram a ser consultados e validados antes da escrita. Atividades não publicadas na contagem são bloqueadas; a política de negócio ainda deve ser homologada com o responsável pelo AgilePoint. Não use uma conta administrativa compartilhada. Contratos personalizados de botões, uploads e downloads requerem validação própria por formulário. A camada universal não promete suporte automático a componentes Webrun inteiramente customizados.

O ranking do repositório retorna a nota e a ordem definidas pela regra do AgilePoint; o MCP não calcula esses valores nem conhece a fórmula ou o desempate. A `posicao` é a ordem da linha, inclusive quando duas notas exibidas são iguais. A fórmula só pode ser documentada após obter a implementação da regra no sistema de origem.

## Proteções

- somente telas descobertas no menu autenticado podem ser abertas;
- somente a origem HTTPS configurada em `APF_BASE_URL` é permitida, inclusive em redirecionamentos;
- campos de senha, token e autenticação são bloqueados na camada universal;
- escrita exige perfil/capacidade autorizados, `APF_WRITE_ENABLED=true`, simulação e idempotência; no modo padrão também exige aprovação humana externa de uso único;
- idempotência é reservada em disco antes da chamada remota e bloqueia repetição quando o resultado é incerto;
- todas as respostas HTTP têm limite de tempo e tamanho;
- chamadas são serializadas dentro de cada sessão;
- upload é validado pelos bytes exatos e download/relatórios têm limite, MIME e assinatura verificados;
- auditoria omite valores por padrão e nunca registra senha, cookie ou token de sessão.

## Cobertura

A camada universal cobre controles HTML e componentes comuns do Webrun: campos, selects, checkboxes, botões, links, abas, grades, uploads e downloads. Componentes totalmente customizados podem exigir um adaptador específico; nesses casos, adicione uma ferramenta especializada sem remover as proteções universais.

## Configuração inicial conforme a operação

Depois de conectar, a IA solicita somente Usuário e Senha ainda ausentes, autentica e pergunta “O que você deseja fazer no AgilePoint?”. Se a tarefa já tiver sido informada, aproveita o pedido. A autenticação aceita `objetivo` opcional e exige somente as credenciais. Projeto e Sprint são solicitados apenas quando necessários para uma operação de Contagem, sem bloquear Dica de Mestre, consultas ou alterações em outras telas. O contexto em memória é opcional. A importação por planilha preenchida é preservada e não exige o kit removido. Veja o roteiro em `docs/README_TESTADORES.md`.

## Atualização e diagnóstico 1.2.1

O instalador reconhece instalações verificadas, incluindo 1.0.0 sem marcador, preserva dados e políticas personalizadas e não duplica conexões antigas conflitantes. Windows usa Instalar.ps1; macOS/Linux usam Node 22+ e npm com `node instalar.mjs --cliente detectar`. Após reconectar, `diagnosticar_configuracao` deve confirmar a versão 1.2.1. O diagnóstico distingue política local, recusa identificada do AgilePoint, transporte e origem indeterminada, sem retornar credenciais. Veja o roteiro em docs/README_TESTADORES.md e os limites em docs/RELEASE_1.2.1.md.
