import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import type { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import type { CommandQuickPickItem } from '../../../ide/workbench/contrib/commands/quick_pick_provider';
import { inputFocus } from '../../../ide/input/focus';
import { check, type StudioFixture } from './studio_fixture';

/** Ordinary commands enter real work-area handles; the owners retain default versus automatic intent. */
export async function testStudioSashSizing(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput, theme: number): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace, panel = editor.resourcePanel;
	const group = editor.editorParts.findGroup(source)!, model = source.workingCopy;
	const text = model.buffer.getText(), version = model.version, dirty = model.dirty, undo = model.canUndo, redo = model.canRedo;
	const selection = client.consumer.selection, row = source.context.view.cursorRow, column = source.context.view.cursorColumn;
	const hierarchyVisible = main.regionLayout.hierarchyVisible, detailsVisible = main.regionLayout.detailsVisible;
	const filesVisible = panel.isVisible(), recipient = editor.guestInputRecipient;
	// Hiding sibling regions admits a real feasible interval in the small reading surface.
	if (hierarchyVisible) await test.runPaletteCommand('Workspace: Hide Hierarchy');
	if (detailsVisible) await test.runPaletteCommand('Workspace: Hide Details');
	await test.runPaletteCommand('View: Focus Files');
	const filesOrigin = inputFocus.admittedTarget!, filesControl = panel.sash;
	await test.runPaletteCommand('Workspace: Resize Focused View Width');
	check(inputFocus.admittedTarget === filesControl.focusTarget && filesControl.interactionActive,
		'sash sizing: the actual Palette enters the exact Files handle, not a document or Main boundary');
	await test.press('ArrowRight'); await test.press('ControlLeft', 'ArrowRight');
	check(panel.split.canReset && editor.statusBar.itemsLayout.items.peek(0).item === filesControl.statusItems[0]
		&& editor.statusBar.itemsLayout.items.peek(0).visible,
		'sash sizing: live Files resizing publishes its own retained preference and visible native operation guidance');
	await test.capture?.(`sash-sizing-${editor.fontVariant}-theme-${theme}-files`);
	await test.press('Home'); await test.press('Enter');
	check(!panel.split.canReset && panel.split.ratio === panel.split.defaultRatio && inputFocus.admittedTarget === filesOrigin,
		'sash sizing: Home restores Files default ratio and Enter returns to the exact invoking client');
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	await test.runPaletteCommand('Workspace: Reset Focused View Width');
	check(!panel.split.canReset && inputFocus.admittedTarget === filesOrigin,
		'sash sizing: direct reset changes only sizing intent without changing native Files focus');
	await test.press('ControlLeft', 'KeyB');
	await test.runPaletteCommand('Workspace: Show Details');
	await test.runPaletteCommand('Workspace: Focus Details');
	const detailsOrigin = inputFocus.admittedTarget!, detailsControl = main.resizeControlForTarget(detailsOrigin, 'width')!;
	await test.runPaletteCommand('Workspace: Resize Focused View Width');
	check(inputFocus.admittedTarget === detailsControl.focusTarget && detailsControl.interactionActive,
		'sash sizing: Main Details enters its own actual native width handle');
	await test.press('ArrowLeft'); await test.press('ControlLeft', 'ArrowLeft');
	check(main.regionLayout.detailsWidth !== undefined && editor.statusBar.itemsLayout.items.peek(0).item === detailsControl.statusItems[0]
		&& editor.statusBar.itemsLayout.items.peek(0).visible,
		'sash sizing: Details live sizing retains an explicit request and presents the actual operation guidance');
	await test.capture?.(`sash-sizing-${editor.fontVariant}-theme-${theme}-details`);
	await test.press('Home'); await test.press('Escape');
	check(main.regionLayout.detailsWidth === undefined && !main.regionLayout.detailsSash.canReset
		&& inputFocus.admittedTarget === detailsOrigin,
		'sash sizing: Home restores automatic Details sizing and Escape returns without rolling back that accepted reset');
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	await test.runPaletteCommand('Workspace: Reset Focused View Width');
	check(main.regionLayout.detailsWidth === undefined && inputFocus.admittedTarget === detailsOrigin,
		'sash sizing: direct Details reset restores automatic intent without replacing its field or focus');
	if (!detailsVisible) await test.runPaletteCommand('Workspace: Hide Details');
	if (hierarchyVisible) await test.runPaletteCommand('Workspace: Show Hierarchy');
	if (filesVisible) await test.press('ControlLeft', 'KeyB');
	await test.clickTab(source.id, 1, group);
	check(editor.mainWorkspace.primary === client && client.consumer.selection === selection
		&& group.model.activeTab === source && group.panes.activePane?.input === source
		&& editor.editorParts.findGroup(source) === group && editor.guestInputRecipient === recipient
		&& model.buffer.getText() === text && model.version === version && model.dirty === dirty && model.canUndo === undo && model.canRedo === redo
		&& source.context.view.cursorRow === row && source.context.view.cursorColumn === column,
		'sash sizing: work-area input preserves Main selection, exact document membership, canonical history, Source caret and guest routing');
}

/** Run once, independently of active guidance captures: invalid blur intentionally publishes a warning. */
export async function testStudioSashResetBlur(test: StudioFixture, client: ScenePrimaryClient, source: CodeEditorInput): Promise<void> {
	const editor = test.ide.editor, main = editor.mainWorkspace, panel = editor.resourcePanel, model = source.workingCopy;
	const group = editor.editorParts.findGroup(source)!, hierarchyVisible = main.regionLayout.hierarchyVisible;
	const detailsVisible = main.regionLayout.detailsVisible, filesVisible = panel.isVisible();
	const text = model.buffer.getText(), version = model.version, dirty = model.dirty, undo = model.canUndo, redo = model.canRedo;
	if (filesVisible) await test.press('ControlLeft', 'KeyB');
	if (hierarchyVisible) await test.runPaletteCommand('Workspace: Hide Hierarchy');
	await test.runPaletteCommand('Workspace: Focus Details');
	await test.runPaletteCommand('Workspace: Increase Focused View Width');
	const field = client.details.control.controls[0];
	await test.click(client.view.details.properties[0].bounds);
	await test.press('ControlLeft', 'KeyA'); await test.press('Minus');
	const draftOrigin = inputFocus.admittedTarget!;
	check(draftOrigin === field.field.focusTarget && field.pending && model.version === version,
		'sash sizing: ordinary numeric input retains an invalid field draft without publishing canonical source');
	// Palette admission performs ordinary blur: the numeric field owns invalid-draft
	// cancellation before Reset is chosen; the layout action must add no source edit.
	await test.press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(editor.quickInput.visible && !field.pending && model.version === version,
		'sash sizing: ordinary Palette blur settles the invalid numeric draft without publishing canonical source');
	const settledFieldText = field.field.text;
	await test.clipboard.writeText('Workspace: Reset Focused View Width'); await test.press('ControlLeft', 'KeyV');
	const resetIndex = editor.quickInput.model.list.rows.findIndex(item => (item.item as CommandQuickPickItem).command === 'workspace.resetViewWidth');
	check(resetIndex >= 0, 'sash sizing: Reset retains its actual native Details origin after the field-owned blur');
	for (let index = 0; index < resetIndex; index++) await test.press('ArrowDown');
	await test.press('Enter');
	check(main.regionLayout.detailsWidth === undefined,
		'sash sizing: actual Palette reset restores automatic Details sizing intent');
	check(inputFocus.admittedTarget === draftOrigin,
		'sash sizing: actual Palette reset returns to the exact invoking field');
	check(!field.pending && field.field.text === settledFieldText,
		'sash sizing: actual Palette reset leaves the field-owned post-blur value unchanged');
	check(model.version === version,
		'sash sizing: actual Palette reset cannot publish canonical source through an unrelated numeric draft');
	if (!detailsVisible) await test.runPaletteCommand('Workspace: Hide Details');
	if (hierarchyVisible) await test.runPaletteCommand('Workspace: Show Hierarchy');
	if (filesVisible) await test.press('ControlLeft', 'KeyB');
	await test.clickTab(source.id, 1, group);
	check(editor.mainWorkspace.primary === client && editor.editorParts.findGroup(source) === group
		&& group.model.activeTab === source && model.buffer.getText() === text && model.version === version
		&& model.dirty === dirty && model.canUndo === undo && model.canRedo === redo,
		'sash sizing: field-owned blur and native layout reset retain canonical source, history and independent Main/document identities');
}
