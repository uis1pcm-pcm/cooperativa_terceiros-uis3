"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { managementFetch } from "@/lib/managementFetch";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export default function PackageImportServicesButton({ packageId }: { packageId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function uploadFile(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await managementFetch(`/api/pcm/packages/${encodeURIComponent(packageId)}/import`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json().catch(() => null) as
        | { ok: boolean; created?: number; skipped?: number; foldersCreated?: number; errors?: Array<{ row: number; error: string }>; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        const fallbackMessage = payload?.error || `Não foi possível importar a planilha para o pacote (HTTP ${response.status}).`;
        throw new Error(fallbackMessage);
      }

      toast.success(`Importação concluída: ${payload.created ?? 0} serviço(s) criado(s), ${payload.foldersCreated ?? 0} subpacote(s) criado(s).`);
      if ((payload.errors?.length ?? 0) > 0) {
        const firstError = payload.errors?.[0];
        toast.warning(`Algumas linhas falharam (${payload.errors?.length}): linha ${firstError?.row} - ${firstError?.error}`);
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível importar a planilha para o pacote.";
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-secondary gap-2">
          <UploadCloud className="h-4 w-4" />
          Importar Planilha
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar planilha no pacote</DialogTitle>
          <DialogDescription>
            Importa a planilha Excel, cria/reutiliza subpacotes por EMPRESA e vincula cada serviço ao subpacote correto.
          </DialogDescription>
        </DialogHeader>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void uploadFile(file);
        }} />
        <button type="button" className="btn btn-primary w-full" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
          {isUploading ? "Importando..." : "Selecionar planilha"}
        </button>
      </DialogContent>
    </Dialog>
  );
}
