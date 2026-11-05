# Dica de Mestre pelo MCP — versão 1.2.1

O fluxo usa os endpoints internos equivalentes a **Incluir Nova → Submeter Inscrição**. A publicação segue a avaliação do AgilePoint: o MCP não concede aprovação, não altera o avaliador e não força a visibilidade no catálogo.

## Como pedir à IA

> Quero enviar uma Dica de Mestre com o título “Minha solução”, esta descrição e a documentação Markdown anexada. Inclua também estes arquivos de apoio. Valide os dados e envie conforme meu pedido.

A IA deve pedir título, descrição e documentação quando faltarem, aproveitar os dados já fornecidos e esclarecer o conteúdo. Ela não precisa clicar nos botões da tela nem receber permissão genérica para executar regras arbitrárias.

## Ferramentas

- `consultar_minhas_dicas_mestre`: consulta as inscrições da conta autenticada e a avaliação retornada pelo sistema, com paginação completa ou erro explícito.
- `simular_publicacao_dica_mestre`: recebe `publicacao`, valida os dados e arquivos, verifica o contrato da tela e títulos já existentes nas suas inscrições e prepara a aprovação. Não inicia envio no servidor nem transfere arquivos.
- `cancelar_publicacao_dica_mestre`: descarta uma simulação ainda pendente. Como a preparação é local, não há inscrição ou anexos no servidor para excluir. Não desfaz uma execução já enviada ou incerta.
- `publicar_dica_mestre`: recebe o token, chave de idempotência e a aprovação exigida. Inicia o GUID de envio, vincula o lote à sessão, envia anexos opcionais, confere seus nomes e submete título, descrição e documentação. Relê a inscrição por ID e compara o Markdown gravado com o conteúdo aprovado.

Exemplo do argumento para simulação:

```json
{
  "publicacao": {
    "titulo": "Minha solução",
    "descricao": "Resumo do problema resolvido e da solução.",
    "documentacao_markdown": "# Minha solução\n\n## Como usar\n\nInstruções, exemplos e referências.",
    "anexos": []
  }
}
```

Para documentação em arquivo, substitua `documentacao_markdown` por `caminho_documentacao`. Informe exatamente um deles. Arquivos precisam estar dentro da pasta privada `APF_UPLOAD_DIR` da instalação; a IA com acesso local pode colocá-los ali. O MCP não lê arquivos fora desse diretório nem executa o código dos anexos.

Título admite até 250 caracteres; descrição, 4.000. A documentação é obrigatória, em Markdown UTF-8, até 2 MiB. São aceitos até 10 anexos de apoio, 25 MiB por arquivo e 50 MiB no total, nos formatos PDF, texto/Markdown, JSON, CSV, imagens PNG/JPEG, ZIP, XLSX, DOCX, PPTX, SQL, JS, TS, PY e FRZ. Nomes duplicados são recusados. Esses limites locais não garantem que todos os arquivos sejam aceitos pela configuração do servidor.

## Aprovação, permissões e segurança

A instalação 1.2.1 usa o modo automatic: a IA simula e executa o comando do usuário sem pedir confirmação adicional. A aprovação editorial do AgilePoint continua independente. Modos external/elicitation configurados explicitamente mantêm seus controles.


A conta precisa acessar Dica de Mestre e suas ações no próprio AgilePoint. O instalador 1.2.1 inclui a capacidade local `publicar_dica_mestre` somente para o formulário `500000385`, nos perfis desenvolvedor e gerente. Isso não concede acesso adicional no sistema nem libera `custom_action` ou uploads universais em outros formulários. Instalações com política própria precisam autorizar essa capacidade explicitamente após conferir o acesso da conta. Atualize e reinicie a conexão MCP antes de usar as novas ferramentas.

Na execução, respeita-se o modo configurado na conexão ativa. A execução confere o contrato e os hashes dos arquivos novamente; alterações exigem nova simulação. As chamadas são serializadas para impedir que o GUID de um envio interfira em outro dentro do mesmo processo MCP. Use conta e processo individuais.

Títulos já existentes nas suas inscrições bloqueiam novo envio; esclareça a intenção antes de criar outro título para contornar isso. Idempotência persistente impede reaproveitar a mesma chave com outro conteúdo. Um resultado incerto nunca deve ser repetido automaticamente, nem com outra chave.

## Conferência e falhas

O sucesso exige localizar uma inscrição única, confirmar seu ID e reler a documentação. O status/avaliação é devolvido como informado pelo AgilePoint, sem convertê-lo em aprovação. Os anexos são conferidos no lote de envio antes da submissão; sua vinculação persistente final não possui uma consulta independente homologada neste fluxo.

Se houver falha após um POST ou upload, o MCP registra resultado incerto e conserva o GUID/etapa na auditoria privada para reconciliação. Podem existir inscrição já criada ou arquivos temporários de apoio no servidor. O cancelamento da preparação não remove esse material, e o MCP não chama exclusões não homologadas. Consulte Minhas Inscrições e reconcilie com o administrador antes de tentar novamente.

Os contratos de abertura, submissão Java, vínculo de GUID, upload múltiplo, consulta e documentação foram identificados no cliente oficial. Os testes automatizados virtualizam o AgilePoint e verificam os contratos, casos de falha e proteções. Não substituem homologação de gravação real com cada perfil nem garantem compatibilidade após alterações do sistema.
