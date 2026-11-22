import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Download,
  ExternalLink,
  Eye,
  Gamepad2,
  Globe,
  Heart,
  Monitor,
  Package,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Tablet,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AdminAnalyticsPayload, GameItem, Language, Product } from '../../types/marketplace';
import { MOBILE_APP_CATEGORIES, type MobileAppItem } from '../../lib/mobileAppsCatalog';
import { GAME_CATEGORIES } from '../../lib/gamesCatalog';
import { adminFetchAnalytics, formatDateShort } from '../../lib/firestoreService';

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_APPS: MobileAppItem[] = [];
const EMPTY_GAMES: GameItem[] = [];

type PresetRange = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';
type ChartMetricKey =
  | 'uniqueVisitors'
  | 'visitors'
  | 'pageViews'
  | 'appViews'
  | 'gameViews'
  | 'downloadClicks'
  | 'playClicks'
  | 'orders';

function formatDeltaBadge(deltaPct: number) {
  if (!Number.isFinite(deltaPct) || deltaPct === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold font-mono-num">
        0%
      </span>
    );
  }
  const positive = deltaPct > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold font-mono-num ${
        positive
          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
          : 'bg-red-50 dark:bg-red-950/50 text-[#DC2626]'
      }`}
    >
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {positive ? `+${deltaPct}%` : `${deltaPct}%`}
    </span>
  );
}

function getDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPresetBounds(preset: PresetRange): { fromMs: number; toMs: number } {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  if (preset === 'today') return { fromMs: startOfToday, toMs: endOfToday };
  if (preset === 'yesterday') {
    const startYest = startOfToday - 24 * 60 * 60 * 1000;
    return { fromMs: startYest, toMs: startOfToday - 1 };
  }
  if (preset === '7d') return { fromMs: startOfToday - 6 * 24 * 60 * 60 * 1000, toMs: endOfToday };
  if (preset === '90d') return { fromMs: startOfToday - 89 * 24 * 60 * 60 * 1000, toMs: endOfToday };
  return { fromMs: startOfToday - 29 * 24 * 60 * 60 * 1000, toMs: endOfToday };
}

// =========================================================================
// 1. DAILY & PERIOD ANALYTICS PANEL
// =========================================================================

interface AdminDailyAnalyticsPanelProps {
  lang: Language;
  apps?: MobileAppItem[];
  games?: GameItem[];
  onError?: (msg: string) => void;
}

export function AdminDailyAnalyticsPanel({
  lang,
  apps = EMPTY_APPS,
  games = EMPTY_GAMES,
  onError,
}: AdminDailyAnalyticsPanelProps) {
  const [preset, setPreset] = useState<PresetRange>('30d');
  const [customFrom, setCustomFrom] = useState(() => getDateInputValue(Date.now() - 29 * 86400000));
  const [customTo, setCustomTo] = useState(() => getDateInputValue(Date.now()));
  const [compare, setCompare] = useState(true);
  const [metric, setMetric] = useState<ChartMetricKey>('uniqueVisitors');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminAnalyticsPayload | null>(null);

  const loadRange = useCallback(
    async (fromMs: number, toMs: number, cmp: boolean) => {
      setLoading(true);
      try {
        const res = await adminFetchAnalytics(fromMs, toMs, cmp);
        setData(res);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Failed to load analytics.');
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  useEffect(() => {
    if (preset === 'custom') return;
    const { fromMs, toMs } = getPresetBounds(preset);
    void loadRange(fromMs, toMs, compare);
  }, [preset, compare, loadRange]);

  const applyCustomRange = () => {
    const f = Date.parse(`${customFrom}T00:00:00`);
    const t = Date.parse(`${customTo}T23:59:59.999`);
    if (!Number.isFinite(f) || !Number.isFinite(t) || f > t) {
      onError?.('Please choose a valid From and To date range.');
      return;
    }
    setPreset('custom');
    void loadRange(f, t, compare);
  };

  const appNameMap = useMemo(() => {
    const m = new Map<string, string>();
    apps.forEach((a) => m.set(a.id, a.name));
    games.forEach((g) => m.set(g.id, lang === 'bn' ? g.titleBn : g.titleEn));
    return m;
  }, [apps, games, lang]);

  const series = data?.dailySeries || [];
  const metricValues = useMemo(
    () =>
      series.map((d) => {
        const val = d[metric] ?? (metric === 'downloadClicks' ? d.downloads : 0) ?? 0;
        return Number(val) || 0;
      }),
    [series, metric]
  );
  const maxChartVal = Math.max(1, ...metricValues);

  const ov = data?.overview;
  const cmp = data?.comparisonSummary;
  const totalDevices =
    (data?.deviceSplit.mobile || 0) + (data?.deviceSplit.tablet || 0) + (data?.deviceSplit.desktop || 0);

  return (
    <div className="space-y-5 text-xs">
      {/* Range Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['today', 'Today', 'আজ'],
              ['yesterday', 'Yesterday', 'গতকাল'],
              ['7d', 'Last 7d', '৭ দিন'],
              ['30d', 'Last 30d', '৩০ দিন'],
              ['90d', 'Last 90d', '৯০ দিন'],
            ] as const
          ).map(([key, en, bn]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors ${
                preset === key
                  ? 'bg-[#FF8500] text-white'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-300 hover:border-[#FF8500]'
              }`}
            >
              {lang === 'bn' ? bn : en}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#F3F6FF] dark:bg-slate-800 px-2.5 py-1.5 rounded-xl border border-[#E6ECFA] dark:border-slate-700">
            <Calendar className="w-3.5 h-3.5 text-[#FF8500]" />
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-transparent text-xs font-mono-num outline-none"
            />
            <span className="text-slate-400">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-transparent text-xs font-mono-num outline-none"
            />
            <button
              type="button"
              onClick={applyCustomRange}
              className="px-2 py-0.5 rounded-lg bg-[#172033] text-white font-bold text-[11px]"
            >
              Apply
            </button>
          </div>

          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="accent-[#FF8500] w-3.5 h-3.5"
            />
            <span>Compare prev. period</span>
          </label>

          <button
            type="button"
            onClick={() => {
              if (preset === 'custom') applyCustomRange();
              else {
                const { fromMs, toMs } = getPresetBounds(preset);
                void loadRange(fromMs, toMs, compare);
              }
            }}
            className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#FF8500] ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Period Comparison Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'আজ বনাম গতকাল ভিজিটর' : 'Visitors Today vs Yesterday'}
            </span>
            {ov && ov.visitorsYesterday > 0
              ? formatDeltaBadge(Math.round(((ov.visitorsToday - ov.visitorsYesterday) / ov.visitorsYesterday) * 100))
              : null}
          </div>
          <p className="text-xl font-extrabold font-mono-num tabular-nums text-[#172033] dark:text-slate-100">
            {(ov?.visitorsToday ?? 0).toLocaleString()}
            <span className="text-xs font-semibold text-[#777777] ml-1.5">
              / {(ov?.visitorsYesterday ?? 0).toLocaleString()} yest.
            </span>
          </p>
          <p className="text-[11px] font-mono-num text-[#777777]">
            {(ov?.visitorsTodayPageViews ?? 0).toLocaleString()} page views today ·{' '}
            {(ov?.visitorsYesterdayPageViews ?? 0).toLocaleString()} yesterday
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'রেঞ্জ ইউনিক ভিজিটর' : 'Unique Visitors (Range)'}
            </span>
            {cmp ? formatDeltaBadge(cmp.deltasPct.uniqueVisitors) : null}
          </div>
          <p className="text-xl font-extrabold font-mono-num tabular-nums text-[#FF8500]">
            {(ov?.uniqueVisitorsInRange ?? data?.kpis.uniqueVisitors ?? 0).toLocaleString()}
          </p>
          <p className="text-[11px] font-mono-num text-[#777777]">
            {(ov?.returningVisitorsInRange ?? 0).toLocaleString()} returning · {(ov?.visitorsThisMonth ?? 0).toLocaleString()} this month
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'ডাউনলোড ও প্লে ক্লিক' : 'Download & Play Clicks'}
            </span>
            {cmp ? formatDeltaBadge(cmp.deltasPct.downloadClicks) : null}
          </div>
          <p className="text-xl font-extrabold font-mono-num tabular-nums text-emerald-600 dark:text-emerald-400">
            {(ov?.totalDownloadClicks ?? data?.kpis.totalDownloads ?? 0).toLocaleString()}
            <span className="text-xs font-semibold text-[#777777] ml-1.5">
              + {(ov?.totalPlayClicks ?? 0).toLocaleString()} play
            </span>
          </p>
          <p className="text-[11px] font-mono-num text-[#777777]">
            {(ov?.todayDownloadClicks ?? data?.kpis.todayDownloads ?? 0).toLocaleString()} today ·{' '}
            {(ov?.totalExternalClicks ?? 0).toLocaleString()} external links
          </p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'পেইজ ভিউ ও অর্ডার' : 'Page Views & Orders'}
            </span>
            {cmp ? formatDeltaBadge(cmp.deltasPct.pageViews) : null}
          </div>
          <p className="text-xl font-extrabold font-mono-num tabular-nums text-[#172033] dark:text-slate-100">
            {(ov?.totalPageViews ?? 0).toLocaleString()}
            <span className="text-xs font-semibold text-[#FF8500] ml-1.5">
              · {(ov?.ordersInRange ?? 0).toLocaleString()} orders
            </span>
          </p>
          <p className="text-[11px] font-mono-num text-[#777777]">
            {ov?.totalAppViews ?? 0} apps · {ov?.totalGameViews ?? 0} games · {ov?.totalServiceViews ?? ov?.totalProductViews ?? 0} services
          </p>
        </div>
      </div>

      {/* Interactive SVG Daily Trend Chart */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'দৈনিক ট্রাফিক ও অ্যাক্টিভিটি চার্ট' : 'Daily Traffic & Engagement Trend'}
            </h3>
            <p className="text-[11px] text-[#777777] dark:text-slate-400">
              Real database events across {series.length} day(s)
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['uniqueVisitors', 'Unique Visitors'],
                ['visitors', 'Total Sessions'],
                ['pageViews', 'Page Views'],
                ['appViews', 'App Views'],
                ['gameViews', 'Game Views'],
                ['downloadClicks', 'Downloads'],
                ['playClicks', 'Play Clicks'],
                ['orders', 'Orders'],
              ] as Array<[ChartMetricKey, string]>
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMetric(k)}
                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] ${
                  metric === k
                    ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                    : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#777777] dark:text-slate-300'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {series.length === 0 ? (
          <div className="py-12 text-center text-[#777777]">
            {loading ? 'Loading chart data...' : 'No recorded events in selected date range.'}
          </div>
        ) : (
          <div className="relative">
            {hoveredIdx !== null && series[hoveredIdx] && (
              <div className="mb-2 px-3 py-1.5 rounded-xl bg-[#172033] text-white text-[11px] font-mono-num inline-flex flex-wrap items-center gap-3">
                <span className="font-bold text-[#FF8500]">{series[hoveredIdx].date}</span>
                <span>Unique: {series[hoveredIdx].uniqueVisitors}</span>
                <span>Views: {series[hoveredIdx].pageViews}</span>
                <span>Apps: {series[hoveredIdx].appViews ?? 0}</span>
                <span>Games: {series[hoveredIdx].gameViews ?? 0}</span>
                <span>Downloads: {series[hoveredIdx].downloadClicks ?? series[hoveredIdx].downloads}</span>
                <span>Orders: {series[hoveredIdx].orders ?? 0}</span>
              </div>
            )}
            <div className="w-full overflow-x-auto">
              <svg
                viewBox={`0 0 ${Math.max(560, series.length * 26)} 180`}
                className="w-full min-w-[520px] h-44 select-none"
                role="img"
                aria-label="Daily analytics bar chart"
              >
                {[0.25, 0.5, 0.75, 1].map((frac) => (
                  <line
                    key={frac}
                    x1="0"
                    x2={Math.max(560, series.length * 26)}
                    y1={148 - frac * 124}
                    y2={148 - frac * 124}
                    stroke="currentColor"
                    strokeOpacity="0.08"
                    strokeDasharray="3 3"
                  />
                ))}
                {series.map((d, idx) => {
                  const totalW = Math.max(560, series.length * 26);
                  const step = totalW / series.length;
                  const barW = Math.max(6, Math.min(20, step * 0.65));
                  const x = idx * step + (step - barW) / 2;
                  const val = metricValues[idx] || 0;
                  const barH = Math.max(val > 0 ? 4 : 1, (val / maxChartVal) * 124);
                  const y = 148 - barH;
                  const active = hoveredIdx === idx;
                  return (
                    <g
                      key={d.date}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barH}
                        rx={3}
                        fill={active ? '#172033' : '#FF8500'}
                        fillOpacity={val > 0 ? (active ? 1 : 0.85) : 0.15}
                      />
                      {(series.length <= 14 || idx % Math.ceil(series.length / 8) === 0 || idx === series.length - 1) && (
                        <text
                          x={x + barW / 2}
                          y={166}
                          textAnchor="middle"
                          fontSize="9"
                          fill="currentColor"
                          opacity="0.6"
                        >
                          {d.date.slice(5)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Breakdown Grid: Devices / Browsers / OS / Countries / Traffic Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Device Split */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
          <h4 className="font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-[#FF8500]" />
            Device Breakdown
          </h4>
          {(
            [
              ['Mobile', data?.deviceSplit.mobile || 0, Smartphone],
              ['Tablet', data?.deviceSplit.tablet || 0, Tablet],
              ['Desktop', data?.deviceSplit.desktop || 0, Monitor],
            ] as const
          ).map(([lbl, count, Icon]) => {
            const pct = totalDevices > 0 ? Math.round((count / totalDevices) * 100) : 0;
            return (
              <div key={lbl} className="space-y-1">
                <div className="flex items-center justify-between font-mono-num">
                  <span className="inline-flex items-center gap-1.5 font-bold">
                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                    {lbl}
                  </span>
                  <span>
                    {count.toLocaleString()} ({pct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#F3F6FF] dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-[#FF8500] rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Top Browsers & OS */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
          <h4 className="font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-[#FF8500]" />
            Browsers &amp; Operating Systems
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-[#777777]">Browsers</p>
              {(data?.browserSplit || []).length === 0 ? (
                <p className="text-[11px] text-[#777777]">No data</p>
              ) : (
                (data?.browserSplit || []).slice(0, 5).map((b) => (
                  <div key={b.name} className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="truncate">{b.name}</span>
                    <strong>{b.count}</strong>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-[#777777]">OS</p>
              {(data?.osSplit || []).length === 0 ? (
                <p className="text-[11px] text-[#777777]">No data</p>
              ) : (
                (data?.osSplit || []).slice(0, 5).map((o) => (
                  <div key={o.name} className="flex items-center justify-between text-[11px] font-mono-num">
                    <span className="truncate">{o.name}</span>
                    <strong>{o.count}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Traffic Sources & Countries */}
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
          <h4 className="font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <ExternalLink className="w-4 h-4 text-[#FF8500]" />
            Traffic Sources &amp; Regions
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-[#777777]">Referrers</p>
              {(data?.trafficSources || []).slice(0, 5).map((s) => (
                <div key={s.source} className="flex items-center justify-between text-[11px] font-mono-num gap-1">
                  <span className="truncate">{s.source}</span>
                  <strong>{s.visits}</strong>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase text-[#777777]">Country</p>
              {(data?.countrySplit || []).length === 0 ? (
                <p className="text-[11px] text-[#777777]">Local / Unknown</p>
              ) : (
                (data?.countrySplit || []).slice(0, 5).map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-[11px] font-mono-num gap-1">
                    <span className="truncate">{c.name}</span>
                    <strong>{c.count}</strong>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Top Pages & Top Apps/Games */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="font-extrabold text-[#172033] dark:text-slate-100">Most Visited Pages</h4>
          {(data?.topPages || []).length === 0 ? (
            <p className="text-[#777777] py-4 text-center">No page views recorded in range.</p>
          ) : (
            <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {(data?.topPages || []).slice(0, 10).map((pg) => (
                <div key={pg.path} className="py-2 flex items-center justify-between gap-2 font-mono-num">
                  <span className="truncate font-bold text-[#172033] dark:text-slate-200">{pg.path}</span>
                  <span className="px-2 py-0.5 rounded-md bg-[#F3F6FF] dark:bg-slate-800 font-extrabold text-[#FF8500]">
                    {pg.views.toLocaleString()} views
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5">
          <h4 className="font-extrabold text-[#172033] dark:text-slate-100">Top Download Clicks</h4>
          {(data?.topApps || []).length === 0 ? (
            <p className="text-[#777777] py-4 text-center">No download click events recorded yet.</p>
          ) : (
            <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {(data?.topApps || []).slice(0, 10).map((item) => (
                <div key={item.appId} className="py-2 flex items-center justify-between gap-2">
                  <span className="truncate font-bold text-[#172033] dark:text-slate-200">
                    {appNameMap.get(item.appId) || item.appId}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-mono-num font-extrabold">
                    {item.downloads.toLocaleString()} clicks
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 2. LIVE VISITORS MONITOR PANEL
// =========================================================================

interface AdminLiveVisitorsPanelProps {
  lang: Language;
  onError?: (msg: string) => void;
}

export function AdminLiveVisitorsPanel({ lang, onError }: AdminLiveVisitorsPanelProps) {
  const [data, setData] = useState<AdminAnalyticsPayload | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);

  const loadLive = useCallback(async () => {
    setLoading(true);
    try {
      const now = Date.now();
      const res = await adminFetchAnalytics(now - 24 * 60 * 60 * 1000, now, false);
      setData(res);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to load live visitor feed.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      void loadLive();
    }, 15000);
    return () => clearInterval(timer);
  }, [autoRefresh, loadLive]);

  const live = data?.liveVisitors;
  const activeCount = live?.activeCount ?? data?.kpis.onlineUsers ?? 0;

  return (
    <div className="space-y-5 text-xs">
      {/* Live Status Hero Strip */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center shrink-0">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                {lang === 'bn' ? 'রিয়েল-টাইম ভিজিটর মনিটর (গত ৫ মিনিট)' : 'Live Active Visitors (5-Minute Window)'}
              </span>
            </div>
            <p className="text-3xl font-extrabold font-mono-num tabular-nums text-[#172033] dark:text-slate-100 mt-0.5">
              {activeCount.toLocaleString()}
              <span className="text-xs font-semibold text-[#777777] ml-2">
                {lang === 'bn' ? 'সক্রিয় ভিজিটর অনলাইন' : 'active session(s)'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-[#FF8500] w-4 h-4"
            />
            <span>Auto-refresh (15s)</span>
          </label>
          <button
            type="button"
            onClick={() => void loadLive()}
            className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Now
          </button>
        </div>
      </div>

      {/* Active Sessions Table (Non-PII) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#FF8500]" />
            Active Visitor Sessions ({live?.activeSessions.length ?? 0})
          </h3>
          <span className="text-[11px] text-[#777777]">Privacy-safe anonymous session tracking</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-2.5 px-4 font-bold">Session</th>
                <th className="py-2.5 px-4 font-bold">Current Page</th>
                <th className="py-2.5 px-4 font-bold">Last Event</th>
                <th className="py-2.5 px-4 font-bold">Device / Browser / OS</th>
                <th className="py-2.5 px-4 font-bold">Source / Country</th>
                <th className="py-2.5 px-4 font-bold text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {(live?.activeSessions || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#777777]">
                    No active visitor sessions within the last 5 minutes.
                  </td>
                </tr>
              ) : (
                (live?.activeSessions || []).map((s) => (
                  <tr key={s.sessionId} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono-num">
                      <p className="font-bold text-[#172033] dark:text-slate-100">
                        {s.isMember ? 'Member' : 'Guest'} · {s.visitorId.slice(0, 10)}
                      </p>
                      <p className="text-[10px] text-[#777777]">
                        {s.isReturning ? `Returning (${s.visitCount} visits)` : 'New visitor'}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 font-mono-num font-bold text-[#FF8500] max-w-[200px] truncate">
                      {s.currentPage || '/'}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num font-bold text-[10px]">
                        {s.lastEventType}
                      </span>
                      {s.lastContentId ? (
                        <p className="text-[10px] text-[#777777] font-mono-num mt-0.5">{s.lastContentId}</p>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-bold capitalize">{s.deviceType}</p>
                      <p className="text-[10px] text-[#777777]">
                        {s.browser} · {s.os}
                      </p>
                    </td>
                    <td className="py-2.5 px-4 text-[11px]">
                      <p className="font-bold">{s.referrerHost || 'direct'}</p>
                      <p className="text-[10px] text-[#777777]">{s.country || 'Unknown'}</p>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-[#777777] whitespace-nowrap">
                      {formatDateShort(s.lastSeenAt, lang)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Event Stream */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#FF8500]" />
          Recent Live Activity Feed
        </h3>
        {(live?.recentEvents || []).length === 0 ? (
          <p className="text-[#777777] py-4 text-center">No recent events recorded.</p>
        ) : (
          <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
            {(live?.recentEvents || []).slice(0, 30).map((ev) => (
              <div key={ev.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500] font-mono-num font-bold text-[10px] shrink-0">
                    {ev.eventType}
                  </span>
                  <span className="font-mono-num font-bold text-[#172033] dark:text-slate-100 truncate">
                    {ev.pagePath || '/'}
                  </span>
                  {ev.contentId ? (
                    <span className="text-[11px] font-mono-num text-[#777777] truncate">
                      ({ev.contentType || 'item'}: {ev.contentId})
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono-num text-[#777777] shrink-0">
                  <span className="capitalize">{ev.deviceType}</span>
                  <span>·</span>
                  <span>{ev.browser}</span>
                  <span>·</span>
                  <span>{new Date(ev.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// 3. CONTENT VIEWS & PERFORMANCE STATISTICS PANEL
// =========================================================================

type SortColumn =
  | 'totalViews'
  | 'uniqueViews'
  | 'viewsToday'
  | 'viewsYesterday'
  | 'views7d'
  | 'downloadClicks'
  | 'ordersCount'
  | 'conversionRate';

interface AdminContentStatsPanelProps {
  lang: Language;
  products?: Product[];
  apps?: MobileAppItem[];
  games?: GameItem[];
  onError?: (msg: string) => void;
}

export function AdminContentStatsPanel({
  lang,
  products = EMPTY_PRODUCTS,
  apps = EMPTY_APPS,
  games = EMPTY_GAMES,
  onError,
}: AdminContentStatsPanelProps) {
  const [data, setData] = useState<AdminAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | 'app' | 'game' | 'service'>('all');
  const [catFilter, setCatFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<SortColumn>('totalViews');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetchAnalytics(undefined, undefined, false);
      setData(res);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to load content stats.');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const statMap = new Map<string, NonNullable<AdminAnalyticsPayload['contentStats']>[number]>();
    (data?.contentStats || []).forEach((s) => statMap.set(`${s.contentType}:${s.id}`, s));

    const unified: Array<{
      uid: string;
      id: string;
      title: string;
      contentType: 'app' | 'game' | 'service';
      category: string;
      totalViews: number;
      uniqueViews: number;
      viewsToday: number;
      viewsYesterday: number;
      views7d: number;
      views30d: number;
      downloadClicks: number;
      playClicks: number;
      externalClicks: number;
      favoritesCount: number;
      ordersCount: number;
      conversionRate: number;
      lastViewedAt: number;
    }> = [];

    apps.forEach((a) => {
      const s = statMap.get(`app:${a.id}`);
      const catMeta = MOBILE_APP_CATEGORIES.find((c) => c.id === a.category);
      unified.push({
        uid: `app:${a.id}`,
        id: a.id,
        title: a.name,
        contentType: 'app',
        category: catMeta ? catMeta.labelEn : a.category,
        totalViews: s?.totalViews ?? 0,
        uniqueViews: s?.uniqueViews ?? 0,
        viewsToday: s?.viewsToday ?? 0,
        viewsYesterday: s?.viewsYesterday ?? 0,
        views7d: s?.views7d ?? 0,
        views30d: s?.views30d ?? 0,
        downloadClicks: s?.downloadClicks ?? 0,
        playClicks: s?.playClicks ?? 0,
        externalClicks: s?.externalClicks ?? 0,
        favoritesCount: s?.favoritesCount ?? 0,
        ordersCount: s?.ordersCount ?? 0,
        conversionRate: s?.conversionRate ?? 0,
        lastViewedAt: s?.lastViewedAt ?? 0,
      });
    });

    games.forEach((g) => {
      const s = statMap.get(`game:${g.id}`);
      const catMeta = GAME_CATEGORIES.find((c) => c.id === g.category);
      unified.push({
        uid: `game:${g.id}`,
        id: g.id,
        title: lang === 'bn' ? g.titleBn : g.titleEn,
        contentType: 'game',
        category: catMeta ? catMeta.labelEn : g.category,
        totalViews: s?.totalViews ?? 0,
        uniqueViews: s?.uniqueViews ?? 0,
        viewsToday: s?.viewsToday ?? 0,
        viewsYesterday: s?.viewsYesterday ?? 0,
        views7d: s?.views7d ?? 0,
        views30d: s?.views30d ?? 0,
        downloadClicks: s?.downloadClicks ?? 0,
        playClicks: s?.playClicks ?? 0,
        externalClicks: s?.externalClicks ?? 0,
        favoritesCount: s?.favoritesCount ?? 0,
        ordersCount: s?.ordersCount ?? 0,
        conversionRate: s?.conversionRate ?? 0,
        lastViewedAt: s?.lastViewedAt ?? 0,
      });
    });

    products.forEach((p) => {
      const s = statMap.get(`service:${p.id}`);
      unified.push({
        uid: `service:${p.id}`,
        id: p.id,
        title: lang === 'bn' ? p.titleBn : p.titleEn,
        contentType: 'service',
        category: p.categoryId,
        totalViews: s?.totalViews ?? 0,
        uniqueViews: s?.uniqueViews ?? 0,
        viewsToday: s?.viewsToday ?? 0,
        viewsYesterday: s?.viewsYesterday ?? 0,
        views7d: s?.views7d ?? 0,
        views30d: s?.views30d ?? 0,
        downloadClicks: s?.downloadClicks ?? 0,
        playClicks: s?.playClicks ?? 0,
        externalClicks: s?.externalClicks ?? 0,
        favoritesCount: s?.favoritesCount ?? 0,
        ordersCount: s?.ordersCount ?? 0,
        conversionRate: s?.conversionRate ?? 0,
        lastViewedAt: s?.lastViewedAt ?? 0,
      });
    });

    return unified;
  }, [apps, games, products, data, lang]);

  const categoriesList = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      if (typeFilter === 'all' || r.contentType === typeFilter) s.add(r.category);
    });
    return Array.from(s).sort();
  }, [rows, typeFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (typeFilter !== 'all' && r.contentType !== typeFilter) return false;
        if (catFilter !== 'all' && r.category !== catFilter) return false;
        if (!q) return true;
        return r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.category.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const diff = (a[sortCol] || 0) - (b[sortCol] || 0);
        return sortAsc ? diff : -diff;
      });
  }, [rows, typeFilter, catFilter, search, sortCol, sortAsc]);

  const leaders = useMemo(() => {
    const topAppViews = [...rows].filter((r) => r.contentType === 'app').sort((a, b) => b.totalViews - a.totalViews)[0];
    const topAppDownloads = [...rows].filter((r) => r.contentType === 'app').sort((a, b) => b.downloadClicks - a.downloadClicks)[0];
    const topGameViews = [...rows].filter((r) => r.contentType === 'game').sort((a, b) => b.totalViews - a.totalViews)[0];
    const topServiceViews = [...rows].filter((r) => r.contentType === 'service').sort((a, b) => b.totalViews - a.totalViews)[0];
    return { topAppViews, topAppDownloads, topGameViews, topServiceViews };
  }, [rows]);

  const toggleSort = (col: SortColumn) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Top Performers Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: 'Most Viewed App',
            item: leaders.topAppViews,
            metric: `${leaders.topAppViews?.totalViews ?? 0} views`,
            icon: Smartphone,
          },
          {
            label: 'Most Downloaded App',
            item: leaders.topAppDownloads,
            metric: `${leaders.topAppDownloads?.downloadClicks ?? 0} clicks`,
            icon: Download,
          },
          {
            label: 'Most Viewed Game',
            item: leaders.topGameViews,
            metric: `${leaders.topGameViews?.totalViews ?? 0} views`,
            icon: Gamepad2,
          },
          {
            label: 'Most Viewed Service',
            item: leaders.topServiceViews,
            metric: `${leaders.topServiceViews?.totalViews ?? 0} views`,
            icon: Package,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-1"
            >
              <p className="text-[11px] font-semibold text-[#777777] flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-[#FF8500]" />
                {card.label}
              </p>
              <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                {card.item?.title || '—'}
              </p>
              <p className="text-[11px] font-mono-num font-bold text-[#FF8500]">{card.metric}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', `All Items (${rows.length})`],
              ['app', `Apps (${apps.length})`],
              ['game', `Games (${games.length})`],
              ['service', `Services (${products.length})`],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTypeFilter(id);
                setCatFilter('all');
              }}
              className={`px-3 py-1.5 rounded-xl font-bold ${
                typeFilter === id
                  ? 'bg-[#FF8500] text-white'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-300'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter content..."
              className="pl-8 pr-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
          >
            <option value="all">All Categories</option>
            {categoriesList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#FF8500] ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Sortable Content Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">Content Item</th>
                <th className="py-3 px-3 font-bold">Type</th>
                {(
                  [
                    ['totalViews', 'Total Views'],
                    ['uniqueViews', 'Unique'],
                    ['viewsToday', 'Today'],
                    ['viewsYesterday', 'Yesterday'],
                    ['views7d', '7d'],
                    ['downloadClicks', 'DL / Play'],
                    ['ordersCount', 'Orders'],
                    ['conversionRate', 'Conv %'],
                  ] as Array<[SortColumn, string]>
                ).map(([col, label]) => (
                  <th key={col} className="py-3 px-3 font-bold text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort(col)}
                      className="inline-flex items-center gap-1 hover:text-[#FF8500] font-bold uppercase"
                    >
                      {label}
                      {sortCol === col ? (
                        sortAsc ? (
                          <ArrowUp className="w-3 h-3 text-[#FF8500]" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-[#FF8500]" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filtered.slice(0, 120).map((r) => {
                const isExp = expandedId === r.uid;
                return (
                  <>
                    <tr
                      key={r.uid}
                      onClick={() => setExpandedId(isExp ? null : r.uid)}
                      className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <td className="py-2.5 px-4 max-w-[230px]">
                        <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{r.title}</p>
                        <p className="text-[10px] text-[#777777] truncate">{r.category}</p>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] ${
                            r.contentType === 'app'
                              ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-600'
                              : r.contentType === 'game'
                                ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-600'
                                : 'bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500]'
                          }`}
                        >
                          {r.contentType}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums font-extrabold">
                        {r.totalViews.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums">
                        {r.uniqueViews.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums text-[#FF8500] font-bold">
                        {r.viewsToday}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums text-[#777777]">
                        {r.viewsYesterday}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums">{r.views7d}</td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums text-emerald-600 dark:text-emerald-400 font-bold">
                        {r.downloadClicks}
                        {r.playClicks > 0 ? ` / ${r.playClicks}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums">{r.ordersCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono-num tabular-nums font-bold">
                        {r.conversionRate}%
                      </td>
                    </tr>
                    {isExp && (
                      <tr key={`${r.uid}-detail`} className="bg-[#F8FAFF] dark:bg-slate-800/30">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono-num">
                            <span className="inline-flex items-center gap-1">
                              <Eye className="w-3.5 h-3.5 text-[#FF8500]" />
                              30d Views: <strong>{r.views30d}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Play className="w-3.5 h-3.5 text-emerald-600" />
                              Play Clicks: <strong>{r.playClicks}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <ExternalLink className="w-3.5 h-3.5 text-sky-600" />
                              External Clicks: <strong>{r.externalClicks}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Heart className="w-3.5 h-3.5 text-rose-500" />
                              Favorites: <strong>{r.favoritesCount}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <ShoppingBag className="w-3.5 h-3.5 text-[#FF8500]" />
                              Orders: <strong>{r.ordersCount}</strong>
                            </span>
                            <span className="inline-flex items-center gap-1 text-[#777777]">
                              <Sparkles className="w-3.5 h-3.5" />
                              Last Viewed: {r.lastViewedAt ? formatDateShort(r.lastViewedAt, lang) : 'Never'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
