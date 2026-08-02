# gerirfrota

Sistema de gestão de frota municipal para prefeituras do Piauí, alinhado aos relatórios obrigatórios do TCE-PI.

## Stack e arquitetura

- **Frontend:** HTML + CSS + JavaScript puros (sem framework, sem build step).
- **Backend:** Supabase (Postgres + Auth + Storage).
- **Hospedagem:** GitHub Pages.
- **Multi-tenant por clone:** 1 cidade = 1 projeto Supabase + 1 repositório próprio. Sem isolamento por row (RLS) entre cidades — cada cidade tem seu banco.
- **Configuração da entidade** (prefeitura/câmara/fundo, código IBGE, brasão) é fixada no banco e só pode ser alterada por mim. Usuários apenas visualizam.
- **UI:** estilo dashboard, **altamente responsivo** (mobile-first é requisito forte). Diretrizes detalhadas em [Design](#design).

## Regras de colaboração

- **Nunca desenvolver nada sem perguntar antes.** Mesmo correções óbvias passam por confirmação.
- **Respostas diretas e secas** — perfil dev sênior, sem rodeios, sem narrar processo.
- Cliente mandou `cliente.html` como **referência visual/funcional gerada por IA** — não é código de produção, é só pra entender a intenção dele.

## Design

- **Responsivo de verdade.** Mobile-first, breakpoints testados em telefone, tablet e desktop. Tabelas viram cards ou rolam horizontalmente sem quebrar; modais ocupam tela cheia em mobile; sidebar colapsa.
- **Toda página com dados cadastráveis tem campo de busca.** Padrão obrigatório: input com ícone de lupa no topo da tabela, filtro em tempo real (client-side enquanto a lista cabe; server-side com debounce quando volumosa). Buscar nas colunas principais do registro (nome, código, identificador). Se a lista pode crescer, o filtro nunca é "feature futura" — entra junto com a primeira versão da tela.
- **Exportações internas (Excel) e impressões podem ser ricas e livres.** Servem ao gestor, então incluem dados extras (UUIDs, códigos TCE + descrições, IBGE, nomes longos). Formato Excel é o padrão (XLSX via [js/export.js](js/export.js)); impressão via [js/print.js](js/print.js) com cabeçalho institucional + filtros aplicados + A4 paisagem.
- **Exportações OFICIAIS TCE-PI (Cód. 503, 443, 517) são fechadas.** Quando formos implementar a aba "Exportação TCE-PI", **seguir à risca** os layouts em `/docs/*_manual-tecnico.pdf` e regras em `/docs/*_regra-validacao.pdf` (mar–mai/2026). Tudo já está consolidado nas seções "Layouts CSV do TCE-PI" e "Regras de validação oficiais do TCE-PI" neste arquivo. Nada de coluna extra, descrição traduzida, separador diferente: só o que o TCE pede, exatamente como pede. CSV com `;`, UTF-8 com BOM, camelCase, códigos numéricos das lookups oficiais, RENAVAM padStart 11, datas ISO. A página deve ter botões individuais por layout (517, 503, 443) — não unificar.

### Cada layout TCE oferece DOIS botões: CSV oficial + PDF interno

Confirmado com o cliente: para cada um dos 3 layouts (517, 503, 443) a tela de Exportação TCE-PI vai ter **duas** ações:

1. **CSV (TCE-PI)** — rigoroso, padrão oficial, **sem campo extra**. Vai pro Documentação Web do TCE.
2. **PDF (interno, conferência)** — mesmos dados do CSV **ou mais ricos** (pode incluir subtipo de combustível, IBGE descrito, nome completo da secretaria, totais agregados, cabeçalho institucional com brasão). Serve pra o gestor revisar antes de enviar e pra arquivamento físico.

### Checklist obrigatório do CSV TCE (não esquecer nada)

Pra cada cell antes de virar string CSV:
- **RENAVAM**: `String(renavam).padStart(11, '0')` — sempre 11 dígitos. Exceção: tipo 99 (Outros) → `'99999999999'`.
- **Placa**: sem hífen, **só letras maiúsculas e dígitos** (`ABC1234` ou `ABC1D23`). Nunca formatada. Para tipo 99: começa com `XYZ`.
- **Códigos enum**: número puro do XLSX oficial (1..99 do `vehicle_type`, 1..7 do `fuel_type`, 1..4/9 do `vehicle_origin`, 0/1 do `sim_nao`). **NÃO** a descrição.
- **`fuel_type_code` no abastecimento (517)**: aceita apenas `1,2,3,4,6` (gasolina, álcool, eletricidade, diesel, GNV). FLEX (5) e HIBRIDO (7) **não** aparecem aqui — são tipos do veículo, não do abastecimento.
- **Subtipos comerciais (qualquer um — Diesel S10, Gasolina Aditivada, Gasolina Comum, e os que vierem)**: **sempre ignorados no CSV TCE**. Só vai o `fuel_type_code` pai. Regra vale tanto para 517 quanto para 503/443. No banco há `fuel_subtype_id` opcional nas tabelas que usam combustível — usar pra UI/relatórios internos; ao montar o CSV TCE, **não** ler essa coluna, ler só `fuel_type_code`.
- **Datas**: formato ISO `AAAA-MM-DD`. Em campos opcionais não preenchidos do 503 (cessão), o leiaute aceita vazio; conferir caso a caso.
- **Decimais**: separador `.` (ponto), 2 casas (`123.45`) para valor monetário e capacidade; `quantidadeAbastecimento` aceita até 7 dígitos.
- **`localizacao` em 503/443**: código IBGE de 7 dígitos da entidade (`entity.ibge_code`).
- **`orgaoLocalizacao` em 517**: nome do órgão/secretaria que opera o veículo (texto livre 3-300 chars) — vem de `department.name`.
- **`codigoCw` em 443**: regex `^CW-\d{6}/\d{2}$` (ex.: `CW-123456/25`).
- **`cpfOuCnpj` em 443**: só dígitos (11 ou 14).
- **Encoding**: UTF-8 com BOM (`﻿` no início do conteúdo).
- **Separador**: `;` (ponto e vírgula).
- **Quebra de linha**: `\r\n`.
- **Quoting**: campos com `;`, `"` ou quebra de linha → envolver em aspas duplas e escapar `"` interno como `""`.
- **Regra OUTROS (tipo 99)**: nas linhas 517, OS QUATRO campos viram sentinela: `renavam=99999999999`, placa começa com `XYZ`, `kmInicial=99999999`, `kmFinal=99999999`. Regra inversa (1.1.9): tipos ≠ 99 não podem ter esses valores sentinela.
- **Cruzada 1.1.6/1.1.7**: ao montar o 517, validar que todo veículo com origem 1/2 aparece também no 503, e com origem 3/4 aparece também no 443. Se não, o TCE rejeita.

### PDF interno — liberdade total

Pode (e deve) incluir:
- Cabeçalho institucional (brasão da entidade, nome do órgão, IBGE, período/mês de referência, filtros aplicados).
- Códigos TCE **junto com** as descrições (`4 - DIESEL (Diesel S10)`).
- Totais agregados ao final (qtd. veículos, soma de litros, soma de gastos, etc).
- Coluna de assinatura/visto.
- Numeração de página + data/hora de geração + nome do usuário que gerou.

Reaproveitar o módulo `js/print.js` que já existe.
- **Células de tabela com múltiplas informações usam `<div class="cell-stack">`.** Nunca empilhar com `<br>` solto — em mobile (quando a tabela vira card), `<br>` quebra o layout label/valor. O `.cell-stack` é flex-column alinhado à direita e gerencia word-break automaticamente pra emails/URLs longas.
- **Moderno mas clean, NÃO juvenil.** Público alvo é servidor público adulto — secretário, motorista, frentista, gestor de frota. Nada de gradientes vibrantes, ilustrações 3D, micro-animações chamativas, emojis decorativos espalhados, ou tipografia "tech". Visual deve transmitir seriedade institucional.
- **Harmonia rigorosa.**
  - Paleta restrita e consistente (definir 1 cor primária institucional + 1 neutra + 1 de alerta, e usar só essas).
  - Tipografia: 1 família, 2-3 pesos no máximo, escala definida.
  - Espaçamento em grade de 4px ou 8px — sem valores aleatórios.
  - Bordas, raios e sombras uniformes em todos os componentes do mesmo tipo.
- **Posicionamento milimétrico.** Nada de "tá quase certo". Alinhamentos perfeitos, gaps idênticos entre elementos irmãos, ícones e textos sempre na mesma baseline. Atenção a paddings/margins que parecem iguais mas não são.
- Cliente.html tem o feeling certo de cores (azul institucional + neutros), mas o uso de emojis como ícones (🚌📊⛽📋) é grosseiro — substituir por ícones SVG consistentes (Lucide, Heroicons ou similar).

## Módulos do sistema (escopo)

1. **Veículos** — cadastro com todos os campos exigidos pelo TCE.
2. **Secretarias / Órgãos** — sigla, nome, centro de custo, responsável.
3. **Fornecedores** — postos de combustível e **mecânicas** (mesmo cadastro, distinto pelo tipo de serviço). Inclui controle de **saldo de contrato por combustível**.
4. **Autorizações de abastecimento** — emitidas para um veículo/fornecedor/combustível/qtd, com **QR Code** para o motorista mostrar ao frentista.
5. **Abastecimentos** — registro de consumo. Pode ser manual ou gerado a partir de autorização. O fornecedor (frentista) preenche os campos finais (qtd real, KM, valor) lendo o QR.
6. **Manutenções** — escopo previsto mas **menos prioritário**. Cliente não modelou no `cliente.html`. Pendente de definição.
7. **Relatórios internos** — agregados por veículo / secretaria / fornecedor / combustível, com filtros e exportação PDF/XLSX.
8. **Exportação TCE-PI** — três layouts CSV obrigatórios (cód. 503, 443, 517 — ver abaixo).
9. **Usuários** — multi-perfil (admin / usuario / fornecedor), com período de acesso opcional.

## Perfis de acesso

| Perfil | O que vê |
|---|---|
| `admin` | Tudo: cadastros, autorizações, abastecimentos, manutenções, relatórios, exportações, gestão de usuários |
| `usuario` | Autorizações, abastecimentos, relatórios, exportações |
| `fornecedor` | Somente autorizações (visão restrita pra preencher abastecimento via QR) |

## Códigos TCE-PI (tabelas de domínio oficiais)

Códigos extraídos das planilhas oficiais do TCE-PI em `/docs` (`Tipo de Combustível.xlsx`, `Tipo de Veículos.xlsx`, `Origem do Veículo.xlsx`, `Sim_Não.xlsx`, `Código do IBGE.xlsx`) e confirmados nos manuais técnicos de **março/2026** (`Abastecimento_manual-tecnico.pdf`, etc.).

> **ATENÇÃO:** o `cliente.html` usa tabelas de códigos **inventadas pela IA do cliente** e que **não batem** com o oficial do TCE. Toda a modelagem deve seguir o oficial abaixo.

### Tipo de Veículo (`tipoVeiculo`) — tabela `tipoVeicCSV`
| Cód | Descrição |
| --- | --- |
| 1 | Automóvel |
| 2 | Ônibus |
| 3 | Microonibus |
| 4 | Caminhão |
| 5 | Caminhonete |
| 6 | Camioneta |
| 7 | Utilitário |
| 8 | Motocicleta |
| 9 | Trator |
| 99 | Outros |

### Tipo de Combustível (`tipoCombustivel`) — tabela `tipoCombCSV`
| Cód | Descrição |
| --- | --- |
| 1 | GASOLINA |
| 2 | ALCOOL |
| 3 | ELETRICIDADE |
| 4 | DIESEL |
| 5 | FLEX (ALCOOL/GASOLINA) |
| 6 | GAS NATURAL VEICULAR |
| 7 | HIBRIDO (ELETRICIDADE/GASOLINA/ALCOOL) |

**No layout 517** o campo `tipoCombustivel` aceita os mesmos códigos, mas representa o combustível **efetivamente abastecido naquele evento** — então não faz sentido `5` (Flex) nem `7` (Híbrido) aqui (são tipos do veículo, não do abastecimento). Na prática usar 1, 2, 3, 4 ou 6.

### Origem do Veículo (`origemVeiculo`)
| Cód | Descrição |
| --- | --- |
| 1 | Próprio |
| 2 | Cedido |
| 3 | Locado |
| 4 | Sublocado |
| 9 | Outras origens |

### Sim/Não (`simNao`) — usado em `veiculoCedido` e `possuiMotorista`
| Cód | Descrição |
| --- | --- |
| 0 | Não |
| 1 | Sim |

### Código IBGE (`codigoIBGE`)
- 224 municípios do Piauí, lista completa em `/docs/Código do IBGE.xlsx`.
- Usado no campo `localizacao` dos layouts 443 e 503.
- Cada instância (cidade) terá seu código IBGE fixado na config.

## Layouts CSV do TCE-PI

**Convenções gerais:**
- Separador: `;`
- Encoding: UTF-8 com BOM.
- Nomes de campos em **camelCase** (confere com os exemplos em `/docs/Exemplo_csv_*.csv` e com os manuais técnicos de mar/2026).
- `renavam`: **exatamente 11 dígitos**, padStart com zeros à esquerda.
- `placa`: 7 caracteres, formato `ABC1234`, `ABC-1234` ou Mercosul `ABC1D23`.
- Datas: `AAAA-MM-DD` (ISO).
- Decimais: separador `.`, 2 casas.

> **Divergência documentada:** o PDF antigo `Leiautes-CSV-2025-Doc-Web-Publicado-em-08-04-2025.pdf` descreve campos em snake_case (`ano_fab`, `cnpj_cpf`, etc.) e enums em texto (`ALCOOL`, `VERDADEIRO`). Os **manuais técnicos de mar/2026** e os **exemplos CSV reais** usam camelCase e códigos numéricos. **Seguir o formato dos manuais 2026.**

### Cód. 517 — Relatório de Abastecimento de Veículos

**Cabeçalho:**
```
modelo;placa;renavam;anoFabricacao;anoModelo;tipoVeiculo;origemVeiculo;orgaoLocalizacao;capacidade;quantidadeAbastecimento;tipoCombustivel;kmInicial;kmFinal
```

**Granularidade observada nos exemplos:** uma linha por **(veículo + combustível) no mês de referência**, com `quantidadeAbastecimento` somada e `kmInicial`/`kmFinal` representando o intervalo do mês (não os KMs de cada bomba individual). Conferir com o cliente se essa é a consolidação esperada ou se aceita uma linha por evento.

**Campos:**
| Campo | Regras |
| --- | --- |
| `modelo` | texto, 3 a 300 chars |
| `placa` | placa válida (chave do registro) |
| `renavam` | exatamente 11 dígitos com zeros à esquerda |
| `anoFabricacao` | número, ≤ ano corrente |
| `anoModelo` | número, ≤ ano corrente + 1 |
| `tipoVeiculo` | código `tipoVeicCSV` |
| `origemVeiculo` | código `origemVeiculo` |
| `orgaoLocalizacao` | texto 3-300 chars (nome do órgão/secretaria que opera o veículo) |
| `capacidade` | numérico > 0 e < 1000.00, 2 casas, separador `.` |
| `quantidadeAbastecimento` | numérico > 0, 2 casas, separador `.` (litros) |
| `tipoCombustivel` | código `tipoCombCSV` |
| `kmInicial` | inteiro 0–99999999 |
| `kmFinal` | inteiro 0–99999999 |

### Cód. 503 — Veículos Próprios e Cedidos
Filtrar `origemVeiculo IN (1, 2)`.

**Cabeçalho:**
```
modelo;placa;renavam;anoFabricacao;anoModelo;tipoCombustivel;estadoConservacao;localizacao;veiculoCedido;orgaoDestVeicCedido;dataInicCessao;dataFimCessao
```

| Campo | Regras |
| --- | --- |
| `modelo` | texto 3-300 |
| `placa` | placa válida (chave) |
| `renavam` | 11 dígitos |
| `anoFabricacao` | ≤ ano corrente |
| `anoModelo` | ≤ ano corrente + 1 |
| `tipoCombustivel` | código `tipoCombCSV` (combustível do veículo — pode ser Flex/Híbrido aqui) |
| `estadoConservacao` | texto 3-300 (livre, não é enum oficial) |
| `localizacao` | **código IBGE** (7 dígitos) |
| `veiculoCedido` | código `simNao` (0/1) |
| `orgaoDestVeicCedido` | texto 3-300 (opcional, só quando cedido) |
| `dataInicCessao` | `AAAA-MM-DD` (opcional, só quando cedido) |
| `dataFimCessao` | `AAAA-MM-DD` (opcional, só quando cedido) |

### Cód. 443 — Veículos Locados e Sublocados
Filtrar `origemVeiculo IN (3, 4)`.

**Cabeçalho:**
```
modelo;placa;renavam;anoFabricacao;anoModelo;tipoCombustivel;cpfOuCnpj;nomeLocador;localizacao;valorUnitMensal;possuiMotorista;codigoCw
```

| Campo | Regras |
| --- | --- |
| `modelo` | texto 3-300 |
| `placa` | placa válida (chave) |
| `renavam` | 11 dígitos |
| `anoFabricacao` | ≤ ano corrente |
| `anoModelo` | ≤ ano corrente + 1 |
| `tipoCombustivel` | código `tipoCombCSV` |
| `cpfOuCnpj` | 11 ou 14 dígitos, apenas números |
| `nomeLocador` | texto 3-300 |
| `localizacao` | **código IBGE** |
| `valorUnitMensal` | numérico > 0, 2 casas, separador `.` |
| `possuiMotorista` | código `simNao` (0/1) |
| `codigoCw` | padrão `CW-XXXXXX/XX` (ex.: `CW-123456/25`) |

## Regras de validação oficiais do TCE-PI

Extraídas de `/docs/*_regra-validacao.pdf` (mar–mai/2026). Implementar tanto no app quanto, idealmente, como constraints/triggers no Supabase.

### Para qualquer veículo (503, 443, 517)
- `anoFabricacao ≤ anoModelo`
- `anoFabricacao ≤ ano_corrente`
- `anoModelo ≤ ano_corrente + 1`

### Abastecimento (517)
- `kmInicial ≤ kmFinal`
- **Cruzada — Próprios/Cedidos (1.1.6):** todo abastecimento com `origemVeiculo ∈ {1,2}` exige que o veículo esteja no cadastro `503` (Mensal Final a partir de dez/2026, ou no PC mensal final 12/2025).
- **Cruzada — Locados/Sublocados (1.1.7):** todo abastecimento com `origemVeiculo ∈ {3,4}` exige que o veículo esteja no cadastro `443`.
- **Regra OUTROS (1.1.8):** quando `tipoVeiculo = 99`, OS QUATRO campos devem ser:
  - `renavam = 99999999999`
  - `placa` deve iniciar com `XYZ`
  - `kmInicial = 99999999`
  - `kmFinal = 99999999`
- **Regra anti-OUTROS (1.1.9):** quando `tipoVeiculo ≠ 99`, **nenhum** dos quatro pode ter o valor sentinela acima.
- **Híbrido:** quando `tipoCombustivel = HIBRIDO`, registrar apenas a capacidade e quantidade do **motor a combustão** (em litros), ignorando o componente elétrico.

### Próprios e Cedidos (503)
- Se `veiculoCedido = 1`:
  - `dataInicCessao ≤ último dia do mês de referência`
  - `dataFimCessao ≥ dataInicCessao`

### Locados e Sublocados (443)
- `valorUnitMensal > 0`
- CPF (quando `cpfOuCnpj` tem 11 dígitos) deve existir na Receita Federal — **validação externa**, não controlamos.

## Regras de negócio observadas no cliente.html

### Veículos
- Validação tipoVeiculo=99 já mapeada acima.
- Estado de conservação: o cliente.html usa um enum livre (Ótimo / Bom / Regular / Ruim / Inativo); o TCE só exige texto 3-300 chars. Manter o enum por UX, mas no banco aceitar livre.

### Saldo de contrato (fornecedor × combustível)
- Estrutura: `{ contrato: litros_total, atual: litros_disponiveis }`.
- `contrato = 0` significa **ilimitado** (não controla saldo).
- Emitir autorização → **debita** `atual`.
- Cancelar autorização → **restaura** `atual` (até o teto `contrato`).
- Editar qtd da autorização → ajusta pela diferença.
- Validar antes de emitir: `qtd ≤ atual` (se não for ilimitado).

### Autorização
- Numeração: `YYYYMMDD-NNN` (sequencial diário).
- Situações: `Emitida` → `Utilizada` (quando vira abastecimento) ou `Cancelada`.
- Só `Emitida` pode ser editada ou cancelada.
- QR Code carrega: `AUT:numero|VEI:placa|COMB:tipo|QTD:litros|DATA:data|SIT:situacao`.
- Validação: `qtd ≤ capacidade_tanque` do veículo.

### Abastecimento
- Pode ser manual ou importado de autorização (`autId` referenciando a autorização).
- Quando importado de autorização: marca a autorização como `Utilizada` e copia os dados.
- Quando vinculado a autorização, `qtd ≤ qtd_autorizada`.
- Ao deletar abastecimento importado, se for o único da autorização → autorização volta a `Emitida` (e saldo é restaurado).
- KM final pode ser atualizado depois (frentista preenche).
- Salvar abastecimento manual também atualiza `km` atual do veículo.

### Limite mensal de autorização por usuário (v2+)
- Cada usuário tem um campo opcional `limiteAut` (R$/mês). `0` = sem limite.
- Antes de emitir autorização, somar o **valor estimado** de todas as autorizações `Emitida`+`Utilizada` do mês corrente onde `responsavel = currentUser`.
- Se `usado + valor_nova_aut > limite` → **bloquear**.
- UI mostra card com barra de progresso na tela de Abastecimentos: utilizado / disponível / limite. Aviso amarelo a 80%, vermelho a 100%.
- O limite é por **responsável que emitiu a autorização**, não por veículo ou secretaria.

### Permissões do perfil "fornecedor" na tela de Autorizações (v3)
- Vê a lista de autorizações, mas **sem** botões de editar/cancelar/excluir — só imprimir, ver QR e visualizar.
- Pode abrir modal de fornecedor em modo **somente leitura** (função `viewFor`) — útil quando vê uma autorização e quer conferir dados do posto.

## O que NÃO replicar do cliente.html

O `cliente.html` foi gerado por IA e tem coisas que **não** vão pra produção:

- `localStorage` como persistência → vira Supabase.
- Senhas em texto plano no array `USERS` → vira Supabase Auth.
- Cadastro de Entidade na UI → vai ser fixo no banco, RO.
- Lista de IBGE inline no JS → vai virar tabela no Supabase (ou consulta).
- Tudo num arquivo HTML único → vai ser separado em arquivos JS/CSS modularizados.
- Workaround `</bo${''}dy>` em [cliente.html:1151](cliente.html#L1151) — existe pra contornar bug do VS Code Live Server, some quando reescrevermos.

## Status atual

- `cliente.html` no repo apenas como referência conceitual.
- `/docs` populado com **specs oficiais do TCE-PI** (manuais técnicos mar/2026, regras de validação mar–mai/2026, leiautes 2025, planilhas de domínio, CSVs de exemplo, lista IBGE). Tudo lido e consolidado neste arquivo.
- `modelagem.md` na raiz: proposta inicial de schema Supabase.
- Nada de código de produção escrito ainda.
- Próximos passos serão definidos pelo usuário (lembrete: **nunca começar sem perguntar**).

## Arquivos de referência em `/docs`

- `Leiautes-CSV-2025-Doc-Web-Publicado-em-08-04-2025.pdf` — leiaute consolidado (snake_case, desatualizado).
- `Abastecimento_manual-tecnico.pdf`, `Abastecimento_regra-validacao.pdf` — Cód. 517.
- `Veículos Próprios e Cedidos_manual-tecnico.pdf`, `_regra-validacao.pdf` — Cód. 503.
- `Veículos Locados e Sublocados_manual-tecnico.pdf`, `_regra-validacao.pdf` — Cód. 443.
- `Tipo de Veículos.xlsx`, `Tipo de Combustível.xlsx`, `Origem do Veículo.xlsx`, `Sim_Não.xlsx`, `Código do IBGE.xlsx` — tabelas de domínio oficiais.
- `Exemplo_csv_abastecimento.csv`, `Exemplo_csv_abastecimento (1).csv`, `Exemplo_csv_veiculospropcedidos.csv`, `Exemplo_csv_veiculoslocasublocados.csv`, `LOCADOS.csv` — exemplos reais.

## Mudanças observadas no `cliente_v4.html`

Quarta versão do mockup do cliente. Análise do diff `cliente_v3.html` → `cliente_v4.html`:

### Realmente novo (não existia antes)

1. **Datas de locação no cadastro de veículo** (origem 3 ou 4): campos `dtiniloc` / `dtfimloc` no bloco "Dados do Contrato de Locação". Validação: fim ≥ início. **Requer mudança no banco** (`lessor_lease_start_date`, `lessor_lease_end_date` em `vehicle`).
2. **Filtros de data nas exportações TCE 503 e 443**: agora as três telas de exportação (517 abastecimento, 503 próprios/cedidos, 443 locados) têm filtro de período. Pra 503 é "Data de Cessão"; pra 443 é "Data de Locação". **Não requer banco** — campos já existem; é só filtro no SELECT.
3. **Impressão térmica automática ao emitir autorização**: após `saveAut()`, chama `printAutTermica(novaAut.id)` que abre a janela de impressão. **Não requer banco.**
4. **Layout mobile dedicado**: header fixo no topo (título + nome + sair), bottom-nav com 5 botões (Início / Autorizações / Abastecimentos / Relatórios / Mais), e drawer "Mais" pras páginas secundárias. **Não requer banco.**

### Pedidos do cliente que JÁ ESTAVAM no v3 (cliente esqueceu)

- "Filtro por veículo em abastecimentos" — já existe desde v3 (`#f-abs-veic`).
- "Export por filtro em relatórios" — já existe desde v3 (`exportSecaoPDF`/`exportSecaoXLS` por seção: veículo, secretaria, fornecedor).

### Impacto consolidado no banco

Apenas **2 colunas novas** em `vehicle`:
```sql
alter table vehicle
  add column lessor_lease_start_date date,
  add column lessor_lease_end_date date,
  add constraint chk_lease_dates check (
    lessor_lease_end_date is null
    or lessor_lease_start_date is null
    or lessor_lease_end_date >= lessor_lease_start_date
  );
```

Não há mudança nos enums, nem nas tabelas TCE oficiais (essas datas são uso interno — o leiaute 443 não exige). Não há mudança em RPCs ou policies.

## Mudanças observadas no `cliente_v5.html`

Quinta versão. Diff `cliente_v4.html` → `cliente_v5.html`:

### Cliente reconheceu erro de códigos TCE e corrigiu (parcialmente)

- **Tipo de Veículo:** códigos agora batem com o oficial (descrições diferentes, irrelevante — exportação usa código numérico).
- **Origem do Veículo:** continua OK (falta só código 9 "Outras origens", que nosso schema tem).
- **Tipo de Combustível:** AINDA errado no cliente_v5 (2=Diesel em vez de Alcool etc). Nossa implementação está correta porque populamos as lookups direto dos XLSX oficiais — zero ação necessária.

### Cadastro de fornecedor ganhou 2 campos novos

- `f-sec` — **Secretaria de Origem do Contrato** (FK pra `department`, obrigatório no UI do cliente).
- `f-numcontrato` — **Nº / Ano do Contrato** (texto livre, ex. `012/2025`, opcional).

E filtro por secretaria na listagem (`f-for-sec`) — só frontend.

Cliente também mencionou "contato" no cadastro. A tabela `supplier` já tem `responsible_name` + `phone` desde o início — provavelmente é isso. Confirmar com cliente se quer mais (email, cargo) quando implementarmos a tela.

### Impacto no banco

```sql
alter table supplier
  add column if not exists department_id uuid references department(id),
  add column if not exists contract_number text;
create index if not exists ix_supplier_department on supplier (department_id);
```

Decisões em aberto:
- `department_id` nullable (não NOT NULL) — mais seguro porque permite fornecedores legados sem secretaria.
- `contract_number` sem CHECK de formato — deixar texto livre.

### Cliente removeu UI mobile customizado

A v4 trazia `MOBILE HEADER` + `BOTTOM NAV` + `MORE MENU` — sumiram na v5. Provavelmente porque nossa implementação mobile (drawer + topbar com logo + botão Instalar PWA) já cobre tudo. Sem ação.

## Lições aprendidas — antipadrões a evitar (sessão 01)

Falhas reais cometidas pelo Claude no início do projeto. Anote-se: o cliente é dev sênior, **antecipa problemas**. Toda vez que ele teve que reportar "deu erro X" por uma coisa óbvia, foi falha de antecipação minha. Padrões a internalizar:

### Supabase — checklist de antecipação

1. **GRANTs não são automáticos.** Toda nova tabela em `public` precisa de `GRANT ... TO authenticated`. Sem isso, RLS nem chega a rodar — Postgres bloqueia antes com `permission denied`. **Sempre incluir GRANTs no init.sql desde o início.**
2. **pgcrypto fica em `extensions`.** Funções como `crypt()` e `gen_salt()` precisam ser chamadas como `extensions.crypt()` e `extensions.gen_salt()` dentro de funções `SECURITY DEFINER`. O `search_path` padrão não inclui `extensions`.
3. **`auth.users.email` é `varchar(255)`, não `text`.** Em funções `RETURNS TABLE (... email text ...)`, fazer cast explícito (`u.email::text`) pra evitar `structure of query does not match function result type`.
4. **Operações admin em `auth.users` (create/delete/set_password) NÃO exigem Edge Function.** Dá pra fazer via RPC `SECURITY DEFINER` no Postgres — o owner (postgres) tem permissão no schema `auth`. Edge Function só vale quando a lógica precisa rodar fora do banco. **Não introduzir deploy extra (Edge Functions, CLI) sem necessidade real.**
5. **`getSession()` pode pendurar em ambientes exóticos.** Sempre usar timeout defensivo no boot.
5a. **`navigator.locks` "vaza" quando aba vai pra background.** O Supabase JS v2 usa Web Locks por default pra coordenar refresh de token entre abas. Aba fica em background → lock pendurado → ao voltar, qualquer query nova trava em loading infinito. **Solução obrigatória:** passar `lock: processLock` (importado da própria lib) no `createClient`. Complementar com listener `visibilitychange` que re-resolve a rota atual ao voltar (com guard pra não interromper modal aberto).
6. **Logout no SPA**: chamar `signOut()` + limpar localStorage residual + `history.replaceState` removendo hash + `location.reload()`. Evita race condition com handler `SIGNED_OUT` re-renderizando login enquanto reload está em curso.

### Frontend — checklist de antecipação

7. **SVG inline em `<button>` sem dimensão = render em 300x150 default.** Sempre regra CSS forçando tamanho (`.btn > svg { width: 16px; height: 16px; }`) desde o primeiro arquivo de estilos.
8. **CSS Grid com items de altura variável** (ex.: field com help text ao lado de field sem) → sempre `align-items: start` no grid + `align-content: start` nos items. Senão o input do field menor desce do topo (stretch).
9. **Esconder texto sem esconder ícone**: usar seletores específicos (`:not(.nav-icon)`) ao colapsar sidebar. Generalizações como `.nav-item span` escondem TUDO incluindo o ícone.
10. **Sidebar colapsada (~64px)**: footer não cabe avatar + botão lado a lado. Empilhar com `flex-direction: column`.
11. **Browser autofill ataca DEPOIS do JS render.** Prevenção precisa: `autocomplete="off"` + honeypots invisíveis + `setTimeout` clearing nos 100ms e 300ms.
12. **GitHub Pages serve arquivos estáticos.** ES Modules e Supabase JS funcionam direto via HTTP — só não pode ser `file://`. Live Server / python http.server / GitHub Pages, qualquer um serve.

### Processo — checklist de antecipação

13. **Patches são gambiarra de remendar engano.** Se gerar um patch.sql, consolidar imediatamente em um único `apply.sql` pra não confundir o usuário com vários arquivos sequenciais.
14. **`schema cache do PostgREST`**: novas funções RPC precisam de `notify pgrst, 'reload schema'` (ou reload no dashboard) pra serem chamáveis via REST. Incluir no patch sempre.
15. **Testar mentalmente o fluxo end-to-end antes de entregar.** Se o entregável requer um passo manual extra ("agora faça deploy de X"), é red flag — vale buscar alternativa que funcione direto.
16. **Quando o cliente diz "antecipe os problemas"**, é literal: parar de entregar coisa que sabidamente vai dar erro com bilhete "se der erro, fazemos depois". Ou faz funcionar, ou avisa explicitamente que não é pra usar ainda.
17. **Mudanças no `init.sql` devem refletir no `apply.sql` E vice-versa** — uma nova cidade deve ter exatamente o mesmo schema da existente.
- `Exemplo_csv_abastecimento.csv`, `Exemplo_csv_abastecimento (1).csv`, `Exemplo_csv_veiculospropcedidos.csv`, `Exemplo_csv_veiculoslocasublocados.csv`, `LOCADOS.csv` — exemplos reais.
