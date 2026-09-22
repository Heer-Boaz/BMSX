import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxError } from '../../toolchain/ts/lua/errors';
import { buildModuleExportSlotName, toLuaModulePath } from '../../toolchain/ts/lua/module_path';
import { discoverGuestTestSuite } from '../../toolchain/ts/rompack/test_suite';
import { buildTestCartridge, UNIT_TEST_ENTRY_MODULE_PATH } from '../../toolchain/ts/rompack/test_cartridge';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH } from '../helpers/scenario_media';

const path = SCENARIO_FIXTURE_TEST_SOURCE_PATH;
const source = `local fixture<const> = require('testlib/fixture')
return {
	kind = 'unit',
	setup = function(t, fixture) fixture.value = 17 end,
	teardown = function(t, fixture) fixture.value = nil end,
	tests = {
		preserves_fixture = function(t, fixture) assert(fixture.value == 17) end,
		['independent case'] = function() assert(fixture == 'source only') end,
	},
}`;

test('suite discovery retains named cases in declaration order without executing fixtures', () => {
	const suite = discoverGuestTestSuite(parseLuaChunk(source, path).chunk, path);
	assert.equal(suite.modulePath, toLuaModulePath(path));
	assert.equal(suite.kind, 'unit');
	assert.equal(suite.setup, true);
	assert.equal(suite.teardown, true);
	assert.deepEqual(suite.tests.map(test => test.name), ['preserves_fixture', 'independent case']);
	assert.deepEqual(suite.tests.map(test => test.range.start.line), [7, 8]);
});

test('suite declarations diagnose dynamic registration, obsolete phases and duplicate names at build time', () => {
	for (const [source, message] of [
		['return register_tests()', /return a suite table/],
		["return { kind='unit', ready=function() end, tests={ a=function() end } }", /Unknown suite field 'ready'/],
		["return { kind='unit', tests={ a=function() end, a=function() end } }", /Duplicate test 'a'/],
		["return { kind='unit', tests={ [name]=function() end } }", /static string names/],
		["return { kind='unit', tests={ a=build_test() } }", /must declare a function/],
		["return { kind='unit', tests={} }", /nonempty tests table/],
		["return { kind='unit', setup=true, tests={ a=function() end } }", /must declare a function/],
	] as const) {
		assert.throws(() => discoverGuestTestSuite(parseLuaChunk(source, path).chunk, path), error => {
			assert.ok(error instanceof LuaSyntaxError);
			assert.equal(error.path, path);
			assert.match(error.message, message);
			return true;
		});
	}
});

test('unit and integration images use linked suite modules, not authored globals or entry concatenation', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-suite-'));
	try {
		const { systemRom, cartRom } = await buildScenarioMediaFixture(directory, [{ path, source }]);
		for (const kind of ['unit', 'integration'] as const) {
			const built = await buildTestCartridge({
				systemRom, cartridge: cartRom,
				test: { sourcePath: path, source: source.replace("kind = 'unit'", `kind = '${kind}'`) },
				ramByteCount: 0x00400000, optLevel: 3,
			});
			assert.equal(built.suite.kind, kind);
			assert.equal(built.suite.tests.length, 2);
			assert.ok(built.linked.layout.globalNames.includes(buildModuleExportSlotName(toLuaModulePath(path), [])));
			assert.ok(built.linked.symbols.moduleFunctions.some(module => module.path === toLuaModulePath(path)));
			assert.equal(built.linked.layout.globalNames.some(name => name.startsWith('__bmsx_host_')), false);
			assert.equal(built.linked.layout.constants.includes('source only'), true);
			assert.equal(built.linked.layout.constants.includes('unselected source only'), false);
			const paths = built.linked.symbols.metadata.debugRanges.flatMap(range => range === null ? [] : [range.path]);
			assert.equal(paths.includes('entry'), kind === 'integration');
			assert.equal(paths.includes(UNIT_TEST_ENTRY_MODULE_PATH), kind === 'unit');
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
