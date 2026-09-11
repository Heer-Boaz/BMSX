import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { editorPointerState } from '../../../ide/input/pointer/state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Real menu, palette, pointer and source-navigation flows on either diagram kind. */
export async function testStudioGraphZoom(test: StudioFixture): Promise<void> {
	const { frame, click, press, runPaletteCommand, movePointer, setKey, input, clock, ide } = test;
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || (lens.view.presentation.kind !== 'graph' && lens.view.presentation.kind !== 'state-graph')) throw new Error('zoom probe requires an actual Studio diagram');
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	const selected = viewport.selection!;
	const source = lens.view.selection!;
	const model = viewport.model;
	const version = lens.workingCopy.version;
	const dirty = lens.workingCopy.dirty;
	const cycles = test.cycles();
	const originalZoom = viewport.zoom, scrollX = viewport.scrollX, scrollY = viewport.scrollY;
	const centerX = (viewport.bounds.left + viewport.bounds.right) / 2, centerY = (viewport.bounds.top + viewport.bounds.bottom) / 2;
	const anchorX = viewport.viewportToGraphX(centerX), anchorY = viewport.viewportToGraphY(centerY);
	await runPaletteCommand('Graph: Zoom Out');
	await click(graph.actionBar.items.find(item => item.command === 'graph.zoomOut')!.bounds);
	check(viewport.zoom < 0.7 && Math.abs(viewport.viewportToGraphX(centerX) - anchorX) < 1e-7
		&& Math.abs(viewport.viewportToGraphY(centerY) - anchorY) < 1e-7, 'zoom: toolbar/palette preserve the canvas-center anchor');
	console.info(`STUDIO: ${graph.kind} zoomed-out canvas ready for visual inspection`);
	await click(graph.actionBar.items.find(item => item.command === 'graph.resetZoom')!.bounds);
	check(viewport.zoom === 1, 'zoom: explicit 1:1 control restores font/layout scale');
	await click(graph.actionBar.items.find(item => item.command === 'graph.zoomIn')!.bounds);
	await runPaletteCommand('Graph: Zoom In');
	check(Math.abs(viewport.zoom - 1.44) < 1e-7 && viewport.model === model, 'zoom: magnification uses the same retained diagram');
	console.info(`STUDIO: ${graph.kind} zoomed-in canvas ready for visual inspection`);
	movePointer({ left: centerX - 10, right: centerX - 10, top: centerY + 8, bottom: centerY + 8 }); await frame();
	// The display owner publishes integer logical pointer coordinates, not the fractional requested center.
	const pointer = editorPointerState.lastPointerSnapshot!;
	const pointerX = viewport.viewportToGraphX(pointer.viewportX), pointerY = viewport.viewportToGraphY(pointer.viewportY);
	setKey('ControlLeft', true);
	input.inputAxis1('pointer:0', 'pointer_wheel', WHEEL_SCROLL_STEP, clock.now()); await frame();
	setKey('ControlLeft', false); await frame();
	check(viewport.zoom < 1.44 && Math.abs(viewport.viewportToGraphX(pointer.viewportX) - pointerX) < 1e-7
		&& Math.abs(viewport.viewportToGraphY(pointer.viewportY) - pointerY) < 1e-7, 'zoom: Ctrl-wheel uses the actual pointer, not the canvas center');
	const zoom = viewport.zoom, x = viewport.scrollX, y = viewport.scrollY;
	await runPaletteCommand('Behavior Lens: Open Source');
	check(getActiveTab().kind === 'code_editor' && lens.workingCopy.version === version, 'zoom: Source switches to unscaled code chrome without editing');
	await runPaletteCommand('Go: Back');
	check(getActiveTab() === lens && viewport.zoom === zoom && viewport.scrollX === x && viewport.scrollY === y,
		'zoom: Back restores the source occurrence and the entire view transform');
	check(viewport.model === model && viewport.selection === selected && lens.view.selection!.rowKey === source.rowKey,
		'zoom: navigation preserves selection and does not run layout');
	await press('ShiftLeft', 'F10');
	const menu = ide.editor.contextMenu;
	check(menu.visible && menu.model.rows.some(row => row.command === 'graph.resetZoom' && row.enabled), 'zoom: selected-node keyboard menu offers the same focused graph commands');
	const reset = menu.model.rows.find(row => row.command === 'graph.resetZoom')!;
	menu.model.viewport.scrollbar.reveal(reset.top, reset.bottom);
	await frame();
	await click({ left: menu.model.viewport.bounds.left, right: menu.model.viewport.bounds.right,
		top: menu.model.viewport.offsetTop + reset.top, bottom: menu.model.viewport.offsetTop + reset.bottom });
	check(!menu.visible && viewport.zoom === 1, 'zoom: context-menu activation resets scale and restores graph focus');
	check(lens.workingCopy.version === version && lens.workingCopy.dirty === dirty && test.cycles() === cycles,
		'zoom: all gestures preserve source, history and suspended machine state');
	viewport.setZoom(originalZoom); viewport.scrollX = scrollX; viewport.scrollY = scrollY;
	await frame();
	console.info(`STUDIO: ${graph.kind} zoom / source / menu PASS`);
}
