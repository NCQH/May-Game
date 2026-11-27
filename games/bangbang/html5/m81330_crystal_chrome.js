/* The audited reward movie needs its full, exact craft backdrop for native
 * ADD/OVERLAY blending. That opaque backdrop covers DOM-only craft labels and
 * controls below it. Repeat only those existing decorative pixels above the
 * movie; the real controls stay in their original inert native panel.
 *
 * No backdrop/frame/award/confirm is copied, no listener or focus target is
 * introduced, and no packet, wallet, inventory or animation state is changed.
 */
const snapshots = new WeakMap();
const decorativeClasses = ['cr-craft-art', 'cr-craft-heading', 'cr-craft-counter', 'cr-price'];
const decorativeButtons = new Set(['cr-craft-info', 'cr-craft-3', 'cr-craft-4', 'cr-craft-5', 'cr-craft-6']);
const excludedTags = new Set(['SCRIPT','STYLE','LINK','IFRAME','OBJECT','EMBED','AUDIO','VIDEO',
  'INPUT','SELECT','TEXTAREA','FORM']);
const STYLE = '.m81330-crystal-chrome,.m81330-crystal-chrome *{pointer-events:none!important;user-select:none!important}';

function decorative(node) {
  return decorativeClasses.some(name => node.classList.contains(name))
    || node.tagName === 'BUTTON' && decorativeButtons.has(node.dataset.testid);
}
function cloneDecoration(source) {
  // Native cloneNode does not copy addEventListener registrations. Strip
  // inline handlers and identity/focus attributes as well, including children.
  const copy = source.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    if (excludedTags.has(node.tagName)) { node.remove(); continue; }
    for (const name of node.getAttributeNames())
      if (name === 'id' || name.startsWith('data-') || name.startsWith('on')
          || ['tabindex','autofocus','accesskey','contenteditable','name','for','form'].includes(name))
        node.removeAttribute(name);
  }
  return copy;
}

export function releaseCrystalRewardChrome(reward) {
  if (!reward) return;
  snapshots.get(reward)?.remove(); snapshots.delete(reward);
}

/** Called after the owner renders its accepted native craft DOM. Position in
 * the reward's 1440×900 coordinate space is the native 1200×800 content origin,
 * not a second viewport fit. Original inline positions/classes remain exact.
 */
export function syncCrystalRewardChrome(reward, section) {
  releaseCrystalRewardChrome(reward);
  if (!reward || reward.disposed || !reward.root || !reward.movieHost || !reward.status
      || !section?.classList.contains('cr-page-craft')
      || Number.parseFloat(section.style.width) !== 1200 || Number.parseFloat(section.style.height) !== 800) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'm8-crystals cr-native m81330-crystal-chrome';
  wrapper.inert = true; wrapper.setAttribute('inert', ''); wrapper.setAttribute('aria-hidden', 'true');
  Object.assign(wrapper.style, {position:'absolute',left:'120px',top:'50px',width:'1200px',height:'800px',
    margin:'0',padding:'0',border:'0',background:'transparent',boxShadow:'none',overflow:'visible'});
  const style = document.createElement('style'); style.textContent = STYLE;
  const page = document.createElement('div'); page.className = 'cr-page cr-page-craft cr-native-dialog';
  Object.assign(page.style, {position:'relative',width:'1200px',height:'800px',background:'transparent'});
  for (const source of section.children) if (decorative(source)) page.append(cloneDecoration(source));
  wrapper.append(style, page);
  // All three are auto-z positioned siblings. DOM order keeps chrome over the
  // movie, but behind the actual status/confirm and independent z41 quality FX.
  reward.root.insertBefore(wrapper, reward.status);
  snapshots.set(reward, wrapper); return wrapper;
}
