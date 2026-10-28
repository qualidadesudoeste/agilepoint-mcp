import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { readSheet } from "read-excel-file/node";
import { validateUploadFile, type UploadActionContract } from "./upload-actions.js";
import { BoundedPendingStore } from "./pending-simulations.js";
import { currentActor } from "./access.js";
import { auditActor, auditIdempotencyKey, auditValue } from "./audit-redaction.js";
import { readApfImportControl, type ApfImportControl } from "./apf-artifacts.js";

const HEADER = "Função Transacional (EE, CE, SE) ou Função de Dados (ALI, AIE)";
const SHEET = "Funções";
const MAX_ROWS = 2_000;
const MAX_BYTES = 10 * 1024 * 1024;

export type QuickImportRow = {
  linha: number;
  descricao: string;
  tipo: string;
  atividade: string;
  td: string;
  ar_tr: string;
};

export type QuickImportPreview = {
  arquivo: string;
  sha256: string;
  aba: string;
  cabecalho_linha: number;
  intervalo: string;
  linhas: QuickImportRow[];
  linhas_com_dados: number;
  linhas_separadoras: number;
  tabela_json: string;
  tabela_webrun: string;
  tabela_html: string;
  kit_apf?: ApfImportControl;
};

export type QuickImportSimulation = {
  contagem_id: string;
  caminho_planilha: string;
  sha256: string;
  tabela_sha256: string;
  intervalo: string;
  linhas_com_dados: number;
  grupos: number;
  itens: number;
  kit_apf?: ApfImportControl;
};

const pending = new BoundedPendingStore<QuickImportSimulation>();

export function createQuickImportSimulation(countId: string, file: string, preview: QuickImportPreview) {
  if (!/^\d+$/.test(countId)) throw new Error("O ID da contagem deve ser numérico.");
  const value: QuickImportSimulation = {
    contagem_id: countId,
    caminho_planilha: file,
    sha256: preview.sha256,
    tabela_sha256: createHash("sha256").update(preview.tabela_json).digest("hex"),
    intervalo: preview.intervalo,
    linhas_com_dados: preview.linhas_com_dados,
    grupos: preview.linhas.filter((row) => row.descricao && !row.tipo).length,
    itens: preview.linhas.filter((row) => row.tipo).length,
    ...(preview.kit_apf ? { kit_apf: preview.kit_apf } : {}),
  };
  const token = randomUUID();
  const expiresAt = Date.now() + 10 * 60_000;
  pending.set(token, { expiresAt, value });
  return { confirmacao_token: token, expira_em: new Date(expiresAt).toISOString(), simulacao: value };
}

export function consumeQuickImportSimulation(token: string): QuickImportSimulation {
  const entry = pending.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(token);
    throw new Error("Token inexistente ou expirado. Simule a importação novamente.");
  }
  return entry.value;
}

export function markQuickImportSimulationConsumed(token: string): void { pending.delete(token); }

export function quickImportHash(value: QuickImportSimulation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function recordQuickImportAudit(key: string, simulation: QuickImportSimulation, status: "sucesso" | "falha", outcome: unknown) {
  const directory = process.env.APF_AUDIT_DIR?.trim();
  if (!directory) throw new Error("Defina APF_AUDIT_DIR para registrar a auditoria da importação.");
  const entry = {
    evento_id: randomUUID(),
    ocorrido_em: new Date().toISOString(),
    ator: auditActor(currentActor()),
    chave_idempotencia: auditIdempotencyKey(key),
    payload_hash: quickImportHash(simulation),
    status,
    contagem_id: simulation.contagem_id,
    arquivo_sha256: simulation.sha256,
    intervalo: simulation.intervalo,
    grupos: simulation.grupos,
    itens: simulation.itens,
    resultado: auditValue(outcome),
  };
  const file = path.join(path.resolve(directory), "importacoes-rapidas.jsonl");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

function normalized(value: unknown): string {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

function cellText(value: unknown, row: number, column: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`A célula ${column}${row} deve conter texto ou número.`);
  }
  const text = String(value).trim();
  if (text.length > 1_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new Error(`A célula ${column}${row} contém texto inválido ou muito longo.`);
  }
  return text;
}

function htmlCell(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function webrunString(value: string | null): string {
  if (value === null) return "null";
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}'`;
}

export function buildQuickImportWebrunArray(rows: QuickImportRow[]): string {
  const objects = rows.map((row) => {
    const fields = [row.descricao, row.tipo, row.atividade, row.td, row.ar_tr];
    return `{${fields.map((value, index) => `"field${index}":${webrunString(value ? htmlCell(value) : null)}`).join(",")},JSONInstanceJS:true}`;
  });
  return `ArrayInstance([${objects.join(",")}])`;
}

export function buildQuickImportHtml(rows: QuickImportRow[]): string {
  return `<table><tbody>${rows.map((row) => `<tr><td colspan="5">${htmlCell(row.descricao)}</td><td>${htmlCell(row.tipo)}</td><td>${htmlCell(row.atividade)}</td><td>${htmlCell(row.td)}</td><td>${htmlCell(row.ar_tr)}</td></tr>`).join("")}</tbody></table>`;
}

export function parseQuickImportRows(sheetRows: unknown[][], filename: string, sha256: string): QuickImportPreview {
  if (sheetRows.length > 10_000) throw new Error("A planilha excede o limite de linhas permitido.");
  const headers = sheetRows.flatMap((row, index) => normalized(row[2]) === normalized(HEADER) ? [index] : []);
  if (headers.length !== 1) throw new Error("A aba Funções deve conter exatamente um cabeçalho de função na coluna C.");
  const headerIndex = headers[0];
  const header = sheetRows[headerIndex];
  if (["Tipo", "TD", "AR/TR"].some((label) => !header.slice(7, 11).some((cell) => normalized(cell) === normalized(label)))) {
    throw new Error("As colunas H:K da aba Funções não correspondem ao modelo de importação.");
  }
  const raw = sheetRows.slice(headerIndex + 1).map((row, index) => ({
    linha: headerIndex + index + 2,
    descricao: cellText(row[2], headerIndex + index + 2, "C"),
    tipo: cellText(row[7], headerIndex + index + 2, "H"),
    atividade: cellText(row[8], headerIndex + index + 2, "I"),
    td: cellText(row[9], headerIndex + index + 2, "J"),
    ar_tr: cellText(row[10], headerIndex + index + 2, "K"),
  }));
  let last = -1;
  raw.forEach((row, index) => {
    if (row.descricao || row.tipo || row.atividade || row.td || row.ar_tr) last = index;
  });
  if (last < 0) throw new Error("Não há dados abaixo do cabeçalho C da aba Funções.");
  const lines = raw.slice(0, last + 1);
  if (lines.length > MAX_ROWS) throw new Error(`A importação excede ${MAX_ROWS} linhas.`);
  let groups = 0;
  let items = 0;
  for (const row of lines) {
    if (!row.descricao && (row.tipo || row.atividade || row.td || row.ar_tr)) {
      throw new Error(`A linha ${row.linha} contém dados em H:K sem descrição na coluna C.`);
    }
    if (row.tipo && !["ALI", "AIE", "EE", "CE", "SE"].includes(row.tipo.toUpperCase())) {
      throw new Error(`O tipo da linha ${row.linha} deve ser ALI, AIE, EE, CE ou SE.`);
    }
    if (row.descricao && !row.tipo) {
      if (row.atividade || row.td || row.ar_tr) throw new Error(`A linha de grupo ${row.linha} não pode ter dados em I:K.`);
      groups += 1;
    } else if (row.tipo) {
      if (!groups) throw new Error(`A linha ${row.linha} precisa estar abaixo de um grupo de função.`);
      if (!row.atividade || !row.td || !row.ar_tr) throw new Error(`A linha ${row.linha} precisa preencher H:K.`);
      if (!["I", "A", "E", "T", "AV", "MI", "AD", "MA", "AP"].includes(row.atividade.toUpperCase())) {
        throw new Error(`A atividade da linha ${row.linha} não consta no cabeçalho do modelo.`);
      }
      items += 1;
    }
    for (const [column, value] of [["J", row.td], ["K", row.ar_tr]] as const) {
      if (value && !/^\d+$/.test(value)) throw new Error(`A célula ${column}${row.linha} deve ser um inteiro não negativo.`);
    }
  }
  if (!groups || !items) throw new Error("A planilha precisa conter ao menos um grupo e um item de função.");
  // O Excel copia C:G mescladas como uma célula; o modal lê cinco células por linha.
  const table = lines.map((row) => ({
    field0: row.descricao ? htmlCell(row.descricao) : null,
    field1: row.tipo ? htmlCell(row.tipo) : null,
    field2: row.atividade ? htmlCell(row.atividade) : null,
    field3: row.td ? htmlCell(row.td) : null,
    field4: row.ar_tr ? htmlCell(row.ar_tr) : null,
  }));
  return {
    arquivo: filename,
    sha256,
    aba: SHEET,
    cabecalho_linha: headerIndex + 1,
    intervalo: `C${headerIndex + 2}:K${lines.at(-1)!.linha}`,
    linhas: lines,
    linhas_com_dados: lines.filter((row) => row.descricao).length,
    linhas_separadoras: lines.filter((row) => !row.descricao).length,
    tabela_json: JSON.stringify(table),
    tabela_webrun: buildQuickImportWebrunArray(lines),
    tabela_html: buildQuickImportHtml(lines),
  };
}

export async function readQuickImportWorkbook(file: string): Promise<QuickImportPreview> {
  const contract = {
    allowedExtensions: [".xlsx"],
    allowedMimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxBytes: MAX_BYTES,
  } as UploadActionContract;
  const validated = await validateUploadFile(file, contract);
  const rows = await readSheet(validated.body, SHEET);
  const preview = parseQuickImportRows(rows, validated.filename, createHash("sha256").update(validated.body).digest("hex"));
  const generatedByKit = rows[3]?.[1] === "AgilePoint MCP — Contagem de pontos de função";
  const kit = await readApfImportControl(validated.path, preview.sha256, preview.linhas, generatedByKit);
  if (kit) preview.kit_apf = kit;
  return preview;
}
