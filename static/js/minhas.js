(() => {
  "use strict";

  const el = {};
  [
    "marca-subtitulo", "cartao-deslogado", "conteudo", "usuario-identificacao", "kpis", "lista-acertos",
    "lista-erros", "lista-disciplinas", "respondidas", "total-respondidas", "f-resultado", "f-disciplina",
    "f-topico", "f-busca", "lista-questoes", "pg-anterior", "pg-info", "pg-proxima", "anotacoes",
    "total-anotacoes", "lista-anotacoes", "btn-sair", "toast"
  ].forEach((id) => {
    el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())] = document.getElementById(id);
  });

  const NOMES_FORMATO = {
    simples: "Simples",
    afirmativas: "Afirmativas",
    vf: "Verdadeiro/Falso",
    lacunas: "Lacunas",
    colunas: "Colunas",
    caso_clinico: "Caso clínico",
    texto_base: "Texto-base"
  };

  let pagina = 1;
  let resumo = null;
  let temporizadorToast = 0;

  const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR"));
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (acertos, total) => (total ? Math.round((100 * acertos) / total) : 0);

  function avisar(mensagem) {
    el.toast.textContent = mensagem;
    el.toast.hidden = false;
    window.clearTimeout(temporizadorToast);
    temporizadorToast = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  function mostrarDeslogado() {
    el.cartaoDeslogado.hidden = false;
    el.conteudo.hidden = true;
    el.btnSair.hidden = true;
  }

  function cartaoQuestao(item) {
    const classe = item.acerto ? "chip chip-alta" : "chip chip-status";
    const rotulo = item.acerto ? "acertou" : "errou";
    return `
      <article class="item-questao">
        <div class="meta">
          <span class="chip chip-banca">${esc(item.banca)}</span>
          <span class="chip chip-ano">${item.ano}</span>
          <span class="chip chip-orgao">${esc(item.orgao)}</span>
          <span class="chip chip-disciplina">${esc(item.disciplina)}</span>
          ${item.topico_nome ? `<span class="chip">${esc(item.topico_nome)}</span>` : ""}
          ${item.subtopico_nome ? `<span class="chip">${esc(item.subtopico_nome)}</span>` : ""}
          <span class="chip chip-tipo">${esc(NOMES_FORMATO[item.formato] || item.formato || "—")}</span>
          <span class="${classe}">${rotulo}${item.escolha ? ` · marcou ${esc(item.escolha)}` : ""}${item.acerto ? "" : ` · gabarito ${esc(item.gabarito || "—")}`}</span>
        </div>
        <p class="item-enunciado">${esc(item.enunciado)}…</p>
        <a class="btn btn-secundario btn-pequeno" href="/?questao=${encodeURIComponent(item.id)}">Praticar esta questão</a>
      </article>`;
  }

  function linhaTema(tema, tipo) {
    const aproveitamento = pct(tema.acertos, tema.n);
    return `
      <div class="linha">
        <span class="selo selo-${aproveitamento >= 70 ? "a" : aproveitamento >= 50 ? "b" : "c"}">${aproveitamento}%</span>
        <div>
          <div class="linha-titulo">${esc(tema.nome)}</div>
          <div class="linha-sub">${fmt(tema.n)} respondidas · ${fmt(tema.acertos)} acertos · ${fmt(tema.n - tema.acertos)} erros</div>
        </div>
        <div class="linha-numeros">
          <a class="btn btn-fantasma btn-pequeno" href="/dashboard?topico=${encodeURIComponent(tema.id)}">ver tópico</a>
        </div>
      </div>`;
  }

  async function carregarResumo() {
    resumo = await window.AQAuth.pedirJson("/api/minhas/resumo");
    const respondidas = resumo.respondidas || 0;
    const acertos = resumo.acertos || 0;
    const erros = respondidas - acertos;

    el.usuarioIdentificacao.textContent = window.AQAuth.usuario() ? window.AQAuth.usuario().email : "";
    el.kpis.innerHTML = [
      ["Questões respondidas", fmt(respondidas)],
      ["Acertos", fmt(acertos)],
      ["Erros", fmt(erros)],
      ["Aproveitamento", respondidas ? `${pct(acertos, respondidas)}%` : "—"],
      ["Tentativas no total", fmt(resumo.tentativas)],
      ["Anotações", fmt(resumo.anotacoes)]
    ]
      .map(([rotulo, valor]) => `<div class="kpi"><div class="n">${valor}</div><div class="l">${rotulo}</div></div>`)
      .join("");

    const temas = (resumo.por_topico || []).filter((tema) => tema.n > 0);
    const melhores = temas.slice().sort((a, b) => pct(b.acertos, b.n) - pct(a.acertos, a.n) || b.n - a.n).slice(0, 8);
    const piores = temas.slice().sort((a, b) => pct(a.acertos, a.n) - pct(b.acertos, b.n) || b.n - a.n).slice(0, 8);

    el.listaAcertos.innerHTML = melhores.length
      ? melhores.map((tema) => linhaTema(tema)).join("")
      : '<p class="nota">Responda pelo menos 3 questões de um tópico para ver seu aproveitamento por tema.</p>';
    el.listaErros.innerHTML = piores.length
      ? piores.map((tema) => linhaTema(tema)).join("")
      : '<p class="nota">Sem dados suficientes ainda.</p>';

    const disciplinas = (resumo.por_disciplina || []).slice().sort((a, b) => b.n - a.n);
    el.listaDisciplinas.innerHTML = disciplinas.length
      ? disciplinas
          .map((disciplina) => {
            const aproveitamento = pct(disciplina.acertos, disciplina.n);
            return `
            <div class="barra-linha">
              <span class="barra-rotulo" title="${esc(disciplina.valor)}">${esc(disciplina.valor)}</span>
              <span class="barra-trilha"><span class="barra-preenchimento" style="width:${aproveitamento}%"></span></span>
              <span class="barra-valor">${aproveitamento}% · ${fmt(disciplina.n)}</span>
            </div>`;
          })
          .join("")
      : '<p class="nota">Nenhuma questão respondida ainda.</p>';

    el.fDisciplina.innerHTML =
      '<option value="">todas</option>' +
      disciplinas.map((disciplina) => `<option value="${esc(disciplina.valor)}">${esc(disciplina.valor)} (${disciplina.n})</option>`).join("");
    el.fTopico.innerHTML =
      '<option value="">todos</option>' +
      temas
        .slice()
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map((tema) => `<option value="${esc(tema.id)}">${esc(tema.nome)} (${tema.n})</option>`)
        .join("");
  }

  async function carregarQuestoes(novaPagina = 1) {
    pagina = novaPagina;
    const parametros = new URLSearchParams({ page: pagina, per_page: 20 });
    if (el.fResultado.value) parametros.set("resultado", el.fResultado.value);
    if (el.fDisciplina.value) parametros.set("disciplina", el.fDisciplina.value);
    if (el.fTopico.value) parametros.set("topico", el.fTopico.value);
    if (el.fBusca.value.trim()) parametros.set("busca", el.fBusca.value.trim());

    el.listaQuestoes.innerHTML = '<div class="carregando"><span class="spinner" aria-hidden="true"></span></div>';
    const dados = await window.AQAuth.pedirJson(`/api/minhas/questoes?${parametros}`);
    el.totalRespondidas.textContent = `${fmt(dados.total)} questões`;
    el.pgInfo.textContent = `página ${dados.page} de ${dados.paginas || 1}`;
    el.listaQuestoes.innerHTML = dados.itens.length
      ? dados.itens.map(cartaoQuestao).join("")
      : '<p class="nota">Nenhuma questão encontrada com esses filtros.</p>';
    el.pgAnterior.disabled = dados.page <= 1;
    el.pgProxima.disabled = dados.page >= (dados.paginas || 1);
  }

  async function carregarAnotacoes() {
    const dados = await window.AQAuth.pedirJson("/api/minhas/anotacoes");
    el.totalAnotacoes.textContent = `${fmt(dados.total)} anotações`;
    el.listaAnotacoes.innerHTML = dados.itens.length
      ? dados.itens
          .map(
            (item) => `
        <article class="item-questao">
          <div class="meta">
            <span class="chip chip-banca">${esc(item.banca)}</span>
            <span class="chip chip-ano">${item.ano}</span>
            <span class="chip chip-orgao">${esc(item.orgao)}</span>
            <span class="chip chip-disciplina">${esc(item.disciplina)}</span>
            ${item.topico_nome ? `<span class="chip">${esc(item.topico_nome)}</span>` : ""}
          </div>
          <div class="anotacao-exibida">
            <span class="anotacao-rotulo">Anotação</span>
            <p>${esc(item.texto)}</p>
          </div>
          <p class="item-enunciado">${esc(item.enunciado)}…</p>
          <a class="btn btn-secundario btn-pequeno" href="/?questao=${encodeURIComponent(item.id)}">Praticar esta questão</a>
        </article>`
          )
          .join("")
      : '<p class="nota">Você ainda não tem anotações. Na tela de prática, use “Adicionar anotação sobre essa questão”.</p>';
  }

  async function iniciar() {
    const autenticado = await window.AQAuth.iniciar();
    if (!autenticado) {
      mostrarDeslogado();
      return;
    }
    el.conteudo.hidden = false;
    el.btnSair.hidden = false;
    const usuario = window.AQAuth.usuario();
    el.marcaSubtitulo.textContent = usuario.nome
      ? `${usuario.nome} · seu desempenho`
      : `${usuario.email} · seu desempenho`;

    await carregarResumo();
    await Promise.all([carregarQuestoes(1), carregarAnotacoes()]);

    el.btnSair.addEventListener("click", async () => {
      await window.AQAuth.sair();
      window.location.href = "/";
    });
    ["fResultado", "fDisciplina", "fTopico"].forEach((chave) => {
      el[chave].addEventListener("change", () => carregarQuestoes(1));
    });
    let debounce;
    el.fBusca.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => carregarQuestoes(1), 350);
    });
    el.pgAnterior.addEventListener("click", () => pagina > 1 && carregarQuestoes(pagina - 1));
    el.pgProxima.addEventListener("click", () => carregarQuestoes(pagina + 1));
  }

  iniciar().catch((erro) => {
    if (erro && erro.status === 401) {
      mostrarDeslogado();
      return;
    }
    avisar(erro.message || "Não foi possível carregar suas estatísticas agora.");
    mostrarDeslogado();
  });
})();
