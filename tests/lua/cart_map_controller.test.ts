import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CartMapController } from '../../ide/workbench/contrib/cart_maps/controller';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveTextCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

for (const existing of [false, true]) test(`superseded map source opening disposes only its unadmitted candidate (${existing ? 'retained' : 'new'} source view)`, async t => {
	const sources = createScenarioTestSourceState([]), group = createTestEditorGroup();
	const resource = { sourceFilePath: 'res/data/nemesis_s_stage.yaml', location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	const model = editorTextModelService.retain(resource, 'yaml', 'map_rows: ["m "]\n');
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => {
		group.dispose(); input.dispose();
		editorTextModelService.clear();
	});
	const retained = existing ? await resolveTextCodeEditorInput(sources, resource) : undefined;
	if (retained !== undefined) group.model.add(retained);
	const disposed: CodeEditorInput[] = [];
	const dispose = CodeEditorInput.prototype.dispose;
	t.mock.method(CodeEditorInput.prototype, 'dispose', function (this: CodeEditorInput) { disposed.push(this); dispose.call(this); });
	const controller = new CartMapController(sources, group, null!);
	controller.openSource(input);
	group.panes.beginOpen();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(group.panes.activePane, null);
	assert.equal(disposed.length, 1);
	const candidate = disposed[0];
	assert.equal(candidate.workingCopy, model);
	if (retained !== undefined) {
		assert.notEqual(candidate, retained);
		assert.notEqual(candidate.context.view, retained.context.view);
		assert.equal(group.model.findById(retained.id), retained);
		retained.context.view.cursorColumn = 3;
	} else assert.equal(group.model.tabs.length, 0);
	candidate.context.view.cursorColumn = 3;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- prefix\n' }]);
	assert.equal(candidate.context.view.cursorRow, 0, 'discarded candidates no longer observe the canonical model');
	if (retained !== undefined) assert.equal(retained.context.view.cursorRow, 1, 'the retained sibling keeps its binding');

});
