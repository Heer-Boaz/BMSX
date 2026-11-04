import type { ProjectContentEntry } from '../../../ide/workbench/contrib/resources/content_index';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { createTestSourceOnlyLuaRecord, createTestToolingPackage } from '../../helpers/runtime_sources';
import { SCENE_AUTHORING_IMPORTS, SCENE_AUTHORING_SOURCE } from '../../fixtures/studio/scene_authoring';
import { check, type StudioFixture } from './studio_fixture';

const READONLY_SCENE_AUTHORING_SOURCE = SCENE_AUTHORING_SOURCE.replaceAll('fixture.', 'readonly.');

/** Test setup admits source-only data; subsequent interactions use ordinary Studio controls. */
export async function openSceneFixture(test: StudioFixture, name: string, additionalSources: readonly (readonly [string, string])[] = []) {
	const root = `tests/fixtures/studio/scene-authoring/${name}`;
	const registry = createLuaSourceRegistry(root, 'scene.lua');
	for (const [path, source, generated] of [
		['scene.lua', SCENE_AUTHORING_SOURCE, false],
		['readonly.lua', READONLY_SCENE_AUTHORING_SOURCE, true],
		['cartlib/world/scene_library.lua', 'return {}', false],
		...SCENE_AUTHORING_IMPORTS.map(([path, source]) => [path, source, false] as const),
		...additionalSources.map(([path, source]) => [path, source, false] as const),
	] as const) registerLuaSourceRecord(registry, createTestSourceOnlyLuaRecord(path, source, `${root}/${path}`, generated));
	const catalog = test.ide.sources.catalog;
	const context = catalog.admitContext({ admission: { id: `fixture-studio-scene-${name}`, projectRoot: root },
		programDomain: 'cart', systemContextId: null, luaSources: registry,
		sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [] });
	const resource = catalog.resolveResource({ contextId: context.id, path: 'scene.lua' })!;
	await test.ide.editor.navigation.openResource(test.ide.editor.editorParts.editorDestination(test.ide.editor.editorParts.activeGroup), resource);
	const model = test.harness.getActiveEditorDocument().model;
	// This whole-file fixture intentionally admits all declarations through its actual source controller.
	test.ide.editor.sceneEditor.openResource(test.ide.editor.editorParts.activeGroup, resource);
	await test.frame();
	const scene = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (!(scene instanceof SceneEditorInput)) throw new Error('the source fixture must admit an authored Scene document');
	const close = async () => {
		for (const group of test.ide.editor.editorParts.groups) for (const input of [...group.model.tabs]) {
			if (input.resource?.contextId === context.id)
				check(await group.close(input.id), 'scene: a clean fixture retires its temporary editor attachments');
		}
		await test.frame();
	};
	return { model, scene, resource, readonlyResource: catalog.resolveResource({ contextId: context.id, path: 'readonly.lua' })!, close };
}

export async function openSceneEditor(test: StudioFixture): Promise<SceneEditorInput> {
	const resource = test.ide.editor.editorParts.activeGroup.model.activeTab.resource;
	if (!test.ide.editor.menubar.expanded) await test.click(editorChromeState.menuButtonBounds);
	test.movePointer(editorChromeState.menuEntryBounds.tools);
	await test.frame();
	check(test.ide.editor.menubar.activeMenu === 'tools', 'scene: the visible Tools entry opens its menu');
	const item = test.ide.editor.contextMenu.model.rows.find(row => row.command === 'sceneEditor')!;
	check(item.enabled, 'scene: the actual Tools menu admits the selected source document');
	await test.clickContextCommand(item.command!);
	const picker = test.ide.editor.quickInput;
	check(picker.visible, 'scene: Tools opens the authored declaration picker');
	const rows = picker.model.list.rows;
	const selected = rows.findIndex(row =>
		(row.item as QuickPickItem & { entry: Extract<ProjectContentEntry, { kind: 'scene' }> }).entry.ownerResource === resource);
	check(selected >= 0, 'scene: the invoking source contributes an actual Scene declaration');
	await test.press('ControlLeft', 'Home');
	for (let index = 0; index < selected; index++) await test.press('ArrowDown');
	await test.press('Enter');
	await test.until(() => {
		const input = test.ide.editor.editorParts.activeGroup.model.activeTab;
		return input instanceof SceneEditorInput && input.resource === resource;
	}, 'scene: the asynchronous Tools request admits the exact source-owned Scene document');
	const input = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (!(input instanceof SceneEditorInput)) throw new Error('scene: Tools command must open the Scene Editor');
	return input;
}

export async function selectSceneRow(test: StudioFixture, input: SceneEditorInput, index: number): Promise<void> {
	const row = input.view.hierarchy.outline.rows[index];
	check(row !== undefined, 'scene: selection requires an actual authored row');
	const layout = input.view.hierarchy.outline.layout;
	const top = layout.contentTop + (index - input.view.hierarchy.outline.scroll) * layout.rowHeight;
	await test.click({ left: layout.contentLeft, right: layout.contentRight, top, bottom: top + layout.rowHeight });
	check(input.view.hierarchy.outline.rows[input.view.hierarchy.outline.selectionIndex] === row, 'scene: pointer selection addresses the requested authored row');
}

export async function selectMember(test: StudioFixture, input: SceneEditorInput, index: number, sceneIndex = 0): Promise<void> {
	const member = input.view.hierarchy.outline.roots[sceneIndex].children[index];
	await selectSceneRow(test, input, input.view.hierarchy.outline.rows.indexOf(member));
}

/** Field drafts, history and same-kind pane reuse over an independent source fixture. */
export async function testSceneSourceEdits(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, readonlyResource, close } = await openSceneFixture(test, 'values');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('scene: actual field controls required');
	const primary = ide.editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('Scene document must admit its actual companion controls');
	const x = primary.details.control.controls[0], selected = scene.view.authoring.selection!;
	if (selected.kind !== 'member' || selected.entry.kind !== 'object') throw new Error('scene: the selected source occurrence owns its authored origin');
	const range = scene.view.authoring.document!.analysis.chunk.locations.range((selected.entry.position!.value as LuaTableConstructorExpression).fields[0].value.span);
	const start = model.buffer.offsetAt(range.start.line - 1, range.start.column - 1);
	const end = model.buffer.offsetAt(range.end.line - 1, range.end.column);
	const grouped = '-( --[[source-owned anchor]]\n\t0)';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: grouped }]);
	await frame();
	const authored = model.buffer.getText();
	await click(scene.view.details.properties[0].bounds);
	await press('ControlLeft', 'KeyA');
	await press('Digit1'); await press('Digit7');
	check(x.pending && model.buffer.getText() === authored, 'scene: a field draft is not yet a canonical source edit');
	await press('ControlLeft', 'KeyZ');
	check(x.field.text === '1' && x.pending && model.buffer.getText() === authored, 'scene: draft Undo edits its own input, not the source fixture');
	await press('ControlLeft', 'KeyY');
	check(x.field.text === '17' && x.pending, 'scene: draft Redo restores only the unsubmitted input');
	await press('Enter');
	const expected = original.slice(0, start) + '( --[[source-owned anchor]]\n\t17)' + original.slice(end);
	check(model.buffer.getText() === expected, 'scene: acceptance preserves authored grouping and comment bytes');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'scene: document Undo restores the accepted expression in one step');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === expected, 'scene: document Redo uses the same canonical history');
	await click(scene.view.details.properties[0].bounds); await press('Minus'); await press('Enter');
	check(x.pending && x.field.focusTarget.hasFocus && model.buffer.getText() === expected, 'scene: invalid acceptance retains the actual draft without a source write');
	await press('Escape');
	await click(scene.view.details.properties[0].bounds); await press('ControlLeft', 'KeyA'); await press('Digit9');
	await test.runPaletteCommand('Editor: Open Source');
	check(ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor'
		&& test.harness.getActiveEditorDocument().model === model, 'scene: Source opens the exact canonical document after accepting its departing field');
	check(model.buffer.getText() === expected.replace('\t17)', '\t09)'), 'scene: Source admission accepts only the selected member value');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: code and visual controls share Undo history');
	await test.clickTab(scene.id, 1, ide.editor.editorParts.findGroup(scene)!);
	check(ide.editor.editorParts.activeGroup.model.activeTab === scene, 'scene: returning to the document reuses its retained view');
	await selectMember(test, scene, 2);
	await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), readonlyResource);
	const readonlyScene = await openSceneEditor(test), readonlyModel = readonlyScene.workingCopy;
	await selectMember(test, readonlyScene, 2);
	check(primary.details.control.controls.every(control => control.field.readOnly), 'scene: read-only attachment revokes previous writable controls');
	for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown'] as const)
		check(!ide.editor.commands.isEnabled(command), 'scene: read-only membership rejects structural mutations');
	await press('Tab'); await press('Digit7');
	check(readonlyModel.buffer.getText() === READONLY_SCENE_AUTHORING_SOURCE && model.buffer.getText() === expected,
		'scene: reusing the pane cannot redirect a write into the previous source');
	await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), model.resource);
	await test.clickTab(scene.id, 1, ide.editor.editorParts.findGroup(scene)!); await selectMember(test, scene, 2);
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'scene: fixture setup and accepted edits leave no dirty source outside this case');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'scene: source-only authoring never executes or installs a cartridge');
	await close();
}
