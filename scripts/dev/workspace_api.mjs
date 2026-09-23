import { constants } from 'node:fs';
import { open, readdir, unlink } from 'node:fs/promises';
import { HttpError } from './http_security.mjs';
import { resolveRootedPath } from './rooted_path.mjs';

/** Authorized filesystem transport only. Source revisions/recovery remain Studio-owned. */
export async function handleWorkspaceRequest(root, req, res, url) {
	res.setHeader('Cache-Control', 'no-store');
	if (req.method === 'GET') {
		const directory = url.searchParams.get('directory');
		if (directory !== null) {
			const entries = await readdir(await resolveRootedPath(root, directory), { withFileTypes: true });
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(entries.map(entry => ({
				name: entry.name, type: entry.isDirectory() ? 'directory'
					: entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symbolic-link' : 'other',
			}))));
			return;
		}
		const path = url.searchParams.get('path');
		const file = await open(await resolveRootedPath(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const stats = await file.stat(), contents = await file.readFile('utf8');
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path, contents, updatedAt: Math.round(stats.mtimeMs) }));
		} finally { await file.close(); }
		return;
	}
	if (req.method === 'PUT') {
		if (req.headers['content-type'] !== 'application/json') throw new HttpError(415, 'Workspace writes require application/json.');
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		const path = await resolveRootedPath(root, payload.path, true);
		const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW
			| (req.headers['if-none-match'] === '*' ? constants.O_EXCL : constants.O_TRUNC);
		let file;
		try { file = await open(path, flags); }
		catch (error) {
			if (error.code === 'EEXIST') throw new HttpError(412, 'File already exists.');
			throw error;
		}
		try {
			await file.writeFile(payload.contents, 'utf8');
			const seconds = payload.updatedAt / 1000;
			await file.utimes(seconds, seconds);
		} finally { await file.close(); }
		res.writeHead(204).end();
		return;
	}
	if (req.method === 'DELETE') {
		try { await unlink(await resolveRootedPath(root, url.searchParams.get('path'))); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		res.writeHead(204).end();
		return;
	}
	res.writeHead(405, { Allow: 'GET,PUT,DELETE' }).end();
}
