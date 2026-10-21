/* =====================================================================
   carrinho.js  |  FASE 3.2  |  Estado do carrinho (ES module)
   Sem dependência do Supabase. Persistido em localStorage, uma chave
   por restaurante: "carrinho:" + restauranteId.

   IMPORTANTE (segurança): nome e preço guardados aqui servem SÓ para
   exibição. O navegador pode ser adulterado; ao finalizar o pedido, o
   servidor (criar_pedido) recalcula tudo a partir do banco e usa apenas
   produtoId, quantidade e observação.
   ===================================================================== */

const PREFIXO = "carrinho:";
const CHAVE_CONTEXTO = "contexto";
const QTD_MAXIMA = 20;
const OBS_MAXIMA = 140;

/* ---------------------------------------------------------------------
   Persistência tolerante a falhas
   --------------------------------------------------------------------- */
function chave(restauranteId) {
  return PREFIXO + restauranteId;
}

function itemValido(i) {
  return (
    i && typeof i === "object" &&
    typeof i.produtoId === "string" &&
    Number.isInteger(i.quantidade) && i.quantidade >= 1 && i.quantidade <= QTD_MAXIMA &&
    Number.isFinite(i.precoCentavos) && i.precoCentavos >= 0
  );
}

function urlImagemSegura(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Lê os itens; JSON corrompido ou formato inesperado -> recomeça vazio. */
export function obter(restauranteId) {
  try {
    const bruto = localStorage.getItem(chave(restauranteId));
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    if (!Array.isArray(lista)) throw new Error("formato inválido");
    return lista.filter(itemValido).map((i) => ({
      produtoId: i.produtoId,
      nome: String(i.nome ?? ""),
      precoCentavos: i.precoCentavos,
      imagemUrl: urlImagemSegura(i.imagemUrl),
      quantidade: i.quantidade,
      observacao: String(i.observacao ?? "").slice(0, OBS_MAXIMA),
    }));
  } catch (erro) {
    console.warn("[carrinho] dados corrompidos descartados", erro);
    try { localStorage.removeItem(chave(restauranteId)); } catch { /* sem acesso ao storage */ }
    return [];
  }
}

function salvar(restauranteId, itens) {
  try {
    if (itens.length === 0) localStorage.removeItem(chave(restauranteId));
    else localStorage.setItem(chave(restauranteId), JSON.stringify(itens));
  } catch (erro) {
    console.warn("[carrinho] não foi possível salvar", erro); // modo privado/cota cheia
  }
  window.dispatchEvent(new CustomEvent("carrinho:mudou", { detail: { restauranteId } }));
}

function limitar(qtd) {
  const n = Math.floor(Number(qtd));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(QTD_MAXIMA, n));
}

/* ---------------------------------------------------------------------
   API
   --------------------------------------------------------------------- */

/** produto: {id, nome, preco_centavos, imagem_url}. Soma se já existir. */
export function adicionar(restauranteId, produto, quantidade = 1, observacao = "") {
  const qtd = limitar(quantidade);
  if (qtd < 1 || !produto?.id) return;

  const itens = obter(restauranteId);
  const obs = String(observacao ?? "").trim().slice(0, OBS_MAXIMA);
  const existente = itens.find((i) => i.produtoId === produto.id);

  if (existente) {
    existente.quantidade = Math.min(QTD_MAXIMA, existente.quantidade + qtd);
    if (obs) existente.observacao = obs;
    // Atualiza os dados de exibição com a versão mais recente do cardápio.
    existente.nome = produto.nome;
    existente.precoCentavos = produto.preco_centavos;
  } else {
    itens.push({
      produtoId: produto.id,
      nome: produto.nome,
      precoCentavos: produto.preco_centavos,
      imagemUrl: urlImagemSegura(produto.imagem_url),
      quantidade: qtd,
      observacao: obs,
    });
  }
  salvar(restauranteId, itens);
}

/** 0 remove; máximo de 20 por item. */
export function alterarQuantidade(restauranteId, produtoId, novaQuantidade) {
  const qtd = limitar(novaQuantidade);
  let itens = obter(restauranteId);
  if (qtd === 0) {
    itens = itens.filter((i) => i.produtoId !== produtoId);
  } else {
    const item = itens.find((i) => i.produtoId === produtoId);
    if (!item) return;
    item.quantidade = qtd;
  }
  salvar(restauranteId, itens);
}

export function remover(restauranteId, produtoId) {
  salvar(restauranteId, obter(restauranteId).filter((i) => i.produtoId !== produtoId));
}

export function limpar(restauranteId) {
  salvar(restauranteId, []);
}

/** Atualiza a observação do item (texto limpo, máximo 140 caracteres). */
export function alterarObservacao(restauranteId, produtoId, observacao) {
  const itens = obter(restauranteId);
  const item = itens.find((i) => i.produtoId === produtoId);
  if (!item) return;
  item.observacao = String(observacao ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ") // sem caracteres de controle
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, OBS_MAXIMA);
  salvar(restauranteId, itens);
}

/**
 * Corrige o preço de EXIBIÇÃO de um item (ex.: o preço mudou no cardápio).
 * Continua sendo só exibição: o servidor recalcula no pedido.
 */
export function atualizarPrecoExibicao(restauranteId, produtoId, novoPrecoCentavos) {
  const preco = Number(novoPrecoCentavos);
  if (!Number.isInteger(preco) || preco < 0) return;
  const itens = obter(restauranteId);
  const item = itens.find((i) => i.produtoId === produtoId);
  if (!item || item.precoCentavos === preco) return;
  item.precoCentavos = preco;
  salvar(restauranteId, itens);
}

export function quantidadeTotal(restauranteId) {
  return obter(restauranteId).reduce((soma, i) => soma + i.quantidade, 0);
}

/** Total só para exibição (o servidor recalcula no pedido). */
export function totalCentavos(restauranteId) {
  return obter(restauranteId).reduce((soma, i) => soma + i.precoCentavos * i.quantidade, 0);
}

export function quantidadeDoProduto(restauranteId, produtoId) {
  return obter(restauranteId).find((i) => i.produtoId === produtoId)?.quantidade ?? 0;
}

/* ---------------------------------------------------------------------
   Contexto (restaurante + mesa), vindo do QR Code
   --------------------------------------------------------------------- */
function sanitizarMesa(mesa) {
  return String(mesa ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 10);
}

function sanitizarSlug(slug) {
  return String(slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
}

/** Guarda {slug, mesa}. undefined mantém o valor salvo; mesa "" limpa a mesa. */
export function salvarContexto({ slug, mesa } = {}) {
  const atual = obterContexto();
  const novo = {
    slug: slug ? sanitizarSlug(slug) : atual.slug,
    mesa: mesa !== undefined && mesa !== null ? sanitizarMesa(mesa) : atual.mesa,
  };
  try {
    localStorage.setItem(CHAVE_CONTEXTO, JSON.stringify(novo));
  } catch (erro) {
    console.warn("[carrinho] contexto não salvo", erro);
  }
}

/** Sempre devolve {slug, mesa} (strings, possivelmente vazias). */
export function obterContexto() {
  try {
    const dados = JSON.parse(localStorage.getItem(CHAVE_CONTEXTO) || "null");
    return {
      slug: sanitizarSlug(dados?.slug),
      mesa: sanitizarMesa(dados?.mesa),
    };
  } catch {
    return { slug: "", mesa: "" };
  }
}
