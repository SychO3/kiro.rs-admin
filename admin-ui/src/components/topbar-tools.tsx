import { useEffect, useState } from 'react'
import {
  Activity, Link, RefreshCw, UploadCloud, Settings, Key, Wand2, Eye, EyeOff, Copy,
  MoreHorizontal, ShieldAlert, ShieldCheck, Gauge, Shuffle, MessageSquarePlus,
  SlidersHorizontal, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { storage } from '@/lib/storage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  useLoadBalancingMode, useSetLoadBalancingMode,
  useAccountThrottleConfig, useSetAccountThrottleConfig,
  useAdaptiveRpm, useSetAdaptiveRpm,
  useRetryPolicy, useSetRetryPolicy,
} from '@/hooks/use-credentials'
import { useUpdateCheck } from '@/hooks/use-update-check'
import {
  updateAdminKey, type LoadBalancingMode, LB_LABEL, nextLbMode,
  type RetryMode, type RetryPolicy, type RetryPolicyConfig,
} from '@/api/credentials'
import { extractErrorMessage, generateApiKey } from '@/lib/utils'
import { ImageUpdateDialog } from '@/components/image-update-dialog'
import { ModelMappingsDialog } from '@/components/model-mappings-dialog'
import { SystemPromptDialog } from '@/components/system-prompt-dialog'

/**
 * 顶栏右侧通用工具栏：负载均衡切换、刷新、在线更新、设置（Key 管理）。
 *
 * 与原 Dashboard 中的工具按钮等价，但全局 Tab 都可访问。刷新按钮会失效
 * 凭据/客户端 Key/统计三类查询，覆盖三个 Tab 的主要数据源。
 */
interface TopbarToolsProps {
  compact?: boolean
}

export function TopbarTools({ compact = false }: TopbarToolsProps) {
  const queryClient = useQueryClient()
  const { data: loadBalancingData, isLoading: isLoadingMode } = useLoadBalancingMode()
  const { mutate: setLoadBalancingMode, isPending: isSettingMode } = useSetLoadBalancingMode()
  const { data: throttleConfig, isLoading: isLoadingThrottle } = useAccountThrottleConfig()
  const { mutate: setThrottleConfig, isPending: isSettingThrottle } = useSetAccountThrottleConfig()
  const { data: adaptiveRpm, isLoading: isLoadingAdaptiveRpm } = useAdaptiveRpm()
  const { mutate: setAdaptiveRpmMut, isPending: isSettingAdaptiveRpm } = useSetAdaptiveRpm()
  const { data: retryPolicy, isLoading: isLoadingRetry } = useRetryPolicy()
  const { mutate: setRetryPolicy, isPending: isSettingRetry } = useSetRetryPolicy()
  const { data: updateCheck } = useUpdateCheck()

  const [imageUpdateOpen, setImageUpdateOpen] = useState(false)
  const [modelMappingsOpen, setModelMappingsOpen] = useState(false)
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [showPlain, setShowPlain] = useState(false)
  const [updating, setUpdating] = useState(false)

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['credentials'] })
    queryClient.invalidateQueries({ queryKey: ['client-keys'] })
    queryClient.invalidateQueries({ queryKey: ['stats'] })
    toast.success('已刷新')
  }

  const handleToggleLoadBalancing = () => {
    const cur = (loadBalancingData?.mode ?? 'priority') as LoadBalancingMode
    const next = nextLbMode(cur)
    setLoadBalancingMode({ mode: next }, {
      onSuccess: () => toast.success(`已切换到${LB_LABEL[next]}模式`),
      onError: (err) => toast.error(`切换失败: ${extractErrorMessage(err)}`),
    })
  }

  const handleToggleAffinity = () => {
    const cur = loadBalancingData?.affinityEnabled ?? true
    setLoadBalancingMode({ affinityEnabled: !cur }, {
      onSuccess: () => toast.success(!cur ? '已开启客户端亲和性' : '已关闭客户端亲和性'),
      onError: (err) => toast.error(`切换失败: ${extractErrorMessage(err)}`),
    })
  }

  const handleToggleFailover = () => {
    const cur = throttleConfig?.failover ?? true
    const next = !cur
    setThrottleConfig({ failover: next }, {
      onSuccess: () => toast.success(next ? '已开启账号级风控故障转移' : '已关闭账号级风控故障转移'),
      onError: (err) => toast.error(`切换失败: ${extractErrorMessage(err)}`),
    })
  }

  const handleToggleAdaptiveRpm = () => {
    const cur = adaptiveRpm?.enabled ?? false
    const next = !cur
    setAdaptiveRpmMut(next, {
      onSuccess: () => toast.success(next ? '已开启自适应 RPM' : '已关闭自适应 RPM'),
      onError: (err) => toast.error(`切换失败: ${extractErrorMessage(err)}`),
    })
  }

  const openKeyDialog = () => {
    setNewKey('')
    setShowPlain(false)
    setKeyDialogOpen(true)
  }

  const handleUpdateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    const key = newKey.trim()
    if (!key) {
      toast.error('新登录API密钥不能为空')
      return
    }
    setUpdating(true)
    try {
      await updateAdminKey({ newKey: key })
      storage.setApiKey(key)
      toast.success('登录API密钥已更新，已自动切换到新 Key')
      setKeyDialogOpen(false)
      setNewKey('')
    } catch (err) {
      toast.error(`更新失败: ${extractErrorMessage(err)}`)
    } finally {
      setUpdating(false)
    }
  }

  const controls = {
    affinityEnabled: loadBalancingData?.affinityEnabled ?? true,
    adaptiveRpmEnabled: adaptiveRpm?.enabled ?? false,
    handleRefresh,
    handleToggleAffinity,
    handleToggleAdaptiveRpm,
    handleToggleFailover,
    handleToggleLoadBalancing,
    isLoadingAdaptiveRpm,
    isLoadingMode,
    isLoadingRetry,
    isLoadingThrottle,
    isSettingAdaptiveRpm,
    isSettingMode,
    isSettingRetry,
    isSettingThrottle,
    loadBalancingMode: loadBalancingData?.mode,
    openImageUpdate: () => setImageUpdateOpen(true),
    openModelMappings: () => setModelMappingsOpen(true),
    openSystemPrompt: () => setSystemPromptOpen(true),
    openKeyDialog,
    retryPolicy,
    setRetryPolicy: (mode: RetryMode, customPolicy?: RetryPolicy | null) =>
      setRetryPolicy(
        { mode, customPolicy: mode === 'custom' ? customPolicy ?? DEFAULT_CUSTOM_RETRY_POLICY : null },
        {
          onSuccess: (res) => toast.success(`429 策略已切换到 ${RETRY_MODE_LABELS[res.mode]}`),
          onError: (err) => toast.error(`保存失败: ${extractErrorMessage(err)}`),
        },
      ),
    throttleConfig,
    updateCheck,
    updateCooldown: (secs: number) =>
      setThrottleConfig({ cooldownSecs: secs }, {
        onSuccess: () =>
          toast.success(`冷却时长已设为 ${Math.round(secs / 60)} 分钟`),
        onError: (err) => toast.error(`保存失败: ${extractErrorMessage(err)}`),
      }),
  }

  return (
    <>
      {compact ? <CompactTools controls={controls} /> : <FullTools controls={controls} />}
      <ImageUpdateDialog open={imageUpdateOpen} onOpenChange={setImageUpdateOpen} />
      <ModelMappingsDialog open={modelMappingsOpen} onOpenChange={setModelMappingsOpen} />
      <SystemPromptDialog open={systemPromptOpen} onOpenChange={setSystemPromptOpen} />

      <Dialog
        open={keyDialogOpen}
        onOpenChange={(open) => { if (!updating) setKeyDialogOpen(open) }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              修改登录API密钥
            </DialogTitle>
            <DialogDescription>
              用于登录此管理面板。修改后将自动更新本地存储的 Key，无需重新登录。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateKey} className="space-y-4 py-2">
            <div className="relative">
              <Input
                type={showPlain ? 'text' : 'password'}
                placeholder="输入或生成新的登录API密钥"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                disabled={updating}
                autoFocus
                className="pr-20 font-mono text-[13px]"
              />
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="pointer-events-auto h-7 w-7"
                  onClick={() => setShowPlain((v) => !v)}
                  disabled={updating}
                  title={showPlain ? '隐藏' : '显示'}
                >
                  {showPlain ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="pointer-events-auto h-7 w-7"
                  onClick={async () => {
                    if (!newKey.trim()) {
                      toast.error('请先输入或生成 Key 再复制')
                      return
                    }
                    try {
                      await navigator.clipboard.writeText(newKey)
                      toast.success('已复制到剪贴板')
                    } catch {
                      toast.error('复制失败，请手动选择文本')
                    }
                  }}
                  disabled={updating}
                  title="复制"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const key = generateApiKey('sk-admin-')
                  setNewKey(key)
                  setShowPlain(true)
                }}
                disabled={updating}
              >
                <Wand2 className="h-3.5 w-3.5" />生成随机 Key
              </Button>
              <p className="text-[11px] text-muted-foreground">
                建议生成后立即复制保存，确认更新后即生效。
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setKeyDialogOpen(false)} disabled={updating}>
                取消
              </Button>
              <Button type="submit" disabled={updating || !newKey.trim()}>
                {updating ? '更新中…' : '确认更新'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface ToolControls {
  affinityEnabled: boolean
  adaptiveRpmEnabled: boolean
  handleRefresh: () => void
  handleToggleAffinity: () => void
  handleToggleAdaptiveRpm: () => void
  handleToggleFailover: () => void
  handleToggleLoadBalancing: () => void
  isLoadingAdaptiveRpm: boolean
  isLoadingMode: boolean
  isLoadingRetry: boolean
  isLoadingThrottle: boolean
  isSettingAdaptiveRpm: boolean
  isSettingMode: boolean
  isSettingRetry: boolean
  isSettingThrottle: boolean
  loadBalancingMode?: LoadBalancingMode
  openImageUpdate: () => void
  openModelMappings: () => void
  openSystemPrompt: () => void
  openKeyDialog: () => void
  retryPolicy?: RetryPolicyConfig
  setRetryPolicy: (mode: RetryMode, customPolicy?: RetryPolicy | null) => void
  throttleConfig?: { failover: boolean; cooldownSecs: number }
  updateCheck?: { hasUpdate: boolean; latestVersion: string; currentVersion: string }
  updateCooldown: (secs: number) => void
}

function FullTools({ controls }: { controls: ToolControls }) {
  return (
    <>
      <SchedulingMenu controls={controls} />
      <RefreshButton onRefresh={controls.handleRefresh} />
      <ImageUpdateButton controls={controls} />
      <KeySettingsMenu
        onOpenKeyDialog={controls.openKeyDialog}
        onOpenModelMappings={controls.openModelMappings}
        onOpenSystemPrompt={controls.openSystemPrompt}
      />
    </>
  )
}

/**
 * 调度设置下拉：把负载均衡 / 亲和性 / 自适应RPM 三个开关，
 * 以及 429 重试策略、账号级故障转移冷却，全部收进一个入口，
 * 避免顶栏平铺一排按钮。移动端(CompactTools)仍走各自的紧凑项。
 */
function SchedulingMenu({ controls }: { controls: ToolControls }) {
  const modeBusy = controls.isLoadingMode || controls.isSettingMode
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" title="调度设置：负载均衡 / 亲和性 / 自适应RPM / 429 策略 / 故障转移">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden md:inline">调度</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[28rem] max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>负载调度</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={modeBusy}
          onSelect={(e) => { e.preventDefault(); controls.handleToggleLoadBalancing() }}
        >
          <Activity />
          {controls.isLoadingMode
            ? '负载均衡加载中'
            : `均衡模式：${LB_LABEL[controls.loadBalancingMode ?? 'priority']}（点击切换）`}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={modeBusy}
          onSelect={(e) => { e.preventDefault(); controls.handleToggleAffinity() }}
        >
          <Link />
          {controls.affinityEnabled ? '关闭客户端亲和性' : '开启客户端亲和性'}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={controls.isLoadingAdaptiveRpm || controls.isSettingAdaptiveRpm}
          onSelect={(e) => { e.preventDefault(); controls.handleToggleAdaptiveRpm() }}
        >
          <Gauge />
          {controls.isLoadingAdaptiveRpm
            ? '自适应 RPM 加载中'
            : controls.adaptiveRpmEnabled
              ? '关闭自适应 RPM'
              : '开启自适应 RPM'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <RetryCompactItems controls={controls} />
        <DropdownMenuSeparator />
        <ThrottleCompactItems
          config={controls.throttleConfig}
          loading={controls.isLoadingThrottle}
          saving={controls.isSettingThrottle}
          onToggleFailover={controls.handleToggleFailover}
          onChangeCooldown={controls.updateCooldown}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 可折叠分段（移动端菜单专用）：默认收起，点标题行展开。
 * 头行显示当前值 hint，避免收起时看不到状态。
 */
function CompactCollapsible({
  label, hint, children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <DropdownMenuItem
        className="justify-between"
        onSelect={(e) => { e.preventDefault(); setOpen((v) => !v) }}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown /> : <ChevronRight />}
          {label}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </DropdownMenuItem>
      {open && children}
    </>
  )
}

function CompactTools({ controls }: { controls: ToolControls }) {
  const throttleProps = {
    config: controls.throttleConfig,
    loading: controls.isLoadingThrottle,
    saving: controls.isSettingThrottle,
    onToggleFailover: controls.handleToggleFailover,
    onChangeCooldown: controls.updateCooldown,
  }
  const retryHint = RETRY_MODE_LABELS[controls.retryPolicy?.mode ?? 'failover']
  const throttleState = readThrottleState(controls.throttleConfig)
  const throttleHint = throttleState.failover ? `开 · ${throttleState.cooldownMin}m` : '关'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" title="更多操作">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>系统操作</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={controls.isLoadingMode || controls.isSettingMode}
          onSelect={controls.handleToggleLoadBalancing}
        >
          <Activity />
          {controls.isLoadingMode
            ? '负载均衡加载中'
            : `切换到${LB_LABEL[nextLbMode(controls.loadBalancingMode ?? 'priority')]}`}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={controls.isLoadingMode || controls.isSettingMode}
          onSelect={controls.handleToggleAffinity}
        >
          <Link />
          {controls.affinityEnabled ? '关闭客户端亲和性' : '开启客户端亲和性'}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={controls.isLoadingAdaptiveRpm || controls.isSettingAdaptiveRpm}
          onSelect={controls.handleToggleAdaptiveRpm}
        >
          <Gauge />
          {controls.isLoadingAdaptiveRpm
            ? '自适应 RPM 加载中'
            : controls.adaptiveRpmEnabled
              ? '关闭自适应 RPM'
              : '开启自适应 RPM'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={controls.handleRefresh}>
          <RefreshCw />刷新数据
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={controls.openImageUpdate}>
          <UploadCloud />镜像在线更新
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <CompactCollapsible label="普通 429 策略" hint={retryHint}>
          <RetryCompactItems controls={controls} hideLabel />
        </CompactCollapsible>
        <CompactCollapsible label="故障转移 / 冷却" hint={throttleHint}>
          <ThrottleCompactItems {...throttleProps} hideLabel />
        </CompactCollapsible>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>模型</DropdownMenuLabel>
        <DropdownMenuItem onSelect={controls.openModelMappings}>
          <Shuffle />模型映射（请求时模型名转发）
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={controls.openSystemPrompt}>
          <MessageSquarePlus />系统提示注入
        </DropdownMenuItem>
        <DropdownMenuLabel>密钥管理</DropdownMenuLabel>
        <DropdownMenuItem onSelect={controls.openKeyDialog}>
          <Key />修改登录API密钥（管理面板登录）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const RETRY_MODES: RetryMode[] = [
  'failover',
  'turbo',
  'fast',
  'balanced',
  'steady',
  'polite',
  'custom',
]

const RETRY_MODE_LABELS: Record<RetryMode, string> = {
  failover: '默认故障转移',
  turbo: 'Turbo',
  fast: 'Fast',
  balanced: 'Balanced',
  steady: 'Steady',
  polite: 'Polite',
  custom: 'Custom',
}

const RETRY_MODE_DESCRIPTIONS: Record<RetryMode, string> = {
  failover: '当前默认：普通 429 先用同一凭据切到 q/runtime 备用端点桶，仍失败再切换其它凭据；不做跨请求冷却，适合多账号池保持吞吐。',
  turbo: '最激进：1 秒短冷却、最多 12 次/凭据重试，恢复最快，但更容易持续压到上游限流。',
  fast: '快速恢复：3 秒冷却、9 次/凭据重试，适合短时高峰，仍会快速换凭据。',
  balanced: '折中策略：10 秒冷却、9 次/凭据重试，在吞吐和稳定之间取平衡。',
  steady: '稳态策略：30 秒冷却、6 次/凭据重试，并尊重 Retry-After，减少重复撞同一个限流桶。',
  polite: '保守策略：60 秒冷却、4 次/凭据重试，尊重 Retry-After，不主动换凭据。',
  custom: '自定义：手动设置普通 429 冷却、每凭据重试次数、退避范围、是否换凭据和是否尊重 Retry-After。',
}

const DEFAULT_CUSTOM_RETRY_POLICY: RetryPolicy = {
  rateLimitCooldownMs: 3000,
  maxRequestRetries: 9,
  baseBackoffMs: 200,
  maxBackoffMs: 2000,
  credentialSwitchOn429: true,
  respectRetryAfter: false,
}

function CustomRetryPolicyForm({
  policy, saving, onApply, onBoolChange, onNumberChange,
}: {
  policy: RetryPolicy
  saving: boolean
  onApply: () => void
  onBoolChange: (key: 'credentialSwitchOn429' | 'respectRetryAfter', checked: boolean) => void
  onNumberChange: (key: keyof RetryPolicy, value: string) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <RetryNumberInput
        label="冷却 ms"
        min={0}
        max={120000}
        value={policy.rateLimitCooldownMs}
        onChange={(value) => onNumberChange('rateLimitCooldownMs', value)}
      />
      <RetryNumberInput
        label="每凭据重试"
        min={1}
        max={30}
        value={policy.maxRequestRetries}
        onChange={(value) => onNumberChange('maxRequestRetries', value)}
      />
      <RetryNumberInput
        label="基础退避 ms"
        min={50}
        max={30000}
        value={policy.baseBackoffMs}
        onChange={(value) => onNumberChange('baseBackoffMs', value)}
      />
      <RetryNumberInput
        label="最大退避 ms"
        min={policy.baseBackoffMs}
        max={120000}
        value={policy.maxBackoffMs}
        onChange={(value) => onNumberChange('maxBackoffMs', value)}
      />
      <RetrySwitch
        checked={policy.credentialSwitchOn429}
        label="429 换凭据"
        onCheckedChange={(checked) => onBoolChange('credentialSwitchOn429', checked)}
      />
      <RetrySwitch
        checked={policy.respectRetryAfter}
        label="Retry-After"
        onCheckedChange={(checked) => onBoolChange('respectRetryAfter', checked)}
      />
      <Button
        type="button"
        size="sm"
        className="sm:col-span-2"
        disabled={saving}
        onClick={onApply}
      >
        保存 Custom
      </Button>
    </div>
  )
}

function RetryNumberInput({
  label, min, max, value, onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (value: string) => void
}) {
  return (
    <label className="text-xs font-medium text-muted-foreground">
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 text-xs"
      />
    </label>
  )
}

function RetrySwitch({
  checked, label, onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-8 items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
      {label}
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function RetryCompactItems({ controls, hideLabel }: { controls: ToolControls; hideLabel?: boolean }) {
  const [customPolicy, setCustomPolicy] = useState<RetryPolicy>(DEFAULT_CUSTOM_RETRY_POLICY)
  const activeMode = controls.retryPolicy?.mode ?? 'failover'
  const effective = controls.retryPolicy?.effectivePolicy
  const busy = controls.isLoadingRetry || controls.isSettingRetry

  useEffect(() => {
    if (controls.retryPolicy?.customPolicy) {
      setCustomPolicy(controls.retryPolicy.customPolicy)
    } else if (controls.retryPolicy?.mode === 'custom' && controls.retryPolicy.effectivePolicy) {
      setCustomPolicy(controls.retryPolicy.effectivePolicy)
    }
  }, [controls.retryPolicy?.customPolicy, controls.retryPolicy?.effectivePolicy, controls.retryPolicy?.mode])

  const updateNumber = (key: keyof RetryPolicy, value: string) => {
    const numeric = Number(value)
    setCustomPolicy((prev) => ({ ...prev, [key]: Number.isFinite(numeric) ? numeric : 0 }))
  }

  const applyMode = (mode: RetryMode, custom = customPolicy) => {
    controls.setRetryPolicy(mode, mode === 'custom' ? custom : null)
  }

  return (
    <>
      {!hideLabel && <DropdownMenuLabel>普通 429 策略</DropdownMenuLabel>}
      <div className="space-y-2 px-2 pb-2">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {RETRY_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={activeMode === mode ? 'default' : 'outline'}
              className="h-7 justify-start text-xs"
              disabled={busy}
              title={RETRY_MODE_DESCRIPTIONS[mode]}
              onClick={() => applyMode(mode)}
            >
              {RETRY_MODE_LABELS[mode]}
            </Button>
          ))}
        </div>
        <div className="rounded-md bg-secondary/40 px-2.5 py-2 text-[11px] leading-snug">
          <div className="font-medium text-foreground">{RETRY_MODE_LABELS[activeMode]}</div>
          <p className="mt-1 text-muted-foreground">{RETRY_MODE_DESCRIPTIONS[activeMode]}</p>
          {effective && (
            <div className="mt-1 text-muted-foreground">{retryPolicySummary(effective)}</div>
          )}
        </div>
        {activeMode === 'custom' && (
          <CustomRetryPolicyForm
            policy={customPolicy}
            saving={controls.isSettingRetry}
            onApply={() => applyMode('custom', customPolicy)}
            onBoolChange={(key, checked) =>
              setCustomPolicy((prev) => ({ ...prev, [key]: checked }))
            }
            onNumberChange={updateNumber}
          />
        )}
      </div>
    </>
  )
}

function retryPolicySummary(policy: RetryPolicy) {
  const cooldown = policy.rateLimitCooldownMs <= 0
    ? '不跨请求冷却'
    : `冷却 ${(policy.rateLimitCooldownMs / 1000).toFixed(1)}s`
  const switchText = policy.credentialSwitchOn429 ? '429 换凭据' : '不主动换凭据'
  const retryAfter = policy.respectRetryAfter ? '尊重 Retry-After' : '忽略 Retry-After'
  return `${cooldown} · 每凭据 ${policy.maxRequestRetries} 次 · ${switchText} · ${retryAfter}`
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Button variant="ghost" size="icon" onClick={onRefresh} title="刷新">
      <RefreshCw className="h-4 w-4" />
    </Button>
  )
}

function ImageUpdateButton({ controls }: { controls: ToolControls }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={controls.openImageUpdate}
      title={imageUpdateTitle(controls.updateCheck)}
      className="relative"
    >
      <UploadCloud className="h-4 w-4" />
      {controls.updateCheck?.hasUpdate && <UpdateDot />}
    </Button>
  )
}

function KeySettingsMenu({
  onOpenKeyDialog,
  onOpenModelMappings,
  onOpenSystemPrompt,
}: {
  onOpenKeyDialog: () => void
  onOpenModelMappings: () => void
  onOpenSystemPrompt: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title="设置">
          <Settings className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>模型</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onOpenModelMappings}>
          <Shuffle />模型映射（请求时模型名转发）
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenSystemPrompt}>
          <MessageSquarePlus />系统提示注入
        </DropdownMenuItem>
        <DropdownMenuLabel>密钥管理</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onOpenKeyDialog}>
          <Key />修改登录API密钥（管理面板登录）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function imageUpdateTitle(updateCheck: ToolControls['updateCheck']) {
  if (!updateCheck?.hasUpdate) return '镜像在线更新'
  return `发现新版本 v${updateCheck.latestVersion}（当前 v${updateCheck.currentVersion}）`
}

function UpdateDot() {
  return (
    <span className="absolute right-1 top-1 inline-flex h-2 w-2 items-center justify-center">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  )
}

interface ThrottleConfigButtonProps {
  config?: { failover: boolean; cooldownSecs: number }
  loading: boolean
  saving: boolean
  onToggleFailover: () => void
  onChangeCooldown: (secs: number) => void
}

interface ThrottleState {
  cooldownMin: number
  cooldownSecs: number
  failover: boolean
}

interface CustomCooldownFormProps {
  cooldownMin: number
  customMin: string
  disabled: boolean
  onCustomMinChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
}

const COOLDOWN_PRESETS = [
  { label: '5 分钟', secs: 5 * 60 },
  { label: '15 分钟', secs: 15 * 60 },
  { label: '30 分钟', secs: 30 * 60 },
  { label: '1 小时', secs: 60 * 60 },
  { label: '2 小时', secs: 2 * 60 * 60 },
]

const DEFAULT_COOLDOWN_SECS = 30 * 60
const SECONDS_PER_MINUTE = 60
const MIN_CUSTOM_COOLDOWN_MINUTES = 1
const MAX_CUSTOM_COOLDOWN_MINUTES = 1440

function ThrottleCooldownPanel({
  customMin, saving, state, onChangeCooldown, onCustomMinChange, onDone, onSubmitCustom,
}: {
  customMin: string
  saving: boolean
  state: ThrottleState
  onChangeCooldown: (secs: number) => void
  onCustomMinChange: (value: string) => void
  onDone?: () => void
  onSubmitCustom: (e: React.FormEvent) => void
}) {
  const disabled = saving || !state.failover

  return (
    <>
      <DropdownMenuLabel className="pt-1">冷却时长</DropdownMenuLabel>
      <div className={cooldownPanelClassName(state.failover)}>
        <CooldownPresetButtons
          cooldownSecs={state.cooldownSecs}
          disabled={disabled}
          onChangeCooldown={onChangeCooldown}
          onDone={onDone}
        />
        <CustomCooldownForm
          cooldownMin={state.cooldownMin}
          customMin={customMin}
          disabled={disabled}
          onCustomMinChange={onCustomMinChange}
          onSubmit={onSubmitCustom}
        />
      </div>
    </>
  )
}

function CustomCooldownForm({
  cooldownMin, customMin, disabled, onCustomMinChange, onSubmit,
}: CustomCooldownFormProps) {
  return (
    <form onSubmit={onSubmit} className="mt-2 flex items-center gap-1.5">
      <Input
        type="number"
        min={MIN_CUSTOM_COOLDOWN_MINUTES}
        max={MAX_CUSTOM_COOLDOWN_MINUTES}
        placeholder={`自定义（当前 ${cooldownMin}）`}
        value={customMin}
        onChange={(e) => onCustomMinChange(e.target.value)}
        disabled={disabled}
        className="h-7 text-xs"
      />
      <span className="text-xs text-muted-foreground">分钟</span>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={disabled || !customMin.trim()}
      >
        保存
      </Button>
    </form>
  )
}

function ThrottleCompactItems(props: ThrottleConfigButtonProps & { hideLabel?: boolean }) {
  const { loading, saving, onToggleFailover, onChangeCooldown, hideLabel } = props
  const [customMin, setCustomMin] = useState('')
  const state = readThrottleState(props.config)
  const busy = loading || saving

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault()
    const min = parseInt(customMin, 10)
    if (invalidCooldownMinutes(min)) {
      toast.error('请输入 1-1440 之间的分钟数')
      return
    }
    onChangeCooldown(min * SECONDS_PER_MINUTE)
    setCustomMin('')
  }

  return (
    <>
      {!hideLabel && <DropdownMenuLabel>故障转移</DropdownMenuLabel>}
      <DropdownMenuItem
        disabled={busy}
        onSelect={onToggleFailover}
      >
        {state.failover ? <ShieldCheck /> : <ShieldAlert />}
        {compactThrottleText(loading, state)}
      </DropdownMenuItem>
      <ThrottleCooldownPanel
        customMin={customMin}
        saving={busy}
        state={state}
        onChangeCooldown={onChangeCooldown}
        onCustomMinChange={setCustomMin}
        onSubmitCustom={submitCustom}
      />
    </>
  )
}

function CooldownPresetButtons({
  cooldownSecs, disabled, onChangeCooldown, onDone,
}: {
  cooldownSecs: number
  disabled: boolean
  onChangeCooldown: (secs: number) => void
  onDone?: () => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {COOLDOWN_PRESETS.map((preset) => (
        <CooldownPresetButton
          key={preset.secs}
          active={preset.secs === cooldownSecs}
          disabled={disabled}
          label={preset.label}
          secs={preset.secs}
          onChangeCooldown={onChangeCooldown}
          onDone={onDone}
        />
      ))}
    </div>
  )
}

function CooldownPresetButton({
  active, disabled, label, secs, onChangeCooldown, onDone,
}: {
  active: boolean
  disabled: boolean
  label: string
  secs: number
  onChangeCooldown: (secs: number) => void
  onDone?: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'default' : 'outline'}
      className="h-7 text-xs"
      disabled={disabled}
      onClick={() => {
        if (!active) onChangeCooldown(secs)
        onDone?.()
      }}
    >
      {label}
    </Button>
  )
}

function secondsToMinutes(seconds: number) {
  return Math.round(seconds / SECONDS_PER_MINUTE)
}

function readThrottleState(
  config: ThrottleConfigButtonProps['config'],
): ThrottleState {
  const cooldownSecs = config?.cooldownSecs ?? DEFAULT_COOLDOWN_SECS
  return {
    cooldownMin: secondsToMinutes(cooldownSecs),
    cooldownSecs,
    failover: config?.failover ?? true,
  }
}

function compactThrottleText(loading: boolean, state: ThrottleState) {
  if (loading) return '故障转移加载中'
  if (!state.failover) return '开启故障转移'
  return `关闭故障转移 · ${state.cooldownMin}m`
}

function invalidCooldownMinutes(minutes: number) {
  return (
    Number.isNaN(minutes) ||
    minutes < MIN_CUSTOM_COOLDOWN_MINUTES ||
    minutes > MAX_CUSTOM_COOLDOWN_MINUTES
  )
}

function cooldownPanelClassName(failover: boolean) {
  return `px-2 pb-2 ${failover ? '' : 'opacity-60'}`
}
