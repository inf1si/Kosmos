// Test-only transport. The app has no test provider or network bypass in shipped source.
const original=globalThis.fetch;

const providers=new Set(['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com']);

globalThis.fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input));

  if(providers.has(url.hostname)&&process.env.KOSMOS_AGENT_FIXTURE_URL){
    const request=new Request(input,init);

    return original(`${process.env.KOSMOS_AGENT_FIXTURE_URL}/fixture-model?provider=${url.hostname}`,{method:request.method,headers:{'Content-Type':'application/json'},body:request.method==='GET'?undefined:await request.text(),signal:request.signal});
  }

  return original(input,init);
};
