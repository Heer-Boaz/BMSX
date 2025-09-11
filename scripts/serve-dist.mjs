#!/usr/bin/env node
// Minimal static file server to host ./dist over your LAN
// Usage: node scripts/serve-dist.mjs [--dir dist] [--port 8080] [--host 0.0.0.0] [--spa] [--cache <seconds|no-store>]

import { createServer } from 'node:http';
import { stat, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
function getArg(name, short, def) {
	const i = args.findIndex(a => a === `--${name}` || a === `-${short}`);
	if (i !== -1) {
		const v = args[i + 1];
		if (!v || v.startsWith('-')) return true; // boolean flag present
		return v;
	}
	return def;
}

if (args.includes('--help') || args.includes('-h')) {
	console.log(`Static server for ./dist
Usage: node scripts/serve-dist.mjs [options]
Options:
	-d, --dir <path>      Directory to serve (default: dist)
	-p, --port <number>   Port to listen on (default: 8080)
	-H, --host <address>  Host address to bind (default: 0.0.0.0)
			--spa             Fallback to index.html for unknown routes
			--cache <secs|no-store>  Cache-Control (default: no-store)
	-h, --help            Show this help
`);
	process.exit(0);
}

const dir = path.resolve(String(getArg('dir', 'd', 'dist')));
const port = Number(getArg('port', 'p', '8080')) || 8080;
const host = String(getArg('host', 'H', '0.0.0.0'));
const spa = Boolean(getArg('spa', '', false));
const cacheArg = String(getArg('cache', '', 'no-store'));
const cacheHeader = cacheArg === 'no-store' ? 'no-store' : `public, max-age=${Number(cacheArg) || 0}`;

const MIME = new Map(Object.entries({
	'.html': 'text/html; charset=utf-8',
	'.htm':  'text/html; charset=utf-8',
	'.js':   'text/javascript; charset=utf-8',
	'.mjs':  'text/javascript; charset=utf-8',
	'.cjs':  'text/javascript; charset=utf-8',
	'.css':  'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map':  'application/json; charset=utf-8',
	'.svg':  'image/svg+xml',
	'.png':  'image/png',
	'.jpg':  'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif':  'image/gif',
	'.webp': 'image/webp',
	'.ico':  'image/x-icon',
	'.wasm': 'application/wasm',
	'.mp3':  'audio/mpeg',
	'.mp4':  'video/mp4',
	'.ttf':  'font/ttf',
	'.otf':  'font/otf',
	'.woff': 'font/woff',
	'.woff2':'font/woff2'
}));

function getType(p) {
	const ext = path.extname(p).toLowerCase();
	return MIME.get(ext) || 'application/octet-stream';
}

function safeJoin(root, urlPath) {
    const decoded = decodeURIComponent(urlPath || '/');
    const rel = decoded.startsWith('/') ? decoded.slice(1) : decoded;
    const joined = path.resolve(path.join(root, rel));
    if (joined === root) return joined; // root allowed
    if (!joined.startsWith(root + path.sep)) return null; // block traversal
    return joined;
}

function getLocalIPs() {
	const nets = os.networkInterfaces();
	const addrs = [];
	for (const name of Object.keys(nets)) {
		for (const net of nets[name] || []) {
			if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
		}
	}
	return addrs;
}

async function fileExists(p) {
	try { await access(p); return true; } catch { return false; }
}

const root = dir;

// Decide default file to open/redirect when path is '/'
const defaultCandidates = ['game_debug.html', 'game.html', 'index.html'];
let defaultFile = null;
for (const c of defaultCandidates) {
    if (await fileExists(path.join(root, c))) { defaultFile = c; break; }
}

const server = createServer(async (req, res) => {
	try {
    const urlPath = new URL(req.url || '/', 'http://x').pathname;

    // Redirect root to preferred default file if available
    if (urlPath === '/' || urlPath === '') {
        if (defaultFile) {
            res.writeHead(302, { 'Location': `/${defaultFile}` }).end();
            return;
        }
    }
		let target = safeJoin(root, urlPath);
		if (!target) {
			res.writeHead(403).end('Forbidden');
			return;
		}

		let st;
		try {
			st = await stat(target);
			if (st.isDirectory()) {
				const idx = path.join(target, 'index.html');
				if (await fileExists(idx)) {
					target = idx;
					st = await stat(target);
				} else {
					res.writeHead(403).end('Directory listing denied.');
					return;
				}
			}
		} catch {
			if (spa) {
				const idx = path.join(root, 'index.html');
				try {
					st = await stat(idx);
					target = idx;
				} catch {
					res.writeHead(404).end('Not Found');
					return;
				}
			} else {
				res.writeHead(404).end('Not Found');
				return;
			}
		}

		const type = getType(target);
		res.setHeader('Content-Type', type);
		res.setHeader('Content-Length', st.size);
		res.setHeader('Last-Modified', st.mtime.toUTCString());
		res.setHeader('Cache-Control', cacheHeader);
		createReadStream(target).pipe(res);
	} catch (e) {
		res.writeHead(500).end('Internal Server Error');
	}
});

server.listen(port, host, () => {
    const ips = getLocalIPs();
    console.log(`Serving ${root}\n  http://localhost:${port}/\n`);
    if (defaultFile) {
        console.log(`Default file: /${defaultFile}`);
    }
    if (ips.length) {
        console.log('On your LAN:');
        for (const ip of ips) console.log(`  http://${ip}:${port}/`);
    } else {
        console.log('No external IPv4 found. Is your network up?');
    }
    if (defaultFile) {
        console.log(`\nTip: open http://localhost:${port}/${defaultFile}`);
    } else {
        console.log('\nTip: open your HTML file, e.g. /game_debug.html');
    }
});
