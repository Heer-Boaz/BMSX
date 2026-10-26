import { createTestEditorGroup } from '../helpers/editor_panes';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { CartEditor } from '../../ide/cart_editor';
import type { ResourceDomain } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { openCreateResourcePrompt } from '../../ide/workbench/contrib/resources/create';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, path: string, canonicalPath: string, generated = false) {
	const clock = new VirtualHeadlessClock();
	configureFontVariant(clock, 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const source = { ...createScenarioTestSourceRecord(path, 1), normalized_source_path: canonicalPath, generated };
	const sources = createScenarioTestSourceState([source]);
	const resource = sources.resources.find(resource => resource.domain === 0 && resource.path === path)!;
	const group = createTestEditorGroup();
	group.model.initialize(resolveLuaCodeEditorInput(sources, resource));
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu);
	const editor = { quickInput: picker, editorGroup: group } as CartEditor;
	t.after(() => {
		picker.dispose(); menu.dispose(); group.dispose();
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	return { clock, sources, editor, picker, resource };
}

test('New File uses a project resource authoring directory, including a project-local library-named folder', t => {
	const f = fixture(t, 'cartlib/local.lua', 'carts/nemesis_s/cartlib/local.lua');
	openCreateResourcePrompt(f.editor, f.sources, f.clock);
	assert.equal(f.picker.inputBox, true);
	// This is the actual proposed filesystem directory, not the prompt wording.
	assert.equal(f.picker.field.text, 'cartlib/');
	assert.equal(f.editor.editorGroup.model.activeTab!.resource, f.resource);
});

for (const [path, generated] of [['cartlib/shared.lua', false], ['testlib/context.lua', false], ['bmsx/assets.lua', true]] as const) {
	test(`New File from ${path} asks for an authoring project instead of borrowing its execution context`, t => {
		const f = fixture(t, path, path, generated);
		openCreateResourcePrompt(f.editor, f.sources, f.clock);
		assert.equal(f.picker.visible, true); assert.equal(f.picker.inputBox, false);
		const projects = f.picker.model.items as readonly (QuickPickItem & { domain: ResourceDomain })[];
		assert.deepEqual(projects.map(project => project.domain), [0, -1]);
		f.picker.accept();
		assert.equal(f.picker.inputBox, true);
		assert.equal(f.picker.field.text, '', 'the explicitly chosen project cannot inherit an external or generated directory');
		assert.equal(f.editor.editorGroup.model.activeTab!.resource, f.resource);
	});
}
