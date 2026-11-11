import {muskNewsUrl,normalizeMuskNews,createMuskTracker} from './musk.mjs';
export const putinEntities=[
 {id:'putin',name:'Vladimir Putin',query:'"Vladimir Putin"',official:'https://en.kremlin.ru/events/president/news',reference_label:'Kremlin presidential statements (Russian official position)'},
 {id:'kremlin',name:'Kremlin & leadership',query:'Kremlin (Putin OR Peskov OR Russia)',official:'https://en.kremlin.ru/',reference_label:'Kremlin website (Russian official position)'},
 {id:'diplomacy',name:'Foreign policy',query:'(Putin OR Kremlin OR Russia) (diplomacy OR summit OR negotiations OR treaty)',official:'https://news.un.org/en/',reference_label:'UN News (institutional reporting)'},
 {id:'ukraine',name:'War in Ukraine',query:'(Russia OR Putin OR Kremlin) Ukraine (war OR ceasefire OR attacks)',official:'https://ukraine.un.org/en',reference_label:'United Nations in Ukraine'},
 {id:'sanctions',name:'Sanctions',query:'(Russia OR Russian OR Putin) sanctions',official:'https://www.consilium.europa.eu/en/policies/sanctions-against-russia/',reference_label:'EU Council sanctions policy'},
 {id:'economy',name:'Energy & economy',query:'Russia (oil OR gas OR economy OR budget OR Gazprom OR Rosneft)',official:'https://www.iea.org/countries/russia',reference_label:'IEA Russia energy reference'},
 {id:'security',name:'Cyber & influence',query:'(Russia OR Russian OR Kremlin) (cyberattack OR hacking OR espionage OR disinformation)',official:'https://www.cisa.gov/topics/cyber-threats-and-advisories/advanced-persistent-threats/russia',reference_label:'CISA Russian cyber threat advisories'}
];
export function matchPutinEntities(value){const t=String(value||'').normalize('NFKC'),ids=[];
 if(/\bputin\b|владимир\s+путин/iu.test(t))ids.push('putin');
 if(/\bkremlin\b|\bpeskov\b|кремл/iu.test(t))ids.push('kremlin');
 const context=/\b(?:russia|russian|putin|kremlin|moscow|lavrov)\b|росси|путин|кремл/iu.test(t);
 if(!context)return ids;
 if(/\b(?:diplomacy|diplomatic|summit|negotiations?|negotiators?|treaty|talks|foreign policy|lavrov|peace deal)\b/i.test(t))ids.push('diplomacy');
 if(/\b(?:ukraine|ukrainian|kyiv|donbas|donetsk|zaporizhzhia)\b|украин/iu.test(t))ids.push('ukraine');
 if(/\bsanctions?\b|\basset freeze\b|\bembargo\b|\bshadow fleet\b/i.test(t))ids.push('sanctions');
 if(/\b(?:oil|gas|energy|economy|economic|budget|gazprom|rosneft|ruble|rouble|inflation|crude|lng)\b/i.test(t))ids.push('economy');
 if(/\b(?:cyberattack|cyber|hacking|hackers?|espionage|disinformation|intelligence|gru|fsb|svr|sabotage|election interference)\b/i.test(t))ids.push('security');
 return ids;}
export const putinNewsUrl=muskNewsUrl;
export function attributePutinReport(e){
 const publisher=e.publisher||e.source||'';
 const statement=/^(?:kremlin|president of russia|president of the russian federation)$/i.test(publisher),state=/^(?:tass(?: russian news agency)?|rt|rt\.com|russia today|sputnik(?: news)?|ria novosti|russia beyond)$/i.test(publisher);
 if(!statement&&!state)return e;
 return {...e,source_type:statement?'official_statement':'state_media',confidence:statement?'Official Russian statement, not independent verification':'Russian state media report, not independently verified'};
}
export function normalizePutinNews(xml,now=Date.now()) {return normalizeMuskNews(xml,now,{match:matchPutinEntities,tracker:'putin',category:'geo'}).map(attributePutinReport);}
export const createPutinTracker=db=>createMuskTracker(db,{registry:putinEntities,match:matchPutinEntities,tracker:'putin',matchXAuthors:false,decorate:attributePutinReport});
