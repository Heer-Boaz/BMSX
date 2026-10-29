import { CallHierarchyInput } from '../../../ide/workbench/contrib/call_hierarchy/editor_input';
import { CALL_HIERARCHY_SOURCE } from '../../fixtures/studio/call_hierarchy';
import { CallHierarchyDirection } from '../../../ide/editor/contrib/call_hierarchy/model';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { UnavailableScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { openSceneFixture } from './studio_scene_source';
import { check, codePositionBounds, sourcePane, type StudioFixture } from './studio_fixture';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { WorkspaceSearchInput } from '../../../ide/workbench/contrib/workspace_search/editor_input';
import { WorkspaceSearchPane } from '../../../ide/workbench/contrib/workspace_search/editor_pane';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { inputFocus } from '../../../ide/input/focus';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { testProjectBrowserSession } from './studio_browser_session';
import { testStudioBehaviorIntent } from './studio_behavior_intent';
import { registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import type { Blua32SourceImage } from '../../../ide/runtime/sources';
import type { CommandQuickPickItem } from '../../../ide/workbench/contrib/commands/quick_pick_provider';
import type { ResourceQuickPickItem } from '../../../ide/workbench/contrib/resources/quick_access';
import type { QuickPickItem } from '../../../ide/workbench/services/quick_input/provider';
import { SCENE_AUTHORING_SOURCE } from '../../fixtures/studio/scene_authoring';
import { createTestSourceOnlyLuaRecord } from '../../helpers/runtime_sources';
import { getCodeAreaBounds, resolveTextPositionBounds } from '../../../ide/editor/ui/view/view';
import { testStudioWindowKeyboard } from './studio_window_keyboard';
import { testStudioSashSizing, testStudioSashResetBlur } from './studio_sash_sizing';
import { testStudioBuildChooser } from './studio_build_chooser';
import { testStudioRomCommands } from './studio_rom_commands';
import { testStudioBatchClose } from './studio_batch_close';
import { testStudioSaveAll } from './studio_save_all';
import { testStudioFilesOperations } from './studio_files_operations';
import { testStudioMainScenePicker } from './studio_main_scene_picker';

const SOURCE_READING_FIXTURE = `local function read_authoring_source()
    local readable_value = alpha_beta_gamma_delta_epsilon_zeta_eta_theta_iota_kappa_lambda_mu_nu_xi_omicron_pi_rho_sigma_tau_upsilon_phi_chi_psi_omega
    return readable_value
end
return read_authoring_source
`;

/** Standalone renderer workflow over a dedicated test cartridge and independent source fixtures. */
export async function runStudioMainAuthoring(test: StudioFixture) {
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'main: dedicated test cartridge starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await testMainSceneAuthoring(test);
	await testMainProjectRun(test);
	await testStudioBehaviorIntent(test);
	await testProjectBrowserSession(test);
	await testStudioBatchClose(test);
	await testStudioSaveAll(test);
	await testStudioFilesOperations(test);
	await testStudioMainScenePicker(test);
	return { hostFrames: test.observations.hostFrames, cycles: test.cycles(), mainAuthoring: 'pass', filesBrowserRecovery: 'hybrid-pass' };
}

/** Explicit source fixture setup, then ordinary Files/menu/keyboard/pointer authoring in the real Workbench. */
export async function testMainSceneAuthoring(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test, editor = ide.editor;
	const panelWasVisible = editor.resourcePanel.isVisible();
	const { model, resource, close } = await openSceneFixture(test, 'main', [
		['calls.lua', CALL_HIERARCHY_SOURCE], ['reading.lua', SOURCE_READING_FIXTURE],
	]);
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
	check(client.hierarchy.attached && client.details.attached,
		'main: independent hierarchy and Details presentations share one retained authored context');
	const field = client.details.control.controls[0];
	await click(client.view.details.properties[0].bounds); await press('Digit1'); await press('Digit2');
	check(field.pending && field.field.text === '12' && model.buffer.getText() === original,
		'main: the actual field owns its draft before source publication');
	await press('ControlLeft', 'KeyZ');
	check(field.field.text === '1' && model.buffer.getText() === original, 'main: field Undo cannot undo canonical source');
	await press('ControlLeft', 'KeyY');
	check(field.pending && field.field.text === '12', 'main: field Redo restores the unsubmitted numeric value');

	// Font and theme changes exercise the real retained control, not regenerated test geometry.
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			check(inputFocus.admittedTarget === field.field.focusTarget
				&& editor.statusBar.itemsLayout.items.peek(0)?.item === client.statusItems[0],
				'main status: the independent Details field retains the primary context while its native draft is active');
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-draft`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
			check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
				'main: theme changes retain the exact draft and context');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
		check(editor.mainWorkspace.primary === client && field.pending && model.buffer.getText() === original,
			'main: font reflow retains the exact draft and context');
	}
	await press('ShiftLeft', 'F6');
	check(inputFocus.admittedTarget !== null && editor.editorParts.main.scope.contains(inputFocus.admittedTarget.scope),
		'main: reverse outer navigation leaves Details through the actual permanent document client');
	await press('F6');
	check(inputFocus.admittedTarget !== null && client.details.scope.contains(inputFocus.admittedTarget.scope),
		'main: forward outer navigation returns to the same retained Details presentation');
	const accepted = original.replace('x = 1,', 'x = 12,');
	check(model.buffer.getText() === accepted && !field.pending && model.dirty,
		'main: acceptance publishes one canonical coordinate edit');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(editor.quickInput.visible && (editor.quickInput.model.items as readonly CommandQuickPickItem[])
		.every(item => item.command !== 'runProject' && item.command !== 'runCurrentFile'),
		'main: an independent source-only project cannot borrow the installed cartridge or a background document to Run');
	await press('Escape');
	const selected = { ...client.consumer.selectionRange };
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	await test.until(() => {
		const group = editor.editorParts.main.activeGroup, input = group.model.activeTab;
		return input?.kind === 'code_editor' && input.workingCopy === model
			&& inputFocus.admittedTarget === group.panes.activePane?.commandTarget;
	}, 'main: asynchronous Source admission presents the canonical document between the retained regions');
	const input = editor.editorParts.main.activeGroup.model.activeTab;
	check(input?.kind === 'code_editor' && input.workingCopy === model,
		'main: Source opens the canonical working copy in the ordinary document arrangement');
	await press('ControlLeft', 'End');
	check(editor.mainWorkspace.primary === client && client.consumer.selectionRange.start === selected.start
		&& client.consumer.selectionRange.end === selected.end,
		'main: independent document caret navigation cannot replace primary selection');
	await test.runPaletteCommand('Go: Back');
	await test.until(() => {
		const primary = editor.mainWorkspace.primary, target = inputFocus.admittedTarget;
		return primary instanceof ScenePrimaryClient && primary !== client && target !== null
			&& (primary.hierarchy.scope.contains(target.scope) || primary.details.scope.contains(target.scope));
	}, 'main: asynchronous Back admits the exact primary bookmark through a fresh native attachment');
	const restored = editor.mainWorkspace.primary;
	check(restored instanceof ScenePrimaryClient && restored !== client && restored.consumer.workingCopy === model
		&& restored.consumer.selectionRange.start === selected.start && restored.consumer.selectionRange.end === selected.end,
		'main: Back restores the exact authored location through a fresh primary attachment');
	await test.runPaletteCommand('Go: Forward');
	await test.until(() => editor.editorParts.main.activeGroup.model.activeTab === input
		&& inputFocus.admittedTarget === editor.editorParts.main.activeGroup.panes.activePane?.commandTarget,
		'main: Forward presents the retained independent Source');
	check(editor.editorParts.main.activeGroup.model.activeTab === input,
		'main: Forward returns to the independent retained Source view');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			if (!(restored instanceof ScenePrimaryClient) || input?.kind !== 'code_editor') throw new Error('main: actual primary and Source required');
			await testPrimaryRegionNavigation(test, restored, input, theme);
			await testPrimaryViewResizing(test, restored, input, theme);
			await testStudioSashSizing(test, restored, input, theme);
			await testPrimaryRegionVisibility(test, restored, input, theme);
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-source`);
			await press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	if (!(restored instanceof ScenePrimaryClient) || input?.kind !== 'code_editor') throw new Error('main: retained primary and canonical Source required');
	await testMainSourceReadability(test, restored, input);
	await testPrimarySourceDestinations(test, input);
	await testStudioSashResetBlur(test, restored, input);
	await testStudioBuildChooser(test, restored, input);
	await testStudioRomCommands(test, restored, input);
	await testCallHierarchyResult(test, resource.contextId);
	await testWorkspaceSearchResult(test, resource.contextId);
	await press('ControlLeft', 'KeyW');
	check(editor.mainWorkspace.primary === restored && model.buffer.getText() === accepted && model.dirty && !editor.actionPrompt.visible,
		'main: closing Source neither prompts for nor discards the working copy retained by Main');
	if (!(restored instanceof ScenePrimaryClient)) throw new Error('main: restored Scene client required');
	await test.runPaletteCommand('Workspace: Focus Hierarchy'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty,
		'main: the retained authoring control consumes the same canonical source history after document close');
	await press('ContextMenu'); await test.clickContextCommand('editor.source');
	await test.until(() => {
		const group = editor.editorParts.main.activeGroup, input = group.model.activeTab;
		return input?.kind === 'code_editor' && input.workingCopy === model
			&& inputFocus.admittedTarget === group.panes.activePane?.commandTarget;
	}, 'main: Source is actually admitted before subsequent native editing commands');
	await press('ControlLeft', 'KeyA'); await press('Backspace');
	check(model.buffer.getText() === '' && restored.consumer.availability === 'unavailable',
		'main: deleting the exact authored declaration leaves its retained reference unavailable');

	// Exercise initial-recovery attachment explicitly; UI input above produced the missing subject.
	const recovery = editor.mainWorkspace.beginRestore();
	try {
		check(await recovery.restore(editor.mainWorkspace.serialize(), (record, regions, scope, isCurrent) =>
			editor.restorePrimaryClient(record, regions, scope, isCurrent)), 'main: unavailable reference admits its own recovery presentation');
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
	await test.until(() => {
		const group = editor.editorParts.main.activeGroup, input = group.model.activeTab;
		return input?.kind === 'code_editor' && input.workingCopy === model
			&& inputFocus.admittedTarget === group.panes.activePane?.commandTarget;
	}, 'main: unavailable Source action completes through ordinary asynchronous native document admission');
	check(editor.editorParts.main.activeGroup.model.activeTab?.kind === 'code_editor',
		'main: unavailable presentation exposes Source through its actual keyboard action control');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty && editor.mainWorkspace.primary === unavailable,
		'main: Source Undo cannot silently rebind the unavailable persisted subject');
	await test.runPaletteCommand('Workspace: Focus Primary Authoring');
	await press('ControlLeft', 'KeyS');
	await test.until(() => ide.textFileSaves.latestOperation(model)?.result?.status === 'saved',
		'main: unavailable authoring saves its retained file through the ordinary native keyboard action');
	check(ide.textFileSaves.latestOperation(model)!.snapshot.source === original
		&& model.persistedBaseline === original && !model.dirty && editor.mainWorkspace.primary === unavailable,
		'main: Save acknowledges the exact retained source without inventing an available Scene or document subject');
	await test.runPaletteCommand('Workspace: Clear Primary Authoring');
	await test.until(() => editor.mainWorkspace.primary === undefined, 'main: clear retires the admitted authored context');
	check(editor.mainWorkspace.primary === undefined && !unavailable.hierarchy.attached && !unavailable.details.attached && !unavailable.isCurrent(),
		'main: explicit clear releases its actual controls and domain context');
	await close();
	if (panelWasVisible !== panel.isVisible()) await press('ControlLeft', 'KeyB');
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'main: source-only authoring never executes or installs a cartridge');
}

/** Native wrapping is a retained Source reading choice, independent of Main and canonical text history. */
async function testMainSourceReadability(test: StudioFixture, client: ScenePrimaryClient, originalSource: CodeEditorInput): Promise<void> {
	const editor = test.ide.editor, group = editor.editorParts.findGroup(originalSource)!;
	const originalView = { ...originalSource.context.view }, mainModel = client.consumer.workingCopy;
	const mainText = mainModel.buffer.getText(), mainVersion = mainModel.version, selection = client.consumer.selection;
	const mainDirty = mainModel.dirty, mainUndo = mainModel.canUndo, mainRedo = mainModel.canRedo;
	await test.runPaletteCommand('Go: Go to File');
	await test.clipboard.writeText('reading.lua'); await test.press('ControlLeft', 'KeyV');
	const rows = editor.quickInput.model.list.rows;
	const index = rows.findIndex(row => {
		const resource = (row.item as ResourceQuickPickItem).resource;
		return resource.contextId === mainModel.identity.contextId && resource.path === 'reading.lua';
	});
	check(index >= 0, 'source reading: the ordinary source-only fixture is a real file choice');
	for (let row = 0; row < index; row++) await test.press('ArrowDown');
	await test.press('Enter');
	await test.until(() => group.model.activeTab?.resource?.path === 'reading.lua'
		&& inputFocus.admittedTarget === group.panes.activePane?.commandTarget,
		'source reading: Go to File admits the independent reading document between the retained Main regions');
	const source = group.model.activeTab;
	if (source?.kind !== 'code_editor') throw new Error('source reading: actual Source input required');
	const model = source.workingCopy, view = source.context.view;
	const text = model.buffer.getText(), version = model.version, dirty = model.dirty, undo = model.canUndo, redo = model.canRedo;
	check(text === SOURCE_READING_FIXTURE && !view.wordWrapEnabled && editor.mainWorkspace.primary === client,
		'source reading: a new ordinary Source view defaults to unwrapped reading without replacing Main');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.press('ControlLeft', 'Home');
			await test.click(codePositionBounds(test, 1, 6));
			check(view.cursorRow === 1 && view.cursorColumn === 6 && !view.wordWrapEnabled,
				'source reading: pointer navigation uses canonical source columns in the unwrapped native control');
			await test.capture?.(`main-source-reading-${editor.fontVariant}-theme-${theme}-unwrapped`);
			const unwrappedScroll = { row: view.scrollRow, left: view.scrollLeft };
			await test.runPaletteCommand('Workspace: Focus Details');
			await test.clickTab(source.id, 1, group);
			check(!view.wordWrapEnabled && view.cursorRow === 1 && view.cursorColumn === 6
				&& view.scrollRow === unwrappedScroll.row && view.scrollLeft === unwrappedScroll.left,
				'source reading: Main field focus cannot reset an independent unwrapped Source viewport');
			await test.press('AltLeft', 'KeyZ');
			check(view.wordWrapEnabled && view.cursorRow === 1 && view.cursorColumn === 6,
				'source reading: actual Alt+Z changes only the attached Source reading mode');
			const code = sourcePane(test)!.code, layout = code.layout;
			const firstVisual = layout.positionToVisualIndex(1, 6), continuation = layout.visualIndexToSegment(firstVisual + 1);
			check(continuation.row === 1 && continuation.startColumn > 6,
				'source reading: the narrow real Source presents a continuation of the same authored line');
			// Coordinates only drive the pointer through the actual virtual-indent projection.
			const bounds = { left: 0, top: 0, right: 0, bottom: 0 };
			resolveTextPositionBounds(code, 1, continuation.startColumn, bounds);
			const area = getCodeAreaBounds(code), continuationColumn = continuation.startColumn;
			const indentX = area.textLeft + continuation.indentPixels / 2, rowY = (bounds.top + bounds.bottom) / 2;
			await test.click({ left: indentX, right: indentX, top: rowY, bottom: rowY });
			check(view.cursorRow === 1 && view.cursorColumn === continuationColumn,
				'source reading: clicking virtual continuation indentation chooses its real source stop');
			await test.click(codePositionBounds(test, 1, 6));
			await test.press('ArrowDown');
			const firstColumn = view.cursorColumn;
			await test.press('ArrowDown');
			check(view.cursorRow === 1 && firstColumn > 6 && view.cursorColumn > firstColumn,
				'source reading: native vertical keys traverse wrapped continuations, not unrelated source rows');
			await test.capture?.(`main-source-reading-${editor.fontVariant}-theme-${theme}-wrapped`);
			const wrappedColumn = view.cursorColumn, wrappedScroll = { row: view.scrollRow, left: view.scrollLeft };
			await test.runPaletteCommand('Workspace: Focus Details');
			await test.clickTab(source.id, 1, group);
			check(view.wordWrapEnabled && view.cursorRow === 1 && view.cursorColumn === wrappedColumn
				&& view.scrollRow === wrappedScroll.row && view.scrollLeft === wrappedScroll.left,
				'source reading: Main field focus preserves the exact wrapped Source caret and viewport');
			await test.press('ArrowUp'); await test.press('ArrowUp');
			check(view.cursorRow === 1 && view.cursorColumn === 6,
				'source reading: returning through indented continuations restores the requested source caret');
			await test.press('AltLeft', 'KeyZ');
			check(!view.wordWrapEnabled && model.buffer.getText() === text && model.version === version
				&& model.dirty === dirty && model.canUndo === undo && model.canRedo === redo
				&& editorTextModelService.get(model.identity) === model,
				'source reading: presentation input never edits, dirties, replaces or adds Undo history to the working copy');
			check(editor.mainWorkspace.primary === client && client.consumer.selection === selection
				&& mainModel.buffer.getText() === mainText && mainModel.version === mainVersion
				&& mainModel.dirty === mainDirty && mainModel.canUndo === mainUndo && mainModel.canRedo === mainRedo,
				'source reading: font, theme, pointer and wrapping remain independent of Main authoring and history');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.press('ControlLeft', 'KeyW');
	check(group.model.activeTab === originalSource && originalSource.context.view.wordWrapEnabled === originalView.wordWrapEnabled
		&& originalSource.context.view.cursorRow === originalView.cursorRow && originalSource.context.view.cursorColumn === originalView.cursorColumn
		&& originalSource.context.view.scrollRow === originalView.scrollRow && originalSource.context.view.scrollLeft === originalView.scrollLeft,
		'source reading: closing the clean reading document returns to the original independent Source state');
}

/** A newly authored source-only Scene still belongs to its actual installed project's existing entry program. */
async function testMainProjectRun(test: StudioFixture): Promise<void> {
	const { ide } = test;
	const editor = ide.editor, catalog = ide.sources.catalog, image = ide.sources.currentBlua32Media.cartridgeSlots[0]!;
	const context = catalog.getContext(image.sourceContextId), path = 'studio_main_project_run.lua';
	check(context.programDomain === 'cart' && context.luaSources.can_boot_from_source,
		'main run: the dedicated test cartridge already owns a source-bootable installed program');
	const record = createTestSourceOnlyLuaRecord(path, SCENE_AUTHORING_SOURCE, `${context.projectRootPath}/${path}`);
	registerLuaSourceRecord(context.luaSources, record);
	const resource = catalog.registerLuaResource(context.id, record);
	// Workspace opening already admits the actual cartlib dependency independently of packed ROM membership.
	const before = test.cycles(), media = ide.sources.currentBlua32Media, boot = ide.boots.latestOperation;
	const target = ide.runTargets.selected, panel = editor.resourcePanel, panelWasVisible = panel.isVisible();
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await test.frame();
	await test.press('ArrowRight'); await test.press('ArrowDown'); await test.press('ContextMenu');
	await test.clickContextCommand('resources.editInMain');
	const client = editor.mainWorkspace.primary;
	check(client instanceof ScenePrimaryClient && client.consumer.workingCopy.resource === resource,
		'main run: Files admits the newly authored Scene in the actual installed project');
	if (!(client instanceof ScenePrimaryClient)) throw new Error('main run: actual primary Scene required');
	await test.press('ControlLeft', 'KeyB');
	await test.press('ArrowDown'); await test.press('Enter'); await test.press('Home');
	check(client.consumer.selection?.kind === 'member' && client.consumer.selection.index === 0,
		'main run: ordinary hierarchy navigation selects the first authored member');

	// Keep a genuinely unrelated document visible: it must never supply the Run project subject.
	await test.runPaletteCommand('Go: Go to File');
	await test.clipboard.writeText('scene.lua'); await test.press('ControlLeft', 'KeyV');
	const filePicker = editor.quickInput, fileRows = filePicker.model.list.rows;
	const independentIndex = fileRows.findIndex(row => {
		const resource = (row.item as ResourceQuickPickItem).resource;
		return resource.contextId === 'fixture-studio-scene-main' && resource.path === 'scene.lua';
	});
	check(independentIndex >= 0, 'main run: the previous independent source fixture is an ordinary file choice');
	for (let index = 0; index < independentIndex; index++) await test.press('ArrowDown');
	await test.press('Enter');
	await test.until(() => editor.editorParts.main.activeGroup.model.activeTab?.resource?.contextId === 'fixture-studio-scene-main',
		'main run: Go to File presents the independent document without changing Main');
	const group = editor.editorParts.main.activeGroup, independent = group.model.activeTab;
	const model = client.consumer.workingCopy, original = model.buffer.getText(), accepted = original.replace('x = 1,', 'x = 12,');
	const field = client.details.control.controls[0];
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('Workspace: Focus Details');
			await test.click(client.view.details.properties[0].bounds); await test.press('Digit1'); await test.press('Digit2');
			check(field.pending && field.field.text === '12' && model.buffer.getText() === original,
				'main run: the actual Main field owns its pending draft before Palette blur');
			await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
			const actions = editor.quickInput.model.items as readonly CommandQuickPickItem[];
			check(editor.quickInput.visible && actions.some(item => item.command === 'runProject')
				&& actions.every(item => item.command !== 'runCurrentFile'),
				'main run: the native Palette offers the installed project operation, never Run Current File for an authored Scene');
			await test.clipboard.writeText('Run: Run Project'); await test.press('ControlLeft', 'KeyV'); await test.press('Enter');
			const picker = editor.editorParts.main.quickInput;
			const choices = picker.model.items as readonly (QuickPickItem & { domain: 0 | 1; image: Blua32SourceImage })[];
			check(picker.visible && !picker.inputBox && choices.length === 1 && choices[0].domain === 0 && choices[0].image === image,
				'main run: Palette offers only the exact installed attachment owned by Main, never the visible independent document');
			check(!field.pending && model.buffer.getText() === accepted && model.dirty,
				'main run: ordinary outgoing field blur publishes the accepted draft before project selection');
			await test.capture?.(`main-run-${editor.fontVariant}-theme-${theme}-attachment`);
			await test.press('Enter');
			check(editor.actionPrompt.visible && model.buffer.getText() === accepted && model.dirty && !field.pending,
				'main run: choosing the installed project reaches the real unsaved-source decision with the accepted Main edit');
			await test.capture?.(`main-run-${editor.fontVariant}-theme-${theme}-unsaved`);
			await test.press('Escape');
			check(!editor.actionPrompt.visible && ide.boots.latestOperation === boot && ide.sources.currentBlua32Media === media
				&& ide.runTargets.selected === target && test.cycles() === before && group.model.activeTab === independent
				&& editor.mainWorkspace.primary === client,
				'main run: cancelling never starts Boot, installs media, executes guest input, changes targets or replaces either authored subject');
			await test.runPaletteCommand('Workspace: Focus Hierarchy'); await test.press('ControlLeft', 'KeyZ');
			check(model.buffer.getText() === original && !model.dirty, 'main run: native primary Undo cleans the accepted test edit');
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.runPaletteCommand('Workspace: Clear Primary Authoring');
	check(editor.mainWorkspace.primary === undefined && group.model.activeTab === independent,
		'main run: explicit clear releases Main without replacing the independent document');
	await test.press('ControlLeft', 'KeyW');
	if (panelWasVisible !== panel.isVisible()) await test.press('ControlLeft', 'KeyB');
	check(model.buffer.getText() === original && !model.dirty && ide.boots.latestOperation === boot
		&& ide.sources.currentBlua32Media === media && ide.runTargets.selected === target && test.cycles() === before,
		'main run: the complete visible workflow leaves only a clean source-only fixture and never boots or saves it');
}

/** Palette sizing addresses the captured native region and retains its independent authoring and Source reading. */
async function testPrimaryViewResizing(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace, group = editor.editorParts.findGroup(source)!;
	const selected = client.consumer.selection, text = source.workingCopy.buffer.getText(), version = source.workingCopy.version;
	const row = source.context.view.cursorRow, column = source.context.view.cursorColumn;
	const filesVisible = editor.resourcePanel.isVisible(), activityVisible = main.activityDisplayed;
	if (filesVisible) await test.press('ControlLeft', 'KeyB');
	// In the small real viewport, hiding the sibling creates an actual feasible interval rather than bypassing minima.
	await test.runPaletteCommand('Workspace: Hide Details');
	await test.runPaletteCommand('Workspace: Focus Hierarchy');
	const hierarchy = inputFocus.admittedTarget!, generation = client.hierarchy.scope.contextGeneration;
	const width = main.regionLayout.hierarchyWidth;
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	const wider = main.regionLayout.hierarchyWidth;
	check(wider !== width && inputFocus.admittedTarget === hierarchy,
		'main resize: the actual palette changes the invoking hierarchy sizing intent and returns to its native control');
	await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-resized-hierarchy`);
	await test.runPaletteCommand('Workspace: Decrease Focused View Width');
	check(main.regionLayout.hierarchyWidth! < wider! && client.hierarchy.scope.contextGeneration === generation,
		'main resize: decreasing uses the same retained hierarchy sizing owner without retiring its attachment');
	await test.runPaletteCommand('Workspace: Show Details');
	if (activityVisible) await test.runPaletteCommand('Workspace: Hide Activity Area');
	await test.runPaletteCommand('View: Problems Panel');
	const activity = main.activity!, target = inputFocus.admittedTarget!, height = main.regionLayout.activityHeight;
	await test.runPaletteCommand('Workspace: Increase Focused View Height');
	const taller = main.regionLayout.activityHeight;
	check(taller !== height && inputFocus.admittedTarget === target && main.activity === activity,
		'main resize: the palette addresses the focused docked reader height without replacing or refocusing its client');
	await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-resized-activity`);
	await test.runPaletteCommand('Workspace: Decrease Focused View Height');
	check(main.regionLayout.activityHeight! < taller! && main.primary === client && client.consumer.selection === selected
		&& group.model.activeTab === source && source.context.view.cursorRow === row && source.context.view.cursorColumn === column
		&& source.workingCopy.buffer.getText() === text && source.workingCopy.version === version,
		'main resize: axis commands preserve authored selection, canonical bytes, document membership and independent Source caret');
	if (!activityVisible) await test.runPaletteCommand('Workspace: Hide Activity Area');
	if (filesVisible) await test.press('ControlLeft', 'KeyB');
}

/** Actual outer-region keys preserve domain selection, independent Source reading and native local traversal. */
async function testPrimaryRegionNavigation(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace, group = editor.editorParts.findGroup(source)!;
	const selected = client.consumer.selection, text = source.workingCopy.buffer.getText(), version = source.workingCopy.version;
	const row = source.context.view.cursorRow, column = source.context.view.cursorColumn;
	const filesVisible = editor.resourcePanel.isVisible(), activityVisible = main.activityDisplayed;
	if (!activityVisible) await test.runPaletteCommand('View: Problems Panel');
	await test.runPaletteCommand('View: Focus Files');
	const filesSelection = editor.resourcePanel.files.selectedNode, activity = main.activity!;
	const generation = client.scope.contextGeneration;
	const mainScopes = [client.hierarchy.scope, group.focusScope, client.details.scope, activity.scope];
	for (const scope of mainScopes) {
		await test.press('F6');
		check(inputFocus.admittedTarget !== null && scope.contains(inputFocus.admittedTarget.scope),
			'main: F6 admits the next concrete outer-region client in fixed workspace order');
	}
	check(activity === editor.problems && editor.problems.selectedDiagnostic === undefined && !editor.statusBar.canFocus,
		'main: empty native Problems contributes no status-reading destination');
	await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-region-empty-activity`);
	await test.press('F6');
	check(inputFocus.admittedTarget === editor.resourcePanel.focusTarget && editor.statusBar.canFocus,
		'main: F6 skips unavailable status and admits Files, whose own status makes reading available again');
	await test.press('ShiftLeft', 'F6');
	check(inputFocus.admittedTarget === editor.statusBar.focusTarget,
		'main: reverse outer navigation admits the actual available Files status reader');
	await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-region-status`);
	for (const scope of [...mainScopes].reverse().concat(editor.resourcePanel.focusTarget.scope)) {
		await test.press('ShiftLeft', 'F6');
		check(inputFocus.admittedTarget !== null && scope.contains(inputFocus.admittedTarget.scope),
			'main: Shift+F6 admits the previous actual region rather than cycling documents or floating windows');
	}
	await test.press('F6'); await test.press('F6'); await test.press('F6');
	check(inputFocus.admittedTarget === client.details.control.focusTarget,
		'main: region navigation addresses the retained native Details control');
	await test.press('Tab');
	check(inputFocus.admittedTarget === client.details.control.controls[0].field.focusTarget,
		'main: local Tab still enters the first actual Details field');
	await test.press('Tab');
	check(inputFocus.admittedTarget === client.details.control.controls[1].field.focusTarget,
		'main: local Tab remains within the native property field order');
	await test.press('ShiftLeft', 'Tab');
	check(inputFocus.admittedTarget === client.details.control.controls[0].field.focusTarget,
		'main: reverse Tab retains its local field route, independent of outer-region keys');
	await test.press('F6');
	check(inputFocus.admittedTarget !== null && activity.scope.contains(inputFocus.admittedTarget.scope),
		'main: F6 leaves an inline field for the displayed docked activity without selecting another client');
	check(main.primary === client && client.scope.contextGeneration === generation && client.consumer.selection === selected
		&& editor.resourcePanel.files.selectedNode === filesSelection && group.model.activeTab === source
		&& source.context.view.cursorRow === row && source.context.view.cursorColumn === column
		&& source.workingCopy.buffer.getText() === text && source.workingCopy.version === version,
		'main: both outer directions and local traversal preserve exact attachments, authored selection, Source reading and canonical bytes');
	if (!activityVisible) await test.runPaletteCommand('Workspace: Hide Activity Area');
	if (!filesVisible) await test.press('ControlLeft', 'KeyB');
}

/** Native panel menus and the Window menu change attachments, never the authored or document subjects. */
async function testPrimaryRegionVisibility(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace, group = editor.editorParts.findGroup(source)!;
	const selected = { ...client.consumer.selectionRange }, text = source.workingCopy.buffer.getText();
	const row = source.context.view.cursorRow, column = source.context.view.cursorColumn;
	for (const region of ['details', 'hierarchy'] as const) {
		const panel = client[region], sibling = client[region === 'details' ? 'hierarchy' : 'details'];
		const generation = panel.scope.contextGeneration;
		if (!editor.menubar.expanded) await test.click(editorChromeState.menuButtonBounds);
		test.movePointer(editorChromeState.menuEntryBounds.window); await test.frame();
		await test.clickContextCommand(region === 'details' ? 'workspace.details.focus' : 'workspace.hierarchy.focus');
		check(inputFocus.admittedTarget !== null && panel.scope.contains(inputFocus.admittedTarget.scope),
			'main: explicit region focus reveals and admits its actual native control');
		const point = test.movePointer(panel.layoutState.header);
		const hit = editor.surfaces.hitTest(point.viewportX, point.viewportY);
		test.setPointerButton('pointer_secondary', true); await test.frame();
		test.setPointerButton('pointer_secondary', false); await test.frame();
		const toggle = region === 'details' ? 'workspace.details.toggle' : 'workspace.hierarchy.toggle';
		if (!editor.contextMenu.visible || !editor.contextMenu.model.rows.some(row => row.command === toggle && row.enabled)) {
			const hovered = panel.actionBar.tooltipItem;
			console.info('MAIN_REGION_HEADER_ROUTE', JSON.stringify({ font: editor.fontVariant, region, point,
				header: panel.layoutState.header, title: panel.layoutState.titleBounds,
				hitRegion: hit === editor.surfaces.findByScope(panel.scope.surfaceScope), hitRole: hit?.role,
				hovered: hovered === undefined ? undefined : { command: String(hovered.command), bounds: hovered.bounds },
				menuVisible: editor.contextMenu.visible,
				menu: editor.contextMenu.model.rows.map(row => ({ command: row.command, enabled: row.enabled })) }));
			await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-${region}-header-routing-failure`);
		}
		await test.clickContextCommand(toggle);
		check(main.primary === client && !panel.attached && sibling.attached && panel.scope.contextGeneration !== generation,
			'main: hiding one named region retires only its native attachment');
		check(group.model.activeTab === source && editor.editorParts.activeGroup === group
			&& inputFocus.target !== null && group.focusScope.contains(inputFocus.target.scope),
			'main: hiding a focused region returns input to the actual permanent document client');
		await test.capture?.(`main-${editor.fontVariant}-theme-${theme}-${region}-hidden`);
		const focused = inputFocus.admittedTarget;
		if (!editor.menubar.expanded) await test.click(editorChromeState.menuButtonBounds);
		test.movePointer(editorChromeState.menuEntryBounds.window); await test.frame();
		await test.clickContextCommand(region === 'details' ? 'workspace.details.toggle' : 'workspace.hierarchy.toggle');
		check(panel.attached && sibling.attached && main.primary === client && inputFocus.admittedTarget === focused,
			'main: showing a region restores its presentation without stealing the document focus');
		check(client.consumer.selectionRange.start === selected.start && client.consumer.selectionRange.end === selected.end
			&& source.context.view.cursorRow === row && source.context.view.cursorColumn === column
			&& source.workingCopy.buffer.getText() === text,
			'main: panel visibility preserves exact authored selection, independent Source caret and canonical bytes');
	}
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
			await testStudioWindowKeyboard(test, source, floatingPart, theme);
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
