import { useState, useEffect } from 'react'
import { X, Download, Eye, Code } from 'lucide-react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { WorkspaceFile } from '@/types'
import type { Id } from '../../../convex/_generated/dataModel'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface FileViewerProps {
  file: WorkspaceFile
  threadId: string
  orgId?: string
  onClose: () => void
}

export function FileViewer({ file, threadId, orgId, onClose }: FileViewerProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')

  const fileData = useQuery(api.workspace.queries.getFile, {
    threadId: threadId as Id<'threads'>,
    filePath: file.filePath,
    orgId,
  })

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const content = fileData?.content ?? ''
  const isMarkdown = file.contentType === 'text/markdown' || file.filePath.endsWith('.md')
  const isHtml = file.contentType === 'text/html' || file.filePath.endsWith('.html')
  const isJson = file.contentType === 'application/json' || file.filePath.endsWith('.json')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div className="flex items-center gap-3 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{file.filePath}</h3>
            <span className="text-xs text-muted-foreground shrink-0">{file.contentType}</span>
          </div>
          <div className="flex items-center gap-2">
            {(isMarkdown || isHtml) && (
              <div className="flex rounded-lg border border-border/50 overflow-hidden">
                <button
                  onClick={() => setViewMode('preview')}
                  className={`px-2.5 py-1 text-xs flex items-center gap-1.5 ${viewMode === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
                <button
                  onClick={() => setViewMode('source')}
                  className={`px-2.5 py-1 text-xs flex items-center gap-1.5 ${viewMode === 'source' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Code className="h-3 w-3" />
                  Source
                </button>
              </div>
            )}
            <button
              onClick={() => {
                const blob = new Blob([content], { type: file.contentType })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = file.filePath.split('/').pop() ?? 'file'
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Download"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {!fileData ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Loading...
            </div>
          ) : (isMarkdown || isHtml) && viewMode === 'preview' ? (
            <div className="prose prose-invert prose-sm max-w-none">
              {isMarkdown ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: content }} />
              )}
            </div>
          ) : isJson ? (
            <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">
              {(() => {
                try { return JSON.stringify(JSON.parse(content), null, 2) } catch { return content }
              })()}
            </pre>
          ) : (
            <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">{content}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
