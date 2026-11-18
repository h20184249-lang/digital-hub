// Lightweight Cloudflare Workers shim for `iconv-lite`.
// `iconv-lite@0.4.x` defines `"browser": { "./lib/streams": false }` in package.json,
// which causes Wrangler's esbuild bundler to stub `./lib/streams` while `nodejs_compat`
// exposes `process.versions.node` at runtime. Using Web-standard `TextDecoder` avoids
// that crash and shrinks the Worker bundle by removing legacy encoding tables.

function normalizeEncoding(encoding: string): string {
  const lower = String(encoding || 'utf-8').trim().toLowerCase();
  if (lower === 'utf8' || lower === 'utf-8' || lower === 'unicode-1-1-utf-8') {
    return 'utf-8';
  }
  if (lower === 'latin1' || lower === 'binary' || lower === 'iso-8859-1') {
    return 'iso-8859-1';
  }
  if (lower === 'ascii' || lower === 'us-ascii') {
    return 'utf-8';
  }
  return lower;
}

export function encodingExists(encoding: string): boolean {
  try {
    new TextDecoder(normalizeEncoding(encoding));
    return true;
  } catch {
    return false;
  }
}

export function getDecoder(encoding: string) {
  const decoder = new TextDecoder(normalizeEncoding(encoding));
  return {
    write(buf: Uint8Array | Buffer): string {
      return decoder.decode(buf, { stream: true });
    },
    end(): string {
      return decoder.decode();
    },
  };
}

export function decode(buf: Uint8Array | Buffer, encoding = 'utf-8'): string {
  return new TextDecoder(normalizeEncoding(encoding)).decode(buf);
}

export function encode(str: string, _encoding = 'utf-8'): Buffer {
  return Buffer.from(String(str), 'utf8');
}

const iconvLite = {
  encodingExists,
  getDecoder,
  decode,
  encode,
};

export default iconvLite;
