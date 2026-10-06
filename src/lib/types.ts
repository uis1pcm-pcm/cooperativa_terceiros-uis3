import type {
  AccessToken as BaseAccessToken,
  AccessTokenTarget as BaseAccessTokenTarget,
  Package as BasePackage,
  Service as BaseService,
  ServiceChecklistItem as BaseChecklistItem,
  ServiceStatus as BaseServiceStatus,
  ServiceUpdate as BaseServiceUpdate,
} from "@/types";

export type ServiceStatus = BaseServiceStatus;

export type ChecklistItem = BaseChecklistItem & {
  serviceId?: string;
  updatedAt?: number;
  lastUpdateDate?: number;
  lastProgressUpdateAt?: number;
};

export type ServiceUpdate = BaseServiceUpdate & {
  serviceId?: string;
  token?: string;
  manualPercent?: number;
  realPercentSnapshot?: number;
  timeWindow?: BaseServiceUpdate["timeWindow"];
  subactivity?: BaseServiceUpdate["subactivity"];
  mode?: BaseServiceUpdate["mode"];
  impediments?: BaseServiceUpdate["impediments"];
  resources?: BaseServiceUpdate["resources"];
  workforce?: BaseServiceUpdate["workforce"];
  shiftConditions?: BaseServiceUpdate["shiftConditions"];
  forecastDate?: number | null;
  criticality?: number | null;
  evidences?: BaseServiceUpdate["evidences"];
  justification?: string | null;
  previousPercent?: number | null;
  declarationAccepted?: boolean;
  audit?: BaseServiceUpdate["audit"];
  // Data informada pelo terceiro no formulário (reportDate), persistida como timestamp (ms).
  // Strings devem ser normalizadas antes de salvar (ex.: dd/MM/yyyy ou "20 de novembro de 2025").
  date?: number | null;
};

export type Service = BaseService & {
  plannedDaily?: number[];
  company?: string | null;
  cnpj?: string | null;
  realPercent?: number;
  realPercentSnapshot?: number;
  percentualRealAtual?: number;
  manualPercent?: number;
  displayStatus?: ServiceStatus;
  hasChecklist?: boolean;
  packageId?: string;
  updatedAt?: number;
  lastUpdateDate?: number;
  lastProgressUpdateAt?: number;
  previousProgress?: number | null;
  hasLegacyServiceUpdates?: boolean;
};

export type Package = BasePackage & {
  serviceIds?: string[];
};

export type AccessTokenTarget = BaseAccessTokenTarget;

export type AccessToken = BaseAccessToken;
