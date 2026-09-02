import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

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
import { layoutRomPrefix } from '../../toolchain/ts/rompack/rom_prefix_layout';
import {
	buildRomBlua32Tail,
	compileLuaChunkBuffer,
	finalizeRompack,
} from '../../scripts/rompacker/rombuilder';

const ROOT = join(process.cwd(), 'tmp', 'data-only-cartridge-test');
const CLI_ROOT = join(process.cwd(), 'tmp', 'data-only-cartridge-cli-test');
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

test('normal cart production admits source-free hardware without BIOS artifacts', async () => {
	await rm(CLI_ROOT, { recursive: true, force: true });
	try {
		const result = spawnSync(process.execPath, [
			'--import',
			'tsx',
			'scripts/rompacker/rompacker.ts',
			'--mode',
			'rompack',
			'--skiptypecheck',
			'-romname',
			'cartridge_data_conformance',
			'--output-dir',
			CLI_ROOT,
			'--force',
		], {
			cwd: process.cwd(),
			encoding: 'utf8',
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		const packageBytes = await readFile(join(
			CLI_ROOT,
			'cartridge_data_conformance.rom',
		));
		const packageImage = parseCartridgePackage(packageBytes);
		assert.deepEqual(packageImage.manifest.hardware, MANIFEST.hardware);
		assert.equal(packageImage.header.blua32ImageByteCount, 0);
	} finally {
		await rm(CLI_ROOT, { recursive: true, force: true });
	}
});

test('normal cart production discovers program source outside the BMSX worktree', async () => {
	const externalRoot = await mkdtemp(join(tmpdir(), 'bmsx-external-cart-'));
	try {
		const resourceRoot = join(externalRoot, 'res');
		await mkdir(join(resourceRoot, 'manifest'), { recursive: true });
		await writeFile(
			join(resourceRoot, 'manifest', 'manifest.rommanifest'),
			'title: External source probe\nhardware:\n    - type: rom\n',
		);
		await writeFile(join(externalRoot, 'entry.lua'), 'module<entry>\nreturn 1\n');
		const outputRoot = join(externalRoot, 'output');
		const result = spawnSync(process.execPath, [
			'--import',
			'tsx',
			'scripts/rompacker/rompacker.ts',
			'--mode',
			'rompack',
			'--skiptypecheck',
			'-romname',
			'external_source_probe',
			'-respath',
			resourceRoot,
			'--output-dir',
			outputRoot,
			'--force',
		], {
			cwd: process.cwd(),
			encoding: 'utf8',
		});
		assert.match(
			`${result.stdout}\n${result.stderr}`,
			/BIOS import library not found/,
		);
		await assert.rejects(readFile(join(outputRoot, 'external_source_probe.rom')));
	} finally {
		await rm(externalRoot, { recursive: true, force: true });
	}
});

test('normal cart production keeps external source-free resources cartridge-owned', async () => {
	const externalRoot = await mkdtemp(join(tmpdir(), 'bmsx-external-data-cart-'));
	try {
		const resourceRoot = join(externalRoot, 'res');
		await mkdir(join(resourceRoot, 'manifest'), { recursive: true });
		await writeFile(
			join(resourceRoot, 'manifest', 'manifest.rommanifest'),
			'title: External data probe\nhardware:\n    - type: ram\n      bytes: 256\n    - type: mailbox\n',
		);
		const probeBytes = Buffer.from('external-probe');
		await writeFile(join(resourceRoot, 'probe.bin'), probeBytes);
		const outputRoot = join(externalRoot, 'output');
		const result = spawnSync(process.execPath, [
			'--import',
			'tsx',
			'scripts/rompacker/rompacker.ts',
			'--mode',
			'rompack',
			'--skiptypecheck',
			'-romname',
			'external_data_probe',
			'-respath',
			resourceRoot,
			'--output-dir',
			outputRoot,
			'--force',
		], {
			cwd: process.cwd(),
			encoding: 'utf8',
		});
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		const packageBytes = await readFile(join(outputRoot, 'external_data_probe.rom'));
		const packageImage = parseCartridgePackage(packageBytes);
		assert.deepEqual(packageImage.manifest.hardware, MANIFEST.hardware);
		assert.equal(packageImage.header.blua32ImageByteCount, 0);
		const index = await parseCartridgeIndex(packageBytes);
		assert.deepEqual(
			index.entries.map(entry => [entry.type, entry.resid]),
			[['bin', 'probe']],
		);
		const probe = index.entries[0]!;
		assert.deepEqual(
			packageBytes.subarray(probe.start!, probe.end!),
			probeBytes,
		);
	} finally {
		await rm(externalRoot, { recursive: true, force: true });
	}
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
			compiled_buffer: compileLuaChunkBuffer(source, 'entry.lua'),
			source_path: 'entry.lua',
		}];
		const layout = layoutRomPrefix(assets, false, MANIFEST);
		const blua32 = buildRomBlua32Tail(assets, {
			generatedLuaModules: [],
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
			compiled_buffer: compileLuaChunkBuffer(source, 'module.lua'),
			source_path: 'module.lua',
		}], {
			generatedLuaModules: [],
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
