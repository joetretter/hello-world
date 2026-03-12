const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  storageDir: path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), 'storage')),
  maxFileSize: Number(process.env.MAX_FILE_SIZE || 50 * 1024 * 1024),
  allowRecursiveDirDelete: (process.env.ALLOW_RECURSIVE_DIR_DELETE || 'true').toLowerCase() === 'true'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function toSafePath(relativePath = '') {
  const normalizedRaw = path.normalize(relativePath || '');
  const normalized = (normalizedRaw === '.' ? '' : normalizedRaw).replace(/^([/\\])+/, '');
  const fullPath = path.resolve(config.storageDir, normalized);
  if (!fullPath.startsWith(config.storageDir)) {
    throw new Error('Path escapes storage root');
  }
  return { fullPath, normalizedPath: normalized.replace(/\\/g, '/') };
}

function getContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function ensureStorageRoot() {
  await fsp.mkdir(config.storageDir, { recursive: true });
}

async function parseRequestBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > config.maxFileSize) {
      const error = new Error('File too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function listDirectory(relativePath) {
  const { fullPath, normalizedPath } = toSafePath(relativePath);
  const stats = await fsp.stat(fullPath);
  if (!stats.isDirectory()) {
    const error = new Error('Path is not a directory');
    error.statusCode = 400;
    throw error;
  }

  const entries = await fsp.readdir(fullPath, { withFileTypes: true });
  const items = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(fullPath, entry.name);
    const entryStats = await fsp.stat(entryPath);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      size: entry.isDirectory() ? null : entryStats.size,
      modifiedAt: entryStats.mtime.toISOString()
    };
  }));

  items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: normalizedPath,
    parent: normalizedPath ? path.posix.dirname(normalizedPath) === '.' ? '' : path.posix.dirname(normalizedPath) : null,
    items
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const relativePath = url.searchParams.get('path') || '';

  if (pathname === '/api/list' && req.method === 'GET') {
    const listing = await listDirectory(relativePath);
    return sendJson(res, 200, listing);
  }

  if (pathname === '/api/file' && req.method === 'GET') {
    const { fullPath } = toSafePath(relativePath);
    const stats = await fsp.stat(fullPath);
    if (!stats.isFile()) {
      return sendJson(res, 400, { error: 'Requested path is not a file' });
    }

    res.writeHead(200, {
      'Content-Type': getContentType(fullPath),
      'Content-Length': stats.size,
      'Content-Disposition': `attachment; filename="${path.basename(fullPath)}"`
    });
    fs.createReadStream(fullPath).pipe(res);
    return;
  }

  if (pathname === '/api/text' && req.method === 'GET') {
    const { fullPath } = toSafePath(relativePath);
    const data = await fsp.readFile(fullPath, 'utf8');
    return sendJson(res, 200, { path: relativePath, content: data });
  }

  if (pathname === '/api/file' && req.method === 'PUT') {
    const { fullPath } = toSafePath(relativePath);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    const data = await parseRequestBody(req);
    await fsp.writeFile(fullPath, data);
    return sendJson(res, 200, { message: 'File saved', path: relativePath, size: data.length });
  }

  if (pathname === '/api/file' && req.method === 'DELETE') {
    const { fullPath } = toSafePath(relativePath);
    await fsp.unlink(fullPath);
    return sendJson(res, 200, { message: 'File deleted', path: relativePath });
  }

  if (pathname === '/api/dir' && req.method === 'POST') {
    const { fullPath } = toSafePath(relativePath);
    await fsp.mkdir(fullPath, { recursive: true });
    return sendJson(res, 201, { message: 'Directory created', path: relativePath });
  }

  if (pathname === '/api/dir' && req.method === 'DELETE') {
    const { fullPath } = toSafePath(relativePath);
    const recursive = config.allowRecursiveDirDelete && (url.searchParams.get('recursive') || 'false').toLowerCase() === 'true';
    await fsp.rm(fullPath, { recursive, force: false });
    return sendJson(res, 200, { message: 'Directory deleted', path: relativePath, recursive });
  }

  sendJson(res, 404, { error: 'API route not found' });
}

async function serveStatic(req, res, url) {
  const root = path.join(process.cwd(), 'public');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const clean = path.normalize(requested).replace(/^([/\\])+/, '');
  const fullPath = path.resolve(root, clean);

  if (!fullPath.startsWith(root)) {
    return sendJson(res, 400, { error: 'Invalid path' });
  }

  try {
    const data = await fsp.readFile(fullPath);
    res.writeHead(200, { 'Content-Type': getContentType(fullPath) });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    throw error;
  }
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    const statusCode = error.statusCode || (error.code === 'ENOENT' ? 404 : 500);
    sendJson(res, statusCode, { error: error.message || 'Internal server error' });
  }
}

ensureStorageRoot().then(() => {
  const server = http.createServer(requestHandler);
  server.listen(config.port, config.host, () => {
    console.log(`Server running at http://${config.host}:${config.port}`);
    console.log(`Storage root: ${config.storageDir}`);
  });
}).catch((error) => {
  console.error('Failed to initialize server:', error);
  process.exit(1);
});
