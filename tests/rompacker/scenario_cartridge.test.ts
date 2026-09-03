import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { buildLuaSources } from '../../ide/runtime/source_registry';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { buildLuaStackFrames } from '../../ide/runtime/stack_trace';
import { buildScenarioCartridge } from '../../toolchain/ts/rompack/scenario_cartridge';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { traceSinkFieldName } from '../../toolchain/ts/lua/compiler/trace_statement';
import { loadBlua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { RomSourceStack } from '../../toolchain/ts/rompack/source';
import { parseCartridgePackage } from '../../machine/ts/rompack/image';
import {
	buildScenarioMediaFixture,
	SCENARIO_FIXTURE_CART_ENTRY_SOURCE,
	SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE,
	SCENARIO_FIXTURE_TEST_SOURCE_PATH,
	SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE,
} from '../helpers/scenario_media';

const ROOT = join(process.cwd(), 'tmp', 'host-test-cartridge-test');

test('scenario cartridge packages authored test source without making it a startup module', async () => {
	await rm(ROOT, { recursive: true, force: true });
	try {
		await mkdir(ROOT, { recursive: true });
		const testSource = [
			"local fixture<const> = require('testlib/fixture')",
			'__bmsx_host_test = {}',
			'function __bmsx_host_test.ready()',
			'\treturn fixture == "source only"',
			'end',
			'function __bmsx_host_test.setup()',
			'end',
			'function __bmsx_host_test.update()',
			"\tassert(false, 'mapped assertion')",
			'end',
		].join('\n');
		const { systemRom, cartRom } = await buildScenarioMediaFixture(ROOT, [{
			path: SCENARIO_FIXTURE_TEST_SOURCE_PATH,
			source: testSource,
		}]);
		const baseToolingImage = loadBlua32ToolingImage(
			parseCartridgePackage(cartRom),
			CART_ROM_BASE,
		)!;
		assert.equal(
			baseToolingImage.layout.constants.includes(traceSinkFieldName('fixture')),
			false,
		);
		assert.equal(baseToolingImage.layout.constants.includes('source only'), false);
		assert.equal(
			baseToolingImage.layout.constants.includes('unselected source only'),
			false,
		);
		const enhancedBuild = await buildScenarioCartridge({
			systemRom,
			cartridge: cartRom,
			test: {
				sourcePath: SCENARIO_FIXTURE_TEST_SOURCE_PATH,
				source: testSource,
			},
			ramByteCount: 0x00400000,
			optLevel: 3,
		});
		const enhanced = enhancedBuild.layer.bytes;
		const index = await parseCartridgeIndex(enhanced);
		const sourceEntry = index.entries.find(
			entry => entry.source_path === SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		)!;
		const entrySource = index.entries.find(entry => entry.source_path === 'entry.lua')!;

		assert.equal(sourceEntry.type, 'lua');
		assert.equal(sourceEntry.compiled_start, undefined);
		assert.equal(sourceEntry.normalized_source_path, SCENARIO_FIXTURE_TEST_SOURCE_PATH);
		assert.equal(sourceEntry.update_timestamp, 1234);
		assert.equal(
			Buffer.from(enhanced.subarray(sourceEntry.start, sourceEntry.end)).toString('utf8'),
			testSource,
		);
		assert.equal(
			Buffer.from(enhanced.subarray(entrySource.start, entrySource.end)).toString('utf8'),
			SCENARIO_FIXTURE_CART_ENTRY_SOURCE,
		);
		const sourceOnlyEntry = index.entries.find(entry => entry.resid === 'source-only-module')!;
		assert.equal(sourceOnlyEntry.compiled_start, undefined);
		assert.equal(
			Buffer.from(enhanced.subarray(sourceOnlyEntry.start, sourceOnlyEntry.end)).toString('utf8'),
			SCENARIO_FIXTURE_SOURCE_ONLY_MODULE_SOURCE,
		);
		const unselectedSourceOnlyEntry = index.entries.find(
			entry => entry.resid === 'unselected-source-only-module',
		)!;
		assert.equal(unselectedSourceOnlyEntry.compiled_start, undefined);
		assert.equal(
			Buffer.from(enhanced.subarray(
				unselectedSourceOnlyEntry.start,
				unselectedSourceOnlyEntry.end,
			)).toString('utf8'),
			SCENARIO_FIXTURE_UNSELECTED_MODULE_SOURCE,
		);

		const cartPackage = parseCartridgePackage(enhanced);
		const toolingImage = loadBlua32ToolingImage(cartPackage, CART_ROM_BASE)!;
		assert.equal(
			toolingImage.layout.constants.includes(traceSinkFieldName('fixture')),
			true,
		);
		assert.equal(toolingImage.layout.constants.includes('source only'), true);
		assert.equal(
			toolingImage.layout.constants.includes('unselected source only'),
			false,
		);
		const testModulePath = toLuaModulePath(SCENARIO_FIXTURE_TEST_SOURCE_PATH);
		const authoredRanges = toolingImage.symbols!.metadata.debugRanges.filter(
			range => range !== null && range.path === testModulePath,
		);
		assert.ok(authoredRanges.some(range => range!.start.line === 9 && range!.start.column === 2));
		const debugRangeIndex = toolingImage.symbols!.metadata.debugRanges.findIndex(
			range => range !== null
				&& range.path === testModulePath
				&& range.start.line === 9
				&& range.start.column === 2,
		);
		const tracePc = toolingImage.layout.header.textAddress + debugRangeIndex * INSTRUCTION_BYTES;
		const functionIndex = toolingImage.layout.functions.findIndex(
			fn => tracePc >= fn.codeAddress && tracePc < fn.codeAddress + fn.codeByteCount,
		);
		const fn = toolingImage.layout.functions[functionIndex];
		const media = await loadRomToolingMedia(systemRom, [enhanced, null]);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		const frames = buildLuaStackFrames(sources, [{
			executionDomainId: 0,
			toolingImage,
			functionAddress: fn.address,
			functionIndex,
			codeAddress: fn.codeAddress,
			codeByteCount: fn.codeByteCount,
			tracePc,
			registers: [],
			upvalues: [],
		}]);
		const authoredFrame = frames.find(
			frame => frame.kind === 'source'
				&& frame.resource.path === SCENARIO_FIXTURE_TEST_SOURCE_PATH,
		)!;
		assert.equal(authoredFrame.kind, 'source');
		assert.equal(authoredFrame.line, 9);
		assert.equal(authoredFrame.column, 2);
		assert.equal(authoredFrame.workspacePath, SCENARIO_FIXTURE_TEST_SOURCE_PATH);

		const layer = { id: 'cart' as const, index, bytes: enhanced };
		const romSource = new RomSourceStack([layer]);
		const registry = buildLuaSources(romSource, romSource, index, 'cart');
		const testRecord = registry.path2lua[SCENARIO_FIXTURE_TEST_SOURCE_PATH];
		assert.equal(testRecord.program_module, false);
		assert.equal(testRecord.src, testSource);
		assert.equal(registry.module2lua[testModulePath], testRecord);
		assert.equal(registry.entrySourcePath, 'entry.lua');

		await assert.rejects(
			buildScenarioCartridge({
				systemRom,
				cartridge: cartRom,
				test: {
					sourcePath: SCENARIO_FIXTURE_TEST_SOURCE_PATH,
					source: 'local value = 1\n@',
				},
				ramByteCount: 0x00400000,
				optLevel: 3,
			}),
			(error: LuaSyntaxError) => error.path === SCENARIO_FIXTURE_TEST_SOURCE_PATH
				&& error.line === 2
				&& error.column === 1,
		);
		await assert.rejects(
			buildScenarioCartridge({
				systemRom,
				cartridge: cartRom,
				test: {
					sourcePath: 'tests/carts/example/unpackaged_assert.lua',
					source: '__bmsx_host_test = {}',
				},
				ramByteCount: 0x00400000,
				optLevel: 3,
			}),
			/lua asset '__bmsx_scenario_test__\/tests\/carts\/example\/unpackaged_assert\.lua' is not present in the ROM/,
		);
	} finally {
		await rm(ROOT, { recursive: true, force: true });
	}
});
