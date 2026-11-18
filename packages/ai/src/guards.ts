/**
 * Guardas determinísticas (OWASP LLM01, LLM02, LLM05, LLM07): código comum, sem modelo.
 * Funcionam mesmo que o modelo seja enganado — os testes de ataque usam um modelo falso que
 * obedece a tudo, e a guarda tem que segurar sozinha.
 */

/** Vai no trace: se uma guarda mudar, dá para comparar antes e depois. */
export const GUARDS_VERSION = 'guarda-v1';

/** Caracteres invisíveis usados para esconder instruções (largura zero, direção de texto). */
export const INVISIBLE_CHARS = /[\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;

/** Domínios que podem aparecer numa resposta. `.example` é reservado: nunca aponta para um site real. */
export const ALLOWED_LINK_HOSTS = ['bancoorla.example'];

// ---------------------------------------------------------------- entrada: dados sensíveis

export type SensitiveKind = 'secret' | 'card' | 'cpf' | 'email' | 'phone';

const SECRET_WORD = String.raw`(?:senha|password|pin|token|c[oó]digo(?:\s+(?:do\s+token|do\s+sms|por\s+sms|de\s+seguran[cç]a|de\s+verifica[cç][aã]o|de\s+acesso|que\s+(?:chegou|recebi)))?)`;
// "senha: abc" / "token = abc" — com dois-pontos ou igual, qualquer valor é segredo.
const SECRET_WITH_SEPARATOR = new RegExp(
  String.raw`\b(${SECRET_WORD}|cvv|cvc)(\s*[:=]\s*)(\S+)`,
  'gi',
);
// "minha senha é 482913" / "código 123456" — sem separador, só valor com número e 4+ caracteres
// ("errei a senha 3 vezes" não é segredo).
const SECRET_WITH_DIGITS = new RegExp(
  String.raw`\b(${SECRET_WORD})(\s+(?:[eé]|eh)\s+|\s+)((?=\S*\d)\S{4,})`,
  'gi',
);
const CVV = /\b(cvv|cvc|c[oó]digo de seguran[cç]a)(\s*(?:[eé]|eh|:|=)?\s*)(\d{3,4})\b/gi;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const PHONE = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\b\d{2})[\s-]?9?\d{4}[\s-]?\d{4}\b/g;

/** Algoritmo de Luhn: o dígito verificador dos cartões. Evita esconder qualquer número comprido. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/**
 * Esconde dados sensíveis ANTES de gravar ou mandar para a IA (minimização, LGPD). A ordem
 * importa: cartão antes de CPF e telefone (os padrões menores pegariam pedaços do número).
 */
export function maskSensitiveData(text: string): { text: string; found: SensitiveKind[] } {
  const found = new Set<SensitiveKind>();
  const hide =
    (kind: SensitiveKind, label: string) =>
    (...m: string[]) => {
      found.add(kind);
      return kind === 'secret' ? `${m[1]}${m[2]}${label}` : label;
    };

  let out = text
    .replace(CVV, hide('secret', '[oculto]'))
    .replace(SECRET_WITH_SEPARATOR, hide('secret', '[oculto]'))
    .replace(SECRET_WITH_DIGITS, hide('secret', '[oculto]'));
  out = out.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || !isLuhnValid(digits)) return match;
    found.add('card');
    return '[cartão oculto]';
  });
  out = out
    .replace(CPF, hide('cpf', '[CPF oculto]'))
    .replace(EMAIL, hide('email', '[e-mail oculto]'))
    .replace(PHONE, hide('phone', '[telefone oculto]'));
  return { text: out, found: [...found] };
}

// ---------------------------------------------------------------- entrada: tentativa de manipular a IA

export type InjectionKind =
  | 'override'
  | 'role_play'
  | 'prompt_extraction'
  | 'role_marker'
  | 'other_customer_data'
  | 'encoded';

/** Minúsculas, sem acento, sem caractere invisível, espaços simples: "IGNÓRE" e "ignore" são iguais. */
export function normalizeForGuard(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(INVISIBLE_CHARS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const INJECTION_PATTERNS: [InjectionKind, RegExp][] = [
  [
    'override',
    /\b(ignore|ignora|ignorar|esqueca|esquece|desconsidere|desconsidera|despreze)\b.{0,30}\b(instrucoes|instrucao|regras|ordens|diretrizes|orientacoes|comandos|prompt)\b/,
  ],
  ['override', /\b(ignore|disregard|forget)\b.{0,30}\b(instructions|rules|guidelines|prompt)\b/],
  ['override', /\bignora\b.{0,30}\b(instrucciones|reglas)\b/],
  ['override', /\b(novas|nova) (instrucoes|regras)\b|\bnew instructions\b/],
  [
    'role_play',
    /\b(voce|vc) (agora )?(e|sera|vai ser) (um |o |a |uma )?(gerente|administrador|admin|desenvolvedor|dev|hacker|dan|outro assistente|outra ia|ia sem regras|sem (regras|restricoes|limites|filtro))\b/,
  ],
  ['role_play', /\b(a partir de agora|de agora em diante) (voce|vc)\b/],
  ['role_play', /\b(finja|finge|fingir|imagine que voce|aja como|atue como|se comporte como)\b/],
  ['role_play', /\b(you are now|act as|pretend (to be|you are)|roleplay as)\b/],
  [
    'role_play',
    /\b(modo|mode) (desenvolvedor|developer|dev|dan|deus|god|sem (restricoes|filtro|regras)|jailbreak|livre)\b|\bjailbreak\b/,
  ],
  // "quais são as regras do Pix?" é pergunta normal: só conta pedir as regras DA IA.
  [
    'prompt_extraction',
    /\b(repita|repete|mostre|mostra|revele|revela|imprima|exiba|copie|cole|traduza|resuma|liste|escreva|me (de|da|passa|mostra|conta|diz|diga)|qual (e|era|foi)|quais (sao|eram|foram))\b.{0,40}\b(prompt|(suas|tuas) (instrucoes|regras|ordens|diretrizes)|(instrucoes|regras|configuracao|mensagem) (do|de) sistema|(instrucoes|regras) (iniciais|originais|ocultas|secretas|internas)|texto (acima|anterior|inicial))\b/,
  ],
  [
    'prompt_extraction',
    /\b(system prompt|prompt (do|de) sistema|initial prompt|your instructions)\b/,
  ],
  [
    'prompt_extraction',
    /\b(tudo|todo o texto|o que esta) (que esta )?(acima|antes desta mensagem)\b/,
  ],
  // "sistema:" só no começo ("o sistema: caiu" é queixa normal); em inglês, em qualquer lugar.
  [
    'role_marker',
    /^(system|sistema|assistant|assistente|developer)\s*:|\b(system|assistant|developer)\s*:/,
  ],
  ['role_marker', /<\|[^|]{0,20}\|>|\[\/?inst\]|<<\/?sys>>|<\/?\s*(trechos|pergunta|system)\s*>/],
  // "mandei Pix pra conta de outra pessoa" é normal: só conta PEDIR dado de outra pessoa.
  [
    'other_customer_data',
    /\b(mostre|mostra|me (passa|passe|da|de|diga|diz|fala|informa|informe|mostra)|qual (e|o|a|era)|quais (sao|os|as)|quero (ver|saber)|consulte|consulta|acesse|acessa|liste|lista|busque|busca|puxe|puxa)\b.{0,40}\b(cpf|saldo|dados|extrato|telefone|endereco|cartao|historico|conversa|mensagens)s?\b.{0,30}\b(outro cliente|outra cliente|outra pessoa|outro usuario|cliente anterior|ultimo cliente|todos os clientes|qualquer cliente|outros clientes|terceiros?|meu vizinho|minha vizinha)\b/,
  ],
  [
    'other_customer_data',
    /\b(liste|lista|mostre|mostra|me (passa|da|de)) .{0,20}\b(clientes|usuarios|cpfs)\b/,
  ],
];

// Junta letras soltas: "i g n o r e" → "ignore" (truque para escapar de padrões).
const spacedLetters = (s: string) => s.replace(/\b(\w) (?=\w\b)/g, '$1');

function matchInjection(normalized: string): InjectionKind | null {
  for (const candidate of [normalized, spacedLetters(normalized)]) {
    for (const [kind, pattern] of INJECTION_PATTERNS) if (pattern.test(candidate)) return kind;
  }
  return null;
}

/** Tenta decodificar trechos em base64 (truque para esconder a instrução do filtro). */
function decodedBase64Parts(text: string): string[] {
  const parts: string[] = [];
  for (const token of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    // Só conta se virou texto legível (base64 de verdade, não uma palavra comprida qualquer).
    const printable = decoded.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '');
    if (decoded.length >= 8 && printable.length / decoded.length > 0.9) parts.push(decoded);
  }
  return parts;
}

/** Tentativa de mudar o comportamento da IA, extrair o prompt ou pegar dado de outra pessoa. */
export function detectInjection(text: string): InjectionKind | null {
  const direct = matchInjection(normalizeForGuard(text));
  if (direct) return direct;
  for (const decoded of decodedBase64Parts(text)) {
    if (matchInjection(normalizeForGuard(decoded))) return 'encoded';
  }
  return null;
}

// ---------------------------------------------------------------- saída: o que a IA nunca pode dizer

export type OutputIssue =
  'asks_secret' | 'personal_data' | 'link' | 'prompt_leak' | 'markup' | 'claims_action';

const SECRET_TERM =
  /\b(senha|token|codigo (do token|do sms|por sms|recebido|que (chegou|recebeu)|de seguranca|de verificacao)|cvv|cvc|numero (completo )?do (seu )?cartao|dados do (seu )?cartao)\b/;
const REQUEST =
  /\bme (passa|passe|envia|envie|manda|mande|informa|informe|diga|diz|fala|fale|conta|conte)\b|\b(informe|informar|forneca|fornecer|envie|enviar|mande|mandar|passe|passar|compartilhe|compartilhar|diga|dizer|repasse|digite aqui|confirme aqui)\b|\bqual (e|seria) (a |o )?(sua|seu)\b|\bprecis(o|amos) d[aeo]s? (sua|seu)\b/;
const NEGATION = /\b(nunca|nao|jamais|nem|ninguem)\b/;
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const BARE_DOMAIN =
  /\b(?:[a-z0-9-]+\.)+(?:com|net|org|br|io|xyz|info|app|me|ly|co|site|online|top|link|click|shop)\b/i;
const MARKUP = /<\s*\/?\s*[a-z][^>]*>|javascript:|data:text\/html/i;
const CLAIMS_ACTION =
  /\b(realizei|fiz|enviei|transferi|liberei|aumentei|desbloqueei|bloqueei|cancelei|aprovei|estornei|alterei|reativei)\b/;
const LEAK_MARKERS =
  /sem_resposta|base de conhecimento|<\s*\/?\s*(trechos|pergunta)|\bregras:|prompt/;

const words = (s: string) =>
  normalizeForGuard(s)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

function shingles(text: string, size: number): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(' '));
  return out;
}

function hostAllowed(url: string, allowed: string[]): boolean {
  try {
    const host = new URL(url.startsWith('www.') ? `https://${url}` : url).hostname;
    return allowed.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Confere uma resposta antes de ela chegar ao cliente. Devolve o primeiro problema achado, ou
 * `null`. Vale para FAQ e RAG: se alguém envenenar a base, a guarda ainda segura.
 */
export function checkOutput(
  text: string,
  options: { allowedHosts?: string[]; leakSources?: string[] } = {},
): OutputIssue | null {
  const allowed = options.allowedHosts ?? ALLOWED_LINK_HOSTS;
  const normalized = normalizeForGuard(text);

  if (MARKUP.test(text)) return 'markup';

  for (const sentence of normalized.split(/[.!?\n;]+/)) {
    if (SECRET_TERM.test(sentence) && REQUEST.test(sentence) && !NEGATION.test(sentence)) {
      return 'asks_secret';
    }
  }

  if (maskSensitiveData(text).found.length > 0) return 'personal_data';

  for (const url of text.match(LINK) ?? []) if (!hostAllowed(url, allowed)) return 'link';
  const withoutUrls = text.replace(LINK, ' ');
  const bare = withoutUrls.match(BARE_DOMAIN);
  if (bare && !allowed.includes(bare[0].toLowerCase())) return 'link';

  if (CLAIMS_ACTION.test(normalized)) return 'claims_action';

  if (LEAK_MARKERS.test(normalized)) return 'prompt_leak';
  const answer = shingles(text, 8);
  for (const source of options.leakSources ?? []) {
    for (const s of shingles(source, 8)) if (answer.has(s)) return 'prompt_leak';
  }
  return null;
}
