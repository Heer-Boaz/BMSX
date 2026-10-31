import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import type { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import type { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import type { SceneHierarchyControl } from '../../ide/workbench/contrib/scene_editor/hierarchy_control';
import type { SceneSourceObject } from '../../ide/workbench/contrib/scene_editor/model';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import type { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { readLuaNumberExpression } from '../../toolchain/ts/lua/syntax/number_expression';
import { createActualSourcePanes } from '../helpers/source_panes';

const POSES = `return { dock = { 1, 0, 0, 1, 10, 20 } }\n`;
const PREFABS = `local prefab = require('cartlib/world/prefab')
prefab.define({ def_id = 'node', class = {}, spatial = { family = '2d', authority = 'affine' } })
return {}
`;
const SOURCE = `local scenes = require('cartlib/world/scene_library')
local poses = require('poses')
require('prefabs')
-- This shared provider and its spelling must not be materialized by member edits.
local carrier_pose = { 1, 0, 0, 1, 100, 200 }
scenes.register('room', { objects = {
 { member_id = 'carrier', definition_id = 'node', spatial = { local_transform = carrier_pose } },
 { member_id = 'subject', definition_id = 'node', spatial = { parent_id = 'carrier', local_transform = { 1, 0, 0, 1, 2, 3 } } },
 { member_id = 'leaf', definition_id = 'node', spatial = { parent_id = 'subject', local_transform = { 1, 0, 0, 1, 4, 5 } } },
 { member_id = 'dock', definition_id = 'node', spatial = { local_transform = poses.dock } },
 { member_id = 'spare', definition_id = 'node', spatial = { local_transform = { 1, 0, 0, 1, 7, 8 } } },
} })
-- Equal member IDs in another Scene never confer edit authority.
scenes.register('elsewhere', { objects = {
 { member_id = 'carrier', definition_id = 'node', spatial = { local_transform = { 1, 0, 0, 1, 30, 40 } } },
 { member_id = 'leaf', definition_id = 'node', spatial = { parent_id = 'carrier', local_transform = { 1, 0, 0, 1, 6, 7 } } },
} })
return {}
`;

async function fixture(t: TestContext, placement: 'document' | 'Main' = 'document') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['poses.lua', POSES], ['prefabs.lua', PREFABS],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/world/prefab.lua', 'return { define=function() end }']]);
	f.editor.setFontVariant('tiny'); f.first.focus();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const sourceInput = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.secondGroup.openEditor(sourceInput);
	let context: SceneAuthoringContext, hierarchy: SceneHierarchyControl, details: SceneDetailsControl;
	let picker: QuickInputController, commandTarget: InputFocusTarget;
	if (placement === 'Main') {
		const document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
		f.update();
		const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
		context = primary.consumer; hierarchy = primary.hierarchy.control; details = primary.details.control;
		picker = f.editor.quickInput; commandTarget = primary.commandTarget;
	} else {
		f.editor.sceneEditor.openResource(f.firstGroup, resource); f.update();
		const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof SceneEditorPane);
		context = pane.control.view.authoring; hierarchy = pane.control.hierarchy; details = pane.control.details;
		picker = f.firstPart.quickInput; commandTarget = pane.control.focusTarget;
	}
	return { ...f, model, resource, sourceInput, context, hierarchy, details, picker, commandTarget };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

function member(f: Fixture, id: string, sceneIndex = 0): SceneSourceObject {
	f.context.refresh();
	const entry = f.context.document!.scenes[sceneIndex].objects.find(entry => entry.kind === 'object' && stringLiteralValue(entry.memberId) === id);
	assert.ok(entry?.kind === 'object'); return entry;
}

/** Navigate to an exact authored occurrence, not a rendered label or a fixed row number. */
function selectMember(f: Fixture, id: string): void {
	f.update(); const entry = member(f, id);
	assert.equal(f.hierarchy.focus(), true); f.key('Home');
	const index = f.hierarchy.view.outline.rows.findIndex(row => row.element.kind === 'member' && row.element.entry === entry);
	assert.ok(index >= 0);
	for (let step = 0; step < index; step++) f.key('ArrowDown');
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === entry);
}

/** The actual focused TextInputTarget owns editing; filtering stays QuickInput-owned. */
function enterText(f: Fixture, text: string): void {
	const target = f.editor.textTarget; assert.ok(target !== undefined);
	assert.equal(target.replaceText(0, target.readText().text.length, text), true); f.update();
}

function paletteCommand(f: Fixture, command: EditorCommandId): void {
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const palette = f.editor.quickInput; assert.equal(palette.visible, true);
	enterText(f, command);
	assert.ok(palette.model.list.rows[palette.model.list.selectionIndex]?.item !== undefined);
	assert.equal((palette.model.list.rows[palette.model.list.selectionIndex].item as CommandQuickPickItem).command, command);
	f.key('Enter');
}

function contextCommand(f: Fixture, command: EditorCommandId): void {
	f.key('ContextMenu'); const menu = f.editor.contextMenu; assert.equal(menu.visible, true);
	assert.ok(menu.model.rows.some(row => row.command === command && row.enabled));
	// Skip disabled entries and separators through the real menu's navigation.
	for (let step = 0; menu.model.rows[menu.model.selectedIndex]?.command !== command && step < menu.model.rows.length; step++) f.key('ArrowDown');
	assert.equal(menu.model.rows[menu.model.selectedIndex].command, command); f.key('Enter');
}

function coefficients(entry: SceneSourceObject): readonly (number | null)[] {
	assert.ok(entry.spatial?.coefficients !== null && entry.spatial?.coefficients !== undefined);
	return entry.spatial.coefficients.map(field => readLuaNumberExpression(field.value));
}

function assertProvidersUnchanged(f: Fixture): void {
	const source = f.model.buffer.getText();
	assert.ok(source.includes('local carrier_pose = { 1, 0, 0, 1, 100, 200 }'));
	assert.ok(source.includes('local_transform = carrier_pose') && source.includes('local_transform = poses.dock'));
	assert.ok(source.endsWith(SOURCE.slice(SOURCE.indexOf('-- Equal member IDs'))));
	assert.ok(f.sourceInput instanceof CodeEditorInput && f.sourceInput.workingCopy === f.model);
	assert.ok(f.secondGroup.model.activeTab === f.sourceInput);
}

for (const [command, placement, expected] of [
	['sceneEditor.reparentMember', 'document', [1, 0, 0, 1, 92, 183]],
	['sceneEditor.reparentMemberKeepLocal', 'Main', [1, 0, 0, 1, 2, 3]],
] as const) test(`${placement} Scene ${command} filters and accepts a source parent with its explicit placement policy`, async t => {
	const f = await fixture(t, placement); selectMember(f, 'subject');
	paletteCommand(f, command); assert.equal(f.picker.visible, true);
	assert.ok(inputFocus.admittedTarget === f.picker.field.focusTarget);
	enterText(f, 'leaf'); assert.equal(f.picker.model.list.rows.length, 0, 'a descendant is not an admissible parent');
	enterText(f, 'dock'); assert.equal(f.picker.model.list.rows.length, 1); f.key('Enter');
	assert.equal(f.picker.visible, false);
	const subject = member(f, 'subject');
	assert.equal(stringLiteralValue(subject.spatial!.parentId!.value), 'dock');
	assert.deepEqual(coefficients(subject), expected);
	const parent = f.context.getSpatialParents(f.context.document!.scenes[0]);
	assert.equal(parent.get(subject), member(f, 'dock'));
	assert.equal(parent.get(member(f, 'leaf')), subject);
	assertProvidersUnchanged(f);
	// Exact bytes after one Undo prove that the parent link and affine are one canonical edit.
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('Escape cancels both Scene parent choice and rename without source or history changes', async t => {
	const f = await fixture(t); selectMember(f, 'subject');
	for (const command of ['sceneEditor.reparentMember', 'sceneEditor.renameMember'] as const) {
		paletteCommand(f, command); assert.equal(f.picker.visible, true); enterText(f, 'not accepted'); f.key('Escape');
		assert.equal(f.picker.visible, false); assert.equal(f.model.buffer.getText(), SOURCE);
		assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
		assert.ok(inputFocus.admittedTarget === f.hierarchy.focusTarget);
		assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === member(f, 'subject'));
	}
});

test('actual Scene rename rejects an occupied identity and changes only the admitted member and its parent references', async t => {
	const f = await fixture(t); selectMember(f, 'subject'); contextCommand(f, 'sceneEditor.renameMember');
	assert.equal(f.picker.visible, true); assert.equal(f.picker.inputBox, true);
	enterText(f, 'dock'); f.key('Enter'); await setImmediate(); f.update();
	assert.equal(f.picker.visible, true); assert.equal(f.picker.busy, false); assert.equal(f.model.buffer.getText(), SOURCE);
	enterText(f, 'renamed'); f.key('Enter'); await setImmediate(); f.update();
	assert.equal(f.picker.visible, false);
	assert.equal(stringLiteralValue(member(f, 'leaf').spatial!.parentId!.value), 'renamed');
	assert.deepEqual(coefficients(member(f, 'renamed')), [1, 0, 0, 1, 2, 3]);
	assertProvidersUnchanged(f);
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('normal Scene removal roots surviving children at their previous world pose', async t => {
	const f = await fixture(t); selectMember(f, 'subject'); contextCommand(f, 'sceneEditor.removeMember');
	const scene = f.context.document!.scenes[0], leaf = member(f, 'leaf');
	assert.equal(scene.objects.length, 4); assert.equal(leaf.spatial!.parentId, null);
	assert.deepEqual(coefficients(leaf), [1, 0, 0, 1, 106, 208]);
	assert.equal(f.context.getSpatialParents(scene).get(leaf), undefined); assertProvidersUnchanged(f);
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('explicit Scene subtree removal deletes only source descendants of the selected occurrence', async t => {
	const f = await fixture(t); selectMember(f, 'subject'); contextCommand(f, 'sceneEditor.removeSubtree');
	f.context.refresh();
	assert.deepEqual(f.context.document!.scenes[0].objects.map(entry => entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined), ['carrier', 'dock', 'spare']);
	assertProvidersUnchanged(f);
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('Scene mutation pickers cannot retarget the member selected by accepted-picker focus return', async t => {
	const f = await fixture(t);
	for (const command of ['sceneEditor.reparentMember', 'sceneEditor.renameMember'] as const) {
		selectMember(f, 'subject'); paletteCommand(f, command); enterText(f, command === 'sceneEditor.reparentMember' ? 'dock' : 'renamed');
		let replaced = false;
		const release = f.hierarchy.focusTarget.onDidFocus(() => {
			release(); replaced = true;
			const entry = member(f, 'spare');
			const index = f.hierarchy.view.outline.rows.findIndex(row => row.element.kind === 'member' && row.element.entry === entry);
			assert.equal(selectSceneOutlineRow(f.hierarchy.view, index), true);
		}); t.after(release);
		f.key('Enter'); await setImmediate(); f.update();
		assert.equal(replaced, true); assert.equal(f.picker.visible, false);
		assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === member(f, 'spare'));
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	}
});

for (const command of ['sceneEditor.reparentMember', 'sceneEditor.renameMember'] as const)
test(`canonical Scene and pose-dependency changes retire an already open ${command} interaction`, async t => {
	const f = await fixture(t); selectMember(f, 'subject'); paletteCommand(f, command); enterText(f, 'dock');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer canonical source\n' }]); f.update();
	assert.equal(f.picker.visible, false); assert.equal(f.model.buffer.getText(), '-- newer canonical source\n' + SOURCE);
	f.editor.commands.execute('undo', f.commandTarget); f.update(); selectMember(f, 'subject');
	paletteCommand(f, command); enterText(f, 'dock');
	const poses = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'poses.lua' })!);
	poses.pushEditOperations([{ offset: 0, deleteLength: POSES.length, text: POSES.replace('10, 20', '50, 60') }]); f.update();
	assert.equal(f.picker.visible, false); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('replacing and restoring a document Scene attachment never revives its older picker', async t => {
	const f = await fixture(t); selectMember(f, 'subject'); paletteCommand(f, 'sceneEditor.reparentMember'); enterText(f, 'dock');
	const sceneInput = f.firstGroup.model.activeTab!;
	f.firstGroup.openEditor(f.firstInput); f.update();
	assert.equal(f.picker.visible, false);
	f.firstGroup.openEditor(sceneInput); f.update();
	assert.equal(f.picker.visible, false); f.key('Enter');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	assert.equal(f.editor.commands.isEnabled('sceneEditor.reparentMember', f.commandTarget), true);
});

test('provider-only Scene topology replacement measures its new nodes once at unchanged source and bounds', async t => {
	const f = await fixture(t); selectMember(f, 'subject');
	const view = f.hierarchy.view, entry = member(f, 'subject');
	const previous = view.outline.rows.find(row => row.element.kind === 'member' && row.element.entry === entry)!;
	const sourceVersion = f.model.version, authoringRevision = f.context.revision;
	assert.notEqual(previous.element.displayLabel, '');
	const prefabs = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'prefabs.lua' })!);
	prefabs.pushEditOperations([{ offset: 0, deleteLength: PREFABS.length, text: PREFABS.replace("authority = 'affine'", "authority = 'root_origin'") }]); f.update();
	const next = view.outline.rows.find(row => row.element.kind === 'member' && row.element.entry === entry)!;
	assert.notEqual(next, previous); assert.equal(f.model.version, sourceVersion); assert.equal(f.context.revision, authoringRevision);
	// A new projected caption needs layout even when its owning Scene source and control bounds did not change.
	assert.notEqual(next.element.displayLabel, '');
	const rows = [...view.outline.rows];
	f.update(); f.update();
	assert.ok(rows.every((row, index) => view.outline.rows[index] === row), 'stable frames reuse their admitted projection rather than rebuilding it');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('Scene command execution settles its concrete Details draft before admitting the parent picker', async t => {
	const f = await fixture(t); selectMember(f, 'subject');
	const field = f.details.controls[0]; assert.equal(field.field.focusTarget.focus(), true); enterText(f, '31');
	assert.equal(field.pending, true); assert.equal(f.model.buffer.getText(), SOURCE);
	f.editor.commands.execute('sceneEditor.reparentMember', f.commandTarget);
	assert.equal(field.pending, false); assert.equal(f.picker.visible, true);
	assert.deepEqual(coefficients(member(f, 'subject')), [1, 0, 0, 1, 31, 3]);
	enterText(f, 'dock'); f.key('Enter');
	assert.deepEqual(coefficients(member(f, 'subject')), [1, 0, 0, 1, 121, 183]);
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.deepEqual(coefficients(member(f, 'subject')), [1, 0, 0, 1, 31, 3]);
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	selectMember(f, 'subject');
	const nextField = f.details.controls[0]; assert.equal(nextField.field.focusTarget.focus(), true); enterText(f, '55');
	let published = false;
	const release = f.model.onDidChangeContent(() => {
		release(); published = true; f.hierarchy.view.refresh();
		const entry = member(f, 'spare');
		const index = f.hierarchy.view.outline.rows.findIndex(row => row.element.kind === 'member' && row.element.entry === entry);
		assert.equal(selectSceneOutlineRow(f.hierarchy.view, index), true);
	}); t.after(release);
	f.editor.commands.execute('sceneEditor.reparentMember', f.commandTarget);
	assert.equal(published, true); assert.equal(nextField.pending, false); assert.equal(f.picker.visible, false);
	assert.deepEqual(coefficients(member(f, 'subject')), [1, 0, 0, 1, 55, 3]);
	assert.deepEqual(coefficients(member(f, 'spare')), [1, 0, 0, 1, 7, 8]);
	f.editor.commands.execute('undo', f.commandTarget); f.update(); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('Scene sibling moves skip interleaved descendants and other roots while retaining the selected source occurrence', async t => {
	const f = await fixture(t);
	const before = SOURCE.replace("{ member_id = 'spare', definition_id = 'node', spatial = {", "{ member_id = 'spare', definition_id = 'node', spatial = { parent_id = 'carrier',");
	f.model.pushEditOperations([{ offset: 0, deleteLength: SOURCE.length, text: before }]); f.update();
	selectMember(f, 'subject'); contextCommand(f, 'sceneEditor.moveMemberDown');
	const scene = f.context.document!.scenes[0], subject = member(f, 'subject');
	assert.deepEqual(scene.objects.map(entry => entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined),
		['carrier', 'leaf', 'dock', 'spare', 'subject']);
	const parents = f.context.getSpatialParents(scene);
	assert.equal(parents.get(subject), member(f, 'carrier')); assert.equal(parents.get(member(f, 'leaf')), subject);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === subject);
	assert.equal(f.hierarchy.view.outline.rows[f.hierarchy.view.outline.selectionIndex].element.kind, 'member');
	f.editor.commands.execute('undo', f.commandTarget); f.update();
	// Exact canonical bytes are the source-move/one-Undo integrity contract, not a UI wording assertion.
	assert.equal(f.model.buffer.getText(), before);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === member(f, 'subject'));
});

test('passive source selection retains nested disclosure until an explicit hierarchy reveal', async t => {
	const f = await fixture(t); selectMember(f, 'carrier'); f.key('ArrowLeft');
	const scene = f.context.document!.scenes[0], leaf = member(f, 'leaf');
	assert.equal(f.context.select(f.context.document!, f.model.version,
		{ kind: 'member', scene, entry: leaf, index: scene.objects.indexOf(leaf) }), true);
	f.hierarchy.update();
	const rows = f.hierarchy.view.outline.rows, carrier = member(f, 'carrier');
	assert.equal(rows.find(row => row.element.kind === 'member' && row.element.entry === carrier)!.collapsed, true);
	assert.equal(rows.some(row => row.element.kind === 'member' && row.element.entry === leaf), false);
	assert.equal(f.hierarchy.view.outline.selectionIndex, -1);
	f.hierarchy.revealSelection();
	const selected = f.hierarchy.view.outline.rows[f.hierarchy.view.outline.selectionIndex].element;
	assert.ok(selected.kind === 'member' && selected.entry === leaf);
	assert.equal(selected.index, scene.objects.indexOf(leaf));
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('the parent picker distinguishes a legal root-named member from removing its parent', async t => {
	const f = await fixture(t), source = SOURCE.replace("member_id = 'spare'", "member_id = 'Scene Root'");
	f.model.pushEditOperations([{ offset: 0, deleteLength: SOURCE.length, text: source }]); f.update();
	selectMember(f, 'subject'); paletteCommand(f, 'sceneEditor.reparentMember'); enterText(f, 'Scene Root');
	const rows = f.picker.model.list.rows;
	assert.equal(rows.length, 2);
	// Presentation metadata must distinguish two different source operations even when their labels coincide.
	assert.equal(rows[0].item.label, rows[1].item.label);
	assert.notEqual(rows[0].item.description, rows[1].item.description);
	const parent = member(f, 'Scene Root'), choice = f.context.captureReparent()!.choices.find(choice => choice.parent === parent)!;
	const index = rows.findIndex(row => row.item.description === choice.description); assert.ok(index >= 0);
	for (let step = 0; step < index; step++) f.key('ArrowDown');
	f.key('Enter');
	assert.equal(stringLiteralValue(member(f, 'subject').spatial!.parentId!.value), 'Scene Root');
	f.editor.commands.execute('undo', f.commandTarget); f.update(); assert.equal(f.model.buffer.getText(), source);
});
