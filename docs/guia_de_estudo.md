# Guia de estudo: entender o painel e apresentar sem travar

Este guia é para quem precisa **entender e apresentar** o projeto, e não só rodá-lo. Leia na ordem: do objetivo até as perguntas do professor.

---

## 1. O objetivo em uma frase

> **Mostrar que dá para observar o Oracle "por dentro", em tempo real, usando as views que o próprio Oracle oferece, e explicar o que cada número significa.**

O professor **não** quer um sistema grande. Ele quer ver que o grupo:

1. sabe **onde** o Oracle guarda informação sobre ele mesmo (as views `V$` e `DBA_`);
2. sabe **consultar** essas views;
3. sabe **mostrar** o resultado atualizando sozinho;
4. sabe **interpretar**: olhar um número e dizer se ele é bom, ruim ou normal.

O item 4 é o mais importante. Na aula vale mais dizer "AAS 3 com 2 CPUs significa fila" do que mostrar um gráfico bonito.

### Analogia para fixar

O Oracle é como um carro. As views `V$` são o painel de instrumentos: velocímetro, conta-giros e temperatura. O nosso projeto pega esses instrumentos, que ficam escondidos no SQL, e coloca numa tela que qualquer pessoa consegue ler.

---

## 2. O caminho de um número (a arquitetura)

```text
 Oracle (FREEPDB1)
   │  V$SESSION, V$INSTANCE...      ← o Oracle escreve aqui sozinho, o tempo todo
   ▼
 Views VW_* (schema PAINEL_MON)     ← nós escrevemos: SQL que traduz e resume
   ▼
 ORDS (módulo REST "monitor")       ← transforma cada view numa URL que devolve JSON
   ▼
 app.js (no navegador)              ← a cada 10 s chama as URLs e desenha a tela
   ▼
 index.html                         ← o que você vê
```

Cada camada, em uma linha:

| Peça | O que é | Analogia |
| --- | --- | --- |
| **Oracle Free** | O banco de dados. Roda num container Docker. | O carro. |
| **`V$` / `DBA_`** | Views do sistema que o Oracle mantém sozinho com o estado dele. | Os sensores do carro. |
| **Views `VW_*`** | SQL que nós escrevemos em cima das `V$` para deixar o dado pronto e com nomes em português. | O fio que leva o sinal do sensor ao painel. |
| **ORDS** | Oracle REST Data Services: programa da Oracle que publica SQL como API web (URL que devolve JSON). | A tomada que liga o fio na tela. |
| **HTML/JS** | A página. O JavaScript chama a API de tempos em tempos (`fetch` + `setInterval`). | O painel de instrumentos. |
| **Docker** | Roda o Oracle e o ORDS em containers, sem instalar nada no Windows. | A garagem. |

> **Por que não escrevemos um backend em Python/Node?** Porque o ORDS já faz esse papel. Assim a lógica fica toda em SQL, que é o assunto da disciplina, e há menos peças para dar problema.

---

## 3. Conceitos que você PRECISA saber

Se o professor perguntar qualquer coisa, a resposta vai passar por um destes conceitos.

### Instância × Banco
- **Banco (database)** = os **arquivos** no disco (dados, redo, controlfile).
- **Instância** = os **processos + a memória** (SGA) que abrem e usam esses arquivos.
- O banco pode existir com a instância desligada. A instância é o "motor ligado".
- Ciclo de subida: `STARTED` (memória alocada) → `MOUNTED` (leu o controlfile) → `OPEN` (usuários podem trabalhar).

### CDB × PDB (multitenant)
- **CDB** (`CDB$ROOT`) é o banco "contêiner", que guarda o dicionário do Oracle.
- **PDB** (`FREEPDB1`) é um banco "plugável" dentro do CDB, onde ficam os dados das aplicações.
- Nosso painel conecta no PDB `FREEPDB1`. O card **Container atual** prova isso.

### Sessão
- Cada conexão aberta no banco é uma **sessão** (uma linha em `V$SESSION`).
- **ACTIVE** = está executando algo agora. **INACTIVE** = conectada, mas parada esperando o usuário.
- O ORDS deixa algumas sessões abertas o tempo todo (pool de conexões). Por isso sempre aparecem algumas `INACTIVE`, e isso é normal.

### Wait (espera)
- O Oracle registra **tudo** o que uma sessão espera: disco, lock, rede, commit.
- Uma sessão ativa ou está **em CPU** (trabalhando), ou está **esperando** algum evento.
- Olhar os waits é a forma clássica de descobrir **por que** o banco está lento.
- A classe **Idle** (ex.: `SQL*Net message from client`) é a sessão esperando o usuário mandar algo. Não é problema, por isso a escondemos.

### Lock (bloqueio)
- Quando uma sessão faz `UPDATE` numa linha, ela "tranca" a linha até dar `COMMIT` ou `ROLLBACK`.
- Se outra sessão tentar alterar a **mesma linha**, ela fica parada esperando. O evento aparece como `enq: TX - row lock contention`.
- Em `V$SESSION`, a coluna `BLOCKING_SESSION` da sessão parada aponta o SID de quem a está trancando.

### AAS (Average Active Sessions)
- É a **média de sessões ativas** no último minuto: quantas sessões, em média, estavam trabalhando ou esperando.
- **Regra de ouro:** compare com o número de CPUs. O Oracle Free usa até **2 CPUs**.
  - AAS < 2: folga.
  - AAS ≈ 2: no limite.
  - AAS > 2: tem sessão em **fila**.

### Acumulado × Momento
- `V$SYSTEM_EVENT` e `V$SQLAREA` são **acumulados desde o startup**: só crescem. Mostram a **história**.
- `V$SESSION` é uma **foto do agora**.
- Por isso o painel tem as abas **Agora** e **Desde o startup**. Saber explicar essa diferença é ponto garantido.

### Tablespace
- É uma "pasta lógica" onde o Oracle guarda tabelas e índices. Por baixo, são arquivos (datafiles).
- Se encher, os `INSERT`s falham com `ORA-01653`. O painel mostra o percentual em relação ao **máximo** (já conta o autoextend).

### Privilégio mínimo
- O usuário do painel (`PAINEL_MON`) **não é DBA**. Ele só tem `SELECT` nas views do sistema de que precisa.
- Os grants são **diretos** (`GRANT SELECT ON v_$session TO painel_mon`), e não por role, porque views e procedures **não enxergam** privilégios que vêm de role.

---

## 4. A tela, bloco por bloco: o que mostra e como ler

Use esta seção como "cola" durante o tour do painel.

### Topo
| Elemento | O que é |
| --- | --- |
| **API: online** (pílula verde) | O `GET /health` respondeu. Se ficar vermelho, o ORDS ou o banco caiu. |
| Horário | Quando foi a última atualização. |
| **Atualizar a cada 5/10/30 s** | O intervalo do `setInterval` no `app.js`. Isso é a "atualização periódica" que a premissa pede. |
| **Pausar / Atualizar agora** | Congela a tela ou força uma leitura. Útil para explicar com calma. |

### Faixa de identificação (4 cards)
| Card | Fonte | O que dizer |
| --- | --- | --- |
| **Instância** | `V$INSTANCE` | Nome `FREE`, status `OPEN`: a instância está de pé e aceitando usuários. |
| **Banco** | `V$DATABASE` | `READ WRITE` = aceita alterações. `NOARCHIVELOG` = o redo não é arquivado (normal em laboratório, mas em produção impede recuperação até um ponto no tempo). |
| **Container atual** | `SYS_CONTEXT('USERENV','CON_NAME')` | `FREEPDB1`: estamos no PDB, não no root. |
| **No ar há** | `V$INSTANCE.STARTUP_TIME` | Importa porque **zera os acumulados**: depois de um restart, waits e top SQL recomeçam do zero. |

### Indicadores (6 cards)
Todos vêm de **uma única view**, a `VW_RESUMO`.

| Card | Normal em repouso | Na carga | Como ler |
| --- | --- | --- | --- |
| **Sessões de usuário** | 3 a 6 | 10 a 20 | Conexões abertas, inclusive as ociosas. Sozinho não diz muito. |
| **Ativas agora** | 0 a 1 | 8 (Média) | O melhor termômetro de "carga agora". |
| **Bloqueadas** | **0** | 2, alternando com 0 (fica vermelho) | Deveria ser sempre 0. Maior que 0 = alguém está travando alguém. |
| **AAS** | ~0 | ~3 (Média) | Compare com 2 CPUs. Acima disso, há fila. |
| **CPU do banco** | < 10% | ~75% (Média) | % das 2 CPUs que o Oracle Free pode usar (`CPU Usage Per Sec` ÷ `cpu_count`). |
| **Execuções/s** | baixo | sobe | Volume de comandos SQL por segundo. |

> A sessão do próprio painel é **excluída** das contagens (`sid <> SYS_CONTEXT('USERENV','SID')`). Assim o painel não "se vê" e não infla o número.

> **Atenção ao atraso:** AAS, CPU e Execuções/s são **médias de 60 s** que o Oracle recalcula uma vez por minuto. Ao clicar em Gerar carga, "Ativas agora" sobe na hora, mas esses três só sobem na virada do minuto. Espere de 1 a 2 minutos antes de comentar o AAS.

> Os números da coluna "Na carga" foram **medidos** neste ambiente, com o perfil Média.

### Carga de laboratório
- Sem carga, o banco fica parado e o painel mostra tudo zerado, o que é chato de apresentar.
- O botão **Gerar carga** chama `POST /carga/iniciar`, que roda a procedure `PKG_CARGA.INICIAR`, que cria **jobs do `DBMS_SCHEDULER`**. Cada job é uma sessão fazendo um tipo de trabalho:

| Módulo (aparece como `CARGA_LAB / ...`) | O que faz | O que provoca no painel |
| --- | --- | --- |
| `CONSULTA` | `SELECT ... GROUP BY` em `VENDAS` (300 mil linhas, full scan) | Muitas **leituras lógicas** no Top SQL |
| `CPU` | Laço PL/SQL de 3 milhões de voltas | Sessão **"Em CPU"** |
| `LOCK_DONO` | `UPDATE` na linha 1 de `ESTOQUE` e espera 10 s antes do COMMIT | É o **bloqueador** |
| `LOCK_FILA` | O mesmo `UPDATE` na mesma linha | Fica **bloqueada** (`enq: TX - row lock contention`) |

Perfis: **Leve** = 5 sessões, **Média** = 8, **Pesada** = 12. A carga para sozinha quando o tempo acaba, ou no botão **Parar**.

### Linha do tempo
- As `V$` só mostram o agora. Para ver **tendência**, um job (`JOB_COLETA_METRICAS`) grava uma foto da `VW_RESUMO` a cada **15 s** na tabela `METRICAS_HIST`. Guarda 24 h.
- É a mesma ideia do **AWR** do Oracle, que tira snapshots de hora em hora, só que bem simplificada.
- Na carga: as linhas de "ativas" e "AAS" sobem juntas e descem quando a carga para.

### Esperas (waits)
- **Aba Agora** (`V$SESSION`): agrupa as sessões ativas pelo que estão fazendo neste segundo.
- **Aba Desde o startup** (`V$SYSTEM_EVENT`): top 10 eventos por tempo total esperado.

Eventos que vão aparecer e o que dizer de cada um:

| Evento | Em português |
| --- | --- |
| `Em CPU` | Não está esperando: está trabalhando. |
| `enq: TX - row lock contention` | Esperando outra sessão liberar uma linha (falta COMMIT do outro lado). |
| `db file sequential read` | Lendo **um** bloco do disco (típico de acesso por índice). |
| `db file scattered read` / `direct path read` | Lendo **vários** blocos (típico de full table scan). |
| `log file sync` | O COMMIT esperando o redo ser gravado no disco. |
| `PL/SQL lock timer` | A sessão está "dormindo" de propósito (`DBMS_SESSION.SLEEP`, pausa da carga). É da classe Idle, então aparece em "Sessões ativas", mas não em "Esperas agora". |
| `resmgr:cpu quantum` | O Resource Manager segurando a sessão porque a CPU acabou. Pode aparecer na carga Pesada, porque o Free é limitado a 2 CPUs. |

### Sessões ativas agora
- Uma linha por sessão ativa: SID, usuário, **módulo** (`CARGA_LAB / CONSULTA`, `CARGA_LAB / CPU`...), **atividade** (evento ou "Em CPU"), há quantos **segundos** está na chamada atual, e o **SQL_ID**.

### Bloqueios
- Mostra **quem trava quem**: a sessão bloqueada (`LOCK_FILA`) e a bloqueadora (`LOCK_DONO`).
- Como funciona: auto-join em `V$SESSION` (`b.sid = w.blocking_session`).
- Quando existe bloqueio, aparece também o **alerta vermelho** no topo da tela.
- O alerta **pisca**: o `LOCK_DONO` segura a linha por 10 s, faz COMMIT, descansa 4 s e tranca de novo. Nesses 4 s não há bloqueio. É proposital.
- Como resolver: o bloqueador faz `COMMIT`/`ROLLBACK`, ou o DBA mata a sessão com `ALTER SYSTEM KILL SESSION 'sid,serial#' IMMEDIATE`.

### Sessões por usuário
- Contagem por usuário e status. Mostra o `ORDS_PUBLIC_USER` com várias `INACTIVE` (o pool) e o `CARGA_LAB` com várias `ACTIVE` durante a carga.

### SQLs mais custosos
- `V$SQLAREA`, ordenado por **tempo total** (todas as execuções somadas).
- Pontos que impressionam o professor:
  - **Tempo total ≫ CPU** = o SQL passou o tempo **esperando**. Exemplo: o `UPDATE` do `LOCK_FILA` tem tempo alto e CPU quase zero.
  - **ms/execução** separa o SQL "lento" do SQL "rápido mas executado mil vezes".
  - **Leituras lógicas** (buffer gets) altas indicam full scan ou falta de índice.
- Ao clicar no SQL_ID, a tela mostra o texto do SQL e o comando para ver o plano: `DBMS_XPLAN.DISPLAY_CURSOR('sql_id')`.

### Tablespaces
- % de uso em relação ao máximo. Faixas: < 75% ok, 75–85% atenção, > 85% crítico.

### Estatísticas gerais
- `V$CON_SYSMETRIC`: médias que o próprio Oracle calcula a cada 60 s, só do nosso PDB. Destaques: **Database Wait Time Ratio × CPU Time Ratio** (o banco está mais esperando ou mais trabalhando?) e **Buffer Cache Hit Ratio** (% de leituras atendidas pela memória).
- Logo depois de um restart fica vazio por cerca de 1 minuto. É normal.

---

## 5. O que apresentar na aula (roteiro de ~12 min)

O roteiro detalhado está em [`roteiro_apresentacao.md`](roteiro_apresentacao.md). Esta é a versão para memorizar:

| # | Tempo | O que fazer | Frase-chave |
| --- | --- | --- | --- |
| 1 | 1 min | Problema | "O DBA precisa saber rápido se o banco está saudável. A informação existe nas `V$`, mas consultar uma por uma é lento." |
| 2 | 2 min | Arquitetura (diagrama da seção 2) e um JSON no navegador | "Views fazem o SQL, o ORDS vira API, o HTML atualiza a cada 10 s. Tudo dentro do Oracle." |
| 3 | 2 min | Tour do painel **parado** | "Instância OPEN, PDB FREEPDB1, quase nenhuma sessão ativa, AAS perto de zero: banco ocioso." |
| 4 | 4 min | **Gerar carga (Média, 3 min)** e narrar o que muda | "Ativas subiram para 8. Um minuto depois, o AAS passou de 2 = fila. Apareceu bloqueio: LOCK_FILA espera LOCK_DONO. No Top SQL, o UPDATE tem tempo alto e CPU zero: ele só esperou." |
| 5 | 2 min | Abrir `02_views_monitoramento.sql` e `05_ords_modulo.sql` | "Cada número da tela vem de uma view, e cada view vira uma URL com uma linha de código." |
| 6 | 1 min | Limitações | "Endpoints sem autenticação, acumulados sem delta, sem alerta por e-mail. Seriam os próximos passos." |

**Antes da aula (checklist):**
1. `docker compose up -d` na pasta `docker/` e esperar os dois containers ficarem de pé. Se for a primeira vez nesta máquina, rode também `scripts\configurar.ps1`.
2. Abrir `http://localhost:8181/painel/index.html` **pelo menos 5 min antes** (para a linha do tempo ter pontos).
3. Testar o botão **Gerar carga** uma vez e clicar em **Parar**.
4. Deixar aberto numa aba `http://localhost:8181/ords/painel/monitor/stats/resumo` (o JSON).
5. Deixar o `sql/02_views_monitoramento.sql` aberto no editor.
6. Ter um plano B: se o Oracle não subir, usar `python scripts/mock_ords.py` (dados falsos, mesma tela).

---

## 6. Perguntas que o professor deve fazer, e como responder

### Sobre o objetivo e as escolhas

**"De onde vêm esses números?"**
> Das views dinâmicas do Oracle: `V$INSTANCE`, `V$DATABASE`, `V$SESSION`, `V$SYSTEM_EVENT`, `V$SQLAREA`, `V$CON_SYSMETRIC` e `DBA_TABLESPACE_USAGE_METRICS`. Criamos uma view nossa para cada bloco da tela (`VW_*`) e o ORDS só faz `SELECT * FROM` nela. *(Abra a view VW_RESUMO e mostre.)*

**"Por que usaram ORDS e não um backend em Python/Go/Node?"**
> Para ter menos peças. O ORDS é da própria Oracle e transforma SQL em API REST. A lógica fica toda em SQL, no banco, que é o foco da disciplina. A premissa permite "API ou leitura direta", e o ORDS é a API.

**"Por que criar views em vez de colocar o SQL direto na API?"**
> A view é um contrato: o nome e as colunas não mudam, mesmo se mudarmos o SQL por dentro. Também fica tudo num arquivo só, fácil de revisar e de mostrar. E dá para testar a view no DBeaver sem o ORDS.

**"Por que essas métricas e não outras?"**
> Elas respondem às três perguntas que um DBA faz primeiro: o banco está **de pé**? (instância, status, container) Está **ocupado**? (sessões ativas, AAS, CPU) Se está lento, **por quê**? (waits, bloqueios, top SQL). Tablespace entra porque disco cheio derruba a aplicação.

### Sobre conceitos Oracle

**"Qual a diferença entre instância e banco?"**
> Banco são os arquivos em disco. Instância são os processos e a memória que abrem esses arquivos. A instância pode estar `STARTED` ou `MOUNTED` sem o banco estar aberto. Só em `OPEN` o usuário trabalha.

**"O que é esse FREEPDB1?"**
> É o PDB, o banco plugável dentro do CDB, na arquitetura multitenant. Os dados da aplicação ficam no PDB. O root (`CDB$ROOT`) guarda o dicionário do Oracle. O card "Container atual" mostra onde estamos conectados.

**"O que é um wait? Por que esconderam os Idle?"**
> Wait é o tempo que a sessão passou esperando algo (disco, lock, commit) em vez de usar CPU. Os eventos Idle são a sessão esperando o **usuário** mandar comando, então não representam problema do banco.

**"Qual a diferença entre a aba Agora e Desde o startup?"**
> "Agora" vem de `V$SESSION`: é uma foto do instante. "Desde o startup" vem de `V$SYSTEM_EVENT`: é um total acumulado que só cresce. Um problema que já passou continua aparecendo no acumulado, mas some do "Agora".

**"O que é AAS? Um AAS de 3 é ruim?"**
> É a média de sessões ativas no último minuto. Depende das CPUs: o Oracle Free usa até 2. Com AAS 3, em média uma sessão está na fila esperando CPU ou outro recurso. Então, aqui, é sinal de saturação.

**"Como vocês detectam o bloqueio?"**
> Pela coluna `BLOCKING_SESSION` de `V$SESSION`, que aponta o SID de quem trava. Fazemos um auto-join de `V$SESSION` com ela mesma: a sessão que espera (`w`) com a que bloqueia (`b`). Filtramos eventos `enq:%`, que são esperas por lock.

**"Como resolver esse bloqueio?"**
> O ideal é o bloqueador dar `COMMIT` ou `ROLLBACK`. Em emergência, o DBA mata a sessão: `ALTER SYSTEM KILL SESSION 'sid,serial#' IMMEDIATE`. O SID e o serial# aparecem no bloco de bloqueios. *(Se der tempo, demonstre.)*

**"O UPDATE aparece no top SQL com tempo alto e CPU quase zero. Por quê?"**
> Porque ele passou quase todo o tempo **esperando o lock**, não trabalhando. Tempo total = CPU + espera. Quando a diferença é grande, o gargalo é espera.

**"O que são leituras lógicas e físicas?"**
> Lógicas (buffer gets) são blocos lidos da memória (buffer cache). Físicas (disk reads) são os que precisaram vir do disco. Leitura lógica alta indica SQL que lê muito: full scan ou falta de índice.

**"Como veriam o plano de execução desse SQL?"**
> `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('sql_id'));`. O painel mostra esse comando ao clicar no SQL_ID.

### Sobre segurança e privilégios

**"Que usuário o painel usa? Ele é DBA?"**
> Não. É o `PAINEL_MON`, com privilégio mínimo: `CREATE SESSION`, criar views/tabelas/procedures/jobs no próprio schema, e `SELECT` direto em cada `V$` usada. Não tem `DBA` nem `SELECT ANY DICTIONARY`.

**"Por que grants diretos e não `SELECT_CATALOG_ROLE`?"**
> Porque privilégios vindos de **role** não valem dentro de views e de procedures definer-rights. Para a view `VW_RESUMO` enxergar a `V$SESSION`, o grant tem que ser direto para o dono da view. Além disso, assim damos só o necessário.

**"Por que `v_$session` e não `v$session` no GRANT?"**
> `V$SESSION` é um **sinônimo público**. O objeto real é a view `SYS.V_$SESSION`, e o grant é feito no objeto, não no sinônimo.

**"Isso está seguro para produção?"**
> Não, e sabemos disso: os endpoints são públicos (sem autenticação) e as senhas estão no código, porque é um laboratório local. Em produção usaríamos privilégios/OAuth do ORDS, senhas fora do código e não exporíamos o POST de carga.

### Sobre atualização e desempenho

**"Como é feita a atualização periódica?"**
> No navegador, um `setInterval` chama a cada 10 s (configurável para 5 ou 30) todos os endpoints com `fetch`, em paralelo (`Promise.allSettled`). Se um endpoint falhar, só aquele bloco mostra erro, e o resto continua.

**"E o histórico, como funciona?"**
> Um job do `DBMS_SCHEDULER` roda a cada 15 s a procedure `COLETAR_SNAPSHOT`, que faz `INSERT ... SELECT` da `VW_RESUMO` na tabela `METRICAS_HIST` e apaga o que tem mais de 24 h. É uma versão simplificada do AWR.

**"O painel não pesa no banco?"**
> Pouco. São consultas leves em views de memória (`V$`) a cada 10 s, e a sessão do painel é excluída das contagens. Um monitor que derruba o banco seria pior que nenhum.

**"Como a carga é gerada?"**
> Dentro do próprio Oracle. O botão chama `POST /carga/iniciar`, que executa `PKG_CARGA.INICIAR`, que cria jobs do scheduler. Cada job é uma sessão com um módulo (`DBMS_APPLICATION_INFO.SET_MODULE`) para aparecer identificado no painel.

### Sobre o ambiente

**"Por que Docker?"**
> Para qualquer integrante subir o mesmo Oracle e ORDS com um comando, sem instalar nada. As versões das imagens estão **travadas** (`free:23.26.3.0` e `ords:26.3.0`) porque a tag `latest` muda sem aviso. Já aconteceu: o ORDS 26.3 passou a exigir uma variável nova e quebrou a subida.

**"Que problemas vocês encontraram?"** *(pergunta clássica, e temos boas respostas)*
> 1. **`V$SYSMETRIC` vazia:** no Oracle 26ai, consultada de dentro do PDB, ela não traz nada. Descobrimos que as métricas do PDB ficam em `V$CON_SYSMETRIC` (grupo 18). A `Host CPU Utilization` só existe no root, então mostramos a CPU **do banco** (`CPU Usage Per Sec` ÷ `cpu_count`).
> 2. **Só 4 jobs ao mesmo tempo:** o parâmetro `job_queue_processes` vem com 4 no Free, e a carga Média precisa de 8 jobs. Subimos para 20 no CDB root e no PDB, porque o teto vale para o CDB inteiro.
> 3. **Overflow no PL/SQL:** o laço de CPU fazia `i * i` com `PLS_INTEGER` e estourava 2³¹ (`ORA-01426`). Corrigimos com `MOD` antes de multiplicar.
> 4. **`latest` quebrou o ambiente:** o ORDS 26.3 passou a exigir uma variável nova. Travamos as versões das imagens.
> 5. **`DROP USER` falhava ao reconfigurar** (`ORA-01940`) porque o pool do ORDS mantinha o usuário conectado. O script 01 agora trava a conta, apaga os jobs e encerra as sessões antes.

**"Por que tem `PL/SQL lock timer` nas sessões ativas?"**
> É o `DBMS_SESSION.SLEEP` da carga: a sessão está "dormindo" de propósito entre um ciclo e outro. É um evento da classe Idle, por isso não aparece na aba "Esperas agora".

**"Por que o alerta de bloqueio aparece e some?"**
> A sessão `LOCK_DONO` segura a linha por 10 s, dá COMMIT, espera 4 s e tranca de novo. Nesses 4 s não há bloqueio. Isso mostra também que o painel é tempo real: ele reflete exatamente o ciclo.

**"Por que a porta 1522 e não 1521?"**
> Para não conflitar com algum Oracle já instalado na máquina, que usaria a 1521 padrão.

**"Se reiniciar o banco, o que acontece com o painel?"**
> O acumulado zera (waits e top SQL), porque as `V$` vivem em memória. O card "No ar há" mostra isso. O histórico continua, porque está numa tabela.

---

## 7. Se der problema na hora

| Sintoma | O que fazer |
| --- | --- |
| Página dá 404 | Espere o ORDS terminar de subir (`docker compose logs -f ords`) e use Ctrl+F5. Se continuar, rode `scripts\configurar.ps1` de novo. |
| Pílula "API: offline" | `docker compose ps`: algum container caiu? `docker compose up -d`. |
| Gráfico vazio | O job grava a cada 15 s. Espere 1 a 2 minutos. |
| "Estatísticas gerais" vazia ou AAS com "—" | `V$CON_SYSMETRIC` só preenche 1 minuto após o startup. |
| Nada funciona | Plano B: pare o ORDS (`docker stop painel-oracle-ords`) e rode `python scripts\mock_ords.py`. A tela é a mesma, com dados falsos. **Avise o professor que é o mock.** |

---

## 8. Resumo para decorar (se só der tempo de ler isto)

1. **Objetivo:** observar o Oracle em tempo real pelas views `V$` e saber interpretar os números.
2. **Caminho:** `V$` → view `VW_*` → ORDS (JSON) → `fetch` a cada 10 s → tela.
3. **Saúde:** instância `OPEN`, banco `READ WRITE`, PDB `FREEPDB1`.
4. **Carga:** ativas e AAS. AAS > 2 CPUs = fila.
5. **Por quê está lento:** waits (Agora = foto, Startup = história), bloqueios (`BLOCKING_SESSION`) e top SQL (tempo ≫ CPU = espera).
6. **Segurança:** usuário com privilégio mínimo e grants diretos, porque roles não valem em views.
7. **Histórico:** job do scheduler a cada 15 s, um "AWR caseiro".
8. **Limitações:** sem autenticação, sem delta e sem alerta. São os próximos passos.
