import { memo, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { EndpointLatency } from '@/types/api'
import { tooltipContentStyle, tooltipCursorStyle, tooltipItemStyle, tooltipLabelStyle } from './tooltip-style'

interface Props {
  data: EndpointLatency[]
}

interface ChartDatum {
  endpoint: string
  p50Ms: number
  p95Ms: number
  count: number
  throttlePct: number
}

function EndpointLatencyChartImpl({ data }: Props) {
  const formatted = useMemo(() => buildChartData(data), [data])

  if (data.length === 0) {
    return <EmptyChart />
  }

  return <ChartContent data={formatted} />
}

function buildChartData(data: EndpointLatency[]): ChartDatum[] {
  return data.map((d) => ({
    endpoint: d.endpoint || '—',
    p50Ms: d.p50Ms,
    p95Ms: d.p95Ms,
    count: d.count,
    throttlePct: Math.round(d.throttleRate * 1000) / 10,
  }))
}

function EmptyChart() {
  return (
    <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground sm:h-[260px]">
      暂无数据
    </div>
  )
}

function ChartContent({ data }: { data: ChartDatum[] }) {
  return (
    <div className="h-[280px] sm:h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="endpoint" tick={{ fontSize: 11 }} interval={0} height={32} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}ms`} width={54} />
          <Tooltip
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            itemStyle={tooltipItemStyle}
            cursor={tooltipCursorStyle}
            formatter={formatTooltipValue}
            labelFormatter={formatTooltipLabel}
          />
          <Legend verticalAlign="top" align="right" height={28} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="p50Ms" name="P50" fill="#3b82f6" isAnimationActive={false} />
          <Bar dataKey="p95Ms" name="P95" fill="#f59e0b" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function formatTooltipValue(value: number, name: string) {
  return [`${value}ms`, name]
}

function formatTooltipLabel(label: string, payload?: ReadonlyArray<{ payload?: ChartDatum }>) {
  const d = payload?.[0]?.payload
  if (!d) return label
  return `${label}  ·  ${d.count} 次  ·  429 ${d.throttlePct}%`
}

export const EndpointLatencyChart = memo(EndpointLatencyChartImpl)
