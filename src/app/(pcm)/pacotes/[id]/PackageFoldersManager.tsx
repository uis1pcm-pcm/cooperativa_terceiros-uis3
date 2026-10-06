"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { tryGetAuth } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/formatDateTime";

export type FolderSummary = {
  id: string;
  name: string;
  companyId?: string | null;
  services: string[];
  tokenCode?: string | null;
  tokenCreatedAt?: number | null;
  progressPercent?: number | null;
  realizedPercent?: number | null;
  startDateMs?: number | null;
  endDateMs?: number | null;
};

export type ServiceOption = {
  id: string;
  label: string;
  description?: string;
  status?: string;
};

export type ServiceInfo = {
  id: string;
  label: string;
  status: string;
  companyLabel?: string;
  isOpen: boolean;
  lastUpdateMs?: number | null;
};

const MAX_VISIBLE_SERVICES = 5;

const STATUS_TONE: Record<string, string> = {
  Aberto: "bg-sky-100 text-sky-700 border-sky-200",
  Pendente: "bg-amber-100 text-amber-700 border-amber-200",
  Concluído: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Encerrado: "bg-slate-200 text-slate-700 border-slate-300",
};

export type PackageFoldersManagerProps = {
  packageId: string;
  services: ServiceOption[];
  serviceDetails: Record<string, ServiceInfo>;
  initialFolders: FolderSummary[];
};

type FolderState = FolderSummary & {
  services: string[];
};

type ServiceSelectionState = Record<string, Set<string>>;

type PendingMap = Record<string, boolean>;

type BooleanMap = Record<string, boolean>;

function normaliseFolder(folder: FolderSummary): FolderState {
  return {
    ...folder,
    services: Array.isArray(folder.services)
      ? folder.services.map((value) => value.trim()).filter((value) => value.length > 0)
      : [],
  };
}

function formatFolderProgress(folder: { progressPercent?: number | null; services: string[] }): string {
  if (!folder.services.length) return "Sem serviços";
  if (typeof folder.progressPercent === "number" && Number.isFinite(folder.progressPercent)) {
    return `${Math.round(folder.progressPercent)}%`;
  }
  return "0%";
}

function formatFolderRealized(folder: { realizedPercent?: number | null; services: string[] }): string {
  if (!folder.services.length) return "Sem serviços";
  if (typeof folder.realizedPercent === "number" && Number.isFinite(folder.realizedPercent)) {
    return `${Math.round(folder.realizedPercent)}%`;
  }
  return "0%";
}

function formatDateLabel(value?: number | null) {
  if (!value || !Number.isFinite(value)) return "";
  return formatDate(value, { timeZone: "America/Sao_Paulo", fallback: "" });
}

function formatDateTimeLabel(value?: number | null) {
  if (!value || !Number.isFinite(value)) return "";
  return formatDateTime(value, { timeZone: "America/Sao_Paulo", fallback: "" });
}

async function authorisedFetch(input: string, init?: RequestInit) {
  const { auth, error } = tryGetAuth();
  const user = auth?.currentUser;
  if (!user) {
    throw error ?? new Error("Faça login novamente para continuar.");
  }

  let idToken: string;
  try {
    idToken = await user.getIdToken(false);
  } catch (tokenError) {
    console.warn("[PackageFoldersManager] Falha ao obter token, tentando refresh", tokenError);
    try {
      idToken = await user.getIdToken(true);
    } catch (refreshError) {
      console.error("[PackageFoldersManager] Falha ao fazer refresh do token", refreshError);
      throw new Error("Não foi possível autenticar. Faça login novamente.");
    }
  }
  
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${idToken}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, { ...init, headers });
}

function buildAccessLink(token?: string | null) {
  if (!token) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/acesso?token=${token}`;
}

function sortServiceOptions(options: ServiceOption[]) {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
}

function buildServiceOptionFromApi(data: Record<string, unknown>): ServiceOption {
  const baseLabel =
    typeof data.os === "string" && data.os
      ? data.os
      : typeof data.oc === "string" && data.oc
        ? data.oc
        : typeof data.tag === "string" && data.tag
          ? data.tag
          : typeof data.id === "string" && data.id
            ? data.id
            : "";
  const descriptionParts: string[] = [];
  const companyLabel =
    (typeof data.empresa === "string" && data.empresa) ||
    (typeof data.company === "string" && data.company) ||
    (typeof (data.assignedTo as { companyName?: string })?.companyName === "string"
      ? (data.assignedTo as { companyName?: string }).companyName
      : undefined);
  if (companyLabel) descriptionParts.push(`Empresa: ${companyLabel}`);
  const sector = typeof data.setor === "string" && data.setor;
  if (sector) descriptionParts.push(`Setor: ${sector}`);

  const status = typeof data.status === "string" ? data.status : "";

  return {
    id: String(data.id ?? ""),
    label: baseLabel || String(data.id ?? ""),
    description: descriptionParts.length ? descriptionParts.join(" • ") : undefined,
    status,
  };
}

export default function PackageFoldersManager({
  packageId,
  services,
  serviceDetails,
  initialFolders,
}: PackageFoldersManagerProps) {
  const encodedPackageId = useMemo(() => encodeURIComponent(packageId), [packageId]);
  const [folders, setFolders] = useState<FolderState[]>(() =>
    initialFolders.map(normaliseFolder).sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })),
  );
  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => initialFolders[0]?.id ?? null);
  const [serviceSelections, setServiceSelections] = useState<ServiceSelectionState>(() => {
    const initial: ServiceSelectionState = {};
    initialFolders.forEach((folder) => {
      initial[folder.id] = new Set(normaliseFolder(folder).services ?? []);
    });
    return initial;
  });
  const [availableServices, setAvailableServices] = useState<ServiceOption[]>(() => sortServiceOptions(services));
  const [loadingAvailableServices, setLoadingAvailableServices] = useState(false);
  const [pendingServices, setPendingServices] = useState<PendingMap>({});
  const [savingServices, setSavingServices] = useState<BooleanMap>({});
  const [rotatingToken, setRotatingToken] = useState<BooleanMap>({});
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderCompany, setNewFolderCompany] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [savingFolderInfo, setSavingFolderInfo] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [addingServicesFor, setAddingServicesFor] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [expandedSelection, setExpandedSelection] = useState<Record<string, boolean>>({});
  const [expandedAssignable, setExpandedAssignable] = useState<Record<string, boolean>>({});
  const [generatingShare, setGeneratingShare] = useState(false);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    if (!folders.length) {
      setActiveFolderId(null);
      return;
    }
    setActiveFolderId((current) => {
      if (current && folders.some((folder) => folder.id === current)) {
        return current;
      }
      return folders[0]?.id ?? null;
    });
  }, [folders]);

  useEffect(() => {
    setAddingServicesFor((current) => {
      if (!current) return null;
      return folders.some((folder) => folder.id === current) ? current : null;
    });
  }, [folders]);

  const refreshAvailableServices = useCallback(async () => {
    setLoadingAvailableServices(true);
    try {
      // Fetch enough records to include older unassigned services. This list is
      // not filtered by company: "Empresa vinculada" identifies the contractor
      // and must not prevent a service without a package from being selected.
      const search = new URLSearchParams({ limit: "2000", mode: "summary" });
      const response = await fetch(`/api/pcm/services/available?${search.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok || !Array.isArray(data.services)) {
        const message =
          typeof data?.error === "string" && data.error
            ? data.error
            : "Não foi possível atualizar a lista de serviços.";
        throw new Error(message);
      }
      const assignedServiceIds = new Set<string>();
      folders.forEach((folder) => {
        folder.services.forEach((id) => {
          if (id) assignedServiceIds.add(id);
        });
      });
      const mappedOptions = data.services
        .map((service: Record<string, unknown>) => buildServiceOptionFromApi(service))
        .filter((option: ServiceOption) => option.id);

      // `services` also contains open services that already belong to this
      // package but have not been assigned to a subpackage. The endpoint only
      // returns globally unassigned services, so replacing the state with its
      // response made package services disappear as soon as this panel opened.
      const refreshedById = new Map<string, ServiceOption>();
      [...services, ...mappedOptions].forEach((option) => {
        if (option.id && !assignedServiceIds.has(option.id)) {
          refreshedById.set(option.id, option);
        }
      });
      setAvailableServices(sortServiceOptions([...refreshedById.values()]));
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao buscar serviços disponíveis", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar os serviços.";
      toast.error(message);
    } finally {
      setLoadingAvailableServices(false);
    }
  }, [folders, services]);

  useEffect(() => {
    if (!addingServicesFor) return;
    refreshAvailableServices();
  }, [addingServicesFor, refreshAvailableServices]);

  function updateServiceSelection(folderId: string, serviceId: string, checked: boolean) {
    setServiceSelections((prev) => {
      const next = { ...prev };
      const current = new Set(next[folderId] ?? []);
      if (checked) {
        current.add(serviceId);
      } else {
        current.delete(serviceId);
      }
      next[folderId] = current;
      return next;
    });
    setPendingServices((prev) => ({ ...prev, [folderId]: true }));
  }

  async function saveFolderServices(folderId: string) {
    const selectedSet = serviceSelections[folderId] ?? new Set<string>();
    const previousSelection = folders.find((folder) => folder.id === folderId)?.services ?? [];
    const selected = Array.from(selectedSet);
    setSavingServices((prev) => ({ ...prev, [folderId]: true }));
    try {
      const encodedFolderId = encodeURIComponent(folderId);
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/folders/${encodedFolderId}/services`, {
        method: "PUT",
        body: JSON.stringify({ services: selected }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error ? data.error : "Não foi possível atualizar os serviços.";
        throw new Error(message);
      }
      const updatedFolder = normaliseFolder(data.folder as FolderSummary);
      setFolders((prev) => {
        const next = prev
          .map((folder) => (folder.id === updatedFolder.id ? updatedFolder : folder))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
        const added = updatedFolder.services.filter((id) => !previousSelection.includes(id));
        const removed = previousSelection.filter((id) => !updatedFolder.services.includes(id));
        setAvailableServices((current) => {
          const withoutAdded = current.filter((option) => !added.includes(option.id));
          const restored = removed
            .map((id) => serviceDetails[id])
            .filter((info): info is ServiceInfo => Boolean(info) && info.isOpen)
            .map((info) => ({
              id: info.id,
              label: info.label,
              description: info.companyLabel,
              status: info.status,
            }));
          const merged = [...withoutAdded];
          restored.forEach((option) => {
            if (!merged.some((existing) => existing.id === option.id)) {
              merged.push(option);
            }
          });
          return sortServiceOptions(merged);
        });
        return next;
      });
      setServiceSelections((prev) => ({ ...prev, [folderId]: new Set(updatedFolder.services) }));
      setPendingServices((prev) => ({ ...prev, [folderId]: false }));
      setAddingServicesFor(null);
      toast.success("Serviços atualizados com sucesso.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao atualizar serviços", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar os serviços.";
      toast.error(message);
    } finally {
      setSavingServices((prev) => ({ ...prev, [folderId]: false }));
    }
  }

  async function rotateToken(folderId: string) {
    setRotatingToken((prev) => ({ ...prev, [folderId]: true }));
    try {
      const encodedFolderId = encodeURIComponent(folderId);
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/folders/${encodedFolderId}/rotate-token`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error ? data.error : "Não foi possível gerar um novo token.";
        throw new Error(message);
      }
      const updatedFolder = normaliseFolder(data.folder as FolderSummary);
      setFolders((prev) =>
        prev
          .map((folder) => (folder.id === updatedFolder.id ? updatedFolder : folder))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })),
      );
      toast.success("Novo token gerado com sucesso.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao rotacionar token", error);
      const message = error instanceof Error ? error.message : "Não foi possível gerar um novo token.";
      toast.error(message);
    } finally {
      setRotatingToken((prev) => ({ ...prev, [folderId]: false }));
    }
  }

  async function copyTokenLink(folder: FolderState) {
    if (!folder.tokenCode) {
      toast.error("Este subpacote ainda não possui um token ativo.");
      return;
    }
    try {
      const link = buildAccessLink(folder.tokenCode);
      await navigator.clipboard.writeText(link);
      toast.success("Link de acesso copiado para a área de transferência.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao copiar link", error);
      toast.error("Não foi possível copiar o link automaticamente.");
    }
  }

  async function generateShareLink() {
    if (!activeFolder) {
      toast.error("Selecione um subpacote para gerar o link público.");
      return;
    }

    const selected = Array.from(serviceSelections[activeFolder.id] ?? new Set<string>());
    if (!selected.length) {
      toast.error("Selecione pelo menos um serviço para compartilhar.");
      return;
    }

    setGeneratingShare(true);
    setShareUrl("");

    try {
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/share`, {
        method: "POST",
        body: JSON.stringify({ serviceIds: selected }),
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || !data || typeof (data as { url?: unknown }).url !== "string") {
        const message =
          data &&
          typeof data === "object" &&
          data &&
          "error" in data &&
          typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error?: string }).error ?? "")
            : "Não foi possível gerar o link público.";
        throw new Error(message || "Não foi possível gerar o link público.");
      }

      const url = ((data as { url: string }).url ?? "").trim();
      if (!url) {
        throw new Error("Não foi possível gerar o link público.");
      }

      setShareUrl(url);
      toast.success("Link público gerado com sucesso.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao gerar link público", error);
      const message = error instanceof Error ? error.message : "Não foi possível gerar o link público.";
      toast.error(message);
    } finally {
      setGeneratingShare(false);
    }
  }

  async function copyShareLink(url: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao copiar link público", error);
      toast.error("Não foi possível copiar o link automaticamente.");
    }
  }

  async function createFolder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) {
      toast.error("Informe o nome do subpacote.");
      return;
    }
    setCreatingFolder(true);
    try {
      const payload: Record<string, unknown> = { name };
      const companyId = newFolderCompany.trim();
      if (companyId) payload.companyId = companyId;
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/folders`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error ? data.error : "Não foi possível criar o subpacote.";
        throw new Error(message);
      }
      const createdFolder = normaliseFolder(data.folder as FolderSummary);
      setFolders((prev) => {
        const next = [...prev, createdFolder].sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
        );
        setActiveFolderId(createdFolder.id);
        return next;
      });
      setServiceSelections((prev) => ({ ...prev, [createdFolder.id]: new Set(createdFolder.services) }));
      setNewFolderName("");
      setNewFolderCompany("");
      toast.success("Subpacote criado com sucesso.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao criar subpacote", error);
      const message = error instanceof Error ? error.message : "Não foi possível criar o subpacote.";
      toast.error(message);
    } finally {
      setCreatingFolder(false);
    }
  }

  function startEditing(folder: FolderState) {
    setEditingFolderId(folder.id);
    setEditName(folder.name);
    setEditCompany(folder.companyId ?? "");
  }

  function cancelEditing() {
    setEditingFolderId(null);
    setEditName("");
    setEditCompany("");
    setSavingFolderInfo(false);
  }

  async function saveFolderInfo(folderId: string) {
    const name = editName.trim();
    if (!name) {
      toast.error("O nome do subpacote não pode ficar vazio.");
      return;
    }
    setSavingFolderInfo(true);
    try {
      const encodedFolderId = encodeURIComponent(folderId);
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/folders/${encodedFolderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name, companyId: editCompany.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error ? data.error : "Não foi possível atualizar o subpacote.";
        throw new Error(message);
      }
      const updatedFolder = normaliseFolder(data.folder as FolderSummary);
      setFolders((prev) =>
        prev
          .map((folder) => (folder.id === updatedFolder.id ? updatedFolder : folder))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })),
      );
      setEditingFolderId(null);
      toast.success("Dados do subpacote atualizados com sucesso.");
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao atualizar subpacote", error);
      const message = error instanceof Error ? error.message : "Não foi possível atualizar o subpacote.";
      toast.error(message);
    } finally {
      setSavingFolderInfo(false);
    }
  }

  async function deleteFolder(folderId: string) {
    setDeletingFolderId(folderId);
    try {
      const encodedFolderId = encodeURIComponent(folderId);
      const response = await authorisedFetch(`/api/pcm/packages/${encodedPackageId}/folders/${encodedFolderId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        const message =
          typeof data?.error === "string" && data.error ? data.error : "Não foi possível excluir o subpacote.";
        throw new Error(message);
      }
      setFolders((prev) => prev.filter((folder) => folder.id !== folderId));
      setServiceSelections((prev) => {
        const next = { ...prev };
        delete next[folderId];
        return next;
      });
      setEditingFolderId(null);
      const unlinkedServices =
        typeof data.unlinkedServices === "number" && Number.isFinite(data.unlinkedServices) ? data.unlinkedServices : 0;
      toast.success(`Subpacote excluído. ${unlinkedServices} serviço(s) foram desvinculados.`);
    } catch (error) {
      console.error("[PackageFoldersManager] Falha ao excluir subpacote", error);
      const message = error instanceof Error ? error.message : "Não foi possível excluir o subpacote.";
      toast.error(message);
    } finally {
      setDeletingFolderId(null);
    }
  }

  const activeFolder = useMemo(() => {
    if (!activeFolderId) return null;
    return folders.find((folder) => folder.id === activeFolderId) ?? null;
  }, [activeFolderId, folders]);
  const activeFolderToken = activeFolder?.tokenCode ?? "";
  const activeFolderLink = useMemo(
    () => (activeFolderToken ? buildAccessLink(activeFolderToken) : ""),
    [activeFolderToken],
  );

  const activeSelection = useMemo(() => {
    if (!activeFolder) return [];
    return Array.from(serviceSelections[activeFolder.id] ?? new Set<string>());
  }, [activeFolder, serviceSelections]);

  const assignableServices = useMemo(() => {
    if (!activeFolder) return [];
    const selection = serviceSelections[activeFolder.id] ?? new Set<string>();
    return availableServices.filter((service) => !selection.has(service.id));
  }, [activeFolder, availableServices, serviceSelections]);

  const filteredAssignable = useMemo(() => {
    if (!serviceSearch.trim()) return assignableServices;
    const query = serviceSearch.trim().toLowerCase();
    return assignableServices.filter((service) =>
      `${service.label} ${service.description ?? ""}`.toLowerCase().includes(query),
    );
  }, [assignableServices, serviceSearch]);

  const activeSelectionKey = useMemo(() => activeSelection.join("|"), [activeSelection]);

  useEffect(() => {
    setShareUrl("");
  }, [activeFolderId, activeSelectionKey]);

  return (
    <div className="card space-y-6 p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Subpacotes</h2>
        <p className="text-sm text-muted-foreground">
          Organize o pacote em subpacotes por empresa, escolha os serviços disponíveis e gere tokens individuais de
          acompanhamento.
        </p>
      </div>

      <form
        onSubmit={createFolder}
        className="grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_auto]"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome do subpacote</label>
          <input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            className="input"
            placeholder="Ex.: Crystal, Delfor"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa/terceiro</label>
          <input
            value={newFolderCompany}
            onChange={(event) => setNewFolderCompany(event.target.value)}
            className="input"
            placeholder="Identificador da empresa (opcional)"
          />
        </div>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={creatingFolder}>
            {creatingFolder ? "Criando…" : "Criar subpacote"}
          </button>
        </div>
      </form>

      {folders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nenhum subpacote criado ainda. Crie um subpacote para distribuir o acesso aos terceiros.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1fr)]">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lista de subpacotes</p>
            <div className="max-h-[45rem] space-y-2 overflow-y-auto pr-2 [scrollbar-gutter:stable]">
              {folders.map((folder) => {
                const isActive = activeFolder?.id === folder.id;
                const selection = serviceSelections[folder.id] ?? new Set<string>();
                const plannedLabel = formatFolderProgress(folder);
                const realizedLabel = formatFolderRealized(folder);
                const startLabel = formatDateLabel(folder.startDateMs) || "-";
                const endLabel = formatDateLabel(folder.endDateMs) || "-";
                return (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setActiveFolderId(folder.id);
                      setAddingServicesFor(null);
                    }}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition focus:outline-none focus-visible:ring",
                      isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{folder.name}</span>
                      <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                        {selection.size} serviço{selection.size === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Empresa: {folder.companyId ? folder.companyId : "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Planejado em: <span className="font-semibold text-foreground">{plannedLabel}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Realizado: <span className="font-semibold text-foreground">{realizedLabel}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cronograma: <span className="font-semibold text-foreground">{startLabel}</span> —{' '}
                      <span className="font-semibold text-foreground">{endLabel}</span>
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {activeFolder ? (
                <div className="space-y-4">
                  <div className="rounded-lg border p-4 shadow-sm">
                    {(() => {
                      const plannedLabel = formatFolderProgress(activeFolder);
                      const realizedLabel = formatFolderRealized(activeFolder);
                      const startLabel = formatDateLabel(activeFolder.startDateMs) || "-";
                      const endLabel = formatDateLabel(activeFolder.endDateMs) || "-";
                      return (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                          <div>
                            <h3 className="text-lg font-semibold text-foreground">{activeFolder.name}</h3>
                            <p className="text-xs text-muted-foreground">
                              Empresa vinculada: {activeFolder.companyId ? activeFolder.companyId : "-"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Planejado em: <span className="font-semibold text-foreground">{plannedLabel}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Realizado: <span className="font-semibold text-foreground">{realizedLabel}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Cronograma: <span className="font-semibold text-foreground">{startLabel}</span> —{' '}
                              <span className="font-semibold text-foreground">{endLabel}</span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Token atual: <span className="font-mono text-foreground">{activeFolder.tokenCode ?? "Sem token ativo"}</span>
                              {activeFolder.tokenCreatedAt ? (
                                <span className="text-muted-foreground"> • gerado em {formatDateTimeLabel(activeFolder.tokenCreatedAt)}</span>
                              ) : null}
                              {activeFolderLink ? (
                                <>
                                  {" "}•{" "}
                                  <a
                                    href={activeFolderLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary underline underline-offset-2"
                                  >
                                    Link público
                                  </a>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => copyTokenLink(activeFolder)}
                              disabled={!activeFolder.tokenCode}
                            >
                              Copiar link
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline"
                              onClick={() => rotateToken(activeFolder.id)}
                              disabled={rotatingToken[activeFolder.id] ?? false}
                            >
                              {rotatingToken[activeFolder.id] ? "Gerando…" : "Rotacionar token"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() => startEditing(activeFolder)}
                            >
                              Editar dados
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                </div>

                <div className="rounded-lg border p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-end gap-3 border-b pb-3">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setAddingServicesFor((current) => (current === activeFolder.id ? null : activeFolder.id));
                        setServiceSearch("");
                      }}
                    >
                      {addingServicesFor === activeFolder.id ? "Fechar" : "Adicionar serviços"}
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {activeSelection.length === 0 ? (
                      <div className="rounded border border-dashed p-4 text-sm text-muted-foreground">
                        Selecione serviços disponíveis para este subpacote.
                      </div>
                    ) : (
                      <>
                        {(expandedSelection[activeFolder.id] ?? false
                          ? activeSelection
                          : activeSelection.slice(0, MAX_VISIBLE_SERVICES)
                        ).map((serviceId) => {
                          const info = serviceDetails[serviceId];
                          const label = info?.label ?? serviceId;
                          const statusLabel = info?.status ?? "Desconhecido";
                          const statusTone = STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
                          const company = info?.companyLabel ? ` • ${info.companyLabel}` : "";
                          return (
                            <div
                              key={serviceId}
                              className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm"
                            >
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium text-foreground">{label}</p>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}
                                  >
                                    {statusLabel}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  ID: {serviceId}
                                  {company}
                                </p>
                              </div>
                              <button
                                type="button"
                                className="btn btn-ghost text-xs text-destructive"
                                onClick={() => updateServiceSelection(activeFolder.id, serviceId, false)}
                              >
                                Remover
                              </button>
                            </div>
                          );
                        })}
                        {activeSelection.length > MAX_VISIBLE_SERVICES ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            <span>
                              Mostrando
                              {expandedSelection[activeFolder.id]
                                ? ` ${activeSelection.length}`
                                : ` ${Math.min(activeSelection.length, MAX_VISIBLE_SERVICES)}`}
                              {` de ${activeSelection.length} serviço${activeSelection.length === 1 ? "" : "s"}.`}
                            </span>
                            <button
                              type="button"
                              className="btn btn-ghost text-xs"
                              onClick={() =>
                                setExpandedSelection((prev) => ({
                                  ...prev,
                                  [activeFolder.id]: !(prev[activeFolder.id] ?? false),
                                }))
                              }
                            >
                              {expandedSelection[activeFolder.id] ? "Mostrar menos" : "Mostrar mais"}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <div className="text-xs text-muted-foreground">
                      {pendingServices[activeFolder.id]
                        ? "Existem alterações pendentes. Salve para aplicar."
                        : "Nenhuma alteração pendente."}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => saveFolderServices(activeFolder.id)}
                      disabled={savingServices[activeFolder.id] || !(pendingServices[activeFolder.id] ?? false)}
                    >
                      {savingServices[activeFolder.id] ? "Salvando…" : "Salvar alterações"}
                    </button>
                  </div>

                  {activeSelection.length > 0 ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-dashed p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h5 className="text-sm font-semibold">Compartilhamento público</h5>
                          <p className="text-xs text-muted-foreground">
                            Gere um link público temporário com os serviços selecionados para compartilhar com terceiros.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-outline whitespace-nowrap"
                          onClick={generateShareLink}
                          disabled={generatingShare}
                        >
                          {generatingShare ? "Gerando…" : "Gerar link público"}
                        </button>
                      </div>
                      {shareUrl ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            readOnly
                            value={shareUrl}
                            className="input w-full text-xs"
                          />
                          <button
                            type="button"
                            className="btn btn-secondary whitespace-nowrap"
                            onClick={() => copyShareLink(shareUrl)}
                          >
                            Copiar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {addingServicesFor === activeFolder.id ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-dashed p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h5 className="text-sm font-semibold">Serviços disponíveis</h5>
                          <p className="text-xs text-muted-foreground">
                            Apenas serviços abertos ou pendentes e sem vínculo com outros pacotes ou subpacotes aparecem
                            nesta lista.
                          </p>
                          {loadingAvailableServices ? (
                            <p className="mt-1 text-xs text-muted-foreground">Atualizando serviços disponíveis…</p>
                          ) : null}
                        </div>
                        <input
                          value={serviceSearch}
                          onChange={(event) => setServiceSearch(event.target.value)}
                          className="input"
                          placeholder="Buscar por OS, código ou empresa"
                        />
                      </div>
                      {filteredAssignable.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Nenhum serviço aberto ou pendente disponível com os filtros atuais.
                        </p>
                      ) : (
                        <>
                          <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                            {(expandedAssignable[activeFolder.id] ?? false
                              ? filteredAssignable
                              : filteredAssignable.slice(0, MAX_VISIBLE_SERVICES)
                            ).map((service) => {
                              const statusLabel = service.status ?? "Aberto";
                              const statusTone = STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
                              return (
                                <label
                                  key={service.id}
                                  className="flex cursor-pointer items-start gap-2 rounded border p-3 text-sm hover:border-primary/40 hover:bg-muted/40"
                                >
                                  <input
                                    type="checkbox"
                                    className="mt-1"
                                    checked={serviceSelections[activeFolder.id]?.has(service.id) ?? false}
                                    onChange={(event) => updateServiceSelection(activeFolder.id, service.id, event.target.checked)}
                                  />
                                  <span className="space-y-1">
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span className="font-medium text-foreground">{service.label}</span>
                                      <span
                                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}
                                      >
                                        {statusLabel}
                                      </span>
                                    </span>
                                    {service.description ? (
                                      <span className="block text-xs text-muted-foreground">{service.description}</span>
                                    ) : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                          {filteredAssignable.length > MAX_VISIBLE_SERVICES ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span>
                                Mostrando
                                {expandedAssignable[activeFolder.id]
                                  ? ` ${filteredAssignable.length}`
                                  : ` ${Math.min(filteredAssignable.length, MAX_VISIBLE_SERVICES)}`}
                                {` de ${filteredAssignable.length} serviço${filteredAssignable.length === 1 ? "" : "s"} disponíveis.`}
                              </span>
                              <button
                                type="button"
                                className="btn btn-ghost text-xs"
                                onClick={() =>
                                  setExpandedAssignable((prev) => ({
                                    ...prev,
                                    [activeFolder.id]: !(prev[activeFolder.id] ?? false),
                                  }))
                                }
                              >
                                {expandedAssignable[activeFolder.id] ? "Mostrar menos" : "Mostrar mais"}
                              </button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Selecione um subpacote para visualizar os detalhes e gerenciar os serviços vinculados.
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={Boolean(editingFolderId)} onOpenChange={(open) => (!open ? cancelEditing() : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar subpacote</DialogTitle>
            <DialogDescription>Atualize nome e empresa/CNPJ vinculados ao subpacote.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nome</label>
              <input value={editName} onChange={(event) => setEditName(event.target.value)} className="input" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa/CNPJ</label>
              <input value={editCompany} onChange={(event) => setEditCompany(event.target.value)} className="input" />
            </div>
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <button
                type="button"
                className="btn btn-destructive"
                onClick={() => editingFolderId && deleteFolder(editingFolderId)}
                disabled={savingFolderInfo || Boolean(deletingFolderId)}
              >
                {deletingFolderId ? "Excluindo…" : "Excluir subpacote"}
              </button>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" onClick={cancelEditing} disabled={savingFolderInfo}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => editingFolderId && saveFolderInfo(editingFolderId)}
                  disabled={savingFolderInfo}
                >
                  {savingFolderInfo ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
