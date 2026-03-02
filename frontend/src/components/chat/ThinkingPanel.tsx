import { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'

interface ThinkingPanelProps {
  content: string
  isStreaming?: boolean
}

export function ThinkingPanel({ content, isStreaming = false }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false)

  if (!content) return null

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden animate-fade-in">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-amber-500/10 transition-colors"
      >
        <div className="p-1 rounded-lg bg-amber-500/15">
          <Brain className="h-4 w-4 text-amber-400" />
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-amber-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-amber-400" />
        )}
        <span className="text-sm font-medium text-amber-300">
          Thought process
        </span>
        {isStreaming && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            thinking...
          </span>
        )}
      </button>

      {/* Thinking body */}
      {expanded && (
        <div className="px-4 pb-4 animate-fade-in">
          <div className="rounded-lg bg-background/50 p-4 max-h-64 overflow-y-auto border border-amber-500/20">
            <pre className="text-sm font-sans whitespace-pre-wrap text-muted-foreground leading-relaxed">
              {content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
