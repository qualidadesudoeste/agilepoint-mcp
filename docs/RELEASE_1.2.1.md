# MCP AgilePoint 1.2.1

Numeração de distribuição ajustada para a linha 1.2. Esta revisão reúne as alterações que estavam identificadas localmente como 1.4.0. A versão 1.2.0 já publicada é preservada. As referências a versões 1.3.x nos registros de homologação identificam compilações internas anteriores à renumeração.

Melhora atualização de instalações antigas e diagnóstico de erros, preservando o fluxo por credenciais no chat, a importação rápida de planilhas e a associação de responsáveis corrigida na 1.3.3.

## Atualização

O instalador reconhece pacotes antigos pelo marcador de instalação ou, para versões sem marcador, pela identidade do manifesto e do servidor compilado, sem executar o programa antigo. Atualiza registros JSON e tabelas TOML padrão, substitui as conexões verificadas e impede duplicação silenciosa quando encontrar uma instalação ausente, modificada ou conflitante.

Remove da conexão migrada as credenciais e configurações manuais antigas de perfil/colaborador. Conserva pastas de auditoria, aprovação, importação e exportação, contratos personalizados e políticas de capacidade modificadas. Políticas padrão conhecidas são atualizadas com o pacote. Desabilitação explícita de escrita ou da conexão permanece respeitada. Conexões com políticas/pastas diferentes exigem identificar qual é a instalação correta; o instalador não escolhe uma delas silenciosamente.

Preserva outras configurações do cliente, diretórios antigos e backups existentes. Não cria backup contendo as credenciais removidas. Alguns formatos TOML alternativos/complexos são recusados com diagnóstico e arquivo preservado; tabelas padrão, literais, arrays multilinha e comentários são suportados.

Windows usa Instalar.ps1, ou o instalador Node quando disponível. macOS e Linux usam `node instalar.mjs --cliente detectar`, com Node.js 22+ e npm. Foram corrigidos os caminhos específicos de plataforma e testada a localização do npm em layouts Windows, Homebrew/nvm e distribuições Linux. O arquivo de CI passa a conter matriz Windows/macOS/Linux com Node 22/24; essa configuração, sozinha, não comprova execução dos jobs.

## Diagnóstico

Nova ferramenta `diagnosticar_configuracao`, sem chamada ao AgilePoint: versão ativa/esperada, sistema operacional, autenticação por chat ou ambiente legado, origem do perfil e política de escrita. Não retorna login, senha, tokens ou cookies. O estado de versão por cliente permite detectar uma atualização posterior: um processo 1.2.1 desatualizado bloqueia gravações até reconectar. Processos antigos que não possuem esse recurso precisam ser reconectados e ter sua versão conferida após instalar.

Erros das ferramentas recebem código, origem, operação, versão e orientação. Aprovação/perfil/gravação desabilitada são identificados como política local; credenciais recusadas pelo AgilePoint e falhas de transporte possuem origens distintas. Quando não existe evidência suficiente, a origem é indeterminada. Resultado incerto não autoriza repetição automática. Restrições impostas pelo próprio cliente de IA não podem ser detectadas ou desativadas pelo servidor MCP.

## Verificação

Testes locais cobrem migração 1.0.0, JSON/TOML, conflitos, preservação de política/dados, remoção de credenciais da conexão, reconexão e diagnósticos pelo protocolo MCP. Os testes de caminhos/npm simulam Windows/macOS/Linux. Instalação e migração do ZIP são verificadas em ambiente isolado Windows nos cinco formatos de cliente. Não se declara homologação nativa em macOS/Linux nem nova homologação de gravação no AgilePoint nesta versão.

Na publicação de 05/11/2026, os testes automatizados passaram nas seis combinações de Windows/macOS/Linux com Node 22/24. Foi corrigido o reconhecimento das políticas padrão com finais de linha CRLF ou BOM, preservando as políticas personalizadas. Evidência: https://github.com/qualidadesudoeste/agilepoint-mcp/actions/runs/42034986100 . Isso não equivale a homologar a interface real de cada cliente de IA.
