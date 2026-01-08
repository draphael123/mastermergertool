/**
 * Master Merge Tool — Multi-format PDF Creator
 * 
 * Features:
 *   - Merge PDFs, images, and text files into one PDF
 *   - Drag & drop folder/file upload
 *   - Manual drag-to-reorder
 *   - PDF compression (Low/Medium/High quality)
 *   - Real-time progress indicator
 *
 * Supported formats:
 *   - PDF (.pdf)
 *   - Images (.jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff)
 *   - Text (.txt)
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
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const sharp = require("sharp");

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

// Supported file extensions
const SUPPORTED = {
  pdf: ['.pdf'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
  text: ['.txt'],
};

function getFileType(filename) {
  const ext = (filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  if (SUPPORTED.pdf.includes(ext)) return 'pdf';
  if (SUPPORTED.image.includes(ext)) return 'image';
  if (SUPPORTED.text.includes(ext)) return 'text';
  return null;
}

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

// Convert image buffer to PDF page
async function imageToPdfPage(buffer, quality = 'medium') {
  // Quality settings for compression
  const qualitySettings = {
    low: { jpeg: 50, resize: 1200 },
    medium: { jpeg: 75, resize: 2000 },
    high: { jpeg: 95, resize: 4000 },
  };
  const settings = qualitySettings[quality] || qualitySettings.medium;

  // Process image with sharp
  let img = sharp(buffer);
  const metadata = await img.metadata();
  
  // Resize if larger than max dimension (for compression)
  const maxDim = settings.resize;
  if (metadata.width > maxDim || metadata.height > maxDim) {
    img = img.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
  }

  // Convert to JPEG for better compression (unless PNG with transparency)
  const jpegBuffer = await img.jpeg({ quality: settings.jpeg }).toBuffer();
  const processedMeta = await sharp(jpegBuffer).metadata();

  return {
    buffer: jpegBuffer,
    width: processedMeta.width,
    height: processedMeta.height,
  };
}

// Convert text to PDF pages
async function textToPdfPages(text, pdfDoc) {
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontSize = 11;
  const margin = 50;
  const pageWidth = 612; // Letter size
  const pageHeight = 792;
  const lineHeight = fontSize * 1.4;
  const maxWidth = pageWidth - margin * 2;
  const maxLines = Math.floor((pageHeight - margin * 2) / lineHeight);

  // Split text into lines
  const lines = text.split('\n');
  const wrappedLines = [];

  for (const line of lines) {
    if (line.length === 0) {
      wrappedLines.push('');
      continue;
    }
    
    // Word wrap
    const words = line.split(' ');
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      
      if (width > maxWidth && currentLine) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  // Create pages
  const pages = [];
  for (let i = 0; i < wrappedLines.length; i += maxLines) {
    const pageLines = wrappedLines.slice(i, i + maxLines);
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    
    let y = pageHeight - margin;
    for (const line of pageLines) {
      page.drawText(line, {
        x: margin,
        y: y - fontSize,
        size: fontSize,
        font: font,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    pages.push(page);
  }

  return pages;
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Master Merge Tool</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;700&family=Source+Sans+3:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #0a0f0d;
      --bg-surface: #111916;
      --bg-elevated: #182019;
      --bg-hover: #1f2a22;
      --border: #243027;
      --border-active: #354538;
      --text: #e4ebe6;
      --text-muted: #8b9a8f;
      --text-dim: #566259;
      --accent: #4ade80;
      --accent-hover: #6ee7a0;
      --accent-dim: #22633c;
      --accent-glow: rgba(74, 222, 128, 0.1);
      --warning: #fbbf24;
      --error: #f87171;
      --error-bg: rgba(248, 113, 113, 0.1);
      --pdf-color: #ef4444;
      --image-color: #8b5cf6;
      --text-color: #3b82f6;
    }

    * { box-sizing: border-box; }
    
    html { background: var(--bg-deep); }
    
    body {
      margin: 0;
      min-height: 100vh;
      background: 
        radial-gradient(ellipse 100% 80% at 20% -30%, rgba(74, 222, 128, 0.07), transparent 50%),
        radial-gradient(ellipse 80% 60% at 80% 120%, rgba(74, 222, 128, 0.05), transparent 50%),
        repeating-linear-gradient(0deg, transparent, transparent 50px, rgba(74, 222, 128, 0.01) 50px, rgba(74, 222, 128, 0.01) 51px),
        var(--bg-deep);
      color: var(--text);
      font-family: 'Source Sans 3', sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }

    /* Header */
    header {
      text-align: center;
      margin-bottom: 40px;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      margin-bottom: 20px;
    }

    .logo-block {
      width: 14px;
      height: 20px;
      background: var(--accent);
      border-radius: 3px;
    }

    .logo-block:nth-child(2) {
      height: 26px;
      opacity: 0.7;
    }

    .logo-block:nth-child(3) {
      height: 22px;
      opacity: 0.5;
    }

    h1 {
      font-family: 'Playfair Display', serif;
      font-size: 48px;
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -1px;
      background: linear-gradient(135deg, var(--text) 0%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .tagline {
      color: var(--text-muted);
      font-size: 17px;
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
      gap: 14px;
      margin-bottom: 20px;
    }

    .card-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%);
      color: var(--bg-deep);
      font-weight: 700;
      font-size: 14px;
      border-radius: 10px;
      font-family: 'IBM Plex Mono', monospace;
    }

    .card-title {
      font-weight: 600;
      font-size: 17px;
    }

    .card-subtitle {
      font-size: 13px;
      color: var(--text-dim);
      margin-top: 2px;
    }

    /* Drop Zone */
    .dropzone {
      position: relative;
      border: 2px dashed var(--border-active);
      border-radius: 14px;
      padding: 56px 24px;
      text-align: center;
      cursor: pointer;
      transition: all 0.25s ease;
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
      box-shadow: 0 0 40px rgba(74, 222, 128, 0.15);
    }

    .dropzone-icon {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
    }

    .dropzone-icon span {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      font-size: 18px;
    }

    .icon-pdf { background: rgba(239, 68, 68, 0.15); color: var(--pdf-color); }
    .icon-img { background: rgba(139, 92, 246, 0.15); color: var(--image-color); }
    .icon-txt { background: rgba(59, 130, 246, 0.15); color: var(--text-color); }

    .dropzone-text {
      font-size: 16px;
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

    /* Supported Formats */
    .formats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
      justify-content: center;
    }

    .format-tag {
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 500;
    }

    .format-tag.pdf { background: rgba(239, 68, 68, 0.12); color: var(--pdf-color); }
    .format-tag.image { background: rgba(139, 92, 246, 0.12); color: var(--image-color); }
    .format-tag.text { background: rgba(59, 130, 246, 0.12); color: var(--text-color); }

    /* Stats */
    .stats {
      display: flex;
      gap: 12px;
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
      border: 1px solid var(--border);
    }

    .stat-icon {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .stat-icon.pdf { background: var(--pdf-color); }
    .stat-icon.image { background: var(--image-color); }
    .stat-icon.text { background: var(--text-color); }
    .stat-icon.total { background: var(--accent); }

    .stat-value {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 500;
      color: var(--accent);
    }

    /* Options */
    .options {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 24px;
      padding: 20px;
      background: var(--bg-elevated);
      border-radius: 12px;
      border: 1px solid var(--border);
    }

    .option-group {
      flex: 1;
      min-width: 200px;
    }

    .option-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-dim);
      margin-bottom: 8px;
    }

    .option-select {
      width: 100%;
      padding: 10px 14px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-family: 'Source Sans 3', sans-serif;
      font-size: 14px;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238b9a8f' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
    }

    .option-select:focus {
      outline: none;
      border-color: var(--accent);
    }

    .quality-hint {
      font-size: 12px;
      color: var(--text-dim);
      margin-top: 6px;
    }

    /* File List */
    .file-list {
      list-style: none;
      margin: 0 0 20px;
      padding: 0;
      max-height: 400px;
      overflow-y: auto;
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
      gap: 3px;
      padding: 6px 4px;
      opacity: 0.3;
      transition: opacity 0.15s;
    }

    .file-item:hover .drag-handle { opacity: 0.6; }

    .drag-handle span {
      display: block;
      width: 16px;
      height: 2px;
      background: var(--text);
      border-radius: 1px;
    }

    .file-type {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      font-size: 14px;
      flex-shrink: 0;
    }

    .file-type.pdf { background: rgba(239, 68, 68, 0.12); color: var(--pdf-color); }
    .file-type.image { background: rgba(139, 92, 246, 0.12); color: var(--image-color); }
    .file-type.text { background: rgba(59, 130, 246, 0.12); color: var(--text-color); }

    .file-index {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
      min-width: 28px;
    }

    .file-info {
      flex: 1;
      min-width: 0;
    }

    .file-name {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      font-size: 12px;
      color: var(--text-dim);
      font-family: 'IBM Plex Mono', monospace;
    }

    .file-remove {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.15s;
    }

    .file-remove:hover {
      background: var(--error-bg);
      color: var(--error);
    }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-dim);
      font-size: 14px;
    }

    .empty-state-icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    /* Progress */
    .progress-wrap {
      margin-bottom: 20px;
      display: none;
    }

    .progress-wrap.visible { display: block; }

    .progress-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 13px;
    }

    .progress-text { color: var(--text-muted); }

    .progress-percent {
      font-family: 'IBM Plex Mono', monospace;
      color: var(--accent);
    }

    .progress-bar {
      height: 8px;
      background: var(--bg-elevated);
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent-dim), var(--accent));
      border-radius: 4px;
      width: 0%;
      transition: width 0.3s ease;
    }

    /* Button */
    .merge-btn {
      width: 100%;
      padding: 18px 24px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--accent) 0%, #22c55e 100%);
      color: var(--bg-deep);
      font-family: 'Source Sans 3', sans-serif;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 4px 24px rgba(74, 222, 128, 0.3);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .merge-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(74, 222, 128, 0.4);
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
      padding: 14px 18px;
      border-radius: 10px;
      font-size: 14px;
      margin-top: 16px;
      display: none;
      align-items: center;
      gap: 10px;
    }

    .status.visible { display: flex; }

    .status.success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.2);
      color: var(--accent);
    }

    .status.error {
      background: var(--error-bg);
      border: 1px solid rgba(248, 113, 113, 0.2);
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

    .guide-header:hover { background: var(--bg-elevated); }

    .guide-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 600;
      font-size: 15px;
    }

    .guide-title-icon {
      width: 32px;
      height: 32px;
      background: var(--accent-glow);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .guide-chevron {
      width: 20px;
      height: 20px;
      stroke: var(--text-dim);
      transition: transform 0.2s ease;
    }

    .guide.open .guide-chevron { transform: rotate(180deg); }

    .guide-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .guide.open .guide-content { max-height: 800px; }

    .guide-inner {
      padding: 0 24px 24px;
      border-top: 1px solid var(--border);
    }

    .guide-section {
      margin-top: 20px;
    }

    .guide-section h3 {
      font-size: 13px;
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
      margin-bottom: 8px;
    }

    .guide-section li::marker { color: var(--accent); }

    .kbd {
      display: inline-block;
      padding: 2px 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 5px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 12px;
      color: var(--text);
    }

    /* Footer */
    footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 13px;
    }

    footer a {
      color: var(--accent);
      text-decoration: none;
    }

    footer a:hover { text-decoration: underline; }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card { animation: fadeIn 0.5s ease backwards; }
    .card:nth-child(1) { animation-delay: 0.1s; }
    .card:nth-child(2) { animation-delay: 0.2s; }
    .guide { animation: fadeIn 0.5s ease 0.35s backwards; }

    /* Scrollbar */
    .file-list::-webkit-scrollbar {
      width: 8px;
    }

    .file-list::-webkit-scrollbar-track {
      background: var(--bg-elevated);
      border-radius: 4px;
    }

    .file-list::-webkit-scrollbar-thumb {
      background: var(--border-active);
      border-radius: 4px;
    }

    .file-list::-webkit-scrollbar-thumb:hover {
      background: var(--text-dim);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <div class="logo-block"></div>
        <div class="logo-block"></div>
        <div class="logo-block"></div>
      </div>
      <h1>Master Merge Tool</h1>
      <p class="tagline">Combine PDFs, images & text into one document</p>
    </header>

    <!-- Step 1: Upload -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">1</span>
        <div>
          <div class="card-title">Upload Files</div>
          <div class="card-subtitle">Drop a folder or select individual files</div>
        </div>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dropzone-icon">
          <span class="icon-pdf">PDF</span>
          <span class="icon-img">IMG</span>
          <span class="icon-txt">TXT</span>
        </div>
        <div class="dropzone-text">
          <strong>Drop files or folder here</strong> or click to browse
        </div>
        <div class="dropzone-hint">Supports PDF, images (JPG, PNG, GIF, WebP), and text files</div>
        <input type="file" id="fileInput" multiple webkitdirectory />
      </div>

      <div class="formats">
        <span class="format-tag pdf">.pdf</span>
        <span class="format-tag image">.jpg</span>
        <span class="format-tag image">.png</span>
        <span class="format-tag image">.gif</span>
        <span class="format-tag image">.webp</span>
        <span class="format-tag text">.txt</span>
      </div>

      <div class="stats" id="stats" style="display:none;">
        <div class="stat">
          <span class="stat-icon pdf"></span>
          <span>PDFs:</span>
          <span class="stat-value" id="pdfCount">0</span>
        </div>
        <div class="stat">
          <span class="stat-icon image"></span>
          <span>Images:</span>
          <span class="stat-value" id="imageCount">0</span>
        </div>
        <div class="stat">
          <span class="stat-icon text"></span>
          <span>Text:</span>
          <span class="stat-value" id="textCount">0</span>
        </div>
        <div class="stat">
          <span class="stat-icon total"></span>
          <span>Total:</span>
          <span class="stat-value" id="totalSize">0 KB</span>
        </div>
      </div>
    </div>

    <!-- Step 2: Configure & Merge -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">2</span>
        <div>
          <div class="card-title">Review & Merge</div>
          <div class="card-subtitle">Drag to reorder, then create your PDF</div>
        </div>
      </div>

      <div class="options">
        <div class="option-group">
          <label class="option-label">Compression Level</label>
          <select class="option-select" id="qualitySelect">
            <option value="high">High Quality (larger file)</option>
            <option value="medium" selected>Medium Quality (balanced)</option>
            <option value="low">Low Quality (smallest file)</option>
          </select>
          <div class="quality-hint" id="qualityHint">Balanced file size and quality</div>
        </div>
      </div>

      <ul class="file-list" id="fileList">
        <li class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div>No files selected. Upload files above to get started.</div>
        </li>
      </ul>

      <div class="progress-wrap" id="progress">
        <div class="progress-label">
          <span class="progress-text" id="progressText">Processing...</span>
          <span class="progress-percent" id="progressPercent">0%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
      </div>

      <div class="status" id="status"></div>

      <button class="merge-btn" id="mergeBtn" disabled>
        Create Master PDF
      </button>
    </div>

    <!-- Guide -->
    <div class="guide" id="guide">
      <div class="guide-header" onclick="toggleGuide()">
        <div class="guide-title">
          <span class="guide-title-icon">?</span>
          How to Use
        </div>
        <svg class="guide-chevron" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="guide-content">
        <div class="guide-inner">
          <div class="guide-section">
            <h3>Supported File Types</h3>
            <ul>
              <li><strong>PDF files</strong> — merged directly into the output</li>
              <li><strong>Images</strong> (JPG, PNG, GIF, WebP, BMP, TIFF) — converted to PDF pages</li>
              <li><strong>Text files</strong> (.txt) — rendered with monospace font, auto-paginated</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Uploading</h3>
            <ul>
              <li><strong>Drag & drop</strong> files or an entire folder onto the upload area</li>
              <li><strong>Click to browse</strong> and select from your computer</li>
              <li><strong>Folder upload:</strong> Supported in Chrome/Edge — all compatible files are extracted</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Reordering</h3>
            <ul>
              <li>Drag files by the handle (≡) to change their position</li>
              <li>Files are merged top-to-bottom in the order shown</li>
              <li>Click <span class="kbd">✕</span> to remove a file from the list</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Compression Options</h3>
            <ul>
              <li><strong>High Quality:</strong> Best for printing, larger file size</li>
              <li><strong>Medium:</strong> Good balance for sharing and viewing</li>
              <li><strong>Low Quality:</strong> Smallest size, good for email/web</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Troubleshooting</h3>
            <ul>
              <li><strong>Encrypted PDFs:</strong> Remove password protection before merging</li>
              <li><strong>Large files:</strong> Files up to 250MB each are supported</li>
              <li><strong>Slow processing:</strong> Large images take longer to compress</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Files are processed server-side and not stored.
      <br>Built with <a href="https://pdf-lib.js.org/" target="_blank">pdf-lib</a> and <a href="https://sharp.pixelplumbing.com/" target="_blank">sharp</a>.
    </footer>
  </div>

<script>
(function() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const stats = document.getElementById('stats');
  const pdfCountEl = document.getElementById('pdfCount');
  const imageCountEl = document.getElementById('imageCount');
  const textCountEl = document.getElementById('textCount');
  const totalSizeEl = document.getElementById('totalSize');
  const fileList = document.getElementById('fileList');
  const mergeBtn = document.getElementById('mergeBtn');
  const qualitySelect = document.getElementById('qualitySelect');
  const qualityHint = document.getElementById('qualityHint');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const statusEl = document.getElementById('status');
  const guide = document.getElementById('guide');

  const SUPPORTED = {
    pdf: ['.pdf'],
    image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
    text: ['.txt'],
  };

  let files = [];
  let draggedItem = null;

  const qualityHints = {
    high: 'Best quality, largest file size',
    medium: 'Balanced file size and quality',
    low: 'Smallest file, reduced quality',
  };

  // Utils
  function formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
  }

  function getFileExt(name) {
    return (name || '').toLowerCase().match(/\\.[^.]+$/)?.[0] || '';
  }

  function getFileType(name) {
    const ext = getFileExt(name);
    if (SUPPORTED.pdf.includes(ext)) return 'pdf';
    if (SUPPORTED.image.includes(ext)) return 'image';
    if (SUPPORTED.text.includes(ext)) return 'text';
    return null;
  }

  function isSupported(file) {
    return getFileType(file.name) !== null;
  }

  function getFileName(file) {
    return file.webkitRelativePath || file.name || 'unnamed';
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

  function getTypeIcon(type) {
    switch(type) {
      case 'pdf': return 'PDF';
      case 'image': return 'IMG';
      case 'text': return 'TXT';
      default: return '?';
    }
  }

  // UI Updates
  function updateStats() {
    const counts = { pdf: 0, image: 0, text: 0 };
    let total = 0;
    files.forEach(f => {
      const type = getFileType(f.name);
      if (type) counts[type]++;
      total += f.size || 0;
    });

    pdfCountEl.textContent = counts.pdf;
    imageCountEl.textContent = counts.image;
    textCountEl.textContent = counts.text;
    totalSizeEl.textContent = formatBytes(total);
    
    stats.style.display = files.length > 0 ? 'flex' : 'none';
    mergeBtn.disabled = files.length === 0;
  }

  function renderFileList() {
    fileList.innerHTML = '';
    
    if (files.length === 0) {
      fileList.innerHTML = \`
        <li class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div>No files selected. Upload files above to get started.</div>
        </li>\`;
      return;
    }

    files.forEach((file, index) => {
      const type = getFileType(file.name);
      const li = document.createElement('li');
      li.className = 'file-item';
      li.draggable = true;
      li.dataset.index = index;

      li.innerHTML = \`
        <div class="drag-handle"><span></span><span></span><span></span></div>
        <div class="file-type \${type}">\${getTypeIcon(type)}</div>
        <span class="file-index">\${String(index + 1).padStart(2, '0')}</span>
        <div class="file-info">
          <div class="file-name">\${getFileName(file)}</div>
          <div class="file-meta">\${formatBytes(file.size || 0)}</div>
        </div>
        <button class="file-remove" title="Remove">✕</button>
      \`;

      li.querySelector('.file-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        files.splice(index, 1);
        renderFileList();
        updateStats();
      });

      li.addEventListener('dragstart', handleDragStart);
      li.addEventListener('dragend', handleDragEnd);
      li.addEventListener('dragover', handleDragOver);
      li.addEventListener('drop', handleDrop);
      li.addEventListener('dragleave', handleDragLeave);

      fileList.appendChild(li);
    });
  }

  // Drag reorder handlers
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
      const [moved] = files.splice(fromIndex, 1);
      files.splice(toIndex, 0, moved);
      renderFileList();
    }
  }

  // File Drop Zone
  function handleFileDrop(e) {
    e.preventDefault();
    dropzone.classList.remove('drag-over');

    const items = e.dataTransfer.items;
    if (items) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        processEntries(entries).then(addFiles);
        return;
      }
    }
    addFiles(Array.from(e.dataTransfer.files));
  }

  async function processEntries(entries) {
    const allFiles = [];
    
    async function readEntry(entry, path = '') {
      if (entry.isFile) {
        return new Promise((resolve) => {
          entry.file(file => {
            Object.defineProperty(file, 'webkitRelativePath', {
              value: path + file.name,
              writable: false
            });
            resolve(file);
          });
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise(r => dirReader.readEntries(r));
        const subFiles = [];
        for (const subEntry of entries) {
          const result = await readEntry(subEntry, path + entry.name + '/');
          if (Array.isArray(result)) subFiles.push(...result);
          else if (result) subFiles.push(result);
        }
        return subFiles;
      }
    }

    for (const entry of entries) {
      const result = await readEntry(entry);
      if (Array.isArray(result)) allFiles.push(...result);
      else if (result) allFiles.push(result);
    }

    return allFiles;
  }

  function addFiles(newFiles) {
    const supported = newFiles.filter(isSupported);
    supported.sort((a, b) => naturalSort(getFileName(a).toLowerCase(), getFileName(b).toLowerCase()));

    supported.forEach(file => {
      const exists = files.some(f => getFileName(f) === getFileName(file) && f.size === file.size);
      if (!exists) files.push(file);
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

  // Quality hint
  qualitySelect.addEventListener('change', () => {
    qualityHint.textContent = qualityHints[qualitySelect.value];
  });

  // Merge
  async function handleMerge() {
    if (files.length === 0) return;

    mergeBtn.disabled = true;
    hideStatus();
    showProgress('Preparing files...', 0);

    try {
      const fd = new FormData();
      files.forEach((f) => {
        fd.append('files', f, getFileName(f));
      });
      fd.append('quality', qualitySelect.value);

      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise((resolve, reject) => {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 60);
            showProgress('Uploading...', pct);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) resolve(xhr.response);
          else reject(new Error(xhr.responseText || 'Merge failed'));
        };

        xhr.onerror = () => reject(new Error('Network error'));
      });

      xhr.open('POST', '/merge');
      xhr.responseType = 'blob';
      xhr.send(fd);

      showProgress('Converting & merging...', 65);

      const blob = await uploadPromise;

      showProgress('Complete!', 100);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showStatus('PDF created successfully! Download started.');
      setTimeout(hideProgress, 1500);

    } catch (err) {
      hideProgress();
      showStatus(err.message || 'Failed to create PDF. Check file formats.', true);
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
    const quality = req.body.quality || 'medium';

    if (uploaded.length === 0) {
      return res.status(400).type("text/plain").send("No files uploaded.");
    }

    const merged = await PDFDocument.create();

    for (const f of uploaded) {
      const filename = f.originalname || '';
      const type = getFileType(filename);

      if (type === 'pdf') {
        // Merge PDF directly
        try {
          const doc = await PDFDocument.load(f.buffer, { ignoreEncryption: false });
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach((p) => merged.addPage(p));
        } catch (err) {
          console.error(`Failed to process PDF ${filename}:`, err.message);
          throw new Error(`Failed to process ${filename}: ${err.message}`);
        }
      } else if (type === 'image') {
        // Convert image to PDF page
        try {
          const processed = await imageToPdfPage(f.buffer, quality);
          const img = await merged.embedJpg(processed.buffer);
          
          // Create page with image dimensions (max 8.5x11 inches at 72dpi)
          const maxWidth = 612;
          const maxHeight = 792;
          let width = processed.width;
          let height = processed.height;
          
          // Scale to fit page
          const scale = Math.min(maxWidth / width, maxHeight / height, 1);
          width *= scale;
          height *= scale;

          const page = merged.addPage([Math.max(width, 100), Math.max(height, 100)]);
          page.drawImage(img, {
            x: 0,
            y: 0,
            width: width,
            height: height,
          });
        } catch (err) {
          console.error(`Failed to process image ${filename}:`, err.message);
          throw new Error(`Failed to process ${filename}: ${err.message}`);
        }
      } else if (type === 'text') {
        // Convert text to PDF pages
        try {
          const text = f.buffer.toString('utf-8');
          await textToPdfPages(text, merged);
        } catch (err) {
          console.error(`Failed to process text ${filename}:`, err.message);
          throw new Error(`Failed to process ${filename}: ${err.message}`);
        }
      }
    }

    const mergedBytes = await merged.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="merged.pdf"');
    return res.status(200).send(Buffer.from(mergedBytes));

  } catch (err) {
    const msg = String(err?.message || "Merge failed.");

    if (msg.toLowerCase().includes("encrypted") || msg.toLowerCase().includes("password")) {
      return res.status(500).type("text/plain")
        .send("One or more PDFs are encrypted. Remove password protection and try again.");
    }

    return res.status(500).type("text/plain").send(msg);
  }
});

// For local development
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Master Merge Tool running at http://localhost:${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
