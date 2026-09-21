"""Gera os artefatos do banco de questões usados em tempo de execução.

Uso:
    python scripts/gerar_payload.py [--origem questoes.json] [--destino dados]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from questoes_bank import gerar_artefatos  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera payload e ids do banco de questões")
    parser.add_argument("--origem", default=str(RAIZ / "questoes.json"))
    parser.add_argument("--destino", default=str(RAIZ / "dados"))
    argumentos = parser.parse_args()

    origem = Path(argumentos.origem)
    if not origem.exists():
        print(f"arquivo não encontrado: {origem}", file=sys.stderr)
        return 2

    meta = gerar_artefatos(origem, Path(argumentos.destino))
    print(f"{meta['total']} questões | {meta['bytes'] / 1e6:.2f} MB | versão {meta['versao']}")
    print(f"artefatos em {argumentos.destino}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
