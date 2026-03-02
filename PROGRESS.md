# Progress

Track your progress through the masterclass. Update this file as you complete modules - Claude Code reads this to understand where you are in the project.

## Convention
- `[ ]` = Not started
- `[-]` = In progress
- `[x]` = Completed

## Modules (Original Stack: Supabase + FastAPI)

### Module 1: App Shell + Observability
- [x] Backend Setup - FastAPI skeleton with health endpoint
- [x] Supabase Client - Backend Supabase client wrapper
- [x] Database Schema - threads and messages tables with RLS
- [x] Auth Middleware - JWT verification and /auth/me endpoint
- [x] Frontend Setup - Vite + React + Tailwind + shadcn/ui
- [x] Frontend Supabase Client
- [x] Auth UI - Sign in/sign up forms
- [x] OpenAI Assistant Service - Responses API integration
- [x] Thread API - CRUD endpoints
- [x] Chat API with SSE - Streaming messages
- [x] Thread List UI
- [x] Chat View UI
- [x] Main App Assembly
- [x] LangSmith Tracing

**Status: COMPLETE (superseded by Convex migration)**

### Module 2: BYO Retrieval + Provider Abstraction
- [x] Phase 1: Provider Abstraction - ChatCompletions API with configurable base_url/api_key
- [x] Phase 2: Database Schema - pgvector extension, documents/chunks tables, RLS, match_chunks function, storage bucket
- [x] Phase 3: Ingestion Pipeline - embedding_service, chunking_service, ingestion_service, documents router
- [x] Phase 4: Retrieval Tool - retrieval_service, tool_executor, RAG_TOOLS definition, tool-calling loop in chat
- [x] Phase 5: Ingestion UI + Realtime - DocumentsPage, DocumentUpload, DocumentList, useRealtimeDocuments hook

**Status: COMPLETE (superseded by Convex migration)**

### Module 3: Record Manager (Deduplication)
**Status: COMPLETE (superseded by Convex migration)**

### Module 4: Metadata Extraction (Dynamic Schema)
**Status: COMPLETE (superseded by Convex migration)**

### Module 5: Multi-Format Document Support (Docling)
**Status: COMPLETE (superseded by Convex migration)**

### Module 6: Hybrid Search & Reranking
**Status: COMPLETE (superseded by Convex migration)**

### Module 7: Additional Tools (Text-to-SQL & Web Search)
**Status: COMPLETE (superseded by Convex migration)**

### Module 8: Sub-Agents (Document Analysis)
**Status: COMPLETE (superseded by Convex migration)**

### Dark Mode
**Status: COMPLETE (carried forward into Convex stack)**

---

## Convex + Clerk Migration

Migrated the entire stack from Supabase + FastAPI (Python) to Convex + Clerk + Vercel.

### Phase 1: Foundation (Convex + Clerk + Project Setup)
- [x] Installed convex and @clerk/clerk-react, removed @supabase/supabase-js
- [x] Created convex/schema.ts with documents, chunks, folders, settings tables
- [x] Created Clerk auth config and ConvexProviderWithClerk
- [x] Rewrote useAuth.ts, App.tsx, main.tsx for Clerk
- [x] Created AuthPage.tsx with Clerk SignIn
- [x] Deleted supabase.ts, useRealtimeDocuments.ts, AuthForm.tsx

**Status: COMPLETE**

### Phase 2: Documents + Folders + File Storage
- [x] Convex document queries/mutations with file upload
- [x] Convex folder queries/mutations with ancestors
- [x] All frontend components rewired to Convex hooks
- [x] Reactive updates (no manual refetch)

**Status: COMPLETE**

### Phase 3: Ingestion Pipeline
- [x] Parsing (PDF via pdf-parse v2, DOCX via mammoth, TXT/MD)
- [x] Recursive character chunking
- [x] OpenAI-compatible embedding with batching
- [x] LLM-based metadata extraction with dynamic schema
- [x] processDocument internalAction orchestrating full pipeline
- [x] Scheduler trigger on document create/re-upload

**Status: COMPLETE**

### Phase 4: Search + Retrieval
- [x] Vector search via ctx.vectorSearch
- [x] Text search via searchIndex
- [x] Hybrid search with RRF fusion
- [x] Cohere-compatible reranking (optional)

**Status: COMPLETE**

### Phase 5: Chat (Streaming, Tools, Sub-Agents)
- [x] HTTP Action SSE endpoint (convex/http.ts)
- [x] 9 tools: search, web_search, analyze_document, explore_knowledge_base, ls, tree, grep, glob, read
- [x] analyze_document sub-agent (deep single-doc analysis)
- [x] explore_knowledge_base sub-agent (multi-round KB exploration)
- [x] Title generation on first message
- [x] Frontend SSE client with all 16 event types
- [x] Reactive thread list, Convex message loading + streaming

**Status: COMPLETE**

### Phase 6: Settings + Polish
- [x] Convex settings queries/mutations (auth-checked, upsert)
- [x] SettingsPage with Convex hooks (model name, rerank top N, web search toggle)
- [x] Clerk UserButton + theme toggle on all pages
- [x] Removed all dead API stubs from api.ts

**Status: COMPLETE**

### Phase 7: Deploy + Cleanup
- [x] Deleted dead UserMenu.tsx
- [x] Updated vite-env.d.ts (Convex + Clerk env vars)
- [x] Rewrote CLAUDE.md for Convex stack
- [x] Updated PROGRESS.md
- [x] Updated README.md
- [x] Cleaned up .gitignore
- [ ] Delete old directories (backend/, supabase/, scripts/) — manual
- [ ] Deploy Convex to production (`npx convex deploy`)
- [ ] Connect to Vercel (GitHub repo + env vars)
- [ ] Final E2E validation on production URL

**Status: IN PROGRESS**

## Service URLs
- **Frontend (dev):** http://localhost:5173
- **Convex Dashboard:** https://dashboard.convex.dev
