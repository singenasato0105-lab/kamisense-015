/* チェスコーチAI エンジン（依存ゼロ）
 * 0x88盤・合法手生成・SAN・評価関数・反復深化αβ探索(置換表/静止探索/ヌルムーブ/LMR)
 * ブラウザのメインスレッド・Web Worker・Node(テスト)のどれでも動く。 */
"use strict";
const P=1,N=2,B=3,R=4,Q=5,K=6;
const F_CAP=1,F_EP=2,F_CASTLE=4,F_DOUBLE=8;
const VAL=[0,100,320,330,500,900,0];
const PHASE_W=[0,0,1,1,2,4,0];
const N_OFF=[33,31,18,14,-33,-31,-18,-14], K_OFF=[1,-1,16,-16,17,15,-17,-15];
const B_OFF=[17,15,-17,-15], R_OFF=[1,-1,16,-16];
const CR=new Int8Array(128).fill(15); CR[4]=12; CR[0]=13; CR[7]=14; CR[116]=3; CR[112]=7; CR[119]=11;
const START_FEN='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
function enc(f,t,pr,fl){return f|(t<<7)|(pr<<14)|(fl<<17);}
function mFrom(m){return m&127;} function mTo(m){return (m>>7)&127;}
function mPromo(m){return (m>>14)&7;} function mFlag(m){return (m>>17)&15;}
function sqName(s){return 'abcdefgh'[s&7]+((s>>4)+1);}
function sqParse(n){return (n.charCodeAt(1)-49)*16+(n.charCodeAt(0)-97);}

// ---- Zobrist ----
let _seed=0x2545F491|0;
function _rnd(){_seed^=_seed<<13;_seed^=_seed>>>17;_seed^=_seed<<5;return _seed|0;}
const Z1=[],Z2=[];
for(let p=0;p<16;p++){Z1.push(new Int32Array(128));Z2.push(new Int32Array(128));for(let s=0;s<128;s++){Z1[p][s]=_rnd();Z2[p][s]=_rnd();}}
const ZC1=new Int32Array(16),ZC2=new Int32Array(16),ZE1=new Int32Array(8),ZE2=new Int32Array(8);
for(let i=0;i<16;i++){ZC1[i]=_rnd();ZC2[i]=_rnd();} for(let i=0;i<8;i++){ZE1[i]=_rnd();ZE2[i]=_rnd();}
const ZS1=_rnd(),ZS2=_rnd();

// ---- 局面 ----
class Pos{
  constructor(fen){this.b=new Int8Array(128);this.ks=[4,116];this.undo=[];this.hist1=[];this.hist2=[];this.setFen(fen||START_FEN);}
  setFen(fen){
    const [bd,side,cas,ep,half,full]=fen.trim().split(/\s+/);
    this.b.fill(0); let r=7,f=0;
    for(const ch of bd){
      if(ch==='/'){r--;f=0;}
      else if(ch>='1'&&ch<='8'){f+=+ch;}
      else{const lo=ch.toLowerCase(),c=ch===lo?1:0,t='pnbrqk'.indexOf(lo)+1,sq=r*16+f;this.b[sq]=t|(c<<3);if(t===K)this.ks[c]=sq;f++;}
    }
    this.side=side==='b'?1:0; this.castle=0;
    if(cas&&cas!=='-'){if(cas.includes('K'))this.castle|=1;if(cas.includes('Q'))this.castle|=2;if(cas.includes('k'))this.castle|=4;if(cas.includes('q'))this.castle|=8;}
    this.ep=(ep&&ep!=='-')?sqParse(ep):-1; this.half=+half||0; this.full=+full||1;
    this.undo=[];this.hist1=[];this.hist2=[]; this.computeHash();
  }
  computeHash(){
    let h1=0,h2=0; for(let s=0;s<128;s++){if(s&0x88){s+=7;continue;}const p=this.b[s];if(p){h1^=Z1[p][s];h2^=Z2[p][s];}}
    h1^=ZC1[this.castle];h2^=ZC2[this.castle]; if(this.ep>=0){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    if(this.side){h1^=ZS1;h2^=ZS2;} this.h1=h1;this.h2=h2;
  }
  fen(){
    let s=''; for(let r=7;r>=0;r--){let e=0;for(let f=0;f<8;f++){const p=this.b[r*16+f];if(!p){e++;continue;}if(e){s+=e;e=0;}const ch='pnbrqk'[(p&7)-1];s+=(p>>3)?ch:ch.toUpperCase();}if(e)s+=e;if(r)s+='/';}
    let c=''; if(this.castle&1)c+='K';if(this.castle&2)c+='Q';if(this.castle&4)c+='k';if(this.castle&8)c+='q';
    return s+' '+(this.side?'b':'w')+' '+(c||'-')+' '+(this.ep>=0?sqName(this.ep):'-')+' '+this.half+' '+this.full;
  }
  clone(){const p=Object.create(Pos.prototype);p.b=new Int8Array(this.b);p.side=this.side;p.castle=this.castle;p.ep=this.ep;p.half=this.half;p.full=this.full;p.ks=this.ks.slice();p.h1=this.h1;p.h2=this.h2;p.hist1=this.hist1.slice();p.hist2=this.hist2.slice();p.undo=[];return p;}
  attacked(sq,by){
    const b=this.b; let s;
    if(by===0){s=sq-15;if(!(s&0x88)&&b[s]===P)return true;s=sq-17;if(!(s&0x88)&&b[s]===P)return true;}
    else{s=sq+15;if(!(s&0x88)&&b[s]===(P|8))return true;s=sq+17;if(!(s&0x88)&&b[s]===(P|8))return true;}
    const c=by<<3, kn=N|c, kg=K|c, bi=B|c, ro=R|c, qu=Q|c;
    for(let i=0;i<8;i++){s=sq+N_OFF[i];if(!(s&0x88)&&b[s]===kn)return true;s=sq+K_OFF[i];if(!(s&0x88)&&b[s]===kg)return true;}
    for(let i=0;i<4;i++){const d=B_OFF[i];s=sq+d;while(!(s&0x88)){const q=b[s];if(q){if(q===bi||q===qu)return true;break;}s+=d;}}
    for(let i=0;i<4;i++){const d=R_OFF[i];s=sq+d;while(!(s&0x88)){const q=b[s];if(q){if(q===ro||q===qu)return true;break;}s+=d;}}
    return false;
  }
  inCheck(){return this.attacked(this.ks[this.side],this.side^1);}
  // fromの駒がtoのマスを利かせているか（解説用）
  pieceAttacks(from,to){
    const p=this.b[from]; if(!p)return false; const t=p&7,c=p>>3,d=to-from;
    if(t===P)return c===0?(d===15||d===17):(d===-15||d===-17);
    if(t===N)return N_OFF.includes(d); if(t===K)return K_OFF.includes(d);
    const dirs=t===B?B_OFF:t===R?R_OFF:K_OFF;
    for(const dd of dirs){let s=from+dd;while(!(s&0x88)){if(s===to)return true;if(this.b[s])break;s+=dd;}}
    return false;
  }
  attackers(sq,by){const out=[];for(let s=0;s<128;s++){if(s&0x88){s+=7;continue;}const p=this.b[s];if(p&&(p>>3)===by&&s!==sq&&this.pieceAttacks(s,sq))out.push(s);}return out;}
  gen(capsOnly){
    const b=this.b,us=this.side,them=us^1,mv=[];
    for(let sq=0;sq<128;sq++){
      if(sq&0x88){sq+=7;continue;}
      const p=b[sq]; if(!p||(p>>3)!==us)continue; const t=p&7;
      if(t===P){
        const dir=us?-16:16,start=us?6:1,prom=us?0:7,to=sq+dir;
        if(!(to&0x88)&&!b[to]){
          if((to>>4)===prom){mv.push(enc(sq,to,Q,0));if(!capsOnly){mv.push(enc(sq,to,N,0),enc(sq,to,R,0),enc(sq,to,B,0));}}
          else if(!capsOnly){mv.push(enc(sq,to,0,0));const to2=to+dir;if((sq>>4)===start&&!b[to2])mv.push(enc(sq,to2,0,F_DOUBLE));}
        }
        for(let k=0;k<2;k++){const c=sq+dir+(k?1:-1);if(c&0x88)continue;const q=b[c];
          if(q&&(q>>3)===them){if((c>>4)===prom){mv.push(enc(sq,c,Q,F_CAP),enc(sq,c,N,F_CAP),enc(sq,c,R,F_CAP),enc(sq,c,B,F_CAP));}else mv.push(enc(sq,c,0,F_CAP));}
          else if(c===this.ep)mv.push(enc(sq,c,0,F_CAP|F_EP));}
      }else if(t===N||t===K){
        const offs=t===N?N_OFF:K_OFF;
        for(let i=0;i<8;i++){const to=sq+offs[i];if(to&0x88)continue;const q=b[to];if(!q){if(!capsOnly)mv.push(enc(sq,to,0,0));}else if((q>>3)===them)mv.push(enc(sq,to,0,F_CAP));}
        if(t===K&&!capsOnly){
          if(us===0&&sq===4){
            if((this.castle&1)&&!b[5]&&!b[6]&&b[7]===R&&!this.attacked(4,1)&&!this.attacked(5,1)&&!this.attacked(6,1))mv.push(enc(4,6,0,F_CASTLE));
            if((this.castle&2)&&!b[3]&&!b[2]&&!b[1]&&b[0]===R&&!this.attacked(4,1)&&!this.attacked(3,1)&&!this.attacked(2,1))mv.push(enc(4,2,0,F_CASTLE));
          }else if(us===1&&sq===116){
            if((this.castle&4)&&!b[117]&&!b[118]&&b[119]===(R|8)&&!this.attacked(116,0)&&!this.attacked(117,0)&&!this.attacked(118,0))mv.push(enc(116,118,0,F_CASTLE));
            if((this.castle&8)&&!b[115]&&!b[114]&&!b[113]&&b[112]===(R|8)&&!this.attacked(116,0)&&!this.attacked(115,0)&&!this.attacked(114,0))mv.push(enc(116,114,0,F_CASTLE));
          }
        }
      }else{
        const dirs=t===B?B_OFF:t===R?R_OFF:K_OFF;
        for(let i=0;i<dirs.length;i++){const d=dirs[i];let to=sq+d;
          while(!(to&0x88)){const q=b[to];if(!q){if(!capsOnly)mv.push(enc(sq,to,0,0));}else{if((q>>3)===them)mv.push(enc(sq,to,0,F_CAP));break;}to+=d;}}
      }
    }
    return mv;
  }
  make(m){
    const b=this.b,from=m&127,to=(m>>7)&127,pr=(m>>14)&7,fl=(m>>17)&15,us=this.side,p=b[from];
    let capSq=to; if(fl&F_EP)capSq=us?to+16:to-16; const cap=b[capSq];
    this.undo.push([m,cap,this.castle,this.ep,this.half,this.h1,this.h2,this.full]);
    this.hist1.push(this.h1);this.hist2.push(this.h2);
    let h1=this.h1^Z1[p][from],h2=this.h2^Z2[p][from];
    if(cap){h1^=Z1[cap][capSq];h2^=Z2[cap][capSq];b[capSq]=0;}
    b[from]=0; const np=pr?(pr|(us<<3)):p; b[to]=np; h1^=Z1[np][to];h2^=Z2[np][to];
    if(fl&F_CASTLE){let rf,rt;if(to===6){rf=7;rt=5;}else if(to===2){rf=0;rt=3;}else if(to===118){rf=119;rt=117;}else{rf=112;rt=115;}
      const rk=b[rf];b[rf]=0;b[rt]=rk;h1^=Z1[rk][rf]^Z1[rk][rt];h2^=Z2[rk][rf]^Z2[rk][rt];}
    if((p&7)===K)this.ks[us]=to;
    h1^=ZC1[this.castle];h2^=ZC2[this.castle]; this.castle&=CR[from]&CR[to]; h1^=ZC1[this.castle];h2^=ZC2[this.castle];
    if(this.ep>=0){h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    this.ep=-1; if(fl&F_DOUBLE){this.ep=(from+to)>>1;h1^=ZE1[this.ep&7];h2^=ZE2[this.ep&7];}
    this.half=((p&7)===P||cap)?0:this.half+1; if(us)this.full++;
    this.side=us^1; h1^=ZS1;h2^=ZS2; this.h1=h1;this.h2=h2;
    if(this.attacked(this.ks[us],us^1)){this.unmake();return false;}
    return true;
  }
  unmake(){
    const u=this.undo.pop(),m=u[0],cap=u[1],b=this.b,from=m&127,to=(m>>7)&127,pr=(m>>14)&7,fl=(m>>17)&15;
    this.side^=1; const us=this.side; let p=b[to]; if(pr)p=P|(us<<3);
    b[from]=p; b[to]=0; if(fl&F_EP)b[us?to+16:to-16]=cap; else b[to]=cap;
    if(fl&F_CASTLE){let rf,rt;if(to===6){rf=7;rt=5;}else if(to===2){rf=0;rt=3;}else if(to===118){rf=119;rt=117;}else{rf=112;rt=115;}b[rf]=b[rt];b[rt]=0;}
    if((p&7)===K)this.ks[us]=from;
    this.castle=u[2];this.ep=u[3];this.half=u[4];this.h1=u[5];this.h2=u[6];this.full=u[7];
    this.hist1.pop();this.hist2.pop();
  }
  makeNull(){
    this.undo.push([0,0,this.castle,this.ep,this.half,this.h1,this.h2,this.full]);this.hist1.push(this.h1);this.hist2.push(this.h2);
    if(this.ep>=0){this.h1^=ZE1[this.ep&7];this.h2^=ZE2[this.ep&7];}
    this.ep=-1;this.half=0;this.side^=1;this.h1^=ZS1;this.h2^=ZS2;
  }
  unmakeNull(){const u=this.undo.pop();this.side^=1;this.castle=u[2];this.ep=u[3];this.half=u[4];this.h1=u[5];this.h2=u[6];this.full=u[7];this.hist1.pop();this.hist2.pop();}
  legalMoves(){const out=[];for(const m of this.gen(false)){if(this.make(m)){this.unmake();out.push(m);}}return out;}
  isRep(){const h=this.hist1,g=this.hist2,n=h.length,lim=Math.max(0,n-this.half);for(let i=n-2;i>=lim;i-=2)if(h[i]===this.h1&&g[i]===this.h2)return true;return false;}
  repCount(){let c=0;const h=this.hist1,g=this.hist2,n=h.length,lim=Math.max(0,n-this.half);for(let i=n-2;i>=lim;i-=2)if(h[i]===this.h1&&g[i]===this.h2)c++;return c;}
  insufficient(){let minors=0;for(let s=0;s<128;s++){if(s&0x88){s+=7;continue;}const t=this.b[s]&7;if(t===P||t===R||t===Q)return false;if(t===N||t===B)minors++;}return minors<=1;}
  hasPieces(c){for(let s=0;s<128;s++){if(s&0x88){s+=7;continue;}const p=this.b[s];if(p&&(p>>3)===c){const t=p&7;if(t!==P&&t!==K)return true;}}return false;}
  evaluate(){return evaluate(this);}
}

// ---- SAN ----
function san(pos,m,legal){
  legal=legal||pos.legalMoves();
  const from=mFrom(m),to=mTo(m),fl=mFlag(m),pr=mPromo(m),p=pos.b[from],t=p&7;
  let s;
  if(fl&F_CASTLE)s=(to&7)===6?'O-O':'O-O-O';
  else if(t===P){s=(fl&F_CAP)?'abcdefgh'[from&7]+'x':'';s+=sqName(to);if(pr)s+='='+' PNBRQK'[pr];}
  else{
    s=' PNBRQK'[t];
    const others=legal.filter(o=>o!==m&&mTo(o)===to&&(pos.b[mFrom(o)]&7)===t);
    if(others.length){
      if(!others.some(o=>(mFrom(o)&7)===(from&7)))s+='abcdefgh'[from&7];
      else if(!others.some(o=>(mFrom(o)>>4)===(from>>4)))s+=((from>>4)+1);
      else s+=sqName(from);
    }
    if(fl&F_CAP)s+='x'; s+=sqName(to);
  }
  if(pos.make(m)){if(pos.inCheck())s+=pos.legalMoves().length?'+':'#';pos.unmake();}
  return s;
}

// ---- 評価関数 ----
const PST_TXT={
 1:'0 0 0 0 0 0 0 0 50 50 50 50 50 50 50 50 10 10 20 30 30 20 10 10 5 5 10 25 25 10 5 5 0 0 0 20 20 0 0 0 5 -5 -10 0 0 -10 -5 5 5 10 10 -20 -20 10 10 5 0 0 0 0 0 0 0 0',
 2:'-50 -40 -30 -30 -30 -30 -40 -50 -40 -20 0 0 0 0 -20 -40 -30 0 10 15 15 10 0 -30 -30 5 15 20 20 15 5 -30 -30 0 15 20 20 15 0 -30 -30 5 10 15 15 10 5 -30 -40 -20 0 5 5 0 -20 -40 -50 -40 -30 -30 -30 -30 -40 -50',
 3:'-20 -10 -10 -10 -10 -10 -10 -20 -10 0 0 0 0 0 0 -10 -10 0 5 10 10 5 0 -10 -10 5 5 10 10 5 5 -10 -10 0 10 10 10 10 0 -10 -10 10 10 10 10 10 10 -10 -10 5 0 0 0 0 5 -10 -20 -10 -10 -10 -10 -10 -10 -20',
 4:'0 0 0 0 0 0 0 0 5 10 10 10 10 10 10 5 -5 0 0 0 0 0 0 -5 -5 0 0 0 0 0 0 -5 -5 0 0 0 0 0 0 -5 -5 0 0 0 0 0 0 -5 -5 0 0 0 0 0 0 -5 0 0 0 5 5 0 0 0',
 5:'-20 -10 -10 -5 -5 -10 -10 -20 -10 0 0 0 0 0 0 -10 -10 0 5 5 5 5 0 -10 -5 0 5 5 5 5 0 -5 0 0 5 5 5 5 0 -5 -10 5 5 5 5 5 0 -10 -10 0 5 0 0 0 0 -10 -20 -10 -10 -5 -5 -10 -10 -20',
 6:'-30 -40 -40 -50 -50 -40 -40 -30 -30 -40 -40 -50 -50 -40 -40 -30 -30 -40 -40 -50 -50 -40 -40 -30 -30 -40 -40 -50 -50 -40 -40 -30 -20 -30 -30 -40 -40 -30 -30 -20 -10 -20 -20 -20 -20 -20 -20 -10 20 20 0 0 0 0 20 20 20 30 10 0 0 10 30 20',
 7:'-50 -40 -30 -20 -20 -30 -40 -50 -30 -20 -10 0 0 -10 -20 -30 -30 -10 20 30 30 20 -10 -30 -30 -10 30 40 40 30 -10 -30 -30 -10 30 40 40 30 -10 -30 -30 -10 20 30 30 20 -10 -30 -30 -30 0 0 0 0 -30 -30 -50 -30 -30 -30 -30 -30 -30 -50'
};
const PMG=[null],PEG=[null];
for(let t=1;t<=6;t++){const a=PST_TXT[t].split(' ').map(Number);PMG.push(a);PEG.push(t===6?PST_TXT[7].split(' ').map(Number):a);}
PEG[1]=PMG[1].map((v,i)=>{const row=i>>3;return [0,90,55,32,16,6,0,0][row];});
const PASS_MG=[0,5,8,14,24,40,60,0],PASS_EG=[0,10,16,28,48,80,120,0];
function evaluate(pos){
  const b=pos.b; let mg0=0,mg1=0,eg0=0,eg1=0,ph=0,bi0=0,bi1=0;
  const pf0=new Int8Array(8),pf1=new Int8Array(8),pawns=[];
  for(let sq=0;sq<128;sq++){
    if(sq&0x88){sq+=7;continue;}
    const p=b[sq]; if(!p)continue; const c=p>>3,t=p&7,r=sq>>4,f=sq&7,idx=c?(r*8+f):((7-r)*8+f);
    if(c){mg1+=VAL[t]+PMG[t][idx];eg1+=VAL[t]+PEG[t][idx];}else{mg0+=VAL[t]+PMG[t][idx];eg0+=VAL[t]+PEG[t][idx];}
    ph+=PHASE_W[t];
    if(t===P){(c?pf1:pf0)[f]++;pawns.push(sq|(c<<7));}else if(t===B){if(c)bi1++;else bi0++;}
  }
  for(const x of pawns){
    const sq=x&127,c=x>>7,f=sq&7,r=sq>>4,own=c?pf1:pf0,opp=c?pf0:pf1; let m=0,e=0;
    if(own[f]>1){m-=10;e-=15;}
    if((f===0||!own[f-1])&&(f===7||!own[f+1])){m-=12;e-=10;}
    let passed=true; const op=P|((c^1)<<3);
    for(let ff=Math.max(0,f-1);ff<=Math.min(7,f+1)&&passed;ff++){if(!opp[ff])continue;
      if(c===0){for(let rr=r+1;rr<7;rr++)if(b[rr*16+ff]===op){passed=false;break;}}
      else{for(let rr=r-1;rr>0;rr--)if(b[rr*16+ff]===op){passed=false;break;}}}
    if(passed){const adv=c?7-r:r;m+=PASS_MG[adv];e+=PASS_EG[adv];}
    if(c){mg1+=m;eg1+=e;}else{mg0+=m;eg0+=e;}
  }
  if(bi0>=2){mg0+=30;eg0+=40;} if(bi1>=2){mg1+=30;eg1+=40;}
  if(ph>24)ph=24;
  let eg=eg0-eg1;
  // 終盤の追い詰め(駒得側が相手キングを端へ・自キングを近づける)
  if(ph<=6&&Math.abs(eg)>250){
    const win=eg>0?0:1,lk=pos.ks[win^1],wk=pos.ks[win];
    const cd=Math.max(3-(lk>>4),(lk>>4)-4)+Math.max(3-(lk&7),(lk&7)-4);
    const kd=Math.abs((lk>>4)-(wk>>4))+Math.abs((lk&7)-(wk&7));
    const mop=cd*12+(14-kd)*5; eg+=win===0?mop:-mop;
  }
  const s=(((mg0-mg1)*ph+eg*(24-ph))/24)|0;
  return pos.side?-s:s;
}

// ---- 探索 ----
const MATE=30000,INF=32000,MAXPLY=64,TTBITS=19,TTSIZE=1<<TTBITS,TTMASK=TTSIZE-1;
let TT=null;
function ttInit(){TT={k1:new Int32Array(TTSIZE),k2:new Int32Array(TTSIZE),mv:new Int32Array(TTSIZE),sc:new Int32Array(TTSIZE),dp:new Int8Array(TTSIZE),fl:new Int8Array(TTSIZE)};}
const S={pos:null,nodes:0,deadline:0,stop:false,killers:null,hist:null,pv:null,pvLen:null};
function orderScore(b,m,tt,ply){
  if(m===tt)return 1<<29;
  const fl=(m>>17)&15,pr=(m>>14)&7;
  if(fl&F_CAP){const v=(fl&F_EP)?P:(b[(m>>7)&127]&7);return 100000000+VAL[v]*10-VAL[b[m&127]&7]+(pr?VAL[pr]:0);}
  if(pr)return 90000000+VAL[pr];
  if(m===S.killers[ply*2])return 80000000; if(m===S.killers[ply*2+1])return 70000000;
  return S.hist[b[m&127]*128+((m>>7)&127)];
}
function pickNext(mv,sc,i){let bi=i;for(let j=i+1;j<mv.length;j++)if(sc[j]>sc[bi])bi=j;if(bi!==i){let t=mv[i];mv[i]=mv[bi];mv[bi]=t;t=sc[i];sc[i]=sc[bi];sc[bi]=t;}return mv[i];}
function timeUp(){if((++S.nodes&2047)===0&&Date.now()>S.deadline)S.stop=true;return S.stop;}
function qsearch(alpha,beta,ply){
  if(timeUp())return 0;
  const pos=S.pos; S.pvLen[ply]=ply;
  const stand=evaluate(pos); if(ply>=MAXPLY-1)return stand;
  if(stand>=beta)return stand; if(stand>alpha)alpha=stand;
  const mv=pos.gen(true),sc=new Array(mv.length);
  for(let i=0;i<mv.length;i++)sc[i]=orderScore(pos.b,mv[i],0,ply);
  for(let i=0;i<mv.length;i++){
    const m=pickNext(mv,sc,i);
    if(!pos.make(m))continue;
    const s=-qsearch(-beta,-alpha,ply+1); pos.unmake(); if(S.stop)return 0;
    if(s>alpha){alpha=s;if(s>=beta)return s;}
  }
  return alpha;
}
function negamax(depth,alpha,beta,ply,allowNull){
  if(timeUp())return 0;
  const pos=S.pos; S.pvLen[ply]=ply;
  if(ply>0){if(pos.half>=100||pos.isRep()||pos.insufficient())return 0; if(ply>=MAXPLY-1)return evaluate(pos);}
  const inCheck=pos.inCheck(); if(inCheck)depth++;
  if(depth<=0)return qsearch(alpha,beta,ply);
  const idx=pos.h1&TTMASK; let ttMove=0;
  if(TT.k1[idx]===pos.h1&&TT.k2[idx]===pos.h2){
    ttMove=TT.mv[idx];
    if(ply>0&&TT.dp[idx]>=depth){let s=TT.sc[idx];if(s>MATE-MAXPLY)s-=ply;else if(s<-MATE+MAXPLY)s+=ply;const f=TT.fl[idx];
      if(f===0)return s; if(f===1&&s>=beta)return s; if(f===2&&s<=alpha)return s;}
  }
  if(allowNull&&!inCheck&&ply>0&&depth>=3&&beta<MATE-MAXPLY&&pos.hasPieces(pos.side)&&evaluate(pos)>=beta){
    pos.makeNull(); const s=-negamax(depth-3,-beta,-beta+1,ply+1,false); pos.unmakeNull();
    if(S.stop)return 0; if(s>=beta)return beta;
  }
  const mv=pos.gen(false),sc=new Array(mv.length);
  for(let i=0;i<mv.length;i++)sc[i]=orderScore(pos.b,mv[i],ttMove,ply);
  let legal=0,best=-INF,bestMove=0; const a0=alpha;
  for(let i=0;i<mv.length;i++){
    const m=pickNext(mv,sc,i), quiet=!(((m>>17)&F_CAP)||((m>>14)&7));
    if(!pos.make(m))continue; legal++;
    let s;
    if(legal===1)s=-negamax(depth-1,-beta,-alpha,ply+1,true);
    else{
      let r=0; if(depth>=3&&legal>3&&quiet&&!inCheck&&m!==S.killers[ply*2]&&!pos.inCheck())r=legal>10?2:1;
      s=-negamax(depth-1-r,-alpha-1,-alpha,ply+1,true);
      if(s>alpha&&r>0&&!S.stop)s=-negamax(depth-1,-alpha-1,-alpha,ply+1,true);
      if(s>alpha&&s<beta&&!S.stop)s=-negamax(depth-1,-beta,-alpha,ply+1,true);
    }
    pos.unmake(); if(S.stop)return 0;
    if(s>best){best=s;bestMove=m;
      if(s>alpha){alpha=s;
        const row=S.pv[ply],nrow=S.pv[ply+1];row[ply]=m;for(let j=ply+1;j<S.pvLen[ply+1];j++)row[j]=nrow[j];S.pvLen[ply]=Math.max(ply+1,S.pvLen[ply+1]);
        if(s>=beta){if(quiet){if(S.killers[ply*2]!==m){S.killers[ply*2+1]=S.killers[ply*2];S.killers[ply*2]=m;}const hi=pos.b[m&127]*128+((m>>7)&127);S.hist[hi]=Math.min(60000000,S.hist[hi]+depth*depth);}break;}
      }}
  }
  if(!legal)return inCheck?-MATE+ply:0;
  let st=best; if(st>MATE-MAXPLY)st+=ply;else if(st<-MATE+MAXPLY)st-=ply;
  TT.k1[idx]=pos.h1;TT.k2[idx]=pos.h2;TT.mv[idx]=bestMove;TT.sc[idx]=st;TT.dp[idx]=depth;TT.fl[idx]=best>=beta?1:(best>a0?0:2);
  return best;
}
/* think: o={timeMs, maxDepth, noise}. noise>0なら固定深さで全候補を評価し乱数を加えて選ぶ（弱いレベル用） */
function think(pos,o){
  if(!TT)ttInit();
  o=o||{}; const timeMs=o.timeMs||1000;
  S.pos=pos;S.nodes=0;S.stop=false;S.deadline=Date.now()+timeMs;
  S.killers=new Int32Array(MAXPLY*2+2);S.hist=new Int32Array(16*128);
  S.pv=[];for(let i=0;i<=MAXPLY;i++)S.pv.push(new Int32Array(MAXPLY+1));S.pvLen=new Int32Array(MAXPLY+1);
  const legal=pos.legalMoves();
  if(!legal.length)return {move:0,score:pos.inCheck()?-MATE:0,pv:[],depth:0,nodes:0};
  const maxD=o.maxDepth||40;
  if(o.noise>0){
    S.deadline=Date.now()+60000; let best=null,bv=-Infinity;
    for(const m of legal){pos.make(m);const s=-negamax(maxD-1,-INF,INF,1,true);pos.unmake();
      const v=s+(Math.random()*2-1)*o.noise;if(v>bv){bv=v;best=[m,s];}}
    return {move:best[0],score:best[1],pv:[best[0]],depth:maxD,nodes:S.nodes};
  }
  let bestMove=legal[0],bestScore=0,pv=[legal[0]],depth=0;
  for(let d=1;d<=maxD;d++){
    const s=negamax(d,-INF,INF,0,true);
    if(S.stop&&d>1)break;
    if(S.pvLen[0]>0){bestMove=S.pv[0][0];pv=Array.from(S.pv[0].subarray(0,S.pvLen[0]));}
    bestScore=s;depth=d;
    if(Date.now()>S.deadline-timeMs*0.5)break;
    if(Math.abs(s)>MATE-MAXPLY&&d>=MATE-Math.abs(s)+1)break;
    if(legal.length===1&&d>=3)break;
  }
  return {move:bestMove,score:bestScore,pv,depth,nodes:S.nodes};
}
function runSearch(msg){const pos=new Pos(msg.startFen);for(const m of msg.moves)pos.make(m);return think(pos,msg);}
if(typeof module!=='undefined')module.exports={Pos,san,think,runSearch,evaluate,enc,mFrom,mTo,mPromo,mFlag,sqName,START_FEN,MATE,VAL};
if(typeof window==='undefined'&&typeof module==='undefined'&&typeof self!=='undefined'){
  self.onmessage=function(e){const r=runSearch(e.data);r.id=e.data.id;self.postMessage(r);};
}
