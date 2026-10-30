import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import { api } from '../../ide/runtime/overlay_api';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { captureInstalledLuaSources, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createBlua32SourceImage } from '../../ide/runtime/sources';
import { RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { updateFullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { GteDetailsWindow } from '../../ide/workbench/contrib/gte_debugger/details_window';
import { GteDebuggerInput } from '../../ide/workbench/contrib/gte_debugger/editor_input';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { CapturedLuaSourceBinding } from '../../ide/workbench/services/working_copy/captured_lua_source';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import { eventHistoryRuntime } from '../helpers/event_history';

const PROGRAM = `
local data<const>: *word = 0x08010244
local command<const>: *word = 0x08010344
function issue()
 data[12] = 0x00100010
 data[13] = 0x00100040
 data[14] = 0x00400020
 *command = 0x00000006
end
issue()
return true`;

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'msx', withSource = false, program = PROGRAM) {
	configureFontVariant(variant);
	const { runtime, sources, cpu } = eventHistoryRuntime(createCartlibProgramHarness(program).images);
	const models = new EditorTextModelService(), registry = sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources;
	const record = { ...createScenarioTestSourceRecord('entry.lua', 1, program), sourceKind: 'project' as const, program_module: true };
	if (withSource) {
		registerLuaSourceRecord(registry, record);
		const image = sources.currentBlua32Media.cartridgeSlots[0]!;
		sources.currentBlua32Media = { ...sources.currentBlua32Media,
			cartridgeSlots: [createBlua32SourceImage(image.layout, image.symbols, captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_CARTRIDGE_CONTEXT_IDS[0]), null] };
	}
	const resource = withSource ? sources.catalog.registerLuaResource(TEST_CARTRIDGE_CONTEXT_IDS[0], record) : undefined;
	const history = new RuntimeGteHistory(runtime, sources, 2), input = new GteDebuggerInput(history);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	const issue = () => {
		cpu.beginCompletionCall(cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure, []);
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, 10_000_000), RunResult.Halted);
	};
	input.update(); input.select(input.selected.sequence);
	const area = { left: 0, top: 24, right: 384, bottom: 274 };
	updateFullWidthWorkbenchLayout(input.layout, { ...area, bottom: 256 });
	const surfaces = new WorkbenchSurfaceService(), origin = inputFocus.createTarget();
	origin.bindKeyboard(() => {}); origin.focus();
	const owner = surfaces.attach({ role: 'content', captureScope: origin.scope.surfaceScope, isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const source = new CapturedLuaSourceBinding(models, sources.catalog);
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture, area), quickInput = new QuickInputController(contextMenu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	let formats = 0, sourceOpens = 0;
	const synchronize = () => {
		if (input.selected.sequence < 0) source.clear(); else source.bind(input.selected.image, input.selected.pc);
	};
	synchronize();
	const details = new GteDetailsWindow(input, {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	}, surfaces, owner, origin, area, quickInput, contextMenu, source, () => { sourceOpens++; });
	const format = details.presentation.details.bind(details.presentation);
	t.mock.method(details.presentation, 'details', (...args: Parameters<typeof format>) => { formats++; return format(...args); });
	t.after(() => { details.dispose(); quickInput.dispose(); contextMenu.dispose(); source.clear(); inputFocus.setTarget(null); pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); input.dispose(); history.dispose(); models.clear(); });
	const key = (code: string, down: boolean) => inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const press = (code: string) => { key(code, true); key(code, false); };
	return { runtime, input, history, issue, area, surfaces, owner, origin, details, synchronize, source, models, resource,
		quickInput, contextMenu, formats: () => formats, sourceOpens: () => sourceOpens, key, press };
}

for (const variant of ['tiny', 'msx'] as const) test(`GTE ${variant} defaults are reproduced in the same font and deferred while the retained view is hidden`, t => {
	const f = fixture(t, variant), { input, details } = f;
	details.show();
	const model = input.detailsWindow, defaults = { ...model.requestedBounds }, selected = input.selected;
	const sequence = selected.sequence;
	assert.ok(input.windowPlacements[0] === model); assert.equal(input.windowPlacements.length, 1);
	model.setRequestedBounds({ left: 10, top: 30, right: 210, bottom: 150 }); model.setPlacement('right');
	details.window.resetPlacement(); details.update();
	assert.equal(model.placementInitialized, true); assert.equal(model.placement, 'normal'); assert.deepEqual(model.requestedBounds, defaults);
	assert.ok(input.selected === selected); assert.equal(input.selected.sequence, sequence);
	details.window.hide();
	for (const placement of input.windowPlacements) placement.requestDefaultPlacement();
	details.update(); assert.equal(model.placementInitialized, false); assert.equal(model.open, false);
	details.show(); assert.equal(model.placementInitialized, true); assert.deepEqual(model.requestedBounds, defaults);
	assert.ok(input.selected === selected); assert.equal(input.selected.sequence, sequence);
});

for (const variant of ['tiny', 'msx'] as const) test(`GTE ${variant} Details is modeless and retains measured raw fields without idle reformatting`, t => {
	const f = fixture(t, variant), { input, details } = f;
	details.update(); assert.equal(f.formats(), 0);
	details.show();
	assert.equal(details.window.surface!.role, 'window'); assert.equal(details.window.surface!.lifetimeOwner, f.owner);
	assert.equal(details.inspector.chrome, 'client'); assert.equal(input.detailsWindow.title, 'NCLIP #0');
	assert.equal(input.detailsWindow.requestedBounds.bottom, input.layout.bottom - 4);
	assert.equal(details.inspector.model.rows.length, 68);
	assert.equal(details.inspector.model.rows[1].element.value, 'Source unavailable');
	assert.equal(details.inspector.model.rows[67].element.label, 'C[31]');
	const rows = details.inspector.model.rows, first = rows[0].element;
	const advance = editorViewState.font.advance.bind(editorViewState.font);
	let measures = 0;
	t.mock.method(editorViewState.font, 'advance', (...args: Parameters<typeof advance>) => { measures++; return advance(...args); });
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(f.formats(), 1); assert.equal(measures, 0);
	assert.equal(details.inspector.model.rows, rows); assert.equal(rows[0].element, first);
	f.press('Escape'); assert.equal(inputFocus.target, f.origin); assert.equal(input.detailsWindow.open, true);
});

test('GTE Details follows selected owned evidence, retires held activation and preserves expired snapshots', t => {
	const f = fixture(t, 'msx', true), { input, details } = f;
	const model = f.models.retain(f.resource!, 'lua', PROGRAM);
	details.show();
	const captured = f.history.snapshot(input.selected.sequence), rows = details.inspector.model.rows, first = rows[0].element;
	const source = inputFocus.getCommand('gte.source', details.window.focusTarget)!;
	assert.equal(source.isEnabled(), true, 'the held Source attempt starts with actual navigation authority');
	f.issue(); f.issue(); input.update(); f.synchronize(); details.update();
	assert.equal(input.selected.sequence, captured.sequence); assert.ok(input.selected.sequence < input.history.firstSequence);
	assert.ok(input.selected.image === captured.image); assert.equal(input.selected.pc, captured.pc);
	assert.deepEqual(input.selected.beforeData, captured.beforeData); assert.deepEqual(input.selected.afterData, captured.afterData);
	assert.deepEqual(input.selected.beforeControl, captured.beforeControl); assert.deepEqual(input.selected.afterControl, captured.afterControl);
	assert.ok(details.inspector.model.rows === rows); assert.ok(rows[0].element === first); assert.equal(f.formats(), 1);
	details.inspector.focusTarget.focus(); f.press('ArrowDown');
	assert.equal(details.inspector.model.selectionIndex, 1); assert.equal(source.isEnabled(), true);
	f.key('Enter', true);
	input.select(input.history.firstSequence); f.synchronize(); details.update(); f.key('Enter', false);
	assert.equal(f.sourceOpens(), 0); assert.equal(f.formats(), 2);
	assert.ok(details.inspector.model.rows === rows); assert.ok(rows[0].element !== first);
	assert.ok(input.selected.sequence >= input.history.firstSequence && input.selected.sequence < input.history.endSequence);
	assert.equal(source.isEnabled(), true);
	details.inspector.focusTarget.focus(); f.press('Home'); f.press('ArrowDown'); f.press('Enter');
	assert.equal(f.sourceOpens(), 1, 'a fresh Source release is admitted for the replacement observation');
	const properties = new Set(rows.map(row => row.element));
	f.key('Enter', true); input.clear(); input.update(); f.synchronize(); details.update(); f.key('Enter', false);
	assert.equal(f.sourceOpens(), 1, 'Clear retires the old Source hold before publishing an empty subject');
	assert.equal(input.detailsWindow.open, true); assert.equal(input.selected.sequence, -1); assert.ok(input.selected.image === null);
	assert.equal(input.history.count, 0); assert.ok(f.source.location === undefined); assert.equal(source.isEnabled(), false);
	assert.ok(rows.every(row => !properties.has(row.element)), 'Clear retires every property element owned by the captured register document');
	assert.equal(f.formats(), 2);
	inputFocus.executeCommand('gte.source', details.window.focusTarget); assert.equal(f.sourceOpens(), 1);
	assert.equal(model.buffer.getText(), PROGRAM); assert.equal(model.canUndo, false);
	inputFocus.executeCommand('window.hide', details.inspector.focusTarget); assert.equal(input.detailsWindow.open, false);
});

test('GTE reopening restores bookmarks at reflow and never applies them to a newly selected command', t => {
	const f = fixture(t), { input, details } = f; details.show();
	const last = details.inspector.model.rows.length - 1;
	details.inspector.model.select(last);
	const anchor = details.inspector.model.rowAt(details.inspector.model.viewport.bounds.top), scroll = details.inspector.model.viewport.scrollTop, placement = { ...input.detailsWindow.requestedBounds };
	details.window.hide();
	assert.equal(input.detailsView.selectionIndex, last); assert.equal(input.detailsView.anchorIndex, anchor);
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(f.formats(), 1);
	details.show();
	assert.equal(details.inspector.model.selectionIndex, last); assert.equal(details.inspector.model.viewport.scrollTop, scroll);
	details.inspector.focusTarget.focus(); f.press('Home'); details.update(); assert.equal(details.inspector.model.viewport.scrollTop, 0);
	details.window.hide(); details.show(); assert.equal(f.formats(), 1);
	details.inspector.model.select(last);
	f.issue(); input.update(); input.select(input.history.endSequence - 1); f.synchronize();
	details.window.hide();
	assert.equal(input.detailsView.selectionIndex, 0); assert.equal(input.detailsView.anchorIndex, 0);
	details.show(); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0); assert.equal(f.formats(), 2);
	assert.deepEqual(input.detailsWindow.requestedBounds, placement);
});

test('GTE reading position survives a font change while its window is closed', t => {
	const f = fixture(t, 'tiny'), { details } = f;
	details.show();
	details.inspector.model.select(67);
	details.window.hide();
	configureFontVariant('msx'); details.update();
	details.show(); details.update();
	const model = details.inspector.model, view = model.viewport, last = model.rows[67];
	assert.equal(model.selectionIndex, 67);
	assert.ok(view.offsetTop + last.top < view.bounds.bottom && view.offsetTop + last.bottom > view.bounds.top,
		'the selected retained register must remain visible after reflow, not an old absolute pixel offset');
});


test('GTE Source generation changes retire only the Source row activation, not raw disclosure or its measured document', t => {
	const f = fixture(t, 'tiny', true), { details, input } = f;
	const model = f.models.retain(f.resource!, 'lua', PROGRAM);
	details.show();
	assert.equal(f.source.status, 'available');
	details.inspector.model.select(1);
	const sourceRow = details.inspector.model.rows[1].element, rawRow = details.inspector.model.rows[67].element;
	const changeAndUndo = () => {
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]); details.update();
		assert.equal(f.source.status, 'changed');
		model.undo(); details.update(); assert.equal(f.source.status, 'available');
	};
	f.key('Enter', true); changeAndUndo(); f.key('Enter', false);
	assert.equal(f.sourceOpens(), 0, 'the old Source hold must not survive a changed/undone working copy generation');
	f.press('Enter'); assert.equal(f.sourceOpens(), 1, 'a fresh attempt is admitted after exact bytes return');
	f.key('Enter', true);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- between input and paint\n' }]); model.undo();
	f.key('Enter', false);
	assert.equal(f.sourceOpens(), 1, 'release admission must observe and retire an intervening source generation even before paint');
	f.press('End'); f.key('Enter', true); changeAndUndo(); f.key('Enter', false); details.update();
	assert.equal(details.inspector.model.rows[67].textExpanded, true, 'source invalidation must not cancel an unrelated raw-word disclosure');
	assert.equal(details.inspector.model.rows[67].element, rawRow); assert.equal(f.formats(), 1);
	f.press('Home'); f.press('ArrowDown'); f.press('ArrowRight'); details.update();
	assert.equal(details.inspector.model.rows[1].textExpanded, true);
	f.issue(); input.update(); input.select(input.history.endSequence - 1); f.synchronize(); details.update();
	assert.notEqual(details.inspector.model.rows[1].element, sourceRow);
	assert.equal(details.inspector.model.rows[1].textExpanded, false, 'a different captured subject does not inherit Source text disclosure identity');
});

for (const variant of ['tiny', 'msx'] as const) for (const route of ['direct', 'command'] as const) test(`GTE ${variant} ${route} View chooser pins its captured observation while live history advances`, t => {
	const f = fixture(t, variant), { input, details, quickInput } = f;
	input.following = true; details.show();
	const sequence = input.selected.sequence, revision = input.selectionRevision, registers = input.selected.afterData.slice();
	if (route === 'direct') details.chooseView();
	else inputFocus.executeCommand('gte.view', details.inspector.focusTarget);
	assert.equal(quickInput.visible, true);
	for (let index = 0; index <= input.history.capacity; index++) {
		f.issue(); input.update(); f.synchronize(); details.update();
		assert.equal(quickInput.visible, true);
		assert.equal(input.selected.sequence, sequence);
		assert.equal(input.selectionRevision, revision);
		assert.deepEqual(input.selected.afterData, registers);
	}
	assert.ok(input.history.firstSequence > sequence);
	f.press('ArrowDown'); f.press('Enter'); details.update();
	assert.equal(quickInput.visible, false); assert.equal(input.inspectorPage, 'diagram');
	assert.equal(input.selected.sequence, sequence); assert.equal(input.following, false);
});

test('GTE View choice applies in the background when picker blur admits newer outside focus', t => {
	const f = fixture(t), { input, details, quickInput } = f;
	details.show(); details.chooseView();
	assert.ok(quickInput.invocationOrigin === details.inspector.focusTarget);
	f.press('ArrowDown');
	t.after(quickInput.field.focusTarget.onDidBlur(() => f.origin.focus()));
	f.press('Enter');
	assert.equal(quickInput.visible, false); assert.equal(input.inspectorPage, 'diagram');
	assert.equal(details.window.visible, true); assert.equal(input.detailsWindow.open, true);
	assert.ok(inputFocus.admittedTarget === f.origin);
});

test('GTE View chooser cancellation retains its pinned evidence and window retirement closes only its own popup', t => {
	const f = fixture(t), { input, details, quickInput } = f;
	input.following = true; details.show(); details.chooseView();
	const sequence = input.selected.sequence;
	f.press('Escape');
	assert.equal(quickInput.visible, false);
	f.issue(); input.update(); f.synchronize(); details.update();
	assert.equal(input.selected.sequence, sequence); assert.equal(input.following, false);
	details.chooseView(); details.window.hide();
	assert.equal(quickInput.visible, false); assert.equal(input.detailsWindow.open, false);
	details.show(); details.chooseView();
	quickInput.input('Another owner', '', '', async value => value, () => {}, undefined, { invocationOrigin: f.origin });
	details.window.hide();
	assert.equal(quickInput.visible, true);
	quickInput.hide();
});

test('GTE selection retires its real view chooser before copying another retained subject', t => {
	const f = fixture(t), { input, details, quickInput } = f;
	details.show(); details.chooseView(); assert.equal(quickInput.visible, true);
	const previous = input.selected.sequence;
	let before = -1;
	const unbind = input.onWillChangeSelection(() => { before = input.selected.sequence; assert.equal(quickInput.visible, false); });
	t.after(unbind);
	f.issue(); input.select(input.history.endSequence - 1);
	assert.equal(before, previous); assert.equal(details.inspector.visible, false);
	f.synchronize(); details.update();
	assert.equal(input.inspectorPage, 'properties'); assert.equal(details.inspector.visible, true);
	assert.equal(f.formats(), 2);
});

for (const variant of ['tiny', 'msx'] as const) test(`GTE ${variant} Diagram owns one scrolling surface and preserves its semantic anchor through reflow`, t => {
	const f = fixture(t, variant), { input, details, quickInput } = f;
	details.show();
	details.chooseView(); f.press('ArrowDown'); f.press('Enter'); details.update();
	assert.equal(quickInput.visible, false); assert.equal(input.inspectorPage, 'diagram');
	assert.equal(details.inspector.visible, false); assert.equal(details.presentation.points.length, 3);
	assert.ok(input.diagram.contentHeight > input.diagram.height);
	const point = details.diagram.points[0];
	assert.equal(details.diagram.hit(input.diagram.bounds.left + point.x, input.diagram.offsetTop + point.y, input.diagram), 0);
	f.press('End'); assert.equal(input.diagram.scrollTop, input.diagram.contentHeight - input.diagram.height);
	configureFontVariant(variant === 'tiny' ? 'msx' : 'tiny'); details.update();
	assert.equal(input.diagram.scrollTop, input.diagram.contentHeight - input.diagram.height, 'End follows the actual annotation end, not old pixels');
	f.press('Home'); f.press('ArrowDown');
	const anchor = { ...input.diagramAnchor }; details.diagram.captureAnchor(input.diagram, anchor);
	configureFontVariant(variant); details.update();
	const after = { ...input.diagramAnchor }; details.diagram.captureAnchor(input.diagram, after);
	assert.equal(after.section, anchor.section); assert.equal(after.offset, anchor.offset);
	const advances = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(advances.mock.callCount(), 0); assert.equal(f.formats(), 1);
	assert.equal(inputFocus.getCommand('gte.view', details.window.focusTarget)!.isEnabled(), true);
	inputFocus.executeCommand('gte.view', details.window.focusTarget);
	assert.equal(quickInput.visible, true);
	quickInput.hide();
});

test('GTE PLUS Details exposes each actual vector plane and retains acceptance source at publication', t => {
	const program = `
local plus<const>: *word = 0x08010384
function issue()
 plus[0] = 0x20001000
 plus[1] = 0x3000
 plus[2] = 0x10002000
 plus[3] = 0xf000
 plus[4] = 0x800
 plus[8] = 1
 while (plus[9] & 0x80000000) ~= 0 do end
end
issue()
return true`;
	const f = fixture(t, 'msx', true, program), { input, details, history } = f;
	const accepted = history.snapshot(0);
	assert.equal(accepted.kind, 'plus-accepted'); assert.equal(input.selected.kind, 'plus-published');
	assert.equal(input.selected.pc, accepted.pc); assert.equal(input.selected.image, accepted.image);
	details.show();
	assert.equal(f.source.status, 'available');
	assert.equal(details.inspector.model.rows[1].element.label, 'Acceptance source');
	for (const [plane, points] of [
		['xy', [[4096, 8192], [8192, 4096], [8192, 10240]]],
		['xz', [[4096, 12288], [8192, -4096], [8192, 10240]]],
		['yz', [[8192, 12288], [4096, -4096], [10240, 10240]]],
	] as const) {
		details.chooseView(); f.press('ArrowDown'); f.press('Enter'); details.update();
		assert.equal(input.inspectorPage, 'diagram'); assert.equal(input.plane, plane);
		assert.deepEqual(details.presentation.points.map(point => [point.x, point.y]), points);
		assert.equal(details.presentation.connectPoints, false);
		assert.equal(details.diagram.points.length, 3);
		assert.ok(details.diagram.lines.some(line => line.section === 'explanation'));
	}
	assert.equal(input.selected.pc, accepted.pc); assert.equal(f.source.status, 'available');
	assert.equal(f.formats(), 1, 'changing vector interpretation never rebuilds the raw register document');
});

for (const intent of ['point', 'ArrowRight', 'PageDown'] as const) test(`GTE Diagram ${intent} freezes the captured observation before later Follow frames`, t => {
	const f = fixture(t), { input, details } = f;
	details.show();
	details.chooseView(); f.press('ArrowDown'); f.press('Enter'); details.update();
	const chosenSequence = input.selected.sequence;
	input.following = true;
	f.issue(); input.update(); f.synchronize(); details.update();
	assert.ok(input.selected.sequence > chosenSequence);
	const sequence = input.selected.sequence;
	if (intent === 'point') {
		const point = details.diagram.points[1];
		details.window.clientSurface!.handlePointer!({ valid: true, insideViewport: true,
			viewportX: input.diagram.bounds.left + point.x, viewportY: input.diagram.offsetTop + point.y,
			pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false }, 0);
		assert.equal(input.selectedPoint, 1);
	} else {
		details.diagramControl.focusTarget.focus();
		assert.ok(details.diagramControl.focusTarget.hasFocus);
		f.press(intent);
	}
	assert.equal(input.following, false);
	f.issue(); input.update(); f.synchronize(); details.update();
	assert.equal(input.selected.sequence, sequence, 'the inspected record stays owned while history appends and reuses its ring');
});

test('GTE two-way font reflow retains the exact middle wrapped annotation at minimum width in a short work area', t => {
	const program = `
local data<const>: *word = 0x08010244
local control<const>: *word = 0x080102c4
local command<const>: *word = 0x08010344
function issue()
 control[0] = 0x7fff7fff
 control[1] = 0x7fff7fff
 control[2] = 0x7fff7fff
 control[3] = 0
 control[4] = 0
 control[5] = 0x7fffffff
 control[6] = 0x7fffffff
 control[7] = 0xffff
 control[24] = 0x7fffffff
 control[25] = 0x7fffffff
 control[26] = 0xffff
 control[27] = 0x7fff
 control[28] = 0x7fffffff
 data[0] = 0x7fff7fff
 data[1] = 0x7fff
 data[2] = 0x7fff7fff
 data[3] = 0x7fff
 data[4] = 0x7fff7fff
 data[5] = 0x7fff
 *command = 0x00080030
end
issue()
return true`;
	const f = fixture(t, 'msx', false, program), { input, details } = f;
	f.area.bottom = 110;
	details.show();
	const requested = input.detailsWindow.requestedBounds;
	input.detailsWindow.setRequestedBounds({ left: requested.left, top: requested.top,
		right: requested.left + input.detailsWindow.minimumWidth, bottom: requested.top + input.detailsWindow.minimumHeight });
	details.update(); details.chooseView(); f.press('ArrowDown'); f.press('Enter'); details.update();
	const middle = details.diagram.lines.find(line => line.start > 0 && line.section === 'flags'
		&& line.top <= input.diagram.contentHeight - input.diagram.height);
	assert.ok(middle, 'the captured saturated RTPT FLAG must expose a scrollable wrapped annotation');
	const reading = { top: middle.top, section: middle.section, start: middle.start };
	input.diagram.scrollbar.setScroll(reading.top);
	configureFontVariant('tiny'); details.update();
	configureFontVariant('msx'); details.update();
	assert.equal(input.diagram.scrollTop, reading.top, 'returning to the original font restores the exact source-text row, not the intervening wider line start');
	const restored = details.diagram.lines.find(line => line.top === input.diagram.scrollTop)!;
	assert.equal(restored.section, reading.section); assert.equal(restored.start, reading.start);
	configureFontVariant('tiny'); details.update();
	details.dispose();
	configureFontVariant('msx');
	const reopened = new GteDetailsWindow(input, {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	}, f.surfaces, f.owner, f.origin, f.area, f.quickInput, f.contextMenu, f.source, () => assert.fail('reading-position restore is not Source navigation'));
	t.after(() => reopened.dispose());
	reopened.show();
	assert.equal(input.diagram.scrollTop, reading.top, 'a fresh controller restores retained source coordinates, not the old font pixels');
	configureFontVariant('tiny'); reopened.update();
	f.press('Home');
	assert.equal(input.diagramAnchor.projectedScroll, undefined, 'actual Home intent retires even an unchanged projected position');
	configureFontVariant('msx'); reopened.update();
	assert.equal(input.diagram.scrollTop, 0, 'explicit Home replaces the older semantic annotation anchor');
});

test('NCLIP Output RGB paints its produced explanation at Home and retires captured data on Clear', t => {
	const f = fixture(t), { input, details } = f; details.show();
	details.chooseView(); for (let index = 0; index < 4; index++) f.press('ArrowDown'); f.press('Enter'); details.update();
	assert.equal(input.view, 'color'); assert.equal(input.inspectorPage, 'diagram');
	assert.equal(details.presentation.points.length, 0); assert.equal(details.presentation.colors.length, 0);
	f.press('Home'); details.update(); assert.equal(input.diagram.scrollTop, 0);
	const explanation = details.diagram.lines.filter(line => line.section === 'explanation');
	assert.ok(explanation.length > 0 && details.presentation.explanation.length > 0);
	// Exact source slices and painted lines verify producer-to-renderer data integrity, not English wording.
	assert.equal(explanation[0].start, 0); assert.equal(explanation.at(-1)!.end, details.presentation.explanation.length);
	for (const line of explanation) assert.equal(line.text, details.presentation.explanation.slice(line.start, line.end));
	assert.ok(details.diagram.lines.findIndex(line => line.section === 'explanation') < details.diagram.lines.findIndex(line => line.section === 'flags'));
	for (const method of ['pushClipRect', 'popClipRect', 'pushTransform', 'popTransform', 'fill_rect'] as const) t.mock.method(api, method, () => {});
	const border = t.mock.method(api, 'blit_rect', () => {}), text = t.mock.method(api, 'blit_text_inline_with_font', () => {});
	details.diagram.draw(input.diagram, details.presentation, input.selectedPoint, editorViewState.font.renderFont());
	assert.equal(border.mock.callCount(), 0, 'an empty interpretation must not paint an operand plot');
	assert.ok(text.mock.calls.some(call => call.arguments[0] === explanation[0].text),
		'Home must paint the produced explanation before any nonexistent operand plot could displace it');
	input.clear(); f.synchronize(); details.update();
	assert.equal(input.inspectorPage, 'diagram'); assert.equal(input.selected.sequence, -1);
	assert.equal(details.presentation.points.length, 0); assert.equal(details.presentation.colors.length, 0);
	assert.equal(details.diagram.lines.some(line => line.section === 'flags'), false);
	const clearedExplanation = details.diagram.lines.filter(line => line.section === 'explanation');
	assert.ok(clearedExplanation.length > 0 && details.presentation.explanation.length > 0);
	assert.equal(clearedExplanation[0].start, 0); assert.equal(clearedExplanation.at(-1)!.end, details.presentation.explanation.length);
	for (const line of clearedExplanation) assert.equal(line.text, details.presentation.explanation.slice(line.start, line.end));
	text.mock.resetCalls();
	details.diagram.draw(input.diagram, details.presentation, input.selectedPoint, editorViewState.font.renderFont());
	assert.ok(text.mock.calls.some(call => call.arguments[0] === clearedExplanation[0].text));
	assert.equal(border.mock.callCount(), 0);
});

test('GTE warmed width/font layouts reuse measured line and section records', t => {
	const f = fixture(t), { details } = f; details.show();
	details.chooseView(); f.press('ArrowDown'); f.press('Enter'); details.update();
	const diagram = details.diagram, lines = new Set<object>();
	const fonts = (['tiny', 'msx'] as const).map(variant => {
		configureFontVariant(variant); return editorViewState.font;
	});
	for (const font of fonts) for (const width of [110, 180, 268]) {
		editorViewState.font = font;
		diagram.layout(details.presentation, width, font.renderFont(), 120);
		for (const line of diagram.lines) lines.add(line);
	}
	const reserve = t.mock.method(ScratchBuffer.prototype, 'reserve');
	for (let pass = 0; pass < 5; pass++) for (const font of fonts) for (const width of [268, 180, 110]) {
		editorViewState.font = font;
		diagram.layout(details.presentation, width, font.renderFont(), 120);
		assert.ok(diagram.lines.every(line => lines.has(line)), 'a measured wrap replaces a warmed retained record');
	}
	assert.equal(reserve.mock.callCount(), 0, 'warm resize must not grow either line or section record storage');
});
