# Roteiro da apresentação (~12 min)

> Antes da aula: suba o ambiente (`docker compose up -d`), rode `scripts/configurar.sh`, abra o painel e deixe aberto **há pelo menos 5 minutos** para a linha do tempo ter pontos. Deixe também o DBeaver conectado como `SYSTEM` e, em outra aba, o arquivo `sql/02_views_monitoramento.sql`.

## 1. Problema e proposta (1 min)

- O DBA precisa saber, rapidamente, se o banco está saudável. As informações existem nas views `V$`, mas consultar uma por uma no SQL Developer é lento.
- Proposta: um painel simples que lê essas views em tempo real, usando só o que o Oracle oferece (views, scheduler, PL/SQL e ORDS).

## 2. Arquitetura (2 min)

Mostrar o diagrama do README:

1. **Views `VW_*`** no schema `PAINEL_MON`: uma por métrica. O usuário tem só `SELECT` nas `V$` (privilégio mínimo).
2. **ORDS** transforma cada view num endpoint REST, sem escrever backend em Go/Python/Node.
3. **Job `DBMS_SCHEDULER`** grava um snapshot a cada 15 s, o que dá histórico.
4. **Painel HTML/JS** servido pelo próprio ORDS, que atualiza a cada 10 s com `fetch`.

Abrir no navegador: `http://localhost:8181/ords/painel/monitor/stats/resumo` e mostrar o JSON.

## 3. Tour do painel em repouso (2 min)

- Cards de identificação: instância `OPEN`, banco `READ WRITE`, container `FREEPDB1`.
- Sessões: quase todas `INACTIVE` (pool do ORDS) e "Ativas agora" perto de 0.
- Waits: aba **Desde o startup** × aba **Agora**. Explicar acumulado × momento.
- Tablespaces: uso em relação ao máximo com autoextend.

## 4. Demonstração ao vivo (4 min)

1. Perfil **Média**, 3 min, e clicar em **Gerar carga**.
2. Na próxima atualização:
   - **Ativas agora** sobe para 6 a 8, e o AAS sobe em seguida.
   - **Sessões ativas**: módulos `CONSULTA`, `CPU`, `LOCK_FILA`.
   - **Esperas agora**: "Em CPU" e `enq: TX - row lock contention`.
   - **Alerta vermelho de bloqueio**: abrir o bloco Bloqueios e mostrar que `LOCK_FILA` espera `LOCK_DONO`.
   - **Top SQL**: o `SELECT ... GROUP BY` da `VENDAS` com muitas leituras lógicas, e o `UPDATE` com tempo total alto mas CPU quase zero (só esperando lock). Clicar no SQL_ID.
3. **Linha do tempo**: mostrar a subida.
4. (Opcional) No DBeaver como SYSTEM, rodar a consulta 4 de `consultas.sql` e matar o bloqueador com `ALTER SYSTEM KILL SESSION`. O alerta some.
5. Clicar em **Parar**: em poucos segundos tudo volta ao normal.

## 5. De onde vem cada número (2 min)

Abrir `02_views_monitoramento.sql` e mostrar, por exemplo, a `VW_BLOQUEIOS` (auto-join em `V$SESSION` por `BLOCKING_SESSION`) e a `VW_RESUMO`. Depois mostrar o `05_ords_modulo.sql`: cada endpoint é uma linha `get_lista('stats/...', 'SELECT * FROM vw_...')`.

## 6. Limitações e próximos passos (1 min)

- Endpoints públicos: em produção, proteger com privilégios ORDS/OAuth.
- `V$SYSTEM_EVENT` e `V$SQLAREA` são acumulados desde o startup. O próximo passo seria guardar deltas no histórico, como o AWR faz.
- Alertas por e-mail quando houver bloqueio por mais de N segundos (outro job do scheduler).

## Perguntas prováveis

- **Por que ORDS e não um backend próprio?** Menos peças: o banco já publica a API, e a lógica fica em SQL, que é o foco da disciplina.
- **Por que grants diretos e não `SELECT_CATALOG_ROLE`?** Privilégios de role não valem dentro de views e procedures definer-rights, e assim damos só o necessário.
- **AAS de 3 é ruim?** Depende das CPUs. O Oracle Free usa até 2 threads, então AAS 3 significa sessões em fila.
- **O painel pesa no banco?** São consultas leves em `V$`, a cada 10 s. A sessão do próprio painel é excluída das contagens.
