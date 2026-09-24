import { SCENE_VIEWPORT_SOURCE } from '../../fixtures/studio/scene_viewport';
import { SCROLLBAR_WIDTH, WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { getProblemsPanelBounds, problemsPanel } from '../../../ide/workbench/contrib/problems/panel/controller';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';
import { testStudioPointerHover } from './studio_pointer_hover';
import { resolveRuntimeResource, runtimeLuaSourceRegistry } from '../../../ide/runtime/sources';

export async function runStudioSceneViewport(test: StudioFixture) {
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'scene viewport: cartridge execution starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	await testStudioSceneViewport(test);
	return { hostFrames: test.observations.hostFrames, cycles: test.cycles() };
}

/** Actual font/layout, divider, focus, captured pointer and source edits on independent Lua. */
export async function testStudioSceneViewport(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, movePointer, setPointerButton, runPaletteCommand } = test;
	ide.editor.setFontVariant('tiny');
	// Open actual workspace inputs until the tab-bar owner publishes horizontal overflow.
	// Their contents and names are irrelevant to this form fixture.
	for (const resource of ide.sources.luaResources) {
		if (resource.domain !== 0) continue;
		await ide.editor.navigation.openResource(resource); await frame(); await frame();
		if (editorChromeState.tabScrollbar.isVisible()) break;
	}
	await ide.editor.navigation.openResource(resolveRuntimeResource(ide.sources, { domain: 0, path: 'scenes/root.lua' })!);
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
	// Reuse a real workspace input as transport, not its game implementation.
	const record = runtimeLuaSourceRegistry(ide.sources, model.resource.domain)!.records.find(record =>
		record.program_module && !record.generated && record.source_path !== model.resource.path && !record.module_path.startsWith('cartlib/'))!;
	await ide.editor.navigation.openResource(resolveRuntimeResource(ide.sources, { domain: model.resource.domain, path: record.source_path })!);
	const provider = harness.getActiveEditorDocument().model;
	const originalProvider = provider.buffer.getText();
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: "return require('cartlib/world/scene_library')" }]);
	const apiOffset = authored.indexOf('cartlib/world/scene_library');
	model.pushEditOperations([{ offset: apiOffset, deleteLength: 'cartlib/world/scene_library'.length, text: record.module_path }]);
	await ide.editor.navigation.openResource(model.resource);
	check(await openSceneEditor(test) === scene, 'scene imports: the actual menu reopens the same scene through a reexport');
	await selectMember(test, scene, 0);
	await test.click(scene.properties[0].bounds);
	await press('Digit9');
	check(x.pending && x.field.focusTarget.hasFocus, 'scene imports: a real property draft is focused');
	const document = scene.document, version = scene.version, sourceVersion = model.version;
	provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unchanged API\n' }]);
	await frame();
	check(scene.document === document && scene.version === version && x.pending && x.field.focusTarget.hasFocus,
		'scene imports: an equivalent dependency edit retains projection, focus and draft');
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return replacement' }]);
	check(x.commit() && model.version === sourceVersion,
		'scene imports: even commit before the next frame cannot publish the valid draft to a revoked source target');
	await frame();
	check(scene.properties[0].value === null && x.field.readOnly && !x.pending && !x.field.focusTarget.hasFocus,
		'scene imports: revocation detaches and cancels the old field rather than committing it on blur');
	check(model.version === sourceVersion, 'scene imports: revocation never writes the consumer');
	provider.undo(); await frame();
	await selectMember(test, scene, 0);
	check(scene.properties[0].value === 11 && !x.field.readOnly, 'scene imports: provider Undo restores editing admission');
	provider.undo(); model.undo(); provider.undo(); await frame();
	check(model.buffer.getText() === authored && provider.buffer.getText() === originalProvider,
		'scene imports: ordinary Undo restores both independent source histories');
	await selectMember(test, scene, 0);
	const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
	const resize = async (y: number) => {
		const panel = getProblemsPanelBounds()!;
		movePointer(point(10, panel.top)); await frame();
		setPointerButton('pointer_primary', true); await frame();
		movePointer(point(10, y)); await frame();
		setPointerButton('pointer_primary', false); await frame();
		check(scene.layout.bottom === editorViewState.codeAreaBottom,
			'A02: pane consumes resized parent bounds in the same frame');
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
		ide.editor.setFontVariant(variant); await frame();
		check(editorChromeState.tabScrollbar.isVisible() && editorViewState.tabBarTotalHeight === editorViewState.tabBarHeight + SCROLLBAR_WIDTH,
			'A02/A04: overflowing tabs remain one bounded row at either font');
		check(scene.layout.top === editorViewState.codeAreaTop && scene.layout.bottom === editorViewState.codeAreaBottom,
			'A02/A04: font and tab-strip height reach the child layout in one update');
		if (!problemsPanel.isVisible) await runPaletteCommand('View: Problems Panel');
		await testStudioPointerHover(test, scene);
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
		// Options extend the form beyond XYZ. Position X just behind the header
		// through keyboard scrolling, independently of the total content height.
		await press('Home');
		const hideXSteps = Math.ceil(scene.properties[0].contentBounds.bottom / scene.outline.layout.rowHeight);
		for (let index = 0; index < hideXSteps; index += 1) await press('ArrowDown');
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
		const selectedProblem = problemsPanel.selectedDiagnostic;
		const panel = getProblemsPanelBounds()!;
		await test.click(point(panel.left + 4, panel.bottom - 1));
		check(problemsPanel.isFocused && problemsPanel.getHoverIndex() === -1 && ide.editor.editorPanes.activePane === pane,
			'A02: Problems padding focuses the panel without activating a clipped diagnostic');
		check(problemsPanel.selectedDiagnostic === selectedProblem && model.buffer.getText() === authored,
			'A02: panel focus does not change diagnostic selection or authored source');
		pane.focus(); await frame();
		check(!problemsPanel.isFocused && problemsPanel.selectedDiagnostic === selectedProblem,
			'A02: returning to Scene retains an inactive Problems selection');
		console.log(`STUDIO-SCENE-VIEWPORT:${variant}:PASS`);
	}
	// Keep the final renderer screenshot on a short viewport with the last option and notes visible.
	await press('Escape');
	pane.focus(); await press('Tab'); await press('End'); await frame();
	check(model.buffer.getText() === authored, 'A02: presentation never rewrites the fixture');
}
