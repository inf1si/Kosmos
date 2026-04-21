/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly DATABASE_URL?: string;
  readonly DATABASE_AUTH_TOKEN?: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL?: string;
  readonly ANTHROPIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
