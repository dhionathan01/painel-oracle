# =====================================================================
# Versão Windows (PowerShell) do configurar.sh: roda os scripts SQL
# 01 a 05 na ordem certa, dentro do container, e ajusta o doc_root do ORDS.
# Pré-requisito: "docker compose up -d" na pasta docker/.
#
# Uso (na raiz do projeto):
#   powershell -ExecutionPolicy Bypass -File scripts\configurar.ps1
# =====================================================================
$ErrorActionPreference = 'Stop'

$DbContainer   = if ($env:DB_CONTAINER)   { $env:DB_CONTAINER }   else { 'painel-oracle-db' }
$OrdsContainer = if ($env:ORDS_CONTAINER) { $env:ORDS_CONTAINER } else { 'painel-oracle-ords' }
$OraclePwd     = if ($env:ORACLE_PWD)     { $env:ORACLE_PWD }     else { 'OraclePwd123' }
$OrdsUrl       = if ($env:ORDS_URL)       { $env:ORDS_URL }       else { 'http://localhost:8181' }
$Pdb = '//localhost:1521/FREEPDB1'

function Rodar-Sql($conexao, $arquivo) {
    Write-Host ""
    Write-Host "==> $arquivo"
    # "exit" no stdin encerra o sqlplus ao final do script
    'exit' | docker exec -i $DbContainer sqlplus -s -L $conexao "@/opt/painel/sql/$arquivo"
    if ($LASTEXITCODE -ne 0) { throw "Falhou: $arquivo" }
}

function Status-Http($url) {
    try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5).StatusCode }
    catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
}

Write-Host -NoNewline "==> Aguardando o banco ficar healthy..."
while ((docker inspect -f '{{.State.Health.Status}}' $DbContainer 2>$null) -ne 'healthy') {
    Write-Host -NoNewline '.'; Start-Sleep 10
}
Write-Host " ok"

Rodar-Sql "sys/$OraclePwd@$Pdb as sysdba" '01_usuarios_e_grants.sql'
Rodar-Sql "painel_mon/PainelMon123@$Pdb"  '02_views_monitoramento.sql'
Rodar-Sql "painel_mon/PainelMon123@$Pdb"  '03_historico_scheduler.sql'
Rodar-Sql "carga_lab/CargaLab123@$Pdb"    '04_carga_lab.sql'

Write-Host ""
Write-Host -NoNewline "==> Aguardando o ORDS responder em $OrdsUrl/ords/ (a 1a instalação demora)..."
while ((Status-Http "$OrdsUrl/ords/") -eq 0) { Write-Host -NoNewline '.'; Start-Sleep 10 }
Write-Host " ok"

Rodar-Sql "painel_mon/PainelMon123@$Pdb"  '05_ords_modulo.sql'

# O ORDS 26.x não serve o doc_root sem essa configuração explícita
Write-Host ""
Write-Host -NoNewline "==> Configurando o doc_root do ORDS (painel em /painel/)..."
docker exec $OrdsContainer ords --config /etc/ords/config config set `
    standalone.doc.root /etc/ords/config/global/standalone/doc_root | Out-Null
docker restart $OrdsContainer | Out-Null
while ((Status-Http "$OrdsUrl/painel/index.html") -ne 200) { Write-Host -NoNewline '.'; Start-Sleep 5 }
Write-Host " ok"

Write-Host ""
Write-Host "==> Teste da API:"
(Invoke-WebRequest "$OrdsUrl/ords/painel/monitor/health" -UseBasicParsing).Content
Write-Host ""
Write-Host "Pronto! Abra o painel em: $OrdsUrl/painel/index.html"
