import type { RuntimeResource } from '../../../ide/common/resource';
import { inputFocus } from '../../../ide/input/focus';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { ResourceQuickPickItem } from '../../../ide/workbench/contrib/resources/quick_access';
import type { EditorGroupView } from '../../../ide/workbench/services/editor/editor_group';
import { check, type StudioFixture } from './studio_fixture';
import { openSceneFixture } from './studio_scene_source';

/** Resolve one synthetic resource through ordinary Go to File in its receiving native group. */
async function openFile(test: StudioFixture, group: EditorGroupView, resource: RuntimeResource, beside = false) {
	await test.runPaletteCommand('Window: Focus Main Workspace');
	for (let step = 0; test.ide.editor.editorParts.activeGroup !== group && step < test.ide.editor.editorParts.groups.length; step++)
		await test.runPaletteCommand('Editor Groups: Focus Next Group');
	check(test.ide.editor.editorParts.activeGroup === group && inputFocus.admittedTarget !== null && group.focusScope.contains(inputFocus.admittedTarget.scope),
		'batch close: the receiving group owns native input before Go to File');
	await test.runPaletteCommand('Go: Go to File');
	await test.clipboard.writeText(resource.path); await test.press('ControlLeft', 'KeyV');
	const index = test.ide.editor.quickInput.model.list.rows.findIndex(row => (row.item as ResourceQuickPickItem).resource === resource);
	check(index >= 0, 'batch close: the admitted synthetic file is an exact native file choice');
	for (let row = 0; row < index; row++) await test.press('ArrowDown');
	if (beside) await test.press('AltLeft', 'Enter'); else await test.press('Enter');
	await test.until(() => {
		const receiver = test.ide.editor.editorParts.activeGroup;
		return (beside ? receiver !== group : receiver === group) && receiver.model.activeTab?.kind === 'code_editor'
			&& receiver.model.activeTab.resource === resource && inputFocus.admittedTarget === receiver.panes.activePane?.commandTarget;
	},
		'batch close: ordinary file navigation completes in the intended concrete group');
	return test.ide.editor.editorParts.activeGroup.model.activeTab!;
}

/** Local closure preserves other documents; global closure retires Scene companions with their owning input. */
export async function testStudioBatchClose(test: StudioFixture): Promise<void> {
	const editor = test.ide.editor, parts = editor.editorParts, panel = editor.resourcePanel;
	const originalGroups = new Set(parts.groups);
	const { resource, close } = await openSceneFixture(test, 'batch-close', [
		['batch_alpha.lua', 'return { alpha = true }\n'], ['batch_beta.lua', 'return { beta = true }\n'],
	]);
	await close();
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await test.frame();
	await test.press('ArrowRight'); await test.press('ArrowDown'); await test.press('ContextMenu');
	await test.clickContextCommand('resources.open');
	await test.until(() => {
		const primary = editor.mainWorkspace.primary;
		return primary instanceof ScenePrimaryClient && primary.input.resource === resource;
	}, 'Files: the exact Scene document admits its authoring companions');
	const primary = editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('batch close: the synthetic Scene must own its real Main presentation');
	const model = primary.authoring.workingCopy;
	await test.runPaletteCommand('Editor: Open Source');
	await test.until(() => parts.activeGroup.model.activeTab?.kind === 'code_editor' && parts.activeGroup.model.activeTab.resource === resource,
		'batch close: Main opens its canonical Source as an ordinary independent document');
	const mainGroup = parts.activeGroup;
	await openFile(test, mainGroup, resource, true);
	const side = parts.activeGroup, groups = [...parts.groups], documents = [...parts.documents];
	check(mainGroup.model.activeTab !== side.model.activeTab && mainGroup.model.activeTab?.kind === 'code_editor'
		&& side.model.activeTab?.kind === 'code_editor' && mainGroup.model.activeTab.workingCopy === side.model.activeTab.workingCopy,
		'batch close: explicit views share one canonical model without duplicating input ownership');
	await test.runPaletteCommand('View: Problems Panel');
	const activity = editor.mainWorkspace.activity, activityDisplayed = editor.mainWorkspace.activityDisplayed;
	const alpha = test.ide.sources.catalog.resolveResource({ contextId: resource.contextId, path: 'batch_alpha.lua' })!;
	const beta = test.ide.sources.catalog.resolveResource({ contextId: resource.contextId, path: 'batch_beta.lua' })!;
	const media = test.ide.sources.currentBlua32Media, cycles = test.cycles(), source = model.buffer.getText(), version = model.version;
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('Window: Focus Main Workspace');
			await test.runPaletteCommand('Editor Groups: Focus Previous Group');
			const keeper = await openFile(test, mainGroup, alpha);
			const selected = await openFile(test, mainGroup, beta);
			const files = JSON.stringify(panel.serialize());
			// Native tab focus reveals the inactive keeper without activating its document.
			await test.runPaletteCommand('Editor Groups: Focus Editor Tabs'); await test.press('Home');
			for (let index = 0; index < mainGroup.model.indexOf(keeper); index++) await test.press('ArrowRight');
			const bounds = mainGroup.tabStrip.layoutState.items.peek(mainGroup.model.indexOf(keeper)).bounds;
			const clip = mainGroup.tabStrip.layoutState.viewportBounds;
			await test.click({ left: Math.max(bounds.left, clip.left), right: Math.min(bounds.right, clip.right), top: bounds.top, bottom: bounds.bottom },
				1, 'pointer_secondary');
			check(editor.contextMenu.visible && mainGroup.model.activeTab === selected
				&& editor.contextMenu.model.rows.some(row => row.command === 'tabs.closeOthers' && row.enabled),
				'batch close: right-click captures the exact inactive keeper without selecting it');
			await test.capture?.(`batch-close-${editor.fontVariant}-theme-${theme}-others-menu`);
			await test.clickContextCommand('tabs.closeOthers');
			await test.until(() => mainGroup.model.tabs.length === 1, 'batch close: the native context request closes its exact other views');
			check(mainGroup.model.activeTab === keeper && mainGroup.model.tabs[0] === keeper && mainGroup.model.previewTab === null
				&& side.model.tabs.every(input => !mainGroup.model.contains(input)) && JSON.stringify(panel.serialize()) === files,
				'batch close: the context keeper is pinned once, not the previously active editor or a duplicated side view');
			await openFile(test, mainGroup, beta);
			await test.runPaletteCommand('Editor Groups: Focus Editor Tabs'); await test.press('ContextMenu');
			check(editor.contextMenu.visible && editor.contextMenu.invocationOrigin === mainGroup.tabStrip.focusTarget
				&& editor.contextMenu.model.rows.some(row => row.command === 'tabs.closeAll' && row.enabled),
				'batch close: keyboard tab context owns its concrete local Close All capability');
			await test.clickContextCommand('tabs.closeAll');
			await test.until(() => mainGroup.model.tabs.length === 0, 'batch close: the invoking group contents retire through the normal close owner');
			check(parts.groups.length === groups.length && groups.every(group => parts.groups.includes(group))
				&& !mainGroup.surface.retired && editor.mainWorkspace.primary === primary,
				'batch close: closing all local views keeps the concrete group and independent Main subject alive');
			await openFile(test, mainGroup, alpha);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	const beforeGlobalFiles = JSON.stringify(panel.serialize());
	await test.runPaletteCommand('Workspace: Focus Hierarchy');
	await test.runPaletteCommand('Editor: Close All Editors');
	await test.until(() => parts.groups.every(group => group.model.tabs.length === 0),
		'batch close: the workspace request closes document inputs across every concrete group');
	check(parts.groups.length === groups.length && groups.every(group => parts.groups.includes(group) && !group.surface.retired)
		&& parts.documents.length === documents.length && documents.every(part => parts.documents.includes(part))
		&& editor.mainWorkspace.primary === undefined && !primary.isCurrent() && !primary.hierarchy.attached && !primary.details.attached
		&& editor.mainWorkspace.activity === activity && editor.mainWorkspace.activityDisplayed === activityDisplayed
		&& JSON.stringify(panel.serialize()) === beforeGlobalFiles && model.buffer.getText() === source && model.version === version && !model.dirty
		&& test.ide.sources.currentBlua32Media === media && test.cycles() === cycles,
		'batch close: closing the Scene retires companions while preserving group containers, unrelated readers and canonical source bytes');
	for (const group of [side, mainGroup].filter(group => !originalGroups.has(group))) {
		await test.runPaletteCommand('Window: Focus Main Workspace');
		for (let step = 0; parts.activeGroup !== group && step < parts.groups.length; step++)
			await test.runPaletteCommand('Editor Groups: Focus Next Group');
		check(parts.activeGroup === group, 'batch close: the empty fixture group remains a native focus destination');
		await test.runPaletteCommand('Editor Groups: Close Group');
	}

	await close();
	check(!parts.groups.includes(side) && editor.mainWorkspace.primary === undefined && !model.dirty,
		'batch close: empty group cleanup is separate from document and companion retirement');
}
