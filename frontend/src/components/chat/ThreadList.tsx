import { useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { MessageSquarePlus, Trash2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../../../convex/_generated/api'
import { useOrg } from '@/hooks/useOrg'
import { cn } from '@/lib/utils'

interface ThreadListProps {
  selectedThreadId: string | null
  onSelectThread: (threadId: string) => void
}

export function ThreadList({ selectedThreadId, onSelectThread }: ThreadListProps) {
  const { activeOrgId } = useOrg()
  const threads = useQuery(
    api.chat.queries.listThreads,
    activeOrgId ? { orgId: activeOrgId } : "skip"
  )
  const createThread = useMutation(api.chat.mutations.createThread)
  const deleteThreadMutation = useMutation(api.chat.mutations.deleteThread)
  const [creating, setCreating] = useState(false)

  const handleCreateThread = async () => {
    if (!activeOrgId) return
    setCreating(true)
    try {
      const newThread = await createThread({ orgId: activeOrgId })
      if (newThread) {
        onSelectThread(String(newThread._id))
      }
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation()
    if (!activeOrgId) return
    try {
      await deleteThreadMutation({ orgId: activeOrgId, threadId: threadId as any })
      if (selectedThreadId === threadId) {
        onSelectThread('')
      }
    } catch (error) {
      console.error('Failed to delete thread:', error)
    }
  }

  if (threads === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          onClick={handleCreateThread}
          disabled={creating || !activeOrgId}
          className="w-full h-10 rounded-xl bg-primary hover:bg-primary/90 transition-all duration-200 btn-press shadow-sm"
        >
          <MessageSquarePlus className="mr-2 h-4 w-4" />
          {creating ? 'Creating...' : 'New Chat'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {threads.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No conversations yet. Start a new chat!
          </div>
        ) : (
          <div className="space-y-0.5">
            {threads.map((thread) => (
              <div
                key={String(thread._id)}
                onClick={() => onSelectThread(String(thread._id))}
                className={cn(
                  "group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors",
                  selectedThreadId === String(thread._id)
                    ? "bg-accent/80 shadow-sm"
                    : "hover:bg-accent/50"
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <MessageSquare className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    selectedThreadId === String(thread._id) ? "text-primary" : "text-muted-foreground"
                  )} />
                  <span className="truncate">{thread.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
                  onClick={(e) => handleDeleteThread(e, String(thread._id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
