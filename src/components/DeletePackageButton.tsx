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

export type DeletePackageButtonProps = {
  packageId: string;
  packageLabel: string;
  triggerClassName?: string;
  children?: ReactNode;
};

export default function DeletePackageButton({
  packageId,
  packageLabel,
  triggerClassName,
  children,
}: DeletePackageButtonProps) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  async function deletePackageHandler() {
    if (isDeleting) return;
    setIsDeleting(true);

    try {
      const { auth, error } = tryGetAuth();
      const user = auth?.currentUser;
      if (!user) {
        throw error ?? new Error("Faça login novamente para excluir o pacote.");
      }

      const idToken = await user.getIdToken();
      const encodedId = encodeURIComponent(packageId);
      const response = await fetch(`/api/pcm/packages/${encodedId}`, {
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
          data &&
          typeof data === "object" &&
          data &&
          "error" in data &&
          typeof (data as { error?: unknown }).error === "string"
            ? ((data as { error?: string }).error ?? "")
            : "Não foi possível excluir o pacote.";
        throw new Error(message || "Não foi possível excluir o pacote.");
      }

      toast.success("Pacote excluído com sucesso.");
      setOpen(false);
      router.push("/pacotes");
      router.refresh();
    } catch (err: unknown) {
      console.error(`[packages/${packageId}] Falha ao excluir pacote`, err);
      const message = err instanceof Error ? err.message : "Não foi possível excluir o pacote.";
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
          className={cn("btn btn-destructive", triggerClassName)}
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
          <DialogTitle>Excluir pacote</DialogTitle>
        </DialogHeader>
        <DialogDescription className="space-y-2">
          <p>Tem certeza que deseja excluir o pacote abaixo? Essa ação não pode ser desfeita.</p>
          <p className="font-semibold text-foreground">{packageLabel}</p>
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
            onClick={deletePackageHandler}
            disabled={isDeleting}
          >
            {isDeleting ? "Excluindo…" : "Excluir definitivamente"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
