export type Status = "Aberto" | "Pendente" | "Concluído";

export type ChecklistItem = {
  id: string;
  descricao: string;
  peso: number; // 0..100
};

export type ServiceDoc = {
  os: string; oc?: string;
  tag?: string; equipamento?: string; setor?: string;
  inicioPrevisto: FirebaseFirestore.Timestamp;
  fimPrevisto: FirebaseFirestore.Timestamp;
  horasPrevistas: number;
  status: Status;
  empresaId?: string;
  cnpj?: string;
  pacoteId?: string;
  andamento: number;
  checklist?: ChecklistItem[];
  createdBy: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
};

export type UpdateItem = { itemId: string; pct: number };
export type ServiceUpdate = {
  date: FirebaseFirestore.Timestamp;
  note?: string;
  items?: UpdateItem[];
  totalPct?: number;
  by: "token" | "user";
  tokenId?: string;
  ip?: string;
};

export type TokenScope =
  | { type: "service"; serviceId: string }
  | { type: "folder"; folderId: string; pacoteId?: string | null; packageId?: string | null; empresaId?: string | null };

export type AccessTokenDoc = {
  token: string;
  active: boolean;
  scope: TokenScope;
  createdBy: string;
  createdAt: FirebaseFirestore.Timestamp;
};
