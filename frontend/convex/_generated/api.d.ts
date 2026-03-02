/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys_internals from "../apiKeys/internals.js";
import type * as apiKeys_mutations from "../apiKeys/mutations.js";
import type * as apiKeys_queries from "../apiKeys/queries.js";
import type * as chat_internals from "../chat/internals.js";
import type * as chat_mutations from "../chat/mutations.js";
import type * as chat_queries from "../chat/queries.js";
import type * as documents_actions from "../documents/actions.js";
import type * as documents_internals from "../documents/internals.js";
import type * as documents_mutations from "../documents/mutations.js";
import type * as documents_queries from "../documents/queries.js";
import type * as folders_mutations from "../folders/mutations.js";
import type * as folders_queries from "../folders/queries.js";
import type * as googleDrive_actions from "../googleDrive/actions.js";
import type * as googleDrive_internals from "../googleDrive/internals.js";
import type * as googleDrive_queries from "../googleDrive/queries.js";
import type * as http from "../http.js";
import type * as ingestion_chunking from "../ingestion/chunking.js";
import type * as ingestion_embedding from "../ingestion/embedding.js";
import type * as ingestion_metadata from "../ingestion/metadata.js";
import type * as ingestion_parsing from "../ingestion/parsing.js";
import type * as lib_auth from "../lib/auth.js";
import type * as migrations_backfillMemberEmails from "../migrations/backfillMemberEmails.js";
import type * as migrations_backfillMemberEmailsHelper from "../migrations/backfillMemberEmailsHelper.js";
import type * as migrations_backfillOrgs from "../migrations/backfillOrgs.js";
import type * as navigation_internals from "../navigation/internals.js";
import type * as organizations_actions from "../organizations/actions.js";
import type * as organizations_mutations from "../organizations/mutations.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as search_actions from "../search/actions.js";
import type * as search_internals from "../search/internals.js";
import type * as settings_actions from "../settings/actions.js";
import type * as settings_mutations from "../settings/mutations.js";
import type * as settings_queries from "../settings/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "apiKeys/internals": typeof apiKeys_internals;
  "apiKeys/mutations": typeof apiKeys_mutations;
  "apiKeys/queries": typeof apiKeys_queries;
  "chat/internals": typeof chat_internals;
  "chat/mutations": typeof chat_mutations;
  "chat/queries": typeof chat_queries;
  "documents/actions": typeof documents_actions;
  "documents/internals": typeof documents_internals;
  "documents/mutations": typeof documents_mutations;
  "documents/queries": typeof documents_queries;
  "folders/mutations": typeof folders_mutations;
  "folders/queries": typeof folders_queries;
  "googleDrive/actions": typeof googleDrive_actions;
  "googleDrive/internals": typeof googleDrive_internals;
  "googleDrive/queries": typeof googleDrive_queries;
  http: typeof http;
  "ingestion/chunking": typeof ingestion_chunking;
  "ingestion/embedding": typeof ingestion_embedding;
  "ingestion/metadata": typeof ingestion_metadata;
  "ingestion/parsing": typeof ingestion_parsing;
  "lib/auth": typeof lib_auth;
  "migrations/backfillMemberEmails": typeof migrations_backfillMemberEmails;
  "migrations/backfillMemberEmailsHelper": typeof migrations_backfillMemberEmailsHelper;
  "migrations/backfillOrgs": typeof migrations_backfillOrgs;
  "navigation/internals": typeof navigation_internals;
  "organizations/actions": typeof organizations_actions;
  "organizations/mutations": typeof organizations_mutations;
  "organizations/queries": typeof organizations_queries;
  "search/actions": typeof search_actions;
  "search/internals": typeof search_internals;
  "settings/actions": typeof settings_actions;
  "settings/mutations": typeof settings_mutations;
  "settings/queries": typeof settings_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
