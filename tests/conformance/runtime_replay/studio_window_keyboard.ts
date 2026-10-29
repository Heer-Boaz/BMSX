import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { EditorPart } from '../../../ide/workbench/services/editor/editor_part';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

/** Ordinary system-menu input exercises the same real window across both fonts and themes. */
export async function testStudioWindowKeyboard(test: StudioFixture, source: CodeEditorInput, part: EditorPart, theme: number): Promise<void> {
	const editor = test.ide.editor, window = part.window!, model = window.model;
	const group = editor.editorParts.findGroup(source)!;
	const text = source.workingCopy.buffer.getText(), version = source.workingCopy.version;
	const dirty = source.workingCopy.dirty, undo = source.workingCopy.canUndo, redo = source.workingCopy.canRedo;
	const primary = editor.mainWorkspace.primary, recipient = editor.guestInputRecipient;
	const before = { ...model.requestedBounds }, placement = model.placement;
	let publications = 0;
	const unbind = model.onDidChangePlacement(() => publications++);
	try {
		await test.press('AltLeft', 'Space');
		check(editor.contextMenu.visible && editor.contextMenu.invocationOrigin === window.focusTarget,
			'window keyboard: Alt+Space opens the actual document window menu, not the Source context menu');
		await test.clickContextCommand('window.move');
		check(inputFocus.admittedTarget === window.focusTarget && editor.guestInputRecipient === null,
			'window keyboard: the accepted Move owns chrome input without entering document content');
		await test.press('ArrowRight'); await test.press('ArrowDown');
		check(publications === 0 && model.placement === placement
			&& model.requestedBounds.left === before.left && model.requestedBounds.top === before.top
			&& model.requestedBounds.right === before.right && model.requestedBounds.bottom === before.bottom,
			'window keyboard: a displayed move remains prospective and cannot publish persisted placement');
		check(editor.statusBar.itemsLayout.items.peek(0).item === window.statusItems[0]
			&& editor.statusBar.itemsLayout.items.peek(0).visible,
			'window keyboard: the visible shared status consumes the native Move operation item, not stale feedback');
		await test.capture?.(`window-keyboard-${editor.fontVariant}-theme-${theme}-move`);
		await test.press('Escape');
		check(publications === 0 && inputFocus.admittedTarget === window.focusTarget,
			'window keyboard: Escape discards the move without publishing or entering content');
		await test.press('AltLeft', 'Space'); await test.clickContextCommand('window.move');
		await test.press('ArrowLeft'); await test.press('ArrowUp'); await test.press('Enter');
		check(publications === 1 && model.placement === 'normal' && inputFocus.admittedTarget === window.focusTarget,
			'window keyboard: Enter publishes the accepted Move once and keeps native title focus');
		await test.press('AltLeft', 'Space'); await test.clickContextCommand('window.resize');
		await test.press('ArrowLeft'); await test.press('ArrowUp');
		check(publications === 1 && window.statusItems.length > 0,
			'window keyboard: sizing owns a live operation hint while committed placement remains unchanged');
		check(editor.statusBar.itemsLayout.items.peek(0).item === window.statusItems[0]
			&& editor.statusBar.itemsLayout.items.peek(0).visible,
			'window keyboard: the visible shared status consumes the native Resize operation item');
		await test.capture?.(`window-keyboard-${editor.fontVariant}-theme-${theme}-resize`);
		await test.press('Escape');
		check(publications === 1 && inputFocus.admittedTarget === window.focusTarget,
			'window keyboard: discarded sizing does not publish a placement or transfer keyboard focus');
		await test.press('AltLeft', 'Space'); await test.clickContextCommand('window.resize');
		await test.press('ControlLeft', 'ArrowLeft'); await test.press('ControlLeft', 'ArrowUp'); await test.press('Enter');
		check(publications === 2 && inputFocus.admittedTarget === window.focusTarget,
			'window keyboard: fine sizing commits once without selecting an editor or another window');
		check(editor.editorParts.partForGroup(group) === part && group.model.activeTab === source
			&& group.panes.activePane?.input === source && editor.editorParts.findGroup(source) === group
			&& editor.mainWorkspace.primary === primary && editor.guestInputRecipient === recipient
			&& source.workingCopy.buffer.getText() === text && source.workingCopy.version === version
			&& source.workingCopy.dirty === dirty && source.workingCopy.canUndo === undo && source.workingCopy.canRedo === redo,
			'window keyboard: window interaction preserves exact source membership, canonical history, Main and guest routing');
	} finally { unbind(); }
	await test.clickTab(source.id, 1, group);
	check(inputFocus.admittedTarget === group.panes.activePane?.commandTarget,
		'window keyboard: ordinary tab input returns to the retained Source control');
}
