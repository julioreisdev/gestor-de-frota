# Deploy — Gerir Frota Demo

Instância: **`demo.gerirfrota.com`** · Banco Supabase: `yxdbaieeokfrdmpncsnk` · Entidade: Anísio de Abreu

---

## 1. Banco de dados Supabase

No painel do projeto Supabase (https://supabase.com/dashboard/project/yxdbaieeokfrdmpncsnk):

1. Abra **SQL Editor**.
2. Cole o conteúdo de [`init.sql`](init.sql) inteiro e rode. Cria schema completo, RPCs, triggers, RLS e grants.
3. Cole o conteúdo de [`dump.sql`](dump.sql) inteiro e rode. Popula lookups TCE-PI, IBGE, entidade Anísio de Abreu e usuário admin.
4. (Opcional) No **SQL Editor**, troque a senha do admin antes de mostrar a demo:
   ```sql
   update auth.users
     set encrypted_password = extensions.crypt('NOVA_SENHA', extensions.gen_salt('bf'))
     where email = 'romerito-maia@hotmail.com';
   ```

**Credenciais admin padrão** (já criadas pelo `dump.sql`):
- Usuário: `admin`
- Senha: `035AHRSw?`

---

## 2. Repositório GitHub

1. Crie um novo repo no GitHub, ex: `julioreisdev/gerirfrota-demo`.
2. Clone esta pasta para um diretório novo e ajuste o remote:
   ```bash
   git clone https://github.com/julioreisdev/gestor-de-frota.git gerirfrota-demo
   cd gerirfrota-demo
   git remote set-url origin https://github.com/julioreisdev/gerirfrota-demo.git
   ```
3. Verifique se [`js/config.js`](js/config.js) tem a URL e a chave corretas do banco demo (já estão).
4. Commit e push:
   ```bash
   git add .
   git commit -m "deploy: instância demo"
   git push -u origin main
   ```

---

## 3. GitHub Pages

1. Em `Settings → Pages` do novo repo:
   - Source: **Deploy from a branch** → `main` → `/ (root)` → **Save**
2. Aguarde 1-2 min e confira em `https://julioreisdev.github.io/gerirfrota-demo/` se carrega.

---

## 4. Custom domain `demo.gerirfrota.com`

### Cloudflare (DNS)

1. Acesse o painel da Cloudflare → domínio `gerirfrota.com` → **DNS → Records → + Add record**:
   - **Type**: `CNAME`
   - **Name**: `demo`
   - **Target**: `julioreisdev.github.io`
   - **Proxy status**: **DNS only** (nuvem cinza)
   - **TTL**: Auto

### GitHub Pages (custom domain)

1. `Settings → Pages` do repo `gerirfrota-demo`.
2. Em **Custom domain**, digite `demo.gerirfrota.com` → **Save**. O GitHub commita o arquivo `CNAME` automaticamente.
3. Aguarde 5-30 min até a checkbox **Enforce HTTPS** destravar → marque.

### Cloudflare (ligar proxy)

Quando `https://demo.gerirfrota.com` carregar OK com cert do Let's Encrypt:

1. Cloudflare → **SSL/TLS → Overview** → modo **Full (strict)**.
2. Cloudflare → **DNS → Records** → clique na nuvem cinza do CNAME `demo` pra deixar **laranja**.
3. Cloudflare → **SSL/TLS → Edge Certificates**:
   - ✅ Always Use HTTPS
   - ✅ Automatic HTTPS Rewrites

---

## 5. Validação final

```bash
dig +short demo.gerirfrota.com
curl -sI https://demo.gerirfrota.com | head -3
```

Esperado:
- DNS resolve pros IPs do GitHub (DNS only) ou Cloudflare (proxy laranja)
- HTTP/2 200 OK

No navegador:
- Abra `https://demo.gerirfrota.com` → tela de login
- Entre com `admin` / `035AHRSw?`
- Tudo carrega: Dashboard, Veículos, Autorizações, Relatórios, Exportação TCE

---

## Mapa de arquivos da instância

| Arquivo                  | Conteúdo                                                        |
|--------------------------|-----------------------------------------------------------------|
| `init.sql`               | Schema completo + RPCs + triggers + RLS + grants (idempotente)  |
| `dump.sql`               | Lookups TCE + IBGE + entidade Anísio de Abreu + admin           |
| `apply.sql`              | **Vazio** (histórico — tudo foi consolidado no `init.sql`)      |
| `js/config.js`           | `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` + nome do app       |
| `manifest.webmanifest`   | PWA: nome, ícone, identificador único da instância             |
| `logo.png`               | Logo do sistema (favicon + login + sidebar + topbar)            |

---

## Para criar outra instância (outra cidade) no futuro

1. Criar novo projeto Supabase
2. Rodar `init.sql` no novo projeto
3. Editar `dump.sql`: trocar IBGE, organ_name, brasão (URL), email/senha do admin
4. Rodar `dump.sql`
5. Clonar repo novo a partir deste, ajustar `js/config.js`, `manifest.webmanifest`
6. Push + custom domain `<cidade>.gerirfrota.com` (1 CNAME na Cloudflare)
