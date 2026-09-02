import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { composeLuaSource } from '../../toolchain/ts/lua/compiler/source_map';

const ENTRY_PATH = 'entry';
const GENERATED_PATH = 'bmsx/test_harness';
const TEST_RANGE_PATH = 'tests/carts/example/example_assert';
const TEST_DISPLAY_PATH = `${TEST_RANGE_PATH}.lua`;

function buildMappedModule(testSource: string) {
	return composeLuaSource(GENERATED_PATH, [
		{ kind: 'generated', source: '__loader = function()' },
		{
			kind: 'source',
			rangePath: TEST_RANGE_PATH,
			displayPath: TEST_DISPLAY_PATH,
			source: testSource,
		},
		{ kind: 'generated', source: 'end' },
	]);
}

test('compiler maps generated harness debug metadata to authored source ranges', () => {
	const entrySource = `module<entry>\nrequire('${GENERATED_PATH}')`;
	const testSource = 'local value = 1\nassert(value == 2)';
	const mapped = buildMappedModule(testSource);
	const compiled = compileLuaChunkToProgram(
		parseLuaChunk(entrySource, ENTRY_PATH).chunk!,
		[{
			path: GENERATED_PATH,
			source: mapped.source,
			chunk: parseLuaChunk(mapped.source, GENERATED_PATH).chunk!,
			sourceMap: mapped.sourceMap,
		}],
		{ entrySource, optLevel: 0 },
	);

	const authoredRanges = compiled.metadata.debugRanges.filter(
		range => range !== null && range.path === TEST_RANGE_PATH,
	);
	assert.ok(authoredRanges.some(range => range!.start.line === 1 && range!.start.column === 1));
	assert.ok(authoredRanges.some(range => range!.start.line === 2 && range!.start.column === 1));
	const authoredStatements = compiled.metadata.statementPointsByProto.flat().filter(
		point => point.range.path === TEST_RANGE_PATH,
	);
	assert.ok(authoredStatements.some(point => point.range.start.line === 1));
	assert.ok(authoredStatements.some(point => point.range.start.line === 2));
});

test('compiler reports mapped harness diagnostics at the authored source location', () => {
	const entrySource = `module<entry>\nrequire('${GENERATED_PATH}')`;
	const mapped = buildMappedModule('local value<const> = 1\nvalue = 2');

	assert.throws(
		() => compileLuaChunkToProgram(
			parseLuaChunk(entrySource, ENTRY_PATH).chunk!,
			[{
				path: GENERATED_PATH,
				source: mapped.source,
				chunk: parseLuaChunk(mapped.source, GENERATED_PATH).chunk!,
				sourceMap: mapped.sourceMap,
			}],
			{ entrySource, optLevel: 0 },
		),
		new RegExp(`module ${TEST_DISPLAY_PATH.replaceAll('/', '\\/')}: 2:1:`),
	);
});
