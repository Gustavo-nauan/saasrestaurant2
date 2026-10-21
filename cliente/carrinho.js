/* =====================================================================
   carrinho.js (página)  |  FASE 3.3  |  Revisão e confirmação do pedido
   Depende de: supabase.js, auth.js, ../js/carrinho.js, icones.js, utils.js
   Segurança: textos do banco/usuário entram via textContent; innerHTML só
   recebe SVGs estáticos. NUNCA enviamos preços ao servidor: criar_pedido
   recalcula tudo a partir da tabela produtos.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { exigirCliente } from "../js/auth.js";
import {
  obter, alterarQuantidade, alterarObservacao, atualizarPrecoExibicao, remover, limpar,
  totalCentavos, quantidadeTotal, obterContexto, salvarContexto,
} from "../js/carrinho.js";
import { icone } from "../js/icones.js";
import { formatarMoeda, mostrarToast } from "../js/utils.js";

const QTD_MAX = 20;
const OBS_ITEM_MAX = 140;
const OBS_GERAL_MAX = 200;
const MESA_MAX = 10;
const REGEX_MESA = /^[A-Za-z0-9-]{1,10}$/;

/* ---------------------------------------------------------------------
   DOM
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
  el.innerHTML = icone(nome, tamanho); // SVG estático
  return el;
}

const form = $("#form-pedido");
const estado = $("#estado");
const avisos = $("#avisos");
const lista = $("#lista");
const rodape = $("#rodape");
const campoMesa = $("#campo-mesa");
const inputMesa = $("#mesa");
const obsGeral = $("#obs-geral");

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
let restaurante = null;
let enviando = false;       // trava contra envio duplicado
let redirecionando = false; // ignora eventos do carrinho depois do sucesso
let silencioso = false;     // ignora eventos durante a revalidação inicial
const editandoObs = new Set();      // produtos com o editor de observação aberto
const rascunhosObs = new Map();     // texto ainda não salvo de cada editor

/* ---------------------------------------------------------------------
   Avisos e estados de tela
   --------------------------------------------------------------------- */
function adicionarAviso(mensagem, tipo = "info") {
  const aviso = criar("div", `aviso${tipo === "erro" ? " aviso-erro" : ""}`);
  const ic = criar("span", "aviso-icone");
  comIcone(ic, "alerta", 20);
  aviso.append(ic, criar("span", "aviso-texto", mensagem));
  avisos.append(aviso);
  return aviso;
}

function limparAvisos(somenteErros = false) {
  if (!somenteErros) return avisos.replaceChildren();
  $$(".aviso-erro", avisos).forEach((a) => a.remove());
}

function mostrarCarregando() {
  form.hidden = true;
  rodape.hidden = true;
  document.body.classList.remove("tem-barra");
  estado.replaceChildren();
  const bloco = criar("div", "carrinho-skeleton");
  estado.setAttribute("aria-busy", "true");
  for (let i = 0; i < 3; i += 1) bloco.append(criar("div", "skeleton skeleton-bloco"));
  estado.append(bloco);
}

function mostrarEstado({ icone: nomeIcone, titulo, texto, botao }) {
  form.hidden = true;
  rodape.hidden = true;
  document.body.classList.remove("tem-barra");
  estado.removeAttribute("aria-busy");
  estado.replaceChildren();

  const bloco = criar("div", "carrinho-estado");
  const vazio = criar("div", "vazio");
  vazio.append(comIcone(criar("div", "vazio-icone"), nomeIcone, 32), criar("h2", "", titulo));
  if (texto) vazio.append(criar("p", "", texto));
  if (botao) {
    const el = botao.href ? criar("a", "btn btn-primario", botao.texto) : criar("button", "btn btn-primario", botao.texto);
    if (botao.href) el.href = botao.href;
    else { el.type = "button"; el.addEventListener("click", botao.acao); }
    vazio.append(el);
  }
  bloco.append(vazio);
  estado.append(bloco);
}

function mostrarCarrinhoVazio() {
  mostrarEstado({
    icone: "carrinho",
    titulo: "Seu carrinho está vazio",
    texto: "Escolha algo gostoso no cardápio para começar o seu pedido.",
    botao: { texto: "Ver cardápio", href: "cardapio.html" },
  });
}

/* ---------------------------------------------------------------------
   Dados do banco
   --------------------------------------------------------------------- */
async function buscarRestaurante(slug) {
  let consulta = supabase.from("restaurantes").select("id, nome, slug").eq("ativo", true);
  consulta = slug
    ? consulta.eq("slug", slug)
    : consulta.order("criado_em", { ascending: true }).limit(1);
  const { data, error } = await consulta.maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Confere o carrinho com o banco: remove itens que sumiram ou ficaram
 * indisponíveis e corrige preços. Devolve a lista de mensagens (pode ser vazia).
 */
async function revalidarCarrinho() {
  const itens = obter(restaurante.id);
  if (itens.length === 0) return [];

  const { data, error } = await supabase
    .from("produtos")
    .select("id, nome, preco_centavos, disponivel, imagem_url")
    .eq("restaurante_id", restaurante.id)
    .in("id", itens.map((i) => i.produtoId));
  if (error) throw error;

  const atuais = new Map((data ?? []).map((p) => [p.id, p]));
  const mensagens = [];

  itens.forEach((item) => {
    const produto = atuais.get(item.produtoId);
    if (!produto || produto.disponivel === false) {
      remover(restaurante.id, item.produtoId);
      mensagens.push(`O item "${item.nome}" não está mais disponível e foi removido.`);
    } else if (produto.preco_centavos !== item.precoCentavos) {
      atualizarPrecoExibicao(restaurante.id, item.produtoId, produto.preco_centavos);
      mensagens.push(
        `O preço de "${item.nome}" foi atualizado para ${formatarMoeda(produto.preco_centavos)}.`
      );
    }
  });
  return mensagens;
}

/* ---------------------------------------------------------------------
   Renderização
   --------------------------------------------------------------------- */
function urlImagemSegura(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function criarMiniatura(item) {
  const caixa = criar("div", "item-miniatura");
  const semImagem = () => {
    caixa.replaceChildren();
    caixa.classList.add("sem-imagem");
    caixa.append(comIcone(criar("span"), "sacola", 28));
  };
  const urlSegura = urlImagemSegura(item.imagemUrl);
  if (urlSegura) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", semImagem, { once: true });
    img.src = urlSegura;
    caixa.append(img);
  } else {
    semImagem();
  }
  return caixa;
}

function criarItem(item) {
  const id = item.produtoId;
  const artigo = criar("article", "item");
  artigo.dataset.produto = id;

  /* Topo: miniatura + textos */
  const info = criar("div", "item-info");
  const nome = criar("h3", "item-nome", item.nome);
  info.append(nome, criar("p", "item-preco", formatarMoeda(item.precoCentavos)));
  if (item.observacao && !editandoObs.has(id)) {
    info.append(criar("p", "item-obs", `Obs.: ${item.observacao}`));
  }
  if (!editandoObs.has(id)) {
    const link = criar("button", "item-link", item.observacao ? "Editar observação" : "Adicionar observação");
    link.type = "button";
    link.dataset.acao = "editar-obs";
    link.dataset.foco = `${id}:editar-obs`;
    info.append(link);
  }
  const topo = criar("div", "item-topo");
  topo.append(criarMiniatura(item), info);
  artigo.append(topo);

  /* Editor inline de observação */
  if (editandoObs.has(id)) {
    const editor = criar("div", "item-editor");
    const campo = criar("div", "campo");
    const rotulo = criar("label", "", `Observação de ${item.nome}`);
    rotulo.htmlFor = `obs-${id}`;
    const area = document.createElement("textarea");
    area.id = `obs-${id}`;
    area.rows = 2;
    area.maxLength = OBS_ITEM_MAX;
    area.placeholder = "ex.: sem cebola";
    area.value = rascunhosObs.has(id) ? rascunhosObs.get(id) : item.observacao;
    area.dataset.foco = `${id}:campo-obs`;
    area.setAttribute("aria-describedby", `obs-${id}-contador`);
    const contador = criar("p", "campo-ajuda carrinho-contador", `${area.value.length}/${OBS_ITEM_MAX}`);
    contador.id = `obs-${id}-contador`;
    campo.append(rotulo, area, contador);

    const acoes = criar("div", "item-editor-acoes");
    const salvarBtn = criar("button", "btn btn-secundario", "Salvar");
    salvarBtn.type = "button";
    salvarBtn.dataset.acao = "salvar-obs";
    const cancelarBtn = criar("button", "btn btn-fantasma", "Cancelar");
    cancelarBtn.type = "button";
    cancelarBtn.dataset.acao = "cancelar-obs";
    acoes.append(salvarBtn, cancelarBtn);

    editor.append(campo, acoes);
    artigo.append(editor);
  }

  /* Rodapé: seletor, remover, subtotal */
  const seletor = criar("div", "seletor");
  seletor.setAttribute("role", "group");
  seletor.setAttribute("aria-label", `Quantidade de ${item.nome}`);

  const menos = criar("button");
  menos.type = "button";
  menos.dataset.acao = "menos";
  menos.dataset.foco = `${id}:menos`;
  menos.disabled = item.quantidade <= 1;
  menos.setAttribute("aria-label", `Diminuir quantidade de ${item.nome}`);
  comIcone(menos, "menos", 20);

  const valor = criar("span", "seletor-qtd", String(item.quantidade));
  valor.setAttribute("aria-live", "polite");

  const mais = criar("button", "seletor-mais");
  mais.type = "button";
  mais.dataset.acao = "mais";
  mais.dataset.foco = `${id}:mais`;
  mais.disabled = item.quantidade >= QTD_MAX;
  mais.setAttribute("aria-label", `Aumentar quantidade de ${item.nome}`);
  comIcone(mais, "mais", 20);
  seletor.append(menos, valor, mais);

  const lixeira = criar("button", "btn btn-fantasma btn-icone item-remover");
  lixeira.type = "button";
  lixeira.dataset.acao = "remover";
  lixeira.setAttribute("aria-label", `Remover ${item.nome}`);
  comIcone(lixeira, "lixeira", 22);

  const subtotal = criar("span", "item-subtotal", formatarMoeda(item.precoCentavos * item.quantidade));
  const rodapeItem = criar("div", "item-rodape");
  rodapeItem.append(seletor, lixeira, subtotal);
  artigo.append(rodapeItem);

  return artigo;
}

/** Redesenha tudo a partir do localStorage, preservando o foco do teclado. */
function renderizar() {
  const itens = obter(restaurante.id);
  if (itens.length === 0) {
    mostrarCarrinhoVazio();
    return;
  }

  const focoAnterior = document.activeElement?.dataset?.foco || null;

  estado.replaceChildren();
  estado.removeAttribute("aria-busy");
  form.hidden = false;
  lista.replaceChildren(...itens.map(criarItem));

  const total = formatarMoeda(totalCentavos(restaurante.id));
  $("#resumo-subtotal").textContent = total;
  $("#resumo-total").textContent = total;
  $("#rodape-total").textContent = total;
  rodape.hidden = false;
  document.body.classList.add("tem-barra");

  if (focoAnterior) {
    const alvo = lista.querySelector(`[data-foco="${CSS.escape(focoAnterior)}"]`);
    if (alvo && !alvo.disabled) alvo.focus({ preventScroll: true });
    else if (focoAnterior.endsWith(":menos") || focoAnterior.endsWith(":mais")) {
      const [id] = focoAnterior.split(":");
      lista.querySelector(`[data-foco^="${CSS.escape(id)}:"]:not(:disabled)`)?.focus({ preventScroll: true });
    }
  }
}

/* ---------------------------------------------------------------------
   Eventos da lista (delegação)
   --------------------------------------------------------------------- */
lista.addEventListener("click", (e) => {
  const botao = e.target.closest("[data-acao]");
  const artigo = e.target.closest(".item[data-produto]");
  if (!botao || !artigo || enviando) return;

  const id = artigo.dataset.produto;
  const item = obter(restaurante.id).find((i) => i.produtoId === id);
  if (!item) return;

  switch (botao.dataset.acao) {
    case "mais":
      alterarQuantidade(restaurante.id, id, item.quantidade + 1);
      break;
    case "menos":
      if (item.quantidade > 1) alterarQuantidade(restaurante.id, id, item.quantidade - 1);
      break;
    case "remover":
      remover(restaurante.id, id);
      editandoObs.delete(id);
      rascunhosObs.delete(id);
      mostrarToast(`"${item.nome}" foi removido do pedido.`, "info", 2200);
      $("#titulo-itens").focus({ preventScroll: true }); // foco não se perde
      break;
    case "editar-obs":
      editandoObs.add(id);
      renderizar();
      $(`#obs-${CSS.escape(id)}`, lista)?.focus({ preventScroll: true });
      break;
    case "salvar-obs": {
      const texto = $(`#obs-${CSS.escape(id)}`, lista)?.value ?? "";
      editandoObs.delete(id);
      rascunhosObs.delete(id);
      alterarObservacao(restaurante.id, id, texto);
      lista.querySelector(`[data-foco="${CSS.escape(id)}:editar-obs"]`)?.focus({ preventScroll: true });
      break;
    }
    case "cancelar-obs":
      editandoObs.delete(id);
      rascunhosObs.delete(id);
      renderizar();
      lista.querySelector(`[data-foco="${CSS.escape(id)}:editar-obs"]`)?.focus({ preventScroll: true });
      break;
    default:
  }
});

lista.addEventListener("input", (e) => {
  const area = e.target.closest("textarea");
  if (!area) return;
  const id = area.closest(".item").dataset.produto;
  rascunhosObs.set(id, area.value);
  $(`#obs-${CSS.escape(id)}-contador`, lista).textContent = `${area.value.length}/${OBS_ITEM_MAX}`;
});

window.addEventListener("carrinho:mudou", () => {
  if (!restaurante || redirecionando || silencioso) return;
  renderizar();
});
// Outra aba mexeu no carrinho: mantém a tela em sincronia.
window.addEventListener("storage", () => {
  if (!restaurante || redirecionando || silencioso) return;
  renderizar();
});

/* ---------------------------------------------------------------------
   Como receber / mesa / observação geral
   --------------------------------------------------------------------- */
function tipoSelecionado() {
  return $('input[name="tipo"]:checked', form)?.value ?? "retirada_balcao";
}

function atualizarCampoMesa() {
  campoMesa.hidden = tipoSelecionado() !== "mesa";
}

function mostrarErroMesa(mensagem) {
  const bloco = campoMesa;
  const texto = $(".msg-texto", $("#mesa-erro"));
  if (mensagem) {
    bloco.classList.add("campo-erro");
    inputMesa.setAttribute("aria-invalid", "true");
    texto.textContent = mensagem;
  } else {
    bloco.classList.remove("campo-erro");
    inputMesa.removeAttribute("aria-invalid");
    texto.textContent = "";
  }
}

function validarMesa() {
  if (tipoSelecionado() !== "mesa") return true;
  const valor = inputMesa.value.trim();
  if (valor === "") {
    mostrarErroMesa("Informe o número da mesa.");
    return false;
  }
  if (!REGEX_MESA.test(valor)) {
    mostrarErroMesa("Use apenas letras, números e hífen, até 10 caracteres.");
    return false;
  }
  mostrarErroMesa("");
  return true;
}

$$('input[name="tipo"]', form).forEach((r) =>
  r.addEventListener("change", () => {
    atualizarCampoMesa();
    mostrarErroMesa("");
    if (tipoSelecionado() === "mesa") inputMesa.focus({ preventScroll: true });
  })
);

inputMesa.addEventListener("input", () => {
  // Só letras, números e hífen, até 10 caracteres.
  const limpo = inputMesa.value.replace(/[^A-Za-z0-9-]/g, "").slice(0, MESA_MAX);
  if (limpo !== inputMesa.value) inputMesa.value = limpo;
  if (campoMesa.classList.contains("campo-erro")) validarMesa();
});

obsGeral.addEventListener("input", () => {
  $("#obs-geral-contador").textContent = `${obsGeral.value.length}/${OBS_GERAL_MAX}`;
});

/* ---------------------------------------------------------------------
   Confirmação do pedido
   --------------------------------------------------------------------- */
function travarFormulario(ligado) {
  $$("[data-confirmar]").forEach((b) => {
    b.disabled = ligado;
    b.classList.toggle("btn-carregando", ligado);
    b.setAttribute("aria-busy", String(ligado));
  });
  $$("input, textarea, button:not([data-confirmar])", form).forEach((el) => {
    el.disabled = ligado;
  });
  if (!ligado) {
    // Reaplica o estado correto dos botões do seletor (mínimo/máximo).
    renderizar();
  }
}

/** Mensagem segura: erros levantados pela função do banco já vêm em português. */
function mensagemDoErro(erro) {
  const texto = String(erro?.message ?? "");
  if (/failed to fetch|network|fetch/i.test(texto)) {
    return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  }
  // P0001 = raise exception escrito em criar_pedido; 28000 = sem autenticação.
  if ((erro?.code === "P0001" || erro?.code === "28000") && texto) return texto;
  return "Não foi possível enviar o pedido agora. Tente novamente em instantes.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (enviando) return;

  limparAvisos(true);
  const itens = obter(restaurante.id);
  if (itens.length === 0) {
    mostrarCarrinhoVazio();
    return;
  }
  if (!validarMesa()) {
    inputMesa.focus();
    return;
  }

  const tipo = tipoSelecionado();
  const mesa = tipo === "mesa" ? inputMesa.value.trim() : null;
  const observacao = obsGeral.value.trim() || null;

  enviando = true;
  travarFormulario(true);

  try {
    // Só ids, quantidades e observações: o preço é recalculado no servidor.
    const p_itens = itens.map((i) => ({
      produto_id: i.produtoId,
      quantidade: i.quantidade,
      observacao: i.observacao || null,
    }));

    const { data, error } = await supabase.rpc("criar_pedido", {
      p_restaurante_id: restaurante.id,
      p_tipo_entrega: tipo,
      p_mesa: mesa,
      p_observacao: observacao,
      p_itens,
    });
    if (error) throw error;

    // A função devolve "table": pode vir como array de uma linha ou como objeto.
    const linha = Array.isArray(data) ? data[0] : data;
    if (!linha || !linha.id) throw new Error("Resposta inesperada do servidor.");

    redirecionando = true; // mantém tudo travado até a página trocar
    if (mesa) salvarContexto({ mesa });
    limpar(restaurante.id);
    window.location.replace(`pedido.html?id=${encodeURIComponent(linha.id)}`);
  } catch (erro) {
    console.error("[carrinho]", erro);
    enviando = false;
    const mensagem = mensagemDoErro(erro);
    travarFormulario(false);

    // Pode ter sido um item que ficou indisponível: sincroniza o carrinho.
    try {
      (await revalidarCarrinho()).forEach((m) => adicionarAviso(m));
    } catch (erroRevalidar) {
      console.warn("[carrinho] revalidação após erro falhou", erroRevalidar);
    }
    if (obter(restaurante.id).length === 0) mostrarCarrinhoVazio();
    adicionarAviso(mensagem, "erro");
    mostrarToast(mensagem, "erro");
    avisos.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
async function carregar() {
  limparAvisos();
  mostrarCarregando();
  try {
    const contexto = obterContexto();
    restaurante = await buscarRestaurante(contexto.slug);

    if (!restaurante) {
      mostrarEstado({
        icone: "alerta",
        titulo: "Este restaurante não está disponível no momento.",
        texto: "Confira o QR Code ou tente novamente mais tarde.",
        botao: { texto: "Ver cardápio", href: "cardapio.html" },
      });
      return;
    }
    $("#restaurante-nome").textContent = restaurante.nome;

    if (obter(restaurante.id).length === 0) {
      mostrarCarrinhoVazio();
      return;
    }

    silencioso = true;
    const mensagens = await revalidarCarrinho();
    silencioso = false;
    mensagens.forEach((m) => adicionarAviso(m));

    // Tipo padrão: mesa do contexto (se houver) ou retirada no balcão.
    if (contexto.mesa) {
      $("#tipo-mesa").checked = true;
      inputMesa.value = contexto.mesa;
    } else {
      $("#tipo-balcao").checked = true;
    }
    atualizarCampoMesa();

    renderizar();
  } catch (erro) {
    silencioso = false;
    console.error("[carrinho]", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar o seu pedido",
      texto: "Verifique sua internet e tente de novo.",
      botao: { texto: "Tentar de novo", acao: carregar },
    });
  }
}

async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
  });

  // Sem sessão: vai ao login e volta para o carrinho depois.
  const sessao = await exigirCliente("login.html?destino=carrinho.html");
  if (!sessao) return;

  await carregar();
}

iniciar().catch((erro) => {
  console.error("[carrinho]", erro);
  mostrarEstado({
    icone: "alerta",
    titulo: "Não foi possível carregar o seu pedido",
    texto: "Verifique sua internet e tente de novo.",
    botao: { texto: "Tentar de novo", acao: () => window.location.reload() },
  });
});
