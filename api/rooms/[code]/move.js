import { db, events } from "hatchable";

export const access = "public";
export const methods = ["POST"];

const COLORS=["red","yellow","green","blue"];
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,"0")).join("");}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function refill(s){if(s.deck.length)return;if(s.discard.length<=1)throw new Error("There are no more cards to draw.");const top=s.discard.pop();s.deck=shuffle(s.discard);s.discard=[top];}
function draw(s,p,n){for(let i=0;i<n;i++){refill(s);if(!s.deck.length)break;p.hand.push(s.deck.pop());}}
function playerView(s,id){return {room:{code:s.code,status:s.status,hostId:s.hostId,players:s.players.map(p=>({id:p.id,name:p.name,cardCount:p.hand.length,hand:p.id===id?p.hand:undefined,saidUno:!!p.saidUno,drewThisTurn:p.id===id&&!!p.drewThisTurn})),currentPlayerId:s.currentPlayerId,direction:s.direction,topCard:s.discard[s.discard.length-1]||null,activeColor:s.activeColor,drawCount:s.deck.length,round:s.round||1,winner:s.winner||null,winnerId:s.winnerId||null}};}
export default async function(req,res){
  try{
    const code=String(req.params.code||"").toUpperCase(),b=req.body||{},t=String(b.token||"");
    const q=await db.query("SELECT state FROM uno_rooms WHERE code=$1",[code]);
    if(!q.rows.length)return res.status(404).json({error:"Room not found."});
    const s=q.rows[0].state,p=s.players.find(x=>x.token===t);
    if(!p)return res.status(403).json({error:"Player session not found."});
    if(s.status!=="playing")return res.status(409).json({error:"The game isn't in progress."});
    if(s.currentPlayerId!==p.id)return res.status(409).json({error:"It's not your turn yet."});
    const top=s.discard[s.discard.length-1];
    let message="";
    if(b.action==="draw"){
      if(p.drewThisTurn){
        p.drewThisTurn=false;
        const idx=s.players.findIndex(x=>x.id===p.id);
        s.currentPlayerId=s.players[(idx+s.direction+s.players.length)%s.players.length].id;
        message="You passed your turn.";
      } else {
        draw(s,p,1);p.drewThisTurn=true;
        const drawn=p.hand[p.hand.length-1];
        const playable=drawn.color==="wild"||drawn.color===s.activeColor||drawn.value===top.value;
        if(!playable){p.drewThisTurn=false;const idx=s.players.findIndex(x=>x.id===p.id);s.currentPlayerId=s.players[(idx+s.direction+s.players.length)%s.players.length].id;message="You drew a card and passed your turn.";}else message="You drew a card. Play a card or tap the draw pile again to pass.";
      }
    } else if(b.action==="play"){
      const i=p.hand.findIndex(c=>c.id===b.cardId);
      if(i<0)return res.status(400).json({error:"That card isn't in your hand."});
      const c=p.hand[i],can=(c.color==="wild"||c.color===s.activeColor||c.value===top.value);
      if(!can)return res.status(409).json({error:"Play a card matching the colour or number, or a wild card."});
      if(p.drewThisTurn&&!p.lastDrawnId&&false)return res.status(409).json({error:"Invalid move."});
      if((c.value==="wild"||c.value==="+4")&&!COLORS.includes(b.color))return res.status(400).json({error:"Choose a colour for your wild card."});
      if(c.value==="+4"){
        const hasColor=p.hand.some(other=>other.id!==c.id&&other.color===s.activeColor&&other.color!=="wild");
        if(hasColor)return res.status(409).json({error:"You can only play Wild +4 when you have no cards of the current colour."});
      }
      p.hand.splice(i,1);s.discard.push(c);s.activeColor=c.color==="wild"?b.color:c.color;p.saidUno=false;p.drewThisTurn=false;p.lastDrawnId=null;
      const idx=s.players.findIndex(x=>x.id===p.id);let next=(idx+s.direction+s.players.length)%s.players.length;
      if(c.value==="reverse"){s.direction*=-1;if(s.players.length===2)next=idx;}
      if(c.value==="skip")next=(next+s.direction+s.players.length)%s.players.length;
      if(c.value==="+2"){draw(s,s.players[next],2);next=(next+s.direction+s.players.length)%s.players.length;}
      if(c.value==="+4"){draw(s,s.players[next],4);next=(next+s.direction+s.players.length)%s.players.length;}
      if(p.hand.length===0){s.status="finished";s.winner=p.name;s.winnerId=p.id;s.currentPlayerId=null;message=p.name+" wins the round!";}else if(p.hand.length===1&&!p.saidUno){message="You have one card left — press UNO!";s.currentPlayerId=s.players[next].id;}else{s.currentPlayerId=s.players[next].id;message="Card played.";}
    } else return res.status(400).json({error:"Unknown move."});
    await db.query("UPDATE uno_rooms SET state=$2::jsonb,status=$3,updated_at=NOW() WHERE code=$1",[code,JSON.stringify(s),s.status]);
    await events.publish("uno-room:"+code,"changed",{kind:"move"});
    return res.json({...playerView(s,p.id),message});
  }catch(e){console.log("move error",e?.message||e);return res.status(400).json({error:e.message||"Couldn't make that move."});}
}