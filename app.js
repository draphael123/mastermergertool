/**
 * Folder PDF Merger — Enhanced Edition
 * 
 * Features:
 *   - Drag & drop file/folder upload
 *   - Manual drag-to-reorder
 *   - Real-time progress indicator
 *   - Distinctive dark UI with warm accents
 *
 * Run:
 *   npm install
 *   npm start
 *
 * Open:
 *   http://localhost:3000
 */

const express = require("express");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

function naturalSort(a, b) {
  const ax = [];
  const bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => ax.push([$1 || Infinity, $2 || ""]));
  b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => bx.push([$1 || Infinity, $2 || ""]));
  while (ax.length && bx.length) {
    const an = ax.shift();
    const bn = bx.shift();
    const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }
  return ax.length - bx.length;
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>PDF Merger</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #0d0d0d;
      --bg-surface: #161616;
      --bg-elevated: #1e1e1e;
      --bg-hover: #252525;
      --border: #2a2a2a;
      --border-active: #3d3d3d;
      --text: #e8e4df;
      --text-muted: #8a857f;
      --text-dim: #5c5954;
      --accent: #e8a849;
      --accent-hover: #f0b85a;
      --accent-glow: rgba(232, 168, 73, 0.15);
      --success: #6bcf7f;
      --error: #e85a5a;
      --error-bg: rgba(232, 90, 90, 0.1);
    }

    * { box-sizing: border-box; }
    
    html { 
      background: var(--bg-deep);
      min-height: 100%;
    }
    
    body {
      margin: 0;
      min-height: 100vh;
      background: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(232, 168, 73, 0.08), transparent),
        radial-gradient(ellipse 60% 40% at 100% 100%, rgba(232, 168, 73, 0.04), transparent),
        var(--bg-deep);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    .container {
      max-width: 820px;
      margin: 0 auto;
      padding: 60px 24px 80px;
    }

    /* Header */
    header {
      text-align: center;
      margin-bottom: 48px;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, var(--accent) 0%, #d4922e 100%);
      border-radius: 16px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(232, 168, 73, 0.25);
    }

    .logo svg {
      width: 32px;
      height: 32px;
      fill: var(--bg-deep);
    }

    h1 {
      font-family: 'DM Serif Display', serif;
      font-size: 42px;
      font-weight: 400;
      margin: 0 0 12px;
      letter-spacing: -0.5px;
      color: var(--text);
    }

    .tagline {
      color: var(--text-muted);
      font-size: 16px;
      margin: 0;
    }

    /* Cards */
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }

    .card-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: var(--accent);
      color: var(--bg-deep);
      font-weight: 700;
      font-size: 13px;
      border-radius: 8px;
    }

    .card-title {
      font-weight: 600;
      font-size: 16px;
    }

    /* Drop Zone */
    .dropzone {
      position: relative;
      border: 2px dashed var(--border-active);
      border-radius: 12px;
      padding: 48px 24px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      background: var(--bg-elevated);
    }

    .dropzone:hover {
      border-color: var(--accent);
      background: var(--accent-glow);
    }

    .dropzone.drag-over {
      border-color: var(--accent);
      background: var(--accent-glow);
      transform: scale(1.01);
    }

    .dropzone-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      opacity: 0.6;
    }

    .dropzone-icon svg {
      width: 100%;
      height: 100%;
      stroke: var(--text);
    }

    .dropzone-text {
      font-size: 15px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .dropzone-text strong {
      color: var(--accent);
    }

    .dropzone-hint {
      font-size: 13px;
      color: var(--text-dim);
    }

    .dropzone input {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }

    /* Stats */
    .stats {
      display: flex;
      gap: 16px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--bg-elevated);
      border-radius: 10px;
      font-size: 13px;
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
      color: var(--accent);
    }

    /* File List */
    .file-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 8px;
      cursor: grab;
      transition: all 0.15s ease;
      user-select: none;
    }

    .file-item:hover {
      border-color: var(--border-active);
      background: var(--bg-hover);
    }

    .file-item.dragging {
      opacity: 0.5;
      transform: scale(0.98);
    }

    .file-item.drag-over-item {
      border-color: var(--accent);
      background: var(--accent-glow);
    }

    .drag-handle {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      opacity: 0.4;
      transition: opacity 0.15s;
    }

    .file-item:hover .drag-handle {
      opacity: 0.7;
    }

    .drag-handle span {
      display: block;
      width: 14px;
      height: 2px;
      background: var(--text);
      border-radius: 1px;
    }

    .file-index {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
      min-width: 24px;
    }

    .file-name {
      flex: 1;
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-size {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
    }

    .file-remove {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .file-remove:hover {
      background: var(--error-bg);
      color: var(--error);
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-dim);
      font-size: 14px;
    }

    /* Progress */
    .progress-wrap {
      margin-top: 20px;
      display: none;
    }

    .progress-wrap.visible {
      display: block;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 13px;
    }

    .progress-text {
      color: var(--text-muted);
    }

    .progress-percent {
      font-family: 'JetBrains Mono', monospace;
      color: var(--accent);
    }

    .progress-bar {
      height: 6px;
      background: var(--bg-elevated);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      border-radius: 3px;
      width: 0%;
      transition: width 0.3s ease;
    }

    /* Button */
    .merge-btn {
      width: 100%;
      padding: 16px 24px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent) 0%, #d4922e 100%);
      color: var(--bg-deep);
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 20px rgba(232, 168, 73, 0.3);
    }

    .merge-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 28px rgba(232, 168, 73, 0.4);
    }

    .merge-btn:active:not(:disabled) {
      transform: translateY(0);
    }

    .merge-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* Status Messages */
    .status {
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 14px;
      margin-top: 16px;
      display: none;
    }

    .status.visible {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status.success {
      background: rgba(107, 207, 127, 0.1);
      border: 1px solid rgba(107, 207, 127, 0.2);
      color: var(--success);
    }

    .status.error {
      background: var(--error-bg);
      border: 1px solid rgba(232, 90, 90, 0.2);
      color: var(--error);
    }

    /* Guide */
    .guide {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      overflow: hidden;
    }

    .guide-header {
      padding: 18px 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.15s;
    }

    .guide-header:hover {
      background: var(--bg-elevated);
    }

    .guide-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 15px;
    }

    .guide-title svg {
      width: 18px;
      height: 18px;
      stroke: var(--accent);
    }

    .guide-chevron {
      width: 20px;
      height: 20px;
      stroke: var(--text-dim);
      transition: transform 0.2s ease;
    }

    .guide.open .guide-chevron {
      transform: rotate(180deg);
    }

    .guide-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .guide.open .guide-content {
      max-height: 600px;
    }

    .guide-inner {
      padding: 0 24px 24px;
      border-top: 1px solid var(--border);
    }

    .guide-section {
      margin-top: 20px;
    }

    .guide-section h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--accent);
      margin: 0 0 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .guide-section p,
    .guide-section li {
      font-size: 14px;
      color: var(--text-muted);
      margin: 0;
      line-height: 1.7;
    }

    .guide-section ul {
      margin: 0;
      padding-left: 20px;
    }

    .guide-section li {
      margin-bottom: 6px;
    }

    .guide-section li::marker {
      color: var(--accent);
    }

    .kbd {
      display: inline-block;
      padding: 2px 6px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text);
    }

    /* Footer */
    footer {
      text-align: center;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 13px;
    }

    footer a {
      color: var(--accent);
      text-decoration: none;
    }

    footer a:hover {
      text-decoration: underline;
    }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card {
      animation: fadeIn 0.4s ease backwards;
    }

    .card:nth-child(1) { animation-delay: 0.1s; }
    .card:nth-child(2) { animation-delay: 0.2s; }

    .guide {
      animation: fadeIn 0.4s ease 0.3s backwards;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="#0d0d0d" stroke-width="1.5" fill="none"/>
        </svg>
      </div>
      <h1>PDF Merger</h1>
      <p class="tagline">Combine multiple PDFs into one. Drag to reorder.</p>
    </header>

    <!-- Step 1: Upload -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">1</span>
        <span class="card-title">Select PDF Files</span>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dropzone-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="dropzone-text">
          <strong>Drop files or folder here</strong> or click to browse
        </div>
        <div class="dropzone-hint">Accepts PDF files • Folder upload supported in Chrome/Edge</div>
        <input type="file" id="fileInput" multiple accept=".pdf,application/pdf" />
      </div>

      <div class="stats" id="stats" style="display:none;">
        <div class="stat">
          <span>PDFs:</span>
          <span class="stat-value" id="pdfCount">0</span>
        </div>
        <div class="stat">
          <span>Total size:</span>
          <span class="stat-value" id="totalSize">0 KB</span>
        </div>
      </div>
    </div>

    <!-- Step 2: Reorder & Merge -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">2</span>
        <span class="card-title">Review & Reorder</span>
      </div>

      <ul class="file-list" id="fileList">
        <li class="empty-state">No PDFs selected yet. Upload files above to get started.</li>
      </ul>

      <div class="progress-wrap" id="progress">
        <div class="progress-label">
          <span class="progress-text" id="progressText">Uploading...</span>
          <span class="progress-percent" id="progressPercent">0%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
      </div>

      <div class="status" id="status"></div>

      <button class="merge-btn" id="mergeBtn" disabled>
        Merge PDFs
      </button>
    </div>

    <!-- Guide -->
    <div class="guide" id="guide">
      <div class="guide-header" onclick="toggleGuide()">
        <div class="guide-title">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          How to Use
        </div>
        <svg class="guide-chevron" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="guide-content">
        <div class="guide-inner">
          <div class="guide-section">
            <h3>Uploading Files</h3>
            <ul>
              <li><strong>Drag & drop</strong> PDFs directly onto the upload area</li>
              <li><strong>Click to browse</strong> and select individual files</li>
              <li><strong>Folder upload:</strong> In Chrome/Edge, drop a folder to import all PDFs inside</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Reordering</h3>
            <ul>
              <li>Drag files by the handle (≡) to change their order</li>
              <li>Files merge in the order shown—top to bottom</li>
              <li>Click the <span class="kbd">✕</span> button to remove a file</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Merging</h3>
            <ul>
              <li>Click <strong>Merge PDFs</strong> when ready</li>
              <li>Progress shows upload and processing status</li>
              <li>Download starts automatically when complete</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Troubleshooting</h3>
            <ul>
              <li><strong>Encrypted PDFs:</strong> Remove password protection before merging</li>
              <li><strong>Large files:</strong> Files up to 250MB each are supported</li>
              <li><strong>Browser issues:</strong> Use Chrome or Edge for best compatibility</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Files are processed on the server and not stored. 
      <br>Built with <a href="https://pdf-lib.js.org/" target="_blank">pdf-lib</a>.
    </footer>
  </div>

<script>
(function() {
  // Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const stats = document.getElementById('stats');
  const pdfCountEl = document.getElementById('pdfCount');
  const totalSizeEl = document.getElementById('totalSize');
  const fileList = document.getElementById('fileList');
  const mergeBtn = document.getElementById('mergeBtn');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const statusEl = document.getElementById('status');
  const guide = document.getElementById('guide');

  // State
  let pdfFiles = [];
  let draggedItem = null;

  // Utils
  function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return (i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
  }

  function naturalSort(a, b) {
    const rx = /(\\d+)|(\\D+)/g;
    const ax = String(a).match(rx) || [];
    const bx = String(b).match(rx) || [];
    while (ax.length && bx.length) {
      const a1 = ax.shift();
      const b1 = bx.shift();
      const an = parseInt(a1, 10);
      const bn = parseInt(b1, 10);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
      const cmp = String(a1).localeCompare(String(b1));
      if (cmp) return cmp;
    }
    return ax.length - bx.length;
  }

  function getFileName(file) {
    return file.webkitRelativePath || file.name || 'unnamed.pdf';
  }

  function isPDF(file) {
    return file.type === 'application/pdf' || 
           (file.name || '').toLowerCase().endsWith('.pdf');
  }

  // UI Updates
  function updateStats() {
    const total = pdfFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    pdfCountEl.textContent = pdfFiles.length;
    totalSizeEl.textContent = formatBytes(total);
    stats.style.display = pdfFiles.length > 0 ? 'flex' : 'none';
    mergeBtn.disabled = pdfFiles.length === 0;
  }

  function renderFileList() {
    fileList.innerHTML = '';
    
    if (pdfFiles.length === 0) {
      fileList.innerHTML = '<li class="empty-state">No PDFs selected yet. Upload files above to get started.</li>';
      return;
    }

    pdfFiles.forEach((file, index) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = true;
      li.dataset.index = index;

      li.innerHTML = \`
        <div class="drag-handle">
          <span></span><span></span><span></span>
        </div>
        <span class="file-index">\${String(index + 1).padStart(2, '0')}</span>
        <span class="file-name">\${getFileName(file)}</span>
        <span class="file-size">\${formatBytes(file.size || 0)}</span>
        <button class="file-remove" title="Remove file">✕</button>
      \`;

      // Remove button
      li.querySelector('.file-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        pdfFiles.splice(index, 1);
        renderFileList();
        updateStats();
      });

      // Drag events
      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragend', handleDragEnd);
      li.addEventListener('dragover', handleDragOver);
      li.addEventListener('drop', handleDrop);
      li.addEventListener('dragleave', handleDragLeave);

      fileList.appendChild(li);
    });
  }

  // Drag and Drop for reordering
  function handleDragStart(e) {
    draggedItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('drag-over-item');
    });
    draggedItem = null;
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this !== draggedItem) {
      this.classList.add('drag-over-item');
    }
  }

  function handleDragLeave() {
    this.classList.remove('drag-over-item');
  }

  function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over-item');
    
    if (draggedItem && this !== draggedItem) {
      const fromIndex = parseInt(draggedItem.dataset.index);
      const toIndex = parseInt(this.dataset.index);
      
      const [moved] = pdfFiles.splice(fromIndex, 1);
      pdfFiles.splice(toIndex, 0, moved);
      
      renderFileList();
    }
  }

  // File Drop Zone
  function handleFileDrop(e) {
    e.preventDefault();
    dropzone.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    const newFiles = [];

    if (items) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        processEntries(entries).then(files => {
          addFiles(files);
        });
        return;
      }
    }

    // Fallback to regular files
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function processEntries(entries) {
    const files = [];
    
    async function readEntry(entry, path = '') {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file(file => {
            // Preserve path info
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path + file.name,
              writable: false
            });
            resolve(file);
          });
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise((resolve) => {
          dirReader.readEntries(resolve);
        });
        const subFiles = [];
        for (const subEntry of entries) {
          const result = await readEntry(subEntry, path + entry.name + '/');
          if (Array.isArray(result)) {
            subFiles.push(...result);
          } else if (result) {
            subFiles.push(result);
          }
        }
        return subFiles;
      }
    }

    for (const entry of entries) {
      const result = await readEntry(entry);
      if (Array.isArray(result)) {
        files.push(...result);
      } else if (result) {
        files.push(result);
      }
    }

    return files;
  }

  function addFiles(files) {
    const pdfs = files.filter(isPDF);
    
    // Sort naturally then add
    pdfs.sort((a, b) => naturalSort(
      getFileName(a).toLowerCase(),
      getFileName(b).toLowerCase()
    ));

    // Add unique files only
    pdfs.forEach(file => {
      const exists = pdfFiles.some(f => 
        getFileName(f) === getFileName(file) && f.size === file.size
      );
      if (!exists) {
        pdfFiles.push(file);
      }
    });

    renderFileList();
    updateStats();
    hideStatus();
  }

  // Progress & Status
  function showProgress(text, percent) {
    progress.classList.add('visible');
    progressText.textContent = text;
    progressPercent.textContent = percent + '%';
    progressFill.style.width = percent + '%';
  }

  function hideProgress() {
    progress.classList.remove('visible');
  }

  function showStatus(message, isError = false) {
    statusEl.className = 'status visible ' + (isError ? 'error' : 'success');
    statusEl.innerHTML = (isError ? '⚠ ' : '✓ ') + message;
  }

  function hideStatus() {
    statusEl.className = 'status';
  }

  // Merge
  async function handleMerge() {
    if (pdfFiles.length === 0) return;

    mergeBtn.disabled = true;
    hideStatus();
    showProgress('Preparing upload...', 0);

    try {
      const fd = new FormData();
      pdfFiles.forEach((f, i) => {
        fd.append('files', f, getFileName(f));
      });

      // Upload with progress
      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 70);
            showProgress('Uploading...', pct);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            resolve(xhr.response);
          } else {
            reject(new Error(xhr.responseText || 'Merge failed'));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
      });

      xhr.open('POST', '/merge');
      xhr.responseType = 'blob';
      xhr.send(fd);

      showProgress('Processing PDFs...', 75);

      const blob = await uploadPromise;

      showProgress('Complete!', 100);

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showStatus('Merge complete! Download started.');
      
      setTimeout(hideProgress, 1500);

    } catch (err) {
      hideProgress();
      showStatus(err.message || 'Merge failed. Check that PDFs are not encrypted.', true);
    } finally {
      mergeBtn.disabled = false;
    }
  }

  // Guide toggle
  window.toggleGuide = function() {
    guide.classList.toggle('open');
  };

  // Event Listeners
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', handleFileDrop);

  fileInput.addEventListener('change', () => {
    addFiles(Array.from(fileInput.files || []));
    fileInput.value = '';
  });

  mergeBtn.addEventListener('click', handleMerge);

  // Init
  updateStats();
})();
</script>
</body>
</html>`);
});

app.post("/merge", upload.array("files"), async (req, res) => {
  try {
    const uploaded = req.files || [];
    const pdfs = uploaded.filter((f) => {
      const name = String(f.originalname || "").toLowerCase();
      const mimetype = String(f.mimetype || "");
      return mimetype === "application/pdf" || name.endsWith(".pdf");
    });

    if (pdfs.length === 0) {
      return res.status(400).type("text/plain").send("No PDF files uploaded.");
    }

    const merged = await PDFDocument.create();

    for (const f of pdfs) {
      const doc = await PDFDocument.load(f.buffer, { ignoreEncryption: false });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }

    const mergedBytes = await merged.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="merged.pdf"');
    return res.status(200).send(Buffer.from(mergedBytes));
  } catch (err) {
    const msg = String(err?.message || "Merge failed.");

    if (msg.toLowerCase().includes("encrypted") || msg.toLowerCase().includes("password")) {
      return res
        .status(500)
        .type("text/plain")
        .send("One or more PDFs are encrypted/password-protected. Remove protection and try again.");
    }

    return res.status(500).type("text/plain").send(msg);
  }
});

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`PDF Merger running at http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app;

