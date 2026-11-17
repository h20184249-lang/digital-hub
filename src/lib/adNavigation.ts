export type AdMediaKind = 'direct_video' | 'embed_video' | 'external';

export interface ResolvedAdLaunch {
  ok: boolean;
  href: string;
  finalHttpUrl: string;
  isAndroidIntent: boolean;
  error?: string;
}

const recentLaunchTimestamps = new Map<string, number>();

export function isValidExternalAdUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return false;
    return true;
  } catch {
    return false;
  }
}

export function isAndroidUserAgent(uaOverride?: string): boolean {
  const ua =
    uaOverride ?? (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '');
  return /Android/i.test(ua);
}

export function isAndroidChromeBrowser(uaOverride?: string): boolean {
  const ua =
    uaOverride ?? (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' ? navigator.userAgent : '');
  if (!/Android/i.test(ua)) return false;
  const hasChrome = /(Chrome|CriOS)\//i.test(ua);
  const isWebViewOrOther =
    /(;\s*wv\)|WebView|SamsungBrowser|UCBrowser|OPR\/|EdgA\/|Firefox|FxiOS|MiuiBrowser|DuckDuckGo|FBAN|FBAV|Instagram)/i.test(
      ua
    );
  return hasChrome && !isWebViewOrOther;
}

export function resolveAdBrowserUrl(
  rawUrl?: string | null,
  queryParams?: Record<string, string | undefined>,
  uaOverride?: string
): ResolvedAdLaunch {
  if (!isValidExternalAdUrl(rawUrl)) {
    return {
      ok: false,
      href: '#ad-unavailable',
      finalHttpUrl: '',
      isAndroidIntent: false,
      error: 'Advertisement destination URL is missing or invalid.',
    };
  }

  try {
    const parsed = new URL(rawUrl!.trim());
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        if (v && v.trim()) {
          parsed.searchParams.set(k, v.trim());
        }
      }
    }

    const finalHttpUrl = parsed.toString();
    const isAndroid = isAndroidUserAgent(uaOverride);
    const inAndroidChrome = isAndroidChromeBrowser(uaOverride);

    // On Android non-Chrome (WebView / Samsung / 3rd-party browser), launch Chrome via Android Intent
    // with automatic S.browser_fallback_url to the device's default browser if Chrome isn't installed.
    if (isAndroid && !inAndroidChrome) {
      const scheme = parsed.protocol.replace(':', '').toLowerCase();
      const withoutScheme = finalHttpUrl.replace(/^https?:\/\//i, '');
      const intentUrl = `intent://${withoutScheme}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
        finalHttpUrl
      )};end`;
      return {
        ok: true,
        href: intentUrl,
        finalHttpUrl,
        isAndroidIntent: true,
      };
    }

    // Desktop Chrome & Android Chrome open synchronously in a fresh tab via standard HTTPS anchor
    return {
      ok: true,
      href: finalHttpUrl,
      finalHttpUrl,
      isAndroidIntent: false,
    };
  } catch {
    return {
      ok: false,
      href: '#ad-unavailable',
      finalHttpUrl: '',
      isAndroidIntent: false,
      error: 'Unable to parse advertisement URL.',
    };
  }
}

export function tryAcquireAdLaunchLock(adKey: string, url: string, cooldownMs = 2200): boolean {
  const normalizedKey = `${adKey.trim().toLowerCase()}::${url.trim().toLowerCase()}`;
  const now = Date.now();
  const prev = recentLaunchTimestamps.get(normalizedKey);
  if (prev && now - prev < cooldownMs) {
    return false;
  }
  recentLaunchTimestamps.set(normalizedKey, now);
  if (recentLaunchTimestamps.size > 200) {
    for (const [k, ts] of recentLaunchTimestamps.entries()) {
      if (now - ts > 30000) recentLaunchTimestamps.delete(k);
    }
  }
  return true;
}

export function classifyAdMediaUrl(mediaUrl?: string | null): {
  kind: AdMediaKind;
  playableSrc: string;
} {
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    return { kind: 'external', playableSrc: '' };
  }
  const trimmed = mediaUrl.trim();
  if (!isValidExternalAdUrl(trimmed)) {
    return { kind: 'external', playableSrc: '' };
  }

  if (/\.(mp4|webm|ogg|ogv|m4v|mov)(\?.*)?$/i.test(trimmed)) {
    return { kind: 'direct_video', playableSrc: trimmed };
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      let videoId = '';
      if (host.includes('youtu.be')) {
        videoId = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.replace('/shorts/', '').split('/')[0] || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.replace('/embed/', '').split('/')[0] || '';
      } else {
        videoId = parsed.searchParams.get('v') || '';
      }
      if (/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
        return {
          kind: 'embed_video',
          playableSrc: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
        };
      }
    }

    if (host.includes('vimeo.com')) {
      const vimeoMatch = parsed.pathname.match(/\/(?:video\/)?(\d{5,15})/);
      if (vimeoMatch?.[1]) {
        return {
          kind: 'embed_video',
          playableSrc: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
        };
      }
    }
  } catch {
    // Fallback to external
  }

  return { kind: 'external', playableSrc: '' };
}
