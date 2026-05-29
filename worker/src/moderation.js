const CONFUSABLES = new Map([
  ["а", "a"], ["е", "e"], ["о", "o"], ["р", "p"], ["с", "c"], ["х", "x"], ["у", "y"], ["к", "k"], ["і", "i"],
  ["Α", "a"], ["Β", "b"], ["Ε", "e"], ["Η", "h"], ["Ι", "i"], ["Κ", "k"], ["Μ", "m"], ["Ν", "n"], ["Ο", "o"],
  ["Ρ", "p"], ["Τ", "t"], ["Υ", "y"], ["Χ", "x"], ["Ζ", "z"],
  ["０", "0"], ["１", "1"], ["２", "2"], ["３", "3"], ["４", "4"], ["５", "5"], ["６", "6"], ["７", "7"], ["８", "8"], ["９", "9"],
  ["ｂ", "b"], ["ｃ", "c"], ["ｄ", "d"], ["ｆ", "f"], ["ｇ", "g"], ["ｈ", "h"], ["ｉ", "i"], ["ｊ", "j"], ["ｋ", "k"],
  ["ｌ", "l"], ["ｍ", "m"], ["ｎ", "n"], ["ｐ", "p"], ["ｑ", "q"], ["ｒ", "r"], ["ｓ", "s"], ["ｔ", "t"], ["ｕ", "u"],
  ["ｖ", "v"], ["ｗ", "w"], ["ｘ", "x"], ["ｙ", "y"], ["ｚ", "z"],
]);

const LEET = new Map([
  ["0", "o"], ["1", "i"], ["3", "e"], ["4", "a"], ["5", "s"], ["7", "t"], ["8", "b"], ["9", "g"],
  ["@", "a"], ["$", "s"], ["!", "i"], ["|", "i"], ["+", "t"], ["(", "c"], [")", "c"], ["[", "c"], ["]", "c"],
]);

const NSFW_LEXICON = [
  "anal","anilingus","anus","arsehole","ass","asses","asshole","ballsack","bareback","bbw","bdsm","beastiality",
  "bestiality","bigtits","bimbo","blowjob","bondage","boner","boobs","brothel","bukkake","butthole","buttplug",
  "camgirl","camslut","camwhore","childporn","clit","clitoris","clits","cock","cocks","cocksuck","coochie","cooch",
  "coon","coprophilia","cornhole","creampie","cuck","cuckold","cum","cumshot","cumslut","cunnilingus","cunt",
  "deepthroat","dick","dicks","dildo","dildos","dominatrix","doggystyle","dommy","dommes","dyke","ejaculate",
  "ejaculation","erect","erection","escort","fap","fellatio","femdom","fetish","filthy","fingering","fisting",
  "flogging","fondle","footjob","foreskin","fornicate","fuck","fucked","fucker","fucking","fucks","futanari",
  "gangbang","gangrape","gilf","gloryhole","gonad","groped","groping","handjob","hardcore","harlot","hentai",
  "hooker","horny","hotwife","incest","jackoff","jerkoff","jerk","jizz","kink","kinky","labia","lewd","libido",
  "loli","lolicon","lolita","masochism","masturbate","masturbation","milf","molest","molestation","molester",
  "mosh","mounted","mountedslut","nipple","nipples","nsfw","nude","nudes","nudist","onlyfans","oral","orgasm",
  "orgasmic","orgy","paedophile","panties","pawg","pedo","pedophile","peeing","pegging","penetrate","penetration",
  "penis","penises","perv","perverse","pervert","pheromone","phonesex","piss","pissing","pegging","porn","porno",
  "pornography","pornstar","prick","pron","prostitute","prostitution","pube","pubes","pubic","puss","pussies",
  "pussy","queef","raped","rapes","raping","rapist","rectum","rimjob","rimming","sadism","sadomasochism",
  "salacious","scat","schlong","screwed","scrotum","semen","sexed","sexting","sexual","sexually","sexy","shaft",
  "shag","shagging","shemale","shibari","shibariropes","shitting","shota","shotacon","slut","sluts","slutty",
  "smut","smutty","snatch","sodomise","sodomize","sodomy","spank","spanked","spanking","sperm","squirter",
  "squirting","strapon","stripper","stripclub","suck","sucked","sucking","swinger","swingers","threesome","tit",
  "tits","titty","titties","topless","torture","tugjob","twat","twats","upskirt","urethra","urinate","vagina",
  "vaginas","vibrator","virgin","voyeur","vulva","wank","wanker","wanking","whore","whores","xrated",
  "loliporn","childmolester","molestkids","kiddie","jailbait","preteen","underage","minorporn",
  "kompromat","revenge","upskirts","creepshot","creepshots","candidteen","sextrade","sextrafficking",
];

const HARD_BLOCK_LEXICON = [
  "childporn","childmolester","kiddie","loli","lolicon","lolita","loliporn","molestkids","shota","shotacon",
  "preteen","underage","jailbait","minorporn","kindergartensex","preteenporn","cp","cpornography",
  "sextrafficking","traffickedminor","minortrafficking","csam",
];

const CONTEXT_FLAGS = [
  "not safe for work","18+","18 plus","over 18","adults only","explicit content","graphic content",
  "nsfw warning","mature content","adult only","18 and up","x rated","triple x","xxx",
];

function foldUnicode(s) {
  const decomposed = s.normalize("NFKD");
  let out = "";
  for (const ch of decomposed) {
    if (CONFUSABLES.has(ch)) { out += CONFUSABLES.get(ch); continue; }
    const code = ch.codePointAt(0);
    if (code >= 0x0300 && code <= 0x036f) continue;
    if (code >= 0x1ab0 && code <= 0x1aff) continue;
    if (code >= 0x1dc0 && code <= 0x1dff) continue;
    out += ch;
  }
  return out.toLowerCase();
}

function normalizeLeet(s) {
  let out = "";
  for (const ch of s) out += LEET.has(ch) ? LEET.get(ch) : ch;
  return out;
}

function stripFiller(s) {
  return s.replace(/[\s\u00a0_\-.,;:'"`~^*+=<>/\\|(){}\[\]?!@#%&]/g, "");
}

function buildVariants(input) {
  const lower = (input || "").toLowerCase();
  const folded = foldUnicode(lower);
  const leet = normalizeLeet(folded);
  return {
    raw: lower,
    folded,
    leet,
    compressedFolded: stripFiller(folded),
    compressedLeet: stripFiller(leet),
  };
}

function wordBoundaryHit(haystack, needle) {
  if (!haystack || needle.length < 3) return false;
  const re = new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

function compressedHit(haystack, needle) {
  if (!haystack || needle.length < 4) return false;
  return haystack.includes(needle);
}

function looseHit(needle, variants) {
  if (wordBoundaryHit(variants.folded, needle)) return true;
  if (wordBoundaryHit(variants.leet, needle)) return true;
  if (compressedHit(variants.compressedFolded, needle)) return true;
  if (compressedHit(variants.compressedLeet, needle)) return true;
  return false;
}

function fuzzyHit(needle, variants) {
  if (needle.length < 6) return false;
  const expanded = needle.replace(/(.)\1+/g, "$1");
  if (expanded !== needle && compressedHit(variants.compressedFolded, expanded)) return true;
  for (let i = 1; i < needle.length - 1; i++) {
    const skip = needle.slice(0, i) + needle.slice(i + 1);
    if (skip.length >= 5 && compressedHit(variants.compressedFolded, skip)) return true;
  }
  return false;
}

export function moderateText(input, opts = {}) {
  const text = String(input || "");
  if (!text.trim()) return { ok: true, reasons: [], severity: "none" };

  const limit = Number(opts.maxLength) || 32_000;
  if (text.length > limit) {
    return { ok: false, reasons: ["length"], severity: "policy" };
  }

  const variants = buildVariants(text);
  const hits = [];
  let hard = false;

  for (const term of HARD_BLOCK_LEXICON) {
    if (looseHit(term, variants) || fuzzyHit(term, variants)) {
      hits.push(term);
      hard = true;
    }
  }

  if (!hard) {
    for (const term of NSFW_LEXICON) {
      if (looseHit(term, variants) || fuzzyHit(term, variants)) {
        hits.push(term);
        if (hits.length >= 5) break;
      }
    }
  }

  const ctxHits = CONTEXT_FLAGS.filter(flag => variants.folded.includes(flag));
  if (ctxHits.length && hits.length === 0) {
    hits.push(...ctxHits);
  }

  if (hits.length === 0) return { ok: true, reasons: [], severity: "none" };

  return {
    ok: false,
    reasons: hits.slice(0, 5),
    severity: hard ? "hard" : "nsfw",
  };
}

export const _internal = { foldUnicode, normalizeLeet, stripFiller, buildVariants, looseHit, fuzzyHit };
