import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { getResMetaList } from '../../scripts/rompacker/rombuilder';

const ROOT = join(process.cwd(), 'tmp', 'rompacker-bin-scan-test');

test('resource scan treats glTF buffer URIs as model-owned and keeps other .bin files as raw assets', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(join(ROOT, 'data'), { recursive: true });
		await mkdir(join(ROOT, 'models'), { recursive: true });
		await mkdir(join(ROOT, 'raw'), { recursive: true });
		await writeFile(join(ROOT, 'data', 'tiles.bin'), Buffer.from([1, 2, 3, 4]));
		await writeFile(join(ROOT, 'raw', 'scripted.bin'), Buffer.from([9, 10, 11, 12]));
		await writeFile(join(ROOT, 'models', 'mesh.bin'), Buffer.from([5, 6, 7, 8]));
		await writeFile(join(ROOT, 'models', 'mesh.gltf'), JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 4 }] }));

		const resources = await getResMetaList([ROOT]);
		const binResources = resources.filter(resource => resource.type === 'bin');

		assert.deepEqual(binResources.map(resource => resource.name).sort(), ['scripted', 'tiles']);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
