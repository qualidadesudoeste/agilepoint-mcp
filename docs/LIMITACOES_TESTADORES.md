# MCP AgilePoint — limitações conhecidas

Versão **1.2.1**. O pacote está disponível para testes controlados. A cobertura pode variar conforme a tela, a operação e as permissões da conta.


- A instalação pelo pedido “Instale esse MCP” precisa de um cliente com MCP local, acesso a arquivos e execução de comandos no Windows. Uma IA web sem esses recursos não consegue instalar o pacote apenas recebendo o ZIP. Alguns clientes precisam ser reiniciados antes de disponibilizar as ferramentas.
- O MCP usa endpoints internos do AgilePoint/Webrun. Atualizações do sistema podem exigir ajustes no MCP.
- A conta precisa ter acesso à tela e à operação no próprio AgilePoint. A configuração local do MCP não concede acesso no sistema.
- As operações padrão de incluir, alterar e excluir dependem da capacidade configurada e dos controles publicados pela tela. Isso não garante suporte automático a todas as telas ou grades.
- A submissão de Dica de Mestre possui ferramentas próprias, incluindo documentação e anexos de apoio. Botões de avaliação, sincronização de aplicações e outros uploads/ações personalizados continuam dependendo de contratos específicos. Peça à IA para chamar `verificar_cobertura_telas` antes de testar outra ação.
- Os contratos de Dica de Mestre foram identificados no cliente oficial e testados com o backend virtualizado. A gravação real com cada perfil permanece pendente de homologação. A submissão mantém a avaliação do AgilePoint; não equivale a aprovação ou publicação imediata no catálogo.
- Arquivos de apoio da dica são conferidos no lote de envio antes de submeter. A vinculação persistente final dos anexos não possui consulta independente homologada. Falhas após uploads podem deixar arquivos temporários no servidor; a auditoria privada conserva o GUID/etapa para reconciliação, e o MCP não chama exclusões não homologadas. Cancelar preparação local não desfaz execuções enviadas.
- A instalação usa execução automática após simulação interna. Configurações explicitamente mantidas em external/elicitation e políticas próprias do cliente de IA podem exigir aprovação. A conta continua sujeita às permissões do AgilePoint.
- O ranking do repositório reproduz as notas e a ordem retornadas pelo AgilePoint. O MCP não calcula a fórmula nem define o desempate.
- Uma falha de conexão durante uma gravação pode deixar o resultado incerto. Não repita automaticamente: consulte o registro no AgilePoint ou pelo MCP e confira o que foi persistido antes de solicitar nova operação.
- A importação rápida lê C:K da aba Funções. Justificativas e evidências fora dessas colunas não são enviadas a campos de observação do AgilePoint por esse fluxo. A importação acrescenta funções e não elimina duplicidades de negócio entre solicitações diferentes.

## Como testar

Use contas individuais e registros descartáveis de uma aplicação de teste. Antes de gravar, confira a aplicação, a contagem ou versão, o ID do registro e a prévia. Depois, consulte novamente para verificar os valores. Ao finalizar, exclua somente os registros criados para o teste e confirme por nova consulta que foram removidos.

Não use operações em massa nem exclusões em dados de trabalho para validar o pacote. Se uma ação ficar bloqueada ou sua limpeza não puder ser confirmada, registre a ocorrência e pare esse teste.

## Como relatar um erro

Envie a versão do MCP, cliente de IA utilizado, perfil testado, nome da tela, operação solicitada, horário aproximado e mensagem de erro. Descreva o resultado esperado e o observado. Quando necessário, informe somente o ID de um registro descartável ou uma captura com os dados pessoais ocultados.

Nunca envie senha, token, cookie, conteúdo de arquivos de credenciais ou registros completos de chamadas de autenticação. Remova também credenciais e dados pessoais de capturas e trechos de conversa.

## Homologação real desta correção

Em 04/11/2026 foram testadas criação, importação de XLSX e associação com desenvolvedor, distribuição seletiva com gerente e alteração/limpeza com administrador. Foram conferidos dois grupos, três itens e percentuais por leitura após a gravação. As contagens descartáveis foram excluídas e sua ausência foi consultada. Essa validação não cobre todas as combinações de perfil/operação nem altera as limitações de Dica de Mestre e anexos descritas acima.

## Atualização e plataformas

Os caminhos e a localização do npm de Windows/macOS/Linux possuem testes simulados. A instalação do ZIP e a migração dos cinco formatos de cliente foram verificadas em ambiente isolado Windows. Em 05/11/2026, a suíte automatizada passou em runners nativos Windows, macOS e Linux com Node 22 e 24. A instalação ponta a ponta nas interfaces reais dos clientes de IA em macOS/Linux permanece pendente. Node 22+ e npm são requisitos para macOS/Linux; o bootstrap automático de Node em Instalar.ps1 é exclusivo de Windows. Formatos TOML alternativos não reconhecidos são preservados com diagnóstico explícito. Credenciais que já estavam em backups ou históricos antigos não são apagadas pela atualização.

Os testes reais de contagem e distribuição mencionados acima foram executados na 1.3.3. Nesta atualização 1.2.1 não houve nova gravação de dados de negócio no AgilePoint; os testes novos se concentram em instalação, migração e diagnóstico pelo protocolo MCP.
