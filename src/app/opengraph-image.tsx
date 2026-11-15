import { getPublicAuthorName } from '@/lib/public-data';
import { shareImage } from '@/lib/share-image';
import { SHARE_IMAGE_SIZE, SITE_NAME } from '@/lib/site-metadata';

export const dynamic='force-dynamic';

export const alt=SITE_NAME;

export const size=SHARE_IMAGE_SIZE;

export const contentType='image/png';

export default async function Image(){
  return shareImage({title:SITE_NAME,author:await getPublicAuthorName()});
}
