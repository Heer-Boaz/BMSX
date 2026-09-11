import type { SceneEditorInput } from '../../../ide/workbench/contrib/scene_editor/editor_input';
import { getProblemsPanelBounds } from '../../../ide/workbench/contrib/problems/panel/controller';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { check, type StudioFixture } from './studio_fixture';

/** Real ordered dispatch: no synthetic leave and no direct hover-state repair. */
export async function testStudioPointerHover(test: StudioFixture, scene: SceneEditorInput): Promise<void> {
	const { ide, frame, press, click, movePointer } = test;
	const text = scene.workingCopy.buffer.getText();
	const source = scene.actionBar.items.find(item => item.command === 'sceneEditor.source')!;
	movePointer(source.bounds); await frame();
	check(scene.actionBar.hoveredCommand === source.command, 'A09: the real Scene Source button is hovered');
	movePointer(getProblemsPanelBounds()!); await frame();
	check(scene.actionBar.hoveredCommand === null, 'A09: Source → Problems without a click sends leave');
	movePointer(source.bounds); await frame();
	movePointer(editorChromeState.topBarBounds); await frame();
	check(scene.actionBar.hoveredCommand === null, 'A09: Source → chrome sends leave');
	movePointer(source.bounds); await frame();
	await click(editorChromeState.menuEntryBounds.file);
	check(editorChromeState.openMenuId === 'file', 'A09: actual menu is open');
	movePointer(source.bounds); await frame();
	check(scene.actionBar.hoveredCommand === null, 'A09: an open menu excludes underlying hover, not only clicks');
	await click(editorChromeState.menuEntryBounds.file);
	check(editorChromeState.openMenuId === null, 'A09: closing the menu restores the underlying route');
	await frame();
	movePointer(source.bounds); await frame();
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	const quickInput = ide.editor.quickInput;
	check(quickInput.visible && scene.actionBar.hoveredCommand === null, 'A09: palette revokes the previous routed hover');
	const list = quickInput.model.list;
	movePointer({ left: list.layout.contentLeft + 2, right: list.layout.contentLeft + 2,
		top: list.layout.contentTop + 2, bottom: list.layout.contentTop + 2 });
	await frame();
	check(list.hoverIndex >= 0, 'A09: actual palette result row is hovered');
	const selection = list.selectionIndex;
	movePointer({ left: -10, right: -10, top: -10, bottom: -10 }); await frame();
	check(list.hoverIndex === -1 && list.selectionIndex === selection, 'A09: canvas leave clears pointer feedback, not keyboard selection');
	await press('Escape');
	movePointer(source.bounds); await frame();
	check(scene.actionBar.hoveredCommand === source.command, 'A09: return from popup re-enters Source');
	ide.editor.deactivate();
	check(scene.actionBar.hoveredCommand === null, 'A09: editor hide leaves immediately without another pointer poll');
	ide.editor.activate(); await frame();
	check(scene.workingCopy.buffer.getText() === text, 'A09: hover/lifecycle changes never edit source');
	console.info('STUDIO: pointer hover / Problems / chrome / menu / palette / canvas leave / hide PASS');
}
