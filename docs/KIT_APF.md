# Kit de contagem APF — versão 1.1.2

O kit prepara e confere uma contagem antes de seu cadastro no AgilePoint. A IA identifica as funções a partir dos requisitos e das evidências; o MCP recebe esses dados estruturados, calcula complexidade e PF base e gera os artefatos para revisão. Ele não executa scripts enviados pela pessoa ou gerados pela IA.

## Ferramentas

- `iniciar_contagem_guiada`: aceita só o nome da tela e o contexto disponível, devolvendo as pendências e o roteiro para conduzir a análise e o cadastro.

- `preparar_contagem_apf`: valida os dados e devolve a contagem calculada, os fatores aplicados e os avisos.
- `validar_contagem_apf`: confere os dados e permite comparar os totais com valores esperados; divergências precisam ser resolvidas antes de prosseguir.
- `gerar_planilha_apf`: gera o XLSX a partir do modelo incluído no pacote e um JSON de conferência. Os arquivos são locais; essa ferramenta não grava dados no AgilePoint.

A instalação já inclui os recursos necessários. Não é preciso instalar Python, LibreOffice ou um navegador para usar o kit.

## Pedido simples do desenvolvedor

> Faça a contagem de PF da tela Cadastro de clientes e cadastre a contagem no Agile.

A IA recebe a orientação de chamar `iniciar_contagem_guiada`, aproveitar os requisitos e arquivos já disponíveis e perguntar somente o que faltar: aplicação, versão/sprint, escopo da entrega, metodologia ou informações funcionais. O desenvolvedor não precisa conhecer os nomes das ferramentas nem informar previamente os valores de TD e AR/TR: a IA os propõe com evidências e esclarece as lacunas da análise.

Depois, a IA prepara e valida a contagem com o kit, localiza ou conduz a criação de uma contagem vazia, consulta funções existentes e fatores, gera os artefatos e executa o fluxo de simulação e importação para a aba **Funções**. Ao terminar, consulta novamente os itens e totais. Aprovações continuam conforme o modo da instalação; a IA não altera esse modo para concluir o pedido.

Clientes que oferecem prompts MCP também podem selecionar `contar_tela_e_cadastrar` e informar o nome da tela. Os demais usam as instruções e a ferramenta de orientação. O servidor não contém um modelo de IA para analisar requisitos: a análise e a sequência de chamadas são realizadas pela IA do cliente, que precisa ter acesso às fontes e seguir o roteiro. O comando simples não garante uma contagem correta se os dados funcionais estiverem incompletos.

Nesse fluxo, “anexar a contagem no Agile” significa cadastrar os grupos e itens na aba Funções. Upload do XLSX como anexo é uma operação diferente e requer suporte específico ao formulário.

## Informações para preparar

### Distribuição dos desenvolvedores no fluxo guiado

Antes de qualquer cadastro no fluxo guiado, a IA deve obter os responsáveis e os percentuais. Se não forem informados, pergunta: “Quais desenvolvedores devem receber os pontos, qual o percentual de cada um e essa divisão vale para todas as funções?”. Dados parciais geram perguntas apenas sobre o que falta. A IA pode continuar a análise local das fontes enquanto aguarda, mas não deve criar a contagem ou importar funções sem resolver essa pendência.

No argumento `distribuicao` de `iniciar_contagem_guiada`, uma divisão única pode omitir `funcoes`; nesse caso, vale para todas as funções do escopo solicitado. Havendo várias divisões, cada uma informa os nomes exatos dos grupos/funções abrangidos. Exemplo desse argumento:

```json
{
  "distribuicao": [
    { "usuarios": [
      { "usuario": "Jéssica", "percentual": 60 },
      { "usuario": "Bruno", "percentual": 40 }
    ] }
  ]
}
```

Esse campo pertence à ferramenta de orientação, não ao objeto `contagem` do cálculo/gerador. Não se presume 100% para a conta autenticada, nem divisão igual. Percentuais são inteiros de 1 a 100 e cada função deve totalizar 100%. Responsáveis duplicados, escopos sobrepostos e divisões incompletas geram pendências. A identificação efetiva das pessoas e a cobertura das funções analisadas ainda precisam ser conferidas antes de gravar.

Após a importação, a IA identifica os grupos efetivamente criados e conduz `simular_associacao_usuarios_funcoes` e `associar_usuarios_funcoes`, sempre com seleção explícita das funções do pedido. A operação usa **substituir**: a prévia deve mostrar vínculos atuais e novos, e a substituição exige aprovação específica, inclusive em modo `delegated`. Não reutilize a aprovação da importação nem selecione indiscriminadamente todas as funções antigas da contagem. Para divisões diferentes, execute uma associação por conjunto de funções, sem sobrepor os conjuntos.

Ao concluir, a IA deve reler as contribuições e conferir usuários, percentuais e soma de 100% por função. Se as funções forem importadas e a associação falhar, deve informar o resultado parcial e os IDs; não deve reimportar as funções ou afirmar que o fluxo foi concluído.

Informe a aplicação, a versão/sprint, a metodologia e a referência que autoriza seu uso. Organize as funções em grupos e forneça, para cada uma:

- nome;
- tipo `ALI`, `AIE`, `EE`, `CE` ou `SE`;
- atividade `I`, `A`, `E`, `T`, `AV`, `MI`, `AD`, `MA` ou `AP`;
- TD e AR/TR como inteiros; funções de dados exigem ao menos um AR/TR;
- justificativa e evidências que permitam revisar a identificação e a contagem.

O MCP valida a estrutura, mas não comprova que os requisitos correspondem a uma função de negócio independente. A revisão do escopo, das fronteiras da aplicação e das evidências continua necessária.

Os fatores são informados por atividade, com `modo`, `valor` e `fonte`. O modo `multiplicador` calcula PF base × fator; o modo `fixo` atribui o valor informado a cada função daquela atividade. Sem fator para uma atividade usada, o PF equivalente correspondente e seu total ficam pendentes. Não são preenchidos como zero. O modo fixo está disponível para preparação local; a importação de um pacote gerado com ele é bloqueada enquanto o contrato correspondente do endpoint não estiver suportado.

Exemplo de dados de preparação:

Nas três ferramentas, envie este objeto no argumento `contagem`. Para validar ou gerar, pode informar também `totais_esperados: {"pf_base": 3, "pf_equivalente": 3}` no mesmo nível de `contagem`.

```json
{
  "aplicacao": "Aplicação de teste",
  "versao": "Sprint de teste",
  "metodologia": "Referência contratual aprovada pela equipe — informar documento e versão",
  "grupos": [
    {
      "nome": "Cadastro de clientes",
      "funcoes": [
        {
          "nome": "Incluir cliente",
          "tipo": "EE",
          "atividade": "I",
          "td": 5,
          "ar_tr": 1,
          "justificativa": "Entrada que mantém os dados de cliente dentro da fronteira da aplicação.",
          "evidencias": ["Requisito de teste HU-001, critérios de aceite 1 e 2"]
        }
      ]
    }
  ],
  "fatores": {
    "I": {
      "modo": "multiplicador",
      "valor": 1,
      "fonte": "Exemplo de teste; substituir pela convenção efetiva da contagem"
    }
  }
}
```

Este exemplo não define uma política contratual. O pacote original do kit contém referências a versões diferentes de roteiros de métricas. O MCP não declara uma delas aplicável nem altera automaticamente as convenções do AgilePoint.

## Gerar e importar

1. Prepare os dados com a IA e revise funções, atividades, TD, AR/TR, justificativas e evidências.
2. Chame `validar_contagem_apf`. Quando houver um total esperado aprovado, informe-o para detectar divergências.
3. Chame `gerar_planilha_apf`. Guarde juntos o XLSX e seu arquivo de conferência com final `.apf.json`. A pasta de exportações é a configurada em `APF_EXPORT_DIR`; a cópia para importação fica em `APF_UPLOAD_DIR`. Os artefatos são um retrato dos dados preparados; não são um modelo que analisa novos requisitos sozinho.
4. Autentique no AgilePoint e identifique a contagem aberta correta por ID, aplicação e versão. Se necessário, crie primeiro uma contagem vazia pelo fluxo de inclusão autorizado.
5. Consulte `consultar_fatores_contagem` e prepare os fatores usados na planilha a partir das convenções efetivas da contagem. Para importar um pacote gerado, todos os fatores necessários devem estar presentes, em modo multiplicador e compatíveis com o endpoint. A simulação e a execução verificam a aplicação/versão, a integridade do XLSX e dos dados C:K e os fatores da contagem. Fator pendente, divergência ou modo fixo impedem essa importação.
6. Use `simular_importacao_rapida` com o ID da contagem e o caminho da planilha na pasta de importação. Confira grupos, itens e conteúdo da prévia.
7. Aprove a solicitação conforme o modo da instalação e execute `importar_contagem_rapida` com os identificadores retornados pela simulação.
8. Consulte novamente as funções e os totais efetivos no AgilePoint. Compare-os com os artefatos de conferência.

A geração e a validação são locais e não exigem aprovação de gravação. A importação continua sujeita às permissões da conta e aos controles de simulação, aprovação, auditoria e idempotência do MCP.

## O que a importação lê

A aba **Funções** preserva o cabeçalho do modelo na coluna C. A importação rápida lê somente as linhas abaixo dele, no intervalo C:K: nome em C, tipo em H, atividade em I, TD em J e AR/TR em K. As linhas de grupo têm nome e as demais colunas vazias.

Justificativas e evidências são preservadas nos artefatos gerados. Elas não são enviadas automaticamente a campos de observação no AgilePoint pela importação C:K.

Mantenha o `.apf.json` ao lado da planilha gerada para importar o pacote com sua conferência. Depois de corrigir dados ou fatores, gere novamente os artefatos; não edite manualmente apenas um deles. As planilhas externas anteriores continuam no fluxo de importação existente, sem presumir que possuam esse arquivo de conferência.

A importação acrescenta funções à contagem. Não substitui funções existentes, não remove as anteriores e não identifica automaticamente duplicidades de negócio entre pedidos distintos. Não lance o mesmo conjunto por `lancar_pontos_funcao` e depois importe sua planilha. Em caso de resultado incerto, consulte o que foi salvo antes de repetir qualquer operação.

## Arquivos e privacidade

O arquivo de conferência admite até 8 MiB e a planilha até 10 MiB. Contagens com evidências muito extensas precisam ser divididas. Remover o `.apf.json` de uma planilha identificada como gerada pelo kit bloqueia a importação.

XLSX e JSON podem conter requisitos, nomes e evidências. Eles ficam nas pastas privadas da instalação até serem removidos pela pessoa responsável. Excluir um registro de teste no AgilePoint não apaga esses artefatos nem a auditoria local. Compartilhe apenas os arquivos necessários e revise os dados antes de enviá-los a outra pessoa ou serviço.
