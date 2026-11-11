# Third-party components

This implementation is original Capstone Viewer code; it does not copy World Monitor code.

- MapLibre GL JS 5.6.1, BSD-3-Clause: https://github.com/maplibre/maplibre-gl-js. The bundled license is `assets/vendor/LICENSE.txt`.
- Natural Earth world boundaries distributed through world-atlas 2.0.2, public domain: https://github.com/topojson/world-atlas and https://www.naturalearthdata.com/about/terms-of-use/.
- d3-geo 3.1.1, ISC, used at asset preparation time for dateline-safe SVG projection: https://github.com/d3/d3-geo.
- Google DSPL country reference coordinates: https://github.com/google/dspl/blob/master/samples/google/canonical/countries.csv (Apache-2.0 repository). Country points are approximate reference locations, not incident coordinates.
- fast-xml-parser 5.3.0, MIT: https://github.com/NaturalIntelligence/fast-xml-parser. Its dependencies and their license files ship with the desktop app.
- Cheerio 1.1.2, MIT: https://github.com/cheeriojs/cheerio. Used to read Telegram public channel previews; its dependency/license files ship in the desktop app.
- Electron 45.0.0, MIT, with Chromium and other third-party components: https://github.com/electron/electron. The desktop distribution retains Electron's LICENSE and LICENSES.chromium.html.
- Node.js runtime, distributed under its bundled licenses: https://nodejs.org/en/about/previous-releases. See `runtime-node/LICENSE` in the desktop build.
- YouTube playback uses the official iframe API: https://developers.google.com/youtube/iframe_api_reference. Streams remain hosted by their broadcasters.
- Telegram public previews: https://telegram.org/blog/privacy-discussions-web-bots#view-public-channels. X API user and List timelines: https://docs.x.com/x-api/users/get-posts and https://docs.x.com/x-api/lists/get-list-posts. Provider access, availability and pricing remain controlled by those services.

Feeds retain ownership of their content. This app displays short feed headlines/excerpts and links to the original report. Company/HQ placement lookup is a small manually maintained city-level reference (`config/headquarters.json`), not automated geolocation or proof of exploitation there.
