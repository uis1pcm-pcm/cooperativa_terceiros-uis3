export type ServiceChecklistStatus = "nao-iniciado" | "em-andamento" | "concluido";

export type ServiceChecklistItem = {
  id: string;
  description: string;
  weight: number; // 0..100
  progress: number; // 0..100
  status?: ServiceChecklistStatus;
};

export type ServiceUpdateAuthor = {
  uid?: string;
  name?: string;
  companyId?: string;
};

export type ServiceUpdateMode = "simple" | "detailed";

export type ServiceUpdateTimeWindow = {
  start?: number | null;
  end?: number | null;
  hours?: number | null;
};

export type ServiceUpdateSubactivity = {
  id?: string | null;
  label?: string | null;
};

export type ServiceUpdateImpediment = {
  type: string;
  durationHours?: number | null;
};

export type ServiceUpdateResource = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
};

export type ServiceUpdateWorkforceEntry = {
  role: string;
  quantity: number;
};

export type ServiceUpdateShift = "manha" | "tarde" | "noite";

export type ServiceUpdateShiftWeather = "claro" | "nublado" | "chuvoso";

export type ServiceUpdateShiftCondition = "praticavel" | "impraticavel";

export type ServiceUpdateShiftInfo = {
  shift: ServiceUpdateShift;
  weather: ServiceUpdateShiftWeather;
  condition: ServiceUpdateShiftCondition;
};

export type ServiceUpdateEvidence = {
  url: string;
  label?: string | null;
};

export type ServiceUpdateAudit = {
  submittedBy?: string | null;
  submittedByType?: "token" | "user" | "system";
  submittedAt?: number | null;
  previousPercent?: number | null;
  newPercent?: number | null;
  token?: string | null;
  ip?: string | null;
};

export type ServiceUpdate = {
  id: string;
  createdAt: number; // unix ms
  submittedAt?: number | null;
  // Data operacional selecionada para o lançamento (reportDate), em ms.
  date?: number | null;
  description: string;
  percent?: number; // 0..100 (usado quando NÃO há checklist)
  by?: ServiceUpdateAuthor;
  timeWindow?: ServiceUpdateTimeWindow;
  subactivity?: ServiceUpdateSubactivity;
  mode?: ServiceUpdateMode;
  impediments?: ServiceUpdateImpediment[];
  resources?: ServiceUpdateResource[];
  workforce?: ServiceUpdateWorkforceEntry[];
  shiftConditions?: ServiceUpdateShiftInfo[];
  forecastDate?: number | null;
  criticality?: number | null;
  evidences?: ServiceUpdateEvidence[];
  justification?: string | null;
  previousPercent?: number | null;
  declarationAccepted?: boolean;
  audit?: ServiceUpdateAudit;
};

export type ServiceStatus =
  | "Aberto"
  | "Pendente"
  | "Concluído"
  | "aberto"
  | "pendente"
  | "concluido"
  | "concluído"
  | "encerrado";

export type AssignedCompany = {
  companyId?: string;
  companyName?: string;
};

export type Service = {
  id: string;
  os: string;
  oc?: string;
  tag?: string;
  equipmentName?: string;
  setor?: string;
  sector?: string;
  plannedStart: string;
  plannedEnd: string;
  totalHours: number;
  description?: string | null;
  status: ServiceStatus;
  code?: string;
  assignedTo?: AssignedCompany;
  progress?: number;
  updates?: ServiceUpdate[];
  checklist?: ServiceChecklistItem[];
  createdAt: number;
  packageId?: string;
  plannedDaily?: number[];
  company?: string | null;
  empresa?: string | null;
  cnpj?: string | null;
  andamento?: number;
  realPercent?: number;
  updatedAt?: number;
  previousProgress?: number | null;
  hasLegacyServiceUpdates?: boolean;
  importKey?: string | null;
};

export type PackageStatus = ServiceStatus;

export type Package = {
  id: string;
  name: string;
  status: PackageStatus;
  plannedStart: string;
  plannedEnd: string;
  totalHours: number;
  code?: string;
  description?: string | null;
  services?: string[];
  createdAt: number;
  assignedCompanies?: { companyId: string; companyName?: string }[];
};

export type PackageFolder = {
  id: string;
  packageId: string;
  name: string;
  companyId?: string | null;
  services: string[];
  tokenId?: string | null;
  tokenCode?: string | null;
  createdAt?: number;
  updatedAt?: number;
  tokenCreatedAt?: number | null;
};

export type AccessTokenTarget =
  | { targetType: "service"; targetId: string; company?: string }
  | { targetType: "folder"; targetId: string; company?: string };

export type AccessToken = AccessTokenTarget & {
  id: string;
  active: boolean;
  expiresAt?: number | null;
  createdAt?: number;
  oneTime?: boolean | null;
};
