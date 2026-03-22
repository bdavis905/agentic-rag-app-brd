import { useState, useRef, useEffect } from 'react'
import { Zap, FileCheck, MessageSquare, Target, Database, Palette } from 'lucide-react'

export type DeepModeType = null | 'deep' | 'contract_review' | 'creative_strategist' | 'foundation_builder' | 'ad_production'

interface DeepModeSelectorProps {
  mode: DeepModeType
  onModeChange: (mode: DeepModeType) => void
  disabled?: boolean
}

const modes = [
  {
    value: null as DeepModeType,
    label: 'Standard',
    description: 'Normal chat mode',
    icon: MessageSquare,
    color: '',
  },
  {
    value: 'deep' as DeepModeType,
    label: 'Deep Mode',
    description: 'Planning + workspace tools',
    icon: Zap,
    color: 'text-amber-400',
  },
  {
    value: 'contract_review' as DeepModeType,
    label: 'Contract Review',
    description: 'Multi-phase contract analysis',
    icon: FileCheck,
    color: 'text-blue-400',
  },
  {
    value: 'creative_strategist' as DeepModeType,
    label: 'Creative Strategist',
    description: 'Ad strategy, coverage gaps, briefs',
    icon: Target,
    color: 'text-emerald-400',
  },
  {
    value: 'foundation_builder' as DeepModeType,
    label: 'Foundation Builder',
    description: 'Build foundation docs for a client',
    icon: Database,
    color: 'text-purple-400',
  },
  {
    value: 'ad_production' as DeepModeType,
    label: 'Ad Production',
    description: 'Produce ads from briefs',
    icon: Palette,
    color: 'text-rose-400',
  },
]

export function DeepModeSelector({ mode, onModeChange, disabled }: DeepModeSelectorProps) {
  const [showPopover, setShowPopover] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const activeMode = modes.find(m => m.value === mode) ?? modes[0]
  const ActiveIcon = activeMode.icon

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          if (mode) {
            onModeChange(null)
          } else {
            setShowPopover(!showPopover)
          }
        }}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
          mode
            ? mode === 'deep'
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
              : mode === 'creative_strategist'
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
              : mode === 'foundation_builder'
              ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30 hover:bg-purple-500/25'
              : mode === 'ad_production'
              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25'
              : 'bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent'
        } disabled:opacity-50`}
        title={mode ? `${activeMode.label} (click to disable)` : 'Select mode'}
      >
        <ActiveIcon className={`h-3.5 w-3.5 ${activeMode.color}`} />
        {mode && <span>{activeMode.label}</span>}
        {!mode && <span>Mode</span>}
      </button>

      {showPopover && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-background border border-border rounded-xl shadow-xl overflow-hidden animate-fade-in z-50">
          {modes.map((m) => {
            const Icon = m.icon
            return (
              <button
                key={m.value ?? 'standard'}
                onClick={() => {
                  onModeChange(m.value)
                  setShowPopover(false)
                }}
                className={`flex items-start gap-3 w-full px-3.5 py-2.5 text-left hover:bg-muted/30 transition-colors ${
                  mode === m.value ? 'bg-muted/20' : ''
                }`}
              >
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${m.color || 'text-muted-foreground'}`} />
                <div>
                  <p className="text-sm font-medium text-foreground">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
