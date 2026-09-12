import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { mapBehaviorLensSourceRanges } from '../../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';

editorViewState.font = new EditorFont('tiny');

for (const [children, viewCount] of [[0, 0], [32, 1], [32, 16], [1024, 1], [1024, 16]]) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = { type = 'wait', duration_ticks = 1 }
trees.register('profile', { root = { type = 'sequence', children = {${'leaf,'.repeat(children)}} } })`;
	const model = new EditorTextModel({ domain: 0, path: 'profile.lua', source: { type: 'lua', resid: 'profile' } }, 'lua', source);
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(source, model.resource.path));
	const inputs: BehaviorLensInput[] = [];
	for (let index = 0; index < viewCount; index += 1) {
		inputs.push(new BehaviorLensInput(model, createBehaviorLensViewState(document, model, 'graph', assert.fail),
			() => assert.fail('range tracking does not start an FSM layout engine')));
	}
	model.onDidChangeContent(event => {
		for (const input of inputs) mapBehaviorLensSourceRanges(input.view, model.resource, event);
	});
	const editAndUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
			model.undo();
		}
	}) * 10;
	assert.equal(model.buffer.getText(), source);
	if (inputs.length > 0) {
		const first = inputs[0].view.source;
		for (const input of inputs) assert.equal(input.view.source, first);
	}
	console.log(JSON.stringify({ children, viewCount, editAndUndoMicroseconds,
		boundary: '100 edit+Undo cycles per sample, 10 warmups / median of 25; retained source generations, model PieceTree/history/events and all view notifications; excludes parse, projection, rendering and guest' }));
	for (const input of inputs) input.dispose();
	model.dispose();
}
