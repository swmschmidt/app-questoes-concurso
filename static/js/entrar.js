(() => {
  "use strict";

  const el = {};
  [
    "abas-conta", "conta-descricao", "conta-erro", "conta-sucesso", "formulario-conta", "linha-nome",
    "campo-nome", "campo-email", "campo-senha", "btn-enviar", "btn-esqueci", "conta-nota", "toast"
  ].forEach((id) => {
    el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())] = document.getElementById(id);
  });

  let modo = new URLSearchParams(window.location.search).get("modo") === "criar" ? "criar" : "entrar";
  let temporizadorToast = 0;

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
      el.contaSucesso.textContent = modo === "criar" ? "Conta criada! Redirecionando..." : "Tudo certo! Redirecionando...";
      el.contaSucesso.hidden = false;
      window.setTimeout(() => {
        window.location.href = destino();
      }, 500);
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

  el.abasConta.querySelectorAll(".aba").forEach((botao) => {
    botao.addEventListener("click", () => aplicarModo(botao.dataset.modo));
  });
  el.formularioConta.addEventListener("submit", enviar);
  el.btnEsqueci.addEventListener("click", esqueciSenha);

  aplicarModo(modo);

  window.AQAuth.iniciar().then((autenticado) => {
    if (autenticado) {
      el.contaSucesso.textContent = "Você já está conectado. Redirecionando...";
      el.contaSucesso.hidden = false;
      window.setTimeout(() => {
        window.location.href = destino();
      }, 600);
    }
  });
})();
