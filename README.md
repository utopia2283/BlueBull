# BlueBull

BlueBull is a local video/audio downloader for public YouTube, Facebook, and
Instagram URLs, with a React interface and an Express backend powered by
`yt-dlp`.

## Requirements

- Node.js
- `yt-dlp` 2026.03.17 or newer
- `ffmpeg`

## Run Locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Users choose their own download folder in
the browser before saving a file.

For a single-port server suitable for a tunnel:

```sh
npm run build
npm start
```

## Vercel

The Vercel deployment is a preview build of the interface. Actual downloads need
the local Express server because Vercel serverless functions do not provide a
durable local filesystem or bundled `yt-dlp`/`ffmpeg` runtime for this workflow.

Only download content you have the right to save. BlueBull does not support DRM,
paid content, login bypass, or unauthorized downloads.
