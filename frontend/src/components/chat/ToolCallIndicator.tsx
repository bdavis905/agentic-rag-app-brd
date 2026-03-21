import { Search, Database, Globe, FileSearch, Loader2, Check, Code } from 'lucide-react'
import type { ToolCallInfo } from '@/types'

interface ToolCallIndicatorProps {
  toolCall: ToolCallInfo
}

const toolIcons: Record<string, typeof Search> = {
  search_documents: Search,
  analyze_document: FileSearch,
  query_sales_database: Database,
  web_search: Globe,
  execute_code: Code,
}

const toolLabels: Record<string, string> = {
  search_documents: 'Searching documents',
  analyze_document: 'Analyzing document',
  query_sales_database: 'Querying database',
  web_search: 'Searching web',
  execute_code: 'Executing code',
}

export function ToolCallIndicator({ toolCall }: ToolCallIndicatorProps) {
  const Icon = toolIcons[toolCall.tool_name] || Search
  const label = toolLabels[toolCall.tool_name] || toolCall.tool_name

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {toolCall.status === 'running' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : toolCall.status === 'completed' ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : null}
    </div>
  )
}
