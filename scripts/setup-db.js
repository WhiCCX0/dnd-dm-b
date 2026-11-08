#!/usr/bin/env node

/**
 * Zero-dependency database acquisition & release bundler for dnd-dm-b (R16).
 *
 * Modes:
 *   1. Default (one-command setup):
 *        node scripts/setup-db.js [--force]
 *      Tries downloading the prebuilt archive from GitHub Releases and verifying SHA-256;
 *      if the release asset is not yet published (HTTP 404), automatically builds from 5echm_web@c1425c8.
 *
 *   2. Release download with strict SHA-256 verification:
 *        node scripts/setup-db.js --from-release [--url <url>] [--sha256 <hex>] [--force]
 *
 *   3. Local deterministic build from pinned upstream 5echm_web commit (c1425c8):
 *        node scripts/setup-db.js --from-source [--source-dir <topics_dir>] [--commit <sha>] [--force]
 *
 *   4. Maintainer release bundler:
 *        node scripts/setup-db.js --pack <archive.tar.gz> [--update-manifest]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { assertFts5Support } from './sqlite-capability.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST_PATH = path.resolve(ROOT_DIR, 'references', 'db-manifest.json');
const DEFAULT_UPSTREAM_REPO = 'https://github.com/DND5eChm/5echm_web.git';
const DEFAULT_UPSTREAM_COMMIT = 'c1425c8e90804766689a0db7ec416833f3fc3046';

const ALLOWED_ARCHIVE_ENTRIES = new Set(['rules.db', 'topics_index.json', 'dedup-report.json']);
const RELEASE_RETRY_DELAYS_MS = [500, 1000, 2000];

export function loadManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (fs.existsSync(manifestPath)) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  return {
    version: '2.2.0',
    upstreamRepo: DEFAULT_UPSTREAM_REPO,
    upstreamCommit: DEFAULT_UPSTREAM_COMMIT,
    releaseArchiveName: 'dnd-dm-b-rules-db-v2.2.0.tar.gz',
    releaseUrl: 'https://github.com/WhiCCX0/dnd-dm-b/releases/download/v2.2.0/dnd-dm-b-rules-db-v2.2.0.tar.gz',
    sha256: ''
  };
}

export async function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function buildTarHeader(name, size, mtimeSec = Math.floor(Date.now() / 1000)) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  const sizeOct = size.toString(8).padStart(11, '0') + '\0';
  if (sizeOct.length > 12) {
    throw new Error(`File "${name}" (${size} bytes) exceeds 8 GiB ustar octal header limit`);
  }
  header.write(sizeOct, 124, 12, 'ascii');
  header.write(mtimeSec.toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156); // spaces while computing checksum
  header.write('0', 156, 1, 'ascii'); // regular file
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

export async function packDbArchive({
  rulesDbPath = path.resolve(ROOT_DIR, 'references', 'rules.db'),
  topicsIndexPath = path.resolve(ROOT_DIR, 'references', 'topics_index.json'),
  dedupReportPath,
  outArchivePath
}) {
  if (!fs.existsSync(rulesDbPath)) {
    throw new Error(`Missing rules.db at ${rulesDbPath}`);
  }
  if (!fs.existsSync(topicsIndexPath)) {
    throw new Error(`Missing topics_index.json at ${topicsIndexPath}`);
  }
  const resolvedDedupPath = dedupReportPath !== undefined
    ? dedupReportPath
    : path.join(path.dirname(rulesDbPath), 'dedup-report.json');

  fs.mkdirSync(path.dirname(outArchivePath), { recursive: true });
  const tmpOut = `${outArchivePath}.${process.pid}.tmp`;

  async function* tarChunks() {
    const files = [
      { name: 'topics_index.json', fullPath: topicsIndexPath },
      ...(resolvedDedupPath && fs.existsSync(resolvedDedupPath)
        ? [{ name: 'dedup-report.json', fullPath: resolvedDedupPath }]
        : []),
      { name: 'rules.db', fullPath: rulesDbPath }
    ];
    for (const f of files) {
      const stat = fs.statSync(f.fullPath);
      yield buildTarHeader(f.name, stat.size, 0);
      const rs = fs.createReadStream(f.fullPath);
      for await (const chunk of rs) {
        yield chunk;
      }
      const remainder = stat.size % 512;
      if (remainder !== 0) {
        yield Buffer.alloc(512 - remainder, 0);
      }
    }
    // End-of-archive: two 512-byte zero blocks
    yield Buffer.alloc(1024, 0);
  }

  await pipeline(
    tarChunks(),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(tmpOut)
  );
  fs.renameSync(tmpOut, outArchivePath);

  const sha256 = await computeFileSha256(outArchivePath);
  return {
    archivePath: outArchivePath,
    archiveBytes: fs.statSync(outArchivePath).size,
    rulesDbBytes: fs.statSync(rulesDbPath).size,
    topicsIndexBytes: fs.statSync(topicsIndexPath).size,
    sha256
  };
}

export async function extractDbArchive({
  archivePath,
  expectedSha256,
  targetDir = path.resolve(ROOT_DIR, 'references')
}) {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }
  if (!expectedSha256 || !/^[a-f0-9]{64}$/i.test(expectedSha256.trim())) {
    throw new Error('缺少有效的 64 位 SHA-256 校验值，拒绝解压未校验压缩包');
  }

  const actualSha256 = await computeFileSha256(archivePath);
  if (actualSha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
    throw new Error(
      `SHA-256 校验失败！期望: ${expectedSha256.trim().toLowerCase()}，实际: ${actualSha256.toLowerCase()}`
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(archivePath).pipe(gunzip);

  let pending = Buffer.alloc(0);
  let currentEntry = null;
  const extracted = [];

  const flushCurrent = async () => {
    if (!currentEntry) return;
    await new Promise((resolve, reject) => {
      currentEntry.ws.end(err => (err ? reject(err) : resolve()));
    });
    fs.renameSync(currentEntry.tmpPath, currentEntry.finalPath);
    extracted.push(currentEntry.name);
    currentEntry = null;
  };

  try {
    for await (const chunk of input) {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

      while (true) {
        if (!currentEntry) {
          if (pending.length < 512) break;
          const header = pending.subarray(0, 512);
          pending = pending.subarray(512);

          let allZero = true;
          for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
              allZero = false;
              break;
            }
          }
          if (allZero) continue;

          const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '').trim();
          const safeName = path.basename(rawName);
          const sizeStr = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
          const size = parseInt(sizeStr || '0', 8);
          if (!Number.isFinite(size) || size < 0) {
            throw new Error(`Invalid tar entry size for "${rawName}": "${sizeStr}"`);
          }
          const padBytes = size % 512 === 0 ? 0 : 512 - (size % 512);

          if (!ALLOWED_ARCHIVE_ENTRIES.has(safeName) || safeName !== rawName) {
            throw new Error(`Unexpected archive entry "${rawName}"`);
          }

          const finalPath = path.join(targetDir, safeName);
          const tmpPath = `${finalPath}.${process.pid}.tmp`;
          const ws = fs.createWriteStream(tmpPath);
          currentEntry = { name: safeName, remaining: size, padRemaining: padBytes, ws, tmpPath, finalPath };
        }

        if (currentEntry.remaining > 0) {
          if (pending.length === 0) break;
          const take = Math.min(currentEntry.remaining, pending.length);
          const slice = pending.subarray(0, take);
          pending = pending.subarray(take);
          currentEntry.remaining -= take;
          if (!currentEntry.ws.write(slice)) {
            await new Promise(resolve => currentEntry.ws.once('drain', resolve));
          }
        }

        if (currentEntry.remaining === 0) {
          if (pending.length < currentEntry.padRemaining) break;
          pending = pending.subarray(currentEntry.padRemaining);
          currentEntry.padRemaining = 0;
          await flushCurrent();
        }
      }
    }
    if (currentEntry) {
      throw new Error(`Truncated tar archive while reading "${currentEntry.name}"`);
    }
  } catch (err) {
    if (currentEntry) {
      try { currentEntry.ws.destroy(); } catch (_) {}
      if (fs.existsSync(currentEntry.tmpPath)) fs.unlinkSync(currentEntry.tmpPath);
    }
    throw err;
  }

  return { sha256: actualSha256, extracted };
}

export function shouldBypassProxy(hostname, port, noProxyRaw) {
  const raw = noProxyRaw !== undefined
    ? String(noProxyRaw)
    : String(process.env.NO_PROXY || process.env.no_proxy || '');
  if (!raw.trim()) return false;

  const hostLower = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const tokens = raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  for (const token of tokens) {
    if (token === '*') return true;
    let tHost = token.toLowerCase();
    let tPort = null;
    const colonIdx = tHost.lastIndexOf(':');
    if (colonIdx !== -1 && !tHost.includes(']')) {
      tPort = Number(tHost.slice(colonIdx + 1));
      tHost = tHost.slice(0, colonIdx);
    }
    if (tPort && Number(port) && tPort !== Number(port)) continue;
    const bare = tHost.replace(/^\[|\]$/g, '').replace(/^\.+/, '');
    if (!bare) continue;
    if (hostLower === bare || hostLower.endsWith(`.${bare}`)) {
      return true;
    }
  }
  return false;
}

function parseProxyUrl(rawProxy) {
  const trimmed = String(rawProxy || '').trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return new URL(withScheme);
}

function makeDownloadTimeoutError(stageLabel, timeoutMs, urlStr) {
  const secStr = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
  return new Error(
    `下载预编译规则库${stageLabel}超时（${secStr}）：${urlStr}；若网络受限，可手动下载压缩包后执行离线安装：node scripts/setup-db.js --from-release --url <本地压缩包路径>（详见 README.md“离线安装”）`
  );
}

function requestWithOptionalProxy(targetUrl, options = {}) {
  const parsed = new URL(targetUrl);
  const targetPort = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
  const connectTimeoutMs = Number(
    options.connectTimeoutMs ?? process.env.DND_DOWNLOAD_CONNECT_TIMEOUT_MS ?? 30000
  );

  const rawProxy = options.proxyEnv !== undefined
    ? options.proxyEnv
    : (parsed.protocol === 'https:'
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || '')
      : (process.env.HTTP_PROXY || process.env.http_proxy || ''));

  const bypass = shouldBypassProxy(parsed.hostname, targetPort, options.noProxy);
  const proxyUrl = (!bypass && rawProxy) ? parseProxyUrl(rawProxy) : null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const activeHandles = [];
    const finishResolve = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      resolve(res);
    };
    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      for (const h of activeHandles) {
        try { h.destroy(); } catch (_) {}
      }
      reject(err);
    };

    const connectTimer = setTimeout(() => {
      finishReject(makeDownloadTimeoutError('连接与响应', connectTimeoutMs, targetUrl));
    }, connectTimeoutMs);

    const headers = { 'User-Agent': 'dnd-dm-b-setup-db/2.2.0' };

    if (!proxyUrl) {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(parsed, { headers }, res => finishResolve(res));
      activeHandles.push(req);
      req.on('error', finishReject);
      return;
    }

    const proxyMod = proxyUrl.protocol === 'https:' ? https : http;
    const proxyPort = Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80);
    const proxyAuthHeader = proxyUrl.username
      ? {
          'Proxy-Authorization': `Basic ${Buffer.from(
            `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password || '')}`
          ).toString('base64')}`
        }
      : {};

    if (parsed.protocol === 'http:') {
      const req = proxyMod.get({
        host: proxyUrl.hostname,
        port: proxyPort,
        path: parsed.href,
        headers: { ...headers, ...proxyAuthHeader, Host: parsed.host }
      }, res => finishResolve(res));
      activeHandles.push(req);
      req.on('error', finishReject);
      return;
    }

    const connectReq = proxyMod.request({
      host: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${parsed.hostname}:${targetPort}`,
      headers: { ...proxyAuthHeader, Host: `${parsed.hostname}:${targetPort}` }
    });
    activeHandles.push(connectReq);
    connectReq.on('connect', (connectRes, socket) => {
      activeHandles.push(socket);
      if (connectRes.statusCode !== 200) {
        socket.destroy();
        finishReject(new Error(`Proxy CONNECT failed with HTTP ${connectRes.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: parsed.hostname
      });
      activeHandles.push(tlsSocket);
      const req = https.get({
        hostname: parsed.hostname,
        port: targetPort,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        createConnection: () => tlsSocket
      }, res => finishResolve(res));
      activeHandles.push(req);
      req.on('error', finishReject);
    });
    connectReq.on('error', finishReject);
    connectReq.end();
  });
}

export async function downloadArchive(urlStr, destPath, redirectsLeft = 5, options = {}) {
  if (urlStr.startsWith('file://')) {
    const srcPath = fileURLToPath(urlStr);
    if (!fs.existsSync(srcPath)) {
      const err = new Error(`File not found: ${srcPath}`);
      err.statusCode = 404;
      throw err;
    }
    fs.copyFileSync(srcPath, destPath);
    return;
  }

  if (!/^https?:\/\//i.test(urlStr)) {
    // Treat plain local filesystem path as file copy
    const resolved = path.resolve(urlStr);
    if (!fs.existsSync(resolved)) {
      const err = new Error(`Archive file not found: ${resolved}`);
      err.statusCode = 404;
      throw err;
    }
    fs.copyFileSync(resolved, destPath);
    return;
  }

  const res = await requestWithOptionalProxy(urlStr, options);
  const code = res.statusCode || 0;

  if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
    res.resume();
    if (redirectsLeft <= 0) {
      throw new Error(`Too many redirects while downloading ${urlStr}`);
    }
    const nextUrl = new URL(res.headers.location, urlStr).href;
    return downloadArchive(nextUrl, destPath, redirectsLeft - 1, options);
  }

  if (code !== 200) {
    res.resume();
    const err = new Error(`Download failed from ${urlStr} (HTTP ${code})`);
    err.statusCode = code;
    throw err;
  }

  const idleTimeoutMs = Number(
    options.idleTimeoutMs ?? process.env.DND_DOWNLOAD_IDLE_TIMEOUT_MS ?? 60000
  );
  const progressIntervalMs = Number(options.progressIntervalMs ?? 10000);
  const emitProgress = typeof options.onProgress === 'function'
    ? options.onProgress
    : (line => console.log(line));

  const totalBytes = Number(res.headers['content-length']) || 0;
  let downloadedBytes = 0;
  let lastBucket = 0;
  let lastReportAt = Date.now();
  let idleTimer = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      res.destroy(makeDownloadTimeoutError('空闲读取', idleTimeoutMs, urlStr));
    }, idleTimeoutMs);
  };

  resetIdleTimer();
  res.on('data', (chunk) => {
    resetIdleTimer();
    downloadedBytes += chunk.length;
    const now = Date.now();
    const bucket = totalBytes > 0 ? Math.min(10, Math.floor((downloadedBytes / totalBytes) * 10)) : 0;
    const timeDue = (now - lastReportAt) >= progressIntervalMs;
    if ((totalBytes > 0 && bucket > lastBucket) || timeDue) {
      if (bucket > lastBucket) lastBucket = bucket;
      lastReportAt = now;
      if (totalBytes > 0) {
        const pct = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
        emitProgress(
          `[setup-db] 下载进度: ${pct}% (${(downloadedBytes / 1048576).toFixed(2)} / ${(totalBytes / 1048576).toFixed(2)} MiB)`
        );
      } else {
        emitProgress(`[setup-db] 下载进度: 已接收 ${(downloadedBytes / 1048576).toFixed(2)} MiB`);
      }
    }
  });

  const tmpDest = `${destPath}.${process.pid}.part`;
  try {
    await pipeline(res, fs.createWriteStream(tmpDest));
    fs.renameSync(tmpDest, destPath);
  } catch (err) {
    if (fs.existsSync(tmpDest)) {
      try { fs.unlinkSync(tmpDest); } catch (_) {}
    }
    throw err;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

async function downloadReleaseArchiveWithRetry(url, destPath) {
  const maxAttempts = RELEASE_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await downloadArchive(url, destPath);
      return;
    } catch (err) {
      const statusCode = Number(err.statusCode);
      const isServerError = statusCode >= 500 && statusCode <= 599;
      if (!isServerError || attempt === maxAttempts) {
        throw err;
      }

      const delayMs = RELEASE_RETRY_DELAYS_MS[attempt - 1];
      console.warn(
        `[setup-db] GitHub Release 返回 HTTP ${statusCode}，第 ${attempt}/${maxAttempts} 次下载失败，${delayMs}ms 后重试...`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

export async function setupFromRelease({
  url,
  sha256,
  targetDir = path.resolve(ROOT_DIR, 'references'),
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const manifest = loadManifest(manifestPath);
  const archiveUrl = url || process.env.DND_DB_ARCHIVE_URL || manifest.releaseUrl;
  const expectedSha = sha256 || process.env.DND_DB_SHA256 || manifest.sha256;

  if (!archiveUrl) {
    throw new Error('未配置 Release 下载地址 (releaseUrl / DND_DB_ARCHIVE_URL)');
  }
  if (!expectedSha) {
    throw new Error('未配置 Release SHA-256 校验值 (sha256 / DND_DB_SHA256)');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-db-dl-'));
  const tmpArchive = path.join(tmpDir, 'rules-bundle.tar.gz');
  try {
    console.log(`[setup-db] 正在下载预编译规则库压缩包: ${archiveUrl}`);
    await downloadReleaseArchiveWithRetry(archiveUrl, tmpArchive);
    console.log(`[setup-db] 正在校验 SHA-256 (${expectedSha.slice(0, 12)}...) 并解压...`);
    const result = await extractDbArchive({
      archivePath: tmpArchive,
      expectedSha256: expectedSha,
      targetDir
    });
    console.log(`[setup-db] SHA-256 校验通过！已解压至 ${targetDir}: ${result.extracted.join(', ')}`);
    return result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function setupFromSource({
  sourceDir,
  upstreamRepo,
  upstreamCommit,
  targetDir = path.resolve(ROOT_DIR, 'references'),
  manifestPath = DEFAULT_MANIFEST_PATH
} = {}) {
  const manifest = loadManifest(manifestPath);
  const repoUrl = upstreamRepo || process.env.DND_UPSTREAM_REPO || manifest.upstreamRepo || DEFAULT_UPSTREAM_REPO;
  const commitSha = upstreamCommit || process.env.UPSTREAM_COMMIT || manifest.upstreamCommit || DEFAULT_UPSTREAM_COMMIT;

  let topicsDir = sourceDir || process.env.RULES_SOURCE_DIR || '';
  let tempCloneDir = null;

  try {
    if (!topicsDir) {
      tempCloneDir = fs.mkdtempSync(path.join(os.tmpdir(), '5echm-src-'));
      console.log(`[setup-db] 正在按单提交浅拉取上游数据源 ${repoUrl} @ ${commitSha} ...`);

      const gitSteps = [
        { label: 'git init', args: ['-C', tempCloneDir, 'init', '-q'] },
        { label: 'git remote add origin', args: ['-C', tempCloneDir, 'remote', 'add', 'origin', repoUrl] },
        { label: `git fetch --depth 1 origin ${commitSha}`, args: ['-C', tempCloneDir, 'fetch', '--depth', '1', 'origin', commitSha] },
        { label: 'git checkout FETCH_HEAD', args: ['-C', tempCloneDir, 'checkout', '-q', 'FETCH_HEAD'] }
      ];

      for (const step of gitSteps) {
        const res = spawnSync('git', step.args, { stdio: 'inherit' });
        if (res.status !== 0) {
          throw new Error(`${step.label} 失败 (exit ${res.status})`);
        }
      }
      topicsDir = path.join(tempCloneDir, 'topics');
    }

    if (!fs.existsSync(topicsDir)) {
      throw new Error(`未找到原始 HTML 目录: ${topicsDir}`);
    }

    fs.mkdirSync(targetDir, { recursive: true });
    const env = {
      ...process.env,
      RULES_SOURCE_DIR: topicsDir,
      UPSTREAM_COMMIT: commitSha,
      DND_DB_PATH: path.join(targetDir, 'rules.db'),
      DND_INDEX_PATH: path.join(targetDir, 'topics_index.json'),
      DND_DEDUP_REPORT_PATH: path.join(targetDir, 'dedup-report.json')
    };

    console.log('[setup-db] 1/2 正在运行 build-index.js --force ...');
    const idxRes = spawnSync(process.execPath, [path.join(__dirname, 'build-index.js'), '--force'], {
      env,
      stdio: 'inherit'
    });
    if (idxRes.status !== 0) {
      throw new Error(`build-index.js 执行失败 (exit ${idxRes.status})`);
    }

    console.log('[setup-db] 2/2 正在运行 build-db.js --force ...');
    const dbRes = spawnSync(process.execPath, [path.join(__dirname, 'build-db.js'), '--force'], {
      env,
      stdio: 'inherit'
    });
    if (dbRes.status !== 0) {
      throw new Error(`build-db.js 执行失败 (exit ${dbRes.status})`);
    }

    console.log(`[setup-db] 本地构建完成！已生成 ${path.join(targetDir, 'rules.db')}、topics_index.json 与 dedup-report.json`);
  } finally {
    if (tempCloneDir) {
      fs.rmSync(tempCloneDir, { recursive: true, force: true });
    }
  }
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`用法:
  node scripts/setup-db.js [--force]                                    # 一键获取数据库（优先 Release 下载校验 SHA-256，未发布时自动从源码构建）
  node scripts/setup-db.js --from-release [--url <url>] [--sha256 <h>]  # 严格从 Release/URL 下载压缩包并校验 SHA-256
  node scripts/setup-db.js --from-source [--source-dir <dir>]           # 从 5echm_web@${DEFAULT_UPSTREAM_COMMIT} 本地构建
  node scripts/setup-db.js --pack <out.tar.gz> [--update-manifest]      # 打包预编译库并计算 SHA-256`);
    return;
  }

  const getOpt = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };

  const packOut = getOpt('--pack');
  if (packOut) {
    const outPath = path.resolve(packOut);
    const info = await packDbArchive({ outArchivePath: outPath });
    console.log(`[setup-db] 已生成预编译包: ${info.archivePath}`);
    console.log(`  压缩包体积: ${info.archiveBytes} bytes (${(info.archiveBytes / 1024 / 1024).toFixed(2)} MiB)`);
    console.log(`  rules.db:   ${info.rulesDbBytes} bytes (${(info.rulesDbBytes / 1024 / 1024).toFixed(2)} MiB)`);
    console.log(`  topics_index.json: ${info.topicsIndexBytes} bytes (${(info.topicsIndexBytes / 1024 / 1024).toFixed(2)} MiB)`);
    console.log(`  SHA-256:    ${info.sha256}`);

    if (args.includes('--update-manifest')) {
      const manifest = loadManifest();
      manifest.releaseArchiveName = path.basename(outPath);
      manifest.sha256 = info.sha256;
      manifest.archiveBytes = info.archiveBytes;
      manifest.rulesDbBytes = info.rulesDbBytes;
      manifest.topicsIndexBytes = info.topicsIndexBytes;
      fs.writeFileSync(DEFAULT_MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      console.log(`[setup-db] 已更新清单文件: ${DEFAULT_MANIFEST_PATH}`);
    }
    return;
  }

  assertFts5Support();

  const isForce = args.includes('--force') || args.includes('-f');
  const forceRelease = args.includes('--from-release');
  const forceSource = args.includes('--from-source') || args.includes('--build');
  const targetDir = process.env.DND_DB_DIR
    ? path.resolve(process.env.DND_DB_DIR)
    : path.resolve(ROOT_DIR, 'references');

  const dbPath = path.join(targetDir, 'rules.db');
  const indexPath = path.join(targetDir, 'topics_index.json');
  const dedupReportPath = path.join(targetDir, 'dedup-report.json');
  if (!isForce && fs.existsSync(dbPath) && fs.existsSync(indexPath) && fs.existsSync(dedupReportPath)) {
    console.log(`[setup-db] 检测到已存在 ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(2)} MiB)，如需覆盖重建请加 --force。`);
    return;
  }

  if (forceSource) {
    setupFromSource({
      sourceDir: getOpt('--source-dir'),
      upstreamCommit: getOpt('--commit'),
      targetDir
    });
    return;
  }

  if (forceRelease) {
    await setupFromRelease({
      url: getOpt('--url'),
      sha256: getOpt('--sha256'),
      targetDir
    });
    return;
  }

  // Default auto mode: retry transient Release HTTP 5xx responses before falling back to a source build.
  // Never fall back if SHA-256 verification failed!
  try {
    await setupFromRelease({
      url: getOpt('--url'),
      sha256: getOpt('--sha256'),
      targetDir
    });
  } catch (err) {
    if (String(err.message || '').includes('SHA-256 校验失败')) {
      throw err;
    }
    console.warn(`[setup-db] Release 预编译包暂不可用 (${err.message})，自动切换为从上游 5echm_web@${DEFAULT_UPSTREAM_COMMIT} 本地构建...`);
    setupFromSource({
      sourceDir: getOpt('--source-dir'),
      upstreamCommit: getOpt('--commit'),
      targetDir
    });
  }
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'setup-db.js')
);

if (isMain) {
  cli().catch(err => {
    console.error(`[setup-db] 错误: ${err.message}`);
    process.exit(1);
  });
}
