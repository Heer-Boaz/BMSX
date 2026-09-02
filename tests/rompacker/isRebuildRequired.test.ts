import assert from 'node:assert/strict';
import { mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { isRebuildRequired } from '../../scripts/rompacker/rombuilder';
import { GX_GENERATED_MODULE_BUILD_SOURCE_FILES } from '../../toolchain/ts/rompack/generated_modules';

type RebuildFixture = {
	readonly romname: string;
	readonly cartRoot: string;
	readonly resPath: string;
	readonly assetPath: string;
	readonly distReleasePath: string;
	readonly distDebugPath: string;
	readonly biosPath: string;
	readonly biosDebugPath: string;
};

function createRebuildFixture(romname: string): RebuildFixture {
	const cartRoot = join(process.cwd(), 'src', 'carts', romname);
	return {
		romname,
		cartRoot,
		resPath: join(cartRoot, 'res'),
		assetPath: join(cartRoot, 'res', 'asset.txt'),
		distReleasePath: join(process.cwd(), 'dist', `${romname}.rom`),
		distDebugPath: join(process.cwd(), 'dist', `${romname}.debug.rom`),
		biosPath: join(process.cwd(), 'dist', `${romname}.bios.rom`),
		biosDebugPath: join(process.cwd(), 'dist', `${romname}.bios.debug.rom`),
	};
}

async function removeRebuildFixture(fixture: RebuildFixture): Promise<void> {
	await rm(fixture.cartRoot, { recursive: true, force: true });
	await rm(fixture.distReleasePath, { force: true });
	await rm(fixture.distDebugPath, { force: true });
	await rm(fixture.biosPath, { force: true });
	await rm(fixture.biosDebugPath, { force: true });
}

async function withRebuildFixture(romname: string, run: (fixture: RebuildFixture) => Promise<void>): Promise<void> {
	const fixture = createRebuildFixture(romname);
	try {
		await removeRebuildFixture(fixture);
		await run(fixture);
	} finally {
		await removeRebuildFixture(fixture);
	}
}

async function writeBaseCartOutput(fixture: RebuildFixture, biosPath = fixture.biosPath): Promise<void> {
	await mkdir(fixture.resPath, { recursive: true });
	await writeFile(fixture.assetPath, 'asset');
	await mkdir(join(process.cwd(), 'dist'), { recursive: true });
	await writeFile(biosPath, 'bios');
	await writeFile(fixture.distReleasePath, 'release');
}

test('debug rebuild triggers when debug ROM is missing', async () => {
	await withRebuildFixture('__rompacker_test_debug_missing__', async fixture => {
		await writeBaseCartOutput(fixture, fixture.biosDebugPath);

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: true,
			biosImportsFilePath: fixture.biosDebugPath,
		});
		assert.equal(needsRebuild, true);
	});
});

test('non-debug rebuild skips when output is newer than inputs', async () => {
	await withRebuildFixture('__rompacker_test_non_debug_up_to_date__', async fixture => {
		await writeBaseCartOutput(fixture);

		const now = Date.now();
		await utimes(fixture.assetPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(fixture.biosPath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(fixture.distReleasePath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: false,
			biosImportsFilePath: fixture.biosPath,
		});
		assert.equal(needsRebuild, false);
	});
});

test('cart rebuild triggers when the BIOS import library is newer than the game ROM', async () => {
	await withRebuildFixture('__rompacker_test_bios_newer__', async fixture => {
		await writeBaseCartOutput(fixture);

		const now = Date.now();
		await utimes(fixture.assetPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(fixture.distReleasePath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(fixture.biosPath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: false,
			biosImportsFilePath: fixture.biosPath,
		});
		assert.equal(needsRebuild, true);
	});
});

test('cart rebuild triggers when cart-root file is newer than game ROM', async () => {
	await withRebuildFixture('__rompacker_test_cart_root_file_newer__', async fixture => {
		const cartRootAssetPath = join(fixture.cartRoot, 'new-resource.bin');
		await writeBaseCartOutput(fixture);
		await writeFile(cartRootAssetPath, 'new-resource');

		const now = Date.now();
		await utimes(fixture.assetPath, new Date(now - 5_000), new Date(now - 5_000));
		await utimes(fixture.biosPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(fixture.distReleasePath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(cartRootAssetPath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: false,
			extraLuaPaths: [fixture.cartRoot],
			biosImportsFilePath: fixture.biosPath,
		});
		assert.equal(needsRebuild, true);
	});
});

test('cart rebuild tracks every generated GX contract input', async () => {
	await withRebuildFixture('__rompacker_test_gx_contract_input__', async fixture => {
		assert.deepEqual(GX_GENERATED_MODULE_BUILD_SOURCE_FILES, [
			'./machine/ts/spec/gx/display_presets.ts',
			'./machine/ts/spec/gx/gp0.ts',
			'./machine/ts/spec/gx/gp1.ts',
			'./machine/ts/spec/gx/pcrtc.ts',
			'./toolchain/ts/rompack/generated_modules.ts',
			'./toolchain/ts/rompack/gx_display_preset_module.ts',
			'./toolchain/ts/rompack/gx_register_module.ts',
		]);
		await writeBaseCartOutput(fixture);
		let newestInputMtimeMs = 0;
		for (const path of GX_GENERATED_MODULE_BUILD_SOURCE_FILES) {
			const input = await stat(path);
			if (input.mtimeMs > newestInputMtimeMs) newestInputMtimeMs = input.mtimeMs;
		}
		await utimes(fixture.assetPath, new Date(newestInputMtimeMs - 4_000), new Date(newestInputMtimeMs - 4_000));
		await utimes(fixture.biosPath, new Date(newestInputMtimeMs - 3_000), new Date(newestInputMtimeMs - 3_000));
		await utimes(fixture.distReleasePath, new Date(newestInputMtimeMs - 2_000), new Date(newestInputMtimeMs - 2_000));

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: false,
			buildSourceFiles: GX_GENERATED_MODULE_BUILD_SOURCE_FILES,
			biosImportsFilePath: fixture.biosPath,
		});
		assert.equal(needsRebuild, true);
	});
});

test('cart rebuild ignores newer files under _ignore', async () => {
	await withRebuildFixture('__rompacker_test_cart_root_ignore_newer__', async fixture => {
		const ignoredAssetPath = join(fixture.cartRoot, '_ignore', 'new-resource.bin');
		await writeBaseCartOutput(fixture);
		await mkdir(join(fixture.cartRoot, '_ignore'), { recursive: true });
		await writeFile(ignoredAssetPath, 'ignored');

		const now = Date.now();
		await utimes(fixture.assetPath, new Date(now - 5_000), new Date(now - 5_000));
		await utimes(fixture.biosPath, new Date(now - 4_000), new Date(now - 4_000));
		await utimes(fixture.distReleasePath, new Date(now - 3_000), new Date(now - 3_000));
		await utimes(ignoredAssetPath, new Date(now - 2_000), new Date(now - 2_000));

		const needsRebuild = await isRebuildRequired(fixture.romname, fixture.resPath, {
			domain: 'cart',
			debug: false,
			extraLuaPaths: [fixture.cartRoot],
			biosImportsFilePath: fixture.biosPath,
		});
		assert.equal(needsRebuild, false);
	});
});
