const SEARCH_FIELDS = [
  "id", "os", "oc", "code", "tag", "equipmentName", "equipamento", "sector", "setor",
  "company", "empresa", "empresaId", "companyId", "cnpj", "packageId", "pacoteId",
] as const;

export function normalizeServiceSearch(value: unknown): string {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function meaningfulTokens(value: string): string[] {
  const words = value.split(/[^a-z0-9]+/).filter(Boolean);
  const result = new Set(words);
  const compact = value.replace(/[^a-z0-9]/g, "");
  if (compact) result.add(compact);
  if (compact.length >= 3) {
    for (let index = 0; index <= compact.length - 3; index += 1) result.add(compact.slice(index, index + 3));
  }
  for (const word of words) {
    if (word.length < 3) continue;
    for (let index = 0; index <= word.length - 3; index += 1) result.add(word.slice(index, index + 3));
  }
  return [...result];
}

export function buildServiceSearchTokens(id: string, data: Record<string, unknown>): string[] {
  const values = [id, ...SEARCH_FIELDS.filter((field) => field !== "id").map((field) => data[field])];
  const tokens = new Set<string>();
  values.forEach((value) => meaningfulTokens(normalizeServiceSearch(value)).forEach((token) => tokens.add(token)));
  return [...tokens].slice(0, 200);
}

export function chooseServiceSearchToken(term: string): string | null {
  const normalized = normalizeServiceSearch(term);
  if (!normalized) return null;
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  if (compact.length >= 3) return compact.slice(0, 3);
  return compact || null;
}

export function serviceSearchMatches(id: string, data: Record<string, unknown>, term: string): boolean {
  const needle = normalizeServiceSearch(term);
  if (!needle) return true;
  return [id, ...SEARCH_FIELDS.map((field) => data[field])].some((value) => normalizeServiceSearch(value).includes(needle));
}

export function buildServiceSearchFields(id: string, data: Record<string, unknown>) {
  return { searchTokens: buildServiceSearchTokens(id, data) };
}
