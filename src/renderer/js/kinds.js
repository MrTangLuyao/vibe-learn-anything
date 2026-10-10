/* Icons and colours for chapter kinds and page kinds. */

export const CHAPTER_KINDS = {
  lesson: { icon: 'book-open', color: '#5aa1e3' },
  reading: { icon: 'file-text', color: '#5aa1e3' },
  code: { icon: 'code-xml', color: '#2f6fb3' },
  lab: { icon: 'flask-conical', color: '#2f6fb3' },
  quiz: { icon: 'list-checks', color: '#8a6fe0' },
  video: { icon: 'play', color: '#d9534f' },
  slides: { icon: 'presentation', color: '#d98a3a' },
  project: { icon: 'rocket', color: '#d97757' },
  survey: { icon: 'clipboard-list', color: '#3fa37a' },
};

export const PAGE_KINDS = {
  doc: { icon: 'file-text', color: '#e0b35a' },
  reading: { icon: 'book-open', color: '#e0b35a' },
  code: { icon: 'code-xml', color: '#e0b35a' },
  lab: { icon: 'flask-conical', color: '#e0b35a' },
  quiz: { icon: 'list-checks', color: '#e0645c' },
  survey: { icon: 'clipboard-list', color: '#e0645c' },
  slides: { icon: 'presentation', color: '#e0645c' },
  pdf: { icon: 'file', color: '#e0453c' },
  video: { icon: 'play', color: '#e0453c' },
  project: { icon: 'rocket', color: '#d97757' },
};

export function chapterKind(ch) {
  return CHAPTER_KINDS[ch.kind] || CHAPTER_KINDS.lesson;
}

export function pageKind(kind) {
  return PAGE_KINDS[kind] || PAGE_KINDS.doc;
}
