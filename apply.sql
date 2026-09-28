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

-- Reload do schema cache do PostgREST
notify pgrst, 'reload schema';
