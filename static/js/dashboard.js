(() => {
  "use strict";

  const CHAVE_TEMA = "aq-asb:tema:v1";
  const NOMES_FORMATO = {
    simples: "Simples",
    afirmativas: "Afirmativas",
    vf: "Verdadeiro/Falso",
    lacunas: "Lacunas",
    colunas: "Colunas",
    caso_clinico: "Caso clínico",
    texto_base: "Texto-base"
  };
  const NOMES_COMANDO = {
    correta: "Assinale a correta",
    incorreta: "Assinale a incorreta",
    definicao: "Definição",
    conduta: "Conduta",
    calculo: "Cálculo",
    outro: "Outro"
  };
  const POR_PAGINA_TOPICO = 20;
  const NOMES_NIVEL = { 1: "Muito fácil", 2: "Fácil", 3: "Média", 4: "Difícil", 5: "Muito difícil" };
  const NOTAS = [1, 2, 3, 4, 5];
  const LETRAS = ["A", "B", "C", "D", "E"];

  const el = {};
  [
    "abas", "kpis", "gr-disciplina", "gr-ano", "gr-banca", "gr-formato", "gr-comando", "gr-tier", "gr-score",
    "inc-total", "lista-incidencia", "sel-topico", "sel-topico-banca", "sel-topico-ano", "kpis-topico",
    "termos-topico", "lista-subtopicos", "gr-top-ano", "gr-top-banca", "gr-top-subtopico", "gr-top-formato",
    "gr-top-comando", "cartao-questoes-topico", "titulo-questoes-topico", "nota-questoes-topico",
    "lista-questoes-topico", "btn-mais-questoes", "f-busca", "f-disciplina", "f-banca", "f-ano", "f-topico",
    "f-subtopico", "f-formato", "f-comando", "f-status", "f-alta", "btn-exportar", "btn-copiar-ids",
    "btn-limpar", "q-total", "lista-questoes", "pg-anterior", "pg-info", "pg-proxima", "overlay",
    "overlay-fundo", "overlay-corpo", "overlay-titulo", "btn-fechar-overlay", "btn-tema", "toast"
  ].forEach((id) => {
    el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())] = document.getElementById(id);
  });

  let resumo = null;
  let topicos = [];
  let subtopicos = [];
  let subtopicoAtivo = null;
  let questoesTopico = [];
  let totalQuestoesTopico = 0;
  let paginaQuestoes = 1;
  let temporizadorToast = 0;
  let overlayQuestao = null;
  let overlayRespondida = false;
  let overlayNota = null;
  let overlayAnotacao = "";
  let overlayFormAnotacao = false;
  let overlayArrastando = false;
  let overlayPrevia = 0;
  let overlaySuprimirClique = false;

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function avisar(mensagem) {
    el.toast.textContent = mensagem;
    el.toast.hidden = false;
    window.clearTimeout(temporizadorToast);
    temporizadorToast = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  async function api(url) {
    const resposta = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return resposta.json();
  }

  function nomeTopico(id) {
    const topico = topicos.find((t) => t.id === id);
    return topico ? topico.nome : id;
  }

  function barras(container, itens, opcoes = {}) {
    const lista = itens.filter((item) => item && item.n != null);
    if (!lista.length) {
      container.innerHTML = '<p class="nota">sem dados</p>';
      return;
    }
    const maximo = Math.max(...lista.map((item) => item.n)) || 1;
    const rotulo = opcoes.rotulo || ((valor) => valor);
    container.innerHTML = lista
      .map(
        (item, indice) => `
      <div class="barra-linha">
        <span class="barra-rotulo" title="${esc(rotulo(item.valor))}">${esc(rotulo(item.valor))}</span>
        <span class="barra-trilha"><span class="barra-preenchimento cor-${indice % 6}" style="width:${((100 * item.n) / maximo).toFixed(1)}%"></span></span>
        <span class="barra-valor">${fmt(item.n)}</span>
      </div>`
      )
      .join("");
  }

  function colunas(container, itens) {
    const lista = (itens || []).filter((item) => item && item.n != null);
    if (!lista.length) {
      container.innerHTML = '<p class="nota">sem dados</p>';
      return;
    }
    const maximo = Math.max(...lista.map((item) => item.n)) || 1;
    container.innerHTML = `<div class="colunas">${lista
      .map(
        (item) => `
      <div class="coluna" title="${esc(item.valor)}: ${fmt(item.n)}">
        <span class="coluna-valor">${fmt(item.n)}</span>
        <span class="coluna-barra" style="height:${((100 * item.n) / maximo).toFixed(1)}%"></span>
        <span class="coluna-rotulo">${esc(item.valor)}</span>
      </div>`
      )
      .join("")}</div>`;
  }

  function cartaoQuestao(item) {
    return `
      <article class="item-questao">
        <div class="meta">
          <span class="chip chip-banca">${esc(item.banca)}</span>
          <span class="chip chip-ano">${item.ano}</span>
          <span class="chip chip-orgao">${esc(item.orgao)}</span>
          <span class="chip chip-disciplina">${esc(item.disciplina)}</span>
          ${item.tier ? `<span class="chip chip-tier chip-tier-${esc(item.tier)}">${esc(item.tier)}</span>` : ""}
          ${item.topico_nome ? `<span class="chip">${esc(item.topico_nome)}</span>` : ""}
          ${item.subtopico_nome ? `<span class="chip">${esc(item.subtopico_nome)}</span>` : ""}
          <span class="chip chip-tipo">${esc(NOMES_FORMATO[item.formato] || item.formato || "—")}</span>
          ${item.status && item.status !== "correta" ? `<span class="chip chip-status">${esc(item.status)}</span>` : ""}
        </div>
        <p class="item-enunciado">${esc(item.enunciado)}…</p>
        <button type="button" class="btn btn-secundario btn-pequeno" data-qid="${esc(item.id)}">Ver questão</button>
      </article>`;
  }

  function ligarBotoesQuestao(container) {
    container.querySelectorAll("button[data-qid]").forEach((botao) => {
      botao.addEventListener("click", () => abrirOverlay(botao.dataset.qid));
    });
  }

  function cartaoAlternativasOverlay(questao) {
    return Object.entries(questao.alternativas || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([letra, texto]) => `
        <button type="button" class="alternativa" data-letra="${esc(letra)}">
          <span class="letra" aria-hidden="true">${esc(letra)}</span>
          <span class="texto">${esc(texto)}</span>
          <span class="marca" aria-hidden="true"></span>
        </button>`
      )
      .join("");
  }

  function responderOverlay(letra) {
    if (!overlayQuestao || overlayRespondida || !overlayQuestao.alternativas[letra]) return;
    overlayRespondida = true;
    const acerto = letra === overlayQuestao.gabarito;
    el.overlayCorpo.querySelectorAll(".alternativa").forEach((botao) => {
      const atual = botao.dataset.letra;
      botao.disabled = true;
      if (atual === overlayQuestao.gabarito) botao.classList.add("correta");
      if (atual === letra) {
        botao.classList.add("escolhida");
        if (!acerto) botao.classList.add("errada");
      }
    });
    const retorno = el.overlayCorpo.querySelector("#overlay-retorno");
    retorno.hidden = false;
    retorno.className = `retorno ${acerto ? "retorno-certo" : "retorno-errado"}`;
    retorno.textContent = acerto
      ? "Resposta correta! Mandou bem."
      : `Resposta incorreta. A alternativa correta é a letra ${overlayQuestao.gabarito}.`;
  }

  function descreverNotaOverlay() {
    if (!overlayNota) return "Opcional, ainda não avaliada";
    return `Sua nota: ${overlayNota} · ${NOMES_NIVEL[overlayNota]}`;
  }

  function pintarEscalaOverlay(nota) {
    const valor = Number(nota) || 0;
    el.overlayCorpo.querySelectorAll("#overlay-escala .nivel").forEach((botao) => {
      const nivel = Number(botao.dataset.nota);
      botao.classList.toggle("aceso", nivel <= valor);
      botao.setAttribute("aria-pressed", String(nivel === overlayNota));
    });
  }

  function renderizarEscalaOverlay() {
    pintarEscalaOverlay(overlayNota || 0);
    const valor = el.overlayCorpo.querySelector("#overlay-dificuldade-valor");
    const remover = el.overlayCorpo.querySelector("#overlay-remover-nota");
    if (valor) valor.textContent = descreverNotaOverlay();
    if (remover) remover.hidden = !overlayNota;
  }

  function nivelNaPosicaoOverlay(clientX) {
    const botoes = [...el.overlayCorpo.querySelectorAll("#overlay-escala .nivel")];
    if (!botoes.length) return 0;
    for (const botao of botoes) {
      const caixa = botao.getBoundingClientRect();
      if (clientX >= caixa.left && clientX <= caixa.right) return Number(botao.dataset.nota);
    }
    const primeira = botoes[0].getBoundingClientRect();
    const ultima = botoes[botoes.length - 1].getBoundingClientRect();
    if (clientX < primeira.left) return Number(botoes[0].dataset.nota);
    if (clientX > ultima.right) return Number(botoes[botoes.length - 1].dataset.nota);
    return 0;
  }

  function montarEscalaOverlay() {
    const escala = el.overlayCorpo.querySelector("#overlay-escala");
    escala.textContent = "";
    NOTAS.forEach((nota) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "nivel";
      botao.dataset.nota = String(nota);
      botao.style.setProperty("--cor-nivel", `var(--nivel-${nota})`);
      botao.textContent = String(nota);
      botao.title = `${nota} · ${NOMES_NIVEL[nota]}`;
      botao.setAttribute("aria-label", `${nota} - ${NOMES_NIVEL[nota]}`);
      botao.setAttribute("aria-pressed", "false");

      const prever = () => {
        overlayPrevia = nota;
        pintarEscalaOverlay(nota);
        el.overlayCorpo.querySelector("#overlay-dificuldade-valor").textContent = `${nota} · ${NOMES_NIVEL[nota]}`;
      };
      botao.addEventListener("mouseenter", prever);
      botao.addEventListener("focus", prever);
      botao.addEventListener("click", (evento) => {
        if (overlaySuprimirClique) {
          overlaySuprimirClique = false;
          evento.preventDefault();
          return;
        }
        salvarNotaOverlay(nota);
      });
      escala.appendChild(botao);
    });

    escala.addEventListener("mouseleave", () => {
      overlayPrevia = 0;
      renderizarEscalaOverlay();
    });
    escala.addEventListener("focusout", () => {
      overlayPrevia = 0;
      renderizarEscalaOverlay();
    });
    escala.addEventListener("pointerdown", (evento) => {
      if (evento.button) return;
      const nota = nivelNaPosicaoOverlay(evento.clientX);
      if (!nota) return;
      overlayArrastando = true;
      overlayPrevia = nota;
      if (typeof escala.setPointerCapture === "function") {
        try {
          escala.setPointerCapture(evento.pointerId);
        } catch (erro) {
          /* segue sem captura */
        }
      }
      pintarEscalaOverlay(nota);
      el.overlayCorpo.querySelector("#overlay-dificuldade-valor").textContent = `${nota} · ${NOMES_NIVEL[nota]}`;
    });
    escala.addEventListener("pointermove", (evento) => {
      if (!overlayArrastando) return;
      const nota = nivelNaPosicaoOverlay(evento.clientX);
      if (!nota || overlayPrevia === nota) return;
      overlayPrevia = nota;
      pintarEscalaOverlay(nota);
      el.overlayCorpo.querySelector("#overlay-dificuldade-valor").textContent = `${nota} · ${NOMES_NIVEL[nota]}`;
    });
    escala.addEventListener("pointerup", (evento) => {
      if (!overlayArrastando) return;
      overlayArrastando = false;
      const nota = nivelNaPosicaoOverlay(evento.clientX);
      const caixa = escala.getBoundingClientRect();
      const dentro = evento.clientX >= caixa.left - 10 && evento.clientX <= caixa.right + 10;
      if (nota && dentro) {
        overlaySuprimirClique = true;
        window.setTimeout(() => {
          overlaySuprimirClique = false;
        }, 700);
        salvarNotaOverlay(nota);
      } else {
        overlayPrevia = 0;
        renderizarEscalaOverlay();
      }
    });
    escala.addEventListener("pointercancel", () => {
      overlayArrastando = false;
      overlayPrevia = 0;
      renderizarEscalaOverlay();
    });
  }

  async function salvarNotaOverlay(nota) {
    if (!overlayQuestao) return;
    const anterior = overlayNota;
    overlayNota = nota;
    overlayPrevia = 0;
    renderizarEscalaOverlay();
    try {
      const resposta = await window.AQAuth.pedir("/api/avaliacoes", {
        method: "POST",
        corpo: { questao_id: overlayQuestao.id, nota }
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      avisar(`Dificuldade salva: ${nota} · ${NOMES_NIVEL[nota]}`);
    } catch (erro) {
      overlayNota = anterior;
      renderizarEscalaOverlay();
      avisar("Não foi possível salvar a avaliação agora. Tente de novo.");
    }
  }

  async function removerNotaOverlay() {
    if (!overlayQuestao || !overlayNota) return;
    const anterior = overlayNota;
    overlayNota = null;
    renderizarEscalaOverlay();
    try {
      const resposta = await window.AQAuth.pedir(`/api/avaliacoes/${encodeURIComponent(overlayQuestao.id)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      avisar("Avaliação removida. A questão volta para 'não avaliadas'.");
    } catch (erro) {
      overlayNota = anterior;
      renderizarEscalaOverlay();
      avisar("Não foi possível remover a avaliação agora.");
    }
  }

  function renderizarAnotacaoOverlay() {
    const tem = Boolean(overlayAnotacao);
    const exibida = el.overlayCorpo.querySelector("#overlay-anotacao-exibida");
    const formulario = el.overlayCorpo.querySelector("#overlay-anotacao-form");
    const botao = el.overlayCorpo.querySelector("#overlay-btn-anotacao");
    const texto = el.overlayCorpo.querySelector("#overlay-anotacao-texto");
    if (!exibida) return;
    exibida.hidden = !tem || overlayFormAnotacao;
    formulario.hidden = !overlayFormAnotacao;
    botao.hidden = tem || overlayFormAnotacao;
    texto.textContent = overlayAnotacao;
  }

  function abrirFormularioAnotacaoOverlay() {
    overlayFormAnotacao = true;
    el.overlayCorpo.querySelector("#overlay-anotacao-campo").value = overlayAnotacao || "";
    renderizarAnotacaoOverlay();
    el.overlayCorpo.querySelector("#overlay-anotacao-campo").focus();
  }

  function fecharFormularioAnotacaoOverlay() {
    overlayFormAnotacao = false;
    renderizarAnotacaoOverlay();
  }

  async function salvarAnotacaoOverlay() {
    if (!overlayQuestao) return;
    const campo = el.overlayCorpo.querySelector("#overlay-anotacao-campo");
    const texto = campo.value.trim();
    if (!texto) {
      avisar("Escreva algo para salvar a anotação.");
      return;
    }
    const botao = el.overlayCorpo.querySelector("#overlay-salvar-anotacao");
    botao.disabled = true;
    try {
      const resposta = await window.AQAuth.pedir("/api/anotacoes", {
        method: "POST",
        corpo: { questao_id: overlayQuestao.id, texto }
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      overlayAnotacao = texto;
      overlayFormAnotacao = false;
      renderizarAnotacaoOverlay();
      avisar("Anotação salva. Você pode revê-la em 'Ver questões anotadas'.");
    } catch (erro) {
      avisar("Não foi possível salvar a anotação agora. Tente de novo.");
    } finally {
      botao.disabled = false;
    }
  }

  async function removerAnotacaoOverlay() {
    if (!overlayQuestao || !overlayAnotacao) return;
    const anterior = overlayAnotacao;
    overlayAnotacao = "";
    overlayFormAnotacao = false;
    renderizarAnotacaoOverlay();
    try {
      const resposta = await window.AQAuth.pedir(`/api/anotacoes/${encodeURIComponent(overlayQuestao.id)}`, { method: "DELETE" });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      avisar("Anotação removida.");
    } catch (erro) {
      overlayAnotacao = anterior;
      renderizarAnotacaoOverlay();
      avisar("Não foi possível remover a anotação agora.");
    }
  }

  async function enviarReporteOverlay() {
    if (!overlayQuestao) return;
    const campo = el.overlayCorpo.querySelector("#overlay-reporte-descricao");
    const botao = el.overlayCorpo.querySelector("#overlay-enviar-reporte");
    botao.disabled = true;
    try {
      const resposta = await fetch("/api/reportes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questao_id: overlayQuestao.id, descricao: campo.value.trim() })
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      el.overlayCorpo.querySelector("#overlay-reporte-form").hidden = true;
      el.overlayCorpo.querySelector("#overlay-btn-reportar").hidden = false;
      campo.value = "";
      avisar("Relato enviado. Obrigado por ajudar a melhorar o banco!");
    } catch (erro) {
      avisar("Não foi possível enviar o relato agora. Tente de novo.");
    } finally {
      botao.disabled = false;
    }
  }

  function ligarEventosOverlay(questao) {
    el.overlayCorpo.querySelectorAll(".alternativa").forEach((botao) => {
      botao.addEventListener("click", () => responderOverlay(botao.dataset.letra));
    });

    montarEscalaOverlay();
    renderizarEscalaOverlay();
    el.overlayCorpo.querySelector("#overlay-remover-nota").addEventListener("click", removerNotaOverlay);

    const loginAnotacao = el.overlayCorpo.querySelector("#overlay-anotacao-login");
    const autenticado = window.AQAuth.autenticado();
    loginAnotacao.hidden = autenticado;
    el.overlayCorpo.querySelector("#overlay-btn-anotacao").hidden = !autenticado;
    if (!autenticado) {
      el.overlayCorpo.querySelector("#overlay-anotacao-exibida").hidden = true;
      el.overlayCorpo.querySelector("#overlay-anotacao-form").hidden = true;
    }
    el.overlayCorpo.querySelector("#overlay-btn-anotacao").addEventListener("click", abrirFormularioAnotacaoOverlay);
    el.overlayCorpo.querySelector("#overlay-editar-anotacao").addEventListener("click", abrirFormularioAnotacaoOverlay);
    el.overlayCorpo.querySelector("#overlay-remover-anotacao").addEventListener("click", removerAnotacaoOverlay);
    el.overlayCorpo.querySelector("#overlay-cancelar-anotacao").addEventListener("click", fecharFormularioAnotacaoOverlay);
    el.overlayCorpo.querySelector("#overlay-anotacao-form").addEventListener("submit", (evento) => {
      evento.preventDefault();
      salvarAnotacaoOverlay();
    });

    el.overlayCorpo.querySelector("#overlay-btn-reportar").addEventListener("click", () => {
      el.overlayCorpo.querySelector("#overlay-btn-reportar").hidden = true;
      el.overlayCorpo.querySelector("#overlay-reporte-form").hidden = false;
      el.overlayCorpo.querySelector("#overlay-reporte-descricao").focus();
    });
    el.overlayCorpo.querySelector("#overlay-cancelar-reporte").addEventListener("click", () => {
      el.overlayCorpo.querySelector("#overlay-reporte-form").hidden = true;
      el.overlayCorpo.querySelector("#overlay-btn-reportar").hidden = false;
    });
    el.overlayCorpo.querySelector("#overlay-reporte-form").addEventListener("submit", (evento) => {
      evento.preventDefault();
      enviarReporteOverlay();
    });
  }

  async function abrirOverlay(questaoId) {
    el.overlay.hidden = false;
    document.body.classList.add("sem-scroll");
    el.overlayTitulo.textContent = "Questão";
    el.overlayCorpo.innerHTML = '<div class="carregando"><span class="spinner" aria-hidden="true"></span><p>Carregando questão...</p></div>';
    try {
      const questao = await api(`/api/dashboard/questao/${encodeURIComponent(questaoId)}`);
      overlayQuestao = questao;
      overlayRespondida = false;
      overlayNota = questao.nota || null;
      overlayAnotacao = window.AQAuth.autenticado() ? questao.anotacao || "" : "";
      overlayFormAnotacao = false;
      overlayPrevia = 0;
      overlayArrastando = false;

      el.overlayTitulo.textContent = `${questao.banca} · ${questao.ano}`;
      el.overlayCorpo.innerHTML = `
        <div class="meta">
          <span class="chip chip-banca">${esc(questao.banca)}</span>
          <span class="chip chip-ano">${questao.ano}</span>
          <span class="chip chip-orgao">${esc(questao.orgao)}</span>
          <span class="chip chip-disciplina">${esc(questao.disciplina)}</span>
          ${questao.tier ? `<span class="chip chip-tier chip-tier-${esc(questao.tier)}">${esc(questao.tier)}</span>` : ""}
          ${questao.alta_incidencia ? '<span class="chip chip-alta">alta incidência</span>' : ""}
          ${questao.topico_nome ? `<span class="chip">${esc(questao.topico_nome)}</span>` : ""}
          ${questao.subtopico_nome ? `<span class="chip">${esc(questao.subtopico_nome)}</span>` : ""}
          <span class="chip chip-tipo">${esc(NOMES_FORMATO[questao.formato] || questao.formato || "—")}</span>
          <span class="chip chip-tipo">${esc(NOMES_COMANDO[questao.comando] || questao.comando || "—")}</span>
          ${questao.status !== "correta" ? `<span class="chip chip-status">${esc(questao.status)}</span>` : ""}
        </div>
        <p class="nota">${esc(questao.cargo || "")}${questao.numero ? ` · questão nº ${questao.numero}` : ""} · ${esc(questao.id)}</p>
        <p class="enunciado">${esc(questao.enunciado)}</p>
        <div class="alternativas">${cartaoAlternativasOverlay(questao)}</div>
        <p class="retorno" id="overlay-retorno" role="status" aria-live="polite" hidden></p>

        <div class="dificuldade">
          <div class="dificuldade-topo">
            <span class="dificuldade-titulo">Qual a dificuldade desta questão?</span>
            <span class="dificuldade-acoes">
              <span class="dificuldade-valor" id="overlay-dificuldade-valor">Opcional, ainda não avaliada</span>
              <button type="button" class="btn-link" id="overlay-remover-nota" hidden>Remover avaliação</button>
            </span>
          </div>
          <div class="escala" id="overlay-escala" role="group" aria-label="Dificuldade de 1 (muito fácil) a 5 (muito difícil)"></div>
          <div class="escala-legenda"><span>1 · Mais fácil</span><span>5 · Mais difícil</span></div>
        </div>

        <div class="anotacao">
          <p class="anotacao-login" id="overlay-anotacao-login" hidden>
            <a class="btn-link" href="/entrar?voltar=/dashboard">Entre na sua conta</a> para salvar anotações nas questões.
          </p>
          <button type="button" class="btn-link" id="overlay-btn-anotacao">✎ Adicionar anotação sobre essa questão</button>
          <div class="anotacao-exibida" id="overlay-anotacao-exibida" hidden>
            <div class="anotacao-topo">
              <span class="anotacao-rotulo">Anotação</span>
              <span class="anotacao-acoes">
                <button type="button" class="btn-link" id="overlay-editar-anotacao">Editar</button>
                <button type="button" class="btn-link btn-link-perigo" id="overlay-remover-anotacao">Remover</button>
              </span>
            </div>
            <p id="overlay-anotacao-texto"></p>
          </div>
          <form class="anotacao-form" id="overlay-anotacao-form" hidden>
            <label for="overlay-anotacao-campo">Sua anotação sobre esta questão</label>
            <textarea id="overlay-anotacao-campo" rows="3" maxlength="2000" placeholder="Ex.: revisar esta depois, caiu em prova parecida, decorar as fases do tratamento..."></textarea>
            <div class="acoes">
              <button type="submit" class="btn btn-primario btn-pequeno" id="overlay-salvar-anotacao">Salvar anotação</button>
              <button type="button" class="btn btn-fantasma btn-pequeno" id="overlay-cancelar-anotacao">Cancelar</button>
            </div>
          </form>
        </div>

        <div class="reporte">
          <button type="button" class="btn-link" id="overlay-btn-reportar">⚑ Reportar erro nesta questão</button>
          <form class="reporte-form" id="overlay-reporte-form" hidden>
            <label for="overlay-reporte-descricao">O que está errado? (opcional)</label>
            <textarea id="overlay-reporte-descricao" rows="3" maxlength="2000" placeholder="Ex.: gabarito divergente, enunciado incompleto, alternativa repetida..."></textarea>
            <div class="acoes">
              <button type="submit" class="btn btn-primario btn-pequeno" id="overlay-enviar-reporte">Enviar relato</button>
              <button type="button" class="btn btn-fantasma btn-pequeno" id="overlay-cancelar-reporte">Cancelar</button>
            </div>
          </form>
        </div>

        <p class="atalho">Escolha uma alternativa para ver o gabarito na hora. Dica: use as teclas <kbd>A</kbd>–<kbd>E</kbd> (ou <kbd>1</kbd>–<kbd>5</kbd>).</p>
        <div class="acoes">
          <a class="btn btn-secundario btn-pequeno" href="/?questao=${encodeURIComponent(questao.id)}">Abrir no modo prática</a>
        </div>`;

      ligarEventosOverlay(questao);
    } catch (erro) {
      overlayQuestao = null;
      el.overlayCorpo.innerHTML = '<p class="aviso-vazio">Não foi possível carregar a questão agora. Tente de novo.</p>';
    }
  }

  function fecharOverlay() {
    el.overlay.hidden = true;
    document.body.classList.remove("sem-scroll");
    el.overlayCorpo.innerHTML = "";
    overlayQuestao = null;
    overlayRespondida = false;
    overlayNota = null;
    overlayAnotacao = "";
    overlayFormAnotacao = false;
  }

  async function carregarVisao() {
    const estatisticas = await api("/api/dashboard/estatisticas");
    const totais = resumo.totais;
    const cobertura = totais.especificas ? Math.round((100 * totais.especificas) / totais.questoes) : 0;

    el.kpis.innerHTML = [
      ["Questões", fmt(totais.questoes)],
      ["Provas", fmt(totais.provas)],
      ["Bancas", fmt(totais.bancas)],
      ["Órgãos", fmt(totais.orgaos)],
      ["Período", `${totais.periodo[0]}–${totais.periodo[1]}`],
      ["Específicas", fmt(totais.especificas)],
      ["Com gabarito", fmt(totais.com_gabarito)],
      ["Cobertura classificada", `${cobertura}%`]
    ]
      .map(([rotulo, valor]) => `<div class="kpi"><div class="n">${valor}</div><div class="l">${rotulo}</div></div>`)
      .join("");

    barras(el.grDisciplina, estatisticas.por_disciplina.slice(0, 10));
    colunas(el.grAno, estatisticas.por_ano);
    barras(el.grBanca, estatisticas.por_banca.slice(0, 12));
    barras(el.grFormato, estatisticas.por_formato, { rotulo: (v) => NOMES_FORMATO[v] || v });
    barras(el.grComando, estatisticas.por_comando, { rotulo: (v) => NOMES_COMANDO[v] || v });
    barras(el.grTier, estatisticas.por_tier, { rotulo: (v) => `Tier ${v}` });
  }

  function carregarIncidencia() {
    const lista = topicos.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    el.incTotal.textContent = `${lista.length} tópicos`;
    barras(
      el.grScore,
      lista.slice(0, 15).map((t) => ({ valor: t.nome, n: Math.round(t.score || 0) }))
    );

    el.listaIncidencia.innerHTML = lista
      .map((topico) => {
        const recentes = Object.entries(topico.por_ano || {})
          .filter(([ano]) => Number(ano) >= 2024)
          .reduce((soma, [, quantidade]) => soma + quantidade, 0);
        const bancas = (topico.top_bancas || [])
          .slice(0, 3)
          .map(([banca, quantidade]) => `${esc(banca)} (${quantidade})`)
          .join(", ");
        return `
        <div class="linha">
          <span class="selo selo-${esc((topico.tier || "c").toLowerCase())}">${esc(topico.tier || "—")}</span>
          <div>
            <div class="linha-titulo">${esc(topico.nome)}</div>
            <div class="linha-sub">${esc(topico.grupo || "")}${bancas ? ` · ${bancas}` : ""}</div>
          </div>
          <div class="linha-numeros">
            <span><strong>${fmt(topico.n)}</strong> questões</span>
            <span><strong>${fmt(Math.round(topico.score || 0))}</strong> score</span>
            <span><strong>${fmt(recentes)}</strong> desde 2024</span>
            <button type="button" class="btn btn-fantasma btn-pequeno" data-topico="${esc(topico.id)}">ver tópico</button>
          </div>
        </div>`;
      })
      .join("");

    el.listaIncidencia.querySelectorAll("button[data-topico]").forEach((botao) => {
      botao.addEventListener("click", () => {
        el.selTopico.value = botao.dataset.topico;
        trocarSecao("topicos");
        carregarTopico();
      });
    });
  }

  async function carregarTopico() {
    const topicoId = el.selTopico.value;
    if (!topicoId) return;
    const parametros = new URLSearchParams({ topico: topicoId });
    if (el.selTopicoBanca.value) parametros.set("banca", el.selTopicoBanca.value);
    if (el.selTopicoAno.value) parametros.set("ano", el.selTopicoAno.value);

    const [estatisticas, detalhe] = await Promise.all([
      api(`/api/dashboard/estatisticas?${parametros}`),
      Promise.resolve(topicos.find((t) => t.id === topicoId) || {})
    ]);

    el.kpisTopico.innerHTML = [
      ["Tier", `<span class="selo selo-${esc((detalhe.tier || "c").toLowerCase())}">${esc(detalhe.tier || "—")}</span>`],
      ["Questões", fmt(estatisticas.total)],
      ["Score", fmt(Math.round(detalhe.score || 0))],
      ["Bancas", fmt(estatisticas.por_banca.length)],
      ["Anos", fmt(estatisticas.por_ano.length)]
    ]
      .map(([rotulo, valor]) => `<div class="kpi"><div class="n">${valor}</div><div class="l">${rotulo}</div></div>`)
      .join("");

    el.termosTopico.innerHTML =
      (detalhe.termos || [])
        .map(([termo, quantidade]) => `<span class="chip">${esc(termo)} <strong>${quantidade}</strong></span>`)
        .join("") || '<span class="nota">sem termos</span>';

    colunas(el.grTopAno, estatisticas.por_ano);
    barras(el.grTopBanca, estatisticas.por_banca.slice(0, 12));
    barras(el.grTopFormato, estatisticas.por_formato, { rotulo: (v) => NOMES_FORMATO[v] || v });
    barras(el.grTopComando, estatisticas.por_comando, { rotulo: (v) => NOMES_COMANDO[v] || v });

    const subs = subtopicos.filter((s) => s.topico === topicoId);
    barras(el.grTopSubtopico, subs.map((s) => ({ valor: s.nome, n: s.n })));
    el.listaSubtopicos.innerHTML = subs.length
      ? subs
          .map(
            (sub) => `
        <div class="linha">
          <span class="selo selo-${esc((sub.tier || "c").toLowerCase())}">${esc(sub.tier || "—")}</span>
          <div>
            <div class="linha-titulo">${esc(sub.nome)}</div>
            <div class="linha-sub">${fmt(sub.n)} questões · score ${fmt(Math.round(sub.score || 0))}</div>
          </div>
          <div class="linha-numeros">
            <button type="button" class="btn btn-secundario btn-pequeno" data-subtopico="${esc(sub.id)}">ver questões</button>
          </div>
        </div>`
          )
          .join("")
      : '<p class="nota">este tópico não tem subtópicos definidos.</p>';

    el.listaSubtopicos.querySelectorAll("button[data-subtopico]").forEach((botao) => {
      botao.addEventListener("click", () => carregarQuestoesDoTopico(botao.dataset.subtopico));
    });

    carregarQuestoesDoTopico(null);
  }

  async function carregarQuestoesDoTopico(subtopicoId, acumular = false) {
    const topicoId = el.selTopico.value;
    if (!topicoId) return;

    if (!acumular) {
      subtopicoAtivo = subtopicoId;
      questoesTopico = [];
    }

    const pagina = acumular ? Math.floor(questoesTopico.length / POR_PAGINA_TOPICO) + 1 : 1;
    const parametros = new URLSearchParams({ topico: topicoId, page: pagina, per_page: POR_PAGINA_TOPICO });
    if (subtopicoAtivo) parametros.set("subtopico", subtopicoAtivo);
    if (el.selTopicoBanca.value) parametros.set("banca", el.selTopicoBanca.value);
    if (el.selTopicoAno.value) parametros.set("ano", el.selTopicoAno.value);

    const dados = await api(`/api/dashboard/questoes?${parametros}`);
    questoesTopico = acumular ? questoesTopico.concat(dados.itens) : dados.itens;
    totalQuestoesTopico = dados.total;

    const nomeSub = subtopicoAtivo
      ? (subtopicos.find((s) => s.topico === topicoId && s.id === subtopicoAtivo) || {}).nome || subtopicoAtivo
      : null;
    el.cartaoQuestoesTopico.hidden = false;
    el.tituloQuestoesTopico.textContent = nomeSub ? `Questões do subtópico: ${nomeSub}` : `Questões do tópico: ${nomeTopicosNome(topicoId)}`;
    el.notaQuestoesTopico.textContent = `${fmt(totalQuestoesTopico)} questões encontradas${nomeSub ? "" : " (todos os subtópicos)"} · mostrando ${fmt(questoesTopico.length)}`;
    el.listaQuestoesTopico.innerHTML = questoesTopico.length
      ? questoesTopico.map(cartaoQuestao).join("")
      : '<p class="nota">nenhuma questão com esses filtros.</p>';
    ligarBotoesQuestao(el.listaQuestoesTopico);
    el.btnMaisQuestoes.hidden = questoesTopico.length >= totalQuestoesTopico;
    el.btnMaisQuestoes.textContent = `Carregar mais questões (faltam ${fmt(Math.max(0, totalQuestoesTopico - questoesTopico.length))})`;
  }

  function nomeTopicosNome(topicoId) {
    return nomeTopico(topicoId);
  }

  function filtrosQuestoes() {
    const parametros = new URLSearchParams();
    const busca = el.fBusca.value.trim();
    if (busca) parametros.set("busca", busca);
    if (el.fDisciplina.value) parametros.set("disciplina", el.fDisciplina.value);
    if (el.fBanca.value) parametros.set("banca", el.fBanca.value);
    if (el.fAno.value) parametros.set("ano", el.fAno.value);
    if (el.fTopico.value) parametros.set("topico", el.fTopico.value);
    if (el.fSubtopico.value) {
      const [topico, subtopico] = el.fSubtopico.value.split("::");
      if (!el.fTopico.value) parametros.set("topico", topico);
      parametros.set("subtopico", subtopico);
    }
    if (el.fFormato.value) parametros.set("formato", el.fFormato.value);
    if (el.fComando.value) parametros.set("comando", el.fComando.value);
    if (el.fStatus.value) parametros.set("status", el.fStatus.value);
    if (el.fAlta.checked) parametros.set("alta", "1");
    return parametros;
  }

  async function carregarQuestoes(pagina = 1) {
    paginaQuestoes = pagina;
    const parametros = filtrosQuestoes();
    parametros.set("page", pagina);
    parametros.set("per_page", 20);
    el.listaQuestoes.innerHTML = '<div class="carregando"><span class="spinner" aria-hidden="true"></span></div>';
    const dados = await api(`/api/dashboard/questoes?${parametros}`);
    el.qTotal.textContent = `${fmt(dados.total)} questões`;
    el.pgInfo.textContent = `página ${dados.page} de ${dados.paginas || 1}`;
    el.listaQuestoes.innerHTML = dados.itens.length
      ? dados.itens.map(cartaoQuestao).join("")
      : '<p class="nota">nenhuma questão encontrada.</p>';
    ligarBotoesQuestao(el.listaQuestoes);
    el.pgAnterior.disabled = dados.page <= 1;
    el.pgProxima.disabled = dados.page >= (dados.paginas || 1);
  }

  function preencherSelect(select, itens, rotulo = (valor) => valor, vazio = "todos") {
    select.innerHTML =
      `<option value="">${vazio}</option>` +
      itens.map((item) => `<option value="${esc(item)}">${esc(rotulo(item))}</option>`).join("");
  }

  function trocarSecao(nome) {
    el.abas.querySelectorAll(".aba").forEach((botao) => botao.classList.toggle("ativa", botao.dataset.secao === nome));
    document.querySelectorAll(".secao").forEach((secao) => secao.classList.toggle("ativa", secao.id === nome));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function aplicarTema(tema) {
    const prefereEscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const escuro = tema === "escuro" || (tema === "auto" && prefereEscuro);
    document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (erro) {
      try {
        const area = document.createElement("textarea");
        area.value = texto;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
        return true;
      } catch (erro2) {
        return false;
      }
    }
  }

  function ligarEventos() {
    el.abas.querySelectorAll(".aba").forEach((botao) => {
      botao.addEventListener("click", () => trocarSecao(botao.dataset.secao));
    });
    el.selTopico.addEventListener("change", () => carregarTopico());
    el.selTopicoBanca.addEventListener("change", () => carregarTopico());
    el.selTopicoAno.addEventListener("change", () => carregarTopico());
    el.btnMaisQuestoes.addEventListener("click", () => carregarQuestoesDoTopico(subtopicoAtivo, true));

    let debounce;
    el.fBusca.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => carregarQuestoes(1), 350);
    });
    ["fDisciplina", "fBanca", "fAno", "fTopico", "fSubtopico", "fFormato", "fComando", "fStatus", "fAlta"].forEach((id) => {
      el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())].addEventListener("change", () => carregarQuestoes(1));
    });
    el.btnLimpar.addEventListener("click", () => {
      el.fBusca.value = "";
      ["fDisciplina", "fBanca", "fAno", "fTopico", "fSubtopico", "fFormato", "fComando", "fStatus"].forEach((id) => {
        el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())].value = "";
      });
      el.fAlta.checked = false;
      carregarQuestoes(1);
    });
    el.btnExportar.addEventListener("click", () => {
      window.open(`/api/dashboard/export.csv?${filtrosQuestoes()}`, "_blank");
    });
    el.btnCopiarIds.addEventListener("click", async () => {
      const dados = await api(`/api/dashboard/ids?${filtrosQuestoes()}`);
      const copiou = await copiar(dados.ids.join("\n"));
      avisar(copiou ? `${fmt(dados.total)} IDs copiados.` : "Não foi possível copiar os IDs.");
    });
    el.pgAnterior.addEventListener("click", () => paginaQuestoes > 1 && carregarQuestoes(paginaQuestoes - 1));
    el.pgProxima.addEventListener("click", () => carregarQuestoes(paginaQuestoes + 1));

    el.btnFecharOverlay.addEventListener("click", fecharOverlay);
    el.overlayFundo.addEventListener("click", fecharOverlay);
    document.addEventListener("keydown", (evento) => {
      if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
      if (el.overlay.hidden) return;
      const alvo = evento.target;
      if (alvo && alvo.closest && alvo.closest("input, select, textarea")) return;

      if (evento.key === "Escape") {
        fecharOverlay();
        return;
      }

      if (overlayRespondida || !overlayQuestao) return;
      const tecla = evento.key.toUpperCase();
      const numero = Number(evento.key);
      let letra = LETRAS.includes(tecla) ? tecla : null;
      if (!letra && Number.isInteger(numero) && numero >= 1 && numero <= LETRAS.length) {
        letra = LETRAS[numero - 1];
      }
      if (letra && overlayQuestao.alternativas[letra]) {
        evento.preventDefault();
        responderOverlay(letra);
      }
    });

    el.btnTema.addEventListener("click", () => {
      const temaAtual = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
      try {
        window.localStorage.setItem(CHAVE_TEMA, temaAtual);
      } catch (erro) {
        /* modo privado */
      }
      aplicarTema(temaAtual);
    });
  }

  async function iniciar() {
    ligarEventos();
    await window.AQAuth.iniciar();

    resumo = await api("/api/dashboard/resumo");
    const dadosTopicos = await api("/api/dashboard/topicos");
    topicos = dadosTopicos.topicos;
    subtopicos = dadosTopicos.subtopicos;

    await carregarVisao();
    carregarIncidencia();

    el.selTopico.innerHTML = topicos
      .slice()
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((topico) => `<option value="${esc(topico.id)}">[${esc(topico.tier || "—")}] ${esc(topico.nome)} (${topico.n})</option>`)
      .join("");
    preencherSelect(el.selTopicoBanca, resumo.opcoes.bancas, (valor) => valor, "todas");
    preencherSelect(el.selTopicoAno, resumo.opcoes.anos, (valor) => valor, "todos");

    preencherSelect(el.fDisciplina, resumo.opcoes.disciplinas, (valor) => valor, "todas");
    preencherSelect(el.fBanca, resumo.opcoes.bancas, (valor) => valor, "todas");
    preencherSelect(el.fAno, resumo.opcoes.anos, (valor) => valor, "todos");
    preencherSelect(el.fTopico, topicos.map((t) => t.id), (id) => `[${(topicos.find((t) => t.id === id) || {}).tier || "—"}] ${nomeTopico(id)}`, "todos");
    preencherSelect(el.fFormato, resumo.opcoes.formatos, (valor) => NOMES_FORMATO[valor] || valor, "todos");
    preencherSelect(el.fComando, resumo.opcoes.comandos, (valor) => NOMES_COMANDO[valor] || valor, "todos");

    el.fSubtopico.innerHTML =
      '<option value="">todos</option>' +
      topicos
        .map((topico) => {
          const lista = subtopicos.filter((s) => s.topico === topico.id);
          if (!lista.length) return "";
          return (
            `<optgroup label="${esc(topico.nome)}">` +
            lista
              .map((sub) => `<option value="${esc(topico.id)}::${esc(sub.id)}">${esc(sub.nome)} (${sub.n})</option>`)
              .join("") +
            "</optgroup>"
          );
        })
        .join("");

    await Promise.all([carregarTopico(), carregarQuestoes(1)]);

    const topicoInicial = new URLSearchParams(window.location.search).get("topico");
    if (topicoInicial && topicos.some((topico) => topico.id === topicoInicial)) {
      el.selTopico.value = topicoInicial;
      trocarSecao("topicos");
      await carregarTopico();
    }
  }

  let temaSalvo = "auto";
  try {
    temaSalvo = window.localStorage.getItem(CHAVE_TEMA) || "auto";
  } catch (erro) {
    temaSalvo = "auto";
  }
  aplicarTema(temaSalvo);

  iniciar().catch((erro) => {
    document.querySelector("main").insertAdjacentHTML(
      "afterbegin",
      `<div class="cartao"><p class="aviso-vazio">Não foi possível carregar o painel agora (${esc(erro.message)}). Tente recarregar a página.</p></div>`
    );
  });
})();
