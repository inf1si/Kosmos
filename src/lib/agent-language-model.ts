import { WORKFLOW_SERIALIZE,WORKFLOW_DESERIALIZE } from '@workflow/serde';
import { providerConfig,type AIProvider } from './ai-provider';

import type { vertexLanguageModel } from './vertex-runtime';

type RuntimeModel=ReturnType<typeof vertexLanguageModel>;

/** Only provider/model identifiers cross durable boundaries. Vertex authentication resolves inside a model step. */
export class AgentLanguageModel {
  readonly specificationVersion='v4' as const;
  readonly supportedUrls={};
  readonly provider:string;
  constructor(readonly vendor:AIProvider,readonly modelId:string){this.provider=`writing-agent.${vendor}`;}
  static [WORKFLOW_SERIALIZE](model:AgentLanguageModel){return {vendor:model.vendor,modelId:model.modelId};}
  static [WORKFLOW_DESERIALIZE](value:{vendor:AIProvider;modelId:string}){return new AgentLanguageModel(value.vendor,value.modelId);}
  async doGenerate(options:Parameters<RuntimeModel['doGenerate']>[0]){return generateAgentModel(this.vendor,this.modelId,options);}
  async doStream(options:Parameters<RuntimeModel['doStream']>[0]){return streamAgentModel(this.vendor,this.modelId,options);}
}

export function agentLanguageModel(provider:AIProvider,modelId:string){return new AgentLanguageModel(provider,modelId);}

async function generateAgentModel(vendor:AIProvider,modelId:string,options:Parameters<RuntimeModel['doGenerate']>[0]){
  'use step';
  const {vertexLanguageModel}=await import('./vertex-runtime'),config=providerConfig(vendor,process.env,modelId);

  if(!config)throw new Error('Vertex AI 서버 인증과 모델을 설정하세요.');

  try{return await vertexLanguageModel(config).doGenerate(options);}catch{throw new Error('Vertex AI 요청을 완료하지 못했습니다. 모델·접근 권한·할당량을 확인하세요.');}
}

async function streamAgentModel(vendor:AIProvider,modelId:string,options:Parameters<RuntimeModel['doStream']>[0]){
  'use step';
  const {vertexLanguageModel}=await import('./vertex-runtime'),config=providerConfig(vendor,process.env,modelId);

  if(!config)throw new Error('Vertex AI 서버 인증과 모델을 설정하세요.');

  return vertexLanguageModel(config).doStream(options);
}
