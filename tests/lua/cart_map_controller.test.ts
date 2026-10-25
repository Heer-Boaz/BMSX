import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CartMapController } from '../../ide/workbench/contrib/cart_maps/controller';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveTextCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { codeEditorInputManager } from '../../ide/workbench/ui/code_tab/input_manager';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { createTestEditorPanes } from '../helpers/editor_panes';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

for (const existing of [false, true]) test(`superseded map source opening disposes only its unadmitted candidate (${existing ? 'retained' : 'new'} source view)`, async t => {
	const sources = createScenarioTestSourceState([]), panes = createTestEditorPanes();
	const resource = { location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	const model = editorTextModelService.retain(resource, 'yaml', 'map_rows: ["m "]\n');
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => {
		panes.dispose(); input.dispose(); editorTabGroup.clear();
		codeEditorInputManager.clear(); editorTextModelService.clear();
	});
	const retained = existing ? await resolveTextCodeEditorInput(sources, resource) : undefined;
	if (retained !== undefined) editorTabGroup.add(retained);
	const disposed: CodeEditorInput[] = [];
	const dispose = CodeEditorInput.prototype.dispose;
	t.mock.method(CodeEditorInput.prototype, 'dispose', function (this: CodeEditorInput) { disposed.push(this); dispose.call(this); });
	const controller = new CartMapController(sources, panes, null!);
	controller.openSource(input);
	panes.beginOpen();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(panes.activePane, null);
	if (retained !== undefined) {
		assert.deepEqual(disposed, []);
		assert.equal(editorTabGroup.findById(retained.id), retained);
	} else {
		assert.equal(disposed.length, 1);
		assert.equal(disposed[0].workingCopy, model);
		assert.equal(editorTabGroup.tabs.length, 0);
	}
});
