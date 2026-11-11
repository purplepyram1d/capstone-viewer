import {fetchText} from '../lib/collectors.mjs';
import {parseRSS} from '../lib/events.mjs';
for(const [name,url] of [['Tesla official','https://ir.tesla.com/rss/news-releases.xml'],['Musk news','https://news.google.com/rss/search?q=%22Elon%20Musk%22%20when%3A7d&hl=en-US&gl=US&ceid=US%3Aen']]){try{const body=await fetchText(url);const rows=parseRSS(body);console.log(name,rows.length,rows[0]?.title,rows[0]?.ts);}catch(e){console.log(name,e.message);}}
