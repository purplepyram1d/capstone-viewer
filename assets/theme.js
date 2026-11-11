// Apply the saved palette before paint, then mount the picker once the page is ready.
window.CapstoneTheme = (() => {
  const storageKey = 'capstone-theme';
  const groups = {
    Light: [
      ['parchment', 'Parchment'],
      ['rosedawn', 'Rosé Pine Dawn'],
      ['rosegold', 'Rose Gold'],
      ['ivory', 'Ivory'],
      ['botanical', 'Botanical'],
      ['seaglass', 'Sea Glass']
    ],
    Dark: [
      ['candle', 'Candlelight'],
      ['rosepine', 'Rosé Pine'],
      ['midnight', 'Midnight'],
      ['evergreen', 'Evergreen'],
      ['highcontrast', 'High Contrast'],
      ['dark', 'Capstone Night']
    ]
  };
  const ids = new Set(Object.values(groups).flat().map(([id]) => id));
  const listeners = new Set();
  const root = document.documentElement;
  let picker;

  function savedTheme() {
    try { return JSON.parse(localStorage.getItem(storageKey)); }
    catch { return null; }
  }

  function applyTheme(id, persist = false) {
    const theme = ids.has(id) ? id : 'dark';
    const changed = root.dataset.theme !== theme;
    root.dataset.theme = theme;
    if (picker) picker.value = theme;
    if (persist) {
      try { localStorage.setItem(storageKey, JSON.stringify(theme)); } catch {}
    }
    if (changed && listeners.size) {
      // Maps read computed colors after the page's theme tokens change.
      requestAnimationFrame(() => {
        for (const listener of listeners) {
          try { listener(root.dataset.theme); }
          catch (error) { console.error('Could not apply theme', error); }
        }
      });
    }
  }

  applyTheme(savedTheme());
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) applyTheme(savedTheme());
  });

  document.addEventListener('DOMContentLoaded', () => {
    picker = document.getElementById('theme-select');
    if (!picker) {
      const fullscreen = document.getElementById('fullscreen');
      if (!fullscreen) return;
      picker = document.createElement('select');
      picker.id = 'theme-select';
      fullscreen.before(picker);
    }

    picker.setAttribute('aria-label', 'Theme');
    for (const [label, themes] of Object.entries(groups)) {
      const group = document.createElement('optgroup');
      group.label = label;
      for (const [id, name] of themes) group.append(new Option(name, id));
      picker.append(group);
    }
    picker.value = root.dataset.theme;
    picker.hidden = false;
    picker.addEventListener('change', () => applyTheme(picker.value, true));
  });

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { onChange };
})();
