import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { apfPreparationSchema, prepareApfCount, type ApfPreparedCount } from "./apf-kit.js";
import { generateApfWorkbook } from "./apf-workbook.js";
import { validateUploadFile, type UploadActionContract } from "./upload-actions.js";
import type { QuickImportRow } from "./quick-import.js";
import type { ActivityConvention } from "./factors.js";

const FORMAT = "agilepoint-apf-kit/v1";
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const manifestSchema = z.object({
  formato: z.literal(FORMAT),
  planilha_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contagem: apfPreparationSchema,
}).strict();

export type ApfImportControl = {
  aplicacao: string;
  versao: string;
  metodologia: string;
  pf_base: number;
  pf_equivalente: number | null;
  fatores: NonNullable<ApfPreparedCount["fatores"]>;
  atividades: string[];
  manifesto_sha256: string;
};

function sha256(body: Buffer | string): string { return createHash("sha256").update(body).digest("hex"); }

export function apfImportRows(prepared: ApfPreparedCount): QuickImportRow[] {
  let row = 12;
  const rows: QuickImportRow[] = [];
  for (const group of prepared.grupos) {
    rows.push({ linha: row++, descricao: group.nome, tipo: "", atividade: "", td: "", ar_tr: "" });
    for (const item of group.funcoes) rows.push({
      linha: row++, descricao: item.nome, tipo: item.tipo, atividade: item.atividade,
      td: String(item.td), ar_tr: String(item.ar_tr),
    });
    rows.push({ linha: row++, descricao: "", tipo: "", atividade: "", td: "", ar_tr: "" });
  }
  while (rows.length && !rows.at(-1)!.descricao) rows.pop();
  return rows;
}

/** The companion contains input data, never a trusted precomputed total or executable code. */
export function verifyApfManifest(raw: unknown, workbookHash: string, rows: QuickImportRow[], manifestHash: string): ApfImportControl {
  const manifest = manifestSchema.parse(raw);
  if (manifest.planilha_sha256 !== workbookHash) throw new Error("A planilha diverge do arquivo .apf.json. Gere novamente os artefatos do kit.");
  const prepared = prepareApfCount(manifest.contagem);
  const expected = apfImportRows(prepared);
  const comparable = (values: QuickImportRow[]) => values.map(({ descricao, tipo, atividade, td, ar_tr }) => [descricao, tipo, atividade, td, ar_tr]);
  if (JSON.stringify(comparable(rows)) !== JSON.stringify(comparable(expected))) {
    throw new Error("Os dados C:K divergem da contagem de conferência. Gere novamente os artefatos do kit.");
  }
  return {
    aplicacao: prepared.aplicacao, versao: prepared.versao, metodologia: prepared.metodologia,
    pf_base: prepared.totais.pf_base, pf_equivalente: prepared.totais.pf_equivalente,
    fatores: prepared.fatores ?? {}, atividades: [...new Set(prepared.grupos.flatMap((group) => group.funcoes.map((item) => item.atividade)))],
    manifesto_sha256: manifestHash,
  };
}

export async function readApfImportControl(file: string, workbookHash: string, rows: QuickImportRow[], required = false): Promise<ApfImportControl | undefined> {
  const companion = file.replace(/\.xlsx$/i, ".apf.json");
  // Only a missing companion is legacy input; malformed or inaccessible controls fail closed.
  try { await realpath(companion); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (required) throw new Error("A planilha foi gerada pelo kit APF, mas seu .apf.json está ausente. Mantenha os dois arquivos juntos ou gere novamente os artefatos.");
      return undefined;
    }
    throw error;
  }
  const validated = await validateUploadFile(companion, {
    allowedExtensions: [".json"], allowedMimeTypes: ["application/json"], maxBytes: MAX_MANIFEST_BYTES,
  } as UploadActionContract);
  return verifyApfManifest(JSON.parse(validated.body.toString("utf8")), workbookHash, rows, validated.sha256);
}

export function assertApfImportTarget(control: ApfImportControl | undefined,
  count: { application: string; version: string }, conventions: ActivityConvention[]): void {
  if (!control) return;
  const normal = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  if (normal(control.aplicacao) !== normal(count.application) || normal(control.versao) !== normal(count.version)) {
    throw new Error("A aplicação/versão da planilha do kit não corresponde à contagem selecionada. Nenhum dado foi enviado.");
  }
  if (control.pf_equivalente === null) throw new Error("O PF equivalente do kit está pendente. Consulte consultar_fatores_contagem e gere novamente a planilha com os fatores efetivos.");
  for (const activity of control.atividades) {
    const factor = control.fatores[activity as keyof typeof control.fatores];
    if (!factor || factor.modo !== "multiplicador") throw new Error("A importação do kit requer fatores multiplicadores compatíveis com o endpoint. Valores fixos são apenas para preparação local.");
    const published = conventions.find((item) => item.atividade === activity);
    if (!published || Math.abs(published.fator - factor.valor) > 0.000001) {
      throw new Error(`O fator ${activity} da planilha diverge da convenção vigente no AgilePoint. Consulte os fatores e gere novamente os artefatos.`);
    }
  }
}

async function privateRoot(variable: "APF_EXPORT_DIR" | "APF_UPLOAD_DIR"): Promise<string> {
  const configured = process.env[variable]?.trim();
  if (!configured) throw new Error(`Configure ${variable} para gerar os artefatos locais do kit.`);
  await mkdir(path.resolve(configured), { recursive: true, mode: 0o700 });
  return realpath(path.resolve(configured));
}

/** Generated names and exclusive writes avoid caller-controlled paths and accidental replacement. */
export async function saveApfArtifacts(prepared: ApfPreparedCount) {
  // Reparse inputs to prevent computed fields being accepted as new caller-supplied controls.
  const input = apfPreparationSchema.parse({
    aplicacao: prepared.aplicacao, versao: prepared.versao, metodologia: prepared.metodologia,
    grupos: prepared.grupos.map((group) => ({ nome: group.nome, funcoes: group.funcoes.map(({ nome, tipo, atividade, td, ar_tr, justificativa, evidencias }) => ({ nome, tipo, atividade, td, ar_tr, justificativa, evidencias })) })),
    ...(prepared.fatores ? { fatores: prepared.fatores } : {}),
  });
  const estimatedManifest = JSON.stringify({ formato: FORMAT, planilha_sha256: "0".repeat(64), contagem: input }, null, 2);
  if (Buffer.byteLength(estimatedManifest, "utf8") + 1 > MAX_MANIFEST_BYTES) throw new Error("As justificativas/evidências excedem o limite de 8 MiB do arquivo de conferência. Reduza os textos ou divida a contagem antes de gerar.");
  const workbook = await generateApfWorkbook(prepared);
  if (workbook.length > 10 * 1024 * 1024) throw new Error("A planilha gerada excede o limite de 10 MiB da importação rápida. Divida a contagem.");
  const manifest = { formato: FORMAT, planilha_sha256: sha256(workbook), contagem: input };
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  const exportRoot = await privateRoot("APF_EXPORT_DIR");
  const uploadRoot = await privateRoot("APF_UPLOAD_DIR");
  const bundleId = `contagem-apf-${randomUUID()}`;
  const directories: string[] = [];
  try {
    for (const root of [...new Set([exportRoot, uploadRoot])]) {
      const directory = path.join(root, bundleId);
      await mkdir(directory, { mode: 0o700 });
      directories.push(directory);
      await writeFile(path.join(directory, "contagem.xlsx"), workbook, { flag: "wx", mode: 0o600 });
      await writeFile(path.join(directory, "contagem.apf.json"), body, { flag: "wx", mode: 0o600 });
    }
  } catch (error) {
    // These exclusively-created directories are generated direct children of validated roots.
    for (const directory of directories) await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    artefato_id: bundleId,
    exportacao: { planilha: path.join(exportRoot, bundleId, "contagem.xlsx"), conferencia: path.join(exportRoot, bundleId, "contagem.apf.json") },
    importacao: { caminho_planilha: path.join(uploadRoot, bundleId, "contagem.xlsx"), conferencia: path.join(uploadRoot, bundleId, "contagem.apf.json") },
    sha256: manifest.planilha_sha256, manifesto_sha256: sha256(body), totais: prepared.totais,
    avisos: prepared.avisos,
    proximo_passo: "Revise os artefatos e consulte os fatores da contagem. Depois use simular_importacao_rapida com o caminho de importação e o ID da contagem aberta; a importação exige a aprovação configurada.",
    gravado_no_agilepoint: false,
  };
}
