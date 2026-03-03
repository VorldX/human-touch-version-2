const { spawn } = require('node:child_process');
const http = require('node:http');

const port = 3023;
const child = spawn('npm',['run','dev','--','--port',String(port)],{shell:true});
let out='';
let err='';
child.stdout.on('data',d=>{ out += d.toString(); });
child.stderr.on('data',d=>{ err += d.toString(); });

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function fetchUrl(url){
  return new Promise((resolve,reject)=>{
    const req = http.get(url,(res)=>{
      let data='';
      res.on('data',c=> data += c.toString());
      res.on('end',()=> resolve({status: res.statusCode, body:data, headers:res.headers}));
    });
    req.on('error',reject);
  });
}

(async()=>{
  const startedAt = Date.now();
  let ready = false;
  while(Date.now() - startedAt < 120000){
    await sleep(500);
    const marker = out + '\n' + err;
    if(marker.includes('Local:') || marker.includes('Ready in') || marker.includes(`localhost:${port}`)){
      ready = true;
      break;
    }
  }

  if(!ready){
    console.log('NOT_READY');
    console.log('STDERR=' + err.slice(-4000));
    console.log('STDOUT=' + out.slice(-4000));
  } else {
    try{
      const res = await fetchUrl(`http://localhost:${port}/app?tab=settings&settingsLane=integrations&composio=connected&toolkit=gmail`);
      console.log('STATUS=' + res.status);
      console.log('BODY=' + res.body.slice(0, 600).replace(/\n/g,' '));
    } catch(e){
      console.log('REQ_ERR=' + (e && e.message ? e.message : String(e)));
    }
    await sleep(2000);
    console.log('STDERR=' + err.slice(-8000));
    console.log('STDOUT=' + out.slice(-8000));
  }

  try { child.kill('SIGTERM'); } catch {}
  await sleep(1500);
  try { child.kill('SIGKILL'); } catch {}
  process.exit(0);
})();
