import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-page grid place-items-center text-center">
      <div className="max-w-md">
        <h1>Página não encontrada</h1>
        <p className="mt-2 text-muted-foreground">
          O recurso solicitado não existe ou foi movido.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Link className="btn btn-secondary" href="/">Ir para a página inicial</Link>
          <Link className="btn btn-primary" href="/login">Ir para o login</Link>
        </div>
      </div>
    </div>
  );
}
