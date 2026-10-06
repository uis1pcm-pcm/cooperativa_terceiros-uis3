"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field, FormRow } from "@/components/ui/form-controls";
import { parseDateOnly, dateOnlyToMillis, formatDateOnly, formatDateOnlyBR, maskDateOnlyInput } from "@/lib/dateOnly";
import { tryGetAuth } from "@/lib/firebase";
import { useFirebaseAuthSession } from "@/lib/useFirebaseAuthSession";
import type { Package } from "@/types";
import PackageImportServicesButton from "./PackageImportServicesButton";

function normaliseStatus(status: Package["status"]): "Aberto" | "Pendente" | "Concluído" | "Encerrado" {
  const raw = String(status ?? "").toLowerCase();
  if (raw === "concluido" || raw === "concluído") return "Concluído";
  if (raw === "encerrado") return "Encerrado";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

function toDateInput(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = parseDateOnly(trimmed);
  if (parsed) {
    return formatDateOnlyBR(parsed);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const fallback = parseDateOnly(trimmed.slice(0, 10));
    return fallback ? formatDateOnlyBR(fallback) : "";
  }
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }
  return "";
}

const statusOptions: Array<ReturnType<typeof normaliseStatus>> = [
  "Aberto",
  "Pendente",
  "Concluído",
  "Encerrado",
];

type PackageEditorClientProps = {
  packageId: string;
  initialPackage: Package;
};

type FormState = {
  name: string;
  code: string;
  description: string;
  startDate: string;
  endDate: string;
  status: ReturnType<typeof normaliseStatus>;
};

export default function PackageEditorClient({ packageId, initialPackage }: PackageEditorClientProps) {
  const router = useRouter();
  const { ready: isAuthReady, issue: authIssue } = useFirebaseAuthSession();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<FormState>(() => ({
    name: initialPackage.name?.trim() ?? "",
    code: initialPackage.code?.trim() ?? "",
    description: initialPackage.description?.trim() ?? "",
    startDate: toDateInput(initialPackage.plannedStart),
    endDate: toDateInput(initialPackage.plannedEnd),
    status: normaliseStatus(initialPackage.status),
  }));

  const encodedPackageId = useMemo(() => encodeURIComponent(packageId), [packageId]);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    if (!form.name.trim()) {
      toast.error("Informe o nome do pacote.");
      return;
    }

    const start = parseDateOnly(form.startDate);
    const end = parseDateOnly(form.endDate);

    if (!start || !end) {
      toast.error("Datas inválidas. Verifique os valores informados.");
      return;
    }

    const startMillis = dateOnlyToMillis(start);
    const endMillis = dateOnlyToMillis(end);
    if (startMillis > endMillis) {
      toast.error("A data final deve ser posterior ou igual à data inicial.");
      return;
    }

    if (!isAuthReady) {
      toast.error(authIssue ?? "Sua sessão segura ainda não foi confirmada. Aguarde ou faça login novamente.");
      return;
    }

    const { auth, error } = tryGetAuth();
    const user = auth?.currentUser;
    if (!user) {
      toast.error(error?.message ?? "Faça login novamente para salvar o pacote.");
      return;
    }

    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        plannedStart: formatDateOnly(start),
        plannedEnd: formatDateOnly(end),
        status: form.status,
      };

      const response = await fetch(`/api/pcm/packages/${encodedPackageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message =
          data &&
          typeof data === "object" &&
          data &&
          "error" in data &&
          typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error?: string }).error ?? "")
            : "Não foi possível atualizar o pacote.";
        throw new Error(message || "Não foi possível atualizar o pacote.");
      }

      toast.success("Pacote atualizado com sucesso.");
      router.push(`/pacotes/${encodedPackageId}`);
      router.refresh();
    } catch (err: unknown) {
      console.error(`[packages/${packageId}] Falha ao atualizar pacote`, err);
      const message = err instanceof Error ? err.message : "Não foi possível atualizar o pacote.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthReady) {
    return (
      <div className="rounded-2xl border bg-amber-50 p-6 text-sm text-amber-700 shadow-sm">
        {authIssue ?? "Sincronizando sessão segura. Aguarde..."}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border bg-card/80 p-6 shadow-sm">
      <div className="flex justify-end">
        <PackageImportServicesButton packageId={packageId} />
      </div>
      <Field
        label="Nome do pacote"
        value={form.name}
        onChange={(event) => updateForm("name", event.target.value)}
        required
      />

      <FormRow>
        <Field
          label="Data inicial"
          value={form.startDate}
          onChange={(event) => updateForm("startDate", maskDateOnlyInput(event.target.value))}
          onBlur={(event) => updateForm("startDate", maskDateOnlyInput(event.target.value))}
          placeholder="dd/mm/aaaa"
          inputMode="numeric"
          maxLength={10}
          pattern="\d{2}/\d{2}/\d{4}"
          required
        />
        <Field
          label="Data final"
          value={form.endDate}
          onChange={(event) => updateForm("endDate", maskDateOnlyInput(event.target.value))}
          onBlur={(event) => updateForm("endDate", maskDateOnlyInput(event.target.value))}
          placeholder="dd/mm/aaaa"
          inputMode="numeric"
          maxLength={10}
          pattern="\d{2}/\d{2}/\d{4}"
          required
        />
      </FormRow>

      <FormRow>
        <Field
          label="Código"
          value={form.code}
          onChange={(event) => updateForm("code", event.target.value)}
          placeholder="Opcional"
        />
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground/90" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            value={form.status}
            onChange={(event) => updateForm("status", normaliseStatus(event.target.value as Package["status"]))}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </FormRow>

      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground/90" htmlFor="description">
          Descrição
        </label>
        <textarea
          id="description"
          value={form.description}
          onChange={(event) => updateForm("description", event.target.value)}
          rows={4}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <p className="text-xs text-muted-foreground">Texto livre para contextualizar o pacote.</p>
      </div>

      <button type="submit" className="btn btn-primary" disabled={saving} aria-busy={saving}>
        {saving ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}
