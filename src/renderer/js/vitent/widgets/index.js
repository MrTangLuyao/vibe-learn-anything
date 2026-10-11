/* Directive name → widget. Aliases (tip, warning, …) map through DIRECTIVES[name].alias. */
import { callout, details, reveal, tabs, columns, steps, toc, divider, fullscreen } from './basic.js';
import { slides } from './slides.js';
import { quiz, cloze, parsons, flashcards } from './quiz.js';
import { workspace } from './workspace.js';
import { pdf, video, audio, image, embed, html, doc, file } from './media.js';
import { button, ask, terminal } from './action.js';

export const WIDGETS = {
  callout, details, reveal, tabs, columns, steps, toc, divider, fullscreen,
  slides,
  quiz, cloze, parsons, flashcards,
  workspace,
  pdf, video, audio, image, embed, html, doc, file,
  button, ask, terminal,
};
