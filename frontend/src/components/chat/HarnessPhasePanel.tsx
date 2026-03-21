import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Check, AlertCircle, Layers } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HarnessPhaseState } from '@/types'

interface HarnessPhasePanelProps {
  phases: HarnessPhaseState[]
}

export function HarnessPhasePanel({ phases }: HarnessPhasePanelProps) {
  if (phases.length === 0) return null

  const completedCount = phases.filter(p => p.status === 'completed').length
  const hasError = phases.some(p => p.status === 'error')
  const isRunning = phases.some(p => p.status === 'running')

  return (
    <div className="border border-blue-500/30 rounded-xl bg-blue-500/5 overflow-hidden animate-fade-in">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-blue-500/20">
        <Layers className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-blue-300">Harness Workflow</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
          {completedCount}/{phases.length} phases
        </span>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />}
        {hasError && <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
      </div>

      <div className="px-2 py-2 space-y-1">
        {phases.map((phase) => (
          <PhaseItem key={phase.phaseIndex} phase={phase} />
        ))}
      </div>
    </div>
  )
}

function PhaseItem({ phase }: { phase: HarnessPhaseState }) {
  const [expanded, setExpanded] = useState(phase.status === 'running' || phase.status === 'error')

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

        <div className="shrink-0">
          {phase.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
          ) : phase.status === 'completed' ? (
            <div className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-3 w-3 text-emerald-400" />
            </div>
          ) : phase.status === 'error' ? (
            <div className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/15">
              <AlertCircle className="h-3 w-3 text-red-400" />
            </div>
          ) : null}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {phase.phaseDescription && (
            <p className="text-xs text-muted-foreground pl-6">{phase.phaseDescription}</p>
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
          {phase.resultMarkdown && (
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
