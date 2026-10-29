import type { EditorSourceLocationRequest } from '../../../ide/editor/navigation/source_location';
import { inputFocus } from '../../../ide/input/focus';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../../ide/runtime/source_registry';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import type { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import type { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../../ide/workbench/contrib/code_editor/view_snapshot';
import { LuaTableFieldKind } from '../../../toolchain/ts/lua/syntax/ast';
import { BEHAVIOR_SOURCE_INTENT } from '../../fixtures/studio/behavior_source_intent';
import { createTestToolingPackage } from '../../helpers/runtime_sources';
import { createScenarioTestSourceRecord } from '../../helpers/scenario_sources';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Independent source namespace, then ordinary Behavior controls on the actual browser graph engines. */
export async function testStudioBehaviorIntent(test: StudioFixture): Promise<void> {
	const { ide, frame, press, cycles } = test, editor = ide.editor;
	console.info('STUDIO: independent Behavior source intent / native layout / Source / history');
	const root = 'tests/fixtures/studio/behavior-source-intent';
	const registry = createLuaSourceRegistry(root, 'behavior.lua');
	for (const [path, source] of [
		['behavior.lua', BEHAVIOR_SOURCE_INTENT],
		['cartlib/behaviour_tree/library.lua', 'return {}'],
		['cartlib/fsm/library.lua', 'return {}'],
		['cartlib/actioneffects.lua', 'return {}'],
	] as const) registerLuaSourceRecord(registry, createScenarioTestSourceRecord(path, 1, source, `${root}/${path}`));
	const context = ide.sources.catalog.admitContext({
		admission: { id: 'fixture-studio-behavior-intent', projectRoot: root }, programDomain: 'cart', systemContextId: null,
		luaSources: registry, sourceRoots: [{ path: root, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'source-only' }],
		dependencyContextIds: [], previewPackage: createTestToolingPackage(root), previewRom: null, assetSources: [],
	});
	const resource = ide.sources.catalog.resolveResource({ contextId: context.id, path: 'behavior.lua' })!;
	await editor.navigation.openResource(editor.editorParts.main.activeGroup, resource);
	const originalSource = editor.editorParts.activeGroup.model.activeTab;
	if (originalSource?.kind !== 'code_editor') throw new Error('behavior intent: source fixture requires its real Source input');
	const sourceGroup = editor.editorParts.activeGroup;
	const model = originalSource.workingCopy, before = cycles(), media = ide.sources.currentBlua32Media;
	const receipts: EditorSourceLocationRequest[] = [];

	for (const kind of ['tree', 'machine', 'effect'] as const) {
		console.info(`STUDIO: behavior intent ${kind}`);
		await test.clickTab(originalSource.id, 1, sourceGroup);
		await test.runPaletteCommand(kind === 'tree' ? 'Behavior Lens: Open Behavior Tree (BT)'
			: kind === 'machine' ? 'Behavior Lens: Open State Machine (FSM)' : 'Behavior Lens: Open ActionEffect');
		await chooseBehavior(test, `${kind === 'tree' ? 'BT' : kind === 'machine' ? 'FSM' : 'EFFECT'} fixture.intent.${kind}`);
		const lens = editor.editorParts.activeGroup.model.activeTab;
		if (lens.kind !== 'behavior_lens') throw new Error('behavior intent: chooser requires an actual retained Behavior input');
		check(lens.workingCopy === model, 'behavior intent: every presentation owns the exact source fixture working copy');
		await selectSourceOccurrence(test, lens, kind);
		if (kind === 'effect') await testAcceptedEffectField(test, lens);
		const receipt = editor.behaviorLens.captureSourceLocation(lens, 'selected')!;
		receipts.push(receipt);
		const revision = lens.view.selectionState.selectionRevision;
		for (let font = 0; font < 2; font++) {
			for (let theme = 0; theme < 2; theme++) {
				await presentSourcePair(test, lens, receipt);
				check(lens.view.selectionState.selectionRevision === revision && receipt.isCurrent!(),
					'behavior intent: font, theme and source-side topology retain the semantic occurrence, not a geometry item');
				await test.capture?.(`behavior-${kind}-${editor.fontVariant}-theme-${theme}-source`);
				await test.clickTab(lens.id); await press('ControlLeft', 'AltLeft', 'KeyT');
			}
			await press('ControlLeft', 'ShiftLeft', 'KeyT'); await settleLayout(test, lens);
		}
		await testSourceReparse(test, lens, receipt, revision);
		check(model.buffer.getText() === BEHAVIOR_SOURCE_INTENT && !model.dirty,
			'behavior intent: source and property history leave no fixture edits before the next domain');
	}
	for (const group of editor.editorParts.groups) for (const input of [...group.model.tabs]) {
		if (input.resource?.contextId === context.id) check(await group.close(input.id), 'behavior intent: clean fixture closes through its real editor group');
	}
	await frame();
	check(receipts.every(receipt => !receipt.isCurrent!()), 'behavior intent: closing actual retained inputs retires their source authority');
	check(cycles() === before && ide.sources.currentBlua32Media === media,
		'behavior intent: source-only BT, FSM and Effect authoring never runs or installs guest code');
	console.info('STUDIO: independent Behavior source intent PASS');
}

async function settleLayout(test: StudioFixture, input: BehaviorLensInput): Promise<void> {
	await test.frame();
	if (input.view.presentation.kind === 'state-graph') {
		await input.graphLayout.settled; await test.frame();
		check(input.view.presentation.layoutState.kind === 'ready' && input.graphLayout.state.kind === 'ready',
			'behavior intent: the native browser worker publishes the current FSM graph');
	}
}

async function selectSourceOccurrence(test: StudioFixture, input: BehaviorLensInput, kind: 'tree' | 'machine' | 'effect'): Promise<void> {
	await settleLayout(test, input);
	const view = input.view, presentation = view.presentation;
	await test.press('Home');
	if (kind === 'tree') {
		if (presentation.kind !== 'graph') throw new Error('behavior intent: BT requires its native graph');
		await test.press('ArrowDown'); await test.press('ArrowDown'); await test.press('ArrowRight');
		const selected = presentation.viewport.selection;
		check(selected?.kind === 'node' && selected.member?.index === 1
			&& selected.parent!.children[0].source.rowKey !== selected.source.rowKey,
			'behavior intent: keyboard selects the second actual reuse of a shared BT initializer');
		if (selected?.kind !== 'node') throw new Error('behavior intent: selected BT card required');
		const viewport = presentation.viewport;
		await test.click({ left: viewport.graphToViewportX(selected.bounds.left), right: viewport.graphToViewportX(selected.bounds.right),
			top: viewport.graphToViewportY(selected.bounds.top), bottom: viewport.graphToViewportY(selected.bounds.top + selected.headerHeight) });
		check(view.selectionState.selected?.rowKey === selected.source.rowKey, 'behavior intent: pointer agrees with the exact reused source occurrence');
	} else if (kind === 'machine') {
		if (presentation.kind !== 'state-graph') throw new Error('behavior intent: FSM requires its worker-backed graph');
		const geometry = presentation.viewport.model;
		const returns = geometry.edges.filter(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.outcome.proof.kind === 'return');
		check(returns.length === 2, 'behavior intent: identical return paths remain distinct authored proofs');
		const edge = returns[1];
		for (let index = 0; index < geometry.nodes.length + geometry.edges.indexOf(edge); index++) await test.press('ArrowDown');
		const selected = view.selectionState.selected;
		check(selected?.kind === 'state-outcome' && edge.link.reference.kind === 'state-outcome'
			&& selected.outcome === edge.link.reference.outcome, 'behavior intent: native graph traversal selects the second exact return proof');
	} else {
		if (presentation.kind !== 'properties') throw new Error('behavior intent: Effect requires its actual authored properties');
		const index = presentation.tree.rows.findIndex(row => row.element.kind === 'property'
			&& row.element.write?.field.kind === LuaTableFieldKind.IdentifierKey && row.element.write.field.name === 'period_ms');
		check(index >= 0, 'behavior intent: actual authored period field is available');
		for (let row = 0; row < index; row++) await test.press('ArrowDown');
		const property = presentation.tree.rows[index].element;
		check(property.kind === 'property' && view.selectionState.selected?.rowKey === property.source.rowKey,
			'behavior intent: native property navigation selects the written field, not its presentation group');
	}
}

async function presentSourcePair(test: StudioFixture, input: BehaviorLensInput, receipt: EditorSourceLocationRequest): Promise<CodeEditorInput> {
	await test.clickTab(input.id); await settleLayout(test, input);
	const range = selectedBehaviorLensSourceRange(input.view)!;
	check(range !== undefined && receipt.isCurrent!(), 'behavior intent: selected occurrence still owns source navigation');
	const model = input.view.source.models.get(range.path)!;
	await test.press('ContextMenu'); await test.clickContextCommand('editor.sourceToSide');
	await test.until(() => {
		const group = test.ide.editor.editorParts.activeGroup, code = group.model.activeTab;
		return code?.kind === 'code_editor' && code.workingCopy === model && group !== test.ide.editor.editorParts.findGroup(input);
	}, 'behavior intent: real context-menu Source to Side admits its independent canonical text view');
	const code = test.ide.editor.editorParts.activeGroup.model.activeTab;
	if (code.kind !== 'code_editor') throw new Error('behavior intent: exact Source receiver required');
	check(captureCodeEditorView(code).cursor === model.buffer.offsetAt(range.start.line - 1, range.start.column - 1),
		'behavior intent: Source caret belongs to the selected semantic occurrence, including repeated definitions/proofs');
	check(receipt.isCurrent!(), 'behavior intent: presenting source in another group retains the original source intent');
	return code;
}

async function testSourceReparse(test: StudioFixture, input: BehaviorLensInput, receipt: EditorSourceLocationRequest, revision: number): Promise<void> {
	const code = await presentSourcePair(test, input, receipt), model = code.workingCopy;
	const sourceGroup = test.ide.editor.editorParts.activeGroup;
	const prefix = '-- moved behavior source 🐉\n', range = selectedBehaviorLensSourceRange(input.view)!;
	await test.press('ControlLeft', 'Home'); await test.clipboard.writeText(prefix); await test.press('ControlLeft', 'KeyV');
	check(model.buffer.getText() === prefix + BEHAVIOR_SOURCE_INTENT, 'behavior intent: ordinary Source input inserts exact authored bytes');
	await test.clickTab(input.id); await settleLayout(test, input);
	check(receipt.isCurrent!() && input.view.selectionState.selectionRevision === revision
		&& selectedBehaviorLensSourceRange(input.view)!.start.line === range.start.line + 1,
		'behavior intent: corresponding source reparse maps the retained semantic occurrence once');
	await presentSourcePair(test, input, receipt);
	await test.capture?.(`behavior-${input.view.presentation.kind}-reparsed-source`);
	await test.press('ControlLeft', 'KeyZ'); await test.clickTab(input.id); await settleLayout(test, input);
	check(model.buffer.getText() === BEHAVIOR_SOURCE_INTENT && receipt.isCurrent!()
		&& selectedBehaviorLensSourceRange(input.view)!.start.line === range.start.line,
		'behavior intent: Source Undo restores exact bytes and corresponding semantic location');
	await test.clickTab(code.id, 1, sourceGroup); await test.press('ControlLeft', 'KeyY'); await test.clickTab(input.id); await settleLayout(test, input);
	check(model.buffer.getText() === prefix + BEHAVIOR_SOURCE_INTENT && receipt.isCurrent!(),
		'behavior intent: Source Redo maps current ownership without reviving an old geometry object');
	await test.clickTab(code.id, 1, sourceGroup); await test.press('ControlLeft', 'KeyZ'); await test.clickTab(input.id); await settleLayout(test, input);
}

async function testAcceptedEffectField(test: StudioFixture, input: BehaviorLensInput): Promise<void> {
	const pane = test.ide.editor.editorParts.findGroup(input)!.panes.activePane;
	if (!(pane instanceof BehaviorLensEditorPane)) throw new Error('behavior intent: actual property editor owner required');
	const model = input.workingCopy, receipt = test.ide.editor.behaviorLens.captureSourceLocation(input, 'selected')!;
	await test.press('ContextMenu'); await test.clickContextCommand('behaviorLens.editProperty');
	const field = inputFocus.admittedTarget!;
	check(pane.propertyEdit.active && field.edit !== undefined && field.textInput !== undefined, 'behavior intent: native Edit opens its actual source-bound field');
	await test.press('ControlLeft', 'KeyA'); await test.clipboard.writeText('123456789 + 7'); await test.press('ControlLeft', 'KeyV');
	check(field.edit!.pending && model.buffer.getText() === BEHAVIOR_SOURCE_INTENT, 'behavior intent: actual property control owns its unpublished draft');
	const version = model.version, source = input.view.presentation.actionBar.items.find(item => item.command === 'editor.source')!;
	await test.click(source.bounds, 6);
	await test.until(() => {
		const code = test.ide.editor.editorParts.activeGroup.model.activeTab;
		return code?.kind === 'code_editor' && code.workingCopy === model;
	},
		'behavior intent: primary Source accepts its pending property then follows canonical text affinity');
	const accepted = BEHAVIOR_SOURCE_INTENT.replace('period_ms = 20', 'period_ms = 123456789 + 7');
	check(model.buffer.getText() === accepted && model.version === version + 1 && !field.edit!.pending && receipt.isCurrent!(),
		'behavior intent: accepted property replacement publishes source and semantic correspondence together');
	await test.press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BEHAVIOR_SOURCE_INTENT, 'behavior intent: Source Undo restores exactly the accepted property edit');
	await test.clickTab(input.id); await settleLayout(test, input);
	await test.press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === accepted, 'behavior intent: actual Behavior Redo consumes canonical property history');
	await test.press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BEHAVIOR_SOURCE_INTENT, 'behavior intent: Behavior Undo leaves the independent fixture source unchanged');
	await selectSourceOccurrence(test, input, 'effect');
}
