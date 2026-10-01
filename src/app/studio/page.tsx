import { StudioProvider } from '@/components/studio-provider';
import { Studio } from '@/components/studio';
export default function StudioPage(){const localPreview=process.env.NODE_ENV==='development'||process.env.ALLOW_LOCAL_PREVIEW==='true';return <StudioProvider localPreview={localPreview}><Studio/></StudioProvider>;}
