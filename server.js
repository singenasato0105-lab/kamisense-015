/* ===== 神センス！スタートタイミング「0.15」チャレンジ  リアルタイムリレー =====
   依存パッケージゼロ（Node標準のみ）。会場LANのホストPC1台で起動、または Render 等の公開ホストに載せる。
   （OCT謝恩会ゲームの server.js を踏襲）

   仕組み：
     GET  /events  … SSE。接続中の全端末へ配信。接続直後に最新stateを送って遅参も即同期。
     POST /send    … 端末からのメッセージ受信→中継。admin発は全端末へ、参加者(挑戦者/投票者)発はadminへ。
     静的配信      … / (役割選択) /admin /screen(投影) /player(挑戦者) /vote(投票者)
   起動： node server.js  （PORT=9000 node server.js でポート変更）
*/
const http=require('http'), fs=require('fs'), path=require('path');
const PORT=process.env.PORT||8080, ROOT=__dirname;
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.mp3':'audio/mpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.wav':'audio/wav'};
function lanIp(){const n=require('os').networkInterfaces();for(const k in n)for(const x of n[k])if(x.family==='IPv4'&&!x.internal)return x.address;return 'localhost';}
function baseUrl(req){
  if(process.env.PUBLIC_URL)return process.env.PUBLIC_URL.replace(/\/?$/,'/');
  const p=req.headers['x-forwarded-proto'], h=req.headers['x-forwarded-host']||req.headers.host;
  if(p&&h)return p.split(',')[0].trim()+'://'+h.split(',')[0].trim()+'/';
  let host=req.headers.host||'';
  if(!host||/^(localhost|127\.|\[?::1)/i.test(host))host=lanIp()+':'+PORT;
  return 'http://'+host+'/';
}
let clients=[], lastState=null, stateVer=0, seqN=0, inbox=[];
const N=6;
// 進行状態のクラッシュ復旧：ディスクに保存し、起動時に復元
const SAVE=path.join(ROOT,'kami-state.json');
try{ const raw=fs.readFileSync(SAVE,'utf8'); if(raw&&raw.trim()){ lastState=JSON.parse(raw); stateVer=1; console.log('前回の進行状態を復元しました'); } }catch(e){}
// 永続化はデバウンス：投票1票ごとにディスクへ書くと高負荷時に詰まるため最大1秒に1回へ束ねる。
// 運営操作（フェーズ/リセット等）は即時保存、プロセス終了時も必ず書き切る（下部のSIGTERM/SIGINT）。
let persistT=null, persistDirty=false;
function flushPersist(){ if(!persistDirty)return; persistDirty=false; try{ fs.writeFileSync(SAVE, lastState?JSON.stringify(lastState):''); }catch(e){} }
function persist(immediate){ persistDirty=true;
  if(immediate){ if(persistT){clearTimeout(persistT);persistT=null;} flushPersist(); return; }
  if(persistT)return; persistT=setTimeout(()=>{ persistT=null; flushPersist(); }, 1000); }
// /state 応答の直列化キャッシュ：状態は版(stateVer)が変わった時だけ1回 stringify し、
// 毎リクエストは now/seq の短い前置きだけ連結して返す（毎回の全状態stringifyを排除＝ポーリング嵐でもCPUを食わない）。
let _stateBody=null, _stateBodyVer=-1;
function stateBody(){ if(_stateBodyVer!==stateVer){ _stateBody=JSON.stringify(lastState); _stateBodyVer=stateVer; } return _stateBody; }
function defaultState(v){ return {type:'state',src:'admin',s:{phase:'lobby',round:1,gameId:Date.now(),venue:v||'naruto',names:new Array(N).fill(null),joined:new Array(N).fill(false),votes:new Array(N).fill(0),results:new Array(N).fill(null),goSeq:0}}; }
if(!lastState||!lastState.s){ lastState=defaultState(); stateVer=Math.max(stateVer,1); }
// 参加者メッセージをサーバー側で集計（運営が閉じていても取りこぼさない）
function applyParticipant(m){ const s=lastState.s; const b=m.boat;
  if(typeof b!=='number'||b<0||b>=N) return false;
  if(m.type==='join'){ if(s.phase!=='lobby'&&s.phase!=='vote') return false; s.joined[b]=true; s.names[b]=m.name||s.names[b]||('挑戦者'+String.fromCharCode(65+b)); return true; }
  if(m.type==='vote'){ if(s.phase!=='vote') return false; s.votes[b]=(s.votes[b]||0)+1; return true; }
  if(m.type==='result'){ if(s.results[b]==null){ s.results[b]=m.st; return true; } }   // 記録だけ。結果へは運営が手動で進める（自動遷移なし）
  return false; }
// 運営の操作コマンドを適用（フェーズ/会場/スタート/次ラウンド/リセット）
function applyCmd(m){ const s=lastState.s, a=m.action;
  if(a==='venue'){ s.venue=m.value; }
  else if(a==='phase'){ s.phase=m.value; }
  else if(a==='go'){ s.phase='countdown'; s.results=new Array(N).fill(null); s.goSeq=(s.goSeq||0)+1; s.goAt=Date.now()+(+m.delay||20500); }   // 発走ファンファーレ(実測18.83秒)を最後まで流し切ってから大時計(よーいドン)。投影の再生開始遅延(0.3〜0.6秒)＋余韻を見込んで20.5秒。ファンファーレ差替時はこの値を尺+約1.6秒に合わせる
  else if(a==='next'){ s.round=(s.round||1)+1; s.votes=new Array(N).fill(0); s.results=new Array(N).fill(null); s.phase='vote'; }
  else if(a==='reset'){ lastState.s=defaultState(s.venue).s; }
  return true; }
function serveFile(res,file,req){
  fs.readFile(path.join(ROOT,file),(err,buf)=>{
    if(err){res.writeHead(404);res.end('not found');return;}
    const ext=path.extname(file); let out=buf;
    if(ext==='.html'){ const url=baseUrl(req);
      out=buf.toString().replace('<script src="shared.js"></script>','<script>window.APP_SSE=true;window.APP_URL='+JSON.stringify(url)+';</script>\n<script src="shared.js"></script>'); }
    // HTMLはAPP_URL注入があるため毎回最新(no-store)。JS/CSSは5分、音源は1日キャッシュ＝QR一斉スキャン時の再ダウンロード負荷とバーストを抑える。
    const cache = ext==='.html' ? 'no-store'
      : (ext==='.mp3'||ext==='.ogg'||ext==='.m4a'||ext==='.wav') ? 'public, max-age=86400'
      : 'public, max-age=300';
    res.writeHead(200,{'Content-Type':MIME[ext]||'text/plain','Cache-Control':cache,'Access-Control-Allow-Origin':'*'});
    res.end(out);
  });
}
function broadcast(obj){
  const data='data: '+JSON.stringify(obj)+'\n\n';
  const adminOnly=(obj.src!=='admin');   // 参加者発はadminのみ・admin発(state等)は全端末
  clients.forEach(c=>{ if(adminOnly&&!c.admin)return; try{c.res.write(data);}catch(e){} });
}
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/events'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});
    if(res.flushHeaders)res.flushHeaders(); res.write(':'+Array(2049).join(' ')+'\n\n'); res.write('retry: 2000\n\n');
    const c={res,admin:u.searchParams.get('role')==='admin'}; clients.push(c);
    if(lastState)res.write('data: '+JSON.stringify(lastState)+'\n\n');
    req.on('close',()=>{clients=clients.filter(x=>x!==c);}); return;
  }
  if(req.method==='POST'&&u.pathname==='/send'){
    let b=''; req.on('data',d=>{b+=d;if(b.length>1e6)req.destroy();});
    req.on('end',()=>{ let m; try{m=JSON.parse(b);}catch(e){res.writeHead(400);res.end();return;}
      if(m.type==='state'&&m.src==='admin'){ lastState=m; if(!lastState.s)lastState.s=defaultState().s; stateVer++; persist(true); broadcast(lastState); }
      else if(m.type==='cmd'&&m.src==='admin'){ applyCmd(m); stateVer++; persist(true); broadcast(lastState); }
      else { seqN++; m._seq=seqN; inbox.push(m); if(inbox.length>400)inbox=inbox.slice(-250);
        const changed=applyParticipant(m);   // サーバーで集計
        if(changed){ stateVer++; persist(); broadcast(lastState); } else { broadcast(m); } }   // 投票はデバウンス保存（1秒に1回）
      res.writeHead(204,{'Access-Control-Allow-Origin':'*'}); res.end(); });
    return;
  }
  // 時刻同期専用（超軽量・低ジッタ）：クライアントのNTP風オフセット計算に使う
  if(req.method==='GET'&&u.pathname==='/time'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({now:Date.now()})); return;
  }
  // 短ポーリング（プロキシ/トンネルでも確実に届く）
  if(req.method==='GET'&&u.pathname==='/state'){
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    res.end('{"v":'+stateVer+',"seq":'+seqN+',"now":'+Date.now()+',"state":'+stateBody()+'}'); return;   // 状態は版キャッシュ・前置きだけ都度連結
  }
  if(req.method==='GET'&&u.pathname==='/inbox'){
    const since=+(u.searchParams.get('since')||0);
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({seq:seqN, now:Date.now(), msgs:inbox.filter(x=>x._seq>since)})); return;
  }
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});res.end();return;}
  let p=u.pathname;
  if(p==='/')p='/index.html';
  if(p==='/admin')p='/admin.html';
  if(p==='/screen')p='/projector.html';
  if(p==='/player')p='/player.html';
  if(p==='/vote')p='/voter.html';
  if(p==='/guide')p='/当日運営手順書.html';
  if(p==='/wall')p='/wall.html';
  if(p==='/healthz'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('ok v2-load clients='+clients.length);return;}
  const allow=['/index.html','/admin.html','/projector.html','/player.html','/voter.html','/当日運営手順書.html','/wall.html','/shared.js','/app.css','/qrcode.min.js','/bgm.js'];
  if(allow.includes(p)){serveFile(res,p.slice(1),req);return;}
  if(/^\/bgm\/[a-z]+\/[a-z0-9_]+\.(mp3|ogg|m4a|wav)$/i.test(p)){ serveFile(res,p.slice(1),req); return; }  // BGM音源
  res.writeHead(404); res.end('not found');
});
server.listen(PORT,()=>{
  const ip=lanIp();
  console.log('神センス0.15 リアルタイムサーバ 起動  PORT='+PORT);
  console.log('  役割選択 : http://localhost:'+PORT+'/');
  console.log('  投影     : http://localhost:'+PORT+'/screen');
  console.log('  運営     : http://localhost:'+PORT+'/admin');
  console.log('  挑戦者   : http://localhost:'+PORT+'/player');
  console.log('  投票者   : http://localhost:'+PORT+'/vote');
  console.log('  会場LAN  : http://'+ip+':'+PORT+'/');
});
setInterval(()=>{const p='data: '+JSON.stringify({type:'ping',src:'admin'})+'\n\n';clients.forEach(c=>{try{c.res.write(p);}catch(e){}});},3000);
// 終了シグナルでデバウンス保留中の投票を書き切ってから落ちる（進行状態を取りこぼさない）
['SIGTERM','SIGINT'].forEach(sig=>process.on(sig,()=>{ try{ flushPersist(); }catch(e){} process.exit(0); }));
