import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { RomArtifactStore } from '../../scripts/rompacker/artifacts';
import { afterTest } from '../helpers/test_cleanup';

import { parseCartHeader, type CartRomHeader } from '../../machine/ts/rompack/format';
import {
	assertCartridgePackageFitsHardware,
	parseCartridgePackage,
} from '../../machine/ts/rompack/image';
import type { CartManifest } from '../../machine/ts/rompack/manifest';
import { CART_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { CART_PACKAGE_MAX_BYTE_COUNT, CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import type { RomAsset } from '../../toolchain/ts/rompack/assets';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { readBlua32BiosImports } from '../../toolchain/ts/rompack/blua32_bios_imports';
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	buildRomBlua32Tail,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';

const ROOT = join(process.cwd(), 'tmp', 'data-only-cartridge-test');
const EXECUTABLE_ROOT = join(process.cwd(), 'tmp', 'executable-without-rom-test');
const MANIFEST: CartManifest = {
	title: 'Data cartridge',
	hardware: [
		{ type: 'ram', bytes: 256 },
		{ type: 'mailbox' },
	],
};
const EMPTY_HEADER: CartRomHeader = {
	headerSize: CART_ROM_HEADER_SIZE,
	manifestOffset: 0,
	manifestLength: 0,
	tocOffset: 0,
	tocLength: 0,
	dataOffset: 0,
	dataLength: 0,
	blua32ImageOffset: 0,
	blua32ImageByteCount: 0,
	blua32StartupFunctionAddress: 0,
	blua32IrqFunctionAddress: 0,
	blua32ExceptionFunctionAddress: 0,
	blua32StaticLayoutTokenLo: 0,
	blua32StaticLayoutTokenHi: 0,
	blua32DiagnosticDirectoryOffset: 0,
	metadataOffset: 0,
	metadataLength: 0,
};

test('cartridge package bounds and executable metadata follow declared hardware', () => {
	assert.doesNotThrow(() => assertCartridgePackageFitsHardware(
		CART_ROM_SIZE + 1,
		EMPTY_HEADER,
		MANIFEST.hardware,
	));
	assert.throws(() => assertCartridgePackageFitsHardware(
		CART_ROM_SIZE + 1,
		EMPTY_HEADER,
		[{ type: 'rom' }],
	));
	assert.throws(() => assertCartridgePackageFitsHardware(
		CART_PACKAGE_MAX_BYTE_COUNT + 1,
		EMPTY_HEADER,
		MANIFEST.hardware,
	), /format limit/);
	assert.throws(() => assertCartridgePackageFitsHardware(
		CART_ROM_HEADER_SIZE,
		{ ...EMPTY_HEADER, blua32ImageOffset: CART_ROM_HEADER_SIZE },
		MANIFEST.hardware,
	), /requires an installed ROM device/);
});

test('the CLI publishes external source-free resources as a cartridge even when named system', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-external-data-cart-'));
	afterTest(t, () => rm(root, { recursive: true, force: true }));
	const resourceRoot = join(root, 'res');
	const outputRoot = join(root, 'output');
	const store = new RomArtifactStore(join(root, 'store'));
	await mkdir(resourceRoot);
	await writeFile(join(resourceRoot, 'manifest.rommanifest'),
		'title: External data probe\nhardware:\n    - type: ram\n      bytes: 256\n    - type: mailbox\n');
	const probeBytes = Buffer.from('external-probe');
	await writeFile(join(resourceRoot, 'probe.bin'), probeBytes);
	const result = spawnSync(process.execPath, [
		'--import', 'tsx', 'scripts/rompacker/rompacker.ts', '--mode', 'rompack',
		'-romname', 'system', '-respath', resourceRoot,
		'--output-dir', outputRoot, '--store-dir', store.root,
	], { encoding: 'utf8' });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const packageBytes = await readFile(join(outputRoot, 'system.rom'));
	const image = parseCartridgePackage(packageBytes);
	assert.deepEqual(image.manifest.hardware, MANIFEST.hardware);
	assert.equal(image.header.blua32ImageByteCount, 0);
	const index = await parseCartridgeIndex(packageBytes);
	assert.deepEqual(index.entries.map(entry => [entry.type, entry.resid]), [['bin', 'probe']]);
	const [probe] = index.entries;
	assert.deepEqual(packageBytes.subarray(probe.start!, probe.end!), probeBytes);

	const artifact = (await store.list()).find(artifact => artifact.target === 'system');
	assert.ok(artifact?.cart);
	for (const unit of [artifact.system, artifact.cart]) for (const output of unit.outputs) {
		const published = await readFile(join(store.directory(artifact.id), output.file));
		assert.equal(createHash('sha256').update(published).digest('hex'), output.digest);
		assert.deepEqual(await readFile(join(outputRoot, output.file)), published);
	}
});

test('the CLI links a debug cartridge named bmsx-bios to a separate BIOS ROM', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-external-source-cart-'));
	afterTest(t, () => rm(root, { recursive: true, force: true }));
	const resourceRoot = join(root, 'res');
	const outputRoot = join(root, 'output');
	await mkdir(resourceRoot);
	await writeFile(join(resourceRoot, 'manifest.rommanifest'), 'title: External source probe\nhardware:\n    - type: rom\n');
	await writeFile(join(root, 'entry.lua'), 'module<entry>\nreturn 1\n');
	const result = spawnSync(process.execPath, [
		'--import', 'tsx', 'scripts/rompacker/rompacker.ts', '--mode', 'rompack', '--debug',
		'-romname', 'bmsx-bios', '-respath', resourceRoot,
		'--output-dir', outputRoot, '--store-dir', join(root, 'store'),
	], { encoding: 'utf8' });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	const filename = 'bmsx-bios.debug.rom';
	const cart = parseCartridgePackage(await readFile(join(outputRoot, filename)));
	assert.ok(cart.header.blua32ImageByteCount > 0);
	const systemRom = await readFile(join(outputRoot, 'system', filename));
	assert.equal(readBlua32BiosImports(systemRom).functions.length, 4);
	assert.deepEqual(await readdir(join(outputRoot, 'system')), [filename]);
});

test('package producer emits a source-free hardware cartridge without a BLua32 tail', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		const data = Buffer.from([0x11, 0x22, 0x33]);
		const assets: RomAsset[] = [{
			type: 'data',
			resid: 'payload',
			buffer: data,
		}];
		const layout = layoutRomPrefix(assets, true, MANIFEST);
		await finalizeRompack('data-only', {
			debug: true,
			blua32: null,
			layout,
			outputDirectory: ROOT,
		});

		const rom = await readFile(join(ROOT, 'data-only.debug.rom'));
		const header = parseCartHeader(rom);
		assert.equal(header.blua32ImageOffset, 0);
		assert.equal(header.blua32ImageByteCount, 0);
		assert.equal(header.blua32StartupFunctionAddress, 0);
		assert.equal(header.blua32IrqFunctionAddress, 0);
		assert.equal(header.blua32ExceptionFunctionAddress, 0);
		assert.equal(header.blua32StaticLayoutTokenLo, 0);
		assert.equal(header.blua32StaticLayoutTokenHi, 0);
		assert.equal(header.blua32DiagnosticDirectoryOffset, 0);

		const image = parseCartridgePackage(rom);
		assert.deepEqual(image.manifest, MANIFEST);
		const contradictory = Uint8Array.from(rom);
		writeCartRomHeader(contradictory, {
			...header,
			blua32ImageOffset: CART_ROM_HEADER_SIZE,
		});
		assert.throws(
			() => parseCartridgePackage(contradictory),
			/requires an installed ROM device/,
		);
		const index = await parseCartridgeIndex(rom);
		assert.equal(index.entries.some(entry => entry.type === 'code'), false);
		const payload = index.entries.find(entry => entry.resid === 'payload')!;
		assert.deepEqual(rom.subarray(payload.start!, payload.end!), data);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});

test('package producer rejects BLua32 program metadata without a ROM device', async () => {
	await rm(EXECUTABLE_ROOT, { recursive: true, force: true });
	try {
		const source = 'module<entry>\nreturn 1';
		const assets: RomAsset[] = [{
			type: 'lua',
			resid: 'entry',
			buffer: Buffer.from(source),
			program_module: true,
			source_path: 'entry.lua',
		}];
		const layout = layoutRomPrefix(assets, false, MANIFEST);
		const blua32 = buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
			includeDiagnostics: false,
			includeSymbols: false,
			optLevel: 3,
			imageOffset: layout.nextOffset,
			ramByteCount: 0x00400000,
			domain: 'cart',
			biosImports: {
				cartridgeStaticRamBase: 0,
				functions: [],
			},
		});
		await assert.rejects(
			finalizeRompack('executable-without-rom', {
				debug: false,
				blua32,
				layout,
				outputDirectory: EXECUTABLE_ROOT,
			}),
			/requires an installed ROM device/,
		);
	} finally {
		await rm(EXECUTABLE_ROOT, { recursive: true, force: true });
	}
});

test('a cart with Lua source still requires a module entry', () => {
	const source = 'return 1';
	assert.throws(
		() => buildRomBlua32Tail([{
			type: 'lua',
			resid: 'module',
			buffer: Buffer.from(source),
			program_module: true,
			source_path: 'module.lua',
		}], {
			generatedLuaModules: [],
			includeDiagnostics: false,
			includeSymbols: false,
			optLevel: 3,
			imageOffset: 0x100,
			ramByteCount: 0x00400000,
			domain: 'cart',
			biosImports: {
				cartridgeStaticRamBase: 0,
				functions: [],
			},
		}),
		/module<entry>/,
	);
});
