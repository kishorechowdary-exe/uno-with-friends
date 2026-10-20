import { db, events } from "hatchable";

export const access = "public";
export const methods = ["GET","POST"];

function clean(s){return String(s||"").replace(/[<>\u0000-\u001f]/g,"").trim().slice(0,160);}
export default async function(req,res){
  try{
    const code=String(req.params.code||"").toUpperCase();
    if(req.method==="POST"){
      const token=String(req.body?.token||""),text=clean(req.body?.text);
      if(!text)return res.status(400).json({error:"Write a message first."});
      const q=await db.query("SELECT state FROM uno_rooms WHERE code=$1",[code]);
      if(!q.rows.length)return res.status(404).json({error:"Room not found."});
      const s=q.rows[0].state,p=s.players.find(x=>x.token===token);
      if(!p)return res.status(403).json({error:"Your player session isn't in this room."});
      const r=await db.query("INSERT INTO uno_chat (room_code,player_id,player_name,message) VALUES ($1,$2,$3,$4) RETURNING id",[code,p.id,p.name,text]);
      await events.publish("uno-room:"+code,"changed",{kind:"chat"});
      return res.json({ok:true,id:r.rows[0].id});
    }
    const token=String(req.query?.token||""),after=Math.max(0,Number(req.query?.after||0));
    const q=await db.query("SELECT state FROM uno_rooms WHERE code=$1",[code]);
    if(!q.rows.length)return res.status(404).json({error:"Room not found."});
    const s=q.rows[0].state,p=s.players.find(x=>x.token===token);
    if(!p)return res.status(403).json({error:"Your player session isn't in this room."});
    const r=await db.query("SELECT id,player_name,message FROM uno_chat WHERE room_code=$1 AND id>$2 ORDER BY id ASC LIMIT 80",[code,after]);
    return res.json({messages:r.rows.map(m=>({id:Number(m.id),name:m.player_name,text:m.message}))});
  }catch(e){console.log("chat error",e?.message||e);return res.status(500).json({error:"Chat is unavailable right now."});}
}