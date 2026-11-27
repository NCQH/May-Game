/** Renderer recovery remains available even when RoboHud never initialized.
 * It uses normal reload/native leave paths and never fakes scene readiness.
 */
export class BattleRenderRecovery {
  constructor({host, onReload, onLeave, document = globalThis.document}) {
    this.onReload = onReload; this.onLeave = onLeave; this.generation = 0;
    const node = (tag, className, text = '') => {
      const value = document.createElement(tag); value.className = className;
      value.textContent = text; return value;
    };
    this.root = node('div', 'm84-battle-recovery'); this.root.hidden = true;
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-label', 'Lỗi hiển thị trận');
    this.root.setAttribute('aria-modal', 'true');
    const card = node('section', 'm84-battle-recovery-card');
    card.append(node('h2', '', 'Không thể tiếp tục hiển thị trận'),
      node('p', '', 'Tải lại giao diện hoặc trở về sảnh để tiếp tục.'));
    const details = node('details', 'm84-battle-recovery-details');
    this.detail = node('pre', '');
    this.summary = node('summary', '', 'Chi tiết lỗi');
    details.append(this.summary, this.detail); card.append(details);
    const actions = node('div', 'm84-battle-recovery-actions');
    this.reload = node('button', '', 'Tải lại giao diện'); this.reload.type = 'button';
    this.reload.dataset.testid = 'm84-render-reload';
    this.leave = node('button', '', 'Về sảnh'); this.leave.type = 'button';
    this.leave.dataset.testid = 'm84-render-leave';
    actions.append(this.reload, this.leave); card.append(actions);
    this.status = node('p', 'm84-battle-recovery-status'); this.status.setAttribute('role', 'status');
    card.append(this.status); this.root.append(card); host.append(this.root);
    this.reload.onclick = () => this.onReload();
    this.leave.onclick = () => this.leaveScene();
    this.root.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [this.summary, this.reload, this.leave].filter(button => !button.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  show(error) {
    this.generation += 1; this.root.hidden = false; this.leave.disabled = false;
    this.detail.textContent = `${error?.name || 'Error'}: ${error?.message || String(error)}`;
    this.status.textContent = ''; this.reload.focus({preventScroll: true});
  }

  clear() {
    this.generation += 1; this.root.hidden = true; this.leave.disabled = false;
    this.detail.textContent = ''; this.status.textContent = '';
  }

  async leaveScene() {
    if (this.root.hidden || this.leave.disabled) return;
    const generation = this.generation;
    this.leave.disabled = true; this.status.textContent = 'Đang trở về sảnh…';
    try {
      await this.onLeave();
      // BattleView.update hides the panel after the native leave succeeds.
    } catch (error) {
      if (generation !== this.generation || this.root.hidden) return;
      this.status.textContent = `Chưa thể trở về sảnh: ${error.message || String(error)}`;
      console.error('Battle recovery leave failed', error);
    } finally {
      if (generation === this.generation) this.leave.disabled = false;
    }
  }
}

/** Refresh the document URL too; its import map selects one coherent build. */
export function battleReloadUrl(href, now = Date.now()) {
  const url = new URL(href); url.searchParams.set('reload', String(now)); return url.href;
}
