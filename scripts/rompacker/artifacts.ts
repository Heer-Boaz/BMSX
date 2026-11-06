import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { RomArtifact } from '../../toolchain/ts/rompack/build_manifest';
import { withArtifactStoreLock } from './artifact_lock';

export type PreparedRomArtifact = { artifact: RomArtifact; reused: boolean };
export const RECENT_ROM_ARTIFACTS = 50;
export type ArtifactDeduplication = { artifacts: number; files: number; uniqueFiles: number; storedBytes: number; uniqueBytes: number; linkedFiles: number };
export type ArtifactCollection = { retained: number; removed: string[]; removedBlobs: number; reclaimedBlobBytes: number };
type ArtifactEntry = { artifact: RomArtifact; published: number };

export function romBuildKey(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Immutable bundles commit by directory rename. Mutable exports are never the publication catalog. */
export class RomArtifactStore {
	public constructor(public readonly root: string) {}
	public directory(id: string): string { return join(this.root, 'artifacts', id); }
	public staging(id: string): string { return join(this.root, 'staging', id); }
	public withSharedAccess<T>(operation: () => Promise<T>): Promise<T> { return withArtifactStoreLock(this.root, 'shared', operation); }

	/** References are owned lifetimes, not inferred from filenames or source text. */
	public async retain(owner: string, artifact: string): Promise<void> {
		await this.publishReference(join(this.root, 'refs', owner), artifact);
	}
	public async release(owner: string): Promise<void> { await rm(join(this.root, 'refs', owner), { force: true }); }
	public async releaseReferences(owner: string): Promise<void> { await rm(join(this.root, 'refs', owner), { recursive: true, force: true }); }

	public async read(id: string): Promise<RomArtifact> {
		return JSON.parse(await readFile(join(this.directory(id), 'artifact.json'), 'utf8'));
	}

	public async find(key: string): Promise<RomArtifact | undefined> {
		let id: string;
		try { id = await readFile(join(this.root, 'actions', key), 'utf8'); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
		// Only publish() creates catalog entries. Immutable results are consumed directly,
		// not rehashed on every local cache hit. Writable exports have a separate owner.
		return this.read(id);
	}

	public async publish(stage: string, artifact: RomArtifact): Promise<void> {
		await mkdir(join(this.root, 'artifacts'), { recursive: true });
		await mkdir(join(this.root, 'blobs'), { recursive: true });
		for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart])
			for (const output of unit.outputs) await this.internOutput(join(stage, output.file), output.digest);
		await writeFile(join(stage, 'artifact.json'), JSON.stringify(artifact));
		await chmod(join(stage, 'artifact.json'), 0o444 & ~process.umask());
		try { await rename(stage, this.directory(artifact.id)); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			await rm(stage, { recursive: true }); // Concurrent publication of the identical content-addressed bundle.
		}
		for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart]) {
			await this.publishReference(join(this.root, 'actions', unit.key), artifact.id);
		}
	}

	public async export(artifact: RomArtifact, outputDirectory: string, include: (file: string) => boolean = () => true): Promise<void> {
		for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart]) {
			for (const output of unit.outputs) {
				if (!include(output.file)) continue;
				const destination = join(outputDirectory, output.file);
				try { if (await this.digest(destination) === output.digest) continue; }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
				await mkdir(dirname(destination), { recursive: true });
				const temporary = `${destination}.${randomUUID()}.tmp`;
				try {
					await copyFile(join(this.directory(artifact.id), output.file), temporary);
					await chmod(temporary, 0o666 & ~process.umask()); // Exports are mutable files, never aliases of immutable store content.
					await rename(temporary, destination);
				} finally { await rm(temporary, { force: true }); }
			}
		}
	}

	public async retainExport(artifact: RomArtifact, outputDirectory: string): Promise<void> {
		const unit = artifact.cart ?? artifact.system;
		await this.retain(`exports/${romBuildKey([resolve(outputDirectory), artifact.target, unit.recipe.debug])}`, artifact.id);
	}

	/** Admit pre-existing mutable exports by their complete media bytes, not their names alone. */
	public async retainExistingExports(outputDirectory: string, apply: boolean): Promise<string[]> {
		const entries = await this.entries(), selected = new Set<string>(), retained: string[] = [];
		entries.sort((a, b) => b.published - a.published || a.artifact.id.localeCompare(b.artifact.id));
		const digests = new Map<string, Promise<string | undefined>>();
		for (const { artifact } of entries) {
			const unit = artifact.cart ?? artifact.system;
			const owner = romBuildKey([resolve(outputDirectory), artifact.target, unit.recipe.debug]);
			if (selected.has(owner)) continue;
			const output = unit.outputs.find(output => output.file.endsWith('.rom'))!, path = join(outputDirectory, output.file);
			let digest = digests.get(path);
			if (digest === undefined) {
				digest = this.digest(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
				digests.set(path, digest);
			}
			if (await digest !== output.digest) continue;
			selected.add(owner); retained.push(artifact.id);
			if (apply) await this.retain(`exports/${owner}`, artifact.id);
		}
		return retained;
	}

	/** Verify complete contents before replacing existing immutable files with shared inodes. */
	public deduplicate(apply: boolean): Promise<ArtifactDeduplication> {
		return withArtifactStoreLock(this.root, apply ? 'exclusive' : 'shared', async () => {
			const artifacts = await this.entries(), files: { path: string; digest: string }[] = [];
			const inodes = new Map<string, { digest: string; bytes: number }>(), contents = new Map<string, number>();
			for (const { artifact } of artifacts) for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart]) {
				for (const output of unit.outputs) {
					const path = join(this.directory(artifact.id), output.file), metadata = await stat(path);
					const inode = `${metadata.dev}:${metadata.ino}`;
					let content = inodes.get(inode);
					if (content === undefined) {
						content = { digest: await this.digest(path), bytes: metadata.size }; inodes.set(inode, content);
					}
					if (content.digest !== output.digest) throw new Error(`Artifact content differs from its receipt: ${path}`);
					contents.set(content.digest, content.bytes); files.push({ path, digest: content.digest });
				}
			}
			let linkedFiles = 0;
			for (const entry of await this.directoryEntries(join(this.root, 'blobs'))) if (contents.has(entry.name)) {
				const path = join(this.root, 'blobs', entry.name), metadata = await stat(path);
				const known = inodes.get(`${metadata.dev}:${metadata.ino}`);
				if ((known === undefined ? await this.digest(path) : known.digest) !== entry.name)
					throw new Error(`Shared artifact content differs from its digest: ${path}`);
			}
			if (apply) {
				await mkdir(join(this.root, 'blobs'), { recursive: true });
				await mkdir(join(this.root, 'staging'), { recursive: true });
				for (const file of files) if (await this.internOutput(file.path, file.digest)) linkedFiles++;
			}
			return { artifacts: artifacts.length, files: files.length, uniqueFiles: contents.size,
				storedBytes: [...inodes.values()].reduce((sum, content) => sum + content.bytes, 0),
				uniqueBytes: [...contents.values()].reduce((sum, bytes) => sum + bytes, 0), linkedFiles };
		});
	}

	/** Recent history, latest recipes and explicit live/publication roots own retention. */
	public collect(options: { keepRecent: number; apply: boolean; roots?: readonly string[]; retiredReferences?: readonly string[] }): Promise<ArtifactCollection> {
		return withArtifactStoreLock(this.root, 'exclusive', async () => {
			const entries = await this.entries();
			entries.sort((a, b) => b.published - a.published || a.artifact.id.localeCompare(b.artifact.id));
			const retained = new Set(entries.slice(0, options.keepRecent).map(entry => entry.artifact.id)), recipes = new Set<string>();
			if (options.roots !== undefined) for (const id of options.roots) retained.add(id);
			for (const { artifact } of entries) {
				const unit = artifact.cart ?? artifact.system, recipe = unit.recipe;
				const key = romBuildKey([artifact.target, recipe.domain, recipe.projectRoot, recipe.debug, recipe.optLevel]);
				if (!recipes.has(key)) { retained.add(artifact.id); recipes.add(key); }
			}
			const retired = new Set(options.retiredReferences);
			for (const entry of await this.directoryEntries(join(this.root, 'refs'))) {
				const path = join(this.root, 'refs', entry.name);
				if (retired.has(entry.name)) { if (options.apply) await rm(path, { recursive: true, force: true }); continue; }
				for (const reference of entry.isDirectory() ? await this.referenceFiles(path) : [path]) retained.add(await readFile(reference, 'utf8'));
			}
			const present = new Set(entries.map(entry => entry.artifact.id));
			for (const id of retained) if (!present.has(id)) throw new Error(`Retained artifact is missing: ${id}`);
			const removed: string[] = [];
			for (const { artifact } of entries) if (!retained.has(artifact.id)) {
				removed.push(artifact.id);
			}
			if (!options.apply) return { retained: retained.size, removed, removedBlobs: 0, reclaimedBlobBytes: 0 };
			const mappings = new Map<string, string>();
			for (const { artifact } of entries) if (retained.has(artifact.id))
				for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart])
					if (!mappings.has(unit.key)) mappings.set(unit.key, artifact.id);
			for (const path of await this.referenceFiles(join(this.root, 'actions'))) {
				const key = basename(path), previous = await readFile(path, 'utf8');
				const current = mappings.get(key);
				if (current === undefined) await rm(path);
				else if (!retained.has(previous)) await this.publishReference(path, current);
				mappings.delete(key);
			}
			for (const [key, artifact] of mappings) await this.publishReference(join(this.root, 'actions', key), artifact);
			// Unpublish only after the cache catalog no longer names these bundles.
			// A stopped collector can leave garbage in staging, never a half-removed artifact.
			await mkdir(join(this.root, 'staging'), { recursive: true });
			for (const id of removed) await rename(this.directory(id), this.staging(randomUUID()));
			// Exclusive access proves no cooperating producer still owns these stages.
			// Retire them before testing blob link counts, including interrupted publications.
			await rm(join(this.root, 'staging'), { recursive: true, force: true });
			let removedBlobs = 0, reclaimedBlobBytes = 0;
			for (const path of await this.referenceFiles(join(this.root, 'blobs'))) {
				const metadata = await stat(path);
				if (metadata.nlink === 1) { await rm(path); removedBlobs++; reclaimedBlobBytes += metadata.size; }
			}
			return { retained: retained.size, removed, removedBlobs, reclaimedBlobBytes };
		});
	}

	private async entries(): Promise<ArtifactEntry[]> {
		const entries: ArtifactEntry[] = [];
		for (const entry of await this.directoryEntries(join(this.root, 'artifacts'))) {
			const path = join(this.directory(entry.name), 'artifact.json');
			entries.push({ artifact: JSON.parse(await readFile(path, 'utf8')), published: (await stat(path)).mtimeMs });
		}
		return entries;
	}
	private async publishReference(path: string, artifact: string): Promise<void> {
		const temporary = this.staging(randomUUID());
		await mkdir(dirname(path), { recursive: true }); await mkdir(dirname(temporary), { recursive: true });
		try { await writeFile(temporary, artifact); await rename(temporary, path); }
		finally { await rm(temporary, { force: true }); }
	}
	private async directoryEntries(path: string) {
		try { return await readdir(path, { withFileTypes: true }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
	}
	private async referenceFiles(path: string): Promise<string[]> {
		const files: string[] = [];
		for (const entry of await this.directoryEntries(path)) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) files.push(...await this.referenceFiles(child)); else files.push(child);
		}
		return files;
	}
	private async internOutput(path: string, digest: string): Promise<boolean> {
		const blob = join(this.root, 'blobs', digest);
		await chmod(path, 0o444 & ~process.umask());
		try { await link(path, blob); return false; }
		catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
		const current = await stat(path), canonical = await stat(blob);
		if (current.dev === canonical.dev && current.ino === canonical.ino) return false;
		const temporary = this.staging(randomUUID());
		try { await link(blob, temporary); await rename(temporary, path); }
		finally { await rm(temporary, { force: true }); }
		return true;
	}

	private async digest(path: string): Promise<string> {
		const hash = createHash('sha256');
		for await (const part of createReadStream(path)) hash.update(part);
		return hash.digest('hex');
	}
}
