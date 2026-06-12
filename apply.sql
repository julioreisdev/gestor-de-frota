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

-- Reload do schema cache do PostgREST
notify pgrst, 'reload schema';
