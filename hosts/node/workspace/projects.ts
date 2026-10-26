import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { load, dump } from 'js-yaml';
import type { StudioCartridgeProject, StudioProjectAdmission, StudioSourceContext } from '../../common/studio_projects';
import { resolveRootedPath } from '../../../scripts/dev/rooted_path.mjs';

/** Canonical project creation. Builds and opening a machine are separate explicit operations. */
export class WorkspaceProjects {
	private readonly database: DatabaseSync;
	private readonly readSystem: StatementSync;
	private readonly readCartridge: StatementSync;
	private readonly writeContext: StatementSync;
	private readonly selectSystem: StatementSync;
	private readonly selectCartridge: StatementSync;
	private readonly readTargets: StatementSync;
	private readonly creations = new Set<Promise<StudioCartridgeProject>>();
	private closing: Promise<void> | undefined;

	public constructor(private readonly root: string, stateDirectory: string) {
		mkdirSync(stateDirectory, { recursive: true });
		this.database = new DatabaseSync(join(stateDirectory, 'source-contexts.sqlite'));
		try {
			this.database.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
				CREATE TABLE IF NOT EXISTS source_contexts(id TEXT PRIMARY KEY, project_root TEXT NOT NULL);
				CREATE TABLE IF NOT EXISTS system_selection(singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
					context_id TEXT NOT NULL REFERENCES source_contexts(id));
				CREATE TABLE IF NOT EXISTS cartridge_selections(target TEXT PRIMARY KEY,
					context_id TEXT NOT NULL REFERENCES source_contexts(id));`);
			this.readSystem = this.database.prepare('SELECT c.id, c.project_root AS projectRoot FROM system_selection s JOIN source_contexts c ON c.id = s.context_id WHERE s.singleton = 1');
			this.readCartridge = this.database.prepare('SELECT c.id, c.project_root AS projectRoot FROM cartridge_selections s JOIN source_contexts c ON c.id = s.context_id WHERE s.target = ?');
			this.writeContext = this.database.prepare('INSERT INTO source_contexts(id, project_root) VALUES (?, ?)');
			this.selectSystem = this.database.prepare('INSERT INTO system_selection(singleton, context_id) VALUES (1, ?)');
			this.selectCartridge = this.database.prepare('INSERT INTO cartridge_selections(target, context_id) VALUES (?, ?)');
			this.readTargets = this.database.prepare('SELECT target FROM cartridge_selections');
		} catch (error) { this.database.close(); throw error; }
	}

	/** Listing source projects does not admit contexts or assign identities. */
	public async targets(): Promise<string[]> {
		const selected = this.readTargets.all();
		const entries = await readdir(join(this.root, 'carts'), { withFileTypes: true });
		const targets = new Set(entries.filter(entry => entry.isDirectory() && /^[a-z0-9_-]+$/.test(entry.name)).map(entry => entry.name));
		for (const row of selected) targets.add(row.target as string);
		return [...targets].sort();
	}

	/** Admit the selected project's source identity independently of its code or build configuration. */
	public async resolveCartridge(target: string): Promise<StudioProjectAdmission> {
		this.database.exec('BEGIN IMMEDIATE');
		try {
			const selectedSystem = this.readSystem.get();
			const system: StudioSourceContext = selectedSystem === undefined
				? { id: randomUUID(), projectRoot: 'machine/bios' }
				: { id: selectedSystem.id as string, projectRoot: selectedSystem.projectRoot as string };
			if (selectedSystem === undefined) {
				this.writeContext.run(system.id, system.projectRoot);
				this.selectSystem.run(system.id);
			}
			const selectedCartridge = this.readCartridge.get(target);
			const cartridge: StudioSourceContext = selectedCartridge === undefined
				? { id: randomUUID(), projectRoot: `carts/${target}` }
				: { id: selectedCartridge.id as string, projectRoot: selectedCartridge.projectRoot as string };
			if (selectedCartridge === undefined) {
				this.writeContext.run(cartridge.id, cartridge.projectRoot);
				this.selectCartridge.run(target, cartridge.id);
			}
			this.database.exec('COMMIT');
			return { target, system, cartridge };
		} catch (error) { this.database.exec('ROLLBACK'); throw error; }
	}

	public close(): Promise<void> {
		if (this.closing === undefined) {
			this.closing = Promise.allSettled(this.creations).then(() => { this.database.close(); });
		}
		return this.closing;
	}

	public createCartridge(target: string): Promise<StudioCartridgeProject> {
		if (this.closing !== undefined) return Promise.reject(new Error('Workspace projects are closing'));
		const operation = this.createCartridgeFiles(target);
		this.creations.add(operation);
		void operation.then(() => { this.creations.delete(operation); }, () => { this.creations.delete(operation); });
		return operation;
	}

	private async createCartridgeFiles(target: string): Promise<StudioCartridgeProject> {
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
		const admission = await this.resolveCartridge(target);
		return { target, projectRoot, entryPath: `${projectRoot}/entry.lua`, sourceContextId: admission.cartridge.id };
	}
}
