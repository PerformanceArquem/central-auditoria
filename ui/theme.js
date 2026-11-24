/* Run in the head so the saved theme is applied before the first paint. */
(() => {
  'use strict';
  const root = document.documentElement;
  const key = 'audit_workspace_theme';
  let theme = 'light';
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch {}
  root.dataset.theme = theme;
  function updateButton() {
    const button = document.getElementById('workspaceThemeToggle');
    if (!button) return;
    const dark = root.dataset.theme === 'dark';
    button.textContent = dark ? 'Tema: Escuro' : 'Tema: Claro';
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
  }
  document.addEventListener('DOMContentLoaded', () => {
    updateButton();
    document.getElementById('workspaceThemeToggle')?.addEventListener('click', () => {
      theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = theme;
      try { localStorage.setItem(key, theme); } catch {}
      updateButton();
    });
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    root.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
    updateButton();
  });
})();
