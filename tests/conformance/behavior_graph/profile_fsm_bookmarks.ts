import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark,
	resolveBehaviorSourceBookmark } from '../../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { reconcileStateMachineSourceSelection, selectStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';

/** Selected proof only; deliberately select the last sibling/consumer, not the best-case first. */
for (const siblings of [32, 1024]) {
	const source = `local machines<const> = require('cartlib/fsm/library')
local callback<const> = function(owner) if owner.done then return '../active' end return '../active' end
local branch<const> = { states = { idle = { update = callback, on = { go = '../active' } }, active = {} } }
machines.register('profile', { states = {${Array.from({ length: siblings }, (_, index) => `lane${index}=branch`).join(',')}} })`;
	const model = new EditorTextModel({ domain: 0, path: 'profile.lua', source: { type: 'lua', resid: 'profile' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
	const view = createBehaviorLensViewState(document, model, 'outline');
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	const origin = definition.scopes[0].children.get(`lane${siblings - 1}`)!.children.get('idle')!;
	for (const slot of ['event', 'update']) {
		const transition = definition.transitions.find(item => item.origin === origin && item.slot.kind === slot)!;
		const selection = selectStateMachineSource({ kind: 'state-outcome', rowKey: transition.slot.source.rowKey,
			transition, outcome: transition.outcomes[transition.outcomes.length - 1] }, model.buffer);
		assert.ok(selection.kind === 'state-outcome');
		const bookmark = captureBehaviorSourceBookmark(view, selection);
		const roundtrip = [{ offset: 0, deletedLength: 0, insertedLength: 10 }, { offset: 0, deletedLength: 10, insertedLength: 0 }];
		let observed = 0;
		const captureMicroseconds = medianMilliseconds(() => {
			for (let index = 0; index < 1000; index += 1) observed += captureBehaviorSourceBookmark(view, selection).path.length;
		});
		const copyAndMapMicroseconds = medianMilliseconds(() => {
			for (let index = 0; index < 1000; index += 1) {
				const pending = copyBehaviorSourceBookmark(bookmark);
				mapBehaviorSourceBookmark(pending, roundtrip);
				observed += pending.tracked.binding.start;
			}
		});
		const resolveMicroseconds = medianMilliseconds(() => {
			for (let index = 0; index < 1000; index += 1) {
				const path = resolveBehaviorSourceBookmark(bookmark, view)!;
				const resolved = reconcileStateMachineSourceSelection(bookmark, view.stateMachines.references.get(path[path.length - 1].rowKey), model.buffer)!;
				observed += resolved.rowKey.length;
			}
		});
		assert.ok(observed > 0);
		assert.equal(bookmark.tracked.binding.start, selection.tracked.binding.start);
		console.log(JSON.stringify({ siblings, proof: bookmark.tracked.kind, path: bookmark.path.length,
			captureMicroseconds, copyAndMapMicroseconds, resolveMicroseconds,
			boundary: '1000 explicit operations per sample, 10 warmups / median of 25. Retained source index; last shared consumer. No parse, model events, layout, pointer, GPU, guest, complete edit/frame or heap/GC measurement.' }));
	}
	model.dispose();
}
