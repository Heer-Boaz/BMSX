import type { StudioHttpSession } from './http_session';
import { joinWorkspacePaths } from '../workspace/path';

/** Native file selection also works on HTTP LAN origins; no clipboard or File System Access permission required. */
function selectFiles(signal: AbortSignal): Promise<File[]> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.multiple = true;
		input.hidden = true;
		const release = () => { input.remove(); signal.removeEventListener('abort', abort); };
		const abort = () => { release(); reject(signal.reason); };
		input.addEventListener('change', () => { release(); resolve(Array.from(input.files!)); }, { once: true });
		input.addEventListener('cancel', () => { release(); resolve([]); }, { once: true });
		signal.addEventListener('abort', abort, { once: true });
		document.body.append(input);
		input.click();
	});
}

/** File bodies stay native Blobs: no base64, text decoding or whole-file JavaScript copies. */
export async function importWorkspaceFiles(session: StudioHttpSession, directory: string, signal: AbortSignal): Promise<readonly string[]> {
	const files = await selectFiles(signal);
	const imported: string[] = [];
	for (const file of files) {
		const path = joinWorkspacePaths(directory, file.name);
		try {
			const response = await session.request(`/__bmsx__/files?path=${encodeURIComponent(path)}`, {
				method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'If-None-Match': '*' }, body: file, signal,
			});
			if (!response.ok) throw new Error(await response.text());
			imported.push(path);
		} catch (error) {
			throw new Error(`Import stopped at ${file.name}: ${error instanceof Error ? error.message : String(error)}\n${imported.length} file(s) confirmed imported into ${directory}. Check that folder before retrying; written files are kept.`, { cause: error });
		}
	}
	return imported;
}
