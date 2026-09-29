import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RomBuildRecord } from './build_state';

export type RomBuildUnit = RomBuildRecord & { key: string; name: string };
export type RomArtifact = { id: string; target: string; system: RomBuildUnit; cart?: RomBuildUnit };
export type PreparedRomArtifact = { artifact: RomArtifact; reused: boolean };

export function romBuildKey(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Immutable bundles commit by directory rename. Mutable exports are never the publication catalog. */
export class RomArtifactStore {
	public constructor(public readonly root: string) {}
	public directory(id: string): string { return join(this.root, 'artifacts', id); }
	public staging(id: string): string { return join(this.root, 'staging', id); }

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
		await writeFile(join(stage, 'artifact.json'), JSON.stringify(artifact));
		try { await rename(stage, this.directory(artifact.id)); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' && (error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			await rm(stage, { recursive: true }); // Concurrent publication of the identical content-addressed bundle.
		}
		await mkdir(join(this.root, 'actions'), { recursive: true });
		for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart]) {
			const path = join(this.root, 'actions', unit.key), temporary = `${path}.${randomUUID()}`;
			await writeFile(temporary, artifact.id);
			await rename(temporary, path);
		}
	}

	public async export(artifact: RomArtifact, outputDirectory: string): Promise<void> {
		await mkdir(outputDirectory, { recursive: true });
		for (const unit of artifact.cart === undefined ? [artifact.system] : [artifact.system, artifact.cart]) {
			for (const output of unit.outputs) {
				const destination = join(outputDirectory, output.file);
				try { if (await this.digest(destination) === output.digest) continue; }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
				const temporary = `${destination}.${randomUUID()}.tmp`;
				await copyFile(join(this.directory(artifact.id), output.file), temporary);
				await rename(temporary, destination);
			}
		}
	}

	private async digest(path: string): Promise<string> {
		const hash = createHash('sha256');
		for await (const part of createReadStream(path)) hash.update(part);
		return hash.digest('hex');
	}
}
