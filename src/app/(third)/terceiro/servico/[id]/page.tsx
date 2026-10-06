import ServiceDetailsClient from "@/components/ServiceDetailsClient";
import { fetchThirdService, fetchThirdServiceChecklist, fetchThirdServiceUpdates } from "@/lib/thirdServiceData";
import { getTokenCookie } from "@/lib/tokenSession";
import { getServicesForToken } from "@/lib/terceiroService";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";
import { unstable_cache } from "next/cache";

async function getThirdServiceBundle(serviceId: string) {
  const cached = unstable_cache(
    async () => {
      const service = await fetchThirdService(serviceId);
      if (!service) {
        return null;
      }

      const [updates, checklist] = await Promise.all([
        fetchThirdServiceUpdates(serviceId, 20).catch((error) => {
          console.error(`[terceiro/${serviceId}] Falha ao carregar atualizações`, error);
          return [];
        }),
        fetchThirdServiceChecklist(serviceId).catch((error) => {
          console.error(`[terceiro/${serviceId}] Falha ao carregar checklist`, error);
          return [];
        }),
      ]);

      const hasChecklist = service.hasChecklist || checklist.length > 0;

      return {
        service: { ...service, hasChecklist },
        updates,
        checklist,
      };
    },
    ["third-service-bundle", serviceId],
    {
      revalidate: 30,
      tags: [
        "services:detail",
        "services:updates",
        "services:legacy-updates",
        `services:detail:${serviceId}`,
        `services:updates:${serviceId}`,
        `service:${serviceId}:updates`,
        `service:${serviceId}:legacy-updates`,
      ],
    },
  );

  return cached();
}

export default async function TerceiroServicoPage({ params }: { params: { id: string } }) {
  const token = await getTokenCookie();
  if (!token) return null;

  try {
    const allowed = (await getServicesForToken(token)).some((service) => service.id === params.id);
    if (!allowed) {
      return <div className="card p-6">Acesso negado a este serviço.</div>;
    }

    const bundle = await getThirdServiceBundle(params.id);
    if (!bundle) {
      return <div className="card p-6">Serviço não encontrado.</div>;
    }

    return (
      <ServiceDetailsClient
        service={bundle.service}
        updates={bundle.updates}
        checklist={bundle.checklist}
      />
    );
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error(`[terceiro/${params.id}] Firebase Admin não configurado`, error);
      return <div className="card p-6">Configuração de acesso ao banco indisponível.</div>;
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn(`[terceiro/${params.id}] Falha ao acessar serviço`, error);
      const message = mapped.status === 404 ? "Serviço não encontrado." : mapped.message;
      return <div className="card p-6">{message}</div>;
    }

    console.error(`[terceiro/${params.id}] Erro inesperado`, error);
    return <div className="card p-6">Não foi possível carregar este serviço.</div>;
  }
}
