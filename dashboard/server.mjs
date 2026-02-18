/**
 * Monitoring Dashboard Server
 *
 * Minimal Node.js HTTP server (zero dependencies) that serves
 * the dashboard frontend and API endpoints for scraper stats/logs.
 *
 * Usage: pnpm run dashboard
 * Open: http://localhost:3847
 */

import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3847;
const PROJECT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATS_FILE = path.join(PROJECT_DIR, 'data', 'scraper-stats.json');
const LOG_FILE = path.join(PROJECT_DIR, 'logs', 'scraper.log');
const HEARTBEAT_FILE = path.join(PROJECT_DIR, 'data', 'heartbeat.json');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function readLastLines(filePath, lineCount = 100) {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const lines = data.split('\n');
    return lines.slice(-lineCount).join('\n');
  } catch {
    return 'No log file found.';
  }
}

async function serveStaticFile(res, filePath) {
  try {
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // API endpoints
  if (pathname === '/api/stats') {
    const stats = await readJsonFile(STATS_FILE);
    sendJson(res, stats || { error: 'No stats file found. Is the scraper running?' });
    return;
  }

  if (pathname === '/api/heartbeat') {
    const heartbeat = await readJsonFile(HEARTBEAT_FILE);
    sendJson(res, heartbeat || { error: 'No heartbeat file found. Is the scraper running?' });
    return;
  }

  if (pathname === '/api/logs') {
    const lines = url.searchParams.get('lines') || '100';
    const logs = await readLastLines(LOG_FILE, parseInt(lines, 10));
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-cache',
    });
    res.end(logs);
    return;
  }

  // Static files
  if (pathname === '/' || pathname === '/index.html') {
    await serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }

  // Serve any file from public/
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  await serveStaticFile(res, path.join(PUBLIC_DIR, safePath));
});

server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Stats file: ${STATS_FILE}`);
  console.log(`Log file: ${LOG_FILE}`);
});
