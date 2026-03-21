import { useRef, useState } from 'react'
import { Paperclip, Loader2, X } from 'lucide-react'

interface FileUploadButtonProps {
  threadId: string | null
  disabled?: boolean
  onUploadComplete?: (file: { filePath: string; contentType: string; sizeBytes: number }) => void
  onError?: (error: string) => void
}

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md,.csv,.json,.html,.xml,.yaml,.yml'

export function FileUploadButton({ threadId, disabled, onUploadComplete, onError }: FileUploadButtonProps) {
  const [uploading, setUploading] = useState(false)
  const [attachedFile, setAttachedFile] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !threadId) return

    setUploading(true)
    try {
      // For now, just track the attachment — the chat handler will write it to workspace.
      setAttachedFile(file.name)
      onUploadComplete?.({
        filePath: file.name,
        contentType: file.type || 'text/plain',
        sizeBytes: file.size,
      })
    } catch (err: any) {
      onError?.(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || !threadId}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
        title="Attach file"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
      </button>

      {attachedFile && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-muted/30 rounded-lg text-xs text-muted-foreground">
          <span className="truncate max-w-[120px]">{attachedFile}</span>
          <button
            onClick={() => setAttachedFile(null)}
            className="hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
