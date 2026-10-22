-- =====================================================================
-- Consultas de monitoramento "puras" (direto nas V$), para estudar e
-- demonstrar no DBeaver / SQL Developer. São as mesmas lógicas que
-- viraram views no script 02.
-- Conectar como SYSTEM (ou PAINEL_MON) no FREEPDB1.
-- =====================================================================

-- 1) Instância, banco e container ---------------------------------------
SELECT instance_name, host_name, version_full, status, database_status,
       startup_time
FROM   v$instance;

SELECT name, open_mode, log_mode
FROM   v$database;

SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS container_atual FROM dual;

-- 2) Sessões por usuário e status ---------------------------------------
SELECT username, status, COUNT(*) AS total
FROM   v$session
WHERE  type = 'USER'
GROUP  BY username, status
ORDER  BY total DESC;

-- 3) O que as sessões ativas estão fazendo agora ------------------------
SELECT sid, serial#, username, module, sql_id, state,
       CASE WHEN state = 'WAITING' THEN event ELSE 'Em CPU' END AS atividade,
       wait_class, last_call_et, blocking_session
FROM   v$session
WHERE  type = 'USER'
AND    status = 'ACTIVE'
ORDER  BY last_call_et DESC;

-- 4) Bloqueios: quem espera por quem ------------------------------------
SELECT w.sid AS bloqueada, w.username, w.event, w.last_call_et AS segundos,
       b.sid AS bloqueador, b.username AS usuario_bloqueador, b.status
FROM   v$session w
JOIN   v$session b ON b.sid = w.blocking_session
WHERE  w.event LIKE 'enq:%';

-- Para "destravar" numa demonstração (como SYSTEM/SYS), mate o bloqueador:
-- ALTER SYSTEM KILL SESSION '<sid>,<serial#>' IMMEDIATE;

-- 5) Waits acumulados desde o startup -----------------------------------
SELECT event, wait_class, total_waits,
       ROUND(time_waited_micro / 1e6, 2) AS segundos
FROM   v$system_event
WHERE  wait_class <> 'Idle'
ORDER  BY time_waited_micro DESC
FETCH  FIRST 10 ROWS ONLY;

-- 6) SQLs mais custosos -------------------------------------------------
SELECT sql_id, parsing_schema_name, executions,
       ROUND(elapsed_time / 1e6, 2) AS tempo_total_s,
       ROUND(cpu_time / 1e6, 2)     AS cpu_s,
       buffer_gets, disk_reads,
       SUBSTR(sql_text, 1, 120)     AS sql_texto
FROM   v$sqlarea
WHERE  parsing_schema_name <> 'SYS'
ORDER  BY elapsed_time DESC
FETCH  FIRST 10 ROWS ONLY;

-- Texto completo e plano de um SQL específico:
-- SELECT sql_fulltext FROM v$sqlarea WHERE sql_id = '&sql_id';
-- SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&sql_id'));

-- 7) Tablespaces --------------------------------------------------------
SELECT m.tablespace_name,
       ROUND(m.used_space      * t.block_size / 1048576, 1) AS usado_mb,
       ROUND(m.tablespace_size * t.block_size / 1048576, 1) AS maximo_mb,
       ROUND(m.used_percent, 1)                             AS pct
FROM   dba_tablespace_usage_metrics m
JOIN   dba_tablespaces t ON t.tablespace_name = m.tablespace_name
ORDER  BY m.used_percent DESC;

-- 8) Estatísticas gerais (último minuto) --------------------------------
-- No PDB do 26ai a V$SYSMETRIC vem vazia: use V$CON_SYSMETRIC (grupo 18).
-- Conectado no CDB$ROOT, a V$SYSMETRIC (grupo 2) volta a funcionar.
SELECT metric_name, ROUND(value, 2) AS valor, metric_unit
FROM   v$con_sysmetric
WHERE  group_id = 18
AND    metric_name IN ('Average Active Sessions', 'CPU Usage Per Sec',
                       'Executions Per Sec', 'User Transaction Per Sec',
                       'Buffer Cache Hit Ratio')
ORDER  BY metric_name;

-- 9) Job de histórico e jobs de carga -----------------------------------
SELECT owner, job_name, state, repeat_interval, run_count, last_start_date
FROM   dba_scheduler_jobs
WHERE  owner IN ('PAINEL_MON', 'CARGA_LAB');
