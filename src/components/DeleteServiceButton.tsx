"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { tryGetAuth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type DeleteServiceButtonProps = {
  serviceId: string;
  serviceLabel: string;
  triggerClassName?: string;
  children?: ReactNode;
};

export default function DeleteServiceButton({
  serviceId,
  serviceLabel,
  triggerClassName,
  children,
}: DeleteServiceButtonProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function deleteService() {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      const { auth, error } = tryGetAuth();
      const user = auth?.currentUser;
      if (!user) {
        throw error ?? new Error("Faça login novamente para excluir o serviço.");
      }

      const idToken = await user.getIdToken();
      const encodedId = encodeURIComponent(serviceId);
      const response = await fetch(`/api/pcm/servicos/${encodedId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message =
          data && typeof data === "object" && data && "error" in data && typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error: string }).error ?? "")
            : "Não foi possível excluir o serviço.";
        throw new Error(message || "Não foi possível excluir o serviço.");
      }

      toast.success("Serviço excluído com sucesso.");
      setOpen(false);
      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      console.error(`[servicos/${serviceId}] Falha ao excluir serviço`, err);
      const message = err instanceof Error ? err.message : "Não foi possível excluir o serviço.";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isDeleting && setOpen(next)}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "btn btn-destructive",
            triggerClassName,
          )}
        >
          {children ?? (
            <>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Excluir
            </>
          )}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir serviço</DialogTitle>
        </DialogHeader>
        <DialogDescription className="space-y-2">
          <p>Tem certeza que deseja excluir o serviço abaixo? Essa ação não pode ser desfeita.</p>
          <p className="font-semibold text-foreground">{serviceLabel}</p>
        </DialogDescription>
        <div className="mt-4 flex justify-end gap-3">
          <DialogClose asChild>
            <button type="button" className="btn btn-secondary" disabled={isDeleting}>
              Cancelar
            </button>
          </DialogClose>
          <button
            type="button"
            className="btn btn-destructive"
            onClick={deleteService}
            disabled={isDeleting}
          >
            {isDeleting ? "Excluindo…" : "Excluir definitivamente"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
