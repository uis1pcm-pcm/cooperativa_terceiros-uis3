import type { Service } from "@/types";
import { formatDayKey } from "@/lib/formatDateTime";
import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";
import { DEFAULT_TIME_ZONE, startOfDayInTimeZone } from "@/lib/referenceDate";

export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Preservar valor exato digitado, apenas garantir que está no range válido
  // Removido Math.round para evitar alterar valores como 20 para 18
  return Math.max(0, Math.min(100, value));
}

export function snapshotBeforeConclusion(current: number, previous?: number | null): number {
  const candidates = [current, previous].filter((value): value is number => Number.isFinite(value ?? NaN));
  for (const candidate of candidates) {
    const clamped = clampProgress(candidate);
    if (clamped < 100) {
      return clamped;
    }
  }
  return 0;
}

type ResolveReopenParams = {
  requested?: number | null;
  previousStored?: number | null;
  history?: Array<number | null | undefined>;
  current?: number | null;
};

export function resolveReopenedProgress({
  requested,
  previousStored,
  history = [],
  current,
}: ResolveReopenParams): number {
  const candidates: Array<number | null | undefined> = [requested, previousStored, ...history, current];

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate ?? NaN)) continue;
    const clamped = clampProgress(Number(candidate));
    if (clamped < 100) {
      return clamped;
    }
  }

  return 0;
}

type DateInput =
  | string
  | number
  | Date
  | { toDate?: () => Date; toMillis?: () => number }
  | null
  | undefined;

export type ServicoDoSubpacote = {
  id?: string;
  nome?: string;
  horasPrevistas?: number | string | null;
  totalHours?: number | string | null;
  horas?: number | string | null;
  hours?: number | string | null;
  peso?: number | string | null;
  weight?: number | string | null;
  dataInicio?: DateInput;
  inicioPrevisto?: DateInput;
  inicioPlanejado?: DateInput;
  plannedStart?: DateInput;
  startDate?: DateInput;
  dataFim?: DateInput;
  fimPrevisto?: DateInput;
  fimPlanejado?: DateInput;
  plannedEnd?: DateInput;
  endDate?: DateInput;
  [key: string]: unknown;
};

export type SubpacotePlanejado = {
  id?: string;
  nome?: string;
  servicos?: ServicoDoSubpacote[] | null;
  services?: ServicoDoSubpacote[] | null;
  [key: string]: unknown;
};

export type PacotePlanejado = {
  subpacotes?: SubpacotePlanejado[] | null;
  subPackages?: SubpacotePlanejado[] | null;
  [key: string]: unknown;
};

export type ServicoPlanejado = {
  id?: string | number | null;
  descricao?: string | null;
  description?: string | null;
  dataInicio?: DateInput;
  dataFim?: DateInput;
  inicio?: DateInput;
  fim?: DateInput;
  percentualRealAtual?: number | string | null;
  percentualReal?: number | string | null;
  percentualInformado?: number | string | null;
  progressoReal?: number | string | null;
  realProgress?: number | string | null;
  currentProgress?: number | string | null;
  [key: string]: unknown;
};

export type ServicoPlanejadoResumo = {
  id?: string;
  descricao?: string;
  percentualPlanejado: number;
  percentualReal: number;
};

export type CurvaSPonto = { data: Date; percentual: number };

export type IndicadoresCurvaS = {
  planejadoTotal: number;
  planejadoAteHoje: number;
  realizado: number;
  diferenca: number;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  return startOfDayInTimeZone(date, DEFAULT_TIME_ZONE);
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export function toDate(value: DateInput): Date | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : new Date(time);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Suporte a "dd/MM/yyyy" e "dd/MM/yy" (com "/" ou "-"), comum no input do usuário.
    const brDate = parseDayFirstDateStringToUtcDate(trimmed);
    if (brDate) return brDate;

    const ptDate = parsePortugueseDateStringToUtcDate(trimmed);
    if (ptDate) return ptDate;

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value === "object") {
    const source = value as { toDate?: () => Date; toMillis?: () => number };
    if (typeof source.toDate === "function") {
      const date = source.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return new Date(date.getTime());
      }
    }
    if (typeof source.toMillis === "function") {
      const millis = source.toMillis();
      if (typeof millis === "number" && Number.isFinite(millis)) {
        const date = new Date(millis);
        if (!Number.isNaN(date.getTime())) {
          return date;
        }
      }
    }

    const seconds = (source as { seconds?: unknown; _seconds?: unknown }).seconds ??
      (source as { _seconds?: unknown })._seconds;
    const nanoseconds =
      (source as { nanoseconds?: unknown; _nanoseconds?: unknown }).nanoseconds ??
      (source as { _nanoseconds?: unknown })._nanoseconds;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      const millis = seconds * 1000 + (typeof nanoseconds === "number" ? nanoseconds / 1_000_000 : 0);
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }
  return null;
}

function getDateFromKeys(service: ServicoDoSubpacote, keys: string[]): Date | null {
  for (const key of keys) {
    if (Object.hasOwn(service, key)) {
      const value = toDate(service[key] as DateInput);
      if (value) return value;
    }
  }
  return null;
}

function extractHorasPrevistas(servico: ServicoDoSubpacote): number | null {
  const resolved =
    toPositiveNumber(servico.horasPrevistas) ??
    toPositiveNumber(servico.totalHours) ??
    toPositiveNumber(servico.horas) ??
    toPositiveNumber(servico.hours) ??
    toPositiveNumber(servico.peso) ??
    toPositiveNumber(servico.weight);

  if (resolved === null) return 1;
  return resolved;
}

type DateRange = { inicio: Date; fim: Date };

function resolveDateRange(servico: ServicoDoSubpacote): DateRange | null {
  const inicio =
    getDateFromKeys(servico, [
      "dataInicio",
      "inicioPrevisto",
      "inicioPlanejado",
      "plannedStart",
      "startDate",
      "inicio",
    ]) ?? null;
  const fim =
    getDateFromKeys(servico, [
      "dataFim",
      "fimPrevisto",
      "fimPlanejado",
      "plannedEnd",
      "endDate",
      "fim",
    ]) ?? null;

  if (!inicio || !fim) return null;
  if (fim.getTime() <= inicio.getTime()) return null;
  return { inicio, fim };
}

function daysBetween(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff)) return 0;
  const inclusiveDays = Math.floor(diff / DAY_IN_MS) + 1;
  return Math.max(1, inclusiveDays);
}

type ServiceProgressEntry = { horasPrevistas: number; percentual: number };
type AtualizacaoPercentual = { data: Date; percentual: number };

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function parsePercentual(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampPercentage(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/%/g, "").replace(/\s+/g, " ");
    const parsed = Number(normalized.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return clampPercentage(parsed);
    }
  }
  return null;
}

function pickFirstObject<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  keys: string[],
): T | null {
  for (const key of keys) {
    if (Object.hasOwn(source, key)) {
      const candidate = source[key];
      if (candidate && typeof candidate === "object") {
        return candidate as T;
      }
    }
  }
  return null;
}

function sanitizePlannedDaily(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  const sanitised: number[] = values.map((value) => parsePercentual(value) ?? 0);
  if (!sanitised.length) return [];
  for (let i = 1; i < sanitised.length; i++) {
    if (sanitised[i] < sanitised[i - 1]) {
      sanitised[i] = sanitised[i - 1];
    }
  }
  sanitised[sanitised.length - 1] = 100;
  return sanitised.map((value) => Math.round(value));
}

function gerarDatasPlanejadas(range: DateRange): string[] {
  const datas: string[] = [];
  const inicio = startOfDay(range.inicio).getTime();
  const fim = startOfDay(range.fim).getTime();
  for (let time = inicio; time <= fim; time += DAY_IN_MS) {
    datas.push(
      formatDayKey(new Date(time), {
        timeZone: DEFAULT_TIME_ZONE,
        fallback: new Date(time).toISOString().slice(0, 10),
      }),
    );
  }
  return datas;
}

function calcularPercentualUsandoSeriePlanejada(
  servico: ServicoPlanejado | ServicoDoSubpacote,
  range: DateRange,
  referencia: Date,
): number | null {
  const serie = sanitizePlannedDaily((servico as { plannedDaily?: unknown }).plannedDaily);
  if (!serie.length) return null;
  const datas = gerarDatasPlanejadas(range);
  if (datas.length !== serie.length || !datas.length) return null;
  const alvo = formatDayKey(startOfDay(referencia), {
    timeZone: DEFAULT_TIME_ZONE,
    fallback: startOfDay(referencia).toISOString().slice(0, 10),
  });
  if (alvo < datas[0]) return 0;
  let percentual = 0;
  for (let i = 0; i < datas.length; i++) {
    if (alvo >= datas[i]) {
      percentual = serie[i];
    } else {
      break;
    }
  }
  return clampPercentage(percentual);
}

const UPDATE_LIST_KEYS = [
  "atualizacoes",
  "historicoAtualizacoes",
  "historico",
  "history",
  "updates",
  "progressUpdates",
  "percentualUpdates",
  "realUpdates",
];

const UPDATE_DATE_KEYS = [
  "reportDate",
  "reportDateMillis",
  "data",
  "dataAtualizacao",
  "data_atualizacao",
  "dataAtualizacaoPercentual",
  "date",
  "timestamp",
  "createdAt",
];

const UPDATE_PERCENT_KEYS = [
  "percentual",
  "percentualInformado",
  "percentualReal",
  "percentualRealAtual",
  "realPercent",
  "andamento",
  "percent",
  "valor",
  "value",
  "progress",
];

const DIRECT_PERCENT_DATE_KEYS = [
  "reportDate",
  "reportDateMillis",
  "date",
  "data",
  "dataAtualizacao",
  "dataAtualizacaoPercentual",
];

const REPORT_DATE_KEYS = ["reportDate", "reportDateMillis"] as const;

function resolveEffectiveUpdateDate(
  source: Record<string, unknown>,
  keys: string[],
  fallbackDate?: Date,
): Date | null {
  let invalidReportedDate = false;
  for (const key of keys) {
    if (!Object.hasOwn(source, key)) continue;
    const parsed = toDate(source[key] as DateInput);
    if (parsed) return parsed;
    if (REPORT_DATE_KEYS.includes(key as (typeof REPORT_DATE_KEYS)[number])) {
      invalidReportedDate = true;
    }
  }
  if (invalidReportedDate) {
    console.warn(
      "[serviceProgress] reportDate inválido encontrado em atualização. Verifique a origem do dado.",
      {
        reportDate: Object.hasOwn(source, "reportDate") ? source["reportDate"] : undefined,
        reportDateMillis: Object.hasOwn(source, "reportDateMillis") ? source["reportDateMillis"] : undefined,
      },
    );
  }
  if (fallbackDate) {
    return new Date(fallbackDate.getTime());
  }
  return null;
}

function normalizeUpdateEntry(entry: unknown, fallbackDate?: Date): AtualizacaoPercentual | null {
  if (!entry || typeof entry !== "object") return null;
  const source = entry as Record<string, unknown>;
  const data = resolveEffectiveUpdateDate(source, UPDATE_DATE_KEYS, fallbackDate);
  if (!data) return null;

  let percentual: number | null = null;
  for (const key of UPDATE_PERCENT_KEYS) {
    if (Object.hasOwn(source, key)) {
      percentual = parsePercentual(source[key]);
      if (percentual !== null) break;
    }
  }
  if (percentual === null) return null;
  return { data: startOfDay(data), percentual };
}

function coletarAtualizacoesDoServico(
  servico: ServicoDoSubpacote,
  fallbackDate?: Date,
): AtualizacaoPercentual[] {
  const atualizacoes: AtualizacaoPercentual[] = [];
  for (const key of UPDATE_LIST_KEYS) {
    const lista = (servico as Record<string, unknown>)[key];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      const normalizado = normalizeUpdateEntry(item);
      if (normalizado) {
        atualizacoes.push(normalizado);
      }
    }
  }

  const percentualDireto =
    parsePercentual((servico as Record<string, unknown>).percentualRealAtual) ??
    parsePercentual((servico as Record<string, unknown>).percentualReal) ??
    parsePercentual((servico as Record<string, unknown>).percentualInformado) ??
    parsePercentual((servico as Record<string, unknown>).realPercent) ??
    parsePercentual((servico as Record<string, unknown>).andamento) ??
    parsePercentual((servico as Record<string, unknown>).progress) ??
    parsePercentual((servico as Record<string, unknown>).progressoReal) ??
    parsePercentual((servico as Record<string, unknown>).realProgress) ??
    parsePercentual((servico as Record<string, unknown>).currentProgress);

  if (percentualDireto !== null) {
    const data = resolveEffectiveUpdateDate(
      servico as Record<string, unknown>,
      DIRECT_PERCENT_DATE_KEYS,
    );
    if (data) {
      atualizacoes.push({ data: startOfDay(data), percentual: percentualDireto });
    }
  }

  // Um serviço pode receber mais de um lançamento para a mesma data operacional.
  // A curva consolidada do pacote deve representar o maior avanço informado no dia,
  // independentemente da ordem em que esses lançamentos foram carregados.
  const maiorAtualizacaoPorDia = new Map<number, AtualizacaoPercentual>();
  for (const atualizacao of atualizacoes) {
    const dia = atualizacao.data.getTime();
    const atual = maiorAtualizacaoPorDia.get(dia);
    if (!atual || atualizacao.percentual > atual.percentual) {
      maiorAtualizacaoPorDia.set(dia, atualizacao);
    }
  }

  return Array.from(maiorAtualizacaoPorDia.values()).sort(
    (a, b) => a.data.getTime() - b.data.getTime(),
  );
}

function normalizeDescricao(servico: ServicoPlanejado | ServicoDoSubpacote | null | undefined): string | undefined {
  if (!servico) return undefined;
  const candidatos = [servico.descricao, (servico as { description?: unknown }).description];
  for (const valor of candidatos) {
    if (typeof valor === "string") {
      const trimmed = valor.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

type PreparedServicoPlanejado = {
  horasPrevistas: number;
  inicio: Date;
  fim: Date;
  totalDias: number;
  source: ServicoDoSubpacote;
};

type ServicoRealizadoNormalizado = {
  horasPrevistas: number;
  atualizacoes: AtualizacaoPercentual[];
};

function prepararServicoPlanejado(servico: ServicoDoSubpacote): PreparedServicoPlanejado | null {
  const horasPrevistas = extractHorasPrevistas(servico);
  if (!horasPrevistas) return null;
  const range = resolveDateRange(servico);
  if (!range) return null;
  const inicio = startOfDay(range.inicio);
  const fim = startOfDay(range.fim);
  const totalDias = Math.max(1, daysBetween(inicio, fim));
  return { horasPrevistas, inicio, fim, totalDias, source: servico };
}

function calcularPercentualPlanejadoDoServico(
  servico: PreparedServicoPlanejado,
  referencia: Date,
): number {
  const referenciaMs = startOfDay(referencia).getTime();
  const inicioMs = servico.inicio.getTime();
  const fimMs = servico.fim.getTime();

  if (referenciaMs < inicioMs) {
    return 0;
  }
  if (referenciaMs >= fimMs) {
    return 100;
  }

  const diasTotais = Math.max(1, servico.totalDias);
  const diasDecorridos = Math.floor((referenciaMs - inicioMs) / DAY_IN_MS) + 1;
  if (diasDecorridos <= 0) return 0;

  return clampPercentage((diasDecorridos / diasTotais) * 100);
}

function prepararServicosPlanejados(servicos: ServicoDoSubpacote[]): PreparedServicoPlanejado[] {
  return servicos
    .map((servico) => prepararServicoPlanejado(servico))
    .filter((item): item is PreparedServicoPlanejado => Boolean(item));
}

function mapServicoParaPercentual(
  servico: ServicoDoSubpacote,
  referencia: Date,
): ServiceProgressEntry | null {
  const preparado = prepararServicoPlanejado(servico);
  if (!preparado) return null;
  const percentual = calcularPercentualPlanejadoDoServico(preparado, referencia);
  return { horasPrevistas: preparado.horasPrevistas, percentual };
}

function coletarServicosDoSubpacote(subpacote: SubpacotePlanejado | null | undefined): ServicoDoSubpacote[] {
  if (!subpacote) return [];
  const listas: ServicoDoSubpacote[][] = [];
  if (Array.isArray(subpacote.servicos)) listas.push(subpacote.servicos);
  const alternativa = (subpacote as { services?: ServicoDoSubpacote[] | null }).services;
  if (Array.isArray(alternativa)) {
    listas.push(alternativa);
  }
  const servicos: ServicoDoSubpacote[] = [];
  for (const lista of listas) {
    for (const servico of lista) {
      if (servico && typeof servico === "object") {
        servicos.push(servico);
      }
    }
  }
  return servicos;
}

export function obterIntervaloSubpacote(
  subpacote: SubpacotePlanejado | null | undefined,
): { inicio: Date | null; fim: Date | null } {
  const servicos = coletarServicosDoSubpacote(subpacote);
  let menor: Date | null = null;
  let maior: Date | null = null;
  for (const servico of servicos) {
    const range = resolveDateRange(servico);
    if (!range) continue;
    if (!menor || range.inicio.getTime() < menor.getTime()) {
      menor = range.inicio;
    }
    if (!maior || range.fim.getTime() > maior.getTime()) {
      maior = range.fim;
    }
  }
  return { inicio: menor, fim: maior };
}

function coletarServicosDoPacote(pacote: PacotePlanejado | null | undefined): ServicoDoSubpacote[] {
  if (!pacote) return [];
  const subpacotes: SubpacotePlanejado[] = [];
  if (Array.isArray(pacote.subpacotes)) {
    subpacotes.push(...pacote.subpacotes);
  }
  const alternativa = (pacote as { subPackages?: SubpacotePlanejado[] | null }).subPackages;
  if (Array.isArray(alternativa)) {
    subpacotes.push(...alternativa);
  }

  return subpacotes.flatMap((subpacote) => coletarServicosDoSubpacote(subpacote));
}

function gerarLinhaDoTempo(servicos: PreparedServicoPlanejado[]): Date[] {
  if (!servicos.length) return [];
  let menor: Date | null = null;
  let maior: Date | null = null;
  for (const servico of servicos) {
    const inicio = startOfDay(servico.inicio);
    const fim = startOfDay(servico.fim);
    if (!menor || inicio.getTime() < menor.getTime()) {
      menor = inicio;
    }
    if (!maior || fim.getTime() > maior.getTime()) {
      maior = fim;
    }
  }
  if (!menor || !maior) return [];
  const datas: Date[] = [];
  for (let time = menor.getTime(); time <= maior.getTime(); time += DAY_IN_MS) {
    datas.push(new Date(time));
  }
  return datas;
}

function calcularPercentualPlanejadoNoDia(
  servicos: PreparedServicoPlanejado[],
  referencia: Date,
  somaHoras?: number,
): number {
  if (!servicos.length) return 0;
  const totalHoras = somaHoras ?? servicos.reduce((total, servico) => total + servico.horasPrevistas, 0);
  if (totalHoras <= 0) return 0;
  const somaPonderada = servicos.reduce((total, servico) => {
    const percentual = calcularPercentualPlanejadoDoServico(servico, referencia);
    return total + percentual * servico.horasPrevistas;
  }, 0);
  return clampPercentage(somaPonderada / totalHoras);
}

function prepararServicosRealizados(
  servicos: PreparedServicoPlanejado[],
): ServicoRealizadoNormalizado[] {
  return servicos.map((servico) => ({
    horasPrevistas: servico.horasPrevistas,
    atualizacoes: coletarAtualizacoesDoServico(servico.source, servico.inicio),
  }));
}

function percentualRealizadoAte(
  servico: ServicoRealizadoNormalizado,
  referencia: Date,
): number {
  if (!servico.atualizacoes.length) return 0;
  const alvo = startOfDay(referencia).getTime();
  let percentual = 0;
  for (const atualizacao of servico.atualizacoes) {
    const data = atualizacao.data.getTime();
    if (data <= alvo) {
      percentual = atualizacao.percentual;
    } else {
      break;
    }
  }
  return percentual;
}

function obterValorCurvaNaData(curva: CurvaSPonto[], referencia: Date): number {
  if (!curva.length) return 0;
  const alvo = startOfDay(referencia).getTime();
  let anterior = curva[0];
  if (alvo <= anterior.data.getTime()) {
    return anterior.percentual;
  }
  for (const ponto of curva) {
    const tempo = ponto.data.getTime();
    if (tempo === alvo) {
      return ponto.percentual;
    }
    if (tempo > alvo) {
      return anterior.percentual;
    }
    anterior = ponto;
  }
  return curva[curva.length - 1].percentual;
}

export function calcularPercentualSubpacote(
  subpacote: SubpacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): number {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const listaServicosRaw =
    (Array.isArray(subpacote?.servicos) && subpacote?.servicos) ||
    (Array.isArray(subpacote?.services) && subpacote?.services) ||
    [];

  const servicosValidos = listaServicosRaw
    .map((servico) => mapServicoParaPercentual(servico, referencia))
    .filter((entry): entry is ServiceProgressEntry => Boolean(entry));

  const somaHoras = servicosValidos.reduce((total, entry) => total + entry.horasPrevistas, 0);
  if (somaHoras <= 0) return 0;

  const somaPonderada = servicosValidos.reduce(
    (total, entry) => total + entry.percentual * entry.horasPrevistas,
    0,
  );
  const percentual = somaPonderada / somaHoras;
  if (!Number.isFinite(percentual)) return 0;
  return Math.max(0, Math.min(100, percentual));
}

export function calcularPercentualRealizadoSubpacote(
  subpacote: SubpacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): number {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const servicos = coletarServicosDoSubpacote(subpacote);
  const normalizados = servicos
    .map((servico) => {
      const horasPrevistas = extractHorasPrevistas(servico);
      if (!horasPrevistas) return null;
      const range = resolveDateRange(servico);
      const normalizado: ServicoRealizadoNormalizado = {
        horasPrevistas,
        atualizacoes: coletarAtualizacoesDoServico(servico, range?.inicio),
      };
      return normalizado;
    })
    .filter((servico): servico is ServicoRealizadoNormalizado => Boolean(servico));

  const somaHoras = normalizados.reduce((total, servico) => total + servico.horasPrevistas, 0);
  if (somaHoras <= 0) return 0;

  const somaPonderada = normalizados.reduce((total, servico) => {
    const percentual = percentualRealizadoAte(servico, referencia);
    return total + percentual * servico.horasPrevistas;
  }, 0);
  const percentual = somaPonderada / somaHoras;
  if (!Number.isFinite(percentual)) return 0;
  return clampPercentage(percentual);
}

export function calcularPercentualRealizadoPacote(
  pacote: PacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): number {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const subpacotes = coletarSubpacotesDoPacote(pacote);
  if (!subpacotes.length) return 0;

  let somaHoras = 0;
  let somaPonderada = 0;

  subpacotes.forEach((subpacote) => {
    const horas = calcularHorasDoSubpacote(subpacote);
    if (horas <= 0) return;
    const percentual = calcularPercentualRealizadoSubpacote(subpacote, referencia);
    somaHoras += horas;
    somaPonderada += percentual * horas;
  });

  if (somaHoras <= 0) return 0;
  return clampPercentage(somaPonderada / somaHoras);
}

function calcularHorasDoSubpacote(subpacote: SubpacotePlanejado | null | undefined): number {
  const servicos = coletarServicosDoSubpacote(subpacote);
  return servicos.reduce((total, servico) => total + (extractHorasPrevistas(servico) ?? 0), 0);
}

function coletarSubpacotesDoPacote(pacote: PacotePlanejado | null | undefined): SubpacotePlanejado[] {
  if (!pacote) return [];
  const subpacotes: SubpacotePlanejado[] = [];
  if (Array.isArray(pacote.subpacotes)) {
    subpacotes.push(...pacote.subpacotes);
  }
  const alternativa = (pacote as { subPackages?: SubpacotePlanejado[] | null }).subPackages;
  if (Array.isArray(alternativa)) {
    subpacotes.push(...alternativa);
  }
  return subpacotes;
}

export function calcularPercentualPlanejadoPacote(
  pacote: PacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): number {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const subpacotes = coletarSubpacotesDoPacote(pacote);
  if (!subpacotes.length) return 0;

  let somaHoras = 0;
  let somaPonderada = 0;

  subpacotes.forEach((subpacote) => {
    const horas = calcularHorasDoSubpacote(subpacote);
    if (horas <= 0) return;
    const percentual = calcularPercentualSubpacote(subpacote, referencia);
    somaHoras += horas;
    somaPonderada += percentual * horas;
  });

  if (somaHoras <= 0) return 0;
  return clampPercentage(somaPonderada / somaHoras);
}

export function calcularPercentualPlanejadoServico(
  servico: ServicoPlanejado | ServicoDoSubpacote | null | undefined,
  dataReferencia?: DateInput,
): number {
  if (!servico) return 0;
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const range = resolveDateRange(servico as ServicoDoSubpacote);
  if (!range) return 0;

  const percentualPlanejadoDaSerie = calcularPercentualUsandoSeriePlanejada(
    servico,
    range,
    referencia,
  );
  if (typeof percentualPlanejadoDaSerie === "number") {
    return percentualPlanejadoDaSerie;
  }

  const referenciaMs = referencia.getTime();
  const inicioMs = range.inicio.getTime();
  const fimMs = range.fim.getTime();

  if (referenciaMs < inicioMs) {
    return 0;
  }
  if (referenciaMs >= fimMs) {
    return 100;
  }

  // O percentual do serviço representa a interpolação entre os marcos: 0% no
  // início e 100% no fim. Usar dias inclusivos fazia o serviço já começar com
  // avanço e deslocava o "planejado até hoje" para uma data incorreta.
  const diasTotais = Math.max(1, Math.floor((fimMs - inicioMs) / DAY_IN_MS));
  const diasDecorridos = Math.floor((referenciaMs - inicioMs) / DAY_IN_MS);
  if (diasDecorridos <= 0) return 0;

  return clampPercentage((diasDecorridos / diasTotais) * 100);
}

export function resolveServicoPercentualPlanejado(
  servico: ServicoPlanejado | ServicoDoSubpacote | Record<string, unknown> | null | undefined,
  dataReferencia?: DateInput,
): number {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  if (!servico || typeof servico !== "object") return 0;

  const range = resolveDateRange(servico as ServicoDoSubpacote);
  if (range) {
    return calcularPercentualPlanejadoServico(servico as ServicoDoSubpacote, referencia);
  }

  const source = servico as Record<string, unknown>;

  const subpacotePlanejado = pickFirstObject<SubpacotePlanejado>(source, [
    "plannedSubpackage",
    "subpacotePlanejado",
    "subpacote",
    "folder",
    "subpackage",
    "subPackage",
  ]);
  if (subpacotePlanejado) {
    return clampProgress(calcularPercentualSubpacote(subpacotePlanejado, referencia));
  }

  const pacotePlanejado = pickFirstObject<PacotePlanejado>(source, [
    "pacotePlanejado",
    "package",
    "plannedPackage",
    "pacote",
  ]);
  if (pacotePlanejado) {
    return clampProgress(calcularPercentualPlanejadoPacote(pacotePlanejado, referencia));
  }

  return 0;
}

export function resolveServicoRealPercent(
  servico: ServicoDoSubpacote | ServicoPlanejado | Record<string, unknown> | null | undefined,
  dataReferencia?: DateInput,
): number {
  if (!servico || typeof servico !== "object") return 0;
  const source = servico as Record<string, unknown>;
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();

  const rawStatus = String(source.status ?? "").trim().toLowerCase();
  const previousProgressFields = [
    source.previousProgress,
    source.progressBeforeConclusion,
    source.previousPercent,
  ];
  const previousProgress = previousProgressFields
    .map((value) => parsePercentual(value))
    .find((value): value is number => value !== null);

  // O snapshot de reabertura só é necessário enquanto os campos canônicos
  // ainda carregam os 100% da conclusão. Depois de um novo RDO, `progress` já
  // representa o valor atual e um previousProgress antigo não pode prevalecer.
  const canonicalStoredProgress = [
    source.progress,
    source.realPercent,
    source.realPercentSnapshot,
    source.percentualRealAtual,
    source.andamento,
  ]
    .map((value) => parsePercentual(value))
    .find((value): value is number => value !== null);

  if (
    rawStatus === "pendente" &&
    previousProgress !== null &&
    (canonicalStoredProgress === undefined || canonicalStoredProgress >= 100)
  ) {
    const clamped = clampProgress(previousProgress);
    if (clamped < 100) {
      return clamped;
    }
  }

  const range = resolveDateRange(servico as ServicoDoSubpacote);
  const inicioPlanejado = range?.inicio ?? null;
  const atualizacoes = coletarAtualizacoesDoServico(
    servico as ServicoDoSubpacote,
    inicioPlanejado ?? referencia,
  );
  if (atualizacoes.length) {
    const normalizado: ServicoRealizadoNormalizado = {
      horasPrevistas: extractHorasPrevistas(servico as ServicoDoSubpacote) ?? 1,
      atualizacoes,
    };
    return clampProgress(percentualRealizadoAte(normalizado, referencia));
  }

  const pacotePlanejado = pickFirstObject<PacotePlanejado>(source, [
    "pacotePlanejado",
    "package",
    "plannedPackage",
    "pacote",
  ]);
  if (pacotePlanejado) {
    return clampProgress(calcularPercentualRealizadoPacote(pacotePlanejado, referencia));
  }

  const camposPercentual = [
    "progress",
    "realPercent",
    "realPercentSnapshot",
    "percentualReal",
    "percentualRealAtual",
    "percentualInformado",
    "progressoReal",
    "realProgress",
    "currentProgress",
    "andamento",
    "manualPercent",
    "manualProgress",
    "percent",
    "pct",
  ];

  for (const campo of camposPercentual) {
    if (!Object.hasOwn(source, campo)) continue;
    const parsed = parsePercentual(source[campo]);
    if (parsed !== null) {
      return clampProgress(parsed);
    }
  }

  return 0;
}

export function mapearServicosPlanejados(
  servicos: ServicoPlanejado[] | null | undefined,
  dataReferencia?: DateInput,
): ServicoPlanejadoResumo[] {
  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  if (!Array.isArray(servicos)) return [];

  return servicos.map((servico) => {
    const percentualPlanejado = calcularPercentualPlanejadoServico(servico, referencia);
    const percentualReal =
      parsePercentual(servico.percentualRealAtual) ??
      parsePercentual(servico.percentualReal) ??
      parsePercentual(servico.percentualInformado) ??
      parsePercentual(servico.progressoReal) ??
      parsePercentual(servico.realProgress) ??
      parsePercentual(servico.currentProgress) ??
      0;

    let id: string | undefined;
    if (typeof servico.id === "string") {
      id = servico.id;
    } else if (typeof servico.id === "number" && Number.isFinite(servico.id)) {
      id = String(servico.id);
    }

    return {
      id,
      descricao: normalizeDescricao(servico),
      percentualPlanejado,
      percentualReal,
    };
  });
}

export function calcularCurvaSPlanejada(
  pacote: PacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): CurvaSPonto[] {
  const referencia = dataReferencia ? toDate(dataReferencia) ?? new Date() : null;
  const servicos = coletarServicosDoPacote(pacote);
  const preparados = prepararServicosPlanejados(servicos);
  let linhaDoTempo = gerarLinhaDoTempo(preparados);
  if (!linhaDoTempo.length) return [];
  if (referencia) {
    const limite = startOfDay(referencia).getTime();
    linhaDoTempo = linhaDoTempo.filter((data) => data.getTime() <= limite);
    if (!linhaDoTempo.length) {
      linhaDoTempo = [startOfDay(referencia)];
    }
  }
  const somaHoras = preparados.reduce((total, servico) => total + servico.horasPrevistas, 0);
  return linhaDoTempo.map((data) => ({
    data,
    percentual:
      somaHoras > 0 ? calcularPercentualPlanejadoNoDia(preparados, data, somaHoras) : 0,
  }));
}

export function calcularCurvaSRealizada(
  pacote: PacotePlanejado | null | undefined,
  dataReferencia?: DateInput,
): CurvaSPonto[] {
  const referencia = dataReferencia ? toDate(dataReferencia) ?? new Date() : null;
  const servicos = coletarServicosDoPacote(pacote);
  const preparados = prepararServicosPlanejados(servicos);
  let linhaDoTempo = gerarLinhaDoTempo(preparados);
  if (!linhaDoTempo.length) return [];
  const somaHoras = preparados.reduce((total, servico) => total + servico.horasPrevistas, 0);
  if (somaHoras <= 0) {
    return linhaDoTempo.map((data) => ({ data, percentual: 0 }));
  }
  const servicosRealizados = prepararServicosRealizados(preparados);

  const dataUltimaAtualizacao = servicosRealizados.reduce<Date | null>((maisRecente, servico) => {
    const ultima = servico.atualizacoes.length ? servico.atualizacoes[servico.atualizacoes.length - 1].data : null;
    if (!ultima) return maisRecente;
    if (!maisRecente || ultima.getTime() > maisRecente.getTime()) {
      return ultima;
    }
    return maisRecente;
  }, null);

  const limiteReferencia = referencia ? startOfDay(referencia).getTime() : null;

  const limiteData = (() => {
    if (limiteReferencia !== null && dataUltimaAtualizacao) {
      return Math.min(limiteReferencia, startOfDay(dataUltimaAtualizacao).getTime());
    }
    if (limiteReferencia !== null) return limiteReferencia;
    if (dataUltimaAtualizacao) return startOfDay(dataUltimaAtualizacao).getTime();
    return null;
  })();

  if (limiteData !== null) {
    const primeiroDiaPlanejado = linhaDoTempo[0] ? startOfDay(linhaDoTempo[0]) : null;
    linhaDoTempo = linhaDoTempo.filter((data) => data.getTime() <= limiteData);
    if (!linhaDoTempo.length && primeiroDiaPlanejado) {
      linhaDoTempo = [primeiroDiaPlanejado];
    }
  }

  return linhaDoTempo.map((data) => {
    const somaPonderada = servicosRealizados.reduce((total, servico) => {
      const percentual = percentualRealizadoAte(servico, data);
      return total + percentual * servico.horasPrevistas;
    }, 0);
    const percentual = somaPonderada / somaHoras;
    return { data, percentual: clampPercentage(percentual) };
  });
}

export function calcularIndicadoresCurvaS(
  pacote: PacotePlanejado | null | undefined,
  dataHoje?: DateInput,
): IndicadoresCurvaS {
  const referencia = toDate(dataHoje ?? new Date()) ?? new Date();
  const curvaPlanejada = calcularCurvaSPlanejada(pacote, referencia);
  const curvaRealizada = calcularCurvaSRealizada(pacote, referencia);
  const planejadoAteHoje = Math.round(obterValorCurvaNaData(curvaPlanejada, referencia));
  const realizadoRaw = obterValorCurvaNaData(curvaRealizada, referencia);
  const realizado = Math.round(clampPercentage(realizadoRaw));
  return {
    planejadoTotal: 100,
    planejadoAteHoje,
    realizado,
    diferenca: realizado - planejadoAteHoje,
  };
}

type PcmService = Service & {
  folderId?: string | null;
  pastaId?: string | null;
  folderName?: string | null;
};

// Usa a mesma regra de ponderação aplicada nos cálculos de percentual,
// baseada em horas previstas/total/peso. Mantém consistência entre as métricas
// exibidas (percentuais) e os valores derivados (horas faltantes/diferença).
function normalizarHorasTotal(servico: PcmService): number {
  const horas = extractHorasPrevistas(servico as unknown as ServicoDoSubpacote);
  return horas ?? 0;
}

function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clampPercentageValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizarServicosParaSubpacote(servicos: PcmService[]): ServicoDoSubpacote[] {
  return servicos.map((servico) => ({
    ...servico,
    dataInicio: (servico as { dataInicio?: DateInput }).dataInicio,
    dataFim: (servico as { dataFim?: DateInput }).dataFim,
    inicioPrevisto: (servico as { inicioPrevisto?: DateInput }).inicioPrevisto,
    fimPrevisto: (servico as { fimPrevisto?: DateInput }).fimPrevisto,
    inicioPlanejado: (servico as { inicioPlanejado?: DateInput }).inicioPlanejado,
    fimPlanejado: (servico as { fimPlanejado?: DateInput }).fimPlanejado,
    plannedStart: servico.plannedStart,
    plannedEnd: servico.plannedEnd,
    startDate: (servico as { startDate?: DateInput }).startDate,
    endDate: (servico as { endDate?: DateInput }).endDate,
    totalHours: servico.totalHours,
  }));
}

export function calcularMetricasSubpacote(
  services: PcmService[],
  dataReferencia?: DateInput,
): Array<{
  nome: string;
  plannedPercent: number;
  realizedPercent: number;
  totalHours: number;
  horasQueDeveriamEstar: number;
  horasAtual: number;
  diferenca: number;
}> {
  if (!Array.isArray(services) || services.length === 0) return [];

  const referencia = toDate(dataReferencia ?? new Date()) ?? new Date();
  const referenceDate = startOfDay(referencia);
  // A data de referência representa o corte do planejamento. O realizado do
  // resumo, por outro lado, é sempre o progresso atual consolidado e não deve
  // voltar no tempo quando o usuário consulta outra data de referência.
  const currentDate = startOfDay(new Date());

  const grupos = new Map<
    string,
    { nome: string; servicos: PcmService[]; totalHours: number }
  >();

  const semSubpacoteKey = "sem-subpacote";

  services.forEach((servico) => {
    const folderId =
      (typeof servico.folderId === "string" && servico.folderId.trim()) ||
      (typeof servico.pastaId === "string" && servico.pastaId.trim());
    const chave = folderId || semSubpacoteKey;
    const nome =
      (servico.folderName && servico.folderName.trim()) ||
      folderId ||
      "Sem Subpacote";
    const existente = grupos.get(chave) ?? { nome, servicos: [], totalHours: 0 };
    existente.servicos.push(servico);
    existente.totalHours += normalizarHorasTotal(servico);
    existente.nome = existente.nome || nome;
    grupos.set(chave, existente);
  });

  return Array.from(grupos.values())
    .map((grupo) => {
      const servicosNormalizados = normalizarServicosParaSubpacote(grupo.servicos);
      const subpacotePlanejado = { servicos: servicosNormalizados };
      const plannedPercentRaw = clampPercentageValue(
        calcularPercentualSubpacote(subpacotePlanejado, referenceDate) ?? 0,
      );
      const realizedPercentRaw = clampPercentageValue(
        calcularPercentualRealizadoSubpacote(subpacotePlanejado, currentDate) ?? 0,
      );
      // Preserve casas decimais: em subpacotes grandes, alterar a data de um
      // unico servico geralmente muda menos de 1 ponto percentual. Arredondar
      // para inteiro fazia o Resumo por Subpacote aparentar nao ter recalculado.
      const plannedPercent = roundToTwoDecimals(plannedPercentRaw);
      const realizedPercent = roundToTwoDecimals(realizedPercentRaw);
      const horasQueDeveriamEstar = roundToTwoDecimals(
        grupo.totalHours * plannedPercentRaw * 0.01,
      );
      const horasAtual = roundToTwoDecimals(
        grupo.totalHours * realizedPercentRaw * 0.01,
      );
      const diferenca = roundToTwoDecimals(
        grupo.totalHours * (realizedPercentRaw - plannedPercentRaw) * 0.01,
      );

      return {
        nome: grupo.nome,
        plannedPercent,
        realizedPercent,
        totalHours: grupo.totalHours,
        horasQueDeveriamEstar,
        horasAtual,
        diferenca,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

export function calcularMetricasPorSetor(
  services: PcmService[],
  dataReferencia?: DateInput,
): Array<{
  setor: string;
  plannedPercent: number;
  realizedPercent: number;
  totalHours: number;
  horasQueDeveriamEstar: number;
  horasAtual: number;
  diferenca: number;
}> {
  if (!Array.isArray(services) || services.length === 0) return [];

  const currentDate = startOfDay(toDate(dataReferencia ?? new Date()) ?? new Date());

  const grupos = new Map<
    string,
    { setor: string; servicos: PcmService[]; totalHours: number }
  >();

  services.forEach((servico) => {
    const setorRaw =
      (typeof servico.setor === "string" && servico.setor.trim()) ||
      (typeof servico.sector === "string" && servico.sector.trim());
    const setor = setorRaw || "Sem setor";
    const existente = grupos.get(setor) ?? { setor, servicos: [], totalHours: 0 };
    existente.servicos.push(servico);
    existente.totalHours += normalizarHorasTotal(servico);
    grupos.set(setor, existente);
  });

  return Array.from(grupos.values())
    .map((grupo) => {
      const servicos = grupo.servicos;
      let totalHours = 0;
      let sumWeightedPlanned = 0;
      let sumWeightedRealized = 0;

      servicos.forEach((servico) => {
        const horas = normalizarHorasTotal(servico);
        if (horas <= 0) return;
        const servicoComoSubpacote = servico as unknown as ServicoDoSubpacote;
        totalHours += horas;

        const plannedPercent = clampPercentageValue(
          calcularPercentualPlanejadoServico(servicoComoSubpacote, currentDate) ?? 0,
        );

        const range = resolveDateRange(servicoComoSubpacote);
        const atualizacoes = coletarAtualizacoesDoServico(servicoComoSubpacote, range?.inicio);
        const servicoRealizadoNorm: ServicoRealizadoNormalizado = {
          horasPrevistas: horas,
          atualizacoes,
        };
        const realizedPercent = clampPercentageValue(
          percentualRealizadoAte(servicoRealizadoNorm, currentDate),
        );
        sumWeightedPlanned += plannedPercent * horas;
        sumWeightedRealized += realizedPercent * horas;
      });

      const plannedPercentRaw =
        totalHours > 0 ? clampPercentageValue(sumWeightedPlanned / totalHours) : 0;
      const realizedPercentRaw =
        totalHours > 0 ? clampPercentageValue(sumWeightedRealized / totalHours) : 0;
      const plannedPercent = Math.round(plannedPercentRaw);
      const realizedPercent = Math.round(realizedPercentRaw);
      const horasQueDeveriamEstar = roundToTwoDecimals(
        totalHours * plannedPercentRaw * 0.01,
      );
      const horasAtual = roundToTwoDecimals(
        totalHours * realizedPercentRaw * 0.01,
      );
      const diferenca = roundToTwoDecimals(
        totalHours * (realizedPercentRaw - plannedPercentRaw) * 0.01,
      );

      return {
        setor: grupo.setor,
        plannedPercent,
        realizedPercent,
        totalHours,
        horasQueDeveriamEstar,
        horasAtual,
        diferenca,
      };
    })
    .sort((a, b) => a.setor.localeCompare(b.setor, "pt-BR", { sensitivity: "base" }));
}
