import { useEffect, useMemo, useState } from 'react'
import './App.css'

const emptyError = { code: '', message: '' }

function formatDuration(seconds) {
  if (!seconds) return 'Unknown length'
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function formatSize(bytes) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function App() {
  const [url, setUrl] = useState('')
  const [type, setType] = useState('mp4')
  const [health, setHealth] = useState(null)
  const [video, setVideo] = useState(null)
  const [downloads, setDownloads] = useState([])
  const [error, setError] = useState(emptyError)
  const [loading, setLoading] = useState({ health: true, info: false, download: false })

  const ready = health?.ready
  const statusLabel = useMemo(() => {
    if (!health) return 'Checking'
    if (health.ready) return 'Ready'
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
      setDownloads(result.recent || [])
    } catch (nextError) {
      setError(nextError)
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

  async function download() {
    setLoading((current) => ({ ...current, download: true }))
    setError(emptyError)
    try {
      const result = await request('/api/download', {
        method: 'POST',
        body: JSON.stringify({ url, type }),
      })
      setDownloads(result.recent || [])
      if (result.file) {
        setError({ code: 'download_complete', message: `Saved: ${result.file.name}` })
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
        setDownloads(result.recent || [])
      } catch {
        if (!active) return
        setHealth({
          ready: false,
          status: 'deployed_preview',
          downloadDir: 'Run locally to download files',
          ytdlp: { ok: false, version: null, versionOk: false },
          ffmpeg: { ok: false },
          probe: { ok: false },
        })
        setError({
          code: 'local_api_unavailable',
          message: 'BlueBull is deployed as a preview. Run it on your Mac to use yt-dlp downloads.',
        })
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
            <span>{health?.downloadDir || '~/Desktop/BlueBull Downloads'}</span>
          </div>
          <small>yt-dlp {health?.ytdlp?.version || 'not found'}</small>
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

        <button className="primary-action" type="button" onClick={download} disabled={!ready || !url.trim() || loading.download}>
          {loading.download ? 'Downloading...' : `Download ${type.toUpperCase()}`}
        </button>
      </section>

      <aside className="side-panel">
        <section>
          <h2>System check</h2>
          <ul className="check-list">
            <li className={health?.ytdlp?.ok && health?.ytdlp?.versionOk ? 'pass' : 'fail'}>
              <span>yt-dlp</span>
              <strong>{health?.ytdlp?.version || 'missing'}</strong>
            </li>
            <li className={health?.ffmpeg?.ok ? 'pass' : 'fail'}>
              <span>ffmpeg</span>
              <strong>{health?.ffmpeg?.ok ? 'found' : 'missing'}</strong>
            </li>
            <li className={health?.probe?.ok ? 'pass' : 'fail'}>
              <span>YouTube probe</span>
              <strong>{health?.probe?.ok ? 'passed' : 'failed'}</strong>
            </li>
          </ul>
        </section>

        <section>
          <h2>Recent downloads</h2>
          <div className="download-list">
            {downloads.length === 0 && <p className="muted">No files yet.</p>}
            {downloads.map((file) => (
              <div className="download-item" key={file.path}>
                <span>{file.name}</span>
                <small>{formatSize(file.size)}</small>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  )
}

export default App
