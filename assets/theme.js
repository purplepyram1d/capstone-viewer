// Runs in <head>, before the page paints, so a saved theme never flashes the default first. It also follows a
// switch made in another window, which matters on pages without the shared script (the Sources directory).
(() => {
  const apply = () => { try { const t = JSON.parse(localStorage.getItem('capstone-theme')); if (typeof t === 'string' && /^[a-z]{2,12}$/.test(t)) document.documentElement.dataset.theme = t; } catch {} };
  apply(); window.addEventListener('storage', event => { if (event.key === 'capstone-theme') apply(); });
})();
