-- =============================================================================
-- gerirfrota — dump.sql (instância DEMO)
-- Seeds (lookups + IBGE) + entidade (Anísio de Abreu) + usuário admin.
-- Rodar DEPOIS de init.sql.
--
-- Para clonar para uma nova cidade:
--   1) alterar IBGE e organ_name na seção ENTIDADE
--   2) alterar email/senha do admin na seção USUÁRIO ADMIN (recomendado)
-- =============================================================================

-- =============================================================================
-- LOOKUPS TCE-PI
-- =============================================================================

-- Tipo de veículo (tabela oficial tipoVeicCSV)
insert into vehicle_type (code, description, notes) values
  (1,  'Automóvel',   'Veículo automotor destinado ao transporte de passageiros, com capacidade para até oito pessoas, exclusive o condutor.'),
  (2,  'Ônibus',      'Veículo automotor de transporte coletivo com capacidade para mais de 20 passageiros, ainda que, em virtude de adaptações com vista à maior comodidade destes, transporte número menor.'),
  (3,  'Microonibus', 'Veículo automotor de transporte coletivo com capacidade para até 20 passageiros.'),
  (4,  'Caminhão',    'Veículo automotor destinado ao transporte de carga, com carroçaria, e peso bruto total superior a 3.500 Kg.'),
  (5,  'Caminhonete', 'Veículo automotor destinado ao transporte de carga, com peso bruto total de até 3.500 Kg.'),
  (6,  'Camioneta',   'Veículo automotor, misto, com quatro rodas, com carroçaria, destinado ao transporte simultâneo ou alternativo de pessoas e carga no mesmo compartimento.'),
  (7,  'Utilitário',  'Veículo misto caracterizado pela versatilidade do seu uso, inclusive fora da estrada.'),
  (8,  'Motocicleta', 'Veículo automotor de duas rodas, com ou sem side-car, dirigido em posição montada.'),
  (9,  'Trator',      'Trator rodas ou esteira.'),
  (99, 'Outros',      'Outros equipamentos, máquinas ou congêneres que não se enquadram em nenhuma definição anterior e utilizem combustíveis para abastecimento.');

-- Tipo de combustível (tabela oficial tipoCombCSV)
insert into fuel_type (code, description) values
  (1, 'GASOLINA'),
  (2, 'ALCOOL'),
  (3, 'ELETRICIDADE'),
  (4, 'DIESEL'),
  (5, 'FLEX (ALCOOL/GASOLINA)'),
  (6, 'GAS NATURAL VEICULAR'),
  (7, 'HIBRIDO (ELETRICIDADE/GASOLINA/ALCOOL)');

-- Subtipos comerciais (UX interna; exportação TCE usa só o pai)
insert into fuel_subtype (fuel_type_code, description)
select v.fuel_type_code, v.description
from (values
  (1::smallint, 'Gasolina Comum'),
  (1::smallint, 'Gasolina Aditivada'),
  (4::smallint, 'Diesel'),
  (4::smallint, 'Diesel S10')
) as v(fuel_type_code, description)
where not exists (
  select 1 from fuel_subtype f
  where f.fuel_type_code = v.fuel_type_code
    and f.description = v.description
);

-- Origem do veículo (tabela oficial origemVeiculo)
insert into vehicle_origin (code, description) values
  (1, 'Próprio'),
  (2, 'Cedido'),
  (3, 'Locado'),
  (4, 'Sublocado'),
  (9, 'Outras origens');

-- Sim/Não (tabela oficial simNao) — usado em veiculoCedido e possuiMotorista
insert into sim_nao (code, description) values
  (0, 'Não'),
  (1, 'Sim');

-- Municípios do Piauí (IBGE — 224 entradas)
insert into ibge_municipality (code, name) values
  ('2200053','Acauã'),
  ('2200103','Agricolândia'),
  ('2200202','Água Branca'),
  ('2200251','Alagoinha do Piauí'),
  ('2200277','Alegrete do Piauí'),
  ('2200301','Alto Longá'),
  ('2200400','Altos'),
  ('2200459','Alvorada do Gurguéia'),
  ('2200509','Amarante'),
  ('2200608','Angical do Piauí'),
  ('2200707','Anísio de Abreu'),
  ('2200806','Antônio Almeida'),
  ('2200905','Aroazes'),
  ('2200954','Aroeiras do Itaim'),
  ('2201002','Arraial'),
  ('2201051','Assunção do Piauí'),
  ('2201101','Avelino Lopes'),
  ('2201150','Baixa Grande do Ribeiro'),
  ('2201176','Barra D''Alcântara'),
  ('2201200','Barras'),
  ('2201309','Barreiras do Piauí'),
  ('2201408','Barro Duro'),
  ('2201507','Batalha'),
  ('2201556','Bela Vista do Piauí'),
  ('2201572','Belém do Piauí'),
  ('2201606','Beneditinos'),
  ('2201705','Bertolínia'),
  ('2201739','Betânia do Piauí'),
  ('2201770','Boa Hora'),
  ('2201804','Bocaina'),
  ('2201903','Bom Jesus'),
  ('2201919','Bom Princípio do Piauí'),
  ('2201929','Bonfim do Piauí'),
  ('2201945','Boqueirão do Piauí'),
  ('2201960','Brasileira'),
  ('2201988','Brejo do Piauí'),
  ('2202000','Buriti dos Lopes'),
  ('2202026','Buriti dos Montes'),
  ('2202059','Cabeceiras do Piauí'),
  ('2202075','Cajazeiras do Piauí'),
  ('2202083','Cajueiro da Praia'),
  ('2202091','Caldeirão Grande do Piauí'),
  ('2202109','Campinas do Piauí'),
  ('2202117','Campo Alegre do Fidalgo'),
  ('2202133','Campo Grande do Piauí'),
  ('2202174','Campo Largo do Piauí'),
  ('2202208','Campo Maior'),
  ('2202251','Canavieira'),
  ('2202307','Canto do Buriti'),
  ('2202406','Capitão de Campos'),
  ('2202455','Capitão Gervásio Oliveira'),
  ('2202505','Caracol'),
  ('2202539','Caraúbas do Piauí'),
  ('2202554','Caridade do Piauí'),
  ('2202604','Castelo do Piauí'),
  ('2202653','Caxingó'),
  ('2202703','Cocal'),
  ('2202711','Cocal de Telha'),
  ('2202729','Cocal dos Alves'),
  ('2202737','Coivaras'),
  ('2202752','Colônia do Gurguéia'),
  ('2202778','Colônia do Piauí'),
  ('2202802','Conceição do Canindé'),
  ('2202851','Coronel José Dias'),
  ('2202901','Corrente'),
  ('2203008','Cristalândia do Piauí'),
  ('2203107','Cristino Castro'),
  ('2203206','Curimatá'),
  ('2203230','Currais'),
  ('2203271','Curral Novo do Piauí'),
  ('2203255','Curralinhos'),
  ('2203305','Demerval Lobão'),
  ('2203354','Dirceu Arcoverde'),
  ('2203404','Dom Expedito Lopes'),
  ('2203453','Dom Inocêncio'),
  ('2203420','Domingos Mourão'),
  ('2203503','Elesbão Veloso'),
  ('2203602','Eliseu Martins'),
  ('2203701','Esperantina'),
  ('2203750','Fartura do Piauí'),
  ('2203800','Flores do Piauí'),
  ('2203859','Floresta do Piauí'),
  ('2203909','Floriano'),
  ('2204006','Francinópolis'),
  ('2204105','Francisco Ayres'),
  ('2204154','Francisco Macedo'),
  ('2204204','Francisco Santos'),
  ('2204303','Fronteiras'),
  ('2204352','Geminiano'),
  ('2204402','Gilbués'),
  ('2204501','Guadalupe'),
  ('2204550','Guaribas'),
  ('2204600','Hugo Napoleão'),
  ('2204659','Ilha Grande'),
  ('2204709','Inhuma'),
  ('2204808','Ipiranga do Piauí'),
  ('2204907','Isaías Coelho'),
  ('2205003','Itainópolis'),
  ('2205102','Itaueira'),
  ('2205151','Jacobina do Piauí'),
  ('2205201','Jaicós'),
  ('2205250','Jardim do Mulato'),
  ('2205276','Jatobá do Piauí'),
  ('2205300','Jerumenha'),
  ('2205359','João Costa'),
  ('2205409','Joaquim Pires'),
  ('2205458','Joca Marques'),
  ('2205508','José de Freitas'),
  ('2205516','Juazeiro do Piauí'),
  ('2205524','Júlio Borges'),
  ('2205532','Jurema'),
  ('2205557','Lagoa Alegre'),
  ('2205573','Lagoa de São Francisco'),
  ('2205565','Lagoa do Barro do Piauí'),
  ('2205581','Lagoa do Piauí'),
  ('2205599','Lagoa do Sítio'),
  ('2205540','Lagoinha do Piauí'),
  ('2205607','Landri Sales'),
  ('2205706','Luís Correia'),
  ('2205805','Luzilândia'),
  ('2205854','Madeiro'),
  ('2205904','Manoel Emídio'),
  ('2205953','Marcolândia'),
  ('2206001','Marcos Parente'),
  ('2206050','Massapê do Piauí'),
  ('2206100','Matias Olímpio'),
  ('2206209','Miguel Alves'),
  ('2206308','Miguel Leão'),
  ('2206357','Milton Brandão'),
  ('2206407','Monsenhor Gil'),
  ('2206506','Monsenhor Hipólito'),
  ('2206605','Monte Alegre do Piauí'),
  ('2206654','Morro Cabeça no Tempo'),
  ('2206670','Morro do Chapéu do Piauí'),
  ('2206696','Murici dos Portelas'),
  ('2206704','Nazaré do Piauí'),
  ('2206720','Nazária'),
  ('2206753','Nossa Senhora de Nazaré'),
  ('2206803','Nossa Senhora dos Remédios'),
  ('2207959','Nova Santa Rita'),
  ('2206902','Novo Oriente do Piauí'),
  ('2206951','Novo Santo Antônio'),
  ('2207009','Oeiras'),
  ('2207108','Olho D''Água do Piauí'),
  ('2207207','Padre Marcos'),
  ('2207306','Paes Landim'),
  ('2207355','Pajeú do Piauí'),
  ('2207405','Palmeira do Piauí'),
  ('2207504','Palmeirais'),
  ('2207553','Paquetá'),
  ('2207603','Parnaguá'),
  ('2207702','Parnaíba'),
  ('2207751','Passagem Franca do Piauí'),
  ('2207777','Patos do Piauí'),
  ('2207793','Pau D''Arco do Piauí'),
  ('2207801','Paulistana'),
  ('2207850','Pavussu'),
  ('2207900','Pedro II'),
  ('2207934','Pedro Laurentino'),
  ('2208007','Picos'),
  ('2208106','Pimenteiras'),
  ('2208205','Pio IX'),
  ('2208304','Piracuruca'),
  ('2208403','Piripiri'),
  ('2208502','Porto'),
  ('2208551','Porto Alegre do Piauí'),
  ('2208601','Prata do Piauí'),
  ('2208650','Queimada Nova'),
  ('2208700','Redenção do Gurguéia'),
  ('2208809','Regeneração'),
  ('2208858','Riacho Frio'),
  ('2208874','Ribeira do Piauí'),
  ('2208908','Ribeiro Gonçalves'),
  ('2209005','Rio Grande do Piauí'),
  ('2209104','Santa Cruz do Piauí'),
  ('2209153','Santa Cruz dos Milagres'),
  ('2209203','Santa Filomena'),
  ('2209302','Santa Luz'),
  ('2209377','Santa Rosa do Piauí'),
  ('2209351','Santana do Piauí'),
  ('2209401','Santo Antônio de Lisboa'),
  ('2209450','Santo Antônio dos Milagres'),
  ('2209500','Santo Inácio do Piauí'),
  ('2209559','São Braz do Piauí'),
  ('2209609','São Félix do Piauí'),
  ('2209658','São Francisco de Assis do Piauí'),
  ('2209708','São Francisco do Piauí'),
  ('2209757','São Gonçalo do Gurguéia'),
  ('2209807','São Gonçalo do Piauí'),
  ('2209856','São João da Canabrava'),
  ('2209872','São João da Fronteira'),
  ('2209906','São João da Serra'),
  ('2209955','São João da Varjota'),
  ('2209971','São João do Arraial'),
  ('2210003','São João do Piauí'),
  ('2210052','São José do Divino'),
  ('2210102','São José do Peixe'),
  ('2210201','São José do Piauí'),
  ('2210300','São Julião'),
  ('2210359','São Lourenço do Piauí'),
  ('2210375','São Luis do Piauí'),
  ('2210383','São Miguel da Baixa Grande'),
  ('2210391','São Miguel do Fidalgo'),
  ('2210409','São Miguel do Tapuio'),
  ('2210508','São Pedro do Piauí'),
  ('2210607','São Raimundo Nonato'),
  ('2210623','Sebastião Barros'),
  ('2210631','Sebastião Leal'),
  ('2210656','Sigefredo Pacheco'),
  ('2210706','Simões'),
  ('2210805','Simplício Mendes'),
  ('2210904','Socorro do Piauí'),
  ('2210938','Sussuapara'),
  ('2210953','Tamboril do Piauí'),
  ('2210979','Tanque do Piauí'),
  ('2211001','Teresina'),
  ('2211100','União'),
  ('2211209','Uruçuí'),
  ('2211308','Valença do Piauí'),
  ('2211357','Várzea Branca'),
  ('2211407','Várzea Grande'),
  ('2211506','Vera Mendes'),
  ('2211605','Vila Nova do Piauí'),
  ('2211704','Wall Ferraz');

-- =============================================================================
-- ENTIDADE: Prefeitura Municipal de Anísio de Abreu (IBGE 2200707)
-- =============================================================================
insert into entity (id, entity_type, ibge_code, organ_name, coat_of_arms_url, default_ref_month)
values (
  1,
  'Prefeitura Municipal',
  '2200707',
  'Prefeitura Municipal de Anísio de Abreu',
  'https://sts-gestao.s3.amazonaws.com/uploads/clientes_imagem/bfd6b8203a969e76d07c469bd39e788e.png',
  to_char(current_date, 'YYYY-MM')
);

-- =============================================================================
-- USUÁRIO ADMIN
--   email: romerito-maia@hotmail.com
--   senha: 035AHRSw?
--   Trocar o email se desejar — basta substituir a string abaixo.
-- =============================================================================
do $$
declare
  v_user_id  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_email    text := 'romerito-maia@hotmail.com';
  v_password text := '035AHRSw?';
begin
  insert into auth.users (
    instance_id, id, aud, role,
    email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
    jsonb_build_object('full_name','Administrador'),
    now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data,
    provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
    'email',
    now(), now(), now()
  );

  insert into app_user (id, username, full_name, role, active)
  values (v_user_id, 'admin', 'Administrador', 'admin', true);
end $$;

-- =============================================================================
-- FIM dump.sql
-- =============================================================================
