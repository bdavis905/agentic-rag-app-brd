import { Loader2, Check, Circle, ListTodo } from 'lucide-react'
import type { TodoItem } from '@/types'

interface PlanPanelProps {
  todos: TodoItem[]
}

export function PlanPanel({ todos }: PlanPanelProps) {
  if (todos.length === 0) return null

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length

  return (
    <div className="border border-border/50 rounded-xl bg-surface-2/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <ListTodo className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-muted-foreground">Plan</span>
        <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
          {completed}/{total}
        </span>
      </div>

      <div className="px-3 py-2 space-y-1">
        {todos
          .sort((a, b) => a.position - b.position)
          .map((todo, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg text-sm"
            >
              <div className="mt-0.5 shrink-0">
                {todo.status === 'completed' ? (
                  <div className="w-4.5 h-4.5 flex items-center justify-center rounded-full bg-emerald-500/15">
                    <Check className="h-3 w-3 text-emerald-400" />
                  </div>
                ) : todo.status === 'in_progress' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/50" />
                )}
              </div>
              <span
                className={
                  todo.status === 'completed'
                    ? 'text-muted-foreground line-through'
                    : todo.status === 'in_progress'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                }
              >
                {todo.content}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}
