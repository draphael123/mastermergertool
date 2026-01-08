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
  <title>Master Merge Tool — Combine Any Document into PDF</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f0f11;
      --surface: #16161a;
      --elevated: #1c1c21;
      --border: #2a2a32;
      --text: #fffffe;
      --text-muted: #94a1b2;
      --text-dim: #72757e;
      
      /* Vibrant color palette */
      --pink: #ff6b9d;
      --pink-glow: rgba(255, 107, 157, 0.15);
      --purple: #c77dff;
      --purple-glow: rgba(199, 125, 255, 0.15);
      --blue: #48bfe3;
      --blue-glow: rgba(72, 191, 227, 0.15);
      --cyan: #64dfdf;
      --cyan-glow: rgba(100, 223, 223, 0.15);
      --green: #72efdd;
      --green-glow: rgba(114, 239, 221, 0.15);
      --yellow: #ffd166;
      --yellow-glow: rgba(255, 209, 102, 0.15);
      --orange: #ff9f1c;
      --orange-glow: rgba(255, 159, 28, 0.15);
      --red: #ef476f;
      --red-glow: rgba(239, 71, 111, 0.15);
      
      /* Gradients */
      --gradient-primary: linear-gradient(135deg, var(--pink), var(--purple), var(--blue));
      --gradient-warm: linear-gradient(135deg, var(--orange), var(--pink));
      --gradient-cool: linear-gradient(135deg, var(--cyan), var(--purple));
      --gradient-success: linear-gradient(135deg, var(--green), var(--cyan));
    }

    * { box-sizing: border-box; }
    
    html { background: var(--bg); }
    
    body {
      margin: 0;
      min-height: 100vh;
      background: 
        radial-gradient(ellipse 80% 60% at 10% 0%, rgba(255, 107, 157, 0.12), transparent 50%),
        radial-gradient(ellipse 60% 50% at 90% 10%, rgba(199, 125, 255, 0.1), transparent 50%),
        radial-gradient(ellipse 70% 50% at 50% 100%, rgba(72, 191, 227, 0.08), transparent 50%),
        var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      font-size: 15px;
      line-height: 1.6;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 40px 24px 80px;
    }

    /* Hero Section */
    .hero {
      text-align: center;
      padding: 60px 0 50px;
      position: relative;
    }

    .hero::before {
      content: '';
      position: absolute;
      top: 0;
      left: 50%;
      transform: translateX(-50%);
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(199, 125, 255, 0.15), transparent 70%);
      pointer-events: none;
      z-index: -1;
    }

    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 90px;
      height: 90px;
      background: var(--gradient-primary);
      border-radius: 28px;
      margin-bottom: 28px;
      font-size: 42px;
      box-shadow: 
        0 10px 50px rgba(255, 107, 157, 0.3),
        0 4px 20px rgba(199, 125, 255, 0.2);
      animation: float 4s ease-in-out infinite;
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    h1 {
      font-size: 56px;
      font-weight: 900;
      margin: 0 0 16px;
      letter-spacing: -2px;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.1;
    }

    .tagline {
      font-size: 20px;
      color: var(--text-muted);
      margin: 0 0 12px;
      font-weight: 500;
    }

    .tagline-highlight {
      background: var(--gradient-warm);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-weight: 700;
    }

    /* Benefits Section */
    .benefits {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .benefit {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 28px;
      position: relative;
      overflow: hidden;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .benefit:hover {
      transform: translateY(-4px);
    }

    .benefit::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
    }

    .benefit:nth-child(1)::before { background: var(--gradient-warm); }
    .benefit:nth-child(2)::before { background: var(--gradient-cool); }
    .benefit:nth-child(3)::before { background: var(--gradient-success); }
    .benefit:nth-child(4)::before { background: linear-gradient(90deg, var(--yellow), var(--orange)); }

    .benefit:nth-child(1):hover { box-shadow: 0 20px 40px rgba(255, 107, 157, 0.15); }
    .benefit:nth-child(2):hover { box-shadow: 0 20px 40px rgba(199, 125, 255, 0.15); }
    .benefit:nth-child(3):hover { box-shadow: 0 20px 40px rgba(114, 239, 221, 0.15); }
    .benefit:nth-child(4):hover { box-shadow: 0 20px 40px rgba(255, 209, 102, 0.15); }

    .benefit-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin-bottom: 16px;
    }

    .benefit:nth-child(1) .benefit-icon { background: var(--pink-glow); }
    .benefit:nth-child(2) .benefit-icon { background: var(--purple-glow); }
    .benefit:nth-child(3) .benefit-icon { background: var(--green-glow); }
    .benefit:nth-child(4) .benefit-icon { background: var(--yellow-glow); }

    .benefit-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .benefit:nth-child(1) .benefit-title { color: var(--pink); }
    .benefit:nth-child(2) .benefit-title { color: var(--purple); }
    .benefit:nth-child(3) .benefit-title { color: var(--green); }
    .benefit:nth-child(4) .benefit-title { color: var(--yellow); }

    .benefit-desc {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
    }

    /* Format Showcase */
    .formats-showcase {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px;
      margin-bottom: 32px;
      text-align: center;
    }

    .formats-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-dim);
      margin-bottom: 20px;
    }

    .formats-grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }

    .format-badge {
      padding: 10px 18px;
      border-radius: 50px;
      font-size: 13px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
      border: 1px solid transparent;
      transition: transform 0.2s ease;
    }

    .format-badge:hover {
      transform: scale(1.05);
    }

    .format-badge.pdf { background: var(--red-glow); color: var(--red); border-color: rgba(239, 71, 111, 0.3); }
    .format-badge.word { background: var(--blue-glow); color: var(--blue); border-color: rgba(72, 191, 227, 0.3); }
    .format-badge.excel { background: var(--green-glow); color: var(--green); border-color: rgba(114, 239, 221, 0.3); }
    .format-badge.ppt { background: var(--orange-glow); color: var(--orange); border-color: rgba(255, 159, 28, 0.3); }
    .format-badge.image { background: var(--purple-glow); color: var(--purple); border-color: rgba(199, 125, 255, 0.3); }
    .format-badge.text { background: var(--cyan-glow); color: var(--cyan); border-color: rgba(100, 223, 223, 0.3); }

    /* Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 32px;
      margin-bottom: 24px;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--gradient-primary);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 28px;
    }

    .card-number {
      width: 44px;
      height: 44px;
      background: var(--gradient-primary);
      color: white;
      font-weight: 800;
      font-size: 18px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 15px rgba(255, 107, 157, 0.3);
    }

    .card-title {
      font-weight: 700;
      font-size: 20px;
      margin-bottom: 4px;
    }

    .card-subtitle {
      font-size: 14px;
      color: var(--text-dim);
    }

    /* Dropzone */
    .dropzone {
      border: 2px dashed var(--border);
      border-radius: 20px;
      padding: 50px 24px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s ease;
      background: var(--elevated);
      position: relative;
    }

    .dropzone:hover {
      border-color: var(--purple);
      background: var(--purple-glow);
    }

    .dropzone.drag-over {
      border-color: var(--pink);
      background: var(--pink-glow);
      transform: scale(1.01);
      box-shadow: 0 0 60px rgba(255, 107, 157, 0.2);
    }

    .dropzone-icons {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 24px;
    }

    .dropzone-icons span {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }

    .icon-pdf { background: var(--red-glow); color: var(--red); }
    .icon-doc { background: var(--blue-glow); color: var(--blue); }
    .icon-xls { background: var(--green-glow); color: var(--green); }
    .icon-img { background: var(--purple-glow); color: var(--purple); }
    .icon-ppt { background: var(--orange-glow); color: var(--orange); }

    .dropzone-text {
      font-size: 17px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .dropzone-text strong {
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
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
      gap: 12px;
      margin-top: 24px;
      flex-wrap: wrap;
    }

    .stat {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: var(--elevated);
      border-radius: 14px;
      font-size: 14px;
      border: 1px solid var(--border);
    }

    .stat-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .stat-dot.pdf { background: var(--red); box-shadow: 0 0 10px var(--red); }
    .stat-dot.word { background: var(--blue); box-shadow: 0 0 10px var(--blue); }
    .stat-dot.excel { background: var(--green); box-shadow: 0 0 10px var(--green); }
    .stat-dot.image { background: var(--purple); box-shadow: 0 0 10px var(--purple); }
    .stat-dot.text { background: var(--cyan); box-shadow: 0 0 10px var(--cyan); }
    .stat-dot.total { background: var(--pink); box-shadow: 0 0 10px var(--pink); }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      color: var(--text);
    }

    /* Options */
    .options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 28px;
      padding: 24px;
      background: var(--elevated);
      border-radius: 18px;
      border: 1px solid var(--border);
    }

    .option-group label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-dim);
      margin-bottom: 10px;
    }

    .option-select {
      width: 100%;
      padding: 14px 18px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a1b2' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 14px center;
      transition: border-color 0.2s;
    }

    .option-select:focus {
      outline: none;
      border-color: var(--purple);
    }

    /* File List */
    .file-list {
      list-style: none;
      margin: 0 0 24px;
      padding: 0;
      max-height: 400px;
      overflow-y: auto;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 18px;
      background: var(--elevated);
      border: 1px solid var(--border);
      border-radius: 16px;
      margin-bottom: 10px;
      cursor: grab;
      transition: all 0.2s ease;
    }

    .file-item:hover {
      border-color: var(--purple);
      background: var(--purple-glow);
    }

    .file-item.dragging { opacity: 0.5; transform: scale(0.98); }
    .file-item.drag-over-item { border-color: var(--pink); background: var(--pink-glow); }

    .drag-handle {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px;
      opacity: 0.4;
      transition: opacity 0.2s;
    }

    .file-item:hover .drag-handle { opacity: 0.8; }

    .drag-handle span {
      display: block;
      width: 16px;
      height: 2px;
      background: var(--text);
      border-radius: 2px;
    }

    .file-type {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      flex-shrink: 0;
    }

    .file-type.pdf { background: var(--red-glow); color: var(--red); }
    .file-type.image { background: var(--purple-glow); color: var(--purple); }
    .file-type.word { background: var(--blue-glow); color: var(--blue); }
    .file-type.excel { background: var(--green-glow); color: var(--green); }
    .file-type.text, .file-type.markdown, .file-type.html { background: var(--cyan-glow); color: var(--cyan); }
    .file-type.powerpoint { background: var(--orange-glow); color: var(--orange); }

    .file-index {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-dim);
      min-width: 28px;
    }

    .file-info { flex: 1; min-width: 0; }

    .file-name {
      font-size: 15px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-meta {
      font-size: 12px;
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
      margin-top: 2px;
    }

    .file-remove {
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      color: var(--text-dim);
      cursor: pointer;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.2s;
    }

    .file-remove:hover { background: var(--red-glow); color: var(--red); }

    .empty-state {
      text-align: center;
      padding: 60px 24px;
      color: var(--text-dim);
    }

    .empty-state-icon { font-size: 48px; margin-bottom: 16px; }

    /* Progress */
    .progress-wrap {
      margin-bottom: 24px;
      display: none;
    }

    .progress-wrap.visible { display: block; }

    .progress-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 14px;
    }

    .progress-text { color: var(--text-muted); }
    
    .progress-percent { 
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .progress-bar {
      height: 10px;
      background: var(--elevated);
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .progress-fill {
      height: 100%;
      background: var(--gradient-primary);
      border-radius: 6px;
      width: 0%;
      transition: width 0.3s ease;
    }

    /* Button */
    .merge-btn {
      width: 100%;
      padding: 20px 28px;
      border: none;
      border-radius: 16px;
      background: var(--gradient-primary);
      color: white;
      font-family: 'Outfit', sans-serif;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 8px 30px rgba(255, 107, 157, 0.3);
      text-transform: uppercase;
      letter-spacing: 1.5px;
    }

    .merge-btn:hover:not(:disabled) {
      transform: translateY(-3px);
      box-shadow: 0 12px 40px rgba(255, 107, 157, 0.4);
    }

    .merge-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* Status */
    .status {
      padding: 16px 20px;
      border-radius: 14px;
      font-size: 15px;
      margin-top: 20px;
      display: none;
      align-items: center;
      gap: 12px;
      font-weight: 500;
    }

    .status.visible { display: flex; }

    .status.success {
      background: var(--green-glow);
      border: 1px solid rgba(114, 239, 221, 0.3);
      color: var(--green);
    }

    .status.error {
      background: var(--red-glow);
      border: 1px solid rgba(239, 71, 111, 0.3);
      color: var(--red);
    }

    /* Guide */
    .guide {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      overflow: hidden;
    }

    .guide-header {
      padding: 24px 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: background 0.2s;
    }

    .guide-header:hover { background: var(--elevated); }

    .guide-title {
      display: flex;
      align-items: center;
      gap: 14px;
      font-weight: 700;
      font-size: 16px;
    }

    .guide-icon {
      width: 44px;
      height: 44px;
      background: var(--gradient-cool);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .guide-chevron {
      width: 24px;
      height: 24px;
      stroke: var(--text-dim);
      transition: transform 0.3s ease;
    }

    .guide.open .guide-chevron { transform: rotate(180deg); }

    .guide-content {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.4s ease;
    }

    .guide.open .guide-content { max-height: 1200px; }

    .guide-inner {
      padding: 0 28px 28px;
      border-top: 1px solid var(--border);
    }

    .guide-section { margin-top: 28px; }

    .guide-section h3 {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 0 0 14px;
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .guide-section ul {
      margin: 0;
      padding-left: 20px;
    }

    .guide-section li {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 10px;
      line-height: 1.7;
    }

    .guide-section li::marker { color: var(--purple); }

    footer {
      text-align: center;
      margin-top: 48px;
      padding-top: 28px;
      border-top: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 14px;
    }

    footer a { 
      background: var(--gradient-primary);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-decoration: none;
      font-weight: 600;
    }

    footer a:hover { text-decoration: underline; }

    /* Animations */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hero { animation: fadeInUp 0.6s ease backwards; }
    .benefits { animation: fadeInUp 0.6s ease 0.15s backwards; }
    .formats-showcase { animation: fadeInUp 0.6s ease 0.25s backwards; }
    .card:nth-child(1) { animation: fadeInUp 0.6s ease 0.35s backwards; }
    .card:nth-child(2) { animation: fadeInUp 0.6s ease 0.45s backwards; }
    .guide { animation: fadeInUp 0.6s ease 0.55s backwards; }

    .file-list::-webkit-scrollbar { width: 8px; }
    .file-list::-webkit-scrollbar-track { background: var(--elevated); border-radius: 4px; }
    .file-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .file-list::-webkit-scrollbar-thumb:hover { background: var(--text-dim); }

    @media (max-width: 600px) {
      h1 { font-size: 36px; }
      .tagline { font-size: 16px; }
      .benefits { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Hero Section -->
    <section class="hero">
      <div class="logo">📄</div>
      <h1>Master Merge Tool</h1>
      <p class="tagline">The <span class="tagline-highlight">easiest way</span> to combine all your documents into one PDF</p>
    </section>

    <!-- Benefits -->
    <section class="benefits">
      <div class="benefit">
        <div class="benefit-icon">🚀</div>
        <div class="benefit-title">Lightning Fast</div>
        <div class="benefit-desc">Convert and merge dozens of files in seconds. No waiting, no signup, no hassle—just instant results.</div>
      </div>
      <div class="benefit">
        <div class="benefit-icon">📁</div>
        <div class="benefit-title">15+ File Formats</div>
        <div class="benefit-desc">PDF, Word, Excel, PowerPoint, images, text files, Markdown, and HTML—all supported in one tool.</div>
      </div>
      <div class="benefit">
        <div class="benefit-icon">🔒</div>
        <div class="benefit-title">100% Private</div>
        <div class="benefit-desc">Your files are processed server-side and immediately deleted. Nothing is ever stored or shared.</div>
      </div>
      <div class="benefit">
        <div class="benefit-icon">🗜️</div>
        <div class="benefit-title">Smart Compression</div>
        <div class="benefit-desc">Choose your quality level—from crisp prints to tiny email attachments. You're in control.</div>
      </div>
    </section>

    <!-- Format Showcase -->
    <section class="formats-showcase">
      <div class="formats-title">Supported File Types</div>
      <div class="formats-grid">
        <span class="format-badge pdf">.PDF</span>
        <span class="format-badge word">.DOCX</span>
        <span class="format-badge word">.DOC</span>
        <span class="format-badge excel">.XLSX</span>
        <span class="format-badge excel">.XLS</span>
        <span class="format-badge excel">.CSV</span>
        <span class="format-badge ppt">.PPTX</span>
        <span class="format-badge image">.JPG</span>
        <span class="format-badge image">.PNG</span>
        <span class="format-badge image">.GIF</span>
        <span class="format-badge image">.WEBP</span>
        <span class="format-badge text">.TXT</span>
        <span class="format-badge text">.MD</span>
        <span class="format-badge text">.HTML</span>
      </div>
    </section>

    <!-- Step 1: Upload -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">1</span>
        <div>
          <div class="card-title">Upload Your Files</div>
          <div class="card-subtitle">Drop a folder or pick individual documents</div>
        </div>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dropzone-icons">
          <span class="icon-pdf">PDF</span>
          <span class="icon-doc">DOC</span>
          <span class="icon-xls">XLS</span>
          <span class="icon-img">IMG</span>
          <span class="icon-ppt">PPT</span>
        </div>
        <div class="dropzone-text">
          <strong>Drop files here</strong> or click to browse
        </div>
        <div class="dropzone-hint">Drag entire folders for batch upload (Chrome/Edge)</div>
        <input type="file" id="fileInput" multiple webkitdirectory />
      </div>

      <div class="stats" id="stats" style="display:none;">
        <div class="stat"><span class="stat-dot pdf"></span>PDFs: <span class="stat-value" id="pdfCount">0</span></div>
        <div class="stat"><span class="stat-dot word"></span>Docs: <span class="stat-value" id="wordCount">0</span></div>
        <div class="stat"><span class="stat-dot excel"></span>Sheets: <span class="stat-value" id="excelCount">0</span></div>
        <div class="stat"><span class="stat-dot image"></span>Images: <span class="stat-value" id="imageCount">0</span></div>
        <div class="stat"><span class="stat-dot text"></span>Text: <span class="stat-value" id="textCount">0</span></div>
        <div class="stat"><span class="stat-dot total"></span>Total: <span class="stat-value" id="totalSize">0 KB</span></div>
      </div>
    </div>

    <!-- Step 2: Configure & Merge -->
    <div class="card">
      <div class="card-header">
        <span class="card-number">2</span>
        <div>
          <div class="card-title">Configure & Create</div>
          <div class="card-subtitle">Reorder files, set quality, generate your PDF</div>
        </div>
      </div>

      <div class="options">
        <div class="option-group">
          <label>Quality Level</label>
          <select class="option-select" id="qualitySelect">
            <option value="high">🖨️ High — Best for printing</option>
            <option value="medium" selected>⚖️ Medium — Balanced</option>
            <option value="low">📧 Low — Email friendly</option>
          </select>
        </div>
        <div class="option-group">
          <label>Output Name</label>
          <select class="option-select" id="filenameSelect">
            <option value="merged">merged.pdf</option>
            <option value="combined">combined.pdf</option>
            <option value="master">master.pdf</option>
            <option value="document">document.pdf</option>
          </select>
        </div>
      </div>

      <ul class="file-list" id="fileList">
        <li class="empty-state">
          <div class="empty-state-icon">📂</div>
          <div>Drop some files above to get started!</div>
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

      <button class="merge-btn" id="mergeBtn" disabled>✨ Create Master PDF</button>
    </div>

    <!-- Guide -->
    <div class="guide" id="guide">
      <div class="guide-header" onclick="toggleGuide()">
        <div class="guide-title">
          <span class="guide-icon">💡</span>
          Tips & Help
        </div>
        <svg class="guide-chevron" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="guide-content">
        <div class="guide-inner">
          <div class="guide-section">
            <h3>How It Works</h3>
            <ul>
              <li><strong>Upload:</strong> Drag files or an entire folder onto the drop zone</li>
              <li><strong>Reorder:</strong> Drag items by the handle to arrange merge order</li>
              <li><strong>Configure:</strong> Pick your compression level and filename</li>
              <li><strong>Download:</strong> Click the button and get your merged PDF instantly</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Quality Settings</h3>
            <ul>
              <li><strong>High:</strong> Maximum detail, ideal for printing documents</li>
              <li><strong>Medium:</strong> Great balance of size and quality for most uses</li>
              <li><strong>Low:</strong> Smallest file size, perfect for email attachments</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3>Pro Tips</h3>
            <ul>
              <li>Excel sheets automatically render with formatted tables</li>
              <li>Images are scaled to fit standard letter-size pages</li>
              <li>Each file gets a header showing its original filename</li>
              <li>Files are processed in the order shown—drag to reorder!</li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <footer>
      Files are processed privately and never stored.
      <br>Made with <a href="https://pdf-lib.js.org/" target="_blank">pdf-lib</a> • <a href="https://sharp.pixelplumbing.com/" target="_blank">sharp</a> • <a href="https://github.com/draphael123/mastermergertool" target="_blank">GitHub</a>
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
    return { pdf:'PDF', image:'IMG', word:'DOC', excel:'XLS', text:'TXT', markdown:'MD', html:'HTM', powerpoint:'PPT' }[type] || '?';
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
      fileList.innerHTML = '<li class="empty-state"><div class="empty-state-icon">📂</div><div>Drop some files above to get started!</div></li>';
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
    statusEl.innerHTML = (err ? '⚠️ ' : '✅ ') + msg;
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

      showStatus('PDF created successfully! Your download has started.');
      setTimeout(hideProgress, 2000);
    } catch (err) {
      hideProgress();
      showStatus(err.message || 'Something went wrong. Please try again.', true);
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
