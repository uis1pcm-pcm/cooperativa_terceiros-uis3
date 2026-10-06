"use client";

import { useMemo } from "react";

export type ChecklistDraftItem = {
  id: string;
  description: string;
  weight: number;
};

type ChecklistItemsEditorProps = {
  items: ChecklistDraftItem[];
  onChange: (items: ChecklistDraftItem[]) => void;
  disabled?: boolean;
};

const clamp = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

export default function ChecklistItemsEditor({ items, onChange, disabled }: ChecklistItemsEditorProps) {
  const totalWeight = useMemo(
    () => Math.round(items.reduce((acc, item) => acc + (Number(item.weight) || 0), 0) * 100) / 100,
    [items],
  );

  function updateItem(id: string, patch: Partial<ChecklistDraftItem>) {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  function addItem() {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 11);
    const newItem: ChecklistDraftItem = {
      id,
      description: "",
      weight: 0,
    };
    onChange([...items, newItem]);
  }

  const percent = clamp(totalWeight);
  const hasExactHundred = Math.round(percent) === 100;

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-background p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Itens do checklist</h3>
        <button type="button" onClick={addItem} disabled={disabled} className="btn btn-secondary text-xs">
          Adicionar linha
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Descrição</th>
              <th className="w-32 px-3 py-2 font-semibold">Peso (%)</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-sm text-muted-foreground">
                  Nenhum item adicionado.
                </td>
              </tr>
            ) : null}
            {items.map((item) => (
              <tr key={item.id} className="border-t">
                <td className="px-3 py-2 align-top">
                  <textarea
                    className="input min-h-[72px] resize-y text-sm"
                    value={item.description}
                    onChange={(event) => updateItem(item.id, { description: event.target.value })}
                    disabled={disabled}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    className="input text-sm"
                    value={item.weight}
                    onChange={(event) =>
                      updateItem(item.id, {
                        weight: clamp(Number(event.target.value ?? 0)),
                      })
                    }
                    disabled={disabled}
                  />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    disabled={disabled}
                    className="btn btn-ghost text-xs text-destructive disabled:opacity-50"
                  >
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground/80">Soma dos pesos</span>
          <span className={hasExactHundred ? "font-semibold text-primary" : "font-semibold text-amber-600"}>
            {percent.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${hasExactHundred ? "bg-primary" : "bg-amber-500"}`}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
        {!hasExactHundred ? (
          <p className="text-xs text-amber-600">A soma dos pesos deve ser exatamente 100%.</p>
        ) : null}
      </div>
    </div>
  );
}
