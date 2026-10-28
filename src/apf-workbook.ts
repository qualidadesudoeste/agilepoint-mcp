import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { APF_ACTIVITIES, APF_TYPES, type ApfPreparedCount } from "./apf-kit.js";

export const APF_TEMPLATE_SHA256 = "4be7dfbdc4cf6e503b9c073c79e2f0f206d937c16df2bf427e4558afa6385865";
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const FIRST_ROW = 12;
const LAST_ROW = 774;
const WRAP_STYLE = 169;
const TITLE_STYLE = 170;
const HEADER_STYLE = 171;

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function literal(address: string, value: string | number | null, style = WRAP_STYLE): string {
  if (value === null) return `<c r="${address}" s="${style}"/>`;
  if (typeof value === "number") return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
  // Explicit inline strings prevent Excel formula and hyperlink interpretation.
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function formula(address: string, expression: string, cached: string | number, style = 115): string {
  return `<c r="${address}" s="${style}"${typeof cached === "string" ? ' t="str"' : ""}><f>${xml(expression)}</f><v>${xml(String(cached))}</v></c>`;
}

function simpleSheet(rows: string[], widths: number[], lastColumn: string, freeze = 0, title = true): string {
  const views = freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const height = (cells: string) => {
    const lines = [...cells.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(.*?)<\/c>/gs)].map((match) => {
      const column = match[1].split("").reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
      const content = /<t[^>]*>(.*?)<\/t>/s.exec(match[2])?.[1].replace(/&(?:amp|lt|gt|quot|apos);/g, "x") ?? "";
      return content.split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / Math.max(1, widths[column] - 3))), 0);
    });
    return Math.min(409, Math.max(30, Math.max(1, ...lines) * 18 + 8));
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}"><dimension ref="A1:${lastColumn}${rows.length}"/>${views}<sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((cells, i) => `<row r="${i + 1}" ht="${i === 0 && title ? 36 : height(cells)}" customHeight="1">${cells}</row>`).join("")}</sheetData>${title ? `<mergeCells count="1"><mergeCell ref="A1:${lastColumn}1"/></mergeCells>` : ""}<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0" footer="0"/></worksheet>`;
}

/** Build an XLSX from the supplied kit's layout. Only the bundled, hash-pinned template is read. */
export async function generateApfWorkbook(prepared: ApfPreparedCount): Promise<Buffer> {
  const template = await readFile(new URL("../assets/apf/FPA-MODELO.xlsx", import.meta.url));
  if (createHash("sha256").update(template).digest("hex") !== APF_TEMPLATE_SHA256) {
    throw new Error("O modelo APF instalado está ausente ou foi alterado. Reinstale o pacote oficial.");
  }
  const source = unzipSync(template);
  const $ = load(strFromU8(source["xl/worksheets/sheet2.xml"]), { xml: true });
  const expressions = new Map<string, string>();
  const cells = new Map<string, ReturnType<typeof $>>();
  const rows = new Map<string, ReturnType<typeof $>>();
  $("c").each((_, element) => {
    const cell = $(element);
    cells.set(cell.attr("r")!, cell);
    if (cell.find("f").length) expressions.set(cell.attr("r")!, cell.find("f").text());
  });
  $("row").each((_, element) => { rows.set($(element).attr("r")!, $(element)); });
  // Original generic formulas, defaults, comments and author material must not survive as stale results.
  $("c").each((_, element) => { $(element).empty().removeAttr("t"); });
  $("drawing, legacyDrawing, hyperlinks, extLst, dataValidations, sheetProtection").remove();
  $("selection").attr({ activeCell: "A1", sqref: "A1" });
  $("sheetView").attr({ zoomScale: "85", zoomScaleNormal: "85", tabSelected: "1" });
  const set = (address: string, value: string | number | null) => {
    const cell = cells.get(address);
    if (!cell) throw new Error(`Célula ${address} ausente no modelo APF.`);
    cell.replaceWith(literal(address, value, Number(cell.attr("s") ?? 114)));
  };
  const setFormula = (address: string, expression: string, cached: string | number) => {
    const cell = cells.get(address);
    if (!cell || !expression) throw new Error(`Fórmula ${address} ausente no modelo APF.`);
    cell.replaceWith(formula(address, expression, cached, Number(cell.attr("s") ?? 115)));
  };
  set("B4", "AgilePoint MCP — Contagem de pontos de função");
  set("B7", `Aplicação: ${prepared.aplicacao}`);
  set("H7", `Versão: ${prepared.versao}`);
  set("H8", "Metodologia:");
  set("K8", prepared.metodologia);
  set("B9", `Preparado em: ${prepared.preparado_em}`);
  set("H9", "Fatores e fontes: aba Contagem. Evidências: aba Evidências.");
  set("B10", "Preparação local; importação C:K não transfere observações R.");
  set("O10", prepared.totais.pf_base);
  set("Q10", prepared.totais.pf_equivalente === null ? "Equivalente pendente" : `Equivalente: ${prepared.totais.pf_equivalente}`);
  const headers: Record<string, string> = {
    B11: "Grupo", C11: "Função Transacional (EE, CE, SE) ou Função de Dados (ALI, AIE)",
    H11: "Tipo", I11: "(I/A/E/T/AV/MI/AD/MA/AP)", J11: "TD", K11: "AR/TR", L11: "ctl", M11: "C",
    N11: "Complex.", O11: "PF base", P11: "PF equivalente", Q11: "Fator", R11: "Justificativa / evidências",
  };
  for (const [address, value] of Object.entries(headers)) set(address, value);

  const metadataRows: string[] = [
    literal("A1", "AgilePoint MCP — Preparação de contagem", TITLE_STYLE),
    literal("A2", "Aplicação") + literal("B2", prepared.aplicacao),
    literal("A3", "Versão") + literal("B3", prepared.versao),
    literal("A4", "Metodologia / contrato informado") + literal("B4", prepared.metodologia),
    literal("A5", "Preparado em") + literal("B5", prepared.preparado_em),
    literal("A6", "Motor de cálculo") + literal("B6", `${prepared.fonte.identificador} ${prepared.fonte.versao} — ${prepared.fonte.regra}`),
    literal("A7", "Escopo da importação") + literal("B7", "C:K da aba Funções; observações/evidências ficam neste XLSX e no JSON de preparação."),
    literal("A8", "Revisão") + literal("B8", "Funções identificadas pela IA/pessoa; revisar evidências e conciliar fatores com a convenção do AgilePoint antes de gravar."),
    ["Atividade", "Modo", "Valor", "Fonte"].map((name, i) => literal(`${String.fromCharCode(65 + i)}9`, name, HEADER_STYLE)).join(""),
  ];
  const factorRows = new Map<string, number>();
  for (const activity of APF_ACTIVITIES) {
    const row = metadataRows.length + 1;
    factorRows.set(activity, row);
    const factor = prepared.fatores?.[activity];
    metadataRows.push(literal(`A${row}`, activity) + literal(`B${row}`, factor?.modo ?? "Pendente")
      + literal(`C${row}`, factor?.valor ?? null) + literal(`D${row}`, factor?.fonte ?? "Fator não informado; PF equivalente não presumido."));
  }
  const evidenceRows = [["Grupo", "Função", "Tipo", "Atividade", "Justificativa (continuação nas linhas seguintes)", "Evidência", "Fator / fonte"].map((name, i) => literal(`${String.fromCharCode(65 + i)}1`, name, HEADER_STYLE)).join("")];
  let currentRow = FIRST_ROW;
  let groupNumber = 0;
  const allFunctions = prepared.grupos.flatMap((group) => group.funcoes);
  for (const group of prepared.grupos) {
    if (currentRow + group.funcoes.length > LAST_ROW) throw new Error("A contagem excede a capacidade de linhas do modelo APF.");
    groupNumber += 1;
    set(`C${currentRow}`, group.nome);
    set(`B${currentRow}`, `F${groupNumber}`);
    currentRow += 1;
    for (const item of group.funcoes) {
      const row = currentRow++;
      for (const [column, value] of Object.entries({ C: item.nome, H: item.tipo, I: item.atividade, J: item.td, K: item.ar_tr })) set(`${column}${row}`, value);
      const code = item.complexidade === "Baixa" ? "L" : item.complexidade === "Média" ? "A" : "H";
      setFormula(`L${row}`, `H${row}&M${row}`, `${item.tipo}${code}`);
      for (const [column, value] of [["M", code], ["N", item.complexidade], ["O", item.pf_base]] as const) {
        setFormula(`${column}${row}`, expressions.get(`${column}${row}`)!, value);
      }
      const factorRow = factorRows.get(item.atividade)!;
      const expression = `IF('Contagem'!B${factorRow}="fixo",'Contagem'!C${factorRow},IF('Contagem'!B${factorRow}="multiplicador",ROUND(O${row}*'Contagem'!C${factorRow},6),""))`;
      setFormula(`P${row}`, expression, item.pf_equivalente ?? "");
      set(`Q${row}`, item.fator_aplicado ? `${item.fator_aplicado.modo === "fixo" ? "fixo " : "× "}${item.fator_aplicado.valor}` : "Pendente");
      const observation = `${item.justificativa}\nEvidências: ${item.evidencias.join("; ")}`;
      set(`R${row}`, observation.length > 32_000 ? `${observation.slice(0, 31_900)}\n[Texto completo na aba Evidências]` : observation);
      rows.get(String(row))!.attr({ ht: "72", customHeight: "1" });
      const chunks = item.justificativa.match(/[\s\S]{1,1500}/gu) ?? [item.justificativa];
      // One evidence per row and short justification chunks keep full source text visible in Excel.
      for (let continuation = 0; continuation < Math.max(chunks.length, item.evidencias.length); continuation += 1) {
        const er = evidenceRows.length + 1;
        evidenceRows.push([group.nome, item.nome, item.tipo, item.atividade, chunks[continuation] ?? "", item.evidencias[continuation] ?? "", item.fator_aplicado ? `${item.fator_aplicado.modo} ${item.fator_aplicado.valor}; ${item.fator_aplicado.fonte}` : "Pendente"].map((value, index) => literal(`${String.fromCharCode(65 + index)}${er}`, value)).join(""));
      }
    }
    currentRow += 1;
  }
  const last = currentRow - 2;
  // Empty preformatted rows keep the template layout without thousands of stale formula caches.
  const summaryRows = [
    literal("A1", "Sumário da preparação APF", TITLE_STYLE),
    literal("A2", "Aplicação") + literal("B2", prepared.aplicacao),
    literal("A3", "Versão") + literal("B3", prepared.versao),
    literal("A4", "Metodologia") + literal("B4", prepared.metodologia),
    literal("A5", "Funções") + formula("B5", `COUNT('Funções'!O12:O${last})`, prepared.totais.funcoes),
    literal("A6", "PF base") + formula("B6", `SUM('Funções'!O12:O${last})`, prepared.totais.pf_base),
    literal("A7", "PF equivalente") + formula("B7", `IF(COUNT('Funções'!P12:P${last})<>COUNT('Funções'!O12:O${last}),"Pendente",SUM('Funções'!P12:P${last}))`, prepared.totais.pf_equivalente ?? "Pendente"),
    literal("A8", "Critério") + literal("B8", "Equivalente depende dos fatores explícitos por atividade; sem fator, permanece pendente. Não constitui aceite do AgilePoint."),
    ["Tipo", "Complexidade", "Quantidade", "PF base", "PF equivalente"].map((name, i) => literal(`${String.fromCharCode(65 + i)}9`, name, HEADER_STYLE)).join(""),
  ];
  for (const type of APF_TYPES) for (const complexity of ["Baixa", "Média", "Alta"] as const) {
    const row = summaryRows.length + 1;
    const matches = allFunctions.filter((item) => item.tipo === type && item.complexidade === complexity);
    const quantity = matches.length;
    const base = matches.reduce((sum, item) => sum + item.pf_base, 0);
    const equivalent = matches.every((item) => item.pf_equivalente !== null) ? Math.round(matches.reduce((sum, item) => sum + item.pf_equivalente!, 0) * 1e6) / 1e6 : "Pendente";
    const criteria = `'Funções'!H12:H${last},A${row},'Funções'!N12:N${last},B${row}`;
    summaryRows.push(literal(`A${row}`, type) + literal(`B${row}`, complexity)
      + formula(`C${row}`, `COUNTIFS(${criteria})`, quantity)
      + formula(`D${row}`, `SUMIFS('Funções'!O12:O${last},${criteria})`, base)
      + formula(`E${row}`, `IF(COUNTIFS(${criteria},'Funções'!P12:P${last},"<>")<>C${row},"Pendente",SUMIFS('Funções'!P12:P${last},${criteria}))`, equivalent));
  }
  for (const warning of prepared.avisos) {
    const row = summaryRows.length + 1;
    summaryRows.push(literal(`A${row}`, "Aviso") + literal(`B${row}`, warning));
  }

  // Closed part list discards comments, author properties, third-party logos, macros, links and drawings.
  const output: Record<string, Uint8Array> = {};
  output["xl/theme/theme1.xml"] = source["xl/theme/theme1.xml"];
  const styles = load(strFromU8(source["xl/styles.xml"]), { xml: true });
  if (styles("cellXfs > xf").length !== WRAP_STYLE) throw new Error("Os estilos do modelo APF foram alterados.");
  for (const index of [114, 113, 24]) {
    const style = styles("cellXfs > xf").eq(index).clone();
    style.attr("applyAlignment", "1").find("alignment").remove();
    style.append('<alignment horizontal="left" vertical="top" wrapText="1"/>');
    styles("cellXfs").append(style);
  }
  styles("cellXfs").attr("count", String(HEADER_STYLE + 1));
  output["xl/styles.xml"] = strToU8(styles.xml());
  output["xl/worksheets/sheet1.xml"] = strToU8(simpleSheet(metadataRows, [33, 60, 16, 100], "D"));
  output["xl/worksheets/sheet2.xml"] = strToU8($.xml());
  output["xl/worksheets/sheet3.xml"] = strToU8(simpleSheet(summaryRows, [30, 65, 16, 16, 20], "E"));
  output["xl/worksheets/sheet4.xml"] = strToU8(simpleSheet(evidenceRows, [30, 45, 12, 14, 90, 90, 80], "G", 1, false));
  output["xl/workbook.xml"] = strToU8(`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView activeTab="1"/></bookViews><sheets>${["Contagem", "Funções", "Sumário", "Evidências"].map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames><definedName name="CF">'Funções'!$L$12:$L$${last}</definedName></definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  output["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2, 3, 4].map((i) => `<Relationship Type="${REL}/worksheet" Target="worksheets/sheet${i}.xml" Id="rId${i}"/>`).join("")}<Relationship Type="${REL}/styles" Target="styles.xml" Id="rId5"/><Relationship Type="${REL}/theme" Target="theme/theme1.xml" Id="rId6"/></Relationships>`);
  output["_rels/.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="${REL}/officeDocument" Target="xl/workbook.xml" Id="rId1"/></Relationships>`);
  output["[Content_Types].xml"] = strToU8(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${[1, 2, 3, 4].map((i) => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  return Buffer.from(zipSync(output, { level: 6 }));
}
