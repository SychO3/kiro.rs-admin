import axios from 'axios'
import { storage } from '@/lib/storage'
import type {
  BalancePoint,
  CredentialDistribution,
  CredentialHealth,
  EndpointLatency,
  ModelDistribution,
  OverviewStats,
  StatsFilter,
  StatsTimeFilter,
  TimeSeriesPoint,
} from '@/types/api'

const api = axios.create({
  baseURL: '/api/admin',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const apiKey = storage.getApiKey()
  if (apiKey) config.headers['x-api-key'] = apiKey
  return config
})

export async function getOverview(): Promise<OverviewStats> {
  const { data } = await api.get<OverviewStats>('/stats/overview')
  return data
}

function statsParams(time: StatsTimeFilter, filter?: StatsFilter) {
  return {
    ...time,
    ...(filter?.keyId !== undefined ? { keyId: filter.keyId } : {}),
    ...(filter?.group ? { group: filter.group } : {}),
  }
}

export async function getTimeSeries(time: StatsTimeFilter, filter?: StatsFilter): Promise<TimeSeriesPoint[]> {
  const { data } = await api.get<TimeSeriesPoint[]>('/stats/timeseries', {
    params: statsParams(time, filter),
  })
  return data
}

export async function getByModel(time: StatsTimeFilter, filter?: StatsFilter): Promise<ModelDistribution[]> {
  const { data } = await api.get<ModelDistribution[]>('/stats/by-model', {
    params: statsParams(time, filter),
  })
  return data
}

export async function getByCredential(time: StatsTimeFilter, filter?: StatsFilter): Promise<CredentialDistribution[]> {
  const { data } = await api.get<CredentialDistribution[]>('/stats/by-credential', {
    params: statsParams(time, filter),
  })
  return data
}

/** 仅取时间范围（range 或 startDate/endDate），端点/健康看板不按 key/group 过滤 */
function rangeParams(time: StatsTimeFilter) {
  return { ...time }
}

export async function getEndpointLatency(time: StatsTimeFilter): Promise<EndpointLatency[]> {
  const { data } = await api.get<EndpointLatency[]>('/stats/endpoint-latency', {
    params: rangeParams(time),
  })
  return data
}

export async function getCredentialHealth(time: StatsTimeFilter): Promise<CredentialHealth[]> {
  const { data } = await api.get<CredentialHealth[]>('/stats/credential-health', {
    params: rangeParams(time),
  })
  return data
}

export async function getBalanceSeries(
  credentialId: number,
  time: StatsTimeFilter,
): Promise<BalancePoint[]> {
  const { data } = await api.get<BalancePoint[]>('/stats/balance-series', {
    params: { ...rangeParams(time), credentialId },
  })
  return data
}
