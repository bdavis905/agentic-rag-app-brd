import { FileText, FileCode, File, FolderOpen } from 'lucide-react'
import type { WorkspaceFile } from '@/types'

interface WorkspacePanelProps {
  files: WorkspaceFile[]
  onFileClick?: (file: WorkspaceFile) => void
}

const codeExtensions = new Set(['py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'json', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bash'])
const textExtensions = new Set(['md', 'txt', 'csv', 'log'])

function getFileIcon(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (codeExtensions.has(ext)) return FileCode
  if (textExtensions.has(ext)) return FileText
  return File
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const sourceColors: Record<string, string> = {
  agent: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  user: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  harness: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
}

export function WorkspacePanel({ files, onFileClick }: WorkspacePanelProps) {
  if (files.length === 0) return null

  const sorted = [...files].sort((a, b) => a.filePath.localeCompare(b.filePath))

  return (
    <div className="border border-border/50 rounded-xl bg-surface-2/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <FolderOpen className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium text-muted-foreground">Workspace</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-2 py-2 space-y-0.5 max-h-64 overflow-y-auto">
        {sorted.map((file) => {
          const Icon = getFileIcon(file.filePath)
          const sourceClass = sourceColors[file.source] || sourceColors.agent

          return (
            <button
              key={file.id}
              onClick={() => onFileClick?.(file)}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm hover:bg-muted/30 transition-colors text-left"
            >
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground/90 text-xs font-medium">{file.filePath}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-muted-foreground">{formatSize(file.sizeBytes)}</span>
                  <span className={`text-[10px] px-1.5 py-0 rounded-full border ${sourceClass}`}>
                    {file.source}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
