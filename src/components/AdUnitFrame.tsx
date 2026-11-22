import { MouseEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Megaphone,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AdPlacementSlot,
  AdSlotCategory,
  Language,
  ManagedAdUnitConfig,
  ManagedAdUnitStatus,
} from '../types/marketplace';
import { AD_PLACEMENT_LABELS, AD_SLOT_CATEGORIES } from '../lib/adProviderConfig';
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

// Global duplicate script execution guard so identical ad script URLs never execute twice on the same page
const activeScriptOwners = new Map<string, string>();
const scriptOwnerListeners = new Set<() => void>();
let statusNotifyScheduled = false;
let ownerNotifyScheduled = false;

function notifyScriptOwnersChanged(): void {
  if (ownerNotifyScheduled) return;
  ownerNotifyScheduled = true;
  queueMicrotask(() => {
    ownerNotifyScheduled = false;
    scriptOwnerListeners.forEach((fn) => fn());
  });
}

function claimScriptSlotLock(scriptUrl: string, instanceKey: string): boolean {
  const normalized = scriptUrl.trim();
  if (!normalized) return true;
  const currentOwner = activeScriptOwners.get(normalized);
  if (currentOwner && currentOwner !== instanceKey) {
    return false;
  }
  if (currentOwner !== instanceKey) {
    activeScriptOwners.set(normalized, instanceKey);
    notifyScriptOwnersChanged();
  }
  return true;
}

function releaseScriptSlotLock(scriptUrl: string, instanceKey: string): void {
  const normalized = scriptUrl.trim();
  if (!normalized) return;
  if (activeScriptOwners.get(normalized) === instanceKey) {
    activeScriptOwners.delete(normalized);
    notifyScriptOwnersChanged();
  }
}

function isScriptClaimedElsewhere(scriptUrl: string, myKey: string): boolean {
  const normalized = scriptUrl.trim();
  if (!normalized) return false;
  const owner = activeScriptOwners.get(normalized);
  return Boolean(owner && owner !== myKey);
}

export function reportManagedUnitStatus(
  unitId: string,
  status: ManagedAdUnitStatus,
  error?: string
): void {
  const existing = runtimeUnitStatuses.get(unitId);
  if (existing && existing.status === status && (existing.error || '') === (error || '')) {
    return;
  }
  runtimeUnitStatuses.set(unitId, {
    status,
    error,
    updatedAt: new Date().toISOString(),
  });
  if (statusNotifyScheduled) return;
  statusNotifyScheduled = true;
  queueMicrotask(() => {
    statusNotifyScheduled = false;
    statusListeners.forEach((fn) => fn());
  });
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

function buildSandboxedSrcDoc(
  unit: ManagedAdUnitConfig,
  slot: AdPlacementSlot,
  retryNonce: number
): string {
  // Runs in an isolated sandboxed iframe with zero access to parent localStorage, cookies, or DOM.
  const safeId = JSON.stringify(unit.id);
  const safeSlot = JSON.stringify(slot);
  const safeFormat = JSON.stringify(unit.format);
  const safeContainerId = JSON.stringify(unit.containerId || '');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
  img, iframe, ins, div {
    max-width: 100%;
  }
</style>
</head>
<body>
<div id="dh-isolated-banner-${unit.id}" data-banner-slot="${slot}" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;">
${unit.rawScriptHtml}
</div>
<script>
(function() {
  var unitId = ${safeId};
  var slot = ${safeSlot};
  var format = ${safeFormat};
  var containerId = ${safeContainerId};
  var wrapId = 'dh-isolated-banner-' + unitId;
  var settled = false;
  var scriptLoadSuccess = false;
  var scriptLoadFailed = false;
  var lastScriptErr = '';

  function send(status, err) {
    if (settled && status === 'loaded') return;
    if (status === 'loaded' || status === 'error' || status === 'blocked') {
      settled = true;
    }
    try {
      window.parent.postMessage({ type: 'dh_ad_unit_status', unitId: unitId, slot: slot, status: status, error: err || '' }, '*');
    } catch (e) {}
  }

  window.onerror = function(msg) {
    lastScriptErr = typeof msg === 'string' ? msg : 'Ad script runtime error';
    return true;
  };
  window.addEventListener('unhandledrejection', function(e) {
    if (e && e.preventDefault) e.preventDefault();
  });

  // Attach onload/onerror hooks to injected external script tags without duplicating any script request
  var scripts = document.querySelectorAll('script[src]');
  for (var s = 0; s < scripts.length; s++) {
    scripts[s].addEventListener('load', function() {
      scriptLoadSuccess = true;
      if (format === 'script_pop') {
        send('loaded', '');
      }
    });
    scripts[s].addEventListener('error', function() {
      scriptLoadFailed = true;
      send('blocked', 'External ad script failed to load or was blocked (403/network/adblocker)');
    });
  }

  window.addEventListener('error', function(ev) {
    if (ev && ev.target && ev.target.tagName === 'SCRIPT') {
      scriptLoadFailed = true;
      send('blocked', 'External ad script failed to load or was blocked (403/network/adblocker)');
      return;
    }
  }, true);

  function isRealVisibleElement(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'META' || tag === 'LINK') {
      return false;
    }
    if (el.id === wrapId) return false;
    if (tag === 'IMG') {
      return Boolean(el.complete && el.naturalWidth > 8 && el.naturalHeight > 8);
    }
    if (tag === 'IFRAME') {
      var ir = el.getBoundingClientRect();
      return Boolean((el.src || el.srcdoc) && ir.width > 12 && ir.height > 12);
    }
    if (tag === 'CANVAS' || tag === 'OBJECT' || tag === 'SVG' || tag === 'INS' || tag === 'A') {
      var mr = el.getBoundingClientRect();
      return mr.width > 12 && mr.height > 12;
    }
    return false;
  }

  function hasVisibleAdContent() {
    if (!document.body) return false;
    if (containerId) {
      var cEl = document.getElementById(containerId);
      if (cEl) {
        var cKids = cEl.querySelectorAll('iframe, img, canvas, object, ins, a, div');
        for (var k = 0; k < cKids.length; k++) {
          if (isRealVisibleElement(cKids[k])) return true;
          var kr = cKids[k].getBoundingClientRect();
          if (cKids[k].tagName === 'DIV' && kr.width > 12 && kr.height > 12 && cKids[k].innerText && cKids[k].innerText.trim().length > 0) {
            return true;
          }
        }
      }
    }
    var mediaNodes = document.body.querySelectorAll('iframe, img, canvas, object, ins, svg, a');
    for (var j = 0; j < mediaNodes.length; j++) {
      if (isRealVisibleElement(mediaNodes[j])) return true;
    }
    var wrap = document.getElementById(wrapId);
    if (wrap) {
      var innerChildren = wrap.children;
      for (var c = 0; c < innerChildren.length; c++) {
        var child = innerChildren[c];
        var tag = child.tagName ? child.tagName.toUpperCase() : '';
        if (tag !== 'SCRIPT' && tag !== 'STYLE' && child.id !== containerId) {
          var cr = child.getBoundingClientRect();
          if (cr.width > 12 && cr.height > 12 && (child.querySelector('iframe, img, a, ins') || (child.innerText && child.innerText.trim().length > 0))) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function inspectRendered(isFinal) {
    if (settled) return;
    if (hasVisibleAdContent()) {
      send('loaded', '');
    } else if (scriptLoadSuccess && format === 'script_pop' && !scriptLoadFailed) {
      send('loaded', '');
    } else if (scriptLoadFailed) {
      send('blocked', lastScriptErr || 'External ad script failed to load or was blocked (403/network/adblocker)');
    } else if (isFinal) {
      send(
        lastScriptErr ? 'error' : 'blocked',
        lastScriptErr || 'Ad script did not render visible content (blocked or empty inventory)'
      );
    }
  }

  try {
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var obs = new MutationObserver(function() {
        if (!settled && hasVisibleAdContent()) {
          obs.disconnect();
          send('loaded', '');
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    }
  } catch (e) {}

  setTimeout(function() { inspectRendered(false); }, 900);
  setTimeout(function() { inspectRendered(false); }, 2200);
  setTimeout(function() { inspectRendered(false); }, 3500);
  setTimeout(function() { inspectRendered(true); }, 4800);
})();
</script>
</body>
</html>`;
}

export function AdUnitCardOrBanner({
  unit,
  slot,
  lang,
  strictRewardMode = false,
  collapseOnFailure = false,
  slotOwnerKey,
  onStatusChange,
}: {
  unit: ManagedAdUnitConfig;
  slot: AdPlacementSlot;
  lang: Language;
  strictRewardMode?: boolean;
  collapseOnFailure?: boolean;
  slotOwnerKey?: string;
  onStatusChange?: (unitId: string, status: ManagedAdUnitStatus, err?: string) => void;
}) {
  const reactId = useId();
  const instanceKey = `${unit.id}_${slot}_${slotOwnerKey || reactId}`;
  const [retryNonce, setRetryNonce] = useState(0);
  const [duplicateSkipped, setDuplicateSkipped] = useState(false);
  const [status, setStatus] = useState<ManagedAdUnitStatus>(
    unit.format === 'direct_link' ? 'loaded' : 'loading'
  );
  const [errorReason, setErrorReason] = useState<string>('');
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const outerWrapRef = useRef<HTMLDivElement | null>(null);
  const impressionSentRef = useRef(false);

  const isScriptBackedType =
    unit.format === 'banner_iframe' || unit.format === 'script_pop' || unit.format === 'native_widget';

  useEffect(() => {
    if (!isScriptBackedType || !unit.originalUrl) {
      setDuplicateSkipped((prev) => (prev ? false : prev));
      return;
    }
    const acquired = claimScriptSlotLock(unit.originalUrl, instanceKey);
    const nextSkipped = !acquired;
    setDuplicateSkipped((prev) => (prev === nextSkipped ? prev : nextSkipped));
    return () => {
      if (acquired) {
        releaseScriptSlotLock(unit.originalUrl, instanceKey);
      }
    };
  }, [isScriptBackedType, unit.originalUrl, instanceKey]);

  const srcDoc = useMemo(
    () =>
      unit.format === 'direct_link' || duplicateSkipped
        ? ''
        : buildSandboxedSrcDoc(unit, slot, retryNonce),
    [unit.id, unit.rawScriptHtml, unit.format, unit.containerId, slot, retryNonce, duplicateSkipped]
  );

  // Measure available container width so fixed-size ad frames scale proportionally on mobile with zero overflow
  useEffect(() => {
    const el = outerWrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setContainerWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [unit.id, slot]);

  useEffect(() => {
    if (!impressionSentRef.current) {
      impressionSentRef.current = true;
      trackUnitEvent(unit.id, 'impression', slot, unit.format);
    }
  }, [unit.id, slot, unit.format]);

  useEffect(() => {
    if (unit.format === 'direct_link' || duplicateSkipped) {
      setStatus((prev) => (prev === 'loaded' ? prev : 'loaded'));
      reportManagedUnitStatus(unit.id, 'loaded');
      onStatusChange?.(unit.id, 'loaded');
      return;
    }
    setStatus((prev) => (prev === 'loading' ? prev : 'loading'));
    setErrorReason((prev) => (prev === '' ? prev : ''));
    reportManagedUnitStatus(unit.id, 'loading');
    onStatusChange?.(unit.id, 'loading');

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
        const nextStatus = data.status;
        const nextErr = data.error || '';
        setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
        setErrorReason((prev) => (prev === nextErr ? prev : nextErr));
        reportManagedUnitStatus(unit.id, nextStatus, data.error);
        onStatusChange?.(unit.id, nextStatus, data.error);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [unit.id, unit.format, slot, retryNonce, duplicateSkipped]);

  const handleRetry = () => {
    setErrorReason('');
    setStatus(unit.format === 'direct_link' ? 'loaded' : 'loading');
    setRetryNonce((n) => n + 1);
  };

  // Enforce duplicate-script prevention cleanly: in banner placements, collapse duplicate script slots cleanly
  if (duplicateSkipped && unit.format !== 'direct_link') {
    return null;
  }

  // Tall skyscraper banners (160x300, 160x600) only render when sufficient container & viewport space exist
  if (
    unit.dimensions &&
    unit.dimensions.width <= 180 &&
    unit.dimensions.height >= 300 &&
    ((typeof window !== 'undefined' && window.innerWidth < 768 && slot !== 'available_ads') ||
      (containerWidth > 0 && containerWidth < unit.dimensions.width))
  ) {
    return null;
  }

  if (unit.format === 'direct_link') {
    const launch = resolveAdBrowserUrl(unit.originalUrl);

    if (!launch.ok) {
      if (collapseOnFailure && !strictRewardMode) return null;
      return (
        <div
          id={`dh-ad-container-${slot}-${unit.id}`}
          className="w-full max-w-full rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3.5 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
            <div className="min-w-0">
              <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                {unit.provider} · {unit.id}
              </p>
              <p className="text-amber-800 dark:text-amber-300 truncate">
                {lang === 'bn' ? 'বিজ্ঞাপনের লিংকটি অনুপলব্ধ।' : 'Ad destination is unavailable.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-[#172033] dark:text-slate-100 font-bold inline-flex items-center gap-1 shrink-0"
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
        id={`dh-ad-container-${slot}-${unit.id}`}
        href={launch.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={onDirectCardClick}
        className="w-full max-w-full group rounded-2xl bg-gradient-to-r from-[#172033] via-[#1f2c47] to-[#263659] border border-[#FF8500]/30 hover:border-[#FF8500] p-3.5 sm:p-4 text-white flex items-center justify-between gap-3 shadow-sm cursor-pointer transition-all overflow-hidden"
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
        <span className="px-3 sm:px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0 group-hover:opacity-95 shadow-xs">
          <Play className="w-3 h-3 fill-current" />
          <span>{lang === 'bn' ? 'ওপেন' : 'Open Ad'}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </span>
      </a>
    );
  }

  // When an ad script fails to load or is blocked:
  // - In normal page placements (collapseOnFailure), collapse gracefully so there is zero broken UI or empty gap
  //   and NEVER render a fake/demo placeholder banner.
  // - In Available Ads / Watch-Earn strict inspection mode, show honest load status + Retry link.
  if (status === 'blocked' || status === 'error') {
    if (collapseOnFailure && !strictRewardMode) {
      return null;
    }

    const partnerLaunch = resolveAdBrowserUrl(unit.originalUrl);

    if (!strictRewardMode && partnerLaunch.ok) {
      return (
        <div id={`dh-ad-container-${slot}-${unit.id}`} className="w-full max-w-full overflow-hidden">
          <div className="w-full rounded-2xl bg-gradient-to-r from-[#172033] via-[#1e2c47] to-[#253657] border border-[#FF8500]/35 px-3.5 py-2.5 sm:px-4 sm:py-3 text-white flex items-center justify-between gap-2.5 shadow-xs">
            <a
              href={partnerLaunch.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(e) => {
                if (!tryAcquireAdLaunchLock(`${unit.id}_fallback`, partnerLaunch.finalHttpUrl)) {
                  e.preventDefault();
                  return;
                }
                trackUnitEvent(unit.id, 'click', slot, unit.format);
              }}
              className="flex-1 min-w-0 flex items-center gap-2.5 group"
            >
              <span className="w-8 h-8 rounded-xl bg-[#FF8500]/20 border border-[#FF8500]/40 text-[#FF9B19] flex items-center justify-center shrink-0">
                <Megaphone className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FF9B19]">
                  <span>{unit.provider}</span>
                  {unit.dimensions && (
                    <>
                      <span>·</span>
                      <span className="font-mono-num">
                        {unit.dimensions.width}×{unit.dimensions.height}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>{lang === 'bn' ? 'স্পন্সরড ব্যানার' : 'Sponsored Banner'}</span>
                </div>
                <p className="text-xs sm:text-sm font-bold text-white group-hover:text-[#FF9B19] truncate transition-colors">
                  {lang === 'bn' ? unit.labelBn : unit.label}
                </p>
              </div>
            </a>

            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href={partnerLaunch.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => {
                  if (!tryAcquireAdLaunchLock(`${unit.id}_fallback_btn`, partnerLaunch.finalHttpUrl)) {
                    e.preventDefault();
                    return;
                  }
                  trackUnitEvent(unit.id, 'click', slot, unit.format);
                }}
                className="px-3 py-1.5 rounded-xl dh-orange-gradient text-white text-[11px] font-bold inline-flex items-center gap-1 hover:opacity-95"
              >
                <span>{lang === 'bn' ? 'দেখুন' : 'Visit'}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={handleRetry}
                title={lang === 'bn' ? 'ব্যানার রিলোড করুন' : 'Reload ad script'}
                aria-label="Reload banner"
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full max-w-full rounded-2xl border border-[#E6ECFA] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800/80 p-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
          <div className="min-w-0">
            <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
              {unit.provider} · {unit.id}
            </p>
            <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">
              {lang === 'bn'
                ? 'বিজ্ঞাপন স্ক্রিপ্টটি লোড হয়নি বা অ্যাডব্লকার দ্বারা ব্লক করা আছে।'
                : errorReason || 'Ad script failed to load or is blocked by adblocker.'}
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

  const dims = unit.dimensions || { width: 320, height: 100 };
  const availableWidth = containerWidth > 0 ? containerWidth : dims.width;
  const scale = Math.min(1, availableWidth / dims.width);
  const scaledWidth = Math.max(1, Math.floor(dims.width * scale));
  const scaledHeight = Math.max(1, Math.floor(dims.height * scale));

  return (
    <div
      id={`dh-ad-container-${slot}-${unit.id}`}
      ref={outerWrapRef}
      className="flex flex-col items-center justify-center w-full max-w-full overflow-hidden"
    >
      <div
        className="relative max-w-full overflow-hidden rounded-xl border border-[#E6ECFA] dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs"
        style={{
          width: `${scaledWidth}px`,
          height: `${scaledHeight}px`,
        }}
      >
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[#F3F6FF]/90 dark:bg-slate-900/90 text-[#172033] dark:text-slate-200 text-xs font-semibold">
            <Loader2 className="w-4 h-4 text-[#FF8500] animate-spin shrink-0" />
            <span className="truncate px-2">{lang === 'bn' ? 'বিজ্ঞাপন লোড হচ্ছে...' : 'Loading ad...'}</span>
          </div>
        )}
        <iframe
          key={`${unit.id}_${slot}_${retryNonce}`}
          title={`${unit.provider} ${unit.id}`}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-top-navigation-by-user-activation"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="eager"
          width={dims.width}
          height={dims.height}
          style={{
            width: `${dims.width}px`,
            height: `${dims.height}px`,
            maxWidth: 'none',
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
          className="border-0 block"
          onError={() => {
            setStatus('error');
            setErrorReason('Iframe failed to load');
            reportManagedUnitStatus(unit.id, 'error', 'Iframe failed to load');
            onStatusChange?.(unit.id, 'error', 'Iframe failed to load');
          }}
        />
      </div>
      <span className="mt-1 text-[10px] font-mono-num text-[#777777] dark:text-slate-400">
        {unit.provider} · {dims.width}×{dims.height} · {lang === 'bn' ? 'স্পন্সরড' : 'Sponsored'}
      </span>
    </div>
  );
}

// Distinct primary banner preference order per page placement so every slot loads a unique script
const SLOT_UNIT_PREFERENCE: Partial<Record<AdPlacementSlot, string[]>> = {
  top_header: ['UNIT_09', 'UNIT_07', 'UNIT_05'],
  home_main: ['UNIT_05', 'UNIT_08', 'UNIT_07', 'UNIT_09', 'UNIT_01'],
  in_page: ['UNIT_08', 'UNIT_03', 'UNIT_12', 'UNIT_16'],
  product_page: ['UNIT_05', 'UNIT_08', 'UNIT_03', 'UNIT_14'],
  dashboard: ['UNIT_07', 'UNIT_08', 'UNIT_13', 'UNIT_23'],
  watch_earn: ['UNIT_07', 'UNIT_08', 'UNIT_05', 'UNIT_09'],
  footer: ['UNIT_07', 'UNIT_09', 'UNIT_21'],
  sidebar: ['UNIT_06', 'UNIT_25', 'UNIT_08'],
};

/**
 * Renders eligible ads for any placement or category slot with priority, rotation,
 * duplicate-script protection, and responsive scaling across mobile and desktop.
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
  const slotInstanceKey = useId();
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [slideIdx, setSlideIdx] = useState(0);
  const [activeSlotFilter, setActiveSlotFilter] = useState<'all' | AdSlotCategory>('all');
  const [ownerRevision, setOwnerRevision] = useState(0);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const listener = () => setOwnerRevision((r) => r + 1);
    scriptOwnerListeners.add(listener);
    return () => {
      scriptOwnerListeners.delete(listener);
    };
  }, []);

  const candidates = useMemo(() => {
    if (!adsEnabled) return [];
    const seenIds = new Set<string>();
    const preferredOrder = SLOT_UNIT_PREFERENCE[placement] || [];
    return units
      .filter((u) => {
        if (!u.enabled) return false;
        if (seenIds.has(u.id)) return false;
        const matchesSlot = u.placements.includes(placement) || u.slotCategory === placement;
        if (!matchesSlot) return false;
        // On non-grid slots, respect strict mobile vs desktop viewport rules
        if (placement !== 'available_ads') {
          if (isMobile && !u.showOnMobile) return false;
          if (!isMobile && !u.showOnDesktop) return false;
        }
        // Keep pop scripts safe inside Main Ad / Available Ads slots without unsolicited full-page interruption
        if (
          u.format === 'script_pop' &&
          placement !== 'available_ads' &&
          placement !== 'main_ad' &&
          placement !== 'home_main'
        ) {
          return false;
        }
        seenIds.add(u.id);
        return true;
      })
      .sort((a, b) => {
        const prefA = preferredOrder.indexOf(a.id);
        const prefB = preferredOrder.indexOf(b.id);
        if (prefA !== -1 && prefB !== -1) return prefA - prefB;
        if (prefA !== -1) return -1;
        if (prefB !== -1) return 1;
        return a.priority - b.priority;
      });
  }, [adsEnabled, units, placement, isMobile]);

  // Select first candidate whose script URL is NOT already active elsewhere on the same page
  const unclaimedCandidates = useMemo(() => {
    if (placement === 'available_ads') return candidates;
    const free = candidates.filter((u) => {
      if (u.format === 'direct_link') return true;
      return !isScriptClaimedElsewhere(u.originalUrl, `${u.id}_${placement}_${slotInstanceKey}`);
    });
    return free;
  }, [candidates, placement, slotInstanceKey, ownerRevision]);

  useEffect(() => {
    const list = unclaimedCandidates.length > 0 ? unclaimedCandidates : candidates;
    if (list.length <= 1) return;
    const active = list[slideIdx % list.length];
    const sec = Math.max(12, active?.rotationSeconds || 25);
    const timer = setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % list.length);
    }, sec * 1000);
    return () => clearInterval(timer);
  }, [unclaimedCandidates, candidates, slideIdx]);

  if (!adsEnabled || candidates.length === 0) return null;

  if (variant === 'grid') {
    const isAvailableAdsHub = placement === 'available_ads';
    const categoriesToShow =
      activeSlotFilter === 'all'
        ? AD_SLOT_CATEGORIES
        : AD_SLOT_CATEGORIES.filter((c) => c.key === activeSlotFilter);

    const externalRewardUnits = units.filter((u) => u.enabled && u.format === 'direct_link');

    if (isAvailableAdsHub) {
      return (
        <section className={`w-full max-w-full overflow-hidden space-y-5 ${className}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-[#FF8500] shrink-0" />
              <h3 className="text-sm sm:text-base font-extrabold text-[#172033] dark:text-slate-100 truncate">
                {lang === 'bn' ? AD_PLACEMENT_LABELS[placement].bn : AD_PLACEMENT_LABELS[placement].en}
              </h3>
            </div>
            <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400 shrink-0">
              {candidates.length} {lang === 'bn' ? 'সক্রিয়' : 'active'}
            </span>
          </div>

          {/* 7 Slot Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveSlotFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                activeSlotFilter === 'all'
                  ? 'dh-orange-gradient text-white'
                  : 'bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 text-[#172033] dark:text-slate-200'
              }`}
            >
              {lang === 'bn' ? 'সব স্লট (৭)' : 'All 7 Slots'}
            </button>
            {AD_SLOT_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveSlotFilter(cat.key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                  activeSlotFilter === cat.key
                    ? 'dh-orange-gradient text-white'
                    : 'bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 text-[#172033] dark:text-slate-200'
                }`}
              >
                {lang === 'bn' ? cat.titleBn : cat.titleEn}
              </button>
            ))}
          </div>

          <div className="space-y-5">
            {categoriesToShow.map((cat) => {
              if (cat.key === 'reward_ad') {
                return (
                  <div
                    key={cat.key}
                    className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                          {lang === 'bn' ? cat.titleBn : cat.titleEn}
                        </h4>
                        <p className="text-[11px] text-[#777777] dark:text-slate-400">
                          {lang === 'bn'
                            ? 'আপনার অনুমোদিত এক্সটার্নাল বিজ্ঞাপন লিংকসমূহ — নেটওয়ার্ক পলিসি অনুমোদন করলে ৫ সেকেন্ডে +৫ কয়েন রিওয়ার্ড।'
                            : 'Your external ad links — policy-approved units pay +5 Coins after 5s verification.'}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        5s = +5 Coins
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {externalRewardUnits.slice(0, 6).map((u) => {
                        const launch = resolveAdBrowserUrl(u.originalUrl);
                        return (
                          <div
                            key={`rew_${u.id}`}
                            className="rounded-2xl p-3 bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2.5"
                          >
                            <div className="min-w-0">
                              <span className="text-[10px] font-mono-num font-bold text-[#FF8500]">
                                {u.id} · {u.provider}
                              </span>
                              <p className="text-xs font-bold text-[#172033] dark:text-slate-100 truncate">
                                {lang === 'bn' ? u.labelBn : u.label}
                              </p>
                              <p
                                className={`text-[10px] font-bold ${
                                  u.supportsRewardedVerification
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-[#777777] dark:text-slate-400'
                                }`}
                              >
                                {u.supportsRewardedVerification
                                  ? lang === 'bn'
                                    ? 'পলিসি অনুমোদিত (+৫ কয়েন)'
                                    : 'Reward Approved (+5 Coins)'
                                  : lang === 'bn'
                                    ? 'এক্সটার্নাল লিংক · পলিসি যাচাই বাকি'
                                    : 'External Link · Policy Pending'}
                              </p>
                            </div>
                            {launch.ok && (
                              <a
                                href={launch.href}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="px-2.5 py-1.5 rounded-xl dh-orange-gradient text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                              >
                                <span>{lang === 'bn' ? 'ওপেন' : 'Open'}</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const slotUnits = candidates.filter((u) => u.slotCategory === cat.key);
              if (slotUnits.length === 0) return null;
              return (
                <div
                  key={cat.key}
                  className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                        {lang === 'bn' ? cat.titleBn : cat.titleEn}
                      </h4>
                      <p className="text-[11px] text-[#777777] dark:text-slate-400">
                        {lang === 'bn' ? cat.descBn : cat.descEn}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                      {slotUnits.length} {lang === 'bn' ? 'টি ইউনিট' : 'units'}
                    </span>
                  </div>
                  <div
                    className={`grid grid-cols-1 ${
                      cat.key === 'large_banner' ? 'md:grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-3'
                    } gap-3 items-start`}
                  >
                    {slotUnits.map((unit) => (
                      <AdUnitCardOrBanner
                        key={`${placement}_${cat.key}_${unit.id}`}
                        unit={unit}
                        slot={placement}
                        lang={lang}
                        collapseOnFailure={false}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      );
    }

    return (
      <section className={`w-full max-w-full overflow-hidden space-y-3 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-[#FF8500] shrink-0" />
            <h3 className="text-sm sm:text-base font-extrabold text-[#172033] dark:text-slate-100 truncate">
              {lang === 'bn' ? AD_PLACEMENT_LABELS[placement].bn : AD_PLACEMENT_LABELS[placement].en}
            </h3>
          </div>
          <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400 shrink-0">
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

  const displayList = unclaimedCandidates.length > 0 ? unclaimedCandidates : [];
  if (displayList.length === 0) return null;

  if (variant === 'slider') {
    const activeUnit = displayList[slideIdx % displayList.length];
    return (
      <div className={`w-full max-w-full overflow-hidden space-y-2 ${className}`}>
        <AdUnitCardOrBanner
          key={`${placement}_slider_${activeUnit.id}`}
          unit={activeUnit}
          slot={placement}
          lang={lang}
          slotOwnerKey={slotInstanceKey}
          collapseOnFailure
        />
        {displayList.length > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setSlideIdx((p) => (p - 1 + displayList.length) % displayList.length)}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100"
              aria-label="Previous ad"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1">
              {displayList.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSlideIdx(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === slideIdx % displayList.length ? 'w-5 bg-[#FF8500]' : 'w-2 bg-gray-300 dark:bg-slate-600'
                  }`}
                  aria-label={`Ad ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSlideIdx((p) => (p + 1) % displayList.length)}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100"
              aria-label="Next ad"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeUnit = displayList[slideIdx % displayList.length];
  return (
    <div className={`w-full max-w-full overflow-hidden ${className}`}>
      <AdUnitCardOrBanner
        key={`${placement}_${activeUnit.id}`}
        unit={activeUnit}
        slot={placement}
        lang={lang}
        slotOwnerKey={slotInstanceKey}
        collapseOnFailure
      />
    </div>
  );
}
