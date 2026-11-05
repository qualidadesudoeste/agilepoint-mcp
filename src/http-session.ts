import { buildInternalUrl, buildLoginRequestBody } from "./internal-api.js";
import { randomUUID } from "node:crypto";
import { DiagnosticError } from "./diagnostics.js";

export type WebrunHttpResponse = {
  status: number;
  headers: Headers;
  body: Buffer;
  url: string;
  text(): string;
};

export type HttpExchangeObserver = (exchange: {
  method: "GET" | "POST";
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string | Buffer;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: Buffer;
}) => Promise<void> | void;

export class WebrunHttpSession {
  private readonly cookies = new Map<string, string>();
  private authentication?: Promise<void>;

  constructor(
    private readonly baseUrl: string,
    private username?: string,
    private password?: string,
    private readonly observer?: HttpExchangeObserver,
  ) {
    validateSecureBaseUrl(baseUrl);
  }

  hasCredentials(): boolean {
    return Boolean(this.username && this.password);
  }

  setCredentialsOnce(username: string, password: string): void {
    if (this.username || this.password) throw new Error("Esta sessão MCP já possui uma identidade; reinicie o processo para trocar de conta.");
    if (!username.trim() || !password) throw new Error("Usuário e senha são obrigatórios.");
    this.username = username.trim();
    this.password = password;
    this.invalidate();
  }

  clearCredentials(): void {
    this.username = undefined;
    this.password = undefined;
    this.invalidate();
  }

  async ensureAuthenticated(): Promise<void> {
    if (!this.username || !this.password) {
      throw new Error("Autentique-se com autenticar_agilepoint ou configure APF_USERNAME e APF_PASSWORD em ambiente privado.");
    }
    if (!this.authentication) {
      this.authentication = this.authenticate().catch((error) => {
        this.authentication = undefined;
        throw error;
      });
    }
    return this.authentication;
  }

  async get(url: string, headers: Record<string, string> = {}): Promise<WebrunHttpResponse> {
    await this.ensureAuthenticated();
    return this.request(url, { method: "GET", headers });
  }

  async getLimited(url: string, maxBytes: number, headers: Record<string, string> = {}): Promise<WebrunHttpResponse> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("O limite da resposta deve ser um inteiro positivo.");
    await this.ensureAuthenticated();
    return this.request(url, { method: "GET", headers, maxResponseBytes: maxBytes });
  }

  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<WebrunHttpResponse> {
    await this.ensureAuthenticated();
    return this.request(url, { method: "POST", headers, body });
  }

  async postMultipart(
    url: string,
    fields: Record<string, string>,
    file: { fieldName: string; filename: string; mimeType: string; body: Buffer },
    headers: Record<string, string> = {},
  ): Promise<WebrunHttpResponse> {
    await this.ensureAuthenticated();
    const encoded = encodeMultipartFormData(fields, file);
    return this.request(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": encoded.contentType,
        "Content-Length": String(encoded.body.length),
      },
      body: encoded.body,
    });
  }

  invalidate(): void {
    this.authentication = undefined;
    this.cookies.clear();
  }

  private async authenticate(): Promise<void> {
    const landing = await this.request(buildInternalUrl(this.baseUrl, "/open.do", { sys: "APF" }), { method: "GET" });
    if (isAuthenticatedDocument(landing.text())) return;

    const loginUrl = buildInternalUrl(this.baseUrl, "/openform.do", {
      sys: "APF", action: "openform", formID: "19", firstLoad: true,
    });
    await this.request(loginUrl, { method: "GET", headers: { Referer: landing.url } });
    const login = await this.request(buildInternalUrl(this.baseUrl, "/executeRule.do", {}), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginUrl,
      },
      body: buildLoginRequestBody(this.username!, this.password!),
      sensitive: true,
    });
    const loginText = login.text();
    if (/Acesso negado|WFRUserNotLogged|Usu.rio ou senha n.o conferem/i.test(loginText)) {
      throw new DiagnosticError("CREDENCIAIS_RECUSADAS", "agilepoint", "O AgilePoint recusou as credenciais informadas.", "Confira as credenciais da conta e tente autenticar novamente. Não altere o perfil local.");
    }

    const validation = await this.request(buildInternalUrl(this.baseUrl, "/open.do", { sys: "APF" }), { method: "GET" });
    if (!isAuthenticatedDocument(validation.text())) {
      throw new Error("O AgilePoint não confirmou a autenticação HTTP.");
    }
  }

  private async request(url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string | Buffer; maxResponseBytes?: number; sensitive?: boolean }): Promise<WebrunHttpResponse> {
    const trustedOrigin = validateSecureBaseUrl(this.baseUrl).origin;
    let currentUrl = validateRequestUrl(url, this.baseUrl, trustedOrigin).toString();
    let method = init.method;
    let body = init.body;
    const maxResponseBytes = init.maxResponseBytes ?? configuredInteger("APF_HTTP_MAX_RESPONSE_BYTES", 25 * 1024 * 1024, 1024, 100 * 1024 * 1024);
    const timeoutMs = configuredInteger("APF_HTTP_TIMEOUT_MS", 30_000, 1_000, 120_000);
    const deadline = Date.now() + timeoutMs;
    for (let redirects = 0; redirects <= 8; redirects += 1) {
      const headers = new Headers(init.headers);
      const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      if (cookie) headers.set("Cookie", cookie);
      headers.set("Accept-Language", "pt-BR,pt;q=0.9");
      headers.set("User-Agent", "agilepoint-apf-mcp/2 endpoint-client");
      const controller = new AbortController();
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error(`A requisição ao AgilePoint excedeu o limite total de ${timeoutMs} ms.`);
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      let response: Response;
      try {
        response = await fetch(currentUrl, { method, headers, body: body as BodyInit | undefined, redirect: "manual", signal: controller.signal });
      } catch (error) {
        clearTimeout(timeout);
        if (controller.signal.aborted) throw new DiagnosticError("TEMPO_DE_CONEXAO", "transporte", `A requisição ao AgilePoint excedeu o limite total de ${timeoutMs} ms.`, "Confira a conectividade. Se era gravação, consulte o registro antes de tentar novamente.");
        throw new DiagnosticError("FALHA_DE_CONEXAO", "transporte", "Não foi possível completar a conexão HTTPS com o AgilePoint.", "Confira conexão, DNS e certificado. Isso não comprova falta de permissão; em gravações, verifique o resultado antes de repetir.");
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        this.captureCookies(response.headers);
        let bytes: Buffer;
        try {
          bytes = await readResponseBytes(response, maxResponseBytes);
        } catch (error) {
          if (controller.signal.aborted) throw new Error(`A requisição ao AgilePoint excedeu o limite total de ${timeoutMs} ms.`);
          if (error instanceof TypeError) throw new DiagnosticError("RESPOSTA_INTERROMPIDA", "transporte", "A conexão com o AgilePoint foi interrompida antes de completar a resposta.", "O resultado de uma gravação pode ser incerto. Consulte o registro antes de tentar novamente.");
          throw error;
        } finally {
          clearTimeout(timeout);
        }
        if (!init.sensitive) await this.observer?.({
          method,
          url: response.url || currentUrl,
          requestHeaders: Object.fromEntries(headers.entries()),
          requestBody: body,
          status: response.status,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          responseBody: bytes,
        });
        return {
          status: response.status,
          headers: response.headers,
          body: bytes,
          url: response.url || currentUrl,
          text: () => decodeResponse(bytes, response.headers.get("content-type") ?? ""),
        };
      }
      const location = response.headers.get("location");
      try {
        if (!location) throw new Error(`O AgilePoint respondeu redirecionamento HTTP ${response.status} sem destino.`);
        currentUrl = validateRequestUrl(location, currentUrl, trustedOrigin).toString();
        this.captureCookies(response.headers);
      } finally {
        clearTimeout(timeout);
        await response.body?.cancel().catch(() => undefined);
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
    }
    throw new Error("O AgilePoint excedeu o limite de redirecionamentos HTTP.");
  }

  private captureCookies(headers: Headers): void {
    const extended = headers as Headers & { getSetCookie?: () => string[] };
    const values = extended.getSetCookie?.() ?? splitSetCookie(headers.get("set-cookie"));
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const cookieValue = pair.slice(separator + 1).trim();
      if (cookieValue) this.cookies.set(name, cookieValue);
      else this.cookies.delete(name);
    }
  }
}

async function readResponseBytes(response: Response, maxBytes?: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (maxBytes && Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`A resposta excede o limite autorizado de ${maxBytes} bytes.`);
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (maxBytes && bytes.length > maxBytes) throw new Error(`A resposta excede o limite autorizado de ${maxBytes} bytes.`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (maxBytes !== undefined && total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`A resposta excede o limite autorizado de ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export function validateSecureBaseUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error("APF_BASE_URL deve ser uma URL HTTPS válida."); }
  if (url.protocol !== "https:") throw new Error("APF_BASE_URL deve usar HTTPS.");
  if (url.username || url.password || url.hash || url.search || (url.pathname && url.pathname !== "/")) {
    throw new Error("APF_BASE_URL deve conter somente a origem HTTPS, sem credenciais, caminho, consulta ou fragmento.");
  }
  return url;
}

function validateRequestUrl(raw: string, base: string, trustedOrigin: string): URL {
  let url: URL;
  try { url = new URL(raw, base); }
  catch { throw new Error("O AgilePoint retornou uma URL inválida."); }
  if (url.protocol !== "https:" || url.origin !== trustedOrigin) {
    throw new Error("A requisição ou o redirecionamento tentou sair da origem HTTPS configurada.");
  }
  if (url.username || url.password) throw new Error("URLs com credenciais embutidas não são permitidas.");
  return url;
}

function configuredInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} deve ser um inteiro entre ${minimum} e ${maximum}.`);
  }
  return value;
}

export function encodeMultipartFormData(
  fields: Record<string, string>,
  file: { fieldName: string; filename: string; mimeType: string; body: Buffer },
  boundary = `----AgilePointMcp${randomUUID().replace(/-/g, "")}`,
): { contentType: string; body: Buffer } {
  if (!/^[A-Za-z0-9'-]{20,80}$/.test(boundary)) throw new Error("Boundary multipart inválido.");
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(file.fieldName)) throw new Error("Nome do campo de arquivo inválido.");
  if (!file.filename || /[\r\n\0"\\/]/.test(file.filename)) throw new Error("Nome de arquivo inválido para multipart.");
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(file.mimeType)) throw new Error("Tipo MIME inválido para multipart.");
  const chunks: Buffer[] = [];
  const addText = (value: string) => chunks.push(Buffer.from(value, "utf8"));
  for (const [name, value] of Object.entries(fields)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(name)) throw new Error(`Nome de campo multipart inválido: ${name}.`);
    addText(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  addText(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`);
  chunks.push(file.body);
  addText(`\r\n--${boundary}--\r\n`);
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(chunks) };
}

export function isAuthenticatedDocument(source: string): boolean {
  return /formID=20(?:\D|$)/i.test(source) && !/formID=19(?:\D|$)/i.test(source);
}

export function isLoginDocument(source: string): boolean {
  return /formID=19(?:\D|$)|WFRInput588|Template\s*-\s*Login\s*-\s*Autenticar/i.test(source);
}

function decodeResponse(bytes: Buffer, contentType: string): string {
  return /charset\s*=\s*(?:iso-8859-1|windows-1252)/i.test(contentType)
    ? new TextDecoder("windows-1252").decode(bytes)
    : bytes.toString("utf8");
}

function splitSetCookie(value: string | null): string[] {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/g).map((item) => item.trim()).filter(Boolean);
}
