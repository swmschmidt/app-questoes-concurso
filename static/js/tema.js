/* Tema claro/escuro compartilhado por todas as páginas (roda antes da renderização). */
(() => {
  "use strict";

  const CHAVE = "aq-asb:tema:v1";

  function ler() {
    try {
      return window.localStorage.getItem(CHAVE) || "auto";
    } catch (erro) {
      return "auto";
    }
  }

  function aplicar(tema) {
    const prefereEscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const escuro = tema === "escuro" || (tema === "auto" && prefereEscuro);
    document.documentElement.dataset.tema = escuro ? "escuro" : "claro";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", escuro ? "#080d16" : "#eef2f8");
  }

  aplicar(ler());

  window.AQTema = {
    aplicar,
    atual: ler,
    alternar() {
      const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
      try {
        window.localStorage.setItem(CHAVE, novo);
      } catch (erro) {
        /* modo privado */
      }
      aplicar(novo);
      return novo;
    },
    ligarBotao(botao) {
      if (!botao) return;
      botao.addEventListener("click", () => window.AQTema.alternar());
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.AQTema.ligarBotao(document.getElementById("btn-tema"));
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (ler() === "auto") aplicar("auto");
  });
})();
