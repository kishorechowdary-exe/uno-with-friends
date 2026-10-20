import { db, events } from "hatchable";

export const access = "public";
export const methods = ["POST"];

const COLORS = ["red", "yellow", "green", "blue"];
const VALUES = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","+2","wild","+4"];
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function code6() {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,"0")).join("");
}
function cleanName(v) {
  return String(v || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0,18);
}
function publicRoom(s) {
  const players = s.players.map(p => ({
    id:p.id, name:p.name, cardCount:p.hand.length,
    hand:p.id === s._viewer ? p.hand : undefined,
    saidUno:!!p.saidUno
  }));
  return {
    code:s.code,status:s.status,hostId:s.hostId,players,
    currentPlayerId:s.currentPlayerId,direction:s.direction,
    topCard:s.discard[s.discard.length-1] || null,
    activeColor:s.activeColor,drawCount:s.deck.length,round:s.round||1,
    winner:s.winner||null,winnerId:s.winnerId||null,
    messages:s.messages||[]
  };
}
async function load(code) {
  const result = await db.query("SELECT code, state FROM uno_rooms WHERE code = $1", [code]);
  if (!result.rows.length) return null;
  return {code:result.rows[0].code,state:result.rows[0].state};
}
async function save(code, state) {
  await db.query("UPDATE uno_rooms SET state = $2::jsonb, status = $3, updated_at = NOW() WHERE code = $1", [code, JSON.stringify(state), state.status]);
}
function findPlayer(s, id) { return s.players.find(p => p.id === id); }
function sanitizeState(s, viewerId) {
  const safe = JSON.parse(JSON.stringify(s));
  safe._viewer = viewerId;
  return publicRoom(safe);
}
function shuffle(cards) {
  for (let i=cards.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [cards[i],cards[j]]=[cards[j],cards[i]]; }
  return cards;
}
function createDeck() {
  const d=[];
  COLORS.forEach(color=>{
    d.push({id:token().slice(0,12),color,value:"0"});
    for(let n=1;n<=9;n++){ d.push({id:token().slice(0,12),color,value:String(n)}); d.push({id:token().slice(0,12),color,value:String(n)}); }
    ["skip","reverse","+2"].forEach(value=>{d.push({id:token().slice(0,12),color,value});d.push({id:token().slice(0,12),color,value});});
  });
  for(let i=0;i<4;i++){d.push({id:token().slice(0,12),color:"wild",value:"wild"});d.push({id:token().slice(0,12),color:"wild",value:"+4"});}
  return shuffle(d);
}
function ensureDeck(s) {
  if(s.deck.length) return;
  if(s.discard.length<=1) throw new Error("No cards left to draw.");
  const top=s.discard.pop();
  s.deck=shuffle(s.discard);
  s.discard=[top];
}
function drawOne(s,p) { ensureDeck(s); if(!s.deck.length) throw new Error("No cards left to draw."); p.hand.push(s.deck.pop()); }
function nextIndex(s,from,step=1) { const n=s.players.length; return (from + (step*s.direction) % n + n) % n; }
function publicView(s,playerId) {
  const safe=JSON.parse(JSON.stringify(s));
  safe.players=safe.players.map(p=>({id:p.id,name:p.name,hand:p.id===playerId?p.hand:undefined,cardCount:p.hand.length,saidUno:!!p.saidUno}));
  return {room:{code:s.code,status:s.status,hostId:s.hostId,players:safe.players,currentPlayerId:s.currentPlayerId,direction:s.direction,topCard:s.discard[s.discard.length-1]||null,activeColor:s.activeColor,drawCount:s.deck.length,round:s.round||1,winner:s.winner||null,winnerId:s.winnerId||null},player:{id:playerId}};
}
export default async function(req,res) {
  try {
    const body=req.body||{};
    if(body.action!=="create"&&body.action!=="join") return res.status(400).json({error:"Choose create or join."});
    const name=cleanName(body.name);
    if(name.length<1) return res.status(400).json({error:"Enter a nickname to play."});
    let s, code, playerId=token(), playerToken=token();
    if(body.action==="create") {
      code=code6();
      for(let tries=0;tries<8;tries++){ const exists=await load(code); if(!exists)break; code=code6(); }
      s={code,status:"waiting",hostId:playerId,players:[{id:playerId,token:playerToken,name,hand:[],saidUno:false}],deck:[],discard:[],activeColor:"red",currentPlayerId:null,direction:1,winner:null,winnerId:null,round:1};
      await db.query("INSERT INTO uno_rooms (code, host_id, status, state) VALUES ($1, $2, $3, $4::jsonb)",[code,playerId,s.status,JSON.stringify(s)]);
      await events.publish("uno-room:"+code,"changed",{kind:"joined"});
    } else {
      code=String(body.code||"").trim().toUpperCase();
      if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return res.status(400).json({error:"That room code doesn't look right."});
      const row=await load(code);
      if(!row) return res.status(404).json({error:"Room not found. Check the code with your friend."});
      s=row.state;
      if(s.status!=="waiting") return res.status(409).json({error:"This game has already started."});
      if(s.players.length>=8) return res.status(409).json({error:"Room is full (8 players max)."});
      if(s.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) return res.status(409).json({error:"That nickname is already taken in this room."});
      s.players.push({id:playerId,token:playerToken,name,hand:[],saidUno:false});
      await save(code,s);
      await events.publish("uno-room:"+code,"changed",{kind:"joined"});
    }
    const v=publicView(s,playerId);
    v.token=playerToken;
    return res.json(v);
  } catch(e) {
    console.log("rooms error",e?.message||e);
    return res.status(500).json({error:"Couldn't open the room. Please try again."});
  }
}