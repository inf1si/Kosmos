import { getPublicAuthorName, getPublicData } from '@/lib/public-data';
import { shareImage } from '@/lib/share-image';
import { SHARE_IMAGE_SIZE, SITE_NAME } from '@/lib/site-metadata';

export const dynamic='force-dynamic';

export const alt=SITE_NAME;

export const size=SHARE_IMAGE_SIZE;

export const contentType='image/png';

export default async function Image({params}:{params:Promise<{workId:string}>}){
  const {workId}=await params,[data,author]=await Promise.all([getPublicData().catch(()=>[]),getPublicAuthorName()]),pub=data.find(item=>item.workId===workId);

  return shareImage(pub?{title:pub.title,subtitle:pub.subtitle,author}:{title:SITE_NAME,author});
}
