# MCP AgilePoint 1.1.2 — testes controlados

Servidor MCP local para consultar dados e operar formulários autorizados do AgilePoint, por endpoints internos e com credenciais individuais.

Inclui kit APF com cálculo de complexidade/PF, geração de planilhas e conferência para importação rápida. O fluxo guiado aceita pedidos simples de contagem, pergunta o que faltar e coleta responsáveis/percentuais antes do cadastro. A IA do cliente analisa as fontes e conduz a sequência de ferramentas; o servidor não contém um modelo próprio de IA.

## Instalação

Baixe **agilepoint-mcp-1.1.2.zip**, envie o pacote à IA compatível com MCP local e peça **“Instale esse MCP”**. O cliente precisa de acesso a arquivos e execução de comandos. O login individual do AgilePoint é solicitado depois da conexão. O guia e as limitações estão dentro do pacote.

O ZIP automático do código-fonte não é o pacote de instalação. Para desenvolver a partir do fonte, use Node.js 22 ou superior, `npm ci` e `npm test`.

## Verificação e limites

Testes locais de cálculo, geração, importação de arquivos, orientação, aprovação e instalação passaram. O envio ao GitHub não inclui nova homologação de gravação real com todos os perfis. Antes de ampliar o uso, valide as operações necessárias com contas individuais e registros descartáveis.

Operações de escrita seguem as permissões efetivas da conta e o modo de aprovação configurado. A associação de desenvolvedores substitui os vínculos nas funções selecionadas e exige aprovação específica. Não repita gravações com resultado incerto.

SHA-256 do pacote de instalação:

`1A6FA917AB5C596C8C833C976C988451B193EB18BA2BCF74343A8BD0EACBB7E1`
