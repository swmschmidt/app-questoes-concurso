/* Sessão do usuário: JWT de acesso em memória + refresh token em cookie httpOnly. */
(() => {
  "use strict";

  let usuario = null;
  let token = null;
  let renovacaoEmAndamento = null;

  async function renovar() {
    if (renovacaoEmAndamento) return renovacaoEmAndamento;
    renovacaoEmAndamento = (async () => {
      try {
        const resposta = await fetch("/api/auth/refresh", {
          method: "POST",
          headers: { Accept: "application/json" }
        });
        if (!resposta.ok) {
          usuario = null;
          token = null;
          return false;
        }
        const dados = await resposta.json();
        usuario = dados.usuario || null;
        token = dados.token || null;
        return Boolean(usuario && token);
      } catch (erro) {
        usuario = null;
        token = null;
        return false;
      } finally {
        renovacaoEmAndamento = null;
      }
    })();
    return renovacaoEmAndamento;
  }

  function definirSessao(dados) {
    usuario = dados.usuario || null;
    token = dados.token || null;
    return usuario;
  }

  async function pedir(url, opcoes = {}) {
    const cabecalhos = Object.assign({}, opcoes.headers || {});
    if (token) cabecalhos.Authorization = `Bearer ${token}`;
    const configuracao = Object.assign({}, opcoes, { headers: cabecalhos });
    if (opcoes.corpo !== undefined) {
      cabecalhos["Content-Type"] = "application/json";
      configuracao.body = JSON.stringify(opcoes.corpo);
    }
    delete configuracao.corpo;

    const resposta = await fetch(url, configuracao);
    if (resposta.status === 401 && opcoes.renovar !== false) {
      const conseguiu = await renovar();
      if (conseguiu) {
        const novasOpcoes = Object.assign({}, opcoes, { renovar: false });
        return pedir(url, novasOpcoes);
      }
    }
    return resposta;
  }

  async function pedirJson(url, opcoes = {}) {
    const resposta = await pedir(url, opcoes);
    let dados = null;
    try {
      dados = await resposta.json();
    } catch (erro) {
      dados = null;
    }
    if (!resposta.ok) {
      const mensagem = (dados && (dados.mensagem || dados.erro)) || `Falha na requisição (HTTP ${resposta.status}).`;
      const erro = new Error(mensagem);
      erro.status = resposta.status;
      erro.dados = dados;
      throw erro;
    }
    return dados;
  }

  async function entrar(email, senha) {
    const dados = await pedirJson("/api/auth/login", { method: "POST", corpo: { email, senha }, renovar: false });
    return definirSessao(dados);
  }

  async function criarConta(nome, email, senha) {
    const dados = await pedirJson("/api/auth/registrar", { method: "POST", corpo: { nome, email, senha }, renovar: false });
    return definirSessao(dados);
  }

  async function sair() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (erro) {
      /* segue limpando o estado local */
    }
    usuario = null;
    token = null;
  }

  window.AQAuth = {
    iniciar: renovar,
    renovar,
    pedir,
    pedirJson,
    entrar,
    criarConta,
    sair,
    definirSessao,
    usuario: () => usuario,
    token: () => token,
    autenticado: () => Boolean(usuario && token)
  };
})();
