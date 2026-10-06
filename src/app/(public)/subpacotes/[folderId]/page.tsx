export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";

import { requireFolderAccess } from "@/lib/public-access";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { toPublicSubpackageService } from "@/lib/subpackageServices";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";
import SubpackageServicesClient from "./SubpackageServicesClient";

function formatServiceIdList(ids: string[]): string {
  if (ids.length === 0) return "";
  if (ids.length === 1) return ids[0];
  return ids.join(", ");
}

export default async function FolderPublicPage({
  params,
  searchParams,
}: {
  params: { folderId: string };
  searchParams?: { token?: string };
}) {
  const token = searchParams?.token?.trim().toUpperCase() ?? "";
  if (!token) {
    return <div className="card p-6">Token não informado. Inclua ?token=... na URL.</div>;
  }

  try {
    const { folder, services, unavailableServices } = await requireFolderAccess(token, params.folderId);

    const publicServices = services.map(toPublicSubpackageService);

    const unavailableMessage = unavailableServices.length
      ? `Alguns serviços vinculados ao subpacote não estão disponíveis para exibição (${formatServiceIdList(
          unavailableServices,
        )}).`
      : null;

    return (
      <div className="container-page max-w-5xl pb-16">
        <Link href="/" className="link inline-flex items-center gap-1 mb-4">
          ← Voltar
        </Link>

        <div className="card bg-card/60 p-6 shadow-sm backdrop-blur">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight">
            {folder.name ? `Serviços de ${folder.name}` : "Serviços do subpacote"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Consulte abaixo todos os serviços disponíveis com o token informado.
            {folder.company ? ` Empresa responsável: ${folder.company}.` : ""}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {publicServices.length} serviço{publicServices.length === 1 ? "" : "s"} disponível{publicServices.length === 1 ? "" : "s"}.
          </p>
          {unavailableMessage ? (
            <p className="mt-2 text-xs text-amber-600">{unavailableMessage}</p>
          ) : null}
        </div>

        <SubpackageServicesClient folderId={params.folderId} token={token} initialServices={publicServices} />
      </div>
    );
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const status = (error as { status?: number }).status ?? 403;
      const message = error.message || "Acesso não autorizado.";
      return <div className="card p-6">{status === 404 ? "Subpacote não encontrado." : message}</div>;
    }

    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error(`[public/subpacotes/${params.folderId}] Firebase Admin não configurado`, error);
      return <div className="card p-6">Configuração de acesso ao banco indisponível.</div>;
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn(`[public/subpacotes/${params.folderId}] Falha ao carregar subpacote`, error);
      const message = mapped.status === 404 ? "Subpacote não encontrado." : mapped.message;
      return <div className="card p-6">{message}</div>;
    }

    console.error(`[public/subpacotes/${params.folderId}] Falha inesperada`, error);
    return <div className="card p-6">Não foi possível carregar os serviços deste subpacote.</div>;
  }
}
