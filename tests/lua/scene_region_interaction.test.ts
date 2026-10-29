import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorSourceLocation } from '../../ide/editor/navigation/source_location';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { SceneEditorNavigationSelection } from '../../ide/workbench/contrib/scene_editor/navigation_selection';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'first', definition_id = 'actor.first', options = { pos = { x = 1, y = 2, z = 3 }, strength = 5 } },
 { member_id = 'second', definition_id = 'actor.second', options = { pos = { x = 4, y = 5, z = 6 }, strength = 8 } },
} })
return {}
`;

async function fixture(t: TestContext, source = SOURCE) {
	const f = createActualSourcePanes(t, false, [['scene.lua', source], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny'); f.first.focus();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.editor.sceneEditor.openResource(f.firstGroup, resource);
	f.update();
	const client = f.firstGroup.panes.activePane;
	assert.ok(client instanceof SceneEditorPane);
	const control = client.control, view = control.view;
	assert.equal(control.hierarchy.focus(), true); f.key('ArrowDown');
	const selected = view.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === view.authoring.document!.scenes[0].objects[0]);
	return { ...f, client, control, view, model };
}

for (const compact of [false, true])
	test(`document Scene Tab traverses its actual ${compact ? 'Details-only' : 'hierarchy and Details'} regions and returns through the action bar`, async t => {
		const f = await fixture(t), { control, view } = f;
		if (compact) {
			assert.equal(control.details.focus(), true);
			f.firstBounds.right = 300;
			f.editor.updateViewport({ width: 600, height: 320 });
			f.editor.setFontVariant('msx'); f.update();
			assert.equal(control.hierarchy.canFocus, false);
		} else assert.equal(control.hierarchy.canFocus, true);
		assert.equal(control.details.canFocus, true);
		const selection = view.authoring.selection, execution = f.host.execution.revision;
		const start = compact ? control.details.commandTarget : control.hierarchy.focusTarget;
		assert.equal(start.focus(), true);
		f.key('Tab', KeyModifier.shift);
		const actions = inputFocus.admittedTarget;
		assert.ok(actions !== null && control.inputScope.contains(actions.scope));
		assert.equal(view.actionBar.hasFocus, true);
		const fields = [...control.details.controls, ...control.details.options.controls]
			.filter(control => control.field.focusTarget.canFocus!()).map(control => control.field.focusTarget);
		assert.ok(fields.includes(control.details.controls[0].field.focusTarget)
			&& fields.includes(control.details.options.controls[0].field.focusTarget), 'position and expression controls both participate in the region boundary');
		const cycle = compact ? [actions, control.details.commandTarget, ...fields]
			: [actions, control.hierarchy.focusTarget, control.details.commandTarget, ...fields];
		for (let index = 1; index <= cycle.length; index++) {
			f.key('Tab');
			assert.ok(inputFocus.admittedTarget === cycle[index % cycle.length]);
		}
		for (let index = cycle.length - 1; index >= 0; index--) {
			f.key('Tab', KeyModifier.shift);
			assert.ok(inputFocus.admittedTarget === cycle[index]);
		}
		assert.ok(view.authoring.selection === selection && control.view === view);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
		assert.equal(f.host.execution.revision, execution);
	});

for (const command of ['editor.source', 'editor.sourceToSide'] as const) for (const kind of ['position', 'option'] as const)
	test(`document Scene ${command} observes its canonical ${kind} only after the actual Details draft settles`, async t => {
		const f = await fixture(t), { control, view, model } = f;
		const field = kind === 'position' ? control.details.controls[0] : control.details.options.controls[0];
		assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '31', true);
		assert.ok(control.details.inputScope.contains(field.field.focusTarget.scope)
			&& !control.details.inputScope.contains(field.field.focusTarget.commandContext.scope),
			'draft ownership is the Details attachment, not its broader semantic command context');
		const expected = kind === 'position' ? SOURCE.replace('x = 1,', 'x = 31,') : SOURCE.replace('strength = 5', 'strength = 31');
		const read = view.authoring.getSourceLocation.bind(view.authoring);
		let produced: EditorSourceLocation | undefined;
		const producer = t.mock.method(view.authoring, 'getSourceLocation', () => {
			assert.equal(field.pending, false); assert.equal(model.buffer.getText(), expected);
			produced = read(); return produced;
		});
		const request = t.mock.method(f.editor.navigation, 'openSource');
		f.editor.commands.execute(command, control.commandTarget);
		assert.equal(request.mock.callCount(), 1); assert.ok(await request.mock.calls[0].result !== undefined);
		assert.equal(producer.mock.callCount(), 1); assert.ok(produced !== undefined && produced.selection !== undefined);
		assert.ok(produced.model === model); assert.equal(produced.modelVersion, model.version);
		const input = f.editor.editorParts.activeGroup.model.activeTab;
		assert.ok(input instanceof CodeEditorInput && input.workingCopy === model);
		const position = { row: 0, column: 0 }; model.buffer.positionAt(view.authoring.selectionRange.start, position);
		assert.equal(input.context.view.cursorRow, position.row); assert.equal(input.context.view.cursorColumn, position.column);
		assert.equal(input.context.view.cursorRow, produced.selection.row); assert.equal(input.context.view.cursorColumn, produced.selection.startColumn);
		assert.equal(model.buffer.getText(), expected); assert.equal(model.dirty, true);
		const selected = view.authoring.selection;
		assert.ok(selected?.kind === 'member' && selected.entry === view.authoring.document!.scenes[0].objects[0]);
	});

for (const command of ['editor.source', 'editor.sourceToSide'] as const) for (const kind of ['position', 'option'] as const)
	test(`document Scene ${command} cannot replace a newer selection published by its ${kind} draft`, async t => {
		const f = await fixture(t), { control, view, model } = f;
		const field = kind === 'position' ? control.details.controls[0] : control.details.options.controls[0];
		assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '31', true);
		const release = model.onDidChangeContent(() => {
			release(); view.authoring.refresh();
			const document = view.authoring.document!, scene = document.scenes[0];
			assert.equal(view.authoring.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 }), true);
		}); t.after(release);
		const groups = [...f.editor.editorParts.groups], producer = t.mock.method(view.authoring, 'getSourceLocation');
		const opening = t.mock.method(f.editor.navigation, 'openResource');
		f.editor.commands.execute(command, control.commandTarget);
		assert.equal(field.pending, false); assert.equal(producer.mock.callCount(), 0); assert.equal(opening.mock.callCount(), 0);
		assert.equal(f.editor.editorParts.groups.length, groups.length);
		assert.ok(groups.every((group, index) => f.editor.editorParts.groups[index] === group));
		assert.ok(f.firstGroup.panes.activePane === f.client && control.hasView);
		assert.ok(inputFocus.admittedTarget === field.field.focusTarget);
		const selected = view.authoring.selection;
		assert.ok(selected?.kind === 'member' && selected.entry === view.authoring.document!.scenes[0].objects[1]);
		assert.equal(model.buffer.getText(), kind === 'position'
			? SOURCE.replace('x = 1,', 'x = 31,') : SOURCE.replace('strength = 5', 'strength = 31'));
	});

for (const retirement of ['detach', 'zero extent'] as const)
	test(`document hierarchy ${retirement} retires its armed popup without retiring sibling Details or its context`, async t => {
		const f = await fixture(t), { control, view } = f, menu = f.editor.contextMenu;
		assert.equal(control.hierarchy.focus(), true);
		f.editor.commands.execute('contextMenu', control.hierarchy.focusTarget);
		assert.equal(menu.visible, true);
		menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === 'editor.source');
		assert.ok(menu.model.selectedIndex >= 0 && menu.model.rows[menu.model.selectedIndex].enabled);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
		const selection = view.authoring.selection, rootGeneration = control.inputScope.contextGeneration;
		const detailsGeneration = control.details.inputScope.contextGeneration, hierarchyGeneration = control.hierarchy.inputScope.contextGeneration;
		const request = t.mock.method(f.editor.navigation, 'openSource');
		if (retirement === 'detach') control.hierarchy.clearView();
		else control.hierarchy.layout({ left: 0, top: 0, right: 0, bottom: 0 });
		assert.equal(menu.visible, false);
		assert.ok(control.hierarchy.inputScope.contextGeneration > hierarchyGeneration);
		assert.equal(control.inputScope.contextGeneration, rootGeneration);
		assert.equal(control.details.inputScope.contextGeneration, detailsGeneration);
		assert.ok(control.details.hasView && control.details.canFocus && view.authoring.selection === selection);
		assert.equal(f.editor.commands.isEnabled('editor.source', control.details.commandTarget), true);
		if (retirement === 'detach') control.hierarchy.setView(view.hierarchy, view.layout.hierarchyBounds);
		else control.hierarchy.layout(view.layout.hierarchyBounds);
		f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
		assert.equal(request.mock.callCount(), 0); assert.equal(menu.visible, false);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.ok(control.view === view);
	});

test('document hierarchy detachment preserves the exact live Details draft through composition updates', async t => {
	const f = await fixture(t), { control, view } = f, field = control.details.controls[0];
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '31', true);
	const selection = view.authoring.selection, rootGeneration = control.inputScope.contextGeneration;
	const detailsGeneration = control.details.inputScope.contextGeneration;
	control.hierarchy.clearView(); f.update();
	assert.equal(control.hierarchy.hasView, false);
	assert.ok(control.details.hasView && control.details.controls[0] === field && view.authoring.selection === selection);
	assert.equal(control.inputScope.contextGeneration, rootGeneration);
	assert.equal(control.details.inputScope.contextGeneration, detailsGeneration);
	assert.ok(inputFocus.admittedTarget === field.field.focusTarget);
	assert.equal(field.pending, true); assert.equal(field.field.text, '31'); assert.equal(f.model.buffer.getText(), SOURCE);
	f.key('Enter');
	assert.equal(field.pending, false); assert.equal(f.model.buffer.getText(), SOURCE.replace('x = 1,', 'x = 31,'));
	assert.equal(control.hierarchy.hasView, false); assert.equal(control.details.inputScope.contextGeneration, detailsGeneration);
	const selected = view.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === view.authoring.document!.scenes[0].objects[0]);
});

test('attached Scene restoration cannot clear a newer member selected by source-retirement publication', async t => {
	const f = await fixture(t), { control, view, model } = f, context = view.authoring;
	const navigation = new SceneEditorNavigationSelection(view); t.after(() => navigation.dispose());
	let published = false;
	const release = context.onDidChangeSelection(() => {
		if (published || context.selection !== undefined) return;
		published = true;
		const document = context.document!, scene = document.scenes[0];
		assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 }), true);
	}); t.after(release);
	const range = { ...context.selectionRange };
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: 'nil' }]);
	control.restoreSelection(navigation);
	assert.equal(published, true);
	const selected = context.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === context.document!.scenes[0].objects[1]);
	assert.ok(view.details.projection.subject?.selection === selected && control.view === view);
});

test('Scene restoration cannot replace the active region chosen by its selection-publication callback', async t => {
	const f = await fixture(t), { control, view, model } = f, context = view.authoring;
	const navigation = new SceneEditorNavigationSelection(view); t.after(() => navigation.dispose());
	f.key('ArrowDown'); assert.equal(control.details.focus(), true);
	let published = false;
	const release = context.onDidChangeSelection(() => {
		const selection = context.selection;
		if (published || selection?.kind !== 'member' || selection.index !== 0) return;
		published = true;
		const document = context.document!, scene = document.scenes[0];
		assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 }), true);
		assert.equal(control.details.focus(), true);
	}); t.after(release);
	control.restoreSelection(navigation);
	assert.equal(published, true);
	const selected = context.selection;
	assert.ok(selected?.kind === 'member' && selected.entry === context.document!.scenes[0].objects[1]);
	assert.ok(inputFocus.admittedTarget === control.details.commandTarget);
	assert.equal(view.section, 'details', 'the older bookmark cannot overwrite a newer actual region interaction');
	assert.equal(model.buffer.getText(), SOURCE);
});

test('explicit Scene definition admission preserves a newer Scene selected by its source producer', async t => {
	const source = SOURCE.replace('return {}', "scenes.register('other', { objects = { { member_id = 'third', definition_id = 'actor.third' } } })\nreturn {}");
	const f = await fixture(t, source), { control, view, model } = f, context = view.authoring;
	const root = context.captureSourceReference().selected!.root;
	const untrack = model.trackRanges(new Map([['requested Scene', root]])); t.after(untrack);
	let published = false;
	const release = context.onDidChangeSelection(() => {
		if (published || context.selection !== undefined) return;
		published = true;
		const document = context.document!;
		assert.equal(context.select(document, model.version, { kind: 'scene', scene: document.scenes[1] }), true);
	}); t.after(release);
	const range = { ...context.selectionRange };
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: 'nil' }]);
	f.editor.sceneEditor.openDefinition(f.firstGroup, model.resource, root);
	assert.equal(published, true);
	const selected = context.selection;
	assert.ok(selected?.kind === 'scene' && selected.scene === context.document!.scenes[1]);
	assert.ok(f.firstGroup.panes.activePane === f.client && control.view === view);
	assert.equal(model.buffer.getText(), source.slice(0, range.start) + 'nil' + source.slice(range.end));
});

test('a prepared Scene definition cannot replace a newer member or its Details reading state at receiver handoff', async t => {
	const options = Array.from({ length: 24 }, (_, index) => `option_${index} = ${index}`).join(', ');
	const source = SOURCE.replace('strength = 8', `strength = 8, ${options}`)
		.replace('return {}', "scenes.register('other', { objects = { { member_id = 'third', definition_id = 'actor.third' } } })\nreturn {}");
	const f = await fixture(t, source), { control, view, model } = f, context = view.authoring;
	const document = context.document!, range = luaSourceRangeToTextRange(model.buffer, document.scenes[1].range);
	const prepared = f.editor.sceneEditor.prepareDefinition(f.firstGroup, model, range);
	assert.ok(prepared !== undefined && prepared.options?.navigationSelection !== undefined);
	try {
		const scene = document.scenes[0];
		assert.equal(context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 }), true);
		assert.equal(control.details.focus(), true); f.update();
		view.details.viewport.scrollbar.setScroll(27); control.update();
		const scroll = view.details.viewport.scrollTop; assert.ok(scroll > 0);
		f.firstGroup.openEditor(prepared.input, prepared.options);
		const selected = context.selection;
		assert.ok(selected?.kind === 'member' && selected.entry === scene.objects[1]);
		assert.equal(view.section, 'details'); assert.equal(view.details.viewport.scrollTop, scroll);
		assert.ok(inputFocus.admittedTarget === control.details.commandTarget && f.firstGroup.panes.activePane === f.client);
		assert.equal(model.buffer.getText(), source);
	} finally { prepared.dispose?.(); }
});
