import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deleteWorkspaceRecord, publishWorkspaceRecord, WORKSPACE_SAVE_DIRECTORY } from '../../hosts/node/workspace/files.mjs';
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
		if (payload.expectedSource !== undefined && payload.expectedSource !== null && typeof payload.expectedSource !== 'string') {
			throw new HttpError(400, 'Invalid source precondition.');
		}
		const path = await resolveRootedPath(root, payload.path, true);
		const staging = await resolveRootedPath(root, join(dirname(payload.path), WORKSPACE_SAVE_DIRECTORY), true);
		try { await publishWorkspaceRecord(path, staging, payload, req.headers['if-none-match'] !== '*', payload.expectedSource); }
		catch (error) {
			if (error.code === 'EEXIST') throw new HttpError(412, 'File already exists.');
			if (error.code === 'ESTALE') throw new HttpError(409, 'Source changed outside this Studio.');
			throw error;
		}
		res.writeHead(204).end();
		return;
	}
	if (req.method === 'DELETE') {
		await deleteWorkspaceRecord(await resolveRootedPath(root, url.searchParams.get('path')));
		res.writeHead(204).end();
		return;
	}
	res.writeHead(405, { Allow: 'GET,PUT,DELETE' }).end();
}
