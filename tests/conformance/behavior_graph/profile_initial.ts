import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { indexStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_index';
import { setStateMachineInitial } from '../../../ide/workbench/contrib/behavior_lens/state_machine_initial';

for (const states of [32, 1024]) {
	for (const initial of ["initial='state0',", '']) {
		const source = `local machines<const> = require('cartlib/fsm/library')
machines.register('profile',{${initial}states={${Array.from({ length: states }, (_, index) => `state${index}={}`).join(',')}}})`;
		const resource = { domain: 0 as const, path: 'profile.lua', source: { type: 'lua' as const, resid: 'profile' } };
		const model = new EditorTextModel(resource, 'lua', source);
		const document = buildBehaviorSourceDocument(resource, buildLuaFileSemanticData(source, resource.path));
		const index = indexStateMachineSource(document);
		const [key, target] = [...index.initialTargets.entries()].at(-1)!;
		assert.equal(target.name, `state${states - 1}`);
		let observed = 0;
		const indexMicroseconds = medianMilliseconds(() => {
			for (let operation = 0; operation < 100; operation += 1) observed += indexStateMachineSource(document).initialTargets.size;
		}) * 10;
		const retainedLookupMicroseconds = medianMilliseconds(() => {
			for (let operation = 0; operation < 10000; operation += 1) if (index.initialTargets.get(key) === target) observed += 1;
		}) / 10;
		const editAndUndoMicroseconds = medianMilliseconds(() => {
			for (let operation = 0; operation < 100; operation += 1) { setStateMachineInitial(model, target); model.undo(); }
		}) * 10;
		assert.ok(observed > 0);
		assert.equal(model.buffer.getText(), source);
		assert.equal(model.canUndo, false);
		console.log(JSON.stringify({ states, sourceUtf16: source.length, insertion: initial.length === 0,
			indexMicroseconds, retainedLookupMicroseconds, editAndUndoMicroseconds,
			boundary: 'retained source document; 10 warmups/median of 25; 100 indexes, 10000 lookups or 100 edits+Undo per sample. No parse/layout, focus routing, GPU, Hot Resume, complete frame or heap/GC measurement.' }));
		model.dispose();
	}
}
