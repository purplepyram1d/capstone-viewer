import { canadaCyberReference } from './canada-cyber.mjs';
import { weatherReference } from './weather-alerts.mjs';
import { canadaWeatherReference } from './canada-weather.mjs';
import { nhcReference } from './nhc.mjs';
import { femaReference } from './fema-declarations.mjs';
import { ifrcReference } from './ifrc-emergencies.mjs';
import { weeklyVolcanoReference } from './weekly-volcanoes.mjs';
import { jmaQuakeReference } from './jma-earthquakes.mjs';
import { emscReference } from './emsc-earthquakes.mjs';
import { gaQuakeReference } from './ga-earthquakes.mjs';
import { bcWildfireReference } from './bc-wildfires.mjs';
import { riverGaugeReference } from './river-gauges.mjs';
import { stormReportReference } from './local-storm-reports.mjs';
import { geoNetQuakeReference } from './geonet-quakes.mjs';
import { faaAirportReference } from './faa-airports.mjs';
import { eaFloodReference } from './ea-floods.mjs';
import { driveBcReference } from './drivebc-closures.mjs';

const reference = (evidence, description, url) => ({evidence, description, url});

const profiles = {
  kev:reference('Official catalog','CISA’s catalog of vulnerabilities known to have been exploited. Capstone uses the catalog addition date.','https://www.cisa.gov/known-exploited-vulnerabilities-catalog'),
  cisa:reference('Official advisory','Joint advisories, security alerts, and recommended mitigations from CISA and partner agencies.','https://www.cisa.gov/news-events/cybersecurity-advisories'),
  ransomware:reference('Actor claims','Indexes claims attributed to ransomware groups. Look for a victim statement or independent evidence.','https://www.ransomware.live/'),
  bbc:reference('Publisher reporting','World news from BBC News. Any map location inferred from a headline is approximate.','https://www.bbc.com/news/world'),
  'guardian-world':reference('Publisher reporting','World news and reporting from The Guardian.','https://www.theguardian.com/world'),
  'un-news':reference('Institutional reporting','UN News reporting, official statements, and coverage of UN operations in English.','https://news.un.org/en/'),
  'cert-fr':reference('Official advisory','Public security advisories published in French by France’s national CERT.','https://www.cert.ssi.gouv.fr/avis/'),
  'cert-eu':reference('Official advisory','Technical advisories and recommended actions from the EU institutions’ cybersecurity service.','https://cert.europa.eu/publications/security-advisories/'),
  cccs:reference('Official advisory','Public alerts and advisories for Canadian organizations, including industrial control systems. The date is the publisher’s latest update.',canadaCyberReference),
  jvn:reference('Official advisory','Coordinated vulnerability notes in English. Capstone preserves the first publication date when a later update is provided.','https://jvn.jp/en/rss/'),
  jpcert:reference('Official advisory','Selected security alerts published in English by Japan’s coordination center.','https://www.jpcert.or.jp/english/menu_alertsandadvisories.html'),
  'uk-ncsc':reference('Official agency publication','News, reports, and guidance published by the United Kingdom’s National Cyber Security Centre.','https://www.ncsc.gov.uk/'),
  deepmind:reference('Company announcement','Research updates and announcements from Google DeepMind.','https://deepmind.google/blog/'),
  'cmu-robotics':reference('University statement','Carnegie Mellon Robotics Institute news about its robotics programs and research.','https://www.ri.cmu.edu/news/'),
  'ieee-robotics':reference('Publisher reporting','IEEE Spectrum reporting on robotics, research, and industry developments.','https://spectrum.ieee.org/topic/robotics/'),
  openai:reference('Company announcement','OpenAI announcements and research updates from the company’s public feed.','https://openai.com/news/'),
  'emsc-earthquakes':reference('Source measurement','Recent magnitude 3.0 to 4.49 earthquakes across Europe and its surrounding seas, including the Mediterranean. Each point links to the EMSC event. Data: EMSC / SeismicPortal, CC BY 4.0.',emscReference),
  'ga-earthquakes':reference('Official measurement','Published Geoscience Australia solutions from M2.0 up to M4.5 across its Australian monitoring area. Points show the reported epicenter. Capstone selects and formats the records. Geoscience Australia, CC BY 4.0.',gaQuakeReference),
  'jma-earthquakes':reference('Official measurement','Earthquake information for reports of intensity 3 or above on the JMA scale in Japan. Source: Japan Meteorological Agency website. Capstone selects and formats the published records.',jmaQuakeReference),
  usgs:reference('Official measurement','USGS earthquakes of magnitude 4.5 and above worldwide. Magnitude 2.5 and above is shown when the source epicenter falls inside a U.S. state or territory or a Canadian province or territory.','https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php'),
  gdelt:reference('Machine-coded news aggregate','GDELT tags news text with action and geography codes. The aggregate stays available for source review.','https://www.gdeltproject.org/'),
  'usgs-volcano':reference('Official volcano bulletin','Volcano notices and alerts issued by U.S. observatories. Conditions and aviation codes refer to the notice issue time.','https://volcanoes.usgs.gov/hans-public/'),
  'gvp-volcano-weekly':reference('Official weekly synthesis','Preliminary weekly activity reports from the Smithsonian Global Volcanism Program and USGS. Map points identify volcano catalog locations. Each report links to its dated archive.',weeklyVolcanoReference),
  'geonet-earthquakes':reference('Official measurement','Preferred solutions for earthquakes in the New Zealand monitoring region with estimated moderate-or-stronger shaking at the nearest locality. Data: Earth Sciences New Zealand / GeoNet, CC BY 3.0 NZ.',geoNetQuakeReference),
  'geonet-volcano':reference('Official volcano bulletin','GeoNet volcanic activity bulletins about monitored volcanoes in New Zealand. Includes the alert level at the time of issue when provided.','https://www.geonet.org.nz/volcano/vab'),
  'ifrc-emergencies':reference('Official humanitarian catalog','Public IFRC GO emergency records by catalog creation time. The incident start date is shown separately when provided. Map points reference a single country named in the record.',ifrcReference),
  'fema-declarations':reference('Official disaster declaration','Federal disaster, emergency, and fire-management declarations. The date is the declaration date, and the record separately identifies the incident period and designated areas.',femaReference),
  'nhc-cyclones':reference('Official tropical cyclone advisory','NHC Atlantic and Pacific public advisories. Marker shows the reported storm center and its source time.',nhcReference),
  eonet:reference('Official curated catalog','NASA curates natural-event observations using linked source reports. Map tracks use dated catalog positions.','https://eonet.gsfc.nasa.gov/docs/v3'),
  'copernicus-mapping':reference('Official mapping activation','Copernicus emergency mapping records for selected natural hazards. Map points show the source’s approximate mapping-area center.','https://mapping.emergency.copernicus.eu/about/how-to-harvest-cems-mapping-data/emergency-response-data/'),
  'nifc-wildfire':reference('Official incident record','Federal wildfire inventory. State and map point refer to the reported origin. Open the inventory for current status.','https://www.arcgis.com/home/item.html?id=4181a117dc9e43db8598533e29972015'),
  'bc-wildfire':reference('Official incident record','BC Wildfire Service incident points for recent ignitions, with the reported control stage and size from the collected inventory. Open the linked incident for updates. Data licensed under the Open Government Licence – British Columbia.',bcWildfireReference),
  'nwps-observed':reference('Official gauge measurement','NOAA’s observed layer for U.S. gauges at moderate or major flood stage. Each entry links to the gauge and keeps the measurement time.',riverGaugeReference),
  'nws-storm-reports':reference('Official preliminary report','Selected local reports of flooding, tornadoes, wind damage, landslides, and other impacts. The reporting NWS office supplies the time, state and point. Source record links cover the last 72 hours.',stormReportReference),
  'nws-alerts':reference('Official weather bulletin','Severe and extreme U.S. weather bulletins collected while listed by NWS. Each saved message keeps its issue and expiration times.',weatherReference),
  'eccc-weather':reference('Official weather bulletin','Canadian weather warnings with their published risk colour, issue time, and affected areas. Data Source: Environment and Climate Change Canada.',canadaWeatherReference),
  gdacs:reference('Modeled hazard alert','GDACS models potential impact from selected natural hazards. Map points represent approximate alert areas.','https://www.gdacs.org/feed_reference.aspx'),
  swpc:reference('Official bulletin','NOAA geomagnetic storm products. Forecasts and observed threshold bulletins carry separate labels.','https://www.swpc.noaa.gov/products/alerts-watches-and-warnings'),
  ntwc:reference('Official bulletin','National Tsunami Warning Center products for its covered coasts. A map point shows the earthquake origin.','https://www.tsunami.gov/?page=productRetrieval'),
  ptwc:reference('Official bulletin','Pacific Tsunami Warning Center products for covered territories and international regions. A map point shows the earthquake origin.','https://www.tsunami.gov/?page=productRetrieval'),
  'ea-floods':reference('Official flood notice','Environment Agency flood alerts, warnings and removals for England’s warning service. This uses Environment Agency flood and river level data from the real-time data API (Beta).',eaFloodReference),
  'drivebc-closures':reference('Official closure status','Road segments currently listed as closed by DriveBC with an explicit running time window. Data licensed under the Open Government Licence – British Columbia.',driveBcReference),
  'faa-airports':reference('Official status listing','Reported U.S. airport ground stops, ground delay programs, closures, operating restrictions, selected delays and deicing. Points mark airport locations. FAA listings can change between polls.',faaAirportReference),
  ioda:reference('Network measurement','IODA detects changes in internet connectivity using several measurement signals. Attribution needs separate evidence.','https://ioda.inetintel.cc.gatech.edu/'),
  'radar-outages':reference('Provider annotation','Cloudflare Radar annotations describe outages using network observations and provider context.','https://radar.cloudflare.com/outage-center'),
  'radar-hijacks':reference('Automated detection','Cloudflare Radar detects possible anomalies in routing announcements. Attribution needs independent evidence.','https://radar.cloudflare.com/routing'),
  nvd:reference('Official vulnerability record','Recent National Vulnerability Database entries with critical CVSS v3 scores.','https://nvd.nist.gov/vuln/search'),
  threatfox:reference('Community threat intelligence','Community-reported indicators summarized by malware family.','https://threatfox.abuse.ch/'),
  urlhaus:reference('Community threat intelligence','Community-reported malware URLs summarized by source tag.','https://urlhaus.abuse.ch/')
};

const tracker = reference('Publisher coverage via Google News','Topic-specific coverage from the publishers indexed by Google News.','https://news.google.com/');

export function collectorProfile(feed) {
  return feed.profile || profiles[feed.id] || (feed.tracker ? tracker : null);
}
