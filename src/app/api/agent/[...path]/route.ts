import { writingAgentAPI } from '@/lib/agent-api';

export const maxDuration=60;

async function handler(request:Request,context:{params:Promise<{path:string[]}>}){
  return writingAgentAPI(request,(await context.params).path);
}

export { handler as GET,handler as POST,handler as PATCH };
