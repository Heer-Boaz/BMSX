#!/usr/bin/env node
// Minimal static file server to host ./dist over your LAN
// Usage: node scripts/serve-dist.mjs [--dir dist] [--port 8080] [--host 0.0.0.0] [--spa] [--cache <seconds|no-store>]

import { createServer } from 'node:http';
import { stat, access, readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
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

const projectRoot = process.cwd();

function resolveWorkspacePath(relativePath) {
	const trimmed = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
	const target = path.resolve(projectRoot, trimmed);
	if (target === projectRoot) {
		return target;
	}
	const boundary = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
	if (!target.startsWith(boundary)) {
		throw new Error(`Path "${relativePath}" is outside of the workspace.`);
	}
	return target;
}

async function readRequestBody(req) {
	return await new Promise((resolveBody, rejectBody) => {
		const chunks = [];
		req.on('data', chunk => {
			chunks.push(chunk);
		});
		req.on('end', () => {
			const buffer = chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
			resolveBody(buffer.toString('utf8'));
		});
		req.on('error', rejectBody);
	});
}

async function handleWorkspaceApi(req, res, url) {
	if (url.pathname !== '/__bmsx__/workspace') {
		return false;
	}
	if (req.method !== 'POST') {
		res.writeHead(405, { 'Allow': 'POST' }).end();
		return true;
	}
	const rawBody = await readRequestBody(req);
	let payload;
	try {
		payload = JSON.parse(rawBody);
	} catch {
		res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request body must be valid JSON.' }));
		return true;
	}
	const projectRootPath = typeof payload?.projectRootPath === 'string' ? payload.projectRootPath : '';
	if (!projectRootPath) {
		res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Missing "projectRootPath".' }));
		return true;
	}
	let resolvedRoot;
	try {
		resolvedRoot = resolveWorkspacePath(projectRootPath);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
		return true;
	}
	const metadataDir = path.join(resolvedRoot, '.bmsx');
	const dirtyDir = path.join(metadataDir, 'dirty');
	try {
		await mkdir(metadataDir, { recursive: true });
		await mkdir(dirtyDir, { recursive: true });
		res.writeHead(204).end();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
	}
	return true;
}

async function handleLuaApi(req, res, url) {
	if (url.pathname !== '/__bmsx__/lua') {
		return false;
	}
	if (req.method === 'OPTIONS') {
		res.writeHead(204, {
			'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		}).end();
		return true;
	}
	if (req.method === 'GET') {
		const targetPath = url.searchParams.get('path');
		if (!targetPath) {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Missing "path" query parameter.' }));
			return true;
		}
		let absolutePath;
		try {
			absolutePath = resolveWorkspacePath(targetPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
			return true;
		}
		let contents;
		let stats;
		try {
			stats = await stat(absolutePath);
			contents = await readFile(absolutePath, 'utf8');
		} catch {
			res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `File not found: ${targetPath}` }));
			return true;
		}
		res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
			path: targetPath,
			contents,
			updatedAt: stats?.mtimeMs,
		}));
		return true;
	}
	if (req.method === 'POST') {
		const rawBody = await readRequestBody(req);
		let payload;
		try {
			payload = JSON.parse(rawBody);
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Request body must be valid JSON.' }));
			return true;
		}
		const targetPath = payload && typeof payload.path === 'string' ? payload.path : '';
		const contents = payload && typeof payload.contents === 'string' ? payload.contents : null;
		if (!targetPath || contents === null) {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Both "path" (string) and "contents" (string) are required.' }));
			return true;
		}
		let absolutePath;
		try {
			absolutePath = resolveWorkspacePath(targetPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
			return true;
		}
		try {
			await mkdir(path.dirname(absolutePath), { recursive: true });
		} catch {
			// directory creation best-effort
		}
		await writeFile(absolutePath, contents, 'utf8');
		res.writeHead(204).end();
		return true;
	}
	if (req.method === 'DELETE') {
		const targetPath = url.searchParams.get('path');
		if (!targetPath) {
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Missing "path" query parameter.' }));
			return true;
		}
		let absolutePath;
		try {
			absolutePath = resolveWorkspacePath(targetPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
			return true;
		}
		try {
			await unlink(absolutePath);
		} catch (err) {
			if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
				res.writeHead(204).end();
				return true;
			}
			const message = err instanceof Error ? err.message : String(err);
			res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: message }));
			return true;
		}
		res.writeHead(204).end();
		return true;
	}
	res.writeHead(405, { 'Allow': 'GET,POST,DELETE,OPTIONS' }).end();
	return true;
}

async function handleCartsApi(req, res, url) {
	if (url.pathname !== '/__bmsx__/carts') {
		return false;
	}
	if (req.method !== 'GET') {
		res.writeHead(405, { 'Allow': 'GET' }).end();
		return true;
	}
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (err) {
		res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(err) }));
		return true;
	}
	const carts = entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.rom') && !entry.name.startsWith('engine'))
		.map(entry => {
			const file = entry.name;
			const label = file.replace(/\.debug\.rom$/i, '').replace(/\.rom$/i, '');
			return { file, label, href: `/${file}` };
		});
	res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ carts }));
	return true;
}

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
    const requestUrl = new URL(req.url || '/', 'http://x');
    if (await handleWorkspaceApi(req, res, requestUrl)) {
        return;
    }
    if (await handleLuaApi(req, res, requestUrl)) {
        return;
    }
    if (await handleCartsApi(req, res, requestUrl)) {
        return;
    }
    const urlPath = requestUrl.pathname;

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
