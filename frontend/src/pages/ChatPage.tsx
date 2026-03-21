import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from 'convex/react'
import { UserButton } from '@clerk/clerk-react'
import { Settings } from 'lucide-react'
import { ThreadList } from '@/components/chat/ThreadList'
import { ChatView } from '@/components/chat/ChatView'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { useOrg } from '@/hooks/useOrg'
import { api } from '../../convex/_generated/api'
import logo from '/logo-brd.jpg'

export function ChatPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined)
  const autoCreatedRef = useRef(false)
  const navigate = useNavigate()
  const createThread = useMutation(api.chat.mutations.createThread)
  const { activeOrgId } = useOrg()

  // Auto-create a thread when none is selected so ChatView always renders
  useEffect(() => {
    if (!selectedThreadId && activeOrgId && !autoCreatedRef.current) {
      autoCreatedRef.current = true
      createThread({ orgId: activeOrgId, title: 'New Chat' }).then((newThread) => {
        if (newThread) {
          setSelectedThreadId(String(newThread._id))
        }
        autoCreatedRef.current = false
      }).catch(() => {
        autoCreatedRef.current = false
      })
    }
  }, [selectedThreadId, activeOrgId])

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId)
    setInitialMessage(undefined)
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border/50 bg-surface-1">
        {/* Logo */}
        <div className="border-b border-border/50 p-4">
          <img src={logo} alt="Genesis" className="h-24" />
        </div>

        {/* Org Switcher */}
        <OrgSwitcher />

        {/* Navigation Tabs */}
        <nav className="border-b border-border/50 p-2">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            <button className="flex-1 px-3 py-1.5 rounded-md text-sm font-medium bg-background shadow-sm transition-all duration-200">
              Chat
            </button>
            <button
              onClick={() => navigate('/documents')}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Documents
            </button>
            <button
              onClick={() => navigate('/skills')}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
              Skills
            </button>
          </div>
        </nav>

        {/* Thread List */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ThreadList
            selectedThreadId={selectedThreadId}
            onSelectThread={handleSelectThread}
          />
        </div>

        {/* User Menu */}
        <div className="mt-auto border-t border-border/50 p-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UserButton afterSignOutUrl="/" />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => navigate('/settings')}
                className="p-2 rounded-lg hover:bg-accent/50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 bg-background">
        {selectedThreadId ? (
          <ChatView
            threadId={selectedThreadId}
            initialMessage={initialMessage}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="animate-pulse text-muted-foreground text-sm">Starting new chat...</div>
          </div>
        )}
      </div>
    </div>
  )
}
