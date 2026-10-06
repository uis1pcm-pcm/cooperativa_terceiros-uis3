"use client";

import { useState, useTransition, FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

type DashboardFiltersProps = {
  companies: string[];
  packages: string[];
  current: {
    status?: string;
    company?: string;
    packageId?: string;
  };
};

const statuses = [
  { value: "", label: "Todos os status" },
  { value: "aberto", label: "Abertos" },
  { value: "pendente", label: "Pendentes" },
  { value: "concluido", label: "Concluídos" },
];

export default function DashboardFilters({ companies, packages, current }: DashboardFiltersProps) {
  const [status, setStatus] = useState(current.status ?? "");
  const [company, setCompany] = useState(current.company ?? "");
  const [packageId, setPackageId] = useState(current.packageId ?? "");
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (company) params.set("company", company);
    if (packageId) params.set("package", packageId);

    startTransition(() => {
      router.replace(params.size ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
      toast.success("Filtros aplicados");
    });
  }

  function resetFilters() {
    setStatus("");
    setCompany("");
    setPackageId("");
    startTransition(() => {
      router.replace(pathname, { scroll: false });
      toast.success("Filtros limpos");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="label">
          Status
          <select
            className="input mt-1"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="label">
          Empresa
          <select
            className="input mt-1"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          >
            <option value="">Todas</option>
            {companies.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="label">
          Pacote
          <select
            className="input mt-1"
            value={packageId}
            onChange={(event) => setPackageId(event.target.value)}
          >
            <option value="">Todos</option>
            {packages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="btn btn-primary flex-1"
            disabled={isPending}
          >
            {isPending ? "Aplicando…" : "Aplicar filtros"}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="btn btn-secondary"
            disabled={isPending}
          >
            {isPending ? "…" : "Limpar"}
          </button>
        </div>
      </div>
    </form>
  );
}
