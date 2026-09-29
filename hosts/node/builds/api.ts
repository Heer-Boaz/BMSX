import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { StudioBuildRequest } from '../../common/studio_builds';
import type { StudioBuildJobs } from './jobs';

import { BuildRequestError } from './errors';

/** The untrusted HTTP/MCP admission boundary. Internal producer/worker values need no DTO revalidation. */
export function buildRequestId(value: unknown): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new BuildRequestError(400, 'requestId must be a UUID');
	return value;
}
export function decodeBuildRequest(value: Record<string, unknown>): StudioBuildRequest {
	const requestId = buildRequestId(value.requestId);
	if (typeof value.target !== 'string' || !/^[a-z0-9_-]+$/.test(value.target)) throw new BuildRequestError(400, 'Invalid cartridge target');
	if (value.debug !== true && value.debug !== false) throw new BuildRequestError(400, 'Specify debug: true or false');
	if (![0, 1, 2, 3].includes(value.optLevel as number)) throw new BuildRequestError(400, 'optLevel must be 0, 1, 2 or 3');
	return { requestId, target: value.target, debug: value.debug, optLevel: value.optLevel as 0 | 1 | 2 | 3 };
}
export function buildArtifactId(value: unknown): string {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new BuildRequestError(400, 'Invalid artifact ID');
	return value;
}

/** Logs are capped by their writer, fetched on demand, and never carried by the control stream. */
export async function readBuildLog(jobs: StudioBuildJobs, id: string): Promise<string> {
	const job = jobs.get(id);
	if (job === undefined) throw new BuildRequestError(404, 'Build not found');
	try { return await readFile(join(jobs.root, 'jobs', `${id}.log`), 'utf8'); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (job.state === 'queued' || job.state === 'cancelled' || job.state === 'interrupted')) return '';
		throw error;
	}
}

export async function handleBuildRequest(jobs: StudioBuildJobs, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
	try {
		const route = url.pathname.slice('/__bmsx__/builds'.length).split('/').filter(Boolean);
		let result: unknown;
		if (request.method === 'GET' && route.length === 0) result = jobs.snapshot();
		else if (request.method === 'GET' && route[0] === 'targets') result = await jobs.targets();
		else if (route[0] === 'jobs') {
			const id = buildRequestId(route[1]);
			if (request.method === 'PUT' && route.length === 2) {
				if (request.headers['content-type'] !== 'application/json') throw new BuildRequestError(415, 'Expected application/json');
				const chunks: Buffer[] = []; let size = 0;
				for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new BuildRequestError(413, 'Build request is too large'); chunks.push(chunk); }
				const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				result = await jobs.admit(decodeBuildRequest({ ...input, requestId: id }));
			} else if (request.method === 'POST' && route[2] === 'cancel') result = await jobs.cancel(id);
			else if (request.method === 'GET' && route[2] === 'log') result = await readBuildLog(jobs, id);
			else if (request.method === 'GET' && route.length === 2) {
				result = jobs.get(id); if (result === undefined) throw new BuildRequestError(404, 'Build request not admitted');
			} else throw new BuildRequestError(405, 'Unsupported build operation');
		} else if (request.method === 'GET' && route[0] === 'artifacts') {
			const id = buildArtifactId(route[1]), artifact = await jobs.artifacts.read(id);
			if (route.length === 2) result = artifact;
			else {
				const outputs = [...artifact.system.outputs, ...(artifact.cart?.outputs ?? [])];
				const output = outputs.find(output => output.file === route[2]);
				if (route.length !== 3 || output === undefined) throw new BuildRequestError(404, 'Artifact file not found');
				const file = join(jobs.artifacts.directory(id), output.file), metadata = await stat(file);
				response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': metadata.size,
					'Cache-Control': 'private, max-age=31536000, immutable', ETag: `"${output.digest}"` });
				createReadStream(file).on('error', error => response.destroy(error)).pipe(response); return;
			}
		} else throw new BuildRequestError(404, 'Build route not found');
		response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
	} catch (error) {
		const status = error instanceof BuildRequestError ? error.status : error instanceof SyntaxError ? 400 : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
		response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(error instanceof Error ? error.message : String(error));
	}
}
