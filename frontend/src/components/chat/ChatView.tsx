import { useState, useEffect, useRef } from 'react'
import { useQuery } from 'convex/react'
import { useAuth as useClerkAuth } from '@clerk/clerk-react'
import { Send, Square, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendMessage } from '@/lib/api'
import { StepsPanel } from './StepsPanel'
import { SubAgentPanel } from './SubAgentPanel'
import { ThinkingPanel } from './ThinkingPanel'
import { useOrg } from '@/hooks/useOrg'
import { api } from '../../../convex/_generated/api'
import type { ToolCallInfo, SubAgentState } from '@/types'

interface ChatViewProps {
  threadId: string
  initialMessage?: string
}

// Conversation items - everything in one ordered array
type ConversationItem =
  | { type: 'user'; id: string; content: string }
  | { type: 'assistant-text'; id: string; content: string }
  | { type: 'thinking'; id: string; content: string; isStreaming: boolean }
  | { type: 'tools'; id: string; toolCalls: ToolCallInfo[] }
  | { type: 'subagent'; id: string; state: SubAgentState }

// Parsed segment from text with think tags
type ParsedSegment =
  | { type: 'thinking'; content: string; isComplete: boolean }
  | { type: 'text'; content: string }

// Parse text that may contain multiple <think>...</think> blocks anywhere
function parseTextWithThinking(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Look for <think> tag
    const thinkStart = remaining.toLowerCase().indexOf('<think>')

    if (thinkStart === -1) {
      // No more think tags - rest is plain text
      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    // Add any text before the think tag
    if (thinkStart > 0) {
      const beforeText = remaining.slice(0, thinkStart)
      if (beforeText.trim()) {
        segments.push({ type: 'text', content: beforeText })
      }
    }

    // Find the closing </think> tag
    const afterThinkStart = remaining.slice(thinkStart + 7) // after "<think>"
    const thinkEnd = afterThinkStart.toLowerCase().indexOf('</think>')

    if (thinkEnd === -1) {
      // No closing tag yet - thinking is incomplete (still streaming)
      segments.push({
        type: 'thinking',
        content: afterThinkStart,
        isComplete: false
      })
      break
    }

    // Complete thinking block
    const thinkContent = afterThinkStart.slice(0, thinkEnd)
    segments.push({
      type: 'thinking',
      content: thinkContent.trim(),
      isComplete: true
    })

    // Continue parsing after </think>
    remaining = afterThinkStart.slice(thinkEnd + 8) // after "</think>"
  }

  return segments
}

export function ChatView({ threadId, initialMessage }: ChatViewProps) {
  const [conversation, setConversation] = useState<ConversationItem[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initialMessageSentRef = useRef(false)
  const responseIdRef = useRef<string>('')
  const rawTextBufferRef = useRef<string>('')
  const textPhaseRef = useRef<number>(0) // Increments when tool calls happen
  const loadedThreadRef = useRef('')

  const { getToken } = useClerkAuth()
  const { activeOrgId } = useOrg()
  const dbMessages = useQuery(
    api.chat.queries.getMessages,
    activeOrgId ? { orgId: activeOrgId, threadId: threadId as any } : "skip"
  )

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [conversation])

  // Reset state when threadId changes
  useEffect(() => {
    setLoading(true)
    setConversation([])
    setError(null)
    loadedThreadRef.current = ''
    initialMessageSentRef.current = false
  }, [threadId])

  // Initialize conversation from Convex query (one-time per thread)
  useEffect(() => {
    if (dbMessages !== undefined && loadedThreadRef.current !== threadId) {
      loadedThreadRef.current = threadId
      const items: ConversationItem[] = []
      dbMessages.forEach((msg: any) => {
        if (msg.role === 'user') {
          items.push({ type: 'user' as const, id: String(msg._id), content: msg.content })
        } else {
          // For assistant messages, add tool calls first (if any), then parse thinking, then text
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            items.push({ type: 'tools' as const, id: `${msg._id}-tools`, toolCalls: msg.toolCalls })
          }
          // Parse thinking tags from stored content (may have multiple blocks)
          const segments = parseTextWithThinking(msg.content)
          if (segments.length === 0) {
            // No segments (empty content), just add the raw content
            items.push({ type: 'assistant-text' as const, id: String(msg._id), content: msg.content })
          } else {
            segments.forEach((seg, idx) => {
              if (seg.type === 'thinking') {
                items.push({ type: 'thinking' as const, id: `${msg._id}-seg-${idx}`, content: seg.content, isStreaming: false })
              } else {
                items.push({ type: 'assistant-text' as const, id: `${msg._id}-seg-${idx}`, content: seg.content })
              }
            })
          }
        }
      })
      setConversation(items)
      setLoading(false)
    }
  }, [dbMessages, threadId])

  const doSend = async (userMessage: string) => {
    if (!userMessage.trim() || sending) return

    const token = await getToken({ template: "convex" })
    const userMsgId = `user-${Date.now()}`
    responseIdRef.current = `response-${Date.now()}`

    setSending(true)
    setWaiting(true)
    setError(null)

    // Add user message to conversation
    setConversation(prev => [...prev, { type: 'user', id: userMsgId, content: userMessage }])

    abortControllerRef.current = new AbortController()

    rawTextBufferRef.current = ''
    textPhaseRef.current = 0

    try {
      await sendMessage({
        threadId,
        content: userMessage,
        orgId: activeOrgId ?? undefined,
        token,
        onTextDelta: (text) => {
          setWaiting(false)
          rawTextBufferRef.current += text

          const responseId = responseIdRef.current
          const phase = textPhaseRef.current
          const segments = parseTextWithThinking(rawTextBufferRef.current)

          setConversation(prev => {
            // Only remove items from the CURRENT phase (not previous phases)
            const phasePrefix = `${responseId}-phase${phase}-`
            const filtered = prev.filter(item => !item.id.startsWith(phasePrefix))

            // Create conversation items for each segment in this phase
            const newItems: ConversationItem[] = segments.map((seg, idx) => {
              if (seg.type === 'thinking') {
                return {
                  type: 'thinking' as const,
                  id: `${phasePrefix}${idx}`,
                  content: seg.content,
                  isStreaming: !seg.isComplete,
                }
              } else {
                return {
                  type: 'assistant-text' as const,
                  id: `${phasePrefix}${idx}`,
                  content: seg.content,
                }
              }
            })

            return [...filtered, ...newItems]
          })
        },
        onDone: () => {
          setSending(false)
          setWaiting(false)
          abortControllerRef.current = null
        },
        onError: (err) => {
          console.error('Stream error:', err)
          setError(err)
          setSending(false)
          setWaiting(false)
          abortControllerRef.current = null
        },
        onToolCallStart: (toolName, args) => {
          // New phase for text after tool calls - reset buffer
          textPhaseRef.current += 1
          rawTextBufferRef.current = ''

          const toolsId = `${responseIdRef.current}-tools`
          const newToolCall: ToolCallInfo = { tool_name: toolName, arguments: args, status: 'running' }
          setConversation(prev => {
            const lastItem = prev[prev.length - 1]
            if (lastItem?.type === 'tools' && lastItem.id === toolsId) {
              // Add to existing tools item
              return [...prev.slice(0, -1), { ...lastItem, toolCalls: [...lastItem.toolCalls, newToolCall] }]
            } else {
              // Create new tools item
              return [...prev, { type: 'tools', id: toolsId, toolCalls: [newToolCall] }]
            }
          })
        },
        onToolCallComplete: (toolName, resultSummary) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'tools') return item
              const idx = item.toolCalls.findIndex(tc => tc.tool_name === toolName && tc.status === 'running')
              if (idx === -1) return item
              const updated = [...item.toolCalls]
              updated[idx] = { ...updated[idx], status: 'completed', result_summary: resultSummary }
              return { ...item, toolCalls: updated }
            })
          })
        },
        onSubAgentStart: (documentId, filename) => {
          const subagentId = `${responseIdRef.current}-subagent`
          // Mark analyze_document tool as completed
          setConversation(prev => {
            const updated = prev.map(item => {
              if (item.type !== 'tools') return item
              return {
                ...item,
                toolCalls: item.toolCalls.map(tc =>
                  tc.tool_name === 'analyze_document' ? { ...tc, status: 'completed' as const } : tc
                )
              }
            })
            // Add subagent item
            return [...updated, {
              type: 'subagent' as const,
              id: subagentId,
              state: {
                active: true,
                mode: 'analyze' as const,
                documentId,
                filename,
                reasoning: '',
                status: 'running' as const,
              }
            }]
          })
        },
        onSubAgentReasoning: (content) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent') return item
              return { ...item, state: { ...item.state, reasoning: item.state.reasoning + content } }
            })
          })
        },
        onSubAgentComplete: () => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent') return item
              return { ...item, state: { ...item.state, status: 'completed' as const } }
            })
          })
        },
        onSubAgentError: (error) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent') return item
              return {
                ...item,
                state: { ...item.state, status: 'error' as const, reasoning: item.state.reasoning + '\n\nError: ' + error }
              }
            })
          })
        },
        onExplorerStart: (researchQuery) => {
          const subagentId = `${responseIdRef.current}-subagent`
          // Mark explore_knowledge_base tool as completed
          setConversation(prev => {
            const updated = prev.map(item => {
              if (item.type !== 'tools') return item
              return {
                ...item,
                toolCalls: item.toolCalls.map(tc =>
                  tc.tool_name === 'explore_knowledge_base' ? { ...tc, status: 'completed' as const } : tc
                )
              }
            })
            // Add explorer subagent item
            return [...updated, {
              type: 'subagent' as const,
              id: subagentId,
              state: {
                active: true,
                mode: 'explore' as const,
                researchQuery,
                explorerToolCalls: [],
                reasoning: '',
                status: 'running' as const,
              }
            }]
          })
        },
        onExplorerToolCall: (toolName, args, round) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent' || item.state.mode !== 'explore') return item
              const newToolCall = {
                tool_name: toolName,
                arguments: args,
                round,
                status: 'running' as const,
              }
              return {
                ...item,
                state: {
                  ...item.state,
                  explorerToolCalls: [...(item.state.explorerToolCalls || []), newToolCall],
                }
              }
            })
          })
        },
        onExplorerToolResult: (toolName, resultSummary) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent' || item.state.mode !== 'explore') return item
              const toolCalls = [...(item.state.explorerToolCalls || [])]
              // Find the last running tool call with this name and mark complete
              for (let i = toolCalls.length - 1; i >= 0; i--) {
                if (toolCalls[i].tool_name === toolName && toolCalls[i].status === 'running') {
                  toolCalls[i] = { ...toolCalls[i], status: 'completed', result_summary: resultSummary }
                  break
                }
              }
              return {
                ...item,
                state: { ...item.state, explorerToolCalls: toolCalls }
              }
            })
          })
        },
        onExplorerReasoning: (content) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent' || item.state.mode !== 'explore') return item
              return { ...item, state: { ...item.state, reasoning: item.state.reasoning + content } }
            })
          })
        },
        onExplorerComplete: () => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent' || item.state.mode !== 'explore') return item
              return { ...item, state: { ...item.state, status: 'completed' as const } }
            })
          })
        },
        onExplorerError: (error) => {
          setConversation(prev => {
            return prev.map(item => {
              if (item.type !== 'subagent' || item.state.mode !== 'explore') return item
              return {
                ...item,
                state: { ...item.state, status: 'error' as const, reasoning: item.state.reasoning + '\n\nError: ' + error }
              }
            })
          })
        },
        onThreadTitle: () => {
          // Title already updated server-side; ThreadList picks up via reactive query
        },
        signal: abortControllerRef.current.signal,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setSending(false)
        setWaiting(false)
      } else {
        console.error('Failed to send message:', err)
        setError((err as Error).message || 'Failed to send message')
        setSending(false)
        setWaiting(false)
      }
      abortControllerRef.current = null
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || sending) return
    const userMessage = input.trim()
    setInput('')
    await doSend(userMessage)
  }

  useEffect(() => {
    if (!loading && initialMessage && !initialMessageSentRef.current) {
      initialMessageSentRef.current = true
      doSend(initialMessage)
    }
  }, [loading, initialMessage])

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasContent = conversation.length > 0 || waiting || error

  // Empty state - show centered welcome with integrated input
  if (!hasContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center animate-fade-in">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight mb-2">What can I help with?</h1>
          <p className="text-muted-foreground">Start a conversation to explore your documents</p>
        </div>
        <form onSubmit={handleSubmit} className="w-full max-w-xl px-4">
          <div className="relative focus-glow rounded-full">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={sending}
              className="h-12 rounded-full pl-5 pr-12 text-base bg-surface-2 border-border/50 focus:border-primary/50 transition-colors"
            />
            <Button
              type="submit"
              size="icon"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full h-9 w-9 bg-primary hover:bg-primary/90 transition-all duration-200 btn-press"
              disabled={!input.trim() || sending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8">
            <div className="space-y-6">
              {conversation.map((item, index) => {
                if (item.type === 'user') {
                  return (
                    <div key={item.id} className="flex justify-end animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                      <div className="max-w-[85%] rounded-2xl bg-primary/10 border border-primary/20 px-5 py-3 shadow-sm">
                        <p className="whitespace-pre-wrap">{item.content}</p>
                      </div>
                    </div>
                  )
                }
                if (item.type === 'thinking') {
                  return (
                    <ThinkingPanel
                      key={item.id}
                      content={item.content}
                      isStreaming={item.isStreaming}
                    />
                  )
                }
                if (item.type === 'assistant-text') {
                  return (
                    <div key={item.id} className="prose prose-neutral dark:prose-invert max-w-none animate-fade-in">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {item.content}
                      </ReactMarkdown>
                    </div>
                  )
                }
                if (item.type === 'tools') {
                  return <StepsPanel key={item.id} toolCalls={item.toolCalls} />
                }
                if (item.type === 'subagent') {
                  return <SubAgentPanel key={item.id} subAgent={item.state} />
                }
                return null
              })}

              {/* Loading indicator */}
              {waiting && (
                <div className="flex items-center gap-3 text-muted-foreground animate-fade-in">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm">Thinking...</span>
                </div>
              )}

              {/* Error message */}
              {error && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive animate-fade-in">
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
      </div>

      {/* Input area */}
      <div className="border-t border-border/50 bg-surface-1">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <form onSubmit={handleSubmit} className="relative focus-glow rounded-full">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              disabled={sending}
              className="h-12 rounded-full pl-5 pr-24 text-base bg-background border-border/50 focus:border-primary/50 transition-colors"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-1">
              {sending ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="rounded-full h-9 w-9 transition-all duration-200 btn-press"
                  onClick={handleStop}
                  title="Stop generating"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="rounded-full h-9 w-9 bg-primary hover:bg-primary/90 transition-all duration-200 btn-press"
                  disabled={!input.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
