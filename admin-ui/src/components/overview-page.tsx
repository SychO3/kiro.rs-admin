import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Activity, Coins, Cpu, KeyRound, Server } from 'lucide-react'
import {
  useByCredential,
  useByModel,
  useCredentialHealth,
  useEndpointLatency,
  useOverview,
  useTimeSeries,
} from '@/hooks/use-stats'
import { useClientKeys } from '@/hooks/use-client-keys'
import { useGroupOptions } from '@/hooks/use-groups'
import type {
  ClientKeyItem,
  CredentialDistribution,
  CredentialHealth,
  EndpointLatency,
  ModelDistribution,
  StatsFilter,
  StatsGranularity,
  StatsRange,
  StatsTimeFilter,
  TimeSeriesPoint,
} from '@/types/api'
import { TimeSeriesChart } from '@/components/charts/time-series-chart'
import { ModelPieChart } from '@/components/charts/model-pie-chart'
import { CredentialBarChart } from '@/components/charts/credential-bar-chart'
import { EndpointLatencyChart } from '@/components/charts/endpoint-latency-chart'
import { cn, formatCost, formatCredits, formatNumber } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const RANGES: { label: string; value: StatsRange }[] = [
  { label: '24 小时', value: '24h' },
  { label: '7 天', value: '7d' },
  { label: '30 天', value: '30d' },
]

const GRANULARITIES: { label: string; value: StatsGranularity }[] = [
  { label: '按小时', value: 'hour' },
  { label: '按天', value: 'day' },
]

function toDateInputValue(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function customTimeFilter(
  startDate: string,
  endDate: string,
  granularity: StatsGranularity,
): StatsTimeFilter {
  return { startDate, endDate, granularity }
}

function presetStartDate(range: StatsRange, endDate: string): string {
  const days = range === '24h' ? 1 : range === '7d' ? 6 : 29
  const d = new Date(`${endDate}T00:00:00`)
  d.setDate(d.getDate() - days)
  return toDateInputValue(d)
}

function formatDateText(value: string): string {
  // 去掉年份，只显示 MM/DD（年份多余占地方）
  const parts = value.split('-')
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value.replace(/-/g, '/')
}

function timeLabel(filter: StatsTimeFilter): string {
  const suffix = filter.granularity === 'day' ? '按天' : '按小时'
  if (filter.range) {
    const range = RANGES.find((r) => r.value === filter.range)?.label ?? filter.range
    return `近 ${range} · ${suffix}`
  }
  return `${formatDateText(filter.startDate ?? '')} - ${formatDateText(filter.endDate ?? '')} · ${suffix}`
}

export function OverviewPage() {
  const filters = useOverviewFilters()
  const { data: overview } = useOverview()
  const { data: keysData } = useClientKeys()
  const groupOptions = useGroupOptions()
  const { data: series } = useTimeSeries(filters.timeFilter, filters.statsFilter)
  const { data: byModel } = useByModel(filters.timeFilter, filters.statsFilter)
  const { data: byCred } = useByCredential(filters.timeFilter, filters.statsFilter)
  const { data: endpointLatency } = useEndpointLatency(filters.timeFilter)
  const { data: credHealth } = useCredentialHealth(filters.timeFilter)
  const seriesData = useMemo(() => series ?? [], [series])
  const modelData = useMemo(() => byModel ?? [], [byModel])
  const credData = useMemo(() => byCred ?? [], [byCred])
  const endpointData = useMemo(() => endpointLatency ?? [], [endpointLatency])
  const healthData = useMemo(() => credHealth ?? [], [credHealth])
  const rangeStats = useMemo(() => aggregateSeries(seriesData), [seriesData])
  const selectedKeyLabel = selectedStatsKeyLabel(filters.keyFilter, keysData?.keys ?? [])
  const groupFilterActive = filters.groupFilter !== 'all'

  return (
    <div>
      <PageHeader />
      <StatsCards
        activeCredentials={overview?.activeCredentials ?? 0}
        activeKeys={overview?.activeClientKeys ?? 0}
        stats={rangeStats}
        timeText={timeLabel(filters.timeFilter)}
      />
      <KeyFilterCard
        keyFilter={filters.keyFilter}
        keys={keysData?.keys ?? []}
        selectedLabel={selectedKeyLabel}
        onChange={filters.setKeyFilter}
        groupFilter={filters.groupFilter}
        groupOptions={groupOptions}
        onGroupChange={filters.setGroupFilter}
      />
      <TrendCard
        customEndDate={filters.customEndDate}
        customStartDate={filters.customStartDate}
        draftGranularity={filters.draftGranularity}
        draftRange={filters.draftRange}
        keyFilter={filters.keyFilter}
        seriesData={seriesData}
        timeFilter={filters.timeFilter}
        onApplyCustomRange={filters.applyCustomRange}
        onCustomEndDateChange={filters.setCustomEndDate}
        onCustomStartDateChange={filters.setCustomStartDate}
        onGranularityChange={filters.setDraftGranularity}
        onPresetRangeChange={filters.selectPresetRange}
      />
      <DistributionPanels
        byCred={credData}
        byModel={modelData}
        timeText={timeLabel(filters.timeFilter)}
        groupFilterActive={groupFilterActive}
      />
      <HealthPanels
        endpoint={endpointData}
        health={healthData}
        timeText={timeLabel(filters.timeFilter)}
      />
    </div>
  )
}

function HealthPanels({
  endpoint,
  health,
  timeText,
}: {
  endpoint: EndpointLatency[]
  health: CredentialHealth[]
  timeText: string
}) {
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <EndpointLatencyPanel data={endpoint} timeText={timeText} />
      <CredentialHealthPanel data={health} timeText={timeText} />
    </div>
  )
}

function EndpointLatencyPanel({ data, timeText }: { data: EndpointLatency[]; timeText: string }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">端点延迟 / 限流</h2>
          <span className="text-[11px] text-muted-foreground">{timeText}</span>
        </div>
        <EndpointLatencyChart data={data} />
      </CardContent>
    </Card>
  )
}

function CredentialHealthPanel({ data, timeText }: { data: CredentialHealth[]; timeText: string }) {
  // 成功率升序：最不健康的排前面，一眼看出问题号
  const rows = useMemo(
    () =>
      [...data]
        .map((h) => ({
          ...h,
          successRate: h.total > 0 ? h.success / h.total : 0,
          throttleRate: h.total > 0 ? h.throttled / h.total : 0,
        }))
        .sort((a, b) => a.successRate - b.successRate),
    [data],
  )
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">凭据健康度</h2>
          <span className="text-[11px] text-muted-foreground">{timeText}</span>
        </div>
        {rows.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground sm:h-[260px]">
            暂无数据
          </div>
        ) : (
          <div className="max-h-[340px] overflow-auto text-[12px]">
            <table className="w-full table-fixed">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium pb-1 w-[38%]">凭据</th>
                  <th className="text-right font-medium w-[14%]">请求</th>
                  <th className="text-right font-medium w-[16%]">成功率</th>
                  <th className="text-right font-medium w-[16%]">限流率</th>
                  <th className="text-right font-medium w-[16%]">鉴权失败</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.credentialId} className="border-t border-border/40">
                    <td className="py-1 truncate" title={h.email ?? `#${h.credentialId}`}>
                      {h.email ?? `#${h.credentialId}`}
                    </td>
                    <td className="text-right tabular-nums">{formatNumber(h.total)}</td>
                    <td
                      className={cn(
                        'text-right tabular-nums',
                        h.successRate >= 0.95
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : h.successRate >= 0.8
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-destructive',
                      )}
                    >
                      {(h.successRate * 100).toFixed(1)}%
                    </td>
                    <td className="text-right tabular-nums">{(h.throttleRate * 100).toFixed(1)}%</td>
                    <td className="text-right tabular-nums">{formatNumber(h.authFailed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function useOverviewFilters() {
  const today = useMemo(() => toDateInputValue(new Date()), [])
  const [timeFilter, setTimeFilter] = useState<StatsTimeFilter>(() =>
    customTimeFilter(presetStartDate('24h', today), today, 'hour'),
  )
  const [customStartDate, setCustomStartDate] = useState(() => presetStartDate('24h', today))
  const [customEndDate, setCustomEndDate] = useState(today)
  const [draftGranularity, setDraftGranularity] = useState<StatsGranularity>('hour')
  const [draftRange, setDraftRange] = useState<StatsRange | undefined>('24h')
  const [keyFilter, setKeyFilter] = useState('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const statsFilter = useMemo<StatsFilter>(() => {
    const f: StatsFilter = {}
    if (keyFilter !== 'all') f.keyId = Number(keyFilter)
    if (groupFilter !== 'all') f.group = groupFilter
    return f
  }, [keyFilter, groupFilter])
  const applyCustomRange = () => {
    setTimeFilter(customTimeFilter(customStartDate, customEndDate, draftGranularity))
  }
  const updateCustomStartDate = (value: string) => {
    setCustomStartDate(value)
    setDraftRange(undefined)
  }
  const updateCustomEndDate = (value: string) => {
    setCustomEndDate(value)
    setDraftRange(undefined)
  }
  const selectPresetRange = (range: StatsRange) => {
    const endDate = toDateInputValue(new Date())
    setCustomStartDate(presetStartDate(range, endDate))
    setCustomEndDate(endDate)
    setDraftRange(range)
  }
  return {
    applyCustomRange,
    customEndDate,
    customStartDate,
    draftGranularity,
    draftRange,
    keyFilter,
    groupFilter,
    selectPresetRange,
    setCustomEndDate: updateCustomEndDate,
    setCustomStartDate: updateCustomStartDate,
    setDraftGranularity,
    setKeyFilter,
    setGroupFilter,
    statsFilter,
    timeFilter,
  }
}

function selectedStatsKeyLabel(keyFilter: string, keys: ClientKeyItem[]): string {
  if (keyFilter === 'all') return '全部入口 Key'
  return keys.find((k) => String(k.id) === keyFilter)?.name ?? `#${keyFilter}`
}

function PageHeader() {
  return (
    <div className="mb-6">
      <h1 className="text-[28px] font-semibold tracking-tight leading-tight">概览</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        中转站调用情况、Token 消耗趋势与上游凭据贡献
      </p>
    </div>
  )
}

interface RangeStats {
  calls: number
  credits: number
  cost: number
  errors: number
  inputTokens: number
  outputTokens: number
}

function aggregateSeries(data: TimeSeriesPoint[]): RangeStats {
  return data.reduce(
    (acc, p) => ({
      calls: acc.calls + p.calls,
      credits: acc.credits + (p.credits ?? 0),
      cost: acc.cost + (p.cost ?? 0),
      errors: acc.errors + p.errors,
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
    }),
    { calls: 0, credits: 0, cost: 0, errors: 0, inputTokens: 0, outputTokens: 0 },
  )
}

function StatsCards({
  activeCredentials,
  activeKeys,
  stats,
  timeText,
}: {
  activeCredentials: number
  activeKeys: number
  stats: RangeStats
  timeText: string
}) {
  const cards = [
    {
      icon: <Activity className="h-4 w-4" />,
      label: '调用',
      value: formatNumber(stats.calls),
      extra: stats.errors > 0 ? (
        <Badge variant="destructive">异常 {formatNumber(stats.errors)}</Badge>
      ) : null,
    },
    { icon: <Cpu className="h-4 w-4" />, label: '输入 Token', value: formatNumber(stats.inputTokens) },
    { icon: <Cpu className="h-4 w-4" />, label: '输出 Token', value: formatNumber(stats.outputTokens) },
    {
      icon: <Coins className="h-4 w-4" />,
      label: '费用',
      value: formatCost(stats.cost),
      extra: <span className="text-[11px] text-muted-foreground">⚡{formatCredits(stats.credits)}</span>,
    },
    {
      icon: <KeyRound className="h-4 w-4" />,
      label: '启用的客户端 Key',
      meta: '当前可用入口',
      value: formatNumber(activeKeys),
      className: 'col-span-2 max-[360px]:col-span-1 lg:col-span-1',
      extra: (
        <span className="text-[11px] text-muted-foreground">
          上游 {formatNumber(activeCredentials)}
        </span>
      ),
    },
  ]

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 max-[360px]:grid-cols-1 lg:grid-cols-5">
      {cards.map((card) => (
        <StatCard key={card.label} meta={card.meta ?? timeText} {...card} />
      ))}
    </div>
  )
}

function KeyFilterCard({
  keyFilter,
  keys,
  onChange,
  selectedLabel,
  groupFilter,
  groupOptions,
  onGroupChange,
}: {
  keyFilter: string
  keys: ClientKeyItem[]
  onChange: (value: string) => void
  selectedLabel: string
  groupFilter: string
  groupOptions: string[]
  onGroupChange: (value: string) => void
}) {
  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">统计筛选</div>
            <div className="truncate text-[12px] text-muted-foreground">
              {selectedLabel}
              {groupFilter !== 'all' && ` · 分组：${groupFilter}`}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* 入口 Key 筛选 */}
            <Select value={keyFilter} onValueChange={onChange}>
              <SelectTrigger className="h-8 w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">全部入口 Key</SelectItem>
                {keys.map((key) => (
                  <SelectItem key={key.id} value={String(key.id)}>
                    {key.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* 账号分组筛选 */}
            <Select value={groupFilter} onValueChange={onGroupChange}>
              <SelectTrigger className="h-8 w-full sm:w-[180px]">
                <SelectValue placeholder="全部分组" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">全部分组</SelectItem>
                {groupOptions.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface TrendCardProps {
  customEndDate: string
  customStartDate: string
  draftGranularity: StatsGranularity
  draftRange?: StatsRange
  keyFilter: string
  onApplyCustomRange: () => void
  onCustomEndDateChange: (value: string) => void
  onCustomStartDateChange: (value: string) => void
  onGranularityChange: (value: StatsGranularity) => void
  onPresetRangeChange: (value: StatsRange) => void
  seriesData: TimeSeriesPoint[]
  timeFilter: StatsTimeFilter
}

function TrendCard({
  customEndDate,
  customStartDate,
  draftGranularity,
  draftRange,
  keyFilter,
  onApplyCustomRange,
  onCustomEndDateChange,
  onCustomStartDateChange,
  onGranularityChange,
  onPresetRangeChange,
  seriesData,
  timeFilter,
}: TrendCardProps) {
  const chartKey = `${timeLabel(timeFilter)}:${keyFilter}`
  return (
    <Card className="mb-6">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <TrendTitle granularity={timeFilter.granularity} />
          <TrendControls
            customEndDate={customEndDate}
            customStartDate={customStartDate}
            draftGranularity={draftGranularity}
            draftRange={draftRange}
            onApplyCustomRange={onApplyCustomRange}
            onCustomEndDateChange={onCustomEndDateChange}
            onCustomStartDateChange={onCustomStartDateChange}
            onGranularityChange={onGranularityChange}
            onPresetRangeChange={onPresetRangeChange}
          />
        </div>
        <div key={chartKey} className="chart-range-fade">
          <TimeSeriesChart data={seriesData} granularity={timeFilter.granularity} />
        </div>
      </CardContent>
    </Card>
  )
}

function TrendTitle({ granularity }: { granularity: StatsGranularity }) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight">Token 使用趋势</h2>
      <p className="text-[12px] text-muted-foreground">
        {granularity === 'day' ? '按天' : '按小时'}聚合 · 输入/输出/缓存读写
      </p>
    </div>
  )
}

function TrendControls({
  customEndDate,
  customStartDate,
  draftGranularity,
  draftRange,
  onApplyCustomRange,
  onCustomEndDateChange,
  onCustomStartDateChange,
  onGranularityChange,
  onPresetRangeChange,
}: {
  customEndDate: string
  customStartDate: string
  draftGranularity: StatsGranularity
  draftRange?: StatsRange
  onApplyCustomRange: () => void
  onCustomEndDateChange: (value: string) => void
  onCustomStartDateChange: (value: string) => void
  onGranularityChange: (value: StatsGranularity) => void
  onPresetRangeChange: (value: StatsRange) => void
}) {
  return (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-end lg:justify-end">
      <PresetRangeButtons currentRange={draftRange} onChange={onPresetRangeChange} />
      <GranularitySelect value={draftGranularity} onChange={onGranularityChange} />
      <DateRangeInputs
        endDate={customEndDate}
        startDate={customStartDate}
        onApply={onApplyCustomRange}
        onEndDateChange={onCustomEndDateChange}
        onStartDateChange={onCustomStartDateChange}
      />
    </div>
  )
}

function PresetRangeButtons({
  currentRange,
  onChange,
}: {
  currentRange?: StatsRange
  onChange: (value: StatsRange) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-border/60 p-0.5 lg:flex lg:items-center">
      {RANGES.map((r) => (
        <Button
          key={r.value}
          size="sm"
          variant={currentRange === r.value ? 'default' : 'ghost'}
          className="h-8 rounded-md px-2 text-xs lg:h-7 lg:px-3"
          onClick={() => onChange(r.value)}
        >
          {r.label}
        </Button>
      ))}
    </div>
  )
}

function GranularitySelect({
  onChange,
  value,
}: {
  onChange: (value: StatsGranularity) => void
  value: StatsGranularity
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as StatsGranularity)}>
      <SelectTrigger className="h-8 w-full lg:w-[96px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {GRANULARITIES.map((g) => (
          <SelectItem key={g.value} value={g.value}>
            {g.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DateRangeInputs({
  endDate,
  onApply,
  onEndDateChange,
  onStartDateChange,
  startDate,
}: {
  endDate: string
  onApply: () => void
  onEndDateChange: (value: string) => void
  onStartDateChange: (value: string) => void
  startDate: string
}) {
  return (
    <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
      <div className="flex items-center gap-1.5">
        <DateInput value={startDate} onChange={onStartDateChange} />
        <span className="shrink-0 text-[10px] text-muted-foreground">至</span>
        <DateInput value={endDate} onChange={onEndDateChange} />
      </div>
      <Button
        size="sm"
        className="h-7 w-full px-2.5 text-xs lg:w-auto"
        disabled={!startDate || !endDate || endDate < startDate}
        onClick={onApply}
      >
        应用
      </Button>
    </div>
  )
}

function DateInput({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <Input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 min-w-0 flex-1 rounded-md px-1.5 text-[10px] sm:text-xs"
    />
  )
}

function DistributionPanels({
  byCred,
  byModel,
  timeText,
  groupFilterActive,
}: {
  byCred: CredentialDistribution[]
  byModel: ModelDistribution[]
  timeText: string
  groupFilterActive: boolean
}) {
  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-2">
      <ModelPanel data={byModel} timeText={timeText} groupFilterActive={groupFilterActive} />
      <CredentialPanel data={byCred} />
    </div>
  )
}

function ModelPanel({
  data,
  timeText,
  groupFilterActive,
}: {
  data: ModelDistribution[]
  timeText: string
  groupFilterActive: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold tracking-tight">按模型分布</h2>
          <span className="text-[11px] text-muted-foreground">{timeText}</span>
        </div>
        {groupFilterActive && (
          <p className="mb-3 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-600">
            当前已启用「分组筛选」。模型分布暂未细分到分组维度，本卡片显示的是
            <strong className="mx-0.5">不区分分组</strong>的模型聚合结果。
          </p>
        )}
        <ModelPieChart data={data} />
        {data.length > 0 && <ModelTable data={data} />}
      </CardContent>
    </Card>
  )
}

function ModelTable({ data }: { data: ModelDistribution[] }) {
  return (
    <div className="mt-3 max-h-32 overflow-auto text-[12px]">
      <table className="w-full table-fixed">
        <thead className="text-muted-foreground">
          <tr>
            <th className="text-left font-medium pb-1 w-[40%]">模型</th>
            <th className="text-right font-medium w-[15%]">调用</th>
            <th className="text-right font-medium w-[15%]">输入</th>
            <th className="text-right font-medium w-[15%]">输出</th>
            <th className="text-right font-medium w-[15%]">费用</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.model} className="border-t border-border/40">
              <td className="py-1 truncate">{m.model}</td>
              <td className="text-right tabular-nums">{formatNumber(m.calls)}</td>
              <td className="text-right tabular-nums">{formatNumber(m.inputTokens)}</td>
              <td className="text-right tabular-nums">{formatNumber(m.outputTokens)}</td>
              <td className="text-right tabular-nums text-amber-600 dark:text-amber-400">{formatCost(m.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CredentialPanel({ data }: { data: CredentialDistribution[] }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">按上游凭据分布</h2>
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <Server className="h-3 w-3" />Top {Math.min(data.length, 12)}
          </span>
        </div>
        <CredentialBarChart data={data} />
      </CardContent>
    </Card>
  )
}

function StatCard({
  icon,
  label,
  meta,
  value,
  extra,
  className,
}: {
  className?: string
  icon: React.ReactNode
  label: string
  meta: string
  value: string
  extra?: React.ReactNode
}) {
  return (
    <Card className={cn('hover:shadow-apple-lg hover:-translate-y-0.5', className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex min-h-[34px] items-start gap-2">
          <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-foreground">{label}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</div>
          </div>
        </div>
        <div className="ml-6 mt-4 min-h-[36px]">
          <span className="min-w-0 truncate text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</span>
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
