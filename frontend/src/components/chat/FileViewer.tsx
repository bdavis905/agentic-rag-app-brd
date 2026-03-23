import { useState, useEffect, useCallback } from 'react'
import { X, Download, Eye, Code, Copy, Check } from 'lucide-react'
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

/** Human-readable labels for foundation doc types */
const DOC_TYPE_LABELS: Record<string, string> = {
  build_a_buyer: 'Build-A-Buyer Profile',
  pain_matrix: 'Pain Matrix & Core Wound',
  mechanism: 'Unique Mechanism',
  offer_brief: 'Offer Brief',
  copy_blocks: 'Copy Blocks',
  voice_profile: 'Voice Profile',
}

/** Check if a string looks like it contains markdown content */
function looksLikeMarkdown(str: string): boolean {
  if (str.length < 20) return false
  return /^#{1,6}\s/m.test(str) || /\*\*[^*]+\*\*/m.test(str) || /\n[-*]\s/m.test(str) || /\n\d+\.\s/m.test(str)
}

/** Format a JSON key into a readable section title */
function formatKeyTitle(key: string): string {
  if (DOC_TYPE_LABELS[key]) return DOC_TYPE_LABELS[key]
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function FileViewer({ file, threadId, orgId, onClose }: FileViewerProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview')
  const [copied, setCopied] = useState(false)

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

  // Check if JSON contains markdown-rich string values worth rendering
  const jsonHasMarkdown = isJson && (() => {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed !== 'object' || parsed === null) return false
      return Object.values(parsed).some(
        (v) => typeof v === 'string' && looksLikeMarkdown(v)
      )
    } catch {
      return false
    }
  })()

  const hasPreviewMode = isMarkdown || isHtml || jsonHasMarkdown

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = content
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [content])

  /** Render JSON in preview mode — markdown values as rendered sections */
  const renderJsonPreview = () => {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed !== 'object' || parsed === null) {
        return <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">{content}</pre>
      }

      const entries = Object.entries(parsed)
      // Filter to show markdown-rich string values as rendered sections,
      // and collect metadata/non-markdown fields separately
      const markdownEntries: [string, string][] = []
      const metadataEntries: [string, any][] = []

      for (const [key, value] of entries) {
        if (key.endsWith('_source_bot') || key.startsWith('_')) continue
        if (typeof value === 'string' && looksLikeMarkdown(value)) {
          markdownEntries.push([key, value])
        } else {
          metadataEntries.push([key, value])
        }
      }

      return (
        <div className="space-y-8">
          {markdownEntries.map(([key, value]) => (
            <div key={key} className="border-b border-border/30 pb-6 last:border-0">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-foreground">
                  {formatKeyTitle(key)}
                </h2>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(value)
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50 transition-colors"
                  title="Copy this section"
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </button>
              </div>
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
              </div>
            </div>
          ))}
          {metadataEntries.length > 0 && (
            <div className="border-t border-border/30 pt-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Metadata</h3>
              <pre className="text-xs font-mono text-foreground/70 whitespace-pre-wrap">
                {JSON.stringify(Object.fromEntries(metadataEntries), null, 2)}
              </pre>
            </div>
          )}
        </div>
      )
    } catch {
      return <pre className="text-sm font-mono text-foreground/90 whitespace-pre-wrap">{content}</pre>
    }
  }

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
            {hasPreviewMode && (
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
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            </button>
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
          ) : hasPreviewMode && viewMode === 'preview' ? (
            isMarkdown ? (
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            ) : isHtml ? (
              <div className="prose prose-invert prose-sm max-w-none">
                <div dangerouslySetInnerHTML={{ __html: content }} />
              </div>
            ) : jsonHasMarkdown ? (
              renderJsonPreview()
            ) : null
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
