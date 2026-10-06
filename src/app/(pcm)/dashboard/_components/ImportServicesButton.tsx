"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function ImportServicesButton() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<
    { created: number; duplicates: number; skipped: number; errors?: Array<{ row: number | null; error: string }> } | null
  >(null);

  function handleChooseFile() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    await uploadFile(file);
  }

  async function uploadFile(file: File) {
    setIsUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/pcm/servicos/import", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok: boolean;
            created?: number;
            duplicates?: number;
            skipped?: number;
            errors?: Array<{ row: number | null; error: string }>;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        const message = payload?.error || "Não foi possível importar a planilha.";
        throw new Error(message);
      }

      setResult({
        created: payload.created ?? 0,
        duplicates: payload.duplicates ?? 0,
        skipped: payload.skipped ?? 0,
        errors: payload.errors ?? [],
      });
      toast.success(`Importação concluída: ${payload.created ?? 0} serviço(s) criado(s).`);
      if ((payload.errors?.length ?? 0) > 0) {
        const firstError = payload.errors?.[0];
        toast.warning(
          `Algumas linhas não foram criadas (${payload.errors?.length}). Primeira falha: linha ${firstError?.row ?? "?"} - ${firstError?.error}`,
        );
      }
      setOpen((payload.errors?.length ?? 0) > 0);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível importar a planilha.";
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-secondary flex items-center gap-2">
          <UploadCloud className="h-4 w-4" />
          Importar planilha
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar serviços via Excel</DialogTitle>
          <DialogDescription>
            Faça upload da planilha (cabeçalhos na linha 8, dados a partir da linha 9) contendo os campos
            O.S, SETOR, TAG MAQUINA, EQUIP. NOVO, DESCRIÇÃO SERVIÇOS, DATA DE INICIO, DATA FINAL, EMPRESA,
            CNPJ e TOTAL DE HORA HOMEM. Serviços já existentes serão ignorados automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <p className="text-sm text-muted-foreground">
            Cada linha completa da planilha representa um serviço. Se uma nova planilha contiver registros já
            importados com a mesma O.S, eles serão descartados para evitar duplicação.
          </p>

          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={handleChooseFile}
            disabled={isUploading}
          >
            {isUploading ? "Importando..." : "Selecionar planilha"}
          </button>

          {result ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Resumo da importação</p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">Criados:</span> {result.created}
                </li>
                <li>
                  <span className="font-medium text-foreground">Duplicados ignorados:</span> {result.duplicates}
                </li>
                <li>
                  <span className="font-medium text-foreground">Linhas não criadas:</span> {result.skipped}
                </li>
              </ul>
              {result.errors?.length ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <p className="font-semibold">Falhas retornadas pela importação:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {result.errors.slice(0, 5).map((item, index) => (
                      <li key={`${item.row ?? "linha"}-${index}`}>
                        Linha {item.row ?? "?"}: {item.error}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
