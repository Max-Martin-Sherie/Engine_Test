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

/** Sets a button's main label (the first line), keeping any sub-label. */
export function setLabel(b: HTMLElement, text: string): void {
  const label = b.querySelector('.btn-label');
  if (label && label.textContent !== text) label.textContent = text;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function section(name: string, label: string, dim: 'light' | 'heavy'): HTMLElement {
  const s = el('section', `screen screen-${dim}`);
  s.dataset['screen'] = name;
  s.setAttribute('aria-label', label);
  s.hidden = true;
  return s;
}

/** Three stars, the first `earned` of them lit. */
export function starRow(earned: number, className = 'stars'): HTMLElement {
  const row = el('span', className);
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${earned} of 3 stars`);
  for (let i = 0; i < 3; i++) row.append(el('i', i < earned ? 'star on' : 'star'));
  return row;
}
