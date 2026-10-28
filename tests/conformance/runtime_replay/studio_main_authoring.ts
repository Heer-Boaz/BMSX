import { CallHierarchyInput } from '../../../ide/workbench/contrib/call_hierarchy/editor_input';
import { CALL_HIERARCHY_SOURCE } from '../../fixtures/studio/call_hierarchy';
import { CallHierarchyDirection } from '../../../ide/editor/contrib/call_hierarchy/model';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { UnavailableScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { openSceneFixture } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { WorkspaceSearchInput } from '../../../ide/workbench/contrib/workspace_search/editor_input';
import { WorkspaceSearchPane } from '../../../ide/workbench/contrib/workspace_search/editor_pane';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { inputFocus } from '../../../ide/input/focus';

/** Standalone renderer workflow over a dedicated test cartridge and independent source fixtures. */
export async function runStudioMainAuthoring(test: StudioFixture) {
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'main: dedicated test cartridge starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await testMainSceneAuthoring(test);
	return { hostFrames: test.observations.hostFrames, cycles: test.cycles(), mainAuthoring: 'pass' };
}

/** Explicit source fixture setup, then ordinary Files/menu/keyboard/pointer authoring in the real Workbench. */
export async function testMainSceneAuthoring(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test, editor = ide.editor;
	const panelWasVisible = editor.resourcePanel.isVisible();
	const { model, resource, close } = await openSceneFixture(test, 'main', [['calls.lua', CALL_HIERARCHY_SOURCE]]);
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await close();
	check(editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== resource.contextId)),
		'main: fixture document attachments are closed before primary authoring');

	// Arrangement only reveals the test-owned source. Actual disclosure, declaration selection and opening use UI input.
	const panel = editor.resourcePanel;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await frame();
	check(panel.files.selectedNode?.element.kind === 'file', 'main: Files selects the exact fixture resource');
	await press('ArrowRight'); await press('ArrowDown');
	const occurrence = panel.files.selectedNode?.element;
	check(occurrence?.kind === 'definition' && occurrence.content.kind === 'scene' && occurrence.content.ownerResource === resource,
		'main: ordinary tree navigation selects the authored Scene occurrence');
	await press('ContextMenu');
	await test.clickContextCommand('resources.editInMain');
	const client = editor.mainWorkspace.primary;
	check(client instanceof ScenePrimaryClient, 'main: Files admits the real authored Scene client');
	if (!(client instanceof ScenePrimaryClient)) throw new Error('main: Scene client required');
	check(occurrence?.kind === 'definition' && occurrence.content.kind === 'scene' && client.consumer.subject === occurrence.content.definition,
		'main: primary authoring keeps the exact declaration supplied by Files');
	check(editor.editorParts.groups.every(group => group.model.tabs.every(input => input.resource?.contextId !== resource.contextId)),
		'main: primary authoring creates no hidden document input');
	await press('ControlLeft', 'KeyB');
	check(!panel.isVisible(), 'main: the browser can hide without retiring its admitted primary subject');
	await press('ArrowDown'); await press('Enter'); await press('Home');
	check(client.consumer.selection?.kind === 'member' && client.consumer.selection.index === 0,
		'main: hierarchy navigation selects an actual authored member');
	const field = client.control.controls[0];
	await click(client.view.properties[0].bounds); await press('Digit1'); await press('Digit2');
	check(field.pending && field.field.text === '12' && model.buffer.getText() === original,
		'main: the actual field owns its draft before source publication');
	await press('ControlLeft', 'KeyZ');
	check(field.field.text === '1' && model.buffer.getText() === original, 'main: field Undo cannot undo canonical source');
	await press('ControlLeft', 'KeyY');
	check(field.pending && field.field.text === '12', 'main: field Redo restores the unsubmitted numeric value');

	// Font and theme changes exercise the real retained control, not regenerated test geometry.
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-draft`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
			check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
				'main: theme changes retain the exact draft and context');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
		check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
			'main: font reflow retains the exact draft and context');
	}
	await press('Enter');
	const accepted = original.replace('x = 1,', 'x = 12,');
	check(model.buffer.getText() === accepted && !field.pending && model.dirty,
		'main: acceptance publishes one canonical coordinate edit');
	const selected = { ...client.consumer.selectionRange };
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	const input = editor.editorParts.main.activeGroup.model.activeTab;
	check(input?.kind === 'code_editor' && input.workingCopy === model,
		'main: Source opens the canonical working copy in the ordinary document arrangement');
	await press('ControlLeft', 'End');
	check(editor.mainWorkspace.primary === client && client.consumer.selectionRange.start === selected.start
		&& client.consumer.selectionRange.end === selected.end,
		'main: independent document caret navigation cannot replace primary selection');
	await test.runPaletteCommand('Go: Back');
	const restored = editor.mainWorkspace.primary;
	check(restored instanceof ScenePrimaryClient && restored !== client && restored.consumer.workingCopy === model
		&& restored.consumer.selectionRange.start === selected.start && restored.consumer.selectionRange.end === selected.end,
		'main: Back restores the exact authored location through a fresh primary attachment');
	await test.runPaletteCommand('Go: Forward');
	check(editor.editorParts.main.activeGroup.model.activeTab === input,
		'main: Forward returns to the independent retained Source view');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-source`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	if (input?.kind !== 'code_editor') throw new Error('main: retained canonical Source required');
	await testPrimarySourceDestinations(test, input);
	await testCallHierarchyResult(test, resource.contextId);
	await testWorkspaceSearchResult(test, resource.contextId);
	await press('ControlLeft', 'KeyW');
	check(editor.mainWorkspace.primary === restored && model.buffer.getText() === accepted && model.dirty && !editor.actionPrompt.visible,
		'main: closing Source neither prompts for nor discards the working copy retained by Main');
	if (!(restored instanceof ScenePrimaryClient)) throw new Error('main: restored Scene client required');
	await click(restored.view.layout.sourceBounds); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty,
		'main: the retained authoring control consumes the same canonical source history after document close');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	await press('ControlLeft', 'KeyA'); await press('Backspace');
	check(model.buffer.getText() === '' && restored.consumer.availability === 'unavailable',
		'main: deleting the exact authored declaration leaves its retained reference unavailable');

	// Exercise initial-recovery attachment explicitly; UI input above produced the missing subject.
	const recovery = editor.mainWorkspace.beginRestore();
	try {
		check(await recovery.restore(editor.mainWorkspace.serialize(), (record, surface, scope, isCurrent) =>
			editor.restorePrimaryClient(record, surface, scope, isCurrent)), 'main: unavailable reference admits its own recovery presentation');
	} finally { recovery.dispose(); }
	const unavailable = editor.mainWorkspace.primary;
	check(unavailable instanceof UnavailableScenePrimaryClient && unavailable.getWorkingCopies()[0] === model,
		'main: recovery retains the real source model without fabricating a Scene context');
	await test.runPaletteCommand('Workspace: Focus Primary Authoring');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-unavailable`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await press('Tab'); await press('Enter');
	check(editor.editorParts.main.activeGroup.model.activeTab?.kind === 'code_editor',
		'main: unavailable presentation exposes Source through its actual keyboard action control');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty && editor.mainWorkspace.primary === unavailable,
		'main: Source Undo cannot silently rebind the unavailable persisted subject');
	await test.runPaletteCommand('Workspace: Clear Primary Authoring');
	check(editor.mainWorkspace.primary === undefined && !restored.control.hasView && !restored.consumer.isCurrent,
		'main: explicit clear releases its actual controls and domain context');
	await close();
	if (panelWasVisible !== panel.isVisible()) await press('ControlLeft', 'KeyB');
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'main: source-only authoring never executes or installs a cartridge');
}

/** Main is the source producer; document placement uses ordinary affinity and explicit side intent. */
async function testPrimarySourceDestinations(test: StudioFixture, source: CodeEditorInput): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace.primary, files = editor.resourcePanel.files.selectedNode;
	const originalGroup = editor.editorParts.findGroup(source)!;
	const originalGroups = editor.editorParts.main.groups.length, partCount = editor.editorParts.mostRecentlyActive.length;
	await test.runPaletteCommand('Window: Move Editor To…');
	await test.clipboard.writeText('New Editor Window'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
	const floating = editor.editorParts.findGroup(source)!;
	const floatingPart = editor.editorParts.partForGroup(floating);
	check(floating !== originalGroup && floatingPart.kind === 'document',
		'main-source: the actual Source view moves to an explicit editor window');
	await test.runPaletteCommand('Workspace: Focus Primary Authoring');
	check(editor.mainWorkspace.primary === main, 'main-source: focus does not reselect the authored subject');
	await test.press('ContextMenu'); await test.clickContextCommand('editor.source');
	await test.until(() => editor.editorParts.activeGroup === floating, 'main-source: default Source reveals the existing floating text view');
	check(floating.model.activeTab === source && floating.panes.activePane?.input === source && !originalGroup.model.contains(source)
		&& editor.editorParts.activePart === floatingPart && floatingPart.surface.visible
		&& inputFocus.target !== null && floating.focusScope.contains(inputFocus.target.scope)
		&& editor.editorParts.mostRecentlyActive.length === partCount + 1 && editor.resourcePanel.files.selectedNode === files,
		'main-source: normal affinity retains the exact moved Source without creating a Main duplicate');
	// Async admission may finish after the input frame painted; the visual checkpoint observes its next presentation.
	await test.frame();
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			check(floating.model.activeTab === source && floating.panes.activePane?.input === source
				&& editor.editorParts.activePart === floatingPart && floatingPart.surface.visible
				&& inputFocus.target !== null && floating.focusScope.contains(inputFocus.target.scope),
				'main-source: font and theme changes preserve the attached, visible and focused Source owner');
			await test.capture?.(`main-source-affinity-${editor.fontVariant}-theme-${theme}`);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.runPaletteCommand('Window: Move Editor To…');
	await test.clipboard.writeText('Main Workspace'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
	check(editor.editorParts.findGroup(source) === originalGroup && originalGroup.model.activeTab === source && floating.model.tabs.length === 0,
		'main-source: moving the same Source back leaves its canonical view in Main');
	await test.runPaletteCommand('Window: Show Open Windows');
	await test.clipboard.writeText('Editor'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
	check(editor.editorParts.activePart === floatingPart, 'main-source: the window picker can still reveal the empty document host');
	await test.runPaletteCommand('Window: Close Window');
	await test.until(() => floatingPart.retired, 'main-source: explicit window close retires the empty floating host');
	check(editor.editorParts.mostRecentlyActive.length === partCount && originalGroup.model.activeTab === source,
		'main-source: closing the empty host does not close its moved Source');
	await test.runPaletteCommand('Workspace: Focus Primary Authoring');
	await test.press('ContextMenu'); await test.clickContextCommand('editor.sourceToSide');
	await test.until(() => editor.editorParts.main.groups.length === originalGroups + 1, 'main-source: explicit Source to Side admits a Main neighbor');
	const side = editor.editorParts.activeGroup, sideSource = side.model.activeTab;
	check(side !== originalGroup && editor.editorParts.partForGroup(side) === editor.editorParts.main
		&& sideSource?.kind === 'code_editor' && sideSource.workingCopy === source.workingCopy && sideSource !== source,
		'main-source: explicit side intent makes an independent text view in the invoking arrangement');
	await test.runPaletteCommand('Editor Groups: Close Group');
	check(editor.editorParts.main.groups.length === originalGroups && editor.editorParts.findGroup(source) === originalGroup
		&& editor.mainWorkspace.primary === main && editor.resourcePanel.files.selectedNode === files,
		'main-source: closing the explicit side group preserves primary authoring and the original Source');
}

/** Query and Source use ordinary commands; only initial source-fixture selection is arranged. */
async function testCallHierarchyResult(test: StudioFixture, contextId: string): Promise<void> {
	const { editor } = test.ide, panel = editor.resourcePanel, main = editor.mainWorkspace.primary;
	const selected = panel.files.selectedNode, scroll = panel.scroll, horizontal = panel.hscroll;
	const calls = test.ide.sources.catalog.resolveResource({ contextId, path: 'calls.lua' })!;
	await editor.navigation.focusChunkSource(editor.editorParts.activeGroup, calls, { row: 1, startColumn: 16, endColumn: 16 });
	await test.frame();
	await test.press('ControlLeft', 'KeyB');
	check(panel.isVisible() && panel.files.selectedNode === selected, 'calls: showing Files retains its own selection');
	await test.runPaletteCommand('Go: Show Call Hierarchy');
	const group = editor.editorParts.activeGroup, result = group.model.activeTab;
	check(result instanceof CallHierarchyInput && panel.isVisible() && editor.mainWorkspace.primary === main,
		'calls: captured result has an independent document presentation alongside Files and Main');
	if (!(result instanceof CallHierarchyInput)) throw new Error('calls: actual result input required');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`calls-${editor.fontVariant}-theme-${theme}`);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.runPaletteCommand('Calls: Show Outgoing Calls');
	check(result.direction === CallHierarchyDirection.CallsFrom, 'calls: the result owns its actual query direction');
	await test.press('ArrowDown'); await test.press('Enter');
	check(group.model.activeTab?.kind === 'code_editor', 'calls: result activation navigates to its proved canonical Source');
	check(panel.files.selectedNode === selected && panel.scroll === scroll && panel.hscroll === horizontal,
		'calls: result and Source navigation do not choose another project-browser subject or reading position');
	await test.runPaletteCommand('Go: Back');
	check(group.model.activeTab === result && result.direction === CallHierarchyDirection.CallsFrom,
		'calls: Back restores the retained result and its direction');
	await test.press('ControlLeft', 'KeyW');
	await test.press('ControlLeft', 'KeyW');
	await test.press('ControlLeft', 'KeyB');
	check(!panel.isVisible() && editor.mainWorkspace.primary === main, 'calls: closing the activity leaves primary authoring untouched');
}

/** Fixture setup admits the independent source namespace; query editing and navigation use real controls. */
async function testWorkspaceSearchResult(test: StudioFixture, contextId: string): Promise<void> {
	const editor = test.ide.editor, panel = editor.resourcePanel, main = editor.mainWorkspace.primary;
	const selected = panel.files.selectedNode, scroll = panel.scroll, horizontal = panel.hscroll;
	const group = editor.editorParts.activeGroup;
	const result = group.openProducedEditor(() => new WorkspaceSearchInput(editorTextModelService, test.ide.sources.catalog, contextId, test.clock));
	check(result instanceof WorkspaceSearchInput, 'search: fixture admits an independent retained query');
	if (!(result instanceof WorkspaceSearchInput)) throw new Error('search: actual retained query required');
	const pane = group.panes.activePane;
	if (!(pane instanceof WorkspaceSearchPane)) throw new Error('search: real query control required');
	pane.focusQuery();
	await test.clipboard.writeText('launch'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
	await test.until(() => result.search.status === 'complete', 'search: explicit query completes over authored fixture source');
	check(result.search.files.some(file => file.resource.contextId === contextId && file.resource.path === 'calls.lua'),
		'search: actual field query observes the admitted source namespace');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.capture?.(`search-${editor.fontVariant}-theme-${theme}`);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.press('ArrowDown'); await test.press('ArrowDown'); await test.press('Enter');
	await test.until(() => group.model.activeTab?.kind === 'code_editor', 'search: result opens its exact canonical Source');
	check(panel.files.selectedNode === selected && panel.scroll === scroll && panel.hscroll === horizontal && editor.mainWorkspace.primary === main,
		'search: navigating the observation leaves Files reading state and Main authoring intact');
	await test.runPaletteCommand('Go: Back');
	check(group.model.activeTab === result && result.tree.rows[result.tree.selectionIndex]?.element.match !== undefined,
		'search: Back restores the retained query and selected observation');
	await test.press('ControlLeft', 'KeyW'); await test.press('ControlLeft', 'KeyW');
	check(editor.mainWorkspace.primary === main, 'search: closing the activity does not close primary authoring');
}
