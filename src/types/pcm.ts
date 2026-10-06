export type PCMServiceListItem = {
  id: string;
  os?: string | null;
  oc?: string | null;
  tag?: string | null;
  code?: string | null;
  equipamento?: string | null;
  equipmentName?: string | null;
  setor?: string | null;
  sector?: string | null;
  status?: string | null;
  andamento?: number | null;
  progress?: number | null;
  realPercent?: number | null;
  manualPercent?: number | null;
  packageId?: string | null;
  empresa?: string | null;
  company?: string | null;
  cnpj?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  plannedStart?: unknown;
  plannedEnd?: unknown;
  plannedDaily?: number[] | null;
  assignedTo?: {
    companyName?: string | null;
    companyId?: string | null;
  } | null;
  [key: string]: unknown;
};

export type PCMPackageListItem = {
  id: string;
  name?: string | null;
  status?: string | null;
  code?: string | null;
  createdAt?: number | null;
  servicesCount?: number;
  services?: unknown[];
  serviceIds?: unknown[];
  [key: string]: unknown;
};

export type PCMListResponse<T> = {
  items: T[];
  nextCursor: string | null;
};
