This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment Variables

Configure the following variables before running the API routes that rely on Firebase Admin:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (com `\n` escapados)

### Login PCM

- O login PCM valida as credenciais no servidor e usa um cookie HTTP-only para a sessão. O navegador não autentica no Firebase nem acessa o Firestore diretamente.
- As operações PCM passam por rotas do servidor autenticadas, que usam Firebase Admin; mantenha o service account configurado na hospedagem.
- Configure `PCM_SESSION_SECRET` com um segredo aleatório persistente para assinar os cookies de sessão. Como fallback, a aplicação usa a chave privada ou o JSON Base64 do service account.
- A tela de detalhes do serviço consulta o servidor periodicamente (a cada 30 segundos) no lugar dos listeners Firestore no navegador.

### Rede do Firestore em produção

- O arquivo `.env.production` mantém as opções de long-polling para fluxos que ainda usam o Firestore Web SDK. O login PCM e suas operações não dependem de Firebase Auth ou de acesso direto ao Firestore pelo navegador.
- Para os fluxos que ainda usam o Firestore Web SDK, garanta que o proxy/firewall permita tráfego para `firestore.googleapis.com` e demais domínios `*.googleapis.com`.
- Caso o proxy permita streaming HTTP (`useFetchStreams`), ajuste as variáveis de ambiente conforme necessário e reinicie a aplicação. A inicialização do Firebase registra no console qual estratégia está ativa para facilitar o diagnóstico.
- Quando um `ERR_CONNECTION_RESET` ocorrer mesmo com o long-polling habilitado, a interface exibe um aviso amistoso e agenda novas tentativas de reconexão automaticamente.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Notas de implementação

- Atualizações de serviço agora são deduplicadas por meio de uma chave estável que prioriza o ID do documento do Firestore. Entradas sem ID utilizam `{modo, autor, timestamp normalizado, percentual, hash da descrição}`. O helper `dedupeUpdates` registra telemetria em `updates.deduplicated`.
- Recursos informados com quantidade `0` ou negativa passam a ser persistidos como `null` e a UI omite o sufixo `• 0`. O helper `sanitiseResourceQuantities` garante consistência nas duas frentes.
- A troca de status para **Concluído** grava `previousProgress` e a reabertura para **Pendente** restaura o valor via `resolveReopenedProgress`. Eventos são registrados em `service.progress.snapshot` e `service.progress.restore`.
- O portal público grava o token validado no cookie de sessão e também em `sessionStorage` (`third_portal_token`). Erros de validação geram `token.validation.failure`; revalidações bem-sucedidas geram `token.validation.success`. Quando a sessão expira, `token.session.missing` e `token.session.expired` são emitidos.
- A tela de pacotes foi reorganizada para priorizar a curva S e expor o pareamento Serviço × Empresa em um card dedicado.
- Endpoints administrativos foram movidos de `/api/admin/*` para `/api/management/*` para evitar bloqueios falsos positivos de bloqueadores de anúncios (erro `ERR_BLOCKED_BY_CLIENT`).
- As regras do Firestore autorizam usuários autenticados a criarem e carregarem pastas de pacotes (`packageFolders`), evitando o erro `FirebaseError: Missing or insufficient permissions` ao cadastrar serviços.
- A tela de detalhes de serviço carrega e atualiza os dados por rotas PCM autenticadas no servidor, usando Firebase Admin; a atualização periódica ocorre a cada 30 segundos.

### Regras de segurança do Firestore

- `isSignedIn()` continua restringindo gravações a usuários autenticados.
- `hasServiceTokenAccess(serviceId)` permite leitura a tokens com claims customizados, aceitando:
  - `serviceId` direto (tokens emitidos por `claimAccessV2` com `role: "third"`),
  - listas (`serviceIds`, `allowedServices`, `allowedServiceIds`) com o identificador do serviço,
  - mapas (`serviceAccess`) em que a chave do serviço esteja marcada com `true` ou com o próprio ID.
- `isServiceReader(serviceId)` reutiliza as verificações acima para liberar leitura em `services/{serviceId}` e subcoleções mesmo para acessos feitos via token, mantendo as operações de escrita restritas a `request.auth` autenticado.

### Feature flags e rollback

- Deduplicação de atualizações e saneamento de recursos são funções puras; para rollback basta trocar os helpers por implementações anteriores.
- A restauração de andamento depende do campo `previousProgress`. Para voltar ao comportamento antigo remova as chamadas de `resolveReopenedProgress`/`snapshotBeforeConclusion` em `ServiceEditorClient` e limpe o campo no Firestore.
- O fluxo do link público utiliza `sessionStorage`. Para desativar, remova a chamada `persistTokenSession` e o uso de `tokenStorageKey` no portal do terceiro.

### Testes

Foram adicionados testes unitários (`tests/unit`) escritos com Vitest e um cenário E2E (`tests/e2e`) com Playwright. Em ambientes restritos é necessário instalar manualmente as dependências:

```bash
npm install --save-dev vitest @playwright/test
```

Execução dos testes:

```bash
npm run test          # unitários
npx playwright test   # E2E
```

> **Observação:** o ambiente de CI local pode bloquear o download dessas bibliotecas (erro 403). Caso ocorra, habilite o acesso ao registry npm ou utilize um mirror interno antes de rodar os testes.

### Lint

Para contornar ambientes sem acesso ao registry npm, `npm run lint` utiliza `scripts/offline-lint.mjs`. O script é autossuficiente e aplica verificações básicas (console.log/debugger proibidos, remoção de espaços ao final da linha e quebra de linha ao final do arquivo) sobre arquivos `.ts`, `.tsx`, `.js` e `.jsx`.
