# MCP AgilePoint — limitações conhecidas

Versão **1.1.2**. O pacote está disponível para testes controlados. A cobertura pode variar conforme a tela, a operação e as permissões da conta.

- A contagem guiada fornece perguntas e instruções à IA do cliente. O MCP não analisa requisitos com um modelo próprio nem força todos os clientes a executar o roteiro. A IA precisa ler as fontes, esclarecer lacunas e respeitar a aprovação configurada antes do cadastro.
- No fluxo guiado, responsáveis e percentuais precisam estar definidos antes do cadastro. A distribuição é conferida estruturalmente, mas identidades e cobertura efetiva das funções ainda exigem consulta. A associação substitui vínculos nas funções selecionadas, exige aprovação própria e ocorre após importar. Uma falha nessa etapa pode deixar funções cadastradas sem a distribuição concluída; a IA deve informar o resultado parcial e evitar reimportação.

- A instalação pelo pedido “Instale esse MCP” precisa de um cliente com MCP local, acesso a arquivos e execução de comandos no Windows. Uma IA web sem esses recursos não consegue instalar o pacote apenas recebendo o ZIP. Alguns clientes precisam ser reiniciados antes de disponibilizar as ferramentas.
- O MCP usa endpoints internos do AgilePoint/Webrun. Atualizações do sistema podem exigir ajustes no MCP.
- A conta precisa ter acesso à tela e à operação no próprio AgilePoint. A configuração local do MCP não concede acesso no sistema.
- As operações padrão de incluir, alterar e excluir dependem da capacidade configurada e dos controles publicados pela tela. Isso não garante suporte automático a todas as telas ou grades.
- Botões personalizados, anexos e uploads exigem contratos específicos. Ações de Dica de Mestre, sincronização de aplicações e outros botões podem permanecer bloqueados. Peça à IA para chamar `verificar_cobertura_telas` antes de testar uma ação específica.
- Aprovar apenas escrevendo “aprovado” na conversa não conclui a aprovação externa. Siga o procedimento do `README.md` e use o ID da simulação.
- O ranking do repositório reproduz as notas e a ordem retornadas pelo AgilePoint. O MCP não calcula a fórmula nem define o desempate.
- Uma falha de conexão durante uma gravação pode deixar o resultado incerto. Não repita automaticamente: consulte o registro no AgilePoint ou pelo MCP e confira o que foi persistido antes de solicitar nova operação.
- O kit APF calcula dados estruturados; a identificação das funções a partir de requisitos ou código precisa de análise da IA e revisão humana. O cálculo não certifica a metodologia nem a adequação do escopo.
- A referência contratual e os fatores de atividade devem ser explícitos. O kit original contém versões distintas de roteiros; o MCP não escolhe automaticamente uma versão nem trata todos os fatores como multiplicadores. Sem fatores informados, o PF equivalente fica pendente.
- A planilha gerada pode ser preparada sem consulta ao AgilePoint. Seus totais são uma conferência local e não provam o resultado de uma gravação. Para importar um pacote gerado, mantenha o XLSX e seu `.apf.json` juntos; o MCP verifica a aplicação/versão, a integridade e a compatibilidade dos fatores na simulação e na execução. Fatores pendentes, divergentes ou fixos bloqueiam essa importação. Depois, consulte a grade e os totais efetivos no sistema.
- O fator em modo fixo é aceito no cálculo local. A importação do kit com esse modo aguarda suporte ao contrato efetivo do AgilePoint, sem convertê-lo silenciosamente em multiplicador.
- A versão 1.1.0 integra o kit com validação local. Essa validação não representa uma nova homologação de gravação no AgilePoint com todos os perfis.
- A importação rápida lê C:K da aba Funções. Justificativas e evidências preservadas no XLSX e no JSON não são enviadas a campos de observação do AgilePoint por esse fluxo. A importação acrescenta funções e não elimina duplicidades de negócio entre solicitações diferentes.

## Como testar

Use contas individuais e registros descartáveis de uma aplicação de teste. Antes de gravar, confira a aplicação, a contagem ou versão, o ID do registro e a prévia. Depois, consulte novamente para verificar os valores. Ao finalizar, exclua somente os registros criados para o teste e confirme por nova consulta que foram removidos.

Não use operações em massa nem exclusões em dados de trabalho para validar o pacote. Se uma ação ficar bloqueada ou sua limpeza não puder ser confirmada, registre a ocorrência e pare esse teste.

## Como relatar um erro

Envie a versão do MCP, cliente de IA utilizado, perfil testado, nome da tela, operação solicitada, horário aproximado e mensagem de erro. Descreva o resultado esperado e o observado. Quando necessário, informe somente o ID de um registro descartável ou uma captura com os dados pessoais ocultados.

Nunca envie senha, token, cookie, conteúdo de arquivos de credenciais ou registros completos de chamadas de autenticação. Remova também credenciais e dados pessoais de capturas e trechos de conversa.
