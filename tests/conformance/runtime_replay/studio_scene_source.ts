import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { createTestToolingPackage } from '../../helpers/runtime_sources';
import { createScenarioTestSourceRecord } from '../../helpers/scenario_sources';
import { SCENE_AUTHORING_SOURCE } from '../../fixtures/studio/scene_authoring';
import { check, type StudioFixture } from './studio_fixture';

/** Test setup admits source-only data; subsequent interactions use ordinary Studio controls. */
export async function openSceneFixture(test: StudioFixture, name: string) {
	const root = `tests/fixtures/studio/scene-authoring/${name}`;
	const registry = createLuaSourceRegistry(root, 'scene.lua');
	for (const [path, source, generated] of [
		['scene.lua', SCENE_AUTHORING_SOURCE, false],
		['readonly.lua', SCENE_AUTHORING_SOURCE, true],
		['cartlib/world/scene_library.lua', 'return {}', false],
	] as const) registerLuaSourceRecord(registry, {
		...createScenarioTestSourceRecord(path, 1, source, `${root}/${path}`), generated,
	});
	const catalog = test.ide.sources.catalog;
	const context = catalog.admitContext({ admission: { id: `fixture-studio-scene-${name}`, projectRoot: root },
		programDomain: 'cart', systemContextId: null, luaSources: registry,
		sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [] });
	const resource = catalog.resolveResource({ contextId: context.id, path: 'scene.lua' })!;
	await test.ide.editor.navigation.openResource(test.ide.editor.editorParts.editorDestination(test.ide.editor.editorParts.activeGroup), resource);
	const model = test.harness.getActiveEditorDocument().model;
	const scene = await openSceneEditor(test);
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
	if (!test.ide.editor.menubar.expanded) await test.click(editorChromeState.menuButtonBounds);
	test.movePointer(editorChromeState.menuEntryBounds.tools);
	await test.frame();
	check(test.ide.editor.menubar.activeMenu === 'tools', 'scene: the visible Tools entry opens its menu');
	const item = test.ide.editor.contextMenu.model.rows.find(row => row.command === 'sceneEditor')!;
	check(item.enabled, 'scene: the actual Tools menu admits the selected source document');
	await test.clickContextCommand(item.command!);
	const input = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (input.kind !== 'scene_editor') throw new Error('scene: Tools command must open the Scene Editor');
	return input;
}

export async function selectSceneRow(test: StudioFixture, input: SceneEditorInput, index: number): Promise<void> {
	const row = input.view.outline.rows[index];
	check(row !== undefined, 'scene: selection requires an actual authored row');
	const layout = input.view.outline.layout;
	const top = layout.contentTop + (index - input.view.outline.scroll) * layout.rowHeight;
	await test.click({ left: layout.contentLeft, right: layout.contentRight, top, bottom: top + layout.rowHeight });
	check(input.view.outline.rows[input.view.outline.selectionIndex] === row, 'scene: pointer selection addresses the requested authored row');
}

export async function selectMember(test: StudioFixture, input: SceneEditorInput, index: number, sceneIndex = 0): Promise<void> {
	const member = input.view.outline.roots[sceneIndex].children[index];
	await selectSceneRow(test, input, input.view.outline.rows.indexOf(member));
}

/** Field drafts, history and same-kind pane reuse over an independent source fixture. */
export async function testSceneSourceEdits(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, readonlyResource, close } = await openSceneFixture(test, 'values');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('scene: actual field controls required');
	const x = pane.control.controls[0], property = scene.view.properties[0];
	const range = scene.view.authoring.document!.analysis.chunk.locations.range(property.field!.value.span);
	const start = model.buffer.offsetAt(range.start.line - 1, range.start.column - 1);
	const end = model.buffer.offsetAt(range.end.line - 1, range.end.column);
	const grouped = '-( --[[source-owned anchor]]\n\t0)';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: grouped }]);
	await frame();
	const authored = model.buffer.getText();
	await click(scene.view.properties[0].bounds);
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
	await click(scene.view.properties[0].bounds); await press('Minus'); await press('Enter');
	check(x.pending && x.field.focusTarget.hasFocus && model.buffer.getText() === expected, 'scene: invalid acceptance retains the actual draft without a source write');
	await press('Escape');
	await click(scene.view.properties[0].bounds); await press('Digit9');
	await click(scene.view.actionBar.items.find(item => item.command === 'editor.source')!.bounds);
	check(ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor'
		&& test.harness.getActiveEditorDocument().model === model, 'scene: Source opens the exact canonical document after accepting its departing field');
	check(model.buffer.getText() === expected.replace('\t17)', '\t09)'), 'scene: Source admission accepts only the selected member value');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected, 'scene: code and visual controls share Undo history');
	check(await openSceneEditor(test) === scene, 'scene: returning to the document reuses its retained view');
	await selectMember(test, scene, 2);
	await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), readonlyResource);
	const readonlyScene = await openSceneEditor(test), readonlyModel = readonlyScene.workingCopy;
	await selectMember(test, readonlyScene, 2);
	check(pane.control.controls.every(control => control.field.readOnly), 'scene: read-only attachment revokes previous writable controls');
	for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown'] as const)
		check(!ide.editor.commands.isEnabled(command), 'scene: read-only membership rejects structural mutations');
	await press('Tab'); await press('Digit7');
	check(readonlyModel.buffer.getText() === SCENE_AUTHORING_SOURCE && model.buffer.getText() === expected,
		'scene: reusing the pane cannot redirect a write into the previous source');
	await ide.editor.navigation.openResource(ide.editor.editorParts.editorDestination(ide.editor.editorParts.activeGroup), model.resource);
	await openSceneEditor(test); await selectMember(test, scene, 2);
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'scene: fixture setup and accepted edits leave no dirty source outside this case');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'scene: source-only authoring never executes or installs a cartridge');
	await close();
}
