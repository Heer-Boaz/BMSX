import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { runtimeSourceProjectRootPath } from '../../../ide/runtime/sources';
import { workspaceRecords } from '../../../ide/workspace/records';
import { resolveWorkspacePath } from '../../../ide/workspace/path';
import { CartMapPane } from '../../../ide/workbench/contrib/cart_maps/editor_pane';
import type { CartMapInput } from '../../../ide/workbench/contrib/cart_maps/editor_input';
import type { SerializedEditorGroup } from '../../../ide/workbench/services/editor/editor_serialization';
import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { persistWorkspaceSessionLocally } from '../../../ide/workbench/workspace/storage';
import { check, type StudioFixture } from './studio_fixture';
import { typeSourceText } from './studio_scene_authoring';

export type CartMapExpectation = {
	readonly sourcePath: string;
	readonly source: string;
	readonly group: SerializedEditorGroup;
	readonly x: number;
	readonly y: number;
};

async function openMap(test: StudioFixture, name: string): Promise<CartMapInput> {
	await test.press('ControlLeft', 'Comma');
	await test.press('ControlLeft', 'KeyA');
	await typeSourceText(test, name);
	await test.press('Enter');
	await test.until(() => getActiveTab().kind === 'code_editor' && getActiveTab().resource?.path.endsWith(`${name}.yaml`) === true,
		'map: file picker opens the canonical YAML source');
	await test.runPaletteCommand('Map Editor: Open');
	const input = getActiveTab();
	if (input.kind !== 'cart_map') throw new Error('Map command must open the source-backed map pane');
	return input;
}

async function selectMapItem(test: StudioFixture, input: CartMapInput, cart: 'pietious' | 'nemesis_s'): Promise<void> {
	const tree = input.tree;
	const root = cart === 'pietious' ? tree.roots.find(root => root.element.sheet.key === '2')! : tree.roots[0];
	for (const target of [root, root.children[cart === 'pietious' ? 3 : 0]]) {
		const index = tree.rows.indexOf(target), layout = tree.layout;
		check(index >= tree.scroll && index < tree.scroll + layout.visibleRowCount, 'map: selected source member has a visible outline row');
		const top = layout.contentTop + (index - tree.scroll) * layout.rowHeight;
		await test.click({ left: layout.contentLeft, right: layout.contentRight, top, bottom: top + layout.rowHeight });
		check(tree.rows[tree.selectionIndex] === target, 'map: pointer selects the requested authored member');
		if (target === root && root.collapsed) await test.press('ArrowRight');
	}
	check(input.selected !== undefined, 'map: source member exposes its editable coordinates');
}

/** Normal host-input navigation/property/grid dispatch; source and runtime reads are assertions. */
export async function runStudioCartMaps(test: StudioFixture, cart: 'pietious' | 'nemesis_s', restored?: CartMapExpectation) {
	// The browser driver performs a real page reload; this is the same checkpoint
	// boundary as the product, not an explicit serialize/deserialize test shortcut.
	window.addEventListener('pagehide', persistWorkspaceSessionLocally);
	if (restored !== undefined) {
		const input = getActiveTab();
		if (input.kind !== 'cart_map') throw new Error('map: fresh browser session restores the active map editor');
		const model = input.workingCopy;
		check(JSON.stringify(editorTabGroup.serialize(test.ide.editor.editorInputSerializers)) === JSON.stringify(restored.group),
			'map: fresh reload restores ordered views, active selection and map view state');
		check(model.resource.path === restored.sourcePath && model.buffer.getText() === restored.source && !model.dirty && !model.canUndo,
			'map: reload has exact saved YAML and a fresh, clean working copy without invented Undo');
		check([...editorTextModelService.models].filter(model => model.resource.domain === 0 && model.resource.path === restored.sourcePath).length === 1,
			'map: source and visual views restore one canonical model');
		await test.press('ControlRight', 'ShiftRight');
		await test.frame();
		check(input.selected?.x === restored.x && input.selected.y === restored.y,
			'map: first visible render preserves the restored edited selection');
		await test.capture?.('fresh-reload');
		return { restored: true };
	}
	await test.until(() => test.ide.sources.activeCartridgeSlot === 0, 'map: actual cartridge starts');
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	const name = cart === 'pietious' ? 'castle_map' : 'nemesis_s_stage';
	let input = await openMap(test, name);
	await selectMapItem(test, input, cart);
	const model = input.workingCopy, source = model.buffer.getText();
	const x = cart === 'pietious' ? 13 : 257, y = cart === 'pietious' ? 13 : 1;
	check(input.selected!.x === x && input.selected!.y === y, 'map: actual shipped member coordinates are exposed');
	const offset = cart === 'pietious' ? source.indexOf('    x: 13\n    y: 13') + '    x: '.length
		: source.indexOf('m', source.indexOf('\nmap_rows:\n') + '\nmap_rows:\n'.length);
	check(source.slice(offset, offset + 2) === (cart === 'pietious' ? '13' : 'm '), 'map: independent source oracle locates only the accepted tokens');
	const expected = source.slice(0, offset) + (cart === 'pietious' ? '14' : ' m') + source.slice(offset + 2);
	const media = test.ide.sources.currentBlua32Media, rom = test.ide.sources.cartridgeSlots[0]!.rom.bytes, cycles = test.cycles();
	const path = resolveWorkspacePath(model.resource.path, runtimeSourceProjectRootPath(test.ide.sources, 0));
	const savedBefore = (await workspaceRecords.provider.read(path))!.contents;
	await test.capture?.('selected');
	const sheet = input.grid.content, scrollX = input.grid.horizontal.getScroll(), scrollY = input.grid.vertical.getScroll();
	const emptyLeft = input.grid.bounds.left + (x - 1) * input.grid.cellSize - scrollX;
	const emptyTop = input.grid.bounds.top + y * input.grid.cellSize - scrollY;
	check(!sheet!.markers.some(marker => marker.x === x - 1 && marker.y === y), 'map: adjacent grid cell has no selectable marker');
	await test.click({ left: emptyLeft, right: emptyLeft + input.grid.cellSize, top: emptyTop, bottom: emptyTop + input.grid.cellSize });
	check(input.selected === undefined && input.grid.content === sheet && input.grid.horizontal.getScroll() === scrollX
		&& input.grid.vertical.getScroll() === scrollY && model.buffer.getText() === source,
		'map: empty-grid deselection retains its sheet, scroll position and authored bytes');
	await test.capture?.('deselected');
	await selectMapItem(test, input, cart);
	const pane = test.ide.editor.editorPanes.activePane;
	if (!(pane instanceof CartMapPane)) throw new Error('map: actual map pane owns the position inputs');
	await test.click(input.fieldBounds[0]);
	await test.press('ControlLeft', 'KeyA');
	await typeSourceText(test, String(x + 1));
	check(pane.controls[0].pending && model.buffer.getText() === source, 'map: coordinate typing remains a local draft until acceptance');
	await test.press('Enter');
	check(model.buffer.getText() === expected && input.selected?.x === x + 1,
		'map: one accepted property edit changes only its source tokens and follows the same member');
	await test.press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source && input.selected?.x === x && input.selected.y === y,
		'map: document Undo restores all original bytes and the same member selection');
	await test.press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === expected && input.selected?.x === x + 1 && input.selected.y === y,
		'map: document Redo restores exactly one accepted move and follows its member');
	await selectMapItem(test, input, cart);
	const grid = input.grid, selected = input.selected!, selectedSheet = grid.content;
	const left = grid.bounds.left + selected.x * grid.cellSize - grid.horizontal.getScroll();
	const top = grid.bounds.top + selected.y * grid.cellSize - grid.vertical.getScroll();
	check(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right && top >= grid.bounds.top && top + grid.cellSize <= grid.bounds.bottom,
		'map: the selected marker is reachable in the scrolled grid');
	const parent = input.tree.rows[input.tree.selectionIndex].parent!, outline = input.tree.layout;
	const parentTop = outline.contentTop + (input.tree.rows.indexOf(parent) - input.tree.scroll) * outline.rowHeight;
	await test.click({ left: outline.contentLeft, right: outline.contentRight, top: parentTop, bottom: parentTop + outline.rowHeight });
	await test.press('ArrowLeft');
	check(parent.collapsed && input.selected === undefined && grid.content === selectedSheet && model.buffer.getText() === expected,
		'map: collapsing the selected source parent keeps the same map without changing authored data');
	await test.capture?.('collapsed');
	await test.click({ left, right: left + grid.cellSize, top, bottom: top + grid.cellSize });
	check(input.selected === selected && !parent.collapsed, 'map: grid hit expands the collapsed source parent and selects its member');
	await test.press('ArrowLeft');
	check(model.buffer.getText() === source && input.selected?.x === x && input.selected.y === y,
		'map: focused grid keyboard moves the selected source member by one tile');
	await test.press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === expected && input.selected?.x === x + 1 && input.selected.y === y,
		'map: shared Undo restores the keyboard move and its member selection');
	await test.capture?.('moved');
	await test.runPaletteCommand('Map Editor: Open Source');
	const code = getActiveTab();
	check(code.kind === 'code_editor' && code.workingCopy === model, 'map: Source reveals the same resource-owned model');
	await test.press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === source, 'map: source-view Undo shares the visual edit history');
	await test.press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === expected, 'map: source-view Redo restores the same minimal token edit');
	check((await workspaceRecords.provider.read(path))!.contents === savedBefore, 'map: accepted edits do not implicitly Save');
	await test.press('ControlLeft', 'KeyS');
	await test.until(() => !model.dirty, 'map: explicit Save persists the authored YAML');
	check((await workspaceRecords.provider.read(path))!.contents === expected, 'map: physical workspace file contains all exact accepted source bytes');
	check(test.ide.sources.currentBlua32Media === media && test.ide.sources.cartridgeSlots[0]!.rom.bytes === rom && test.cycles() === cycles,
		'map: editing and saving neither cook assets nor install media nor execute the guest');
	await test.capture?.('source-saved');
	await test.press('ControlLeft', 'KeyW');
	await test.press('ControlLeft', 'KeyW');
	input = await openMap(test, name);
	await selectMapItem(test, input, cart);
	check(input.workingCopy.buffer.getText() === expected && input.selected!.x === x + 1 && input.selected!.y === y,
		'map: closing and reopening reads the saved authored position');
	await test.capture?.('reopened');
	const map: CartMapExpectation = { sourcePath: model.resource.path, source: expected,
		group: editorTabGroup.serialize(test.ide.editor.editorInputSerializers), x: x + 1, y };
	return { hostFrames: test.observations.hostFrames, map };
}
