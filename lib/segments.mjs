// 长回复分段：一段一个气泡，依次显示。纯逻辑，QML 以 import "lib/segments.mjs" 导入，node 可直接单测。
// 模型被要求「分几段说、段间换行」；这里按换行拆，太长的段再按句子切，太短的并进相邻段，
// 所以模型不守规矩时也能正常分段。

/** 每个气泡最多多少字（中文按字、英文按字符） */
const MAX_CHARS = { zh: 50, en: 120 };
/** 短于这个长度的段并进相邻段（放得下的话） */
const MIN_CHARS = { zh: 12, en: 30 };

/** 句末断点：中文标点直接断；英文 . ! ? 后面要有空白 */
const SENTENCE = /[^。！？!?；;…]*?(?:[。！？!?；;…]+[”’"')）]*|[.!?]+[”’"')）]*(?=\s)|$)\s*/g;
const CLAUSE = /[^，,、：:]*?(?:[，,、：:]+|$)\s*/g;

/** 按正则切成片段（保留标点）。不用 matchAll / flatMap：QML 的 JS 引擎不一定支持 */
function pieces(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) out.push(m[0].trim());
    if (m.index === re.lastIndex) re.lastIndex++;
    if (re.lastIndex > text.length) break;
  }
  return out;
}

const concatMap = (list, fn) => list.reduce((acc, x) => acc.concat(fn(x)), []);

/** 片段贪心装箱：每箱不超过 max；单个片段超长就硬切 */
function pack(parts, max, sep) {
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (p.length > max) {
      if (cur) out.push(cur);
      cur = '';
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
      continue;
    }
    if (!cur) cur = p;
    else if ((cur + sep + p).length <= max) cur += sep + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 一段太长：先按句子装箱，句子还太长就按逗号，再不行硬切 */
function splitLong(para, max, sep) {
  if (para.length <= max) return [para];
  const sentences = concatMap(pieces(para, SENTENCE), (s) => (s.length > max ? pieces(s, CLAUSE) : [s]));
  return pack(sentences, max, sep);
}

/** 文本 → 气泡段落数组（至少一段；空文本返回 []） */
export function split(text, lang) {
  const max = MAX_CHARS[lang] || MAX_CHARS.zh;
  const min = MIN_CHARS[lang] || MIN_CHARS.zh;
  const sep = lang === 'en' ? ' ' : '';
  const paras = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const segs = concatMap(paras, (p) => splitLong(p, max, sep));
  // 太短的段并进前一段（保留换行，同一个气泡里分行显示）
  const out = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (s.length < min || prev.length < min) && (prev + '\n' + s).length <= max) out[out.length - 1] = prev + '\n' + s;
    else out.push(s);
  }
  return out;
}

/** 一段气泡停留多久（毫秒）：按阅读速度估，最后一段多留一会儿 */
export function duration(text, lang, last) {
  const perChar = lang === 'en' ? 70 : 220;
  const ms = Math.min(15000, Math.max(4000, String(text || '').length * perChar));
  return last ? ms + 4000 : ms;
}

/**
 * 模型有时在 JSON 字符串里直接换行（没写成 \n），JSON.parse 会失败。
 * 把字符串里的裸换行转义后再解析；字符串外的换行原样保留。
 */
export function escapeNewlinesInStrings(s) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of String(s)) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === '\n') {
        out += '\\n';
        continue;
      } else if (ch === '\r') continue;
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}
