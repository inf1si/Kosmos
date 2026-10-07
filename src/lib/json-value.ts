import { z } from 'zod';

/** The values accepted at JSON I/O boundaries, before a feature-specific schema is applied. */
export const jsonValueSchema = z.json();

// Optional object fields are omitted by JSON.stringify; parsed JSON never contains undefined.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };
