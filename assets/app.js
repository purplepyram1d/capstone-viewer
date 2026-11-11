// Storage: this static build keeps stars and added sources in localStorage.
// The `sync` object is a seam for a future backend; it stays null here.
const readLocal = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || fb); } catch (e) { return JSON.parse(fb); } };
const writeLocal = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const localFavs = new Set(readLocal("lwd-favs", "[]"));
const localCustom = readLocal("lwd-custom", "[]");
let favs = new Set(localFavs);
let custom = localCustom.slice();
let active = "all";
try { active = localStorage.getItem("lwd-desk") || "all"; } catch (e) {}
if (!["all", "fav"].includes(active) && !GROUPS.some(g => "g:" + g.id === active) && !DESKS.some(d => d.id === active)) active = "all";
const sync = { sources: null, prefs: null, canWrite: false };
let favQueue = Promise.resolve();
function saveFavs() {
  if (sync.prefs) {
    const body = { favs: [...favs] };
    favQueue = favQueue.then(() => sync.prefs.set(body)).catch(() => setStatus("err"));
  } else writeLocal("lwd-favs", [...favs]);
}
const okUrl = u => { try { return /^https?:$/.test(new URL(u).protocol); } catch (e) { return false; } };
const all = () => SOURCES.concat(custom
  .filter(s => s && typeof s.n === "string" && okUrl(s.u) && DESKS.some(d => d.id === s.d))
  .map(s => ({ ...s, mine: true, p: typeof s.p === "string" && s.p ? s.p : "Added by you.", t: Array.isArray(s.t) ? s.t.filter(x => typeof x === "string").slice(0, 5) : [] })));
function setStatus(k) {
  const el = document.getElementById("sync");
  el.dataset.state = k;
  el.textContent = { synced: "Synced to your account on every device.", local: "Your stars and added sources are saved in this browser only.", err: "Couldn't reach sync, so recent changes may not have saved. Reload to try again." }[k];
}

const host = u => new URL(u).hostname.replace(/^www\./, "") + (new URL(u).hostname.includes("github") ? new URL(u).pathname.replace(/\/$/, "") : "");
const esc = s => s.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

function renderClocks() {
  const now = new Date();
  document.getElementById("utc").textContent = now.toISOString().slice(11, 19) + "Z";
  document.getElementById("utcdate").textContent = now.toISOString().slice(0, 10);
  document.getElementById("clocks").innerHTML = CITIES.map(([city, tz]) => {
    const t = now.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
    const h = +t.slice(0, 2);
    const ph = h >= 8 && h < 18 ? ["day","Daylight"] : (h >= 6 && h < 8) || (h >= 18 && h < 20) ? ["dusk", h < 12 ? "Dawn" : "Dusk"] : ["night","Night"];
    return `<div class="clock"><span class="city">${city}</span><span class="t">${t}</span><span class="ph ${ph[0]}"><i></i>${ph[1]}</span></div>`;
  }).join("");
}

function renderChips() {
  const list = all();
  const counts = d => list.filter(s => s.d === d).length;
  const gcount = g => list.filter(s => groupOf(s.d) === g).length;
  const chip = ([id, label, n, cls]) =>
    `<button class="chip${cls ? " " + cls : ""}" data-desk="${id}" aria-pressed="${active===id}">${label}<span class="n">${n}</span></button>`;
  const top = [["all","Everything",list.length], ...GROUPS.map(g => ["g:" + g.id, g.name, gcount(g.id), "grp"]), ["fav","Starred",favs.size,"fav"]];
  const focusGroup = active.startsWith("g:") ? active.slice(2) : (DESKS.find(d => d.id === active) || {}).g;
  const desks = DESKS.filter(d => !focusGroup || d.g === focusGroup).map(d => [d.id, d.name, counts(d.id)]);
  document.getElementById("chips").innerHTML =
    `<div class="chiprow">${top.map(chip).join("")}</div><div class="chiprow sub">${desks.map(chip).join("")}</div>`;
}
const groupOf = deskId => (DESKS.find(d => d.id === deskId) || {}).g;

function card(s) {
  const tags = (s.mine ? ["mine"] : []).concat(s.t).map(t => `<span class="tag${t==="live"?" live":t==="gh"?" gh":t==="mine"?" mine":""}">${t==="gh"?"github":esc(t)}</span>`).join("");
  const rm = s.mine && (!sync.sources || sync.canWrite) ? `<button class="rm" data-rm="${esc(s.id || s.u)}">Remove ${esc(s.n)}</button>` : "";
  const on = favs.has(s.u);
  return `<article class="src">
    <div class="src-top"><div style="min-width:0"><a class="name" href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.n)}</a><div class="host">${esc(host(s.u))}</div></div>
    <button class="star" data-u="${esc(s.u)}" aria-pressed="${on}" aria-label="${on?"Unstar":"Star"} ${esc(s.n)}"><svg viewBox="0 0 24 24"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1 6.3 20.2l1.2-6.3L2.8 9.5l6.4-.8z"/></svg></button></div>
    <p>${esc(s.p)}</p><div class="tags">${tags}</div>${rm}</article>`;
}

function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const match = s => !q || (s.n + " " + s.p + " " + s.t.join(" ") + " " + s.u).toLowerCase().includes(q) || (q === "github" && s.u.includes("github"));
  const inView = s => active === "all" || (active === "fav" ? favs.has(s.u) : active.startsWith("g:") ? groupOf(s.d) === active.slice(2) : s.d === active);
  const pool = all().filter(s => match(s) && inView(s));
  const out = [];
  if (active === "fav" && !favs.size) {
    out.push(`<div class="empty">No starred sources yet. Tap the star on any card to pin it here.</div>`);
  } else if (!pool.length) {
    out.push(`<div class="empty">Nothing matches "${esc(q)}". Try a place, a topic, or clear the filter.</div>`);
  } else {
    GROUPS.forEach(g => {
      const inGroup = DESKS.filter(d => d.g === g.id && pool.some(s => s.d === d.id));
      if (!inGroup.length) return;
      out.push(`<div class="band band-${g.id}"><h2>${g.name}</h2><p>${g.blurb}</p></div>`);
    inGroup.forEach(d => {
      const rows = pool.filter(s => s.d === d.id);
      out.push(`<section class="desk"><div class="desk-head"><h3>${d.name}</h3><p>${d.blurb}</p></div>${
        d.id === "exposure" ? `<div class="caution">These index devices whose owners often never meant them to be public, including private cameras. Use them to understand exposure and practice recon on your own assets, not to watch people.</div>` : ""
      }<div class="grid">${rows.map(card).join("")}</div></section>`);
    });
    });
  }
  document.getElementById("desks").innerHTML = `<div style="display:flex;flex-direction:column;gap:22px">${out.join("")}</div>`;
}

document.getElementById("chips").addEventListener("click", e => {
  const b = e.target.closest(".chip"); if (!b) return;
  active = b.dataset.desk; try { localStorage.setItem("lwd-desk", active); } catch (er) {}
  renderChips(); render();
});
document.getElementById("f-desk").innerHTML = DESKS.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
document.getElementById("addform").addEventListener("submit", e => {
  e.preventDefault();
  const msg = document.getElementById("f-msg");
  const name = document.getElementById("f-name").value.trim();
  let url = document.getElementById("f-url").value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  let ok = false; try { ok = !!name && /^https?:$/.test(new URL(url).protocol); } catch (er) {}
  msg.className = "";
  if (!ok) { msg.textContent = "Add a name and a full link, like https://example.com."; msg.className = "err"; return; }
  if (all().some(s => s.u === url)) { msg.textContent = "That link is already on the desk."; msg.className = "err"; return; }
  const entry = { d: document.getElementById("f-desk").value, n: name.slice(0, 120), u: url,
    p: document.getElementById("f-desc").value.trim().slice(0, 300),
    t: document.getElementById("f-tags").value.split(",").map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 5),
    added: Date.now() };
  const form = e.target;
  if (sync.sources) {
    const btn = form.querySelector("button"); btn.disabled = true;
    sync.sources.add(entry).then(() => { form.reset(); msg.textContent = `Saved "${name}" to every device.`; })
      .catch(er => { msg.className = "err"; msg.textContent = er && er.code === "quota_exceeded" ? "The desk is full. Remove a few of your sources, then try again." : "Couldn't save that source. Check your connection and try again."; })
      .finally(() => { btn.disabled = false; });
    return;
  }
  custom.push(entry);
  const saved = writeLocal("lwd-custom", custom);
  form.reset();
  msg.textContent = saved ? `Saved "${name}" in this browser.` : `Added "${name}" for now; this browser won't keep it after you close the page.`;
  renderChips(); render();
});
document.getElementById("desks").addEventListener("click", e => {
  const r = e.target.closest(".rm");
  if (r) {
    const key = r.dataset.rm;
    const s = custom.find(c => c.id === key || c.u === key);
    if (!s) return;
    if (favs.delete(s.u)) saveFavs();
    if (sync.sources && s.id) { r.disabled = true; sync.sources.doc(s.id).delete().catch(() => { r.disabled = false; setStatus("err"); }); }
    else { custom = custom.filter(c => c !== s); writeLocal("lwd-custom", custom); renderChips(); render(); }
    return;
  }
  const b = e.target.closest(".star"); if (!b) return;
  const u = b.dataset.u; favs.has(u) ? favs.delete(u) : favs.add(u); saveFavs();
  renderChips(); render();
});
document.getElementById("q").addEventListener("input", render);

renderClocks(); setInterval(renderClocks, 1000);
setStatus("local");
renderChips(); render();
