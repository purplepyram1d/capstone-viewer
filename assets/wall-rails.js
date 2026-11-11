// Live wall side rails and crawl: market prices on the left (/api/markets; the server refetches at most every 15 minutes),
// world clocks on the right, and a top-stories crawl along the bottom fed by the ranked headlines in the live snapshot.
// New stories are swapped in when the crawl finishes a loop, so it never jumps mid-headline.
(() => {
  const { esc, subscribe } = Capstone, $ = id => document.getElementById(id);
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shortTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---- Markets ----
  const fmt = (n, digits) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const priceText = i => i.group === 'crypto' ? '$' + fmt(i.price, i.price >= 1000 ? 0 : 2) : fmt(i.price, 2);
  function marketRow(i) {
    const pct = Number.isFinite(i.changePct) ? i.changePct : null, dir = pct === null ? '' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    const title = `${i.label}${i.asOf ? ' · as of ' + new Date(i.asOf).toLocaleString() : ''}${i.stale ? ' · last good value; this source failed on the latest check' : ''}`;
    return `<div class="market-row ${dir}${i.stale ? ' stale' : ''}" title="${esc(title)}"><span class="market-name">${esc(i.symbol || i.label)}${i.state === 'closed' ? '<small>CLOSED</small>' : ''}</span><span class="market-price">${priceText(i)}</span><span class="market-change">${pct === null ? '' : (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '') + fmt(Math.abs(pct), 2) + '%'}</span></div>`;
  }
  function renderMarkets(board) {
    if (board.disabled) { $('market-list').innerHTML = '<p class="subtle">Prices are off while collectors are off.</p>'; $('market-note').textContent = ''; return; }
    const group = (name, title) => { const rows = board.items.filter(i => i.group === name); return rows.length ? `<p class="rail-head">${title}</p>${rows.map(marketRow).join('')}` : ''; };
    $('market-list').innerHTML = group('index', 'STOCKS') + group('crypto', 'CRYPTO · 24H') || '<p class="subtle">Prices unavailable right now.</p>';
    const failed = board.errors?.length ? ` · ${board.errors.length} source${board.errors.length === 1 ? '' : 's'} failed` : '';
    $('market-note').textContent = board.updated ? `Updated ${shortTime(board.updated)} · every 15 min${failed}. Yahoo Finance, CoinGecko; delayed.` : 'Price sources unreachable; retrying.';
  }
  async function loadMarkets() {
    try { const res = await fetch('/api/markets'); if (!res.ok) throw new Error(); renderMarkets(await res.json()); }
    catch { $('market-note').textContent = 'Price sources unreachable; retrying.'; }
  }
  // Polling more often than the server's 15-minute cache only matters when a fetch failed and the server is retrying sooner.
  loadMarkets(); setInterval(loadMarkets, 5 * 60000);

  // ---- World clocks ----
  const CLOCKS = [['Los Angeles', 'America/Los_Angeles'], ['New York', 'America/New_York'], ['UTC', 'UTC'], ['London', 'Europe/London'], ['Kyiv', 'Europe/Kyiv'], ['Moscow', 'Europe/Moscow'],
    ['Jerusalem', 'Asia/Jerusalem'], ['Dubai', 'Asia/Dubai'], ['New Delhi', 'Asia/Kolkata'], ['Beijing', 'Asia/Shanghai'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']];
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = (date, timeZone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  function renderClocks() {
    const now = new Date(), here = parts(now, localZone), today = `${here.year}${here.month}${here.day}`;
    $('clock-list').innerHTML = CLOCKS.map(([city, zone]) => {
      let p; try { p = parts(now, zone); } catch { p = parts(now, zone === 'Europe/Kyiv' ? 'Europe/Kiev' : 'UTC'); }
      const day = `${p.year}${p.month}${p.day}`, shift = day > today ? ' · tomorrow' : day < today ? ' · yesterday' : '', hour = Number(p.hour);
      return `<div class="clock-row${zone === localZone ? ' local' : ''}"><span class="clock-city"><i class="daynight ${hour >= 6 && hour < 18 ? 'day' : 'night'}" title="${hour >= 6 && hour < 18 ? 'Daytime' : 'Night'}"></i>${esc(city)}</span><span class="clock-time">${p.hour}:${p.minute}</span><span class="clock-day">${p.weekday}${shift}</span></div>`;
    }).join('');
  }
  renderClocks(); setInterval(renderClocks, 15000);

  // ---- Top-stories crawl ----
  const track = $('wall-ticker-track'); let tickerKey = '', pending = null;
  const windowLabel = h => !h ? 'TOP STORIES' : h === 1 ? 'TOP STORIES · PAST HOUR' : `TOP STORIES · PAST ${h} HOURS`;
  const safeUrl = url => /^https?:\/\//i.test(url || '') ? url : null;
  function apply({ html, label, count }) {
    $('wall-ticker-label').textContent = label; track.innerHTML = html + html;
    track.style.animation = 'none'; void track.offsetWidth;
    if (!reducedMotion() && count) track.style.animation = `kiosk-ticker ${Math.max(40, track.scrollWidth / 2 / 80)}s linear infinite`;
  }
  track.addEventListener('animationiteration', () => { if (pending) { const next = pending; pending = null; apply(next); } });
  subscribe(data => {
    const h = data.headlines, rows = (h?.rows || []).filter(r => !window.CapstoneReading?.muted(r));
    const key = rows.map(r => r.id + r.ts).join('|') + '|' + h?.window_hours; if (key === tickerKey) return; tickerKey = key;
    const fresh = r => Date.now() - Date.parse(r.first_ts || r.ts) < 15 * 60000;
    const html = rows.length ? rows.map(r => { const url = safeUrl(r.url), title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : esc(r.title);
      return `<span class="tick"><i class="dot ${esc(r.category)}"></i>${fresh(r) ? '<em class="tick-new">NEW</em>' : ''}${title} <b>${esc(r.source)} · ${shortTime(r.ts)}</b></span>`; }).join('') : '<span class="tick">Waiting for stories…</span>';
    const next = { html, label: windowLabel(h?.window_hours), count: rows.length };
    // First fill, an empty crawl, or no animation running: show now. Otherwise wait for the loop to finish.
    if (!track.innerHTML || !track.style.animation || track.style.animation === 'none' || reducedMotion()) apply(next); else pending = next;
  });
})();
