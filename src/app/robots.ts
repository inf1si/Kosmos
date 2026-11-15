import type { MetadataRoute } from 'next';
import { searchIndexable, siteUrl } from '@/lib/site-metadata';

export const dynamic='force-dynamic';

export default function robots():MetadataRoute.Robots{
  if(!searchIndexable())return {rules:{userAgent:'*',disallow:'/'}};

  // The studio stays crawlable so its noindex is read; a path blocked here can still be listed by address.
  return {rules:{userAgent:'*',allow:'/',disallow:['/api/','/auth/']},sitemap:`${siteUrl()}/sitemap.xml`};
}
