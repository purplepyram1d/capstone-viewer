import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseClaim, classifyClaim, plain } from '../lib/claims.mjs';
import { feedConfig, normalizeBluesky } from '../lib/social.mjs';
import { family } from '../lib/hotspots.mjs';
const countries=JSON.parse(readFileSync(new URL('../assets/countries.json',import.meta.url)));
// Hackmanac writes victim names in Mathematical Sans-Serif Bold letters.
const bold=s=>[...s].map(c=>/[A-Z]/.test(c)?String.fromCodePoint(0x1D5D4+c.charCodeAt(0)-65):/[a-z]/.test(c)?String.fromCodePoint(0x1D5EE+c.charCodeAt(0)-97):c).join('');

test('flag-led relay posts become country-placed claims with group and victim',()=>{
 const c=parseClaim(`🚨Cyber Alert ‼️\n\n🇺🇸US - ${bold('EMARKETER')}\n\nFulcrumSec hacking group claims to have breached EMARKETER, allegedly exfiltrating 15.8 TB of data.`,countries);
 assert.equal(c.country,'US');assert.equal(c.victim,'EMARKETER');assert.equal(c.claim_group,'FulcrumSec');assert.equal(c.kind,'claim');assert.equal(c.claim_type,'breach');
 assert.equal(c.title,'Breach claim: FulcrumSec says it hit EMARKETER (United States)');assert.equal(c.place_basis,'country_centroid');assert.match(c.confidence,/Unverified/);
 const uk=parseClaim(`🚨Cyber Alert ‼️\n\n🇬🇧UK - ${bold('PwC')}\n\nThe Everest hacking group claims to have stolen 590 GB of data from PwC.`,countries);
 assert.equal(uk.country,'GB','UK alias');assert.equal(uk.claim_group,'Everest');
 const ransom=parseClaim(`🚨Cyber Alert ‼️\n\n🇮🇹Italy - ${bold('Coop')}\n\nQilin ransomware group claims to have breached Coop.`,countries);assert.equal(ransom.claim_type,'ransomware');assert.equal(family(ransom),'ransomware');
 const egypt=parseClaim(`🚨Cyber Alert ‼️\n\n🇪🇬Egypt: ${bold('Telecom Egypt - We academy')}\n\nThe n0n hacker group claims to have breached Telecom Egypt's training academy.`,countries);assert.equal(egypt.victim,'Telecom Egypt - We academy');
});

test('confirmed incidents, hacktivist DDoS and structured fields are classified correctly',()=>{
 const confirmed=parseClaim(`🚨Cyber Alert ‼️\n\n🇯🇵Japan - ${bold('Capcom')}\n\nCapcom confirmed a cyberattack targeting its CAPCOM ID account system.`,countries);
 assert.equal(confirmed.kind,'incident');assert.equal(confirmed.title,'Confirmed incident: Capcom (Japan)');assert.match(confirmed.confidence,/Victim-confirmed/);assert.equal(family(confirmed),'incident');
 const ddos=parseClaim(`🚨Cyber Alert ‼️\n\n🇱🇹Lithuania - ${bold('Vilnius Airport')}\n\nNoName057(16) claims DDoS attacks on the airport website.`,countries);
 assert.equal(ddos.claim_type,'hacktivist');assert.equal(ddos.score,60);assert.equal(family(ddos),'hacktivist');
 const structured=parseClaim(`🚨Cyber Alert ‼️\n\n🇪🇸Spain - ${bold('Toyota Canarias')}\n\nAttack reported.\nThreat actor: Qilin   Sector: Retail`,countries);assert.equal(structured.claim_group,'Qilin');
 assert.equal(classifyClaim('Railway disclosed a security incident').type,'confirmed');assert.equal(plain(bold('Haier')),'Haier');
});

test('posts without a leading country flag, or with an unknown one, stay ordinary posts',()=>{
 assert.equal(parseClaim('‼️ LiteLLM Supply Chain Attack: Hackers hijack release pipeline',countries),null);
 assert.equal(parseClaim('🟧 #HackTuesday 🟧 585 cyber attacks across 64 countries',countries),null);
 assert.equal(parseClaim('Weekly update for everyone 🇺🇦',countries),null,'a trailing language flag is not a target');
 assert.equal(parseClaim('🇦🇶Antarctica - Base\n\nclaims to have breached',{}),null);
});

test('claims mode is opt-in per feed and only reshapes matching posts',()=>{
 const post=(rkey,text)=>({post:{uri:`at://did:plc:x/app.bsky.feed.post/${rkey}`,author:{handle:'hackmanac.com'},record:{text,createdAt:'2026-10-23T10:00:00Z'}}});
 const data={feed:[post('3aaaaaaaaa1',`🚨Cyber Alert ‼️\n\n🇯🇵Japan - ${bold('Keio')}\n\nThe Qilin ransomware group claims to have breached Keio Corporation.`),post('3aaaaaaaaa2','‼️ Supply chain attack news')]};
 const now=Date.parse('2026-10-23T12:00:00Z');
 const relay=normalizeBluesky(data,feedConfig({platform:'bluesky',input:'hackmanac.com',claims:true}),now);
 assert.equal(relay[0].kind,'claim');assert.equal(relay[0].country,'JP');assert.equal(relay[0].lat,countries.JP.lat);assert.equal(relay[0].platform,'bluesky');assert.equal(relay[1].kind,'social');
 const normal=normalizeBluesky(data,feedConfig({platform:'bluesky',input:'hackmanac.com'}),now);assert.equal(normal[0].kind,'social');assert.equal(normal[0].lat,null);
 assert.throws(()=>feedConfig({platform:'bluesky',input:'hackmanac.com',claims:'yes'}),/true or false/);
});
