import { useEffect, useMemo, useState } from 'react'
import './App.css'

const emptyError = { code: '', message: '' }
const previewHealth = {
  ready: false,
  status: 'deployed_preview',
  downloadDir: 'Preview only. Use the BlueBull tunnel URL to download files.',
  ytdlp: { ok: false, version: null, versionOk: false, previewOnly: true },
  ffmpeg: { ok: false, previewOnly: true },
  probe: { ok: false, previewOnly: true },
}
const previewError = {
  code: 'preview_only',
  message: 'This Vercel page is only a preview. Use the BlueBull tunnel URL for downloads.',
}

function formatDuration(seconds) {
  if (!seconds) return 'Unknown length'
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function safeFileStem(value) {
  return (value || 'bluebull-download')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'bluebull-download'
}

function App() {
  const [url, setUrl] = useState('')
  const [type, setType] = useState('mp4')
  const [health, setHealth] = useState(null)
  const [video, setVideo] = useState(null)
  const [error, setError] = useState(emptyError)
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [loading, setLoading] = useState({ health: true, info: false, download: false, update: false })

  const ready = health?.ready
  const supportsSavePicker = 'showSaveFilePicker' in window
  const statusLabel = useMemo(() => {
    if (!health) return 'Checking'
    if (health.ready) return 'Ready'
    if (health.status === 'deployed_preview') return 'Preview only'
    if (!health.ytdlp?.ok) return 'yt-dlp missing'
    if (!health.ytdlp?.versionOk) return 'yt-dlp outdated'
    if (!health.ffmpeg?.ok) return 'ffmpeg missing'
    if (!health.probe?.ok) return 'Extractor probe failed'
    return 'Degraded'
  }, [health])

  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const body = await response.json()
    if (!response.ok || body.ok === false) {
      throw body.error || { code: 'request_failed', message: 'Request failed.' }
    }
    return body
  }

  async function refreshHealth() {
    setLoading((current) => ({ ...current, health: true }))
    setError(emptyError)
    try {
      const result = await request('/api/health')
      setHealth(result)
    } catch {
      setHealth(previewHealth)
      setError(previewError)
    } finally {
      setLoading((current) => ({ ...current, health: false }))
    }
  }

  async function updateYtdlp() {
    setLoading((current) => ({ ...current, update: true }))
    setError(emptyError)
    try {
      const result = await request('/api/update-ytdlp', { method: 'POST' })
      setHealth((current) => ({
        ...current,
        ytdlp: {
          ...(current?.ytdlp || {}),
          version: result.update.currentVersion,
          latestVersion: result.update.latestVersion,
          updateAvailable: result.update.updateAvailable,
          updating: false,
        },
      }))
      setError({ code: 'yt_dlp_updated', message: `yt-dlp is now ${result.update.currentVersion}.` })
      await refreshHealth()
    } catch (nextError) {
      setError(nextError)
    } finally {
      setLoading((current) => ({ ...current, update: false }))
    }
  }

  async function fetchInfo(nextUrl = url) {
    setLoading((current) => ({ ...current, info: true }))
    setError(emptyError)
    setVideo(null)
    try {
      const result = await request('/api/info', {
        method: 'POST',
        body: JSON.stringify({ url: nextUrl }),
      })
      setVideo(result.video)
    } catch (nextError) {
      setError(nextError)
    } finally {
      setLoading((current) => ({ ...current, info: false }))
    }
  }

  async function pasteAndCheck(event) {
    event.preventDefault()
    let nextUrl = url

    try {
      const clipboardText = await navigator.clipboard.readText()
      if (clipboardText.trim()) {
        nextUrl = clipboardText.trim()
        setUrl(nextUrl)
      }
    } catch {
      if (!nextUrl.trim()) {
        setError({
          code: 'clipboard_blocked',
          message: 'Paste permission was blocked. Paste the video URL into the input, then try again.',
        })
        return
      }
    }

    await fetchInfo(nextUrl)
  }

  async function download() {
    setLoading((current) => ({ ...current, download: true }))
    setError(emptyError)
    setDownloadProgress({ phase: 'selecting location', progress: 0, eta: null })
    let saveHandle = null
    try {
      if (supportsSavePicker) {
        saveHandle = await window.showSaveFilePicker({
          suggestedName: `${safeFileStem(video?.title)}.${type}`,
          types: [
            {
              description: type.toUpperCase(),
              accept: { [type === 'mp4' ? 'video/mp4' : 'audio/mp4']: [`.${type}`] },
            },
          ],
        })
      }

      setDownloadProgress({ phase: 'starting', progress: 1, eta: null })
      const start = await request('/api/download-job', {
        method: 'POST',
        body: JSON.stringify({ url, type }),
      })

      let job = start.job
      setDownloadProgress(job)

      while (job.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const status = await request(`/api/download-job/${job.id}`)
        job = status.job
        setDownloadProgress(job)
      }

      if (job.status === 'error') {
        throw job.error || { code: 'download_error', message: 'Download failed.' }
      }

      setDownloadProgress({ ...job, phase: 'saving file', progress: 100 })
      const response = await fetch(`/api/download-job/${job.id}/file`)
      if (!response.ok) {
        const body = await response.json()
        throw body.error || { code: 'download_error', message: 'Could not retrieve the completed file.' }
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const fallbackName = `bluebull-download.${type}`
      const fileName = decodeURIComponent(disposition.match(/filename="?([^"]+)"?/i)?.[1] || fallbackName)

      if (saveHandle) {
        const writable = await saveHandle.createWritable()
        await writable.write(blob)
        await writable.close()
        setError({ code: 'download_complete', message: `Saved: ${saveHandle.name || fileName}` })
      } else {
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = fileName
        document.body.append(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(objectUrl)
        setError({ code: 'download_complete', message: `Sent to browser downloads: ${fileName}` })
      }
    } catch (nextError) {
      setError(nextError)
      setDownloadProgress(null)
    } finally {
      setLoading((current) => ({ ...current, download: false }))
    }
  }

  useEffect(() => {
    let active = true

    async function loadHealth() {
      setLoading((current) => ({ ...current, health: true }))
      setError(emptyError)
      try {
        const result = await request('/api/health')
        if (!active) return
        setHealth(result)
      } catch {
        if (!active) return
        setHealth(previewHealth)
        setError(previewError)
      } finally {
        if (active) setLoading((current) => ({ ...current, health: false }))
      }
    }

    loadHealth()
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="app-shell">
      <section className="tool-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">BlueBull</p>
            <h1>Save videos from YouTube, Facebook, or Instagram</h1>
          </div>
          <button className="icon-button" type="button" onClick={refreshHealth} disabled={loading.health} title="Refresh status">
            ↻
          </button>
        </div>

        <div className={`status-strip ${ready ? 'ready' : 'degraded'}`}>
          <div>
            <strong>{statusLabel}</strong>
            <span>{health?.downloadDir || 'Choose a folder on this device'}</span>
          </div>
          <small>{health?.status === 'deployed_preview' ? 'local runtime required' : `yt-dlp ${health?.ytdlp?.version || 'not found'}`}</small>
        </div>

        <form className="download-form" onSubmit={pasteAndCheck}>
          <label htmlFor="url">Video URL</label>
          <div className="url-row">
            <input
              id="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste YouTube, Facebook, or Instagram URL"
              autoComplete="off"
            />
            <button type="submit" disabled={loading.info}>
              {loading.info ? 'Checking' : 'Paste & Check'}
            </button>
          </div>

          <div className="format-row" aria-label="Download format">
            <button type="button" className={type === 'mp4' ? 'selected' : ''} onClick={() => setType('mp4')}>
              MP4
            </button>
            <button type="button" className={type === 'm4a' ? 'selected' : ''} onClick={() => setType('m4a')}>
              M4A
            </button>
          </div>

          <p className="save-note">
            {supportsSavePicker
              ? 'When you save, choose Desktop or any folder in the file dialog.'
              : 'Your browser will ask where to save, or use its default downloads folder.'}
          </p>
        </form>

        {video && (
          <article className="video-result">
            {video.thumbnail && <img src={video.thumbnail} alt="" />}
            <div>
              <h2>{video.title}</h2>
              <p>{video.uploader || 'Unknown channel'} · {formatDuration(video.duration)}</p>
            </div>
          </article>
        )}

        {error.message && (
          <div className={error.code === 'download_complete' ? 'message success' : 'message'}>
            <strong>{error.code || 'status'}</strong>
            <span>{error.message}</span>
          </div>
        )}

        {downloadProgress && (
          <div className="progress-panel">
            <div>
              <strong>{downloadProgress.phase || downloadProgress.status}</strong>
              <span>{Math.round(downloadProgress.progress || 0)}%</span>
            </div>
            <progress max="100" value={downloadProgress.progress || 0}></progress>
            {downloadProgress.eta && <small>ETA {downloadProgress.eta}</small>}
          </div>
        )}

        <button className="primary-action" type="button" onClick={download} disabled={!ready || !url.trim() || loading.download}>
          {loading.download ? 'Downloading...' : `Save ${type.toUpperCase()}`}
        </button>
      </section>

      <aside className="side-panel">
        <section>
          <h2>System check</h2>
          <ul className="check-list">
            <li className={health?.ytdlp?.ok && health?.ytdlp?.versionOk ? 'pass' : 'fail'}>
              <span>yt-dlp</span>
              <strong>{health?.ytdlp?.previewOnly ? 'local only' : health?.ytdlp?.version || 'missing'}</strong>
            </li>
            <li className={health?.ytdlp?.updateAvailable ? 'fail' : 'pass'}>
              <span>Latest yt-dlp</span>
              <strong>{health?.ytdlp?.latestVersion || 'checking'}</strong>
            </li>
            <li className={health?.ffmpeg?.ok ? 'pass' : 'fail'}>
              <span>ffmpeg</span>
              <strong>{health?.ffmpeg?.previewOnly ? 'local only' : health?.ffmpeg?.ok ? 'found' : 'missing'}</strong>
            </li>
            <li className={health?.probe?.ok ? 'pass' : 'fail'}>
              <span>Extractor probe</span>
              <strong>{health?.probe?.previewOnly ? 'local only' : health?.probe?.ok ? 'passed' : 'failed'}</strong>
            </li>
          </ul>
          <button
            className="secondary-action"
            type="button"
            onClick={updateYtdlp}
            disabled={!health?.ytdlp?.ok || loading.update || health?.ytdlp?.previewOnly}
          >
            {loading.update ? 'Updating yt-dlp...' : health?.ytdlp?.updateAvailable ? 'Update yt-dlp' : 'Check / update yt-dlp'}
          </button>
        </section>

        <section>
          <h2>Save location</h2>
          <p className="muted">
            {supportsSavePicker
              ? 'The save dialog lets users choose Desktop or any folder for each file.'
              : 'Your browser will ask where to save, or use its default downloads folder.'}
          </p>
        </section>
      </aside>
    </main>
  )
}

export default App
