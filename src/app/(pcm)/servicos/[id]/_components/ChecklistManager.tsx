"use client";

import { useMemo, useState } from "react";
import ChecklistItemsEditor, { ChecklistDraftItem } from "@/components/forms/ChecklistItemsEditor";
import { managementFetch } from "@/lib/managementFetch";

type Props = {
  serviceId: string;
  initialItems: ChecklistDraftItem[];
};

export default function ChecklistManager({ serviceId, initialItems }: Props) {
  const [items, setItems] = useState<ChecklistDraftItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalWeight = useMemo(
    () => Math.round(items.reduce((acc, item) => acc + (Number(item.weight) || 0), 0) * 100) / 100,
    [items],
  );

  const isValid = Math.round(totalWeight) === 100 || items.length === 0;

  async function handleSave() {
    setFeedback(null);
    setError(null);

    if (!isValid) {
      setError("A soma dos pesos deve ser igual a 100%.");
      return;
    }

    try {
      setSaving(true);
      const payload = {
        items: items
          .filter((item) => item.description.trim())
          .map((item) => ({ description: item.description.trim(), weight: Number(item.weight) || 0 })),
      };

      const response = await managementFetch(`/api/management/services/${serviceId}/checklist/set`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível salvar o checklist.");
      }

      setFeedback("Checklist atualizado com sucesso.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro inesperado.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ChecklistItemsEditor items={items} onChange={setItems} />
      {feedback && <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{feedback}</div>}
      {error && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700">{error}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Salvando..." : "Salvar checklist"}
        </button>
      </div>
    </div>
  );
}
