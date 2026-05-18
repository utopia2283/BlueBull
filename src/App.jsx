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

function App() {
  const [url, setUrl] = useState('')
  const [type, setType] = useState('mp4')
  const [directoryHandle, setDirectoryHandle] = useState(null)
  const [health, setHealth] = useState(null)
  const [video, setVideo] = useState(null)
  const [error, setError] = useState(emptyError)
  const [loading, setLoading] = useState({ health: true, info: false, download: false })

  const ready = health?.ready
  const supportsFolderPicker = 'showDirectoryPicker' in window
  const statusLabel = useMemo(() => {
    if (!health) return 'Checking'
    if (health.ready) return 'Ready'
    if (health.status === 'deployed_preview') return 'Preview only'
    if (!health.ytdlp?.ok) return 'yt-dlp missing'
    if (!health.ytdlp?.versionOk) return 'yt-dlp outdated'
    if (!health.ffmpeg?.ok) return 'ffmpeg missing'
    if (!health.probe?.ok) return 'YouTube probe failed'
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

  async function fetchInfo(event) {
    event.preventDefault()
    setLoading((current) => ({ ...current, info: true }))
    setError(emptyError)
    setVideo(null)
    try {
      const result = await request('/api/info', {
        method: 'POST',
        body: JSON.stringify({ url }),
      })
      setVideo(result.video)
    } catch (nextError) {
      setError(nextError)
    } finally {
      setLoading((current) => ({ ...current, info: false }))
    }
  }

  async function chooseFolder() {
    setError(emptyError)
    if (!supportsFolderPicker) {
      setError({
        code: 'browser_downloads',
        message: 'This browser cannot choose a folder here. It will use the browser download prompt or default downloads folder.',
      })
      return
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      setDirectoryHandle(handle)
      setError({ code: 'folder_selected', message: `Downloads will be saved to: ${handle.name}` })
    } catch (nextError) {
      if (nextError?.name !== 'AbortError') {
        setError({ code: 'folder_error', message: 'Could not open the folder picker.' })
      }
    }
  }

  async function download() {
    setLoading((current) => ({ ...current, download: true }))
    setError(emptyError)
    try {
      const response = await fetch('/api/download-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, type }),
      })

      if (!response.ok) {
        const body = await response.json()
        throw body.error || { code: 'download_error', message: 'Download failed.' }
      }

      const blob = await response.blob()
      const disposition = response.headers.get('content-disposition') || ''
      const fallbackName = `bluebull-download.${type}`
      const fileName = decodeURIComponent(disposition.match(/filename="?([^"]+)"?/i)?.[1] || fallbackName)

      if (supportsFolderPicker && directoryHandle) {
        const handle = await directoryHandle.getFileHandle(fileName, { create: true })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
        setError({ code: 'download_complete', message: `Saved to ${directoryHandle.name}: ${fileName}` })
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
            <h1>Save YouTube video or audio</h1>
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

        <form className="download-form" onSubmit={fetchInfo}>
          <label htmlFor="url">YouTube URL</label>
          <div className="url-row">
            <input
              id="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
            />
            <button type="submit" disabled={loading.info || !url.trim()}>
              {loading.info ? 'Checking' : 'Check'}
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

          <div className="folder-row">
            <button type="button" onClick={chooseFolder}>
              Choose folder
            </button>
            <span>
              {supportsFolderPicker
                ? directoryHandle?.name || 'No folder selected'
                : 'Browser download settings will choose the folder'}
            </span>
          </div>
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
          <div className={error.code === 'download_complete' || error.code === 'folder_selected' ? 'message success' : 'message'}>
            <strong>{error.code || 'status'}</strong>
            <span>{error.message}</span>
          </div>
        )}

        <button className="primary-action" type="button" onClick={download} disabled={!ready || !url.trim() || loading.download || (supportsFolderPicker && !directoryHandle)}>
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
            <li className={health?.ffmpeg?.ok ? 'pass' : 'fail'}>
              <span>ffmpeg</span>
              <strong>{health?.ffmpeg?.previewOnly ? 'local only' : health?.ffmpeg?.ok ? 'found' : 'missing'}</strong>
            </li>
            <li className={health?.probe?.ok ? 'pass' : 'fail'}>
              <span>YouTube probe</span>
              <strong>{health?.probe?.previewOnly ? 'local only' : health?.probe?.ok ? 'passed' : 'failed'}</strong>
            </li>
          </ul>
        </section>

        <section>
          <h2>Save location</h2>
          <p className="muted">
            {supportsFolderPicker
              ? directoryHandle?.name || 'Choose a folder before downloading.'
              : 'Your browser will ask where to save, or use its default downloads folder.'}
          </p>
        </section>
      </aside>
    </main>
  )
}

export default App
