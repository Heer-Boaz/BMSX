import { check, type StudioFixture } from './studio_fixture';
import { editorFeedbackState } from '../../../ide/common/feedback_state';

/** Real menu, palette, pointer and source-navigation flows on either diagram kind. */
export async function testStudioGraphZoom(test: StudioFixture): Promise<void> {
	const { frame, click, press, runPaletteCommand, movePointer, setKey, ide } = test;
	// Expiring authoring feedback changes the canvas extent. Test zoom anchoring
	// after that unrelated presentation has retired, not across two layouts.
	await test.until(() => !editorFeedbackState.message.visible, 'zoom: preceding authoring feedback retired');
	const lens = ide.editor.editorParts.activeGroup.model.activeTab;
	if (lens.kind !== 'behavior_lens' || (lens.view.presentation.kind !== 'graph' && lens.view.presentation.kind !== 'state-graph')) throw new Error('zoom probe requires an actual Studio diagram');
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	const selected = viewport.selection!;
	const source = lens.view.selectionState.selected!;
	const model = viewport.model;
	const version = lens.workingCopy.version;
	const dirty = lens.workingCopy.dirty;
	const cycles = test.cycles();
	const originalZoom = viewport.zoom, scrollX = viewport.scrollX, scrollY = viewport.scrollY;
	const centerX = (viewport.bounds.left + viewport.bounds.right) / 2, centerY = (viewport.bounds.top + viewport.bounds.bottom) / 2;
	const anchorX = viewport.viewportToGraphX(centerX), anchorY = viewport.viewportToGraphY(centerY);
	await runPaletteCommand('Graph: Zoom Out');
	await click(graph.actionBar.overflow!.button.bounds);
	await test.clickContextCommand('graph.zoomOut');
	check(viewport.zoom === 1 / 3 && Math.abs(viewport.viewportToGraphX(centerX) - anchorX) < 1e-7
		&& Math.abs(viewport.viewportToGraphY(centerY) - anchorY) < 1e-7, 'zoom: toolbar/palette preserve the canvas-center anchor');
	console.info(`STUDIO: ${graph.kind} zoomed-out canvas ready for visual inspection`);
	await runPaletteCommand('Graph: Reset Zoom (100%)');
	check(viewport.zoom === 1, 'zoom: explicit 1:1 control restores font/layout scale');
	console.info(`STUDIO: ${graph.kind} 100-percent canvas ready for visual inspection`);
	await click(graph.actionBar.overflow!.button.bounds);
	await test.clickContextCommand('graph.zoomIn');
	await runPaletteCommand('Graph: Zoom In');
	check(viewport.zoom === 3 && viewport.model === model, 'zoom: integer magnification uses the same retained diagram');
	// Center-anchored zoom can move a left-aligned graph offscreen; reveal before inspecting its actual texels.
	viewport.reveal(selected); await frame();
	console.info(`STUDIO: ${graph.kind} zoomed-in canvas ready for visual inspection`);
	const pointer = movePointer({ left: centerX - 10, right: centerX - 10, top: centerY + 8, bottom: centerY + 8 }); await frame();
	// The display owner publishes integer logical pointer coordinates, not the fractional requested center.
	const pointerX = viewport.viewportToGraphX(pointer.viewportX), pointerY = viewport.viewportToGraphY(pointer.viewportY);
	setKey('ControlLeft', true);
	test.remote.apply([{ type: 'wheel', deltaY: 1 }]); await frame();
	setKey('ControlLeft', false); await frame();
	check(viewport.zoom === 1.5 && Math.abs(viewport.viewportToGraphX(pointer.viewportX) - pointerX) < 1e-7
		&& Math.abs(viewport.viewportToGraphY(pointer.viewportY) - pointerY) < 1e-7, 'zoom: Ctrl-wheel uses the actual pointer, not the canvas center');
	const zoom = viewport.zoom, x = viewport.scrollX, y = viewport.scrollY;
	await runPaletteCommand('Behavior Lens: Open Source');
	check(ide.editor.editorParts.activeGroup.model.activeTab.kind === 'code_editor' && lens.workingCopy.version === version, 'zoom: Source switches to unscaled code chrome without editing');
	await runPaletteCommand('Go: Back');
	check(ide.editor.editorParts.activeGroup.model.activeTab === lens && viewport.zoom === zoom && viewport.scrollX === x && viewport.scrollY === y,
		'zoom: Back restores the source occurrence and the entire view transform');
	check(viewport.model === model && viewport.selection === selected && lens.view.selectionState.selected!.rowKey === source.rowKey,
		'zoom: navigation preserves selection and does not run layout');
	await press('ShiftLeft', 'F10');
	const menu = ide.editor.contextMenu;
	check(menu.visible && menu.model.rows.some(row => row.command === 'editor.source' && row.enabled)
		&& menu.model.rows.every(row => row.command === undefined || !row.command.startsWith('graph.')), 'zoom: selected-node menu contains target actions, not viewport zoom');
	await press('Escape');
	await runPaletteCommand('Graph: Reset Zoom (100%)');
	check(!menu.visible && viewport.zoom === 1, 'zoom: dismissing the context menu restores the focused palette route');
	for (const expected of [2, 3, 4]) {
		await runPaletteCommand('Graph: Zoom In');
		check(viewport.zoom === expected, 'zoom: plus visits each canonical magnification');
	}
	check(!ide.editor.commands.isEnabled('graph.zoomIn'), 'zoom: upper endpoint disables plus');
	for (const expected of [3, 2, 1, 1 / 2, 1 / 3, 1 / 4]) {
		await runPaletteCommand('Graph: Zoom Out');
		check(viewport.zoom === expected, 'zoom: minus retraces the same levels and visits exactly 100%');
	}
	check(!ide.editor.commands.isEnabled('graph.zoomOut'), 'zoom: lower endpoint disables minus');
	for (const expected of [1 / 3, 1 / 2, 1]) {
		await runPaletteCommand('Graph: Zoom In');
		check(viewport.zoom === expected, 'zoom: plus returns from the lower endpoint through exactly 100%');
	}
	check(lens.workingCopy.version === version && lens.workingCopy.dirty === dirty && test.cycles() === cycles,
		'zoom: all gestures preserve source, history and suspended machine state');
	viewport.setZoom(originalZoom); viewport.scrollX = scrollX; viewport.scrollY = scrollY;
	await frame();
	console.info(`STUDIO: ${graph.kind} zoom / source / menu PASS`);
}
