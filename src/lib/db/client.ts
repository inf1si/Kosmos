import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = import.meta.env.DATABASE_URL ?? "file:./local.db";
const authToken = import.meta.env.DATABASE_AUTH_TOKEN as string | undefined;

export const db = drizzle(createClient({ url, authToken }), { schema });
