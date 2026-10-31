import { inputFocus } from '../../../ide/input/focus';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { WorkspaceAutosavePayload } from '../../../ide/workbench/workspace/models';
import { applyWorkspaceAutosavePayload } from '../../../ide/workbench/workspace/restore';
import { workspaceState } from '../../../ide/workbench/workspace/state';
import { persistWorkspaceSessionLocally } from '../../../ide/workbench/workspace/storage';
import { check, type StudioFixture } from './studio_fixture';
import { openSceneFixture } from './studio_scene_source';

const BROWSER_SOURCE = [
	"local scenes = require('cartlib/world/scene_library')",
	...Array.from({ length: 48 }, (_, index) => `scenes.register('browser_${index}_${'long_'.repeat(20)}', { objects = {} })`),
].join('\n');

/** Hybrid acceptance: real browser input prepares reading; the workspace owner simulates recovery. */
export async function testProjectBrowserSession(test: StudioFixture): Promise<void> {
	const editor = test.ide.editor, panel = editor.resourcePanel, wasVisible = panel.isVisible();
	const { resource, close } = await openSceneFixture(test, 'browser-session', [['browser.lua', BROWSER_SOURCE]]);
	await close();
	const cycles = test.cycles(), media = test.ide.sources.currentBlua32Media;
	panel.show(); panel.queuePendingSelection(resource); panel.applyPendingSelection(); await test.frame();
	await test.press('ArrowRight'); await test.press('ArrowDown'); await test.press('ContextMenu');
	await test.clickContextCommand('resources.open');
	check(editor.mainWorkspace.primary instanceof ScenePrimaryClient, 'browser recovery: Files admits an independent Main subject');
	await test.press('ContextMenu'); await test.clickContextCommand('editor.source');
	await test.until(() => editor.editorParts.main.activeGroup.model.activeTab?.kind === 'code_editor',
		'browser recovery: Source is an ordinary document beside retained primary authoring');
	const browserResource = test.ide.sources.catalog.resolveResource({ contextId: resource.contextId, path: 'browser.lua' })!;
	check(editorTextModelService.get(browserResource) === undefined, 'browser recovery: declaration browsing needs no canonical working-copy admission');
	for (let font = 0; font < 2; font++) {
		for (let theme = 0; theme < 2; theme++) {
			await test.runPaletteCommand('View: Focus Files');
			// Initial file reveal is fixture arrangement; declaration choice and reading use real input.
			panel.queuePendingSelection(browserResource); panel.applyPendingSelection(); await test.frame();
			if (panel.files.selectedNode!.collapsed) await test.press('ArrowRight');
			for (let row = 0; row < 24; row++) await test.press('ArrowDown');
			const selected = panel.files.selectedNode;
			check(selected?.element.kind === 'definition' && selected.element.content.ownerResource === browserResource,
				'browser recovery: native tree keys choose an exact declaration unrelated to Main or Source');
			test.movePointer(panel.getBounds()!); test.remote.apply([{ type: 'wheel', deltaY: -3 }]); await test.frame();
			test.setKey('ShiftLeft', true); test.remote.apply([{ type: 'wheel', deltaY: 1 }]);
			test.setKey('ShiftLeft', false); await test.frame();
			check(panel.files.selectedNode === selected && panel.scroll > 0 && panel.hscroll > 0,
				'browser recovery: real vertical and horizontal wheel reading does not change the selected declaration');
			persistWorkspaceSessionLocally();
			const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify(workspaceState.localGeneration!.payload));
			check(payload.filesBrowser.focused && payload.filesBrowser.view.selected?.kind === 'definition',
				'browser recovery: the session captures native browser focus and exact declaration correspondence');
			await test.capture?.(`browser-recovery-${editor.fontVariant}-theme-${theme}-before`);
			await test.press('Home'); await test.press('ControlLeft', 'KeyB');
			// There is no Reload Workspace UI: call the actual recovery boundary, not a UI-only substitute claim.
			editor.deactivate();
			await applyWorkspaceAutosavePayload(editor, test.ide.sources.catalog, test.ide.debugger, payload);
			check(!editor.isActive && !editor.acceptsInput && inputFocus.admittedTarget === panel.focusTarget
				&& panel.focusTarget.guestInput === undefined,
				'browser recovery: inactive startup retains saved native Files focus without authorizing input');
			editor.activate(); await test.frame();
			check(JSON.stringify(panel.serialize().view) === JSON.stringify(payload.filesBrowser.view)
				&& panel.visible === payload.filesBrowser.visible && inputFocus.admittedTarget === panel.focusTarget,
				'browser recovery: actual workspace recovery restores exact disclosure, selection, manual reading and native focus');
			check(JSON.stringify(editor.mainWorkspace.serialize().primary) === JSON.stringify(payload.mainWorkspace.primary)
				&& JSON.stringify(editor.editorParts.serialize(editor.editorInputSerializers)) === JSON.stringify(payload.editorParts),
				'browser recovery: independent Main subject and ordinary document topology restore without browser activation');
			check(editorTextModelService.get(browserResource) === undefined,
				'browser recovery: recovering browser correspondence does not open or retain a Source working copy');
			await test.capture?.(`browser-recovery-${editor.fontVariant}-theme-${theme}-after`);
			await test.runPaletteCommand('Workspace: Focus Hierarchy');
			await test.press('Home'); await test.press('ArrowRight'); await test.press('ArrowDown');
			const primary = editor.mainWorkspace.primary;
			if (!(primary instanceof ScenePrimaryClient)) throw new Error('primary recovery: an actual Scene client is required');
			check(primary.consumer.selection?.kind === 'member', 'primary recovery: native hierarchy input chooses an authored member');
			const copy = primary.consumer.workingCopy, source = copy.buffer.getText();
			persistWorkspaceSessionLocally();
			const mainPayload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify(workspaceState.localGeneration!.payload));
			check(mainPayload.mainWorkspace.activeClient === 'primary' && !mainPayload.filesBrowser.focused,
				'primary recovery: the session captures Main foreground independently of document activation');
			await test.capture?.(`primary-recovery-${editor.fontVariant}-theme-${theme}-before`);
			// Exercise the same hybrid recovery boundary while the departing Main still owns native focus.
			await applyWorkspaceAutosavePayload(editor, test.ide.sources.catalog, test.ide.debugger, mainPayload);
			const recovered = editor.mainWorkspace.primary, focused = inputFocus.admittedTarget;
			if (!(recovered instanceof ScenePrimaryClient)) throw new Error('primary recovery: the restored Scene client is required');
			check(recovered !== primary && focused !== null && recovered.hierarchy.scope.contains(focused.scope),
				'primary recovery: retiring Main controls cannot activate a document instead of the restored hierarchy');
			const code = editor.editorParts.main.activeGroup.model.activeTab;
			check(code?.kind === 'code_editor' && code.workingCopy === recovered.consumer.workingCopy
				&& code.workingCopy !== copy && editorTextModelService.get(resource) === code.workingCopy
				&& code.workingCopy.buffer.getText() === source,
				'primary recovery: restored Main and Source share the new canonical model without changing authored bytes');
			check(JSON.stringify(editor.mainWorkspace.serialize().primary) === JSON.stringify(mainPayload.mainWorkspace.primary)
				&& JSON.stringify(editor.editorParts.serialize(editor.editorInputSerializers)) === JSON.stringify(mainPayload.editorParts),
				'primary recovery: exact subject, member selection, document topology and MRU survive native control retirement');
			await test.frame();
			await test.capture?.(`primary-recovery-${editor.fontVariant}-theme-${theme}-after`);
			await test.press('ControlLeft', 'AltLeft', 'KeyT');
		}
		await test.press('ControlLeft', 'ShiftLeft', 'KeyT');
	}
	await test.runPaletteCommand('Workspace: Clear Primary Authoring'); await close();
	if (wasVisible !== panel.isVisible()) await test.press('ControlLeft', 'KeyB');
	check(test.cycles() === cycles && test.ide.sources.currentBlua32Media === media,
		'browser recovery: source-only recovery never resumes execution or installs guest media');
}
