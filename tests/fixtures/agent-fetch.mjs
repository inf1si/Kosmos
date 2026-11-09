import './vertex-auth.mjs';

// Test-only transport. Shipped source always calls real Vertex/OAuth endpoints.
const original=globalThis.fetch;

globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);

  if(['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com'].includes(url.hostname))throw new Error('Direct provider API is forbidden');

  if(url.href==='https://oidc.vercel.com/~token')return Response.json({token:process.env.VERCEL_OIDC_TOKEN,expiry:Math.floor(Date.now()/1000)+3600});

  if(url.hostname==='sts.googleapis.com')return Response.json({access_token:'synthetic-federated',expires_in:3600,token_type:'Bearer',issued_token_type:'urn:ietf:params:oauth:token-type:access_token'});

  if(url.hostname==='iamcredentials.googleapis.com')return Response.json({accessToken:'synthetic-vertex',expireTime:new Date(Date.now()+3600000).toISOString()});

  if(/^(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com$/.test(url.hostname)&&process.env.KOSMOS_AGENT_FIXTURE_URL){
    if(request.headers.get('authorization')!=='Bearer synthetic-vertex')throw new Error('Vertex OAuth bearer is missing');

    if(!url.pathname.includes('/projects/orbiter-ai/locations/global/publishers/'))throw new Error('Vertex project path is wrong');
    const provider=url.pathname.includes('/anthropic/')?'anthropic':'gemini';

    return original(`${process.env.KOSMOS_AGENT_FIXTURE_URL}/fixture-model?provider=${provider}`,{method:request.method,headers:{'Content-Type':'application/json'},body:request.method==='GET'?undefined:await request.text(),signal:request.signal});
  }

  return original(input,init);
};
