import { useState } from 'react'
import { ChevronDown, ChevronRight, FileSearch, FolderSearch, Loader2, Check, AlertCircle } from 'lucide-react'
import type { SubAgentState, ExplorerToolCall } from '@/types'

interface SubAgentPanelProps {
  subAgent: SubAgentState
}

// Strip <think>...</think> tags from sub-agent reasoning for cleaner display
function stripThinkTags(text: string): string {
  // Remove complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
  // Remove incomplete opening <think> tag at the end (still streaming)
  result = result.replace(/<think>[\s\S]*$/gi, '')
  return result.trim()
}

// Human-readable tool name mapping
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  ls: 'Listing folder',
  tree: 'Viewing tree',
  grep: 'Searching content',
  glob: 'Finding files',
  read: 'Reading document',
  analyze_document: 'Analyzing document',
}

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName
}

function ExplorerToolCallItem({ tc }: { tc: ExplorerToolCall }) {
  const displayName = getToolDisplayName(tc.tool_name)
  const isComplete = tc.status === 'completed'

  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      {isComplete ? (
        <Check className="h-3 w-3 text-emerald-400 shrink-0" />
      ) : (
        <Loader2 className="h-3 w-3 animate-spin text-cyan-400 shrink-0" />
      )}
      <span className="text-muted-foreground">
        {displayName}
      </span>
      {isComplete && tc.result_summary && (
        <span className="text-muted-foreground/60">
          - {tc.result_summary}
        </span>
      )}
    </div>
  )
}

export function SubAgentPanel({ subAgent }: SubAgentPanelProps) {
  const [expanded, setExpanded] = useState(true)

  const isExplorer = subAgent.mode === 'explore'

  const statusIcon = {
    running: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
    completed: (
      <div className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="h-3 w-3 text-emerald-400" />
      </div>
    ),
    error: (
      <div className="w-5 h-5 flex items-center justify-center rounded-full bg-red-500/15">
        <AlertCircle className="h-3 w-3 text-red-400" />
      </div>
    ),
  }[subAgent.status]

  // Clean the reasoning by stripping think tags
  const cleanedReasoning = stripThinkTags(subAgent.reasoning || '')

  // Choose colors based on mode
  const borderColor = isExplorer ? 'border-cyan-500/30' : 'border-violet-500/30'
  const bgColor = isExplorer ? 'bg-cyan-500/5' : 'bg-violet-500/5'
  const hoverBg = isExplorer ? 'hover:bg-cyan-500/10' : 'hover:bg-violet-500/10'
  const iconBg = isExplorer ? 'bg-cyan-500/15' : 'bg-violet-500/15'
  const iconColor = isExplorer ? 'text-cyan-400' : 'text-violet-400'
  const titleColor = isExplorer ? 'text-cyan-300' : 'text-violet-300'
  const innerBorder = isExplorer ? 'border-cyan-500/20' : 'border-violet-500/20'

  // Header text
  const headerText = isExplorer
    ? `Exploring: ${subAgent.researchQuery || 'knowledge base'}`
    : `Analyzing: ${subAgent.filename || 'document'}`

  const Icon = isExplorer ? FolderSearch : FileSearch

  const explorerToolCalls = subAgent.explorerToolCalls || []
  const hasToolCalls = explorerToolCalls.length > 0
  const hasReasoning = !!cleanedReasoning

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden animate-fade-in`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2.5 px-4 py-3 ${hoverBg} transition-colors`}
      >
        <div className={`p-1 rounded-lg ${iconBg}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        {expanded ? (
          <ChevronDown className={`h-4 w-4 ${iconColor}`} />
        ) : (
          <ChevronRight className={`h-4 w-4 ${iconColor}`} />
        )}
        <span className={`text-sm font-medium flex-1 text-left ${titleColor} truncate`}>
          {headerText}
        </span>
        {statusIcon}
      </button>

      {/* Body */}
      {expanded && (hasToolCalls || hasReasoning) && (
        <div className="px-4 pb-4 animate-fade-in space-y-3">
          {/* Explorer tool calls */}
          {hasToolCalls && (
            <div className={`rounded-lg bg-background/50 px-3 py-2 border ${innerBorder}`}>
              <div className="space-y-0.5">
                {explorerToolCalls.map((tc, idx) => (
                  <ExplorerToolCallItem key={idx} tc={tc} />
                ))}
              </div>
            </div>
          )}

          {/* Reasoning text */}
          {hasReasoning && (
            <div className={`rounded-lg bg-background/50 p-4 max-h-48 overflow-y-auto border ${innerBorder}`}>
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                {cleanedReasoning}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
