// Groups, desks, curated sources, and clock-rail cities.
// Each source: d = desk id, n = name, u = url, p = one-line description, t = tags.
const GROUPS = [
  { id: "cyber", name: "Cyber Watch", blurb: "Official advisories, reported incidents, exploitation evidence, and network measurements." },
  { id: "world", name: "World Watch", blurb: "World reporting, Earth observations, official bulletins, and public live sources." },
  { id: "ref", name: "Reference", blurb: "The indexes and toolkits behind this desk." }
];
const DESKS = [
  { g: "cyber", id: "ransomware", name: "Ransomware", blurb: "Leak-site trackers that show victims as gangs post them. These are claims; confirm with the victim's own statement." },
  { g: "cyber", id: "exploit", name: "Active Exploitation", blurb: "What attackers are scanning for and exploiting right now, and which CVEs are confirmed in the wild." },
  { g: "cyber", id: "advisories", name: "Security Advisories", blurb: "Government and coordination-center alerts. Check affected products and follow updates from the publisher." },
  { g: "cyber", id: "iocs", name: "Malware & IOCs", blurb: "Community-fed indicators: malicious URLs, C2 servers, samples and campaign pulses." },
  { g: "cyber", id: "breaches", name: "Breaches & Cyber News", blurb: "Confirmed breaches and the reporters who break incidents first." },
  { g: "cyber", id: "internet", name: "Internet Health", blurb: "Outages, shutdowns, DDoS and censorship, measured country by country." },
  { g: "cyber", id: "exposure", name: "Internet Exposure", blurb: "Search engines for internet-connected devices. Defender's tools for understanding what's exposed." },
  { g: "cyber", id: "cyber", name: "Threat Map Visualizations", blurb: "Vendor maps of hits on their own sensors. Good for a wall screen, not evidence of specific incidents." },
  { g: "world", id: "monitors", name: "Global Monitors", blurb: "Dashboards and maps that track conflict, weather and movement as it happens." },
  { g: "world", id: "cams", name: "Live Cameras", blurb: "Owner-published streams from plazas, beaches, skylines and landmarks." },
  { g: "world", id: "airsea", name: "Air & Sea", blurb: "Aircraft and ship positions from transponders. When something happens, the traffic shows it first." },
  { g: "world", id: "conflict", name: "Conflict & News", blurb: "Event databases and coverage tools for following a story past the headline." },
  { g: "world", id: "earth", name: "Earth & Disasters", blurb: "Fires, storms, quakes and floods, mostly straight from the agencies that measure them." },
  { g: "world", id: "space", name: "Space", blurb: "Satellites, the ISS, and the sun's weather." },
  { g: "world", id: "audio", name: "Radio & Audio", blurb: "Public scanner and air-traffic audio. Hear an event unfold in real time." },
  { g: "ref", id: "ai", name: "AI & Robotics", blurb: "Research releases, university work, and robotics reporting." },
  { g: "ref", id: "lists", name: "Lists & Toolkits", blurb: "The curated indexes and toolkits this desk was built from. Start here to find more." }
];

const SOURCES = [
  // cameras
  { d:"cams", n:"SkylineWebcams", u:"https://www.skylinewebcams.com", p:"European-heavy network of HD cams in piazzas, beaches and ports. Browse by country or category.", t:["live","europe","beaches","cities"] },
  { d:"cams", n:"EarthCam", u:"https://www.earthcam.com", p:"The best-known network. Strong on US cities: Times Square, Bourbon Street, plus the Abbey Road crossing.", t:["live","usa","cities","landmarks"] },
  { d:"cams", n:"WorldCams", u:"https://worldcams.tv", p:"Large directory sorted by category (airports, mountains, sights, cities) with Popular and Editor's Choice lists.", t:["live","directory","airports"] },
  { d:"cams", n:"Webcamtaxi", u:"https://www.webcamtaxi.com", p:"Virtual-travel style directory of world webcams; owners can submit their own.", t:["live","directory","travel"] },
  { d:"cams", n:"HDOnTap", u:"https://hdontap.com", p:"HD streams with live viewer counts; good for beaches, resorts and wildlife.", t:["live","beaches","wildlife"] },
  { d:"cams", n:"IPLiveCams", u:"https://iplivecams.com", p:"Cams grouped by type (city, landscape, animal, sport) and by country.", t:["live","directory"] },
  { d:"cams", n:"CamStreamer Live Gallery", u:"https://camstreamer.com/live", p:"Hundreds of public YouTube streams from Axis cameras, with a world map view.", t:["live","map","youtube"] },
  { d:"cams", n:"Windy Webcams", u:"https://www.windy.com/-Webcams/webcams", p:"Webcam layer on top of Windy's weather map. Click a dot to see the sky anywhere.", t:["live","map","weather"] },
  { d:"cams", n:"Explore.org Live Cams", u:"https://explore.org/livecams", p:"Nonprofit wildlife cams: bears at Brooks Falls, eagle nests, reefs, African watering holes.", t:["live","wildlife","nature"] },
  { d:"cams", n:"WindowSwap", u:"https://www.window-swap.com", p:"Recorded views out of people's windows around the world. Not live, but calm and oddly addictive.", t:["recorded","ambient"] },
  // monitors
  { d:"monitors", n:"World Monitor", u:"https://www.worldmonitor.app", p:"Real-time global intelligence: conflict tracking, military flights and vessels, GPS jamming, satellite imagery and risk scores.", t:["live","conflict","aviation","maritime"] },
  { d:"exploit", n:"World Monitor Tech", u:"https://tech.worldmonitor.app", p:"Cyber edition: CISA advisories, malware campaigns, CVE feeds and cyber-event heatmaps in geopolitical context.", t:["live","cyber","cve"] },
  { d:"monitors", n:"Liveuamap", u:"https://liveuamap.com", p:"Map of breaking events plotted from news and social posts, region by region.", t:["live","conflict","news"] },
  { d:"monitors", n:"Zoom Earth", u:"https://zoom.earth", p:"Near-live satellite imagery with storms, fires and rain radar overlaid.", t:["live","satellite","weather"] },
  { d:"monitors", n:"Windy", u:"https://www.windy.com", p:"Wind, rain, temperature and pressure forecasts animated across the globe.", t:["live","weather"] },
  { d:"monitors", n:"Worldwide OSINT Tools Map", u:"https://cipher387.github.io/osintmap/", p:"A world map of country-specific databases and OSINT sources.", t:["map","osint","gh"] },
  // ransomware
  { d:"ransomware", n:"Ransomware.live", collector:"ransomware", u:"https://www.ransomware.live", p:"Near real-time tracker of victims posted to ransomware leak sites, by group, country and sector.", t:["live","leak sites","claims"] },
  { d:"ransomware", n:"RansomLook", u:"https://www.ransomlook.io", p:"Open-source leak-site tracker. Use it to cross-check Ransomware.live.", t:["live","leak sites","open source"] },
  { d:"ai", n:"Google DeepMind", collector:"deepmind", u:"https://deepmind.google/blog/", p:"Company research updates and announcements.", t:["ai","research"] },
  { d:"ai", n:"CMU Robotics Institute", collector:"cmu-robotics", u:"https://www.ri.cmu.edu/news/", p:"University robotics research, demonstrations, and lab updates.", t:["robotics","research"] },
  { d:"ai", n:"IEEE Spectrum Robotics", collector:"ieee-robotics", u:"https://spectrum.ieee.org/topic/robotics/", p:"Reporting on robotics and its applications.", t:["robotics","news"] },
  { d:"ai", n:"OpenAI News", collector:"openai", u:"https://openai.com/news/", p:"Company announcements and research releases.", t:["ai","research"] },
  // active exploitation
  { d:"exploit", n:"CISA Known Exploited Vulnerabilities", collector:"kev", u:"https://www.cisa.gov/known-exploited-vulnerabilities-catalog", p:"CVEs confirmed exploited in the wild, with federal patch deadlines. Use the catalog and vendor guidance to check affected assets.", t:["kev","cve","gov"] },
  { d:"exploit", n:"GreyNoise Visualizer", u:"https://viz.greynoise.io", p:"Mass scanning and exploitation attempts by tag. Trending tags show a new CVE getting sprayed.", t:["live","scanning","cve"] },
  { d:"exploit", n:"SANS Internet Storm Center", u:"https://isc.sans.edu", p:"Daily handler diary, DShield sensor data and the Infocon threat level.", t:["live","dshield","diary"] },
  { d:"exploit", n:"Shadowserver Dashboard", u:"https://dashboard.shadowserver.org", p:"Global stats on compromised and vulnerable devices, by country and over time.", t:["live","exposure","by country"] },
  { d:"advisories", n:"CISA Cybersecurity Advisories", collector:"cisa", u:"https://www.cisa.gov/news-events/cybersecurity-advisories", p:"Joint advisories on active threat actors, ICS flaws and emergency directives.", t:["advisories","gov","ics"] },
  { d:"exploit", n:"FIRST EPSS", u:"https://www.first.org/epss/", p:"Daily probability that a CVE will be exploited in the next 30 days. Pairs well with KEV.", t:["cve","scoring"] },
  { d:"advisories", n:"CERT-EU Security Advisories", collector:"cert-eu", u:"https://cert.europa.eu/publications/security-advisories/", p:"EU institutional cyber advisories, affected products, and recommended actions.", t:["advisories","europe","cve"] },
  { d:"advisories", n:"Japan Vulnerability Notes", collector:"jvn", u:"https://jvn.jp/en/report/all.html", p:"English vulnerability disclosures coordinated by JPCERT/CC and Japan's Information-technology Promotion Agency.", t:["advisories","japan","cve"] },
  { d:"advisories", n:"JPCERT/CC Security Alerts", collector:"jpcert", u:"https://www.jpcert.or.jp/english/menu_alertsandadvisories.html", p:"Japanese incident coordination notices and guidance in English.", t:["advisories","japan","cve"] },
  { d:"advisories", n:"Canadian Centre for Cyber Security", u:"https://www.cyber.gc.ca/en/alerts-advisories", p:"Browse Canada's official alerts, technical advisories, and control-system advisories.", t:["advisories","canada","ics"] },
  { d:"advisories", n:"Australian Cyber Security Centre", u:"https://www.cyber.gov.au/news-and-updates", p:"Browse Australian government alerts, threat reports, advisories, and guidance.", t:["advisories","australia","gov"] },
  { d:"earth", n:"U.S. Tsunami Warning System", collector:"ntwc", u:"https://www.tsunami.gov/", p:"Current NOAA tsunami bulletins for covered coasts and international Pacific and Caribbean forecasts.", t:["tsunami","gov","hazards"] },
  { d:"earth", n:"U.S. National Weather Service", collector:"nws-alerts", u:"https://www.weather.gov/", p:"Official forecasts and current watches, warnings, and advisories. Capstone collects severe and extreme bulletins.", t:["weather","hazards","gov"] },
  { d:"earth", n:"Copernicus EMS Rapid Mapping", collector:"copernicus-mapping", u:"https://mapping.emergency.copernicus.eu/activations/", p:"Public emergency mapping activations and the imagery-based products delivered for each mapped area.", t:["hazards","satellite","mapping","eu"] },
  { d:"conflict", n:"ReliefWeb humanitarian updates", u:"https://reliefweb.int/updates", p:"UN OCHA’s curated humanitarian situation reports, assessments, and maps from contributing organizations.", t:["humanitarian","reports","un"] },
  { d:"earth", n:"USGS Volcano Notifications", collector:"usgs-volcano", u:"https://volcanoes.usgs.gov/hans-public/", p:"U.S. observatory notices with volcanic activity, alert levels, and aviation codes as issued.", t:["volcanoes","usgs","hazards"] },
  { d:"earth", n:"GeoNet Volcano Bulletins", collector:"geonet-volcano", u:"https://www.geonet.org.nz/volcano/vab", p:"Official volcanic activity bulletins and alert levels from New Zealand's GeoNet.", t:["volcanoes","new zealand","hazards"] },
  { d:"earth", n:"NIFC wildfire records", collector:"nifc-wildfire", u:"https://www.arcgis.com/home/item.html?id=4181a117dc9e43db8598533e29972015", p:"Public federal wildfire records with incident discovery dates, points of origin, and reported size and containment when available.", t:["wildfire","hazards","gov"] },
  { d:"earth", n:"Environment Agency flood notices", collector:"ea-floods", u:"https://check-for-flooding.service.gov.uk/alerts-and-warnings", p:"Flood alerts, warnings, and published removals from England’s warning service, with area-specific GOV.UK links.", t:["floods","weather","england","gov"] },
  { d:"earth", n:"MeteoAlarm warning feeds", u:"https://feeds.meteoalarm.org/", p:"Public national weather warnings from EUMETNET members. Select a country to see the original Atom feed.", t:["weather","europe","gov"] },
  { d:"earth", n:"NASA Earth Observatory Natural Event Tracker", collector:"eonet", u:"https://eonet.gsfc.nasa.gov/", p:"Curated natural-event records with original source references and dated map positions.", t:["earth","observations","nasa"] },
  // malware & iocs
  { d:"iocs", n:"ThreatFox", collector:"threatfox", u:"https://threatfox.abuse.ch", p:"abuse.ch's shared database of IOCs: IPs, domains and hashes tied to malware families.", t:["live","iocs","abuse.ch"] },
  { d:"iocs", n:"URLhaus", collector:"urlhaus", u:"https://urlhaus.abuse.ch", p:"Malicious URLs used for malware distribution, updated continuously.", t:["live","urls","abuse.ch"] },
  { d:"iocs", n:"MalwareBazaar", u:"https://bazaar.abuse.ch", p:"Freshly submitted malware samples, searchable by family, tag and hash.", t:["live","samples","abuse.ch"] },
  { d:"iocs", n:"Feodo Tracker", u:"https://feodotracker.abuse.ch", p:"Active botnet command-and-control servers and blocklists.", t:["live","c2","abuse.ch"] },
  { d:"iocs", n:"AlienVault OTX", u:"https://otx.alienvault.com", p:"Community threat pulses on active campaigns, with IOCs you can export.", t:["community","iocs"] },
  // breaches & news
  { d:"breaches", n:"Have I Been Pwned", u:"https://haveibeenpwned.com/PwnedWebsites", p:"Every breach loaded into HIBP, newest first, with record counts and data types.", t:["breaches"] },
  { d:"breaches", n:"HHS OCR Breach Portal", u:"https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf", p:"US healthcare breaches affecting 500+ people, as reported to HHS.", t:["breaches","healthcare","gov"] },
  { d:"breaches", n:"DataBreaches.net", u:"https://databreaches.net", p:"Independent breach reporting that often lands before mainstream outlets.", t:["breaches","news"] },
  { d:"breaches", n:"BleepingComputer", u:"https://www.bleepingcomputer.com", p:"Fast coverage of ransomware attacks, zero-days and outages.", t:["news"] },
  { d:"breaches", n:"The Record", u:"https://therecord.media", p:"Recorded Future's newsroom for cyber incidents, policy and nation-state activity.", t:["news","nation-state"] },
  // threat map visualizations
  { d:"cyber", n:"Kaspersky Cyberthreat Map", u:"https://cybermap.kaspersky.com", p:"Spinning-globe visualization of threats detected by Kaspersky sensors.", t:["live","threat map"] },
  { d:"cyber", n:"Check Point Live Threat Map", u:"https://threatmap.checkpoint.com", p:"Live attacks from Check Point's ThreatCloud, with top targeted countries and industries.", t:["live","threat map"] },
  { d:"cyber", n:"Radware Live Threat Map", u:"https://livethreatmap.radware.com", p:"Near real-time attacks from Radware's global deception network.", t:["live","ddos"] },
  { d:"cyber", n:"Bitdefender Threat Map", u:"https://threatmap.bitdefender.com", p:"Real-time infections, attacks and spam seen by Bitdefender.", t:["live","threat map"] },
  { d:"internet", n:"NETSCOUT Horizon", u:"https://horizon.netscout.com", p:"Real-time DDoS attack map from NETSCOUT's ATLAS sensors.", t:["live","ddos"] },
  { d:"cyber", n:"Imperva Live Threat Map", u:"https://www.imperva.com/cyber-threat-attack-map/", p:"DDoS, hacking attempts and bot traffic mitigated by Imperva.", t:["live","bots","ddos"] },
  // air & sea
  { d:"airsea", n:"ADS-B Exchange", u:"https://globe.adsbexchange.com", p:"Co-op flight tracker that shows unfiltered traffic, including military and blocked aircraft other trackers hide.", t:["live","aviation","military"] },
  { d:"airsea", n:"DriveBC road closures", collector:"drivebc-closures", u:"https://api.open511.gov.bc.ca/help", p:"Provincial closures with explicit active time windows and original event links.", t:["roads","closures","canada","gov"] },
 { d:"airsea", n:"Caltrans highway closures", u:"https://cwwp2.dot.ca.gov/lane-closure.html", p:"District feeds for California’s highway system. Capstone collects confirmed full mainline closures.", t:["roads","closures","california","gov"] },
 { d:"airsea", n:"FAA airport status", collector:"faa-airports", u:"https://nasstatus.faa.gov/", p:"Official airport ground stops, delay programs, closure and operating notices, selected delays, and deicing, mapped to airport reference points.", t:["live","aviation","delays","official"] },
 { d:"airsea", n:"Flightradar24", u:"https://www.flightradar24.com", p:"The most popular flight tracker. Fast, polished, good for airline and airport disruptions.", t:["live","aviation"] },
  { d:"airsea", n:"FlightAware", u:"https://www.flightaware.com", p:"Flight tracking plus airport delay and cancellation stats.", t:["live","aviation","delays"] },
  { d:"airsea", n:"MarineTraffic", u:"https://www.marinetraffic.com", p:"Ship positions from AIS. Watch chokepoints like Suez, Hormuz and the Bosphorus.", t:["live","maritime"] },
  { d:"airsea", n:"VesselFinder", u:"https://www.vesselfinder.com", p:"Free AIS ship tracker with vessel details and port calls.", t:["live","maritime"] },
  { d:"airsea", n:"Submarine Cable Map", u:"https://www.submarinecablemap.com", p:"Every undersea internet cable and landing station. Useful when a cable cut makes the news.", t:["map","infrastructure"] },
  // conflict & news
  { d:"conflict", n:"ACLED", u:"https://acleddata.com", p:"Armed Conflict Location & Event Data: coded records of political violence and protest worldwide.", t:["conflict","data"] },
  { d:"conflict", n:"GDELT Project", u:"https://www.gdeltproject.org", p:"Monitors world news in 100+ languages and turns it into an open database of events and tone.", t:["news","data","live"] },
  { d:"conflict", n:"Ground News", u:"https://ground.news", p:"Shows how outlets across the political spectrum cover the same story.", t:["news","bias"] },
  // earth & disasters
  { d:"earth", n:"GDACS disaster alerts", collector:"gdacs", u:"https://www.gdacs.org/Alerts/", p:"Global alerts and modeled impact estimates for natural hazards.", t:["live","hazards"] },
  { d:"earth", n:"USGS Latest Earthquakes", collector:"usgs", u:"https://earthquake.usgs.gov/earthquakes/map/", p:"Live map of earthquakes worldwide as they're recorded.", t:["live","quakes"] },
  { d:"earth", n:"GDACS", u:"https://www.gdacs.org", p:"UN/EU disaster alert system: quakes, cyclones, floods and volcanoes with impact estimates.", t:["live","alerts"] },
  { d:"earth", n:"NASA FIRMS", u:"https://firms.modaps.eosdis.nasa.gov/map/", p:"Active fire detections from satellites, updated within hours.", t:["live","fires","satellite"] },
  { d:"earth", n:"NASA EONET", u:"https://eonet.gsfc.nasa.gov", p:"Open natural-event tracker: storms, wildfires, icebergs, volcanoes.", t:["live","events"] },
  { d:"earth", n:"National Hurricane Center", u:"https://www.nhc.noaa.gov", p:"Official Atlantic and Eastern Pacific storm tracks and cones.", t:["live","storms"] },
  { d:"earth", n:"Sentinel Hub EO Browser", u:"https://apps.sentinel-hub.com/eo-browser/", p:"Free Sentinel and Landsat imagery. Compare before and after for floods, fires and strikes.", t:["satellite","imagery"] },
  // internet health
  { d:"internet", n:"Cloudflare Radar", collector:"radar-outages", u:"https://radar.cloudflare.com", p:"Internet traffic, outages, attacks and adoption trends by country. Great for spotting shutdowns.", t:["live","outages"] },
  { d:"internet", n:"IODA", collector:"ioda", u:"https://ioda.inetintel.cc.gatech.edu", p:"Georgia Tech's Internet Outage Detection and Analysis dashboard, by country and region.", t:["live","outages","shutdowns"] },
  { d:"internet", n:"OONI Explorer", u:"https://explorer.ooni.org", p:"Crowdsourced measurements of website and app blocking around the world.", t:["censorship","data"] },
  { d:"internet", n:"Downdetector", u:"https://downdetector.com", p:"User-reported outages for apps, carriers and services.", t:["live","outages"] },
  // space
  { d:"space", n:"ISS Mimic", u:"https://github.com/ISS-Mimic/Mimic", p:"Open-source project that mirrors live International Space Station telemetry.", t:["live","gh"] },
  { d:"space", n:"N2YO", u:"https://www.n2yo.com", p:"Live satellite tracking and pass predictions for your location.", t:["live","satellites"] },
  { d:"space", n:"Spot the Station", u:"https://spotthestation.nasa.gov", p:"NASA's ISS sighting times for your city.", t:["iss","sightings"] },
  { d:"space", n:"NOAA Space Weather", collector:"swpc", u:"https://www.swpc.noaa.gov", p:"Solar flares, geomagnetic storms and aurora forecasts.", t:["live","sun","aurora"] },
  // audio
  { d:"audio", n:"Broadcastify", u:"https://www.broadcastify.com", p:"Thousands of public police, fire and EMS scanner feeds.", t:["live","scanner"] },
  { d:"audio", n:"LiveATC", u:"https://www.liveatc.net", p:"Live air traffic control audio from airports worldwide.", t:["live","aviation"] },
  // lists
  { d:"lists", n:"Bellingcat Online Investigations Toolkit", u:"https://bellingcat.gitbook.io/toolkit", p:"Bellingcat's collaborative, categorized toolkit with how-to notes for each tool.", t:["toolkit","osint","guide"] },
  { d:"lists", n:"OSINT Framework", u:"https://osintframework.com", p:"Clickable tree of OSINT resources by data type.", t:["toolkit","osint"] },
  { d:"lists", n:"Awesome OSINT", u:"https://github.com/jivoi/awesome-osint", p:"The big curated OSINT index (~29k stars). See Video Search, Geospatial, and Live Cyber Threat Maps.", t:["gh","osint","index"] },
  { d:"lists", n:"Internet-OSINT (OSINT Toolbox)", u:"https://github.com/the-osint-toolbox/internet-osint", p:"Internet-wide resources, including a cluster of live camera directories and exposure search engines.", t:["gh","osint","cameras"] },
  { d:"lists", n:"OSINT_TIPS", u:"https://github.com/1h4wk/OSINT_TIPS", p:"Numbered tips that point to global camera networks, street cams and an airport webcam database.", t:["gh","osint","cameras"] },
  { d:"lists", n:"Awesome Public Real-Time Datasets", u:"https://github.com/bytewax/awesome-public-real-time-datasets", p:"Free and paid live feeds: transit, weather, quakes, finance, space.", t:["gh","data","feeds"] },
  { d:"lists", n:"OSINTme: IoT & Webcam Search Engines", u:"https://osintme.com/index.php/2023/02/28/20-links-for-iot-and-webcam-search-engines/", p:"Blog post that separates IoT search engines from tourism webcams.", t:["guide","cameras"] },
  // exposure
  { d:"exposure", n:"Shodan", u:"https://www.shodan.io", p:"Search engine for internet-connected devices: servers, ICS, routers, cameras.", t:["iot","recon"] },
  { d:"exposure", n:"Censys", u:"https://search.censys.io", p:"Maps hosts and certificates across the internet.", t:["iot","recon","certs"] },
  { d:"exposure", n:"ZoomEye", u:"https://www.zoomeye.ai", p:"Cyberspace search engine for IPs, domains, and exposed services.", t:["iot","recon"] },
  { d:"exposure", n:"Netlas", u:"https://app.netlas.io", p:"Internet asset search with responses, DNS and WHOIS data.", t:["iot","recon","dns"] }
];

const CITIES = [
  ["Los Angeles","America/Los_Angeles"],["New York","America/New_York"],["São Paulo","America/Sao_Paulo"],
  ["London","Europe/London"],["Rome","Europe/Rome"],["Athens","Europe/Athens"],["Kyiv","Europe/Kyiv"],
  ["Jerusalem","Asia/Jerusalem"],["Dubai","Asia/Dubai"],["Mumbai","Asia/Kolkata"],["Tokyo","Asia/Tokyo"],["Sydney","Australia/Sydney"]
];
