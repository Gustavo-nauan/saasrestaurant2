/* =====================================================================
   pedido.js  |  FASE 3.4  |  Acompanhamento do pedido em tempo real
   Depende de: supabase.js, auth.js, icones.js, utils.js
   Segurança: todo texto vindo do banco entra via textContent; innerHTML
   só recebe os SVGs estáticos de icones.js.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { exigirCliente } from "../js/auth.js";
import { icone } from "../js/icones.js";
import { formatarMoeda, formatarHora, tempoDecorrido, mostrarToast, getParametro } from "../js/utils.js";

const CHAVE_ULTIMO_PEDIDO = "ultimoPedido";
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITULO_PADRAO = "Acompanhe seu pedido | Pedido na Mão";
const INTERVALO_POLLING_MS = 15000;
const INTERVALO_TEMPO_MS = 30000;
const INTERVALO_PISCAR_TITULO_MS = 1200;

const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------------------------------------------------------------
   Atalhos de DOM
   --------------------------------------------------------------------- */
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function comIcone(el, nome, tamanho = 24) {
  el.innerHTML = icone(nome, tamanho); // SVG estático de icones.js
  return el;
}

const estadoEl = $("#estado");
const layoutEl = $("#pedido-layout");
const conexaoEl = $("#conexao");
const conexaoTextoEl = $("#conexao-texto");
const cartaoDestaque = $("#cartao-destaque");
const blocoSom = $("#bloco-som");
const btnSom = $("#btn-som");
const btnSomTexto = $("#btn-som-texto");
const somEstado = $("#som-estado");
const listaEtapas = $("#lista-etapas");
const avisoCancelado = $("#aviso-cancelado");
const areaCancelar = $("#area-cancelar");
const modalFundo = $("#modal-cancelar-fundo");
const modalCancelar = $("#modal-cancelar");
const modalErro = $("#modal-cancelar-erro");
const modalErroTexto = $("#modal-cancelar-erro-texto");
const btnConfirmarCancelar = $("#btn-confirmar-cancelar");

/* ---------------------------------------------------------------------
   Estado da página
   --------------------------------------------------------------------- */
let pedidoId = null;
let pedidoAtual = null;
let nomeRestaurante = "";
let transicaoProntoDisparada = false;

let canalRealtime = null;
let timerPolling = null;
let timerTempoDecorrido = null;
let timerTitulo = null;
let wakeLockSentinel = null;

let audioCtx = null;
let avisoSonoroAtivo = false;
let cancelando = false;
let elementoQueAbriuModal = null;

/* ---------------------------------------------------------------------
   Resolução do ID do pedido
   --------------------------------------------------------------------- */
function obterIdDoPedido() {
  const daUrl = (getParametro("id") || "").trim();
  if (REGEX_UUID.test(daUrl)) {
    try {
      sessionStorage.setItem(CHAVE_ULTIMO_PEDIDO, daUrl);
    } catch { /* modo privado / storage indisponível */ }
    return daUrl;
  }

  if (daUrl !== "") {
    // ?id= foi passado mas não é um UUID válido
    return null;
  }

  try {
    const salvo = (sessionStorage.getItem(CHAVE_ULTIMO_PEDIDO) || "").trim();
    if (REGEX_UUID.test(salvo)) return salvo;
  } catch { /* sem acesso ao sessionStorage */ }

  return null;
}

function destinoLoginComRetorno() {
  const idUrl = (getParametro("id") || "").trim();
  if (REGEX_UUID.test(idUrl)) {
    return `login.html?destino=${encodeURIComponent(`pedido.html?id=${idUrl}`)}`;
  }
  return "login.html?destino=pedido.html";
}

/* ---------------------------------------------------------------------
   Estados de carregamento / vazio / erro
   --------------------------------------------------------------------- */
function mostrarSkeleton() {
  layoutEl.hidden = true;
  estadoEl.replaceChildren();
  estadoEl.setAttribute("aria-busy", "true");

  const sk = criar("div", "pedido-skeleton");
  sk.append(
    criar("div", "skeleton pedido-skeleton-destaque"),
    criar("div", "skeleton pedido-skeleton-bloco"),
    criar("div", "skeleton pedido-skeleton-bloco")
  );
  estadoEl.append(sk);
}

function mostrarEstado({ icone: nomeIcone, titulo, texto, botao }) {
  layoutEl.hidden = true;
  estadoEl.removeAttribute("aria-busy");
  estadoEl.replaceChildren();

  const bloco = criar("div", "pedido-estado");
  const vazio = criar("div", "vazio");
  vazio.append(
    comIcone(criar("div", "vazio-icone"), nomeIcone, 32),
    criar("h2", "", titulo)
  );
  if (texto) vazio.append(criar("p", "", texto));
  if (botao) {
    const el = botao.href
      ? criar("a", "btn btn-primario", botao.texto)
      : criar("button", "btn btn-primario", botao.texto);
    if (botao.href) {
      el.href = botao.href;
    } else {
      el.type = "button";
      el.addEventListener("click", botao.acao);
    }
    vazio.append(el);
  }
  bloco.append(vazio);
  estadoEl.append(bloco);
}

function mostrarNaoEncontrado() {
  mostrarEstado({
    icone: "sacola",
    titulo: "Pedido não encontrado",
    texto: "Não encontramos este pedido na sua conta. Faça um novo pedido pelo cardápio.",
    botao: { texto: "Ver cardápio", href: "cardapio.html" },
  });
}

/* ---------------------------------------------------------------------
   Busca no Supabase
   --------------------------------------------------------------------- */
async function buscarPedidoCompleto(id) {
  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select(
      "id, restaurante_id, senha, status, tipo_entrega, mesa, observacao, total_centavos, criado_em, pronto_em, " +
      "itens_pedido(nome_snapshot, preco_unitario_centavos, quantidade, observacao)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!pedido) return null;

  if (!nomeRestaurante && pedido.restaurante_id) {
    const { data: rest, error: erroRest } = await supabase
      .from("restaurantes")
      .select("nome")
      .eq("id", pedido.restaurante_id)
      .maybeSingle();
    if (!erroRest && rest?.nome) {
      nomeRestaurante = rest.nome;
    }
  }

  return pedido;
}

/* ---------------------------------------------------------------------
   Textos e regras de status
   --------------------------------------------------------------------- */
const ROTULO_STATUS = {
  recebido: "Recebido",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

function obterTextosDestaque(pedido, emTransicaoPronto = false) {
  const estado = emTransicaoPronto && pedido.status === "pronto"
    ? "Seu pedido está pronto"
    : (ROTULO_STATUS[pedido.status] || pedido.status);

  let instrucao = "";
  switch (pedido.status) {
    case "recebido":
      instrucao = "Pedido recebido. A cozinha já foi avisada.";
      break;
    case "em_preparo":
      instrucao = "Estamos preparando o seu pedido.";
      break;
    case "pronto":
      if (pedido.tipo_entrega === "mesa") {
        instrucao = `Pronto! Estamos levando até a mesa ${pedido.mesa || ""}. Aguarde no seu lugar.`;
      } else {
        instrucao = `Pronto! Retire no balcão informando a senha ${pedido.senha}.`;
      }
      break;
    case "finalizado":
      instrucao = "Pedido concluído. Obrigado!";
      break;
    case "cancelado":
      instrucao = "Pedido cancelado.";
      break;
    default:
      instrucao = "";
  }

  return { estado, instrucao };
}

function statusEncerrado(status) {
  return status === "finalizado" || status === "cancelado";
}

function statusDispensaWakeLock(status) {
  return status === "pronto" || status === "finalizado" || status === "cancelado";
}

/* ---------------------------------------------------------------------
   Renderização
   --------------------------------------------------------------------- */
function atualizarTempoDecorrido() {
  if (!pedidoAtual?.criado_em) return;
  const relativo = tempoDecorrido(pedidoAtual.criado_em);
  $("#pedido-tempo").textContent = relativo ? `Pedido feito ${relativo}` : "";
}

function renderizarEtapas(pedido) {
  if (pedido.status === "cancelado") {
    listaEtapas.hidden = true;
    avisoCancelado.hidden = false;
    return;
  }

  avisoCancelado.hidden = true;
  listaEtapas.hidden = false;
  listaEtapas.replaceChildren();

  const definicoes = [
    {
      chave: "recebido",
      titulo: "Recebido",
      subtitulo: "Pedido registrado no restaurante",
      icone: "check",
      hora: pedido.criado_em ? formatarHora(pedido.criado_em) : "",
    },
    {
      chave: "em_preparo",
      titulo: "Em preparo",
      subtitulo: "Seu pedido está sendo preparado",
      icone: "relogio",
      hora: "",
    },
    {
      chave: "pronto",
      titulo: "Pronto",
      subtitulo: pedido.tipo_entrega === "mesa" ? "A caminho da sua mesa" : "Pronto para retirar no balcão",
      icone: "sino",
      hora: pedido.pronto_em ? formatarHora(pedido.pronto_em) : "",
    },
  ];

  // Ordem de progresso: recebido (0), em_preparo (1), pronto (2), finalizado (3 - todas concluídas)
  const indicePorStatus = { recebido: 0, em_preparo: 1, pronto: 2, finalizado: 3 };
  const indiceAtual = indicePorStatus[pedido.status] ?? 0;

  definicoes.forEach((def, idx) => {
    const li = criar("li", "etapa");
    const concluida = idx < indiceAtual || pedido.status === "finalizado";
    const atual = idx === indiceAtual && pedido.status !== "finalizado";

    if (concluida) {
      li.classList.add("etapa-concluida");
    } else if (atual) {
      li.classList.add("etapa-atual");
      li.setAttribute("aria-current", "step");
    } else {
      li.classList.add("etapa-futura");
    }

    const iconeCaixa = criar("span", "etapa-icone");
    comIcone(iconeCaixa, concluida ? "check" : def.icone, 20);

    const corpo = criar("div", "etapa-corpo");
    corpo.append(
      criar("p", "etapa-titulo", def.titulo),
      criar("p", "etapa-subtitulo", def.subtitulo)
    );

    const hora = criar("time", "etapa-hora", def.hora);
    li.append(iconeCaixa, corpo, hora);
    listaEtapas.append(li);
  });
}

function renderizarResumo(pedido) {
  const entregaEl = $("#resumo-entrega");
  entregaEl.replaceChildren();
  const ehMesa = pedido.tipo_entrega === "mesa";
  entregaEl.append(
    comIcone(criar("span"), ehMesa ? "mesa" : "sacola", 16),
    criar("span", "", ehMesa ? `Mesa ${pedido.mesa}` : "Retirada no balcão")
  );

  const ul = $("#resumo-itens");
  ul.replaceChildren();
  const itens = Array.isArray(pedido.itens_pedido) ? pedido.itens_pedido : [];

  itens.forEach((item) => {
    const li = criar("li", "resumo-item");
    const esq = criar("div", "resumo-item-esq");
    const qtd = criar("span", "resumo-item-qtd", `${item.quantidade}x`);
    const textos = criar("div", "resumo-item-textos");
    textos.append(criar("p", "resumo-item-nome", item.nome_snapshot));
    if (item.observacao) {
      textos.append(criar("p", "resumo-item-obs", `Obs.: ${item.observacao}`));
    }
    esq.append(qtd, textos);

    const subtotal = (Number(item.preco_unitario_centavos) || 0) * (Number(item.quantidade) || 0);
    const dir = criar("span", "resumo-item-subtotal", formatarMoeda(subtotal));
    li.append(esq, dir);
    ul.append(li);
  });

  const blocoObs = $("#bloco-obs-geral");
  if (pedido.observacao) {
    $("#resumo-obs-texto").textContent = pedido.observacao;
    blocoObs.hidden = false;
  } else {
    $("#resumo-obs-texto").textContent = "";
    blocoObs.hidden = true;
  }

  $("#resumo-total").textContent = formatarMoeda(pedido.total_centavos);
}

function renderizarPedido(pedido, { animarPronto = false } = {}) {
  estadoEl.replaceChildren();
  estadoEl.removeAttribute("aria-busy");
  layoutEl.hidden = false;

  $("#restaurante-nome").textContent = nomeRestaurante;
  atualizarTempoDecorrido();

  cartaoDestaque.dataset.status = pedido.status;
  $("#destaque-senha").textContent = String(pedido.senha);

  const { estado, instrucao } = obterTextosDestaque(pedido, animarPronto || transicaoProntoDisparada);
  $("#destaque-estado").textContent = estado;
  $("#destaque-instrucao").textContent = instrucao;
  $("#destaque-acao").hidden = pedido.status !== "cancelado";

  if (animarPronto && !reduzirMovimento) {
    cartaoDestaque.classList.remove("pedido-destaque-pronto-animar");
    void cartaoDestaque.offsetWidth;
    cartaoDestaque.classList.add("pedido-destaque-pronto-animar");
  }

  // Botão de aviso sonoro: visível apenas enquanto o pedido ainda não ficou pronto/finalizado/cancelado
  const aguardaPreparo = pedido.status === "recebido" || pedido.status === "em_preparo";
  blocoSom.hidden = !aguardaPreparo;

  // Botão de cancelar: SOMENTE enquanto status = recebido
  const podeCancelar = pedido.status === "recebido";
  areaCancelar.hidden = !podeCancelar;
  if (!podeCancelar && modalFundo.classList.contains("aberto")) {
    fecharModalCancelar();
  }

  renderizarEtapas(pedido);
  renderizarResumo(pedido);
}

/* ---------------------------------------------------------------------
   Web Audio API + Vibração + Alerta de título + Wake Lock
   --------------------------------------------------------------------- */
function atualizarBotaoSom() {
  btnSom.setAttribute("aria-pressed", String(avisoSonoroAtivo));
  btnSomTexto.textContent = avisoSonoroAtivo
    ? "Aviso sonoro e vibração ativados"
    : "Ativar aviso sonoro e vibração";
  somEstado.textContent = avisoSonoroAtivo
    ? "Aviso ativado: você ouvirá um toque quando o pedido ficar pronto."
    : "Aviso sonoro desativado. Toque para ativar.";
}

function destravarAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

function tocarBipePronto() {
  if (!avisoSonoroAtivo) return;
  try {
    if (!destravarAudio() || !audioCtx) return;
    const agora = audioCtx.currentTime;

    // Dois tons curtos e agradáveis (Mi5 -> Sol5 -> Dó6)
    const notas = [
      { freq: 659.25, inicio: 0, duracao: 0.14 },
      { freq: 783.99, inicio: 0.16, duracao: 0.14 },
      { freq: 1046.50, inicio: 0.32, duracao: 0.28 },
    ];

    notas.forEach(({ freq, inicio, duracao }) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, agora + inicio);

      gain.gain.setValueAtTime(0.0001, agora + inicio);
      gain.gain.exponentialRampToValueAtTime(0.22, agora + inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, agora + inicio + duracao);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(agora + inicio);
      osc.stop(agora + inicio + duracao + 0.02);
    });
  } catch {
    /* ignorar falhas de áudio silenciosamente */
  }
}

function vibrarPronto() {
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate([180, 90, 220]);
    }
  } catch {
    /* ignorar quando não suportado */
  }
}

btnSom.addEventListener("click", () => {
  avisoSonoroAtivo = !avisoSonoroAtivo;
  if (avisoSonoroAtivo) {
    destravarAudio();
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate(40);
    } catch { /* ignorado */ }
    tocarBipePronto();
  }
  atualizarBotaoSom();
});

function iniciarAlertaTitulo(senha) {
  pararAlertaTitulo();
  if (document.visibilityState !== "hidden") return;

  const msgPronto = `Pedido pronto - Senha ${senha}`;
  let mostrarPronto = true;
  document.title = msgPronto;

  timerTitulo = setInterval(() => {
    if (document.visibilityState !== "hidden") {
      pararAlertaTitulo();
      return;
    }
    mostrarPronto = !mostrarPronto;
    document.title = mostrarPronto ? msgPronto : TITULO_PADRAO;
  }, INTERVALO_PISCAR_TITULO_MS);
}

function pararAlertaTitulo() {
  if (timerTitulo) {
    clearInterval(timerTitulo);
    timerTitulo = null;
  }
  document.title = TITULO_PADRAO;
}

async function solicitarWakeLock() {
  if (!pedidoAtual || statusDispensaWakeLock(pedidoAtual.status)) return;
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  if (wakeLockSentinel && !wakeLockSentinel.released) return;

  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
  } catch {
    /* falha silenciosa */
  }
}

async function liberarWakeLock() {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch {
    /* falha silenciosa */
  } finally {
    wakeLockSentinel = null;
  }
}

/** Chamado apenas quando observamos transição de outro status -> pronto. */
function dispararTransicaoPronto(pedido) {
  transicaoProntoDisparada = true;
  renderizarPedido(pedido, { animarPronto: true });
  tocarBipePronto();
  vibrarPronto();
  iniciarAlertaTitulo(pedido.senha);
  liberarWakeLock();
}

/* ---------------------------------------------------------------------
   Atualização de estado do pedido (Realtime + Polling)
   --------------------------------------------------------------------- */
async function aplicarAtualizacao(novosDados) {
  if (!pedidoAtual) return;

  const statusAnterior = pedidoAtual.status;
  const mudouParaPronto =
    statusAnterior &&
    statusAnterior !== "pronto" &&
    novosDados.status === "pronto";

  // Se o evento vier sem pronto_em ao entrar em pronto, refazemos a busca completa
  if (novosDados.status === "pronto" && !novosDados.pronto_em) {
    try {
      const completo = await buscarPedidoCompleto(pedidoId);
      if (completo) novosDados = completo;
    } catch { /* segue com o que veio */ }
  }

  pedidoAtual = {
    ...pedidoAtual,
    ...novosDados,
    itens_pedido: novosDados.itens_pedido ?? pedidoAtual.itens_pedido,
  };

  if (mudouParaPronto) {
    dispararTransicaoPronto(pedidoAtual);
  } else {
    renderizarPedido(pedidoAtual);
  }

  if (statusDispensaWakeLock(pedidoAtual.status)) {
    liberarWakeLock();
  }
  if (statusEncerrado(pedidoAtual.status)) {
    pararPolling();
  }
}

async function rebuscarSilencioso() {
  if (!pedidoId || !pedidoAtual || statusEncerrado(pedidoAtual.status)) return;
  try {
    const fresco = await buscarPedidoCompleto(pedidoId);
    if (fresco) await aplicarAtualizacao(fresco);
  } catch {
    /* rede de segurança: ignora erro silenciosamente */
  }
}

/* ---------------------------------------------------------------------
   Indicador de conexão e canal Realtime
   --------------------------------------------------------------------- */
function definirEstadoConexao(online) {
  if (online) {
    conexaoEl.dataset.estado = "online";
    conexaoTextoEl.textContent = "Atualizando em tempo real";
  } else {
    conexaoEl.dataset.estado = "offline";
    conexaoTextoEl.textContent = "Sem conexão. Tentando reconectar...";
  }
}

function assinarRealtime(id) {
  encerrarRealtime();

  canalRealtime = supabase
    .channel(`pedido-${id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "pedidos",
        filter: `id=eq.${id}`,
      },
      (payload) => {
        if (payload?.new && payload.new.status) {
          aplicarAtualizacao(payload.new);
        } else {
          rebuscarSilencioso();
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        definirEstadoConexao(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        definirEstadoConexao(false);
      }
    });
}

function encerrarRealtime() {
  if (!canalRealtime) return;
  try {
    supabase.removeChannel(canalRealtime);
  } catch { /* ignorado */ }
  canalRealtime = null;
}

function iniciarPolling() {
  pararPolling();
  timerPolling = setInterval(() => {
    if (!pedidoAtual || statusEncerrado(pedidoAtual.status)) {
      pararPolling();
      return;
    }
    rebuscarSilencioso();
  }, INTERVALO_POLLING_MS);
}

function pararPolling() {
  if (timerPolling) {
    clearInterval(timerPolling);
    timerPolling = null;
  }
}

/* ---------------------------------------------------------------------
   Cancelamento do pedido (modal com foco preso + RPC cancelar_pedido)
   --------------------------------------------------------------------- */
function abrirModalCancelar() {
  if (!pedidoAtual || pedidoAtual.status !== "recebido") return;
  elementoQueAbriuModal = document.activeElement;
  modalErro.hidden = true;
  modalErroTexto.textContent = "";
  modalFundo.classList.add("aberto");
  document.body.classList.add("modal-aberto");
  $("#btn-voltar-modal").focus({ preventScroll: true });
}

function fecharModalCancelar() {
  if (!modalFundo.classList.contains("aberto")) return;
  modalFundo.classList.remove("aberto");
  document.body.classList.remove("modal-aberto");
  if (elementoQueAbriuModal && document.contains(elementoQueAbriuModal)) {
    elementoQueAbriuModal.focus({ preventScroll: true });
  }
  elementoQueAbriuModal = null;
}

function traduzirErroCancelamento(erro) {
  const texto = String(erro?.message ?? "").trim();
  if (/failed to fetch|network|fetch/i.test(texto)) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  }
  if ((erro?.code === "P0001" || erro?.code === "28000" || texto.includes("não pode mais ser cancelado")) && texto) {
    return texto
      .replace("(status atual: em_preparo)", "(o pedido já começou a ser preparado)")
      .replace("(status atual: pronto)", "(o pedido já está pronto)")
      .replace("(status atual: finalizado)", "(o pedido já foi concluído)")
      .replace("(status atual: cancelado)", "(o pedido já foi cancelado)");
  }
  return "Não foi possível cancelar o pedido agora. Tente novamente.";
}

async function confirmarCancelamento() {
  if (cancelando || !pedidoId) return;
  cancelando = true;
  modalErro.hidden = true;
  btnConfirmarCancelar.disabled = true;
  btnConfirmarCancelar.classList.add("btn-carregando");
  btnConfirmarCancelar.setAttribute("aria-busy", "true");

  try {
    const { error } = await supabase.rpc("cancelar_pedido", { p_pedido_id: pedidoId });
    if (error) throw error;

    fecharModalCancelar();
    mostrarToast("Pedido cancelado.", "info");
    await aplicarAtualizacao({ status: "cancelado" });
  } catch (erro) {
    console.error("[pedido] falha ao cancelar", erro);
    const msg = traduzirErroCancelamento(erro);
    modalErroTexto.textContent = msg;
    modalErro.hidden = false;
    mostrarToast(msg, "erro");
    await rebuscarSilencioso();
  } finally {
    cancelando = false;
    btnConfirmarCancelar.disabled = false;
    btnConfirmarCancelar.classList.remove("btn-carregando");
    btnConfirmarCancelar.setAttribute("aria-busy", "false");
  }
}

$("#btn-abrir-cancelar").addEventListener("click", abrirModalCancelar);
$("#btn-fechar-modal").addEventListener("click", fecharModalCancelar);
$("#btn-voltar-modal").addEventListener("click", fecharModalCancelar);
modalFundo.addEventListener("click", (e) => {
  if (e.target === modalFundo && !cancelando) fecharModalCancelar();
});
btnConfirmarCancelar.addEventListener("click", confirmarCancelamento);

document.addEventListener("keydown", (e) => {
  if (!modalFundo.classList.contains("aberto")) return;

  if (e.key === "Escape") {
    if (!cancelando) {
      e.preventDefault();
      fecharModalCancelar();
    }
    return;
  }

  if (e.key !== "Tab") return;
  const focaveis = $$("button:not(:disabled), [href]", modalCancelar)
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (focaveis.length === 0) return;

  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];

  if (e.shiftKey && (document.activeElement === primeiro || !modalCancelar.contains(document.activeElement))) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (document.activeElement === ultimo || !modalCancelar.contains(document.activeElement))) {
    e.preventDefault();
    primeiro.focus();
  }
});

/* ---------------------------------------------------------------------
   Eventos de visibilidade, rede e saída da página
   --------------------------------------------------------------------- */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    pararAlertaTitulo();
    rebuscarSilencioso();
    solicitarWakeLock();
  }
});

window.addEventListener("online", () => {
  rebuscarSilencioso();
  if (pedidoId && pedidoAtual && !statusEncerrado(pedidoAtual.status)) {
    assinarRealtime(pedidoId);
  }
});

window.addEventListener("offline", () => {
  definirEstadoConexao(false);
});

function limparRecursos() {
  encerrarRealtime();
  pararPolling();
  pararAlertaTitulo();
  if (timerTempoDecorrido) {
    clearInterval(timerTempoDecorrido);
    timerTempoDecorrido = null;
  }
  liberarWakeLock();
}

window.addEventListener("pagehide", limparRecursos);
window.addEventListener("beforeunload", limparRecursos);

/* ---------------------------------------------------------------------
   Carregamento inicial
   --------------------------------------------------------------------- */
async function carregarPedido() {
  mostrarSkeleton();
  try {
    const pedido = await buscarPedidoCompleto(pedidoId);
    if (!pedido) {
      mostrarNaoEncontrado();
      return;
    }

    pedidoAtual = pedido;
    transicaoProntoDisparada = false;
    renderizarPedido(pedido, { animarPronto: false });

    if (!timerTempoDecorrido) {
      timerTempoDecorrido = setInterval(atualizarTempoDecorrido, INTERVALO_TEMPO_MS);
    }

    if (!statusEncerrado(pedido.status)) {
      assinarRealtime(pedidoId);
      iniciarPolling();
    } else {
      conexaoEl.dataset.estado = "online";
      conexaoTextoEl.textContent = "Pedido encerrado";
    }

    if (!statusDispensaWakeLock(pedido.status)) {
      solicitarWakeLock();
    }
  } catch (erro) {
    console.error("[pedido]", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar o seu pedido",
      texto: "Verifique sua internet e tente de novo.",
      botao: { texto: "Tentar de novo", acao: carregarPedido },
    });
  }
}

async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
  });

  atualizarBotaoSom();

  const sessao = await exigirCliente(destinoLoginComRetorno());
  if (!sessao) return;

  pedidoId = obterIdDoPedido();
  if (!pedidoId) {
    mostrarNaoEncontrado();
    return;
  }

  await carregarPedido();
}

iniciar().catch((erro) => {
  console.error("[pedido]", erro);
  mostrarEstado({
    icone: "alerta",
    titulo: "Não foi possível carregar o seu pedido",
    texto: "Verifique sua internet e tente de novo.",
    botao: { texto: "Tentar de novo", acao: () => window.location.reload() },
  });
});

