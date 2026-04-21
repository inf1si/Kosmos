import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------- Better-Auth tables ----------
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  name: text("name"),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  password: text("password"),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp" }),
  scope: text("scope"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }),
  updatedAt: integer("updatedAt", { mode: "timestamp" }),
});

// ---------- App domain ----------
export const series = sqliteTable("series", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  synopsis: text("synopsis"),
  coverImage: text("coverImage"),
  status: text("status", { enum: ["연재중", "완결", "휴재"] }).notNull().default("연재중"),
  kind: text("kind", { enum: ["단편", "장편"] }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const chapter = sqliteTable(
  "chapter",
  {
    id: text("id").primaryKey(),
    seriesId: text("seriesId").notNull().references(() => series.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    slug: text("slug"),
    contentJson: text("contentJson", { mode: "json" }),
    contentHtml: text("contentHtml"),
    status: text("status", { enum: ["초안", "예약", "발행"] }).notNull().default("초안"),
    publishedAt: integer("publishedAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    seriesNumberUnique: uniqueIndex("chapter_series_number_unique").on(t.seriesId, t.number),
  }),
);

export const wikiPage = sqliteTable("wiki_page", {
  id: text("id").primaryKey(),
  seriesId: text("seriesId").references(() => series.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary"),
  contentJson: text("contentJson", { mode: "json" }),
  contentHtml: text("contentHtml"),
  status: text("status", { enum: ["초안", "발행"] }).notNull().default("초안"),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const tag = sqliteTable("tag", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind"),
});

export const chapterTag = sqliteTable(
  "chapter_tag",
  {
    chapterId: text("chapterId").notNull().references(() => chapter.id, { onDelete: "cascade" }),
    tagId: text("tagId").notNull().references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: uniqueIndex("chapter_tag_pk").on(t.chapterId, t.tagId),
  }),
);

export const wikiTag = sqliteTable(
  "wiki_tag",
  {
    wikiId: text("wikiId").notNull().references(() => wikiPage.id, { onDelete: "cascade" }),
    tagId: text("tagId").notNull().references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: uniqueIndex("wiki_tag_pk").on(t.wikiId, t.tagId),
  }),
);

export const link = sqliteTable("link", {
  id: text("id").primaryKey(),
  fromType: text("fromType", { enum: ["chapter", "wiki"] }).notNull(),
  fromId: text("fromId").notNull(),
  toType: text("toType", { enum: ["chapter", "wiki"] }).notNull(),
  toId: text("toId").notNull(),
});

export const asset = sqliteTable("asset", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  mime: text("mime"),
  width: integer("width"),
  height: integer("height"),
  uploadedAt: integer("uploadedAt", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
