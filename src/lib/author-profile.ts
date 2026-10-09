import { z } from 'zod';

export const authorProfileSchema=z.object({name:z.string().trim().max(80),bio:z.string().max(10000)});

export type AuthorProfile=z.infer<typeof authorProfileSchema>;

export const publishedProfileSchema=authorProfileSchema.extend({bio:z.string().trim().min(1).max(10000),published_at:z.iso.datetime({offset:true})});

export type PublishedProfile=z.infer<typeof publishedProfileSchema>;

export const emptyAuthorProfile:AuthorProfile={name:'',bio:''};

export function sameProfile(draft:AuthorProfile,published:PublishedProfile|null){return !!published&&draft.name.trim()===published.name&&draft.bio.trim()===published.bio;}
