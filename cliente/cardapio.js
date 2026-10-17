/* =====================================================================
   cardapio.js  |  FASE 3.2  |  Página do cardápio do cliente
   Depende de: supabase.js, auth.js, carrinho.js, icones.js, utils.js
   Segurança de HTML: todo texto vindo do banco entra via textContent;
   innerHTML só recebe os SVGs estáticos de icones.js. Nenhum preço do
   navegador é confiável: o servidor recalcula tudo ao criar o pedido.
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { exigirCliente, sair } from "../js/auth.js";
import {
  adicionar, alterarQuantidade, quantidadeDoProduto, quantidadeTotal, totalCentavos,
  salvarContexto, obterContexto,
} from "../js/carrinho.js";
import { icone } from "../js/icones.js";
import { formatarMoeda, mostrarToast, debounce, getParametro } from "../js/utils.js";

const QTD_MAX = 20;
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
  el.innerHTML = icone(nome, tamanho); // SVG estático, nunca texto de usuário
  return el;
}

const conteudo = $("#conteudo");
const barraCategorias = $("#barra-categorias");
const chips = $("#chips");
const campoBusca = $("#busca");

/* ---------------------------------------------------------------------
   Estado
   --------------------------------------------------------------------- */
let restaurante = null;
let categorias = [];
let produtos = [];
const produtoPorId = new Map();
let termo = "";
let categoriaAtiva = null;
let travaObservador = false;
let observador = null;

/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function primeiroNome(nome) {
  return String(nome ?? "").trim().split(/\s+/)[0] || "";
}

function plural(n, singular, pluralTxt) {
  return n === 1 ? singular : pluralTxt;
}

/* ---------------------------------------------------------------------
   Etapas da inicialização
   --------------------------------------------------------------------- */
function lerParametrosDaUrl() {
  const slug = getParametro("r");
  if (slug) {
    // QR de outro restaurante sem ?mesa= não deve herdar a mesa antiga.
    salvarContexto({ slug, mesa: getParametro("mesa") ?? "" });
  } else if (getParametro("mesa") !== null) {
    salvarContexto({ mesa: getParametro("mesa") });
  }
}

async function buscarRestaurante(slug) {
  let consulta = supabase.from("restaurantes").select("id, nome, slug").eq("ativo", true);
  consulta = slug
    ? consulta.eq("slug", slug)
    : consulta.order("criado_em", { ascending: true }).limit(1);
  const { data, error } = await consulta.maybeSingle();
  if (error) throw error;
  return data;
}

async function buscarNomeDoCliente(usuarioId) {
  const { data, error } = await supabase
    .from("perfis_clientes").select("nome").eq("id", usuarioId).maybeSingle();
  if (error) {
    console.warn("[cardapio] não foi possível ler o nome do cliente", error);
    return "";
  }
  return data?.nome ?? "";
}

async function buscarCardapio(restauranteId) {
  const [rCategorias, rProdutos] = await Promise.all([
    supabase.from("categorias").select("id, nome, ordem")
      .eq("restaurante_id", restauranteId).eq("ativa", true).order("ordem", { ascending: true }),
    supabase.from("produtos")
      .select("id, categoria_id, nome, descricao, preco_centavos, imagem_url, disponivel, ordem")
      .eq("restaurante_id", restauranteId).order("ordem", { ascending: true }),
  ]);
  if (rCategorias.error) throw rCategorias.error;
  if (rProdutos.error) throw rProdutos.error;
  return { categorias: rCategorias.data ?? [], produtos: rProdutos.data ?? [] };
}

/* ---------------------------------------------------------------------
   Estados de tela: skeleton, vazio, erro
   --------------------------------------------------------------------- */
function mostrarSkeleton() {
  barraCategorias.hidden = true;
  conteudo.replaceChildren();
  conteudo.setAttribute("aria-busy", "true");

  const secao = criar("section", "cardapio-secao");
  const titulo = criar("div", "skeleton skeleton-linha skeleton-curta");
  titulo.style.height = "1.6em";
  secao.append(titulo);

  const lista = criar("div", "cardapio-lista");
  for (let i = 0; i < 6; i += 1) {
    const card = criar("div", "card-produto card-skeleton");
    const corpo = criar("div", "card-produto-corpo");
    corpo.append(
      criar("div", "skeleton skeleton-linha skeleton-curta"),
      criar("div", "skeleton skeleton-linha"),
    );
    card.append(
      corpo,
      criar("div", "skeleton skeleton-bloco"),
      criar("div", "skeleton skeleton-linha skeleton-curta"),
    );
    lista.append(card);
  }
  secao.append(lista);
  conteudo.append(secao);
}

function mostrarEstado({ icone: nomeIcone, titulo, texto, botao }) {
  barraCategorias.hidden = true;
  conteudo.removeAttribute("aria-busy");
  conteudo.replaceChildren();

  const bloco = criar("div", "cardapio-estado");
  const vazio = criar("div", "vazio");
  const caixaIcone = criar("div", "vazio-icone");
  comIcone(caixaIcone, nomeIcone, 32);
  vazio.append(caixaIcone, criar("h3", "", titulo));
  if (texto) vazio.append(criar("p", "", texto));
  if (botao) {
    const b = criar("button", "btn btn-primario", botao.texto);
    b.type = "button";
    b.addEventListener("click", botao.acao);
    vazio.append(b);
  }
  bloco.append(vazio);
  conteudo.append(bloco);
}

/* ---------------------------------------------------------------------
   Renderização do cardápio (com filtro de busca)
   --------------------------------------------------------------------- */
function produtosFiltrados() {
  if (!termo) return produtos;
  return produtos.filter(
    (p) => normalizar(p.nome).includes(termo) || normalizar(p.descricao).includes(termo)
  );
}

function criarImagem(produto, classe) {
  const caixa = criar("div", classe);
  const marcarSemImagem = () => {
    caixa.replaceChildren();
    caixa.classList.add("sem-imagem");
    caixa.append(comIcone(criar("span"), "sacola", 32));
  };

  if (produto.imagem_url) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", marcarSemImagem, { once: true });
    img.src = produto.imagem_url;
    caixa.append(img);
  } else {
    marcarSemImagem();
  }
  return caixa;
}

function criarCard(produto) {
  const indisponivel = produto.disponivel === false;
  const card = criar("article", "card-produto");
  card.dataset.produto = produto.id;
  if (indisponivel) card.classList.add("card-produto-esgotado");
  else card.dataset.abrir = "";

  const imagem = criarImagem(produto, "card-produto-imagem");

  const corpo = criar("div", "card-produto-corpo");
  const nome = criar("h3", "card-produto-nome");
  const botaoNome = criar("button", "card-produto-abrir", produto.nome);
  botaoNome.type = "button";
  botaoNome.dataset.acao = "abrir";
  nome.append(botaoNome);
  corpo.append(nome);
  if (produto.descricao) corpo.append(criar("p", "card-produto-descricao", produto.descricao));
  if (indisponivel) {
    const selo = criar("span", "badge", "Esgotado");
    selo.style.marginTop = "var(--esp-2)";
    corpo.append(selo);
  }

  const rodape = criar("div", "card-produto-rodape");
  rodape.append(criar("span", "card-produto-preco", formatarMoeda(produto.preco_centavos)));
  const controle = criar("div", "card-produto-controle");
  rodape.append(controle);

  card.append(corpo, imagem, rodape);
  montarControle(card, produto);
  return card;
}

/** (Re)constrói o botão "+" ou o seletor − qtd + do card. */
function montarControle(card, produto) {
  const controle = $(".card-produto-controle", card);
  const qtd = restaurante ? quantidadeDoProduto(restaurante.id, produto.id) : 0;
  card.dataset.qtd = String(qtd);
  controle.replaceChildren();

  if (produto.disponivel === false) {
    const b = criar("button", "card-produto-add");
    b.type = "button";
    b.disabled = true;
    b.setAttribute("aria-label", `${produto.nome}: esgotado`);
    comIcone(b, "mais", 22);
    controle.append(b);
    return;
  }

  if (qtd === 0) {
    const b = criar("button", "card-produto-add");
    b.type = "button";
    b.dataset.acao = "adicionar";
    b.setAttribute("aria-label", `Adicionar ${produto.nome} ao carrinho`);
    comIcone(b, "mais", 22);
    controle.append(b);
    return;
  }

  const seletor = criar("div", "seletor");
  seletor.setAttribute("role", "group");
  seletor.setAttribute("aria-label", `Quantidade de ${produto.nome}`);

  const menos = criar("button");
  menos.type = "button";
  menos.dataset.acao = "menos";
  menos.setAttribute("aria-label", `Diminuir quantidade de ${produto.nome}`);
  comIcone(menos, qtd === 1 ? "lixeira" : "menos", 20);

  const valor = criar("span", "seletor-qtd", String(qtd));

  const mais = criar("button", "seletor-mais");
  mais.type = "button";
  mais.dataset.acao = "mais";
  mais.disabled = qtd >= QTD_MAX;
  mais.setAttribute("aria-label", `Aumentar quantidade de ${produto.nome}`);
  comIcone(mais, "mais", 20);

  seletor.append(menos, valor, mais);
  controle.append(seletor);
}

function renderizar() {
  conteudo.removeAttribute("aria-busy");
  conteudo.replaceChildren();

  const filtrados = produtosFiltrados();
  const porCategoria = new Map();
  filtrados.forEach((p) => {
    if (!porCategoria.has(p.categoria_id)) porCategoria.set(p.categoria_id, []);
    porCategoria.get(p.categoria_id).push(p);
  });

  // Categorias sem produtos (ou sem resultado na busca) não aparecem.
  const visiveis = categorias.filter((c) => porCategoria.has(c.id));

  if (visiveis.length === 0) {
    barraCategorias.hidden = true;
    if (termo) {
      mostrarEstado({
        icone: "busca",
        titulo: "Nenhum item encontrado",
        texto: "Tente buscar por outro nome.",
      });
    } else {
      mostrarEstado({
        icone: "sacola",
        titulo: "Cardápio em preparação",
        texto: "Ainda não há itens disponíveis por aqui.",
      });
    }
    return;
  }

  visiveis.forEach((categoria) => {
    const secao = criar("section", "cardapio-secao");
    secao.id = `cat-${categoria.id}`;
    secao.dataset.categoria = categoria.id;
    secao.setAttribute("aria-labelledby", `titulo-${categoria.id}`);

    const titulo = criar("h2", "cardapio-secao-titulo", categoria.nome);
    titulo.id = `titulo-${categoria.id}`;

    const lista = criar("div", "cardapio-lista");
    porCategoria.get(categoria.id).forEach((p) => lista.append(criarCard(p)));

    secao.append(titulo, lista);
    conteudo.append(secao);
  });

  montarChips(visiveis);
  medirBarra();
  observarSecoes();
}

/* ---------------------------------------------------------------------
   Abas de categoria + scroll spy
   --------------------------------------------------------------------- */
function montarChips(visiveis) {
  chips.replaceChildren();
  visiveis.forEach((categoria, i) => {
    const chip = criar("button", "chip", categoria.nome);
    chip.type = "button";
    chip.dataset.categoria = categoria.id;
    chip.addEventListener("click", () => irParaCategoria(categoria.id));
    chips.append(chip);
    if (i === 0 && !visiveis.some((c) => c.id === categoriaAtiva)) categoriaAtiva = categoria.id;
  });
  barraCategorias.hidden = false;
  definirAtiva(categoriaAtiva, { rolarChip: false });
}

function definirAtiva(id, { rolarChip = true } = {}) {
  categoriaAtiva = id;
  $$(".chip", chips).forEach((chip) => {
    const ativo = chip.dataset.categoria === id;
    chip.classList.toggle("chip-ativo", ativo);
    if (ativo) {
      chip.setAttribute("aria-current", "true");
      if (rolarChip) centralizarChip(chip);
    } else {
      chip.removeAttribute("aria-current");
    }
  });
}

/** Rola só a faixa de chips (nunca a página) para mostrar o chip ativo. */
function centralizarChip(chip) {
  const alvo = chip.offsetLeft - (chips.clientWidth - chip.offsetWidth) / 2;
  chips.scrollTo({ left: alvo, behavior: reduzirMovimento ? "auto" : "smooth" });
}

function irParaCategoria(id) {
  const secao = document.getElementById(`cat-${id}`);
  if (!secao) return;
  travaObservador = true; // evita que as abas "pisquem" durante a rolagem animada
  definirAtiva(id);
  secao.scrollIntoView({ behavior: reduzirMovimento ? "auto" : "smooth", block: "start" });
  setTimeout(() => { travaObservador = false; }, 800);
}

chips.addEventListener("keydown", (e) => {
  const lista = $$(".chip", chips);
  const atual = lista.indexOf(document.activeElement);
  if (atual < 0) return;
  let novo = null;
  if (e.key === "ArrowRight") novo = (atual + 1) % lista.length;
  else if (e.key === "ArrowLeft") novo = (atual - 1 + lista.length) % lista.length;
  else if (e.key === "Home") novo = 0;
  else if (e.key === "End") novo = lista.length - 1;
  if (novo !== null) {
    e.preventDefault();
    lista[novo].focus();
  }
});

function medirBarra() {
  document.body.style.setProperty("--altura-barra", `${barraCategorias.offsetHeight}px`);
}

/**
 * IntersectionObserver com uma "faixa" de 2px logo abaixo da barra fixa:
 * a seção que cruza essa faixa é a que está sendo lida.
 */
function observarSecoes() {
  observador?.disconnect();
  const secoes = $$(".cardapio-secao[data-categoria]");
  if (secoes.length === 0) return;

  const topo = Math.round(barraCategorias.offsetHeight + 8);
  const base = Math.max(0, window.innerHeight - topo - 2);
  observador = new IntersectionObserver(
    (entradas) => {
      if (travaObservador) return;
      const visivel = entradas.filter((e) => e.isIntersecting).pop();
      if (visivel && visivel.target.dataset.categoria !== categoriaAtiva) {
        definirAtiva(visivel.target.dataset.categoria);
      }
    },
    { rootMargin: `-${topo}px 0px -${base}px 0px`, threshold: 0 }
  );
  secoes.forEach((s) => observador.observe(s));
}

window.addEventListener("resize", debounce(() => {
  if (barraCategorias.hidden) return;
  medirBarra();
  observarSecoes();
}, 200));

/* ---------------------------------------------------------------------
   Busca
   --------------------------------------------------------------------- */
campoBusca.addEventListener("input", debounce(() => {
  termo = normalizar(campoBusca.value.trim());
  renderizar();
}, 250));

/* ---------------------------------------------------------------------
   Interações nos cards (delegação de eventos)
   --------------------------------------------------------------------- */
conteudo.addEventListener("click", (e) => {
  const card = e.target.closest(".card-produto[data-produto]");
  if (!card) return;
  const produto = produtoPorId.get(card.dataset.produto);
  if (!produto) return;

  const botao = e.target.closest("[data-acao]");
  const acao = botao?.dataset.acao;
  const qtd = quantidadeDoProduto(restaurante.id, produto.id);

  if (acao === "adicionar") {
    adicionar(restaurante.id, produto, 1);
    mostrarToast("Adicionado ao carrinho", "sucesso", 1800);
  } else if (acao === "mais") {
    alterarQuantidade(restaurante.id, produto.id, qtd + 1);
  } else if (acao === "menos") {
    alterarQuantidade(restaurante.id, produto.id, qtd - 1);
  } else if (acao === "abrir") {
    abrirDetalhe(produto, botao);
  } else if (!e.target.closest("button, .card-produto-controle") && card.hasAttribute("data-abrir")) {
    // Clique em qualquer parte livre do card (conveniência para mouse/toque).
    abrirDetalhe(produto, card.querySelector('[data-acao="abrir"]'));
  }
});

/* ---------------------------------------------------------------------
   Carrinho: barra do rodapé + sincronização dos cards
   --------------------------------------------------------------------- */
function atualizarBarraCarrinho() {
  if (!restaurante) return;
  const itens = quantidadeTotal(restaurante.id);
  const fundo = $("#carrinho-fundo");
  const tinha = !fundo.hidden;

  if (itens === 0) {
    fundo.hidden = true;
    document.body.classList.remove("tem-carrinho");
    return;
  }

  $("#carrinho-barra-texto").textContent =
    `Ver carrinho • ${itens} ${plural(itens, "item", "itens")}`;
  $("#carrinho-barra-total").textContent = formatarMoeda(totalCentavos(restaurante.id));
  fundo.hidden = false;
  document.body.classList.add("tem-carrinho");

  if (!tinha && !reduzirMovimento) {
    // Reinicia a animação de entrada só quando a barra acabou de aparecer.
    fundo.style.animation = "none";
    void fundo.offsetWidth;
    fundo.style.animation = "";
  }
}

function sincronizarCards() {
  if (!restaurante) return;
  $$(".card-produto[data-produto]").forEach((card) => {
    const produto = produtoPorId.get(card.dataset.produto);
    if (!produto || produto.disponivel === false) return;
    const qtd = quantidadeDoProduto(restaurante.id, produto.id);
    if (String(qtd) === card.dataset.qtd) return;

    // Preserva o foco do teclado ao reconstruir o controle.
    const controle = $(".card-produto-controle", card);
    const acaoFoco = controle.contains(document.activeElement)
      ? document.activeElement.dataset.acao
      : null;
    montarControle(card, produto);

    if (acaoFoco) {
      const proximo =
        acaoFoco === "adicionar" ? "mais" : acaoFoco === "menos" && qtd === 0 ? "adicionar" : acaoFoco;
      const alvo = $(`[data-acao="${proximo}"]`, card) || $("[data-acao]", controle);
      alvo?.focus();
    }
  });
}

function aoMudarCarrinho() {
  atualizarBarraCarrinho();
  sincronizarCards();
}
window.addEventListener("carrinho:mudou", aoMudarCarrinho);
// Outra aba alterou o carrinho: mantém tudo em sincronia.
window.addEventListener("storage", aoMudarCarrinho);
window.addEventListener("pageshow", (e) => { if (e.persisted) aoMudarCarrinho(); });

/* ---------------------------------------------------------------------
   Detalhe do produto (dialog acessível)
   --------------------------------------------------------------------- */
const detalheFundo = $("#detalhe-fundo");
const detalhe = $("#detalhe");
const detalheObs = $("#detalhe-obs");
const botaoAdicionar = $("#detalhe-adicionar");
let produtoAberto = null;
let qtdDetalhe = 1;
let elementoQueAbriu = null;

function atualizarDetalhe() {
  $("#detalhe-qtd").textContent = String(qtdDetalhe);
  $("#detalhe-menos").disabled = qtdDetalhe <= 1;
  $("#detalhe-mais").disabled = qtdDetalhe >= QTD_MAX;
  $("#detalhe-obs-contador").textContent = `${detalheObs.value.length}/140`;

  if (produtoAberto.disponivel === false) {
    botaoAdicionar.disabled = true;
    botaoAdicionar.textContent = "Esgotado";
  } else {
    botaoAdicionar.disabled = false;
    botaoAdicionar.textContent =
      `Adicionar • ${formatarMoeda(produtoAberto.preco_centavos * qtdDetalhe)}`;
  }
}

function abrirDetalhe(produto, origem) {
  produtoAberto = produto;
  qtdDetalhe = 1;
  elementoQueAbriu = origem || document.activeElement;

  $("#detalhe-nome").textContent = produto.nome;
  const desc = $("#detalhe-descricao");
  desc.textContent = produto.descricao || "";
  desc.hidden = !produto.descricao;
  $("#detalhe-preco").textContent = formatarMoeda(produto.preco_centavos);
  detalheObs.value = "";

  // Troca a imagem preservando o botão de fechar.
  const caixa = $("#detalhe-imagem");
  $$("img, .detalhe-vazio", caixa).forEach((n) => n.remove());
  const marcarSemImagem = () => {
    $$("img", caixa).forEach((n) => n.remove());
    caixa.append(comIcone(criar("span", "detalhe-vazio"), "sacola", 48));
  };
  if (produto.imagem_url) {
    const img = document.createElement("img");
    img.alt = produto.nome;
    img.decoding = "async";
    img.addEventListener("error", marcarSemImagem, { once: true });
    img.src = produto.imagem_url;
    caixa.append(img);
  } else {
    marcarSemImagem();
  }

  atualizarDetalhe();
  detalheFundo.classList.add("aberto");
  document.body.classList.add("detalhe-aberto");
  detalhe.scrollTop = 0;
  $("#detalhe-fechar").focus({ preventScroll: true });
}

function fecharDetalhe() {
  if (!detalheFundo.classList.contains("aberto")) return;
  detalheFundo.classList.remove("aberto");
  document.body.classList.remove("detalhe-aberto");
  produtoAberto = null;
  // O foco volta a quem abriu (se ainda existir na tela).
  if (elementoQueAbriu && document.contains(elementoQueAbriu)) {
    elementoQueAbriu.focus({ preventScroll: true });
  }
  elementoQueAbriu = null;
}

$("#detalhe-fechar").addEventListener("click", fecharDetalhe);
detalheFundo.addEventListener("click", (e) => {
  if (e.target === detalheFundo) fecharDetalhe();
});
$("#detalhe-menos").addEventListener("click", () => {
  qtdDetalhe = Math.max(1, qtdDetalhe - 1);
  atualizarDetalhe();
});
$("#detalhe-mais").addEventListener("click", () => {
  qtdDetalhe = Math.min(QTD_MAX, qtdDetalhe + 1);
  atualizarDetalhe();
});
detalheObs.addEventListener("input", atualizarDetalhe);

botaoAdicionar.addEventListener("click", () => {
  if (!produtoAberto || produtoAberto.disponivel === false) return;
  adicionar(restaurante.id, produtoAberto, qtdDetalhe, detalheObs.value);
  mostrarToast("Adicionado ao carrinho", "sucesso", 1800);
  fecharDetalhe();
});

// Esc fecha; Tab fica preso dentro do diálogo.
document.addEventListener("keydown", (e) => {
  if (!detalheFundo.classList.contains("aberto")) return;

  if (e.key === "Escape") {
    e.preventDefault();
    fecharDetalhe();
    return;
  }
  if (e.key !== "Tab") return;

  const focaveis = $$("button:not(:disabled), textarea, [href], input", detalhe)
    .filter((el) => !el.hidden && el.offsetParent !== null);
  if (focaveis.length === 0) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];

  if (e.shiftKey && (document.activeElement === primeiro || !detalhe.contains(document.activeElement))) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && (document.activeElement === ultimo || !detalhe.contains(document.activeElement))) {
    e.preventDefault();
    primeiro.focus();
  }
});

/* ---------------------------------------------------------------------
   Cabeçalho: sair
   --------------------------------------------------------------------- */
$("#btn-sair").addEventListener("click", async () => {
  try {
    await sair();
  } catch (erro) {
    mostrarToast(erro.message, "erro");
    return;
  }
  window.location.replace("../index.html");
});

/* ---------------------------------------------------------------------
   Carregamento
   --------------------------------------------------------------------- */
async function carregarCardapio() {
  mostrarSkeleton();
  try {
    const contexto = obterContexto();
    restaurante = await buscarRestaurante(contexto.slug);

    if (!restaurante) {
      mostrarEstado({
        icone: "alerta",
        titulo: "Este restaurante não está disponível no momento.",
        texto: "Confira o QR Code ou tente novamente mais tarde.",
      });
      return;
    }

    $("#restaurante-nome").textContent = restaurante.nome;
    document.title = `Cardápio • ${restaurante.nome} | Pedido na Mão`;

    const dados = await buscarCardapio(restaurante.id);
    categorias = dados.categorias;
    produtos = dados.produtos;
    produtoPorId.clear();
    produtos.forEach((p) => produtoPorId.set(p.id, p));

    campoBusca.disabled = false;
    renderizar();
    atualizarBarraCarrinho();
  } catch (erro) {
    console.error("[cardapio]", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar o cardápio",
      texto: "Verifique sua internet e tente de novo.",
      botao: { texto: "Tentar de novo", acao: carregarCardapio },
    });
  }
}

async function iniciar() {
  // Ícones estáticos do HTML
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = icone(el.dataset.icone, Number(el.dataset.tamanho) || 24);
  });

  // 1) Contexto ANTES de qualquer checagem de login: sobrevive ao redirecionamento.
  lerParametrosDaUrl();

  // 2) Exige cliente logado (senão, vai para o login).
  const sessao = await exigirCliente();
  if (!sessao) return;

  // Mesa do contexto
  const { mesa } = obterContexto();
  if (mesa) {
    $("#pilula-mesa-texto").textContent = `Mesa ${mesa}`;
    $("#pilula-mesa").hidden = false;
  }

  // Saudação (não bloqueia o cardápio)
  buscarNomeDoCliente(sessao.user.id).then((nome) => {
    const primeiro = primeiroNome(nome);
    $("#saudacao").textContent = primeiro ? `Olá, ${primeiro}` : "Olá!";
  });

  // 3) e 4) Restaurante + categorias + produtos
  await carregarCardapio();
}

iniciar().catch((erro) => {
  console.error("[cardapio]", erro);
  mostrarEstado({
    icone: "alerta",
    titulo: "Não foi possível carregar o cardápio",
    texto: "Verifique sua internet e tente de novo.",
    botao: { texto: "Tentar de novo", acao: () => window.location.reload() },
  });
});
