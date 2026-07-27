import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
	WORKSPACE_FILE_ENDPOINT,
	type WorkspaceRecord,
} from '../../../ide/workspace/records';

type WorkspaceWriteRequest = WorkspaceRecord & {
	path: string;
};

function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
	const trimmedPath = relativePath.startsWith('/')
		? relativePath.slice(1)
		: relativePath;
	const filePath = path.resolve(workspaceRoot, trimmedPath);
	if (filePath === workspaceRoot) {
		return filePath;
	}
	const workspaceBoundary = workspaceRoot.endsWith(path.sep)
		? workspaceRoot
		: `${workspaceRoot}${path.sep}`;
	if (!filePath.startsWith(workspaceBoundary)) {
		throw new Error(`Path "${relativePath}" is outside of the workspace.`);
	}
	return filePath;
}

function jsonResponse(status: number, payload: object): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function handleWorkspaceRequest(
	request: Request,
	workspaceRoot: string,
): Promise<Response> {
	const url = new URL(request.url);
	switch (request.method) {
		case 'GET': {
			const relativePath = url.searchParams.get('path');
			if (!relativePath) {
				return jsonResponse(400, { error: 'Missing "path" query parameter.' });
			}
			try {
				const filePath = resolveWorkspaceFilePath(workspaceRoot, relativePath);
				const [stats, contents] = await Promise.all([
					fs.stat(filePath),
					fs.readFile(filePath, 'utf8'),
				]);
				return jsonResponse(200, {
					path: relativePath,
					contents,
					updatedAt: Math.round(stats.mtimeMs),
				});
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					return jsonResponse(404, { error: `File not found: ${relativePath}` });
				}
				return jsonResponse(500, { error: String(error) });
			}
		}
		case 'PUT': {
			const payload: WorkspaceWriteRequest = await request.json();
			const filePath = resolveWorkspaceFilePath(workspaceRoot, payload.path);
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, payload.contents, 'utf8');
			const modifiedSeconds = payload.updatedAt / 1000;
			await fs.utimes(filePath, modifiedSeconds, modifiedSeconds);
			return new Response(null, { status: 204 });
		}
		case 'DELETE': {
			const relativePath = url.searchParams.get('path');
			if (!relativePath) {
				return jsonResponse(400, { error: 'Missing "path" query parameter.' });
			}
			await fs.rm(resolveWorkspaceFilePath(workspaceRoot, relativePath), {
				force: true,
			});
			return new Response(null, { status: 204 });
		}
		default:
			return new Response(null, {
				status: 405,
				headers: { Allow: 'GET,PUT,DELETE' },
			});
	}
}

export function installNodeWorkspaceBridge(workspaceRoot: string): void {
	const networkFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = new URL(
			input instanceof Request ? input.url : input.toString(),
			'http://workspace.local',
		);
		if (url.pathname !== WORKSPACE_FILE_ENDPOINT) {
			return networkFetch(input, init);
		}
		const request = input instanceof Request
			? new Request(input, init)
			: new Request(url, init);
		return handleWorkspaceRequest(request, workspaceRoot);
	};
	console.log(`[bootrom:headless] Workspace files mounted at ${workspaceRoot}.`);
}
