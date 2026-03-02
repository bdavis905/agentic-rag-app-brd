import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from 'convex/react'
import { UserButton } from '@clerk/clerk-react'
import { Send, Settings } from 'lucide-react'
import { ThreadList } from '@/components/chat/ThreadList'
import { ChatView } from '@/components/chat/ChatView'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOrg } from '@/hooks/useOrg'
import { api } from '../../convex/_generated/api'
import logo from '/logo-brd.jpg'

export function ChatPage() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined)
  const [welcomeInput, setWelcomeInput] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const createThread = useMutation(api.chat.mutations.createThread)
  const { activeOrgId } = useOrg()

  const handleSelectThread = (threadId: string) => {
    setSelectedThreadId(threadId)
    setInitialMessage(undefined)
  }

  const handleWelcomeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!welcomeInput.trim() || creating || !activeOrgId) return

    const message = welcomeInput.trim()
    setCreating(true)
    try {
      const title = message.length > 50 ? message.substring(0, 47) + '...' : message
      const newThread = await createThread({ orgId: activeOrgId, title })
      if (newThread) {
        setInitialMessage(message)
        setSelectedThreadId(String(newThread._id))
        setWelcomeInput('')
      }
    } catch (error) {
      console.error('Failed to create thread:', error)
    } finally {
      setCreating(false)
    }
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
          <div className="flex h-full flex-col items-center justify-center animate-fade-in">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-semibold tracking-tight mb-2">What can I help with?</h1>
              <p className="text-muted-foreground">Start a conversation to explore your documents</p>
            </div>
            <form onSubmit={handleWelcomeSubmit} className="w-full max-w-xl px-4">
              <div className="relative focus-glow rounded-full">
                <Input
                  value={welcomeInput}
                  onChange={(e) => setWelcomeInput(e.target.value)}
                  placeholder="Ask anything..."
                  disabled={creating || !activeOrgId}
                  className="h-12 rounded-full pl-5 pr-12 text-base bg-surface-2 border-border/50 focus:border-primary/50 transition-colors"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full h-9 w-9 bg-primary hover:bg-primary/90 transition-all duration-200 btn-press"
                  disabled={!welcomeInput.trim() || creating || !activeOrgId}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
