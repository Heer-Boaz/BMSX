import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { captureInstalledLuaSources, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createBlua32SourceImage, registerRuntimeLuaResource } from '../../ide/runtime/sources';
import { RuntimeGteHistory } from '../../ide/runtime/gte_history';
import { updateFullWidthWorkbenchLayout } from '../../ide/workbench/common/layout';
import { GteDetailsWindow } from '../../ide/workbench/contrib/gte_debugger/details_window';
import { GteDebuggerInput } from '../../ide/workbench/contrib/gte_debugger/editor_input';
import { GteDebugPresentation } from '../../ide/workbench/contrib/gte_debugger/presentation';
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

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'msx', withSource = false) {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const { runtime, sources, cpu } = eventHistoryRuntime(createCartlibProgramHarness(PROGRAM).images);
	const models = new EditorTextModelService(), registry = sources.cartridgeSlots[0]!.luaSources;
	const record = { ...createScenarioTestSourceRecord('entry.lua', 1, PROGRAM), sourceKind: 'project' as const, program_module: true };
	if (withSource) {
		registerLuaSourceRecord(registry, record);
		const image = sources.currentBlua32Media.cartridgeSlots[0]!;
		sources.currentBlua32Media = { ...sources.currentBlua32Media,
			cartridgeSlots: [createBlua32SourceImage(image.layout, image.symbols, captureInstalledLuaSources(registry), 0), null] };
	}
	const resource = withSource ? registerRuntimeLuaResource(sources, 0, record) : undefined;
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
	const source = new CapturedLuaSourceBinding(models, sources), presentation = new GteDebugPresentation();
	let formats = 0, sourceOpens = 0;
	const synchronize = () => {
		presentation.update(input.selected, input.selectionRevision, input.view, input.plane);
		if (input.selected.sequence < 0) source.clear(); else source.bind(input.selected.image, input.selected.pc);
	};
	synchronize();
	const details = new GteDetailsWindow(input, {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	}, surfaces, owner, origin, () => area, () => {
		formats++; synchronize(); return presentation.details(input.selected);
	}, source, () => { sourceOpens++; });
	t.after(() => { details.dispose(); inputFocus.setTarget(null); pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); input.dispose(); history.dispose(); models.clear(); });
	const key = (code: string, down: boolean) => inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const press = (code: string) => { key(code, true); key(code, false); };
	return { runtime, input, history, issue, area, surfaces, owner, origin, details, synchronize, source, models, resource,
		formats: () => formats, sourceOpens: () => sourceOpens, key, press };
}

for (const variant of ['tiny', 'msx'] as const) test(`GTE ${variant} Details is modeless and retains measured raw fields without idle reformatting`, t => {
	const f = fixture(t, variant), { input, details } = f;
	details.update(); assert.equal(f.formats(), 0);
	details.show();
	assert.equal(details.window.surface!.role, 'window'); assert.equal(details.window.surface!.lifetimeOwner, f.owner);
	assert.equal(details.inspector.chrome, 'client'); assert.equal(input.detailsWindow.title, '#0 NCLIP');
	assert.equal(input.detailsWindow.requestedBounds.bottom, input.layout.bottom - 4);
	assert.deepEqual(input.detailsActions.items.map(item => item.icon), ['source', 'collapse', 'close']);
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
	const f = fixture(t), { input, details } = f; details.show();
	const captured = Array.from(input.selected.beforeData), first = details.inspector.model.rows[0].element;
	f.issue(); f.issue(); input.update(); f.synchronize(); details.update();
	assert.equal(input.selected.sequence, 0); assert.match(input.detailsWindow.title, /expired/);
	assert.deepEqual(Array.from(input.selected.beforeData), captured); assert.equal(f.formats(), 1);
	details.inspector.focusTarget.focus(); f.press('ArrowDown'); f.key('Enter', true);
	input.select(input.history.firstSequence); f.synchronize(); details.update(); f.key('Enter', false);
	assert.equal(f.sourceOpens(), 0); assert.equal(f.formats(), 2);
	assert.notEqual(details.inspector.model.rows[0].element, first);
	assert.doesNotMatch(input.detailsWindow.title, /expired/);
	input.clear(); input.update(); f.synchronize(); details.update();
	assert.equal(input.detailsWindow.open, true); assert.equal(input.detailsWindow.title, 'GTE Details');
	assert.deepEqual(details.inspector.model.rows.map(row => row.element.label), ['No command selected']);
	assert.equal(f.formats(), 2); assert.equal(inputFocus.getCommand('gte.source', details.window.focusTarget)!.isEnabled(), false);
	inputFocus.executeCommand('window.hide', details.inspector.focusTarget); assert.equal(input.detailsWindow.open, false);
});

test('GTE collapse restores bookmarks at reflow and never applies them to a newly selected command', t => {
	const f = fixture(t), { input, details } = f; details.show();
	const last = details.inspector.model.rows.length - 1;
	details.inspector.model.select(last);
	const anchor = details.inspector.model.rowAt(details.inspector.model.viewport.bounds.top), scroll = details.inspector.model.viewport.scrollTop, placement = { ...input.detailsWindow.requestedBounds };
	details.window.setCollapsed(true);
	assert.equal(input.detailsView.selectionIndex, last); assert.equal(input.detailsView.anchorIndex, anchor);
	for (let frame = 0; frame < 1000; frame++) details.update();
	assert.equal(f.formats(), 1);
	details.window.setCollapsed(false);
	assert.equal(details.inspector.model.selectionIndex, last); assert.equal(details.inspector.model.viewport.scrollTop, scroll);
	details.inspector.focusTarget.focus(); f.press('Home'); details.update(); assert.equal(details.inspector.model.viewport.scrollTop, 0);
	details.window.hide(); details.show(); assert.equal(f.formats(), 1);
	details.inspector.model.select(last);
	f.issue(); input.update(); input.select(input.history.endSequence - 1); f.synchronize();
	details.window.setCollapsed(true);
	assert.equal(input.detailsView.selectionIndex, 0); assert.equal(input.detailsView.anchorIndex, 0);
	details.window.setCollapsed(false); details.update();
	assert.equal(details.inspector.model.selectionIndex, 0); assert.equal(f.formats(), 2);
	assert.deepEqual(input.detailsWindow.requestedBounds, placement);
});

test('GTE expanded reading position survives a font change while its client is collapsed', t => {
	const f = fixture(t, 'tiny'), { details } = f;
	details.show();
	details.inspector.model.select(67);
	details.window.setCollapsed(true);
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null); details.update();
	details.window.setCollapsed(false); details.update();
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
