"""Configuração do projeto Firebase usada pelo app (script de administração).

O app usa o Firebase Authentication (e-mail/senha) para validar as credenciais:
o backend chama a API REST do Identity Toolkit com a chave pública do app web
(FIREBASE_API_KEY) e cria a sessão própria com JWT + refresh token.

Este script usa a conta de serviço (arquivo *firebase-adminsdk*.json, que NUNCA
deve ser versionado) para tarefas administrativas:

  --mostrar-config   imprime a configuração pública do app web (apiKey etc.)
  --dominios         lista os domínios autorizados do Firebase Auth
  --adicionar-dominio app-questoes-concurso.fly.dev
                     libera um domínio para uso do Firebase Auth
  --listar-usuarios  lista os usuários do Firebase (via Identity Toolkit Admin API)
  --remover-usuario  uid ou e-mail

Uso:
    python scripts/configurar_firebase.py --mostrar-config
    python scripts/configurar_firebase.py --adicionar-dominio app-questoes-concurso.fly.dev
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import jwt

RAIZ = Path(__file__).resolve().parent.parent
CONTA_PADRAO = next(iter(RAIZ.glob("*firebase-adminsdk*.json")), None)
ESCOPO = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase"


def requisicao(url: str, metodo: str = "GET", corpo=None, token: str | None = None, tipo: str = "application/json"):
    cabecalhos = {"Content-Type": tipo}
    if token:
        cabecalhos["Authorization"] = f"Bearer {token}"
    if corpo is None:
        dados = None
    elif tipo == "application/x-www-form-urlencoded":
        dados = urllib.parse.urlencode(corpo).encode()
    else:
        dados = json.dumps(corpo).encode()
    pedido = urllib.request.Request(url, data=dados, headers=cabecalhos, method=metodo)
    try:
        with urllib.request.urlopen(pedido, timeout=30) as resposta:
            return resposta.status, json.loads(resposta.read().decode() or "{}")
    except urllib.error.HTTPError as erro:
        try:
            return erro.code, json.loads(erro.read().decode() or "{}")
        except Exception:
            return erro.code, {}


def carregar_conta(caminho: Path | None) -> dict:
    if caminho is None or not caminho.exists():
        raise SystemExit(
            "Conta de serviço não encontrada. Baixe o JSON em "
            "Firebase Console > Configurações do projeto > Contas de serviço."
        )
    return json.loads(caminho.read_text(encoding="utf-8"))


def token_de_acesso(conta: dict) -> str:
    agora = int(time.time())
    assercao = jwt.encode(
        {
            "iss": conta["client_email"],
            "scope": ESCOPO,
            "aud": conta["token_uri"],
            "iat": agora,
            "exp": agora + 3600,
        },
        conta["private_key"],
        algorithm="RS256",
    )
    status, resposta = requisicao(
        conta["token_uri"],
        metodo="POST",
        corpo={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assercao},
        tipo="application/x-www-form-urlencoded",
    )
    if status != 200 or "access_token" not in resposta:
        raise SystemExit(f"Falha ao obter token de acesso: {status} {resposta}")
    return resposta["access_token"]


def config_web(projeto: str, token: str) -> dict:
    status, apps = requisicao(f"https://firebase.googleapis.com/v1beta1/projects/{projeto}/webApps", token=token)
    if status != 200 or not apps.get("apps"):
        raise SystemExit(f"Nenhum app web encontrado no projeto {projeto}: {status} {apps}")
    app_id = apps["apps"][0]["appId"]
    status, config = requisicao(
        f"https://firebase.googleapis.com/v1beta1/projects/{projeto}/webApps/{app_id}/config", token=token
    )
    if status != 200:
        raise SystemExit(f"Falha ao ler a configuração do app web: {status} {config}")
    return config


def dominios_autorizados(projeto: str, token: str) -> list[str]:
    status, dados = requisicao(
        f"https://identitytoolkit.googleapis.com/admin/v2/projects/{projeto}/config", token=token
    )
    if status != 200:
        return []
    return dados.get("authorizedDomains") or []


def definir_dominios(projeto: str, token: str, dominios: list[str]):
    return requisicao(
        f"https://identitytoolkit.googleapis.com/admin/v2/projects/{projeto}/config?updateMask=authorizedDomains",
        metodo="PATCH",
        corpo={"authorizedDomains": dominios},
        token=token,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Administração do Firebase do app de questões")
    parser.add_argument("--conta", default=str(CONTA_PADRAO) if CONTA_PADRAO else None)
    parser.add_argument("--mostrar-config", action="store_true")
    parser.add_argument("--dominios", action="store_true")
    parser.add_argument("--adicionar-dominio")
    argumentos = parser.parse_args()

    conta = carregar_conta(Path(argumentos.conta) if argumentos.conta else None)
    projeto = conta["project_id"]
    token = token_de_acesso(conta)
    print(f"projeto: {projeto} | conta de serviço: {conta['client_email']}")

    if argumentos.mostrar_config:
        config = config_web(projeto, token)
        publico = {chave: config[chave] for chave in ("apiKey", "authDomain", "projectId", "appId") if config.get(chave)}
        print(json.dumps(publico, indent=2, ensure_ascii=False))
        print("\nUse no Fly.io:")
        print(f"  fly secrets set FIREBASE_API_KEY={publico.get('apiKey')} FIREBASE_PROJECT_ID={projeto}")

    if argumentos.dominios or argumentos.adicionar_dominio:
        atuais = dominios_autorizados(projeto, token)
        print("domínios autorizados:", atuais)
        if argumentos.adicionar_dominio and argumentos.adicionar_dominio not in atuais:
            status, resposta = definir_dominios(projeto, token, atuais + [argumentos.adicionar_dominio])
            print("adicionar domínio:", status, json.dumps(resposta, ensure_ascii=False)[:200])
            print("domínios agora:", dominios_autorizados(projeto, token))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
