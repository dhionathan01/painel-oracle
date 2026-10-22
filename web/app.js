/* =====================================================================
   Painel Oracle - frontend
   Busca os endpoints REST do ORDS e redesenha a tela periodicamente.
   Sem bibliotecas: fetch + DOM + <canvas>.
   ===================================================================== */
'use strict';

// Servido pelo próprio ORDS (porta 8181) -> URL relativa, mesma origem.
// Aberto de outro lugar (ex.: python -m http.server 5500) -> URL absoluta.
const API_BASE = window.location.port === '8181'
  ? '/ords/painel/monitor'
  : 'http://localhost:8181/ords/painel/monitor';

const LIMITES = {
  aasAtencao: 2,      // Oracle Free usa no máximo 2 threads de CPU
  cpuAtencao: 70,
  cpuCritico: 85,
  tsAtencao: 75,
  tsCritico: 85,
};

const estado = {
  timer: null,
  pausado: false,
  intervaloSeg: 10,
  abaEsperas: 'agora',
  esperas: { agora: null, acumulados: null },
  historico: [],
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/* ---------------------------------------------------------------------
   Utilitários
   --------------------------------------------------------------------- */
function esc(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function num(valor, casas) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  if (Number.isNaN(n)) return esc(valor);
  return casas === undefined
    ? fmt.format(n)
    : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function classeCss(classe) {
  return String(classe || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function getJson(caminho) {
  const resp = await fetch(API_BASE + caminho, { cache: 'no-store' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${caminho}`);
  return resp.json();
}

async function postJson(caminho, corpo) {
  const resp = await fetch(API_BASE + caminho, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {}),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${caminho}`);
  return resp.json().catch(() => ({}));
}

// Lista do ORDS vem como {"items":[...]}
const itens = (dados) => (dados && Array.isArray(dados.items) ? dados.items : []);

/**
 * Monta uma <table> a partir de uma definição de colunas.
 * col = { campo, titulo, tipo: 'num'|'mono'|'html', render(linha) }
 */
function tabela(linhas, colunas, mensagemVazia) {
  if (!linhas.length) return `<p class="vazio">${esc(mensagemVazia || 'Nada para mostrar.')}</p>`;
  const cab = colunas.map((c) => `<th class="${c.tipo === 'num' ? 'num' : ''}">${esc(c.titulo)}</th>`).join('');
  const corpo = linhas.map((l) => '<tr>' + colunas.map((c) => {
    const conteudo = c.render ? c.render(l) : (c.tipo === 'num' ? num(l[c.campo]) : esc(l[c.campo]));
    const cls = c.classe || (c.tipo === 'num' ? 'num' : c.tipo === 'mono' ? 'mono' : '');
    return `<td class="${cls}">${conteudo}</td>`;
  }).join('') + '</tr>').join('');
  return `<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>`;
}

function mostrarErro(idAlvo, erro) {
  $(idAlvo).innerHTML = `<p class="erro">Não foi possível carregar (${esc(erro.message)}). Verifique os grants do PAINEL_MON e se o ORDS está no ar.</p>`;
}

function definirPilula(el, texto, tipo) {
  el.textContent = texto;
  el.className = `pilula pilula-${tipo}`;
}

/* ---------------------------------------------------------------------
   Renderizadores
   --------------------------------------------------------------------- */
function renderHealth(h) {
  definirPilula($('api-status'), `API: ${h.status || 'UP'}`, 'ok');
  $('api-status').title = `GET /health · horário do banco ${h.horario_banco || ''}`;
}

function renderInstancia(i) {
  $('inst-nome').textContent = i.instancia || '—';
  const st = i.status_instancia || '—';
  definirPilula($('inst-status'), st, st === 'OPEN' ? 'ok' : 'alerta');
  $('inst-banco-status').textContent = i.status_banco ? `banco ${i.status_banco}` : '';
  $('db-nome').textContent = i.banco || '—';
  $('db-detalhe').textContent = [i.modo_abertura, i.modo_log].filter(Boolean).join(' · ');
  $('db-container').textContent = i.container_atual || '—';

  const h = Number(i.uptime_horas);
  $('inst-uptime').textContent = Number.isFinite(h)
    ? (h >= 48 ? `${num(h / 24, 1)} dias` : `${num(h, 1)} h`)
    : '—';
  $('inst-versao').textContent = [i.versao && `v${i.versao}`, i.iniciada_em && `desde ${i.iniciada_em}`]
    .filter(Boolean).join(' · ');
}

function marcarKpi(idNumero, nivel) {
  const card = $(idNumero).closest('.kpi');
  card.classList.remove('ok', 'atencao', 'critico');
  if (nivel) card.classList.add(nivel);
}

function renderResumo(r) {
  $('kpi-sessoes').textContent = num(r.sessoes_usuario);
  $('kpi-ativas').textContent = num(r.sessoes_ativas);
  $('kpi-bloqueadas').textContent = num(r.sessoes_bloqueadas);
  $('kpi-aas').textContent = num(r.aas, 2);
  $('kpi-cpu').textContent = r.host_cpu_pct === null || r.host_cpu_pct === undefined ? '—' : `${num(r.host_cpu_pct, 1)}%`;
  $('kpi-exec').textContent = num(r.execucoes_seg, 1);

  const bloq = Number(r.sessoes_bloqueadas) || 0;
  marcarKpi('kpi-bloqueadas', bloq > 0 ? 'critico' : 'ok');
  marcarKpi('kpi-aas', Number(r.aas) > LIMITES.aasAtencao ? 'atencao' : null);
  const cpu = Number(r.host_cpu_pct);
  marcarKpi('kpi-cpu', cpu >= LIMITES.cpuCritico ? 'critico' : cpu >= LIMITES.cpuAtencao ? 'atencao' : null);
  marcarKpi('kpi-ativas', null);

  const alerta = $('alerta-bloqueio');
  alerta.hidden = bloq === 0;
  $('alerta-texto').textContent = bloq === 1
    ? '1 sessão bloqueada esperando lock'
    : `${bloq} sessões bloqueadas esperando lock`;
}

function renderSessoes(dados) {
  $('tabela-sessoes').innerHTML = tabela(itens(dados), [
    { campo: 'usuario', titulo: 'Usuário', tipo: 'mono' },
    {
      campo: 'status', titulo: 'Status',
      render: (l) => `<span class="pilula pilula-${l.status === 'ACTIVE' ? 'ok' : 'neutra'}">${esc(l.status)}</span>`,
    },
    { campo: 'total', titulo: 'Sessões', tipo: 'num' },
  ], 'Nenhuma sessão de usuário.');
}

function renderAtivas(dados) {
  $('tabela-ativas').innerHTML = tabela(itens(dados), [
    { campo: 'sid', titulo: 'SID', tipo: 'num' },
    { campo: 'usuario', titulo: 'Usuário', tipo: 'mono' },
    { campo: 'modulo', titulo: 'Módulo' },
    {
      campo: 'atividade', titulo: 'Atividade',
      render: (l) => `${esc(l.atividade)} <span class="classe-tag ${classeCss(l.classe)}">${esc(l.classe)}</span>`,
    },
    { campo: 'segundos_ativa', titulo: 'Segundos', tipo: 'num' },
    { campo: 'sql_id', titulo: 'SQL_ID', render: (l) => l.sql_id ? `<code>${esc(l.sql_id)}</code>` : '—' },
  ], 'Nenhuma sessão ativa além do próprio painel. Experimente "Gerar carga".');
}

function renderBloqueios(dados) {
  $('tabela-bloqueios').innerHTML = tabela(itens(dados), [
    {
      campo: 'sid_bloqueada', titulo: 'Bloqueada',
      render: (l) => `<code>SID ${esc(l.sid_bloqueada)}</code><br><small>${esc(l.usuario_bloqueado)} · ${esc(l.modulo_bloqueado || '')}</small>`,
    },
    { campo: 'evento', titulo: 'Esperando', render: (l) => `${esc(l.evento)}<br><small>${num(l.segundos_esperando)} s</small>` },
    {
      campo: 'sid_bloqueador', titulo: 'Bloqueador',
      render: (l) => `<code>SID ${esc(l.sid_bloqueador)},${esc(l.serial_bloqueador)}</code><br><small>${esc(l.usuario_bloqueador)} · ${esc(l.modulo_bloqueador || '')} · ${esc(l.status_bloqueador)}</small>`,
    },
  ], 'Nenhum bloqueio no momento. 👍');
}

function renderEsperas() {
  const alvo = 'tabela-esperas';
  const dados = estado.esperas[estado.abaEsperas];
  if (dados instanceof Error) { mostrarErro(alvo, dados); return; }
  if (!dados) return;
  const linhas = itens(dados);

  if (estado.abaEsperas === 'agora') {
    const max = Math.max(1, ...linhas.map((l) => Number(l.sessoes) || 0));
    $(alvo).innerHTML = tabela(linhas, [
      { campo: 'evento', titulo: 'Evento' },
      { campo: 'classe', titulo: 'Classe', render: (l) => `<span class="classe-tag ${classeCss(l.classe)}">${esc(l.classe)}</span>` },
      {
        campo: 'sessoes', titulo: 'Sessões', classe: 'num',
        render: (l) => `<div class="barra-ev"><div class="trilho"><div class="preench" style="width:${(Number(l.sessoes) / max) * 100}%"></div></div>${num(l.sessoes)}</div>`,
      },
    ], 'Nenhuma sessão esperando agora.');
  } else {
    const max = Math.max(1, ...linhas.map((l) => Number(l.segundos_esperados) || 0));
    $(alvo).innerHTML = tabela(linhas, [
      { campo: 'evento', titulo: 'Evento' },
      { campo: 'classe', titulo: 'Classe', render: (l) => `<span class="classe-tag ${classeCss(l.classe)}">${esc(l.classe)}</span>` },
      { campo: 'total_esperas', titulo: 'Esperas', tipo: 'num' },
      {
        campo: 'segundos_esperados', titulo: 'Tempo (s)', classe: 'num',
        render: (l) => `<div class="barra-ev"><div class="trilho"><div class="preench" style="width:${(Number(l.segundos_esperados) / max) * 100}%"></div></div>${num(l.segundos_esperados, 1)}</div>`,
      },
      { campo: 'media_ms', titulo: 'Média (ms)', tipo: 'num' },
    ], 'Sem waits registrados.');
  }
}

let sqlTextos = {};
function renderSql(dados) {
  const linhas = itens(dados);
  sqlTextos = Object.fromEntries(linhas.map((l) => [l.sql_id, l.texto_sql]));
  $('tabela-sql').innerHTML = tabela(linhas, [
    { campo: 'sql_id', titulo: 'SQL_ID', render: (l) => `<button type="button" class="link-sql" data-sql="${esc(l.sql_id)}">${esc(l.sql_id)}</button>` },
    { campo: 'schema_sql', titulo: 'Schema', tipo: 'mono' },
    { campo: 'execucoes', titulo: 'Execuções', tipo: 'num' },
    { campo: 'tempo_total_s', titulo: 'Tempo total (s)', tipo: 'num' },
    { campo: 'cpu_s', titulo: 'CPU (s)', tipo: 'num' },
    { campo: 'ms_por_execucao', titulo: 'ms/execução', tipo: 'num' },
    { campo: 'leituras_logicas', titulo: 'Leituras lógicas', tipo: 'num' },
    { campo: 'leituras_fisicas', titulo: 'Leituras físicas', tipo: 'num' },
    { campo: 'texto_sql', titulo: 'Texto', classe: 'texto-sql', render: (l) => `<span title="${esc(l.texto_sql)}">${esc(l.texto_sql)}</span>` },
  ], 'Nenhum SQL de usuário no cache ainda.');
}

function renderTablespaces(dados) {
  const linhas = itens(dados);
  if (!linhas.length) { $('lista-tablespaces').innerHTML = '<p class="vazio">Sem dados.</p>'; return; }
  $('lista-tablespaces').innerHTML = linhas.map((t) => {
    const pct = Number(t.percentual_uso) || 0;
    const nivel = pct >= LIMITES.tsCritico ? 'critico' : pct >= LIMITES.tsAtencao ? 'atencao' : '';
    return `<div class="ts-item" title="${esc(t.tipo)} · ${esc(t.status)}">
      <span class="ts-nome">${esc(t.tablespace)}</span>
      <div class="ts-trilho"><div class="ts-preench ${nivel}" style="width:${Math.min(pct, 100)}%"></div></div>
      <span class="ts-valor">${num(pct, 1)}% · ${num(t.usado_mb, 0)} / ${num(t.maximo_mb, 0)} MB</span>
    </div>`;
  }).join('');
}

function renderMetricas(dados) {
  $('tabela-metricas').innerHTML = tabela(itens(dados), [
    { campo: 'metrica', titulo: 'Métrica' },
    { campo: 'valor', titulo: 'Valor', tipo: 'num' },
    { campo: 'unidade', titulo: 'Unidade', render: (l) => `<small>${esc(l.unidade)}</small>` },
  ], 'V$CON_SYSMETRIC ainda sem dados (aguarde 1 minuto após o startup).');
}

function renderCarga(c) {
  const sit = c.situacao || 'PARADA';
  const tipo = sit === 'RODANDO' ? 'alerta' : sit === 'FINALIZANDO' ? 'neutra' : 'ok';
  let texto = `<span class="pilula pilula-${tipo}">${esc(sit)}</span>`;
  if (sit === 'RODANDO') {
    const s = Number(c.segundos_restantes) || 0;
    texto += ` perfil <strong>${esc(c.perfil)}</strong> · <strong>${num(c.jobs_rodando)}</strong> jobs · termina em ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  } else if (sit === 'FINALIZANDO') {
    texto += ` ${num(c.jobs_rodando)} jobs encerrando`;
  }
  $('carga-status').innerHTML = texto;
  $('btn-carga-parar').disabled = sit === 'PARADA';
}

/* ---------------------------------------------------------------------
   Gráfico (canvas, sem biblioteca)
   --------------------------------------------------------------------- */
const SERIES = [
  { campo: 'sessoes_ativas', nome: 'Sessões ativas', cor: '--serie-1' },
  { campo: 'aas', nome: 'AAS (sessões ativas médias)', cor: '--serie-2' },
  { campo: 'sessoes_bloqueadas', nome: 'Sessões bloqueadas', cor: '--serie-3' },
];

function corVar(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function desenharGrafico() {
  const pontos = estado.historico;
  const canvas = $('grafico');
  const vazio = $('grafico-vazio');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const largura = canvas.clientWidth;
  const altura = canvas.clientHeight;
  canvas.width = Math.round(largura * dpr);
  canvas.height = Math.round(altura * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);

  $('legenda').innerHTML = SERIES.map((s) => `<li><i style="background:${corVar(s.cor)}"></i>${esc(s.nome)}</li>`).join('');

  vazio.hidden = pontos.length >= 2;
  if (pontos.length < 2) return;

  const margem = { esq: 36, dir: 12, topo: 10, base: 24 };
  const w = largura - margem.esq - margem.dir;
  const h = altura - margem.topo - margem.base;

  let maxY = 1;
  for (const p of pontos) for (const s of SERIES) maxY = Math.max(maxY, Number(p[s.campo]) || 0);
  maxY = Math.ceil(maxY * 1.15);

  const x = (i) => margem.esq + (i / (pontos.length - 1)) * w;
  const y = (v) => margem.topo + h - (v / maxY) * h;

  // Grade e eixo Y
  ctx.strokeStyle = corVar('--borda');
  ctx.fillStyle = corVar('--texto-suave');
  ctx.font = '11px ' + corVar('--mono');
  ctx.lineWidth = 1;
  const passos = 4;
  for (let i = 0; i <= passos; i++) {
    const v = (maxY / passos) * i;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(margem.esq, yy); ctx.lineTo(margem.esq + w, yy); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(Number.isInteger(v) ? v : v.toFixed(1), margem.esq - 6, yy);
  }

  // Eixo X: alguns horários
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const qtdRotulos = Math.min(6, pontos.length);
  for (let k = 0; k < qtdRotulos; k++) {
    const i = Math.round((k / (qtdRotulos - 1 || 1)) * (pontos.length - 1));
    ctx.textAlign = k === 0 ? 'left' : k === qtdRotulos - 1 ? 'right' : 'center';
    ctx.fillText(pontos[i].horario || '', x(i), margem.topo + h + 6);
  }

  // Linhas
  for (const s of SERIES) {
    ctx.strokeStyle = corVar(s.cor);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pontos.forEach((p, i) => {
      const v = Number(p[s.campo]) || 0;
      if (i === 0) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
  }
}

/* ---------------------------------------------------------------------
   Ciclo de atualização
   --------------------------------------------------------------------- */
async function atualizar() {
  const janela = $('janela-historico').value;
  const tarefas = {
    health: getJson('/health'),
    instancia: getJson('/stats/instancia'),
    resumo: getJson('/stats/resumo'),
    sessoes: getJson('/stats/sessoes'),
    ativas: getJson('/stats/sessoes/ativas'),
    bloqueios: getJson('/stats/bloqueios'),
    esperasAgora: getJson('/stats/waits/agora'),
    esperasAcum: getJson('/stats/waits/acumulados'),
    sql: getJson('/stats/sql'),
    tablespaces: getJson('/stats/tablespaces'),
    metricas: getJson('/stats/metricas'),
    historico: getJson(`/stats/historico?minutos=${encodeURIComponent(janela)}`),
    carga: getJson('/carga/status'),
  };

  const nomes = Object.keys(tarefas);
  const resultados = await Promise.allSettled(Object.values(tarefas));
  const r = Object.fromEntries(nomes.map((n, i) => [n, resultados[i]]));

  // Cada bloco é independente: se um endpoint falha, só ele mostra erro
  const aplicar = (nome, ok, idErro) => {
    if (r[nome].status === 'fulfilled') {
      try { ok(r[nome].value); } catch (e) { console.error(nome, e); if (idErro) mostrarErro(idErro, e); }
    } else {
      console.warn(nome, r[nome].reason);
      if (idErro) mostrarErro(idErro, r[nome].reason);
    }
  };

  if (r.health.status === 'fulfilled') renderHealth(r.health.value);
  else definirPilula($('api-status'), 'API: fora do ar', 'perigo');

  aplicar('instancia', renderInstancia);
  aplicar('resumo', renderResumo);
  aplicar('sessoes', renderSessoes, 'tabela-sessoes');
  aplicar('ativas', renderAtivas, 'tabela-ativas');
  aplicar('bloqueios', renderBloqueios, 'tabela-bloqueios');
  aplicar('sql', renderSql, 'tabela-sql');
  aplicar('tablespaces', renderTablespaces, 'lista-tablespaces');
  aplicar('metricas', renderMetricas, 'tabela-metricas');
  aplicar('carga', renderCarga);

  estado.esperas.agora = r.esperasAgora.status === 'fulfilled' ? r.esperasAgora.value : r.esperasAgora.reason;
  estado.esperas.acumulados = r.esperasAcum.status === 'fulfilled' ? r.esperasAcum.value : r.esperasAcum.reason;
  renderEsperas();

  if (r.historico.status === 'fulfilled') {
    estado.historico = itens(r.historico.value);
    desenharGrafico();
  }

  $('ultima-atualizacao').textContent = new Date().toLocaleTimeString('pt-BR');
}

function agendar() {
  clearInterval(estado.timer);
  if (!estado.pausado) estado.timer = setInterval(atualizar, estado.intervaloSeg * 1000);
}

/* ---------------------------------------------------------------------
   Eventos
   --------------------------------------------------------------------- */
function ligarEventos() {
  $('api-base').textContent = API_BASE;

  $('intervalo').addEventListener('change', (e) => {
    estado.intervaloSeg = Number(e.target.value);
    agendar();
  });

  $('btn-pausar').addEventListener('click', (e) => {
    estado.pausado = !estado.pausado;
    e.target.textContent = estado.pausado ? 'Retomar' : 'Pausar';
    agendar();
  });

  $('btn-atualizar').addEventListener('click', atualizar);
  $('janela-historico').addEventListener('change', atualizar);

  document.querySelectorAll('.aba').forEach((aba) => aba.addEventListener('click', () => {
    document.querySelectorAll('.aba').forEach((a) => a.classList.toggle('ativa', a === aba));
    estado.abaEsperas = aba.dataset.aba;
    renderEsperas();
  }));

  $('tabela-sql').addEventListener('click', (e) => {
    const botao = e.target.closest('[data-sql]');
    if (!botao) return;
    const id = botao.dataset.sql;
    $('dialogo-sql-id').textContent = id;
    $('dialogo-sql-texto').textContent = sqlTextos[id] || '';
    $('dialogo-sql-xplan').textContent = `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('${id}'));`;
    $('dialogo-sql').showModal();
  });

  $('btn-carga-iniciar').addEventListener('click', async (e) => {
    const botao = e.target;
    botao.disabled = true;
    try {
      await postJson('/carga/iniciar', {
        perfil: $('carga-perfil').value,
        minutos: Number($('carga-minutos').value),
      });
      await atualizar();
    } catch (erro) {
      alert(`Não foi possível iniciar a carga: ${erro.message}`);
    } finally {
      botao.disabled = false;
    }
  });

  $('btn-carga-parar').addEventListener('click', async (e) => {
    const botao = e.target;
    botao.disabled = true;
    try {
      await postJson('/carga/parar');
      await atualizar();
    } catch (erro) {
      alert(`Não foi possível parar a carga: ${erro.message}`);
      botao.disabled = false;
    }
  });

  let espera;
  window.addEventListener('resize', () => {
    clearTimeout(espera);
    espera = setTimeout(desenharGrafico, 150);
  });
}

ligarEventos();
atualizar();
agendar();
