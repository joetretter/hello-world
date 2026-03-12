const state = {
  currentPath: ''
};

const dom = {
  currentPath: document.getElementById('currentPath'),
  tableBody: document.getElementById('fileTableBody'),
  status: document.getElementById('status'),
  upBtn: document.getElementById('upBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  uploadInput: document.getElementById('uploadInput'),
  newDirName: document.getElementById('newDirName'),
  createDirBtn: document.getElementById('createDirBtn'),
  textPreview: document.getElementById('textPreview'),
  imagePreview: document.getElementById('imagePreview'),
  emptyPreview: document.getElementById('emptyPreview')
};

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.style.color = isError ? '#b00020' : '#006400';
}

function normalizePath(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

function parentPath(p) {
  if (!p) return '';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function clearPreview() {
  dom.textPreview.hidden = true;
  dom.imagePreview.hidden = true;
  dom.emptyPreview.hidden = false;
}

function isImage(name) {
  return /\.(png|jpg|jpeg|gif|svg)$/i.test(name);
}

function isText(name) {
  return /\.(txt|md|json|js|css|html|xml|csv|log|yml|yaml)$/i.test(name);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch (_) {
      // ignore parse errors
    }
    throw new Error(message);
  }
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response;
}

async function loadDirectory(targetPath = state.currentPath) {
  try {
    const data = await apiRequest(`/api/list?path=${encodeURIComponent(targetPath)}`);
    state.currentPath = data.path;
    dom.currentPath.textContent = '/' + (state.currentPath || '');
    renderTable(data.items);
    setStatus(`Loaded ${data.items.length} item(s).`);
    clearPreview();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function createActionButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderTable(items) {
  dom.tableBody.innerHTML = '';

  if (!items.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.textContent = '(Empty directory)';
    row.appendChild(cell);
    dom.tableBody.appendChild(row);
    return;
  }

  for (const item of items) {
    const row = document.createElement('tr');
    const filePath = normalizePath(state.currentPath, item.name);

    const nameCell = document.createElement('td');
    nameCell.textContent = item.name;

    const typeCell = document.createElement('td');
    typeCell.textContent = item.type;

    const sizeCell = document.createElement('td');
    sizeCell.textContent = item.size == null ? '-' : `${item.size} B`;

    const modCell = document.createElement('td');
    modCell.textContent = item.modifiedAt;

    const actionsCell = document.createElement('td');

    if (item.type === 'directory') {
      actionsCell.appendChild(createActionButton('Open', () => loadDirectory(filePath)));
      actionsCell.appendChild(createActionButton('Delete', () => deleteDirectory(filePath)));
    } else {
      actionsCell.appendChild(createActionButton('Download', () => downloadFile(filePath)));
      actionsCell.appendChild(createActionButton('Delete', () => deleteFile(filePath)));
      if (isText(item.name)) {
        actionsCell.appendChild(createActionButton('View Text', () => previewText(filePath)));
      }
      if (isImage(item.name)) {
        actionsCell.appendChild(createActionButton('View Image', () => previewImage(filePath)));
      }
    }

    row.append(nameCell, typeCell, sizeCell, modCell, actionsCell);
    dom.tableBody.appendChild(row);
  }
}

async function createDirectory() {
  const name = dom.newDirName.value.trim();
  if (!name) {
    setStatus('Please enter a folder name.', true);
    return;
  }
  const targetPath = normalizePath(state.currentPath, name);

  try {
    await apiRequest(`/api/dir?path=${encodeURIComponent(targetPath)}`, { method: 'POST' });
    dom.newDirName.value = '';
    await loadDirectory(state.currentPath);
    setStatus(`Created folder: ${name}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function uploadFile(file) {
  const targetPath = normalizePath(state.currentPath, file.name);

  try {
    await apiRequest(`/api/file?path=${encodeURIComponent(targetPath)}`, {
      method: 'PUT',
      body: await file.arrayBuffer()
    });
    await loadDirectory(state.currentPath);
    setStatus(`Uploaded ${file.name}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function downloadFile(filePath) {
  const link = document.createElement('a');
  link.href = `/api/file?path=${encodeURIComponent(filePath)}`;
  link.download = filePath.split('/').pop();
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function deleteFile(filePath) {
  if (!confirm(`Delete file ${filePath}?`)) {
    return;
  }
  try {
    await apiRequest(`/api/file?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
    await loadDirectory(state.currentPath);
    setStatus(`Deleted file ${filePath}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteDirectory(dirPath) {
  if (!confirm(`Delete folder ${dirPath}? Use recursive delete?`)) {
    return;
  }
  try {
    await apiRequest(`/api/dir?path=${encodeURIComponent(dirPath)}&recursive=true`, { method: 'DELETE' });
    await loadDirectory(state.currentPath);
    setStatus(`Deleted folder ${dirPath}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function previewText(filePath) {
  try {
    const data = await apiRequest(`/api/text?path=${encodeURIComponent(filePath)}`);
    dom.textPreview.textContent = data.content;
    dom.textPreview.hidden = false;
    dom.imagePreview.hidden = true;
    dom.emptyPreview.hidden = true;
    setStatus(`Previewing text: ${filePath}`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

function previewImage(filePath) {
  dom.imagePreview.src = `/api/file?path=${encodeURIComponent(filePath)}`;
  dom.imagePreview.hidden = false;
  dom.textPreview.hidden = true;
  dom.emptyPreview.hidden = true;
  setStatus(`Previewing image: ${filePath}`);
}

dom.upBtn.addEventListener('click', () => loadDirectory(parentPath(state.currentPath)));
dom.refreshBtn.addEventListener('click', () => loadDirectory(state.currentPath));
dom.createDirBtn.addEventListener('click', createDirectory);
dom.uploadInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  await uploadFile(file);
  event.target.value = '';
});

loadDirectory('');
