export const dynamic = "force-dynamic";
export const revalidate = 0;

import ServiceDetailsClient from "@/components/ServiceDetailsClient";
import { requireServiceAccess } from "@/lib/public-access";
import { fetchThirdService, fetchThirdServiceChecklist, fetchThirdServiceUpdates } from "@/lib/thirdServiceData";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: { serviceId: string };
  searchParams?: { token?: string };
}) {
  const token = searchParams?.token?.trim().toUpperCase() ?? "";
  if (!token) {
    return <div className="card p-6">Token não informado. Inclua ?token=... na URL.</div>;
  }

  try {
    await requireServiceAccess(token, params.serviceId);
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const status = (error as { status?: number }).status ?? 403;
      const message = error.message || "Acesso não autorizado.";
      return <div className="card p-6">{status === 404 ? "Serviço não encontrado." : message}</div>;
    }
    console.error(`[public/s/${params.serviceId}] Falha ao validar token`, error);
    return <div className="card p-6">Não foi possível validar o token informado.</div>;
  }

  try {
    const service = await fetchThirdService(params.serviceId);
    if (!service) {
      return <div className="card p-6">Serviço não encontrado.</div>;
    }

    const [updates, checklist] = await Promise.all([
      fetchThirdServiceUpdates(params.serviceId, 20).catch((err) => {
        console.error(`[public/s/${params.serviceId}] Falha ao carregar atualizações`, err);
        return [];
      }),
      fetchThirdServiceChecklist(params.serviceId).catch((err) => {
        console.error(`[public/s/${params.serviceId}] Falha ao carregar checklist`, err);
        return [];
      }),
    ]);

    const hasChecklist = service.hasChecklist || checklist.length > 0;

    return (
      <ServiceDetailsClient service={{ ...service, hasChecklist }} updates={updates} checklist={checklist} token={token} />
    );
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error(`[public/s/${params.serviceId}] Firebase Admin não configurado`, error);
      return <div className="card p-6">Configuração de acesso ao banco indisponível.</div>;
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn(`[public/s/${params.serviceId}] Falha ao carregar serviço`, error);
      const message = mapped.status === 404 ? "Serviço não encontrado." : mapped.message;
      return <div className="card p-6">{message}</div>;
    }

    console.error(`[public/s/${params.serviceId}] Falha inesperada`, error);
    return <div className="card p-6">Não foi possível carregar este serviço.</div>;
  }
}
