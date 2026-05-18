# BlueBull

BlueBull is a local-only YouTube video/audio downloader with a React interface
and an Express backend powered by `yt-dlp`.

## Requirements

- Node.js
- `yt-dlp` 2026.03.17 or newer
- `ffmpeg`

## Run Locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Downloads are saved to:

```text
~/Desktop/BlueBull Downloads
```

## Vercel

The Vercel deployment is a preview build of the interface. Actual downloads need
the local Express server because Vercel serverless functions do not provide a
durable local filesystem or bundled `yt-dlp`/`ffmpeg` runtime for this workflow.

Only download content you have the right to save. BlueBull does not support DRM,
paid content, login bypass, or unauthorized downloads.
