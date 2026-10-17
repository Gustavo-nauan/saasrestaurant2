/* =====================================================================
   auth.js  |  FASE 2  |  Autenticação e controle de acesso (ES module)
   Depende de: supabase.js
   Convenção: funções que falham LANÇAM um Error com mensagem JÁ em
   português e pronta para exibir (nunca texto técnico cru).
   ===================================================================== */

import { supabase, supabaseConfigurado } from "./supabase.js";

/* ---------------------------------------------------------------------
   Tradução de erros
   Usamos o `code` estável do Supabase quando existe; o texto em inglês
   (que pode mudar entre versões) fica só como plano B.
   --------------------------------------------------------------------- */
function traduzirErro(erro) {
  if (!erro) return "Algo deu errado. Tente novamente.";

  if (!supabaseConfigurado) {
    return "O sistema ainda não foi configurado. Avise o responsável.";
  }

  const codigo = String(erro.code || "").toLowerCase();
  const texto = String(erro.message || "").toLowerCase();

  if (codigo === "invalid_credentials" || texto.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }
  if (
    codigo === "user_already_exists" ||
    codigo === "email_exists" ||
    texto.includes("already registered") ||
    texto.includes("already been registered")
  ) {
    return "Este e-mail já está cadastrado. Tente entrar.";
  }
  if (codigo === "weak_password" || texto.includes("at least") || texto.includes("password should")) {
    return "A senha é muito curta. Use pelo menos 6 caracteres.";
  }
  if (codigo === "email_not_confirmed" || texto.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.";
  }
  if (codigo === "validation_failed" || codigo === "email_address_invalid" || texto.includes("invalid email")) {
    return "Digite um e-mail válido.";
  }
  if (codigo === "over_request_rate_limit" || codigo === "over_email_send_rate_limit" || texto.includes("rate limit")) {
    return "Muitas tentativas. Aguarde um instante e tente de novo.";
  }
  if (texto.includes("failed to fetch") || texto.includes("network") || texto.includes("fetch")) {
    return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return "Não foi possível concluir. Tente novamente em instantes.";
}

function falhar(erro) {
  // O erro técnico vai para o console (útil para quem desenvolve);
  // o usuário só vê a versão em português.
  console.error("[auth]", erro);
  throw new Error(traduzirErro(erro));
}

/* ---------------------------------------------------------------------
   Ações
   --------------------------------------------------------------------- */

/**
 * Cria a conta. O nome vai em user_metadata: assim, mesmo quando o
 * perfil ainda não pode ser gravado (confirmação de e-mail ligada), o dado
 * não se perde — garantirPerfil() o usa no primeiro login.
 * Devolve {sessaoCriada: true} ou {sessaoCriada: false, precisaConfirmarEmail: true}.
 */
export async function cadastrarCliente({ nome, email, senha }) {
  try {
    const { data, error } = await supabase.auth.signUp({
      email: String(email).trim(),
      password: senha,
      options: {
        data: {
          nome: String(nome).trim(),
        },
      },
    });
    if (error) throw error;

    // Com confirmação de e-mail ligada, o Supabase NÃO devolve erro para um
    // e-mail já existente (evita revelar quem tem conta): devolve um usuário
    // "de mentira" sem identities. Detectamos aqui para avisar corretamente.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw { code: "user_already_exists", message: "User already registered" };
    }

    // Sem sessão = confirmação de e-mail ligada. Sem sessão o RLS não deixa
    // gravar em perfis_clientes (daria erro de permissão): não tentamos.
    if (!data.session) {
      return { sessaoCriada: false, precisaConfirmarEmail: true };
    }

    const perfilOk = await garantirPerfil();
    return { sessaoCriada: true, perfilOk };
  } catch (erro) {
    falhar(erro);
  }
}

/** Login sem efeitos colaterais (usado por entrar e entrarFuncionario). */
async function entrarBase(email, senha) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim(),
      password: senha,
    });
    if (error) throw error;
    return data;
  } catch (erro) {
    falhar(erro);
  }
}

/** Login de cliente. Garante a linha em perfis_clientes e devolve {perfilOk}. */
export async function entrar(email, senha) {
  await entrarBase(email, senha);
  const perfilOk = await garantirPerfil();
  return { perfilOk };
}

/**
 * Garante que o usuário logado tenha linha em perfis_clientes.
 * - Já existe -> true.
 * - Não existe e há nome no user_metadata -> cria (upsert pelo id) -> true.
 * - Sem nome no metadata (ex.: conta de funcionário) -> não cria nada -> false.
 */
export async function garantirPerfil() {
  const sessao = await obterSessao();
  if (!sessao) return false;

  const usuario = sessao.user;
  try {
    const { data: existente, error: erroBusca } = await supabase
      .from("perfis_clientes")
      .select("id")
      .eq("id", usuario.id)
      .maybeSingle();
    if (erroBusca) throw erroBusca;
    if (existente) return true;

    const meta = usuario.user_metadata || {};
    const nome = String(meta.nome ?? "").trim();
    if (!nome) return false;

    // Telefone não é coletado: a coluna fica nula (ver SQL/06_telefone_opcional.sql).
    const { error: erroCriar } = await supabase.from("perfis_clientes").upsert({
      id: usuario.id,
      nome,
    });
    if (erroCriar) throw erroCriar;
    return true;
  } catch (erro) {
    console.error("[auth]", erro);
    return false;
  }
}

export async function sair() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (erro) {
    falhar(erro);
  }
}

/** Sessão atual (ou null). Lê do armazenamento local, sem ir à rede. */
export async function obterSessao() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("[auth]", error);
    return null;
  }
  return data.session;
}

/** Usuário logado validado no servidor (ou null). */
export async function obterUsuario() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

/** {papel, restaurante_id} do funcionário ativo logado, ou null. */
export async function obterFuncionario() {
  const sessao = await obterSessao();
  if (!sessao) return null;

  const { data, error } = await supabase
    .from("funcionarios")
    .select("papel, restaurante_id")
    .eq("id", sessao.user.id)
    .eq("ativo", true)
    .maybeSingle();

  if (error) {
    console.error("[auth]", error);
    return null;
  }
  return data ?? null;
}

/**
 * Login exclusivo da equipe. Se a conta não for de funcionário ativo, a
 * sessão é encerrada NA HORA: um cliente nunca fica logado por esta porta.
 * Devolve {papel, restaurante_id}.
 */
export async function entrarFuncionario(email, senha) {
  await entrarBase(email, senha); // já lança erro traduzido se falhar

  const funcionario = await obterFuncionario();
  if (!funcionario) {
    try {
      await sair();
    } catch (erro) {
      console.error("[auth]", erro);
    }
    throw new Error("Este acesso é exclusivo da equipe.");
  }
  return funcionario;
}

/**
 * Login unificado (cliente, cozinha e admin).
 * Autentica primeiro e, SOMENTE depois, consulta a tabela funcionarios
 * (apenas ativo = true) para descobrir o tipo da conta.
 * - Se for funcionário ativo: devolve { tipo: "funcionario", papel, restaurante_id, destino }
 * - Caso contrário: chama garantirPerfil() e devolve { tipo: "cliente", perfilOk }
 */
export async function entrarComPapel(email, senha) {
  await entrarBase(email, senha); // mesma mensagem de erro para qualquer conta

  const funcionario = await obterFuncionario();
  if (funcionario) {
    return {
      tipo: "funcionario",
      papel: funcionario.papel,
      restaurante_id: funcionario.restaurante_id,
      destino: destinoPorPapel(funcionario.papel),
    };
  }

  const perfilOk = await garantirPerfil();
  return { tipo: "cliente", perfilOk };
}

/**
 * Página inicial de cada papel. Caminhos relativos às pastas de 1º nível
 * (cliente/, cozinha/, admin/, equipe/).
 * Devolve null para papel desconhecido (a tela decide o que fazer).
 */
export function destinoPorPapel(papel) {
  const destinos = {
    cozinha: "../cozinha/painel.html",
    admin: "../admin/produtos.html",
  };
  return destinos[papel] ?? null;
}

/* ---------------------------------------------------------------------
   Guardas de página
   location.replace (e não href): o usuário não consegue voltar com o
   botão "voltar" para a página protegida.
   Os destinos padrão usam "../" porque as páginas protegidas ficam em
   pastas de um nível (cliente/, cozinha/, admin/, equipe/).
   --------------------------------------------------------------------- */

/**
 * Exige sessão E linha em perfis_clientes.
 * Se a sessão ativa for de um funcionário, redireciona para o destino
 * do papel dele em vez de mandar ao login, evitando loops.
 * Devolve a sessão ou redireciona.
 */
export async function exigirCliente(redirecionarPara = "../cliente/login.html") {
  const sessao = await obterSessao();
  if (!sessao) {
    window.location.replace(redirecionarPara);
    return null;
  }

  const funcionario = await obterFuncionario();
  if (funcionario) {
    const destino = destinoPorPapel(funcionario.papel);
    window.location.replace(destino || redirecionarPara);
    return null;
  }

  const { data, error } = await supabase
    .from("perfis_clientes")
    .select("id")
    .eq("id", sessao.user.id)
    .maybeSingle();

  if (error) console.error("[auth]", error);
  if (error || !data) {
    window.location.replace(redirecionarPara);
    return null;
  }
  return sessao;
}

/**
 * Exige funcionário ativo com um dos papéis permitidos.
 * - Sem sessão: redireciona para redirecionarPara ("../cliente/login.html").
 * - Funcionário ativo com outro papel (ex.: cozinha tentando abrir admin):
 *   redireciona para o destino do papel dele.
 * - Cliente logado tentando abrir área interna: redireciona ao cardápio.
 * Devolve {papel, restaurante_id} ou redireciona.
 */
export async function exigirFuncionario(
  papelsPermitidos = ["cozinha", "admin"],
  redirecionarPara = "../cliente/login.html"
) {
  const sessao = await obterSessao();
  if (!sessao) {
    window.location.replace(redirecionarPara);
    return null;
  }

  const funcionario = await obterFuncionario();
  if (!funcionario) {
    const ehCliente = await garantirPerfil();
    window.location.replace(ehCliente ? "../cliente/cardapio.html" : redirecionarPara);
    return null;
  }

  if (!papelsPermitidos.includes(funcionario.papel)) {
    const destino = destinoPorPapel(funcionario.papel);
    window.location.replace(destino || redirecionarPara);
    return null;
  }

  return funcionario;
}

