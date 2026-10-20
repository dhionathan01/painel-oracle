# Métricas do painel: o que são e de onde vêm

Para cada bloco do painel: a view do Oracle de origem, como o número é calculado e como interpretar.

## Identificação

| Campo | Origem | Leitura |
| --- | --- | --- |
| Instância | `V$INSTANCE.INSTANCE_NAME` | Nome da instância (processos + memória). No Oracle Free é `FREE`. |
| Status | `V$INSTANCE.STATUS` | `STARTED` → `MOUNTED` → `OPEN`. Só em `OPEN` os usuários conseguem trabalhar. |
| Banco | `V$DATABASE.NAME`, `OPEN_MODE`, `LOG_MODE` | `READ WRITE` = aceita alterações. `NOARCHIVELOG` = redo não é arquivado, então não dá para fazer recuperação até um ponto no tempo (normal em laboratório). |
| Container atual | `SYS_CONTEXT('USERENV','CON_NAME')` | Arquitetura multitenant: o CDB (`CDB$ROOT`) contém PDBs. O painel lê o PDB `FREEPDB1`, onde estão os dados das aplicações. |
| No ar há | `V$INSTANCE.STARTUP_TIME` | Tempo desde o último startup. Importante porque os números acumulados (waits, SQL) zeram no restart. |

## Indicadores (cards)

| Card | Cálculo | Leitura |
| --- | --- | --- |
| Sessões de usuário | `COUNT(*) FROM V$SESSION WHERE TYPE='USER'` | Conexões abertas. Inclui as ociosas, como o pool do ORDS. |
| Ativas agora | idem + `STATUS='ACTIVE'` | Sessões executando algo neste instante. É o melhor termômetro de "carga agora". |
| Bloqueadas | `BLOCKING_SESSION IS NOT NULL AND EVENT LIKE 'enq:%'` | Sessões paradas esperando lock de outra. Deveria ser **0**. Se for maior que zero, o card fica vermelho e aparece o alerta. |
| Sessões ativas médias (AAS) | `V$SYSMETRIC` → `Average Active Sessions` | Média de sessões ativas no último minuto (DB time ÷ tempo real). Compare com o número de CPUs: o Oracle Free usa até 2 threads, então AAS acima de 2 indica fila. |
| CPU do host | `V$SYSMETRIC` → `Host CPU Utilization (%)` | Uso de CPU da máquina (container). Acima de 85% em amarelo/vermelho. |
| Execuções/s | `V$SYSMETRIC` → `Executions Per Sec` | Quantos comandos SQL por segundo. Mede o volume de trabalho. |

Todos os cards vêm de uma única view, `VW_RESUMO`. A sessão que faz a consulta (o próprio painel) é excluída das contagens.

## Linha do tempo

- **Origem:** tabela `METRICAS_HIST`, preenchida pelo job `JOB_COLETA_METRICAS` (`DBMS_SCHEDULER`, `FREQ=SECONDLY;INTERVAL=15`) com um `INSERT ... SELECT FROM VW_RESUMO`.
- **Retenção:** 24 horas (a própria procedure apaga o que é mais antigo).
- **Por quê:** as `V$` são uma foto do momento. Para ver tendência é preciso guardar fotos. É a mesma ideia do AWR (que tira snapshots de hora em hora), em versão bem simplificada.

## Esperas (waits)

O Oracle registra tudo o que uma sessão espera: disco, lock, rede, commit. Quando a sessão não está esperando, está em CPU.

| Aba | Origem | Leitura |
| --- | --- | --- |
| Agora | `V$SESSION` (`STATE`, `EVENT`, `WAIT_CLASS`) das sessões ativas | Foto do momento. `STATE='WAITING'` = esperando o `EVENT`. Qualquer outro estado = em CPU. |
| Desde o startup | `V$SYSTEM_EVENT` (`TIME_WAITED_MICRO`) | Total acumulado por evento. Mostra a história, então um problema que já passou continua aparecendo aqui. |

A classe `Idle` (ex.: `SQL*Net message from client`) é excluída: é a sessão esperando o usuário mandar algo, não é problema do banco.

Eventos que costumam aparecer:

| Evento | Classe | Significado |
| --- | --- | --- |
| `enq: TX - row lock contention` | Application | Esperando outra sessão liberar uma linha (falta COMMIT do outro lado). |
| `db file sequential read` | User I/O | Leitura de um bloco do disco, típica de acesso por índice. |
| `db file scattered read` / `direct path read` | User I/O | Leitura de vários blocos, típica de full table scan. |
| `log file sync` | Commit | O COMMIT esperando o LGWR gravar o redo em disco. |
| `latch` / `library cache` | Concurrency | Disputa por estruturas de memória. |

## Sessões ativas agora

`V$SESSION`: SID, usuário, `MODULE` (a carga marca `CONSULTA`, `CPU`, `LOCK_DONO`, `LOCK_FILA` via `DBMS_APPLICATION_INFO.SET_MODULE`), atividade (evento ou "Em CPU"), `LAST_CALL_ET` (segundos desde o início da chamada atual) e `SQL_ID`.

## Bloqueios

Auto-join em `V$SESSION`: a sessão bloqueada (`w`) aponta para a bloqueadora pela coluna `BLOCKING_SESSION` (`b.sid = w.blocking_session`). Para resolver: o bloqueador dá COMMIT/ROLLBACK, ou o DBA executa `ALTER SYSTEM KILL SESSION 'sid,serial#' IMMEDIATE`.

## SQLs mais custosos

`V$SQLAREA`, ordenado por `ELAPSED_TIME` (tempo total de todas as execuções):

| Coluna | Significado |
| --- | --- |
| Execuções | `EXECUTIONS` |
| Tempo total / CPU | `ELAPSED_TIME`, `CPU_TIME` (em microssegundos, convertidos para s). Se o tempo total for muito maior que a CPU, o SQL passa a maior parte do tempo esperando (ex.: o `UPDATE` bloqueado). |
| ms/execução | tempo total ÷ execuções. Separa o "lento" do "executado muitas vezes". |
| Leituras lógicas | `BUFFER_GETS`: blocos lidos da memória. É o principal custo de um SQL. |
| Leituras físicas | `DISK_READS`: blocos que precisaram vir do disco. |

Ao clicar no SQL_ID, o painel mostra o comando para ver o plano: `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('<sql_id>'));`

## Tablespaces

`DBA_TABLESPACE_USAGE_METRICS` (em blocos) × `DBA_TABLESPACES.BLOCK_SIZE`. O percentual é sobre o tamanho **máximo** (considera o autoextend). Faixas: < 75% ok, 75–85% atenção, > 85% crítico. Quando enche: `ORA-01653: unable to extend table`.

## Estatísticas gerais

`V$SYSMETRIC`, grupo 2 (médias de 60 s calculadas pelo próprio Oracle). Destaques:

- **Database Time Per Sec**: centésimos de segundo de DB time por segundo. ÷100 ≈ AAS.
- **Database Wait Time Ratio / CPU Time Ratio**: quanto do DB time foi espera × CPU. Muita espera indica gargalo fora da CPU (I/O, lock).
- **Buffer Cache Hit Ratio**: % de leituras atendidas pela memória. É um indicador clássico, mas sozinho não prova nada.
- **Logons Per Sec**: muitos logons por segundo indicam aplicação sem pool de conexões.

## Carga de laboratório

| Perfil | CONSULTA | CPU | LOCK_DONO | LOCK_FILA | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| LEVE | 2 | 1 | 1 | 1 | 5 |
| MEDIA | 3 | 2 | 1 | 2 | 8 |
| PESADA | 5 | 3 | 1 | 3 | 12 |

- **CONSULTA**: full scan + `GROUP BY` em `VENDAS` (300 mil linhas, sem índice nas colunas filtradas). Aparece no top de SQL com muitas leituras lógicas.
- **CPU**: laço PL/SQL de 3 milhões de iterações. Sessão "Em CPU".
- **LOCK_DONO**: `UPDATE estoque ... WHERE id = 1` e espera 10 s antes do COMMIT.
- **LOCK_FILA**: o mesmo UPDATE na mesma linha, então fica bloqueado com `enq: TX - row lock contention`.

Cada tipo roda num job do `DBMS_SCHEDULER` (uma sessão cada) até o tempo acabar ou alguém chamar `PKG_CARGA.PARAR`.
