import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, Database, Globe, FileSearch, Loader2, Check, Circle, Code } from 'lucide-react'
import type { ToolCallInfo } from '@/types'

interface StepsPanelProps {
  toolCalls: ToolCallInfo[]
}

const toolIcons: Record<string, typeof Search> = {
  search_documents: Search,
  analyze_document: FileSearch,
  query_sales_database: Database,
  web_search: Globe,
  execute_code: Code,
}

const toolLabels: Record<string, string> = {
  search_documents: 'Document Search',
  analyze_document: 'Analyze Document',
  query_sales_database: 'SQL Query',
  web_search: 'Web Search',
  execute_code: 'Code Execution',
}

function getQueryFromArgs(toolName: string, args: string): string {
  try {
    const parsed = JSON.parse(args)
    if (toolName === 'search_documents' || toolName === 'web_search') {
      return parsed.query || args
    }
    if (toolName === 'query_sales_database') {
      // Show a truncated SQL query
      const sql = parsed.sql || ''
      return sql.length > 60 ? sql.substring(0, 57) + '...' : sql
    }
    if (toolName === 'analyze_document') {
      return parsed.query || 'Analyzing document'
    }
    if (toolName === 'execute_code') {
      const code = parsed.code || ''
      return code.length > 60 ? code.substring(0, 57) + '...' : code || 'Running Python code'
    }
    return args
  } catch {
    return args
  }
}

export function StepsPanel({ toolCalls }: StepsPanelProps) {
  const [expanded, setExpanded] = useState(true)

  if (toolCalls.length === 0) return null

  const allCompleted = toolCalls.every(tc => tc.status === 'completed')
  const hasRunning = toolCalls.some(tc => tc.status === 'running')

  return (
    <div className="border border-border/50 rounded-xl bg-surface-2/50 overflow-hidden animate-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <span className="font-medium">{expanded ? 'Hide steps' : 'Show steps'}</span>
        {hasRunning && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-primary" />}
        {allCompleted && !hasRunning && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            {toolCalls.length} step{toolCalls.length !== 1 ? 's' : ''} completed
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {toolCalls.map((tc, idx) => {
            const Icon = toolIcons[tc.tool_name] || Search
            const label = toolLabels[tc.tool_name] || tc.tool_name
            const query = getQueryFromArgs(tc.tool_name, tc.arguments)

            return (
              <div
                key={`${tc.tool_name}-${idx}`}
                className="flex items-start gap-3 text-sm p-2.5 rounded-lg bg-background/50 animate-fade-in"
                style={{ animationDelay: `${idx * 100}ms` }}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="p-1.5 rounded-lg bg-muted/50">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-muted-foreground">{label}</span>
                    <p className="truncate text-foreground/80 text-xs mt-0.5">{query}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {tc.result_summary && tc.status === 'completed' && (
                    <span className="text-xs text-muted-foreground">{tc.result_summary}</span>
                  )}
                  {tc.status === 'running' ? (
                    <div className="w-5 h-5 flex items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    </div>
                  ) : tc.status === 'completed' ? (
                    <div className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-3 w-3 text-emerald-400" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 flex items-center justify-center">
                      <Circle className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
