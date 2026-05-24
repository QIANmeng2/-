const {Pool}=require('pg');
const p=new Pool({host:'yamabiko.proxy.rlwy.net',port:35510,user:'postgres',password:'OHgfbDBtBUxgcBbwSUTVglzoyEimCAgD',database:'railway',ssl:{rejectUnauthorized:false}});
p.query("SELECT indexname,indexdef FROM pg_indexes WHERE tablename='competition_registrations' ORDER BY indexname",(e,r)=>{
  if(e)console.error(e.message);
  else r.rows.forEach(x=>console.log(x.indexname + '\n  ' + x.indexdef));
  p.end();
});
