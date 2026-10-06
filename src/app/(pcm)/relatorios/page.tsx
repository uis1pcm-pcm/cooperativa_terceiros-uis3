"use client";
import RequireAuth from "@/components/RequireAuth";
import PageHeader from "@/components/PageHeader";
import Link from "next/link";

export default function ReportsPage() {
  return (
    <RequireAuth>
      <div className="container-page">
        <PageHeader title="Relatórios" subtitle="Exportação de PDFs e gráficos" />
        <div className="card">
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              Para exportar o relatório completo de um serviço em PDF, acesse a página de detalhes do serviço e
              use o botão <span className="font-semibold text-foreground">“Exportar PDF”</span>. Ele abre a
              visualização de impressão do navegador, permitindo salvar o documento.
            </p>
            <Link href="/servicos" className="btn btn-primary">
              Abrir lista de serviços
            </Link>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
