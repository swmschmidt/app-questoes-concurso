"""Leitura do questoes.json e artefatos pré-gerados do banco de questões.

O JSON bruto (16 MB) não é carregado em tempo de execução no container: o script
scripts/gerar_payload.py cria, no build da imagem, dois arquivos comprimidos:

  dados/questoes.payload.json.gz  -> payload enxuto servido em /api/questoes
  dados/questoes.ids.txt.gz       -> ids válidos usados para validar avaliações
  dados/questoes.meta.json        -> total, versão do payload e hash do JSON

Assim o app sobe rápido e com pouca memória. Se os artefatos não existirem ou
estiverem desatualizados, eles são gerados na hora a partir do JSON — exceto se
PERMITIR_GERAR_PAYLOAD=0, quando o app falha com uma mensagem clara em vez de
gastar memória à toa (é o caso do container, onde o build já gerou tudo).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path

NOME_PAYLOAD = "questoes.payload.json.gz"
NOME_IDS = "questoes.ids.txt.gz"
NOME_META = "questoes.meta.json"
TAMANHO_BLOCO = 1024 * 1024


def hash_arquivo(caminho: Path) -> str:
    digest = hashlib.sha256()
    with caminho.open("rb") as arquivo:
        for bloco in iter(lambda: arquivo.read(TAMANHO_BLOCO), b""):
            digest.update(bloco)
    return digest.hexdigest()


def carregar_questoes(caminho: Path) -> list[dict]:
    with caminho.open(encoding="utf-8") as arquivo:
        bruto = json.load(arquivo)

    questoes: list[dict] = []
    descartadas = 0
    for item in bruto:
        alternativas = {
            letra: str(texto).strip()
            for letra, texto in (item.get("alternativas") or {}).items()
            if str(texto).strip()
        }
        gabarito = str(item.get("gabarito") or "").strip().upper()
        enunciado = str(item.get("enunciado") or "").strip()
        if item.get("status") != "correta" or gabarito not in alternativas or not enunciado:
            descartadas += 1
            continue
        questoes.append(
            {
                "id": item["id"],
                "prova_slug": item.get("prova_slug", ""),
                "banca": item.get("banca") or "Banca não informada",
                "orgao": item.get("orgao") or "Órgão não informado",
                "ano": item.get("ano"),
                "cargo": item.get("cargo", ""),
                "disciplina": item.get("disciplina") or "Sem disciplina",
                "numero": item.get("numero"),
                "enunciado": enunciado,
                "alternativas": alternativas,
                "gabarito": gabarito,
            }
        )

    if descartadas:
        print(f"{descartadas} registro(s) ignorado(s) (anulada, sem gabarito ou sem enunciado).")
    return questoes


def gerar_artefatos(origem: Path, destino: Path) -> dict:
    destino.mkdir(parents=True, exist_ok=True)
    questoes = carregar_questoes(origem)
    payload = json.dumps(questoes, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    meta = {
        "total": len(questoes),
        "versao": hashlib.sha256(payload).hexdigest()[:12],
        "bytes": len(payload),
        "origem": origem.name,
        "sha256_origem": hash_arquivo(origem),
    }

    (destino / NOME_PAYLOAD).write_bytes(gzip.compress(payload, compresslevel=6))
    ids = "\n".join(questao["id"] for questao in questoes).encode("utf-8")
    (destino / NOME_IDS).write_bytes(gzip.compress(ids, compresslevel=6))
    (destino / NOME_META).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta


def artefatos_atualizados(origem: Path, destino: Path) -> bool:
    try:
        meta = json.loads((destino / NOME_META).read_text(encoding="utf-8"))
    except Exception:
        return False
    if not (destino / NOME_PAYLOAD).exists() or not (destino / NOME_IDS).exists():
        return False
    esperado = meta.get("sha256_origem")
    if not esperado:
        return False
    try:
        return esperado == hash_arquivo(origem)
    except OSError:
        return False


def carregar_artefatos(destino: Path) -> tuple[bytes, bytes, frozenset, dict]:
    payload_gzip = (destino / NOME_PAYLOAD).read_bytes()
    payload = gzip.decompress(payload_gzip)
    ids_texto = gzip.decompress((destino / NOME_IDS).read_bytes()).decode("utf-8")
    meta = json.loads((destino / NOME_META).read_text(encoding="utf-8"))
    ids = frozenset(linha for linha in ids_texto.split("\n") if linha)
    return payload, payload_gzip, ids, meta


def permitido_gerar() -> bool:
    return os.environ.get("PERMITIR_GERAR_PAYLOAD", "1").strip().lower() not in {"0", "false", "nao", "não"}


def carregar_ou_gerar(origem: Path, destino: Path) -> tuple[bytes, bytes, frozenset, dict]:
    if not artefatos_atualizados(origem, destino):
        if not permitido_gerar():
            raise RuntimeError(
                f"artefatos de {destino} ausentes ou desatualizados e PERMITIR_GERAR_PAYLOAD=0; "
                "rode 'python scripts/gerar_payload.py' no build da imagem"
            )
        meta = gerar_artefatos(origem, destino)
        print(f"artefatos gerados: {meta['total']} questões, versão {meta['versao']}")
    return carregar_artefatos(destino)
