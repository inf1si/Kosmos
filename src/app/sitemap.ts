import type { MetadataRoute } from 'next';
import { getPublicData } from '@/lib/public-data';
import { sitemapEntries, siteUrl } from '@/lib/site-metadata';

// Publications change without a deployment, so the list is read on request.
export const dynamic='force-dynamic';

export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  return sitemapEntries(await getPublicData().catch(()=>[]),siteUrl());
}
