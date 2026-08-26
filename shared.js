/* ===== 神センス0.15 共通ロジック（全画面共通） ===== */
const CH='kamisense-015';
/* 通信層：サーバー配信(http/https)＝短ポーリング（プロキシ/トンネルでも確実） / file:// or APP_LOCAL=BroadcastChannel（同一PCデモ）
   ・非admin端末は GET /state を約0.7秒毎に取得し、版(v)が変われば state を配信。goSeq増加で {type:'go',goAt} を合成。
   ・admin は GET /inbox?since= で参加者メッセージ(join/vote/result)を取得。
   ・サーバー時刻(now)から時計オフセットを求め、goAt(サーバー時刻)で6人の同時スタートを揃える。 */
function busBase(){
  if(typeof window==='undefined')return null;
  if(window.APP_LOCAL)return null;
  try{ if(/^https?:$/.test(location.protocol))return ''; }catch(e){}
  return null;
}
function makeBus(role){
  const base=busBase();
  if(base===null){
    const bc=new BroadcastChannel(CH); let h=null; bc.onmessage=ev=>{ if(h)h(ev.data); }; setConn(true);
    return {mode:'bc', post(m){bc.postMessage(m);}, onMessage(fn){h=fn;}, serverNow(){return Date.now();}};
  }
  let handler=null, started=false, lastV=-1, lastSeq=0, lastGo=0, offset=0, fails=0, seenState=false;
  let bestRtt=1e9, synced=0;   // NTP風クロック同期：RTT補正＋最小RTTのサンプルだけ採用してジッタを除去（発走ゼロの共有精度を上げる）
  // 投影/運営は速く、挑戦者(6台)は中庸、観客(数百台=群衆)は控えめ。発走同期はサーバ時刻(goAt)で合わせるためポーリング頻度に依存せず、観客を緩めても体感は変わらない＝サーバ負荷を大きく下げる。
  const POLL = role==='screen'?280 : role==='admin'?300 : role==='player'?700 : 1400;
  function applyTime(sNow,tSend,tRecv){ if(typeof sNow!=='number')return; const rtt=tRecv-tSend; const off=(sNow+rtt/2)-tRecv;   // サーバ時刻を受信時点へ換算（片道≒RTT/2）
    bestRtt=bestRtt*1.06+4;                          // 採用基準を毎回わずかに緩め、回線変化に追従しつつ再ロック可能に
    if(rtt<=bestRtt){ offset=off; bestRtt=rtt; synced++; } }   // 低RTT時＝ネット歪みが小さい瞬間の値だけ採用
  function fetchT(url,ms){ const c=(typeof AbortController!=='undefined')?new AbortController():null; const to=c?setTimeout(function(){try{c.abort();}catch(e){}},ms):0;
    return fetch(url,{cache:'no-store',signal:c?c.signal:undefined}).finally(function(){ if(to)clearTimeout(to); }); }   // ハング対策：応答が来なくても中断→次のtickへ（1回の詰まりでポーリングが永久停止しない）
  function syncTime(){ const t=Date.now(); fetchT(base+'/time',4000).then(r=>r.json()).then(d=>applyTime(d.now,t,Date.now())).catch(()=>{}); }
  function tick(){
    const url = role==='admin' ? (base+'/inbox?since='+lastSeq) : (base+'/state'); const t=Date.now();
    fetchT(url,6000).then(r=>r.json()).then(d=>{
      fails=0; setConn(true); applyTime(d.now,t,Date.now());
      if(role==='admin'){ (d.msgs||[]).forEach(m=>{ if(m._seq>lastSeq)lastSeq=m._seq; if(handler)handler(m); }); }
      else if(d.state && d.v!==lastV){ lastV=d.v; if(handler)handler(d.state);
        const gs=(d.state.s&&d.state.s.goSeq)||0, ph=(d.state.s&&d.state.s.phase);
        // 発走判定：goSeqが「変化」し（reset等の減少も追従）かつ phase が countdown の時だけ発走。初回接続はcountdown中なら復元、それ以外は消化して幻の発走を出さない
        if(!seenState){ seenState=true; lastGo=gs; if(ph==='countdown'&&handler) handler({type:'go', goAt:(d.state.s&&d.state.s.goAt)||0}); }
        else if(gs!==lastGo){ lastGo=gs; if(ph==='countdown'&&handler) handler({type:'go', goAt:(d.state.s&&d.state.s.goAt)||0}); } }
    }).catch(()=>{ if(++fails>2)setConn(false); }).finally(()=>{ setTimeout(tick,POLL); });
  }
  return {mode:'poll',
    post(m){ try{ fetch(base+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)}).catch(()=>{}); }catch(e){} },
    onMessage(fn){ handler=fn; if(!started){ started=true;
      const SB=(role==='screen'||role==='player')?8:2;   // 時計を使う投影/挑戦者だけ8連射で素早く収束。観客(群衆)は2回で十分＝QR一斉スキャン時の/timeバーストを大幅に削減
      for(let i=0;i<SB;i++) setTimeout(syncTime,i*150); tick(); } },
    setSeq(n){ lastSeq=n; },
    serverNow(){ return Date.now()+offset; }, syncQuality(){ return {offset:Math.round(offset), bestRtt:Math.round(bestRtt), synced}; } };
}
function setConn(ok){ try{ const e=document.getElementById('conn'); if(e){ e.className='conn '+(ok?'ok':'ng'); e.textContent=(ok?'● 接続中':'○ 未接続'); } }catch(e){} }
function appUrl(){ try{ if(window.APP_URL)return window.APP_URL; return (location.origin||'')+'/'; }catch(e){ return '/'; } }

const N=6, TARGET=0.15, ZERO_AT=10.0, HIDE_REMAIN=4.0, RING_LEN=578, TAKEOUT=0;
const COL=[{b:'var(--k1)',t:'var(--k1t)'},{b:'var(--k2)',t:'var(--k2t)'},{b:'var(--k3)',t:'var(--k3t)'},{b:'var(--k4)',t:'var(--k4t)'},{b:'var(--k5)',t:'var(--k5t)'},{b:'var(--k6)',t:'var(--k6t)'}];
const HEX=['#ffffff','#1b1f26','#ff2b3e','#1f7bff','#ffd21e','#15b45f'];
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
/* ボートレース本準拠のST評価：0秒に近いほど攻めた神スタート */
function grade(st){
  if(st==null) return {l:'未挑戦', c:'var(--muted)', i:'—'};
  if(st<0) return {l:'フライング (F)', c:'var(--red)', i:'❌'};
  if(st<=0.15) return {l:'神スタート！', c:'var(--gold)', i:'👑'};
  if(st<=0.19) return {l:'平均的', c:'#cfe6f5', i:'🏆'};
  return {l:'遅い！', c:'var(--muted)', i:'🐢'};
}
function odds(votes,i){ const t=votes.reduce((a,b)=>a+b,0); if(!t)return null; const v=votes[i]||0.5; return Math.max(1,(t*(1-TAKEOUT))/v); }
function favIndex(votes){ const t=votes.reduce((a,b)=>a+b,0); if(!t)return -1; let m=0; for(let i=1;i<N;i++) if(votes[i]>votes[m])m=i; return votes[m]>0?m:-1; }
function oddsHTML(o){ return o==null?'—':('<span class="x">×</span>'+o.toFixed(1)); }
/* 0秒に近い順（有効ST>=0）。フライング/未挑戦は最下位 */
function ranking(results){
  const idx=[...Array(N).keys()];
  idx.sort((a,b)=>{ const fa=results[a]==null||results[a]<0, fb=results[b]==null||results[b]<0;
    if(fa&&fb)return 0; if(fa)return 1; if(fb)return -1; return results[a]-results[b]; });
  return idx;
}
function boatSVG(cls){ return `<svg class="${cls||'boaticon'}" viewBox="0 0 92 40" preserveAspectRatio="xMidYMid meet"><g fill="rgba(255,255,255,.78)"><path d="M3,30 Q5,15 12,26 Q8,23 7,32 Z"/><path d="M9,31 Q13,13 21,27 Q15,23 13,33 Z" opacity=".82"/><circle cx="6" cy="17" r="1.7"/><circle cx="11.5" cy="12.5" r="1.4"/><circle cx="17" cy="16" r="1.5"/><circle cx="3.5" cy="24" r="1.5"/></g><path d="M16,23 l8.5,-1 l1,6.4 l-9.5,1 Z" fill="#33495a"/><path d="M20,26.5 L74,21.5 Q88,21.5 84,29 L34,31.5 Q22,31.5 20,26.5 Z" fill="#eef4f8"/><path d="M20,26.5 Q22,31.5 34,31.5 L84,29 Q85.4,30.6 81,32 L32,34 Q20.5,33.2 20,26.5 Z" fill="#adc3d2"/><path d="M40,24.6 L57,23.1 L52.5,27.4 L42.5,27.6 Z" fill="#0f1e28"/><path d="M44,24.2 Q46,13.6 51.5,14.4 Q57,15.2 56,24.4 Z" fill="var(--bc)" stroke="rgba(0,0,0,.28)" stroke-width=".6"/><circle cx="49" cy="12" r="5.1" fill="var(--bc)" stroke="rgba(0,0,0,.28)" stroke-width=".6"/><path d="M46.2,11.2 a3.3,3.3 0 0 1 5.6,0 Z" fill="rgba(0,0,0,.45)"/><g fill="rgba(255,255,255,.9)"><circle cx="84" cy="22.5" r="2.1"/><circle cx="88.4" cy="25" r="1.5"/></g></svg>`; }
function turnSVG(){ return `<svg class="tmark" viewBox="0 0 26 44" preserveAspectRatio="xMidYMid meet"><ellipse cx="13" cy="40" rx="10" ry="3.5" fill="rgba(0,0,0,.35)"/><rect x="11" y="7" width="3" height="30" rx="1.5" fill="#c9d6df"/><path d="M14,7 L24,10.5 L14,14 Z" fill="#ff6a1a"/><path d="M4,32 Q13,28 22,32 L22,37 Q13,41 4,37 Z" fill="#ff7a1a"/></svg>`; }
function sceneHTML(){ return `<div class="scene"><div class="glow g-teal"></div><div class="glow g-orange"></div><div class="waves"><svg viewBox="0 0 1200 300" preserveAspectRatio="none"><path class="wln" d="M0,120 C150,80 300,160 450,120 S750,80 900,120 1050,160 1200,120"/><path class="wln" d="M0,180 C180,140 320,210 480,175 S760,135 920,180 1080,215 1200,175"/><path class="wln" d="M0,240 C160,205 340,265 520,235 S800,195 980,240 1120,270 1200,235"/></svg></div><div class="vignette"></div></div>`; }
function clockSVG(){ let t=''; for(let i=0;i<60;i++){ const a=(i*6-90)*Math.PI/180, r1=i%5===0?80:85, r2=91; t+=`<line x1="${(100+r1*Math.cos(a)).toFixed(1)}" y1="${(100+r1*Math.sin(a)).toFixed(1)}" x2="${(100+r2*Math.cos(a)).toFixed(1)}" y2="${(100+r2*Math.sin(a)).toFixed(1)}" stroke="rgba(120,200,240,${i%5===0?.55:.22})" stroke-width="${i%5===0?2:1}"/>`; }
  return `<svg class="clock" id="clockSvg" viewBox="0 0 200 200"><defs><linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34e0ff"/><stop offset="1" stop-color="#ffd24a"/></linearGradient><radialGradient id="face" cx="50%" cy="42%" r="65%"><stop offset="0" stop-color="#0c2f4a"/><stop offset="1" stop-color="#051422"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="url(#face)" stroke="rgba(120,200,240,.2)" stroke-width="1.5"/><circle cx="100" cy="100" r="92" fill="none" stroke="rgba(120,200,240,.12)" stroke-width="8"/><circle id="progress" cx="100" cy="100" r="92" fill="none" stroke="url(#ring)" stroke-width="8" stroke-linecap="round" stroke-dasharray="578" stroke-dashoffset="578" transform="rotate(-90 100 100)" style="filter:drop-shadow(0 0 6px rgba(47,228,255,.6))"/><g>${t}</g><line id="hand" x1="100" y1="100" x2="100" y2="24" stroke="#ff6a1a" stroke-width="4.5" stroke-linecap="round" style="filter:drop-shadow(0 0 5px rgba(255,106,26,.8))"/><circle cx="100" cy="100" r="7" fill="#eaf6ff"/><circle cx="100" cy="100" r="3" fill="#ff6a1a"/></svg>`; }
/* WebAudio */
let _ac=null, _muted=false;
function AC(){ try{ _ac=_ac||new (window.AudioContext||window.webkitAudioContext)(); if(_ac.state==='suspended')_ac.resume(); }catch(e){} return _ac; }
function setMuted(m){ _muted=m; }
/* 自作の合成音（WebAudioシンセ）は完全撤去：信弦さん指示。BGM/効果音は差し込んだmp3のみ。 */
function tone(){ }
function fanfare(){ }
function whistle(){ }
function engineRev(){ }
function confetti(){ const cols=['#ffd24a','#2fe4ff','#ff6a1a','#15b45f','#ff2d78','#fff']; for(let k=0;k<64;k++){ const e=document.createElement('div'); e.className='conf'; e.style.left=(Math.random()*100)+'vw'; e.style.background=cols[k%cols.length]; document.body.appendChild(e); const dur=1500+Math.random()*1300,x=(Math.random()*2-1)*90; e.animate([{transform:'translate(0,-12px) rotate(0)',opacity:1},{transform:`translate(${x}px,105vh) rotate(${760*(Math.random()>.5?1:-1)}deg)`,opacity:.85}],{duration:dur,easing:'cubic-bezier(.2,.6,.4,1)'}); setTimeout(()=>e.remove(),dur); } }
