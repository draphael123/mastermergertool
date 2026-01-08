/**
 * Master Merge Tool — Universal Document Merger
 * 
 * Supported formats:
 *   - PDF (.pdf)
 *   - Images (.jpg, .jpeg, .png, .gif, .webp, .bmp, .tiff)
 *   - Word (.docx, .doc)
 *   - Excel (.xlsx, .xls, .csv)
 *   - Text (.txt)
 *   - Markdown (.md)
 *   - HTML (.html, .htm)
 *   - PowerPoint (.pptx) - text extraction
 *
 * Run:
 *   npm install
 *   npm start
 */

const express = require("express");
const multer = require("multer");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const sharp = require("sharp");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const { marked } = require("marked");

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

// Supported file extensions by category
const SUPPORTED = {
  pdf: ['.pdf'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
  word: ['.docx', '.doc'],
  excel: ['.xlsx', '.xls', '.csv'],
  text: ['.txt'],
  markdown: ['.md', '.markdown'],
  html: ['.html', '.htm'],
  powerpoint: ['.pptx', '.ppt'],
};

function getFileType(filename) {
  const ext = (filename || '').toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  for (const [type, exts] of Object.entries(SUPPORTED)) {
    if (exts.includes(ext)) return type;
  }
  return null;
}

function naturalSort(a, b) {
  const ax = [], bx = [];
  a.replace(/(\d+)|(\D+)/g, (_, $1, $2) => ax.push([$1 || Infinity, $2 || ""]));
  b.replace(/(\d+)|(\D+)/g, (_, $1, $2) => bx.push([$1 || Infinity, $2 || ""]));
  while (ax.length && bx.length) {
    const an = ax.shift(), bn = bx.shift();
    const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
    if (nn) return nn;
  }
  return ax.length - bx.length;
}

// Strip HTML tags for plain text
function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<th[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Convert image buffer to PDF-ready JPEG
async function imageToPdfPage(buffer, quality = 'medium') {
  const settings = {
    low: { jpeg: 50, resize: 1200 },
    medium: { jpeg: 75, resize: 2000 },
    high: { jpeg: 95, resize: 4000 },
  }[quality] || { jpeg: 75, resize: 2000 };

  let img = sharp(buffer);
  const metadata = await img.metadata();
  
  if (metadata.width > settings.resize || metadata.height > settings.resize) {
    img = img.resize(settings.resize, settings.resize, { fit: 'inside', withoutEnlargement: true });
  }

  const jpegBuffer = await img.jpeg({ quality: settings.jpeg }).toBuffer();
  const processedMeta = await sharp(jpegBuffer).metadata();

  return { buffer: jpegBuffer, width: processedMeta.width, height: processedMeta.height };
}

// Convert Word document to text
async function wordToText(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (err) {
    // Fallback for .doc files or errors
    return buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
  }
}

// Convert Excel/CSV to formatted text
function excelToText(buffer, filename) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let output = '';

    workbook.SheetNames.forEach((sheetName, idx) => {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      if (workbook.SheetNames.length > 1) {
        output += `\n${'═'.repeat(60)}\n`;
        output += `  SHEET: ${sheetName}\n`;
        output += `${'═'.repeat(60)}\n\n`;
      }

      if (data.length === 0) {
        output += '(Empty sheet)\n';
        return;
      }

      // Calculate column widths
      const colWidths = [];
      data.forEach(row => {
        row.forEach((cell, i) => {
          const len = String(cell).length;
          colWidths[i] = Math.min(Math.max(colWidths[i] || 0, len), 30);
        });
      });

      // Format as table
      data.forEach((row, rowIdx) => {
        const line = row.map((cell, i) => {
          const str = String(cell);
          return str.substring(0, 30).padEnd(colWidths[i] || 10);
        }).join(' │ ');
        output += line + '\n';

        // Header separator
        if (rowIdx === 0) {
          output += colWidths.map(w => '─'.repeat(w)).join('─┼─') + '\n';
        }
      });

      output += '\n';
    });

    return output.trim();
  } catch (err) {
    return `Error reading spreadsheet: ${err.message}`;
  }
}

// Convert Markdown to text
function markdownToText(buffer) {
  const md = buffer.toString('utf-8');
  const html = marked(md);
  return stripHtml(html);
}

// Convert HTML to text
function htmlToText(buffer) {
  const html = buffer.toString('utf-8');
  return stripHtml(html);
}

// Extract text from PowerPoint
function pptxToText(buffer) {
  try {
    // PPTX is a ZIP file, use XLSX to read the XML content
    const zip = XLSX.read(buffer, { type: 'buffer', bookType: 'xlsx' });
    let text = '';
    
    // Try to extract text from slides
    Object.keys(zip.Sheets || {}).forEach(name => {
      const sheet = zip.Sheets[name];
      const content = XLSX.utils.sheet_to_txt(sheet);
      if (content) text += content + '\n\n';
    });

    if (!text.trim()) {
      // Fallback: extract readable strings from buffer
      const str = buffer.toString('utf-8');
      const matches = str.match(/<a:t>([^<]+)<\/a:t>/g) || [];
      text = matches.map(m => m.replace(/<[^>]+>/g, '')).join('\n');
    }

    return text || '(Could not extract text from presentation)';
  } catch (err) {
    return `(PowerPoint extraction error: ${err.message})`;
  }
}

// Render text to PDF pages with title
async function textToPdfPages(text, pdfDoc, title = null) {
  const font = await pdfDoc.embedFont(StandardFonts.Courier);
  const boldFont = await pdfDoc.embedFont(StandardFonts.CourierBold);
  const fontSize = 10;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const lineHeight = fontSize * 1.5;
  const maxWidth = pageWidth - margin * 2;
  const maxLines = Math.floor((pageHeight - margin * 2 - (title ? 40 : 0)) / lineHeight);

  // Word wrap
  const lines = text.split('\n');
  const wrappedLines = [];

  for (const line of lines) {
    if (!line) { wrappedLines.push(''); continue; }
    
    const words = line.split(' ');
    let current = '';
    
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
        wrappedLines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) wrappedLines.push(current);
  }

  // Create pages
  for (let i = 0; i < wrappedLines.length; i += maxLines) {
    const pageLines = wrappedLines.slice(i, i + maxLines);
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Add title on first page
    if (i === 0 && title) {
      page.drawText(title, {
        x: margin,
        y: y - 14,
        size: 14,
        font: boldFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      y -= 40;
    }

    for (const line of pageLines) {
      page.drawText(line, {
        x: margin,
        y: y - fontSize,
        size: fontSize,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= lineHeight;
    }
  }
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
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-deep: #09090b;
      --bg-surface: #111113;
      --bg-elevated: #18181b;
      --bg-hover: #1f1f23;
      --border: #27272a;
      --border-active: #3f3f46;
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #f97316;
      --accent-hover: #fb923c;
      --accent-dim: #7c2d12;
      --accent-glow: rgba(249, 115, 22, 0.1);
      --success: #22c55e;
      --error: #ef4444;
      --error-bg: rgba(239, 68, 68, 0.1);
      --pdf-color: #ef4444;
      --image-color: #a855f7;
      --word-color: #3b82f6;
      --excel-color: #22c55e;
      --text-file-color: #71717a;
      --ppt-color: #f97316;
    }

    * { box-sizing: border-box; }
    html { background: var(--bg-deep); }
    
    body {
      margin: 0;
      min-height: 100vh;
      background: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(249, 115, 22, 0.08), transparent),
        radial-gradient(ellipse 50% 50% at 100% 50%, rgba(168, 85, 247, 0.04), transparent),
        var(--bg-deep);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    .container {
      max-width: 920px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }

    header {
      text-align: center;
      margin-bottom: 40px;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      background: linear-gradient(135deg, var(--accent) 0%, #ea580c 100%);
      border-radius: 20px;
      margin-bottom: 24px;
      box-shadow: 0 8px 40px rgba(249, 115, 22, 0.3);
      font-size: 32px;
    }

    h1 {
      font-family: 'Fraunces', serif;
      font-size: 52px;
      font-weight: 700;
      margin: 0 0 8px;
      letter-spacing: -2px;
      background: linear-gradient(135deg, var(--text) 30%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .tagline {
      color: var(--text-muted);
      font-size: 17px;
    }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      margin-bottom: 20px;
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 24px;
    }

    .card-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: var(--accent);
      color: white;
      font-weight: 700;
      font-size: 15px;
      border-radius: 12px;
      font-family: 'JetBrains Mono', monospace;
      flex-shrink: 0;
    }

    .card-title {
      font-weight: 600;
      font-size: 18px;
      margin-bottom: 4px;
    }

    .card-subtitle {
      font-size: 14px;
      color: var(--text-dim);
    }

    /* Dropzone */
    .dropzone {
      position: relative;
      border: 2px dashed var(--border-active);
      border-radius: 16px;
      padding: 48px 24px;
      text-align: center;
      cursor: pointer;
      transition: all 0.2s ease;
      background: var(--bg-elevated);
    }

    .dropzone:hover, .dropzone.drag-over {
      border-color: var(--accent);
      background: var(--accent-glow);
    }

    .dropzone.drag-over {
      transform: scale(1.01);
      box-shadow: 0 0 60px rgba(249, 115, 22, 0.15);
    }

    .dropzone-icons {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
    }

    .dropzone-icons span {
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }

    .icon-pdf { background: rgba(239, 68, 68, 0.15); color: var(--pdf-color); }
    .icon-img { background: rgba(168, 85, 247, 0.15); color: var(--image-color); }
    .icon-word { background: rgba(59, 130, 246, 0.15); color: var(--word-color); }
    .icon-excel { background: rgba(34, 197, 94, 0.15); color: var(--excel-color); }
    .icon-ppt { background: rgba(249, 115, 22, 0.15); color: var(--ppt-color); }

    .dropzone-text {
      font-size: 16px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .dropzone-text strong { color: var(--accent); }

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

    /* Format tags */
    .formats {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 20px;
      justify-content: center;
    }

    .format-tag {
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
      border: 1px solid transparent;
    }

    .format-tag.pdf { background: rgba(239, 68, 68, 0.1); color: var(--pdf-color); border-color: rgba(239, 68, 68, 0.2); }
    .format-tag.image { background: rgba(168, 85, 247, 0.1); color: var(--image-color); border-color: rgba(168, 85, 247, 0.2); }
    .format-tag.word { background: rgba(59, 130, 246, 0.1); color: var(--word-color); border-color: rgba(59, 130, 246, 0.2); }
    .format-tag.excel { background: rgba(34, 197, 94, 0.1); color: var(--excel-color); border-color: rgba(34, 197, 94, 0.2); }
    .format-tag.text { background: rgba(113, 113, 122, 0.1); color: var(--text-file-color); border-color: rgba(113, 113, 122, 0.2); }
    .format-tag.ppt { background: rgba(249, 115, 22, 0.1); color: var(--ppt-color); border-color: rgba(249, 115, 22, 0.2); }

    /* Stats */
    .stats {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: var(--bg-elevated);
      border-radius: 10px;
      font-size: 13px;
      border: 1px solid var(--border);
    }

    .stat-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .stat-dot.pdf { background: var(--pdf-color); }
    .stat-dot.image { background: var(--image-color); }
    .stat-dot.word { background: var(--word-color); }
    .stat-dot.excel { background: var(--excel-color); }
    .stat-dot.text { background: var(--text-file-color); }
    .stat-dot.ppt { background: var(--ppt-color); }
    .stat-dot.total { background: var(--accent); }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
      color: var(--accent);
    }

    /* Options */
    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
      padding: 20px;
      background: var(--bg-elevated);
      border-radius: 14px;
      border: 1px solid var(--border);
    }

    .option-group label {
      display: block;
      font-size: 11px;
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
      border-radius: 10px;
      color: var(--text);
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
    }

    .option-select:focus {
      outline: none;
      border-color: var(--accent);
    }

    /* File List */
    .file-list {
      list-style: none;
      margin: 0 0 20px;
      padding: 0;
      max-height: 420px;
      overflow-y: auto;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 8px;
      cursor: grab;
      transition: all 0.15s ease;
      user-select: none;
    }

    .file-item:hover {
      border-color: var(--border-active);
      background: var(--bg-hover);
    }

    .file-item.dragging { opacity: 0.5; transform: scale(0.98); }
    .file-item.drag-over-item { border-color: var(--accent); background: var(--accent-glow); }

    .drag-handle {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 4px;
      opacity: 0.3;
      transition: opacity 0.15s;
    }

    .file-item:hover .drag-handle { opacity: 0.6; }

    .drag-handle span {
      display: block;
      width: 14px;
      height: 2px;
      background: var(--text);
      border-radius: 1px;
    }

    .file-type {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      flex-shrink: 0;
    }

    .file-type.pdf { background: rgba(239, 68, 68, 0.12); color: var(--pdf-color); }
    .file-type.image { background: rgba(168, 85, 247, 0.12); color: var(--image-color); }
    .file-type.word { background: rgba(59, 130, 246, 0.12); color: var(--word-color); }
    .file-type.excel { background: rgba(34, 197, 94, 0.12); color: var(--excel-color); }
    .file-type.text { background: rgba(113, 113, 122, 0.12); color: var(--text-file-color); }
    .file-type.markdown { background: rgba(113, 113, 122, 0.12); color: var(--text-muted); }
    .file-type.html { background: rgba(249, 115, 22, 0.12); color: var(--ppt-color); }
    .file-type.powerpoint { background: rgba(249, 115, 22, 0.12); color: var(--ppt-color); }

    .file-index {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
      min-width: 24px;
    }

    .file-info { flex: 1; min-width: 0; }

    .file-name {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      font-size: 12px;
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
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
      font-size: 16px;
      transition: all 0.15s;
    }

    .file-remove:hover { background: var(--error-bg); color: var(--error); }

    .empty-state {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-dim);
    }

    .empty-state-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }

    /* Progress */
    .progress-wrap {
      margin-bottom: 20px;
      display: none;
    }

    .progress-wrap.visible { display: block; }

    .progress-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 13px;
    }

    .progress-text { color: var(--text-muted); }
    .progress-percent { font-family: 'JetBrains Mono', monospace; color: var(--accent); }

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
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent) 0%, #ea580c 100%);
      color: white;
      font-family: 'Inter', sans-serif;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 24px rgba(249, 115, 22, 0.3);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .merge-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(249, 115, 22, 0.4);
    }

    .merge-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* Status */
    .status {
      padding: 14px 18px;
      border-radius: 12px;
      font-size: 14px;
      margin-top: 16px;
      display: none;
      align-items: center;
      gap: 10px;
    }

    .status.visible { display: flex; }

    .status.success {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      color: var(--success);
    }

    .status.error {
      background: var(--error-bg);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: var(--error);
    }

    /* Guide */
    .guide {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
    }

    .guide-header {
      padding: 20px 24px;
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
    }

    .guide-icon {
      width: 36px;
      height: 36px;
      background: var(--accent-glow);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
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

    .guide.open .guide-content { max-height: 1000px; }

    .guide-inner {
      padding: 0 24px 24px;
      border-top: 1px solid var(--border);
    }

    .guide-section { margin-top: 24px; }

    .guide-section h3 {
      font-size: 12px;
      font-weight: 600;
      color: var(--accent);
      margin: 0 0 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .guide-section ul {
      margin: 0;
      padding-left: 20px;
    }

    .guide-section li {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 8px;
      line-height: 1.6;
    }

    .guide-section li::marker { color: var(--accent); }

    .format-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }

    .format-item {
      padding: 12px;
      background: var(--bg-elevated);
      border-radius: 10px;
      border: 1px solid var(--border);
    }

    .format-item-title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
    }

    .format-item-ext {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-dim);
    }

    footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 13px;
    }

    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .card { animation: fadeIn 0.5s ease backwards; }
    .card:nth-child(1) { animation-delay: 0.1s; }
    .card:nth-child(2) { animation-delay: 0.2s; }
    .guide { animation: fadeIn 0.5s ease 0.35s backwards; }

    .file-list::-webkit-scrollbar { width: 8px; }
    .file-list::-webkit-scrollbar-track { background: var(--bg-elevated); border-radius: 4px; }
    .file-list::-webkit-scrollbar-thumb { background: var(--border-active); border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">📄</div>
      <h1>Master Merge Tool</h1>
      <p class="tagline">Convert any document into one unified PDF</p>
    </header>

    <div class="card">
      <div class="card-header">
        <span class="card-number">1</span>
        <div>
          <div class="card-title">Upload Files</div>
          <div class="card-subtitle">Drop a folder or select files of any supported type</div>
        </div>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dropzone-icons">
          <span class="icon-pdf">PDF</span>
          <span class="icon-word">DOC</span>
          <span class="icon-excel">XLS</span>
          <span class="icon-img">IMG</span>
          <span class="icon-ppt">PPT</span>
        </div>
        <div class="dropzone-text">
          <strong>Drop files or folder here</strong> or click to browse
        </div>
        <div class="dropzone-hint">Supports 15+ file formats including Office documents</div>
        <input type="file" id="fileInput" multiple webkitdirectory />
      </div>

      <div class="formats">
        <span class="format-tag pdf">.pdf</span>
        <span class="format-tag word">.docx</span>
        <span class="format-tag word">.doc</span>
        <span class="format-tag excel">.xlsx</span>
        <span class="format-tag excel">.xls</span>
        <span class="format-tag excel">.csv</span>
        <span class="format-tag ppt">.pptx</span>
        <span class="format-tag image">.jpg</span>
        <span class="format-tag image">.png</span>
        <span class="format-tag image">.gif</span>
        <span class="format-tag image">.webp</span>
        <span class="format-tag text">.txt</span>
        <span class="format-tag text">.md</span>
        <span class="format-tag text">.html</span>
      </div>

      <div class="stats" id="stats" style="display:none;">
        <div class="stat"><span class="stat-dot pdf"></span>PDFs: <span class="stat-value" id="pdfCount">0</span></div>
        <div class="stat"><span class="stat-dot word"></span>Docs: <span class="stat-value" id="wordCount">0</span></div>
        <div class="stat"><span class="stat-dot excel"></span>Sheets: <span class="stat-value" id="excelCount">0</span></div>
        <div class="stat"><span class="stat-dot image"></span>Images: <span class="stat-value" id="imageCount">0</span></div>
        <div class="stat"><span class="stat-dot text"></span>Text: <span class="stat-value" id="textCount">0</span></div>
        <div class="stat"><span class="stat-dot total"></span>Size: <span class="stat-value" id="totalSize">0 KB</span></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <span class="card-number">2</span>
        <div>
          <div class="card-title">Configure & Merge</div>
          <div class="card-subtitle">Drag to reorder, set quality, then create your PDF</div>
        </div>
      </div>

      <div class="options">
        <div class="option-group">
          <label>Compression Level</label>
          <select class="option-select" id="qualitySelect">
            <option value="high">High Quality (larger file)</option>
            <option value="medium" selected>Medium (balanced)</option>
            <option value="low">Low Quality (smallest file)</option>
          </select>
        </div>
        <div class="option-group">
          <label>Output Filename</label>
          <select class="option-select" id="filenameSelect">
            <option value="merged">merged.pdf</option>
            <option value="combined">combined.pdf</option>
            <option value="master">master.pdf</option>
            <option value="output">output.pdf</option>
          </select>
        </div>
      </div>

      <ul class="file-list" id="fileList">
        <li class="empty-state">
          <div class="empty-state-icon">📁</div>
          <div>No files yet. Upload documents above to begin.</div>
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

      <button class="merge-btn" id="mergeBtn" disabled>Create Master PDF</button>
    </div>

    <div class="guide" id="guide">
      <div class="guide-header" onclick="toggleGuide()">
        <div class="guide-title">
          <span class="guide-icon">?</span>
          How to Use
        </div>
        <svg class="guide-chevron" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="guide-content">
        <div class="guide-inner">
          <div class="guide-section">
            <h3>Supported Formats</h3>
            <div class="format-grid">
              <div class="format-item">
                <div class="format-item-title">📄 PDF</div>
                <div class="format-item-ext">.pdf</div>
              </div>
              <div class="format-item">
                <div class="format-item-title">📝 Word</div>
                <div class="format-item-ext">.docx, .doc</div>
              </div>
              <div class="format-item">
                <div class="format-item-title">📊 Excel</div>
                <div class="format-item-ext">.xlsx, .xls, .csv</div>
              </div>
              <div class="format-item">
                <div class="format-item-title">📽️ PowerPoint</div>
                <div class="format-item-ext">.pptx, .ppt</div>
              </div>
              <div class="format-item">
                <div class="format-item-title">🖼️ Images</div>
                <div class="format-item-ext">.jpg, .png, .gif, .webp</div>
              </div>
              <div class="format-item">
                <div class="format-item-title">📃 Text</div>
                <div class="format-item-ext">.txt, .md, .html</div>
              </div>
            </div>
          </div>
          <div class="guide-section">
            <h3>Steps</h3>
            <ul>
              <li><strong>Upload:</strong> Drag files/folders onto the drop zone or click to browse</li>
              <li><strong>Reorder:</strong> Drag items by the handle (≡) to change merge order</li>
              <li><strong>Configure:</strong> Choose compression level and output filename</li>
              <li><strong>Merge:</strong> Click the button and download your combined PDF</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Tips</h3>
            <ul>
              <li>Use <strong>High Quality</strong> for documents you'll print</li>
              <li>Use <strong>Low Quality</strong> for email attachments to reduce size</li>
              <li>Excel sheets render as formatted tables with headers</li>
              <li>Images are automatically scaled to fit standard pages</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Files processed server-side, never stored. 
      Built with <a href="https://pdf-lib.js.org/" target="_blank">pdf-lib</a>.
    </footer>
  </div>

<script>
(function() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const stats = document.getElementById('stats');
  const fileList = document.getElementById('fileList');
  const mergeBtn = document.getElementById('mergeBtn');
  const qualitySelect = document.getElementById('qualitySelect');
  const filenameSelect = document.getElementById('filenameSelect');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  const progressPercent = document.getElementById('progressPercent');
  const progressFill = document.getElementById('progressFill');
  const statusEl = document.getElementById('status');

  const SUPPORTED = {
    pdf: ['.pdf'],
    image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'],
    word: ['.docx', '.doc'],
    excel: ['.xlsx', '.xls', '.csv'],
    text: ['.txt'],
    markdown: ['.md', '.markdown'],
    html: ['.html', '.htm'],
    powerpoint: ['.pptx', '.ppt'],
  };

  let files = [];
  let draggedItem = null;

  function formatBytes(b) {
    const u = ['B','KB','MB','GB'];
    let i = 0;
    while (b >= 1024 && i < u.length-1) { b /= 1024; i++; }
    return (i === 0 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i];
  }

  function getExt(name) {
    return (name || '').toLowerCase().match(/\\.[^.]+$/)?.[0] || '';
  }

  function getFileType(name) {
    const ext = getExt(name);
    for (const [type, exts] of Object.entries(SUPPORTED)) {
      if (exts.includes(ext)) return type;
    }
    return null;
  }

  function isSupported(f) { return getFileType(f.name) !== null; }
  function getFileName(f) { return f.webkitRelativePath || f.name || 'unnamed'; }

  function naturalSort(a, b) {
    const rx = /(\\d+)|(\\D+)/g;
    const ax = String(a).match(rx) || [];
    const bx = String(b).match(rx) || [];
    while (ax.length && bx.length) {
      const a1 = ax.shift(), b1 = bx.shift();
      const an = parseInt(a1), bn = parseInt(b1);
      if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
      const c = String(a1).localeCompare(String(b1));
      if (c) return c;
    }
    return ax.length - bx.length;
  }

  function getTypeLabel(type) {
    const labels = { pdf:'PDF', image:'IMG', word:'DOC', excel:'XLS', text:'TXT', markdown:'MD', html:'HTM', powerpoint:'PPT' };
    return labels[type] || '?';
  }

  function updateStats() {
    const counts = { pdf:0, image:0, word:0, excel:0, text:0, markdown:0, html:0, powerpoint:0 };
    let total = 0;
    files.forEach(f => {
      const t = getFileType(f.name);
      if (t) counts[t]++;
      total += f.size || 0;
    });

    document.getElementById('pdfCount').textContent = counts.pdf;
    document.getElementById('wordCount').textContent = counts.word;
    document.getElementById('excelCount').textContent = counts.excel;
    document.getElementById('imageCount').textContent = counts.image;
    document.getElementById('textCount').textContent = counts.text + counts.markdown + counts.html + counts.powerpoint;
    document.getElementById('totalSize').textContent = formatBytes(total);
    
    stats.style.display = files.length > 0 ? 'flex' : 'none';
    mergeBtn.disabled = files.length === 0;
  }

  function renderFileList() {
    fileList.innerHTML = '';
    if (files.length === 0) {
      fileList.innerHTML = '<li class="empty-state"><div class="empty-state-icon">📁</div><div>No files yet. Upload documents above to begin.</div></li>';
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
        <div class="file-type \${type}">\${getTypeLabel(type)}</div>
        <span class="file-index">\${String(index + 1).padStart(2, '0')}</span>
        <div class="file-info">
          <div class="file-name">\${getFileName(file)}</div>
          <div class="file-meta">\${formatBytes(file.size || 0)}</div>
        </div>
        <button class="file-remove" title="Remove">✕</button>
      \`;

      li.querySelector('.file-remove').onclick = (e) => {
        e.stopPropagation();
        files.splice(index, 1);
        renderFileList();
        updateStats();
      };

      li.addEventListener('dragstart', function(e) { draggedItem = this; this.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragend', function() { this.classList.remove('dragging'); document.querySelectorAll('.file-item').forEach(i => i.classList.remove('drag-over-item')); draggedItem = null; });
      li.addEventListener('dragover', function(e) { e.preventDefault(); if (this !== draggedItem) this.classList.add('drag-over-item'); });
      li.addEventListener('dragleave', function() { this.classList.remove('drag-over-item'); });
      li.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over-item');
        if (draggedItem && this !== draggedItem) {
          const from = parseInt(draggedItem.dataset.index);
          const to = parseInt(this.dataset.index);
          const [moved] = files.splice(from, 1);
          files.splice(to, 0, moved);
          renderFileList();
        }
      });

      fileList.appendChild(li);
    });
  }

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
    const all = [];
    async function read(entry, path = '') {
      if (entry.isFile) {
        return new Promise(r => entry.file(f => {
          Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name });
          r(f);
        }));
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const subs = await new Promise(r => reader.readEntries(r));
        const results = [];
        for (const sub of subs) {
          const res = await read(sub, path + entry.name + '/');
          if (Array.isArray(res)) results.push(...res);
          else if (res) results.push(res);
        }
        return results;
      }
    }
    for (const entry of entries) {
      const res = await read(entry);
      if (Array.isArray(res)) all.push(...res);
      else if (res) all.push(res);
    }
    return all;
  }

  function addFiles(newFiles) {
    const supported = newFiles.filter(isSupported);
    supported.sort((a, b) => naturalSort(getFileName(a).toLowerCase(), getFileName(b).toLowerCase()));
    supported.forEach(f => {
      if (!files.some(x => getFileName(x) === getFileName(f) && x.size === f.size)) {
        files.push(f);
      }
    });
    renderFileList();
    updateStats();
    hideStatus();
  }

  function showProgress(text, pct) {
    progress.classList.add('visible');
    progressText.textContent = text;
    progressPercent.textContent = pct + '%';
    progressFill.style.width = pct + '%';
  }

  function hideProgress() { progress.classList.remove('visible'); }

  function showStatus(msg, err = false) {
    statusEl.className = 'status visible ' + (err ? 'error' : 'success');
    statusEl.innerHTML = (err ? '⚠ ' : '✓ ') + msg;
  }

  function hideStatus() { statusEl.className = 'status'; }

  async function handleMerge() {
    if (files.length === 0) return;
    mergeBtn.disabled = true;
    hideStatus();
    showProgress('Preparing...', 0);

    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f, getFileName(f)));
      fd.append('quality', qualitySelect.value);

      const xhr = new XMLHttpRequest();
      const promise = new Promise((resolve, reject) => {
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) showProgress('Uploading...', Math.round((e.loaded / e.total) * 50));
        };
        xhr.onload = () => xhr.status === 200 ? resolve(xhr.response) : reject(new Error(xhr.responseText || 'Failed'));
        xhr.onerror = () => reject(new Error('Network error'));
      });

      xhr.open('POST', '/merge');
      xhr.responseType = 'blob';
      xhr.send(fd);

      showProgress('Converting documents...', 55);
      const blob = await promise;
      showProgress('Complete!', 100);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameSelect.value + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showStatus('PDF created! Download started.');
      setTimeout(hideProgress, 1500);
    } catch (err) {
      hideProgress();
      showStatus(err.message || 'Failed to create PDF.', true);
    } finally {
      mergeBtn.disabled = false;
    }
  }

  window.toggleGuide = () => document.getElementById('guide').classList.toggle('open');

  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); });
  dropzone.addEventListener('drop', handleFileDrop);
  fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files || [])); fileInput.value = ''; });
  mergeBtn.addEventListener('click', handleMerge);

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

      try {
        if (type === 'pdf') {
          const doc = await PDFDocument.load(f.buffer, { ignoreEncryption: false });
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach(p => merged.addPage(p));

        } else if (type === 'image') {
          const processed = await imageToPdfPage(f.buffer, quality);
          const img = await merged.embedJpg(processed.buffer);
          const scale = Math.min(612 / processed.width, 792 / processed.height, 1);
          const w = processed.width * scale;
          const h = processed.height * scale;
          const page = merged.addPage([Math.max(w, 100), Math.max(h, 100)]);
          page.drawImage(img, { x: 0, y: 0, width: w, height: h });

        } else if (type === 'word') {
          const text = await wordToText(f.buffer);
          await textToPdfPages(text, merged, filename);

        } else if (type === 'excel') {
          const text = excelToText(f.buffer, filename);
          await textToPdfPages(text, merged, filename);

        } else if (type === 'text') {
          const text = f.buffer.toString('utf-8');
          await textToPdfPages(text, merged, filename);

        } else if (type === 'markdown') {
          const text = markdownToText(f.buffer);
          await textToPdfPages(text, merged, filename);

        } else if (type === 'html') {
          const text = htmlToText(f.buffer);
          await textToPdfPages(text, merged, filename);

        } else if (type === 'powerpoint') {
          const text = pptxToText(f.buffer);
          await textToPdfPages(text, merged, filename);
        }
      } catch (err) {
        console.error(`Error processing ${filename}:`, err.message);
        // Add error page
        const errorText = `Error processing file: ${filename}\n\n${err.message}`;
        await textToPdfPages(errorText, merged, 'Error');
      }
    }

    const mergedBytes = await merged.save();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="merged.pdf"');
    return res.status(200).send(Buffer.from(mergedBytes));

  } catch (err) {
    const msg = String(err?.message || "Merge failed.");
    if (msg.toLowerCase().includes("encrypted") || msg.toLowerCase().includes("password")) {
      return res.status(500).type("text/plain").send("One or more PDFs are encrypted. Remove password protection and try again.");
    }
    return res.status(500).type("text/plain").send(msg);
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Master Merge Tool running at http://localhost:${PORT}`));
}

module.exports = app;
