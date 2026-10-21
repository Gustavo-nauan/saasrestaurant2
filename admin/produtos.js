/* =====================================================================
   produtos.js  |  FASE 5.1  |  Administração de produtos e upload de fotos
   Depende de: supabase.js, utils.js, admin-comum.js
   Segurança: todo texto vindo do banco entra via textContent.
   Preço: manipulado apenas como inteiro em centavos (sem ponto flutuante).
   ===================================================================== */

import { supabase } from "../js/supabase.js";
import { formatarMoeda, debounce, mostrarToast } from "../js/utils.js";
import {
  iniciarAdmin,
  iconeAdmin,
  criar,
  comIcone,
  criarControladorModal,
  removerFotoAntigaSilencioso,
} from "../js/admin-comum.js";

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

/* ---------------------------------------------------------------------
   Constantes de validação de imagem e preço
   --------------------------------------------------------------------- */
const TIPOS_IMAGEM_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const TAMANHO_MAX_ENTRADA_BYTES = 5 * 1024 * 1024; // 5 MB antes de processar
const TAMANHO_MAX_SAIDA_BYTES = 2 * 1024 * 1024;   // 2 MB para o bucket
const LADO_MAX_PX = 1000;
const QUALIDADE_INICIAL = 0.82;
const PRECO_MAX_CENTAVOS = 999999; // R$ 9.999,99

/* ---------------------------------------------------------------------
   Elementos do DOM
   --------------------------------------------------------------------- */
const estadoEl = $("#estado");
const areaProdutosEl = $("#area-produtos");
const tabelaCorpoEl = $("#tabela-produtos-corpo");
const cardsMobileEl = $("#cards-produtos-mobile");
const btnNovoProduto = $("#btn-novo-produto");
const campoBusca = $("#campo-busca");
const filtroCategoria = $("#filtro-categoria");

// Modal de criar/editar produto
const modalProdutoFundo = $("#modal-produto-fundo");
const modalProdutoTitulo = $("#modal-produto-titulo");
const btnFecharModalProduto = $("#btn-fechar-modal-produto");
const btnCancelarProduto = $("#btn-cancelar-produto");
const btnSalvarProduto = $("#btn-salvar-produto");
const formProduto = $("#form-produto");
const erroFormProduto = $("#erro-form-produto");

const campoNome = $("#campo-produto-nome");
const contadorNome = $("#contador-produto-nome");
const campoCategoria = $("#campo-produto-categoria");
const campoPreco = $("#campo-produto-preco");
const campoDescricao = $("#campo-produto-descricao");
const contadorDescricao = $("#contador-produto-descricao");
const campoDisponivel = $("#campo-produto-disponivel");

// Controles de foto
const campoFoto = $("#campo-produto-foto");
const fotoPreviewCaixa = $("#foto-preview-caixa");
const rotuloEscolherFoto = $("#rotulo-escolher-foto");
const btnRemoverFoto = $("#btn-remover-foto");
const fotoProgresso = $("#foto-progresso");
const fotoProgressoBarra = $("#foto-progresso-barra");
const fotoProgressoTexto = $("#foto-progresso-texto");

// Modal de exclusão
const modalExcluirFundo = $("#modal-excluir-fundo");
const modalExcluirDesc = $("#modal-excluir-desc");
const erroExcluirProduto = $("#erro-excluir-produto");
const btnFecharModalExcluir = $("#btn-fechar-modal-excluir");
const btnCancelarExcluir = $("#btn-cancelar-excluir");
const btnConfirmarExcluir = $("#btn-confirmar-excluir");

/* ---------------------------------------------------------------------
   Estado da página
   --------------------------------------------------------------------- */
let restauranteId = null;
let categorias = [];
const categoriasPorId = new Map();
let produtos = [];
let termoBusca = "";
let categoriaFiltroId = "";

let produtoEditando = null;
let produtoExcluindo = null;
let precoCentavosAtual = 0;

// Estado da foto no modal
let blobFotoProcessada = null;
let extensaoFotoProcessada = "webp";
let urlPreviewTemporaria = null;
let fotoExistenteUrl = null;
let removerFotoExistente = false;
let processandoFoto = false;

let salvandoProduto = false;
let excluindoProduto = false;
let reordenandoProduto = false;

const modalForm = criarControladorModal(modalProdutoFundo, {
  aoFechar: () => {
    produtoEditando = null;
    limparPreviewTemporario();
    ocultarAlerta(erroFormProduto);
    ocultarProgressoFoto();
  },
});

const modalExcluir = criarControladorModal(modalExcluirFundo, {
  aoFechar: () => {
    produtoExcluindo = null;
    ocultarAlerta(erroExcluirProduto);
  },
});

/* ---------------------------------------------------------------------
   Máscara de preço em reais (100% inteiros, sem ponto flutuante)
   --------------------------------------------------------------------- */
function extrairCentavosDeDigitos(texto) {
  const digitos = String(texto || "")
    .replace(/\D/g, "")
    .replace(/^0+/, "")
    .slice(0, 6); // até 999999 centavos (R$ 9.999,99)
  if (!digitos) return 0;
  return Number.parseInt(digitos, 10);
}

function formatarMascaraCentavos(centavosInt) {
  const c = Math.max(0, Math.min(PRECO_MAX_CENTAVOS, Number.parseInt(String(centavosInt || 0), 10) || 0));
  const padded = String(c).padStart(3, "0");
  const reais = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = padded.slice(-2);
  return `R$ ${reais},${centavos}`;
}

function definirPrecoNoCampo(centavosInt) {
  precoCentavosAtual = Math.max(
    0,
    Math.min(PRECO_MAX_CENTAVOS, Number.parseInt(String(centavosInt || 0), 10) || 0)
  );
  campoPreco.value = formatarMascaraCentavos(precoCentavosAtual);
}

campoPreco.addEventListener("input", () => {
  precoCentavosAtual = extrairCentavosDeDigitos(campoPreco.value);
  campoPreco.value = formatarMascaraCentavos(precoCentavosAtual);
  campoPreco.classList.remove("campo-invalido");
  ocultarAlerta(erroFormProduto);
});

campoPreco.addEventListener("focus", () => {
  requestAnimationFrame(() => {
    const tam = campoPreco.value.length;
    campoPreco.setSelectionRange(tam, tam);
  });
});

/* ---------------------------------------------------------------------
   Utilitários de UI (alertas, skeleton, estados)
   --------------------------------------------------------------------- */
function mostrarAlerta(el, mensagem) {
  el.replaceChildren(
    comIcone(criar("span"), "alerta", 18),
    criar("span", "", mensagem)
  );
  el.hidden = false;
}

function ocultarAlerta(el) {
  el.hidden = true;
  el.replaceChildren();
}

function mostrarSkeleton() {
  areaProdutosEl.hidden = true;
  estadoEl.setAttribute("aria-busy", "true");
  estadoEl.replaceChildren();

  const grade = criar("div", "admin-skeleton-lista");
  for (let i = 0; i < 5; i += 1) {
    grade.append(criar("div", "skeleton admin-skeleton-item"));
  }
  estadoEl.append(grade);
}

function mostrarEstado({ icone, titulo, texto, botao }) {
  areaProdutosEl.hidden = true;
  estadoEl.removeAttribute("aria-busy");
  estadoEl.replaceChildren();

  const bloco = criar("div", "admin-estado-bloco");
  const vazio = criar("div", "vazio");
  vazio.append(
    comIcone(criar("div", "vazio-icone"), icone, 32),
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

/* ---------------------------------------------------------------------
   Busca de categorias e produtos no Supabase
   --------------------------------------------------------------------- */
function ordenarProdutosLocal() {
  produtos.sort((a, b) => {
    const catA = categoriasPorId.get(a.categoria_id);
    const catB = categoriasPorId.get(b.categoria_id);
    const ordemCatA = catA ? Number(catA.ordem) || 0 : 999999;
    const ordemCatB = catB ? Number(catB.ordem) || 0 : 999999;
    if (ordemCatA !== ordemCatB) return ordemCatA - ordemCatB;
    if (a.categoria_id !== b.categoria_id) {
      return String(a.categoria_id).localeCompare(String(b.categoria_id));
    }
    const ordemProdA = Number(a.ordem) || 0;
    const ordemProdB = Number(b.ordem) || 0;
    if (ordemProdA !== ordemProdB) return ordemProdA - ordemProdB;
    return String(a.nome).localeCompare(String(b.nome), "pt-BR");
  });
}

function popularSelectsCategorias() {
  // Select de filtro da barra de ferramentas
  const valorFiltroAnterior = filtroCategoria.value;
  filtroCategoria.replaceChildren(criar("option", "", "Todas as categorias"));
  filtroCategoria.firstChild.value = "";

  // Select do modal de produto
  campoCategoria.replaceChildren(criar("option", "", "Selecione uma categoria"));
  campoCategoria.firstChild.value = "";

  categorias.forEach((cat) => {
    const nomeExibicao = cat.ativa ? cat.nome : `${cat.nome} (oculta)`;

    const optFiltro = criar("option", "", nomeExibicao);
    optFiltro.value = cat.id;
    filtroCategoria.append(optFiltro);

    const optForm = criar("option", "", nomeExibicao);
    optForm.value = cat.id;
    campoCategoria.append(optForm);
  });

  if (valorFiltroAnterior && categoriasPorId.has(valorFiltroAnterior)) {
    filtroCategoria.value = valorFiltroAnterior;
  }
}

async function carregarCatalogo() {
  mostrarSkeleton();

  try {
    const [resCats, resProds] = await Promise.all([
      supabase
        .from("categorias")
        .select("id, nome, ordem, ativa")
        .eq("restaurante_id", restauranteId)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true }),
      supabase
        .from("produtos")
        .select(
          "id, restaurante_id, categoria_id, nome, descricao, preco_centavos, imagem_url, disponivel, ordem"
        )
        .eq("restaurante_id", restauranteId)
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true }),
    ]);

    if (resCats.error) throw resCats.error;
    if (resProds.error) throw resProds.error;

    categorias = resCats.data ?? [];
    categoriasPorId.clear();
    categorias.forEach((c) => categoriasPorId.set(c.id, c));

    produtos = resProds.data ?? [];
    ordenarProdutosLocal();
    popularSelectsCategorias();
    renderizarProdutos();
  } catch (erro) {
    console.error("[admin/produtos] erro ao carregar catálogo:", erro);
    mostrarEstado({
      icone: "alerta",
      titulo: "Não foi possível carregar os produtos",
      texto: "Verifique sua conexão com a internet e tente novamente.",
      botao: { texto: "Tentar de novo", acao: carregarCatalogo },
    });
  }
}

/* ---------------------------------------------------------------------
   Miniatura de foto com fallback de degradê + ícone SVG
   --------------------------------------------------------------------- */
function urlImagemSegura(url, { permitirBlob = false } = {}) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === "https:") return parsed.href;
    if (permitirBlob && parsed.protocol === "blob:") return parsed.href;
    return null;
  } catch {
    return null;
  }
}

function criarMiniaturaProduto(prod) {
  const caixa = criar("div", "produto-miniatura");
  const mostrarFallback = () => {
    caixa.replaceChildren();
    comIcone(caixa, "imagem", 22);
  };

  const urlSegura = urlImagemSegura(prod.imagem_url); if (urlSegura) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", mostrarFallback, { once: true });
    img.src = urlSegura;
    caixa.append(img);
  } else {
    mostrarFallback();
  }

  return caixa;
}

/* ---------------------------------------------------------------------
   Renderização (Tabela no Desktop + Cards no Celular)
   --------------------------------------------------------------------- */
function obterProdutosDaCategoria(categoriaId) {
  return produtos.filter((p) => p.categoria_id === categoriaId);
}

function obterProdutosFiltrados() {
  const busca = termoBusca.trim().toLowerCase();
  return produtos.filter((p) => {
    if (categoriaFiltroId && p.categoria_id !== categoriaFiltroId) return false;
    if (busca && !p.nome.toLowerCase().includes(busca)) return false;
    return true;
  });
}

function criarInterruptorDisponivel(prod, sufixoId) {
  const idInput = `disp-${sufixoId}-${prod.id}`;
  const label = criar("label", "interruptor");
  label.setAttribute("for", idInput);

  const input = criar("input", "interruptor-input");
  input.type = "checkbox";
  input.id = idInput;
  input.checked = Boolean(prod.disponivel);
  input.setAttribute("aria-label", `${prod.nome} disponível`);
  input.addEventListener("change", () => alternarDisponivel(prod, input));

  const trilho = criar("span", "interruptor-trilho");
  trilho.setAttribute("aria-hidden", "true");
  trilho.append(criar("span", "interruptor-bolinha"));

  const texto = criar(
    "span",
    "interruptor-rotulo",
    prod.disponivel ? "Disponível" : "Esgotado"
  );

  label.append(input, trilho, texto);
  return label;
}

function criarBotoesOrdem(prod) {
  const irmaos = obterProdutosDaCategoria(prod.categoria_id);
  const idx = irmaos.findIndex((p) => p.id === prod.id);

  const grupo = criar("div", "admin-acoes-grupo");

  const btnSubir = comIcone(criar("button", "btn-acao-icone"), "seta-cima", 18);
  btnSubir.type = "button";
  btnSubir.disabled = idx <= 0 || reordenandoProduto;
  btnSubir.setAttribute("aria-label", `Mover ${prod.nome} para cima na categoria`);
  btnSubir.title = "Mover para cima na categoria";
  btnSubir.addEventListener("click", () => moverProdutoNaCategoria(prod, -1));

  const btnDescer = comIcone(criar("button", "btn-acao-icone"), "seta-baixo", 18);
  btnDescer.type = "button";
  btnDescer.disabled = idx === -1 || idx >= irmaos.length - 1 || reordenandoProduto;
  btnDescer.setAttribute("aria-label", `Mover ${prod.nome} para baixo na categoria`);
  btnDescer.title = "Mover para baixo na categoria";
  btnDescer.addEventListener("click", () => moverProdutoNaCategoria(prod, 1));

  grupo.append(btnSubir, btnDescer);
  return grupo;
}

function criarBotoesEditarExcluir(prod) {
  const grupo = criar("div", "admin-acoes-grupo");

  const btnEditar = comIcone(criar("button", "btn-acao-icone"), "editar", 18);
  btnEditar.type = "button";
  btnEditar.setAttribute("aria-label", `Editar produto ${prod.nome}`);
  btnEditar.title = "Editar";
  btnEditar.addEventListener("click", () => abrirModalEditar(prod));

  const btnExcluir = comIcone(
    criar("button", "btn-acao-icone btn-acao-perigo"),
    "lixeira",
    18
  );
  btnExcluir.type = "button";
  btnExcluir.setAttribute("aria-label", `Excluir produto ${prod.nome}`);
  btnExcluir.title = "Excluir";
  btnExcluir.addEventListener("click", () => abrirModalExcluir(prod));

  grupo.append(btnEditar, btnExcluir);
  return grupo;
}

function criarLinhaTabela(prod) {
  const tr = criar("tr", prod.disponivel ? "" : "produto-indisponivel");
  tr.dataset.id = prod.id;

  // Coluna 1: Foto + Nome + Descrição
  const tdPrincipal = criar("td");
  const celulaPrincipal = criar("div", "produto-celula-principal");
  const textos = criar("div", "produto-celula-textos");

  const linhaTitulo = criar("div", "produto-card-meta");
  linhaTitulo.append(criar("span", "produto-nome-admin", prod.nome));
  if (!prod.disponivel) {
    linhaTitulo.append(criar("span", "badge-esgotado", "Esgotado"));
  }
  textos.append(linhaTitulo);

  if (prod.descricao) {
    textos.append(criar("span", "produto-desc-admin", prod.descricao));
  }

  celulaPrincipal.append(criarMiniaturaProduto(prod), textos);
  tdPrincipal.append(celulaPrincipal);

  // Coluna 2: Categoria
  const tdCategoria = criar("td");
  const nomeCat = categoriasPorId.get(prod.categoria_id)?.nome || "Sem categoria";
  tdCategoria.append(criar("span", "produto-categoria-tag", nomeCat));

  // Coluna 3: Preço
  const tdPreco = criar("td");
  tdPreco.append(criar("span", "produto-preco-admin", formatarMoeda(prod.preco_centavos)));

  // Coluna 4: Disponível
  const tdDisponivel = criar("td");
  tdDisponivel.append(criarInterruptorDisponivel(prod, "tab"));

  // Coluna 5: Ordem (subir/descer na categoria)
  const tdOrdem = criar("td");
  tdOrdem.append(criarBotoesOrdem(prod));

  // Coluna 6: Ações (editar/excluir)
  const tdAcoes = criar("td");
  tdAcoes.append(criarBotoesEditarExcluir(prod));

  tr.append(tdPrincipal, tdCategoria, tdPreco, tdDisponivel, tdOrdem, tdAcoes);
  return tr;
}

function criarCardMobile(prod) {
  const card = criar(
    "article",
    `produto-card-admin${prod.disponivel ? "" : " produto-indisponivel"}`
  );
  card.dataset.id = prod.id;

  const topo = criar("div", "produto-card-topo");
  const corpo = criar("div", "produto-card-corpo");

  const nomeEl = criar("h2", "produto-nome-admin", prod.nome);
  corpo.append(nomeEl);

  if (prod.descricao) {
    corpo.append(criar("p", "produto-desc-admin", prod.descricao));
  }

  const meta = criar("div", "produto-card-meta");
  const nomeCat = categoriasPorId.get(prod.categoria_id)?.nome || "Sem categoria";
  meta.append(
    criar("span", "produto-preco-admin", formatarMoeda(prod.preco_centavos)),
    criar("span", "produto-categoria-tag", nomeCat)
  );
  if (!prod.disponivel) {
    meta.append(criar("span", "badge-esgotado", "Esgotado"));
  }
  corpo.append(meta);

  topo.append(criarMiniaturaProduto(prod), corpo);

  const rodape = criar("div", "produto-card-rodape");
  const acoesUnificadas = criar("div", "admin-acoes-grupo");
  acoesUnificadas.append(
    ...criarBotoesOrdem(prod).childNodes,
    ...criarBotoesEditarExcluir(prod).childNodes
  );

  rodape.append(criarInterruptorDisponivel(prod, "mob"), acoesUnificadas);
  card.append(topo, rodape);
  return card;
}

function renderizarProdutos() {
  estadoEl.removeAttribute("aria-busy");

  if (produtos.length === 0) {
    mostrarEstado({
      icone: "sacola",
      titulo: "Nenhum produto ainda",
      texto:
        categorias.length === 0
          ? "Crie primeiro uma categoria e depois cadastre o primeiro produto do cardápio."
          : "Cadastre o primeiro produto para começar a montar o cardápio do restaurante.",
      botao:
        categorias.length === 0
          ? { texto: "Criar categoria primeiro", href: "categorias.html" }
          : { texto: "Novo produto", acao: abrirModalCriar },
    });
    return;
  }

  const filtrados = obterProdutosFiltrados();
  if (filtrados.length === 0) {
    mostrarEstado({
      icone: "busca",
      titulo: "Nenhum produto encontrado",
      texto: "Não encontramos produtos para o filtro ou termo buscado.",
      botao: {
        texto: "Limpar filtros",
        acao: () => {
          termoBusca = "";
          categoriaFiltroId = "";
          campoBusca.value = "";
          filtroCategoria.value = "";
          renderizarProdutos();
        },
      },
    });
    return;
  }

  estadoEl.replaceChildren();
  areaProdutosEl.hidden = false;

  tabelaCorpoEl.replaceChildren(...filtrados.map(criarLinhaTabela));
  cardsMobileEl.replaceChildren(...filtrados.map(criarCardMobile));
}

/* ---------------------------------------------------------------------
   Filtros (busca com debounce + select de categoria)
   --------------------------------------------------------------------- */
const aplicarBuscaDebounced = debounce((valor) => {
  termoBusca = valor;
  renderizarProdutos();
}, 220);

campoBusca.addEventListener("input", (e) => {
  aplicarBuscaDebounced(e.target.value);
});

filtroCategoria.addEventListener("change", (e) => {
  categoriaFiltroId = e.target.value;
  renderizarProdutos();
});

/* ---------------------------------------------------------------------
   Alternar "Disponível" (grava na hora e desfaz em caso de erro)
   --------------------------------------------------------------------- */
async function alternarDisponivel(prod, inputEl) {
  const valorAnterior = Boolean(prod.disponivel);
  const novoValor = inputEl.checked;
  prod.disponivel = novoValor;
  inputEl.disabled = true;
  renderizarProdutos();

  try {
    const { error } = await supabase
      .from("produtos")
      .update({ disponivel: novoValor })
      .eq("id", prod.id)
      .eq("restaurante_id", restauranteId);

    if (error) throw error;

    mostrarToast(
      novoValor
        ? `"${prod.nome}" marcado como disponível.`
        : `"${prod.nome}" marcado como esgotado.`,
      "sucesso"
    );
  } catch (erro) {
    console.error("[admin/produtos] erro ao alternar disponibilidade:", erro);
    prod.disponivel = valorAnterior;
    mostrarToast(
      "Não foi possível atualizar a disponibilidade. Alteração desfeita.",
      "erro"
    );
  } finally {
    renderizarProdutos();
  }
}

/* ---------------------------------------------------------------------
   Reordenar produto dentro da mesma categoria
   --------------------------------------------------------------------- */
async function moverProdutoNaCategoria(prod, direcao) {
  const irmaos = obterProdutosDaCategoria(prod.categoria_id);
  const indice = irmaos.findIndex((p) => p.id === prod.id);
  const indiceVizinho = indice + direcao;

  if (reordenandoProduto || indice === -1 || indiceVizinho < 0 || indiceVizinho >= irmaos.length) {
    return;
  }

  const atual = irmaos[indice];
  const vizinho = irmaos[indiceVizinho];
  const ordemOriginalAtual = atual.ordem;
  const ordemOriginalVizinho = vizinho.ordem;

  let novaOrdemAtual = ordemOriginalVizinho;
  let novaOrdemVizinho = ordemOriginalAtual;
  if (novaOrdemAtual === novaOrdemVizinho) {
    novaOrdemAtual = indiceVizinho;
    novaOrdemVizinho = indice;
  }

  reordenandoProduto = true;
  atual.ordem = novaOrdemAtual;
  vizinho.ordem = novaOrdemVizinho;
  ordenarProdutosLocal();
  renderizarProdutos();

  try {
    const [res1, res2] = await Promise.all([
      supabase
        .from("produtos")
        .update({ ordem: novaOrdemAtual })
        .eq("id", atual.id)
        .eq("restaurante_id", restauranteId),
      supabase
        .from("produtos")
        .update({ ordem: novaOrdemVizinho })
        .eq("id", vizinho.id)
        .eq("restaurante_id", restauranteId),
    ]);

    if (res1.error) throw res1.error;
    if (res2.error) throw res2.error;
  } catch (erro) {
    console.error("[admin/produtos] erro ao reordenar produto:", erro);
    atual.ordem = ordemOriginalAtual;
    vizinho.ordem = ordemOriginalVizinho;
    ordenarProdutosLocal();
    mostrarToast("Não foi possível alterar a ordem do produto.", "erro");
  } finally {
    reordenandoProduto = false;
    renderizarProdutos();
  }
}

/* ---------------------------------------------------------------------
   Processamento de Foto via Canvas (máx 1000px, WEBP 0.82 com fallback JPEG)
   --------------------------------------------------------------------- */
function mostrarProgressoFoto(porcentagem, texto) {
  fotoProgresso.hidden = false;
  fotoProgressoBarra.style.width = `${Math.max(0, Math.min(100, porcentagem))}%`;
  fotoProgressoTexto.textContent = texto;
}

function ocultarProgressoFoto() {
  fotoProgresso.hidden = true;
  fotoProgressoBarra.style.width = "0%";
}

function limparPreviewTemporario() {
  if (urlPreviewTemporaria) {
    URL.revokeObjectURL(urlPreviewTemporaria);
    urlPreviewTemporaria = null;
  }
  blobFotoProcessada = null;
  campoFoto.value = "";
}

function atualizarPreviewCaixa(urlImagem) {
  fotoPreviewCaixa.replaceChildren();
  const urlSegura = urlImagemSegura(urlImagem, { permitirBlob: true }); if (urlSegura) {
    const img = document.createElement("img");
    img.alt = "Pré-visualização da foto do produto";
    img.addEventListener(
      "error",
      () => {
        fotoPreviewCaixa.replaceChildren();
        comIcone(fotoPreviewCaixa, "imagem", 28);
      },
      { once: true }
    );
    img.src = urlSegura;
    fotoPreviewCaixa.append(img);
    rotuloEscolherFoto.textContent = "Trocar foto";
    btnRemoverFoto.hidden = false;
  } else {
    comIcone(fotoPreviewCaixa, "imagem", 28);
    rotuloEscolherFoto.textContent = "Escolher foto";
    btnRemoverFoto.hidden = true;
  }
}

function carregarImagemDeArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    const urlObj = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(urlObj);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(urlObj);
      reject(new Error("Não foi possível ler o arquivo de imagem selecionado."));
    };
    img.src = urlObj;
  });
}

function canvasParaBlob(canvas, mimeType, qualidade) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, qualidade);
  });
}

/**
 * Redimensiona a imagem para no máximo 1000px no maior lado e comprime
 * para WEBP (ou JPEG se o navegador não suportar WEBP no canvas),
 * garantindo que o arquivo final tenha menos de 2 MB.
 */
async function processarFotoNoNavegador(arquivo) {
  const img = await carregarImagemDeArquivo(arquivo);
  const largOriginal = img.naturalWidth || img.width;
  const altOriginal = img.naturalHeight || img.height;

  if (!largOriginal || !altOriginal) {
    throw new Error("A imagem selecionada é inválida.");
  }

  let largura = largOriginal;
  let altura = altOriginal;
  const maiorLado = Math.max(largura, altura);

  if (maiorLado > LADO_MAX_PX) {
    const escala = LADO_MAX_PX / maiorLado;
    largura = Math.max(1, Math.round(largura * escala));
    altura = Math.max(1, Math.round(altura * escala));
  }

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Seu navegador não suporta processamento de imagem.");
  }

  ctx.drawImage(img, 0, 0, largura, altura);

  // Tenta gerar WEBP primeiro; se o navegador devolver outro tipo, cai para JPEG
  const qualidades = [QUALIDADE_INICIAL, 0.72, 0.6];
  for (const q of qualidades) {
    let blob = await canvasParaBlob(canvas, "image/webp", q);
    let ext = "webp";

    if (!blob || blob.type !== "image/webp") {
      // Preenche fundo claro antes de exportar para JPEG caso a imagem tivesse transparência
      const canvasJpeg = document.createElement("canvas");
      canvasJpeg.width = largura;
      canvasJpeg.height = altura;
      const ctxJpeg = canvasJpeg.getContext("2d");
      ctxJpeg.fillStyle = "#FFF8F0";
      ctxJpeg.fillRect(0, 0, largura, altura);
      ctxJpeg.drawImage(canvas, 0, 0);

      blob = await canvasParaBlob(canvasJpeg, "image/jpeg", q);
      ext = "jpg";
    }

    if (blob && blob.size <= TAMANHO_MAX_SAIDA_BYTES) {
      return { blob, ext };
    }
  }

  throw new Error("A imagem continuou acima de 2 MB após a compressão. Tente outra foto.");
}

campoFoto.addEventListener("change", async () => {
  const arquivo = campoFoto.files?.[0];
  if (!arquivo) return;

  ocultarAlerta(erroFormProduto);

  if (!TIPOS_IMAGEM_ACEITOS.has(arquivo.type)) {
    campoFoto.value = "";
    mostrarAlerta(
      erroFormProduto,
      "Formato de arquivo não suportado. Envie uma imagem JPG, PNG ou WEBP."
    );
    return;
  }

  if (arquivo.size > TAMANHO_MAX_ENTRADA_BYTES) {
    campoFoto.value = "";
    mostrarAlerta(
      erroFormProduto,
      "A imagem escolhida ultrapassa 5 MB. Escolha um arquivo menor."
    );
    return;
  }

  processandoFoto = true;
  mostrarProgressoFoto(35, "Otimizando imagem...");

  try {
    const { blob, ext } = await processarFotoNoNavegador(arquivo);
    limparPreviewTemporario();
    blobFotoProcessada = blob;
    extensaoFotoProcessada = ext;
    removerFotoExistente = false;

    urlPreviewTemporaria = URL.createObjectURL(blob);
    atualizarPreviewCaixa(urlPreviewTemporaria);
    mostrarProgressoFoto(100, "Foto pronta para envio.");
    setTimeout(ocultarProgressoFoto, 900);
  } catch (erro) {
    console.error("[admin/produtos] erro ao processar imagem:", erro);
    campoFoto.value = "";
    ocultarProgressoFoto();
    mostrarAlerta(
      erroFormProduto,
      erro?.message || "Não foi possível processar a imagem selecionada."
    );
  } finally {
    processandoFoto = false;
  }
});

btnRemoverFoto.addEventListener("click", () => {
  limparPreviewTemporario();
  removerFotoExistente = true;
  atualizarPreviewCaixa(null);
  ocultarProgressoFoto();
});

/* ---------------------------------------------------------------------
   Contadores de caracteres e abertura do modal de Criar / Editar
   --------------------------------------------------------------------- */
function atualizarContadoresFormulario() {
  contadorNome.textContent = `${campoNome.value.length}/60`;
  contadorDescricao.textContent = `${campoDescricao.value.length}/200`;
}

campoNome.addEventListener("input", () => {
  atualizarContadoresFormulario();
  campoNome.classList.remove("campo-invalido");
  ocultarAlerta(erroFormProduto);
});

campoDescricao.addEventListener("input", atualizarContadoresFormulario);

campoCategoria.addEventListener("change", () => {
  campoCategoria.classList.remove("campo-invalido");
  ocultarAlerta(erroFormProduto);
});

function abrirModalCriar() {
  if (categorias.length === 0) {
    mostrarToast("Crie pelo menos uma categoria antes de cadastrar produtos.", "info");
    window.location.href = "categorias.html";
    return;
  }

  produtoEditando = null;
  modalProdutoTitulo.textContent = "Novo produto";
  btnSalvarProduto.textContent = "Criar produto";

  formProduto.reset();
  campoNome.value = "";
  campoDescricao.value = "";
  campoCategoria.value = categoriaFiltroId || categorias[0]?.id || "";
  definirPrecoNoCampo(0);
  campoDisponivel.checked = true;

  campoNome.classList.remove("campo-invalido");
  campoCategoria.classList.remove("campo-invalido");
  campoPreco.classList.remove("campo-invalido");

  limparPreviewTemporario();
  fotoExistenteUrl = null;
  removerFotoExistente = false;
  atualizarPreviewCaixa(null);
  ocultarProgressoFoto();
  ocultarAlerta(erroFormProduto);
  atualizarContadoresFormulario();

  modalForm.abrir(campoNome);
}

function abrirModalEditar(prod) {
  produtoEditando = prod;
  modalProdutoTitulo.textContent = "Editar produto";
  btnSalvarProduto.textContent = "Salvar alterações";

  campoNome.value = prod.nome || "";
  campoDescricao.value = prod.descricao || "";
  campoCategoria.value = prod.categoria_id || "";
  definirPrecoNoCampo(prod.preco_centavos);
  campoDisponivel.checked = Boolean(prod.disponivel);

  campoNome.classList.remove("campo-invalido");
  campoCategoria.classList.remove("campo-invalido");
  campoPreco.classList.remove("campo-invalido");

  limparPreviewTemporario();
  fotoExistenteUrl = prod.imagem_url || null;
  removerFotoExistente = false;
  atualizarPreviewCaixa(fotoExistenteUrl);
  ocultarProgressoFoto();
  ocultarAlerta(erroFormProduto);
  atualizarContadoresFormulario();

  modalForm.abrir(campoNome);
}

btnNovoProduto.addEventListener("click", abrirModalCriar);
btnFecharModalProduto.addEventListener("click", () => modalForm.fechar());
btnCancelarProduto.addEventListener("click", () => modalForm.fechar());

/* ---------------------------------------------------------------------
   Envio da foto ao Supabase Storage e gravação do produto
   --------------------------------------------------------------------- */
function gerarIdentificadorUnico() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function enviarFotoStorage(blob, ext) {
  const caminho = `${restauranteId}/${gerarIdentificadorUnico()}.${ext}`;
  mostrarProgressoFoto(65, "Enviando foto...");

  const { error: erroUpload } = await supabase.storage
    .from("produtos")
    .upload(caminho, blob, {
      contentType: blob.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (erroUpload) throw erroUpload;

  const { data } = supabase.storage.from("produtos").getPublicUrl(caminho);
  mostrarProgressoFoto(100, "Foto enviada.");
  return { urlPublica: data?.publicUrl || null, caminho };
}

formProduto.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (salvandoProduto || processandoFoto) return;

  ocultarAlerta(erroFormProduto);

  const nomeLimpo = campoNome.value.trim();
  const descricaoLimpa = campoDescricao.value.trim();
  const categoriaIdEscolhida = campoCategoria.value;

  if (!nomeLimpo) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormProduto, "Informe o nome do produto.");
    campoNome.focus();
    return;
  }

  if (nomeLimpo.length > 60) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormProduto, "O nome do produto deve ter no máximo 60 caracteres.");
    campoNome.focus();
    return;
  }

  if (!categoriaIdEscolhida) {
    campoCategoria.classList.add("campo-invalido");
    mostrarAlerta(erroFormProduto, "Selecione a categoria do produto.");
    campoCategoria.focus();
    return;
  }

  if (descricaoLimpa.length > 200) {
    mostrarAlerta(erroFormProduto, "A descrição deve ter no máximo 200 caracteres.");
    campoDescricao.focus();
    return;
  }

  if (precoCentavosAtual < 0 || precoCentavosAtual > PRECO_MAX_CENTAVOS) {
    campoPreco.classList.add("campo-invalido");
    mostrarAlerta(erroFormProduto, "O preço deve estar entre R$ 0,00 e R$ 9.999,99.");
    campoPreco.focus();
    return;
  }

  const nomeDuplicado = produtos.some(
    (p) =>
      p.nome.trim().toLowerCase() === nomeLimpo.toLowerCase() &&
      p.id !== produtoEditando?.id
  );
  if (nomeDuplicado) {
    campoNome.classList.add("campo-invalido");
    mostrarAlerta(erroFormProduto, "Já existe um produto com esse nome neste restaurante.");
    campoNome.focus();
    return;
  }

  salvandoProduto = true;
  btnSalvarProduto.disabled = true;
  btnSalvarProduto.classList.add("btn-carregando");

  let novaFotoSubida = null;

  try {
    // 1. Se há uma nova foto processada, faz o upload primeiro.
    // Se o upload falhar, aborta antes de tocar no banco mantendo o formulário intacto!
    if (blobFotoProcessada) {
      try {
        novaFotoSubida = await enviarFotoStorage(blobFotoProcessada, extensaoFotoProcessada);
      } catch (erroFoto) {
        console.error("[admin/produtos] falha no envio da foto:", erroFoto);
        ocultarProgressoFoto();
        mostrarAlerta(
          erroFormProduto,
          "Não foi possível enviar a foto agora. Seus dados foram mantidos: tente salvar novamente ou clique em \"Remover foto\" para salvar o produto sem imagem."
        );
        return;
      }
    }

    // Define qual imagem_url será gravada no banco
    let imagemUrlFinal = fotoExistenteUrl;
    if (novaFotoSubida?.urlPublica) {
      imagemUrlFinal = novaFotoSubida.urlPublica;
    } else if (removerFotoExistente) {
      imagemUrlFinal = null;
    }

    // 2. Grava o produto no banco
    if (produtoEditando) {
      const mudouCategoria = produtoEditando.categoria_id !== categoriaIdEscolhida;
      let ordemParaSalvar = produtoEditando.ordem;

      if (mudouCategoria) {
        const prodsDestino = obterProdutosDaCategoria(categoriaIdEscolhida);
        const maxOrdem = prodsDestino.reduce((m, p) => Math.max(m, Number(p.ordem) || 0), 0);
        ordemParaSalvar = prodsDestino.length === 0 ? 1 : maxOrdem + 1;
      }

      const { data, error } = await supabase
        .from("produtos")
        .update({
          nome: nomeLimpo,
          descricao: descricaoLimpa || null,
          categoria_id: categoriaIdEscolhida,
          preco_centavos: precoCentavosAtual,
          disponivel: campoDisponivel.checked,
          imagem_url: imagemUrlFinal,
          ordem: ordemParaSalvar,
        })
        .eq("id", produtoEditando.id)
        .eq("restaurante_id", restauranteId)
        .select(
          "id, restaurante_id, categoria_id, nome, descricao, preco_centavos, imagem_url, disponivel, ordem"
        )
        .single();

      if (error) throw error;

      // Se trocou ou removeu a foto que existia, remove a antiga do bucket (melhor esforço)
      if (
        fotoExistenteUrl &&
        (novaFotoSubida?.urlPublica || removerFotoExistente) &&
        fotoExistenteUrl !== imagemUrlFinal
      ) {
        removerFotoAntigaSilencioso(fotoExistenteUrl, restauranteId);
      }

      const idx = produtos.findIndex((p) => p.id === produtoEditando.id);
      if (idx >= 0 && data) produtos[idx] = data;

      mostrarToast("Produto atualizado com sucesso.", "sucesso");
    } else {
      const prodsCategoria = obterProdutosDaCategoria(categoriaIdEscolhida);
      const maxOrdem = prodsCategoria.reduce((m, p) => Math.max(m, Number(p.ordem) || 0), 0);
      const novaOrdem = prodsCategoria.length === 0 ? 1 : maxOrdem + 1;

      const { data, error } = await supabase
        .from("produtos")
        .insert({
          restaurante_id: restauranteId,
          categoria_id: categoriaIdEscolhida,
          nome: nomeLimpo,
          descricao: descricaoLimpa || null,
          preco_centavos: precoCentavosAtual,
          disponivel: campoDisponivel.checked,
          imagem_url: imagemUrlFinal,
          ordem: novaOrdem,
        })
        .select(
          "id, restaurante_id, categoria_id, nome, descricao, preco_centavos, imagem_url, disponivel, ordem"
        )
        .single();

      if (error) throw error;

      if (data) produtos.push(data);
      mostrarToast("Produto criado com sucesso.", "sucesso");
    }

    ordenarProdutosLocal();
    modalForm.fechar();
    renderizarProdutos();
  } catch (erro) {
    console.error("[admin/produtos] erro ao salvar produto:", erro);

    // Se a foto nova tinha subido mas o insert/update no banco falhou, limpa o arquivo órfão
    if (novaFotoSubida?.urlPublica) {
      removerFotoAntigaSilencioso(novaFotoSubida.urlPublica, restauranteId);
    }

    if (erro?.code === "23505") {
      campoNome.classList.add("campo-invalido");
      mostrarAlerta(
        erroFormProduto,
        "Já existe um produto com esse nome neste restaurante."
      );
    } else {
      mostrarAlerta(
        erroFormProduto,
        "Não foi possível salvar o produto. Seus dados foram preservados; tente novamente."
      );
    }
  } finally {
    salvandoProduto = false;
    btnSalvarProduto.disabled = false;
    btnSalvarProduto.classList.remove("btn-carregando");
  }
});

/* ---------------------------------------------------------------------
   Excluir produto (com tratamento de vínculo em itens_pedido 23503)
   --------------------------------------------------------------------- */
function abrirModalExcluir(prod) {
  produtoExcluindo = prod;
  ocultarAlerta(erroExcluirProduto);
  modalExcluirDesc.textContent = `Tem certeza de que deseja excluir o produto "${prod.nome}"?`;
  modalExcluir.abrir(btnCancelarExcluir);
}

btnFecharModalExcluir.addEventListener("click", () => modalExcluir.fechar());
btnCancelarExcluir.addEventListener("click", () => modalExcluir.fechar());

btnConfirmarExcluir.addEventListener("click", async () => {
  if (excluindoProduto || !produtoExcluindo) return;

  ocultarAlerta(erroExcluirProduto);
  excluindoProduto = true;
  btnConfirmarExcluir.disabled = true;
  btnConfirmarExcluir.classList.add("btn-carregando");

  const prodAlvo = produtoExcluindo;

  try {
    const { error } = await supabase
      .from("produtos")
      .delete()
      .eq("id", prodAlvo.id)
      .eq("restaurante_id", restauranteId);

    if (error) throw error;

    if (prodAlvo.imagem_url) {
      removerFotoAntigaSilencioso(prodAlvo.imagem_url, restauranteId);
    }

    produtos = produtos.filter((p) => p.id !== prodAlvo.id);
    modalExcluir.fechar();
    renderizarProdutos();
    mostrarToast("Produto excluído com sucesso.", "sucesso");
  } catch (erro) {
    console.error("[admin/produtos] erro ao excluir produto:", erro);
    const jaVendido =
      erro?.code === "23503" ||
      String(erro?.message || "").toLowerCase().includes("foreign key") ||
      String(erro?.details || "").toLowerCase().includes("itens_pedido");

    if (jaVendido) {
      mostrarAlerta(
        erroExcluirProduto,
        "Este produto já foi vendido e não pode ser excluído. Marque como indisponível para tirá-lo do cardápio."
      );
    } else {
      mostrarAlerta(
        erroExcluirProduto,
        "Não foi possível excluir o produto. Tente novamente."
      );
    }
  } finally {
    excluindoProduto = false;
    btnConfirmarExcluir.disabled = false;
    btnConfirmarExcluir.classList.remove("btn-carregando");
  }
});

/* ---------------------------------------------------------------------
   Inicialização
   --------------------------------------------------------------------- */
async function iniciar() {
  $$("[data-icone]").forEach((el) => {
    el.innerHTML = iconeAdmin(el.dataset.icone, Number(el.dataset.tamanho) || 20);
  });

  const contexto = await iniciarAdmin("produtos");
  if (!contexto) return;

  restauranteId = contexto.restaurante_id;
  await carregarCatalogo();
}

iniciar();
