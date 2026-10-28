# MCP AgilePoint 1.2.0 — testes controlados

Inclui fluxo especializado por endpoint para Dica de Mestre: consulta das suas inscrições, simulação, cancelamento local e submissão com título, descrição, documentação Markdown obrigatória e anexos opcionais. O pacote também mantém o kit APF e o fluxo guiado com distribuição de desenvolvedores.

O botão Incluir Nova da tela usa regras próprias. A IA agora recebe ferramentas correspondentes, sem precisar de permissão genérica para executar regras arbitrárias. A capacidade local de publicação fica limitada ao formulário de Dica de Mestre e continua sujeita às permissões reais da conta.

Simulações não criam inscrições nem transferem anexos. A execução exige a autorização configurada, confere o contrato e os hashes novamente, serializa o vínculo do GUID e faz o envio. O sucesso exige reler a inscrição por ID e conferir a documentação. Idempotência e auditoria conservam o estado quando houver resultado incerto.

## Instalação

Baixe **agilepoint-mcp-1.2.0.zip**, envie à sua IA compatível com MCP local e peça **“Instale esse MCP”**. Reinicie a conexão e confira a versão **1.2.0** em `verificar_conexao`. O guia `DICA_DE_MESTRE.md` acompanha o pacote. O ZIP automático do fonte não é o instalador.

## Limites e validação

Submeter uma inscrição não concede aprovação nem garante visibilidade imediata no catálogo. A avaliação do AgilePoint é preservada. Os anexos são conferidos no lote antes da submissão, sem consulta independente homologada da vinculação persistente final. Falhas após upload podem deixar arquivos temporários no servidor; o GUID e a etapa ficam na auditoria privada para reconciliação. O MCP não executa exclusões não homologadas nem reenvia automaticamente.

Contratos identificados no cliente oficial em 28/10/2026. Testes locais virtualizam o backend AgilePoint e cobrem sucesso, Markdown, anexos, permissões, cancelamento, duplicidade, alteração de arquivo, perda de conexão, verificação por ID e auditoria. Homologação de gravação real com cada perfil permanece necessária antes de ampliar o uso.

SHA-256 do pacote: `5E7E920C847F4C57D1C20C41DBE86FF10A582C725C283BA6B3105A08493676FD`.
