import { z } from "zod";

export const APF_KIT_VERSION = "1.1.0";
export const APF_TYPES = ["ALI", "AIE", "EE", "CE", "SE"] as const;
export const APF_ACTIVITIES = ["I", "A", "E", "T", "AV", "MI", "AD", "MA", "AP"] as const;
export type ApfType = typeof APF_TYPES[number];
export type ApfActivity = typeof APF_ACTIVITIES[number];
export type ApfComplexity = "Baixa" | "Média" | "Alta";

const text = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value), "Texto contém caracteres de controle inválidos.");
const key = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");

export const apfFactorSchema = z.object({
  modo: z.enum(["multiplicador", "fixo"]),
  valor: z.number().finite().min(0).max(100_000),
  fonte: text(1_000),
}).strict().superRefine((value, ctx) => {
  if (value.modo === "multiplicador" && value.valor > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["valor"], message: "O multiplicador não pode exceder 100." });
  }
});

const functionSchema = z.object({
  nome: text(1_000),
  tipo: z.enum(APF_TYPES),
  atividade: z.enum(APF_ACTIVITIES),
  td: z.number().int().min(1).max(1_000_000),
  ar_tr: z.number().int().min(0).max(1_000_000),
  justificativa: text(6_000),
  evidencias: z.array(text(1_000)).min(1).max(30),
}).strict().superRefine((value, ctx) => {
  if ((value.tipo === "ALI" || value.tipo === "AIE") && value.ar_tr < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ar_tr"], message: "Funções de dados exigem ao menos um tipo de registro (AR/TR)." });
  }
  if (new Set(value.evidencias.map(key)).size !== value.evidencias.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidencias"], message: "Há evidências duplicadas na função." });
  }
});

const groupsArraySchema = z.array(z.object({ nome: text(1_000), funcoes: z.array(functionSchema).min(1).max(700) }).strict()).min(1).max(250);
const { $schema: _groupsDialect, ...groupsInputSchema } = z.toJSONSchema(groupsArraySchema, { io: "input" });
const groupsSchema = z.preprocess((value, ctx) => {
  if (!Array.isArray(value)) return value;
  let functions = 0;
  if (value.length > 250) {
    ctx.addIssue({ code: "custom", message: "A contagem excede o limite de 250 grupos." });
    return z.NEVER;
  }
  // Refuse oversized envelopes before deeply validating potentially large child arrays.
  for (const [groupIndex, group] of value.entries()) {
    if (group && typeof group === "object" && Array.isArray(group.funcoes)) functions += group.funcoes.length;
    if (functions > 700) {
      ctx.addIssue({ code: "custom", message: "A contagem excede o limite de 700 funções." });
      return z.NEVER;
    }
    if (group && typeof group === "object" && Array.isArray(group.funcoes)) {
      for (const [functionIndex, item] of group.funcoes.entries()) {
        if (item && typeof item === "object" && Array.isArray(item.evidencias) && item.evidencias.length > 30) {
          ctx.addIssue({ code: "custom", path: [groupIndex, "funcoes", functionIndex, "evidencias"], message: "A função excede o limite de 30 evidências." });
          return z.NEVER;
        }
      }
    }
  }
  if (functions + 2 * value.length > 763) {
    ctx.addIssue({ code: "custom", message: "Os grupos e as funções excedem as linhas 12 a 774 do modelo." });
    return z.NEVER;
  }
  return value;
}, groupsArraySchema).meta(groupsInputSchema);

const factorsRecordSchema = z.partialRecord(z.enum(APF_ACTIVITIES), apfFactorSchema);
const { $schema: _factorsDialect, ...factorsInputSchema } = z.toJSONSchema(factorsRecordSchema, { io: "input" });
const factorsSchema = z.preprocess((value, ctx) => {
  if (value && typeof value === "object" && Object.keys(value).length > APF_ACTIVITIES.length) {
    ctx.addIssue({ code: "custom", message: "A contagem excede o limite de fatores por atividade." });
    return z.NEVER;
  }
  return value;
}, factorsRecordSchema).meta(factorsInputSchema);

// Keep the plain object available for the MCP SDK's inputSchema registration.
export const apfPreparationFields = {
  aplicacao: text(1_000),
  versao: text(1_000),
  metodologia: text(2_000).describe("Regra/versão e referência contratual escolhidas pela pessoa responsável. O MCP não escolhe uma versão do SISP automaticamente."),
  grupos: groupsSchema,
  fatores: factorsSchema.optional().describe("Valores explicitamente conferidos com a convenção do AgilePoint/contrato. Sem fator informado, PF equivalente fica pendente."),
};

export const apfPreparationSchema = z.object(apfPreparationFields).strict().superRefine((value, ctx) => {
  const count = value.grupos.reduce((sum, group) => sum + group.funcoes.length, 0);
  if (count > 700) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["grupos"], message: "A contagem excede o limite de 700 funções." });
  // The supplied model reserves rows 12..774; each group has one title and one separator.
  if (count + 2 * value.grupos.length > 763) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["grupos"], message: "Os grupos e as funções excedem as linhas 12 a 774 do modelo." });
  const groups = new Set<string>();
  value.grupos.forEach((group, groupIndex) => {
    const groupKey = key(group.nome);
    if (groups.has(groupKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["grupos", groupIndex, "nome"], message: "Há nomes de grupo duplicados." });
    groups.add(groupKey);
    const functions = new Set<string>();
    group.funcoes.forEach((item, functionIndex) => {
      const itemKey = `${item.tipo}\u0000${key(item.nome)}\u0000${item.atividade}`;
      if (functions.has(itemKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["grupos", groupIndex, "funcoes", functionIndex, "nome"], message: "Há funções duplicadas no mesmo grupo (nome, tipo e atividade)." });
      functions.add(itemKey);
    });
  });
});

export type ApfPreparationInput = z.infer<typeof apfPreparationSchema>;
export type ApfFactor = z.infer<typeof apfFactorSchema>;

const weights: Record<ApfType, readonly [number, number, number]> = {
  ALI: [7, 10, 15], AIE: [5, 7, 10], EE: [3, 4, 6], CE: [3, 4, 6], SE: [4, 5, 7],
};

/** Matrices transcribed from the user-supplied kit. This does not classify requirements as functions. */
export function calculateApfFunction(tipo: ApfType, td: number, ar_tr: number): { complexidade: ApfComplexity; pf_base: number } {
  if (!APF_TYPES.includes(tipo)) throw new Error("Tipo de função inválido.");
  if (!Number.isInteger(td) || td < 1 || td > 1_000_000 || !Number.isInteger(ar_tr) || ar_tr < 0 || ar_tr > 1_000_000) throw new Error("TD e AR/TR devem ser inteiros válidos, com TD positivo.");
  if ((tipo === "ALI" || tipo === "AIE") && ar_tr < 1) throw new Error("ALI/AIE exigem AR/TR positivo.");
  let level: 0 | 1 | 2;
  if (tipo === "ALI" || tipo === "AIE") {
    level = ar_tr >= 6 ? (td >= 20 ? 2 : 1)
      : ar_tr >= 2 ? (td >= 51 ? 2 : td <= 19 ? 0 : 1)
        : td <= 50 ? 0 : 1;
  } else if (tipo === "EE") {
    level = ar_tr >= 3 ? (td >= 5 ? 2 : 1)
      : ar_tr === 2 ? (td >= 16 ? 2 : td <= 4 ? 0 : 1)
        : td <= 15 ? 0 : 1;
  } else {
    level = ar_tr >= 4 ? (td >= 6 ? 2 : 1)
      : ar_tr >= 2 ? (td >= 20 ? 2 : td <= 5 ? 0 : 1)
        : td <= 19 ? 0 : 1;
  }
  return { complexidade: (["Baixa", "Média", "Alta"] as const)[level], pf_base: weights[tipo][level] };
}

function round(value: number): number { return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000; }

export function prepareApfCount(input: unknown) {
  const parsed = apfPreparationSchema.parse(input);
  const missing = new Set<ApfActivity>();
  const avisos: string[] = ["A identificação e a classificação funcional precisam de revisão da pessoa responsável; o cálculo usa as matrizes do kit informado."];
  const grupos = parsed.grupos.map((group) => ({
    ...group,
    funcoes: group.funcoes.map((item) => {
      const calculation = calculateApfFunction(item.tipo, item.td, item.ar_tr);
      const fator = parsed.fatores?.[item.atividade] ?? null;
      if (!fator) missing.add(item.atividade);
      return {
        ...item,
        ...calculation,
        fator_aplicado: fator,
        pf_equivalente: fator ? round(fator.modo === "fixo" ? fator.valor : calculation.pf_base * fator.valor) : null,
      };
    }),
  }));
  const functions = grupos.flatMap((group) => group.funcoes);
  if (missing.size) avisos.push(`PF equivalente pendente: informe fatores explícitos para as atividades ${[...missing].sort().join(", ")}.`);
  if (parsed.fatores && Object.keys(parsed.fatores).length) avisos.push("Os fatores informados são referências locais; a gravação deve conferir a convenção vigente da contagem no AgilePoint.");
  const repeatedAcrossGroups = new Set<string>();
  let repeated = false;
  functions.forEach((item) => {
    const itemKey = `${item.tipo}\u0000${key(item.nome)}\u0000${item.atividade}`;
    if (repeatedAcrossGroups.has(itemKey)) repeated = true;
    repeatedAcrossGroups.add(itemKey);
  });
  if (repeated) avisos.push("Existem nomes/tipos/atividades repetidos em grupos diferentes; confira se representam funções distintas para evitar dupla contagem.");
  return {
    ...parsed,
    grupos,
    totais: {
      funcoes: functions.length,
      grupos: grupos.length,
      pf_base: functions.reduce((sum, item) => sum + item.pf_base, 0),
      pf_equivalente: missing.size ? null : round(functions.reduce((sum, item) => sum + (item.pf_equivalente ?? 0), 0)),
    },
    avisos,
    fonte: { identificador: "kit-contagem-apf", versao: APF_KIT_VERSION, regra: "matrizes-do-kit" },
    preparado_em: new Date().toISOString(),
  };
}

export type ApfPreparedCount = ReturnType<typeof prepareApfCount>;
const expectedSchema = z.object({ pf_base: z.number().finite().min(0).optional(), pf_equivalente: z.number().finite().min(0).optional() }).strict();

/** Non-throwing validation result, including optional independent control totals. */
export function validateApfCount(input: unknown, expected?: z.infer<typeof expectedSchema>) {
  const parsed = apfPreparationSchema.safeParse(input);
  const expectedParsed = expectedSchema.safeParse(expected ?? {});
  if (!parsed.success || !expectedParsed.success) {
    const issues = [...(!parsed.success ? parsed.error.issues : []), ...(!expectedParsed.success ? expectedParsed.error.issues.map((issue) => ({ ...issue, path: ["totais_esperados", ...issue.path] })) : [])];
    return { valido: false, erros: issues.map((issue) => ({ campo: issue.path.join("."), mensagem: issue.message })), contagem: null };
  }
  const contagem = prepareApfCount(parsed.data);
  const erros: { campo: string; mensagem: string }[] = [];
  for (const field of ["pf_base", "pf_equivalente"] as const) {
    const wanted = expectedParsed.data[field];
    if (wanted !== undefined && (contagem.totais[field] === null || Math.abs(contagem.totais[field]! - wanted) > 0.000001)) {
      erros.push({ campo: `totais.${field}`, mensagem: `Total calculado ${contagem.totais[field] ?? "pendente"} diverge do total esperado ${wanted}.` });
    }
  }
  return { valido: erros.length === 0, erros, contagem };
}
