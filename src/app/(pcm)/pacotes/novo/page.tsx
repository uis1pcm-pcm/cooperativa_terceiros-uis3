"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { Field, FormRow } from "@/components/ui/form-controls";
import { tryGetFirestore } from "@/lib/firebase";
import { useFirebaseAuthSession } from "@/lib/useFirebaseAuthSession";
import { dateOnlyToMillis, formatDateOnly, maskDateOnlyInput, parseDateOnly } from "@/lib/dateOnly";

export default function NovoPacotePage() {
  const router = useRouter();
  const [form, setForm] = useState({ nome: "", descricao: "", dataInicio: "", dataFim: "" });
  const [saving, setSaving] = useState(false);
  const { db: firestore, error: firestoreError } = useMemo(() => tryGetFirestore(), []);
  const { ready: isAuthReady, issue: authIssue } = useFirebaseAuthSession();

  useEffect(() => {
    if (firestoreError) {
      console.error("[pacotes/novo] Firestore indisponível", firestoreError);
      toast.error("Configuração de banco de dados indisponível.");
    }
  }, [firestoreError]);

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.nome.trim()) {
      toast.error("Informe o nome do pacote.");
      return;
    }
    const startDate = parseDateOnly(form.dataInicio);
    const endDate = parseDateOnly(form.dataFim);
    if (!startDate || !endDate) {
      toast.error("Datas inválidas. Verifique os valores informados.");
      return;
    }

    const startMillis = dateOnlyToMillis(startDate);
    const endMillis = dateOnlyToMillis(endDate);
    if (startMillis > endMillis) {
      toast.error("A data final deve ser posterior ou igual à data inicial.");
      return;
    }
    if (!firestore) {
      toast.error("Banco de dados indisponível.");
      return;
    }
    if (!isAuthReady) {
      toast.error("Sua sessão segura ainda não foi confirmada. Aguarde ou faça login novamente.");
      return;
    }
    setSaving(true);
    try {
      const nome = form.nome.trim();
      const descricao = form.descricao.trim();
      const inicio = formatDateOnly(startDate);
      const fim = formatDateOnly(endDate);
      const payload = {
        nome,
        name: nome,
        descricao: descricao || null,
        description: descricao || null,
        status: "Aberto",
        plannedStart: inicio,
        plannedEnd: fim,
        dataInicio: inicio,
        dataFim: fim,
        inicioPlanejado: inicio,
        fimPlanejado: fim,
        createdAt: serverTimestamp(),
      };
      const ref = await addDoc(collection(firestore, "packages"), payload);
      toast.success("Pacote criado com sucesso.");
      router.push(`/pacotes/${encodeURIComponent(ref.id)}`);
    } catch (error) {
      console.error("[pacotes/novo] Falha ao criar pacote", error);
      toast.error("Não foi possível criar o pacote.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthReady) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl border bg-amber-50 p-6 text-sm text-amber-700 shadow-sm">
          {authIssue ?? "Sincronizando sessão segura. Aguarde..."}
        </div>
      </div>
    );
  }

  if (!firestore) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <div className="rounded-2xl border bg-card/80 p-6 text-sm text-amber-600 shadow-sm">
          Não foi possível carregar o banco de dados. Verifique a configuração do Firebase.
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Novo pacote</h1>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => router.push("/dashboard")}
        >
          Voltar para o dashboard
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border bg-card/80 p-6 shadow-sm">
        <Field label="Nome do pacote" value={form.nome} onChange={(event) => updateForm("nome", event.target.value)} required />
        <FormRow>
          <Field
            label="Data inicial"
            value={form.dataInicio}
            onChange={(event) => updateForm("dataInicio", maskDateOnlyInput(event.target.value))}
            onBlur={(event) => updateForm("dataInicio", maskDateOnlyInput(event.target.value))}
            placeholder="dd/mm/aaaa"
            inputMode="numeric"
            maxLength={10}
            pattern="\d{2}/\d{2}/\d{4}"
            required
          />
          <Field
            label="Data final"
            value={form.dataFim}
            onChange={(event) => updateForm("dataFim", maskDateOnlyInput(event.target.value))}
            onBlur={(event) => updateForm("dataFim", maskDateOnlyInput(event.target.value))}
            placeholder="dd/mm/aaaa"
            inputMode="numeric"
            maxLength={10}
            pattern="\d{2}/\d{2}/\d{4}"
            required
          />
        </FormRow>
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground/90" htmlFor="descricao">
            Descrição
          </label>
          <textarea
            id="descricao"
            value={form.descricao}
            onChange={(event) => updateForm("descricao", event.target.value)}
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <p className="text-xs text-muted-foreground">Texto livre para contextualizar o pacote.</p>
        </div>

        <button type="submit" className="btn btn-primary" aria-busy={saving} disabled={saving}>
          {saving ? "Salvando..." : "Salvar pacote"}
        </button>
      </form>
    </div>
  );
}
