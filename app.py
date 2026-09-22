"""Aplicativo de questões para concursos de Auxiliar de Saúde Bucal.

Roda no Fly.io em uma única máquina, com pouca memória e scale-to-zero.
O banco de questões vem do questoes.json (payload pré-comprimido em memória) e os
dados persistentes ficam no Postgres do Supabase.

Autenticação: Firebase Auth (e-mail/senha, via API REST do Identity Toolkit) para
validar as credenciais e sessão própria com JWT de acesso + refresh token
rotativo guardado em public.sessoes.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import logging
import os
import re
import secrets
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, render_template, request, url_for

import jwt

from questoes_bank import carregar_ou_gerar

try:
    import psycopg2
    import psycopg2.extras
    from psycopg2 import pool as pg_pool
except ImportError:  # pragma: no cover
    psycopg2 = None
    pg_pool = None

try:
    import psycopg2
    import psycopg2.extras
    from psycopg2 import pool as pg_pool
except ImportError:  # pragma: no cover
    psycopg2 = None
    pg_pool = None

BASE_DIR = Path(__file__).resolve().parent
ARQUIVO_BANCO = BASE_DIR / "questoes.json"
DIRETORIO_DADOS = BASE_DIR / "dados"
DIRETORIO_ESTATICOS = BASE_DIR / "static"

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip() or "troque-este-segredo-em-producao"
JWT_EMISSOR = "app-questoes-concurso"
JWT_TTL_ACESSO = timedelta(minutes=30)
TTL_REFRESH = timedelta(days=30)
NOME_COOKIE_REFRESH = "aq_refresh"
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY", "").strip()
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "").strip()
FIREBASE_APP_ID = os.environ.get("FIREBASE_APP_ID", "").strip()
CACHE_PAYLOAD = "public, max-age=86400, immutable"
TAMANHO_MINIMO_GZIP = 900
NIVEIS_MIN = 1
NIVEIS_MAX = 5
TAMANHO_MAX_DESCRICAO = 2000
TAMANHO_MAX_ANOTACAO = 2000
TAMANHO_MAX_NOME = 120
LIMITE_ANOTACOES_PAGINA = 300
LIMITE_LOTE_RESPOSTAS = 5000
MINIMO_TENTATIVAS_TEMA = 3
TIPOS_COMPRIMIVEIS = {
    "application/javascript",
    "application/json",
    "text/css",
    "text/html",
    "text/javascript",
    "text/plain",
}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("app-questoes")

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 60 * 60 * 24
app.json.ensure_ascii = False


def versao_dos_estaticos() -> str:
    digest = hashlib.sha1()
    for arquivo in sorted(DIRETORIO_ESTATICOS.rglob("*")):
        if arquivo.is_file():
            digest.update(arquivo.name.encode("utf-8"))
            digest.update(str(arquivo.stat().st_mtime_ns).encode("utf-8"))
    return digest.hexdigest()[:10]


_inicio = time.perf_counter()
PAYLOAD_BRUTO, PAYLOAD_GZIP, IDS_VALIDOS, META_BANCO = carregar_ou_gerar(ARQUIVO_BANCO, DIRETORIO_DADOS)
TOTAL_QUESTOES = META_BANCO["total"]
VERSAO_PAYLOAD = META_BANCO["versao"]
log.info(
    "Banco carregado: %d questões (%d MB, %d MB em gzip) em %.2fs",
    TOTAL_QUESTOES,
    len(PAYLOAD_BRUTO) // 1_000_000,
    len(PAYLOAD_GZIP) // 1_000_000,
    time.perf_counter() - _inicio,
)

VERSAO_ESTATICOS = versao_dos_estaticos()

_pool = None
_pool_lock = threading.Lock()


def _reiniciar_pool() -> None:
    global _pool
    with _pool_lock:
        pool = _pool
        _pool = None
    if pool is not None:
        try:
            pool.closeall()
        except Exception:
            pass


def _obter_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = pg_pool.ThreadedConnectionPool(
                    1,
                    3,
                    dsn=DATABASE_URL,
                    connect_timeout=10,
                    application_name="app-questoes-concurso",
                )
    return _pool


@contextmanager
def conexao_banco():
    if psycopg2 is None:
        raise RuntimeError("driver psycopg2 não instalado")
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL não configurada")

    ultimo_erro = None
    for _ in range(2):
        try:
            pool = _obter_pool()
            conexao = pool.getconn()
        except Exception as erro:
            ultimo_erro = erro
            _reiniciar_pool()
            continue

        try:
            yield conexao
            conexao.commit()
            pool.putconn(conexao)
            return
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as erro:
            ultimo_erro = erro
            try:
                pool.putconn(conexao, close=True)
            except Exception:
                pass
            _reiniciar_pool()
        except Exception:
            try:
                conexao.rollback()
                pool.putconn(conexao)
            except Exception:
                pass
            raise

    raise ultimo_erro if ultimo_erro else RuntimeError("falha desconhecida no banco")


def executar_sql(sql: str, parametros=None, buscar: bool = False, dicionario: bool = False):
    fabrica = psycopg2.extras.RealDictCursor if dicionario else None
    with conexao_banco() as conexao:
        with conexao.cursor(cursor_factory=fabrica) as cursor:
            cursor.execute(sql, parametros)
            return cursor.fetchall() if buscar else None


def executar_lote(sql: str, linhas: list, template: str | None = None, tamanho_pagina: int = 500) -> int:
    if not linhas:
        return 0
    with conexao_banco() as conexao:
        with conexao.cursor() as cursor:
            psycopg2.extras.execute_values(cursor, sql, linhas, template=template, page_size=tamanho_pagina)
            return cursor.rowcount


@app.get("/")
def index() -> str:
    return render_template(
        "index.html",
        total_questoes=TOTAL_QUESTOES,
        versao=VERSAO_ESTATICOS,
        versao_payload=VERSAO_PAYLOAD,
        banco_disponivel=bool(DATABASE_URL and psycopg2),
        auth_disponivel=firebase_configurado(),
    )


@app.get("/api/questoes")
def api_questoes() -> Response:
    etag = f'"{VERSAO_PAYLOAD}"'
    cabecalhos = {"ETag": etag, "Cache-Control": CACHE_PAYLOAD, "Vary": "Accept-Encoding"}
    if request.headers.get("If-None-Match") == etag:
        return Response(status=304, headers=cabecalhos)

    if "gzip" in request.accept_encodings:
        resposta = Response(PAYLOAD_GZIP, mimetype="application/json", headers=cabecalhos)
        resposta.headers["Content-Encoding"] = "gzip"
        return resposta
    return Response(PAYLOAD_BRUTO, mimetype="application/json", headers=cabecalhos)


@app.get("/api/avaliacoes")
def api_listar_avaliacoes() -> Response:
    try:
        linhas = executar_sql("select questao_id, nota from public.avaliacoes", buscar=True)
    except Exception as erro:
        log.warning("Falha ao ler avaliações: %s", erro)
        return jsonify({"erro": "avaliacoes_indisponiveis"}), 503
    return jsonify({"avaliacoes": {identificador: nota for identificador, nota in linhas}})


@app.post("/api/avaliacoes")
def api_salvar_avaliacao() -> Response:
    corpo = request.get_json(silent=True) or {}
    questao_id = str(corpo.get("questao_id") or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    try:
        nota = int(corpo.get("nota"))
    except (TypeError, ValueError):
        return jsonify({"erro": "nota_invalida"}), 400
    if not NIVEIS_MIN <= nota <= NIVEIS_MAX:
        return jsonify({"erro": "nota_invalida"}), 400

    try:
        linhas = executar_sql(
            """
            insert into public.avaliacoes (questao_id, nota)
            values (%s, %s)
            on conflict (questao_id) do update
              set nota = excluded.nota, atualizado_em = now()
            returning nota, atualizado_em
            """,
            (questao_id, nota),
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao salvar avaliação: %s", erro)
        return jsonify({"erro": "avaliacao_indisponivel"}), 503

    nota_salva, atualizado_em = linhas[0]
    return jsonify({"questao_id": questao_id, "nota": nota_salva, "atualizado_em": atualizado_em.isoformat()})


@app.delete("/api/avaliacoes/<questao_id>")
def api_remover_avaliacao(questao_id: str) -> Response:
    questao_id = str(questao_id or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    try:
        executar_sql("delete from public.avaliacoes where questao_id = %s", (questao_id,))
    except Exception as erro:
        log.warning("Falha ao remover avaliação: %s", erro)
        return jsonify({"erro": "avaliacao_indisponivel"}), 503

    return jsonify({"questao_id": questao_id, "removida": True})


@app.post("/api/reportes")
def api_registrar_reporte() -> Response:
    corpo = request.get_json(silent=True) or {}
    questao_id = str(corpo.get("questao_id") or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    descricao = str(corpo.get("descricao") or "").strip()
    if len(descricao) > TAMANHO_MAX_DESCRICAO:
        return jsonify({"erro": "descricao_longa", "limite": TAMANHO_MAX_DESCRICAO}), 400

    try:
        linhas = executar_sql(
            "insert into public.reportes (questao_id, descricao) values (%s, %s) returning id, criado_em",
            (questao_id, descricao or None),
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao registrar relato: %s", erro)
        return jsonify({"erro": "reporte_indisponivel"}), 503

    identificador, criado_em = linhas[0]
    return jsonify({"id": identificador, "questao_id": questao_id, "criado_em": criado_em.isoformat()}), 201


@app.get("/api/anotacoes")
def api_listar_anotacoes() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    try:
        linhas = executar_sql(
            "select questao_id, texto from public.anotacoes where usuario_id = %s",
            (usuario["id"],),
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao ler anotações: %s", erro)
        return jsonify({"erro": "anotacoes_indisponiveis"}), 503
    return jsonify({"anotacoes": {identificador: texto for identificador, texto in linhas}})


@app.post("/api/anotacoes")
def api_salvar_anotacao() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    corpo = request.get_json(silent=True) or {}
    questao_id = str(corpo.get("questao_id") or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    texto = str(corpo.get("texto") or "").strip()
    if not texto:
        return jsonify({"erro": "anotacao_vazia"}), 400
    if len(texto) > TAMANHO_MAX_ANOTACAO:
        return jsonify({"erro": "anotacao_longa", "limite": TAMANHO_MAX_ANOTACAO}), 400

    try:
        linhas = executar_sql(
            """
            insert into public.anotacoes (usuario_id, questao_id, texto)
            values (%s, %s, %s)
            on conflict (usuario_id, questao_id) do update
              set texto = excluded.texto, atualizado_em = now()
            returning texto, atualizado_em
            """,
            (usuario["id"], questao_id, texto),
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao salvar anotação: %s", erro)
        return jsonify({"erro": "anotacao_indisponivel"}), 503

    texto_salvo, atualizado_em = linhas[0]
    return jsonify({"questao_id": questao_id, "texto": texto_salvo, "atualizado_em": atualizado_em.isoformat()})


@app.delete("/api/anotacoes/<questao_id>")
def api_remover_anotacao(questao_id: str) -> Response:
    usuario = usuario_atual(obrigatorio=True)
    questao_id = str(questao_id or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    try:
        executar_sql(
            "delete from public.anotacoes where usuario_id = %s and questao_id = %s",
            (usuario["id"], questao_id),
        )
    except Exception as erro:
        log.warning("Falha ao remover anotação: %s", erro)
        return jsonify({"erro": "anotacao_indisponivel"}), 503

    return jsonify({"questao_id": questao_id, "removida": True})


@app.get("/api/minhas/respostas")
def api_minhas_respostas() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    try:
        linhas = executar_sql(
            """
            select distinct on (questao_id) questao_id, escolha, acerto
              from public.respostas
             where usuario_id = %s
             order by questao_id, criado_em desc
            """,
            (usuario["id"],),
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao ler respostas: %s", erro)
        return jsonify({"erro": "respostas_indisponiveis"}), 503
    return jsonify(
        {"respostas": {linha[0]: {"escolha": linha[1], "acerto": 1 if linha[2] else 0} for linha in linhas}}
    )


@app.post("/api/minhas/respostas")
def api_salvar_resposta() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    corpo = request.get_json(silent=True) or {}
    questao_id = str(corpo.get("questao_id") or "").strip()
    if questao_id not in IDS_VALIDOS:
        return jsonify({"erro": "questao_desconhecida"}), 400

    escolha = str(corpo.get("escolha") or "").strip().upper()[:1] or None
    try:
        executar_sql(
            "insert into public.respostas (usuario_id, questao_id, escolha, acerto) values (%s, %s, %s, %s)",
            (usuario["id"], questao_id, escolha, bool(corpo.get("acerto"))),
        )
    except Exception as erro:
        log.warning("Falha ao salvar resposta: %s", erro)
        return jsonify({"erro": "resposta_indisponivel"}), 503
    return jsonify({"ok": True}), 201


@app.post("/api/minhas/respostas/lote")
def api_importar_respostas() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    corpo = request.get_json(silent=True) or {}
    itens = corpo.get("respostas")
    if not isinstance(itens, list) or not itens:
        return jsonify({"ok": True, "importadas": 0})

    linhas = []
    for item in itens[:LIMITE_LOTE_RESPOSTAS]:
        if not isinstance(item, dict):
            continue
        questao_id = str(item.get("id") or item.get("questao_id") or "").strip()
        if questao_id not in IDS_VALIDOS:
            continue
        escolha = str(item.get("escolha") or "").strip().upper()[:1] or None
        linhas.append((usuario["id"], questao_id, escolha, bool(item.get("acerto"))))

    try:
        importadas = executar_lote(
            "insert into public.respostas (usuario_id, questao_id, escolha, acerto) values %s",
            linhas,
        )
    except Exception as erro:
        log.warning("Falha ao importar respostas: %s", erro)
        return jsonify({"erro": "resposta_indisponivel"}), 503
    return jsonify({"ok": True, "importadas": importadas})


@app.delete("/api/minhas/respostas")
def api_limpar_respostas() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    try:
        with conexao_banco() as conexao:
            with conexao.cursor() as cursor:
                cursor.execute("delete from public.respostas where usuario_id = %s", (usuario["id"],))
                removidas = cursor.rowcount
    except Exception as erro:
        log.warning("Falha ao limpar respostas: %s", erro)
        return jsonify({"erro": "resposta_indisponivel"}), 503
    return jsonify({"ok": True, "removidas": removidas})


SQL_MINHAS_RESUMO = """
with minhas as (
  select distinct on (r.questao_id) r.questao_id, r.acerto
    from public.respostas r
   where r.usuario_id = %s
   order by r.questao_id, r.criado_em desc
)
select
  (select count(*) from public.respostas where usuario_id = %s) as tentativas,
  (select count(*) from minhas) as respondidas,
  (select count(*) from minhas where acerto) as acertos,
  (select count(*) from public.anotacoes where usuario_id = %s) as anotacoes,
  (select max(criado_em) from public.respostas where usuario_id = %s) as ultima,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select coalesce(c.disciplina_analise, q.disciplina) as valor, count(*) as n,
                  count(*) filter (where m.acerto) as acertos
             from minhas m
             join public.questoes q on q.id = m.questao_id
             left join public.questoes_classificacao c on c.questao_id = q.id
            group by 1) x) as por_disciplina,
  (select coalesce(json_agg(x order by x.acertos::float / x.n desc, x.n desc), '[]'::json)
     from (select c.topico as id, coalesce(t.nome, c.topico) as nome, count(*) as n,
                  count(*) filter (where m.acerto) as acertos
             from minhas m
             join public.questoes_classificacao c on c.questao_id = m.questao_id
             left join public.topicos t on t.id = c.topico
            where c.topico is not null
            group by 1, 2
           having count(*) >= %s) x) as por_topico
"""


@app.get("/api/minhas/resumo")
def api_minhas_resumo() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    try:
        linha = dict(
            executar_sql(
                SQL_MINHAS_RESUMO,
                (usuario["id"], usuario["id"], usuario["id"], usuario["id"], MINIMO_TENTATIVAS_TEMA),
                buscar=True,
                dicionario=True,
            )[0]
        )
    except Exception as erro:
        log.warning("Falha ao carregar o resumo do usuário: %s", erro)
        return jsonify({"erro": "resumo_indisponivel"}), 503

    if linha.get("ultima"):
        linha["ultima"] = linha["ultima"].isoformat()
    return jsonify(linha)


SQL_MINHAS_QUESTOES = """
with ultimas as (
  select distinct on (questao_id) questao_id, escolha, acerto, criado_em
    from public.respostas
   where usuario_id = %s
   order by questao_id, criado_em desc
)
select u.questao_id as id, u.escolha, u.acerto, u.criado_em,
       left(q.enunciado, 320) as enunciado, q.banca, q.ano, q.orgao, q.gabarito,
       coalesce(c.disciplina_analise, q.disciplina) as disciplina,
       c.topico, coalesce(t.nome, c.topico) as topico_nome, c.subtopico_nome,
       c.tipo_formato as formato,
       count(*) over () as total
  from ultimas u
  join public.questoes q on q.id = u.questao_id
  left join public.questoes_classificacao c on c.questao_id = q.id
  left join public.topicos t on t.id = c.topico
 where {filtros}
 order by u.criado_em desc
 limit %s offset %s
"""


@app.get("/api/minhas/questoes")
def api_minhas_questoes() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    filtros = ["true"]
    parametros: list = [usuario["id"]]

    resultado = str(request.args.get("resultado") or "").strip()
    if resultado == "acertos":
        filtros.append("u.acerto")
    elif resultado == "erros":
        filtros.append("not u.acerto")

    disciplina = str(request.args.get("disciplina") or "").strip()
    if disciplina:
        filtros.append("coalesce(c.disciplina_analise, q.disciplina) = %s")
        parametros.append(disciplina)

    topico = str(request.args.get("topico") or "").strip()
    if topico:
        filtros.append("c.topico = %s")
        parametros.append(topico)

    busca = normalizar_busca(request.args.get("busca", ""))
    if busca:
        filtros.append("q.enunciado_busca like %s")
        parametros.append(f"%{busca}%")

    try:
        pagina = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        pagina = 1
    try:
        por_pagina = min(50, max(1, int(request.args.get("per_page", 20))))
    except (TypeError, ValueError):
        por_pagina = 20

    try:
        linhas = executar_sql(
            SQL_MINHAS_QUESTOES.format(filtros=" and ".join(filtros)),
            parametros + [por_pagina, (pagina - 1) * por_pagina],
            buscar=True,
            dicionario=True,
        )
    except Exception as erro:
        log.warning("Falha ao listar as questões do usuário: %s", erro)
        return jsonify({"erro": "questoes_indisponiveis"}), 503

    total = linhas[0]["total"] if linhas else 0
    itens = []
    for linha in linhas:
        item = dict(linha)
        item.pop("total", None)
        if item.get("criado_em"):
            item["criado_em"] = item["criado_em"].isoformat()
        itens.append(item)

    return jsonify(
        {
            "total": total,
            "page": pagina,
            "per_page": por_pagina,
            "paginas": (total + por_pagina - 1) // por_pagina if total else 0,
            "itens": itens,
        }
    )


@app.get("/api/minhas/anotacoes")
def api_minhas_anotacoes() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    try:
        linhas = executar_sql(
            """
            select a.questao_id as id, a.texto, a.atualizado_em,
                   left(q.enunciado, 320) as enunciado, q.banca, q.ano, q.orgao, q.gabarito,
                   coalesce(c.disciplina_analise, q.disciplina) as disciplina,
                   c.topico, coalesce(t.nome, c.topico) as topico_nome, c.subtopico_nome,
                   c.tipo_formato as formato
              from public.anotacoes a
              join public.questoes q on q.id = a.questao_id
              left join public.questoes_classificacao c on c.questao_id = q.id
              left join public.topicos t on t.id = c.topico
             where a.usuario_id = %s
             order by a.atualizado_em desc
             limit 200
            """,
            (usuario["id"],),
            buscar=True,
            dicionario=True,
        )
    except Exception as erro:
        log.warning("Falha ao listar as anotações do usuário: %s", erro)
        return jsonify({"erro": "anotacoes_indisponiveis"}), 503

    itens = []
    for linha in linhas:
        item = dict(linha)
        if item.get("atualizado_em"):
            item["atualizado_em"] = item["atualizado_em"].isoformat()
        itens.append(item)
    return jsonify({"total": len(itens), "itens": itens})


@app.get("/anotacoes")
def pagina_anotacoes() -> Response:
    return redirect(url_for("pagina_minhas_estatisticas") + "#anotacoes", code=302)


def normalizar_busca(valor: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", valor or "")
    sem_acento = "".join(caractere for caractere in sem_acento if not unicodedata.combining(caractere))
    return re.sub(r"\s+", " ", sem_acento.lower()).strip()


def montar_filtros(args) -> tuple[str, list]:
    condicoes: list[str] = []
    parametros: list = []

    busca = normalizar_busca(args.get("busca", ""))
    if busca:
        condicoes.append("q.enunciado_busca like %s")
        parametros.append(f"%{busca}%")

    for chave, coluna in (
        ("disciplina", "c.disciplina_analise"),
        ("banca", "c.banca_canonica"),
        ("topico", "c.topico"),
        ("subtopico", "c.subtopico"),
        ("formato", "c.tipo_formato"),
        ("comando", "c.tipo_comando"),
        ("status", "q.status"),
        ("tier", "c.incidencia_tier"),
        ("uf", "c.uf"),
    ):
        valor = str(args.get(chave) or "").strip()
        if valor:
            condicoes.append(f"{coluna} = %s")
            parametros.append(valor)

    ano = str(args.get("ano") or "").strip()
    if ano.isdigit():
        condicoes.append("q.ano = %s")
        parametros.append(int(ano))

    if str(args.get("alta") or "") == "1":
        condicoes.append("c.alta_incidencia")

    return (" and ".join(condicoes) if condicoes else "true"), parametros


SQL_ESTATISTICAS = """
with base as (
  select q.id, q.ano, q.status, q.gabarito,
         c.disciplina_analise, c.banca_canonica, c.topico, c.tipo_formato,
         c.tipo_comando, c.incidencia_tier
    from public.questoes q
    join public.questoes_classificacao c on c.questao_id = q.id
   where {filtros}
)
select
  (select count(*) from base) as total,
  (select count(*) from base where topico is not null) as especificas,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select disciplina_analise as valor, count(*) as n from base
            where disciplina_analise is not null group by 1) x) as por_disciplina,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select ano as valor, count(*) as n from base
            where ano is not null group by 1) x) as por_ano,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select banca_canonica as valor, count(*) as n from base
            where banca_canonica is not null group by 1 limit 30) x) as por_banca,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select topico as valor, count(*) as n from base
            where topico is not null group by 1) x) as por_topico,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select tipo_formato as valor, count(*) as n from base
            where tipo_formato is not null group by 1) x) as por_formato,
  (select coalesce(json_agg(x order by x.n desc, x.valor), '[]'::json)
     from (select tipo_comando as valor, count(*) as n from base
            where tipo_comando is not null group by 1) x) as por_comando,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select incidencia_tier as valor, count(*) as n from base
            where incidencia_tier is not null group by 1) x) as por_tier
"""

SQL_RESUMO = """
with base as materialized (
  select q.id, q.prova_slug, q.orgao, q.ano, q.gabarito,
         c.banca_canonica, c.disciplina_analise, c.topico, c.tipo_formato, c.tipo_comando
    from public.questoes q
    join public.questoes_classificacao c on c.questao_id = q.id
)
select
  count(*) as questoes,
  count(distinct prova_slug) as provas,
  count(distinct banca_canonica) as bancas,
  count(distinct orgao) as orgaos,
  min(ano) as ano_min,
  max(ano) as ano_max,
  count(*) filter (where coalesce(gabarito, '') <> '') as com_gabarito,
  count(*) filter (where topico is not null) as especificas,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select distinct disciplina_analise as valor from base
            where disciplina_analise is not null) x) as disciplinas,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select distinct banca_canonica as valor from base
            where banca_canonica is not null) x) as bancas_lista,
  (select coalesce(json_agg(x order by x.valor desc), '[]'::json)
     from (select distinct ano as valor from base where ano is not null) x) as anos,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select distinct tipo_formato as valor from base where tipo_formato is not null) x) as formatos,
  (select coalesce(json_agg(x order by x.valor), '[]'::json)
     from (select distinct tipo_comando as valor from base where tipo_comando is not null) x) as comandos
  from base
"""

SQL_TOPICOS = """
select id, nome, grupo, n, n_corretas, score, score_norm, tier, por_ano, top_bancas, termos
  from public.topicos
 order by score desc nulls last, nome
"""

SQL_SUBTOPICOS = """
select topico_id, id, nome, n, n_corretas, score, tier, por_ano, top_bancas, termos
  from public.subtopicos
 order by score desc nulls last, nome
"""

SQL_QUESTOES = """
select q.id, q.banca, q.ano, q.orgao, q.disciplina, q.numero, q.status, q.gabarito,
       left(q.enunciado, 320) as enunciado,
       c.banca_canonica, c.uf, c.disciplina_analise, c.topico, c.subtopico, c.subtopico_nome,
       c.tipo_formato, c.tipo_comando, c.incidencia_tier, c.alta_incidencia,
       t.nome as topico_nome,
       count(*) over () as total
  from public.questoes q
  join public.questoes_classificacao c on c.questao_id = q.id
  left join public.topicos t on t.id = c.topico
 where {filtros}
 order by q.ano desc nulls last, q.id
 limit %s offset %s
"""

SQL_QUESTAO = """
select q.id,
       q.prova_slug,
       coalesce(c.banca_canonica, q.banca) as banca,
       q.banca as banca_original,
       q.orgao,
       q.ano,
       q.cargo,
       coalesce(c.disciplina_analise, q.disciplina) as disciplina,
       q.numero,
       q.enunciado,
       q.alternativas,
       q.gabarito,
       q.status,
       c.uf,
       c.topico,
       t.nome as topico_nome,
       c.subtopico,
       c.subtopico_nome,
       c.tipo_formato as formato,
       c.tipo_comando as comando,
       c.incidencia_score::float8 as incidencia_score,
       c.incidencia_tier as tier,
       c.alta_incidencia,
       av.nota,
       an.texto as anotacao
  from public.questoes q
  join public.questoes_classificacao c on c.questao_id = q.id
  left join public.topicos t on t.id = c.topico
  left join public.avaliacoes av on av.questao_id = q.id
  left join public.anotacoes an on an.questao_id = q.id
 where q.id = %s
"""

_cache_dashboard: dict = {}
TTL_DASHBOARD = 300


def com_cache(chave: str, produtor):
    agora = time.time()
    registro = _cache_dashboard.get(chave)
    if registro and agora - registro[0] < TTL_DASHBOARD:
        return registro[1]
    valor = produtor()
    _cache_dashboard[chave] = (agora, valor)
    return valor


def topicos_com_cache() -> dict:
    def produzir() -> dict:
        topicos = executar_sql(SQL_TOPICOS, buscar=True)
        subtopicos = executar_sql(SQL_SUBTOPICOS, buscar=True)
        return {
            "topicos": [
                {
                    "id": linha[0],
                    "nome": linha[1],
                    "grupo": linha[2],
                    "n": linha[3],
                    "n_corretas": linha[4],
                    "score": float(linha[5]) if linha[5] is not None else None,
                    "score_norm": float(linha[6]) if linha[6] is not None else None,
                    "tier": linha[7],
                    "por_ano": linha[8] or {},
                    "top_bancas": linha[9] or [],
                    "termos": linha[10] or [],
                }
                for linha in topicos
            ],
            "subtopicos": [
                {
                    "topico": linha[0],
                    "id": linha[1],
                    "nome": linha[2],
                    "n": linha[3],
                    "n_corretas": linha[4],
                    "score": float(linha[5]) if linha[5] is not None else None,
                    "tier": linha[6],
                    "por_ano": linha[7] or {},
                    "top_bancas": linha[8] or [],
                    "termos": linha[9] or [],
                }
                for linha in subtopicos
            ],
        }

    return com_cache("topicos", produzir)


def resumo_com_cache() -> dict:
    def produzir() -> dict:
        totais = executar_sql(SQL_RESUMO, buscar=True)[0]
        cabecalho = topicos_com_cache()
        return {
            "totais": {
                "questoes": totais[0],
                "provas": totais[1],
                "bancas": totais[2],
                "orgaos": totais[3],
                "periodo": [totais[4], totais[5]],
                "com_gabarito": totais[6],
                "especificas": totais[7],
            },
            "opcoes": {
                "disciplinas": totais[8],
                "bancas": totais[9],
                "anos": totais[10],
                "formatos": totais[11],
                "comandos": totais[12],
                "topicos": [
                    {"id": t["id"], "nome": t["nome"], "grupo": t["grupo"], "tier": t["tier"], "n": t["n"]}
                    for t in cabecalho["topicos"]
                ],
            },
        }

    return com_cache("resumo", produzir)


def resumo_questao(linha) -> dict:
    return {
        "id": linha[0],
        "banca": linha[9] or linha[1],
        "banca_original": linha[1],
        "ano": linha[2],
        "orgao": linha[3],
        "disciplina": linha[11] or linha[4],
        "numero": linha[5],
        "status": linha[6],
        "gabarito": linha[7],
        "enunciado": linha[8],
        "uf": linha[10],
        "topico": linha[12],
        "subtopico": linha[13],
        "subtopico_nome": linha[14],
        "formato": linha[15],
        "comando": linha[16],
        "tier": linha[17],
        "alta_incidencia": bool(linha[18]),
        "topico_nome": linha[19],
    }


@app.get("/dashboard")
def pagina_dashboard() -> str:
    return render_template("dashboard.html", versao=VERSAO_ESTATICOS)


@app.get("/api/dashboard/resumo")
def api_dashboard_resumo() -> Response:
    try:
        return jsonify(resumo_com_cache())
    except Exception as erro:
        log.warning("Falha ao carregar o resumo do dashboard: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503


@app.get("/api/dashboard/topicos")
def api_dashboard_topicos() -> Response:
    try:
        return jsonify(topicos_com_cache())
    except Exception as erro:
        log.warning("Falha ao carregar os tópicos: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503


@app.get("/api/dashboard/estatisticas")
def api_dashboard_estatisticas() -> Response:
    filtros, parametros = montar_filtros(request.args)
    try:
        linha = executar_sql(SQL_ESTATISTICAS.format(filtros=filtros), parametros, buscar=True)[0]
    except Exception as erro:
        log.warning("Falha nas estatísticas do dashboard: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503

    return jsonify(
        {
            "total": linha[0],
            "especificas": linha[1],
            "por_disciplina": linha[2],
            "por_ano": linha[3],
            "por_banca": linha[4],
            "por_topico": linha[5],
            "por_formato": linha[6],
            "por_comando": linha[7],
            "por_tier": linha[8],
        }
    )


@app.get("/api/dashboard/questoes")
def api_dashboard_questoes() -> Response:
    filtros, parametros = montar_filtros(request.args)
    try:
        pagina = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        pagina = 1
    try:
        por_pagina = min(50, max(1, int(request.args.get("per_page", 20))))
    except (TypeError, ValueError):
        por_pagina = 20

    try:
        linhas = executar_sql(
            SQL_QUESTOES.format(filtros=filtros),
            parametros + [por_pagina, (pagina - 1) * por_pagina],
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao listar questões do dashboard: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503

    total = linhas[0][20] if linhas else 0
    return jsonify(
        {
            "total": total,
            "page": pagina,
            "per_page": por_pagina,
            "paginas": (total + por_pagina - 1) // por_pagina if total else 0,
            "itens": [resumo_questao(linha) for linha in linhas],
        }
    )


@app.get("/api/dashboard/questao/<questao_id>")
def api_dashboard_questao(questao_id: str) -> Response:
    try:
        linhas = executar_sql(SQL_QUESTAO, (questao_id,), buscar=True, dicionario=True)
    except Exception as erro:
        log.warning("Falha ao carregar a questão %s: %s", questao_id, erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503

    if not linhas:
        return jsonify({"erro": "questao_desconhecida"}), 404

    questao = dict(linhas[0])
    questao["alta_incidencia"] = bool(questao.get("alta_incidencia"))
    questao["alternativas"] = questao.get("alternativas") or {}
    return jsonify(questao)


@app.get("/api/dashboard/ids")
def api_dashboard_ids() -> Response:
    filtros, parametros = montar_filtros(request.args)
    try:
        linhas = executar_sql(
            f"select q.id from public.questoes q "
            f"join public.questoes_classificacao c on c.questao_id = q.id where {filtros} order by q.ano desc nulls last, q.id",
            parametros,
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao listar ids do dashboard: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503
    return jsonify({"total": len(linhas), "ids": [linha[0] for linha in linhas]})


@app.get("/api/dashboard/export.csv")
def api_dashboard_export() -> Response:
    filtros, parametros = montar_filtros(request.args)
    try:
        linhas = executar_sql(
            "select q.id, c.banca_canonica, q.ano, q.orgao, c.uf, c.disciplina_analise, "
            "c.topico, c.subtopico, c.subtopico_nome, c.tipo_formato, c.tipo_comando, "
            "c.incidencia_tier, c.alta_incidencia, q.status, q.gabarito, q.enunciado, q.alternativas "
            "from public.questoes q "
            "join public.questoes_classificacao c on c.questao_id = q.id "
            f"where {filtros} order by q.ano desc nulls last, q.id",
            parametros,
            buscar=True,
        )
    except Exception as erro:
        log.warning("Falha ao exportar CSV: %s", erro)
        return jsonify({"erro": "dashboard_indisponivel"}), 503

    buffer = io.StringIO()
    escritor = csv.writer(buffer)
    escritor.writerow(
        [
            "id",
            "banca",
            "ano",
            "orgao",
            "uf",
            "disciplina",
            "topico",
            "subtopico",
            "subtopico_nome",
            "tipo_formato",
            "tipo_comando",
            "tier",
            "alta_incidencia",
            "status",
            "gabarito",
            "enunciado",
            "alternativas",
            "alternativa_correta",
        ]
    )
    for linha in linhas:
        alternativas = linha[16] or {}
        escritor.writerow(
            [
                linha[0],
                linha[1] or "",
                linha[2] or "",
                linha[3] or "",
                linha[4] or "",
                linha[5] or "",
                linha[6] or "",
                linha[7] or "",
                linha[8] or "",
                linha[9] or "",
                linha[10] or "",
                linha[11] or "",
                "sim" if linha[12] else "não",
                linha[13] or "",
                linha[14] or "",
                linha[15] or "",
                " | ".join(f"{letra}) {texto}" for letra, texto in sorted(alternativas.items())),
                alternativas.get(linha[14], "") if linha[14] else "",
            ]
        )

    return Response(
        "\ufeff" + buffer.getvalue(),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=questoes_filtradas.csv"},
    )


class ErroAuth(Exception):
    def __init__(self, mensagem: str, status: int = 400, codigo: str = "erro_auth"):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status
        self.codigo = codigo


@app.errorhandler(ErroAuth)
def tratar_erro_auth(erro: ErroAuth) -> Response:
    return jsonify({"erro": erro.codigo, "mensagem": erro.mensagem}), erro.status


MENSAGENS_FIREBASE = {
    "EMAIL_EXISTS": ("Este e-mail já está cadastrado. Tente entrar.", 409, "email_existe"),
    "EMAIL_NOT_FOUND": ("E-mail ou senha inválidos.", 401, "credenciais_invalidas"),
    "INVALID_PASSWORD": ("E-mail ou senha inválidos.", 401, "credenciais_invalidas"),
    "INVALID_LOGIN_CREDENTIALS": ("E-mail ou senha inválidos.", 401, "credenciais_invalidas"),
    "INVALID_EMAIL": ("Informe um e-mail válido.", 400, "email_invalido"),
    "MISSING_EMAIL": ("Informe um e-mail válido.", 400, "email_invalido"),
    "MISSING_PASSWORD": ("Informe a senha.", 400, "senha_obrigatoria"),
    "WEAK_PASSWORD": ("A senha precisa ter pelo menos 6 caracteres.", 400, "senha_fraca"),
    "TOO_MANY_ATTEMPTS_TRY_LATER": ("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429, "muitas_tentativas"),
    "USER_DISABLED": ("Esta conta está desativada.", 403, "conta_desativada"),
    "OPERATION_NOT_ALLOWED": ("O login por e-mail e senha não está habilitado no projeto Firebase.", 503, "auth_indisponivel"),
    "API_KEY_INVALID": ("Configuração de autenticação inválida no servidor.", 503, "auth_indisponivel"),
    "PROJECT_NOT_FOUND": ("Configuração de autenticação inválida no servidor.", 503, "auth_indisponivel"),
    "INVALID_IDP_RESPONSE": ("Não conseguimos validar sua conta Google. Tente entrar de novo.", 401, "google_invalido"),
    "FEDERATED_USER_ID_ALREADY_LINKED": ("Essa conta Google já está vinculada a outro usuário.", 409, "conta_vinculada"),
    "INVALID_PROVIDER_ID": ("Login com Google indisponível neste projeto.", 503, "auth_indisponivel"),
}


def firebase_configurado() -> bool:
    return bool(FIREBASE_API_KEY and FIREBASE_PROJECT_ID)


def chamar_firebase(caminho: str, corpo: dict) -> dict:
    if not firebase_configurado():
        raise ErroAuth("A autenticação não está configurada neste servidor.", 503, "auth_indisponivel")

    url = f"https://identitytoolkit.googleapis.com/v1/{caminho}?key={FIREBASE_API_KEY}"
    pedido = urllib.request.Request(
        url,
        data=json.dumps(corpo).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(pedido, timeout=15) as resposta:
            return json.loads(resposta.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as erro:
        try:
            corpo_erro = json.loads(erro.read().decode("utf-8") or "{}")
        except Exception:
            corpo_erro = {}
        mensagem = str((corpo_erro.get("error") or {}).get("message") or f"HTTP {erro.code}")
        chave = mensagem.split(" ")[0].split(":")[0].strip()
        padrao = MENSAGENS_FIREBASE.get(chave)
        if padrao:
            raise ErroAuth(*padrao)
        log.warning("Erro do Firebase (%s): %s", caminho, mensagem)
        raise ErroAuth("Não foi possível concluir a autenticação. Tente de novo.", 400, "erro_auth")
    except urllib.error.URLError as erro:
        log.warning("Falha de rede com o Firebase: %s", erro)
        raise ErroAuth("O serviço de autenticação está indisponível agora. Tente de novo em instantes.", 503, "auth_indisponivel")


def normalizar_email(valor) -> str:
    return str(valor or "").strip().lower()


def email_valido(email: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}", email))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def buscar_ou_criar_usuario(email: str, nome: str | None, firebase_uid: str | None) -> dict:
    linhas = executar_sql(
        """
        insert into public.usuarios (email, nome, firebase_uid, ultimo_acesso_em)
        values (%s, %s, %s, now())
        on conflict (lower(email)) do update
           set ultimo_acesso_em = now(),
               nome = coalesce(nullif(excluded.nome, ''), public.usuarios.nome),
               firebase_uid = coalesce(excluded.firebase_uid, public.usuarios.firebase_uid)
        returning id, email, nome
        """,
        (email, nome, firebase_uid),
        buscar=True,
        dicionario=True,
    )
    return dict(linhas[0])


def gerar_token_acesso(usuario: dict) -> str:
    agora = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(usuario["id"]),
            "email": usuario.get("email") or "",
            "nome": usuario.get("nome") or "",
            "tipo": "acesso",
            "iss": JWT_EMISSOR,
            "iat": int(agora.timestamp()),
            "exp": int((agora + JWT_TTL_ACESSO).timestamp()),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def usuario_do_token(token: str) -> dict | None:
    try:
        dados = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            issuer=JWT_EMISSOR,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        return None
    if dados.get("tipo") != "acesso":
        return None
    try:
        identificador = int(dados["sub"])
    except (TypeError, ValueError):
        return None
    return {"id": identificador, "email": dados.get("email") or "", "nome": dados.get("nome") or ""}


def usuario_atual(obrigatorio: bool = False) -> dict | None:
    cabecalho = request.headers.get("Authorization", "")
    if cabecalho.lower().startswith("bearer "):
        usuario = usuario_do_token(cabecalho[7:].strip())
        if usuario:
            return usuario
    if obrigatorio:
        raise ErroAuth("Faça login para continuar.", 401, "nao_autenticado")
    return None


def definir_cookie_refresh(resposta: Response, token: str) -> None:
    resposta.set_cookie(
        NOME_COOKIE_REFRESH,
        token,
        max_age=int(TTL_REFRESH.total_seconds()),
        httponly=True,
        secure=request.is_secure,
        samesite="Lax",
        path="/api/auth",
    )


def limpar_cookie_refresh(resposta: Response) -> None:
    resposta.delete_cookie(NOME_COOKIE_REFRESH, path="/api/auth")


def criar_sessao(usuario_id: int) -> str:
    token = secrets.token_urlsafe(32)
    executar_sql(
        "insert into public.sessoes (usuario_id, token_hash, expira_em, user_agent) values (%s, %s, %s, %s)",
        (
            usuario_id,
            hash_token(token),
            datetime.now(timezone.utc) + TTL_REFRESH,
            (request.user_agent.string or "")[:300],
        ),
    )
    return token


def responder_sessao(usuario: dict, mensagem: str = "") -> Response:
    token_refresh = criar_sessao(usuario["id"])
    resposta = jsonify(
        {
            "usuario": {"id": usuario["id"], "email": usuario.get("email") or "", "nome": usuario.get("nome") or ""},
            "token": gerar_token_acesso(usuario),
            "expira_em": int(JWT_TTL_ACESSO.total_seconds()),
            "mensagem": mensagem,
        }
    )
    definir_cookie_refresh(resposta, token_refresh)
    return resposta


@app.post("/api/auth/registrar")
def api_auth_registrar() -> Response:
    corpo = request.get_json(silent=True) or {}
    email = normalizar_email(corpo.get("email"))
    senha = str(corpo.get("senha") or "")
    nome = str(corpo.get("nome") or "").strip()[:TAMANHO_MAX_NOME]

    if not email_valido(email):
        raise ErroAuth("Informe um e-mail válido.", 400, "email_invalido")
    if len(senha) < 6:
        raise ErroAuth("A senha precisa ter pelo menos 6 caracteres.", 400, "senha_fraca")

    dados = chamar_firebase("accounts:signUp", {"email": email, "password": senha, "returnSecureToken": True})
    usuario = buscar_ou_criar_usuario(email, nome or None, dados.get("localId"))
    return responder_sessao(usuario, "Conta criada com sucesso!")


@app.post("/api/auth/login")
def api_auth_login() -> Response:
    corpo = request.get_json(silent=True) or {}
    email = normalizar_email(corpo.get("email"))
    senha = str(corpo.get("senha") or "")
    if not email or not senha:
        raise ErroAuth("Informe e-mail e senha.", 400, "dados_incompletos")

    dados = chamar_firebase("accounts:signInWithPassword", {"email": email, "password": senha, "returnSecureToken": True})
    usuario = buscar_ou_criar_usuario(normalizar_email(dados.get("email") or email), None, dados.get("localId"))
    return responder_sessao(usuario, "Bem-vindo de volta!")


@app.post("/api/auth/refresh")
def api_auth_refresh() -> Response:
    token = request.cookies.get(NOME_COOKIE_REFRESH, "")
    if not token:
        raise ErroAuth("Sessão não encontrada.", 401, "sem_sessao")

    linhas = executar_sql(
        """
        select s.id, s.usuario_id, u.email, u.nome
          from public.sessoes s
          join public.usuarios u on u.id = s.usuario_id
         where s.token_hash = %s and s.revogado_em is null and s.expira_em > now()
        """,
        (hash_token(token),),
        buscar=True,
        dicionario=True,
    )
    if not linhas:
        resposta = jsonify({"erro": "sessao_invalida", "mensagem": "Sua sessão expirou. Entre novamente."})
        limpar_cookie_refresh(resposta)
        resposta.status_code = 401
        return resposta

    sessao = dict(linhas[0])
    executar_sql("update public.sessoes set revogado_em = now() where id = %s", (sessao["id"],))
    usuario = {"id": sessao["usuario_id"], "email": sessao["email"], "nome": sessao["nome"]}
    return responder_sessao(usuario)


@app.post("/api/auth/logout")
def api_auth_logout() -> Response:
    token = request.cookies.get(NOME_COOKIE_REFRESH, "")
    if token:
        executar_sql(
            "update public.sessoes set revogado_em = now() where token_hash = %s and revogado_em is null",
            (hash_token(token),),
        )
    resposta = jsonify({"ok": True})
    limpar_cookie_refresh(resposta)
    return resposta


@app.get("/api/auth/eu")
def api_auth_eu() -> Response:
    usuario = usuario_atual(obrigatorio=True)
    return jsonify({"usuario": usuario})


@app.post("/api/auth/senha")
def api_auth_senha() -> Response:
    corpo = request.get_json(silent=True) or {}
    email = normalizar_email(corpo.get("email"))
    if not email_valido(email):
        raise ErroAuth("Informe um e-mail válido.", 400, "email_invalido")
    try:
        chamar_firebase(
            "accounts:sendOobCode",
            {
                "requestType": "PASSWORD_RESET",
                "email": email,
                "continueUrl": url_for("pagina_entrar", _external=True),
            },
        )
    except ErroAuth as erro:
        if erro.codigo != "credenciais_invalidas":
            raise
    return jsonify({"ok": True, "mensagem": "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha."})


@app.post("/api/auth/google")
def api_auth_google() -> Response:
    corpo = request.get_json(silent=True) or {}
    token_google = str(corpo.get("id_token") or "").strip()
    if not token_google:
        raise ErroAuth("Não recebemos o token do Google. Tente de novo.", 400, "token_ausente")

    dados = chamar_firebase(
        "accounts:signInWithIdp",
        {
            "postBody": f"id_token={token_google}&providerId=google.com",
            "requestUri": url_for("pagina_entrar", _external=True),
            "returnSecureToken": True,
        },
    )
    email = normalizar_email(dados.get("email"))
    if not email_valido(email):
        raise ErroAuth("Não conseguimos ler o e-mail da sua conta Google.", 400, "email_ausente")
    nome = str(dados.get("displayName") or "").strip()[:TAMANHO_MAX_NOME]
    usuario = buscar_ou_criar_usuario(email, nome or None, dados.get("localId"))
    return responder_sessao(usuario, "Bem-vindo(a)!")


@app.get("/entrar")
def pagina_entrar() -> str:
    return render_template(
        "entrar.html",
        versao=VERSAO_ESTATICOS,
        auth_disponivel=firebase_configurado(),
        firebase_config=(
            {
                "apiKey": FIREBASE_API_KEY,
                "authDomain": f"{FIREBASE_PROJECT_ID}.firebaseapp.com",
                "projectId": FIREBASE_PROJECT_ID,
                "appId": FIREBASE_APP_ID,
            }
            if firebase_configurado()
            else None
        ),
    )


@app.get("/minhas-estatisticas")
def pagina_minhas_estatisticas() -> str:
    return render_template("minhas_estatisticas.html", versao=VERSAO_ESTATICOS)


@app.get("/healthz")
def healthz() -> Response:
    return Response("ok", mimetype="text/plain")
def comprimir_resposta(resposta: Response) -> Response:
    if (
        resposta.status_code < 300
        and not resposta.direct_passthrough
        and "gzip" in request.accept_encodings
        and "Content-Encoding" not in resposta.headers
        and resposta.mimetype in TIPOS_COMPRIMIVEIS
    ):
        conteudo = resposta.get_data()
        if len(conteudo) >= TAMANHO_MINIMO_GZIP:
            comprimido = gzip.compress(conteudo, compresslevel=6)
            resposta.set_data(comprimido)
            resposta.headers["Content-Encoding"] = "gzip"
            resposta.headers.add("Vary", "Accept-Encoding")
    return resposta


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
