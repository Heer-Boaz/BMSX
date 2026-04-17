import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildModuleAliasMap, buildModuleAliasesFromPaths } from '../../src/bmsx/machine/program/asset';

test('bios util modules resolve through util aliases', () => {
	const aliasMap = buildModuleAliasMap(buildModuleAliasesFromPaths([
		'res/bios/bootrom.lua',
		'res/bios/engine.lua',
		'res/bios/timeline.lua',
		'res/bios/components.lua',
		'res/bios/textobject.lua',
		'res/bios/util/clamp_int.lua',
		'res/bios/util/wrap_text_lines.lua',
	]));

	assert.equal(aliasMap.get('bios/engine'), 'res/bios/engine.lua');
	assert.equal(aliasMap.get('clamp_int'), 'res/bios/util/clamp_int.lua');
	assert.equal(aliasMap.get('util/clamp_int'), 'res/bios/util/clamp_int.lua');
	assert.equal(aliasMap.get('wrap_text_lines'), 'res/bios/util/wrap_text_lines.lua');
	assert.equal(aliasMap.get('util/wrap_text_lines'), 'res/bios/util/wrap_text_lines.lua');
});
