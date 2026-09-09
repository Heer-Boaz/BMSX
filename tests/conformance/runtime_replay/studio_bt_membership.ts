import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_MEMBERSHIP_SOURCE } from '../../helpers/behavior_membership_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Partial source in the actual workbench, not a runtime-evaluated topology fixture. */
export async function testStudioBtMembership(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, cycles, runPaletteCommand, input, clock } = test;
	console.info('STUDIO: independent BT list evidence and opaque members');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_MEMBERSHIP_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.membership', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('BT membership: concrete graph required');
	const view = lens.view;
	const graph = lens.view.presentation;
	const viewport = graph.viewport;
	await press('ArrowDown');
	check(viewport.model.nodes[0].children[0].children.length === 4, 'BT membership: known sibling slots remain visible around builders');
	console.info('STUDIO: BT partial children ready for visual inspection');
	await press('ArrowDown');
	await press('ArrowRight');
	const opaque = viewport.selection;
	if (opaque?.kind !== 'node') throw new Error('BT membership: opaque child not selected');
	check(opaque.lines[0] === 'CHILD 2' && opaque.source.kind === 'dynamic' && opaque.children.length === 0,
		'BT membership: physical navigation enters the opaque slot without inventing its result');
	await click(graph.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === opaque.source.occurrenceRange.start.line - 1
		&& activeCodeEditor.view.cursorColumn === opaque.source.occurrenceRange.start.column - 1 && !hasSelection(),
		'BT membership: held Source opens the builder use, not its function or a code drag');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await press('ArrowRight');
	const nested = viewport.selection;
	if (nested?.kind !== 'node') throw new Error('BT membership: nested sibling not selected');
	check(nested.lines[0] === 'CHILD 3', 'BT membership: later known child remains independently reachable');
	await click(graph.actionBar.items[0].bounds);
	const oldDocument = view.document;
	const span = luaSourceRangeToTextRange(model.buffer, opaque.source.occurrenceRange);
	model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: 'leaf' }]);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 hidden change\n' }]);
	await frame();
	check(view.document === oldDocument, 'BT membership: hidden changes only map source correspondence');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHILD 3'
		&& readLuaSourceRange(model.buffer, viewport.selection.source.occurrenceRange) === 'nested',
		'BT membership: changing one opaque sibling preserves the later selected source occurrence');
	await press('ArrowDown');
	const membership = viewport.selection;
	if (membership?.kind !== 'node') throw new Error('BT membership: nested list card not selected');
	check(membership.lines[0] === 'CHILDREN' && membership.lines[1] === '? PARTIAL MEMBERSHIP',
		'BT membership: only the nested unknown list has an opaque membership card');
	const membershipSource = membership.source;
	await click(graph.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === membershipSource.occurrenceRange.start.line - 1
		&& activeCodeEditor.view.cursorColumn === membershipSource.occurrenceRange.start.column - 1
		&& readLuaSourceRange(model.buffer, membershipSource.occurrenceRange) === 'make_children()' && !hasSelection(),
		'BT membership: nested Source opens the actual list builder without transferring held pointer to the code control');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_MEMBERSHIP_SOURCE, 'BT membership: normal code history restores both source changes');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.weighted-membership', 'BEHAVIOR TREES');
	check(getActiveTab() === lens && lens.workingCopy === model, 'BT membership: another definition keeps the same input and text owner');
	await press('ArrowDown');
	await press('ArrowDown');
	await press('ArrowRight');
	check(viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHOICE 2', 'BT membership: opaque choice has its own selectable slot');
	await press('ArrowRight');
	const choice = viewport.selection;
	if (choice?.kind !== 'node') throw new Error('BT membership: weighted child missing');
	check(choice.lines[0] === 'CHOICE 3  W=4' && choice.source.kind === 'dynamic', 'BT membership: known weight and unknown child are separate evidence');
	const edge = viewport.model.edges.find(edge => edge.child === choice)!;
	const x = edge.points[edge.points.length - 2] + viewport.bounds.left - viewport.scrollX;
	const y = edge.points[edge.points.length - 1] - 6 + viewport.bounds.top - viewport.scrollY;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 });
	check(viewport.selection === edge, 'BT membership: pointer selects the authored weighted connection');
	console.info('STUDIO: BT partial choices ready for visual inspection');
	await click(graph.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === edge.range.start.line - 1 && activeCodeEditor.view.cursorColumn === edge.range.start.column - 1
		&& readLuaSourceRange(model.buffer, edge.range) === '{ weight = 4, child = make_node() }' && !hasSelection(),
		'BT membership: choice Source uses the full choice occurrence, not its opaque child');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	await runPaletteCommand('Behavior Lens: Open Source Details');
	test.clipboard.text = 'weight';
	await press('ControlLeft', 'KeyV');
	check(ide.editor.quickInput.model.list.rows.length === 1, 'BT membership: known weight remains inspectable');
	await press('Enter');
	const weight = choice.details.find(detail => detail.label === 'weight')!;
	check(activeCodeEditor.view.cursorRow === weight.range.start.line - 1 && activeCodeEditor.view.cursorColumn === weight.range.start.column - 1,
		'BT membership: Details opens the exact weight, not the source of another choice');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'BT MEMBERSHIP PAD',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	await frame();
	let pressId = 90000;
	for (const button of ['right', 'down']) {
		input.inputButton('gamepad:0', button, true, 1, clock.now() + 1, ++pressId);
		await frame();
		input.inputButton('gamepad:0', button, false, 0, clock.now() + 1, ++pressId);
		await frame();
	}
	check(viewport.selection?.kind === 'node' && viewport.selection.lines[0] === 'CHILDREN',
		'BT membership: controller traverses known choices into only the unknown nested list');
	input.disconnectInputDevice('gamepad:0');
	const retained = viewport.model;
	const document = view.document;
	for (let index = 0; index < 30; index += 1) await frame();
	check(viewport.model === retained && view.document === document, 'BT membership: idle keeps geometry and source generation');
	await click(editorChromeState.tabButtonBounds.get(code.id)!);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'BT membership: all fixture edits undo without running or changing the paused machine');
}
