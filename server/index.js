import express from 'express'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const app = express()
const port = Number(process.env.PORT || 4174)
const downloadDir = process.env.DOWNLOAD_DIR || path.join(homedir(), 'Desktop', 'BlueBull Downloads')
const probeUrl = process.env.YTDLP_PROBE_URL || 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const minVersion = '2026.03.17'

app.use(express.json({ limit: '32kb' }))

function runCommand(command, args, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1500).unref()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr, error, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut })
    })
  })
}

function compareVersions(current, minimum) {
  const toParts = (value) => String(value).split(/[._-]/).map((part) => Number(part) || 0)
  const a = toParts(current)
  const b = toParts(minimum)
  const max = Math.max(a.length, b.length)

  for (let index = 0; index < max; index += 1) {
    const left = a[index] || 0
    const right = b[index] || 0
    if (left > right) return 1
    if (left < right) return -1
  }
  return 0
}

function isYoutubeUrl(value) {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.replace(/^www\./, '')
    return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)
  } catch {
    return false
  }
}

function classifyError(stderr = '', fallback = 'Request failed') {
  const text = stderr || fallback
  const lower = text.toLowerCase()

  if (lower.includes('command not found') || lower.includes('enoent')) {
    return { code: 'missing_dependency', message: 'yt-dlp is not installed or not on PATH.' }
  }
  if (lower.includes('sign in to confirm') || lower.includes('login') || lower.includes('cookies')) {
    return { code: 'requires_login', message: 'YouTube requires sign-in or cookies for this video.' }
  }
  if (lower.includes('video unavailable') || lower.includes('private video')) {
    return { code: 'video_unavailable', message: 'This video is unavailable.' }
  }
  if (lower.includes('nsig') || lower.includes('signature') || lower.includes('403')) {
    return { code: 'extractor_degraded', message: 'YouTube extraction failed. yt-dlp may need an update.' }
  }
  if (lower.includes('requested format is not available')) {
    return { code: 'format_unavailable', message: 'The requested format is not available for this video.' }
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return { code: 'timeout', message: 'The request timed out.' }
  }

  return { code: 'download_error', message: text.trim().split('\n').slice(-1)[0] || fallback }
}

async function commandStatus(command, args) {
  const result = await runCommand(command, args, { timeoutMs: 15000 })
  if (!result.ok) {
    return { ok: false, error: classifyError(result.stderr || result.error?.message, `${command} failed`) }
  }
  return { ok: true, value: result.stdout.trim().split('\n')[0] }
}

async function getHealth() {
  const ytdlp = await commandStatus('yt-dlp', ['--version'])
  const ffmpeg = await commandStatus('ffmpeg', ['-version'])
  let probe = { ok: false, skipped: true, error: { code: 'missing_dependency', message: 'yt-dlp is unavailable.' } }

  if (ytdlp.ok) {
    const probeResult = await runCommand('yt-dlp', [
      '--dump-json',
      '--skip-download',
      '--no-playlist',
      '--socket-timeout',
      '20',
      probeUrl,
    ])

    if (probeResult.ok) {
      try {
        const data = JSON.parse(probeResult.stdout)
        probe = { ok: true, id: data.id, title: data.title, url: probeUrl }
      } catch {
        probe = { ok: false, error: { code: 'invalid_probe_output', message: 'yt-dlp returned invalid JSON.' } }
      }
    } else {
      probe = { ok: false, error: classifyError(probeResult.stderr, 'YouTube probe failed.'), url: probeUrl }
    }
  }

  const currentVersion = ytdlp.ok ? ytdlp.value : null
  const versionOk = currentVersion ? compareVersions(currentVersion, minVersion) >= 0 : false
  const ready = Boolean(ytdlp.ok && versionOk && ffmpeg.ok && probe.ok)

  return {
    ready,
    status: ready ? 'ready' : 'degraded',
    downloadDir,
    ytdlp: { ok: ytdlp.ok, version: currentVersion, minVersion, versionOk, error: ytdlp.error },
    ffmpeg: { ok: ffmpeg.ok, version: ffmpeg.value, error: ffmpeg.error },
    probe,
  }
}

async function recentDownloads() {
  try {
    await mkdir(downloadDir, { recursive: true })
    const names = await readdir(downloadDir)
    const files = await Promise.all(
      names.map(async (name) => {
        const filePath = path.join(downloadDir, name)
        const info = await stat(filePath)
        return info.isFile()
          ? { name, path: filePath, size: info.size, modifiedAt: info.mtime.toISOString() }
          : null
      }),
    )

    return files
      .filter(Boolean)
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
      .slice(0, 12)
  } catch {
    return []
  }
}

app.get('/api/health', async (_req, res) => {
  res.json({ ...(await getHealth()), recent: await recentDownloads() })
})

app.post('/api/info', async (req, res) => {
  const { url } = req.body || {}
  if (!isYoutubeUrl(url)) {
    res.status(400).json({ ok: false, error: { code: 'invalid_url', message: 'Enter a valid YouTube URL.' } })
    return
  }

  const result = await runCommand('yt-dlp', [
    '--dump-json',
    '--skip-download',
    '--no-playlist',
    '--socket-timeout',
    '25',
    url,
  ])

  if (!result.ok) {
    res.status(422).json({ ok: false, error: classifyError(result.stderr || result.error?.message, 'Unable to read video.') })
    return
  }

  try {
    const data = JSON.parse(result.stdout)
    res.json({
      ok: true,
      video: {
        id: data.id,
        title: data.title,
        uploader: data.uploader,
        duration: data.duration,
        thumbnail: data.thumbnail,
        webpageUrl: data.webpage_url,
      },
    })
  } catch {
    res.status(500).json({ ok: false, error: { code: 'invalid_output', message: 'yt-dlp returned invalid JSON.' } })
  }
})

app.post('/api/download', async (req, res) => {
  const { url, type } = req.body || {}
  if (!isYoutubeUrl(url)) {
    res.status(400).json({ ok: false, error: { code: 'invalid_url', message: 'Enter a valid YouTube URL.' } })
    return
  }
  if (!['mp4', 'm4a'].includes(type)) {
    res.status(400).json({ ok: false, error: { code: 'invalid_type', message: 'Choose MP4 or M4A.' } })
    return
  }

  await mkdir(downloadDir, { recursive: true })
  const output = path.join(downloadDir, '%(title).120s [%(id)s].%(ext)s')
  const args = [
    '--no-playlist',
    '--socket-timeout',
    '30',
    '--restrict-filenames',
    '-o',
    output,
  ]

  if (type === 'mp4') {
    args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--merge-output-format', 'mp4')
  } else {
    args.push('-f', 'ba[ext=m4a]/ba/best', '-x', '--audio-format', 'm4a')
  }
  args.push(url)

  const before = await recentDownloads()
  const result = await runCommand('yt-dlp', args, { timeoutMs: 10 * 60 * 1000 })

  if (!result.ok) {
    res.status(422).json({ ok: false, error: classifyError(result.stderr || result.error?.message, 'Download failed.'), stderr: result.stderr })
    return
  }

  const after = await recentDownloads()
  const beforeNames = new Set(before.map((file) => file.name))
  const created = after.find((file) => !beforeNames.has(file.name)) || after[0] || null
  res.json({ ok: true, file: created, recent: after })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`YouTube downloader API listening on http://127.0.0.1:${port}`)
  console.log(`Downloads: ${downloadDir}`)
})
