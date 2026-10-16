/* =====================================================================
   supabase.js  |  FASE 2  |  Cliente único do Supabase (ES module)
   ===================================================================== */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ╔═══════════════════════════════════════════════════════════════════╗
   ║  >>> PREENCHA AQUI <<<                                            ║
   ║  Onde achar: Supabase > seu projeto > Project Settings > API      ║
   ║    - Project URL          -> SUPABASE_URL                         ║
   ║    - anon / public key    -> SUPABASE_ANON_KEY                    ║
   ║                                                                   ║
   ║  ⚠ NUNCA coloque a chave "service_role" neste projeto.            ║
   ║    Ela ignora o RLS e dá acesso TOTAL ao banco. Como este código  ║
   ║    roda no navegador, qualquer pessoa poderia lê-la.              ║
   ║    A anon key é pública por design: quem protege os dados é o RLS.║
   ╚═══════════════════════════════════════════════════════════════════╝ */
const SUPABASE_URL = "https://pzyiytgsfcfpktjpzvzp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_sEtv_1_wbPbAfKWbd7NRGQ_0aG4Xh5y";

/** true quando as duas constantes acima já foram preenchidas. */
export const supabaseConfigurado =
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_URL.endsWith(".supabase.co") &&
  (SUPABASE_ANON_KEY.startsWith("sb_publishable_") || SUPABASE_ANON_KEY.startsWith("eyJ"));

if (!supabaseConfigurado) {
  console.warn(
    "[supabase] Credenciais ainda não configuradas em js/supabase.js. " +
      "Login e dados não funcionarão até você preenchê-las."
  );
}

// PORQUÊ do valor reserva: createClient() lança erro se a URL for inválida,
// o que derrubaria até a tela de início (que nem precisa de dados). Com um
// endereço válido de mentira a página abre normalmente e só as chamadas
// ao banco falham — com mensagem tratada em auth.js.
export const supabase = createClient(
  supabaseConfigurado ? SUPABASE_URL : "https://projeto-nao-configurado.supabase.co",
  supabaseConfigurado ? SUPABASE_ANON_KEY : "chave-nao-configurada",
  {
    auth: {
      persistSession: true,   // mantém o login após fechar a aba
      autoRefreshToken: true, // renova o token sozinho
      detectSessionInUrl: true,
    },
  }
);
