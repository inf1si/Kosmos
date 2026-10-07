import type JSZip from 'jszip';
import { z } from 'zod';

// JSZip omits these loaded-entry fields from its public types. Decode them before allocating.
const loadedEntrySchema = z.object({
  _data: z.object({ uncompressedSize: z.number().int().nonnegative().safe() }).optional(),
  unsafeOriginalName: z.string().optional(),
});

export function zipUncompressedSize(entry: JSZip.JSZipObject): number | undefined {
  const parsed = loadedEntrySchema.safeParse(entry);

  return parsed.success ? parsed.data._data?.uncompressedSize : undefined;
}

export function zipOriginalName(entry: JSZip.JSZipObject): string {
  const parsed = loadedEntrySchema.safeParse(entry);

  return parsed.success ? parsed.data.unsafeOriginalName ?? entry.name : entry.name;
}
