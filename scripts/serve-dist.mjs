#!/usr/bin/env node
// Development server for the player and Studio, including workspace and Codex access over the LAN.
// Usage: node scripts/serve-dist.mjs [--dir dist] [--port 8080] [--host 127.0.0.1] [--spa] [--cache <seconds|no-store>]

import { createServer } from 'node:http';
import { stat, access, readdir, realpath } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HttpError, WorkspaceHttpSession } from './dev/http_security.mjs';
import { resolveRootedPath } from './dev/rooted_path.mjs';
import { handleWorkspaceRequest } from './dev/workspace_api.mjs';

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
	console.log(`Local development server for ./dist
Usage: node scripts/serve-dist.mjs [options]
Options:
	-d, --dir <path>      Directory to serve (default: dist)
	-p, --port <number>   Port to listen on (default: 8080)
	-H, --host <address>  Host address (default: 127.0.0.1; use 0.0.0.0 for trusted LAN access)
			--spa             Fallback to index.html for unknown routes
			--cache <secs|no-store>  Cache-Control (default: no-store)
	-h, --help            Show this help
`);
	process.exit(0);
}

const dir = path.resolve(String(getArg('dir', 'd', 'dist')));
const port = Number(getArg('port', 'p', '8080'));
const host = String(getArg('host', 'H', '127.0.0.1'));
const spa = Boolean(getArg('spa', '', false));
const cacheArg = String(getArg('cache', '', 'no-store'));
const cacheHeader = cacheArg === 'no-store' ? 'no-store' : `public, max-age=${Number(cacheArg) || 0}`;
const COOP_COEP_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	// Handig/veilig voor eigen assets:
	'Cross-Origin-Resource-Policy': 'same-origin',
};

const MIME = new Map(Object.entries({
	'.html': 'text/html; charset=utf-8',
	'.htm': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.cjs': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.wasm': 'application/wasm',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2'
}));

const projectRoot = await realpath(process.cwd());
const workspaceSession = new WorkspaceHttpSession(host);
// The existing plain-Node entry owns its TypeScript support, not a separate launch mode.
// Constructing the endpoint starts no process and opens no account profile.
await import('tsx');
const { CodexHttpApi } = await import('../hosts/node/codex/http_api.ts');
const { STUDIO_SOURCE_TOOLS } = await import('../ide/workbench/services/assistant/source_tool_protocol.ts');
const { STUDIO_TEST_TOOLS } = await import('../ide/workbench/services/assistant/test_tool_protocol.ts');
const { STUDIO_RUNTIME_TOOLS } = await import('../ide/workbench/services/assistant/runtime_tool_protocol.ts');
const assistant = new CodexHttpApi({ tools: [...STUDIO_SOURCE_TOOLS, ...STUDIO_TEST_TOOLS, ...STUDIO_RUNTIME_TOOLS],
	profileDirectory: path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'bmsx', 'studio-codex') });

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

const root = await realpath(dir);

// Decide default file to open/redirect when path is '/'
const defaultCandidates = ['index.html'];
let defaultFile = null;
for (const c of defaultCandidates) {
	if (await fileExists(path.join(root, c))) { defaultFile = c; break; }
}

const server = createServer(async (req, res) => {
	try {
		const requestUrl = new URL(req.url || '/', 'http://x');

		// Always enable cross-origin isolation (required for SharedArrayBuffer)
		for (const [k, v] of Object.entries(COOP_COEP_HEADERS)) {
			res.setHeader(k, v);
		}

		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('X-Frame-Options', 'DENY');
		res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
		if (requestUrl.pathname === '/__bmsx__/session') {
			workspaceSession.bootstrap(req, res);
			return;
		}
		if (requestUrl.pathname === '/__bmsx__/lua') {
			workspaceSession.authorize(req);
			await handleWorkspaceRequest(projectRoot, req, res, requestUrl);
			return;
		}
		if (requestUrl.pathname.startsWith('/__bmsx__/assistant/')) {
			workspaceSession.authorize(req);
			await assistant.handle(req, res, requestUrl.pathname);
			return;
		}
		if (await handleCartsApi(req, res, requestUrl)) {
			return;
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET,HEAD' }).end();
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
		let target;
		let st;
		try {
			target = await resolveRootedPath(root, decodeURIComponent(urlPath).slice(1));
			st = await stat(target);
			if (st.isDirectory()) {
				const idx = await resolveRootedPath(root, path.relative(root, path.join(target, 'index.html')));
				if (await fileExists(idx)) {
					target = idx;
					st = await stat(target);
				} else {
					res.writeHead(403).end('Directory listing denied.');
					return;
				}
			}
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			if (spa) {
				const idx = await resolveRootedPath(root, 'index.html');
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
		if (req.method === 'HEAD') res.end();
		else createReadStream(target, { flags: constants.O_RDONLY | constants.O_NOFOLLOW }).on('error', error => res.destroy(error)).pipe(res);
	} catch (error) {
		if (error instanceof HttpError) res.writeHead(error.status).end(error.message);
		else if (error.code === 'ENOENT') res.writeHead(404).end('Not Found');
		else if (error instanceof SyntaxError || error instanceof URIError) res.writeHead(400).end('Bad Request');
		else { console.error(error); res.writeHead(500).end('Internal Server Error'); }
	}
});

server.listen(port, host, () => {
	const port = server.address().port;
	const ips = getLocalIPs();
	console.log(`Serving ${root}\n  http://localhost:${port}/\n`);
	if (defaultFile) {
		console.log(`Default file: /${defaultFile}`);
	}
	console.log('Studio APIs: same-origin, session-authorized; Codex starts on Connect');
	if ((host === '0.0.0.0' || host === '::') && ips.length) {
		console.log('On your LAN:');
		for (const ip of ips) console.log(`  http://${ip}:${port}/`);
		console.log('LAN clients can access workspace sources and the Studio Codex profile.');
	}
	if (defaultFile) {
		console.log(`\nTip: open http://localhost:${port}/${defaultFile}`);
	} else {
		console.log('\nTip: open your HTML file, e.g. /index.html?rom=<your-rom>.rom');
	}
});

let shutdown;
const stop = () => {
	// Stop admission, then join both the assistant process and accepted HTTP IO.
	// Killing every socket here would interrupt an already accepted source save.
	shutdown ??= Promise.all([assistant.close(), new Promise((resolve, reject) => {
		server.close(error => error ? reject(error) : resolve());
	})]).catch(error => { console.error(error); process.exitCode = 1; });
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
