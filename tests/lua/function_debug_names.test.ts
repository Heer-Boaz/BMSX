import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';

test('compiler retains authored and inferred function display names separately from function ids', () => {
	const source = `
local local_callback<const> = function()
end
local callbacks<const> = {
	go = function()
	end,
	['finish'] = function()
	end,
	nested = {
		tick = function()
		end,
	},
}
function callbacks:method()
end
callbacks.assigned = function()
end
local function container()
	return function()
	end
end
	return callbacks, local_callback, container
`;
	const compiled = compileLuaSource(source, 'function_debug_names.lua');
	const displayNames = compiled.metadata.protoDisplayNames;
	const namesById = new Map<string, string>();
	for (let index = 0; index < compiled.metadata.protoIds.length; index += 1) {
		namesById.set(
			compiled.metadata.protoIds[index],
			displayNames[index],
		);
	}

	assert.equal(namesById.get('module:function_debug_names.lua/entry'), 'entry');
	assert.equal(namesById.get('module:function_debug_names.lua/entry/local:local_callback'), 'local_callback');
	assert.equal(namesById.get('module:function_debug_names.lua/entry/decl:callbacks.method'), 'callbacks.method');
	assert.equal(namesById.get('module:function_debug_names.lua/entry/assign:callbacks.assigned'), 'callbacks.assigned');
	assert.equal(displayNames.includes('go'), true);
	assert.equal(displayNames.includes('finish'), true);
	assert.equal(displayNames.includes('tick'), true);
	assert.equal(
		displayNames.includes('container.<anonymous>'),
		true,
	);

	const linked = linkTestSystemBlua32(compiled);
	for (let functionIndex = 0; functionIndex < linked.symbols.metadata.functionIds.length; functionIndex += 1) {
		const functionId = linked.symbols.metadata.functionIds[functionIndex];
		assert.equal(
			linked.symbols.metadata.functionDisplayNames[functionIndex],
			namesById.get(functionId),
		);
	}
});
