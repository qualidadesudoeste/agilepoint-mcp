import { createHash } from "node:crypto";
import type { ElicitRequestFormParams, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { consumeHumanApproval, createApprovalRequest, verifyHumanApproval } from "./approval.js";

export type WriteApprovalMode = "automatic" | "external" | "delegated" | "elicitation";
export type ApprovalElicitor = (request: ElicitRequestFormParams) => Promise<ElicitResult>;

export function writeApprovalMode(destructive = false): WriteApprovalMode {
  const configured = (process.env.APF_WRITE_APPROVAL_MODE ?? "automatic").trim().toLowerCase();
  if (configured !== "automatic" && configured !== "external" && configured !== "delegated" && configured !== "elicitation") {
    throw new Error("APF_WRITE_APPROVAL_MODE deve ser automatic, external, delegated ou elicitation.");
  }
  // A delegação nunca abrange exclusões e substituições em lote. Elicitation
  // exige uma confirmação interativa do cliente para cada execução.
  return destructive && configured === "delegated" ? "external" : configured;
}

export async function createWriteAuthorization(operation: string, payloadHash: string, preview: unknown, destructive = false) {
  const mode = writeApprovalMode(destructive);
  if (mode === "automatic") {
    assertPreviewHash(preview, payloadHash);
    return { modo: "automatic" as const, requer_aprovacao_humana: false,
      instrucao: "Confira esta simulação e execute o comando solicitado pelo usuário sem pedir aprovação adicional. Esclareça somente dados ausentes ou ambíguos. Permissões da conta, validações, auditoria e idempotência continuam obrigatórias." };
  }
  if (mode === "external") return createApprovalRequest(operation, payloadHash, preview, destructive);
  if (mode === "elicitation") {
    ensureTrustedElicitation();
    assertPreviewHash(preview, payloadHash);
    return {
      modo: "elicitation" as const,
      requer_aprovacao_humana: true,
      instrucao: "Ao executar, o cliente MCP apresentará a prévia para confirmação humana. Se o cliente não oferecer elicitation de formulário, a operação será recusada.",
    };
  }
  return {
    modo: "delegated" as const,
    requer_aprovacao_humana: false,
    instrucao: "A IA pode executar esta simulação após conferir os alvos e valores. A gravação ainda exige APF_WRITE_ENABLED=true, permissão no AgilePoint e chave de idempotência.",
  };
}

export async function verifyWriteAuthorization(
  approvalId: string | undefined,
  operation: string,
  payloadHash: string,
  idempotencyKey: string,
  destructive = false,
  requiresWrite = true,
  preview?: unknown,
  elicit?: ApprovalElicitor,
): Promise<void> {
  if (requiresWrite && process.env.APF_WRITE_ENABLED !== "true") {
    throw new Error("A gravação está desabilitada. Defina APF_WRITE_ENABLED=true somente no ambiente autorizado.");
  }
  const mode = writeApprovalMode(destructive);
  if (mode === "automatic") {
    if (approvalId) throw new Error("Não envie aprovacao_id no modo automatic.");
    if (preview === undefined) throw new Error("A execução automática exige uma simulação válida.");
    assertPreviewHash(preview, payloadHash);
    return;
  }
  if (mode === "delegated") {
    if (approvalId) throw new Error("Não envie aprovacao_id no modo delegated.");
    return;
  }
  if (mode === "elicitation") {
    if (approvalId) throw new Error("Não envie aprovacao_id no modo elicitation.");
    ensureTrustedElicitation();
    if (!elicit || preview === undefined) throw new Error("A confirmação interativa não está disponível neste cliente MCP.");
    assertPreviewHash(preview, payloadHash);
    await requestClientApproval(operation, payloadHash, preview, elicit);
    return;
  }
  if (!approvalId) throw new Error("Esta operação exige aprovacao_id aprovado por uma pessoa fora da IA.");
  await verifyHumanApproval(approvalId, operation, payloadHash, idempotencyKey);
}

export async function consumeWriteAuthorization(
  approvalId: string | undefined,
  operation: string,
  payloadHash: string,
  idempotencyKey: string,
  destructive = false,
): Promise<void> {
  if (writeApprovalMode(destructive) !== "external") return;
  if (!approvalId) throw new Error("Esta operação exige aprovacao_id aprovado por uma pessoa fora da IA.");
  await consumeHumanApproval(approvalId, operation, payloadHash, idempotencyKey);
}

function ensureTrustedElicitation(): void {
  if (process.env.APF_TRUSTED_CLIENT_ELICITATION !== "true") {
    throw new Error("O modo elicitation exige APF_TRUSTED_CLIENT_ELICITATION=true e um cliente MCP que apresente a confirmação diretamente à pessoa.");
  }
}

function assertPreviewHash(preview: unknown, payloadHash: string): void {
  const actual = createHash("sha256").update(JSON.stringify(preview)).digest("hex");
  if (actual !== payloadHash) throw new Error("A prévia interativa não corresponde à simulação autorizada.");
}

export async function requestClientApproval(
  operation: string,
  payloadHash: string,
  preview: unknown,
  elicit: ApprovalElicitor,
): Promise<void> {
  assertPreviewHash(preview, payloadHash);
  const serialized = JSON.stringify(preview, null, 2);
  if (serialized.length > 12_000) {
    throw new Error("A prévia é longa demais para confirmação interativa; use aprovação externa para esta operação.");
  }
  const phrase = `APROVAR ${payloadHash.slice(0, 16).toUpperCase()}`;
  const response = await elicit({
    mode: "form",
    message: `Confirme somente se você solicitou esta operação no AgilePoint e revisou TODOS os dados abaixo.\nOperação: ${operation}\nSHA-256: ${payloadHash}\nPrévia exata:\n${serialized}\n\nDigite ${phrase} para autorizar. Recusar ou cancelar não altera o AgilePoint.`,
    requestedSchema: {
      type: "object",
      properties: {
        confirmacao: { type: "string", title: "Confirmação", minLength: phrase.length, maxLength: phrase.length },
      },
      required: ["confirmacao"],
    },
  });
  if (response.action !== "accept" || response.content?.confirmacao !== phrase) {
    throw new Error("A operação não foi aprovada na confirmação interativa.");
  }
}
