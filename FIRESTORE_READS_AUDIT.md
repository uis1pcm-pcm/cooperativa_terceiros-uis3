# Resumo executivo

Esta auditoria examinou as leituras Firestore em `src/`, `functions/` e `scripts/`. A reconciliação recuperou pesquisa indexada, cursor composto, backfills manuais e assignment canônico que não estavam presentes no histórico Git disponível. O principal consumidor estrutural restante é o carregamento de histórico por serviço na página de pacote.

Foi corrigido um achado crítico, de baixo risco e coerente com os campos canônicos declarados: a lista de serviços disponíveis deixou de consultar três aliases de pasta para cada candidato e agora usa uma única query por `displayStatus/packageId/folderId/createdAt`.

Com 620 serviços, o uso normal está confortavelmente abaixo de 50.000 leituras/dia após a reconciliação. O detalhe de pacote ainda merece medição real antes de qualquer mudança estrutural.

# Estado atual

A base tem aproximadamente 620 serviços. O custo de uma query é proporcional aos documentos retornados; projeção de campos reduz tráfego, não a contagem de document reads. Consultas agregadas têm cobrança própria por entradas de índice e foram estimadas como poucas leituras para esta escala.

As estimativas abaixo são intervalos, não medições de produção. Cache hit é contado como zero leitura Firestore. Listeners realtime geram uma carga inicial e novas leituras conforme documentos mudam.

# Otimizações já realizadas

- Dashboard usa quatro agregações `count()`, cache de resumo e listas recentes.
- Detalhe, checklist, updates, pacotes, pastas e recentes possuem `unstable_cache` com TTL e tags.
- Progresso manual normal possui fast path constante; rebuild histórico permanece explícito.
- Token ativo usa `orderBy(createdAt desc).limit(1)`, com fallback legado limitado.
- Escritas grandes de pacote usam planejamento/chunks seguros.
- Nesta auditoria, serviços disponíveis passaram a usar uma única query canônica indexada.

Foram reconciliados: pesquisa por `searchTokens`, debounce de 400 ms, cursores compostos, ausência de migração no request do Dashboard, assignment explícito e os três backfills manuais com `--dry-run`.

# Metodologia

1. Busca estática por `.get()`, `getDoc`, `getDocs`, `tx.get`, `count`, `onSnapshot`, `where`, `orderBy`, `limit`, `Promise.all` e loops.
2. Rastreamento dos chamadores das páginas de Dashboard, serviço, pacote, pasta e rotas públicas.
3. Separação entre leitura necessária para exibição e leitura usada apenas para filtrar, contar ou descobrir existência.
4. Estimativa pelo número máximo retornado pelas queries e pelo número de itens iterados.
5. Classificação: CRÍTICO, ALTO, MÉDIO, BAIXO e OK.

Não foi adicionada instrumentação em produção. O Firebase Console continua sendo a fonte correta para validar as hipóteses.

# Leituras por fluxo

| Fluxo | Antes das otimizações declaradas | Estado atual | Cache? | Frequência | Classificação |
|---|---:|---:|---|---|---|
| Abrir Dashboard | ~620+ | agregações + 40 recentes; mismatch é registrado sem scan/migração | 300 s/tags | alta | OK |
| Listar primeiros serviços | 10 | 10 | não | alta | OK |
| Mudar página de serviços | 11 | 10, cursor composto sem get | não | média | OK |
| Pesquisar OS | até 500 | até 100 candidatos indexados | não | alta | OK |
| Pesquisar TAG | até 500 | até 100 candidatos indexados | não | alta | OK |
| Pesquisar CNPJ | até 500 | até 100 candidatos indexados | não | média | OK |
| Pesquisar “motor” | até 500 | até 100 candidatos por trigrama controlado | não | alta | OK |
| Abrir detalhe de serviço | variável | service 1 + checklist C + até 100 updates atuais + 100 legados + token 1; listeners repetem carga inicial | 180 s, depois realtime | alta | ALTO |
| Abrir checklist | C | C, mais service já carregado/cacheado | 180 s | média | OK |
| Atualização normal | histórico completo | ~2 reads no fast path | invalida caches | média | OK |
| Atualização retroativa | histórico completo | ~3 + H | não | baixa | MÉDIO |
| Abrir histórico | todo histórico | até 200 atuais + 200 legados, combinado e cortado | 180 s | média | ALTO |
| Listar serviços disponíveis | candidatos + 3 queries/pasta por candidato | até o limit solicitado, uma query | 300 s salvo disableCache | média | OK após correção |
| Abrir pacote | até 550 serviços + históricos | 1 package + S serviços + até 400 eventos por serviço sem histórico embutido + folders + disponíveis | caches parciais; página force-dynamic | média | CRÍTICO |
| Abrir pasta | 1 folder + serviços exibidos | folder cacheado; rotas públicas podem fazer N gets | 180 s parcial | média | MÉDIO |
| Criar pacote | N leituras no caminho >499 | 0 até 499; N para preflight acima de 499 | não | baixa | BAIXO |
| Excluir pacote | 1 + S + F | 1 package + S serviços + F folders | não | baixa | MÉDIO |
| Obter token ativo | até histórico | 1 canônico; até 2 com fallback | não, por segurança | alta | OK |
| Validar token | 1–3 | 1 direto; até 3 aliases em algumas rotas | não, por segurança | alta | OK |
| Página pública por token | variável | token + serviço/folder + N serviços + checklist + até 20/50 updates | bundle de serviço 30 s | alta | MÉDIO/ALTO |
| Curva S de serviço | histórico | usa dados já carregados/cacheados no detalhe ou 1 serviço na rota dedicada | parcial | média | OK isoladamente |
| Importação | existência em lotes + gravações | queries `in` em chunks de 10; token por item pode acrescentar reads | não | baixa | MÉDIO |

Legenda: `C` = itens de checklist, `H` = eventos históricos, `S` = serviços do pacote, `F` = pastas, `N` = itens processados.

# Antes x depois

## Serviços disponíveis

Antes desta auditoria, para limite 200:

- até 800 documentos candidatos eram carregados;
- para cada candidato elegível eram feitas três queries `array-contains` em `packageFolders`;
- pior caso teórico: 800 reads de serviços + até 2.400 resultados/consultas de pasta.

Depois:

- uma query retorna no máximo 200 documentos já disponíveis;
- nenhuma consulta de pasta é feita por candidato;
- cache existente continua disponível.

## Progresso

- Atualização normal: de `O(H)` para aproximadamente 2 reads.
- Atualização retroativa/rebuild: continua `O(H)`, propositalmente.

## Tokens

- Token ativo: de leitura do histórico para 1 documento; fallback legado continua limitado a 1 candidato.

## Ponto estrutural restante

- Pacote continua carregando históricos de cada serviço porque a Curva S atual depende da série temporal.

# Top 10 consumidores atuais

| # | Arquivo/função | Custo potencial | Frequência | Classe | Recomendação |
|---:|---|---:|---|---|---|
| 1 | `pacotes/[id]/page.tsx`, histórico por serviço | S + até 400×S eventos | média | CRÍTICO | Persistir/usar progresso canônico para visão agregada; carregar histórico somente sob demanda |
| 2 | detalhe de serviço + três listeners | 1 + C + até 200 eventos, repetidos na carga realtime | alta | ALTO | Medir antes de alterar SSR/realtime |
| 3 | histórico de serviço | até 400 documentos consultados para devolver no máximo 200 | média | ALTO | Marcador de legado ou paginação única entre fontes |
| 4 | página pública de pasta | token + folder + N gets de serviços | média/alta | ALTO para pastas grandes | Migrar leitura para `folderId` após validar o backfill em produção |
| 5 | `setFolderServices` | 1 folder + N services + 1 package + F siblings + 1 folder | baixa | MÉDIO | Manter validação e medir operações grandes |
| 6 | exclusão de serviço | service + subdocumentos + tokens + 3 aliases de folder | baixa | MÉDIO | Necessário para limpeza |
| 7 | exclusão de pacote | 1 + S + F | baixa | MÉDIO | Proporcional à liberação necessária |
| 8 | importação | consultas `in` + token/existência por item | baixa | MÉDIO | Medir por job |
| 9 | pesquisa indexada | até 100 candidatos, normalmente poucos | alta | OK | Medir seletividade dos trigramas |
| 10 | serviços disponíveis | até o limite retornado, uma query | média | OK | Manter cache/tag atual |

# Dashboard

O caminho normal executa quatro agregações e duas listas recentes de 20 itens, todas cacheadas por aproximadamente 300 segundos e invalidadas por tags. `dynamic = force-dynamic` no Dashboard não elimina os caches explícitos do repositório.

No mismatch entre total e soma dos três status, o código registra claramente que há documentos pendentes e retorna indisponibilidade de resumo; não lê a coleção nem escreve durante a requisição. A correção é feita exclusivamente pelo backfill manual.

Tags principais: `services:summary`, `services:recent`, `packages:recent`, `services:detail`, `services:updates`, `services:checklist`, `services:available`, `packages:detail`, `packages:services`, `folders:detail`, `folders:by-package`.

As invalidações são amplas em progresso e associação, mas coerentes com as superfícies afetadas. Afiná-las agora economizaria reads apenas após mutations e aumentaria risco de dados obsoletos.

# Pesquisa

Pesquisa usa `searchTokens` indexados. Trigramas controlados preservam substring sem gerar todos os substrings; a query seleciona um token e limita a no máximo 100 candidatos antes da validação compatível em memória.

A página inicial sem busca lê 10 documentos. A paginação usa `updatedAt + documentId` e lê somente os próximos 10 resultados.

Criação e edição via repositório mantêm tokens; o backfill manual cobre documentos existentes e é idempotente.

# Serviços

Detalhes usam cache de 180 segundos para service, checklist e as duas coleções de updates. `getServiceById` e `getService` apontam para o mesmo cache; chamadas paralelas podem ser deduplicadas pelo cache persistente, embora a duplicação semântica permaneça.

O cliente registra listeners realtime para service, updates (100) e checklist. A carga inicial server-side e a carga inicial dos listeners podem duplicar documentos. Isso preserva o comportamento realtime e não foi alterado sem medição, pois remover o bootstrap pode piorar SSR/UX.

# Pacotes e pastas

A abertura de pacote consulta serviços em lotes de IDs, o que custa um read por serviço retornado — não é N+1 de round trips, mas continua S reads. O maior problema é depois consultar `listUpdates(service.id, 200)` para cada serviço sem updates embutidos. Cada chamada consulta até 200 documentos de cada coleção histórica. Para 50 serviços com 20 eventos cada, são cerca de 1.000 reads só de histórico; para históricos grandes, o teto teórico é muito maior.

Isso alimenta Curva S/agregados, portanto removê-lo exige definir se `realPercent` canônico é suficiente para todas as séries exibidas. Não foi alterado automaticamente.

Pastas têm cache de detalhe/lista. `setFolderServices` lê cada serviço selecionado para validar conflito de pacote; são leituras justificadas por regra de negócio, mas podem ser altas em operações grandes.

# Progresso e histórico

O fast path normal lê o service na transação e o update persistido para retorno: aproximadamente 2 reads. Não relê o histórico.

Rebuild lê service + todos `updates` + todos `serviceUpdates`, proporcionalmente ao histórico e adequado para retroatividade/edição/exclusão.

A listagem de histórico consulta ambas as fontes com o mesmo limite e depois corta o merge. Assim, para limite 200, pode ler até 400 para exibir 200. É compatibilidade legada, classificada ALTO quando os dois históricos são grandes.

# Tokens

`getLatestServiceToken` e `ensureServiceAccessToken` usam estado canônico, ordenação e `limit(1)`; fallback legado também é limitado. Não há cache positivo, preservando revogação imediata.

Validação por token custa normalmente 1 read direto. Rotas tolerantes a aliases podem tentar documento direto, `code` e `token`, chegando a aproximadamente 3 consultas em token legado/inválido.

# Páginas públicas

A página pública de serviço valida autorização e carrega bundle com service, até 20 updates e checklist; o bundle tem cache de 30 segundos, mas token permanece validado sem cache positivo.

Pasta pública valida token, lê folder e faz um get por ID listado. O custo é aproximadamente `2 + N`. Usar query por `folderId` seria melhor, mas somente após confirmar que todos os fluxos/backfill mantêm esse campo — o branch ainda contém arrays legados como fonte em vários caminhos.

# Curva S e relatórios

Curva S de serviço é calculada em memória a partir de service/updates já carregados ou cacheados. Não foi encontrada uma varredura global exclusiva da curva individual.

A Curva S de pacote é o motivador aparente do carregamento dos históricos de cada serviço na página de pacote. É o maior consumidor potencial atual. A melhoria estrutural futura é persistir uma série/estado agregado ou carregar séries sob demanda, não simplesmente remover eventos necessários.

Relatórios devem ser tratados como fluxo menos frequente. Queries sem limite em relatórios/listagens administrativas precisam de medição antes de mudança, pois exportação pode legitimamente exigir todos os resultados.

# Cache

Caches relevantes:

| Cache/tag | TTL aproximado | Invalidação |
|---|---:|---|
| service detail/checklist/updates | 180 s | mutations de serviço/progresso |
| available services | 300 s | criação/import/associação |
| dashboard recent/summary | 300 s | mutations relevantes |
| package detail/services/recent | TTL do repositório | mutations de pacote/pasta |
| folder detail/by-package | 180 s | mutations de pasta |
| third service bundle | 30 s | tags de service/update |

Páginas `force-dynamic` continuam podendo usar `unstable_cache`; o problema é apenas quando o acesso não passa pelo cache explícito. Rotas de token devem permanecer dinâmicas.

# Índices

| Índice | Query real | Situação |
|---|---|---|
| accessTokens: targetType, targetId, status, createdAt desc | token ativo por serviço | necessário |
| accessTokens: + company | ensure token por empresa | necessário |
| accessTokens: targetType, targetId, createdAt desc | fallback legado limitado | necessário enquanto houver legado |
| services: packageId, empresa | listagem por token de pacote/empresa | necessário |
| services: status, createdAt desc | listagens filtradas legadas | aparentemente necessário; medir antes de remover |
| services: displayStatus, packageId, folderId, createdAt desc | serviços disponíveis | adicionado nesta auditoria; necessário |

Nenhum índice foi removido. O novo índice troca muitas leituras por custo moderado de índice em writes.

# Estimativa diária

Estas simulações assumem cache compartilhado funcionando, 10 itens por página, 20 itens médios por checklist/histórico em detalhes e excluem importações/backfills ocasionais.

## Leve

Hipóteses:

- 3 administradores;
- por usuário: 3 dashboards, 5 pesquisas, 5 detalhes, 1 update, 2 pacotes/pastas;
- 20 visitas públicas;
- pacote médio com 10 serviços e 10 updates por serviço.

Estimativa: **~5.000–10.000 reads/dia**, ou **10–20%** de 50.000. As 15 pesquisas têm teto de 1.500 candidatos; pacotes podem representar ~600.

## Normal

Hipóteses:

- 10 administradores;
- por usuário: 5 dashboards, 15 pesquisas, 20 detalhes, 5 updates, 5 pacotes/pastas;
- 100 visitas públicas;
- pacotes médios com 20 serviços e 20 updates por serviço.

Estimativa: **~12.000–25.000 reads/dia**, ou **24–50%** da referência, dependendo principalmente do tamanho/frequência dos pacotes e históricos.

## Intenso

Hipóteses:

- 25 administradores;
- por usuário: 10 dashboards, 30 pesquisas, 40 detalhes, 10 updates, 10 pacotes/pastas;
- 500 visitas públicas;
- pacotes de 50 serviços com 30 updates por serviço.

Estimativa: **~100.000–250.000+ reads/dia**, ou **200–500%+**. Pesquisa pode contribuir até 75.000; detalhes de pacote podem dominar conforme o histórico.

As faixas são deliberadamente amplas. O cache pode reduzir detalhes repetidos, enquanto listeners e invalidações frequentes podem aumentá-los.

# Achados corrigidos nesta auditoria

Foi removido o N+1 no caminho normal de serviços disponíveis. A consulta agora filtra diretamente por:

- `displayStatus in [Aberto, Pendente]`;
- `packageId == null`;
- `folderId == null`;
- `createdAt desc`;
- `limit`.

Foi adicionado exatamente o índice composto correspondente.

# Pontos mantidos propositalmente

- Pesquisa mantém filtro final apenas sobre um conjunto indexado limitado, para preservar aliases/substrings.
- Mismatch do Dashboard retorna resumo indisponível e exige backfill manual; não há fallback caro.
- Históricos no pacote: necessários para a série atual; remover mudaria resultado.
- Dois históricos no detalhe: compatibilidade legada.
- Listeners realtime: comportamento visual/realtime existente.
- Validação de token sem cache positivo: segurança.
- Leituras de exclusão/importação: proporcionais à limpeza/validação necessária e pouco frequentes.
- Leitura do update recém-criado: preserva timestamps/retorno exatos.

# Recomendações futuras

1. Medir o detalhe de pacote e confirmar se histórico completo é indispensável para todas as superfícies.
2. Se as métricas justificarem, usar `realPercent` canônico ou carregar séries sob demanda.
3. Após validar o backfill de `folderId` em produção, trocar página pública de pasta por query canônica.
4. Adicionar paginação unificada/marker legado para não consultar 2× o limite de histórico.
5. Medir listeners e cache hit rate antes de alterar SSR/realtime.

Para medir sem dependência nova:

- Firebase Console → Firestore Database → Usage mostra document reads/writes/deletes.
- Google Cloud Console → Monitoring → Metrics Explorer permite agrupar operações por dia e criar alertas.
- Compare dias úteis, horários de pico e dias de importação.
- Execute cenários controlados no Emulator Suite com logs de query para validar contagens antes de produção.
- Marque nos logs de aplicação o nome lógico do fluxo (não dados sensíveis) em testes de carga; não é necessário instrumentar cada get em produção.

# Conclusão

**Com aproximadamente 620 serviços, o projeto está confortável para permanecer dentro de 50.000 leituras diárias em uso normal após a reconciliação.**

Dashboard, pesquisa, tokens, progresso normal e serviços disponíveis estão econômicos. A página de pacote ainda pode carregar históricos de dezenas ou centenas de serviços, portanto uso intenso dessa tela pode ultrapassar a referência.

Não recomendo uma refatoração geral. Recomendo executar e validar os backfills manuais, implantar os índices e medir o uso real por pelo menos uma a duas semanas. A página de pacote só deve receber otimização estrutural adicional se as métricas confirmarem que ela é acessada com frequência e domina as leituras.

# Métricas reais observadas (otimização de agosto de 2026)

As métricas fornecidas foram: `services ORDER BY createdAt DESC LIMIT 400` com 20 execuções/8.000 documentos; `packageFolders` com 20 execuções/840 documentos; `/services` com 5 execuções/3.220 documentos; e aproximadamente 9.600 execuções em cada uma de `updates` e `serviceUpdates`. Document reads e query executions são métricas diferentes: mesmo uma query vazia pode ter cobrança mínima; eliminar uma query legada vazia reduz execuções e a cobrança mínima associada, não apenas documentos retornados.

# Causa confirmada do LIMIT 400

`fetchAvailableOpenServices(200)` executava a query canônica e, mesmo no sucesso, prosseguia para o fallback, cujo `fetchLimit = limit * 2` produzia 400. As 20 execuções vezes 400 documentos explicam exatamente as 8.000 reads. Agora o sucesso canônico retorna imediatamente. O fallback só é alcançado no `catch`; falha que aparenta índice ausente gera aviso explícito, sem expor detalhes ao usuário.

# Causa confirmada do scan de packageFolders

O mesmo fallback fazia `foldersCollection().get()`: 20 scans de aproximadamente 42 pastas explicam 840 reads. A construção do mapa de pastas continua apenas como compatibilidade legada. **Consulta canônica de disponíveis bem-sucedida => nenhuma leitura de `packageFolders`.**

# Legacy serviceUpdates

O marcador canônico escolhido é `hasLegacyServiceUpdates`. Novos serviços recebem `false`. `listUpdates` recebe o marcador já carregado junto com o serviço: `false` consulta somente `updates`; `true` consulta as duas fontes; ausência/`undefined` é estado desconhecido e mantém consulta compatível às duas fontes até backfill. Não foi acrescentada uma leitura do documento do serviço só para descobrir o marcador.

O writer legado encontrado é `src/app/api/progresso/update/route.ts`. Ele agora cria o evento legado e marca o serviço como `true` no mesmo batch. Os demais writers encontrados escrevem na coleção moderna `updates`; exclusão de subcoleção não é writer de evento.

O backfill manual `backfill:legacy-service-updates` pagina serviços por ID, executa exatamente `serviceUpdates.limit(1)` uma vez por serviço, compara o valor detectado com o marcador existente e grava somente divergências. Tem `--dry-run`, progresso, contadores de serviços, consultas, valores true/false e writes, e divide commits por `FIRESTORE_SAFE_BATCH_WRITES` (400). É idempotente e nunca roda em página/request.

# Cache por service

Os caches de histórico agora são factories de `unstable_cache`, porque as tags precisam ser formadas com o `serviceId` conhecido. Chaves incluem serviço e limite; tags são `service:{id}:updates` e `service:{id}:legacy-updates`. Uma atualização de A invalida A, não B/C. O detail/checklist global foi mantido para evitar refatoração desproporcional; updates, o caminho caro, foi priorizado.

`services:available` mantém TTL de 300 segundos. A página de pacote deixou de usar `disableCache: true`. Criação/importação, mutações de pacote e de folder, associação/desassociação e exclusões continuam invalidando a tag nos repositórios/rotas existentes. Assim, aberturas repetidas dentro do TTL sem mutation usam cache; uma mutation de disponibilidade força refresh correto.

# Pacote / Curva S

A página carrega até 650 serviços porque todos alimentam horas, empresas, subpacotes, setores e agregados. Os 3.220 reads observados em 5 execuções (644 por execução) coincidem com `getServicesByIds`/carregamento integral do pacote. Projeção não reduziria document reads, por isso esse conjunto não foi limitado nem trocado por `select`.

A auditoria matemática confirmou que a Curva S realizada precisa da série temporal de updates. Percentuais atuais bastam para alguns cartões/agregados, mas não reproduzem valores em datas passadas. Foi aplicada a opção A, de menor risco: manter o histórico e tornar seu cache/marcador específico. `calcularCurvaSRealizada`, percentuais de pacote/subpacote e métricas de setor/subpacote continuam recebendo os mesmos arrays mesclados, ordenados e limitados; não houve mudança na matemática.

# Antes x depois

## Disponíveis ao abrir pacote

- Antes, pior exemplo: até 200 canônicos + 400 fallback + ~42 folders = ~642 document reads e três caminhos de query.
- Depois, cache miss: até 200 documentos; cache hit: 0 reads; sucesso canônico: 0 consultas/read de folders.
- Se o índice estiver ausente, o fallback temporário ainda pode custar até 400 + folders e agora deixa log explícito.

## Históricos de 600 serviços modernos

- Antes: 600 execuções de `updates` + 600 de `serviceUpdates`, com documentos retornados conforme cada histórico e cobrança mínima para queries vazias.
- Depois do marcador/backfill: 600 execuções de `updates` + 0 legadas, antes do cache.
- Primeira abertura (cache frio): até 600 queries atuais.
- Segunda abertura dentro de 180 s: 0 queries Firestore para históricos cacheados.
- Após update de 1 serviço: cache específico refaz até 1 query atual; antes, tag global podia forçar até 600.
- Após updates de 10 serviços: até 10 queries atuais; antes, até 600 no próximo carregamento.

Os limites de 200 eventos foram preservados porque reduzi-los sem uma prova de janela temporal alteraria a Curva S. A primeira abertura de um pacote grande ainda executa uma query moderna por serviço que não tenha updates embutidos.

# Índices e implantação

O índice necessário permanece exatamente `services(displayStatus ASC, packageId ASC, folderId ASC, createdAt DESC)`, já presente em `firestore.indexes.json`. Nenhum índice novo foi criado. Os índices declarados precisam estar implantados no projeto Firebase com `firebase deploy --only firestore:indexes`; deploy não foi executado.

# Riscos restantes

1. Cache frio de pacote grande ainda lê aproximadamente um documento por serviço e executa uma query moderna de histórico por serviço; isso preserva a série temporal.
2. Documentos sem marcador continuam consultando legado por segurança até o backfill ser concluído.
3. Índice canônico não implantado aciona deliberadamente o fallback caro; o novo log permite detectar isso.
4. Listeners realtime do detalhe continuam com sua carga inicial, por preservação de realtime/UX.
5. Tags globais de detail/checklist permanecem; o ganho marginal não justificou ampliar a mudança.
6. O backfill tem custo único de aproximadamente 620 reads de serviços + aproximadamente 620 consultas `limit(1)` (além da cobrança mínima aplicável) e writes apenas para divergências.
