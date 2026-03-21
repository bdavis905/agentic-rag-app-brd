import { useState } from 'react'
import { ChevronDown, ChevronRight, Code, Download, Loader2, Check, AlertCircle, Terminal } from 'lucide-react'

export interface CodeExecutionFile {
  name: string
  url: string
  size: number
}

export interface CodeExecutionState {
  status: 'running' | 'completed' | 'error'
  codePreview: string
  stdout?: string
  stderr?: string
  error?: string
  files?: CodeExecutionFile[]
  hasChart?: boolean
  chartPng?: string | null
}

interface CodeExecutionPanelProps {
  execution: CodeExecutionState
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CodeExecutionPanel({ execution }: CodeExecutionPanelProps) {
  const [expanded, setExpanded] = useState(true)

  const isRunning = execution.status === 'running'
  const isError = execution.status === 'error'
  const isComplete = execution.status === 'completed'

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
        <Code className="h-4 w-4" />
        <span className="font-medium">Code Execution</span>
        {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto text-primary" />}
        {isComplete && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            {execution.files && execution.files.length > 0
              ? `${execution.files.length} file${execution.files.length !== 1 ? 's' : ''}`
              : 'Done'}
          </span>
        )}
        {isError && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">
            Failed
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Code preview */}
          <div className="rounded-lg bg-background/80 p-3 font-mono text-xs text-foreground/80 overflow-x-auto max-h-48 overflow-y-auto">
            <pre className="whitespace-pre-wrap">{execution.codePreview}</pre>
          </div>

          {/* Stdout */}
          {execution.stdout && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Terminal className="h-3 w-3" />
                <span>Output</span>
              </div>
              <div className="rounded-lg bg-background/80 p-3 font-mono text-xs text-foreground/70 max-h-40 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{execution.stdout}</pre>
              </div>
            </div>
          )}

          {/* Stderr */}
          {execution.stderr && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertCircle className="h-3 w-3" />
                <span>Stderr</span>
              </div>
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 font-mono text-xs text-amber-300/80 max-h-32 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{execution.stderr}</pre>
              </div>
            </div>
          )}

          {/* Error */}
          {execution.error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 font-mono text-xs text-red-300/80 max-h-40 overflow-y-auto">
              <pre className="whitespace-pre-wrap">{execution.error}</pre>
            </div>
          )}

          {/* Inline chart */}
          {execution.chartPng && (
            <div className="rounded-lg overflow-hidden border border-border/50">
              <img
                src={`data:image/png;base64,${execution.chartPng}`}
                alt="Generated chart"
                className="w-full max-w-lg"
              />
            </div>
          )}

          {/* Generated files */}
          {execution.files && execution.files.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-medium">Generated Files</div>
              {execution.files.map((file, idx) => (
                <a
                  key={idx}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-background/50 hover:bg-muted/30 transition-colors group"
                >
                  <div className="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <Download className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <Check className="h-4 w-4 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              ))}
            </div>
          )}

          {/* Running indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Executing Python code...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
