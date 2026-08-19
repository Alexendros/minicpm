import { marked } from '../vendor/marked/marked.esm.js';
import DOMPurify from '../vendor/dompurify/purify.es.mjs';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function render(text) {
  const source = String(text ?? '');
  try {
    const html = marked.parse(source, { gfm: true, breaks: true });
    const safe = DOMPurify.sanitize(html);
    return document.createRange().createContextualFragment(safe);
  } catch {
    const frag = document.createDocumentFragment();
    frag.textContent = source;
    return frag;
  }
}