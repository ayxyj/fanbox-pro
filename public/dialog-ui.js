/* Shared dialog controls. Attributes are supplied by application templates only. */
window.fanboxUI = Object.freeze({
  closeButton(attributes = '') {
    return `<button type="button" class="ui-dialog-close" aria-label="关闭" title="关闭" ${attributes}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  }
});
