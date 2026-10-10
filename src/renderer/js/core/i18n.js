/* t('key', { n: 3 }) → current language, falling back to Chinese, then the key. */
import { DICT } from './i18n-dict.js';

let lang = 'zh';

export function setLang(l) {
  lang = l === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
}

export function getLang() {
  return lang;
}

export function t(key, vars) {
  let s = DICT[lang]?.[key] ?? DICT.zh[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

/* Pick the right language from a course-supplied { zh, en } value or plain string. */
export function tl(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[lang] ?? value.zh ?? value.en ?? Object.values(value)[0] ?? '';
  return value ?? '';
}
