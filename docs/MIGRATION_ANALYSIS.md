# MIGRATION_ANALYSIS.md

Primeiro entregável da migração do Chatbot de Mapeamento (Getnet) de n8n + LLM direto
para arquitetura Microsoft 365 Copilot / Copilot Studio. Este documento é uma análise —
nenhum código foi alterado para produzi-lo.

Baseado exclusivamente no que existe hoje no repositório (`chatbook-`): schema Supabase,
workflow n8n e MVP de chat. Nenhuma capacidade do tenant Microsoft foi assumida — tudo que
depende de licenciamento/tenant está listado na seção 5 e 12 como "a confirmar".

---

## 1. Arquitetura atual

```
Usuário
  │
  ▼
index.html (MVP estático, sem framework)
  │  POST /api/chat { message, sessionId }
  ▼
api/chat.js (Vercel serverless) ou server.js (local)
  │  repassa como POST para N8N_WEBHOOK_URL
  ▼
n8n — Workflow "Chatbot Mapeamento - Getnet"
  │
  ├─ Webhook (entrada)
  ├─ Buscar Contexto de Mapeamento  ──┐
  ├─ Buscar Historico da Sessao     ──┤→ Montar Prompt (Code)
  │                                    │
  │                                    ▼
  │                        Chamar Claude (HTTP → api.anthropic.com)
  │                                    │
  │                                    ▼
  │                          Extrair Resposta (Code)
  │                                    │
  │                    ┌───────────────┼───────────────┐
  │                    ▼                               ▼
  │        Salvar Mensagem do Usuario      Salvar Resposta do Assistente
  │                    │                               │
  │                    └───────────────┬───────────────┘
  │                                    ▼
  └─────────────────────────  Respond to Webhook
                                       │
                                       ▼
                              Resposta ao usuário
```

Banco de dados: Supabase Postgres, 3 tabelas (`mapeamentos`, `mapeamentos_pendencias`,
`chatbot_getnet_sessions`), RLS ligado sem policies (só a `service_role` key acessa).

**Característica central a notar**: o "contexto de negócio" hoje não é uma busca — é um
`SELECT ... LIMIT 50` que traz os 50 mapeamentos mais recentes inteiros, sempre, e joga tudo
dentro do system prompt em JSON, independente da pergunta do usuário. Não há retrieval,
não há filtro por relevância, não há RAG sobre documentos (não existem documentos hoje — só
dados estruturados). Isso é o ponto mais importante para dimensionar a migração: o "cérebro"
do sistema atual é, na prática, o node de código `Montar Prompt` decidindo o que entra no
prompt, e o modelo (Claude) fazendo 100% do raciocínio em cima de um contexto bruto.

---

## 2. Arquitetura proposta (alvo)

```
Usuário
  │
  ▼
Microsoft 365 Copilot / Teams (canal publicado)
  │
  ▼
Copilot Studio — Getnet Process Mapping Agent (orquestrador, sem dados/lógica no prompt)
  │
  ├── Conhecimento ─── SharePoint / Microsoft Graph e/ou Supabase Storage+pgvector (a decidir — seção 2.1)
  ├── Ferramentas  ─── MCP / API segura sobre Supabase PostgreSQL (mapeamentos, pendências, sessões)
  ├── Workflows    ─── Power Automate (ações determinísticas, se surgirem)
  └── n8n          ─── somente para integrações pontuais sem substituto — nunca como banco de dados
                        ou camada de memória (avaliado na seção 9)
  │
  ▼
Resposta fundamentada
```

A mudança de papel: hoje o n8n é o orquestrador e o Claude só responde; no alvo, o
**Copilot Studio Agent é o orquestrador** e decide quando consultar conhecimento, quando
chamar uma ferramenta e quando (se ainda existir) acionar o n8n para algo específico.

**Decisão de arquitetura confirmada pelo usuário** (governa todo o resto deste documento):
Supabase é a camada principal de persistência do chatbot — dados estruturados
(`mapeamentos`/`mapeamentos_pendencias`) **e** memória de conversa (`chatbot_getnet_sessions`)
continuam no PostgreSQL do Supabase; não migram para Dataverse nem dependem do transcript
nativo do Copilot Studio. O agente nunca deve receber dados estruturados nem lógica de
negócio embutidos diretamente no prompt/instruções (isso reforça o risco já identificado na
seção 10 sobre o padrão atual de "despejar tudo no system prompt" — o alvo corrige exatamente
isso). Toda leitura/escrita no Supabase acontece por ferramenta (MCP ou API segura), nunca
por SQL exposto diretamente ao agente. O n8n não deve ser usado como banco de dados nem como
camada de memória — seu único papel possível, se continuar existindo, é executar uma
integração pontual quando explicitamente acionado como ferramenta pelo agente.

### 2.1 Papel do Supabase na arquitetura alvo

| Recurso | Uso proposto | Status hoje | A confirmar |
|---|---|---|---|
| **PostgreSQL** | Fonte de verdade para `mapeamentos`, `mapeamentos_pendencias` e `chatbot_getnet_sessions` (dados estruturados + memória de conversa) | Já existe e está em uso (schema aplicado) | Nenhuma mudança estrutural necessária; só muda a forma de acesso (MCP/API em vez de query direta do n8n) |
| **pgvector** | Se a Getnet tiver documentos de processo, pode armazenar embeddings desses documentos para busca semântica (RAG), como alternativa ou complemento ao conhecimento nativo do Copilot Studio/SharePoint | Não habilitado/testado — não há hoje nenhum documento nem embedding no schema atual | Precisa decisão: o conhecimento documental vive em SharePoint (nativo do Copilot Studio) ou em Supabase Storage+pgvector (RAG próprio, exposto via MCP)? Ver pergunta na seção 12 |
| **Storage** | Poderia guardar os arquivos-fonte (PDFs, procedimentos) se a opção acima for por RAG próprio em vez de SharePoint | Não usado hoje | Mesma decisão acima — depende de onde a Getnet efetivamente mantém esses documentos hoje |
| **Row Level Security** | Hoje RLS está ligado mas **sem policies** — só a `service_role` key (bypassa RLS) consegue ler/escrever. Para expor ao agente via MCP/API com segurança, isso precisa de policies granulares (por exemplo, escopo por usuário/área) em vez de acesso total via bypass | RLS ligado, sem policies reais | Definir se o agente deve enxergar todos os mapeamentos ou um subconjunto por usuário/permissão — hoje não existe esse controle em nenhuma camada (ver riscos, seção 10) |

Este é o desenho de referência para `docs/MCP_ARCHITECTURE.md`, quando esse documento for
produzido: o servidor MCP fala com o Supabase usando uma chave de serviço restrita a ele
(nunca repassada ao agente), e expõe só as ferramentas necessárias — nunca SQL bruto.

---

## 3. Mapa completo do workflow n8n

| # | Nó | Tipo | Função | Entrada | Saída | Credencial | API/Dados | Regra de negócio |
|---|---|---|---|---|---|---|---|---|
| 1 | Webhook | `n8n-nodes-base.webhook` | Ponto de entrada HTTP | POST `{sessionId, userId, message}` | Dispara os dois ramos abaixo | nenhuma | — | Contrato mínimo: exige `sessionId` e `message` (validado só no backend do MVP, não no n8n) |
| 2 | Buscar Contexto de Mapeamento | `n8n-nodes-base.postgres` | Busca os 50 mapeamentos mais recentes + pendências abertas agregadas | nenhuma (query estática) | Array de linhas (JSON) | Postgres — **vazia, não configurada** | Tabelas `mapeamentos` + `mapeamentos_pendencias` | Sempre traz os 50 últimos por `updated_at`, sem filtro pela pergunta do usuário |
| 3 | Buscar Historico da Sessao | `n8n-nodes-base.postgres` | Busca até 20 mensagens da sessão | `sessionId` do Webhook | Array `{role, content}` | Postgres — **vazia** | Tabela `chatbot_getnet_sessions` | Ordena por `created_at asc`, limite 20 |
| 4 | Montar Prompt | `n8n-nodes-base.code` (JS) | Monta o system prompt (JSON do contexto inteiro) + histórico + pergunta | Saída dos nós 2 e 3 + mensagem do usuário | Body para a Anthropic (`model`, `system`, `messages`) | — | — | Este é o único ponto de "orquestração/decisão" hoje — e é 100% determinístico (sem lógica condicional) |
| 5 | Chamar Claude | `n8n-nodes-base.httpRequest` | Chama o modelo de IA | Body montado no nó 4 | Resposta da Anthropic | Header Auth (`x-api-key`) — **vazia** | `POST api.anthropic.com/v1/messages`, modelo `claude-sonnet-5` | Sem retry, sem timeout customizado, sem function calling/tools configurados |
| 6 | Extrair Resposta | `n8n-nodes-base.code` (JS) | Extrai o texto da resposta | JSON da Anthropic | `{sessionId, userId, userMessage, reply}` | — | — | Fallback genérico se a resposta vier vazia/malformada |
| 7 | Salvar Mensagem do Usuario | `n8n-nodes-base.postgres` | Persiste a pergunta | Saída do nó 6 | INSERT | Postgres — **vazia** | `chatbot_getnet_sessions` (`role='user'`) | — |
| 8 | Salvar Resposta do Assistente | `n8n-nodes-base.postgres` | Persiste a resposta | Saída do nó 6 | INSERT | Postgres — **vazia** | `chatbot_getnet_sessions` (`role='assistant'`) | — |
| 9 | Respond to Webhook | `n8n-nodes-base.respondToWebhook` | Retorna ao chamador | `{sessionId, reply}` | HTTP 200 JSON | — | — | — |

Fora do n8n: `index.html` (UI estática) → `api/chat.js`/`server.js` (proxy fino, sem
autenticação, sem rate limiting) → `N8N_WEBHOOK_URL`.

---

## 4. Matriz de migração

| Componente atual | Função | Tecnologia atual | Destino proposto | Prioridade | Motivo |
|---|---|---|---|---|---|
| Webhook (entrada) | Integração/Entrada | n8n | Canal nativo Teams/M365 Copilot via Copilot Studio | Alta | Copilot Studio já fornece trigger de canal; não precisa de webhook custom para receber a pergunta |
| Buscar Contexto de Mapeamento (`SELECT *` de 50 linhas) | Dado dinâmico | n8n + Postgres | Ferramenta MCP/API segura que consulta o mesmo Supabase Postgres por `codigo_terminal`/`status` sob demanda | Alta | É dado estruturado, não documento — não deve ser despejado inteiro no prompt; deve virar tool call filtrado pela pergunta. Supabase continua sendo o armazenamento, só muda quem acessa (MCP em vez de node n8n) |
| Buscar Historico da Sessao | Estado de conversa | n8n + Postgres | Continua em Supabase (`chatbot_getnet_sessions`), acessado via ferramenta MCP/API segura | Alta | Decisão do usuário: Supabase é a camada principal de persistência, inclusive de memória — não usar o transcript nativo do Copilot Studio nem o n8n como memória |
| Montar Prompt (orquestração) | Inteligência/Orquestração | n8n Code node | Instruções + orquestração nativa do Getnet Process Mapping Agent | Alta | É exatamente a função que deve migrar para o agente |
| Chamar Claude | Modelo de IA | Anthropic API via HTTP no n8n | Modelo gerenciado pelo Copilot Studio | Alta | Passa a ser responsabilidade da plataforma, não uma chamada manual |
| Extrair Resposta | Parsing | n8n Code node | Nativo do Copilot Studio | Alta | Deixa de ser necessário |
| Salvar Mensagem/Resposta (sessions) | Persistência de histórico | n8n + Postgres | Continua gravando em `chatbot_getnet_sessions` no Supabase, via ferramenta MCP/API segura (não pelo n8n) | Alta | Mesma decisão: Supabase é a camada principal de persistência/memória; nada disso deve depender do n8n nem do transcript da plataforma |
| Respond to Webhook | Integração/Saída | n8n | Nativo do canal | Alta | Não se aplica na arquitetura alvo |
| Tabelas `mapeamentos` / `mapeamentos_pendencias` | Dado corporativo | Supabase Postgres | Manter como fonte; expor ao agente via Connector custom ou MCP server | Alta | É dado de negócio real (status de terminais) — muda a forma de acesso, não o armazenamento |
| Frontend MVP (`index.html`) | Interface | Vercel/HTML estático | Teams / M365 Copilot como canal principal; manter o MVP só como ambiente de teste isolado | Baixa | Interface web custom não é o canal alvo do projeto |

---

## 5. Dependências Microsoft (nada aqui foi verificado — precisa de confirmação do admin do tenant)

Não tenho acesso a nenhuma ferramenta ou conector Microsoft 365 conectado nesta sessão, então
os itens abaixo são **perguntas em aberto**, não fatos:

1. Licença Microsoft 365 Copilot ativa para os usuários-alvo do agente.
2. Acesso habilitado ao Copilot Studio (via entitlement do M365 Copilot ou licença standalone).
3. Permissão de criação de agentes no Copilot Studio para quem for construí-lo.
4. Permissão de publicação (Teams / canal corporativo).
5. Existência de um site/biblioteca SharePoint com documentação de processos da Getnet
   (hoje **não existe** nenhum documento no sistema atual — só dados estruturados no Postgres).
6. Permissões de Microsoft Graph, se o agente precisar ler SharePoint/arquivos.
7. Licenciamento de Power Automate (conectores premium, se necessário).
8. Suporte a MCP no tier de Copilot Studio da organização.
9. Políticas de DLP que possam restringir fontes de dados ou ferramentas.
10. Configuração de autenticação via Entra ID (app registration) para qualquer connector/MCP
    que precise falar com o Supabase.
11. Orçamento/alocação de Copilot Credits para este agente.

---

## 6. Dependências de licenciamento

- Copilot Studio é consumido por **Copilot Credits**; o volume de uso (mensagens, chamadas de
  ferramenta) tem custo — não assumir uso ilimitado (ver seção 10/riscos e `docs/COST_ESTIMATE.md`
  quando esse documento for produzido).
- Não está confirmado se o entitlement do M365 Copilot cobre o cenário de publicação desejado
  (agente customizado publicado em Teams) ou se é necessária licença Copilot Studio separada —
  isso precisa ser confirmado pelo administrador do tenant, não deve ser assumido.
- Conectores premium do Power Automate (se algum for necessário) têm licenciamento próprio.

---

## 7. Ferramentas necessárias para o agente

Mapeadas a partir do que o n8n faz hoje, todas sobre o mesmo Supabase Postgres (nenhuma
implica mover dado para fora do Supabase):

- **Tool "Consultar status de mapeamento"** — substitui o node "Buscar Contexto de
  Mapeamento", mas parametrizada (por `codigo_terminal`, `status`, `cidade`, etc.) em vez de
  trazer sempre as 50 linhas mais recentes.
- **Tool "Consultar pendências abertas"** — consulta `mapeamentos_pendencias` filtrada por
  mapeamento.
- **Tool "Ler histórico da sessão"** / **"Salvar turno da conversa"** — substituem os nodes de
  histórico e gravação; mantêm `chatbot_getnet_sessions` no Supabase como memória, acessada
  pelo agente via MCP/API em vez de nativamente pela plataforma.
- **Fonte de conhecimento documental** — hoje **não existe** nenhum documento no sistema. Se a
  Getnet tiver procedimentos, políticas ou fluxogramas de mapeamento em algum lugar, isso
  precisa ser localizado antes da Fase 3 do MVP (seção 11), e depois decidido *onde* esse
  conhecimento vai residir: SharePoint (nativo do Copilot Studio) ou Supabase Storage+pgvector
  (RAG próprio, também exposto via MCP) — ver seção 2.1 e pergunta 5/11 na seção 12.

---

## 8. Possíveis MCPs

Um único MCP server cobriria o que hoje são 6 dos 8 nodes do n8n (as duas consultas de
contexto, as duas gravações de sessão, e a leitura de histórico) — esta é a via de exposição
confirmada pelo usuário para o Supabase (MCP/API segura, nunca conexão direta do agente ao
banco):

- **Nome proposto**: `getnet-mapeamento-mcp`
- **Finalidade**: expor `mapeamentos`, `mapeamentos_pendencias` e `chatbot_getnet_sessions`
  (dado estruturado + memória de conversa) como ferramentas consultáveis pelo agente, sem
  expor a `service_role` key nem SQL bruto ao Copilot Studio.
- **Ferramentas candidatas**: `get_mapeamento(codigo_terminal)`, `list_mapeamentos(status?, cidade?)`,
  `list_pendencias_abertas(mapeamento_id)`, `get_historico_sessao(session_id)`,
  `salvar_turno_sessao(session_id, role, content)`. Se pgvector for adotado (seção 2.1):
  `buscar_conhecimento(pergunta)` sobre embeddings de documentos.
- **Autenticação**: chave de serviço fica só no servidor MCP, nunca no agente. Acesso do MCP
  ao Postgres deve respeitar policies de RLS pensadas para esse uso (não apenas bypass total
  via `service_role`), especialmente se o agente precisar de acesso escopado por usuário.
- Detalhamento completo (endpoint, parâmetros, retorno, logs, tratamento de erro) fica para
  `docs/MCP_ARCHITECTURE.md`, a ser produzido só se a Fase 2 confirmar suporte a MCP no tenant.

---

## 9. Componentes que permanecem no n8n

Análise honesta: **no escopo atual do chatbot, nenhum node depende de algo que só o n8n
consiga fazer.** Toda a lógica hoje é: ler Postgres, montar texto, chamar uma API HTTP,
gravar Postgres. Isso é exatamente o que um MCP/API sobre o Supabase substitui.

Reforçando a decisão do usuário: **o n8n não deve, em nenhum cenário, ser usado como banco de
dados ou como camada principal de memória.** O Supabase já cumpre esse papel hoje e continua
cumprindo no alvo. Isso não significa que o n8n deva ser removido do projeto Getnet como um
todo — só que, **para este chatbot especificamente**, não há hoje uma integração que exija
mantê-lo no caminho crítico, e sob nenhuma hipótese ele deve passar a guardar estado. Se no
futuro surgir uma integração com um sistema legado sem connector disponível e sem viabilidade
de expor via MCP, aí sim o n8n permanece como ferramenta (chamado pelo agente, executando uma
operação pontual e sem persistir nada por conta própria) — padrão descrito na seção 13 do
briefing original.

---

## 10. Riscos

- **Sem conhecimento documental hoje**: o sistema atual só responde com base em dados
  estruturados (status de mapeamento). Perguntas sobre "como funciona o processo X" não têm
  fonte nenhuma para responder de forma fundamentada — nem no sistema atual, nem no alvo até
  que documentos sejam localizados e indexados.
- **Contexto "despeje tudo"**: a abordagem atual de jogar as 50 linhas mais recentes no prompt
  não escala e não é comparável a uma ferramenta com busca real — precisa virar tool call
  parametrizado na migração, não só uma reimplementação 1:1.
- **Licenciamento não confirmado**: nenhuma capacidade do M365 Copilot/Copilot Studio foi
  verificada neste tenant (seção 5). Implementar antes de confirmar isso é risco de retrabalho.
- **Autorização granular ausente**: a Supabase tem RLS ligado mas sem policies — hoje qualquer
  chamada com a `service_role` key vê todos os mapeamentos. Como o Supabase passa a ser
  explicitamente a camada principal de persistência (dados + memória) exposta via MCP/API ao
  agente, isso deixa de ser um detalhe e vira pré-requisito de segurança: precisa decidir se
  todo usuário do agente deve enxergar todos os mapeamentos ou se precisa de controle por
  usuário/área, e desenhar policies de RLS reais para isso antes de expor o MCP — não apenas
  seguir usando o bypass total da `service_role`.
- **Local do conhecimento documental indefinido**: com Supabase como camada principal de
  persistência, existe agora uma segunda opção além de SharePoint para guardar documentos de
  processo (Storage+pgvector). Decidir isso tarde pode gerar retrabalho — precisa ser resolvido
  antes da Fase 3 (seção 11).
- **Sem tratamento de erro robusto**: a chamada à Anthropic no n8n não tem retry nem timeout
  customizado; o parsing da resposta só tem um fallback genérico.
- **Sem testes automatizados**: não há suíte de perguntas de referência hoje para comparar
  sistema atual vs. novo (necessária para a Fase de comparação, seção 18 do briefing).
- **Segredos**: as credenciais (Anthropic, Postgres) ainda não foram configuradas no n8n; ao
  migrar, a mesma disciplina de não commitar segredos precisa se estender às credenciais do
  Copilot Studio / Entra ID.

---

## 11. Plano de implementação (fases)

```
FASE 0 — Chatbot atual (n8n + Claude), como está hoje, sem credenciais configuradas
FASE 1 — Auditoria (este documento)
FASE 2 — Validar ambiente Microsoft: responder as perguntas da seção 5/12 com o admin do tenant
FASE 3 — MVP Copilot Studio Agent: só conhecimento (quando/se houver documentos) ou consulta
          direta aos dados de mapeamento via connector — sem remover o n8n
FASE 4 — Adicionar ferramentas (Connector ou MCP para mapeamentos/pendências)
FASE 5 — Rodar a mesma suíte de perguntas nos dois sistemas e comparar
FASE 6 — Decidir, com base em fatos, se algo realmente precisa continuar no n8n
FASE 7 — Publicação em Teams
FASE 8 — Produção, com o sistema atual mantido em paralelo até validação completa
```

Nenhuma fase remove a anterior antes de a próxima estar validada.

---

## 12. Perguntas que precisam ser respondidas antes da implementação

1. O tenant Getnet tem licença M365 Copilot ativa para os usuários-alvo deste agente?
2. Há acesso habilitado ao Copilot Studio (incluído no M365 Copilot ou licença separada)?
3. Quem tem permissão para criar e publicar agentes no Copilot Studio?
4. Existe orçamento/alocação de Copilot Credits definida para este agente?
5. Existem documentos de processo da Getnet (procedimentos, políticas, fluxogramas) em algum
   lugar hoje (SharePoint, wiki, PDFs), ou esse conhecimento documental simplesmente não
   existe ainda em formato consultável?
6. Quem será o responsável (owner) pelo agente e pelas fontes de conhecimento?
7. Qual política de DLP se aplica aos dados de mapeamento de terminais?
8. MCP é suportado na licença/tier de Copilot Studio da organização? (Decisivo: é a via de
   exposição do Supabase já definida pelo usuário — se não houver suporte a MCP no tenant,
   precisa de um caminho alternativo de API segura equivalente.)
9. Conectores premium do Power Automate estão disponíveis/licenciados, caso necessários?
10. Há app registration no Entra ID disponível (ou a criar) para autenticar o servidor
    MCP/API contra o Supabase?
11. Conhecimento documental (se existir) deve ficar em SharePoint (nativo do Copilot Studio)
    ou em Supabase Storage+pgvector (RAG próprio, exposto pelo mesmo MCP)? Dado estruturado e
    memória de conversa já estão decididos — ficam no Supabase (seção 2.1) — mas documentos
    ainda não têm uma fonte definida.
12. Que policies de RLS o Supabase precisa ganhar para o MCP acessar os dados com escopo
    correto (por usuário/área), em vez de usar a `service_role` key com bypass total como hoje?
13. Qual o volume esperado de uso (usuários, perguntas/dia) para dimensionar consumo de
    Copilot Credits antes de publicar?

---

**Próximo passo recomendado**: responder a seção 12 com quem tiver acesso ao tenant Microsoft
da Getnet (admin do M365/Copilot Studio) antes de qualquer implementação. Só depois disso faz
sentido detalhar `ARCHITECTURE_TARGET.md`, `MICROSOFT_ENVIRONMENT.md` e os demais documentos
da estrutura `/docs`.
