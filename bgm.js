/* ===== 会場BGM コントローラ（mp3のみ・合成音は使わない） =====
   進行に合わせて投影(projector)が BGM.play('<cue>') を呼ぶ。
     cue: parade（会場別・場内BGM/ループ）, close（締切）, fanfare（全国共通）, race（走行音）, result（結果発表）
   ・mp3 があればそれを鳴らす：parade→bgm/<venue>/parade.mp3、共通→bgm/common/<cue>.mp3
   ・mp3 が無い cue（race/result/close）は会場parade(本物mp3)で代替＝無音区間を作らない。合成音は完全撤去（信弦さん指示）
   ・fanfareは鳴り終わったら自動でparadeに戻す（発走→大時計→演出まで音を途切れさせない）
   ・自動再生制限のため、最初に画面を1回クリックで音声解禁。 */
(function(){
  const VENUES=['naruto','kojima','marugame'];
  function srcFor(cue){ return cue==='parade' ? ('bgm/'+curVenue+'/parade.mp3') : ('bgm/common/'+cue+'.mp3'); }

  let unlocked=false, muted=false, curVenue='naruto', active=null, curMp3=null;
  const avail={};   // src -> true/false（mp3の有無キャッシュ）
  const A={};       // src -> Audio要素（生成は1回だけ・プリロードしてキャッシュ＝切替を瞬時に）

  // ================= mp3 レイヤ =================
  function getAudio(src){ if(A[src]) return A[src]; const a=new Audio(); a.preload='auto'; a.src=src; try{ a.load(); }catch(e){} A[src]=a; return a; }
  function probe(cue){ const src=srcFor(cue); if(avail[src]===true) return Promise.resolve(true);
    return fetch(src,{cache:'no-store'}).then(r=>{ avail[src]=r.ok; if(r.ok) getAudio(src); return r.ok; }).catch(()=>{ avail[src]=false; return false; }); }
  function playMp3(cue,opts){ stopCurrent(); const src=srcFor(cue), a=getAudio(src); curMp3=a;
    a.onended = (!opts.loop && cue==='fanfare') ? function(){ if(active==='fanfare') play('parade',{loop:true}); } : null;   // ファンファーレが鳴り終わったら会場BGM(parade)を再開＝無音を作らない
    try{ a.loop=!!opts.loop; a.muted=muted; try{ a.currentTime=0; }catch(e){} const p=a.play(); if(p&&p.catch) p.catch(()=>{}); }
    catch(e){} }
  function fallbackParade(){ const psrc=srcFor('parade'); if(avail[psrc]!==true) return;   // paradeも無ければ無音（合成音は使わない）
    if(curMp3 && curMp3.src.indexOf('/parade.mp3')>=0 && !curMp3.paused){ return; }        // 既にparade再生中なら切らずに継続
    stopCurrent(); const a=getAudio(psrc); curMp3=a; try{ a.loop=true; a.muted=muted; const p=a.play(); if(p&&p.catch)p.catch(()=>{}); }catch(e){} }
  function stopCurrent(){ if(curMp3){ try{ curMp3.pause(); }catch(e){} curMp3=null; } stopLoop(); }

  // ================= 内蔵シンセ レイヤ =================
  let AC=null, synGain=null;
  function ac(){ try{ if(!AC) AC=new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==='suspended') AC.resume(); }catch(e){} return AC; }
  function master(){ const c=ac(); if(!c) return null; if(!synGain){ synGain=c.createGain(); synGain.gain.value=muted?0:1; synGain.connect(c.destination); } return synGain; }
  const mf=m=>440*Math.pow(2,(m-69)/12);
  function tone(freq,t0,dur,type,vol,glideTo){ const c=ac(); if(!c)return; const o=c.createOscillator(), g=c.createGain();
    o.type=type||'sine'; o.frequency.setValueAtTime(freq,t0); if(glideTo)try{o.frequency.exponentialRampToValueAtTime(glideTo,t0+dur);}catch(e){}
    const a=Math.min(0.03,dur*0.3), r=Math.min(0.14,dur*0.5);
    g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(vol,t0+a); g.gain.setValueAtTime(vol,Math.max(t0+a,t0+dur-r)); g.gain.linearRampToValueAtTime(0,t0+dur);
    o.connect(g); g.connect(master()); o.start(t0); o.stop(t0+dur+0.03); }
  function hat(t0,vol){ const c=ac(); if(!c)return; const n=c.createBufferSource(), b=c.createBuffer(1,1024,c.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<1024;i++)d[i]=Math.random()*2-1; n.buffer=b; const f=c.createBiquadFilter(); f.type='highpass'; f.frequency.value=7000;
    const g=c.createGain(); g.gain.setValueAtTime(vol,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.05); n.connect(f); f.connect(g); g.connect(master()); n.start(t0); n.stop(t0+0.06); }
  function kick(t0,vol){ const c=ac(); if(!c)return; const o=c.createOscillator(), g=c.createGain(); o.type='sine';
    o.frequency.setValueAtTime(140,t0); try{o.frequency.exponentialRampToValueAtTime(45,t0+0.12);}catch(e){}
    g.gain.setValueAtTime(vol,t0); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.18); o.connect(g); g.connect(master()); o.start(t0); o.stop(t0+0.2); }

  // 会場ごとに調・テンポ・音色を変える（1部/2部/3部で雰囲気が変わる）
  const VMUS={ naruto:{root:57,tempo:122,wave:'triangle',vol:0.16}, kojima:{root:60,tempo:112,wave:'sawtooth',vol:0.14}, marugame:{root:62,tempo:132,wave:'square',vol:0.13} };
  const PROG=[[0,4,7],[7,11,14],[9,12,16],[5,9,12]];   // I - V - vi - IV
  let loopTimer=null, loopKind=null, loopBeat=0, loopStart=0;
  function scheduleLoop(){ const c=ac(); if(!c||!loopKind)return;
    const cfg = loopKind==='race' ? {root:(VMUS[curVenue]||VMUS.naruto).root-5,tempo:152,wave:'sawtooth',vol:0.12} : (VMUS[curVenue]||VMUS.naruto);
    const beat=60/cfg.tempo, ahead=0.25;
    while(loopStart + loopBeat*beat < c.currentTime + ahead){
      const t=loopStart+loopBeat*beat, bar=Math.floor(loopBeat/4)%PROG.length, inBar=loopBeat%4, chord=PROG[bar], R=cfg.root;
      if(loopKind==='race'){
        tone(mf(R-12), t, beat*0.9, 'sawtooth', cfg.vol*0.85); kick(t,0.5); hat(t+beat/2,0.06);
      } else {
        if(inBar===0||inBar===2) tone(mf(R-12+chord[0]), t, beat*0.9, 'triangle', cfg.vol*0.9);           // bass
        if(inBar===0) chord.forEach(iv=> tone(mf(R+iv), t, beat*4*0.98, 'sine', cfg.vol*0.34));           // pad（1小節）
        tone(mf(R+12+chord[(loopBeat*2)%chord.length]),   t,        beat*0.45, cfg.wave, cfg.vol*0.5);    // arp 8分
        tone(mf(R+12+chord[(loopBeat*2+1)%chord.length]), t+beat/2, beat*0.45, cfg.wave, cfg.vol*0.5);
        kick(t,0.26); hat(t+beat/2,0.05);
      }
      loopBeat++;
    }
  }
  function startLoop(kind){ stopLoop(); const c=ac(); if(!c)return; loopKind=kind; loopBeat=0; loopStart=c.currentTime+0.08; scheduleLoop(); loopTimer=setInterval(scheduleLoop,60); }
  function stopLoop(){ if(loopTimer){ clearInterval(loopTimer); loopTimer=null; } loopKind=null; }

  function fanfare(){ const c=ac(); if(!c)return; const R=(VMUS[curVenue]||VMUS.naruto).root+12; let t=c.currentTime+0.05;
    [[0,0.18],[4,0.18],[7,0.18],[12,0.42]].forEach(([iv,d])=>{ tone(mf(R+iv),t,d,'sawtooth',0.22); tone(mf(R+iv-12),t,d,'square',0.12); t+=d*0.92; });
    [0,4,7,12].forEach(iv=> tone(mf(R+iv),t,1.2,'sawtooth',0.18)); [0,4,7].forEach(iv=> tone(mf(R+iv-12),t,1.2,'triangle',0.1)); }
  function closeSting(){ const c=ac(); if(!c)return; const R=(VMUS[curVenue]||VMUS.naruto).root+12, t=c.currentTime+0.03;
    tone(mf(R+7),t,0.16,'square',0.2); tone(mf(R+2),t+0.16,0.16,'square',0.2); tone(mf(R-1),t+0.32,0.34,'square',0.18); }
  function resultSting(){ const c=ac(); if(!c)return; const R=(VMUS[curVenue]||VMUS.naruto).root+12, t=c.currentTime+0.03;
    [0,2,4,5,7,9,11,12].forEach((iv,i)=> tone(mf(R+iv),t+i*0.07,0.12,'triangle',0.16));
    const tc=t+8*0.07; [0,4,7,12].forEach(iv=> tone(mf(R+iv),tc,1.3,'sawtooth',0.18)); [0,4,7].forEach(iv=>tone(mf(R+iv-12),tc,1.3,'triangle',0.1)); }
  function playSynth(cue,opts){ /* 合成音は完全撤去：mp3が無いcueは無音（信弦さん指示） */ }

  // ================= 公開API =================
  function play(cue,opts){ opts=opts||{}; unlocked=true;
    const src=srcFor(cue);
    // 同じcueが既にループ再生中なら鳴らし直さない（currentTime=0での再スタート＝プチ途切れを防ぐ。parade再遷移やrace二重呼び対策）
    if(cue===active && curMp3 && !curMp3.paused && curMp3.src.indexOf(src)>=0){ if(opts.loop) curMp3.loop=true; return; }
    active=cue;
    if(avail[src]===true){ playMp3(cue,opts); return; }
    if(src in avail){ fallbackParade(); return; }                                            // mp3無し確定→会場paradeで代替（無音回避・合成音は使わない）
    probe(cue).then(ok=>{ if(active!==cue) return; if(ok) playMp3(cue,opts); else fallbackParade(); });  // 未確認→確認後に本cue or 代替
  }
  function stop(){ stopCurrent(); active=null; }
  function setMute(m){ muted=!!m; if(curMp3){ try{ curMp3.muted=muted; }catch(e){} } if(synGain){ try{ synGain.gain.setTargetAtTime(muted?0:1, ac().currentTime, 0.02); }catch(e){} } }
  function setVenue(v){ if(!VENUES.includes(v)||v===curVenue) return; curVenue=v; probe('parade');
    if(active==='parade') play('parade',{loop:true}); else if(active==='race') play('race',{loop:true}); }
  function unlock(){ unlocked=true; ac(); master(); ['fanfare','result','close','race','parade'].forEach(probe); }

  // 起動時に全音源の有無を先読み＋Audioを生成してプリロード（切替を瞬時に・ファンファーレ等も確実に鳴る）
  ['fanfare','result','close','race'].forEach(c=>probe(c));
  VENUES.forEach(v=>{ const p='bgm/'+v+'/parade.mp3'; fetch(p,{cache:'no-store'}).then(r=>{ avail[p]=r.ok; if(r.ok) getAudio(p); }).catch(()=>{avail[p]=false;}); });

  window.BGM={ play, stop, setMute, setVenue, unlock, get venue(){return curVenue;}, get ready(){return true;},
    _debug(){ return {venue:curVenue, active, muted, unlocked, avail:Object.assign({},avail), cached:Object.keys(A), playing: curMp3?{src:curMp3.src.split('/').slice(-2).join('/'), paused:curMp3.paused, t:Math.round((curMp3.currentTime||0)*10)/10, loop:curMp3.loop}:null }; } };
})();
