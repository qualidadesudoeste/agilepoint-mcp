export type McpRole = "leitura" | "desenvolvedor" | "gerente" | "administrador";

const validRoles = new Set<McpRole>(["leitura", "desenvolvedor", "gerente", "administrador"]);
let chatActor: { role: McpRole; colaborador_id: string; nome: string } | null = null;

export function environmentCredentialsAvailable(): boolean {
  return process.env.APF_AUTH_MODE !== "chat" && Boolean(process.env.APF_USERNAME && process.env.APF_PASSWORD);
}

export function inferRoleFromMenu(formIds: string[]): McpRole {
  const ids = new Set(formIds);
  if (ids.has("7156")) return "administrador";
  if (ids.has("9148") || ids.has("500000382")) return "gerente";
  return ids.size ? "desenvolvedor" : "leitura";
}

export function activateChatActor(username: string, role: McpRole): void {
  if (chatActor) throw new Error("Esta sessão MCP já possui uma identidade; reinicie o processo para trocar de conta.");
  const login = username.trim().toLocaleLowerCase("pt-BR");
  if (!login) throw new Error("O usuário autenticado não pode ser vazio.");
  chatActor = { role, colaborador_id: `login:${login}`, nome: username.trim() };
}

export function currentRole(): McpRole {
  if (chatActor) return chatActor.role;
  const configured = (process.env.APF_MCP_ROLE ?? "leitura").trim().toLocaleLowerCase("pt-BR") as McpRole;
  if (!validRoles.has(configured)) throw new Error("APF_MCP_ROLE deve ser leitura, desenvolvedor, gerente ou administrador.");
  return configured;
}

export function currentActor() {
  if (chatActor) return { ...chatActor };
  return {
    role: currentRole(),
    colaborador_id: process.env.APF_COLLABORATOR_ID?.trim() || null,
    nome: process.env.APF_COLLABORATOR_NAME?.trim() || null,
  };
}

export function requireRole(allowed: McpRole[], operation: string): McpRole {
  if (!chatActor && !environmentCredentialsAvailable()) {
    throw new Error("Autentique-se com autenticar_agilepoint antes de usar esta operação.");
  }
  const role = currentRole();
  if (!allowed.includes(role)) throw new Error(`A operação ${operation} exige um dos perfis: ${allowed.join(", ")}. Perfil configurado: ${role}.`);
  return role;
}

export function writeConfigurationStatus() {
  return {
    habilitada: process.env.APF_WRITE_ENABLED === "true",
    configurada: true,
    formulario_id: "26,47",
    fluxo: "Contagem > criar/usar sprint > Funções; Aplicação > Desenvolvedores da aplicação",
  };
}
