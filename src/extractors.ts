import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { FunctionalityDetails } from "./session.js";

export type RankingApfRow = {
  posicao: number;
  aplicacao: string;
  aplicacao_id: string;
  projeto_id: string;
  gerente: string;
  sprint: string;
  sprint_id: string;
  desenvolvedor: string;
  colaborador_id: string;
  pf_gerado: number | null;
  pf_equivalente: number | null;
  tipo_atividade: string | null;
  fator_aplicado: number | null;
  auditoria_pf: { calculo: string; origem_fator: "calculado_do_agregado" | "indisponivel" };
};

export type RepositoryCatalogItem = {
  id: string;
  titulo: string;
  descricao: string;
  categoria: string;
  media_estrelas: number | null;
  quantidade_avaliacoes: number;
};

export type RankingRepositorioRow = {
  posicao: number;
  conteudo_id: string;
  conteudo_id_origem: string | null;
  titulo: string;
  conteudo: string;
  descricao: string;
  desenvolvedor: string;
  colaborador_id: string;
  colaborador_id_origem: string | null;
  nota: number | null;
  categoria: string | null;
  categoria_id_origem: string | null;
  data_publicacao: string | null;
  versao_conteudo: string | null;
  aprovacao_cto: boolean | null;
  media_estrelas: number | null;
  quantidade_avaliacoes: number | null;
  quantidade_eu_nao_sabia: number | null;
  indicacao_instrutor: boolean | null;
  percentual_aprovacao_tech_pulse: number | null;
  campos_indisponiveis_na_fonte: string[];
};

export type ContagemRow = {
  contagem_id: string;
  contagem_id_origem: string | null;
  versao: string;
  data_criacao: string;
  aplicacao: string;
  aplicacao_id: string;
  aplicacao_id_origem: string | null;
  tipo: string;
  situacao: string;
};

export type RawRepositoryRow = {
  posicao: number;
  titulo: string;
  descricao: string;
  desenvolvedor: string;
  nota: number | null;
};

export type UnavailableFunctionalityDetail = {
  id: string;
  titulo: string;
  motivo: string;
};

export async function loadAvailableFunctionalityDetails(
  rows: RawRepositoryRow[],
  catalog: RepositoryCatalogItem[],
  loader: (id: string) => Promise<FunctionalityDetails>,
): Promise<{ details: Map<string, FunctionalityDetails>; unavailable: UnavailableFunctionalityDetail[] }> {
  const details = new Map<string, FunctionalityDetails>();
  const unavailable: UnavailableFunctionalityDetail[] = [];
  for (const item of catalog) {
    const appearsInRanking = rows.some((row) =>
      normalize(row.titulo) === normalize(item.titulo)
      || (normalize(row.descricao) === normalize(item.descricao) && normalize(row.descricao) !== "")
    );
    if (!appearsInRanking) continue;
    try {
      details.set(item.id, await loader(item.id));
    } catch (error) {
      unavailable.push({
        id: item.id,
        titulo: item.titulo,
        motivo: error instanceof Error ? error.message : "Detalhes indisponíveis no AgilePoint.",
      });
    }
  }
  return { details, unavailable };
}

export function ptNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stableId(namespace: string, value: string): string {
  const digest = createHash("sha256").update(`${namespace}:${normalize(value)}`).digest("hex").slice(0, 24);
  return `apf:${namespace}:${digest}`;
}

export function mapRankingApfRows(rows: Array<Record<string, unknown>>): RankingApfRow[] {
  return rows.map((row, index) => {
    const aplicacao = String(row.field1026492 ?? "").trim();
    const sprint = String(row.field1136065 ?? "").trim();
    const desenvolvedor = String(row.field1026494 ?? "").trim();
    const pfGerado = ptNumber(row.field1026495);
    const pfEquivalente = ptNumber(row.field1135985);
    const fator = pfGerado !== null && pfGerado !== 0 && pfEquivalente !== null
      ? Number((pfEquivalente / pfGerado).toFixed(6))
      : null;

    return {
      posicao: index + 1,
      aplicacao,
      aplicacao_id: stableId("aplicacao", aplicacao),
      projeto_id: stableId("projeto", aplicacao),
      gerente: String(row.field1026493 ?? "").trim(),
      sprint,
      sprint_id: stableId("sprint", `${aplicacao}|${sprint}`),
      desenvolvedor,
      colaborador_id: stableId("colaborador", desenvolvedor),
      pf_gerado: pfGerado,
      pf_equivalente: pfEquivalente,
      tipo_atividade: null,
      fator_aplicado: fator,
      auditoria_pf: {
        calculo: fator === null ? "fator indisponível" : `pf_equivalente / pf_gerado = ${fator}`,
        origem_fator: fator === null ? "indisponivel" : "calculado_do_agregado",
      },
    };
  });
}

export function mapRankingRepositorioRaw(rows: Array<Record<string, unknown>>): RawRepositoryRow[] {
  return rows.map((row, index) => ({
    posicao: index + 1,
    titulo: String(row.field1135841 ?? "").trim(),
    descricao: String(row.field1135842 ?? "").trim(),
    desenvolvedor: String(row.field1135843 ?? "").trim(),
    nota: ptNumber(row.field1135844),
  }));
}

export function enrichRankingRepositorio(
  rows: RawRepositoryRow[],
  catalog: RepositoryCatalogItem[],
  details: Map<string, FunctionalityDetails>,
): RankingRepositorioRow[] {
  return rows.map((row) => {
    const item = catalog.find((candidate) =>
      normalize(candidate.titulo) === normalize(row.titulo)
      || (normalize(candidate.descricao) === normalize(row.descricao) && normalize(candidate.descricao) !== "")
    );
    const detail = item ? details.get(item.id) : undefined;
    const sourceContentId = detail?.conteudo_id_origem ?? item?.id ?? null;
    const sourceCollaboratorId = detail?.colaborador_id_origem ?? null;
    return {
      ...row,
      conteudo_id: sourceContentId ? `apf:conteudo:${sourceContentId}` : stableId("conteudo", `${row.titulo}|${row.descricao}`),
      conteudo_id_origem: sourceContentId,
      conteudo: row.descricao,
      colaborador_id: sourceCollaboratorId ? `apf:colaborador:${sourceCollaboratorId}` : stableId("colaborador", row.desenvolvedor),
      colaborador_id_origem: sourceCollaboratorId,
      categoria: item?.categoria || null,
      categoria_id_origem: detail?.categoria_id_origem ?? null,
      data_publicacao: detail?.data_publicacao ?? null,
      versao_conteudo: detail?.versao_conteudo ?? null,
      aprovacao_cto: null,
      media_estrelas: item?.media_estrelas ?? null,
      quantidade_avaliacoes: item?.quantidade_avaliacoes ?? null,
      quantidade_eu_nao_sabia: null,
      indicacao_instrutor: null,
      percentual_aprovacao_tech_pulse: null,
      campos_indisponiveis_na_fonte: [
        "aprovacao_cto",
        "quantidade_eu_nao_sabia",
        "indicacao_instrutor",
        "percentual_aprovacao_tech_pulse",
      ],
    };
  });
}

export function extractContagensHtml(html: string, limit: number): { contagens: ContagemRow[]; possuiProximaPagina: boolean } {
  const $ = load(html);
  const rows = $("#results-table tbody tr").toArray().map((row) =>
    $(row).find("td").toArray().map((cell) => cleanCountCell($(cell).text()))
  ).filter((cells) => cells.length >= 5 && cells.some(Boolean));
  return {
    contagens: mapContagemCells(rows, limit),
    possuiProximaPagina: $("#nav-item-next:not(.disabled) a").length > 0,
  };
}

function cleanCountCell(value: string): string {
  // O Webrun às vezes devolve entidades duplamente escapadas ("&amp;nbsp;").
  // Decodificamos somente texto: caracteres '<' e '>' não viram HTML executável.
  const escaped = value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return load(`<span>${escaped}</span>`)("span").text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function mapContagemCells(rows: string[][], limit: number): ContagemRow[] {
  return rows.slice(0, limit).map((cells) => {
    const aplicacao = cells[2] ?? "";
    return {
      contagem_id: stableId("contagem", `${aplicacao}|${cells[0] ?? ""}`),
      contagem_id_origem: null,
      versao: cells[0] ?? "",
      data_criacao: cells[1] ?? "",
      aplicacao,
      aplicacao_id: stableId("aplicacao", aplicacao),
      aplicacao_id_origem: null,
      tipo: cells[3] ?? "",
      situacao: cells[4] ?? "",
    };
  });
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}
