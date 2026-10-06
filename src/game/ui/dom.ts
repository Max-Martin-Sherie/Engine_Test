/** Tiny DOM helpers shared by the screens. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(label: string, action: string, className: string): HTMLButtonElement {
  const b = el('button', `btn ${className}`);
  b.type = 'button';
  b.dataset['action'] = action;
  b.append(el('span', 'btn-label', label));
  return b;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function section(name: string, label: string): HTMLElement {
  const s = el('section', `screen screen-${name}`);
  s.dataset['screen'] = name;
  s.setAttribute('aria-label', label);
  s.hidden = true;
  return s;
}

/** Marks the matching option of a segmented control. */
export function markSelected(buttons: readonly HTMLElement[], value: string): void {
  for (const b of buttons) b.classList.toggle('is-on', b.dataset['value'] === value);
}
