import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Package, Search, ShoppingBag, Users, X } from 'lucide-react';
import { Language, Order, Payment, Product, UserProfile, WalletTransaction } from '../../types/marketplace';

interface AdminGlobalSearchProps {
  lang: Language;
  users: UserProfile[];
  products: Product[];
  orders: Order[];
  walletTxs: WalletTransaction[];
  payments: Payment[];
  onJump: (target: 'users' | 'packages' | 'transactions' | 'storefront', query?: string) => void;
}

export function AdminGlobalSearch({
  lang,
  users,
  products,
  orders,
  walletTxs,
  payments,
  onJump,
}: AdminGlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return null;

    const matchedUsers = users
      .filter(
        (u) =>
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q) ||
          (u.referralCode || '').toLowerCase().includes(q)
      )
      .slice(0, 4);

    const matchedPackages = products
      .filter(
        (p) =>
          p.id.toLowerCase().includes(q) ||
          (p.titleEn || '').toLowerCase().includes(q) ||
          (p.titleBn || '').toLowerCase().includes(q) ||
          (p.badge || '').toLowerCase().includes(q) ||
          String(p.priceBdt).includes(q)
      )
      .slice(0, 4);

    const matchedOrders = orders
      .filter(
        (o) =>
          (o.orderNumber || '').toLowerCase().includes(q) ||
          (o.transactionId || '').toLowerCase().includes(q) ||
          (o.customerName || '').toLowerCase().includes(q) ||
          (o.customerEmail || '').toLowerCase().includes(q) ||
          (o.productTitleEn || '').toLowerCase().includes(q)
      )
      .slice(0, 4);

    const txSeen = new Set<string>();
    const matchedTxs: Array<{ id: string; trxId: string; amountBdt: number; status: string; label: string }> = [];
    for (const tx of walletTxs) {
      if (
        (tx.transactionId || '').toLowerCase().includes(q) ||
        tx.id.toLowerCase().includes(q) ||
        (tx.senderNumber || '').toLowerCase().includes(q)
      ) {
        if (!txSeen.has(tx.transactionId || tx.id)) {
          txSeen.add(tx.transactionId || tx.id);
          matchedTxs.push({
            id: tx.id,
            trxId: tx.transactionId || tx.id,
            amountBdt: tx.amountBdt,
            status: tx.status,
            label: `${tx.type} · ${tx.method}`,
          });
        }
      }
      if (matchedTxs.length >= 4) break;
    }
    if (matchedTxs.length < 4) {
      for (const pay of payments) {
        if (
          (pay.transactionId || '').toLowerCase().includes(q) ||
          (pay.senderNumber || '').toLowerCase().includes(q)
        ) {
          if (!txSeen.has(pay.transactionId)) {
            txSeen.add(pay.transactionId);
            matchedTxs.push({
              id: pay.id,
              trxId: pay.transactionId,
              amountBdt: pay.amountBdt,
              status: pay.status,
              label: `payment · ${pay.method}`,
            });
          }
        }
        if (matchedTxs.length >= 4) break;
      }
    }

    const total =
      matchedUsers.length + matchedPackages.length + matchedOrders.length + matchedTxs.length;

    return {
      total,
      users: matchedUsers,
      packages: matchedPackages,
      orders: matchedOrders,
      txs: matchedTxs,
    };
  }, [query, users, products, orders, walletTxs, payments]);

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md hidden md:block">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={
            lang === 'bn'
              ? 'ইউজার, প্যাকেজ, TrxID বা অর্ডার খুঁজুন...'
              : 'Global search: users, packages, TrxID, orders...'
          }
          className="w-full pl-9 pr-8 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-950 border border-[#E6ECFA] dark:border-slate-800 text-xs text-[#172033] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-[#FF8500]"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && results && (
        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {results.total === 0 ? (
            <p className="p-4 text-xs text-slate-400 text-center">
              No users, packages, TrxIDs, or orders matched "{query}".
            </p>
          ) : (
            <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800 text-xs">
              {results.packages.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Package className="w-3 h-3 text-[#FF8500]" />
                    Packages ({results.packages.length})
                  </p>
                  {results.packages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onJump('packages', p.id);
                      }}
                      className="w-full px-2.5 py-2 rounded-lg hover:bg-[#F3F6FF] dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{p.titleEn}</p>
                        <p className="text-[10px] font-mono-num text-slate-400 truncate">{p.id}</p>
                      </div>
                      <span className="font-mono-num font-extrabold text-[#FF8500] shrink-0">৳{p.priceBdt}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.users.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <Users className="w-3 h-3 text-sky-500" />
                    Users ({results.users.length})
                  </p>
                  {results.users.map((u) => (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onJump('users', u.email || u.phone || u.displayName);
                      }}
                      className="w-full px-2.5 py-2 rounded-lg hover:bg-[#F3F6FF] dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{u.displayName}</p>
                        <p className="text-[10px] font-mono-num text-slate-400 truncate">
                          {u.email || u.phone || u.uid}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 shrink-0">{u.status}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.txs.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-emerald-500" />
                    Transaction IDs ({results.txs.length})
                  </p>
                  {results.txs.map((tx) => (
                    <button
                      key={tx.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onJump('transactions', tx.trxId);
                      }}
                      className="w-full px-2.5 py-2 rounded-lg hover:bg-[#F3F6FF] dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="font-mono-num font-bold text-[#172033] dark:text-slate-100 truncate">
                          {tx.trxId}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">{tx.label}</p>
                      </div>
                      <span className="font-mono-num font-extrabold text-[#FF8500] shrink-0">৳{tx.amountBdt}</span>
                    </button>
                  ))}
                </div>
              )}

              {results.orders.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                    <ShoppingBag className="w-3 h-3 text-amber-500" />
                    Orders ({results.orders.length})
                  </p>
                  {results.orders.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onJump('storefront', o.orderNumber);
                      }}
                      className="w-full px-2.5 py-2 rounded-lg hover:bg-[#F3F6FF] dark:hover:bg-slate-800 flex items-center justify-between gap-2 text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="font-mono-num font-bold text-[#172033] dark:text-slate-100 truncate">
                          #{o.orderNumber} · {o.productTitleEn || o.productId}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {o.customerName || o.customerEmail} · {o.status}
                        </p>
                      </div>
                      <span className="font-mono-num font-extrabold text-[#FF8500] shrink-0">
                        ৳{o.totalPriceBdt}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
