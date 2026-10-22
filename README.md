# Painel Oracle — Dashboard de estatísticas com ORDS

Trabalho final · Grupo 1 · Oracle ADM — MBA em Engenharia de Dados (PUC Minas)

> **Integrantes:** _preencher_

Dashboard simples que mostra, em tempo quase real, o estado de um Oracle AI Database 26ai Free: instância, sessões, esperas, bloqueios, SQLs mais custosos e uso de tablespaces. Os dados saem das views administrativas do Oracle, viram API REST no **ORDS** e aparecem num painel HTML que se atualiza sozinho.

```text
Oracle AI Database 26ai Free (FREEPDB1)
  ├─ V$INSTANCE, V$DATABASE, V$SESSION, V$SYSTEM_EVENT,
  │  V$SQLAREA, V$CON_SYSMETRIC, DBA_TABLESPACE_USAGE_METRICS
  │        │
  │        ▼
  ├─ views VW_* no schema PAINEL_MON  ──►  job DBMS_SCHEDULER (15 s) ──► METRICAS_HIST
  │        │
  │        ▼
  └─ ORDS: módulo REST "monitor"  (GET /stats/*, POST /carga/*)
           │
           ▼
     Painel HTML/CSS/JS servido pelo próprio ORDS  (atualiza a cada 5/10/30 s)
```

## O que tem de diferente

| Recurso | Por que importa |
| --- | --- |
| **Views `VW_*` como contrato** | Toda a lógica SQL fica no banco, numa view por métrica. O ORDS só faz `SELECT * FROM view`, e na apresentação dá para abrir a view e mostrar de onde vem cada número. |
| **Histórico com `DBMS_SCHEDULER`** | As `V$` só mostram o agora. Um job grava uma foto a cada 15 s, e o painel desenha a linha do tempo. |
| **Bloqueios em destaque** | `/stats/bloqueios` mostra quem bloqueia quem (`BLOCKING_SESSION`) e o painel exibe um alerta vermelho. |
| **Waits "agora" × "acumulados"** | Mostra a diferença entre o momento (`V$SESSION`) e a história desde o startup (`V$SYSTEM_EVENT`). |
| **Carga gerada dentro do Oracle** | O botão **Gerar carga** chama um `POST` no ORDS que cria jobs PL/SQL: full scans, CPU e duas sessões disputando a mesma linha. Não precisa de nenhum script externo. |
| **ORDS serve o próprio painel** | O HTML fica no *doc root* do ORDS, com mesma origem da API. Não precisa de servidor web extra nem de configurar CORS. |
| **Explicação em cada bloco** | Cada painel tem um "ⓘ Como ler" com a interpretação da métrica. |

## Estrutura

```text
painel-oracle/
├── README.md
├── docker/
│   ├── compose.yaml            Oracle 26ai Free 23.26.3.0 + ORDS 26.3.0 (versões travadas)
│   └── .env.example            senhas/portas (opcional)
├── sql/
│   ├── 01_usuarios_e_grants.sql    SYS      → cria PAINEL_MON e CARGA_LAB + grants nas V$
│   ├── 02_views_monitoramento.sql  PAINEL_MON → views VW_*
│   ├── 03_historico_scheduler.sql  PAINEL_MON → tabela METRICAS_HIST + job
│   ├── 04_carga_lab.sql            CARGA_LAB  → tabelas + PKG_CARGA
│   ├── 05_ords_modulo.sql          PAINEL_MON → módulo REST no ORDS
│   └── consultas.sql               consultas "puras" para estudo no DBeaver
├── web/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── scripts/
│   ├── configurar.sh           roda os SQL 01→05 na ordem (macOS/Linux/Git Bash)
│   ├── configurar.ps1          o mesmo, para Windows (PowerShell)
│   └── mock_ords.py            API falsa para mexer no visual sem Oracle
└── docs/
    ├── guia_de_estudo.md       COMECE AQUI: objetivo, cada bloco da tela, perguntas do professor
    ├── metricas.md             o que cada métrica significa e de onde vem
    └── roteiro_apresentacao.md
```

> **Vai apresentar?** Leia primeiro [`docs/guia_de_estudo.md`](docs/guia_de_estudo.md): o objetivo, o que cada bloco da tela mostra, os conceitos e as perguntas prováveis do professor, com as respostas.

## Versões (travadas)

| Componente | Imagem | Por que travar |
| --- | --- | --- |
| Banco | `container-registry.oracle.com/database/free:23.26.3.0` (Oracle AI Database 26ai Free) | A tag `latest` muda sem aviso. |
| ORDS | `container-registry.oracle.com/database/ords:26.3.0` | O ORDS 26.x passou a exigir `ORACLE_USER_PWD` e o `standalone.doc.root`. Com `latest`, o projeto quebrou da noite para o dia. |

Para atualizar, troque as duas tags no `docker/compose.yaml` juntas e refaça o teste ponta a ponta.

## Pré-requisitos

- Docker Desktop (ou Docker Engine) com Docker Compose
- 8 GB de RAM livres para o Docker e ~15 GB de disco
- Opcional: DBeaver/SQL Developer para explorar as consultas

## Como rodar

### 1. Subir Oracle + ORDS

```bash
cd docker
docker login container-registry.oracle.com   # só se o pull pedir login
docker compose up -d
docker compose ps        # espere o "oracle" ficar (healthy)
```

A primeira subida demora de 5 a 15 minutos: o Docker baixa as imagens, cria o banco e depois instala o ORDS. Antes do ORDS roda o serviço `ords-permissoes`, que só acerta o dono da pasta de configuração e sai (aparecer como `Exited (0)` no `docker compose ps -a` é o esperado). Para acompanhar:

```bash
docker compose logs -f oracle   # até aparecer DATABASE IS READY TO USE
docker compose logs -f ords     # até aparecer que o ORDS está escutando na 8080
```

### 2. Configurar o banco e a API

**macOS / Linux / Git Bash:** da raiz do projeto:

```bash
bash scripts/configurar.sh
```

**Windows (PowerShell):** da raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\configurar.ps1
```

Os dois scripts fazem a mesma coisa: rodam os SQL 01 a 05 na ordem, esperam o ORDS, configuram o `standalone.doc.root` (sem isso o ORDS 26 não serve o painel) e testam o `/health`. Podem ser rodados de novo a qualquer momento, porque o 01 recria tudo do zero.

**Passo a passo manual:** rode, na ordem:

```bash
docker exec -it painel-oracle-db sqlplus "sys/OraclePwd123@//localhost:1521/FREEPDB1 as sysdba" @/opt/painel/sql/01_usuarios_e_grants.sql
docker exec -it painel-oracle-db sqlplus painel_mon/PainelMon123@//localhost:1521/FREEPDB1 @/opt/painel/sql/02_views_monitoramento.sql
docker exec -it painel-oracle-db sqlplus painel_mon/PainelMon123@//localhost:1521/FREEPDB1 @/opt/painel/sql/03_historico_scheduler.sql
docker exec -it painel-oracle-db sqlplus carga_lab/CargaLab123@//localhost:1521/FREEPDB1 @/opt/painel/sql/04_carga_lab.sql
# só depois que o ORDS terminou de instalar:
docker exec -it painel-oracle-db sqlplus painel_mon/PainelMon123@//localhost:1521/FREEPDB1 @/opt/painel/sql/05_ords_modulo.sql
```

```bash
# por fim, o doc_root do painel (obrigatório no ORDS 26.x):
docker exec painel-oracle-ords ords --config /etc/ords/config config set standalone.doc.root /etc/ords/config/global/standalone/doc_root
docker restart painel-oracle-ords
```

(digite `exit` ao final de cada um, se o sqlplus ficar aguardando)

Se preferir o DBeaver, abra os mesmos arquivos da pasta `sql/` e execute como script (Alt+X), conectado com o usuário indicado no cabeçalho de cada arquivo (Host `localhost`, porta `1522`, service `FREEPDB1`).

### 3. Abrir o painel

```text
http://localhost:8181/painel/index.html
```

Clique em **Gerar carga** e acompanhe sessões, esperas, bloqueios e o gráfico mudando.

## Endpoints

Base: `http://localhost:8181/ords/painel/monitor`

| Método | Caminho | Fonte | Retorno |
| --- | --- | --- | --- |
| GET | `/health` | `DUAL` | status da API, horário do banco |
| GET | `/stats/instancia` | `VW_INSTANCIA` | instância, banco, container (objeto) |
| GET | `/stats/resumo` | `VW_RESUMO` | números dos cards (objeto) |
| GET | `/stats/metricas` | `VW_METRICAS_SISTEMA` | estatísticas gerais |
| GET | `/stats/sessoes` | `VW_SESSOES_RESUMO` | sessões por usuário e status |
| GET | `/stats/sessoes/ativas` | `VW_SESSOES_ATIVAS` | o que cada sessão ativa faz |
| GET | `/stats/bloqueios` | `VW_BLOQUEIOS` | quem bloqueia quem |
| GET | `/stats/waits/agora` | `VW_ESPERAS_AGORA` | esperas do momento |
| GET | `/stats/waits/acumulados` | `VW_WAITS_ACUMULADOS` | top 10 desde o startup |
| GET | `/stats/sql` | `VW_SQL_TOP` | top 10 SQLs por tempo |
| GET | `/stats/tablespaces` | `VW_TABLESPACES` | uso dos tablespaces |
| GET | `/stats/historico?minutos=30` | `VW_HISTORICO` | linha do tempo |
| GET | `/carga/status` | `CARGA_LAB.VW_CARGA_STATUS` | situação da carga (objeto) |
| POST | `/carga/iniciar` | `PKG_CARGA.INICIAR` | body `{"perfil":"MEDIA","minutos":3}` |
| POST | `/carga/parar` | `PKG_CARGA.PARAR` | — |

Teste rápido:

```bash
curl http://localhost:8181/ords/painel/monitor/stats/resumo
curl -X POST -H "Content-Type: application/json" \
     -d '{"perfil":"LEVE","minutos":2}' \
     http://localhost:8181/ords/painel/monitor/carga/iniciar
```

## Usuários criados

| Usuário | Senha (lab) | Papel |
| --- | --- | --- |
| `PAINEL_MON` | `PainelMon123` | Dono das views, do histórico e do módulo ORDS. Só tem **SELECT** nas views do sistema (privilégio mínimo). |
| `CARGA_LAB` | `CargaLab123` | Tabelas `VENDAS` (300 mil linhas) e `ESTOQUE`, e o pacote `PKG_CARGA`. |

Os grants nas `V$` são **diretos** e não via role, porque views e procedures só enxergam privilégios concedidos diretamente ao dono.

O script 01 também sobe o `job_queue_processes` para 20 (no CDB root e no PDB). O Free vem com 4, que não cabe a carga de laboratório.

## Desenvolvendo o visual sem Oracle

```bash
python3 scripts/mock_ords.py
# http://localhost:8181/painel/index.html
```

Ele responde nos mesmos caminhos e com os mesmos campos do ORDS real, com números aleatórios. O botão de carga também funciona. Use só com o ORDS real parado, porque a porta é a mesma.

## Problemas comuns

| Sintoma | Causa provável / solução |
| --- | --- |
| `docker compose up` falha no pull | Rode `docker login container-registry.oracle.com` (conta Oracle gratuita) e tente de novo. |
| ORDS cai com `Required variable ORACLE_USER_PWD is missing` | Compose antigo, sem a variável. Ela já está no `compose.yaml` (senha do `ORDS_PUBLIC_USER`, padrão `OrdsPublic123`). |
| ORDS cai com `The Oracle REST Data Services installation has failed` logo após `settings.xml` | A pasta `global/` do volume ficou com dono root. O serviço `ords-permissoes` resolve. Se o volume for antigo, rode `docker compose down -v` e suba de novo. |
| Script 05 dá `PLS-00201: identifier 'ORDS.ENABLE_SCHEMA'` | O ORDS ainda não terminou de instalar. Espere o log do container `ords` e rode o 05 de novo. |
| Painel abre, mas um bloco mostra erro | Rode o endpoint no navegador para ver a mensagem. Normalmente é um grant faltando, então rode o script 01 e depois 02 a 05. |
| `/ords/painel/...` dá 404 | O script 05 não rodou ou deu erro. Rode de novo como `PAINEL_MON`. |
| `/painel/index.html` dá 404 | Quase sempre falta o `standalone.doc.root`: rode o `configurar` de novo (ou só os dois comandos do doc_root acima) e dê Ctrl+F5. Se persistir, o volume da pasta `web` não montou: `docker compose up -d --force-recreate ords`. Alternativa: `cd web && python -m http.server 5500` e abra `http://localhost:5500` (o CORS para essa porta já está liberado). |
| "Estatísticas gerais" vazia ou AAS/CPU com "—" | `V$CON_SYSMETRIC` só tem valores 1 minuto após o startup. Se continuar vazio, confira se as views usam `V$CON_SYSMETRIC` (no 26ai a `V$SYSMETRIC` vem vazia dentro do PDB). |
| Carga Média/Pesada mostra só 2 a 4 sessões | `job_queue_processes` baixo (o Free vem com 4). O script 01 sobe para 20. Confira com `SHOW PARAMETER job_queue_processes` no root e no PDB. |
| Script 01 dá `ORA-01940: cannot drop a user who is currently connected` | Versão antiga do 01. A atual trava as contas, apaga os jobs e encerra as sessões antes do `DROP`. |
| Gráfico sem pontos | O job grava a cada 15 s. Confira com `SELECT job_name, state FROM user_scheduler_jobs;` como `PAINEL_MON`. |
| Precisa recomeçar do zero | `docker compose down -v` apaga **tudo** (banco e config do ORDS). |

## Segurança (laboratório)

As senhas estão no código e os endpoints são públicos porque é um ambiente local de aula. Em produção usaríamos `.env` fora do Git, privilégios ORDS/OAuth nos módulos e não exporíamos o `POST /carga/*`.
