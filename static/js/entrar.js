(() => {
  "use strict";

  const SDK = "https://www.gstatic.com/firebasejs/10.12.5";
  const CHAVE_REDIRECIONAMENTO = "aq-asb:google-redirecionando";
  const MENSAGENS_GOOGLE = {
    "auth/popup-closed-by-user": "Login cancelado.",
    "auth/cancelled-popup-request": "Login cancelado.",
    "auth/popup-blocked": "O navegador bloqueou a janela do Google. Vamos tentar por redirecionamento...",
    "auth/network-request-failed": "Falha de rede ao falar com o Google. Tente de novo.",
    "auth/unauthorized-domain": "Este domínio não está autorizado no Firebase Authentication.",
    "auth/operation-not-allowed": "O login com Google não está habilitado no projeto Firebase.",
    "auth/account-exists-with-different-credential": "Já existe uma conta com este e-mail usando outro método de login."
  };

  const el = {};
  [
    "abas-conta", "conta-descricao", "conta-erro", "conta-sucesso", "formulario-conta", "linha-nome",
    "campo-nome", "campo-email", "campo-senha", "btn-enviar", "btn-esqueci", "conta-nota", "toast",
    "btn-google", "btn-google-texto", "formulario-divisor"
  ].forEach((id) => {
    el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())] = document.getElementById(id);
  });

  const configFirebase = (() => {
    try {
      const bruto = document.getElementById("config-firebase").textContent.trim();
      const dados = bruto ? JSON.parse(bruto) : null;
      return dados && dados.apiKey ? dados : null;
    } catch (erro) {
      return null;
    }
  })();

  let modo = new URLSearchParams(window.location.search).get("modo") === "criar" ? "criar" : "entrar";
  let temporizadorToast = 0;
  let appFirebase = null;

  function avisar(mensagem) {
    el.toast.textContent = mensagem;
    el.toast.hidden = false;
    window.clearTimeout(temporizadorToast);
    temporizadorToast = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 3600);
  }

  function aplicarModo(novoModo) {
    modo = novoModo;
    el.abasConta.querySelectorAll(".aba").forEach((botao) => {
      botao.classList.toggle("ativa", botao.dataset.modo === modo);
    });
    const criando = modo === "criar";
    el.linhaNome.hidden = !criando;
    el.btnEnviar.textContent = criando ? "Criar conta" : "Entrar";
    el.campoSenha.autocomplete = criando ? "new-password" : "current-password";
    el.contaDescricao.textContent = criando
      ? "Crie sua conta para começar a registrar suas respostas, acertos por tema e anotações."
      : "Entre para acompanhar suas questões respondidas, seus acertos por tema e suas anotações em qualquer aparelho.";
    el.contaNota.textContent = criando
      ? "A senha é guardada com segurança pelo Firebase Authentication; o app nunca vê nem armazena sua senha. As notas de dificuldade das questões continuam públicas e sem vínculo com a sua conta."
      : "Sua sessão usa um token de acesso de curta duração e um refresh token guardado em cookie seguro.";
    esconderAvisos();
  }

  function esconderAvisos() {
    el.contaErro.hidden = true;
    el.contaSucesso.hidden = true;
  }

  function mostrarErro(mensagem) {
    el.contaErro.textContent = mensagem;
    el.contaErro.hidden = false;
    el.contaSucesso.hidden = true;
  }

  function destino() {
    const voltar = new URLSearchParams(window.location.search).get("voltar");
    return voltar && voltar.startsWith("/") ? voltar : "/";
  }

  function irParaDestino(mensagem) {
    el.contaSucesso.textContent = mensagem;
    el.contaSucesso.hidden = false;
    window.setTimeout(() => {
      window.location.href = destino();
    }, 500);
  }

  async function enviar(evento) {
    evento.preventDefault();
    esconderAvisos();

    const nome = el.campoNome.value.trim();
    const email = el.campoEmail.value.trim();
    const senha = el.campoSenha.value;

    if (!email || !senha) {
      mostrarErro("Informe e-mail e senha.");
      return;
    }
    if (senha.length < 6) {
      mostrarErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    el.btnEnviar.disabled = true;
    el.btnEnviar.textContent = modo === "criar" ? "Criando conta..." : "Entrando...";
    try {
      if (modo === "criar") {
        await window.AQAuth.criarConta(nome, email, senha);
      } else {
        await window.AQAuth.entrar(email, senha);
      }
      irParaDestino(modo === "criar" ? "Conta criada! Redirecionando..." : "Tudo certo! Redirecionando...");
    } catch (erro) {
      mostrarErro(erro.message || "Não foi possível concluir. Tente de novo.");
      el.btnEnviar.disabled = false;
      aplicarModo(modo);
    }
  }

  async function esqueciSenha() {
    const email = el.campoEmail.value.trim();
    if (!email) {
      mostrarErro("Digite seu e-mail para receber o link de redefinição.");
      return;
    }
    esconderAvisos();
    try {
      const dados = await window.AQAuth.pedirJson("/api/auth/senha", { method: "POST", corpo: { email }, renovar: false });
      avisar(dados.mensagem || "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.");
    } catch (erro) {
      mostrarErro(erro.message || "Não foi possível enviar o e-mail agora.");
    }
  }

  async function carregarSdk() {
    if (!configFirebase) throw new Error("Login com Google indisponível: falta configuração do Firebase.");
    if (!appFirebase) {
      const { initializeApp } = await import(`${SDK}/firebase-app.js`);
      appFirebase = initializeApp(configFirebase);
    }
    const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import(`${SDK}/firebase-auth.js`);
    return { auth: getAuth(appFirebase), GoogleAuthProvider, signInWithPopup, signInWithRedirect };
  }

  async function concluirComGoogle(idToken) {
    const dados = await window.AQAuth.pedirJson("/api/auth/google", {
      method: "POST",
      corpo: { id_token: idToken },
      renovar: false
    });
    window.AQAuth.definirSessao(dados);
    irParaDestino("Tudo certo! Redirecionando...");
  }

  async function entrarComGoogle() {
    esconderAvisos();
    el.btnGoogle.disabled = true;
    el.btnGoogleTexto.textContent = "Falando com o Google...";
    try {
      const { auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await carregarSdk();
      const provedor = new GoogleAuthProvider();
      provedor.setCustomParameters({ prompt: "select_account" });

      let resultado;
      try {
        resultado = await signInWithPopup(auth, provedor);
      } catch (erro) {
        const podeRedirecionar =
          erro && ["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(erro.code);
        if (podeRedirecionar) {
          try {
            window.sessionStorage.setItem(CHAVE_REDIRECIONAMENTO, "1");
          } catch (erroSessao) {
            /* modo privado */
          }
          await signInWithRedirect(auth, provedor);
          return;
        }
        throw erro;
      }

      const credencial = GoogleAuthProvider.credentialFromResult(resultado);
      const idToken = credencial && credencial.idToken;
      if (!idToken) throw new Error("Não recebemos o token do Google. Tente de novo.");
      await concluirComGoogle(idToken);
    } catch (erro) {
      const mensagem = MENSAGENS_GOOGLE[erro && erro.code] || erro.message || "Não foi possível entrar com o Google.";
      mostrarErro(mensagem);
    } finally {
      el.btnGoogle.disabled = false;
      el.btnGoogleTexto.textContent = "Continuar com Google";
    }
  }

  async function tratarRetornoDoGoogle() {
    let redirecionando = false;
    try {
      redirecionando = window.sessionStorage.getItem(CHAVE_REDIRECIONAMENTO) === "1";
    } catch (erro) {
      redirecionando = false;
    }
    if (!redirecionando || !configFirebase) return;

    el.btnGoogle.disabled = true;
    el.btnGoogleTexto.textContent = "Concluindo o login...";
    try {
      const { auth, GoogleAuthProvider } = await carregarSdk();
      const { getRedirectResult } = await import(`${SDK}/firebase-auth.js`);
      const resultado = await getRedirectResult(auth);
      try {
        window.sessionStorage.removeItem(CHAVE_REDIRECIONAMENTO);
      } catch (erro) {
        /* modo privado */
      }
      if (!resultado) return;
      const credencial = GoogleAuthProvider.credentialFromResult(resultado);
      const idToken = credencial && credencial.idToken;
      if (!idToken) throw new Error("Não recebemos o token do Google. Tente de novo.");
      await concluirComGoogle(idToken);
    } catch (erro) {
      mostrarErro(MENSAGENS_GOOGLE[erro && erro.code] || erro.message || "Não foi possível entrar com o Google.");
      el.btnGoogle.disabled = false;
      el.btnGoogleTexto.textContent = "Continuar com Google";
    }
  }

  el.abasConta.querySelectorAll(".aba").forEach((botao) => {
    botao.addEventListener("click", () => aplicarModo(botao.dataset.modo));
  });
  el.formularioConta.addEventListener("submit", enviar);
  el.btnEsqueci.addEventListener("click", esqueciSenha);

  aplicarModo(modo);

  if (configFirebase) {
    el.btnGoogle.hidden = false;
    el.formularioDivisor.hidden = false;
    el.btnGoogle.addEventListener("click", entrarComGoogle);
    tratarRetornoDoGoogle();
  }

  window.AQAuth.iniciar().then((autenticado) => {
    if (autenticado) irParaDestino("Você já está conectado. Redirecionando...");
  });
})();
