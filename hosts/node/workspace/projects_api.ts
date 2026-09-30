import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { WorkspaceProjects } from './projects';

/** Untrusted HTTP and tool arguments enter through the same project-name boundary. */
export function decodeCartridgeTarget(target: unknown): string {
	if (typeof target !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(target)) throw new Error('Use a cartridge name with lowercase letters, digits, hyphens or underscores.');
	return target;
}

export async function handleProjectRequest(projects: WorkspaceProjects, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
	response.setHeader('Cache-Control', 'no-store');
	if (request.method !== 'PUT') { response.writeHead(405, { Allow: 'PUT' }).end(); return; }
	let target: string;
	try { target = decodeCartridgeTarget(decodeURIComponent(url.pathname.slice('/__bmsx__/projects/'.length))); }
	catch (error) { response.writeHead(400).end(String(error)); return; }
	try {
		const project = await projects.createCartridge(target);
		response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(project));
	} catch (error) {
		response.writeHead((error as NodeJS.ErrnoException).code === 'EEXIST' ? 409 : 500).end(String(error));
	}
}

export const PROJECT_TOOLS = [{ name: 'studio_create_cartridge',
	description: 'Create a saved cartridge project from the workspace emptycart template. Name must be new; existing files are never overwritten. Copies authored entry and manifest, not editor recovery. Does not build, open a window, replace a runtime or save other drafts. Build the returned target with studio_build_cart, then open the published result from Studio Build Jobs.',
	inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false },
}] satisfies Tool[];
