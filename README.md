# Capstone Viewer

Capstone Viewer is a cyber-first open-source intelligence (OSINT) viewer for following what's happening in the world right now, with a global map, event timeline, live stream wall, and curated directory of sources.

## First working version

Capstone now has a Windows desktop app, a flexible YouTube stream wall, a global map linked to an event timeline, and six live collectors. The existing source directory is preserved.

### Open the desktop app

After building the Windows desktop distribution using the steps below, double-click **`Launch Capstone Viewer.cmd`**, or run **`desktop/Capstone Viewer/Capstone Viewer.exe`**. Keep the entire desktop folder together; its executable needs the adjacent resources. Node and Electron are bundled, so no terminal or separately installed runtime is required to use this build.

The app opens Operations. Closing every window keeps it collecting in the system tray (the Eye of Providence icon), so nothing is missed overnight: hover the icon for a one-line status board, click it to reopen Operations, or right-click for other views, **Start with Windows** (off by default; starts in the tray at login) and **Quit Capstone Viewer**. Use **Live wall ↗**, or **Capstone Viewer → Live wall window** (`Ctrl+2`), for the second monitor. `Ctrl+1` opens another Operations window; `Ctrl+3` opens Sources. Each window supports fullscreen. The live wall always fits every stream on one screen (**Columns: Auto (fit all)** picks the layout; a fixed count still shrinks to fit), and in fullscreen it hides the bars so the streams fill the screen. Its left rail shows major stock indices and crypto prices (updated every 15 minutes, delayed), the right rail shows the time in twelve cities, and a crawl along the bottom runs the past hour's top stories, adding new ones as they arrive. The kiosk is sized for reading from across the room: it tours the past hour's top stories as they come in, zooms the globe to each one, labels countries (the alert's country largest), and every card links its sources. Operations labels countries the same way around the selected event.

The wall defaults to four screens in two columns. **Add stream** adds more screens with no fixed count limit. **Edit streams** lets you remove or reorder screens, or restore the defaults. **Columns** sets the grid width (1–6); it adapts to narrower windows. Stream choices and layout persist on this device. All streams start muted. Use **Listen** on one tile; the others mute. **Edit streams** accepts a watch link, video ID, channel ID or @handle. Defaults resolve the current France 24 English, Al Jazeera English, Sky News and DW News broadcasts. Embedding and autoplay are controlled by YouTube/broadcasters; failures show an external link and you can replace the video. The app does not assert that every video you add is a live broadcast.

Desktop event storage is SQLite under `%APPDATA%/Capstone Viewer/feeds`. Stream lists, pins, hidden stories and source preferences live in this app's Chromium profile. Browser preview preferences are separate. The app uses a stable loopback port, **48179**, so preferences survive restarts. If another process occupies it, the app reports the startup error.

### Browser/server development

Requires Node.js 24+. From this directory:

```powershell
npm ci
npm start
```

Open `http://127.0.0.1:8080/ops`, `/wall`, or `/sources`. The root opens Operations. `index.html` is still the original directory. Files remain plain HTML/CSS/JS with no frontend build step. Browser serving uses `runtime/events.sqlite`. Rebuild bundled dependencies/map references with `npm run prepare-assets`; that command needs internet access. Rebuild a Windows desktop distribution with `node node_modules/electron/install.js` followed by `npm run build-desktop`. The build refuses to overwrite an existing desktop output; rename that folder first. `npm test` runs feed normalization and server tests.

For desktop development use `npm run desktop`. To update an existing portable build's application files, use `node scripts/build-desktop.mjs --refresh-app` after closing the app. This preserves the Electron runtime and refreshes the app code and its production dependencies.

### Live data and map behavior

- **CISA KEV**, with an official CISA GitHub mirror if the primary feed fails; **CISA advisories**; **ransomware.live public RSS**; **BBC World RSS**; **OpenAI News RSS**; **USGS magnitude 4.5+ earthquakes**.
- The old ransomware.live v2 endpoint in the handoff is retired. The public RSS feed supplies current claims and country codes without an API key. Only report metadata is collected; screenshots, leak-site attachments and stolen data are not downloaded.
- Collectors poll every five minutes; Server-Sent Events push snapshots to open windows. SQLite retains 30 days. Feed failures retain stored reports and show the last successful collection time. Refresh requests have a 30-second cooldown.
- Timeline defaults to **today in UTC**, with 24-hour, 7-day and 30-day alternatives. Operations holds every report from the last 8 days; past that, only critical reports (score 85+) and still-ongoing outages, back to the 30-day retention limit. The full **Timeline** page (Ctrl+6) still pages through everything retained. Date-only KEV additions are labelled **day only** rather than an invented intraday timestamp.
- The map selects up to 40 located stories from the rolling seven days, ranked by manual pin, score and recency. In the all-desks view it reserves up to four slots per available category before filling the remaining space by score, so a busy cyber feed cannot completely displace world and AI coverage. KEV=85 (95 when CISA records ransomware use), advisory=70, ransomware claim=65, major earthquake=90, world/company report=55. Lower-magnitude quakes score 40 and stay in the timeline unless pinned. Scoring is a simple first pass, not a claim of corroboration or automated AI judgment.
- Exact USGS coordinates are distinguished from approximate country points and company/vendor HQ cities. BBC country placement requires exactly one country name in the headline and is labelled inferred. Unknown locations stay in the timeline; they are never placed at an invented incident location. Edit the small city-level `config/headquarters.json` lookup to correct/add vendors. A new collection applies those corrections.
- Pin/hide controls and selected events synchronize between app windows via BroadcastChannel. The map has a local, token-free Natural Earth basemap. It falls back to a simplified SVG renderer when WebGL is unavailable; that fallback supports selection but not map panning/zooming.
- Country/HQ points can overlap, especially in the simplified map. The timeline and event card remain the reliable way to inspect every story.

### Armed conflict (GDELT)

GDELT machine-codes world news into events every 15 minutes. Capstone keeps only clearly kinetic ones (air strikes, artillery, bombings, ceasefire violations, mass violence, and assaults or abductions by armed groups) and rolls them up to one report per country per day, shown only when at least 5 events come from at least 3 separate outlets. The Conflict tile lists those countries. Wars that are always running (and statements about strikes, which GDELT often places where they were made, such as Washington) would make permanent hot spots, so fighting only joins a hot spot when it escalates: that day's outlets at least double the country's average over its earlier days. That needs about 3 days of history. Everything from GDELT is labelled machine-coded and unverified.

### Attack claims and cyberwar

Mark a feed as a claims relay in **Feeds** ("This source relays attack claims"). Posts that open with a country flag become country-placed reports, typed as hacktivist claim, breach claim, ransomware claim or victim-confirmed incident, with the group and victim pulled out. Claims always stay labelled unverified. Other posts from the same feed stay ordinary posts. Hackmanac on Bluesky is set up as the first relay. Hot spots count ransomware, breach and confirmed-incident reports as one kind of signal (criminal attacks) and hacktivist claims as another, so a country with routine ransomware claims does not become a hot spot on its own. The Cyber tile lists relayed claims by country. Pro-Russian hacktivist Telegram channels are currently banned or private; when you find a live one, add it as a Telegram feed with claims mode on.

### Windows notifications

The desktop app shows native Windows notifications even when every window is minimized: when a status tile turns Severe, and when a watchlist matches a new report. Elevated tiles can be added. Click a notification to open the story or the alert inbox. It also notifies once when a feed has been failing, or silent without an error, for over an hour, and again only if it recovers and breaks later. While a feed is down, Operations shows a gold data-gap line above the status board and marks each tile that depends on it, because that tile may look calmer than reality; the kiosk shows the gap on the tile. Choose what notifies, set quiet hours and send a test under **Watchlists › Desktop alerts**. A tile notifies at most once every 30 minutes, and starting the app never replays old alerts. Windows requires a Start Menu shortcut for an app's notifications, so the app adds **Capstone Viewer** to your Start Menu. If nothing appears, check Windows Settings › System › Notifications and Focus assist.

### What changed while you were away

If you come back to Operations after more than an hour, a summary opens on its own. **What changed** next to Refresh feeds opens it any time, comparing against when you last looked or 6 hours, 24 hours or 7 days ago. It lists status tiles that changed color (and any that peaked higher in between), hot spots that appeared or cleared, outages that started or ended, CVEs whose EPSS jumped, new KEV entries and critical CVEs, and how many reports came in from which sources. Click an item to jump to it. The app keeps a small checkpoint every 15 minutes for 8 days; if the window you ask about starts before those checkpoints, the summary says so and never calls it quiet.

### Kiosk wall

Open **Capstone Viewer › Kiosk wall window** (`Ctrl+7`) or **Kiosk ↗** on Operations for the second monitor, then press **F** for fullscreen. The kiosk tours the hot spots and the strongest located stories of the day on a globe (20 seconds each by default), keeps the status tiles across the top and runs a headline ticker along the bottom. Controls stay hidden until you move the mouse or press a key: **Space** pauses, **← →** step, **M** toggles sound, **S** opens settings. When a status tile rises, a banner appears. Severe always plays an alarm tone; Elevated plays a chime only if you turn that on. Quiet hours silence tones but keep the banner. Every app window reopens on the monitor, size and fullscreen state you last closed it in.

### If the app stops

If Capstone was not collecting for 45 minutes or more before it started, Operations shows a red banner with the gap (for example, offline 3 d 21 h, from Oct 24 8:00 AM to Oct 28 5:22 AM) and how the previous session ended, and Windows shows one notification. Dismiss the banner once you have seen it. The app keeps a lifecycle log at `%APPDATA%\Capstone Viewer\lifecycle.log` (starts, quits, crashes, sleep and wake) so a stop can be explained afterwards. Turning on **Start with Windows** in the tray menu brings it back after a restart.

### Themes

The theme button in the top bar (and in the kiosk's control bar) cycles six themes: **Capstone Night** (the default purple and black), and Corpus Magnus's **Parchment**, **Candlelight**, **Rosé Pine**, **Rosé Pine Dawn** and **Rose Gold**. As in the Corpus reader, the button's icon hints at the next theme and its tooltip names the current one. The choice is saved on this device and every open window, maps included, switches together.

### Status board

Four tiles at the top of Operations (**Internet**, **Cyber**, **Conflict & world**, **Researcher chatter**) read Normal, Elevated or Severe from fixed thresholds. Click a tile to see every number behind its color and the rule that set it; there is no combined score. Volume comparisons (ransomware claims, world-desk reports, social posts) only use sources the app has collected for at least three days, and only against the days since each started. A newly added feed shows "baseline building" instead of a false spike.

### Internet health, hot spots, globe and replay

- **IODA** (Georgia Tech) country outage detections collect every five minutes with no key. Each is a measured drop in one signal (BGP visibility, active probing, Google traffic) against its baseline; the cause is never inferred. Ongoing outages appear in the Operations **Ongoing outages** list, once per country.
- **Cloudflare Radar** outage annotations and high-confidence (8+) BGP hijack detections need a free Cloudflare API token. Add it under **Feeds › Connect Cloudflare Radar**; it is encrypted like the X token. Without it, both feeds show "needs token" and are left out of the healthy-feed count.
- The **Routing pulse** counts BGP withdrawals per minute from the RIPE RIS Live collector rrc00 and flags a surge at 4× the trailing median once an hour of baseline exists. A surge is stored as an unlocated report, because one collector cannot say where or why.
- **Hot spots** list countries where different kinds of signal land within 24 hours: an internet or routing signal plus anything else, three or more mixed reports, or a volume spike against the previous week. Click one to filter the map and timeline to its reports. Co-occurrence is a reason to look, not corroboration, and vendor/company HQ points never count.
- **Globe** switches the WebGL map to a 3D globe and remembers the choice. **Replay 24h** plays the last day of located stories in about 30 seconds, with the day/night line moving to match. The simplified SVG map supports replay and night shading but not the globe.

### Vulnerabilities and malware infrastructure

- **NVD** critical CVEs (CVSS 9.0 or higher, published in the last three days) collect with no key. Severity is the publisher's rating, not evidence of exploitation; a CVE that is also in KEV groups into the same story.
- **EPSS** (FIRST) scores every CVE the app has seen once a day. The timeline shows an EPSS badge, highlighted at 10% or more, and the story card explains it: the estimated chance of exploitation in the next 30 days.
- **ThreatFox** and **URLhaus** (abuse.ch) need a free Auth-Key under **Feeds › Connect abuse.ch**. They appear as one daily report per malware family or tag ("Cobalt Strike: 30 new indicators"), with a link to abuse.ch. Individual indicators and URLs are never copied into the app.

### Telegram and X feeds

Open **Feeds** in the app navigation, or press **Ctrl+4** to open its own feed-management window.

1. Choose Telegram or X and paste a channel/account link or `@username`. X also accepts public List URLs such as `https://x.com/i/lists/123456789`.
2. Choose a display name, desk, polling interval and whether to start collecting. Telegram defaults to enabled every five minutes. X defaults to paused, every 15 minutes, capped at five posts per poll; the cap can be 5, 10 or 20. Bluesky and Mastodon accounts are free, need no login and default to enabled every five minutes. Up to 60 social feeds can be tracked.
3. For X, paste an **X developer API bearer token** into **Connect X**. Saving a token alone does not verify access or enable paused feeds. Enable a feed when ready; the next poll checks API access. Use the X Developer Console to manage provider credits/spending limits. API access and reads can incur provider charges; the app does not estimate a currency budget.
4. Use **View posts** on a feed to open its last 30 days in the timeline. The timeline's Feed selector can show Telegram, X, a specific tracked source, or core feeds. Today remains the default time window when opening Operations normally.

Telegram collection reads the latest public `t.me/s/<channel>` text previews. It needs no Telegram login or bot token. Private/invite-only channels, restricted previews, media-only posts and full history backfills are not supported. The limited public preview can miss posts on a busy channel. No screenshots, videos, documents or other attachments are downloaded. Links and message HTML are converted to plain text, and source links always go to the canonical public post.

X collection uses the official user-post and List-post API endpoints. Account lookups cache the numeric user ID and use `since_id` for incremental polls. Lists do not support that cursor and re-read their latest capped window, which can consume reads for posts already stored; IDs prevent duplicate timeline entries. Each poll makes one capped timeline request (plus the initial account lookup where needed). Backfill pagination is intentionally disabled to bound reads; a busy source can have gaps, and the feed card notes when the API reports another page. Rate-limit responses defer the next poll. Pausing/re-enabling, restarting the app and the main Refresh feeds button do not bypass a social feed's next-poll time.

Social posts are **unverified** and have no inferred incident coordinates. They appear in the timeline; they are not automatically promoted onto the main-event map. The app extracts CVE IDs but does not run AI interpretation of posts.

Feed configurations and polling cursors persist in the same SQLite database as events. Removing a feed stops collection but retains its posts under the normal 30-day retention. In the Windows app, the X token is encrypted with Electron safeStorage/Windows DPAPI in `%APPDATA%/Capstone Viewer/x-credential.bin`; it is never saved in localStorage or SQLite, included in snapshots, or returned by the settings API. Browser/server mode uses memory-only credentials, or `X_BEARER_TOKEN` from the server environment. Memory-only credentials must be re-entered after a restart. Environment-managed credentials are not editable through the UI. Do not copy the desktop credential file between Windows accounts.

The server restricts Host headers to loopback names. If serving through a homelab reverse proxy, set `CAPSTONE_ALLOWED_HOSTS` to a comma-separated list of your exact proxy hostnames. Mutation endpoints reject cross-origin requests; feed settings require JSON. Keep the server behind your own access control when enabling access beyond localhost.

### Watchlists, grouped stories and manual map placement

Open **Watchlists** in the navigation, or **Ctrl+5** in the desktop app. Create a named watchlist with one keyword/phrase per line (commas also work), choose any/every keyword, and optionally restrict it to a desk or provider. Matching is literal, case-insensitive and respects word boundaries: `US` does not match `business`, and one CVE ID does not match a longer CVE ID. Up to 50 watchlists with 20 terms each can be stored. The matcher checks collected titles, summaries, source names, source location labels and CVE IDs; it does not translate or interpret posts.

Existing-report matching is enabled by default when creating a watchlist. Those matches enter the alert inbox quietly. Newly collected matching reports create a persistent local alert and show a small in-app banner while a window is open. Re-polling the same report does not repeat the same rule/report alert. The inbox shows up to 150 matches, unread first; the unread badge counts all retained unread alerts. Use **Mark read** or **Mark all read** to clear that state across windows. Alerts follow report retention and are removed after their underlying reports expire. Pausing/removing a watchlist stops future matching but keeps its alert history. No email, external notification provider, audio alert or OS notification permission is involved.

The timeline's **Watchlist matches** checkbox shows stories matching an enabled rule. **Inspect story** from the inbox opens the related story and marks the alert read. Alert matches reference individual reports even when several reports appear as one story.

The timeline and map now display **grouped stories**. Automatic linking is conservative: the same article URL (ignoring tracking parameters), a single shared CVE, or the same substantial headline on the same UTC date. Multi-CVE roundup posts are not linked to every CVE they mention. A shared CVE links related discussion; it does not assert that all reports describe the same attack. Each story lists its original report links, timestamps, claims/confidence labels, grouping reasons, report count and distinct source-origin count. Two CISA feeds count as one source origin. Separate social feeds count as separate origins, but may still quote one another. Grouping never turns an unverified social claim into corroborated incident evidence.

Use **Group with story…** to connect related stories by hand. Expand a story's report list and choose **Keep this report separate** to exclude an individual report from automatic grouping and remove its manual links. **Allow automatic grouping** re-enables automatic matching for that report. Manual links and separation choices persist in SQLite. Existing pre-grouping pins/hides remain recognized through report IDs; new pins retain those IDs as well.

Select any story and use **Place on map**. Enter a label and coordinates, choose a country reference point, or choose a point directly on the map (including the simplified remote-session map). Add a note explaining the placement and uncertainty. Saving creates a **Manually assigned by you** overlay; the original collected report is preserved and later feed refreshes do not overwrite your correction. When several manually placed reports are grouped, the most recently edited manual point is used for the story. **Restore source location** removes the manual placements in that story and returns to source-derived geography. This does not verify the report or geolocate it automatically.

The location form can also pin an eligible story to the rolling seven-day map. Older reports keep their correction in the 30-day timeline but do not become current events just because you edit them. Social reports can be placed/pinned by hand. The map cap and seven-day window still apply. Pins/hides use the current app/browser profile; watchlists, alert read state, grouping links and location overlays live in SQLite and update other open windows through SSE.

### Remaining roadmap

Broader AI/robotics sources, authenticated Telegram ingestion, Bluesky/Mastodon, semantic/LLM story curation, automated HQ enrichment, OS/email notification options and SIEM forwarding are future work. The desktop build is portable and unsigned, with no installer or automatic updater yet. See `THIRD_PARTY.md` for component/data attribution. No World Monitor code was reused; the overall project license is still undecided.

---

## What's here now: the source directory

- **76 sources across 15 desks in three groups**
  - **Cyber Watch:** Ransomware, Active Exploitation, Malware & IOCs, Breaches & Cyber News, Internet Health, Internet Exposure, Threat Map Visualizations
  - **World Watch:** Global Monitors, Live Cameras, Air & Sea, Conflict & News, Earth & Disasters, Space, Radio & Audio
  - **Reference:** Lists & Toolkits
- **City clock rail:** local time in 12 cities with a daylight/dusk/night indicator
- **Search and filters** by group, desk, name, description, and tag
- **Stars** to pin the sources you use most
- **Add your own sources**, saved in your browser

Plain HTML, CSS, and JavaScript. No build step.

## How sources were chosen

Every entry is something an analyst following a breaking story would actually open: public, free to view, and live or updated within hours. Cyber sources favor primary data (leak-site trackers, CISA KEV, abuse.ch, sensor networks) over vendor marketing, and vendor threat maps are labeled as visualizations rather than incident evidence. Ransomware leak-site entries are treated as *claims* until confirmed by the victim. Owner-published camera networks are included. Directories of unsecured private cameras (such as Insecam) are deliberately excluded. Internet-exposure search engines are listed for defensive awareness, with a note on responsible use.

Starting points: [jivoi/awesome-osint](https://github.com/jivoi/awesome-osint), [The-Osint-Toolbox/Internet-OSINT](https://github.com/the-osint-toolbox/internet-osint), [1h4wk/OSINT_TIPS](https://github.com/1h4wk/OSINT_TIPS), [bytewax/awesome-public-real-time-datasets](https://github.com/bytewax/awesome-public-real-time-datasets), and [Bellingcat's Online Investigations Toolkit](https://bellingcat.gitbook.io/toolkit).

## Project structure

```
index.html          Sources page markup (also the GitHub Pages entry point)
pages/              the app views: ops, wall, kiosk, feeds, watch, timeline, developing, musk, putin
server.mjs, lib/    local server and collectors
desktop.cjs         Electron shell; scripts/build-desktop.mjs builds desktop/
runtime/            local data when the server runs outside the desktop app (not shipped)
assets/styles.css   design tokens (light + dark) and layout
assets/data.js      GROUPS, DESKS, SOURCES, CITIES — edit this to add or change sources
assets/app.js       rendering, search, filters, stars, add-a-source form
```

## Run the source directory by itself

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

## Deploy to GitHub Pages

1. Create a repo named `capstone-viewer` and push this folder to `main`.
2. In **Settings → Pages**, choose *Deploy from a branch*, `main`, `/ (root)`.
3. The site appears at `https://<username>.github.io/capstone-viewer/`.

## Roadmap

1. **Live map (phase 1):** CISA KEV, ransomware.live, and CISA advisories plotted on a MapLibre map, with a live YouTube stream side panel
2. **Telegram ingest:** public threat-intel and hacktivist channels, with AI extraction of country, actor, and CVE
3. **Social ingest:** Bluesky and Mastodon (infosec.exchange), then X if budgeted
4. **Alerts** on watched vendors and CVEs, and forwarding events into a Wazuh/Splunk homelab SIEM
5. Situation playbooks and Admiralty Code reliability ratings for every source

## License

To be decided. If any World Monitor code is reused, this project must be AGPL-3.0-only (see CLAUDE.md).

### Full timeline and event tags

Open **Timeline** in the navigation (desktop Ctrl+6) for every retained report from the rolling 30 days, including unmapped reports and reports outside the live snapshot cap. Pages hold 100 reports, with search, desk, source, period, tag and chronological-order filters. Each report links to its original source and Operations details. External reports open in your default browser from the desktop app.

Use **Add tags / Edit tags** on a report. Add one tag per line with `country:`, `subject:`, `person:` or `custom:`; plain labels become custom tags. Multiple labels are supported (up to 40 per report), persist in local SQLite separately from collected data, and survive feed updates. Tags are manual organizational labels, not verified geographic or biographical assertions. Click a tag to filter the timeline.

Both map renderers offer **+ / −** zoom buttons. The simplified map also supports wheel zoom and drag-to-pan, with **Reset map** restoring the world view.

The wall editor includes a nine-channel preset library: the four defaults plus ABC News, NBC News, CNA, Euronews and NHK WORLD-JAPAN. Select a broadcaster under **Add a preset stream**, then save. Presets resolve the broadcaster’s current YouTube broadcast; availability and embedding can change.

### Elon tracker

Open **Elon tracker** (`/musk`, desktop Ctrl+8 or the tray menu) for Musk, Tesla, SpaceX, Starlink, xAI/Grok, Neuralink, The Boring Company and X/Twitter. Eight public Google News RSS searches poll every 15 minutes with a 7-day lookback. Reports are stored locally for the existing 30-day retention period. The page merges matching existing reports and shows publisher attribution, publication times, company filters, keyword search, period filters, 50-report pagination, official reference links and collection health. Coverage links open through Google News to the publisher; these are not direct X posts or independent verification. Related subjects can carry several company labels. The company list is a subject index, not an ownership chart.

Connected X account posts from elonmusk, Tesla, SpaceX, Starlink, xAI/Grok, Neuralink, boringcompany and X also match by canonical author URL, even when their text does not name the company. Existing X credentials and feed configuration are still required; the tracker does not enable paid reads or scrape X. New tracker coverage stays out of the Operations working set, hot spots, status scores and digest baselines; it remains available in the full timeline and can match existing watchlists.

### Navigation and report reading

Navigation is grouped into **Monitor** (Operations, full timeline, kiosk), **Streams**, **Trackers** (Elon tracker, watchlists) and **Settings** (feeds/connections, source directory). Menus support keyboard navigation and Escape. Existing desktop shortcuts remain unchanged.

Use **View details** in the full timeline or Elon tracker to open a side drawer with the excerpt, source link, location context, assigned tags and private local notes. Save notes explicitly before closing. Notes are stored separately from source reports and survive feed refreshes. Closing the drawer keeps your filters, page and scroll position. Live list refreshes wait while the drawer is open.

The Elon tracker defaults to **Grouped coverage**. Matching or very similar headlines within 48 hours collapse into one card, with an expandable source list and a combined preview. Changed quantities and opposite claims remain separate. This is a navigation aid, not independent corroboration. Choose **Individual reports** to see every report. Grouping is applied before pagination and does not change source records.

### Putin tracker

Open **Trackers > Putin tracker** (`/putin`, Ctrl+9 or the tray menu) for Putin, Kremlin leadership, foreign policy, the war in Ukraine, sanctions, energy/economy and cyber/influence reporting. Seven public Google News RSS searches poll every 15 minutes. The tracker shares grouped coverage, topic/search/period/type filters, individual-report view, source links and the notes drawer with the Elon tracker. Relevant existing reports also appear. Topic matching is headline-based and requires Russian context for broad subjects. This is a news and policy tracker, not live personal-location tracking.

Recognized Russian state media and Russian official statements are labeled separately from other coverage; this identifies provenance, not truthfulness. Official and institutional reference links are not automatic feeds or endorsements. New tracker coverage is excluded from global status, hot-spot and digest calculations to avoid duplicate signals. Existing core/social reporting retains its original role. Reports keep the existing 30-day retention policy. No credentials, paid reads or social-feed settings are changed.

### Operations timeline tags

Operations timeline cards now show several tag chips: stored manual labels plus source context (subject/category, country reference when supplied, and CVEs). HQ coordinates do not generate country labels, and people are never inferred automatically. The event search includes tag labels. Cards show up to six chips with a remainder count; selected details show all labels. Grouped stories combine display labels from their reports without changing each report’s stored labels.

Select an event, choose **Edit tags & notes**, then expand **Edit tags** in the drawer. Enter one country, subject, person or custom label per line and save. A grouped story also exposes a tag editor for each individual report. Manual tags stay in event_tags and survive source refreshes; context chips remain separate. The hot-spot grid now collapses unused columns and uses the panel background, fixing the empty purple rectangle when only one country is present.

### Developing stories and the Operations workspace

**Monitor > Developing stories** (`/developing`) is an evidence desk for continuing situations. The first scan selects up to 12 recent/ongoing candidates across cyber, outages, world/conflict and AI, using existing conservative story groups. On Operations, select any event and choose **Follow developing story** to track it explicitly. No new collections or paid services are added. Tracker coverage remains excluded from global analysis.

Each thread stores the latest evidence excerpts and links, original source publication dates (including day-only precision), when tracking began, and a dated observed-change journal. Repeated unchanged snapshots and restarts do not create new observations. Updates name changed source fields. A new thread starts with a baseline; earlier publication dates do not imply the app was watching at that time. Claims, source measurements, official advisories, attributed statements, machine-coded signals and other reporting remain distinct. Repeated reports are not independent confirmation.

**Follow thread**, analyst status (Watching, Developing, Recovering, Resolved), and journal notes persist locally in developing_threads/developing_reports/developing_changes. Analyst status is explicit and never automatically promoted or resolved. Source-reported outage endings are shown separately, including when a retained report has left the Operations working window. Missing data never means recovery. Active lists show recent threads from the last 30 days plus explicitly followed threads; source excerpts/journal remain local. The detail view shows the latest 80 journal entries and links to report tags/notes.

Operations now prioritizes a compact developing strip, the map and event timeline. **Map / timeline balance** changes column widths and saves on this device. On narrow windows, panels stack. **Show network diagnostics** reveals the routing pulse and hot spots below the workspace. Collector health starts collapsed. Existing status tiles, map/replay, filters, source scoring, alerts and tray collection remain intact. Followed stories can now produce evidence alerts, described below.

## Followed-story alerts
On Developing stories, choose a thread and click Follow thread. Future meaningful source changes enter the Followed-story alerts inbox, with observed and publication times, excerpts, evidence labels and external links. Initial reports, analyst notes/status edits, and URL/timestamp-only changes do not alert. Unfollow stops future alerts; refollow sets a fresh boundary. Inbox history stays local for 30 days, displaying the latest 100, with individual/all read controls and a navigation badge.

Desktop story notifications default on and can be switched off under Watchlists & alerts > Desktop alerts. Existing global and quiet-hour settings apply. Notifications batch for 30 seconds, grouping threads into one popup. Routine updates notify at most once per thread per 10 minutes; source-reported recovery or renewed outage disruption can bypass that cooldown. A single-thread popup opens its developing evidence; a batch opens the story inbox. Restart establishes a fresh baseline rather than replaying old alerts. Silent/suppressed changes still appear in the inbox. Source claims remain claims; analyst status never automatically becomes a source fact.

## Saved desk layouts
Use the Desk switcher below the main navigation to open Overview, Cyber desk or Live wall. Overview starts with a larger map; Cyber desk starts with cyber reports, a 24-hour timeline and network diagnostics. Live wall inherits your current broadcaster lineup and grid columns. Existing device preferences are preserved when a named desk is selected.

Changes to a selected desk save automatically on this device. Operations remembers category, source, search, time window, watchlist-only filter, map projection/position/zoom, map/timeline balance and diagnostics/health visibility. Live wall remembers every stream in order and the grid column count. Playback always starts muted. Use Save as to create another named desk, and Manage desks to rename, remove or undo the latest removal. At least one desk must remain.

Desk selection belongs to the current window, so switching one screen does not navigate another. Report/notification links with explicit Operations parameters open as a Current view rather than overwriting a desk. Current view continues to use the original settings behavior. Layouts are local to this app/browser profile and are not synced between devices. Kiosk keeps its existing clean wall layout. Layouts do not change collectors, credentials, source subscriptions, report curation, annotations or alert settings.

## Telegram starter lineup
The desktop feed list was seeded on 2026-10-24 with eight enabled public channels: The Hacker News, vx-underground, OSINT Industries, Liveuamap, OSINTdefender, The Kyiv Independent, BBC Russian and Meduza LIVE. Display names include source role and EN/RU language. OSINTdefender is explicitly labeled an unverified relay; this review did not establish its affiliation to similarly named accounts. All posts keep the collector's unverified-public-Telegram label, including publisher posts. Russian text is not automatically translated. No channel subscriptions or Telegram login are required.

config/telegram-starter.json records handles, polling intervals, roles, references and rejected stale/unreadable candidates. scripts/seed-telegram-starter.mjs adds missing feeds to the local app at port 48179 (CAPSTONE_URL overrides); rerunning it never changes existing feed settings. Collection uses public text previews only, without attachments. Polling is five minutes for news/community feeds, ten for OSINT relays, and thirty for vendor updates. Manage/pause/remove any source in Feeds.

## Source context and noise controls
Full timeline now offers Source role (publisher, researcher, vendor, relay, official, measurement, unknown), Group repeated coverage / Every report, and Include muted. Reviewed Telegram starter channels carry explicit roles; other social sources remain unknown until reviewed. Roles identify source type, not truth or credibility scores.

Mute source on a timeline card hides its source from the timeline and Operations. Noise controls and source context lets you unmute sources and manage up to 100 literal subject phrases. Matching is case-insensitive substring matching in title, summary and tags. Include muted on either view temporarily reveals hidden reports. These are persistent local reading preferences, not collector pauses: status tiles, diagnostics, story history and notifications still use all inputs. No reports are deleted.

Coverage groups use one shared article/citation URL or repeated title plus text within a UTC day. Similar subject, geography or CVE alone is not a match. Every member keeps its source link, details, notes, confidence and tags; manually separated reports stay separate. Shared-link groups can contain different commentary or updates, and repetition does not establish corroboration. Distinct text is not labeled new evidence. Grouping and mute/role filters apply before pagination. Telegram citations are retained from public text anchors without visiting linked sites; they appear as channels are next polled. X remains disconnected and no paid reads are enabled.

