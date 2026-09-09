import { testStudioSourceRecovery } from './studio_source_recovery';
import { testStudioStateGraph } from './studio_state_graph';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { queryDefinitionsAt } from '../../../ide/editor/contrib/definitions/query';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { getCodeAreaBounds } from '../../../ide/editor/ui/view/view';
import { editorContextMenuState } from '../../../ide/workbench/contrib/context_menu/state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { resolveRuntimeResource } from '../../../ide/runtime/sources';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';
import { testStudioBehaviorSourceGraph } from './studio_behavior_source';
import { testStudioBtMembership } from './studio_bt_membership';
import { testStudioBtMoves } from './studio_bt_moves';
import { testStudioBtDrag } from './studio_bt_drag';
import { testStudioBtRemove } from './studio_bt_remove';
import { testStudioFsmSource } from './studio_fsm_source';
import { testStudioActionEffectSource } from './studio_actioneffect_source';
import { testStudioFsmSelection } from './studio_fsm_selection';

export type NavigationCart = 'nemesis_s' | 'pietious';
const CASES = {
	nemesis_s: {
		path: 'player/actioneffects.lua', identifier: 'fire_salvo_effect_id', useLine: 16, declarationLine: 7, declarationColumn: 7,
		behavior: 'FSM ids_sneeuwpop_fsm', sourcePath: 'enemies/sneeuwpop.lua', sourceLine: 76, sourceColumn: 5,
	},
	pietious: {
		path: 'boss/world1_daemon_tree.lua', identifier: 'move_out_backward', useLine: 190, declarationLine: 21, declarationColumn: 8,
		behavior: 'BT world1_daemon_tree.id', sourcePath: 'boss/world1_daemon_tree.lua', sourceLine: 190, sourceColumn: 14,
	},
} as const;

/** Pixel targets use retained glyph/visual-line geometry, including tabs, wrapping and horizontal scroll. */
function codePositionBounds(row: number, column: number) {
	const view = activeCodeEditor.view;
	const layout = editorViewState.layout;
	const bounds = getCodeAreaBounds();
	const visualIndex = layout.positionToVisualIndex(row, column);
	const segment = layout.visualIndexToSegment(visualIndex)!;
	const entry = layout.getCachedHighlight(activeCodeEditor.model.buffer, row);
	const start = editorViewState.wordWrapEnabled ? segment.startColumn : view.scrollColumn;
	const x = bounds.textLeft + entry.advancePrefix[layout.columnToDisplay(entry.hi, column)]
		- entry.advancePrefix[layout.columnToDisplay(entry.hi, start)];
	const y = bounds.codeTop + (visualIndex - view.scrollRow + 0.5) * editorViewState.lineHeight;
	check(x >= bounds.textLeft && x < bounds.codeRight && y >= bounds.codeTop && y < bounds.codeBottom, 'navigation pointer target must be visible');
	return { left: x, right: x + 1, top: y, bottom: y + 1 };
}

function assertSourcePosition(path: string, line: number, column: number, route: string): void {
	const { model, view } = activeCodeEditor;
	check(getActiveTab().kind === 'code_editor' && model.resource.path === path
		&& view.cursorRow === line - 1 && view.cursorColumn === column - 1,
		`${route}: expected ${path}:${line}:${column}, got ${model.resource.path}:${view.cursorRow + 1}:${view.cursorColumn + 1}`);
	check(view.selectionAnchor === null || (view.selectionAnchor.row === view.cursorRow && view.selectionAnchor.column === view.cursorColumn),
		`${route}: navigation must not turn the old pointer hold into a text selection`);
}

export async function testStudioPointerNavigation(test: StudioFixture, cart: NavigationCart): Promise<void> {
	const spec = CASES[cart];
	const { ide, frame, click, setKey, setPointerButton, movePointer, runPaletteCommand, cycles } = test;
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	const resource = resolveRuntimeResource(ide.sources, { domain: 0, path: spec.path })!;
	await ide.editor.navigation.openResource(resource);
	await frame();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	const useRow = spec.useLine - 1;
	const useColumn = model.buffer.getLineContent(useRow).indexOf(spec.identifier);
	check(useColumn >= 0, `${cart}: actual cart contains the reported identifier use`);
	const definition = queryDefinitionsAt(ide.luaTooling, activeCodeEditor, useRow, useColumn)!;
	check(definition.definitions.length === 1 && definition.definitions[0].location.path === spec.path
		&& definition.definitions[0].location.range.startLine === spec.declarationLine
		&& definition.definitions[0].location.range.startColumn === spec.declarationColumn,
		`${cart}: semantic source owner already returns the exact local declaration`);
	console.info(`STUDIO: ${cart} source ranges and held keyboard/Ctrl-click/context-menu/lens navigation`);
	for (const route of ['keyboard', 'ctrl-click', 'context-menu'] as const) {
		await ide.editor.navigation.openResource(resource, { row: useRow, startColumn: useColumn, endColumn: useColumn });
		await frame();
		if (route === 'keyboard') {
			await runPaletteCommand('Go: Go to Definition');
		} else if (route === 'ctrl-click') {
			setKey('ControlLeft', true);
			await click(codePositionBounds(useRow, useColumn), 6);
			setKey('ControlLeft', false);
		} else {
			await click(codePositionBounds(useRow, useColumn), 4, 'pointer_secondary');
			check(editorContextMenuState.visible && editorContextMenuState.token!.text === spec.identifier,
				`${cart}: actual right click captures the intended identifier`);
			const index = editorContextMenuState.entries.findIndex(entry => entry.action === 'goToDefinition');
			await click(editorContextMenuState.itemBounds[index], 6);
		}
		for (let index = 0; index < 3; index += 1) await frame();
		assertSourcePosition(spec.path, spec.declarationLine, spec.declarationColumn, `${cart} ${route}`);
	}
	// A real subsequent gesture still selects text; navigation does not suppress
	// the button until a guessed timeout or consume the next physical press.
	const row = spec.declarationLine - 1;
	const column = spec.declarationColumn - 1;
	movePointer(codePositionBounds(row, column));
	await frame();
	setPointerButton('pointer_primary', true);
	await frame();
	movePointer(codePositionBounds(row, column + 3));
	for (let index = 0; index < 3; index += 1) await frame();
	setPointerButton('pointer_primary', false);
	await frame();
	check(activeCodeEditor.view.cursorRow === row && activeCodeEditor.view.cursorColumn === column + 3
		&& activeCodeEditor.view.selectionAnchor!.row === row && activeCodeEditor.view.selectionAnchor!.column === column,
		`${cart}: a new physical drag still works after navigation`);

	await runPaletteCommand('Behavior Lens: Open');
	await chooseBehavior(test, spec.behavior);
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('navigation: actual behavior lens missing');
	const view = lens.view;
	const node = view.sourceNodes.find(node => cart === 'nemesis_s'
		? node.label === 'update = sneeuwpop.update_idle'
		: node.detail.startsWith('move_out_backward') && node.referenceRange!.start.line === spec.sourceLine)!;
	const source = node.referenceRange === null ? node.authoredRange : node.referenceRange;
	check(source.path === spec.sourcePath && source.start.line === spec.sourceLine && source.start.column === spec.sourceColumn,
		`${cart}: lens source owner expected ${spec.sourcePath}:${spec.sourceLine}:${spec.sourceColumn}, got ${source.path}:${source.start.line}:${source.start.column}`);
	await revealLensOccurrence(test, view, node.rowKey);
	const presentation = view.presentation;
	if (presentation.kind === 'state-graph') {
		await click(presentation.actionBar.items[0].bounds, 6);
		assertSourcePosition(spec.sourcePath, spec.sourceLine, spec.sourceColumn, `${cart} held FSM source action`);
	} else {
		if (presentation.kind !== 'graph') throw new Error('navigation: this fixture requires the concrete BT graph');
		const viewport = presentation.viewport;
		const card = viewport.model.nodesBySource.get(node.rowKey)!;
		const bounds = { left: card.bounds.left + viewport.bounds.left - viewport.scrollX,
			right: card.bounds.right + viewport.bounds.left - viewport.scrollX,
			top: card.bounds.top + viewport.bounds.top - viewport.scrollY,
			bottom: card.bounds.bottom + viewport.bounds.top - viewport.scrollY };
		await click(bounds);
		await click(bounds, 6);
		assertSourcePosition(spec.sourcePath, spec.sourceLine, spec.sourceColumn, `${cart} held lens double-click`);
	}
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		`${cart}: navigation changes neither source nor paused machine/media`);
}

/** Smaller real-cart profile, sharing the same browser renderer and workbench fixtures. */
export async function runStudioPointerNavigation(test: StudioFixture, cart: NavigationCart) {
	await test.until(() => test.harness.isCartActive(), `${cart}: boot the actual cart`);
	await test.press('ControlRight', 'ShiftRight');
	await test.runMenuCommand('pause');
	if (cart === 'pietious') await testStudioSourceRecovery(test);
	await testStudioPointerNavigation(test, cart);
	await testStudioBehaviorSourceGraph(test);
	await testStudioBtMembership(test);
	await testStudioBtMoves(test);
	await testStudioBtDrag(test);
	await testStudioBtRemove(test);
	await testStudioFsmSource(test);
	await testStudioActionEffectSource(test);
	await testStudioFsmSelection(test);
	await testStudioStateGraph(test);
	return { hostFrames: test.observations.hostFrames, selected: test.cycles() };
}
