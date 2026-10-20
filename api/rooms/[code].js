import { db } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function(req,res) {
  try {
    const code=String(req.params.code||"").toUpperCase();
    const accessToken=String(req.query?.token||"");
    if(!accessToken) return res.status(401).json({error:"Your player session is missing. Rejoin the room."});
    const result=await db.query("SELECT state FROM uno_rooms WHERE code = $1",[code]);
    if(!result.rows.length) return res.status(404).json({error:"Room not found."});
    const s=result.rows[0].state;
    const p=s.players.find(x=>x.token===accessToken);
    if(!p) return res.status(403).json({error:"This player session isn't in the room."});
    const players=s.players.map(x=>({id:x.id,name:x.name,cardCount:x.hand.length,hand:x.id===p.id?x.hand:undefined,saidUno:!!x.saidUno,drewThisTurn:x.id===p.id&&!!x.drewThisTurn}));
    return res.json({room:{code:s.code,status:s.status,hostId:s.hostId,players,currentPlayerId:s.currentPlayerId,direction:s.direction,topCard:s.discard[s.discard.length-1]||null,activeColor:s.activeColor,drawCount:s.deck.length,round:s.round||1,winner:s.winner||null,winnerId:s.winnerId||null}});
  } catch(e) {
    console.log("room fetch error",e?.message||e);
    return res.status(500).json({error:"Couldn't refresh the table."});
  }
}