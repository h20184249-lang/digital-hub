import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Megaphone,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  AdPlacementSlot,
  Language,
  ManagedAdUnitConfig,
  ManagedAdUnitStatus,
} from '../types/marketplace';
import { AD_PLACEMENT_LABELS } from '../lib/adProviderConfig';
import { resolveAdBrowserUrl, tryAcquireAdLaunchLock } from '../lib/adNavigation';
import { apiUrl } from '../lib/apiClient';

function getAdSessionId(): string {
  try {
    let sid = sessionStorage.getItem('dh_ad_sid');
    if (!sid) {
      sid = `sid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('dh_ad_sid', sid);
    }
    return sid;
  } catch {
    return 'sid_mem';
  }
}

export interface ManagedUnitRuntimeStatus {
  status: ManagedAdUnitStatus;
  error?: string;
  updatedAt: string;
}

// Global live telemetry store for Admin Dashboard Unit Status Monitor (in-memory runtime status)
const runtimeUnitStatuses = new Map<string, ManagedUnitRuntimeStatus>();
const statusListeners = new Set<() => void>();

export function reportManagedUnitStatus(
  unitId: string,
  status: ManagedAdUnitStatus,
  error?: string
): void {
  runtimeUnitStatuses.set(unitId, {
    status,
    error,
    updatedAt: new Date().toISOString(),
  });
  statusListeners.forEach((fn) => fn());
}

export function getManagedUnitStatusSnapshot(): Record<string, ManagedUnitRuntimeStatus> {
  return Object.fromEntries(runtimeUnitStatuses.entries());
}

export function subscribeManagedUnitStatuses(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

async function trackUnitEvent(
  unitId: string,
  type: 'impression' | 'click',
  placement: string,
  adFormat: string
) {
  try {
    await fetch(apiUrl('/api/ads/track'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adId: unitId,
        type,
        placement,
        adFormat,
        sessionId: getAdSessionId(),
      }),
    });
  } catch {
    // Non-fatal
  }
}

function buildSandboxedSrcDoc(unit: ManagedAdUnitConfig, slot: AdPlacementSlot, retryNonce: number): string {
  // Runs in an isolated null-origin sandboxed iframe with NO access to parent localStorage, cookies, Firebase tokens, or DOM.
  const safeId = JSON.stringify(unit.id);
  const safeSlot = JSON.stringify(slot);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="dh-attempt" content="${retryNonce}" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    font-family: system-ui, -apple-system, sans-serif;
  }
</style>
</head>
<body>
${unit.rawScriptHtml}
<script>
(function() {
  var unitId = ${safeId};
  var slot = ${safeSlot};
  var settled = false;
  function send(status, err) {
    if (settled && status === 'loaded') return;
    if (status === 'loaded' || status === 'error' || status === 'blocked') {
      settled = true;
    }
    try {
      window.parent.postMessage({ type: 'dh_ad_unit_status', unitId: unitId, slot: slot, status: status, error: err || '' }, '*');
    } catch (e) {}
  }
  window.addEventListener('error', function(ev) {
    send('error', (ev && ev.message) || 'Script runtime error');
  }, true);
  function inspectRendered(isFinal) {
    if (settled) return;
    var hasRendered = false;
    var nodes = document.body ? document.body.children : [];
    for (var i = 0; i < nodes.length; i++) {
      var tag = nodes[i].tagName;
      if (tag && tag !== 'SCRIPT') {
        var r = nodes[i].getBoundingClientRect();
        if (r.width > 8 && r.height > 8) { hasRendered = true; break; }
        if (nodes[i].innerHTML && nodes[i].innerHTML.trim().length > 0) { hasRendered = true; break; }
      }
    }
    if (hasRendered) {
      send('loaded', '');
    } else if (isFinal) {
      send('blocked', 'Ad script did not render or was blocked by network/adblocker');
    }
  }
  setTimeout(function() { inspectRendered(false); }, 1600);
  setTimeout(function() { inspectRendered(false); }, 3400);
  setTimeout(function() { inspectRendered(true); }, 5800);
})();
</script>
</body>
</html>`;
}

export function AdUnitCardOrBanner({
  unit,
  slot,
  lang,
  onStatusChange,
}: {
  unit: ManagedAdUnitConfig;
  slot: AdPlacementSlot;
  lang: Language;
  onStatusChange?: (unitId: string, status: ManagedAdUnitStatus, err?: string) => void;
}) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [status, setStatus] = useState<ManagedAdUnitStatus>(
    unit.format === 'direct_link' ? 'loaded' : 'loading'
  );
  const [errorReason, setErrorReason] = useState<string>('');
  const impressionSentRef = useRef(false);

  const srcDoc = useMemo(
    () => (unit.format === 'direct_link' ? '' : buildSandboxedSrcDoc(unit, slot, retryNonce)),
    [unit.id, unit.rawScriptHtml, unit.format, slot, retryNonce]
  );

  useEffect(() => {
    if (!impressionSentRef.current) {
      impressionSentRef.current = true;
      trackUnitEvent(unit.id, 'impression', slot, unit.format);
    }
  }, [unit.id, slot, unit.format]);

  useEffect(() => {
    if (unit.format === 'direct_link') {
      reportManagedUnitStatus(unit.id, 'loaded');
      return;
    }
    setStatus('loading');
    setErrorReason('');
    reportManagedUnitStatus(unit.id, 'loading');
    const handler = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        unitId?: string;
        slot?: string;
        status?: ManagedAdUnitStatus;
        error?: string;
      } | null;
      if (!data || data.type !== 'dh_ad_unit_status') return;
      if (data.unitId === unit.id && data.slot === slot && data.status) {
        setStatus(data.status);
        setErrorReason(data.error || '');
        reportManagedUnitStatus(unit.id, data.status, data.error);
        onStatusChange?.(unit.id, data.status, data.error);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [unit.id, unit.format, slot, retryNonce]);

  const handleRetry = () => {
    setErrorReason('');
    setStatus(unit.format === 'direct_link' ? 'loaded' : 'loading');
    setRetryNonce((n) => n + 1);
  };

  if (unit.format === 'direct_link') {
    const launch = resolveAdBrowserUrl(unit.originalUrl);

    if (!launch.ok) {
      return (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-[#172033] truncate">
                {unit.provider} · {unit.id}
              </p>
              <p className="text-amber-800 truncate">
                {lang === 'bn' ? 'বিজ্ঞাপনের লিংকটি অনুপলব্ধ।' : 'Ad destination is unavailable.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-[#172033] font-bold inline-flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'রিট্রাই' : 'Retry'}</span>
          </button>
        </div>
      );
    }

    const onDirectCardClick = (e: MouseEvent<HTMLAnchorElement>) => {
      if (!tryAcquireAdLaunchLock(unit.id, launch.finalHttpUrl)) {
        e.preventDefault();
        return;
      }
      trackUnitEvent(unit.id, 'click', slot, unit.format);
    };

    return (
      <a
        href={launch.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={onDirectCardClick}
        className="group rounded-2xl bg-gradient-to-r from-[#172033] via-[#1f2c47] to-[#263659] border border-[#FF8500]/30 hover:border-[#FF8500] p-3.5 sm:p-4 text-white flex items-center justify-between gap-3 shadow-sm cursor-pointer transition-all"
      >
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FF9B19]">
            <Megaphone className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {unit.provider} · {unit.id} · {lang === 'bn' ? 'স্পন্সরড বিজ্ঞাপন' : 'Sponsored'}
            </span>
          </div>
          <p className="text-xs sm:text-sm font-bold text-white group-hover:text-[#FF9B19] truncate transition-colors">
            {lang === 'bn' ? unit.labelBn : unit.label}
          </p>
        </div>
        <span className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 group-hover:opacity-95 shadow-xs">
          <Play className="w-3 h-3 fill-current" />
          <span>{lang === 'bn' ? 'ওপেন করুন' : 'Visit'}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </span>
      </a>
    );
  }

  // Clean, compact Error / Unavailable state with working Retry button
  if (status === 'blocked' || status === 'error') {
    return (
      <div className="w-full rounded-2xl border border-[#E6ECFA] bg-[#F8FAFC] p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-[#172033] truncate">
              {unit.provider} · {unit.id}
            </p>
            <p className="text-[11px] text-[#777777] truncate">
              {lang === 'bn'
                ? 'বিজ্ঞাপনটি লোড হতে সমস্যা হয়েছে বা ব্লক করা আছে।'
                : errorReason || 'Ad failed to load or is temporarily unavailable.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="px-3 py-1.5 rounded-xl bg-[#172033] hover:bg-[#FF8500] text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{lang === 'bn' ? 'আবার চেষ্টা করুন' : 'Retry'}</span>
        </button>
      </div>
    );
  }

  const dims = unit.dimensions || { width: 300, height: 250 };

  return (
    <div className="flex flex-col items-center justify-center w-full overflow-hidden">
      <div
        className="relative max-w-full overflow-hidden rounded-xl border border-[#E6ECFA] bg-white shadow-xs"
        style={{
          width: `${dims.width}px`,
          height: `${dims.height}px`,
        }}
      >
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#F3F6FF]/85 text-[#172033] text-xs font-semibold">
            <Loader2 className="w-4 h-4 text-[#FF8500] animate-spin" />
            <span>{lang === 'bn' ? 'বিজ্ঞাপন লোড হচ্ছে...' : 'Loading ad...'}</span>
          </div>
        )}
        <iframe
          key={`${unit.id}_${slot}_${retryNonce}`}
          title={`${unit.provider} ${unit.id}`}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          loading="lazy"
          width={dims.width}
          height={dims.height}
          className="border-0 w-full h-full block"
          onError={() => {
            setStatus('error');
            setErrorReason('Iframe failed to load');
            reportManagedUnitStatus(unit.id, 'error', 'Iframe failed to load');
          }}
        />
      </div>
      <span className="mt-1 text-[10px] font-mono-num text-[#777777]">
        {unit.provider} · {dims.width}x{dims.height} · {lang === 'bn' ? 'স্পন্সরড' : 'Sponsored'}
      </span>
    </div>
  );
}

/**
 * Renders eligible ads for any of the 10 named placements with rotation, priority, and responsive visibility.
 */
export function ManagedPlacementSlot({
  placement,
  units,
  adsEnabled,
  lang,
  variant = 'banner',
  className = '',
}: {
  placement: AdPlacementSlot;
  units: ManagedAdUnitConfig[];
  adsEnabled: boolean;
  lang: Language;
  variant?: 'banner' | 'slider' | 'grid' | 'compact';
  className?: string;
}) {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const candidates = useMemo(() => {
    if (!adsEnabled) return [];
    return units
      .filter((u) => {
        if (!u.enabled) return false;
        if (!u.placements.includes(placement)) return false;
        if (isMobile && !u.showOnMobile) return false;
        if (!isMobile && !u.showOnDesktop) return false;
        // Never auto-inject pop scripts globally on banners; keep them explicit inside available_ads if admin chooses
        if (u.format === 'script_pop' && placement !== 'available_ads') return false;
        return true;
      })
      .sort((a, b) => a.priority - b.priority);
  }, [adsEnabled, units, placement, isMobile]);

  useEffect(() => {
    if (candidates.length <= 1) return;
    const active = candidates[slideIdx % candidates.length];
    const sec = Math.max(8, active?.rotationSeconds || 20);
    const timer = setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % candidates.length);
    }, sec * 1000);
    return () => clearInterval(timer);
  }, [candidates, slideIdx]);

  if (!adsEnabled || candidates.length === 0) return null;

  if (variant === 'grid') {
    return (
      <section className={`space-y-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#FF8500]" />
            <h3 className="text-sm sm:text-base font-extrabold text-[#172033]">
              {lang === 'bn' ? AD_PLACEMENT_LABELS[placement].bn : AD_PLACEMENT_LABELS[placement].en}
            </h3>
          </div>
          <span className="text-[11px] font-mono-num text-[#777777]">
            {candidates.length} {lang === 'bn' ? 'সক্রিয়' : 'active'}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
          {candidates.map((unit) => (
            <AdUnitCardOrBanner key={`${placement}_${unit.id}`} unit={unit} slot={placement} lang={lang} />
          ))}
        </div>
      </section>
    );
  }

  if (variant === 'slider') {
    const activeUnit = candidates[slideIdx % candidates.length];
    return (
      <div className={`space-y-2 ${className}`}>
        <AdUnitCardOrBanner
          key={`${placement}_slider_${activeUnit.id}`}
          unit={activeUnit}
          slot={placement}
          lang={lang}
        />
        {candidates.length > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setSlideIdx((p) => (p - 1 + candidates.length) % candidates.length)}
              className="p-1 rounded-lg bg-white border border-[#E6ECFA] text-[#172033]"
              aria-label="Previous ad"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1">
              {candidates.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSlideIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === slideIdx % candidates.length ? 'w-5 bg-[#FF8500]' : 'w-2 bg-gray-300'
                  }`}
                  aria-label={`Ad ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSlideIdx((p) => (p + 1) % candidates.length)}
              className="p-1 rounded-lg bg-white border border-[#E6ECFA] text-[#172033]"
              aria-label="Next ad"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeUnit = candidates[slideIdx % candidates.length];
  return (
    <div className={className}>
      <AdUnitCardOrBanner
        key={`${placement}_${activeUnit.id}`}
        unit={activeUnit}
        slot={placement}
        lang={lang}
      />
    </div>
  );
}
