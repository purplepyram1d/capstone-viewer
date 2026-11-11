(() => {
  const { esc, read, save, channel } = Capstone;
  const defaults = CapstoneDeskModel.defaultStreams;
  const desk=CapstoneDesks.initial('wall'),parseInput=CapstoneDeskModel.parseStream;
  // A wall still holding exactly the original four defaults (never edited) moves up to the current defaults; edited walls are kept as they are.
  const oldDefaults = '@France24_en|@aljazeeraenglish|@SkyNews|@dwnews', untouched = list => Array.isArray(list) && list.map(s => s?.input).join('|') === oldDefaults;
  const saved = desk?.streams||read('capstone-streams',defaults), stored = untouched(saved) ? defaults : saved;
  let streams = validStreams(stored)?stored:defaults;
  function validStreams(list) { return Array.isArray(list)&&list.every(s=>s&&typeof s.name==='string'&&s.name.trim()&&typeof s.input==='string'&&parseInput(s.input)); }
  let players=[], ready=[], active=-1, generation=0, apiReady=false;
  const $=id=>document.getElementById(id);
  $('stream-count').textContent=`${streams.length} ${streams.length===1?'screen':'screens'}`;
  function muteAll(announce=false) { players.forEach(p=>{try{p?.mute();}catch{}});active=-1;updateAudio();if(announce)channel?.postMessage({type:'wall-audio',tile:-1}); }
  function updateAudio() { document.querySelectorAll('.stream-tile').forEach((tile,i)=>{tile.classList.toggle('listening',i===active);const button=tile.querySelector('[data-listen]'); button.textContent=i===active?'Mute':'Listen';button.setAttribute('aria-pressed',String(i===active));button.disabled=!ready[i];});$('audio-status').textContent=active<0?'All streams muted':`Listening: ${streams[active].name}`; }
  function listen(i) {if(!ready[i])return;const was=active===i;muteAll();if(!was){active=i;try{players[i].setVolume(75);players[i].unMute();players[i].playVideo();}catch{active=-1;}}updateAudio();channel?.postMessage({type:'wall-audio',tile:active});}
  function fallback(i,message) {const stage=$(`stage-${i}`),parsed=parseInput(streams[i].input);stage.innerHTML=`<div class="video-placeholder"><span class="brand-icon" aria-hidden="true">◭</span><span>${esc(message)}</span><a href="${esc(parsed.url)}" target="_blank" rel="noopener noreferrer">Open broadcaster on YouTube ↗</a></div>`;$(`status-${i}`).textContent='Unavailable in this player · edit the stream or open YouTube';ready[i]=false;if(active===i)muteAll();updateAudio();}
  async function mount(i,gen) {
    let parsed=parseInput(streams[i].input);
    try {
      if(parsed.channel){const response=await fetch('/api/stream?channel='+encodeURIComponent(parsed.channel),{signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not resolve a live stream.');parsed={...parsed,videoId:result.videoId};}
      if(gen!==generation)return;
      if(!apiReady)throw new Error('YouTube player could not load. Check your connection or open the broadcaster.');
      players[i]=new YT.Player(`player-${i}`,{videoId:parsed.videoId,width:'100%',height:'100%',playerVars:{autoplay:1,mute:1,playsinline:1,enablejsapi:1,origin:location.origin,rel:0},events:{
        onReady:e=>{if(gen!==generation){e.target.destroy();return;}ready[i]=true;e.target.mute();e.target.playVideo();$(`status-${i}`).textContent='Muted · waiting for playback';updateAudio();},
        onStateChange:e=>{if(gen!==generation)return;if(e.data===YT.PlayerState.PLAYING)$(`status-${i}`).textContent='Playing · broadcaster stream';if(e.data===YT.PlayerState.ENDED){muteAll();$(`status-${i}`).textContent='Stream ended · reload or edit to choose a new stream';}if(e.data===YT.PlayerState.PAUSED)$(`status-${i}`).textContent='Paused · use player controls to resume';},
        onAutoplayBlocked:()=>{if(gen===generation)$(`status-${i}`).textContent='Autoplay blocked · press Play in the player';},
        onError:e=>{if(gen===generation)fallback(i,[101,150].includes(e.data)?'This broadcaster does not allow embedding.':`YouTube could not play this stream (code ${e.data}).`);}
      }});
    } catch(error) { if(gen===generation)fallback(i,error.message); }
  }
  function render() {
    muteAll();generation++;const gen=generation;players.forEach(p=>{try{p?.destroy();}catch{}});players=[];ready=[];
    $('wall').innerHTML=streams.map((s,i)=>`<section class="stream-tile"><div class="video-stage" id="stage-${i}"><div id="player-${i}" class="video-mount"><div class="video-placeholder"><span class="brand-icon" aria-hidden="true">◭</span><span>Connecting to ${esc(s.name)}…</span></div></div></div><div class="stream-info"><div class="stream-label">${esc(s.name)}<small>FEED ${String(i+1).padStart(2,'0')} · <span class="stream-status" id="status-${i}">Looking for a live stream…</span></small></div><div class="stream-controls"><button data-listen="${i}" disabled aria-pressed="false">Listen</button><a href="${esc(parseInput(s.input).url)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div></div></section>`).join('');
    streams.forEach((_,i)=>void mount(i,gen));updateAudio();$('stream-count').textContent=`${streams.length} ${streams.length===1?'screen':'screens'}`;
    if(!streams.length)$('wall').innerHTML='<div class="empty-wall"><h2>Your wall is empty</h2><p>Add a YouTube stream to start watching.</p><button data-add-stream>Add stream</button></div>';
    layout();
  }
  $('wall').onclick=e=>{const b=e.target.closest('[data-listen]');if(b)listen(Number(b.dataset.listen));if(e.target.closest('[data-add-stream]'))openEditor(true);};
  $('mute-all').onclick=()=>muteAll(true);
  function editRows(list) { $('stream-fields').innerHTML=list.map((s,i)=>`<fieldset class="stream-editor-row"><legend>Screen ${i+1}</legend><div class="stream-field"><label>Name<input data-name value="${esc(s.name)}" maxlength="80" required></label><label>YouTube link, ID, or @handle<input data-input value="${esc(s.input)}" maxlength="250" required spellcheck="false"></label></div><div class="row-actions"><button type="button" data-move="-1" ${i===0?'disabled':''} aria-label="Move screen ${i+1} up">↑ Move up</button><button type="button" data-move="1" ${i===list.length-1?'disabled':''} aria-label="Move screen ${i+1} down">↓ Move down</button><button type="button" data-remove aria-label="Remove screen ${i+1}">Remove</button></div></fieldset>`).join(''); }
  function draftRows() {return [...$('stream-fields').children].map(row=>({name:row.querySelector('[data-name]').value.trim(),input:row.querySelector('[data-input]').value.trim()}));}
  function addRow() {editRows([...draftRows(),{name:'',input:''}]);const row=$('stream-fields').lastElementChild;row.querySelector('input').focus();row.scrollIntoView({block:'nearest'});}
  function openEditor(add=false) {editRows(streams);$('stream-error').textContent='';$('stream-dialog').showModal();if(add)addRow();}
  $('edit-streams').onclick=()=>openEditor();
  $('add-stream').onclick=()=>openEditor(true);
  $('add-stream-row').onclick=addRow;
  let presets=[];
  fetch('/assets/stream-presets.json').then(r=>{if(!r.ok)throw new Error('Library unavailable');return r.json();}).then(list=>{presets=list.filter(s=>validStreams([s]));$('stream-preset').innerHTML='<option value="">Choose a broadcaster to add…</option>'+presets.map((s,i)=>`<option value="${i}">${esc(s.name)}</option>`).join('');}).catch(()=>{$('stream-preset').innerHTML='<option value="">Library unavailable · paste a link below</option>';});
  $('stream-preset').onchange=e=>{if(e.target.value==='')return;const preset=presets[Number(e.target.value)];if(!preset)return;const list=draftRows(),blank=list.findIndex(s=>!s.name&&!s.input);if(blank>=0)list[blank]={...preset};else list.push({...preset});editRows(list);e.target.value='';};
  $('stream-fields').onclick=e=>{const button=e.target.closest('button');if(!button)return;const index=[...$('stream-fields').children].indexOf(button.closest('fieldset')),list=draftRows();if(button.hasAttribute('data-remove'))list.splice(index,1);else if(button.dataset.move){const target=index+Number(button.dataset.move);if(target<0||target>=list.length)return;[list[index],list[target]]=[list[target],list[index]];}else return;editRows(list);};
  $('close-dialog').onclick=()=>$('stream-dialog').close();$('reset-streams').onclick=()=>editRows(defaults);
  $('stream-form').onsubmit=e=>{e.preventDefault();const next=draftRows();if(!validStreams(next)){$('stream-error').textContent='Each screen needs a name and a valid YouTube video or channel.';return;}streams=next;const saved=CapstoneDesks.active()?CapstoneDesks.update():save('capstone-streams',streams);$('stream-dialog').close();$('wall-message').textContent=saved?'Stream wall saved.':'Stream wall changed for this session; browser storage is unavailable.';render();if(!CapstoneDesks.active())channel?.postMessage({type:'streams-updated'});};
  const columns=$('wall-columns'),savedColumns=String(desk?.columns||read('capstone-wall-columns','auto'));
  columns.value=['auto','1','2','3','4','5','6'].includes(savedColumns)?savedColumns:'auto';
  // Every screen stays in view: the grid fills the window below the heading, and each 16:9 tile is sized so all rows fit.
  // Auto tries every column count and keeps the one with the largest video; a chosen count is still shrunk to fit the height.
  function layout(){const grid=$('wall'),tiles=grid.querySelectorAll('.stream-tile'),n=tiles.length;if(!n||matchMedia('(max-width:760px)').matches){grid.style.gridTemplateColumns='';return;}
    const gap=parseFloat(getComputedStyle(grid).columnGap)||10,W=grid.clientWidth,H=grid.clientHeight,chrome=tiles[0].offsetHeight-tiles[0].querySelector('.video-stage').offsetHeight;
    const fit=c=>{const rows=Math.ceil(n/c);return Math.max(48,Math.min((W-gap*(c-1))/c,((H-gap*(rows-1))/rows-chrome)*16/9));};
    let c=columns.value==='auto'?1:Math.min(Number(columns.value),n);if(columns.value==='auto')for(let k=2;k<=n;k++)if(fit(k)>fit(c)+1)c=k;
    grid.style.gridTemplateColumns=`repeat(${c},${Math.floor(fit(c))}px)`;}
  columns.onchange=()=>{if(CapstoneDesks.active())CapstoneDesks.update();else save('capstone-wall-columns',columns.value);layout();};new ResizeObserver(layout).observe($('wall'));layout();
  channel?.addEventListener('message',e=>{if(e.data?.type==='wall-audio')muteAll();if(e.data?.type==='streams-updated'&&!CapstoneDesks.active()){const next=read('capstone-streams',defaults);if(validStreams(next)){streams=next;render();}}});
  CapstoneDesks.register('wall',()=>({streams:streams.map(s=>({...s})),columns:columns.value}));
  window.addEventListener('pagehide',()=>{CapstoneDesks.update();muteAll(true);});
  let booted=false;function boot(){if(booted)return;booted=true;render();}
  window.onYouTubeIframeAPIReady=()=>{apiReady=true;if(booted)render();else boot();};
  const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=boot;document.head.append(script);setTimeout(boot,10000);
})();
