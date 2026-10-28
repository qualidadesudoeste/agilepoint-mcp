import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const SENSITIVE_KEY = /(authorization|cookie|password|passwd|pass|senha|secret|token|csrf|xsrf|jwt|cpf|cnpj|documento|email|e-?mail|telefone|phone)/i;
const CONTROL_KEY = /^(action|acao|command|comando|event|evento|method|metodo|mode|sys|service|servico|operation|operacao|ruleName|pType|parentRID|form(?:id)?|form_id|component(?:id)?|component_id|comID|fieldID|grid(?:id)?|grid_id|page|pagina|size|limit|offset|sort|order|firstload|scrolling|goto|toGrid|param|inner|gt|type|showResults|find|forceGetResponse)$/i;
const SAFE_HEADER = /^(accept|content-type|x-requested-with|sec-fetch-dest|sec-fetch-mode)$/i;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_PATTERN = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export type NetworkDiscoveryStatus = {
  habilitado: boolean;
  ativo: boolean;
  arquivo: string | null;
  iniciado_em: string | null;
  requisicoes_registradas: number;
  respostas_registradas: number;
  respostas_com_erro: number;
  valores_incluidos: boolean;
  ultimo_erro: string | null;
};

export type NetworkEndpointCandidate = {
  metodo: string;
  rota: string;
  parametros: string[];
  recursos: string[];
  observacoes: number;
  status_http: number[];
  classificacao: "candidato_webservice" | "navegacao_de_tela" | "acao_interna";
  estabilidade: "nao_confirmada";
};

export type HttpDiscoveryExchange = {
  method: "GET" | "POST";
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string | Buffer;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: Buffer;
};

export class NetworkDiscoveryLogger {
  private readonly enabled = process.env.APF_DISCOVERY_MODE === "true";
  private readonly includeValues = process.env.APF_DISCOVERY_INCLUDE_VALUES === "true";
  private readonly outputDirectory = process.env.APF_NETWORK_LOG_DIR?.trim() ? path.resolve(process.env.APF_NETWORK_LOG_DIR) : null;
  private filePath: string | null = null;
  private startedAt: string | null = null;
  private active = false;
  private requests = 0;
  private responses = 0;
  private errorResponses = 0;
  private lastError: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private bytesWritten = 0;

  constructor(private readonly baseUrl: string) {}

  async start(): Promise<void> {
    if (!this.enabled || this.active) return;
    if (!this.outputDirectory) throw new Error("APF_DISCOVERY_MODE exige APF_NETWORK_LOG_DIR em um diretório privado.");
    await mkdir(this.outputDirectory, { recursive: true, mode: 0o700 });
    this.startedAt = new Date().toISOString();
    const stamp = this.startedAt.replace(/[:.]/g, "-");
    this.filePath = path.join(this.outputDirectory, `network-${stamp}-${randomUUID().slice(0, 8)}.jsonl`);
    this.active = true;
    await this.write({
      tipo: "sessao",
      evento: "inicio",
      registrado_em: this.startedAt,
      base_url: new URL(this.baseUrl).origin,
      transporte: "http",
      valores_incluidos: this.includeValues,
      politica: "login, cookies, autorizacao, tokens e chaves sensiveis sao sempre omitidos",
    });
  }

  async close(): Promise<void> {
    if (!this.active) return;
    await this.write({
      tipo: "sessao",
      evento: "fim",
      registrado_em: new Date().toISOString(),
      requisicoes_registradas: this.requests,
      respostas_registradas: this.responses,
      respostas_com_erro: this.errorResponses,
    });
    await this.writeQueue;
    this.active = false;
  }

  status(): NetworkDiscoveryStatus {
    return {
      habilitado: this.enabled,
      ativo: this.active,
      arquivo: this.filePath,
      iniciado_em: this.startedAt,
      requisicoes_registradas: this.requests,
      respostas_registradas: this.responses,
      respostas_com_erro: this.errorResponses,
      valores_incluidos: this.includeValues,
      ultimo_erro: this.lastError,
    };
  }

  async analyze(): Promise<{ candidatos: NetworkEndpointCandidate[]; observacao: string }> {
    await this.writeQueue;
    if (!this.filePath) {
      return {
        candidatos: [],
        observacao: "Nenhuma captura ativa nesta sessão. Habilite APF_DISCOVERY_MODE e execute operações controladas.",
      };
    }
    const content = await readFile(this.filePath, "utf8");
    const entries = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    const statuses = new Map<string, number>();
    for (const entry of entries) {
      if (entry.tipo === "resposta" && typeof entry.id === "string" && typeof entry.status === "number") {
        statuses.set(entry.id, entry.status);
      }
    }
    const grouped = new Map<string, NetworkEndpointCandidate>();
    for (const entry of entries) {
      if (entry.tipo !== "requisicao" || typeof entry.url !== "string" || typeof entry.metodo !== "string") continue;
      const parsed = new URL(entry.url);
      const route = parsed.pathname;
      if (isStaticResource(route)) continue;
      const parameters = [...new Set([...parsed.searchParams.keys()])].sort();
      const resource = typeof entry.recurso === "string" ? entry.recurso : "desconhecido";
      const key = `${entry.metodo} ${route} ${parameters.join(",")}`;
      const existing = grouped.get(key) ?? {
        metodo: entry.metodo,
        rota: route,
        parametros: parameters,
        recursos: [],
        observacoes: 0,
        status_http: [],
        classificacao: classifyEndpoint(resource, entry.metodo),
        estabilidade: "nao_confirmada",
      };
      existing.observacoes += 1;
      if (!existing.recursos.includes(resource)) existing.recursos.push(resource);
      const status = typeof entry.id === "string" ? statuses.get(entry.id) : undefined;
      if (status !== undefined && !existing.status_http.includes(status)) existing.status_http.push(status);
      grouped.set(key, existing);
    }
    const candidates = [...grouped.values()].sort((a, b) => {
      const priority = (value: NetworkEndpointCandidate) => value.classificacao === "candidato_webservice" ? 0 : value.classificacao === "acao_interna" ? 1 : 2;
      return priority(a) - priority(b) || b.observacoes - a.observacoes || a.rota.localeCompare(b.rota);
    });
    return {
      candidatos: candidates,
      observacao: "Candidato não significa serviço estável. Confirme o mesmo contrato em novas sessões, com erros controlados e contas de permissões diferentes.",
    };
  }

  async recordHttpExchange(exchange: HttpDiscoveryExchange): Promise<void> {
    if (!this.enabled) return;
    await this.start();
    let url: URL;
    try {
      url = new URL(exchange.url);
    } catch {
      return;
    }
    if (url.origin !== new URL(this.baseUrl).origin || isStaticResource(url.pathname)) return;
    const requestBody = exchange.requestBody === undefined
      ? null
      : Buffer.isBuffer(exchange.requestBody) ? exchange.requestBody : Buffer.from(exchange.requestBody);
    const requestText = requestBody?.toString("utf8") ?? "";
    if (isCredentialExchange(url, requestText)) return;
    const id = randomUUID();
    await this.write({
      tipo: "requisicao",
      id,
      registrado_em: new Date().toISOString(),
      metodo: exchange.method,
      url: sanitizeUrl(exchange.url, this.includeValues),
      recurso: "http",
      cabecalhos: sanitizeHeaders(exchange.requestHeaders),
      corpo: requestBody === null ? null : sanitizeBody(
        requestText,
        exchange.requestHeaders["content-type"] ?? exchange.requestHeaders["Content-Type"] ?? "",
        this.includeValues,
      ),
      corpo_bytes: requestBody?.byteLength ?? 0,
      corpo_sha256: requestBody === null ? null : sha256(requestBody),
    });
    this.requests += 1;
    const contentType = exchange.responseHeaders["content-type"] ?? exchange.responseHeaders["Content-Type"] ?? "";
    const textual = /(json|text|xml|javascript|x-www-form-urlencoded)/i.test(contentType);
    await this.write({
      tipo: "resposta",
      id,
      registrado_em: new Date().toISOString(),
      status: exchange.status,
      url: sanitizeUrl(exchange.url, this.includeValues),
      cabecalhos: sanitizeHeaders(exchange.responseHeaders),
      corpo: textual && exchange.responseBody.byteLength <= 1_000_000
        ? sanitizeBody(exchange.responseBody.toString("utf8"), contentType, this.includeValues)
        : null,
      corpo_bytes: exchange.responseBody.byteLength,
      corpo_sha256: sha256(exchange.responseBody),
    });
    this.responses += 1;
    if (exchange.status >= 400) this.errorResponses += 1;
  }
  private async write(entry: Record<string, unknown>): Promise<void> {
    if (!this.filePath) return;
    const line = `${JSON.stringify(entry)}\n`;
    const lineBytes = Buffer.byteLength(line);
    const maximum = configuredLogBytes();
    if (this.bytesWritten + lineBytes > maximum) {
      this.lastError = `A captura atingiu o limite de ${maximum} bytes e foi interrompida.`;
      this.active = false;
      return;
    }
    this.bytesWritten += lineBytes;
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.filePath!, line, { encoding: "utf8", mode: 0o600 }))
      .catch((error: unknown) => {
        this.lastError = error instanceof Error ? error.message : String(error);
      });
    await this.writeQueue;
  }

}

function configuredLogBytes(): number {
  const raw = process.env.APF_NETWORK_LOG_MAX_BYTES?.trim();
  if (!raw) return 50 * 1024 * 1024;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1024 * 1024 || value > 1024 * 1024 * 1024) {
    throw new Error("APF_NETWORK_LOG_MAX_BYTES deve ser um inteiro entre 1048576 e 1073741824.");
  }
  return value;
}

export function isCredentialExchange(url: URL, requestText: string): boolean {
  if (/formID=19\b/i.test(url.search) || /WFRInput58(?:7|8)\b/i.test(requestText)) return true;
  if (!requestText) return false;
  const form = new URLSearchParams(requestText);
  return form.get("formID") === "19"
    || /login|autenticar\s+usu[aá]rio/i.test(form.get("ruleName") ?? "");
}

export function sanitizeUrl(rawUrl: string, includeValues = false): string {
  try {
    const url = new URL(rawUrl);
    for (const [key, value] of [...url.searchParams.entries()]) {
      url.searchParams.set(key, sanitizePrimitive(value, key, includeValues));
    }
    return redactText(url.toString());
  } catch {
    return redactText(rawUrl.split("?")[0]);
  }
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers)
    .filter(([key]) => SAFE_HEADER.test(key) && !SENSITIVE_KEY.test(key))
    .map(([key, value]) => [key.toLocaleLowerCase(), redactText(value)]));
}

export function sanitizeBody(body: string, contentType: string, includeValues = false): unknown {
  if (/json/i.test(contentType) || /^[\s]*[\[{]/.test(body)) {
    try {
      return sanitizeStructured(JSON.parse(body), "", includeValues);
    } catch {
      // Continua com a detecção dos demais formatos.
    }
  }
  if (/x-www-form-urlencoded/i.test(contentType)) {
    const values = new URLSearchParams(body);
    return {
      formato: "form-urlencoded",
      campos: [...values.entries()].map(([key, value]) => ({
        nome: key,
        valor: sanitizePrimitive(value, key, includeValues),
      })),
    };
  }
  const assignment = body.match(/^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*)\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (assignment) {
    return {
      formato: "javascript-assignment",
      destino: assignment[1],
      estrutura: javascriptShape(assignment[2]),
      bytes: Buffer.byteLength(body),
      sha256: sha256(body),
    };
  }
  if (looksLikeForm(body)) {
    const values = new URLSearchParams(body);
    return {
      formato: "form-urlencoded",
      campos: [...values.entries()].map(([key, value]) => ({
        nome: key,
        valor: sanitizePrimitive(value, key, includeValues),
      })),
    };
  }
  if (/multipart\/form-data/i.test(contentType)) {
    return {
      formato: "multipart",
      campos: [...body.matchAll(/name="([^"]+)"/g)].map((match) => match[1]),
      arquivos: [...body.matchAll(/filename="([^"]*)"/g)].map(() => "[ARQUIVO OMITIDO]"),
    };
  }
  if (/xml/i.test(contentType) || /^\s*</.test(body)) {
    return {
      formato: "xml",
      elementos: [...new Set([...body.matchAll(/<([A-Za-z_][\w:.-]*)\b/g)].map((match) => match[1]))].slice(0, 200),
      bytes: Buffer.byteLength(body),
      sha256: sha256(body),
    };
  }
  return includeValues
    ? { formato: "texto", valor: redactText(body).slice(0, 20_000), truncado: body.length > 20_000 }
    : { formato: "texto", bytes: Buffer.byteLength(body), sha256: sha256(body) };
}

function sanitizeStructured(value: unknown, key: string, includeValues: boolean): unknown {
  if (SENSITIVE_KEY.test(key)) return "[OMITIDO]";
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeStructured(item, key, includeValues));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => [childKey, sanitizeStructured(childValue, childKey, includeValues)]));
  }
  if (value === null) return null;
  return sanitizePrimitive(String(value), key, includeValues, typeof value);
}

function sanitizePrimitive(value: string, key: string, includeValues: boolean, originalType = "string"): string {
  if (SENSITIVE_KEY.test(key)) return "[OMITIDO]";
  if (includeValues || CONTROL_KEY.test(key)) return redactText(value);
  return `[${originalType}:${value.length}]`;
}

function redactText(value: string): string {
  return value
    .replace(CPF_PATTERN, "[CPF OMITIDO]")
    .replace(CNPJ_PATTERN, "[CNPJ OMITIDO]")
    .replace(EMAIL_PATTERN, "[EMAIL OMITIDO]")
    .replace(JWT_PATTERN, "[TOKEN OMITIDO]")
    .replace(/(bearer\s+)[^\s"']+/gi, "$1[TOKEN OMITIDO]");
}

function looksLikeForm(body: string): boolean {
  return body.includes("=") && !/[\r\n]/.test(body.slice(0, 500));
}

export function javascriptShape(expression: string): string {
  return expression
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "[STRING]")
    .replace(/\b\d+(?:\.\d+)?\b/g, "[NUMBER]")
    .replace(/\s+/g, " ")
    .slice(0, 4_000);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function classifyEndpoint(resource: string, method: string): NetworkEndpointCandidate["classificacao"] {
  if (["xhr", "fetch", "eventsource", "websocket"].includes(resource)) return "candidato_webservice";
  if (resource === "http" && method === "POST") return "candidato_webservice";
  if (resource === "document" && method === "GET") return "navegacao_de_tela";
  return "acao_interna";
}

function isStaticResource(route: string): boolean {
  return /\.(?:js|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|eot)(?:$|\?)/i.test(route)
    || /^\/(?:assets|components|i18n|jsRule)\//i.test(route)
    || /^\/(?:offline\.jsp|nothing\.html)$/i.test(route);
}
