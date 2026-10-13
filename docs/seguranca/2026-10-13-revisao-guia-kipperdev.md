# Revisão de segurança — guia KipperDev (12 riscos)

Data: 13/10/2026 · Base: "Vibe coding com segurança" (KipperDev, set/2026) e a
regra do Semgrep (`npm run security:scan`). Stack: painel Vite + React na
Vercel (só arquivos estáticos, sem servidor próprio), Supabase (Auth, Postgres
com RLS, 2 RPCs) e a extensão Chrome (MV3).

Fronteira importante: o painel não tem backend. Tudo que o guia chama de
"servidor" aqui é o **Postgres do Supabase** (RLS, privilégios, triggers e
constraints). A chave anon está no bundle por desenho; a segurança não pode
depender dela.

## Resultado por risco

| # | Risco | Evidência (arquivo:linha / comando) | Situação | Correção / teste |
|---|-------|--------------------------------------|----------|------------------|
| 01 | Segredos no frontend | `src/services/supabaseClient.js:6` só a chave **publishable**; `grep service_role/eyJ…` em `src`, `extension`, `public`, histórico git e bundle `dist/`: nada; `.env` fora do git (`.gitignore`); sem sourcemaps em `dist/` | OK | Sem ação. A única chave no navegador é pública por natureza (RLS protege). |
| 02 | Entradas sem validação | Constraints `check` em todas as colunas (`supabase/migrations/002:327-381`): tamanhos, `status`/`plan` em lista fixa, URLs só `http(s)`, miniaturas só `data:image/`; `UPDATE` só nas colunas editáveis (`003:34-41`); `plan/active/trial_ends_at` bloqueados por trigger (`002:55-80`) | OK | Sem ação. Campo extra é recusado pelo PostgREST; valor fora da regra dá erro 23514. |
| 03 | SQL injection | Nenhum SQL montado por texto no painel (`grep .rpc/.from` em `src/services/api.js`); as RPCs usam parâmetros (`get_share_by_token`, `002:229`); o único `execute format` é em DDL com `%I` (`002:378`) | OK | Sem ação. |
| 04 | Prompt injection | Único ponto em que texto de terceiros vira prompt: roteiro transcrito (`extension/transcricao-regras.js:161`) já instrui a IA a tratar a transcrição só como referência; o produto não chama nenhum modelo | OK (risco residual: depende da IA que o cliente usar) | Sem ação. |
| 05 | XSS | Painel: React escapa tudo; todo `href`/`src` passa por `safeHttpUrl`/`safeImageSrc` (`src/utils/url.js`, usado em OfferCard, OfferPage, RadarPage, ModelarPage). Extensão: cada `innerHTML` com dado do anúncio usa `escapeHtml` (`extension/content.js:1784-1810`, `2068`). CSP do painel: `script-src 'self'` (`vercel.json`). **Achado:** `extension/autorizar.js:89` concatenava `e.message` em HTML | Corrigido | Mensagem agora vira nó de texto (`mostrarNos`). Risco era baixo (texto vinha do Chrome, não de usuário). |
| 06 | IDOR / BOLA | RLS ligada nas 4 tabelas (consulta `pg_class.relrowsecurity` = true); todas as policies filtram por `(select auth.uid())` (`003:64-146`); `anon` sem nenhum privilégio de tabela. **Teste real no banco**: sessão simulada de uma conta inexistente enxergou 0 ofertas, 0 abas, 0 shares, 0 perfis | OK | Não executei o teste de escrita cruzada (o cliente de banco recusou rodar UPDATE/DELETE mesmo dentro de ROLLBACK); a negação está nas policies `with check`/`using` de `003`. |
| 07 | SSRF | Não há servidor que faça requisições. A extensão busca só `facebook.com` (rastreio/radar) e, no Modelar Página, a URL que o próprio usuário pediu, só `http(s)` (`extension/background.js:931`), no navegador dele | Não se aplica | Sem ação. |
| 08 | Senhas em texto puro | Supabase Auth guarda as senhas (bcrypt); `quick_reset_password` removida (`002:20-31`); regras de senha forte na tela de cadastro (`AuthPage.jsx:139`); mensagens neutras no "esqueci a senha" (`api.js:366-384`) | OK + pendência de painel | **Ligar "Leaked password protection"** no painel do Supabase (aviso do linter). |
| 09 | Abuso de requisições / DoS | Auth tem limite de tentativas nativo do Supabase. **Achado:** a API de dados não tinha teto por conta: um token válido podia inserir ofertas sem fim e lotar o plano gratuito | Corrigido | Migração **004** (aplicada): até 5000 ofertas, 50 abas e 100 links por conta (trigger com lock), validade do link entre 1 e 90 dias. Verificado: 3 triggers + constraint existem; a função não é chamável pela API. DDoS volumétrico fica com a Vercel/Supabase (borda). |
| 10 | Enumeração e rotas admin | Não há rota administrativa nem de debug no painel (`src/router.js`); administração só pelo painel do Supabase (login da Supabase). Funções expostas à API: só `get_share_by_token` (anon, de propósito: link público) e `has_active_plan` (responde só sobre o próprio usuário) | OK | Sem ação. Os dois avisos do linter sobre SECURITY DEFINER são intencionais. |
| 11 | Bots em login e cadastro | Supabase Auth suporta CAPTCHA (Turnstile/hCaptcha) e limites por IP, mas é configuração do painel, não do código | Pendência de painel | Ligar **Confirm email** (já apontado em 27/09) e, se aparecer cadastro em massa, **Bot and Abuse Protection** (Turnstile) em Authentication → Settings. |
| 12 | Mensagens de erro que vazam dados | `src/utils/errors.js`: todo erro vira frase em português por código (`toUserError`); o erro técnico vai só para o console; login não distingue "e-mail não existe" de "senha errada" (`api.js:263`) | OK | Sem ação. |

Extra — dependências: `npm audit` (produção) = 0 vulnerabilidades.
Desenvolvimento: `source-map-js` corrigido com `npm audit fix`; `esbuild`/`vite 5`
(aviso só do servidor de desenvolvimento local, não vai para o site) fica
para quando o Vite for atualizado para a versão 8 (mudança grande).

## Comandos executados

- `npm run security:scan` → 251 regras, 111 arquivos, **0 achados**.
- `npm test` → 188 testes, 0 falhas.
- `npm audit --omit=dev` → 0 vulnerabilidades. `npm audit fix` → sobrou só esbuild/vite (dev).
- Supabase (leitura): RLS por tabela, policies, privilégios de `anon`/`authenticated`, funções expostas, linter de segurança, teste de sessão simulada (0 linhas de outra conta), triggers da migração 004.

## Bloqueadores de publicação

Nenhum.

## Melhorias feitas nesta revisão

1. Migração 004 — limites por conta (DoS/custo). Aplicada no banco e versionada.
2. `extension/autorizar.js` — mensagem de erro como texto (extensão 1.30.2).
3. `package-lock.json` — `source-map-js` atualizado.

## Dependências externas (o dono faz no painel do Supabase)

Authentication → Settings:
1. **Confirm email**: ligado (sem isso qualquer e-mail cadastra sem posse).
2. **Leaked password protection**: ligado (bloqueia senha que já vazou).
3. **Bot and Abuse Protection** (Turnstile): opcional; ligar se houver cadastro em massa.

## Não testado / risco residual

- Escrita cruzada entre contas (UPDATE/DELETE) não foi executada no banco real; está coberta pelas policies e pelos privilégios de coluna.
- Proteção DDoS volumétrica depende da Vercel e do Supabase.
- O fluxo de sessão usa `flowType: 'implicit'` (token no `#hash` do link de e-mail). Trocar para PKCE exige que o link seja aberto no mesmo navegador que pediu; fica como decisão futura.
