import nock from 'nock';

// Google Auth uses an independent HTTP client for STS. Keep it off the real network too.
nock('https://sts.googleapis.com').persist().post('/v1/token',body=>String(body.audience).includes('/workloadIdentityPools/vercel/providers/vercel')).reply(200,()=>({access_token:'synthetic-federated',expires_in:3600,token_type:'Bearer',issued_token_type:'urn:ietf:params:oauth:token-type:access_token'}));
