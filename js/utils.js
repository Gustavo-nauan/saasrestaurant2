/* =====================================================================
   utils.js  |  FASE 2  |  Funções utilitárias (ES module)
   Depende de: icones.js (apenas para o ícone do toast)
   ===================================================================== */

import { icone } from "./icones.js";

/**
 * Centavos -> "R$ 12,50".
 * Todo valor monetário do sistema é inteiro em centavos (evita erro de
 * ponto flutuante); só aqui ele vira texto.
 */
export function formatarMoeda(centavos) {
  const valor = (Number(centavos) || 0) / 100;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(valor)
    .replace(/\u00a0/g, " "); // o Intl usa espaço "não quebrável"; normalizamos
}

const ICONE_TOAST = { sucesso: "check", erro: "alerta", info: "sino" };

/** Container único dos toasts, criado sob demanda. */
function obterContainerToasts() {
  let container = document.querySelector(".toasts");
  if (!container) {
    container = document.createElement("div");
    container.className = "toasts";
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Mostra uma mensagem temporária.
 * tipo: "sucesso" | "erro" | "info".
 * role="status" + aria-live: leitor de tela anuncia sem roubar o foco
 * (erros usam "assertive" para serem lidos na hora).
 */
export function mostrarToast(mensagem, tipo = "info", duracaoMs = 3500) {
  if (!ICONE_TOAST[tipo]) tipo = "info";

  const toast = document.createElement("div");
  toast.className = `toast toast-${tipo}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", tipo === "erro" ? "assertive" : "polite");

  const texto = document.createElement("span");
  texto.textContent = mensagem; // textContent: nunca interpreta HTML

  toast.innerHTML = icone(ICONE_TOAST[tipo], 20);
  toast.appendChild(texto);
  obterContainerToasts().appendChild(toast);

  const remover = () => {
    toast.classList.add("toast-saindo");
    // Se animação estiver desligada (reduced-motion), animationend ainda
    // dispara por causa do 0.01ms; o timeout é só uma rede de segurança.
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 600);
  };
  setTimeout(remover, duracaoMs);

  return toast;
}

/** Adia a execução até o usuário parar de digitar por `ms` milissegundos. */
export function debounce(fn, ms = 300) {
  let temporizador;
  return function (...args) {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Escapa caracteres especiais de HTML.
 * Use SEMPRE que montar HTML com texto vindo do usuário/banco
 * (nome de cliente, observação do pedido...) para evitar XSS.
 */
export function escaparHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ISO -> "14:32" (fuso de São Paulo, independente do aparelho). */
export function formatarHora(isoString) {
  const data = new Date(isoString);
  if (Number.isNaN(data.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

/** ISO -> "agora mesmo", "há 3 min", "há 2 h", "há 4 dias". */
export function tempoDecorrido(isoString) {
  const data = new Date(isoString);
  if (Number.isNaN(data.getTime())) return "";

  const segundos = Math.max(0, Math.floor((Date.now() - data.getTime()) / 1000));
  if (segundos < 60) return "agora mesmo";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Lê um parâmetro da query string (?mesa=5 -> getParametro("mesa") === "5"). */
export function getParametro(nome) {
  return new URLSearchParams(window.location.search).get(nome);
}
