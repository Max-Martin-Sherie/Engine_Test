/** Tiny DOM helpers shared by the screens. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
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

/** A gold coin icon followed by an amount, e.g. "120". */
export function coinAmount(amount: number | string, className = ''): HTMLElement {
  const wrap = el('span', `coin-amount ${className}`.trim());
  wrap.append(el('i', 'coin'), el('span', 'coin-number', String(amount)));
  return wrap;
}

export function section(name: string, label: string, dim: 'light' | 'heavy'): HTMLElement {
  const s = el('section', `screen screen-${dim}`);
  s.dataset['screen'] = name;
  s.setAttribute('aria-label', label);
  s.hidden = true;
  return s;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
