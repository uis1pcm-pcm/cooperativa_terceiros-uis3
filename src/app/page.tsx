import Link from "next/link";

export default function Home() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="rounded-2xl border bg-card/60 p-8 backdrop-blur">
        <h1>Bem-vindo</h1>
        <p className="mt-2 text-muted-foreground">
          Acompanhe os serviços de terceiros (PCM).
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/login">
            Entrar
          </Link>
          <Link className="btn btn-secondary" href="/acesso">
            Acesso por token
          </Link>
        </div>
      </div>
    </div>
  );
}
