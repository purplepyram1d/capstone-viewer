# Third-party components

This implementation is original Capstone Viewer code; it does not copy World Monitor code.

- MapLibre GL JS 6.19.0, BSD-3-Clause: https://github.com/maplibre/maplibre-gl-js. The bundled license is `assets/vendor/LICENSE.txt`.
- Natural Earth world boundaries distributed through world-atlas 2.0.2, public domain: https://github.com/topojson/world-atlas and https://www.naturalearthdata.com/about/terms-of-use/.
- Canadian provincial and territorial boundaries from [Natural Earth 1:50m Admin 1](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-1-states-provinces/), public domain. Regenerate with `scripts/prepare-ca-provinces.mjs`.
- US state boundaries, borders, and label points (`assets/us-states.json`) from us-atlas 3.0.1, ISC, built from US Census Bureau cartographic boundaries: https://github.com/topojson/us-atlas. Regenerate with `scripts/prepare-states.mjs`; the license is `assets/vendor/US-ATLAS-LICENSE.txt`.
- Optional radar and global infrared satellite imagery from [NOAA nowCOAST](https://nowcoast.noaa.gov/). Images are served directly by NOAA using its published scan times.
- NWS public forecast-zone reference points from the [NWS county and public-zone correlation file](https://www.weather.gov/gis/ZoneCounty), effective April 16, 2026. Regenerate with `scripts/prepare-nws-zones.mjs`.
- NWS coastal and offshore reference points from the [NWS Marine Zones tables](https://www.weather.gov/gis/MarineZones), effective April 16, 2026. Regenerate with `scripts/prepare-nws-marine-zones.mjs` and the two source `.dbf` files.
- Weather warning data source: Environment and Climate Change Canada. [ECCC Data Services End-use Licence](https://eccc-msc.github.io/open-data/licence/readme_en/).
- British Columbia incident locations from the [BC Wildfire Service data catalogue](https://catalogue.data.gov.bc.ca/dataset/2790e3f7-6395-4230-8545-04efb5a18800), under the [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc).
- DriveBC road condition data from the [Open511 service](https://api.open511.gov.bc.ca/help) under the [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc).
- This uses Environment Agency flood and river level data from the real-time data API (Beta). [Open Government Licence v3.0 and API reference](https://environment.data.gov.uk/flood-monitoring/doc/reference). Generalized flood alert and warning boundaries from the Environment Agency. © Environment Agency copyright and/or database right 2026.
- EMSC seismic data via [SeismicPortal](https://www.seismicportal.eu/fdsn-wsevent.html), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Capstone selects regional records and formats the fields for Operations.
- Source: [Japan Meteorological Agency website](https://www.jma.go.jp/bosai/quake/data/list.json). Capstone selects and formats JMA records. [JMA terms of use](https://www.jma.go.jp/jma/en/copyright.html).
- Telegram user authorization uses [teleproto](https://github.com/sanyok12345/teleproto) (MIT). The sign-in QR image is generated with [node-qrcode](https://github.com/soldair/node-qrcode) (MIT).
- Geoscience Australia's [Earthquakes@GA](https://earthquakes.ga.gov.au/emailSubscription) data, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Capstone selects regional events and formats their published fields. [Geoscience Australia catalog record](https://ecat.ga.gov.au/geonetwork/srv/api/records/671a269f-f615-43b5-b6d3-76c6df58f61b?language=eng)
- GeoNet earthquake solutions from Earth Sciences New Zealand, [CC BY 3.0 NZ](https://creativecommons.org/licenses/by/3.0/nz/). Capstone labels the source’s shaking estimate and link on each record. [GeoNet API](https://api.geonet.org.nz/)
- MeteoAlarm weather warning metadata from EUMETNET members, CC BY 4.0, distributed by https://feeds.meteoalarm.org/. Capstone filters and summarizes the source bulletins.
- d3-geo 3.1.1, ISC, used at asset preparation time for dateline-safe SVG projection: https://github.com/d3/d3-geo.
- Google DSPL country reference coordinates: https://github.com/google/dspl/blob/master/samples/google/canonical/countries.csv (Apache-2.0 repository). Country points are approximate reference locations, not incident coordinates.
- fast-xml-parser 5.12.1, MIT: https://github.com/NaturalIntelligence/fast-xml-parser. Its dependencies and their license files ship with the desktop app.
- Cheerio 1.1.2, MIT: https://github.com/cheeriojs/cheerio. Used to read Telegram public channel previews; its dependency/license files ship in the desktop app.
- Electron 45.0.0, MIT, with Chromium and other third-party components: https://github.com/electron/electron. The desktop distribution retains Electron's LICENSE and LICENSES.chromium.html.
- Node.js runtime, distributed under its bundled licenses: https://nodejs.org/en/about/previous-releases. See `runtime-node/LICENSE` in the desktop build.
- YouTube playback uses the official iframe API: https://developers.google.com/youtube/iframe_api_reference. Streams remain hosted by their broadcasters.
- Telegram public previews: https://telegram.org/blog/privacy-discussions-web-bots#view-public-channels. X API user and List timelines: https://docs.x.com/x-api/users/get-posts and https://docs.x.com/x-api/lists/get-list-posts. Provider access, availability and pricing remain controlled by those services.

Feeds retain ownership of their content. This app displays short feed headlines/excerpts and links to the original report. Company/HQ placement lookup is a small manually maintained city-level reference (`config/headquarters.json`), not automated geolocation or proof of exploitation there.

## Fonts

The app bundles Latin and extended Latin WOFF2 web distributions from Google Fonts. The publisher licenses are included with the font files.

- [IBM Plex Sans and IBM Plex Mono](https://github.com/IBM/plex) use the SIL Open Font License 1.1. See the [Sans](assets/vendor/fonts/ibmplexsans-OFL.txt) and [Mono](assets/vendor/fonts/ibmplexmono-OFL.txt) notices.
- [Big Shoulders](https://github.com/xotypeco/big_shoulders) uses the SIL Open Font License 1.1. See the [font notice](assets/vendor/fonts/bigshoulders-OFL.txt).
