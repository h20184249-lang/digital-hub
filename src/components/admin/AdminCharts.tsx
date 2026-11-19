import { useMemo, useState } from 'react';
import {
  Language,
  Order,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../../types/marketplace';
import { getTimeMs } from '../../lib/firestoreService';

interface AdminChartsProps {
  lang: Language;
  users: UserProfile[];
  wallets: WalletAccount[];
  walletTxs: WalletTransaction[];
  withdrawals: WithdrawalRequest[];
  orders: Order[];
}

export function AdminCharts({
  lang,
  users,
  wallets,
  walletTxs,
  withdrawals,
  orders,
}: AdminChartsProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const dailySeries = useMemo(() => {
    const days: Array<{
      key: string;
      label: string;
      newUsers: number;
      txVolumeBdt: number;
      txCount: number;
    }> = [];
    const now = new Date();
    const map = new Map<string, (typeof days)[number]>();

    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      const label = d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
        month: 'short',
        day: 'numeric',
      });
      const bucket = { key, label, newUsers: 0, txVolumeBdt: 0, txCount: 0 };
      days.push(bucket);
      map.set(key, bucket);
    }

    const toDayKey = (ts: unknown) => {
      const ms = getTimeMs(ts);
      if (!ms) return '';
      const d = new Date(ms);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
    };

    users.forEach((u) => {
      const b = map.get(toDayKey(u.createdAt));
      if (b) b.newUsers += 1;
    });

    walletTxs.forEach((tx) => {
      if (tx.status === 'Rejected') return;
      const b = map.get(toDayKey(tx.createdAt));
      if (b) {
        b.txVolumeBdt += Math.abs(tx.amountBdt || 0);
        b.txCount += 1;
      }
    });

    orders.forEach((o) => {
      if (o.status === 'Cancelled' || o.status === 'Rejected') return;
      const b = map.get(toDayKey(o.createdAt));
      if (b) {
        b.txVolumeBdt += Math.abs(o.totalPriceBdt || 0);
      }
    });

    return days;
  }, [users, walletTxs, orders, lang]);

  const maxVolume = Math.max(100, ...dailySeries.map((d) => d.txVolumeBdt));
  const maxUsers = Math.max(1, ...dailySeries.map((d) => d.newUsers));

  const withdrawalBreakdown = useMemo(() => {
    const statuses: Array<{ status: WithdrawalStatus; label: string; barColor: string; dotColor: string }> = [
      { status: 'Pending', label: 'Pending', barColor: 'bg-amber-500', dotColor: 'text-amber-600 dark:text-amber-400' },
      { status: 'Approved', label: 'Approved', barColor: 'bg-sky-500', dotColor: 'text-sky-600 dark:text-sky-400' },
      { status: 'Processing', label: 'Processing', barColor: 'bg-indigo-500', dotColor: 'text-indigo-600 dark:text-indigo-400' },
      { status: 'Paid', label: 'Paid', barColor: 'bg-emerald-500', dotColor: 'text-emerald-600 dark:text-emerald-400' },
      { status: 'Rejected', label: 'Rejected', barColor: 'bg-rose-500', dotColor: 'text-rose-600 dark:text-rose-400' },
    ];
    const totalCount = withdrawals.length || 1;
    return statuses.map((item) => {
      const matched = withdrawals.filter((w) => w.status === item.status);
      const amount = matched.reduce((s, w) => s + (w.amountBdt || 0), 0);
      return {
        ...item,
        count: matched.length,
        amount,
        pct: Math.round((matched.length / totalCount) * 100),
      };
    });
  }, [withdrawals]);

  const totalWalletLiability = useMemo(
    () => wallets.reduce((s, w) => s + (w.availableBalanceBdt || 0), 0),
    [wallets]
  );

  const completedOrderRevenue = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'Completed' || o.status === 'Paid' || o.status === 'Payment Approved')
        .reduce((s, o) => s + (o.totalPriceBdt || 0), 0),
    [orders]
  );

  const activePoint = hoveredIdx !== null ? dailySeries[hoveredIdx] : dailySeries[dailySeries.length - 1];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* 14-Day Activity & Volume SVG Chart */}
      <div className="xl:col-span-2 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? '১৪ দিনের ইউজার ও লেনদেন প্রবাহ' : '14-Day Activity & Transaction Volume'}
            </h3>
            <p className="text-xs text-[#777777] dark:text-slate-400">
              {lang === 'bn'
                ? 'ডাটাবেস থেকে রিয়েল রেজিস্ট্রেশন ও লেনদেন ভলিউম'
                : 'Real database registrations and wallet/order volume'}
            </p>
          </div>
          {activePoint && (
            <div className="flex items-center gap-4 text-xs bg-[#F3F6FF] dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-[#E6ECFA] dark:border-slate-700">
              <span className="font-bold text-[#172033] dark:text-slate-200">{activePoint.label}</span>
              <span className="font-mono-num font-bold text-[#FF8500]">
                ৳{activePoint.txVolumeBdt.toLocaleString()}
              </span>
              <span className="font-mono-num font-bold text-emerald-600 dark:text-emerald-400">
                +{activePoint.newUsers} {lang === 'bn' ? 'ইউজার' : 'users'}
              </span>
            </div>
          )}
        </div>

        <div className="w-full overflow-x-auto">
          <svg
            viewBox="0 0 640 200"
            className="w-full min-w-[460px] h-48 select-none"
            role="img"
            aria-label="14-day registrations and volume chart"
          >
            {/* Horizontal grid lines */}
            {[0, 1, 2, 3].map((step) => {
              const y = 16 + step * 48;
              return (
                <line
                  key={step}
                  x1="12"
                  y1={y}
                  x2="628"
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-200 dark:text-slate-800"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
              );
            })}

            {/* Bars for Volume & Dots/Line for New Users */}
            {dailySeries.map((pt, idx) => {
              const colWidth = 616 / dailySeries.length;
              const cx = 12 + idx * colWidth + colWidth / 2;
              const barH = Math.max(4, Math.round((pt.txVolumeBdt / maxVolume) * 136));
              const barY = 160 - barH;
              const isHover = hoveredIdx === idx;
              return (
                <g
                  key={pt.key}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={cx - 12}
                    y={barY}
                    width="24"
                    height={barH}
                    rx="6"
                    className={
                      isHover
                        ? 'fill-[#FF8500]'
                        : 'fill-[#FF8500]/30 dark:fill-[#FF8500]/35 transition-colors'
                    }
                  />
                  {idx % 2 === 0 || idx === dailySeries.length - 1 ? (
                    <text
                      x={cx}
                      y="184"
                      textAnchor="middle"
                      className="fill-slate-500 dark:fill-slate-400 text-[10px] font-semibold"
                    >
                      {pt.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            {/* Registration trend polyline */}
            <polyline
              fill="none"
              stroke="#10B981"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={dailySeries
                .map((pt, idx) => {
                  const colWidth = 616 / dailySeries.length;
                  const cx = 12 + idx * colWidth + colWidth / 2;
                  const cy = 152 - Math.round((pt.newUsers / maxUsers) * 116);
                  return `${cx},${cy}`;
                })
                .join(' ')}
            />
            {dailySeries.map((pt, idx) => {
              const colWidth = 616 / dailySeries.length;
              const cx = 12 + idx * colWidth + colWidth / 2;
              const cy = 152 - Math.round((pt.newUsers / maxUsers) * 116);
              return (
                <circle
                  key={`dot_${pt.key}`}
                  cx={cx}
                  cy={cy}
                  r={hoveredIdx === idx ? 5 : 3.2}
                  fill="#10B981"
                  stroke="#FFFFFF"
                  strokeWidth="1.5"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-[11px] font-semibold text-[#777777] dark:text-slate-400 pt-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2 rounded-xs bg-[#FF8500]/60" />
            {lang === 'bn' ? 'দৈনিক লেনদেন ভলিউম (৳)' : 'Daily Transaction Volume (BDT)'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-emerald-500" />
            {lang === 'bn' ? 'নতুন ইউজার রেজিস্ট্রেশন' : 'New User Registrations'}
          </span>
        </div>
      </div>

      {/* Withdrawal Pipeline & Liquidity Breakdown */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 flex flex-col justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'উইথড্রয়াল ও ব্যালেন্স অবস্থা' : 'Withdrawal Pipeline & Balances'}
          </h3>
          <p className="text-xs text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? `${withdrawals.length}টি মোট উইথড্র রিকোয়েস্টের স্ট্যাটাস ব্রেকডাউন`
              : `Status distribution across ${withdrawals.length} total requests`}
          </p>
        </div>

        {/* Stacked proportional bar */}
        <div className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
          {withdrawalBreakdown.map((item) =>
            item.count > 0 ? (
              <div
                key={item.status}
                style={{ width: `${Math.max(4, item.pct)}%` }}
                className={`${item.barColor} h-full`}
                title={`${item.label}: ${item.count} (৳${item.amount})`}
              />
            ) : null
          )}
        </div>

        <div className="space-y-2.5">
          {withdrawalBreakdown.map((item) => (
            <div key={item.status} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${item.barColor}`} />
                <span className="font-semibold text-[#172033] dark:text-slate-200">{item.label}</span>
              </div>
              <div className="flex items-center gap-3 font-mono-num">
                <span className={`font-bold ${item.dotColor}`}>{item.count}</span>
                <span className="text-[#777777] dark:text-slate-400 min-w-[74px] text-right">
                  ৳{item.amount.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[#E6ECFA] dark:border-slate-800 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[11px] text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'ইউজার ওয়ালেট ব্যালেন্স' : 'Total User Wallets'}
            </p>
            <p className="text-base font-extrabold font-mono-num text-[#172033] dark:text-slate-100">
              ৳{totalWalletLiability.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'অর্ডার সেলস' : 'Order Sales'}
            </p>
            <p className="text-base font-extrabold font-mono-num text-emerald-600 dark:text-emerald-400">
              ৳{completedOrderRevenue.toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
