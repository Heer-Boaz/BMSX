import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioConfiguration } from '../../ide/common/studio_configuration';
import { renderStudioPage, STUDIO_PAGES } from '../products/studio_page';
import { resolveRootedPath } from './rooted_path.mjs';

export const STUDIO_PAGE_ROUTES: ReadonlyMap<string, string> = new Map(STUDIO_PAGES.map(page => [`/${page.page}`, page.template]));

/** Application pages are rendered here; arbitrary static HTML is never rewritten. */
export async function serveStudioPage(
	root: string, templateFilename: string, configuration: StudioConfiguration,
	request: IncomingMessage, response: ServerResponse,
): Promise<void> {
	const file = await open(await resolveRootedPath(root, templateFilename), constants.O_RDONLY | constants.O_NOFOLLOW);
	let template: string;
	try { template = await file.readFile('utf8'); } finally { await file.close(); }
	const html = renderStudioPage(template, configuration);
	response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store' });
	response.end(request.method === 'HEAD' ? undefined : html);
}
