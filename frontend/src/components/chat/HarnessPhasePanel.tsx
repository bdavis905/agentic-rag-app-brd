import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2, Check, AlertCircle, Layers, Bot, Search, Clock, XCircle, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HarnessPhaseState } from '@/types'

interface HarnessPhasePanelProps {
  phases: HarnessPhaseState[]
  summary?: string
}

export function HarnessPhasePanel({ phases, summary }: HarnessPhasePanelProps) {
  if (phases.length === 0) return null

  const completedCount = phases.filter(p => p.status === 'completed').length
  const hasError = phases.some(p => p.status === 'error' || p.status === 'cancelled')
  const isRunning = phases.some(p => p.status === 'running')
  const allDone = completedCount === phases.length && !isRunning

  return (
    <div className="border border-blue-500/30 rounded-xl bg-blue-500/5 overflow-hidden animate-fade-in">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-blue-500/20">
        <Layers className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-blue-300">Harness Workflow</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
          {completedCount}/{phases.length} phases
        </span>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />}
        {hasError && !isRunning && <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
        {allDone && <Check className="h-3.5 w-3.5 text-emerald-400" />}
      </div>

      <div className="px-2 py-2 space-y-1">
        {phases.map((phase) => (
          <PhaseItem key={phase.phaseIndex} phase={phase} />
        ))}
      </div>

      {/* Summary rendered at the bottom after all phases complete */}
      {allDone && summary && (
        <div className="border-t border-blue-500/20 px-4 py-4">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseItem({ phase }: { phase: HarnessPhaseState }) {
  const [expanded, setExpanded] = useState(phase.status === 'running' || phase.status === 'error')

  // Auto-expand when phase starts running
  useEffect(() => {
    if (phase.status === 'running') setExpanded(true)
  }, [phase.status])

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-blue-500/10 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-xs font-mono text-blue-400/70">{phase.phaseIndex + 1}</span>
          <span className="text-foreground/90 truncate">{phase.phaseName}</span>
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {phase.status === 'running' && <ElapsedTimer />}
          <StatusIcon status={phase.status} />
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {phase.phaseDescription && (
            <p className="text-xs text-muted-foreground pl-6">{phase.phaseDescription}</p>
          )}

          {/* Streaming text (LLM thinking) */}
          {phase.streamingText && phase.status === 'running' && (
            <div className="pl-6 text-xs text-foreground/70 bg-blue-500/5 rounded-lg px-3 py-2 max-h-24 overflow-y-auto">
              {phase.streamingText.slice(-500)}
            </div>
          )}

          {/* Tool calls */}
          {phase.toolCalls && phase.toolCalls.length > 0 && (
            <div className="pl-6 space-y-1.5">
              {phase.toolCalls.map((tc, idx) => (
                <ToolCallCard key={idx} toolCall={tc} />
              ))}
            </div>
          )}

          {/* Batch progress */}
          {phase.batchProgress && (
            <div className="pl-6">
              <div className="flex items-center gap-2 text-xs text-blue-400">
                <span>
                  {phase.batchProgress.processed}/{phase.batchProgress.total} items processed
                </span>
              </div>
              <div className="w-full bg-blue-500/10 rounded-full h-1.5 mt-1">
                <div
                  className="bg-blue-400 h-1.5 rounded-full transition-all"
                  style={{
                    width: `${phase.batchProgress.total > 0
                      ? (phase.batchProgress.processed / phase.batchProgress.total) * 100
                      : 0}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {phase.error && (
            <div className="pl-6 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              {phase.error}
            </div>
          )}

          {/* Result markdown */}
          {phase.resultMarkdown && phase.status === 'completed' && (
            <div className="pl-6 prose prose-invert prose-xs max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {phase.resultMarkdown}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
    case 'completed':
      return (
        <div className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-500/15">
          <Check className="h-3 w-3 text-emerald-400" />
        </div>
      )
    case 'error':
    case 'failed':
      return (
        <div className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/15">
          <AlertCircle className="h-3 w-3 text-red-400" />
        </div>
      )
    case 'cancelled':
      return (
        <div className="w-5 h-5 flex items-center justify-center rounded-full bg-yellow-500/15">
          <XCircle className="h-3 w-3 text-yellow-400" />
        </div>
      )
    default:
      return null
  }
}

/** Human-readable labels for foundation doc types */
const FOUNDATION_DOC_LABELS: Record<string, string> = {
  'build-a-buyer': 'Build-A-Buyer Profile',
  'pain-matrix': 'Pain Matrix & Core Wound',
  'mechanism': 'Unique Mechanism',
  'offer-brief': 'Offer Brief',
  'copy-blocks': 'Copy Blocks',
  'voice-profile': 'Voice Profile',
}

function ToolCallCard({ toolCall }: { toolCall: any }) {
  const isGenesis = toolCall.toolName === 'call_genesis_bot' || toolCall.tool_name === 'call_genesis_bot'
  const isFoundation = toolCall.toolName === 'foundation_doc' || toolCall.tool_name === 'foundation_doc'
  const toolName = toolCall.toolName || toolCall.tool_name || ''
  const args = toolCall.arguments || ''
  const status = toolCall.status || 'running'
  const resultSummary = toolCall.resultSummary || toolCall.result_summary || ''

  // Parse bot slug or search query from arguments
  let label = toolName
  let query = ''
  try {
    const parsed = JSON.parse(args)
    if (isFoundation) {
      label = 'Foundation Doc'
      const docType = parsed.docType || parsed.doc_type || ''
      query = FOUNDATION_DOC_LABELS[docType] || docType.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    } else if (isGenesis) {
      label = 'Genesis Bot'
      const slug = parsed.bot_slug || ''
      query = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).replace(/\s+$/, '')
    } else if (toolName === 'search_documents') {
      label = 'Document Search'
      query = parsed.query || ''
    } else if (toolName === 'read') {
      label = 'Read Document'
      query = parsed.document_id || ''
    } else {
      query = args.length > 60 ? args.slice(0, 57) + '...' : args
    }
  } catch {
    query = args.length > 60 ? args.slice(0, 57) + '...' : args
  }

  const Icon = isFoundation ? BookOpen : isGenesis ? Bot : Search

  return (
    <div className="flex items-center gap-2.5 text-sm p-2 rounded-lg bg-background/50 border border-border/30">
      <div className="p-1.5 rounded-lg bg-muted/50 shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground/80">{label}</span>
        {query && <p className="text-xs text-muted-foreground truncate capitalize">{query}</p>}
        {status === 'completed' && resultSummary && (
          <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
            {resultSummary.length > 100 ? resultSummary.slice(0, 97) + '...' : resultSummary}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {status === 'running' ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-blue-400">Running</span>
            <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
          </div>
        ) : status === 'completed' ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-emerald-400">Complete</span>
            <Check className="h-3 w-3 text-emerald-400" />
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{status}</span>
        )}
      </div>
    </div>
  )
}

function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="h-3 w-3" />
      <span>{mins}:{secs.toString().padStart(2, '0')}</span>
    </div>
  )
}
