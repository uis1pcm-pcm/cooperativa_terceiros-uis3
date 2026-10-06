export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";

import { listPackagesPCM } from "@/lib/data";

import PackagesListClient from "./PackagesListClient";

export default async function PackagesListPage() {
  const { items, nextCursor } = await listPackagesPCM({ limit: 10 });

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pacotes</h1>
          <p className="text-sm text-muted-foreground">
            Agrupamentos de serviços com acesso rápido aos indicadores, curva S e distribuição por empresas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn btn-secondary" href="/dashboard">
            Voltar para o dashboard
          </Link>
          <Link className="btn btn-primary" href="/pacotes/novo">
            + Novo Pacote
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          Nenhum pacote encontrado.
        </div>
      ) : (
        <PackagesListClient initialItems={items} initialCursor={nextCursor} />
      )}
    </div>
  );
}
