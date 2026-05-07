import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../src/bmsx/lua/semantic/model');

test('semantic file data records direct and chained require aliases', async () => {
	const { buildLuaFileSemanticData } = await semanticModelModulePromise;
	const source = [
		"local constants<const> = require('constants')",
		"local hud<const> = constants.hud",
		"local physics<const> = constants['physics']",
		"local overlay<const> = require('constants').hud.overlay",
		"local combat_overlap<const> = require('combat_overlap')",
		'return constants, hud, physics, overlay, combat_overlap',
	].join('\n');
	const data = buildLuaFileSemanticData(source, 'testpath');
	assert.deepEqual(data.moduleAliases, [
		{ alias: 'constants', module: 'constants', memberPath: [] },
		{ alias: 'hud', module: 'constants', memberPath: ['hud'] },
		{ alias: 'physics', module: 'constants', memberPath: ['physics'] },
		{ alias: 'overlay', module: 'constants', memberPath: ['hud', 'overlay'] },
		{ alias: 'combat_overlap', module: 'combat_overlap', memberPath: [] },
	]);
});
