import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { load } from "cheerio";
import { currentActor } from "./access.js";
import { auditActor, auditIdempotencyKey, auditValue } from "./audit-redaction.js";
import { BoundedPendingStore } from "./pending-simulations.js";
import { validateUploadFile, type UploadActionContract } from "./upload-actions.js";
import { buildInternalUrl, parseWebrunRuleReturnValue } from "./internal-api.js";
import { isLoginDocument, type WebrunHttpSession, type WebrunHttpResponse } from "./http-session.js";
import { deniedDocument, parseWebrunFormState } from "./webrun-metadata.js";

export const DICA_FORM_ID = "500000385";
export const DICA_FLOW_INSTRUCTIONS = "Para publicar uma Dica de Mestre, use simular_publicacao_dica_mestre e publicar_dica_mestre; não tente clicar genericamente em Incluir Nova ou contornar contratos personalizados. Peça título, descrição, documentação Markdown obrigatória e anexos opcionais, aproveitando os dados já fornecidos. Não invente o conteúdo da dica sem solicitação da pessoa. A simulação e seu cancelamento são locais. Siga a aprovação configurada antes de transferir dados. O resultado é uma inscrição submetida ao processo de avaliação do AgilePoint: não prometa publicação imediata no catálogo. Se a execução retornar resultado incerto, consulte consultar_minhas_dicas_mestre e a auditoria; não reenvie automaticamente com nova chave. ";
const MAX_DOCUMENT = 2 * 1024 * 1024;
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), "Texto contém caracteres de controle.");
export const dicaInputSchema = z.object({
  titulo: text(250), descricao: text(4_000),
  documentacao_markdown: z.string().min(1).max(MAX_DOCUMENT).optional(),
  caminho_documentacao: text(2_000).optional().describe("Arquivo .md/.markdown UTF-8 dentro de APF_UPLOAD_DIR, até 2 MiB. Informe este campo ou documentacao_markdown."),
  anexos: z.array(text(2_000)).max(10).optional().describe("Até 10 arquivos de apoio em APF_UPLOAD_DIR; máximo 25 MiB cada e 50 MiB por envio."),
}).strict().refine(v => Boolean(v.documentacao_markdown) !== Boolean(v.caminho_documentacao), { message: "Informe exatamente documentacao_markdown ou caminho_documentacao." });

type FileInfo = { caminho: string; nome: string; sha256: string; bytes: number; mime: string };
export type DicaPrepared = { titulo: string; descricao: string; documentacao: string; documentacao_sha256: string; documento_arquivo?: FileInfo; anexos: FileInfo[] };
export type DicaSubmission = { titulo: string; descricao: string; avaliacao: string; posicao: number };
export type DicaSimulation = { conteudo: DicaPrepared; contrato_sha256: string; ator_sha256: string };
const pending = new BoundedPendingStore<DicaSimulation>();
export function dicaHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function fileDigest(body: Buffer | string): string { return createHash("sha256").update(body).digest("hex"); }

const attachmentContract = {
  allowedExtensions: [".pdf", ".txt", ".md", ".markdown", ".json", ".csv", ".png", ".jpg", ".jpeg", ".zip", ".xlsx", ".docx", ".pptx", ".sql", ".js", ".ts", ".py", ".frz"],
  allowedMimeTypes: [], maxBytes: 25 * 1024 * 1024,
} as unknown as UploadActionContract;
const markdownContract = { allowedExtensions: [".md", ".markdown"], allowedMimeTypes: ["text/plain"], maxBytes: MAX_DOCUMENT } as unknown as UploadActionContract;
const normal = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
const markdown = (value: string) => value.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
const metadata = (file: Awaited<ReturnType<typeof validateUploadFile>>): FileInfo => ({ caminho: file.path, nome: file.filename, sha256: file.sha256, bytes: file.size, mime: file.mimeType });

export async function prepareDica(input: unknown): Promise<DicaPrepared> {
  const parsed = dicaInputSchema.parse(input);
  let document = parsed.documentacao_markdown;
  let documentFile: FileInfo | undefined;
  if (parsed.caminho_documentacao) {
    const file = await validateUploadFile(parsed.caminho_documentacao, markdownContract);
    document = new TextDecoder("utf-8", { fatal: true }).decode(file.body);
    documentFile = metadata(file);
  }
  const content = markdown(document!);
  if (!content.trim() || Buffer.byteLength(content, "utf8") > MAX_DOCUMENT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) throw new Error("A documentação Markdown é vazia, inválida ou excede 2 MiB.");
  const files: FileInfo[] = [];
  for (const file of parsed.anexos ?? []) files.push(metadata(await validateUploadFile(file, attachmentContract)));
  if (files.some(file => /[\r\n\0"\\/]/.test(file.nome) || file.nome.length > 250)) throw new Error("Um nome de anexo é inválido para transferência multipart.");
  if (new Set(files.map(f => normal(f.nome))).size !== files.length) throw new Error("Há anexos com nomes duplicados.");
  if (files.reduce((sum, f) => sum + f.bytes, 0) > 50 * 1024 * 1024) throw new Error("Os anexos excedem 50 MiB no total.");
  return { titulo: parsed.titulo, descricao: parsed.descricao, documentacao: content, documentacao_sha256: fileDigest(content), ...(documentFile ? { documento_arquivo: documentFile } : {}), anexos: files };
}

export async function validateDicaFiles(value: DicaPrepared) {
  if (value.documento_arquivo) {
    const file = await validateUploadFile(value.documento_arquivo.caminho, markdownContract);
    if (file.sha256 !== value.documento_arquivo.sha256) throw new Error("A documentação mudou desde a simulação. Simule novamente.");
  }
  const files = [];
  for (const info of value.anexos) {
    const file = await validateUploadFile(info.caminho, attachmentContract);
    if (file.sha256 !== info.sha256 || file.filename !== info.nome || file.size !== info.bytes) throw new Error("Um anexo mudou desde a simulação. Simule novamente.");
    files.push(file);
  }
  return files;
}

export function createDicaSimulation(conteudo: DicaPrepared, contrato_sha256: string) {
  const value = { conteudo, contrato_sha256, ator_sha256: dicaHash(currentActor()) };
  const token = randomUUID(), expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return { confirmacao_token: token, expira_em: new Date(expiresAt).toISOString(), simulacao: value };
}
export function getDicaSimulation(token: string): DicaSimulation {
  const item = pending.get(token);
  if (!item || item.value.ator_sha256 !== dicaHash(currentActor())) throw new Error("A simulação expirou, foi cancelada ou pertence a outra identidade. Simule novamente.");
  return item.value;
}
export function cancelDicaSimulation(token: string) { getDicaSimulation(token); pending.delete(token); return { cancelado: true, gravado_no_agilepoint: false, aviso: "Preparação local descartada; não havia inscrição nem anexos enviados ao servidor." }; }
export function consumeDicaSimulation(token: string) { pending.delete(token); }

export async function recordDicaAudit(key: string, simulation: DicaSimulation, status: "sucesso" | "falha" | "progresso", outcome: unknown) {
  const directory = process.env.APF_AUDIT_DIR?.trim();
  if (!directory) throw new Error("Defina APF_AUDIT_DIR para registrar a publicação.");
  await mkdir(path.resolve(directory), { recursive: true, mode: 0o700 });
  const raw = outcome && typeof outcome === "object" ? outcome as Record<string, unknown> : {};
  const recovery = Object.fromEntries(Object.entries(raw).filter(([key, value]) => (key === "guid_envio" && typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)) || (key === "inscricao_id" && typeof value === "string" && /^\d+$/.test(value)) || (key === "etapa" && typeof value === "string" && /^[a-z_]{1,60}$/.test(value)) || (key === "anexos_transferidos" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10)));
  const entry = { evento_id: randomUUID(), ocorrido_em: new Date().toISOString(), ator: auditActor(currentActor()), chave_idempotencia: auditIdempotencyKey(key), payload_hash: dicaHash(simulation), status, recuperacao: recovery, resultado: auditValue(outcome) };
  await appendFile(path.join(path.resolve(directory), "dicas-mestre.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

const COMPONENTS = ["1136117", "1136122", "1136116", "1136197", "1136195", "1136200", "1136133", "1136139", "1136137", "1136135", "1136126", "1136140", "1136148", "1136121", "1136119", "1136194", "1136141", "1136120", "1136149", "1136196", "1136124", "1136125", "1136201", "1136198", "1136199", "1136138"];
export function dicaFields(body: string, guid = "", title = "", description = "") {
  const state = parseWebrunFormState(body);
  const values = new Map(state.fields.map(f => [f.componentId, f.value]));
  values.set("1136137", guid); values.set("1136124", title); values.set("1136125", description);
  return Object.fromEntries(COMPONENTS.map((id, index) => [`F_${index}_${id}`, values.get(id) ?? ""]));
}
export function dicaRuleBody(name: string, params: string[], fields: Record<string, string>) {
  if (!["Dica de Mestre - Iniciar Envio de Funcionalidade", "GitSudo - Definir guid na sessao", "Dica de Mestre - Inserir", "Dica de Mestre - Obter documentação", "Lista Anexo - Obter Arquivos"].includes(name)) throw new Error("Regra fora do contrato Dica de Mestre.");
  return new URLSearchParams({ action: "executeRule", pType: "2", ruleName: name, sys: "APF", formID: DICA_FORM_ID, parentRID: "-1", decodedParams: "true", ...Object.fromEntries(params.map((value, index) => [`P_${index}`, value])), ...fields }).toString();
}
export function checkDicaResponse(response: WebrunHttpResponse, phase: string): string {
  const body = response.text();
  if (response.status < 200 || response.status >= 300 || isLoginDocument(body) || deniedDocument(body)
    || /ActNewErrorMessage|hasRuleErrors\s*=\s*true|interactionError\s*\(|(?:showError|setError)\s*\(|throw\s+new\s+Error/i.test(body)) throw new Error(`O AgilePoint recusou ou não confirmou a etapa ${phase} (HTTP ${response.status}).`);
  return body;
}
export function parseDicaGuid(body: string): string {
  const match = /ebfFormChangeComponentValue\([^;]*?['"]guid['"]\s*,\s*['"]([0-9a-f-]{36})['"]/i.exec(body);
  if (!match || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(match[1])) throw new Error("O AgilePoint não retornou o GUID do envio. Nenhuma submissão foi tentada.");
  return match[1];
}
export function assertDicaContract(html: string, rules: string): string {
  for (const [id, rule] of [["1136122", "Dica de Mestre - Iniciar Envio de Funcionalidade"], ["1136126", "DicaDeMestreSubmeterInscricao"], ["1136135", "DicaDeMestreCancelarEnvio"], ["1136137", "GitSudo - Definir guid na sessao"]]) {
    const action = new RegExp(`d\\.c_${id}\\.on(?:click|change)\\s*=([^\\n]+)`).exec(html)?.[1] ?? "";
    if (!action.includes(rule) || new RegExp(`d\\.c_${id}\\.(?:enabled\\s*=\\s*false|disabled\\s*=\\s*true|setEnabled\\(\\s*false)`).test(html)) throw new Error("O formulário não publicou ou desabilitou uma ação obrigatória de Dica de Mestre.");
  }
  const selected = ["DicaDeMestreSubmeterInscricao", "DicaDeMestreCancelarEnvio", "DicaDeMestreResetarEnvio", "DicaDeMestreRepositorioUpload"].map(name => {
    const start = rules.indexOf(`function ${name}(`), end = rules.indexOf(`function run${name}(`, start);
    if (start < 0 || end < start || end - start > 30_000) throw new Error("O código publicado das regras de Dica de Mestre mudou.");
    return rules.slice(start, end);
  });
  if (!selected[0].includes("'Dica de Mestre - Inserir',[this.context['guid'],this.context['titulo'],this.context['descricao'],this.context['documentacao']]")) throw new Error("O contrato de submissão de Dica de Mestre mudou; nenhum dado foi enviado.");
  if (!selected[3].includes("'Dica de Mestre - Ao Enviar'")) throw new Error("O contrato de anexos de Dica de Mestre mudou.");
  return dicaHash({ actions: COMPONENTS, rules: selected });
}

export type DicaEndpointContext = {
  baseUrl: string;
  http: Pick<WebrunHttpSession, "get" | "post" | "postMultipart">;
  open: () => Promise<{ body: string; url: string }>;
  submissions: () => Promise<DicaSubmission[]>;
  resolveId: (submission: DicaSubmission) => Promise<string>;
};

export class DicaMestreEndpoint {
  constructor(private readonly ctx: DicaEndpointContext) {}
  async inspect() {
    const opened = await this.ctx.open();
    const $ = load(opened.body);
    const src = $('script[src]').toArray().map(e => $(e).attr("src")!).find(s => /^jsRule\/system_apf\/webrunRules\.js(?:\?hash=[0-9]+)?$/.test(s));
    if (!src) throw new Error("O formulário não publicou a referência esperada das regras de Dica de Mestre.");
    const resource = new URL(src, opened.url);
    const response = await this.ctx.http.get(buildInternalUrl(this.ctx.baseUrl, resource.pathname, Object.fromEntries(resource.searchParams)), { Referer: opened.url });
    if (response.status < 200 || response.status >= 300 || /^\s*</.test(response.text())) throw new Error("O servidor não retornou o código das regras de Dica de Mestre.");
    const rules = response.text();
    return { ...opened, fingerprint: assertDicaContract(opened.body, rules) };
  }
  async ensureUnique(title: string) {
    const rows = await this.ctx.submissions();
    if (rows.some(row => normal(row.titulo) === normal(title))) throw new Error("Já existe uma inscrição sua com esse título. Consulte-a antes de tentar publicar novamente.");
    return rows;
  }
  async publish(simulation: DicaSimulation, progress: (value: unknown) => Promise<void>) {
    const opened = await this.inspect();
    if (opened.fingerprint !== simulation.contrato_sha256) throw new Error("O contrato do formulário mudou desde a simulação. Simule novamente.");
    await this.ensureUnique(simulation.conteudo.titulo);
    const files = await validateDicaFiles(simulation.conteudo);
    const { titulo, descricao, documentacao } = simulation.conteudo;
    const endpoint = buildInternalUrl(this.ctx.baseUrl, "/executeRule.do", {});
    const rule = async (name: string, params: string[], fields: Record<string, string>) => checkDicaResponse(await this.ctx.http.post(endpoint, dicaRuleBody(name, params, fields), { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: opened.url }), name);
    const start = await rule("Dica de Mestre - Iniciar Envio de Funcionalidade", [], dicaFields(opened.body));
    const guid = parseDicaGuid(start);
    const fields = dicaFields(opened.body, guid, titulo, descricao);
    await progress({ etapa: "envio_iniciado", guid_envio: guid, anexos_transferidos: 0 });
    // The GUID onchange in the official client binds upload callbacks to this session.
    await rule("GitSudo - Definir guid na sessao", [guid], fields);
    if (files.length) {
      const uploadPage = buildInternalUrl(this.ctx.baseUrl, "/upload.jsp", { sys: "APF", formID: DICA_FORM_ID, ruleName: "Dica de Mestre - Ao Enviar", url: "", ruleValidation: "", ruleUpload: "true", multiple: "true" });
      const page = await this.ctx.http.get(uploadPage, { Referer: opened.url });
      if (page.status < 200 || page.status >= 300 || isLoginDocument(page.text()) || deniedDocument(page.text())) throw new Error("O servidor recusou a abertura do formulário de anexos.");
      const uploadHtml = page.text();
      if (!/uploadMultipleFiles\.do\?sys=APF&amp;formID=500000385|uploadMultipleFiles\.do\?sys=APF&formID=500000385/.test(uploadHtml) || !/formData\.append\(name,\s*file\)/.test(uploadHtml)) throw new Error("O contrato multipart de anexos mudou. Nenhum arquivo foi enviado.");
      const uploadUrl = buildInternalUrl(this.ctx.baseUrl, "/uploadMultipleFiles.do", { sys: "APF", formID: DICA_FORM_ID, ruleName: "Dica de Mestre - Ao Enviar", url: "", ruleValidation: "", ruleUpload: "true", multiple: "true" });
      for (const [index, file] of files.entries()) {
        checkDicaResponse(await this.ctx.http.postMultipart(uploadUrl, {}, { fieldName: "upload1", filename: file.filename, mimeType: file.mimeType, body: file.body }, { Referer: uploadPage }), "transferir anexo");
        await progress({ etapa: "anexo_transferido", guid_envio: guid, anexos_transferidos: index + 1, arquivo_sha256: file.sha256 });
      }
      const listed = parseWebrunRuleReturnValue<unknown>(await rule("Lista Anexo - Obter Arquivos", [guid], fields));
      if (!Array.isArray(listed) || listed.length !== files.length || files.some(f => !listed.includes(f.filename))) throw new Error("O servidor não confirmou exatamente os anexos esperados. A inscrição não foi submetida; pode haver arquivos temporários no lote de envio.");
    }
    await progress({ etapa: "submissao_iniciada", guid_envio: guid, anexos_transferidos: files.length });
    await rule("Dica de Mestre - Inserir", [guid, titulo, descricao, documentacao], fields);
    const rows = await this.ctx.submissions();
    const found = rows.filter(row => normal(row.titulo) === normal(titulo) && row.descricao.trim() === descricao);
    if (found.length !== 1) throw new Error("A submissão foi enviada, mas a consulta não confirmou uma inscrição única. Não repita automaticamente; consulte Minhas Inscrições.");
    const id = await this.ctx.resolveId(found[0]);
    const savedDocument = parseWebrunRuleReturnValue<unknown>(await rule("Dica de Mestre - Obter documentação", [id], fields));
    if (typeof savedDocument !== "string" || fileDigest(markdown(savedDocument)) !== simulation.conteudo.documentacao_sha256) throw new Error("A inscrição foi localizada, mas a documentação gravada não pôde ser confirmada. Não reenvie; verifique o registro existente.");
    await progress({ etapa: "inscricao_verificada", guid_envio: guid, inscricao_id: id });
    return { inscricao_id: id, titulo, avaliacao: found[0].avaliacao, inscricao_verificada: true, documentacao_verificada: true, anexos_enviados: files.map(f => ({ nome: f.filename, sha256: f.sha256 })), verificacao_anexos: files.length ? "lote_de_envio_confirmado_antes_da_submissao" : "sem_anexos", aviso: "Submissão realizada pelo fluxo Dica de Mestre. A aprovação e a visibilidade no catálogo continuam sob as regras do AgilePoint; não foram alteradas pelo MCP." };
  }
}
