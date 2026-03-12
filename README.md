# File Browser API + SPA

A fresh Node.js project that runs a single HTTP server to:

- Serve a vanilla single-page web app for browsing files.
- Expose REST API endpoints under `/api/` for file and directory operations.

## Features

- File upload/download/delete (binary-safe).
- Directory list/create/delete and navigation.
- Text and image preview from within the SPA.
- Configurable entirely through environment variables with defaults.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind host |
| `PORT` | `3000` | Bind port |
| `STORAGE_DIR` | `./storage` | Root folder for managed files |
| `MAX_FILE_SIZE` | `52428800` (50 MB) | Max request size for uploads |
| `ALLOW_RECURSIVE_DIR_DELETE` | `true` | Allows recursive directory deletion when `recursive=true` |

## Run

```bash
npm start
```

Then open: `http://localhost:3000`

## API

- `GET /api/list?path=<relativePath>`
- `GET /api/file?path=<relativePath>`
- `PUT /api/file?path=<relativePath>` (raw binary request body)
- `DELETE /api/file?path=<relativePath>`
- `GET /api/text?path=<relativePath>`
- `POST /api/dir?path=<relativePath>`
- `DELETE /api/dir?path=<relativePath>&recursive=true`
