"""Sincroniza os artefatos da análise (tópicos, subtópicos e classificação) com o Supabase.

Lê os arquivos gerados por scripts/analisar_banco.py (projeto da análise) e grava:
  public.topicos                 -> incidência por tópico
  public.subtopicos              -> incidência por subtópico
  public.questoes_classificacao  -> classificação + incidência por questão

Cada linha de questoes_classificacao referencia um id existente em public.questoes
(ON DELETE CASCADE), então rode antes o scripts/importar_questoes.py.

Uso:
    python scripts/importar_dashboard.py --dsn "postgresql://..."
    DATABASE_URL="..." python scripts/importar_dashboard.py \
        --categorizadas "C:/Users/samue/Downloads/Concurso/data/analise/questoes_categorizadas.json" \
        --estatisticas  "C:/Users/samue/Downloads/Concurso/data/analise/estatisticas.json"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVO_SCHEMA = Path(__file__).resolve().parent / "schema.sql"
CAMINHO_PADRAO_ANALISE = Path(r"C:\Users\samue\Downloads\Concurso\data\analise")
TAMANHO_LOTE = 500


def texto(valor):
    return None if valor in (None, "") else str(valor)


def numero(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def booleano(valor) -> bool:
    return bool(valor)


def aplicar_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(ARQUIVO_SCHEMA.read_text(encoding="utf-8"))
    conn.commit()
    print("schema aplicado (topicos, subtopicos, questoes_classificacao)")


def sincronizar_topicos(conn, por_topico: list[dict]) -> None:
    linhas = [
        (
            t["id"],
            t.get("nome") or t["id"],
            t.get("grupo"),
            int(t.get("n") or 0),
            int(t.get("n_corretas") or 0),
            numero(t.get("bruto")),
            numero(t.get("bonus")),
            numero(t.get("score")),
            numero(t.get("score_norm")),
            texto(t.get("tier")),
            json.dumps(t.get("por_ano") or {}, ensure_ascii=False),
            json.dumps(t.get("top_bancas") or [], ensure_ascii=False),
            json.dumps(t.get("termos") or [], ensure_ascii=False),
        )
        for t in por_topico
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.topicos (id, nome, grupo, n, n_corretas, bruto, bonus, score, score_norm,
                                        tier, por_ano, top_bancas, termos)
            values %s
            on conflict (id) do update set
              nome = excluded.nome, grupo = excluded.grupo, n = excluded.n,
              n_corretas = excluded.n_corretas, bruto = excluded.bruto, bonus = excluded.bonus,
              score = excluded.score, score_norm = excluded.score_norm, tier = excluded.tier,
              por_ano = excluded.por_ano, top_bancas = excluded.top_bancas, termos = excluded.termos,
              atualizado_em = now()
            """,
            linhas,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb)",
            page_size=TAMANHO_LOTE,
        )
        execute_values(
            cur,
            """
            delete from public.topicos t
             where not exists (
               select 1 from (values %s) as n(id) where n.id = t.id
             )
            """,
            [(t["id"],) for t in por_topico],
            page_size=TAMANHO_LOTE,
        )
    conn.commit()
    print(f"topicos: {len(linhas)} linhas")


def sincronizar_subtopicos(conn, por_subtopico: list[dict]) -> None:
    linhas = [
        (
            s["topico"],
            s["id"],
            s.get("nome") or s["id"],
            int(s.get("n") or 0),
            int(s.get("n_corretas") or 0),
            numero(s.get("score")),
            texto(s.get("tier")),
            json.dumps(s.get("por_ano") or {}, ensure_ascii=False),
            json.dumps(s.get("top_bancas") or [], ensure_ascii=False),
            json.dumps(s.get("termos") or [], ensure_ascii=False),
            json.dumps(s.get("ids_exemplo") or [], ensure_ascii=False),
        )
        for s in por_subtopico
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.subtopicos (topico_id, id, nome, n, n_corretas, score, tier,
                                           por_ano, top_bancas, termos, ids_exemplo)
            values %s
            on conflict (topico_id, id) do update set
              nome = excluded.nome, n = excluded.n, n_corretas = excluded.n_corretas,
              score = excluded.score, tier = excluded.tier, por_ano = excluded.por_ano,
              top_bancas = excluded.top_bancas, termos = excluded.termos,
              ids_exemplo = excluded.ids_exemplo, atualizado_em = now()
            """,
            linhas,
            template="(%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb)",
            page_size=TAMANHO_LOTE,
        )
        execute_values(
            cur,
            """
            delete from public.subtopicos s
             where not exists (
               select 1 from (values %s) as n(topico_id, id)
                where n.topico_id = s.topico_id and n.id = s.id
             )
            """,
            [(s["topico"], s["id"]) for s in por_subtopico],
            page_size=TAMANHO_LOTE,
        )
        if cur.rowcount:
            print(f"{cur.rowcount} subtópico(s) removido(s) por não existirem mais")
    conn.commit()
    print(f"subtopicos: {len(linhas)} linhas")


def sincronizar_classificacao(conn, questoes: list[dict]) -> None:
    linhas = []
    for q in questoes:
        classificacao = q.get("classificacao") or {}
        incidencia = q.get("incidencia") or {}
        linhas.append(
            (
                q["id"],
                texto(q.get("banca_canonica")),
                texto(q.get("uf")),
                texto(q.get("disciplina_analise")),
                texto(classificacao.get("topico")),
                texto(classificacao.get("subtopico")),
                texto(classificacao.get("subtopico_nome")),
                texto(classificacao.get("tipo_formato")),
                texto(classificacao.get("tipo_comando")),
                numero(incidencia.get("score")),
                texto(incidencia.get("tier")),
                booleano(incidencia.get("alta_incidencia")),
            )
        )

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            insert into public.questoes_classificacao (questao_id, banca_canonica, uf, disciplina_analise,
                                                       topico, subtopico, subtopico_nome, tipo_formato,
                                                       tipo_comando, incidencia_score, incidencia_tier,
                                                       alta_incidencia)
            values %s
            on conflict (questao_id) do update set
              banca_canonica = excluded.banca_canonica, uf = excluded.uf,
              disciplina_analise = excluded.disciplina_analise, topico = excluded.topico,
              subtopico = excluded.subtopico, subtopico_nome = excluded.subtopico_nome,
              tipo_formato = excluded.tipo_formato, tipo_comando = excluded.tipo_comando,
              incidencia_score = excluded.incidencia_score, incidencia_tier = excluded.incidencia_tier,
              alta_incidencia = excluded.alta_incidencia, atualizado_em = now()
            """,
            linhas,
            page_size=TAMANHO_LOTE,
        )
        ids = [linha[0] for linha in linhas]
        cur.execute("delete from public.questoes_classificacao where not (questao_id = any(%s))", (ids,))
        if cur.rowcount:
            print(f"{cur.rowcount} classificação(ões) removida(s) por não existirem mais")
    conn.commit()
    print(f"questoes_classificacao: {len(linhas)} linhas")


def resumo(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.topicos")
        topicos = cur.fetchone()[0]
        cur.execute("select count(*) from public.subtopicos")
        subtopicos = cur.fetchone()[0]
        cur.execute("select count(*), count(topico) from public.questoes_classificacao")
        total, classificadas = cur.fetchone()
        cur.execute("select count(*) from public.questoes_classificacao c join public.questoes q on q.id = c.questao_id")
        ligadas = cur.fetchone()[0]
    print(f"topicos: {topicos} | subtopicos: {subtopicos} | classificações: {total} ({classificadas} com tópico)")
    print(f"classificações com questão correspondente em questoes: {ligadas}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sincroniza a análise (tópicos/subtópicos/classificação) com o Postgres")
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL", ""), help="string de conexão (ou use DATABASE_URL)")
    parser.add_argument("--categorizadas", default=str(CAMINHO_PADRAO_ANALISE / "questoes_categorizadas.json"))
    parser.add_argument("--estatisticas", default=str(CAMINHO_PADRAO_ANALISE / "estatisticas.json"))
    parser.add_argument("--sem-schema", action="store_true")
    argumentos = parser.parse_args()

    if not argumentos.dsn:
        print("informe --dsn ou a variável de ambiente DATABASE_URL", file=sys.stderr)
        return 2

    caminho_questoes = Path(argumentos.categorizadas)
    caminho_estatisticas = Path(argumentos.estatisticas)
    for caminho in (caminho_questoes, caminho_estatisticas):
        if not caminho.exists():
            print(f"arquivo não encontrado: {caminho}", file=sys.stderr)
            return 2

    print(f"lendo {caminho_questoes.name} ...")
    questoes = json.loads(caminho_questoes.read_text(encoding="utf-8"))
    print(f"{len(questoes)} questões categorizadas")
    estatisticas = json.loads(caminho_estatisticas.read_text(encoding="utf-8"))
    especificas = estatisticas["especificas"]

    with psycopg2.connect(argumentos.dsn, connect_timeout=15, application_name="importar-dashboard") as conn:
        if not argumentos.sem_schema:
            aplicar_schema(conn)
        sincronizar_topicos(conn, especificas["por_topico"])
        sincronizar_subtopicos(conn, especificas["por_subtopico"])
        sincronizar_classificacao(conn, questoes)
        resumo(conn)

    print("sincronização concluída")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
