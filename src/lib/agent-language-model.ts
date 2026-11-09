import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { WORKFLOW_SERIALIZE,WORKFLOW_DESERIALIZE } from '@workflow/serde';
import { providerConfig,type AIProvider } from './ai-provider';

type RuntimeModel=ReturnType<ReturnType<typeof createOpenAI>>;

/** Only provider/model identifiers cross durable boundaries. Keys resolve inside a model step. */
export class AgentLanguageModel {
  readonly specificationVersion='v4' as const;
  readonly supportedUrls={};
  readonly provider:string;
  constructor(readonly vendor:AIProvider,readonly modelId:string){this.provider=`writing-agent.${vendor}`;}
  static [WORKFLOW_SERIALIZE](model:AgentLanguageModel){return {vendor:model.vendor,modelId:model.modelId};}
  static [WORKFLOW_DESERIALIZE](value:{vendor:AIProvider;modelId:string}){return new AgentLanguageModel(value.vendor,value.modelId);}
  private resolve(){
    const config=providerConfig(this.vendor);

    if(!config)throw new Error('서버 AI 연결이 필요합니다.');

    if(this.vendor==='openai')return createOpenAI({apiKey:config.key})(this.modelId);

    if(this.vendor==='anthropic')return createAnthropic({apiKey:config.key})(this.modelId);

    return createGoogleGenerativeAI({apiKey:config.key})(this.modelId);
  }
  async doGenerate(options:Parameters<RuntimeModel['doGenerate']>[0]){
    try{return await this.resolve().doGenerate(options);}catch{throw new Error('모델 요청을 완료하지 못했습니다. 연결·문맥 크기·제공자 한도를 확인하세요.');}
  }
  async doStream(options:Parameters<RuntimeModel['doStream']>[0]){
    try{return await this.resolve().doStream(options);}catch{throw new Error('모델 요청을 완료하지 못했습니다. 연결·문맥 크기·제공자 한도를 확인하세요.');}
  }
}

export function agentLanguageModel(provider:AIProvider,modelId:string){return new AgentLanguageModel(provider,modelId);}
