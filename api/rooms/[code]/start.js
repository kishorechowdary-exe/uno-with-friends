import { db, events } from "hatchable";

export const access = "public";
export const methods = ["POST"];

function token(){return Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,"0")).join("");}
function shuffle(cards){for(let i=cards.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}return cards;}
function newDeck(){
  const colors=["red","yellow","green","blue"],d=[];
  colors.forEach(color=>{d.push({id:token(),color,value:"0"});for(let n=1;n<=9;n++){d.push({id:token(),color,value:String(n)},{id:token(),color,value:String(n)});}["skip","reverse","+2"].forEach(value=>d.push({id:token(),color,value},{id:token(),color,value}));});
  for(let i=0;i<4;i++)d.push({id:token(),color:"wild",value:"wild"},{id:token(),color:"wild",value:"+4"});
  return shuffle(d);
}
export default async function(req,res){
  try{
    const code=String(req.params.code||"").toUpperCase(),t=String(req.body?.token||"");
    const q=await db.query("SELECT state FROM uno_rooms WHERE code = $1",[code]);
    if(!q.rows.length)return res.status(404).json({error:"Room not found."});
    const s=q.rows[0].state,p=s.players.find(x=>x.token===t);
    if(!p)return res.status(403).json({error:"Player session not found."});
    if(p.id!==s.hostId)return res.status(403).json({error:"Only the host can start the game."});
    if(s.status!=="waiting")return res.status(409).json({error:"This game has already started."});
    if(s.players.length<2)return res.status(409).json({error:"Invite at least one friend first."});
    const deck=newDeck();
    s.players.forEach(pl=>{pl.hand=[];pl.saidUno=false;pl.drewThisTurn=false;pl.lastDrawnId=null;for(let i=0;i<7;i++)pl.hand.push(deck.pop());});
    let first=deck.pop();while(first.value==="wild"||first.value==="+4"){deck.unshift(first);first=deck.pop();}
    s.deck=deck;s.discard=[first];s.activeColor=first.color;s.currentPlayerId=s.players[0].id;s.direction=1;s.status="playing";s.winner=null;s.winnerId=null;s.startedAt=Date.now();s.round=(s.round||0)+1;
    if(first.value==="+2"){for(let i=0;i<2;i++)s.players[0].hand.push(s.deck.pop());}
    if(first.value==="skip"||first.value==="reverse")s.currentPlayerId=s.players[1].id;
    await db.query("UPDATE uno_rooms SET state=$2::jsonb,status=$3,updated_at=NOW() WHERE code=$1",[code,JSON.stringify(s),s.status]);
    await events.publish("uno-room:"+code,"changed",{kind:"started"});
    const players=s.players.map(x=>({id:x.id,name:x.name,cardCount:x.hand.length,hand:x.id===p.id?x.hand:undefined,saidUno:x.saidUno,drewThisTurn:x.id===p.id&&!!x.drewThisTurn}));
    return res.json({room:{code:s.code,status:s.status,hostId:s.hostId,players,currentPlayerId:s.currentPlayerId,direction:s.direction,topCard:s.discard[s.discard.length-1],activeColor:s.activeColor,drawCount:s.deck.length,round:s.round},message:"Game started!"});
  }catch(e){console.log("start game error",e?.message||e);return res.status(500).json({error:"Couldn't start the game."});}
}