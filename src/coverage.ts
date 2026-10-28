// Only actions whose equivalent endpoint workflow has been independently validated belong here.
const specializedActions: Readonly<Record<string, string>> = {
  "26:1135976": "simular_importacao_rapida / importar_contagem_rapida",
  "26:808": "exportar_relatorio_contagem (analitico)",
  "26:508": "exportar_relatorio_contagem (pdf)",
  "26:676": "exportar_relatorio_contagem (excel)",
  "9127:1135889": "ranking_repositorio",
  "500000382:1136078": "exportar_relatorio_sprint",
  "9148:1135991": "exportar_relatorio_acompanhamento",
  "9146:1135975": "exportar_relatorio_premiacao",
};

export function specializedActionTool(formId: string, componentId: string): string | null {
  return specializedActions[`${formId}:${componentId}`] ?? null;
}
