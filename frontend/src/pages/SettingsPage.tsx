import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useAction } from 'convex/react'
import { UserButton } from '@clerk/clerk-react'
import { Eye, EyeOff, Lock, Settings, Key, Copy, Trash2, Plus, Check, Search, ChevronDown, Loader2, MessageSquare, Type, HardDrive, Unplug, Users, UserMinus, Crown, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useAuth } from '@/hooks/useAuth'
import { useOrg } from '@/hooks/useOrg'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { api } from '../../convex/_generated/api'
import logo from '/logo-brd.jpg'

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  name,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  name?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

interface ModelOption {
  id: string
  name: string
  contextLength: number
  promptPricing: string
  completionPricing: string
}

function ModelSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const fetchModels = useAction(api.settings.actions.fetchModels)
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadModels = useCallback(async () => {
    if (fetched || loading) return
    setLoading(true)
    try {
      const result = await fetchModels({})
      setModels(result.models)
      if (result.models.length === 0) {
        setManualMode(true)
      }
    } catch {
      setManualMode(true)
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [fetchModels, fetched, loading])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }, [open])

  if (manualMode) {
    return (
      <div className="space-y-2">
        <Input
          name="llm-model"
          autoComplete="off"
          placeholder="e.g., gpt-4o, anthropic/claude-3.5-sonnet"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {models.length > 0 && (
          <button
            type="button"
            onClick={() => setManualMode(false)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Browse models
          </button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border/50 bg-card text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading models...
      </div>
    )
  }

  const selectedModel = models.find((m) => m.id === value)
  const filtered = search
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase()),
      )
    : models

  function formatContext(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
    return n.toString()
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between h-9 px-3 rounded-md border border-border/50 bg-card text-sm text-foreground hover:bg-accent/30 transition-colors"
          >
            <span className={selectedModel ? '' : 'text-muted-foreground'}>
              {selectedModel ? selectedModel.name : value || 'Select a model...'}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          sideOffset={4}
        >
          <div className="p-2 border-b border-border/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                No models found
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    m.id === value
                      ? 'bg-accent/50 text-foreground'
                      : 'text-foreground hover:bg-accent/30'
                  }`}
                >
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {m.id}
                    {m.contextLength > 0 && (
                      <span className="ml-2">{formatContext(m.contextLength)} ctx</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={() => setManualMode(true)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Type className="h-3 w-3 inline mr-1" />
        Type manually
      </button>
    </div>
  )
}

function MembersSection({ orgId }: { orgId: string }) {
  const { orgs, activeOrgName } = useOrg()
  const members = useQuery(api.organizations.queries.getMembers, { orgId: orgId as any })
  const pendingInvites = useQuery(api.organizations.queries.getPendingInvites, { orgId: orgId as any })
  const inviteByEmail = useAction(api.organizations.actions.inviteByEmail)
  const updateMemberRole = useMutation(api.organizations.mutations.updateMemberRole)
  const removeMember = useMutation(api.organizations.mutations.removeMember)
  const cancelInvite = useMutation(api.organizations.mutations.cancelPendingInvite)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set([orgId]))
  const [inviting, setInviting] = useState(false)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null)

  // Current user's role in this org
  const currentOrg = orgs.find((o) => String(o._id) === orgId)
  const myRole = currentOrg?.role ?? 'member'
  const canManage = myRole === 'owner' || myRole === 'admin'

  // Orgs the current user can invite to (owner or admin)
  const manageableOrgs = orgs.filter((o) => o.role === 'owner' || o.role === 'admin')

  // Keep selectedOrgIds in sync when active org changes
  useEffect(() => {
    setSelectedOrgIds(new Set([orgId]))
  }, [orgId])

  function toggleOrg(id: string) {
    setSelectedOrgIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    if (selectedOrgIds.size === manageableOrgs.length) {
      setSelectedOrgIds(new Set())
    } else {
      setSelectedOrgIds(new Set(manageableOrgs.map((o) => String(o._id))))
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || selectedOrgIds.size === 0) return
    setInviting(true)
    setMemberError(null)
    setMemberSuccess(null)

    const email = inviteEmail.trim()
    const orgIds = [...selectedOrgIds]
    const results: string[] = []
    const errors: string[] = []

    for (const oid of orgIds) {
      try {
        const result = await inviteByEmail({ orgId: oid as any, email, role: inviteRole })
        const orgName = orgs.find((o) => String(o._id) === oid)?.name ?? oid
        if (result.status === 'already_member') {
          results.push(`Already in ${orgName}`)
        } else if (result.status === 'already_invited') {
          results.push(`Already invited to ${orgName}`)
        } else if (result.status === 'added') {
          results.push(`Added to ${orgName}`)
        } else {
          results.push(`Invite sent (${orgName})`)
        }
      } catch (err) {
        const orgName = orgs.find((o) => String(o._id) === oid)?.name ?? oid
        const msg = err instanceof Error ? err.message : 'Failed'
        errors.push(`${orgName}: ${msg}`)
      }
    }

    if (results.length > 0) {
      setMemberSuccess(`${email}: ${results.join(', ')}`)
      setTimeout(() => setMemberSuccess(null), 5000)
    }
    if (errors.length > 0) {
      setMemberError(errors.join('; '))
    }

    setInviteEmail('')
    setInviteRole('member')
    setSelectedOrgIds(new Set([orgId]))

    setInviting(false)
  }

  async function handleRoleChange(userId: string, newRole: 'admin' | 'member') {
    setMemberError(null)
    try {
      await updateMemberRole({ orgId: orgId as any, userId, role: newRole })
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  async function handleRemove(userId: string) {
    setMemberError(null)
    try {
      await removeMember({ orgId: orgId as any, userId })
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to remove member')
    }
  }

  async function handleCancelInvite(inviteId: string) {
    setMemberError(null)
    try {
      await cancelInvite({ inviteId: inviteId as any })
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : 'Failed to cancel invite')
    }
  }

  function roleBadge(role: string) {
    if (role === 'owner') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-medium text-amber-400">
          <Crown className="h-3 w-3" />
          Owner
        </span>
      )
    }
    if (role === 'admin') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-xs font-medium text-blue-400">
          <Shield className="h-3 w-3" />
          Admin
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 border border-border/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Member
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">
          Members
          {activeOrgName && (
            <span className="text-muted-foreground font-normal"> — {activeOrgName}</span>
          )}
        </h3>
      </div>
      <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
        {memberError && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive animate-fade-in">
            {memberError}
          </div>
        )}
        {memberSuccess && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-400 animate-fade-in">
            {memberSuccess}
          </div>
        )}

        {/* Member list */}
        {members === undefined ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Loading members...</span>
          </div>
        ) : members.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 text-center py-2">No members found.</p>
        ) : (
          <div className="space-y-2">
            {members.map((member: any) => (
              <div
                key={member._id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50 border border-border/30"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0 space-y-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {member.email || member.userId}
                    </div>
                    {member.orgs && member.orgs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {member.orgs.map((o: any) => (
                          <span
                            key={o.orgId}
                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              o.orgId === orgId
                                ? 'bg-primary/15 text-primary border border-primary/30'
                                : 'bg-muted/50 text-muted-foreground border border-border/30'
                            }`}
                          >
                            {o.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && member.role !== 'owner' ? (
                    <select
                      value={member.role}
                      onChange={(e) => handleRoleChange(member.userId, e.target.value as 'admin' | 'member')}
                      className="h-7 rounded-md border border-border/50 bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    roleBadge(member.role)
                  )}
                  {canManage && member.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => handleRemove(member.userId)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove member"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pending invites */}
        {pendingInvites && pendingInvites.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-border/30">
            <p className="text-xs font-medium text-muted-foreground">Pending Invites</p>
            {pendingInvites.map((invite: any) => (
              <div
                key={invite._id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50 border border-dashed border-border/40"
              >
                <div className="min-w-0">
                  <div className="text-sm text-muted-foreground truncate">{invite.email}</div>
                  <div className="text-xs text-muted-foreground/60">
                    Invited as {invite.role} · {new Date(invite.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="inline-flex items-center rounded-full bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 text-xs font-medium text-violet-400">
                    Pending
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleCancelInvite(invite._id)}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Cancel invite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invite form — only for owners/admins */}
        {canManage && (
          <div className="pt-3 border-t border-border/30 space-y-3">
            <p className="text-xs text-muted-foreground">
              Invite by email — if they don't have an account yet, they'll receive a signup email.
            </p>
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Email Address</label>
                  <Input
                    name="invite-email"
                    type="email"
                    autoComplete="off"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                    disabled={inviting}
                  />
                </div>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                  className="h-9 rounded-md border border-border/50 bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  disabled={inviting}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {/* Org selection */}
              {manageableOrgs.length > 1 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Add to Organizations</label>
                  <div className="rounded-lg border border-border/30 bg-background/50 p-2 space-y-1">
                    <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedOrgIds.size === manageableOrgs.length}
                        onChange={toggleAll}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                        disabled={inviting}
                      />
                      <span className="text-xs font-medium text-foreground">All organizations</span>
                    </label>
                    <div className="border-t border-border/20 my-1" />
                    {manageableOrgs.map((org) => (
                      <label
                        key={String(org._id)}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrgIds.has(String(org._id))}
                          onChange={() => toggleOrg(String(org._id))}
                          className="h-3.5 w-3.5 rounded border-border accent-primary"
                          disabled={inviting}
                        />
                        <span className="text-xs text-foreground">{org.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Button
                type="button"
                onClick={handleInvite}
                disabled={inviting || !inviteEmail.trim() || selectedOrgIds.size === 0}
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" />
                {inviting ? 'Inviting...' : selectedOrgIds.size > 1 ? `Invite to ${selectedOrgIds.size} orgs` : 'Invite'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const { activeOrgId, activeOrgName, orgs, switchOrg } = useOrg()
  const navigate = useNavigate()

  const settings = useQuery(api.settings.queries.get, activeOrgId ? { orgId: activeOrgId } : "skip")
  const hasChunks = useQuery(api.settings.queries.hasChunks, activeOrgId ? { orgId: activeOrgId } : "skip")
  const updateSettings = useMutation(api.settings.mutations.update)

  // Google Drive
  const driveStatus = useQuery(api.googleDrive.queries.getConnectionStatus)
  const exchangeDriveCode = useAction(api.googleDrive.actions.exchangeCode)
  const disconnectDrive = useAction(api.googleDrive.actions.disconnect)
  const [driveConnecting, setDriveConnecting] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)

  const handleConnectDrive = useCallback(() => {
    const clientId = driveStatus?.clientId
    const redirectUri = driveStatus?.redirectUri
    if (!clientId || !redirectUri) {
      setDriveError('Google Drive is not configured yet. Contact your admin to set up the Google OAuth credentials.')
      return
    }

    const scope = 'https://www.googleapis.com/auth/drive.readonly'
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`

    const popup = window.open(authUrl, 'google-drive-auth', 'width=500,height=700')
    if (!popup) {
      setDriveError('Popup blocked. Please allow popups for this site.')
      return
    }

    setDriveConnecting(true)
    setDriveError(null)

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'google-drive-callback') return

      window.removeEventListener('message', handleMessage)

      if (event.data.error) {
        setDriveError(event.data.error)
        setDriveConnecting(false)
        return
      }

      try {
        await exchangeDriveCode({ code: event.data.code })
      } catch (err) {
        setDriveError(err instanceof Error ? err.message : 'Failed to connect')
      } finally {
        setDriveConnecting(false)
      }
    }

    window.addEventListener('message', handleMessage)

    // Clean up if popup closed without completing
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed)
        window.removeEventListener('message', handleMessage)
        setDriveConnecting(false)
      }
    }, 500)
  }, [exchangeDriveCode, driveStatus])

  const handleDisconnectDrive = useCallback(async () => {
    try {
      await disconnectDrive({})
      setDriveError(null)
    } catch (err) {
      setDriveError(err instanceof Error ? err.message : 'Failed to disconnect')
    }
  }, [disconnectDrive])

  // API Keys
  const apiKeys = useQuery(api.apiKeys.queries.list, activeOrgId ? { orgId: activeOrgId } : "skip")
  const createApiKey = useAction(api.apiKeys.mutations.create)
  const removeApiKey = useAction(api.apiKeys.mutations.remove)

  const [newKeyName, setNewKeyName] = useState('')
  const [creatingKey, setCreatingKey] = useState(false)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chat Assistant fields
  const [chatSystemPrompt, setChatSystemPrompt] = useState('')

  // LLM fields
  const [llmModel, setLlmModel] = useState('')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')

  // Embedding fields
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('')
  const [embeddingApiKey, setEmbeddingApiKey] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState('')

  // Rerank fields
  const [rerankModel, setRerankModel] = useState('')
  const [rerankBaseUrl, setRerankBaseUrl] = useState('')
  const [rerankApiKey, setRerankApiKey] = useState('')
  const [rerankTopN, setRerankTopN] = useState('')

  // Web search fields
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [webSearchProvider, setWebSearchProvider] = useState('')
  const [webSearchApiKey, setWebSearchApiKey] = useState('')


  const embeddingLocked = hasChunks === true

  // Sync form state when settings load
  useEffect(() => {
    if (settings) {
      setChatSystemPrompt(settings.chatSystemPrompt ?? '')
      setLlmModel(settings.llmModel ?? '')
      setLlmBaseUrl(settings.llmBaseUrl ?? '')
      setLlmApiKey(settings.llmApiKey ?? '')
      setEmbeddingModel(settings.embeddingModel ?? '')
      setEmbeddingBaseUrl(settings.embeddingBaseUrl ?? '')
      setEmbeddingApiKey(settings.embeddingApiKey ?? '')
      setEmbeddingDimensions(settings.embeddingDimensions?.toString() ?? '')
      setRerankModel(settings.rerankModel ?? '')
      setRerankBaseUrl(settings.rerankBaseUrl ?? '')
      setRerankApiKey(settings.rerankApiKey ?? '')
      setRerankTopN(settings.rerankTopN?.toString() ?? '')
      setWebSearchEnabled(settings.webSearchEnabled ?? false)
      setWebSearchProvider(settings.webSearchProvider ?? '')
      setWebSearchApiKey(settings.webSearchApiKey ?? '')
    }
  }, [settings])

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate('/')
    }
  }, [authLoading, isAdmin, navigate])

  async function handleSave() {
    if (!activeOrgId) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await updateSettings({
        orgId: activeOrgId,
        chatSystemPrompt: chatSystemPrompt || undefined,
        llmModel: llmModel || undefined,
        llmBaseUrl: llmBaseUrl || undefined,
        llmApiKey: llmApiKey || undefined,
        embeddingModel: embeddingModel || undefined,
        embeddingBaseUrl: embeddingBaseUrl || undefined,
        embeddingApiKey: embeddingApiKey || undefined,
        embeddingDimensions: embeddingDimensions ? parseInt(embeddingDimensions, 10) : undefined,
        rerankModel: rerankModel || undefined,
        rerankBaseUrl: rerankBaseUrl || undefined,
        rerankApiKey: rerankApiKey || undefined,
        rerankTopN: rerankTopN ? parseInt(rerankTopN, 10) : undefined,
        webSearchEnabled,
        webSearchProvider: webSearchProvider || undefined,
        webSearchApiKey: webSearchApiKey || undefined,
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateKey() {
    if (!newKeyName.trim() || !activeOrgId) return
    setCreatingKey(true)
    setKeyError(null)
    setNewRawKey(null)
    try {
      const result = await createApiKey({ orgId: activeOrgId, name: newKeyName.trim() })
      setNewRawKey(result.rawKey)
      setNewKeyName('')
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to create key')
    } finally {
      setCreatingKey(false)
    }
  }

  async function handleRevokeKey(keyId: any) {
    if (!activeOrgId) return
    try {
      await removeApiKey({ orgId: activeOrgId, keyId })
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to revoke key')
    }
  }

  function handleCopyKey() {
    if (newRawKey) {
      navigator.clipboard.writeText(newRawKey)
      setKeyCopied(true)
      setTimeout(() => setKeyCopied(false), 2000)
    }
  }

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isAdmin) return null

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-border/50 bg-surface-1">
        <div className="border-b border-border/50 p-4">
          <img src={logo} alt="Genesis" className="h-24" />
        </div>

        {/* Org Switcher */}
        <OrgSwitcher />

        {/* Navigation Tabs */}
        <nav className="border-b border-border/50 p-2">
          <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
            <button
              onClick={() => navigate('/')}
              className="flex-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all duration-200"
            >
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

        <div className="flex-1" />
        <div className="border-t border-border/50 p-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <UserButton afterSignOutUrl="/" />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => navigate('/settings')}
                className="p-2 rounded-lg bg-accent/50 transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4 text-foreground" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto bg-background">
        <div className="max-w-xl mx-auto p-8 animate-fade-in">
          <h1 className="text-2xl font-semibold tracking-tight mb-6">Settings</h1>

          {/* Org context banner */}
          {activeOrgName && (
            <div className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Editing settings for</span>
                {orgs.length > 1 ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors">
                        {activeOrgName}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-48 p-1">
                      {orgs.map((org) => (
                        <button
                          key={String(org._id)}
                          onClick={() => switchOrg(org._id)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                            String(org._id) === activeOrgId
                              ? 'bg-accent text-foreground font-medium'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                          }`}
                        >
                          {org.name}
                          {String(org._id) === activeOrgId && (
                            <Check className="inline ml-2 h-3.5 w-3.5" />
                          )}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="font-semibold text-foreground">{activeOrgName}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Each organization has its own configuration, system prompt, and knowledge base.
              </p>
            </div>
          )}

          {settings === undefined ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-sm text-muted-foreground">Loading settings...</div>
            </div>
          ) : (
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()} className="space-y-8">
              {success && (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm text-emerald-400 animate-fade-in">
                  Settings saved successfully.
                </div>
              )}
              {error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive animate-fade-in">
                  {error}
                </div>
              )}

              {/* ─── Chat Assistant ─── */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-foreground">
                    Chat Assistant
                    {activeOrgName && (
                      <span className="text-muted-foreground font-normal"> — {activeOrgName}</span>
                    )}
                  </h3>
                </div>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">System Prompt</label>
                    <textarea
                      name="chat-system-prompt"
                      placeholder={"You are a helpful assistant powered by Genesis.\nYou have access to multiple tools to help answer questions."}
                      value={chatSystemPrompt}
                      onChange={(e) => setChatSystemPrompt(e.target.value)}
                      rows={4}
                      className="flex w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y min-h-[80px]"
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Customize how the assistant introduces itself and interacts with users. Tool and retrieval instructions are added automatically.
                      </p>
                      <span className="text-xs text-muted-foreground/60 shrink-0 ml-2">
                        {chatSystemPrompt.length.toLocaleString()} chars
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ─── LLM Configuration ─── */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">LLM Configuration</h3>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                    <ModelSelector value={llmModel} onChange={setLlmModel} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Base URL</label>
                    <Input
                      name="llm-base-url"
                      autoComplete="off"
                      placeholder="e.g., https://openrouter.ai/api/v1"
                      value={llmBaseUrl}
                      onChange={(e) => setLlmBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <PasswordInput
                      name="llm-api-key"
                      placeholder="sk-..."
                      value={llmApiKey}
                      onChange={setLlmApiKey}
                    />
                  </div>
                </div>
              </div>

              {/* ─── Embedding Configuration ─── */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">Embedding Configuration</h3>
                  {embeddingLocked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-medium text-amber-400">
                      <Lock className="h-3 w-3" />
                      Locked
                    </span>
                  )}
                </div>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  {embeddingLocked && (
                    <p className="text-xs text-amber-400/80">
                      Embedding settings are locked because documents have been processed. Delete all documents to change these settings.
                    </p>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Model Name</label>
                    <Input
                      name="embedding-model"
                      autoComplete="off"
                      placeholder="e.g., text-embedding-3-small"
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      disabled={embeddingLocked}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Base URL</label>
                    <Input
                      name="embedding-base-url"
                      autoComplete="off"
                      placeholder="e.g., https://api.openai.com/v1"
                      value={embeddingBaseUrl}
                      onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
                      disabled={embeddingLocked}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <PasswordInput
                      name="embedding-api-key"
                      placeholder="sk-..."
                      value={embeddingApiKey}
                      onChange={setEmbeddingApiKey}
                      disabled={embeddingLocked}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Dimensions</label>
                    <Input
                      name="embedding-dimensions"
                      type="number"
                      autoComplete="off"
                      placeholder="e.g., 1536"
                      value={embeddingDimensions}
                      onChange={(e) => setEmbeddingDimensions(e.target.value)}
                      disabled={embeddingLocked}
                    />
                  </div>
                </div>
              </div>

              {/* ─── Reranking Configuration ─── */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Reranking <span className="text-muted-foreground font-normal">(Optional)</span></h3>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Model Name</label>
                    <Input
                      name="rerank-model"
                      autoComplete="off"
                      placeholder="e.g., rerank-v3.5"
                      value={rerankModel}
                      onChange={(e) => setRerankModel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Base URL</label>
                    <Input
                      name="rerank-base-url"
                      autoComplete="off"
                      placeholder="e.g., https://api.cohere.com/v2"
                      value={rerankBaseUrl}
                      onChange={(e) => setRerankBaseUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <PasswordInput
                      name="rerank-api-key"
                      placeholder="API key for reranking service"
                      value={rerankApiKey}
                      onChange={setRerankApiKey}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Top N Results</label>
                    <Input
                      name="rerank-topn"
                      type="number"
                      autoComplete="off"
                      placeholder="e.g., 5"
                      value={rerankTopN}
                      onChange={(e) => setRerankTopN(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* ─── Web Search Configuration ─── */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">Web Search <span className="text-muted-foreground font-normal">(Optional)</span></h3>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  <div className="flex items-center gap-3">
                    <input
                      id="web-search-enabled"
                      type="checkbox"
                      checked={webSearchEnabled}
                      onChange={(e) => setWebSearchEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <label htmlFor="web-search-enabled" className="text-sm text-foreground">
                      Enable Web Search
                    </label>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Provider</label>
                    <Input
                      name="web-search-provider"
                      autoComplete="off"
                      placeholder="e.g., Tavily"
                      value={webSearchProvider}
                      onChange={(e) => setWebSearchProvider(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">API Key</label>
                    <PasswordInput
                      name="web-search-api-key"
                      placeholder="tvly-..."
                      value={webSearchApiKey}
                      onChange={setWebSearchApiKey}
                    />
                  </div>
                </div>
              </div>

              {/* ─── Google Drive ─── */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-foreground">Google Drive</h3>
                </div>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  {driveError && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive animate-fade-in">
                      {driveError}
                    </div>
                  )}
                  {driveStatus?.connected ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                          <Check className="h-4 w-4 text-emerald-400" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">Google Drive connected</div>
                          {driveStatus.email && (
                            <div className="text-xs text-muted-foreground">{driveStatus.email}</div>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleDisconnectDrive}
                        className="text-destructive hover:text-destructive text-xs h-7"
                      >
                        <Unplug className="h-3 w-3 mr-1" />
                        Disconnect
                      </Button>
                    </div>
                  ) : driveStatus?.configured ? (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Connect your Google Drive to import documents directly. Read-only access — we'll never modify your files.
                      </p>
                      <Button
                        type="button"
                        onClick={handleConnectDrive}
                        disabled={driveConnecting}
                        size="sm"
                      >
                        <HardDrive className="h-3.5 w-3.5 mr-1.5" />
                        {driveConnecting ? 'Connecting...' : 'Connect Google Drive'}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Google Drive integration is not configured. The deployment admin needs to set <code className="text-[11px] bg-muted/50 px-1 py-0.5 rounded">GOOGLE_CLIENT_ID</code>, <code className="text-[11px] bg-muted/50 px-1 py-0.5 rounded">GOOGLE_CLIENT_SECRET</code>, and <code className="text-[11px] bg-muted/50 px-1 py-0.5 rounded">GOOGLE_REDIRECT_URI</code> as Convex environment variables.
                    </p>
                  )}
                </div>
              </div>

              {/* ─── Members ─── */}
              {activeOrgId && <MembersSection orgId={activeOrgId} />}

              {/* ─── External API Keys ─── */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-foreground">External API Keys</h3>
                </div>
                <div className="space-y-4 p-4 rounded-xl border border-border/50 bg-card">
                  <p className="text-xs text-muted-foreground">
                    Generate API keys to allow external applications to query your knowledge base. Keys use Bearer token authentication.
                  </p>

                  {/* New key reveal */}
                  {newRawKey && (
                    <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-4 space-y-2 animate-fade-in">
                      <p className="text-xs font-medium text-amber-400">
                        Copy this key now — it won't be shown again.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono bg-background/50 px-3 py-2 rounded border border-border/50 text-foreground break-all">
                          {newRawKey}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyKey}
                          className="p-2 rounded-lg hover:bg-accent/50 transition-colors shrink-0"
                          title="Copy to clipboard"
                        >
                          {keyCopied ? (
                            <Check className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <Copy className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setNewRawKey(null)}
                        className="text-xs"
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}

                  {keyError && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3 text-xs text-destructive animate-fade-in">
                      {keyError}
                    </div>
                  )}

                  {/* Create new key */}
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Key Name</label>
                      <Input
                        name="api-key-name"
                        autoComplete="off"
                        placeholder="e.g., Student Portal, Development"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
                        disabled={creatingKey}
                      />
                    </div>
                    <Button
                      type="button"
                      onClick={handleCreateKey}
                      disabled={creatingKey || !newKeyName.trim()}
                      size="sm"
                      className="shrink-0"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {creatingKey ? 'Creating...' : 'Create Key'}
                    </Button>
                  </div>

                  {/* Existing keys */}
                  {apiKeys && apiKeys.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border/30">
                      {apiKeys.map((key: { _id: string; name: string; createdAt: number; lastUsedAt?: number }) => (
                        <div
                          key={key._id}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/50 border border-border/30"
                        >
                          <div className="space-y-0.5">
                            <div className="text-sm font-medium text-foreground">{key.name}</div>
                            <div className="text-xs text-muted-foreground">
                              Created {new Date(key.createdAt).toLocaleDateString()}
                              {key.lastUsedAt && (
                                <> · Last used {new Date(key.lastUsedAt).toLocaleDateString()}</>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRevokeKey(key._id)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Revoke key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {apiKeys && apiKeys.length === 0 && !newRawKey && (
                    <p className="text-xs text-muted-foreground/60 text-center py-2">
                      No API keys yet. Create one to get started.
                    </p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="ghost" onClick={() => navigate(-1)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
