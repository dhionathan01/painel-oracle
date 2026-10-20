#!/usr/bin/env python3
"""
ORDS simulado para desenvolver o painel SEM o Oracle rodando.

Responde nos mesmos caminhos e com os mesmos campos JSON que o módulo
REST real (sql/05_ords_modulo.sql), com números aleatórios.

Uso (na raiz do projeto):
    python3 scripts/mock_ords.py
    -> abra http://localhost:8181/painel/index.html

Use a porta 8181 só quando o ORDS real estiver parado (é a mesma porta).
"""
import json
import random
import time
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORTA = 8181
PASTA_WEB = Path(__file__).resolve().parent.parent / "web"
API = "/ords/painel/monitor"
INICIO = datetime.now() - timedelta(hours=26, minutes=12)

carga = {"ativa": False, "perfil": None, "fim": 0.0, "inicio": None}
historico = []


def carga_rodando():
    return carga["ativa"] and time.time() < carga["fim"]


def resumo():
    extra = {"LEVE": 3, "MEDIA": 6, "PESADA": 10}.get(carga["perfil"], 0) if carga_rodando() else 0
    ativas = random.randint(0, 1) + extra
    bloqueadas = random.randint(1, 2) if carga_rodando() else 0
    return {
        "sessoes_usuario": 9 + extra + random.randint(0, 2),
        "sessoes_ativas": ativas,
        "sessoes_bloqueadas": bloqueadas,
        "aas": round(ativas * random.uniform(0.6, 0.9), 2),
        "host_cpu_pct": round(min(99, 8 + ativas * random.uniform(6, 9)), 1),
        "execucoes_seg": round(15 + ativas * random.uniform(20, 40), 1),
        "transacoes_seg": round(0.2 + ativas * random.uniform(0.3, 1.2), 2),
        "medido_em": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
    }


def coletar_historico():
    agora = datetime.now()
    if not historico or (agora - historico[-1][0]).total_seconds() >= 5:
        r = resumo()
        historico.append((agora, {"horario": agora.strftime("%H:%M:%S"), **{k: v for k, v in r.items() if k != "medido_em"}}))
    del historico[:-720]


def lista(items):
    return {"items": items, "hasMore": False, "limit": 0, "offset": 0, "count": len(items)}


def rota(caminho, query):
    coletar_historico()
    rodando = carga_rodando()
    if caminho == "/health":
        return {"status": "UP", "horario_banco": datetime.now().strftime("%d/%m/%Y %H:%M:%S"), "container": "FREEPDB1"}
    if caminho == "/stats/instancia":
        return {
            "instancia": "FREE", "host": "a1b2c3d4e5f6", "versao": "23.26.0.0.0",
            "status_instancia": "OPEN", "status_banco": "ACTIVE",
            "iniciada_em": INICIO.strftime("%d/%m/%Y %H:%M:%S"),
            "uptime_horas": round((datetime.now() - INICIO).total_seconds() / 3600, 1),
            "banco": "FREE", "modo_abertura": "READ WRITE", "modo_log": "NOARCHIVELOG",
            "container_atual": "FREEPDB1",
        }
    if caminho == "/stats/resumo":
        return resumo()
    if caminho == "/stats/metricas":
        nomes = [("Average Active Sessions", "Active Sessions"), ("Buffer Cache Hit Ratio", "% (LogRead - PhyRead)/LogRead"),
                 ("CPU Usage Per Sec", "CentiSeconds Per Second"), ("Database CPU Time Ratio", "% Cpu/DB_Time"),
                 ("Database Time Per Sec", "CentiSeconds Per Second"), ("Database Wait Time Ratio", "% Wait/DB_Time"),
                 ("Executions Per Sec", "Executes Per Second"), ("Host CPU Utilization (%)", "% Busy/(Idle+Busy)"),
                 ("Logical Reads Per Sec", "Reads Per Second"), ("Logons Per Sec", "Logons Per Second"),
                 ("Physical Reads Per Sec", "Reads Per Second"), ("User Commits Per Sec", "Commits Per Second"),
                 ("User Transaction Per Sec", "Transactions Per Second")]
        return lista([{"metrica": n, "valor": round(random.uniform(0, 100), 2), "unidade": u,
                       "medido_ate": datetime.now().strftime("%H:%M:%S")} for n, u in nomes])
    if caminho == "/stats/sessoes":
        itens = [{"usuario": "ORDS_PUBLIC_USER", "status": "INACTIVE", "total": 6},
                 {"usuario": "SYSTEM", "status": "INACTIVE", "total": 1},
                 {"usuario": "PAINEL_MON", "status": "INACTIVE", "total": 2}]
        if rodando:
            itens.insert(0, {"usuario": "CARGA_LAB", "status": "ACTIVE", "total": 7})
        return lista(itens)
    if caminho == "/stats/sessoes/ativas":
        if not rodando:
            return lista([])
        return lista([
            {"sid": 45, "serial": 3121, "usuario": "CARGA_LAB", "maquina": "a1b2c3", "programa": "oracle@a1b2c3 (J002)",
             "modulo": "LOCK_FILA", "sql_id": "8x2kz0p1q9w3m", "atividade": "enq: TX - row lock contention",
             "classe": "Application", "segundos_ativa": random.randint(1, 10), "bloqueada_por": 61},
            {"sid": 52, "serial": 1877, "usuario": "CARGA_LAB", "maquina": "a1b2c3", "programa": "oracle@a1b2c3 (J004)",
             "modulo": "CONSULTA", "sql_id": "4kq7dbn2r5s8t", "atividade": "Em CPU", "classe": "CPU",
             "segundos_ativa": random.randint(0, 3), "bloqueada_por": None},
            {"sid": 58, "serial": 902, "usuario": "CARGA_LAB", "maquina": "a1b2c3", "programa": "oracle@a1b2c3 (J005)",
             "modulo": "CPU", "sql_id": None, "atividade": "Em CPU", "classe": "CPU",
             "segundos_ativa": random.randint(0, 2), "bloqueada_por": None},
        ])
    if caminho == "/stats/bloqueios":
        if not rodando:
            return lista([])
        return lista([{"sid_bloqueada": 45, "usuario_bloqueado": "CARGA_LAB", "modulo_bloqueado": "LOCK_FILA",
                       "evento": "enq: TX - row lock contention", "segundos_esperando": random.randint(1, 10),
                       "sql_bloqueado": "8x2kz0p1q9w3m", "sid_bloqueador": 61, "serial_bloqueador": 4410,
                       "usuario_bloqueador": "CARGA_LAB", "modulo_bloqueador": "LOCK_DONO",
                       "status_bloqueador": "ACTIVE", "sql_bloqueador": "1m2n3b4v5c6x7"}])
    if caminho == "/stats/waits/agora":
        if not rodando:
            return lista([])
        return lista([{"evento": "Em CPU", "classe": "CPU", "sessoes": random.randint(3, 6)},
                      {"evento": "enq: TX - row lock contention", "classe": "Application", "sessoes": 2},
                      {"evento": "db file scattered read", "classe": "User I/O", "sessoes": 1}])
    if caminho == "/stats/waits/acumulados":
        return lista([
            {"evento": "enq: TX - row lock contention", "classe": "Application", "total_esperas": 210, "segundos_esperados": 612.4, "media_ms": 2916.2},
            {"evento": "db file sequential read", "classe": "User I/O", "total_esperas": 48211, "segundos_esperados": 95.3, "media_ms": 1.98},
            {"evento": "log file sync", "classe": "Commit", "total_esperas": 3120, "segundos_esperados": 22.1, "media_ms": 7.08},
            {"evento": "db file scattered read", "classe": "User I/O", "total_esperas": 2210, "segundos_esperados": 11.7, "media_ms": 5.29},
            {"evento": "control file sequential read", "classe": "System I/O", "total_esperas": 9124, "segundos_esperados": 4.2, "media_ms": 0.46},
        ])
    if caminho == "/stats/sql":
        return lista([
            {"sql_id": "4kq7dbn2r5s8t", "schema_sql": "CARGA_LAB", "execucoes": 812, "tempo_total_s": 148.21, "cpu_s": 139.9,
             "ms_por_execucao": 182.5, "leituras_logicas": 1450231, "leituras_fisicas": 1203, "linhas": 812,
             "texto_sql": "SELECT MAX(TOTAL) FROM (SELECT REGIAO, PRODUTO, SUM(VALOR * QUANTIDADE) AS TOTAL FROM VENDAS GROUP BY REGIAO, PRODUTO)"},
            {"sql_id": "8x2kz0p1q9w3m", "schema_sql": "CARGA_LAB", "execucoes": 190, "tempo_total_s": 604.9, "cpu_s": 0.4,
             "ms_por_execucao": 3183.7, "leituras_logicas": 950, "leituras_fisicas": 0, "linhas": 190,
             "texto_sql": "UPDATE ESTOQUE SET SALDO = SALDO + 1 WHERE ID = 1"},
            {"sql_id": "0d3fbg7h8j2kl", "schema_sql": "CARGA_LAB", "execucoes": 815, "tempo_total_s": 41.7, "cpu_s": 39.2,
             "ms_por_execucao": 51.2, "leituras_logicas": 1302114, "leituras_fisicas": 0, "linhas": 815,
             "texto_sql": "SELECT COUNT(*), SUM(VALOR) FROM VENDAS WHERE PRODUTO = :B1"},
        ])
    if caminho == "/stats/tablespaces":
        return lista([
            {"tablespace": "SYSAUX", "tipo": "PERMANENT", "status": "ONLINE", "usado_mb": 612.3, "maximo_mb": 32768, "percentual_uso": 1.9},
            {"tablespace": "SYSTEM", "tipo": "PERMANENT", "status": "ONLINE", "usado_mb": 287.1, "maximo_mb": 32768, "percentual_uso": 0.9},
            {"tablespace": "USERS", "tipo": "PERMANENT", "status": "ONLINE", "usado_mb": 31.4, "maximo_mb": 32768, "percentual_uso": 0.1},
            {"tablespace": "UNDOTBS1", "tipo": "UNDO", "status": "ONLINE", "usado_mb": 9.8, "maximo_mb": 32768, "percentual_uso": 0.03},
        ])
    if caminho == "/stats/historico":
        minutos = int((query.get("minutos") or ["30"])[0])
        limite = datetime.now() - timedelta(minutes=minutos)
        return lista([p for t, p in historico if t >= limite])
    if caminho == "/carga/status":
        if rodando:
            return {"situacao": "RODANDO", "perfil": carga["perfil"], "iniciada_em": carga["inicio"],
                    "termina_em": None, "segundos_restantes": int(carga["fim"] - time.time()),
                    "jobs_rodando": {"LEVE": 5, "MEDIA": 8, "PESADA": 12}[carga["perfil"]]}
        return {"situacao": "PARADA", "perfil": carga["perfil"], "iniciada_em": carga["inicio"],
                "termina_em": None, "segundos_restantes": 0, "jobs_rodando": 0}
    return None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PASTA_WEB), **kwargs)

    def _json(self, codigo, corpo):
        dados = json.dumps(corpo).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        from urllib.parse import parse_qs, urlparse
        url = urlparse(self.path)
        if url.path.startswith(API):
            corpo = rota(url.path[len(API):], parse_qs(url.query))
            return self._json(200, corpo) if corpo is not None else self._json(404, {"erro": "não encontrado"})
        if url.path.startswith("/painel/"):
            self.path = self.path[len("/painel"):]
            return super().do_GET()
        self.send_response(302)
        self.send_header("Location", "/painel/index.html")
        self.end_headers()

    def do_POST(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        corpo = json.loads(self.rfile.read(tamanho) or b"{}")
        if self.path == API + "/carga/iniciar":
            perfil = str(corpo.get("perfil") or "MEDIA").upper()
            if perfil not in ("LEVE", "MEDIA", "PESADA"):
                return self._json(555, {"erro": "Perfil inválido"})
            minutos = max(1, min(15, int(corpo.get("minutos") or 3)))
            carga.update(ativa=True, perfil=perfil, fim=time.time() + minutos * 60,
                         inicio=datetime.now().strftime("%d/%m/%Y %H:%M:%S"))
            return self._json(200, {"ok": True, "acao": "iniciar"})
        if self.path == API + "/carga/parar":
            carga["ativa"] = False
            return self._json(200, {"ok": True, "acao": "parar"})
        self._json(404, {"erro": "não encontrado"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"ORDS simulado em http://localhost:{PORTA}/painel/index.html  (CTRL+C para sair)")
    ThreadingHTTPServer(("", PORTA), Handler).serve_forever()
