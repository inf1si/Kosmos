import { z } from 'zod';

// Historical messages keep their original provider ID; new requests use Vertex's two model families.
export const providerSchema=z.enum(['openai','anthropic','gemini']);

export type AIProvider=z.infer<typeof providerSchema>;

export const vertexProviderSchema=z.enum(['gemini','anthropic']);

export type VertexProvider=z.infer<typeof vertexProviderSchema>;

export const activeAIProviders=['gemini','anthropic'] as const;

export const providerLabels:Record<AIProvider,string>={openai:'OpenAI',anthropic:'Claude',gemini:'Gemini'};

export const vertexModelIdSchema=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,199}$/).refine(value=>!value.includes('..'));

export const vertexModelListSchema=z.array(vertexModelIdSchema).min(1).refine(models=>new Set(models).size===models.length);

export function serverModelCatalog(provider:AIProvider,env:Record<string,string|undefined>=process.env){
  const prefix=provider==='gemini'?'VERTEX_GEMINI':'VERTEX_CLAUDE';

  return [...new Set([env[prefix+'_MODEL'],...(env[prefix+'_MODELS']||'').split(/[,\n]/)].flatMap(value=>{const parsed=vertexModelIdSchema.safeParse(value);

return parsed.success?[parsed.data]:[];}))];
}

export type ProviderConfig={provider:VertexProvider;model:string;project:string;location:string};

type Environment=Record<string,string|undefined>;

export function vertexAuthMode(env:Environment=process.env){return env.VERTEX_AUTH_MODE||((env.VERCEL||env.GOOGLE_VERTEX_WIF_PROVIDER)?'wif':'adc');}

export function vertexAuthConfigured(env:Environment=process.env){
  if(vertexAuthMode(env)==='adc')return true;

  return vertexAuthMode(env)==='wif'&&/^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(env.GOOGLE_VERTEX_WIF_PROVIDER||'')&&/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(env.GOOGLE_VERTEX_SERVICE_ACCOUNT||'');
}

export function providerConfig(provider:AIProvider,env:Environment=process.env,modelOverride?:string):ProviderConfig|null{
  const family=vertexProviderSchema.safeParse(provider),project=env.GOOGLE_VERTEX_PROJECT,location=(provider==='anthropic'?env.VERTEX_CLAUDE_LOCATION:env.VERTEX_GEMINI_LOCATION)||env.GOOGLE_VERTEX_LOCATION||'global';
  const model=vertexModelIdSchema.safeParse(modelOverride||(provider==='anthropic'?env.VERTEX_CLAUDE_MODEL:env.VERTEX_GEMINI_MODEL)||serverModelCatalog(provider,env)[0]);

  if(!family.success||!project||!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)||!model.success||!vertexAuthConfigured(env)||!(/^(global|[a-z]+-[a-z]+\d+)$/.test(location)))return null;

  return {provider:family.data,model:model.data,project,location};
}
