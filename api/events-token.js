import { db, events } from "hatchable";

export const access = "public";
export const methods = ["GET"];

export default async function(req,res){
  try{
    const room=String(req.query?.room||"").toUpperCase();
    const token=String(req.query?.token||"");
    if(!/^[A-HJ-NP-Z2-9]{6}$/.test(room)||!token)return res.status(400).json({error:"Room session missing."});
    const q=await db.query("SELECT state FROM uno_rooms WHERE code=$1",[room]);
    if(!q.rows.length)return res.status(404).json({error:"Room not found."});
    if(!q.rows[0].state.players.some(p=>p.token===token))return res.status(403).json({error:"Player is not in this room."});
    return res.json(await events.grant(["uno-room:"+room]));
  }catch(e){console.log("event token error",e?.message||e);return res.status(500).json({error:"Could not connect live updates."});}
}