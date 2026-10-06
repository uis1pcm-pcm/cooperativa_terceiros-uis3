export type ThirdService = {
  id: string;
  os?: string | null;
  oc?: string | null;
  code?: string | null;
  tag?: string | null;
  equipmentName?: string | null;
  sector?: string | null;
  status?: string | null;
  plannedStart?: number | null;
  plannedEnd?: number | null;
  totalHours?: number | null;
  company?: string | null;
  cnpj?: string | null;
  andamento?: number | null;
  realPercent?: number | null;
  manualPercent?: number | null;
  updatedAt?: number | null;
  hasChecklist?: boolean;
  previousProgress?: number | null;
};

export type ThirdServiceUpdate = {
  id: string;
  percent: number;
  description?: string;
  createdAt?: number | null;
  submittedAt?: number | null;
  audit?: {
    submittedAt?: number | null;
  };
  timeWindow?: {
    start?: number | null;
    end?: number | null;
    hours?: number | null;
  };
  subactivity?: {
    id?: string | null;
    label?: string | null;
  };
  mode?: "simple" | "detailed";
  impediments?: Array<{ type: string; durationHours?: number | null }>;
  resources?: Array<{ name: string; quantity?: number | null; unit?: string | null }>;
  workforce?: Array<{ role: string; quantity: number }>;
  shiftConditions?: Array<{ shift: "manha" | "tarde" | "noite"; weather: "claro" | "nublado" | "chuvoso"; condition: "praticavel" | "impraticavel" }>;
  forecastDate?: number | null;
  criticality?: number | null;
  evidences?: Array<{ url: string; label?: string | null }>;
  justification?: string | null;
  previousPercent?: number | null;
  declarationAccepted?: boolean;
};

export type ThirdChecklistItem = {
  id: string;
  description: string;
  weight: number;
  progress: number;
  status: "nao-iniciado" | "em-andamento" | "concluido";
  updatedAt?: number | null;
};
