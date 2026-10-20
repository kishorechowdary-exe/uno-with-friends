import { db, events } from "hatchable";

export const access = "public";
export const methods = ["POST"];

export default async function(req,res){
  try{
    const code=String(req.params.code||"").toUpperCase(),t=String(req.body?.token||"");
    const q=await db.query("SELECT state FROM uno_rooms WHERE code=$1",[code]);
    if(!q.rows.length)return res.status(404).json({error:"Room not found."});
    const s=q.rows[0].state,p=s.players.find(x=>x.token===t);
    if(!p)return res.status(403).json({error:"Player session not found."});
    if(s.status!=="playing")return res.status(409).json({error:"The game isn't in progress."});
    if(p.hand.length!==1)return res.status(409).json({error:"You can only call UNO when you have exactly one card."});
    p.saidUno=true;
    await db.query("UPDATE uno_rooms SET state=$2::jsonb,updated_at=NOW() WHERE code=$1",[code,JSON.stringify(s)]);
    await events.publish("uno-room:"+code,"changed",{kind:"uno"});
    return res.json({ok:true,room:{code:s.code,status:s.status,hostId:s.hostId,players:s.players.map(x=>({id:x.id,name:x.name,cardCount:x.hand.length,hand:x.id===p.id?x.hand:undefined,saidUno:!!x.saidUno,drewThisTurn:x.id===p.id&&!!x.drewThisTurn})),currentPlayerId:s.currentPlayerId,direction:s.direction,topCard:s.discard[s.discard.length-1]||null,activeColor:s.activeColor,drawCount:s.deck.length,round:s.round||1,winner:s.winner||null,winnerId:s.winnerId||null}});
  }catch(e){console.log("uno call error",e?.message||e);return res.status(500).json({error:"Couldn't call UNO."});}
}