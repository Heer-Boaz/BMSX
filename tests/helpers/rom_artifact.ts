import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RomArtifact, RomBuildUnit } from '../../toolchain/ts/rompack/build_manifest';
import { RomArtifactStore, romBuildKey } from '../../scripts/rompacker/artifacts';

/** Small opaque outputs exercise store ownership independently of guest compilation. */
export async function publishArtifact(store: RomArtifactStore, version: number, target = 'test', unshared = false): Promise<RomArtifact> {
	const source = Buffer.from(`cartridge ${target} ${version}`), system = Buffer.from('identical BIOS bytes');
	const unit = (domain: 'system' | 'cart', name: string, file: string, bytes: Buffer): RomBuildUnit => ({ name,
		key: romBuildKey([domain, name, bytes.toString()]), recipe: { domain, debug: true, optLevel: 0, projectRoot: name, toolchain: 'test' },
		inputs: romBuildKey(bytes.toString()), outputs: [{ file, digest: createHash('sha256').update(bytes).digest('hex') }] });
	const contents = { target, system: unit('system', 'system', 'system/bios.rom', system), cart: unit('cart', target, `${target}.rom`, source) };
	const artifact = { id: romBuildKey(contents), ...contents }, stage = store.staging(randomUUID());
	await mkdir(join(stage, 'system'), { recursive: true });
	await writeFile(join(stage, 'system/bios.rom'), system); await writeFile(join(stage, `${target}.rom`), source);
	if (unshared) {
		await mkdir(join(store.root, 'artifacts'), { recursive: true });
		await writeFile(join(stage, 'artifact.json'), JSON.stringify(artifact)); await rename(stage, store.directory(artifact.id));
	} else await store.withSharedAccess(() => store.publish(stage, artifact));
	const path = join(store.directory(artifact.id), 'artifact.json');
	await utimes(path, new Date(version * 1000), new Date(version * 1000));
	return artifact;
}
