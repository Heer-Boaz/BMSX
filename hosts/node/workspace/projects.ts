import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load, dump } from 'js-yaml';
import type { StudioCartridgeProject } from '../../common/studio_projects';
import { resolveRootedPath } from '../../../scripts/dev/rooted_path.mjs';

/** Canonical project creation. Builds and opening a machine are separate explicit operations. */
export class WorkspaceProjects {
	public constructor(private readonly root: string) {}

	public async createCartridge(target: string): Promise<StudioCartridgeProject> {
		const projectRoot = `carts/${target}`;
		const destination = await resolveRootedPath(this.root, projectRoot);
		const [source, manifestText] = await Promise.all([
			readFile(await resolveRootedPath(this.root, 'carts/emptycart/entry.lua'), 'utf8'),
			readFile(await resolveRootedPath(this.root, 'carts/emptycart/res/manifest/manifest.rommanifest'), 'utf8'),
		]);
		const manifest = load(manifestText) as Record<string, unknown>;
		manifest.title = target;
		// Directory creation is exclusive. Existing projects (even empty ones) are never overwritten.
		await mkdir(destination);
		await mkdir(join(destination, 'res/manifest'), { recursive: true });
		await writeFile(join(destination, 'entry.lua'), source, { flag: 'wx' });
		await writeFile(join(destination, 'res/manifest/manifest.rommanifest'), dump(manifest), { flag: 'wx' });
		return { target, projectRoot, entryPath: `${projectRoot}/entry.lua` };
	}
}
