// Groups, desks, curated sources, and clock-rail cities.
// Each source: d = desk id, n = name, u = url, p = one-line description, t = tags.
const GROUPS = [
  { id: "cyber", name: "Cyber Watch", blurb: "Real incidents as they surface: who got hit, what's being exploited, what's spreading." },
  { id: "world", name: "World Watch", blurb: "Eyes on the physical world: cameras, traffic, weather, conflict." },
  { id: "ref", name: "Reference", blurb: "The indexes and toolkits behind this desk." }
];
const DESKS = [
  { g: "cyber", id: "ransomware", name: "Ransomware", blurb: "Leak-site trackers that show victims as gangs post them. These are claims; confirm with the victim's own statement." },
  { g: "cyber", id: "exploit", name: "Active Exploitation", blurb: "What attackers are scanning for and exploiting right now, and which CVEs are confirmed in the wild." },
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
  { d:"ransomware", n:"Ransomware.live", u:"https://www.ransomware.live", p:"Near real-time tracker of victims posted to ransomware leak sites, by group, country and sector.", t:["live","leak sites","claims"] },
  { d:"ransomware", n:"RansomLook", u:"https://www.ransomlook.io", p:"Open-source leak-site tracker. Use it to cross-check Ransomware.live.", t:["live","leak sites","open source"] },
  // active exploitation
  { d:"exploit", n:"CISA Known Exploited Vulnerabilities", u:"https://www.cisa.gov/known-exploited-vulnerabilities-catalog", p:"CVEs confirmed exploited in the wild, with federal patch deadlines. A new entry means patch now.", t:["kev","cve","gov"] },
  { d:"exploit", n:"GreyNoise Visualizer", u:"https://viz.greynoise.io", p:"Mass scanning and exploitation attempts by tag. Trending tags show a new CVE getting sprayed.", t:["live","scanning","cve"] },
  { d:"exploit", n:"SANS Internet Storm Center", u:"https://isc.sans.edu", p:"Daily handler diary, DShield sensor data and the Infocon threat level.", t:["live","dshield","diary"] },
  { d:"exploit", n:"Shadowserver Dashboard", u:"https://dashboard.shadowserver.org", p:"Global stats on compromised and vulnerable devices, by country and over time.", t:["live","exposure","by country"] },
  { d:"exploit", n:"CISA Cybersecurity Advisories", u:"https://www.cisa.gov/news-events/cybersecurity-advisories", p:"Joint advisories on active threat actors, ICS flaws and emergency directives.", t:["advisories","gov","ics"] },
  { d:"exploit", n:"FIRST EPSS", u:"https://www.first.org/epss/", p:"Daily probability that a CVE will be exploited in the next 30 days. Pairs well with KEV.", t:["cve","scoring"] },
  // malware & iocs
  { d:"iocs", n:"ThreatFox", u:"https://threatfox.abuse.ch", p:"abuse.ch's shared database of IOCs: IPs, domains and hashes tied to malware families.", t:["live","iocs","abuse.ch"] },
  { d:"iocs", n:"URLhaus", u:"https://urlhaus.abuse.ch", p:"Malicious URLs used for malware distribution, updated continuously.", t:["live","urls","abuse.ch"] },
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
  { d:"earth", n:"USGS Latest Earthquakes", u:"https://earthquake.usgs.gov/earthquakes/map/", p:"Live map of earthquakes worldwide as they're recorded.", t:["live","quakes"] },
  { d:"earth", n:"GDACS", u:"https://www.gdacs.org", p:"UN/EU disaster alert system: quakes, cyclones, floods and volcanoes with impact estimates.", t:["live","alerts"] },
  { d:"earth", n:"NASA FIRMS", u:"https://firms.modaps.eosdis.nasa.gov/map/", p:"Active fire detections from satellites, updated within hours.", t:["live","fires","satellite"] },
  { d:"earth", n:"NASA EONET", u:"https://eonet.gsfc.nasa.gov", p:"Open natural-event tracker: storms, wildfires, icebergs, volcanoes.", t:["live","events"] },
  { d:"earth", n:"National Hurricane Center", u:"https://www.nhc.noaa.gov", p:"Official Atlantic and Eastern Pacific storm tracks and cones.", t:["live","storms"] },
  { d:"earth", n:"Sentinel Hub EO Browser", u:"https://apps.sentinel-hub.com/eo-browser/", p:"Free Sentinel and Landsat imagery. Compare before and after for floods, fires and strikes.", t:["satellite","imagery"] },
  // internet health
  { d:"internet", n:"Cloudflare Radar", u:"https://radar.cloudflare.com", p:"Internet traffic, outages, attacks and adoption trends by country. Great for spotting shutdowns.", t:["live","outages"] },
  { d:"internet", n:"IODA", u:"https://ioda.inetintel.cc.gatech.edu", p:"Georgia Tech's Internet Outage Detection and Analysis dashboard, by country and region.", t:["live","outages","shutdowns"] },
  { d:"internet", n:"OONI Explorer", u:"https://explorer.ooni.org", p:"Crowdsourced measurements of website and app blocking around the world.", t:["censorship","data"] },
  { d:"internet", n:"Downdetector", u:"https://downdetector.com", p:"User-reported outages for apps, carriers and services.", t:["live","outages"] },
  // space
  { d:"space", n:"ISS Mimic", u:"https://github.com/ISS-Mimic/Mimic", p:"Open-source project that mirrors live International Space Station telemetry.", t:["live","gh"] },
  { d:"space", n:"N2YO", u:"https://www.n2yo.com", p:"Live satellite tracking and pass predictions for your location.", t:["live","satellites"] },
  { d:"space", n:"Spot the Station", u:"https://spotthestation.nasa.gov", p:"NASA's ISS sighting times for your city.", t:["iss","sightings"] },
  { d:"space", n:"NOAA Space Weather", u:"https://www.swpc.noaa.gov", p:"Solar flares, geomagnetic storms and aurora forecasts.", t:["live","sun","aurora"] },
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
