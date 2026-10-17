/* =====================================================================
   marca.js  |  FASE 5.1  |  Bloco de marca e favicon padronizados (ES module)
   Monta <img class="marca-logo"> + <span class="marca-nome">Pedido na Mão</span>
   em qualquer elemento [data-marca] e define o favicon da página usando
   endereços absolutos calculados a partir de import.meta.url.
   ===================================================================== */

const NOME_MARCA = "Pedido na Mão";
const URL_LOGO_PADRAO = new URL("../assets/img/logo.png", import.meta.url).href;
const URL_LOGO_CLARA = new URL("../assets/img/logo-branca.png", import.meta.url).href;

/**
 * Faz um pedido HEAD ao endereço que falhou e registra no console
 * o status HTTP e o content-type devolvidos pelo servidor.
 */
async function diagnosticarFalhaImagem(urlTentada) {
  console.warn("[marca] não foi possível carregar a logo:", urlTentada);
  try {
    const resposta = await fetch(urlTentada, { method: "HEAD", cache: "no-store" });
    const tipo = resposta.headers.get("content-type") || "desconhecido";
    console.warn(
      `[marca] diagnóstico HEAD -> status: ${resposta.status} (${resposta.statusText}), content-type: ${tipo}, url: ${urlTentada}`
    );
  } catch (erro) {
    console.warn("[marca] diagnóstico HEAD falhou (erro de rede/CORS):", urlTentada, erro);
  }
}

/**
 * Monta o conteúdo de um elemento [data-marca="padrao"|"clara"].
 */
export function montarBlocoMarca(el) {
  if (!el) return;
  const variante = el.getAttribute("data-marca") === "clara" ? "clara" : "padrao";
  el.classList.add("marca");

  const img = document.createElement("img");
  img.className = "marca-logo";
  img.alt = "";
  img.width = 32;
  img.height = 32;
  img.decoding = "async";

  let tentouFallbackPadrao = false;

  img.addEventListener("error", () => {
    const urlFalhou = img.src || (variante === "clara" ? URL_LOGO_CLARA : URL_LOGO_PADRAO);
    diagnosticarFalhaImagem(urlFalhou);

    if (variante === "clara" && !tentouFallbackPadrao && urlFalhou !== URL_LOGO_PADRAO) {
      tentouFallbackPadrao = true;
      img.src = URL_LOGO_PADRAO;
      return;
    }

    img.hidden = true;
  });

  img.src = variante === "clara" ? URL_LOGO_CLARA : URL_LOGO_PADRAO;

  const nome = document.createElement("span");
  nome.className = "marca-nome";
  nome.textContent = NOME_MARCA;

  el.replaceChildren(img, nome);
}

/**
 * Cria ou atualiza o <link rel="icon" type="image/png"> no <head>.
 */
export function aplicarFavicon() {
  if (!document.head) return;
  let link = document.head.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/png";
  link.href = URL_LOGO_PADRAO;
}

/**
 * Inicializa todos os blocos [data-marca] presentes no documento e o favicon.
 */
export function inicializarMarca(raiz = document) {
  aplicarFavicon();
  raiz.querySelectorAll("[data-marca]").forEach(montarBlocoMarca);
}

inicializarMarca();
