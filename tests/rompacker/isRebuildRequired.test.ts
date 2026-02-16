import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isRebuildRequired } from '../../scripts/rompacker/rombuilder';

test('debug rebuild triggers when debug ROM is missing', async () => {
	const romname = '__rompacker_test_debug_missing__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);
	const distDebugPath = join(process.cwd(), 'dist', `${romname}.debug.rom`);
	const biosDebugPath = join(process.cwd(), 'dist', `${romname}.bios.debug.rom`);

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(distDebugPath, { force: true });
		await rm(biosDebugPath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(join(resPath, 'asset.txt'), 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(distReleasePath, 'release');
		await writeFile(biosDebugPath, 'bios');

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: true, biosRomFilePath: biosDebugPath });
		assert.equal(needsRebuild, true);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(distDebugPath, { force: true });
		await rm(biosDebugPath, { force: true });
	}
});

test('non-debug rebuild skips when output is newer than inputs', async () => {
	const romname = '__rompacker_test_non_debug_up_to_date__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const assetPath = join(resPath, 'asset.txt');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);
	const biosPath = join(process.cwd(), 'dist', `${romname}.bios.rom`);

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(assetPath, 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(biosPath, 'bios');
		await writeFile(distReleasePath, 'release');

		const now = Date.now();
		await utimes(assetPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(biosPath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(distReleasePath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: false, biosRomFilePath: biosPath });
		assert.equal(needsRebuild, false);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });
	}
});

test('cart rebuild triggers when BIOS ROM is newer than game ROM', async () => {
	const romname = '__rompacker_test_bios_newer__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const assetPath = join(resPath, 'asset.txt');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);
	const biosPath = join(process.cwd(), 'dist', `${romname}.bios.rom`);

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(assetPath, 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(distReleasePath, 'release');
		await writeFile(biosPath, 'bios');

		const now = Date.now();
		await utimes(assetPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(distReleasePath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(biosPath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: false, biosRomFilePath: biosPath });
		assert.equal(needsRebuild, true);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });
	}
});

test('cart rebuild triggers when cart-root file is newer than game ROM', async () => {
	const romname = '__rompacker_test_cart_root_file_newer__';
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	const resPath = join(cartRoot, 'res');
	const assetPath = join(resPath, 'asset.txt');
	const distReleasePath = join(process.cwd(), 'dist', `${romname}.rom`);
	const biosPath = join(process.cwd(), 'dist', `${romname}.bios.rom`);
	const cartRootAssetPath = join(cartRoot, 'new-resource.bin');

	try {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });

		await mkdir(resPath, { recursive: true });
		await writeFile(assetPath, 'asset');

		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
		await writeFile(biosPath, 'bios');
		await writeFile(distReleasePath, 'release');
		await writeFile(cartRootAssetPath, 'new-resource');

		const now = Date.now();
		await utimes(assetPath, new Date(now - 5_000), new Date(now - 5_000));
		await utimes(biosPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(distReleasePath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(cartRootAssetPath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(romname, cartRoot, resPath, { debug: false, extraLuaPaths: [cartRoot], biosRomFilePath: biosPath });
		assert.equal(needsRebuild, true);
	} finally {
		await rm(cartRoot, { recursive: true, force: true });
		await rm(distReleasePath, { force: true });
		await rm(biosPath, { force: true });
	}
});
