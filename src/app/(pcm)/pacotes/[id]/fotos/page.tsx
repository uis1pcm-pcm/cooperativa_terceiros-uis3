import Link from "next/link";
import { ArrowLeft, Images } from "lucide-react";
import { notFound } from "next/navigation";

import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { formatDateTime } from "@/lib/formatDateTime";
import { listPackageFolders } from "@/lib/repo/folders";
import { getPackageByIdCached, listPackageServices } from "@/lib/repo/packages";
import { getServicesByIds, listUpdates } from "@/lib/repo/services";
import type { Service, ServiceUpdateEvidence } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PackagePhoto = ServiceUpdateEvidence & {
  serviceId: string;
  serviceLabel: string;
  equipmentName: string | null;
  updateId: string;
  updateDate: number;
  description: string | null;
};

function normaliseServiceReferences(values: unknown[] | undefined): string[] {
  return (values ?? [])
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      return "";
    })
    .filter(Boolean);
}

function isDisplayablePhoto(evidence: ServiceUpdateEvidence): evidence is ServiceUpdateEvidence & { url: string } {
  const url = evidence.url?.trim();
  return Boolean(url && (/^https?:\/\//i.test(url) || url.startsWith("/")));
}

function serviceLabel(service: Service): string {
  return service.os?.trim() || service.tag?.trim() || service.code?.trim() || service.id;
}

async function loadPhotos(services: Service[]): Promise<{ photos: PackagePhoto[]; failedServices: number }> {
  const photos: PackagePhoto[] = [];
  let failedServices = 0;
  const chunkSize = 15;

  for (let index = 0; index < services.length; index += chunkSize) {
    const serviceChunk = services.slice(index, index + chunkSize);
    const results = await Promise.allSettled(
      serviceChunk.map(async (service) => ({
        service,
        updates: await listUpdates(service.id, 200, service.hasLegacyServiceUpdates),
      })),
    );

    results.forEach((result) => {
      if (result.status === "rejected") {
        failedServices += 1;
        console.error("[PackagePhotosPage] Falha ao carregar fotos de um serviço", result.reason);
        return;
      }

      const { service, updates } = result.value;
      updates.forEach((update) => {
        const updateDate = update.date ?? update.submittedAt ?? update.createdAt ?? 0;
        (update.evidences ?? []).filter(isDisplayablePhoto).forEach((evidence) => {
          photos.push({
            ...evidence,
            url: evidence.url.trim(),
            serviceId: service.id,
            serviceLabel: serviceLabel(service),
            equipmentName: service.equipmentName?.trim() || null,
            updateId: update.id,
            updateDate,
            description: update.description?.trim() || null,
          });
        });
      });
    });
  }

  return {
    photos: photos.sort((left, right) => right.updateDate - left.updateDate),
    failedServices,
  };
}

export default async function PackagePhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawPackageId } = await params;
  const decodedPackageId = decodeRouteParam(rawPackageId);
  const candidates = Array.from(new Set([decodedPackageId, rawPackageId].filter(Boolean)));

  let pkg: Awaited<ReturnType<typeof getPackageByIdCached>> = null;
  for (const candidate of candidates) {
    pkg = await getPackageByIdCached(candidate);
    if (pkg) break;
  }
  if (!pkg) return notFound();

  const [packageServices, folders] = await Promise.all([
    listPackageServices(pkg.id, { limit: 2000 }),
    listPackageFolders(pkg.id),
  ]);
  const declaredReferences = Array.isArray(pkg.serviceIds)
    ? pkg.serviceIds
    : Array.isArray(pkg.services)
      ? pkg.services
      : [];
  const serviceIds = Array.from(
    new Set([
      ...normaliseServiceReferences(declaredReferences),
      ...packageServices.map((service) => service.id),
      ...folders.flatMap((folder) => folder.services),
    ]),
  );
  const services = await getServicesByIds(serviceIds, { mode: "full" });
  const { photos, failedServices } = await loadPhotos(services);
  const packageLabel = pkg.name || pkg.code || pkg.id;
  const encodedPackageId = encodeURIComponent(pkg.id);

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-6">
      <header className="rounded-2xl border bg-card/80 p-5 shadow-sm">
        <Link
          href={`/pacotes/${encodedPackageId}`}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Voltar para o pacote
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Images className="h-6 w-6 text-primary" aria-hidden />
              Fotos de {packageLabel}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Todas as fotos anexadas às atualizações dos serviços deste pacote.
            </p>
          </div>
          <span className="rounded-full border bg-muted/60 px-3 py-1 text-sm font-medium">
            {photos.length} {photos.length === 1 ? "foto" : "fotos"}
          </span>
        </div>
      </header>

      {failedServices > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Não foi possível carregar as fotos de {failedServices} {failedServices === 1 ? "serviço" : "serviços"}.
        </div>
      ) : null}

      {photos.length === 0 ? (
        <section className="rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center">
          <Images className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">Nenhuma foto anexada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Os serviços deste pacote ainda não possuem fotos em suas atualizações.
          </p>
        </section>
      ) : (
        <section aria-label="Galeria de fotos" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {photos.map((photo, index) => (
            <article
              key={`${photo.serviceId}-${photo.updateId}-${index}`}
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
            >
              <a href={photo.url} target="_blank" rel="noreferrer" className="block bg-muted">
                {/* Evidências podem estar em domínios externos configurados pelos clientes. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.label?.trim() || `Foto do serviço ${photo.serviceLabel}`}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition-transform hover:scale-[1.02]"
                />
              </a>
              <div className="space-y-2 p-4">
                <div>
                  <p className="font-semibold text-foreground">{photo.serviceLabel}</p>
                  <p className="text-sm text-foreground">
                    Equipamento: {photo.equipmentName || "Não informado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(photo.updateDate, { timeZone: "America/Sao_Paulo", fallback: "Data não informada" })}
                  </p>
                </div>
                {photo.label?.trim() ? <p className="text-sm font-medium">{photo.label}</p> : null}
                {photo.description ? (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{photo.description}</p>
                ) : null}
                <Link
                  href={`/servicos/${encodeURIComponent(photo.serviceId)}`}
                  className="inline-flex text-sm font-medium text-primary hover:underline"
                >
                  Ver serviço
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
