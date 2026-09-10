import { SCENE_VIEWPORT_SOURCE } from '../../fixtures/studio/scene_viewport';
import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { getProblemsPanelBounds, problemsPanel } from '../../../ide/workbench/contrib/problems/panel/controller';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Actual font/layout, divider, focus, captured pointer and source edits on independent Lua. */
export async function testStudioSceneViewport(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, movePointer, setPointerButton, runPaletteCommand } = test;
	ide.editor.setFontVariant('tiny');
	// Open actual workspace inputs until the tab-bar owner publishes a second row.
	// Their contents and names are irrelevant to this form fixture.
	for (const resource of ide.sources.luaResources) {
		if (resource.domain !== 0) continue;
		harness.openLuaSource(resource.path); await frame(); await frame();
		if (editorViewState.tabBarRowCount > 1) break;
	}
	harness.openLuaSource('scenes/root.lua'); // Existing transport; no assertions depend on this cart's definitions.
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: SCENE_VIEWPORT_SOURCE }]);
	const authored = model.buffer.getText();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 0);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('A02: actual Scene pane required');
	const [x, y, z] = pane.controls;
	check(scene.properties[0].value === 11 && scene.properties[2].value === 33, 'A02: independent fixture is selected');
	const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
	const resize = async (y: number) => {
		const panel = getProblemsPanelBounds()!;
		movePointer(point(10, panel.top)); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(point(10, y)); await frame();
		setPointerButton('pointer_primary', false); await frame();
		await frame(); // Tab/chrome layout publication precedes pane reflow.
	};
	const wheel = async (steps: number) => {
		movePointer(scene.details.bounds); await frame();
		test.input.inputAxis1('pointer:0', 'pointer_wheel', WHEEL_SCROLL_STEP * steps, test.clock.now());
		await frame();
	};
	const visible = (index: number) => {
		const field = scene.properties[index].bounds;
		check(field.top >= scene.details.bounds.top && field.bottom <= scene.details.bounds.bottom, `A02: focused ${index} is entirely inside the viewport`);
	};
	for (const variant of ['msx', 'tiny'] as const) {
		ide.editor.setFontVariant(variant); await frame(); await frame();
		check(editorViewState.tabBarRowCount > 1, 'A02: actual tab wrapping contributes to available height');
		if (!problemsPanel.isVisible) await runPaletteCommand('View: Problems Panel');
		const bodyTop = scene.layout.top + (editorViewState.lineHeight + 4) * 2;
		await resize(bodyTop + 52);
		check(scene.details.height > 30 && scene.details.height < scene.details.contentHeight && scene.details.scrollbar.isVisible(),
			`A02: ${variant} Problems resize creates a real scrollable form`);
		pane.focus(); await press('Tab');
		check(inputFocus.target!.commandContext === x.field.focusTarget.parent, 'A02: scroll-area focus routes document commands explicitly');
		await press('End');
		const note = scene.detailsText.at(-1)!;
		check(scene.details.offsetTop + note.top + editorViewState.lineHeight <= scene.details.bounds.bottom,
			'A02: keyboard scroll reaches the last explanatory line');
		const hidden = scene.properties[0].bounds;
		check(hidden.bottom <= scene.details.bounds.top && hidden.bottom > scene.details.bounds.top - scene.outline.layout.rowHeight,
			'A02: X is clipped behind the property header, not a visible input');
		await test.click(point(hidden.left + 4, hidden.bottom - 1));
		check(!x.field.focusTarget.hasFocus && model.buffer.getText() === authored,
			'A02: clicking clipped field geometry cannot activate or edit that field');
		await press('Tab'); // Header click focused the outline; re-enter the scroll area.
		await press('Tab'); check(x.field.focusTarget.hasFocus, 'A02: Tab enters X'); visible(0);
		await press('Tab'); check(y.field.focusTarget.hasFocus, 'A02: Tab enters Y'); visible(1);
		await press('Tab'); check(z.field.focusTarget.hasFocus, 'A02: Tab reveals Z rather than focusing an invisible value'); visible(2);
		await press('Minus');
		check(z.pending && model.buffer.getText() === authored, 'A02: invalid unsubmitted draft has not touched source');
		movePointer(scene.details.scrollbar.getThumb()!); await frame();
		setPointerButton('pointer_primary', true); await frame();
		check(pointerCapture.active && z.field.focusTarget.hasFocus && z.pending, 'A02: scrollbar capture preserves the field draft');
		const track = scene.details.scrollbar.getTrack();
		movePointer(point(track.left + 1, track.bottom - 1)); await frame();
		await press('Escape');
		check(!pointerCapture.active && z.pending && z.field.focusTarget.hasFocus, 'A02: first Escape cancels capture, not the draft');
		setPointerButton('pointer_primary', false); await frame();
		const scroll = scene.details.scrollTop;
		for (let index = 0; index < 8; index += 1) await frame();
		check(scene.details.scrollTop === scroll, 'A02: stationary frames do not re-reveal and undo manual scroll');
		await wheel(-1);
		check(scene.details.scrollTop < scroll && z.pending && model.buffer.getText() === authored, 'A02: wheel moves the form without focus or source changes');
		await press('Escape');
		pane.focus();
		for (let index = 0; index < 4; index += 1) await press('Tab');
		check(z.field.focusTarget.hasFocus, 'A02: normal focus traversal returns to Z'); visible(2);
		await press('Digit9'); await press('Enter');
		check(model.buffer.getText() === SCENE_VIEWPORT_SOURCE.replace('z = 33', 'z = 09') + original && scene.properties[2].value === 9,
			'A02: the revealed bottom field edits only its own canonical Lua value');
		await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === authored, 'A02: one document Undo restores the accepted edit');
		for (let index = 0; index < 4; index += 1) await press('Tab');
		await resize(bodyTop + 38);
		check(z.field.focusTarget.hasFocus, 'A02: divider resize preserves the field focus'); visible(2);
		await resize(scene.layout.top);
		check(scene.details.height === 0 && !scene.details.scrollbar.isVisible(), 'A02: a fully collapsed editor has no fabricated content viewport or thumb');
		await resize(bodyTop + 38);
		check(z.field.focusTarget.hasFocus, 'A02: expanding a collapsed viewport retains the actual focused field'); visible(2);
		console.log(`STUDIO-SCENE-VIEWPORT:${variant}:PASS`);
	}
	// Keep the final renderer screenshot on a short viewport with Z and the last notes visible.
	await press('Escape');
	pane.focus(); await press('Tab'); await press('End'); await frame();
	check(model.buffer.getText() === authored, 'A02: presentation never rewrites the fixture');
}
