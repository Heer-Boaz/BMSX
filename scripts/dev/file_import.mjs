import { createWriteStream } from 'node:fs';
import { link, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { HttpError } from './http_security.mjs';
import { resolveRootedPath } from './rooted_path.mjs';

/** Publish one complete, unmodified workspace file. A build must never discover an upload in progress. */
export async function handleFileImport(root, request, response, url) {
	response.setHeader('Cache-Control', 'no-store');
	if (request.method !== 'PUT') { response.writeHead(405, { Allow: 'PUT' }).end(); return; }
	if (request.headers['content-type'] !== 'application/octet-stream') throw new HttpError(415, 'File import requires application/octet-stream.');
	if (request.headers['if-none-match'] !== '*') throw new HttpError(428, 'File import requires If-None-Match: *; existing files are never overwritten.');
	const path = url.searchParams.get('path');
	const destination = await resolveRootedPath(root, path, true);
	// Stage on the destination filesystem, outside the ROM producer's input set.
	const prefix = await resolveRootedPath(root, join(dirname(path), '.bmsx/imports/upload-'), true);
	const staging = await mkdtemp(prefix);
	try {
		const file = join(staging, 'contents');
		await pipeline(request, createWriteStream(file, { flags: 'wx' }));
		try { await link(file, destination); }
		catch (error) {
			if (error.code === 'EEXIST') throw new HttpError(412, 'File already exists.');
			throw error;
		}
	} catch (error) {
		if (error.code !== 'ECONNRESET') throw error;
		// The sending client left. No destination was published, and there is no response recipient.
		return;
	} finally { await rm(staging, { recursive: true, force: true }); }
	response.writeHead(201).end();
}
