(() => {
  "use strict";

  const config = JSON.parse(document.getElementById("config-app").textContent);
  const LETRAS = ["A", "B", "C", "D", "E"];
  const TODAS = "todas";
  const NAO_AVALIADAS = "nao-avaliadas";
  const NOMES_NIVEL = { 1: "Muito fácil", 2: "Fácil", 3: "Média", 4: "Difícil", 5: "Muito difícil" };
  const NOTAS = [];
  for (let nota = config.niveis.min; nota <= config.niveis.max; nota += 1) NOTAS.push(nota);

  const CHAVE_PROGRESSO = "aq-asb:progresso:v1";
  const TOLERANCIA_ESCALA = 10;

  const el = {};
  [
    "sel-disciplina", "sel-banca", "sel-prova", "sel-dificuldade", "painel", "barra", "barra-preenchimento",
    "m-respondidas", "m-acertos", "m-erros", "m-aproveitamento", "btn-reiniciar", "btn-comecar", "btn-recarregar",
    "btn-proxima", "btn-pular", "btn-anterior", "btn-continuar", "btn-refazer-erradas", "btn-recomecar",
    "btn-inicio", "btn-tema", "tela-inicio", "tela-questao", "tela-fim", "q-meta", "q-nota", "q-enunciado",
    "q-alternativas", "q-retorno", "fim-titulo", "fim-texto", "f-total", "f-acertos", "f-erros",
    "f-aproveitamento", "toast", "aviso-vazio", "inicio-carregando", "carregando-texto", "inicio-erro",
    "inicio-erro-texto", "inicio-pronto", "inicio-total", "dificuldade", "dificuldade-valor", "escala",
    "btn-remover-nota", "anotacao", "anotacao-exibida", "anotacao-texto", "anotacao-form", "anotacao-campo",
    "btn-anotacao", "btn-editar-anotacao", "btn-remover-anotacao", "btn-salvar-anotacao", "btn-cancelar-anotacao",
    "reporte", "reporte-form", "reporte-descricao", "btn-reportar", "btn-enviar-reporte", "btn-cancelar-reporte",
    "link-anotacoes", "area-conta", "anotacao-login"
  ].forEach((id) => {
    el[id.replace(/-(\w)/g, (_, letra) => letra.toUpperCase())] = document.getElementById(id);
  });

  const memoria = {};

  function ler(chave) {
    try {
      return window.localStorage.getItem(chave);
    } catch (erro) {
      return Object.prototype.hasOwnProperty.call(memoria, chave) ? memoria[chave] : null;
    }
  }

  function gravar(chave, valor) {
    memoria[chave] = valor;
    try {
      window.localStorage.setItem(chave, valor);
    } catch (erro) {
      /* modo privado: mantém apenas em memória */
    }
  }

  let banco = [];
  let porId = new Map();
  let progresso = {};
  let avaliacoes = {};
  let anotacoes = {};
  let avaliacoesCarregadas = false;
  let filtro = { disciplina: TODAS, banca: TODAS, prova: TODAS, dificuldade: TODAS };
  let rodada = [];
  let indice = 0;
  let atual = null;
  let respondida = false;
  let respostasDaRodada = new Map();
  let modoRodada = "novas";
  let temporizadorToast = 0;
  let formularioAnotacaoAberto = false;
  let arrastandoNota = false;
  let previaNota = 0;
  let suprimirCliqueNota = false;

  function avisar(mensagem) {
    el.toast.textContent = mensagem;
    el.toast.hidden = false;
    window.clearTimeout(temporizadorToast);
    temporizadorToast = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 3400);
  }

  function embaralhar(lista) {
    const copia = lista.slice();
    for (let i = copia.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const troca = copia[i];
      copia[i] = copia[j];
      copia[j] = troca;
    }
    return copia;
  }

  function normalizar(valor) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "")
      .trim();
  }

  function esc(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[caractere]));
  }

  function cargoCurto(cargo) {
    return cargo.replace(/^(AS\s*-\s*)?Auxiliar\s+(?:de|em)\s+Sa[úu]de\s+Bucal\s*/i, "").trim() || "ASB";
  }

  function carregarProgresso() {
    let dados = {};
    try {
      dados = JSON.parse(ler(CHAVE_PROGRESSO) || "{}") || {};
    } catch (erro) {
      dados = {};
    }
    const limpo = {};
    Object.keys(dados).forEach((id) => {
      if (porId.has(id)) limpo[id] = dados[id];
    });
    return limpo;
  }

  function salvarProgresso() {
    gravar(CHAVE_PROGRESSO, JSON.stringify(progresso));
  }

  function registrarRespostaNoServidor(questaoId, escolha, acerto) {
    if (!window.AQAuth.autenticado()) return;
    window.AQAuth.pedir("/api/minhas/respostas", {
      method: "POST",
      corpo: { questao_id: questaoId, escolha, acerto }
    }).catch(() => {
      /* sem rede: o progresso local continua valendo */
    });
  }

  async function sincronizarProgresso() {
    const local = carregarProgresso();
    if (!window.AQAuth.autenticado()) {
      progresso = local;
      return;
    }
    let doServidor = {};
    try {
      const dados = await window.AQAuth.pedirJson("/api/minhas/respostas");
      doServidor = dados.respostas || {};
    } catch (erro) {
      progresso = local;
      return;
    }
    const pendentes = Object.entries(local)
      .filter(([id]) => !doServidor[id])
      .map(([id, registro]) => ({ id, escolha: registro.escolha, acerto: registro.acerto }));
    if (pendentes.length) {
      try {
        await window.AQAuth.pedirJson("/api/minhas/respostas/lote", { method: "POST", corpo: { respostas: pendentes } });
        pendentes.forEach((item) => {
          doServidor[item.id] = { escolha: item.escolha, acerto: item.acerto };
        });
      } catch (erro) {
        /* segue com o que veio do servidor */
      }
    }
    progresso = doServidor;
  }

  function passaDisciplina(questao) {
    return filtro.disciplina === TODAS || questao.disciplina === filtro.disciplina;
  }

  function passaBanca(questao) {
    return filtro.banca === TODAS || normalizar(questao.banca) === filtro.banca;
  }

  function passaProva(questao) {
    return filtro.prova === TODAS || questao.prova_slug === filtro.prova;
  }

  function passaBase(questao) {
    return passaDisciplina(questao) && passaBanca(questao) && passaProva(questao);
  }

  function passaDificuldade(questao) {
    if (filtro.dificuldade === TODAS) return true;
    const nota = avaliacoes[questao.id];
    if (filtro.dificuldade === NAO_AVALIADAS) return nota === undefined;
    return nota === Number(filtro.dificuldade);
  }

  function pool() {
    return banco.filter((questao) => passaBase(questao) && passaDificuldade(questao));
  }

  function contar(itens) {
    const contagem = new Map();
    itens.forEach((chave) => contagem.set(chave, (contagem.get(chave) || 0) + 1));
    return contagem;
  }

  function soma(contagem) {
    let total = 0;
    contagem.forEach((valor) => {
      total += valor;
    });
    return total;
  }

  function preencherSelect(select, opcoes, valorAtual, rotuloTodos) {
    select.textContent = "";
    const inicial = document.createElement("option");
    inicial.value = TODAS;
    inicial.textContent = rotuloTodos;
    select.appendChild(inicial);

    opcoes.forEach((opcao) => {
      const item = document.createElement("option");
      item.value = opcao.valor;
      item.textContent = opcao.rotulo;
      select.appendChild(item);
    });

    const existe = opcoes.some((opcao) => opcao.valor === valorAtual);
    select.value = existe ? valorAtual : TODAS;
    return existe;
  }

  function montarBancas(avisos) {
    const base = banco.filter((questao) => passaDisciplina(questao) && passaProva(questao));
    const contagem = contar(base.map((questao) => normalizar(questao.banca)));
    const opcoes = [...contagem.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([nome, total]) => ({ valor: nome, rotulo: `${nome} (${total})` }));

    const anterior = filtro.banca;
    preencherSelect(el.selBanca, opcoes, anterior, `Todas as bancas (${base.length})`);
    filtro.banca = el.selBanca.value;
    if (anterior !== TODAS && filtro.banca !== anterior) {
      if (avisos) avisos.push(`A banca ${anterior} não tem questões nessa combinação — mostrando todas as bancas.`);
      return true;
    }
    return false;
  }

  function montarDisciplinas(avisos) {
    const base = banco.filter((questao) => passaBanca(questao) && passaProva(questao));
    const contagem = contar(base.map((questao) => questao.disciplina));
    const opcoes = [...contagem.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([nome, total]) => ({ valor: nome, rotulo: `${nome} (${total})` }));

    const anterior = filtro.disciplina;
    preencherSelect(el.selDisciplina, opcoes, anterior, `Todas as disciplinas (${base.length})`);
    filtro.disciplina = el.selDisciplina.value;
    if (anterior !== TODAS && filtro.disciplina !== anterior) {
      if (avisos) avisos.push(`A disciplina ${anterior} não tem questões nessa combinação — mostrando todas.`);
      return true;
    }
    return false;
  }

  function rotuloProva(prova) {
    const partes = [];
    if (filtro.banca === TODAS) partes.push(prova.banca);
    partes.push(prova.orgao, String(prova.ano));
    if (prova.ambigua || prova.cargos.size > 1) {
      partes.push([...prova.cargos].map(cargoCurto).sort((a, b) => a.localeCompare(b, "pt-BR")).join(" + "));
    }
    return partes.join(" · ");
  }

  function montarProvas(avisos) {
    const mapa = new Map();
    banco.filter((questao) => passaDisciplina(questao) && passaBanca(questao)).forEach((questao) => {
      const prova = mapa.get(questao.prova_slug) || {
        slug: questao.prova_slug,
        banca: questao.banca,
        orgao: questao.orgao,
        ano: questao.ano,
        total: 0,
        cargos: new Set()
      };
      prova.total += 1;
      if (questao.cargo) prova.cargos.add(questao.cargo);
      mapa.set(questao.prova_slug, prova);
    });

    const provas = [...mapa.values()];
    const repeticoes = contar(provas.map((prova) => `${normalizar(prova.banca)}|${prova.orgao}|${prova.ano}`));
    provas.forEach((prova) => {
      prova.ambigua = (repeticoes.get(`${normalizar(prova.banca)}|${prova.orgao}|${prova.ano}`) || 0) > 1;
    });
    provas.sort((a, b) => rotuloProva(a).localeCompare(rotuloProva(b), "pt-BR"));

    const opcoes = provas.map((prova) => ({ valor: prova.slug, rotulo: `${rotuloProva(prova)} (${prova.total})` }));
    const total = provas.reduce((acumulado, prova) => acumulado + prova.total, 0);
    const anterior = filtro.prova;
    preencherSelect(el.selProva, opcoes, anterior, `Todas as provas (${total})`);
    filtro.prova = el.selProva.value;
    if (anterior !== TODAS && filtro.prova !== anterior) {
      if (avisos) avisos.push("A prova escolhida não tem questões nessa combinação — mostrando todas as provas.");
      return true;
    }
    return false;
  }

  function montarDificuldade(avisos) {
    if (!config.bancoDisponivel) {
      preencherSelect(el.selDificuldade, [], TODAS, "Avaliações indisponíveis");
      el.selDificuldade.disabled = true;
      return false;
    }
    if (!avaliacoesCarregadas) {
      preencherSelect(el.selDificuldade, [], TODAS, "Carregando avaliações...");
      el.selDificuldade.disabled = true;
      return false;
    }

    const base = banco.filter(passaBase);
    const contagem = contar(base.map((questao) => (avaliacoes[questao.id] === undefined ? NAO_AVALIADAS : String(avaliacoes[questao.id]))));
    const opcoes = [];
    const naoAvaliadas = contagem.get(NAO_AVALIADAS) || 0;
    if (naoAvaliadas > 0 || filtro.dificuldade === NAO_AVALIADAS) {
      opcoes.push({ valor: NAO_AVALIADAS, rotulo: `Ainda não avaliadas (${naoAvaliadas})` });
    }
    NOTAS.forEach((nota) => {
      const total = contagem.get(String(nota)) || 0;
      if (total > 0 || filtro.dificuldade === String(nota)) {
        opcoes.push({ valor: String(nota), rotulo: `${nota} · ${NOMES_NIVEL[nota]} (${total})` });
      }
    });

    const anterior = filtro.dificuldade;
    preencherSelect(el.selDificuldade, opcoes, anterior, `Todas as questões (${base.length})`);
    el.selDificuldade.disabled = false;
    filtro.dificuldade = el.selDificuldade.value;
    if (anterior !== TODAS && filtro.dificuldade !== anterior) {
      if (avisos) avisos.push("A dificuldade escolhida não tem mais questões nessa combinação — mostrando todas.");
      return true;
    }
    return false;
  }

  function montarFiltros(avisos) {
    for (let volta = 0; volta < 4; volta += 1) {
      const mudou = [montarBancas(avisos), montarDisciplinas(avisos), montarProvas(avisos)].includes(true);
      if (!mudou) break;
    }
    montarDificuldade(avisos);
  }

  function mostrarTela(nome) {
    el.telaInicio.hidden = nome !== "inicio";
    el.telaQuestao.hidden = nome !== "questao";
    el.telaFim.hidden = nome !== "fim";
  }

  function atualizarPainel() {
    if (!banco.length) return;
    const lista = pool();
    let respondidas = 0;
    let acertos = 0;
    lista.forEach((questao) => {
      const registro = progresso[questao.id];
      if (!registro) return;
      respondidas += 1;
      if (registro.acerto) acertos += 1;
    });
    const erros = respondidas - acertos;
    const percentual = lista.length ? Math.round((respondidas / lista.length) * 100) : 0;

    el.barraPreenchimento.style.width = `${percentual}%`;
    el.barra.setAttribute("aria-valuenow", String(percentual));
    el.barra.setAttribute("aria-valuetext", `${respondidas} de ${lista.length} questões respondidas`);
    el.mRespondidas.textContent = `${respondidas}/${lista.length}`;
    el.mAcertos.textContent = String(acertos);
    el.mErros.textContent = String(erros);
    el.mAproveitamento.textContent = respondidas ? `${Math.round((acertos / respondidas) * 100)}%` : "—";

    const vazio = lista.length === 0;
    el.avisoVazio.hidden = !vazio;
    el.btnComecar.disabled = vazio;
  }

  function construirChip(texto, classe) {
    const chip = document.createElement("span");
    chip.className = `chip ${classe}`;
    chip.textContent = texto;
    return chip;
  }

  function construirAlternativa(letra, texto) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "alternativa";
    botao.dataset.letra = letra;
    botao.addEventListener("click", () => responder(letra));

    const marcaLetra = document.createElement("span");
    marcaLetra.className = "letra";
    marcaLetra.setAttribute("aria-hidden", "true");
    marcaLetra.textContent = letra;

    const corpo = document.createElement("span");
    corpo.className = "texto";
    corpo.textContent = texto;

    const marca = document.createElement("span");
    marca.className = "marca";
    marca.setAttribute("aria-hidden", "true");

    botao.append(marcaLetra, corpo, marca);
    return botao;
  }

  function pintarEscala(nota) {
    const valor = Number(nota) || 0;
    const salva = atual ? avaliacoes[atual.id] || 0 : 0;
    el.escala.querySelectorAll(".nivel").forEach((botao) => {
      const nivel = Number(botao.dataset.nota);
      botao.classList.toggle("aceso", nivel <= valor);
      botao.setAttribute("aria-pressed", String(nivel === salva));
    });
  }

  function descreverNota(nota) {
    if (!nota) return "Opcional, ainda não avaliada";
    return `Sua nota: ${nota} · ${NOMES_NIVEL[nota]}`;
  }

  function renderizarDificuldade() {
    if (!config.bancoDisponivel || !avaliacoesCarregadas) {
      el.dificuldade.hidden = true;
      return;
    }
    el.dificuldade.hidden = false;
    const nota = atual ? avaliacoes[atual.id] : undefined;
    pintarEscala(nota || 0);
    el.dificuldadeValor.textContent = descreverNota(nota);
    el.btnRemoverNota.hidden = !nota;
  }

  function nivelNaPosicao(clientX) {
    const botoes = [...el.escala.querySelectorAll(".nivel")];
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

  function dentroDaEscala(clientX) {
    const caixa = el.escala.getBoundingClientRect();
    return clientX >= caixa.left - TOLERANCIA_ESCALA && clientX <= caixa.right + TOLERANCIA_ESCALA;
  }

  function preverNota(nota) {
    if (!nota || previaNota === nota) return;
    previaNota = nota;
    pintarEscala(nota);
    el.dificuldadeValor.textContent = `${nota} · ${NOMES_NIVEL[nota]}`;
  }

  function montarEscala() {
    el.escala.textContent = "";
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

      botao.addEventListener("mouseenter", () => preverNota(nota));
      botao.addEventListener("focus", () => preverNota(nota));
      botao.addEventListener("click", (evento) => {
        if (suprimirCliqueNota) {
          suprimirCliqueNota = false;
          evento.preventDefault();
          return;
        }
        salvarNota(nota);
      });

      el.escala.appendChild(botao);
    });

    el.escala.addEventListener("mouseleave", () => {
      previaNota = 0;
      renderizarDificuldade();
    });
    el.escala.addEventListener("focusout", () => {
      previaNota = 0;
      renderizarDificuldade();
    });

    el.escala.addEventListener("pointerdown", (evento) => {
      if (evento.button) return;
      const nota = nivelNaPosicao(evento.clientX);
      if (!nota) return;
      arrastandoNota = true;
      previaNota = nota;
      if (typeof el.escala.setPointerCapture === "function") {
        try {
          el.escala.setPointerCapture(evento.pointerId);
        } catch (erro) {
          /* alguns navegadores não permitem capturar; segue sem captura */
        }
      }
      pintarEscala(nota);
      el.dificuldadeValor.textContent = `${nota} · ${NOMES_NIVEL[nota]}`;
    });

    el.escala.addEventListener("pointermove", (evento) => {
      if (!arrastandoNota) return;
      preverNota(nivelNaPosicao(evento.clientX));
    });

    el.escala.addEventListener("pointerup", (evento) => {
      if (!arrastandoNota) return;
      arrastandoNota = false;
      const nota = nivelNaPosicao(evento.clientX);
      if (nota && dentroDaEscala(evento.clientX)) {
        suprimirCliqueNota = true;
        window.setTimeout(() => {
          suprimirCliqueNota = false;
        }, 700);
        salvarNota(nota);
      } else {
        previaNota = 0;
        renderizarDificuldade();
      }
    });

    el.escala.addEventListener("pointercancel", () => {
      arrastandoNota = false;
      previaNota = 0;
      renderizarDificuldade();
    });
  }

  function salvarNota(nota) {
    if (!atual || !avaliacoesCarregadas) return;
    const questaoId = atual.id;
    const anterior = avaliacoes[questaoId];
    avaliacoes[questaoId] = nota;
    previaNota = 0;
    renderizarDificuldade();
    montarDificuldade();
    atualizarPainel();

    fetch("/api/avaliacoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questao_id: questaoId, nota })
    })
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta.json();
      })
      .then(() => avisar(`Dificuldade salva: ${nota} · ${NOMES_NIVEL[nota]}`))
      .catch(() => {
        if (anterior === undefined) delete avaliacoes[questaoId];
        else avaliacoes[questaoId] = anterior;
        renderizarDificuldade();
        montarDificuldade();
        atualizarPainel();
        avisar("Não foi possível salvar a avaliação agora. Tente de novo.");
      });
  }

  function removerNota() {
    if (!atual || !avaliacoesCarregadas) return;
    const questaoId = atual.id;
    const anterior = avaliacoes[questaoId];
    if (anterior === undefined) return;

    delete avaliacoes[questaoId];
    renderizarDificuldade();
    montarDificuldade();
    atualizarPainel();

    fetch(`/api/avaliacoes/${encodeURIComponent(questaoId)}`, { method: "DELETE" })
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta.json();
      })
      .then(() => avisar("Avaliação removida. A questão volta para 'não avaliadas'."))
      .catch(() => {
        avaliacoes[questaoId] = anterior;
        renderizarDificuldade();
        montarDificuldade();
        atualizarPainel();
        avisar("Não foi possível remover a avaliação agora.");
      });
  }

  function atualizarLinkAnotacoes() {
    const total = Object.keys(anotacoes).length;
    el.linkAnotacoes.textContent = total ? `✎ Ver questões anotadas (${total})` : "✎ Ver questões anotadas";
    el.linkAnotacoes.href = window.AQAuth.autenticado() ? "/minhas-estatisticas#anotacoes" : "/entrar";
  }

  function renderizarAreaConta() {
    const usuario = window.AQAuth.usuario();
    if (usuario) {
      el.areaConta.innerHTML = `
        <a class="btn btn-fantasma btn-pequeno" href="/minhas-estatisticas">👤 ${esc(usuario.nome || usuario.email)}</a>
        <button type="button" class="btn btn-fantasma btn-pequeno" id="btn-sair-conta">Sair</button>`;
      el.areaConta.querySelector("#btn-sair-conta").addEventListener("click", async () => {
        await window.AQAuth.sair();
        window.location.reload();
      });
    } else {
      el.areaConta.innerHTML = '<a class="btn btn-fantasma btn-pequeno" href="/entrar">Entrar</a>';
    }
  }

  function renderizarAnotacao() {
    if (!config.bancoDisponivel) {
      el.anotacao.hidden = true;
      return;
    }
    el.anotacao.hidden = false;
    const autenticado = window.AQAuth.autenticado();
    el.anotacaoLogin.hidden = autenticado;
    if (!autenticado) {
      el.anotacaoForm.hidden = true;
      el.anotacaoExibida.hidden = true;
      el.btnAnotacao.hidden = true;
      return;
    }
    const texto = atual ? anotacoes[atual.id] || "" : "";
    const temAnotacao = Boolean(texto);
    el.anotacaoForm.hidden = !formularioAnotacaoAberto;
    el.anotacaoExibida.hidden = !temAnotacao || formularioAnotacaoAberto;
    el.btnAnotacao.hidden = temAnotacao || formularioAnotacaoAberto;
    el.anotacaoTexto.textContent = texto;
  }

  function abrirFormularioAnotacao() {
    if (!atual) return;
    formularioAnotacaoAberto = true;
    el.anotacaoCampo.value = anotacoes[atual.id] || "";
    renderizarAnotacao();
    el.anotacaoCampo.focus();
  }

  function fecharFormularioAnotacao() {
    formularioAnotacaoAberto = false;
    el.anotacaoCampo.value = "";
    renderizarAnotacao();
  }

  function salvarAnotacao() {
    if (!atual) return;
    const questaoId = atual.id;
    const texto = el.anotacaoCampo.value.trim();
    if (!texto) {
      avisar("Escreva algo para salvar a anotação.");
      return;
    }

    el.btnSalvarAnotacao.disabled = true;
    window.AQAuth.pedir("/api/anotacoes", {
      method: "POST",
      corpo: { questao_id: questaoId, texto }
    })
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta.json();
      })
      .then((dados) => {
        anotacoes[dados.questao_id] = dados.texto;
        formularioAnotacaoAberto = false;
        el.anotacaoCampo.value = "";
        renderizarAnotacao();
        atualizarLinkAnotacoes();
        avisar("Anotação salva. Você pode revê-la em 'Ver questões anotadas'.");
      })
      .catch(() => avisar("Não foi possível salvar a anotação agora. Tente de novo."))
      .finally(() => {
        el.btnSalvarAnotacao.disabled = false;
      });
  }

  function removerAnotacao() {
    if (!atual) return;
    const questaoId = atual.id;
    const anterior = anotacoes[questaoId];
    if (!anterior) return;

    delete anotacoes[questaoId];
    formularioAnotacaoAberto = false;
    renderizarAnotacao();
    atualizarLinkAnotacoes();

    window.AQAuth.pedir(`/api/anotacoes/${encodeURIComponent(questaoId)}`, { method: "DELETE" })
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta.json();
      })
      .then(() => avisar("Anotação removida."))
      .catch(() => {
        anotacoes[questaoId] = anterior;
        renderizarAnotacao();
        atualizarLinkAnotacoes();
        avisar("Não foi possível remover a anotação agora.");
      });
  }

  function fecharReporte() {
    el.reporteForm.hidden = true;
    el.btnReportar.hidden = false;
    el.reporteDescricao.value = "";
  }

  function enviarReporte() {
    if (!atual) return;
    const questaoId = atual.id;
    const descricao = el.reporteDescricao.value.trim();

    el.btnEnviarReporte.disabled = true;
    fetch("/api/reportes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questao_id: questaoId, descricao })
    })
      .then((resposta) => {
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        return resposta.json();
      })
      .then(() => {
        fecharReporte();
        avisar("Relato enviado. Obrigado por ajudar a melhorar o banco!");
      })
      .catch(() => avisar("Não foi possível enviar o relato agora. Tente de novo."))
      .finally(() => {
        el.btnEnviarReporte.disabled = false;
      });
  }

  function renderizarQuestao() {
    const questao = rodada[indice];
    if (!questao) {
      mostrarResumo();
      return;
    }

    atual = questao;
    respondida = respostasDaRodada.has(questao.id);
    formularioAnotacaoAberto = false;
    previaNota = 0;
    arrastandoNota = false;
    fecharReporte();

    el.qMeta.textContent = "";
    el.qMeta.append(
      construirChip(questao.banca, "chip-banca"),
      construirChip(questao.orgao, "chip-orgao"),
      construirChip(String(questao.ano), "chip-ano"),
      construirChip(questao.disciplina, "chip-disciplina")
    );

    el.qNota.textContent = [
      `Questão ${indice + 1} de ${rodada.length}`,
      questao.cargo,
      questao.numero ? `questão nº ${questao.numero}` : ""
    ]
      .filter(Boolean)
      .join(" · ");

    el.qEnunciado.textContent = questao.enunciado;

    el.qAlternativas.textContent = "";
    LETRAS.filter((letra) => questao.alternativas[letra]).forEach((letra) => {
      el.qAlternativas.appendChild(construirAlternativa(letra, questao.alternativas[letra]));
    });

    el.qRetorno.hidden = true;
    el.qRetorno.className = "retorno";
    el.btnAnterior.disabled = indice === 0;
    el.btnPular.hidden = respondida;
    el.btnProxima.hidden = !respondida;
    el.btnProxima.textContent = indice + 1 >= rodada.length ? "Ver resultado da rodada" : "Próxima questão →";
    if (respondida) marcarResposta(respostasDaRodada.get(questao.id));
    renderizarDificuldade();
    renderizarAnotacao();

    mostrarTela("questao");
    el.telaQuestao.classList.remove("entrar");
    void el.telaQuestao.offsetWidth;
    el.telaQuestao.classList.add("entrar");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function marcarResposta(letraEscolhida) {
    const questao = atual;
    const acerto = letraEscolhida === questao.gabarito;

    el.qAlternativas.querySelectorAll(".alternativa").forEach((botao) => {
      const letra = botao.dataset.letra;
      botao.disabled = true;
      if (letra === questao.gabarito) botao.classList.add("correta");
      if (letra === letraEscolhida) {
        botao.classList.add("escolhida");
        if (!acerto) botao.classList.add("errada");
      }
    });

    el.qRetorno.hidden = false;
    el.qRetorno.className = `retorno ${acerto ? "retorno-certo" : "retorno-errado"}`;
    el.qRetorno.textContent = acerto
      ? "Resposta correta! Mandou bem."
      : `Resposta incorreta. A alternativa correta é a letra ${questao.gabarito}.`;
  }

  function responder(letra) {
    if (respondida || !atual || !atual.alternativas[letra]) return;

    const questao = atual;
    respondida = true;
    const acertou = letra === questao.gabarito;
    respostasDaRodada.set(questao.id, letra);
    progresso[questao.id] = { escolha: letra, acerto: acertou ? 1 : 0, em: Date.now() };
    salvarProgresso();
    registrarRespostaNoServidor(questao.id, letra, acertou);

    marcarResposta(letra);
    el.btnPular.hidden = true;
    el.btnProxima.hidden = false;
    el.btnProxima.textContent = indice + 1 >= rodada.length ? "Ver resultado da rodada" : "Próxima questão →";
    el.btnProxima.focus({ preventScroll: true });
    atualizarPainel();
  }

  function avancar() {
    if (indice + 1 >= rodada.length) {
      mostrarResumo();
      return;
    }
    indice += 1;
    renderizarQuestao();
  }

  function proxima() {
    if (!respondida) return;
    avancar();
  }

  function pular() {
    if (respondida) return;
    avancar();
  }

  function voltar() {
    if (indice === 0) return;
    indice -= 1;
    renderizarQuestao();
  }

  function iniciarRodada(lista) {
    rodada = embaralhar(lista && lista.length ? lista : pool().filter((questao) => !progresso[questao.id]));
    indice = 0;
    respostasDaRodada = new Map();
    atual = null;
    respondida = false;
    atualizarPainel();

    if (!rodada.length) {
      if (pool().length === 0) {
        mostrarTela("inicio");
        return;
      }
      mostrarResumo();
      return;
    }
    renderizarQuestao();
  }

  function estatisticasDaRodada() {
    let acertos = 0;
    respostasDaRodada.forEach((letra, id) => {
      const questao = porId.get(id);
      if (questao && letra === questao.gabarito) acertos += 1;
    });
    return { respondidas: respostasDaRodada.size, acertos, erros: respostasDaRodada.size - acertos };
  }

  function mostrarResumo() {
    const { respondidas, acertos, erros } = estatisticasDaRodada();
    const aproveitamento = respondidas ? Math.round((acertos / respondidas) * 100) : 0;
    const totalSelecao = pool().length;
    const pendentes = pool().filter((questao) => !progresso[questao.id]).length;
    const erradas = pool().filter((questao) => progresso[questao.id] && !progresso[questao.id].acerto);
    const puladas = rodada.filter((questao) => !respostasDaRodada.has(questao.id));

    el.fTotal.textContent = String(rodada.length);
    el.fAcertos.textContent = String(acertos);
    el.fErros.textContent = String(erros);
    el.fAproveitamento.textContent = respondidas ? `${aproveitamento}%` : "—";

    if (pendentes === 0 && puladas.length === 0) {
      el.fimTitulo.textContent = "Você respondeu todas as questões desta seleção!";
      el.fimTexto.textContent = `Foram ${totalSelecao} questões no total. Recomece quando quiser para fixar o conteúdo de novo.`;
    } else if (modoRodada === "erradas") {
      el.fimTitulo.textContent = "Revisão concluída!";
      el.fimTexto.textContent = `Você refez as questões que errou e acertou ${acertos} de ${respondidas}. Ainda restam ${pendentes} questões novas nesta seleção.`;
    } else {
      el.fimTitulo.textContent = "Rodada concluída!";
      const restantes = pendentes > 0 ? ` Restam ${pendentes} questões novas nesta seleção.` : "";
      const deixadas = puladas.length > 0 ? ` Você pulou ${puladas.length} questão(ões) nesta rodada.` : "";
      el.fimTexto.textContent = `Você acertou ${acertos} de ${respondidas}.${deixadas}${restantes}`;
    }

    if (puladas.length) {
      el.btnContinuar.dataset.acao = "pular";
      el.btnContinuar.textContent = `Responder as que pulei (${puladas.length})`;
    } else if (pendentes > 0) {
      el.btnContinuar.dataset.acao = "novos";
      el.btnContinuar.textContent = `Continuar (${pendentes} restantes)`;
    } else {
      el.btnContinuar.dataset.acao = "zerar";
      el.btnContinuar.textContent = "Recomeçar do zero";
    }

    el.btnRefazerErradas.hidden = erradas.length === 0;
    el.btnRefazerErradas.textContent = `Refazer as que errei (${erradas.length})`;
    el.btnRecomecar.hidden = el.btnContinuar.dataset.acao === "zerar";
    mostrarTela("fim");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reiniciarSelecao() {
    pool().forEach((questao) => {
      delete progresso[questao.id];
    });
    salvarProgresso();
    atualizarPainel();
  }

  function aplicarFiltros() {
    const avisos = [];
    montarFiltros(avisos);
    atualizarPainel();

    const reiniciar = el.telaInicio.hidden === false ? false : true;
    if (reiniciar) {
      modoRodada = "novas";
      iniciarRodada();
    }
    if (avisos.length) avisar(avisos[0]);
    else if (reiniciar) avisar("Nova seleção aplicada. Rodada reiniciada.");
  }

  el.selBanca.addEventListener("change", () => {
    filtro.banca = el.selBanca.value;
    aplicarFiltros();
  });

  el.selDisciplina.addEventListener("change", () => {
    filtro.disciplina = el.selDisciplina.value;
    aplicarFiltros();
  });

  el.selProva.addEventListener("change", () => {
    filtro.prova = el.selProva.value;
    aplicarFiltros();
  });

  el.selDificuldade.addEventListener("change", () => {
    filtro.dificuldade = el.selDificuldade.value;
    aplicarFiltros();
  });

  el.btnComecar.addEventListener("click", () => {
    modoRodada = "novas";
    iniciarRodada();
  });

  el.btnProxima.addEventListener("click", proxima);
  el.btnPular.addEventListener("click", pular);
  el.btnAnterior.addEventListener("click", voltar);
  el.btnRemoverNota.addEventListener("click", removerNota);

  el.btnAnotacao.addEventListener("click", abrirFormularioAnotacao);
  el.btnEditarAnotacao.addEventListener("click", abrirFormularioAnotacao);
  el.btnRemoverAnotacao.addEventListener("click", removerAnotacao);
  el.btnCancelarAnotacao.addEventListener("click", fecharFormularioAnotacao);
  el.anotacaoForm.addEventListener("submit", (evento) => {
    evento.preventDefault();
    salvarAnotacao();
  });

  el.btnReportar.addEventListener("click", () => {
    el.btnReportar.hidden = true;
    el.reporteForm.hidden = false;
    el.reporteDescricao.focus();
  });
  el.btnCancelarReporte.addEventListener("click", fecharReporte);
  el.reporteForm.addEventListener("submit", (evento) => {
    evento.preventDefault();
    enviarReporte();
  });

  el.btnContinuar.addEventListener("click", () => {
    const acao = el.btnContinuar.dataset.acao;
    if (acao === "pular") {
      const puladas = rodada.filter((questao) => !respostasDaRodada.has(questao.id));
      modoRodada = "novas";
      iniciarRodada(puladas);
      return;
    }
    if (acao === "novos") {
      modoRodada = "novas";
      iniciarRodada();
      return;
    }
    modoRodada = "novas";
    reiniciarSelecao();
    iniciarRodada();
    avisar("Progresso desta seleção reiniciado.");
  });

  el.btnRefazerErradas.addEventListener("click", () => {
    const erradas = pool().filter((questao) => progresso[questao.id] && !progresso[questao.id].acerto);
    if (!erradas.length) {
      avisar("Nenhuma questão errada nesta seleção.");
      return;
    }
    modoRodada = "erradas";
    iniciarRodada(erradas);
  });

  el.btnRecomecar.addEventListener("click", () => {
    modoRodada = "novas";
    reiniciarSelecao();
    iniciarRodada();
    avisar("Progresso desta seleção reiniciado.");
  });

  el.btnInicio.addEventListener("click", () => {
    mostrarTela("inicio");
    atualizarPainel();
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  el.btnReiniciar.addEventListener("click", async () => {
    const autenticado = window.AQAuth.autenticado();
    const confirmar = window.confirm(
      autenticado
        ? "Apagar o histórico de respostas da sua conta? As questões voltam a aparecer do zero."
        : "Apagar todo o progresso salvo neste navegador? As questões voltam a aparecer do zero."
    );
    if (!confirmar) return;
    progresso = {};
    salvarProgresso();
    if (autenticado) {
      try {
        await window.AQAuth.pedirJson("/api/minhas/respostas", { method: "DELETE" });
      } catch (erro) {
        avisar("Não foi possível apagar o histórico agora. Tente de novo.");
        return;
      }
    }
    atualizarPainel();
    mostrarTela("inicio");
    avisar("Progresso apagado. Bom recomeço!");
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.ctrlKey || evento.metaKey || evento.altKey) return;
    if (evento.target && evento.target.closest && evento.target.closest("input, select, textarea")) return;
    if (el.telaQuestao.hidden) return;

    if (evento.key === "ArrowLeft" || evento.key === "ArrowUp") {
      evento.preventDefault();
      voltar();
      return;
    }

    if (evento.key === "ArrowRight" || evento.key === "ArrowDown") {
      evento.preventDefault();
      if (respondida) proxima();
      else pular();
      return;
    }

    if (!respondida) {
      const tecla = evento.key.toUpperCase();
      const numero = Number(evento.key);
      let letra = LETRAS.includes(tecla) ? tecla : null;
      if (!letra && Number.isInteger(numero) && numero >= 1 && numero <= LETRAS.length) {
        letra = LETRAS[numero - 1];
      }
      if (letra && atual && atual.alternativas[letra]) {
        evento.preventDefault();
        responder(letra);
      }
      return;
    }

    if (evento.key === "Enter" || evento.key === " ") {
      if (evento.target && evento.target.tagName === "BUTTON") return;
      evento.preventDefault();
      proxima();
    }
  });

  function mostrarEstadoInicio(estado) {
    el.inicioCarregando.hidden = estado !== "carregando";
    el.inicioErro.hidden = estado !== "erro";
    el.inicioPronto.hidden = estado !== "pronto";
  }

  async function buscarJson(url) {
    const resposta = await fetch(url, { headers: { Accept: "application/json" } });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    return resposta.json();
  }

  async function carregarExtras() {
    if (config.bancoDisponivel && window.AQAuth.autenticado()) {
      try {
        const dados = await window.AQAuth.pedirJson("/api/avaliacoes");
        avaliacoes = dados.avaliacoes || {};
        avaliacoesCarregadas = true;
      } catch (erro) {
        avaliacoes = {};
        avaliacoesCarregadas = false;
        avisar("As avaliações de dificuldade estão indisponíveis agora. As questões continuam funcionando.");
      }
      try {
        const dados = await window.AQAuth.pedirJson("/api/anotacoes");
        anotacoes = dados.anotacoes || {};
      } catch (erro) {
        anotacoes = {};
      }
    } else if (config.bancoDisponivel) {
      try {
        const dados = await buscarJson("/api/avaliacoes");
        avaliacoes = dados.avaliacoes || {};
        avaliacoesCarregadas = true;
      } catch (erro) {
        avaliacoes = {};
        avaliacoesCarregadas = false;
      }
      anotacoes = {};
    }
    montarFiltros();
    atualizarPainel();
    renderizarDificuldade();
    renderizarAnotacao();
    atualizarLinkAnotacoes();
    renderizarAreaConta();
  }

  async function carregarBanco() {
    mostrarEstadoInicio("carregando");
    el.painel.hidden = true;
    try {
      const resposta = await fetch(`/api/questoes?v=${config.versaoPayload}`, {
        headers: { Accept: "application/json" }
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      el.carregandoTexto.textContent = `Processando ${config.totalQuestoes} questões...`;
      banco = await resposta.json();
      if (!Array.isArray(banco) || !banco.length) throw new Error("payload vazio");
    } catch (erro) {
      el.inicioErroTexto.textContent =
        "Não conseguimos baixar o banco de questões (são cerca de 11 MB, apenas na primeira visita). Verifique sua conexão e tente novamente.";
      mostrarEstadoInicio("erro");
      return;
    }

    porId = new Map(banco.map((questao) => [questao.id, questao]));
    progresso = carregarProgresso();
    el.inicioTotal.textContent = String(banco.length);

    await window.AQAuth.iniciar();
    await sincronizarProgresso();
    renderizarAreaConta();

    montarEscala();
    montarFiltros();
    atualizarPainel();
    el.painel.hidden = false;
    mostrarEstadoInicio("pronto");
    mostrarTela("inicio");
    carregarExtras();

    const alvo = new URLSearchParams(window.location.search).get("questao");
    if (alvo && porId.has(alvo)) {
      modoRodada = "novas";
      iniciarRodada([porId.get(alvo)]);
      avisar("Revisando a questão anotada.");
    }
  }

  el.btnRecarregar.addEventListener("click", carregarBanco);

  mostrarTela("inicio");
  mostrarEstadoInicio("carregando");
  carregarBanco();
})();
