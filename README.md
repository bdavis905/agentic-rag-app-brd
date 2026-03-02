# Agentic RAG App

An Agentic RAG system built collaboratively with Claude Code. This project is actively developed and expanded by [The AI Automators](https://www.theaiautomators.com/) and available exclusively to community members.

[![Claude Code RAG Masterclass](./video-thumbnail.png)](https://www.youtube.com/watch?v=xgPWCuqLoek)

[Watch the original masterclass on YouTube](https://www.youtube.com/watch?v=xgPWCuqLoek)

## What This Is

This started as a masterclass teaching how to build RAG systems with AI coding tools. Now it's a production-ready foundation that you can fork, customize, and extend to build exactly what you need.

**This repo is exclusive to AI Automators community members.**

The benefit of AI coding tools like Claude Code and Cursor is that you don't need to wait for us to add features. You can build them yourself. Fork this repo, describe what you want, and let the AI build it for you. We'll teach you how.

## Current Features

- **Chat interface** with threaded conversations, streaming, tool calls, and subagent reasoning
- **Document ingestion** with drag-and-drop upload and real-time processing status
- **Full RAG pipeline**: chunking, embedding, hybrid search, reranking
- **Agentic patterns**: text-to-SQL, web search, subagents with isolated context
- **Multi-format support**: PDF, DOCX, PPTX, XLSX, HTML, Markdown, images
- **Metadata extraction**: LLM-powered structured metadata with filterable retrieval
- **Record management**: Content hashing for deduplication and incremental updates

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React, TypeScript, Tailwind, shadcn/ui, Vite |
| Backend | Convex (functions, file storage, vector search, HTTP actions) |
| Auth | Clerk (JWT-based, integrated with Convex) |
| Doc Processing | pdf-parse, mammoth (PDF, DOCX, TXT, MD) |
| AI Models | OpenAI (embeddings), OpenRouter (chat completions) |
| Hosting | Vercel (frontend) + Convex Cloud (backend) |

## What's Included

This repo gives you a solid foundation with all the core RAG patterns implemented:

- **App Shell** — Auth, chat UI, managed RAG
- **BYO Retrieval + Memory** — Ingestion, pgvector, completions API
- **Record Manager** — Content hashing, deduplication
- **Metadata Extraction** — LLM-extracted metadata, filtered retrieval
- **Multi-Format Support** — PDF, DOCX, HTML, Markdown via Docling
- **Hybrid Search & Reranking** — Keyword + vector, RRF, reranking
- **Additional Tools** — Text-to-SQL, web search fallback
- **Subagents** — Isolated context, document analysis delegation

## Build Your Own

With AI coding tools, you can extend this foundation in any direction:

- Add knowledge graphs or GraphRAG
- Implement advanced chunking strategies
- Build custom tools for your domain
- Add multi-modal support
- Create agent memory and learning
- Integrate with your existing systems

**You're not waiting on us. You're building it yourself.** The community is here to teach you how to leverage these tools effectively and help when you get stuck.



## Getting Started

1. Clone this repo
2. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
3. Open in your IDE (Cursor, VS Code, etc.)
4. Run `claude` in the terminal
5. Use the `/onboard` command to get started

## Docs

- [PRD.md](./PRD.md) — Product requirements and module details
- [CLAUDE.md](./CLAUDE.md) — Context for Claude Code
- [PROGRESS.md](./PROGRESS.md) — Track your build progress

## Community Access

This repo is available exclusively to members of [The AI Automators](https://www.theaiautomators.com/). Join hundreds of builders who are learning to create production-grade AI systems using AI coding tools.

Inside the community, you'll learn how to:
- Direct AI tools to build exactly what you need
- Debug and fix issues when things break
- Architect systems that scale
- Share what you've built and learn from others

Fork it. Break it. Build something amazing.

---

*Last tested: 2026-02-03*
