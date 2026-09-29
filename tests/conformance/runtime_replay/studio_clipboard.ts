import { editorFeedbackState } from '../../../ide/common/feedback_state';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { TextField } from '../../../ide/editor/ui/inline/text_field_model';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { editorSearchState, lineJumpState } from '../../../ide/workbench/contrib/code_editor/find/widget_state';
import { renameController } from '../../../ide/workbench/contrib/code_editor/rename/controller';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS } from '../../../ide/workbench/ui/top_bar/menu';
import { createStudioFixture } from './studio_fixture';
import { createStudioRenderer } from './studio_renderer';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { selectMember } from './studio_scene_source';

/** Setup and observations only: the test drives editing with actual browser gestures. */
export async function startClipboardTest(canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer('software', canvas, capture);
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, undefined, true);
	await test.until(() => test.cycles() > test.runtime.timing.cpuHz * 13, 'clipboard: boot');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await test.frame();
	const source = activeCodeEditor.model;
	// Prepare a selection without granting browser user activation, to exercise denial first.
	await test.press('ControlLeft', 'Home'); await test.press('ShiftLeft', 'End');
	return {
		frame: test.frame,
		menu() { return { header: editorChromeState.menuEntryBounds.edit, items: TOP_BAR_MENUS.edit.items }; },
		async capture(name: string) { await test.frame(); await renderer.capture!(name); },
		async command(command: 'copy' | 'cut' | 'paste' | 'findLocal' | 'lineJump' | 'commandPalette' | 'rename' | 'terminal' | 'assistant') {
			test.ide.editor.commands.execute(command); await test.frame();
		},
		async source() {
			test.ide.editor.quickInput.hide(); test.ide.editor.search.closeSearch(false); renameController.cancel();
			test.harness.openLuaSource('cart.lua'); await test.frame();
		},
		snapshot() {
			const target = inputFocus.target?.clipboard;
			const field = target instanceof TextField ? target : undefined;
			const tab = getActiveTab();
			return {
				text: field?.text, canUndo: field?.canUndo, canRedo: field?.canRedo,
				selection: target?.copy?.(), source: source.buffer.getText(), version: source.version,
				query: editorSearchState.query, line: lineJumpState.value,
				rename: renameController.getField().text, feedback: editorFeedbackState.message,
				propertySource: tab.kind === 'scene_editor' ? tab.workingCopy.buffer.getText() : undefined,
			};
		},
		async readOnly(value: boolean) { (inputFocus.target!.clipboard as TextField).readOnly = value; await test.frame(); },
		async write(text: string) {
			try { await test.ide.editor.clipboard.writeText(text); return true; }
			catch { return false; }
		},
		async property() {
			test.harness.openLuaSource('scenes/root.lua'); await test.frame();
			test.ide.editor.commands.execute('sceneEditor'); await test.frame();
			const view = getActiveTab(); if (view.kind !== 'scene_editor') throw new Error('Scene Editor expected');
			await selectMember(test, view, 2);
			await test.click(view.properties[0].bounds);
		},
		async transcript() {
			test.ide.editor.commands.execute('terminal'); await test.frame();
			const view = getActiveTab(); if (view.kind !== 'terminal') throw new Error('Terminal expected');
			view.session.transcript.append('output', 'Clipboard: **literal** output'); await test.frame();
			const row = view.transcript.rows.findIndex(row => row.entry === view.session.transcript.next - 1);
			const top = view.viewport.offsetTop + row * view.layout.rowHeight;
			await test.click({ left: view.viewport.bounds.left + 4, right: view.viewport.bounds.right - 4, top, bottom: top + view.layout.rowHeight });
			return view.session.transcript.entry(view.session.transcript.next - 1).text;
		},
	};
}
