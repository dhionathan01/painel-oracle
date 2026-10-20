#!/usr/bin/env bash
# =====================================================================
# Roda os scripts SQL 01 a 05 na ordem certa, dentro do container.
# Pré-requisito: "docker compose up -d" na pasta docker/ e o banco healthy.
#
# Uso (na raiz do projeto):
#   bash scripts/configurar.sh
# =====================================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-painel-oracle-db}"
ORACLE_PWD="${ORACLE_PWD:-OraclePwd123}"
ORDS_URL="${ORDS_URL:-http://localhost:8181}"
PDB="//localhost:1521/FREEPDB1"

rodar_sql() {
  local conexao="$1" arquivo="$2"
  echo
  echo "==> ${arquivo}"
  # "exit" no stdin encerra o sqlplus ao final do script
  echo "exit" | docker exec -i "${DB_CONTAINER}" \
    sqlplus -s -L "${conexao}" "@/opt/painel/sql/${arquivo}"
}

echo "==> Aguardando o banco ficar healthy..."
until [ "$(docker inspect -f '{{.State.Health.Status}}' "${DB_CONTAINER}" 2>/dev/null)" = "healthy" ]; do
  printf '.'; sleep 10
done
echo " ok"

rodar_sql "sys/${ORACLE_PWD}@${PDB} as sysdba" 01_usuarios_e_grants.sql
rodar_sql "painel_mon/PainelMon123@${PDB}"     02_views_monitoramento.sql
rodar_sql "painel_mon/PainelMon123@${PDB}"     03_historico_scheduler.sql
rodar_sql "carga_lab/CargaLab123@${PDB}"       04_carga_lab.sql

echo
echo "==> Aguardando o ORDS responder em ${ORDS_URL}/ords/ (a 1a instalação demora)..."
until [ "$(curl -s -o /dev/null -w '%{http_code}' "${ORDS_URL}/ords/")" != "000" ]; do
  printf '.'; sleep 10
done
echo " ok"

rodar_sql "painel_mon/PainelMon123@${PDB}"     05_ords_modulo.sql

echo
echo "==> Teste da API:"
curl -s "${ORDS_URL}/ords/painel/monitor/health"; echo
echo
echo "Pronto! Abra o painel em: ${ORDS_URL}/painel/index.html"
