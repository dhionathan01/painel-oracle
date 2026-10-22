-- =====================================================================
-- 01 - Usuários e permissões
-- Executar como SYS (AS SYSDBA) conectado no PDB FREEPDB1.
--   docker exec -it painel-oracle-db sqlplus sys/OraclePwd123@//localhost:1521/FREEPDB1 as sysdba
--   SQL> @/opt/painel/sql/01_usuarios_e_grants.sql
--
-- Por que SYS? Só o dono das views V$ (SYS) consegue conceder SELECT
-- nelas a outro usuário. O SYSTEM lê, mas não pode repassar.
--
-- ATENÇÃO: o script recria os usuários (DROP ... CASCADE). Rodar de novo
-- apaga views, histórico e o módulo ORDS: depois rode os scripts 02 a 05.
-- =====================================================================
WHENEVER SQLERROR EXIT FAILURE
SET ECHO ON

-- ---------------------------------------------------------------------
-- Limite de jobs simultâneos do DBMS_SCHEDULER. O Oracle Free vem com 4,
-- o que não cabe a carga MEDIA (8 jobs) + PESADA (12) + o job de coleta.
-- O teto vale para o CDB inteiro, por isso é ajustado no root e no PDB.
-- ---------------------------------------------------------------------
ALTER SESSION SET CONTAINER = CDB$ROOT;
ALTER SYSTEM SET job_queue_processes = 20 SCOPE = BOTH;

ALTER SESSION SET CONTAINER = FREEPDB1;
ALTER SYSTEM SET job_queue_processes = 20 SCOPE = BOTH;

-- ---------------------------------------------------------------------
-- Para poder rodar este script de novo: o DROP USER falha (ORA-01940)
-- se o usuário estiver conectado, e ele fica conectado pelo pool do ORDS,
-- pelo job de coleta e pelos jobs de carga. Então: trava as contas (nada
-- novo conecta), apaga os jobs e encerra as sessões que sobraram.
-- ---------------------------------------------------------------------
DECLARE
  v_restantes PLS_INTEGER;
BEGIN
  FOR u IN (SELECT username FROM dba_users
            WHERE  username IN ('PAINEL_MON', 'CARGA_LAB')) LOOP
    EXECUTE IMMEDIATE 'ALTER USER ' || u.username || ' ACCOUNT LOCK';
  END LOOP;
  FOR j IN (SELECT owner, job_name FROM dba_scheduler_jobs
            WHERE  owner IN ('PAINEL_MON', 'CARGA_LAB')) LOOP
    DBMS_SCHEDULER.DROP_JOB(j.owner || '.' || j.job_name, force => TRUE);
  END LOOP;
  FOR s IN (SELECT sid, serial# AS serial FROM v$session
            WHERE  username IN ('PAINEL_MON', 'CARGA_LAB')) LOOP
    BEGIN
      EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ''' || s.sid || ',' || s.serial || ''' IMMEDIATE';
    EXCEPTION
      WHEN OTHERS THEN NULL;  -- a sessão já tinha terminado
    END;
  END LOOP;
  -- o KILL é assíncrono: espera até 30 s as sessões sumirem
  FOR i IN 1 .. 30 LOOP
    SELECT COUNT(*) INTO v_restantes FROM v$session
    WHERE  username IN ('PAINEL_MON', 'CARGA_LAB');
    EXIT WHEN v_restantes = 0;
    DBMS_SESSION.SLEEP(1);
  END LOOP;
END;
/

-- ---------------------------------------------------------------------
-- PAINEL_MON: dono das views de monitoramento, do histórico e do
-- módulo REST publicado no ORDS. Só tem LEITURA nas views do sistema.
-- ---------------------------------------------------------------------
DROP USER IF EXISTS painel_mon CASCADE;

CREATE USER painel_mon IDENTIFIED BY "PainelMon123"
  DEFAULT TABLESPACE users
  QUOTA 50M ON users;

GRANT CREATE SESSION, CREATE VIEW, CREATE TABLE,
      CREATE PROCEDURE, CREATE JOB TO painel_mon;

-- Grants DIRETOS (não via role): views e procedures só enxergam
-- privilégios concedidos diretamente ao dono.
GRANT SELECT ON sys.v_$instance                  TO painel_mon;
GRANT SELECT ON sys.v_$database                  TO painel_mon;
GRANT SELECT ON sys.v_$session                   TO painel_mon;
GRANT SELECT ON sys.v_$system_event              TO painel_mon;
GRANT SELECT ON sys.v_$sqlarea                   TO painel_mon;
-- No 26ai, V$SYSMETRIC vem vazia dentro do PDB: as métricas do PDB
-- ficam em V$CON_SYSMETRIC. V$PARAMETER é só para ler o cpu_count.
GRANT SELECT ON sys.v_$con_sysmetric             TO painel_mon;
GRANT SELECT ON sys.v_$parameter                 TO painel_mon;
GRANT SELECT ON sys.dba_tablespaces              TO painel_mon;
GRANT SELECT ON sys.dba_tablespace_usage_metrics TO painel_mon;

-- ---------------------------------------------------------------------
-- CARGA_LAB: schema de laboratório que gera atividade no banco
-- (consultas pesadas, CPU e bloqueios) para o painel ter o que mostrar.
-- ---------------------------------------------------------------------
DROP USER IF EXISTS carga_lab CASCADE;

CREATE USER carga_lab IDENTIFIED BY "CargaLab123"
  DEFAULT TABLESPACE users
  QUOTA 200M ON users;

-- CREATE JOB: a carga roda em jobs do DBMS_SCHEDULER (uma sessão por job)
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW,
      CREATE PROCEDURE, CREATE JOB TO carga_lab;

SELECT username, account_status, default_tablespace
FROM   dba_users
WHERE  username IN ('PAINEL_MON', 'CARGA_LAB');

SET ECHO OFF
PROMPT >>> 01 concluído. Próximo: 02_views_monitoramento.sql (como PAINEL_MON)
