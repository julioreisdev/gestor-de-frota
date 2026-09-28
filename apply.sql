-- =============================================================================
-- apply.sql — delta (rodar no banco JÁ EXISTENTE)
-- =============================================================================
-- Extensão da regra "usuario só vê o que é da sua secretaria":
--   - supplier            → filtra por supplier.department_id
--   - supplier_fuel       → filtra pelo supplier dono
--   - fueling_authorization → filtra pelo veículo (vehicle.department_id)
--   - service_authorization → idem
--   (vehicle, fueling e maintenance já estavam filtrados em rodadas anteriores)
--
-- Critério: admin vê tudo. Usuario sem department_id → vê tudo (legado).
-- Usuario com department_id → vê só registros da sua secretaria + registros
-- sem secretaria atribuída (caso de cadastros legados).
--
-- Idempotente.
-- =============================================================================

-- SUPPLIER
drop policy if exists p_supplier_read_internal on supplier;
create policy p_supplier_read_internal on supplier for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'usuario'
        and (current_user_department_id() is null
             or department_id is null
             or department_id = current_user_department_id()))
  );

-- SUPPLIER_FUEL (resolve via supplier dono)
drop policy if exists p_supfuel_read_internal on supplier_fuel;
create policy p_supfuel_read_internal on supplier_fuel for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'usuario'
        and (current_user_department_id() is null
             or exists (
               select 1 from supplier s
                where s.id = supplier_fuel.supplier_id
                  and (s.department_id is null
                       or s.department_id = current_user_department_id())
             )))
  );

-- FUELING_AUTHORIZATION — filtra pelo veículo da secretaria
drop policy if exists p_auth_read_internal on fueling_authorization;
create policy p_auth_read_internal on fueling_authorization for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'usuario'
        and (current_user_department_id() is null
             or exists (
               select 1 from vehicle v
                where v.id = fueling_authorization.vehicle_id
                  and (v.department_id is null
                       or v.department_id = current_user_department_id())
             )))
  );

-- SERVICE_AUTHORIZATION — filtra pelo veículo da secretaria
drop policy if exists p_servauth_read_internal on service_authorization;
create policy p_servauth_read_internal on service_authorization for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'usuario'
        and (current_user_department_id() is null
             or exists (
               select 1 from vehicle v
                where v.id = service_authorization.vehicle_id
                  and (v.department_id is null
                       or v.department_id = current_user_department_id())
             )))
  );

-- =============================================================================
-- ENTITY: flag "usar logo da instância nos relatórios" (default true).
-- Quando false, os PDFs usam a logo do Gerir Frota em vez do brasão da entidade.
-- =============================================================================
alter table entity
  add column if not exists use_logo_in_reports boolean not null default true;

-- =============================================================================
-- NUMERAÇÃO DE AUTORIZAÇÃO: max(sufixo)+1 em vez de count(*)+1.
-- Bug: ao EXCLUIR uma autorização do dia, o count caía e o próximo número
-- colidia com um existente ("duplicate key ... fueling_authorization_number_key").
-- Lock transacional por dia evita corrida entre emissões simultâneas.
-- =============================================================================
create or replace function generate_authorization_number(p_date date) returns text
language plpgsql as $$
declare ds text; n int;
begin
  ds := to_char(p_date,'YYYYMMDD');
  perform pg_advisory_xact_lock(hashtext('fueling_auth_' || ds));
  select coalesce(max(split_part(number,'-',2)::int), 0) + 1 into n
    from fueling_authorization
   where number ~ ('^' || ds || '-[0-9]+$');
  return ds || '-' || lpad(n::text, greatest(3, length(n::text)), '0');
end;
$$;

create or replace function generate_service_authorization_number(p_date date) returns text
language plpgsql as $$
declare ds text; n int;
begin
  ds := to_char(p_date,'YYYYMMDD');
  perform pg_advisory_xact_lock(hashtext('service_auth_' || ds));
  select coalesce(max(split_part(number,'-',3)::int), 0) + 1 into n
    from service_authorization
   where number ~ ('^' || ds || '-MAN-[0-9]+$');
  return ds || '-MAN-' || lpad(n::text, greatest(3, length(n::text)), '0');
end;
$$;

-- =============================================================================
-- 14) FATURAMENTO — Parte 1: base
--   a) Secretaria: CNPJ e cargo do responsável (saem na OF e no Termo)
--   b) Contrato (fornecedor): tipo de preço e fiscal do contrato
--   c) Entidade: data de início do faturamento
--   d) O mesmo posto pode ter mais de um contrato na mesma secretaria
--   e) Login do posto enxerga todos os contratos do seu CNPJ
-- Idempotente.
-- =============================================================================

-- a) Secretaria
alter table department add column if not exists cnpj char(14);
alter table department add column if not exists responsible_role text;
alter table department drop constraint if exists chk_department_cnpj;
alter table department add constraint chk_department_cnpj
  check (cnpj is null or cnpj ~ '^[0-9]{14}$');

-- b) Contrato. Na criação da coluna, contrato com todos os preços zerados é
--    marcado como desconto sobre bomba (preço só é conhecido na nota). Roda uma
--    vez só: reaplicar o script não desfaz escolha feita pelo administrador.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'supplier' and column_name = 'price_type'
  ) then
    alter table supplier add column price_type text not null default 'fixo';
    update supplier s set price_type = 'desconto_bomba'
     where exists (select 1 from supplier_fuel f where f.supplier_id = s.id)
       and not exists (select 1 from supplier_fuel f where f.supplier_id = s.id and f.unit_price > 0);
  end if;
end $$;
alter table supplier drop constraint if exists chk_supplier_price_type;
alter table supplier add constraint chk_supplier_price_type
  check (price_type in ('fixo','desconto_bomba'));
alter table supplier add column if not exists fiscal_name text;
alter table supplier add column if not exists fiscal_registration text;
alter table supplier add column if not exists fiscal_ordinance text;

-- c) Entidade
alter table entity add column if not exists billing_start_date date;

-- d) Unicidade passa a incluir o nº do contrato (renovação de contrato com o
--    mesmo posto vira um cadastro novo, sem sobrescrever o anterior).
alter table supplier drop constraint if exists supplier_cnpj_key;
alter table supplier drop constraint if exists supplier_cnpj_unique;
drop index if exists supplier_cnpj_key;
drop index if exists ux_supplier_cnpj_dept;
create unique index if not exists ux_supplier_cnpj_dept_contract
  on supplier (cnpj, department_id, coalesce(contract_number, ''));

-- e) Posto por CNPJ: o usuário fornecedor é ligado a UM cadastro, mas o mesmo
--    posto tem um cadastro por contrato. Devolve todos os cadastros do CNPJ.
create or replace function current_user_supplier_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s2.id
    from app_user u
    join supplier s1 on s1.id = u.supplier_id
    join supplier s2 on s2.cnpj = s1.cnpj
   where u.id = auth.uid()
$$;
revoke all on function current_user_supplier_ids() from public;
grant execute on function current_user_supplier_ids() to authenticated;

drop policy if exists p_supplier_read_self on supplier;
create policy p_supplier_read_self on supplier for select
  using (current_user_role() = 'fornecedor' and id in (select current_user_supplier_ids()));

drop policy if exists p_supfuel_read_self on supplier_fuel;
create policy p_supfuel_read_self on supplier_fuel for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_auth_read_self on fueling_authorization;
create policy p_auth_read_self on fueling_authorization for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_servauth_read_self on service_authorization;
create policy p_servauth_read_self on service_authorization for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_fueling_read_self on fueling;
create policy p_fueling_read_self on fueling for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_fueling_supplier_ins on fueling;
create policy p_fueling_supplier_ins on fueling for insert
  with check (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_fueling_supplier_upd on fueling;
create policy p_fueling_supplier_upd on fueling for update
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_maint_read_self on maintenance;
create policy p_maint_read_self on maintenance for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_maint_supplier_ins on maintenance;
create policy p_maint_supplier_ins on maintenance for insert
  with check (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_maint_supplier_upd on maintenance;
create policy p_maint_supplier_upd on maintenance for update
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

-- =============================================================================
-- 15) FATURAMENTO — Parte 2: Ordem de Fornecimento (OF)
--   A OF consolida os abastecimentos de UM contrato (cadastro de fornecedor)
--   em um período. Só tem quantidades. Numeração NNN/AAAA por secretaria e
--   exercício. Depois de emitida, os abastecimentos ficam travados.
--   Toda escrita passa pelas funções abaixo (tabelas só têm política de leitura).
-- Idempotente.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'supply_order_status') then
    create type supply_order_status as enum ('emitida','faturada','cancelada');
  end if;
end $$;

create table if not exists supply_order (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references department(id),
  supplier_id   uuid not null references supplier(id),      -- = contrato
  year smallint not null,                                   -- exercício da numeração
  seq  integer  not null,                                   -- sequencial na secretaria/exercício
  number text not null,                                     -- '008/2026'
  reference_month char(7) not null,                         -- competência 'MM/AAAA'
  period_start date not null,
  period_end   date not null,
  issue_date   date not null default current_date,
  selection_mode text not null check (selection_mode in ('contrato','veiculos')),
  commitment_number text,                                   -- empenho (opcional na OF)
  commitment_set_by uuid references app_user(id),
  commitment_set_at timestamptz,
  status supply_order_status not null default 'emitida',
  total_fuelings integer not null check (total_fuelings > 0),
  total_liters numeric(12,2) not null check (total_liters > 0),
  -- cópia congelada do cabeçalho: editar cadastro depois não muda o documento
  department_name_snapshot text not null,
  department_acronym_snapshot text not null,
  department_cnpj_snapshot text,
  responsible_name_snapshot text,
  responsible_role_snapshot text,
  supplier_name_snapshot text not null,
  supplier_cnpj_snapshot text not null,
  contract_number_snapshot text,
  cancel_reason text,
  canceled_by uuid references app_user(id),
  canceled_at timestamptz,
  created_by uuid references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_supply_order_seq unique (department_id, year, seq),
  constraint chk_so_period check (period_end >= period_start),
  constraint chk_so_cancel check (status <> 'cancelada' or cancel_reason is not null)
);
drop trigger if exists trg_supply_order_set_updated_at on supply_order;
create trigger trg_supply_order_set_updated_at before update on supply_order
  for each row execute function set_updated_at();
create index if not exists ix_supply_order_supplier on supply_order (supplier_id);
create index if not exists ix_supply_order_department on supply_order (department_id, year);

create table if not exists supply_order_item (               -- um por combustível (tipo + subtipo)
  id uuid primary key default gen_random_uuid(),
  supply_order_id uuid not null references supply_order(id) on delete cascade,
  fuel_type_code smallint not null references fuel_type(code),
  fuel_subtype_id smallint references fuel_subtype(id),
  fuel_label text not null,                                 -- 'DIESEL S10'
  fuelings_count integer not null,
  liters numeric(12,2) not null
);
create index if not exists ix_supply_order_item_order on supply_order_item (supply_order_id);

-- Histórico: quais abastecimentos a OF levou. Fica mesmo depois de cancelada.
create table if not exists supply_order_fueling (
  supply_order_id uuid not null references supply_order(id),
  fueling_id uuid not null references fueling(id),
  primary key (supply_order_id, fueling_id)
);
create index if not exists ix_supply_order_fueling_fueling on supply_order_fueling (fueling_id);

-- Vínculo ativo do abastecimento com a OF
alter table fueling add column if not exists supply_order_id uuid references supply_order(id);
create index if not exists ix_fueling_supply_order on fueling (supply_order_id);
create index if not exists ix_fueling_pending on fueling (supplier_id, date)
  where supply_order_id is null and deleted_at is null;

grant select on supply_order, supply_order_item, supply_order_fueling to authenticated;

-- ----------------------------------------------------------------------------
-- Leitura (RLS). Sem política de escrita: só as funções gravam.
-- ----------------------------------------------------------------------------
alter table supply_order         enable row level security;
alter table supply_order_item    enable row level security;
alter table supply_order_fueling enable row level security;

drop policy if exists p_so_read_internal on supply_order;
create policy p_so_read_internal on supply_order for select
  using (
    current_user_role() = 'admin'
    or (current_user_role() = 'usuario'
        and (current_user_department_id() is null
             or department_id = current_user_department_id()))
  );
drop policy if exists p_so_read_self on supply_order;
create policy p_so_read_self on supply_order for select
  using (current_user_role() = 'fornecedor' and supplier_id in (select current_user_supplier_ids()));

drop policy if exists p_soi_read on supply_order_item;
create policy p_soi_read on supply_order_item for select
  using (exists (select 1 from supply_order o where o.id = supply_order_item.supply_order_id));
drop policy if exists p_sof_read on supply_order_fueling;
create policy p_sof_read on supply_order_fueling for select
  using (exists (select 1 from supply_order o where o.id = supply_order_fueling.supply_order_id));

-- ----------------------------------------------------------------------------
-- Travas
-- ----------------------------------------------------------------------------
-- Abastecimento em OF não pode ser editado nem excluído, e o vínculo com a OF
-- só muda pelas funções de faturamento (que ligam a chave abaixo na transação).
create or replace function fueling_billing_lock() returns trigger
language plpgsql as $$
declare v_number text;
begin
  if current_setting('gerirfrota.billing_bypass', true) = '1' then
    return coalesce(new, old);
  end if;
  if old.supply_order_id is not null then
    select number into v_number from supply_order where id = old.supply_order_id;
    raise exception 'Este abastecimento faz parte da Ordem de Fornecimento %. Para alterar, cancele a ordem.', coalesce(v_number, '')
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.supply_order_id is not null then
    raise exception 'O vínculo com a Ordem de Fornecimento só pode ser feito pela emissão da ordem.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_fueling_billing_lock on fueling;
create trigger trg_fueling_billing_lock
  before update or delete on fueling
  for each row execute function fueling_billing_lock();

-- Contrato com OF ativa não troca de secretaria (a OF é numerada pela secretaria).
create or replace function supplier_billing_lock() returns trigger
language plpgsql as $$
begin
  if new.department_id is distinct from old.department_id
     and exists (select 1 from supply_order o where o.supplier_id = old.id and o.status <> 'cancelada') then
    raise exception 'Este contrato tem Ordem de Fornecimento emitida e não pode mudar de secretaria.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_supplier_billing_lock on supplier;
create trigger trg_supplier_billing_lock
  before update on supplier
  for each row execute function supplier_billing_lock();

-- ----------------------------------------------------------------------------
-- Funções
-- ----------------------------------------------------------------------------
-- Quem pode faturar: admin e usuário; usuário vinculado a secretaria só a dele.
create or replace function _billing_require(p_department uuid) returns void
language plpgsql stable security definer set search_path = public, auth as $$
declare v_role user_role; v_dept uuid;
begin
  v_role := current_user_role();
  if v_role is null or v_role not in ('admin','usuario') then
    raise exception 'Seu perfil não tem acesso ao faturamento.' using errcode = '42501';
  end if;
  if v_role = 'usuario' then
    v_dept := current_user_department_id();
    if v_dept is not null and v_dept is distinct from p_department then
      raise exception 'Você só pode faturar a sua secretaria.' using errcode = '42501';
    end if;
  end if;
end;
$$;
revoke all on function _billing_require(uuid) from public;
grant execute on function _billing_require(uuid) to authenticated;

-- Abastecimentos elegíveis de um contrato no período (ainda sem OF).
create or replace function billing_pending_fuelings(p_supplier uuid, p_start date, p_end date)
returns table (
  fueling_id uuid, fueling_date date, authorization_number text,
  vehicle_id uuid, plate text, vehicle_model text, vehicle_type_code smallint,
  fuel_type_code smallint, fuel_subtype_id smallint, fuel_label text,
  liters numeric, km_initial integer, km_final integer
)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
declare v_dept uuid; v_start date;
begin
  select s.department_id into v_dept from supplier s where s.id = p_supplier;
  perform _billing_require(v_dept);
  select e.billing_start_date into v_start from entity e where e.id = 1;
  return query
    select f.id, f.date, a.number,
           f.vehicle_id, f.vehicle_plate_snapshot, v.model, v.vehicle_type_code,
           f.fuel_type_code, f.fuel_subtype_id,
           upper(coalesce(fs.description, ft.description)),
           f.quantity, f.km_initial, f.km_final
      from fueling f
      join vehicle v on v.id = f.vehicle_id
      join fuel_type ft on ft.code = f.fuel_type_code
      left join fuel_subtype fs on fs.id = f.fuel_subtype_id
      left join fueling_authorization a on a.id = f.authorization_id
     where f.supplier_id = p_supplier
       and v_dept is not null
       and f.deleted_at is null
       and f.supply_order_id is null
       and v_start is not null and f.date >= v_start
       and f.date between p_start and p_end
     order by f.date, a.number nulls last, f.created_at;
end;
$$;
revoke all on function billing_pending_fuelings(uuid, date, date) from public;
grant execute on function billing_pending_fuelings(uuid, date, date) to authenticated;

-- Contratos (postos) da secretaria com o total pendente no período.
-- Contrato sem pendência aparece com zero.
create or replace function billing_pending_contracts(p_department uuid, p_start date, p_end date)
returns table (
  supplier_id uuid, legal_name text, trade_name text, cnpj text,
  contract_number text, price_type text,
  fuelings integer, liters numeric, vehicles integer, fuels text[]
)
language plpgsql stable security definer set search_path = public, auth as $$
#variable_conflict use_column
declare v_start date;
begin
  perform _billing_require(p_department);
  select e.billing_start_date into v_start from entity e where e.id = 1;
  return query
    select s.id, s.legal_name, s.trade_name, s.cnpj::text,
           s.contract_number, s.price_type,
           count(f.id)::integer,
           coalesce(sum(f.quantity), 0)::numeric,
           count(distinct f.vehicle_id)::integer,
           coalesce(array_agg(distinct upper(coalesce(fs.description, ft.description)))
                      filter (where f.id is not null), '{}')
      from supplier s
      left join fueling f
             on f.supplier_id = s.id
            and f.deleted_at is null
            and f.supply_order_id is null
            and v_start is not null and f.date >= v_start
            and f.date between p_start and p_end
      left join fuel_type ft on ft.code = f.fuel_type_code
      left join fuel_subtype fs on fs.id = f.fuel_subtype_id
     where s.department_id = p_department
       and s.kind in ('posto','ambos')
     group by s.id
     order by count(f.id) desc, s.legal_name, s.contract_number;
end;
$$;
revoke all on function billing_pending_contracts(uuid, date, date) from public;
grant execute on function billing_pending_contracts(uuid, date, date) to authenticated;

-- Emite a OF. Revalida cada abastecimento (não confia na tela).
create or replace function emit_supply_order(
  p_supplier uuid,
  p_start date,
  p_end date,
  p_mode text,
  p_fueling_ids uuid[],
  p_commitment text default null,
  p_issue_date date default null
) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_sup supplier%rowtype; v_dep department%rowtype;
  v_start date; v_issue date := coalesce(p_issue_date, current_date);
  v_ids uuid[]; v_n integer; v_ok integer; v_liters numeric; v_last date;
  v_year smallint; v_seq integer; v_number text; v_id uuid;
  v_commitment text := nullif(btrim(coalesce(p_commitment, '')), '');
begin
  select * into v_sup from supplier where id = p_supplier;
  if v_sup.id is null then raise exception 'Contrato não encontrado.'; end if;
  if v_sup.kind not in ('posto','ambos') then raise exception 'Só contratos de combustível podem ser faturados.'; end if;
  if v_sup.department_id is null then
    raise exception 'Este contrato não tem secretaria. Informe a secretaria no cadastro do fornecedor.';
  end if;
  perform _billing_require(v_sup.department_id);
  select * into v_dep from department where id = v_sup.department_id;

  select billing_start_date into v_start from entity where id = 1;
  if v_start is null then
    raise exception 'Defina a data de início do faturamento na Configuração antes de emitir a primeira ordem.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'Período inválido.'; end if;
  if p_mode not in ('contrato','veiculos') then raise exception 'Modo de seleção inválido.'; end if;

  select array_agg(distinct x) into v_ids from unnest(coalesce(p_fueling_ids, '{}')) x;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Selecione pelo menos um abastecimento.'; end if;

  -- Numeração: uma emissão por vez na secretaria/exercício
  v_year := extract(year from p_end)::smallint;
  perform pg_advisory_xact_lock(hashtext('supply_order_' || v_sup.department_id::text || '_' || v_year::text));

  -- Trava as linhas e revalida: se outra emissão levou algum, esta falha inteira
  perform 1 from fueling where id = any(v_ids) order by id for update;
  select count(*), coalesce(sum(quantity), 0), max(date)
    into v_ok, v_liters, v_last
    from fueling
   where id = any(v_ids)
     and supplier_id = p_supplier
     and deleted_at is null
     and supply_order_id is null
     and date >= v_start
     and date between p_start and p_end;
  if v_ok <> v_n then
    raise exception 'Alguns abastecimentos não estão mais disponíveis para esta ordem (% de %). Atualize a tela e tente de novo.', v_ok, v_n;
  end if;

  if v_issue > current_date then raise exception 'A data de emissão não pode ser futura.'; end if;
  if v_issue < v_last then
    raise exception 'A data de emissão não pode ser anterior ao último abastecimento da ordem (%).', to_char(v_last, 'DD/MM/YYYY');
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
    from supply_order where department_id = v_sup.department_id and year = v_year;
  v_number := lpad(v_seq::text, greatest(3, length(v_seq::text)), '0') || '/' || v_year::text;

  insert into supply_order (
    department_id, supplier_id, year, seq, number, reference_month,
    period_start, period_end, issue_date, selection_mode,
    commitment_number, commitment_set_by, commitment_set_at,
    total_fuelings, total_liters,
    department_name_snapshot, department_acronym_snapshot, department_cnpj_snapshot,
    responsible_name_snapshot, responsible_role_snapshot,
    supplier_name_snapshot, supplier_cnpj_snapshot, contract_number_snapshot,
    created_by
  ) values (
    v_sup.department_id, p_supplier, v_year, v_seq, v_number, to_char(p_end, 'MM/YYYY'),
    p_start, p_end, v_issue, p_mode,
    v_commitment,
    case when v_commitment is not null then auth.uid() end,
    case when v_commitment is not null then now() end,
    v_n, v_liters,
    v_dep.name, v_dep.acronym, v_dep.cnpj,
    v_dep.responsible_name, v_dep.responsible_role,
    v_sup.legal_name, v_sup.cnpj, v_sup.contract_number,
    auth.uid()
  ) returning id into v_id;

  insert into supply_order_item (supply_order_id, fuel_type_code, fuel_subtype_id, fuel_label, fuelings_count, liters)
    select v_id, f.fuel_type_code, f.fuel_subtype_id,
           upper(coalesce(max(fs.description), max(ft.description))),
           count(*), sum(f.quantity)
      from fueling f
      join fuel_type ft on ft.code = f.fuel_type_code
      left join fuel_subtype fs on fs.id = f.fuel_subtype_id
     where f.id = any(v_ids)
     group by f.fuel_type_code, f.fuel_subtype_id;

  insert into supply_order_fueling (supply_order_id, fueling_id)
    select v_id, x from unnest(v_ids) x;

  perform set_config('gerirfrota.billing_bypass', '1', true);
  update fueling set supply_order_id = v_id where id = any(v_ids);
  perform set_config('gerirfrota.billing_bypass', '0', true);

  return v_id;
end;
$$;
revoke all on function emit_supply_order(uuid, date, date, text, uuid[], text, date) from public;
grant execute on function emit_supply_order(uuid, date, date, text, uuid[], text, date) to authenticated;

-- Empenho pode ser informado depois, enquanto a OF estiver só emitida.
create or replace function set_supply_order_commitment(p_order uuid, p_commitment text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_o supply_order%rowtype; v_c text := nullif(btrim(coalesce(p_commitment, '')), '');
begin
  select * into v_o from supply_order where id = p_order for update;
  if v_o.id is null then raise exception 'Ordem de Fornecimento não encontrada.'; end if;
  perform _billing_require(v_o.department_id);
  if v_o.status <> 'emitida' then
    raise exception 'O empenho só pode ser alterado enquanto a ordem está emitida e sem termo.';
  end if;
  update supply_order
     set commitment_number = v_c,
         commitment_set_by = case when v_c is not null then auth.uid() end,
         commitment_set_at = case when v_c is not null then now() end
   where id = p_order;
end;
$$;
revoke all on function set_supply_order_commitment(uuid, text) from public;
grant execute on function set_supply_order_commitment(uuid, text) to authenticated;

-- Cancela a OF: libera os abastecimentos, mantém número e histórico.
create or replace function cancel_supply_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_o supply_order%rowtype; v_r text := btrim(coalesce(p_reason, ''));
begin
  select * into v_o from supply_order where id = p_order for update;
  if v_o.id is null then raise exception 'Ordem de Fornecimento não encontrada.'; end if;
  perform _billing_require(v_o.department_id);
  if v_o.status = 'cancelada' then raise exception 'Esta ordem já está cancelada.'; end if;
  if v_o.status = 'faturada' then
    raise exception 'Esta ordem já tem Termo de Recebimento. Cancele o termo antes.';
  end if;
  if length(v_r) < 5 then raise exception 'Informe a justificativa do cancelamento.'; end if;

  perform set_config('gerirfrota.billing_bypass', '1', true);
  update fueling set supply_order_id = null where supply_order_id = p_order;
  perform set_config('gerirfrota.billing_bypass', '0', true);

  update supply_order
     set status = 'cancelada', cancel_reason = v_r,
         canceled_by = auth.uid(), canceled_at = now()
   where id = p_order;
end;
$$;
revoke all on function cancel_supply_order(uuid, text) from public;
grant execute on function cancel_supply_order(uuid, text) to authenticated;

-- Reload do schema cache do PostgREST
notify pgrst, 'reload schema';
