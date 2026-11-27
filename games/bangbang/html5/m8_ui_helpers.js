// Small DOM helpers. Native/user text is always textContent, never HTML.
export const numberText = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('vi-VN') : '—';
export function nativeText(value) {
  return String(value ?? '').replace(/#ENTER#/g, '\n').replace(/#COLOR_[0-9a-fA-F]+_/g, '')
    .replace(/_END#/g, '').replace(/<[^>]*>/g, '');
}
export function element(tag, text, className = '') {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
export function actionButton(text, handler, {disabled = false, className = '', title = '', testId = ''} = {}) {
  const node = element('button', text, `m8-button ${className}`.trim());
  node.type = 'button'; node.disabled = !!disabled;
  if (title) node.title = title;
  if (testId) node.dataset.testid = testId;
  if (handler) node.addEventListener('click', handler);
  return node;
}
export function assetImage(asset, alt = '', className = '') {
  const node = element('img', null, className); node.alt = alt; node.draggable = false;
  node.decoding = 'async';
  if (asset?.url && !/\.swf(?:$|[?#])/i.test(asset.url)) node.src = asset.url;
  else { node.hidden = true; node.dataset.assetMissing = 'true'; }
  return node;
}
export function field(label, input) {
  const node = element('label', null, 'm8-field');
  node.append(element('span', label), input); return node;
}
export function selectInput(options, value, label = '') {
  const input = element('select'); if (label) input.setAttribute('aria-label', label);
  for (const row of options) {
    const option = element('option', row.label); option.value = String(row.value);
    option.disabled = !!row.disabled; input.append(option);
  }
  if (value != null) input.value = String(value);
  return input;
}
export function textInput(value = '', {placeholder = '', maxLength = 100, type = 'text'} = {}) {
  const input = element('input'); input.type = type; input.value = String(value);
  input.placeholder = placeholder; input.maxLength = maxLength; return input;
}
export function note(text, kind = '') { return element('p', text, `m8-note ${kind}`.trim()); }
export function setText(node, value) {
  const text = String(value ?? ''); if (node.textContent !== text) node.textContent = text;
}
