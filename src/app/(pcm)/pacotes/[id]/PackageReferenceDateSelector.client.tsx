"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatReferenceLabel } from "@/lib/referenceDate";

type Props = {
  initialValue: string;
};

export default function PackageReferenceDateSelector({ initialValue }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const currentParam = searchParams?.get("refDate") ?? initialValue;
    setSelectedDate(currentParam);
  }, [searchParams, initialValue]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSelectedDate(value);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value) {
      params.set("refDate", value);
    } else {
      params.delete("refDate");
    }
    startTransition(() => {
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(url, { scroll: false });
    });
  };

  const clearReference = () => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("refDate");
    startTransition(() => {
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.replace(url, { scroll: false });
    });
  };

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 text-sm text-foreground shadow-sm">
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Data de referência
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          className="input w-auto min-w-[180px]"
          value={selectedDate}
          onChange={handleChange}
        />
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={clearReference}
          disabled={isPending}
        >
          Limpar
        </button>
      </div>
    </div>
  );
}
