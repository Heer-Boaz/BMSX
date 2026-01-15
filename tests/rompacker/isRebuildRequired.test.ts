import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRebuildRequired } from '../../scripts/rompacker/rompacker-core';

test('debug rebuild triggers when debug ROM is missing', async () => {
	const romname = '__rompacker_test_debug_missing__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);
	const distDebugPath = join(process.cwd(), 'dist', `${romname}.debug.rom`);

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(distDebugPath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(join(resPath, 'asset.txt'), 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(distReleasePath, 'release');

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: true });
		assert.equal(needsRebuild, true);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(distDebugPath, { force: true });
	}
});

test('non-debug rebuild skips when output is newer than inputs', async () => {
	const romname = '__rompacker_test_non_debug_up_to_date__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(join(resPath, 'asset.txt'), 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(distReleasePath, 'release');

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: false });
		assert.equal(needsRebuild, false);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
	}
});
