import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { SceneRegistrationProvenance } from '../../ide/workbench/contrib/scene_editor/registration_provenance';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { WORLD_CPU_MODULES, WORLD_CPU_SETUP } from '../helpers/world_cpu';

for (const optLevel of [0, 3] as const) for (const traceStatements of ['emit', 'erase'] as const)
test(`Scene plan provenance observes real publication, not function entry (O${optLevel}, ${traceStatements})`, () => {
	const source = WORLD_CPU_SETUP + `
prefab.define({def_id='actor', class=object_2d})
local register_first<const> = function() scenes.register('same', {objects={{member_id='first', definition_id='actor'}}}) end
local register_second<const> = function() scenes.register('same', {objects={{member_id='second', definition_id='actor'}}}) end
register_first()
first = scenes.instantiate('same')
register_second()
second = scenes.instantiate('same')
register_first()
third = scenes.instantiate('same')
local rejecting<const> = { _compile_pose = function(member, definition)
 if definition ~= nil then register_second(); return false end
 return true
end }
prefab.define({def_id='rejecting', class=rejecting})
assert(not pcall(scenes.register, 'same', {objects={{member_id='failed', definition_id='rejecting'}}}))
last = scenes.instantiate('same')
`;
	// The first statement deliberately executes repeatedly. Only the actual
	// plan store establishes provenance, including the nested successful write.
	const library = readFileSync('cartlib/world/scene_library.lua', 'utf8').replace(
		'function scene_library.register(id, definition)',
		'function scene_library.register(id, definition)\n for i = 1, 3 do registration_visits = (registration_visits or 0) + 1 end');
	const { cpu, images } = createCartlibProgramHarness(source, { optLevel, traceStatements,
		modules: [...WORLD_CPU_MODULES, { path: 'cartlib/world/scene_library', source: library }] });
	const provenance = new SceneRegistrationProvenance(cpu, { layout: images.cartImage, symbols: images.cartSymbols }, 0);
	cpu.setInstructionObserver(provenance);
	try { assert.equal(cpu.runUntilDepth(0, 10_000_000), RunResult.Halted); }
	finally { cpu.setInstructionObserver(null); }
	assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('registration_visits')!), 15);
	assert.equal(provenance.plans.size, 4, 'failed compilation has no plan publication');
	const plans = ['first', 'second', 'third', 'last'].map(name => {
		const scene = cpu.getGlobalByKey(cpu.stringPool.find(name)!) as Table;
		return scene.getStringKey(cpu.stringPool.find('definition')!) as Table;
	});
	assert.equal(new Set(plans.map(plan => plan.hashId)).size, 4, 'plan identity survives repeated registry keys');
	for (let index = 0; index < plans.length; index++) {
		const record = provenance.plans.get(plans[index].hashId)!;
		const call = record.calls.find(call => call.path === 'entry.lua')!;
		assert.equal(readLuaSourceRange(new PieceTreeBuffer(source), call), index % 2 === 0
			? "scenes.register('same', {objects={{member_id='first', definition_id='actor'}}})"
			: "scenes.register('same', {objects={{member_id='second', definition_id='actor'}}})");
	}
});
