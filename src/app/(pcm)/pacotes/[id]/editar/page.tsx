export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { notFound } from "next/navigation";

import PackageEditorClient from "../PackageEditorClient";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getPackageByIdCached } from "@/lib/repo/packages";

export default async function PackageEditPage({ params }: { params: { id: string } }) {
  const rawPackageId = params.id;
  const decodedPackageId = decodeRouteParam(rawPackageId);
  const packageIdCandidates = Array.from(
    new Set([decodedPackageId, rawPackageId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (packageIdCandidates.length === 0) {
    return notFound();
  }

  let pkg: Awaited<ReturnType<typeof getPackageByIdCached>> | null = null;
  let resolvedPackageId = packageIdCandidates[0];

  for (const candidate of packageIdCandidates) {
    try {
      const result = await getPackageByIdCached(candidate);
      if (result) {
        pkg = result;
        resolvedPackageId = result.id ?? candidate;
        break;
      }
    } catch (error) {
      console.error(`[pacotes/${candidate}] Falha ao carregar pacote para edição`, error);
    }
  }

  if (!pkg) {
    return notFound();
  }

  const packageLabel = pkg.name?.trim() || pkg.code?.trim() || resolvedPackageId;
  const encodedPackageId = encodeURIComponent(resolvedPackageId);

  return (
    <div className="container mx-auto space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editar pacote {packageLabel}</h1>
          <p className="text-sm text-muted-foreground">Atualize o período planejado e a descrição do pacote.</p>
        </div>
        <Link className="btn btn-secondary" href={`/pacotes/${encodedPackageId}`}>
          Voltar
        </Link>
      </div>

      <PackageEditorClient packageId={resolvedPackageId} initialPackage={pkg} />
    </div>
  );
}
