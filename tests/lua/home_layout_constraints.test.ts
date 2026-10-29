import assert from 'node:assert/strict';
import test from 'node:test';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { HomeEditorPane } from '../../ide/workbench/contrib/home/editor_pane';
import { HOME_CARD_PADDING, HOME_ICON_GAP, HOME_PADDING, measureHomeEditor, measureHomeMinimumCardWidth } from '../../ide/workbench/contrib/home/layout';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import type { EditorPaneConstraints } from '../../ide/workbench/services/editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
import { createActualSourcePanes } from '../helpers/source_panes';

// Card and intrinsic extents are the subject of these layout tests. No command wording or framebuffer snapshot is frozen.
const CARD_CHROME = HOME_CARD_PADDING * 2 + WORKBENCH_ICON_SIZE + HOME_ICON_GAP + 4;
const EDITOR_CHROME = HOME_PADDING * 2 + SCROLLBAR_WIDTH;

for (const variant of ['tiny', 'msx'] as const) test(`${variant} prospective Home measures potential action labels once without an attached control or availability-dependent floor`, t => {
	const input = new HomeInput(null), font = new EditorFont(variant);
	t.after(() => input.dispose());
	const labelWidth = font.measure.bind(font), measuring = t.mock.method(font, 'measure');
	const constraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: 0 };
	measureHomeEditor(input, font, true, constraints);
	let maximum = 0, count = 0;
	for (const section of input.sections) for (const item of section.actions.items) {
		assert.equal(item.width, labelWidth(item.label), 'the existing action cache retains pure label width, not decorated card/button width');
		maximum = Math.max(maximum, item.width); count++;
	}
	assert.ok(count > 0); assert.equal(measuring.mock.callCount(), count);
	assert.equal(constraints.minimumWidth, maximum + CARD_CHROME + EDITOR_CHROME);
	assert.equal(constraints.minimumHeight, 0); assert.equal(constraints.companionWidth, undefined);
	for (const section of input.sections) for (const item of section.actions.items) item.visible = false;
	for (let frame = 0; frame < 8; frame++) measureHomeEditor(input, font, false, constraints);
	assert.equal(measuring.mock.callCount(), count); assert.equal(constraints.minimumWidth, maximum + CARD_CHROME + EDITOR_CHROME);
	assert.equal(input.layout.font, null, 'prospective measurement does not claim an attached layout generation');
});

test('Home remeasures its existing action-width cache at a font switch and retains the new pure-label metric', t => {
	const input = new HomeInput(null), tiny = new EditorFont('tiny'), msx = new EditorFont('msx'); t.after(() => input.dispose());
	const tinyMeasure = t.mock.method(tiny, 'measure'), msxMeasure = t.mock.method(msx, 'measure');
	const constraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	measureHomeEditor(input, tiny, false, constraints); const tinyWidth = constraints.minimumWidth;
	const count = input.sections.reduce((total, section) => total + section.actions.items.length, 0);
	measureHomeEditor(input, msx, false, constraints); const msxWidth = constraints.minimumWidth;
	assert.equal(tinyMeasure.mock.callCount(), count); assert.equal(msxMeasure.mock.callCount(), count); assert.ok(msxWidth > tinyWidth);
	measureHomeEditor(input, msx, false, constraints); assert.equal(msxMeasure.mock.callCount(), count);
	measureHomeEditor(input, tiny, false, constraints); assert.equal(constraints.minimumWidth, tinyWidth);
	assert.equal(tinyMeasure.mock.callCount(), count * 2);
});

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = { { member_id = 'unit', definition_id = 'actor' } } })
return {}
`;
for (const variant of ['tiny', 'msx'] as const) test(`${variant} actual Main allocation preserves Home's usable card width between its independent contextual regions`, async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant(variant); f.editor.updateViewport({ width: 300, height: 320 });
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const home = new HomeInput(f.sources.catalog.getContext(resource.contextId).admission), group = f.editor.editorParts.main.activeGroup;
	group.openEditor(home); f.update();
	const pane = group.panes.activePane; assert.ok(pane instanceof HomeEditorPane); pane.focus(); f.update();
	const constraints: EditorPaneConstraints = { minimumWidth: 0, minimumHeight: 0, companionWidth: undefined };
	measureHomeEditor(home, editorViewState.font, false, constraints);
	assert.ok(group.minimumWidth >= constraints.minimumWidth);
	assert.ok(home.layout.right - home.layout.left >= constraints.minimumWidth);
	const cardMinimum = measureHomeMinimumCardWidth(home, editorViewState.font);
	let count = 0;
	for (const section of home.sections) if (section.visibleCount > 0) {
		assert.ok(section.bounds.right - section.bounds.left >= cardMinimum);
		const textWidth = section.bounds.right - section.bounds.left - CARD_CHROME;
		for (const item of section.actions.items) if (item.visible) { assert.ok(textWidth >= item.width); count++; }
	}
	assert.ok(count > 0); assert.ok(primary.hierarchy.attached && primary.details.attached);
	assert.ok(f.editor.mainWorkspace.primary === primary && primary.consumer.subject === primary.consumer.document!.scenes[0]);
	assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.dirty, false);
});
