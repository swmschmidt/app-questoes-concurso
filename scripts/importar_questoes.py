"""Cria o schema e sincroniza as questões do questoes.json com o Supabase.

Uso:
    python scripts/importar_questoes.py --dsn "postgresql://..."
    DATABASE_URL="postgresql://..." python scripts/importar_questoes.py

A tabela public.avaliacoes guarda as notas de dificuldade (1 a 5) usadas pelo app.
A tabela public.questoes é um espelho do questoes.json, para consulta e patch manual.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVO_BANCO = RAIZ / "questoes.json"
ARQUIVO_SCHEMA = Path(__file__).resolve().parent / "schema.sql"

COLUNAS = (
    "id",
    "prova_slug",
    "banca",
    "orgao",
    "ano",
    "cargo",
    "disciplina",
    "numero",
    "enunciado",
    "enunciado_busca",
    "alternativas",
    "gabarito",
    "status",
    "extracao",
    "fonte",
)
TAMANHO_LOTE = 500


def texto(valor) -> str:
    return "" if valor is None else str(valor)


def numero(valor):
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def normalizar_busca(valor: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", valor or "")
    sem_acento = "".join(caractere for caractere in sem_acento if not unicodedata.combining(caractere))
    return re.sub(r"\s+", " ", sem_acento.lower()).strip()


def montar_linha(item: dict) -> tuple:
    alternativas = {str(letra): texto(conteudo) for letra, conteudo in (item.get("alternativas") or {}).items()}
    enunciado = texto(item.get("enunciado"))
    return (
        texto(item.get("id")),
        texto(item.get("prova_slug")),
        texto(item.get("banca")),
        texto(item.get("orgao")),
        numero(item.get("ano")),
        texto(item.get("cargo")),
        texto(item.get("disciplina")),
        numero(item.get("numero")),
        enunciado,
        normalizar_busca(enunciado),
        json.dumps(alternativas, ensure_ascii=False),
        texto(item.get("gabarito")),
        texto(item.get("status")),
        json.dumps(item.get("extracao") or {}, ensure_ascii=False),
        json.dumps(item.get("fonte") or {}, ensure_ascii=False),
    )


def aplicar_schema(conn) -> None:
    if not ARQUIVO_SCHEMA.exists():
        raise SystemExit(f"schema não encontrado: {ARQUIVO_SCHEMA}")
    with conn.cursor() as cur:
        cur.execute(ARQUIVO_SCHEMA.read_text(encoding="utf-8"))
    conn.commit()
    print("schema aplicado (avaliacoes + questoes)")


def sincronizar(conn, itens: list[dict]) -> None:
    linhas = [montar_linha(item) for item in itens]
    ids = [linha[0] for linha in linhas]

    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            insert into public.questoes ({", ".join(COLUNAS)})
            values %s
            on conflict (id) do update set
              prova_slug = excluded.prova_slug,
              banca = excluded.banca,
              orgao = excluded.orgao,
              ano = excluded.ano,
              cargo = excluded.cargo,
              disciplina = excluded.disciplina,
              numero = excluded.numero,
              enunciado = excluded.enunciado,
              enunciado_busca = excluded.enunciado_busca,
              alternativas = excluded.alternativas,
              gabarito = excluded.gabarito,
              status = excluded.status,
              extracao = excluded.extracao,
              fonte = excluded.fonte,
              importado_em = now()
            """,
            linhas,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s::jsonb)",
            page_size=TAMANHO_LOTE,
        )
        cur.execute("delete from public.questoes where not (id = any(%s))", (ids,))
        if cur.rowcount:
            print(f"{cur.rowcount} questão(ões) removida(s) por não existirem mais no JSON")
    conn.commit()


def resumo(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("select count(*), count(*) filter (where status = 'correta') from public.questoes")
        total, corretas = cur.fetchone()
        cur.execute("select count(*), min(nota), max(nota), round(avg(nota), 2) from public.avaliacoes")
        avaliacoes = cur.fetchone()
    print(f"questoes: {total} linhas ({corretas} com status 'correta')")
    print(f"avaliacoes: {avaliacoes[0]} notas | min {avaliacoes[1]} | max {avaliacoes[2]} | media {avaliacoes[3]}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sincroniza questoes.json com o Postgres do Supabase")
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL", ""), help="string de conexão (ou use DATABASE_URL)")
    parser.add_argument("--arquivo", default=str(ARQUIVO_BANCO), help="caminho do questoes.json")
    parser.add_argument("--sem-schema", action="store_true", help="não executa o schema.sql")
    argumentos = parser.parse_args()

    if not argumentos.dsn:
        print("informe --dsn ou a variável de ambiente DATABASE_URL", file=sys.stderr)
        return 2

    caminho = Path(argumentos.arquivo)
    print(f"lendo {caminho} ...")
    itens = json.loads(caminho.read_text(encoding="utf-8"))
    print(f"{len(itens)} registros no JSON")

    with psycopg2.connect(argumentos.dsn, connect_timeout=15, application_name="importar-questoes") as conn:
        if not argumentos.sem_schema:
            aplicar_schema(conn)
        sincronizar(conn, itens)
        resumo(conn)

    print("sincronização concluída")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
