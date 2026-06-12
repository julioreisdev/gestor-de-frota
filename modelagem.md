# Modelagem do banco — gerirfrota

Proposta inicial de schema para o Supabase, derivada das specs oficiais do TCE-PI (`/docs`) e da lógica do `cliente.html`. Sujeita a revisão antes de qualquer migration.

## Premissas

- **Multi-tenant por instância:** cada cidade tem seu próprio projeto Supabase. **Não** modelar `tenant_id` em nenhuma tabela.
- **Auth:** usar Supabase Auth (`auth.users`). Tabela `app_user` apenas pra dados de perfil (role, período de acesso).
- **IDs:** `uuid` em tudo (`gen_random_uuid()`). Códigos TCE são `smallint`/`text` em colunas separadas.
- **Timestamps:** todas as tabelas têm `created_at timestamptz default now()` e `updated_at timestamptz default now()` (trigger `updated_at = now()` no update).
- **Soft delete:** `deleted_at timestamptz null` em tabelas com histórico (`vehicle`, `fueling`, `authorization`, `maintenance`). Listagens default `WHERE deleted_at IS NULL`.
- **Snapshots de denormalização:** algumas tabelas (`authorization`, `fueling`) salvam cópia de campos do veículo/fornecedor no momento (placa, nome do fornecedor, sigla da secretaria) — proteger relatórios históricos contra mudanças cadastrais.
- **Constraints fortes:** validações TCE viram `CHECK` constraints e `FK` para tabelas de lookup. Quanto mais o banco rejeitar dado ruim, menos a UI precisa zelar.
- **Convenção de nomes:** `snake_case` para tabelas e colunas (padrão Postgres). Enums TCE permanecem com o nome oficial (`tipo_veiculo`, `tipo_combustivel`, etc).

## Visão geral (entidades)

```
entity (1) ────────────────────────────────────┐
                                               │
ibge_municipality (lookup) ─────────────┐      │
vehicle_type (lookup) ───┐              │      │
fuel_type (lookup) ──────┤              │      │
vehicle_origin (lookup) ─┤              │      │
                         ▼              ▼      ▼
department ──────────► vehicle ◄── secretary  (ref do órgão que opera o veículo)
                          │
                          │  (ABS exige cadastro 503/443)
                          ▼
supplier ──── supplier_fuel (preços + saldos)
   │                          ▲
   ▼                          │
authorization ──► fueling ────┘
   │                ▲
   │                │
   └─► (QR Code)    └── (manual ou importada da autorização)

maintenance (vincula vehicle, supplier, optional authorization)

app_user ─── auth.users (FK)
```

## Lookups (tabelas de domínio TCE)

Populadas via seed; aplicação só faz `SELECT`.

### `ibge_municipality`
```sql
create table ibge_municipality (
  code char(7) primary key,
  name text not null unique
);
```
Seed: 224 municípios do PI (`/docs/Código do IBGE.xlsx`).

### `vehicle_type`
```sql
create table vehicle_type (
  code smallint primary key,
  description text not null,
  notes text
);
-- seed: (1,'Automóvel'), (2,'Ônibus'), (3,'Microonibus'), (4,'Caminhão'),
--       (5,'Caminhonete'), (6,'Camioneta'), (7,'Utilitário'),
--       (8,'Motocicleta'), (9,'Trator'), (99,'Outros')
```

### `fuel_type`
```sql
create table fuel_type (
  code smallint primary key,
  description text not null  -- 'GASOLINA','ALCOOL','ELETRICIDADE','DIESEL',
                              -- 'FLEX (ALCOOL/GASOLINA)','GAS NATURAL VEICULAR',
                              -- 'HIBRIDO (ELETRICIDADE/GASOLINA/ALCOOL)'
);
-- seed: códigos 1..7 conforme /docs/Tipo de Combustível.xlsx
```

### `vehicle_origin`
```sql
create table vehicle_origin (
  code smallint primary key,
  description text not null  -- 'Próprio','Cedido','Locado','Sublocado','Outras origens'
);
-- seed: (1,'Próprio'),(2,'Cedido'),(3,'Locado'),(4,'Sublocado'),(9,'Outras origens')
```

## Entidade (config institucional)

Tabela com **exatamente 1 linha**. Setada na criação do projeto pelo desenvolvedor; usuários só leem. Não exposto na UI de gestão.

```sql
create table entity (
  id smallint primary key default 1 check (id = 1),
  entity_type text not null,           -- 'Prefeitura Municipal','Câmara Municipal','Fundo...','Autarquia'...
  ibge_code char(7) not null references ibge_municipality(code),
  organ_name text not null,            -- 'Prefeitura Municipal de São Raimundo Nonato'
  coat_of_arms_url text,               -- brasão (Storage)
  default_ref_month char(7),           -- 'AAAA-MM' para exportações
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Usuários

Perfis e período de acesso. `auth.users` (do Supabase Auth) cuida de email/senha/sessão.

```sql
create type user_role as enum ('admin','usuario','fornecedor');

create table app_user (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null,
  -- período de acesso opcional (NULL = sem restrição)
  access_start date,
  access_end date,
  -- vínculo opcional: fornecedor logado só vê autorizações desse supplier
  supplier_id uuid references supplier(id) on delete set null,
  -- limite mensal de R$ em autorizações que esse usuário pode emitir (0 = sem limite)
  monthly_authorization_limit numeric(12,2) not null default 0 check (monthly_authorization_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_access_period check (access_end is null or access_start is null or access_end >= access_start),
  constraint chk_supplier_only_for_supplier_role check (
    (role = 'fornecedor' and supplier_id is not null)
    or (role <> 'fornecedor' and supplier_id is null)
  )
);
```

**Observação:** o vínculo `supplier_id` no perfil "fornecedor" é hipótese minha pra que o frentista só veja as autorizações dirigidas ao posto dele. Confirmar.

## Secretarias / Órgãos

```sql
create table department (
  id uuid primary key default gen_random_uuid(),
  name text not null,                    -- 'Secretaria Municipal de Saúde'
  acronym text not null unique,          -- 'SMS'
  cost_center text,                      -- '02.001'
  responsible_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## Veículos

Tabela "fonte da verdade" para TCE — todos os campos dos layouts 503/443 estão aqui. Os campos específicos de cessão/locação ficam nullable e validados por `CHECK`.

```sql
create table vehicle (
  id uuid primary key default gen_random_uuid(),

  -- código interno (humano, mas único)
  internal_code text unique,

  -- identificação obrigatória (TCE)
  plate text not null,                       -- 'ABC1234' ou 'ABC1D23' (Mercosul); guardar sem hífen
  renavam char(11) not null,                 -- '00012345678'
  chassis text,
  model text not null,                       -- usado em CSVs (3-300 chars)
  brand text,
  year_manufacture smallint not null,        -- anoFabricacao
  year_model smallint not null,              -- anoModelo

  -- tipologia TCE
  vehicle_type_code smallint not null references vehicle_type(code),
  fuel_type_code smallint not null references fuel_type(code),
  vehicle_origin_code smallint not null references vehicle_origin(code),

  -- operacional
  department_id uuid references department(id),
  tank_capacity numeric(5,2) check (tank_capacity is null or (tank_capacity > 0 and tank_capacity < 1000)),
  current_km integer not null default 0 check (current_km >= 0 and current_km <= 99999999),
  conservation_state text,                   -- 'Ótimo','Bom','Regular','Ruim','Inativo' (livre, mas UI usa enum)
  acquisition_date date,
  notes text,

  -- só cedido (origin = 2)
  cession_destination_organ text,
  cession_start_date date,
  cession_end_date date,

  -- só locado/sublocado (origin in (3,4))
  lessor_doc text,                            -- 11 ou 14 dígitos numéricos
  lessor_name text,
  monthly_value numeric(15,2),
  has_driver boolean,
  cw_contract_code text,                      -- 'CW-XXXXXX/XX'
  -- datas do contrato de locação (uso interno; TCE 443 não exige, mas filtros usam)
  lessor_lease_start_date date,
  lessor_lease_end_date date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Validações TCE
  constraint chk_years_consistent check (year_manufacture <= year_model),
  constraint chk_year_mfg_max check (year_manufacture <= extract(year from current_date)::int),
  constraint chk_year_mdl_max check (year_model <= extract(year from current_date)::int + 1),
  constraint chk_plate_format check (plate ~ '^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$'),
  constraint chk_renavam_digits check (renavam ~ '^[0-9]{11}$'),

  -- regra OUTROS (517 §1.1.8 e §1.1.9)
  constraint chk_outros_consistency check (
    (vehicle_type_code = 99 and renavam = '99999999999' and plate ~ '^XYZ')
    or (vehicle_type_code <> 99 and renavam <> '99999999999' and plate !~ '^XYZ9999$')
  ),

  -- regra Cedido (503 §1.1.5)
  constraint chk_cession_dates check (
    vehicle_origin_code <> 2
    or cession_end_date is null
    or cession_start_date is null
    or cession_end_date >= cession_start_date
  ),
  -- se cedido, exige org destino e data início
  constraint chk_cession_required_fields check (
    vehicle_origin_code <> 2
    or (cession_destination_organ is not null and cession_start_date is not null)
  ),

  -- se locado/sublocado, exige dados do contrato (443)
  constraint chk_lease_required_fields check (
    vehicle_origin_code not in (3,4)
    or (
      lessor_doc ~ '^([0-9]{11}|[0-9]{14})$'
      and lessor_name is not null
      and monthly_value > 0
      and has_driver is not null
      and cw_contract_code ~ '^CW-[0-9]{6}/[0-9]{2}$'
    )
  )
);

create index ix_vehicle_plate on vehicle (plate);
create index ix_vehicle_origin on vehicle (vehicle_origin_code) where deleted_at is null;
create index ix_vehicle_department on vehicle (department_id) where deleted_at is null;
```

**Observação:** `plate` armazenada sem hífen, normalizada. Formatação visual fica na UI.

## Fornecedores (postos e mecânicas)

```sql
create type supplier_kind as enum ('posto','mecanica','ambos');

create table supplier (
  id uuid primary key default gen_random_uuid(),
  kind supplier_kind not null default 'posto',
  legal_name text not null,                   -- razão social
  trade_name text,                            -- fantasia
  cnpj char(14) not null check (cnpj ~ '^[0-9]{14}$'),
  responsible_name text,
  phone text,
  address text,
  city text,
  ibge_code char(7) references ibge_municipality(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cnpj)
);
```

### Contrato por combustível (saldo)

Um fornecedor pode vender múltiplos combustíveis, cada um com seu preço e saldo de contrato.

```sql
create table supplier_fuel (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references supplier(id) on delete cascade,
  fuel_type_code smallint not null references fuel_type(code),
  unit_price numeric(8,3) not null check (unit_price >= 0),  -- R$/L
  contract_amount numeric(12,2) not null default 0 check (contract_amount >= 0),  -- 0 = ilimitado
  current_balance numeric(12,2) not null default 0 check (current_balance >= 0),
  unique (supplier_id, fuel_type_code),
  constraint chk_balance_within_contract check (
    contract_amount = 0 or current_balance <= contract_amount
  )
);
```

**Operações de saldo** (em transação, server-side via RPC do Supabase):
- Emitir autorização → `current_balance -= qty` (se `contract_amount > 0`).
- Cancelar autorização → `current_balance = LEAST(contract_amount, current_balance + qty)`.
- Editar qtd → ajusta pelo delta.

## Autorizações de abastecimento

```sql
create type authorization_status as enum ('emitida','utilizada','cancelada');

create table fueling_authorization (
  id uuid primary key default gen_random_uuid(),

  -- numero humano: 'AAAAMMDD-NNN' (sequencial diário)
  number text not null unique,
  date date not null,
  status authorization_status not null default 'emitida',

  vehicle_id uuid not null references vehicle(id),
  supplier_id uuid not null references supplier(id),
  fuel_type_code smallint not null references fuel_type(code),

  authorized_quantity numeric(8,2) not null check (authorized_quantity > 0),
  unit_price_snapshot numeric(8,3) not null,                 -- preço no momento da emissão
  estimated_total numeric(12,2) generated always as (authorized_quantity * unit_price_snapshot) stored,

  responsible_name text not null,
  notes text,

  -- snapshots para histórico independente
  vehicle_plate_snapshot text not null,
  vehicle_model_snapshot text not null,
  department_acronym_snapshot text,
  supplier_trade_name_snapshot text not null,

  qr_payload text not null,                                   -- texto codificado no QR

  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index ix_auth_date on fueling_authorization (date);
create index ix_auth_status on fueling_authorization (status) where deleted_at is null;
create index ix_auth_vehicle on fueling_authorization (vehicle_id);
create index ix_auth_supplier on fueling_authorization (supplier_id);
```

**Numeração:** gerada por `RPC` que faz `SELECT count(*) WHERE number LIKE 'AAAAMMDD%'` + 1 dentro de transação.

## Abastecimentos (registros de consumo)

```sql
create table fueling (
  id uuid primary key default gen_random_uuid(),

  -- vínculo opcional com autorização
  authorization_id uuid references fueling_authorization(id),

  vehicle_id uuid not null references vehicle(id),
  supplier_id uuid not null references supplier(id),
  fuel_type_code smallint not null references fuel_type(code),

  date date not null,
  quantity numeric(8,2) not null check (quantity > 0),
  unit_price numeric(8,3) not null check (unit_price >= 0),
  total numeric(12,2) generated always as (quantity * unit_price) stored,

  km_initial integer check (km_initial is null or (km_initial >= 0 and km_initial <= 99999999)),
  km_final integer check (km_final is null or (km_final >= 0 and km_final <= 99999999)),

  responsible_name text not null,
  notes text,

  -- snapshots
  vehicle_plate_snapshot text not null,
  department_acronym_snapshot text,
  supplier_trade_name_snapshot text not null,

  created_by uuid references app_user(id),
  filled_by_supplier_at timestamptz,   -- quando o frentista preencheu via QR
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint chk_km_order check (km_initial is null or km_final is null or km_initial <= km_final)
);

create index ix_fueling_date on fueling (date);
create index ix_fueling_vehicle on fueling (vehicle_id);
create index ix_fueling_supplier on fueling (supplier_id);
create index ix_fueling_auth on fueling (authorization_id);
```

**Regra extra (trigger sugerido):** se `authorization_id IS NOT NULL`, então `quantity <= fueling_authorization.authorized_quantity` e o veículo/combustível/supplier devem bater. Implementar via `BEFORE INSERT/UPDATE TRIGGER`.

**Trigger para atualizar `vehicle.current_km`:** após insert de `fueling` com `km_final NOT NULL`, atualizar `vehicle.current_km = GREATEST(current_km, km_final)`.

## Manutenções (opcional, fase posterior)

Esboço — o cliente não modelou. Manter simples até definição.

```sql
create type maintenance_kind as enum ('preventiva','corretiva','revisao','sinistro','outros');
create type maintenance_status as enum ('aberta','em_andamento','concluida','cancelada');

create table maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicle(id),
  supplier_id uuid references supplier(id),   -- mecânica
  authorization_id uuid references fueling_authorization(id),  -- se for o caso (autorização genérica futura)
  kind maintenance_kind not null,
  status maintenance_status not null default 'aberta',
  open_date date not null default current_date,
  close_date date,
  km_at_service integer check (km_at_service is null or km_at_service >= 0),
  description text not null,
  total_value numeric(12,2),
  responsible_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chk_close_after_open check (close_date is null or close_date >= open_date)
);
```

## RLS (Row Level Security)

Como cada cidade tem um banco isolado, RLS não isola tenants — isola **perfis**.

Política geral:
- `admin`: full access em tudo.
- `usuario`: `select/insert/update` em `vehicle`, `department`, `supplier`, `supplier_fuel`, `fueling_authorization`, `fueling`, `maintenance`. **Não** mexe em `entity` nem `app_user`.
- `fornecedor`: `select` em `fueling_authorization WHERE supplier_id = (select supplier_id from app_user where id = auth.uid())`. `insert/update` em `fueling` apenas para autorizações dele.

Exemplo:
```sql
alter table fueling_authorization enable row level security;

create policy auth_admin_all on fueling_authorization
  for all using (
    (select role from app_user where id = auth.uid()) = 'admin'
  );

create policy auth_usuario_all on fueling_authorization
  for all using (
    (select role from app_user where id = auth.uid()) = 'usuario'
  );

create policy auth_fornecedor_read_own on fueling_authorization
  for select using (
    exists (
      select 1 from app_user u
      where u.id = auth.uid()
        and u.role = 'fornecedor'
        and u.supplier_id = fueling_authorization.supplier_id
    )
  );
```

## Views para os relatórios TCE

Materializar não, view normal serve.

### `v_tce_517_abastecimento`
Consolidação por (veículo, combustível, mês_referência):

```sql
create view v_tce_517_abastecimento as
select
  v.model as "modelo",
  v.plate as "placa",
  v.renavam,
  v.year_manufacture as "anoFabricacao",
  v.year_model as "anoModelo",
  v.vehicle_type_code as "tipoVeiculo",
  v.vehicle_origin_code as "origemVeiculo",
  d.name as "orgaoLocalizacao",
  v.tank_capacity as "capacidade",
  sum(f.quantity)::numeric(10,2) as "quantidadeAbastecimento",
  f.fuel_type_code as "tipoCombustivel",
  min(f.km_initial) as "kmInicial",
  max(f.km_final) as "kmFinal",
  to_char(f.date,'YYYY-MM') as ref_month
from fueling f
join vehicle v on v.id = f.vehicle_id
left join department d on d.id = v.department_id
where f.deleted_at is null
group by v.id, d.name, f.fuel_type_code, to_char(f.date,'YYYY-MM');
```

### `v_tce_503_proprios_cedidos`
```sql
create view v_tce_503_proprios_cedidos as
select
  v.model as "modelo", v.plate as "placa", v.renavam,
  v.year_manufacture as "anoFabricacao", v.year_model as "anoModelo",
  v.fuel_type_code as "tipoCombustivel",
  v.conservation_state as "estadoConservacao",
  e.ibge_code as "localizacao",
  case when v.vehicle_origin_code = 2 then 1 else 0 end as "veiculoCedido",
  v.cession_destination_organ as "orgaoDestVeicCedido",
  v.cession_start_date as "dataInicCessao",
  v.cession_end_date as "dataFimCessao"
from vehicle v
cross join entity e
where v.deleted_at is null and v.vehicle_origin_code in (1,2);
```

### `v_tce_443_locados`
```sql
create view v_tce_443_locados as
select
  v.model as "modelo", v.plate as "placa", v.renavam,
  v.year_manufacture as "anoFabricacao", v.year_model as "anoModelo",
  v.fuel_type_code as "tipoCombustivel",
  v.lessor_doc as "cpfOuCnpj",
  v.lessor_name as "nomeLocador",
  e.ibge_code as "localizacao",
  v.monthly_value as "valorUnitMensal",
  case when v.has_driver then 1 else 0 end as "possuiMotorista",
  v.cw_contract_code as "codigoCw"
from vehicle v
cross join entity e
where v.deleted_at is null and v.vehicle_origin_code in (3,4);
```

## Pendências / decisões abertas

1. **Granularidade do 517:** consolidação por mês (uma linha por veículo+combustível) é o que os exemplos mostram, mas confirmar com o cliente se TCE aceita uma linha por evento.
2. **Validação cruzada do 517 (regras 1.1.6 e 1.1.7):** veículo abastecido com origem 1/2 precisa estar no 503; com origem 3/4 precisa estar no 443. Como tudo está na mesma tabela `vehicle` aqui, basta exigir que o veículo exista — já garantido por FK.
3. **Caso "OUTROS" (tipo 99):** o constraint cobre, mas a UI precisa de fluxo separado pra cadastro de máquina/equipamento sem placa real. Decidir se vira módulo próprio ou flag no cadastro de veículo.
4. **Mecânicas:** modelei `supplier.kind = 'mecanica'` reaproveitando a tabela. Se manutenções forem priorizadas, pode justificar tabela separada.
5. **Fornecedor logado:** confirmar se um login de fornecedor é vinculado a UM `supplier` (modelei assim) ou se pode ver tudo.
6. **Centro de custo da secretaria:** não é exigido pelo TCE; mantive porque o cliente quis.
7. **Mês de referência das exportações:** entidade tem `default_ref_month` mas a UI provavelmente quer permitir escolher período. Combinar.
8. **Auditoria:** não modelei tabela `audit_log`. Se for exigido (provavelmente é, é setor público), considerar `pg_audit` ou tabela própria com triggers.
9. **Storage:** brasão, fotos de veículos, comprovantes de abastecimento — usar Supabase Storage com buckets `public-assets` e `documents` (privado).
10. **Seed:** scripts SQL pra popular `ibge_municipality`, `vehicle_type`, `fuel_type`, `vehicle_origin` ficam em `/supabase/seeds/` quando começarmos.
