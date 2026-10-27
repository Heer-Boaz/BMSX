import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { GameInputControl } from '../../ide/workbench/contrib/game_view/game_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';
import { InputChannel } from '../../hosts/common/input/channel';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { createHostFrameFixture } from '../helpers/host_frame';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { ImagePreviewOverlay } from '../../ide/workbench/ui/image_preview_overlay';
import { createTestRuntimeSourceState, createTestSystemImageRuntimeSourceState, createTestRuntime } from '../helpers/runtime_sources';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { linkTestSystemBlua32, type TestBlua32Image } from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';
import { RemoteInput } from '../../hosts/common/input/remote';
import { HostUiInput } from '../../hosts/common/input/ui';
import { WorkbenchFloatingWindow } from '../../ide/workbench/ui/window/control';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createWorkbenchActionBar } from '../../ide/workbench/ui/action_bar';
import { WorkbenchPropertyInspector } from '../../ide/workbench/ui/property_inspector/control';
import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, selectAll, setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { ConversationObserverInput } from '../../ide/workbench/contrib/conversations/editor_input';
import { ObservedConversation } from '../../ide/workbench/services/assistant/observed_conversation';
import { AssistantInput } from '../../ide/workbench/contrib/assistant/editor_input';
import { AssistantConversation } from '../../ide/workbench/services/assistant/conversation';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { buildCommandQuickPickItems, showCommandPalette } from '../../ide/workbench/contrib/commands/quick_access';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';

const PROMPT_REQUEST: ActionPromptRequest = { title: 'Pending source action', message: 'Continue with the captured source?',
	primary: 'Save and continue', secondary: 'Continue without saving', primaryEnabled: true, defaultChoice: 'primary' };

function fixture(t: TestContext, authored?: { image: TestBlua32Image; registry: LuaSourceRegistry }) {
	const host = createHostFrameFixture(authored === undefined ? undefined : createTestRuntime(authored.image.romBytes));
	if (authored !== undefined) host.runtime.boot();
	const sources = authored === undefined ? createTestRuntimeSourceState({ records: [], path2lua: {}, module2lua: {}, entrySourcePath: '',
		projectRootPath: '', can_boot_from_source: false, revision: 0 }, [null, null], SYSTEM_RESOURCE_DOMAIN)
		: createTestSystemImageRuntimeSourceState(authored.image.romBytes, authored.registry);
	if (authored !== undefined) sources.currentBlua32Media = {
		system: createBlua32SystemSourceImage(authored.image.image, authored.image.symbols, authored.image.biosImports, captureInstalledLuaSources(authored.registry, authored.image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID),
		cartridgeSlots: [null, null],
	};
	const unused = (): never => { throw new Error('Surface routing does not request domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	editorRuntimeState.active = true;
	host.input.setPointerAdmissionMode('routed');
	let buttons = 0;
	function pointer(x: number, y: number, nextButtons = buttons) {
		editor.dispatchPointer({ x, y, buttons: nextButtons, pressedButtons: nextButtons & ~buttons,
			releasedButtons: buttons & ~nextButtons, cancelledButtons: 0, modifiers: KeyModifier.none,
			spaceDown: false, timestamp: host.clock.now() });
		buttons = nextButtons;
	}
	t.after(async () => {
		pointer(0, 0, 0);
		inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	const extent = { left: 0, top: 0, right: 384, bottom: 288 };
	return { ide, editor, host, pointer, extent, sources };
}

/** Compiled guest membership and the production Actor pane, not a substituted input/focus control. */
function actorFixture(t: TestContext) {
	const source = "local world<const> = require('cartlib/world/world'); return world";
	const modules = [{ path: 'cartlib/world/world', source: `local fsm<const> = require('cartlib/fsm/fsm_component')
local state<const> = { definition = { on = {} }, states = {}, state_ids = {}, data = { answer = 42 } }
local machine<const> = { localdef_id = 'flight', definition = { on = {} }, states = { idle = state }, state_ids = { 'idle' }, current_id = 'idle' }
local component<const> = { id = 'states', enabled = true, _parent_component_index = 1, _started = true, _machines = { machine }, _machines_by_id = { flight = machine } }
local actor<const> = { id = 1, active = true, _components = { component }, _components_by_class = { [fsm] = { component } } }
local other<const> = { id = 2, active = true, _components = {}, _components_by_class = {} }
component.parent = actor
return { _objects = { actor, other } }` },
		{ path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/timeline/timeline_component', source: 'return {}' },
		{ path: 'cartlib/actioneffects/actioneffect_component', source: 'return {}' }]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(source, 'actor-reflow.lua');
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []),
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'actor-reflow.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'actor-reflow', type: 'lua', src: source, base_src: source,
		source_path: 'actor-reflow.lua', normalized_source_path: 'actor-reflow.lua', module_path: 'actor-reflow',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const f = fixture(t, { image, registry });
	const sourceModel = f.ide.models.retain(f.sources.catalog.luaResources[0], 'lua', source);
	f.host.runtime.machine.cpu.runUntilDepth(0, 100_000);
	f.host.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
	f.ide.inspection.pause();
	const controller = f.editor.actorLab, input = controller.resolveInput();
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, controller.guest, -1)[0].hashId;
	f.editor.updateViewport({ width: 640, height: 360 });
	f.editor.editorGroup.openEditor(input); f.editor.update(0);
	const pane = f.editor.editorGroup.panes.activePane;
	assert.ok(pane instanceof ActorLabEditorPane);
	return { ...f, controller, input, pane, sourceModel };
}

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Actor preview retirement drains a real guest hold without migrating it into the expanded primary client`, t => {
	const { editor, host, pointer, input, pane } = actorFixture(t);
	editor.setFontVariant(variant); editor.update(0); pane.focus();
	const primary = inputFocus.target!, selected = input.outline.rows[input.outline.selectionIndex];
	const center = () => ({ x: (input.previewBounds.left + input.previewBounds.right) / 2,
		y: (input.previewBounds.top + input.previewBounds.bottom) / 2 });
	const sample = createInputControllerSnapshot();
	let point = center(); pointer(point.x, point.y, PointerButton.Primary);
	const preview = inputFocus.target!, binding = preview.guestInput!;
	assert.notEqual(preview, primary); assert.equal(binding.recipient, host.input);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1); assert.equal(pointerCapture.guestBinding, binding);
	editor.updateViewport({ width: 256, height: 360 }); editor.update(0);
	assert.ok(preview.guestInput === undefined, 'withheld preview retires its actual input attachment');
	assert.equal(inputFocus.target, primary); assert.equal(editor.guestInputRecipient, null);
	preview.focus(); assert.equal(inputFocus.target, primary, 'a withheld preview is not a direct focus destination');
	assert.equal(pointerCapture.guestBinding, undefined); assert.equal(pointerCapture.draining, true);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 0);
	const otherRow = input.outline.selectionIndex === 0 ? 1 : 0;
	pointer((input.outline.layout.contentLeft + input.outline.layout.contentRight) / 2,
		input.outline.layout.contentTop + (otherRow + 0.5) * input.outline.layout.rowHeight,
		PointerButton.Primary | PointerButton.Secondary);
	assert.equal(input.outline.rows[input.outline.selectionIndex], selected, 'the interrupted guest hold cannot select the newly expanded tree');
	editor.updateViewport({ width: 640, height: 360 }); editor.update(0);
	assert.equal(preview.guestInput, binding, 'reappearance reuses the same viewport binding');
	assert.equal(inputFocus.target, primary, 'reappearance does not steal primary keyboard focus');
	point = center(); pointer(point.x, point.y, PointerButton.Primary | PointerButton.Secondary | PointerButton.Auxiliary);
	assert.equal(inputFocus.target, primary); assert.equal(pointerCapture.guestBinding, undefined);
	assert.equal(input.outline.rows[input.outline.selectionIndex], selected);
	pointer(point.x, point.y, 0); assert.equal(pointerCapture.draining, false);
	pointer(point.x, point.y, PointerButton.Primary);
	assert.equal(inputFocus.target, preview); assert.equal(pointerCapture.guestBinding, binding);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 1);
	pointer(point.x, point.y, 0);
});

test('Actor reflow retires the real sash while retaining primary, graph and locked Details owners in both fonts', t => {
	const { ide, editor, host, pointer, input, pane, sourceModel } = actorFixture(t);
	const authored = sourceModel.buffer.getText(), version = sourceModel.version, cycles = host.runtime.machine.scheduler.currentNowCycles();
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	const selected = input.outline.rows[input.outline.selectionIndex], path = input.selectionPath;
	for (const variant of ['tiny', 'msx'] as const) {
		editor.setFontVariant(variant); editor.update(0); pane.focus();
		const primary = inputFocus.target!;
		assert.equal(inputFocus.moveFocus(false), true); assert.equal(inputFocus.moveFocus(false), true);
		const sash = inputFocus.target!;
		assert.notEqual(sash, primary); assert.equal(sash.guestInput, undefined);
		pane.focus();
		const y = (input.split.bounds.top + input.split.bounds.bottom) / 2;
		const x = input.split.position;
		pointer(x, y, PointerButton.Primary);
		assert.equal(pointerCapture.active, true); assert.equal(inputFocus.target, primary);
		pointer(x + 12, y); editor.update(0);
		const ratio = input.split.ratio;
		editor.updateViewport({ width: 256, height: 360 }); editor.update(0);
		assert.equal(pointerCapture.active, false, 'withholding the split retires its captured control');
		assert.equal(pointerCapture.draining, true); assert.equal(sash.canFocus!(), false);
		assert.equal(inputFocus.target, primary);
		for (const backward of [false, true]) {
			const visited = new Set<typeof primary>();
			do {
				assert.ok(!visited.has(inputFocus.target!), 'the visible focus ring returns to the actual primary client');
				visited.add(inputFocus.target!);
				assert.notEqual(inputFocus.target, sash); assert.equal(inputFocus.target!.guestInput, undefined);
				assert.equal(inputFocus.moveFocus(backward), true);
			} while (inputFocus.target !== primary);
		}
		pane.focus(); pointer(220, y, PointerButton.Primary | PointerButton.Secondary); pointer(220, y, 0);
		assert.equal(input.split.ratio, ratio); assert.equal(input.outline.rows[input.outline.selectionIndex], selected);
		assert.equal(input.selectionPath, path);
		editor.updateViewport({ width: 640, height: 360 }); editor.update(0);
		assert.equal(sash.canFocus!(), true); assert.equal(input.split.ratio, ratio); assert.equal(inputFocus.target, primary);
	}
	editor.commands.execute('actorLab.stateGraph'); editor.update(0);
	const graph = input.stateGraph!, graphFocus = inputFocus.target!, selection = graph.viewport.selection;
	const viewport = graph.viewport;
	viewport.setZoom(0.5); viewport.scrollX = -17; viewport.scrollY = -9;
	const viewState = { zoom: viewport.zoom, x: viewport.scrollX, y: viewport.scrollY };
	editor.commands.execute('actorLab.details'); editor.update(0);
	editor.commands.execute('actorLab.lockDetails', pane.inspector.focusTarget);
	const details = input.details!, subject = details.subject!, detailsModel = input.detailsWindow;
	assert.equal(details.locked, true); assert.ok(subject);
	const detailsFocus = inputFocus.target!;
	for (const variant of ['tiny', 'msx'] as const) {
		editor.setFontVariant(variant); editor.update(0);
		const model = graph.viewport.model;
		for (const width of [256, 640]) {
			editor.updateViewport({ width, height: 360 }); editor.update(0);
			assert.equal(inputFocus.target, detailsFocus, 'preview retirement does not blur an independently focused Details client');
			assert.equal(input.stateGraph, graph); assert.equal(graph.viewport.model, model); assert.equal(graph.viewport.selection, selection);
			assert.ok(graph.viewport === viewport);
			assert.deepEqual({ zoom: viewport.zoom, x: viewport.scrollX, y: viewport.scrollY }, viewState);
			assert.equal(input.detailsWindow, detailsModel); assert.equal(details.subject, subject); assert.equal(details.locked, true);
			assert.equal(pane.runtimeControlContext, graphFocus, 'compact composition retains the real graph command origin');
		}
		pane.focus(); assert.equal(inputFocus.target, graphFocus);
		editor.updateViewport({ width: 256, height: 360 }); editor.update(0);
		assert.equal(inputFocus.target, graphFocus);
		pane.inspector.focusTarget.focus();
	}
	pane.detailsWindow.focusTarget.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.ok(inputFocus.target === graphFocus, 'Details Escape returns to the actual graph client, not a pane alias outside its focus ring');
	assert.equal(inputFocus.moveFocus(true), true); assert.equal(inputFocus.target!.guestInput, undefined);
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === graphFocus);
	editor.commands.execute('actorLab.details'); editor.update(0);
	assert.ok(inputFocus.target === pane.inspector.focusTarget);
	editor.commands.execute('window.hide');
	assert.ok(inputFocus.target === graphFocus, 'hiding Details restores the same actual graph client');
	assert.equal(sourceModel.buffer.getText(), authored); assert.equal(sourceModel.version, version); assert.equal(sourceModel.canUndo, false);
	assert.equal(host.runtime.machine.scheduler.currentNowCycles(), cycles);
	assert.equal(ide.inspection.status().paused, true);
});

test('the real Assistant transcript owns only its selected-message actions for the attached input lifetime', async t => {
	class TranscriptProducer extends AssistantConversation {
		public message(text: string) { return this.append('assistant', text); }
		public proposal(proposal: WorkspaceEditProposal) { return this.append('proposal', proposal.title, proposal); }
	}
	const source = 'return 42', path = 'transcript-actions.lua';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, path), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: path,
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'transcript-actions', type: 'lua', src: source, base_src: source,
		source_path: path, normalized_source_path: path, module_path: 'transcript-actions', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const { editor, sources } = fixture(t, { image, registry }), models = new EditorTextModelService();
	const conversation = new TranscriptProducer(models, sources, editor.tools), input = new AssistantInput(conversation);
	const model = models.retain(sources.catalog.luaResources[0], 'lua', source);
	const proposal = new WorkspaceEditProposal('Proposed source', new WorkspaceSourceContext(models, sources.catalog), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 7, deleteLength: 2, text: '43' }] }]]),
	});
	t.after(() => { input.dispose(); conversation.dispose(); models.clear(); });
	const message = conversation.message('Exact selected message\r\nwith retained bytes'), proposed = conversation.proposal(proposal);
	assert.equal(conversation.available, false);
	input.selection.select(undefined);
	editor.editorGroup.openEditor(input); editor.update(0);
	assert.ok(inputFocus.target === input.draft.focusTarget);
	assert.equal(inputFocus.moveFocus(false), true); assert.equal(inputFocus.moveFocus(false), true);
	const client = inputFocus.target!;
	assert.notEqual(client, input.draft.focusTarget);
	for (const command of ['assistant.review', 'assistant.copy'] as const) {
		assert.ok(client.getCommand(command), 'the transcript publishes its real selected-message action');
		assert.equal(client.getCommand(command), client.parent!.getCommand(command));
		assert.equal(editor.commands.isEnabled(command, client), false);
	}
	for (const command of ['assistant.send', 'assistant.queue', 'assistant.direct'] as const) assert.equal(client.getCommand(command), undefined);
	input.selection.select(message);
	assert.equal(editor.commands.isEnabled('assistant.copy', client), true);
	assert.equal(editor.commands.isEnabled('assistant.review', client), false);
	editor.commands.execute('assistant.copy', client);
	assert.equal((await editor.clipboard.read()).text, message.text.getText());
	input.selection.select(proposed);
	assert.equal(editor.commands.isEnabled('assistant.review', client), true);
	editor.editorGroup.panes.clearEditor();
	for (const command of ['assistant.review', 'assistant.copy'] as const) assert.equal(editor.commands.isEnabled(command, client), false);
	editor.commands.execute('assistant.review', client); assert.equal(editor.editorGroup.panes.activePane, null);
	editor.editorGroup.panes.openEditor(input); inputFocus.moveFocus(false); inputFocus.moveFocus(false);
	assert.ok(inputFocus.target === client);
	assert.equal(editor.commands.isEnabled('assistant.review', client), true);
	editor.commands.execute('assistant.review', client);
	const review = editor.editorGroup.panes.activePane!.input;
	assert.equal(review.kind, 'workspace_edit_review');
	assert.ok(review.kind === 'workspace_edit_review' && review.proposal === proposal);
	assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
});

test('Assistant borrows its draft command context only for the concrete input attachment', t => {
	const { editor } = fixture(t), group = editor.editorGroup;
	const input = new AssistantInput(editor.assistant), companion = new GameViewInput();
	t.after(() => input.dispose());
	group.openEditor(input);
	const pane = group.panes.activePane!, draft = input.draft.focusTarget;
	const undo = draft.getCommand('undo');
	assert.ok(pane.commandTarget === draft);
	assert.ok(findEditorGroup(draft) === group);
	insertValue(input.draft, 'Retained draft');
	assert.equal(editor.commands.isEnabled('undo', draft), true);
	showCommandPalette(editor.quickInput, editor.commands);
	assert.ok(editor.quickInput.invocationOrigin === draft);
	assert.equal(editor.quickInput.visible, true);
	group.openEditor(companion);
	assert.ok(group.panes.activePane !== pane);
	assert.ok(group.model.tabs.includes(input), 'switching views retains the input, not its control attachment');
	assert.equal(input.lifetime.signal.aborted, false);
	assert.equal(editor.quickInput.visible, false, 'the old draft cannot keep a Palette alive across attachment retirement');
	assert.equal(findEditorGroup(draft), undefined);
	assert.ok(draft.commandContext === draft);
	for (const command of ['assistant.send', 'assistant.copy', 'suggest.accept'] as const) assert.equal(draft.getCommand(command), undefined);
	assert.equal(draft.getCommand('undo'), undo, 'retiring view commands does not replace the field-owned Undo history');
	assert.equal(draft.next, null); assert.equal(draft.previous, null);
	draft.focus();
	assert.ok(inputFocus.admittedTarget !== draft, 'a retained but detached draft cannot reclaim keyboard focus');
	assert.ok(group.panes.activePane!.input === companion);
	inputFocus.executeCommand('undo', draft);
	assert.equal(input.draft.text, '');
	assert.equal(input.draftHasText, false, 'the retained input still observes its field-owned history');
	group.activate(input.id);
	assert.ok(group.panes.activePane === pane);
	assert.ok(pane.commandTarget === draft);
	assert.ok(findEditorGroup(draft) === group);
	assert.ok(inputFocus.target === draft);
	assert.ok(draft.getCommand('assistant.send'));
});

test('generic command admission and execution use the exact target and disabled locals shadow other owners', t => {
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorGroup.focusScope), leaf = inputFocus.createTarget(parent);
	leaf.commandContext = parent;
	let local = 0, ancestor = 0, enabled = true;
	for (const command of ['undo', 'resourceSearch'] as const) {
		parent.registerCommand(command, { isEnabled: () => true, run: () => { ancestor++; } });
		leaf.registerCommand(command, { isEnabled: () => enabled, run: () => { local++; } });
		assert.equal(editor.commands.isEnabled(command, leaf), true);
		editor.commands.execute(command, leaf);
		assert.equal(local, 1); assert.equal(ancestor, 0);
		enabled = false;
		assert.equal(editor.commands.isEnabled(command, leaf), false);
		editor.commands.execute(command, leaf);
		assert.equal(local, 1); assert.equal(ancestor, 0);
		enabled = true; local = 0;
	}
	const absent = inputFocus.createTarget(parent); absent.commandContext = parent;
	assert.equal(editor.commands.isEnabled('undo', absent), false);
	editor.commands.execute('undo', absent);
	assert.equal(ancestor, 0, 'an absent local capability does not inherit a document action');
});

test('root Palette in an empty group cannot revive commands from its detached last-focused pane', t => {
	const { editor } = fixture(t), group = editor.editorGroup;
	group.openEditor(new HostErrorInput('previous document'));
	const detached = group.panes.activePane!.commandTarget;
	let staleExecutions = 0;
	detached.registerCommand('sceneEditor.source', { isEnabled: () => true, run: () => { staleExecutions++; } });
	detached.focus();
	assert.equal(group.focusScope.lastFocused, detached);
	group.clear();
	assert.equal(group.panes.activePane, null);
	assert.equal(group.focusScope.lastFocused, detached, 'focus memory is retained independently of attachment');
	assert.equal(detached.getCommand('sceneEditor.source')!.isEnabled(), true);
	inputFocus.setTarget(null);
	editor.commands.execute('commandPalette', null);
	const items = editor.quickInput.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	assert.equal(editor.quickInput.invocationOrigin, group.tabFocusTarget);
	assert.equal(items.some(item => item.command === 'sceneEditor.source'), false);
	assert.ok(items.every(item => item.target === group.tabFocusTarget));
	const row = editor.quickInput.model.list.rows.findIndex(row => items[row.itemIndex].command === 'home');
	assert.ok(row >= 0);
	editor.quickInput.model.list.selectionIndex = row;
	editor.quickInput.accept();
	assert.equal(group.panes.activePane?.input.kind, 'home');
	assert.equal(staleExecutions, 0);
});

test('chrome Palette after a preserve-focus switch addresses the new attached client rather than old focus memory', t => {
	const { editor } = fixture(t), group = editor.editorGroup;
	group.openEditor(new HostErrorInput('previous document'));
	const detached = group.panes.activePane!.commandTarget;
	let staleExecutions = 0, currentExecutions = 0;
	detached.registerCommand('sceneEditor.source', { isEnabled: () => true, run: () => { staleExecutions++; } });
	detached.focus();
	editor.resourcePanel.show();
	const chrome = inputFocus.target;
	assert.equal(chrome, editor.resourcePanel.focusTarget);
	const next = new GameViewInput();
	group.openEditor(next, { preserveFocus: true });
	const attached = group.panes.activePane!.commandTarget;
	assert.notEqual(attached, detached);
	assert.equal(inputFocus.target, chrome);
	assert.equal(group.focusScope.lastFocused, detached);
	attached.registerCommand('sceneEditor.source', {
		isEnabled: () => true,
		run: () => { assert.equal(group.panes.activePane!.input, next); currentExecutions++; },
	});
	editor.commands.execute('commandPalette', chrome);
	const items = editor.quickInput.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	const item = items.find(item => item.command === 'sceneEditor.source');
	assert.ok(item);
	assert.equal(item.target, attached);
	assert.equal(editor.quickInput.invocationOrigin, attached);
	const row = editor.quickInput.model.list.rows.findIndex(row => items[row.itemIndex] === item);
	assert.ok(row >= 0);
	editor.quickInput.model.list.selectionIndex = row;
	editor.quickInput.accept();
	assert.equal(currentExecutions, 1);
	assert.equal(staleExecutions, 0);
	assert.equal(group.panes.activePane!.input, next);
	assert.equal(inputFocus.target, chrome);
});

test('chrome Palette retains Host Error body Copy and writes the exact attached document bytes', async t => {
	const { editor } = fixture(t), group = editor.editorGroup;
	const stack = 'RangeError: invalid tuple\n\tat sample.lua:8:3\n';
	group.openEditor(new HostErrorInput(stack));
	const pane = group.panes.activePane!;
	pane.focus();
	const body = inputFocus.target!;
	assert.equal(pane.commandTarget, body);
	assert.equal(body.parent!.clipboard, undefined, 'Copy belongs to the attached document body, not its containing pane root');
	assert.equal(editor.commands.isEnabled('copy', body), true);
	editor.resourcePanel.show();
	const chrome = inputFocus.target;
	assert.equal(chrome, editor.resourcePanel.focusTarget);
	editor.commands.execute('commandPalette', chrome);
	const items = editor.quickInput.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	const copy = items.find(item => item.command === 'copy');
	assert.ok(copy);
	assert.equal(copy.target, body);
	assert.equal(editor.commands.isEnabled('copy', copy.target), true);
	const row = editor.quickInput.model.list.rows.findIndex(row => items[row.itemIndex] === copy);
	assert.ok(row >= 0);
	editor.quickInput.model.list.selectionIndex = row;
	editor.quickInput.accept();
	assert.equal((await editor.clipboard.read()).text, stack);
	assert.equal(inputFocus.target, chrome);
	assert.equal(group.panes.activePane, pane);
});

test('Conversations publishes older-page admission on its real transcript client for the attached input lifetime', t => {
	const { editor } = fixture(t), conversation = new ObservedConversation(), replacement = new ObservedConversation();
	const input = new ConversationObserverInput(conversation), next = new ConversationObserverInput(replacement);
	const older = t.mock.method(conversation, 'older', async () => {}), nextOlder = t.mock.method(replacement, 'older', async () => {});
	t.after(() => { input.dispose(); next.dispose(); conversation.dispose(); replacement.dispose(); });
	conversation.olderCursor = 'previous-page'; replacement.olderCursor = 'replacement-page';
	editor.editorGroup.panes.openEditor(input);
	const client = inputFocus.target!;
	assert.ok(client.getCommand('conversations.older'));
	assert.equal(client.getCommand('conversations.older'), client.parent!.getCommand('conversations.older'));
	assert.equal(editor.commands.isEnabled('conversations.older', client), true);
	editor.commands.execute('conversations.older', client); assert.equal(older.mock.callCount(), 1);
	conversation.pending = true;
	assert.equal(editor.commands.isEnabled('conversations.older', client), false);
	editor.commands.execute('conversations.older', client); assert.equal(older.mock.callCount(), 1);
	conversation.pending = false; conversation.olderCursor = null;
	assert.equal(editor.commands.isEnabled('conversations.older', client), false);
	conversation.olderCursor = 'previous-page'; editor.editorGroup.panes.clearEditor();
	assert.notEqual(inputFocus.admittedTarget, client);
	assert.equal(editor.commands.isEnabled('conversations.older', client), false);
	editor.commands.execute('conversations.older', client); assert.equal(older.mock.callCount(), 1);
	editor.editorGroup.panes.openEditor(next);
	assert.equal(inputFocus.target, client, 'the retained client reads its newly attached input, not the old conversation');
	assert.equal(editor.commands.isEnabled('conversations.older', client), true);
	editor.commands.execute('conversations.older', client);
	assert.equal(older.mock.callCount(), 1); assert.equal(nextOlder.mock.callCount(), 1);
});

test('Conversations wrapping is invariant under translation of the editor client', t => {
	class TranscriptProducer extends ObservedConversation {
		public message(text: string): void { this.append('assistant', text); }
	}
	const { editor } = fixture(t), conversation = new TranscriptProducer(), input = new ConversationObserverInput(conversation);
	t.after(() => { input.dispose(); conversation.dispose(); });
	conversation.message('A conversation transcript wraps at its own client width, independently of the client origin. '.repeat(5));
	conversation.configuration = { agent: 'codex', provider: null, model: 'a-model-with-a-long-name', effort: 'a-long-effort-description', serviceTier: 'a-long-service-tier' };
	const bounds = { left: 0, top: 24, right: 180, bottom: 260 };
	editor.editorGroup.panes.layout(bounds); editor.editorGroup.panes.openEditor(input);
	const rows = input.transcript.rows.length, footer = input.footer.lines.slice(), height = input.viewport.contentHeight;
	// This focused layout contract changes the origin only; neither producer text nor available width changes.
	editor.editorGroup.panes.layout({ ...bounds, left: bounds.left + 80, right: bounds.right + 80 });
	editor.editorGroup.panes.activePane!.update(0);
	assert.equal(input.transcript.rows.length, rows); assert.equal(input.viewport.contentHeight, height);
	assert.deepEqual(input.footer.lines, footer);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Assistant client translation and real Files reflow preserve the draft owner and selection`, t => {
	const { editor } = fixture(t), input = new AssistantInput(editor.assistant);
	t.after(() => input.dispose());
	editor.setFontVariant(variant);
	editor.editorGroup.openEditor(input); editor.update(0);
	insertValue(input.draft, 'A retained assistant draft wraps at the actual client width without changing its text or selection. '.repeat(6));
	input.draft.setSelection(7, 31); editor.editorGroup.panes.activePane!.update(0);
	const state = input.draft.readText(), rows = input.composer.rows.slice(), bounds = { ...input.layout }, composer = { ...input.composerBounds };
	// Equal-width translation is the layout algorithm under test, not an incidental screen position.
	editor.editorGroup.panes.layout({ ...bounds, left: bounds.left + 40, right: bounds.right + 40 });
	editor.editorGroup.panes.activePane!.update(0);
	assert.deepEqual(input.composer.rows, rows);
	assert.deepEqual(input.composerBounds, { ...composer, left: composer.left + 40, right: composer.right + 40 });
	assert.deepEqual(input.draft.readText(), state); assert.ok(inputFocus.target === input.draft.focusTarget);
	editor.resourcePanel.show(); editor.editorGroup.panes.activePane!.focus(); editor.update(0);
	assert.equal(editor.resourcePanel.visible, true);
	assert.ok(input.composer.rows.length > rows.length, 'the real Files client reduces the available composer width');
	assert.deepEqual(input.draft.readText(), state); assert.ok(inputFocus.target === input.draft.focusTarget);
	editor.resourcePanel.hide(); editor.update(0);
	assert.deepEqual(input.composer.rows, rows); assert.deepEqual(input.draft.readText(), state);
	assert.ok(inputFocus.target === input.draft.focusTarget);
	input.draft.undo(); assert.equal(input.draft.text, '', 'reflow adds no draft edits or history entries');
});

for (const command of ['animation.remove', 'animation.tracks', 'animation.keys', 'animation.details'] as const)
test(`${command} publishes the actual focused draft before resolving the explicit action owner`, t => {
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorGroup.focusScope);
	let value = 1, calls = 0;
	const field = new ValueInput(parent, INTEGER_INPUT_FORMAT, accepted => { value = accepted; });
	t.after(() => field.dispose()); field.setValue(value);
	field.field.focusTarget.commandContext = parent;
	parent.registerCommand(command, { isEnabled: () => true, run: () => { assert.equal(value, 2); calls++; } });
	field.field.focusTarget.focus(); selectAll(field.field); insertValue(field.field, '2');
	editor.commands.execute(command, parent);
	assert.equal(calls, 1); assert.equal(field.pending, false);
	selectAll(field.field); insertValue(field.field, 'invalid');
	editor.commands.execute(command, parent);
	assert.equal(calls, 1); assert.equal(value, 2); assert.equal(field.pending, true);
});

test('Animation body clients and its actual property draft publish exact client-navigation handlers to the real command controller and Palette', t => {
	const path = 'animation-navigation.lua';
	const source = "local sprite=require('cartlib/component/sprite_animation_component'); local definition={duration_ms=100,tracks={{kind='value',keys={{time_ms=0,value=1},{time_ms=100,value=2}}}},frames={'picture'}}; sprite.factory(definition); return definition";
	const timelinePath = 'animation-key-palette.lua';
	const timelineSource = "return {duration_ms=100,tracks={{kind='value',keys={{time_ms=0,value=1},{time_ms=100,value=2}}}}}";
	const boot = 'return 42';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(boot, 'boot.lua'), [],
		{ entrySource: boot, programDomain: 'system', optLevel: 0 }));
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'boot.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'boot', type: 'lua', src: boot, base_src: boot,
		source_path: 'boot.lua', normalized_source_path: 'boot.lua', module_path: 'boot', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	registerLuaSourceRecord(registry, { resid: path, type: 'lua', src: source, base_src: source,
		source_path: path, normalized_source_path: path, module_path: 'animation-navigation', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'source-only', program_module: false });
	registerLuaSourceRecord(registry, { resid: timelinePath, type: 'lua', src: timelineSource, base_src: timelineSource,
		source_path: timelinePath, normalized_source_path: timelinePath, module_path: 'animation-key-palette', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'source-only', program_module: false });
	registerLuaSourceRecord(registry, createScenarioTestSourceRecord('cartlib/component/sprite_animation_component.lua', 1, 'return {}',
		'machine/bios/cartlib/component/sprite_animation_component.lua'));
	const { editor, sources } = fixture(t, { image, registry });
	const texture = encodeDirect16GxTexture(1, 1, new Uint8ClampedArray([255, 0, 0, 255]));
	const encoded = new Uint8Array(encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount));
	const context = sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID), rom = context.previewRom!, start = rom.bytes.length, bytes = new Uint8Array(start + encoded.length);
	bytes.set(rom.bytes); bytes.set(encoded, start); rom.bytes = bytes;
	const assets: RomAsset[] = [{ resid: 'picture', type: 'image', imgmeta: { width: 1, height: 1, texture_u: 0, texture_v: 0, gx_atlas_id: 'picture-atlas' } },
		{ resid: 'picture-atlas', type: 'texture', start, end: bytes.length, texturemeta: { mode: texture.mode,
			word_width: texture.wordWidth, height: texture.height, texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount } }];
	finalizePackedRomAssets(assets); rom.index.entries.push(...assets);
	context.previewPackage.img.picture = assets[0]; sources.catalog.rebuildResources();
	const input = editor.animations.openResource(editor.editorGroup, sources.catalog.luaResources.find(resource => resource.path === path)!); editor.update(0);
	const tracks = inputFocus.target!, commands = ['animation.tracks', 'animation.keys', 'animation.details'] as const;
	const handlers = commands.map(command => tracks.getCommand(command));
	editor.animations.selectTrack(input, 1); editor.animations.selectKey(input, 0); editor.update(0);
	const clients = [tracks];
	for (const command of ['animation.keys', 'animation.details'] as const) {
		editor.commands.execute(command); editor.update(0); clients.push(inputFocus.target!);
	}
	editor.animations.selectTrack(input, input.tracks.rows.length - 1); editor.animations.selectProperty(input, 0); editor.update(0);
	assert.equal(input.framePreview.bitmap!.image.width, 1);
	editor.commands.execute('animation.keys'); editor.update(0); clients.push(inputFocus.target!);
	assert.equal(new Set(clients).size, 4, 'the real frame preview is a distinct concrete image client');
	for (const client of clients) {
		for (let index = 0; index < commands.length; index++) {
			assert.equal(client.getCommand(commands[index]), handlers[index]);
			assert.equal(editor.commands.isEnabled(commands[index], client), true);
		}
		const picks = buildCommandQuickPickItems(editor.commands, client);
		for (const command of commands) assert.ok(picks.some(item => item.command === command));
		for (const command of ['animation.source', 'animation.fit', 'animation.snap', 'animation.addFrame'] as const) {
			assert.equal(client.getCommand(command), tracks.getCommand(command));
			assert.equal(editor.commands.isEnabled(command, client), true);
			assert.ok(picks.some(item => item.command === command));
		}
	}
	editor.commands.execute('animation.tracks'); editor.animations.selectTrack(input, 1); editor.animations.selectKey(input, 0);
	const property = input.details.rows.findIndex(row => row.element.field === input.document!.tracks[0].keys[0].value!.field);
	editor.animations.selectProperty(input, property); editor.update(0); editor.commands.execute('animation.details');
	const details = inputFocus.target!;
	editor.commands.execute('animation.edit', details.commandContext);
	const field = inputFocus.target!, native = field.textInput!, undo = field.getCommand('undo');
	assert.ok(field.edit); assert.notEqual(undo, tracks.getCommand('undo'));
	const fieldPicks = buildCommandQuickPickItems(editor.commands, field);
	for (const command of commands) assert.ok(fieldPicks.some(item => item.command === command));
	assert.equal(native.replaceText(0, native.readText().text.length, 'invalid +'), true);
	editor.commands.execute('animation.tracks', field);
	assert.equal(inputFocus.target, field); assert.equal(input.activeClient, 'details'); assert.equal(field.edit!.pending, true);
	assert.equal(input.workingCopy.buffer.getText(), source);
	for (let index = 0; index < commands.length; index++) assert.equal(field.getCommand(commands[index]), handlers[index]);
	assert.equal(field.getCommand('undo'), undo, 'navigation does not borrow or replace the actual field-local history');
	assert.equal(native.replaceText(0, native.readText().text.length, '2'), true);
	showCommandPalette(editor.quickInput, editor.commands);
	assert.equal(input.document!.tracks[0].keys[0].value!.value, 2, 'ordinary Palette blur first publishes the actual field draft');
	assert.equal(editor.quickInput.invocationOrigin, details, 'the retired field resolves to its actual Details owner before catalog enumeration');
	const palette = editor.quickInput.model.list;
	assert.ok(palette.rows.some(row => (row.item as CommandQuickPickItem).command === 'animation.tracks'));
	editor.quickInput.hide();
	const edited = input.workingCopy.buffer.getText();
	editor.commands.execute('animation.tracks', field); assert.equal(input.activeClient, 'tracks');
	assert.equal(input.workingCopy.buffer.getText(), edited);
	editor.editorGroup.panes.clearEditor();
	for (const client of [...clients, field]) for (const command of commands) assert.equal(editor.commands.isEnabled(command, client), false);
	const detachedPicks = buildCommandQuickPickItems(editor.commands, field);
	for (const command of commands) assert.equal(detachedPicks.some(item => item.command === command), false);
	editor.editorGroup.openEditor(input); editor.update(0);
	for (const client of [...clients, field]) for (const command of commands) assert.equal(editor.commands.isEnabled(command, client), true);
	assert.equal(input.workingCopy.buffer.getText(), edited);
	const timeline = editor.animations.openResource(editor.editorGroup, sources.catalog.luaResources.find(resource => resource.path === timelinePath)!);
	editor.animations.selectTrack(timeline, 1); editor.animations.selectKey(timeline, 0); editor.update(0);
	editor.commands.execute('animation.keys');
	const keysClient = inputFocus.target!;
	assert.equal(editor.commands.isEnabled('animation.addKey', keysClient), true);
	assert.ok(buildCommandQuickPickItems(editor.commands, keysClient).some(item => item.command === 'animation.addKey'));
	editor.animations.selectProperty(timeline, timeline.details.rows.findIndex(row => row.element.field === timeline.document!.tracks[0].keys[0].value!.field));
	editor.commands.execute('animation.details'); editor.commands.execute('animation.edit');
	const valueField = inputFocus.target!, valueText = valueField.textInput!, localUndo = valueField.getCommand('undo');
	assert.equal(valueText.replaceText(0, valueText.readText().text.length, 'invalid +'), true);
	editor.commands.execute('animation.addKey', valueField);
	assert.equal(inputFocus.target, valueField); assert.equal(editor.quickInput.visible, false);
	assert.equal(timeline.workingCopy.buffer.getText(), timelineSource);
	assert.equal(valueText.replaceText(0, valueText.readText().text.length, '2'), true);
	editor.commands.execute('animation.addKey', valueField);
	assert.equal(editor.quickInput.inputBox, true, 'the actual Add Key handler opens its owned value prompt after publishing the old property');
	assert.equal(timeline.document!.tracks[0].keys[0].value!.value, 2);
	assert.equal(valueField.getCommand('undo'), localUndo);
	editor.quickInput.hide(); timeline.workingCopy.undo();
	assert.equal(timeline.workingCopy.buffer.getText(), timelineSource); assert.equal(timeline.workingCopy.undo(), null);
	editor.editorGroup.panes.clearEditor();
	for (const client of [...clients, field, valueField]) for (const command of ['animation.source', 'animation.fit', 'animation.snap', 'animation.addKey', 'animation.addFrame'] as const)
		assert.equal(editor.commands.isEnabled(command, client), false);
});

test('clipboard admission and execution retain the supplied leaf rather than its alias or ambient focus', async t => {
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorGroup.focusScope), selected = new TextField(parent), other = new TextField(parent);
	selected.focusTarget.commandContext = parent;
	setFieldText(selected, 'selected data', true); selectAll(selected);
	setFieldText(other, 'unrelated data', true); selectAll(other); other.focusTarget.focus();
	assert.equal(editor.commands.isEnabled('copy', selected.focusTarget), true);
	editor.commands.execute('copy', selected.focusTarget);
	assert.equal((await editor.clipboard.read()).text, 'selected data');
	assert.equal(selected.text, 'selected data'); assert.equal(other.text, 'unrelated data');
	assert.equal(inputFocus.target, other.focusTarget);
});

test('common runtime commands orchestrate the physical transport and the active view capture latch', t => {
	const { editor, host } = fixture(t);
	const toggle = t.mock.method(editor.commands.transport, 'togglePlayback');
	assert.equal(editor.editorGroup.panes.activePane, null);
	editor.commands.execute('gameView.playback');
	assert.equal(toggle.mock.callCount(), 1, 'the transport operation does not depend on an optional capture view');
	editor.commands.execute('events');
	const pane = editor.editorGroup.panes.activePane!;
	assert.equal(pane.input.kind, 'event_viewer');
	assert.equal(pane.runtimeControlContext!.getCommand('runtime.pause'), undefined, 'a latch is not a partial public command');
	pane.setRuntimeCaptureRunning!(true); host.execution.setPauseReason(HostPauseReason.Requested, false);
	assert.equal(pane.suspendsRuntime, false);
	editor.commands.execute('runtime.pause', pane.runtimeControlContext);
	assert.equal(pane.suspendsRuntime, true); assert.equal(host.execution.userPaused, true);
	editor.commands.execute('gameView.playback', pane.runtimeControlContext);
	assert.equal(pane.suspendsRuntime, false); assert.equal(host.execution.userPaused, false);
	assert.equal(toggle.mock.callCount(), 2);
});

for (const command of ['events', 'gpuDebugger', 'gteDebugger'] as const) test(`${command} reading client owns complete pane actions without a semantic alias lookup`, t => {
	const { editor } = fixture(t); editor.commands.execute(command);
	const pane = editor.editorGroup.panes.activePane!, owner = pane.runtimeControlContext!;
	assert.notEqual(inputFocus.target, owner, 'the actual reading control, not its pane action context, has focus');
	for (const action of ['pause', 'stepFrameBack', 'stepFrame', command === 'events' ? 'events.filter' : command === 'gpuDebugger' ? 'gpu.follow' : 'gte.follow'] as const)
		assert.equal(inputFocus.target!.getCommand(action), owner.getCommand(action), 'the client publishes the actual complete command handler');
	assert.equal(inputFocus.target!.getCommand('runtime.pause'), undefined, 'private capture state is not exposed as a partial public transport command');
});

for (const command of ['events', 'gpuDebugger', 'gteDebugger'] as const) test(`${command} timeline Tab boundaries return to its actual reading client`, t => {
	const { editor } = fixture(t); editor.commands.execute(command); editor.update(0);
	const client = inputFocus.target!;
	assert.notEqual(client, editor.editorGroup.panes.activePane!.runtimeControlContext);
	editor.runtimeTimeline.focus(); assert.equal(inputFocus.moveFocus(true), true);
	assert.ok(inputFocus.target === client, 'Shift+Tab restores the actual reading client');
	editor.runtimeTimeline.focus(); assert.equal(inputFocus.moveFocus(false), true);
	assert.ok(inputFocus.target === client, 'an unavailable history range leaves no intermediate slider stop');
});

test('context menu admission and execution belong to the explicit control, not its semantic command alias or current popup focus', t => {
	const { editor, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('context client'));
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	const parent = inputFocus.createTarget(null, scope), leaf = inputFocus.createTarget(parent), other = inputFocus.createTarget(parent);
	for (const target of [parent, leaf, other]) target.bindKeyboard(() => {});
	leaf.commandContext = parent; other.commandContext = parent;
	let parentMenus = 0, leafMenus = 0, enabled = true;
	parent.registerCommand('contextMenu', { isEnabled: () => true, run: () => { parentMenus++; } });
	leaf.registerCommand('contextMenu', { isEnabled: () => enabled, run: () => { leafMenus++; } });
	other.focus();
	assert.equal(inputFocus.target, other);
	assert.equal(editor.commands.isEnabled('contextMenu', leaf), true);
	editor.commands.execute('contextMenu', leaf);
	assert.equal(leafMenus, 1); assert.equal(parentMenus, 0);
	enabled = false;
	assert.equal(editor.commands.isEnabled('contextMenu', leaf), false);
	editor.commands.execute('contextMenu', leaf);
	assert.equal(leafMenus, 1); assert.equal(parentMenus, 0);
	assert.equal(editor.commands.isEnabled('contextMenu', other), false);
	editor.commands.execute('contextMenu', other);
	assert.equal(leafMenus, 1); assert.equal(parentMenus, 0);
});

test('production dispatcher retains the first surface through all physical buttons; wheel uses its own current hit', t => {
	const { editor, pointer, extent } = fixture(t);
	const calls: string[] = [];
	const boundsA = { left: 30, top: 40, right: 160, bottom: 180 };
	const boundsB = { left: 90, top: 40, right: 240, bottom: 180 };
	const a = editor.surfaces.attach({
		role: 'window', captureScope: Symbol('a'), isVisible: () => true,
		getBounds: () => boundsA, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('a'); }, handleWheel: () => { calls.push('wheel a'); return true; },
	});
	editor.surfaces.attach({
		role: 'window', captureScope: Symbol('b'), isVisible: () => true,
		getBounds: () => boundsB, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('b'); },
	});
	pointer(100, 70, PointerButton.Primary);
	pointer(50, 70, PointerButton.Primary | PointerButton.Secondary);
	pointer(50, 70, PointerButton.Secondary);
	assert.equal(editor.dispatchWheel({ x: 50, y: 70, deltaX: 0, deltaY: 1, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	pointer(50, 70, 0);
	pointer(50, 70, PointerButton.Primary);
	assert.deepEqual(calls, ['b', 'b', 'b', 'wheel a', 'b', 'a']);
	assert.equal(pointerCapture.routeScope, a.captureScope);
});

test('surface capture continues outside canvas; hiding its route drains the hold without retargeting', t => {
	const { editor, pointer, extent } = fixture(t);
	const calls: string[] = [];
	let visible = true;
	const capture = {
		handleCapturedPointer() { calls.push('move'); },
		releaseCapturedPointer() { calls.push('up'); },
		cancelPointer() { calls.push('cancel'); },
	};
	const scope = Symbol('drag window');
	editor.surfaces.attach({
		role: 'window', captureScope: scope, isVisible: () => visible,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: () => { calls.push('down'); pointerCapture.capture(capture); },
	});
	pointer(100, 70, PointerButton.Primary);
	pointer(-100, 70);
	pointer(-100, 70, 0);
	assert.deepEqual(calls, ['down', 'move', 'up']);
	pointer(100, 70, PointerButton.Primary);
	visible = false;
	editor.surfaces.changed();
	assert.equal(pointerCapture.draining, true);
	assert.equal(pointerCapture.routeScope, undefined);
	pointer(100, 70);
	pointer(100, 70, 0);
	assert.deepEqual(calls, ['down', 'move', 'up', 'down', 'cancel']);
	assert.equal(pointerCapture.draining, false);
});

test('real popup and modal sources publish visibility before focus admission and revoke covered hover immediately', async t => {
	const { editor, pointer } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	let leaves = 0;
	const hover = { onPointerLeave() { leaves += 1; } };
	pointerHover.visit(hover);
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(leaves, 1, 'opening a surface revokes lower hover without a pointer movement');
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.contextMenu.pointerScope);
	pointer(10, 200, PointerButton.Primary);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(pointerCapture.draining, true, 'the outside dismiss press cannot reach newly exposed content');
	pointer(10, 200, 0);
	assert.equal(pointerCapture.draining, false);

	editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([{ label: 'one', description: '', detail: '' }]), () => {});
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.quickInput.pointerScope);
	editor.quickInput.hide();
	assert.equal(inputFocus.target, origin);
	const decision = editor.actionPrompt.show(PROMPT_REQUEST);
	assert.equal(editor.actionPrompt.focusTarget.hasFocus, true);
	assert.equal(editor.surfaces.topBlockingSurface?.captureScope, editor.actionPrompt.pointerScope);
	assert.equal(editor.dispatchWheel({ x: 10, y: 200, deltaX: 0, deltaY: 1, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	editor.actionPrompt.close();
	assert.equal(await decision, 'cancel');
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), true);
	assert.equal(inputFocus.target, origin);
});


test('menu presentation follows its invoking window session and retires on owner hide or close', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorGroup.focusScope); tree.bindKeyboard(() => {});
	let visible = true;
	const scope = Symbol('details window');
	const window = editor.surfaces.attach({
		role: 'window', captureScope: scope, isVisible: () => visible, getBounds: () => extent, getClip: () => extent, draw() {},
	});
	const subject = inputFocus.createTarget(tree, new InputFocusScope(scope));
	subject.canFocus = () => window.visible;
	subject.bindKeyboard(() => {});
	subject.focus();
	const lifetime = editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, subject);
	assert.equal(popup.lifetimeOwner, window);
	assert.equal(popup.presentationParent, undefined, 'ordinary window popup promotes past its client clip');
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true, 'session attachment exists before requesting popup focus');
	visible = false;
	editor.surfaces.changed();
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(popup.retired, true);
	assert.equal(lifetime.isDisposed, true);
	assert.equal(editor.surfaces.findByScope(editor.contextMenu.pointerScope), undefined);
	assert.equal(inputFocus.target, tree);

	visible = true;
	editor.surfaces.changed(); subject.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const next = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.notEqual(next, popup, 'replacement is a new attachment, not a stale singleton surface');
	window.dispose();
	assert.equal(next.retired, true);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(inputFocus.target, tree);
});

test('retiring a real window with its property menu focused returns to an admitted owner', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorGroup.focusScope); tree.bindKeyboard(() => {});
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, {
		model: new WorkbenchWindowModel({ left: 20, top: 30, right: 250, bottom: 240 }, 100, 80),
		actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.paneSurface,
		focusReturn: tree, workArea: extent, content: { draw() {} }, layoutContent() {},
		retireContentInput: () => inspector.hide(),
		restoreContentInput: () => inspector.show({ title: 'DETAILS', items: [{ label: 'A', value: 'B', description: '', warning: false }],
			focusReturn: tree, canOpenSource: () => false, openSource() {} }, false),
		focusContent: () => inspector.focusTarget.focus(),
	});
	const inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, window.clientFocusTarget, 'client');
	t.after(() => { window.dispose(); inspector.dispose(); });
	for (const retirement of ['surface', 'detach', 'hide'] as const) {
		window.show(true);
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
		const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
		assert.equal(popup.lifetimeOwner, window.clientSurface);
		assert.equal(inputFocus.target, editor.contextMenu.focusTarget);
		if (retirement === 'surface') window.surface!.dispose();
		else if (retirement === 'detach') window.detach();
		else window.hide();
		assert.equal(window.surface, undefined);
		assert.equal(window.clientSurface, undefined);
		assert.equal(inspector.visible, false);
		assert.equal(editor.contextMenu.visible, false);
		assert.equal(popup.retired, true);
		assert.equal(inputFocus.target, tree, `${retirement} returns focus before its popup ownership is removed`);
		assert.equal(inputFocus.admittedTarget, tree, 'the returned target is eligible under the real root admission policy');
	}
});

test('session popup promotes to its actual root or owner-local modal context, never above the admission boundary', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorGroup.focusScope); tree.bindKeyboard(() => {}); tree.focus();
	const rootScope = Symbol('root modal');
	const root = editor.surfaces.attach({
		role: 'modal', blockedScope: null, captureScope: rootScope,
		isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
	});
	const rootTarget = inputFocus.createTarget(tree, new InputFocusScope(rootScope));
	rootTarget.canFocus = () => root.visible;
	rootTarget.bindKeyboard(() => {}); rootTarget.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const rootPopup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(rootPopup.lifetimeOwner, root);
	assert.equal(rootPopup.presentationParent, root);
	assert.equal(editor.surfaces.isAdmitted(rootPopup), true);
	assert.equal(editor.surfaces.hitTest(10, 200), rootPopup);
	editor.contextMenu.hide();
	assert.equal(inputFocus.target, rootTarget);
	root.dispose(); tree.focus();

	const localScope = Symbol('owner-local modal');
	const local = editor.surfaces.attach({
		role: 'modal', blockedScope: editor.paneSurface, lifetimeOwner: editor.paneSurface, captureScope: localScope,
		isVisible: () => true, getBounds: editor.paneSurface.getBounds, getClip: editor.paneSurface.getClip, draw() {},
	});
	const localTarget = inputFocus.createTarget(tree, new InputFocusScope(localScope));
	localTarget.canFocus = () => local.visible;
	localTarget.bindKeyboard(() => {}); localTarget.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const localPopup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(localPopup.lifetimeOwner, local);
	assert.equal(localPopup.presentationParent, local);
	assert.equal(editor.surfaces.isAdmitted(localPopup), true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	assert.equal(editor.surfaces.hitTest(100, 200), localPopup);
	assert.notEqual(editor.surfaces.hitTest(2, 2), localPopup, 'an owner-local popup does not block root chrome');
	local.dispose();
	assert.equal(localPopup.retired, true);
	assert.equal(editor.contextMenu.visible, false);
});

test('menu invocation without focused content has an explicit root-chrome lifetime owner', t => {
	const { editor } = fixture(t);
	inputFocus.setTarget(null);
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, null);
	assert.equal(popup.lifetimeOwner?.captureScope, editor.resourcePanel.focusTarget.scope.surfaceScope);
	assert.equal(popup.presentationParent, undefined);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
});


test('actual Quick Input and action prompt retain their modal lifetime while their session-owned menu has focus', async t => {
	const { editor } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([{ label: 'one', description: '', detail: '' }]), () => {});
	const picker = editor.surfaces.findByScope(editor.quickInput.pointerScope)!;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const pickerMenu = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.quickInput.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(pickerMenu.lifetimeOwner, picker);
	assert.equal(pickerMenu.presentationParent, picker);
	assert.equal(editor.surfaces.isAdmitted(pickerMenu), true);
	editor.contextMenu.hide();
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	assert.equal(editor.quickInput.visible, true);
	editor.quickInput.hide();

	const decision = editor.actionPrompt.show(PROMPT_REQUEST);
	const prompt = editor.surfaces.findByScope(editor.actionPrompt.pointerScope)!;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const promptMenu = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.actionPrompt.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(promptMenu.presentationParent, prompt);
	assert.equal(promptMenu.lifetimeOwner, prompt);
	assert.equal(editor.surfaces.isAdmitted(promptMenu), true);
	editor.contextMenu.hide();
	assert.equal(editor.actionPrompt.focusTarget.hasFocus, true);
	assert.equal(editor.actionPrompt.visible, true);
	editor.actionPrompt.close();
	assert.equal(await decision, 'cancel');
	assert.equal(inputFocus.target, origin);
});

test('the actual lightbox keeps its property popup inside the pane admission context and retires it on close', t => {
	const { editor } = fixture(t);
	const cache = new ImagePreviewCache(async () => ({ width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 255]) }));
	const preview = new ImagePreviewOverlay(cache, editor.surfaces, editor.paneSurface, editor.commands);
	preview.layout(editor.paneSurface.getBounds(), editorViewState.lineHeight);
	t.after(() => { preview.dispose(); cache.dispose(); });
	preview.open('fixture:image');
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(preview.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(popup.lifetimeOwner, preview.surface);
	assert.equal(popup.presentationParent, preview.surface);
	assert.equal(editor.surfaces.isInContext(popup.captureScope, preview.surface.captureScope), true);
	assert.equal(editor.surfaces.isAdmitted(editor.paneSurface), false);
	preview.close();
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(popup.retired, true);
	assert.equal(editor.surfaces.findByScope(editor.contextMenu.pointerScope), undefined);
});


test('a newly shown menu accepts the next native row click before any workbench update', t => {
	const { editor, pointer } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	let actions = 0;
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], {
		isEnabled: () => true, execute: () => { actions += 1; },
	});
	const model = editor.contextMenu.model;
	assert.ok(model.bounds.right > model.bounds.left);
	assert.ok(model.rows[0].bottom > model.rows[0].top);
	const x = model.viewport.bounds.left + 8;
	const y = model.viewport.offsetTop + model.rows[0].top + 2;
	pointer(x, y, PointerButton.Primary);
	pointer(x, y, 0);
	assert.equal(actions, 1);
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(inputFocus.target, origin);
});

test('editor input retirement cancels its actual prompt and picker sessions without restoring the detached guest', async t => {
	const { editor, host } = fixture(t);
	const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	t.after(() => remote.release());
	for (const kind of ['prompt', 'picker']) {
		const game = new GameViewInput();
		editor.editorGroup.panes.openEditor(game);
		const bounds = game.frameBounds;
		remote.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
			{ type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
		const origin = inputFocus.target!;
		assert.ok(origin.guestInput, 'the actual game view input control invoked the session');
		const decision = kind === 'prompt' ? editor.actionPrompt.show(PROMPT_REQUEST) : undefined;
		if (kind === 'picker') editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([
			{ label: 'one', description: '', detail: '' },
		]), () => {});
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
		assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
		editor.editorGroup.panes.openEditor(new HostErrorInput('replacement'));
		assert.equal(editor.actionPrompt.visible, false);
		assert.equal(editor.quickInput.visible, false);
		assert.equal(editor.contextMenu.visible, false, 'retirement also removes the source-owned popup');
		assert.equal(inputFocus.target?.guestInput, undefined);
		assert.notEqual(inputFocus.target, origin);
		if (decision !== undefined) assert.equal(await decision, 'cancel');
	}
});

test('clearing an editor preserves root-origin and other live-owner modal sessions', async t => {
	const { editor, extent } = fixture(t);
	const windowScope = new InputFocusScope(Symbol('other owner'));
	const window = editor.surfaces.attach({ role: 'window', captureScope: windowScope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	const other = inputFocus.createTarget(null, windowScope); other.bindKeyboard(() => {});
	const chrome = inputFocus.createTarget(null, editor.resourcePanel.focusTarget.scope); chrome.bindKeyboard(() => {});
	for (const owner of [null, chrome, other]) {
		for (const kind of ['prompt', 'picker']) {
			editor.editorGroup.panes.openEditor(new HostErrorInput('existing'));
			inputFocus.setTarget(owner);
			const decision = kind === 'prompt' ? editor.actionPrompt.show(PROMPT_REQUEST) : undefined;
			if (kind === 'picker') editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([
				{ label: 'one', description: '', detail: '' },
			]), () => {});
			const sessionFocus = inputFocus.target;
			editor.editorGroup.panes.clearEditor();
			assert.equal(editor.actionPrompt.visible, kind === 'prompt');
			assert.equal(editor.quickInput.visible, kind === 'picker');
			assert.ok(inputFocus.target === sessionFocus, 'pane retirement does not steal an independent surface focus');
			if (decision !== undefined) { editor.actionPrompt.close(); assert.equal(await decision, 'cancel'); }
			else editor.quickInput.hide();
			assert.equal(inputFocus.target, owner);
		}
	}
	window.dispose();
});

test('a blocked retained focus or a root modal without focus cannot dispatch root keyboard commands', t => {
	const { editor, extent } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	const modal = editor.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('focusless modal'),
		isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {} });
	assert.equal(inputFocus.target, origin);
	assert.equal(inputFocus.admittedTarget, null);
	for (const focus of [origin, null]) {
		if (focus === null) inputFocus.setTarget(null);
		const key = new KeyInputEvent('F10', KeyModifier.none);
		assert.equal(editor.dispatchKey(key), true);
		assert.equal(key.consumed, true);
		assert.equal(editor.contextMenu.visible, false);
	}
	modal.dispose();
});

test('native remote paste reaches the admitted Quick Input field before modal keyboard delegation', async t => {
	const { editor, host } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	editor.quickInput.pick('Find actor', '', () => new TextQuickPickProvider([
		{ label: 'player', description: '', detail: '' }, { label: 'enemy', description: '', detail: '' },
	]), () => {});
	assert.equal(editor.quickInput.model.list.rows.length, 2);
	await editor.clipboard.writeText('enemy');
	const remote = new RemoteInput(host.input, host.clock, host.input.dispatchEditingKey.bind(host.input));
	remote.apply([{ type: 'key', code: 'ControlLeft', down: true }, { type: 'key', code: 'KeyV', down: true },
		{ type: 'key', code: 'KeyV', down: false }, { type: 'key', code: 'ControlLeft', down: false }]);
	await Promise.resolve();
	assert.equal(editor.quickInput.field.text, 'enemy');
	assert.equal(editor.quickInput.model.list.rows.length, 1);
	assert.equal(editor.quickInput.model.list.rows[0].itemIndex, 1);
	assert.equal(editor.quickInput.field.focusTarget.hasFocus, true);
	remote.release();
});

test('a toolbar menu uses its explicit tree invocation for lifetime and commands while restoring inspector focus', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorGroup.focusScope); tree.bindKeyboard(() => {});
	const windowScope = new InputFocusScope(Symbol('inspector'));
	const window = editor.surfaces.attach({ role: 'window', captureScope: windowScope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	const inspector = inputFocus.createTarget(tree, windowScope); inspector.bindKeyboard(() => {});
	let invocations = 0;
	tree.registerCommand('actorLab.find', { isEnabled: () => true, run: () => { invocations += 1; } });
	inspector.registerCommand('actorLab.find', { isEnabled: () => false, run: () => { throw new Error('wrong command owner'); } });
	inspector.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'actorLab.find' }], editor.commands,
		{ selectFirst: true, invocationOrigin: tree });
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(editor.contextMenu.invocationOrigin, tree);
	assert.equal(popup.lifetimeOwner, editor.paneSurface);
	assert.equal(editor.contextMenu.focusTarget.commandContext, tree);
	assert.equal(editor.contextMenu.model.rows[0].enabled, true);
	editor.contextMenu.accept();
	assert.equal(invocations, 1, 'command execution retains the explicit origin after restoring a different focus');
	assert.equal(inputFocus.target, inspector);
	window.dispose();
});

test('routed guest gesture survives UI overlap, focus changes, extra buttons and motion outside canvas', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds);
	let paneOccurrences = 0, windowOccurrences = 0;
	editor.surfaces.attach({
		role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: snapshot => { paneOccurrences += 1; game.handlePointer(snapshot); },
	});
	const windowBounds = { left: 180, top: 80, right: 260, bottom: 180 };
	editor.surfaces.attach({
		role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => windowBounds, getClip: () => extent, draw() {},
		handlePointer: () => { windowOccurrences += 1; },
	});
	const snapshot = createInputControllerSnapshot();
	const sample = () => host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	pointer(150, 150, PointerButton.Primary);
	assert.equal(game.focusTarget.hasFocus, true);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(64));
	pointer(200, 150, PointerButton.Primary | PointerButton.Secondary);
	owner.focus(); // keyboard and pointer ownership intentionally diverge
	sample(); assert.equal(snapshot.pointerButtons, 5);
	pointer(-100, 400, PointerButton.Secondary);
	sample(); assert.equal(snapshot.pointerButtons, 4);
	assert.equal(snapshot.pointerXQ16, 0);
	assert.equal(snapshot.pointerYQ16, encodeSignedFix16(211));
	pointer(200, 150, 0);
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(windowOccurrences, 0, 'the covered window gets neither an orphan release nor another button');
	assert.equal(paneOccurrences, 1, 'captured guest motion does not run tree or preview picking');
	pointer(200, 150, PointerButton.Primary);
	assert.equal(windowOccurrences, 1, 'after all-up the topmost surface wins again');
	game.dispose();
});

test('UI gesture cannot migrate into a guest and explicit viewport retirement drains a guest hold', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds); game.focusTarget.focus();
	let uiOccurrences = 0;
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } });
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => ({ left: 180, top: 80, right: 260, bottom: 180 }), getClip: () => extent, draw() {},
		handlePointer: () => { uiOccurrences += 1; } });
	const snapshot = createInputControllerSnapshot();
	const sample = () => host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	pointer(200, 150, PointerButton.Primary);
	pointer(150, 150);
	pointer(150, 150, 0);
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(uiOccurrences, 3);
	pointer(150, 150, PointerButton.Primary);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	game.clearInput();
	sample(); assert.equal(snapshot.pointerButtons, 0);
	assert.equal(pointerCapture.draining, true);
	game.setInput(bounds); game.focusTarget.focus();
	pointer(150, 150, PointerButton.Primary | PointerButton.Auxiliary);
	sample(); assert.equal(snapshot.pointerButtons, 0, 'new buttons during the interrupted hold are drained too');
	pointer(150, 150, 0);
	pointer(150, 150, PointerButton.Primary);
	sample(); assert.equal(snapshot.pointerButtons, 1);
	game.dispose();
});

test('wheel routes the current exposed preview independently of a captured pointer recipient', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const first = new InputChannel(host.input), second = new InputChannel(host.input);
	t.after(() => { first.dispose(); second.dispose(); });
	const scope = new InputFocusScope(Symbol('previews'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const firstGame = new GameInputControl(owner, first, { kind: 'direct', presenter: host.presenter });
	const secondGame = new GameInputControl(owner, second, { kind: 'direct', presenter: host.presenter });
	firstGame.setInput({ left: 20, top: 60, right: 170, bottom: 240 });
	secondGame.setInput({ left: 200, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {},
		handlePointer: snapshot => { firstGame.handlePointer(snapshot); secondGame.handlePointer(snapshot); }, handleWheel: () => false });
	let covered = false;
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('cover'), isVisible: () => covered,
		getBounds: () => extent, getClip: () => extent, draw() {} });
	pointer(95, 150, PointerButton.Primary);
	secondGame.focusTarget.focus();
	assert.equal(editor.dispatchWheel({ x: 275, y: 150, deltaX: 0, deltaY: 3, attachmentDeltaY: 1,
		modifiers: KeyModifier.none, timestamp: 0 }), true);
	covered = true; editor.surfaces.changed();
	editor.dispatchWheel({ x: 275, y: 150, deltaX: 0, deltaY: 6, attachmentDeltaY: 2,
		modifiers: KeyModifier.none, timestamp: 0 });
	host.input.pollInput();
	const snapshot = createInputControllerSnapshot();
	first.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 1);
	assert.equal(snapshot.pointerWheelQ16, 0);
	second.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(1));
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(128));
	pointer(400, 300, 0);
	firstGame.dispose(); secondGame.dispose();
});


test('actual activation drains the producer hold established in player mode, including additional buttons before all-up', t => {
	const source = 'return 42';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'activation.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'activation.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'activation', type: 'lua', src: source, base_src: source,
		source_path: 'activation.lua', normalized_source_path: 'activation.lua', module_path: 'activation',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const { editor, host, extent } = fixture(t, { image, registry });
	const calls: number[] = [];
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('new input owner'), isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { calls.push(snapshot.justPressedButtons); } });
	editorRuntimeState.active = false;
	host.input.setPointerAdmissionMode('physical');
	const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	assert.equal(host.input.pointerButtonsDown, true, 'the hold is known before any host poll');
	assert.equal(pointerCapture.routeScope, undefined);
	editor.activate();
	assert.equal(editor.isActive, true);
	assert.equal(pointerCapture.draining, true);
	remote.apply([{ type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'primary', down: false },
		{ type: 'button', button: 'primary', down: true }]);
	assert.deepEqual(calls, []);
	remote.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false },
		{ type: 'button', button: 'primary', down: true }]);
	assert.deepEqual(calls, [PointerButton.Primary]);
	editor.activate();
	assert.equal(pointerCapture.draining, false, 'reactivating an already active editor does not cancel its own gesture');
	remote.release();
});

test('host-exclusive reentry drains unseen source holds, while actual source loss admits the first fresh gesture', t => {
	const { editor, host, extent } = fixture(t);
	const ui = new HostUiInput(host.input, host.presenter);
	const calls: number[] = [];
	editor.surfaces.attach({ role: 'window', captureScope: Symbol('window'), isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { calls.push(snapshot.justPressedButtons); } });
	let remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	host.input.setForegroundInput(ui, true);
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	host.input.setForegroundInput(ui, false);
	assert.equal(pointerCapture.draining, true);
	remote.apply([{ type: 'button', button: 'aux', down: true }]);
	assert.deepEqual(calls, []);
	remote.release();
	assert.equal(pointerCapture.draining, false, 'explicit producer cancellation ends the cancelled hold without a synthetic release');

	for (const device of ['pointer:0', undefined]) {
		remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		calls.length = 0;
		host.input.resetInput(device);
		assert.equal(host.input.pointerButtonsDown, false);
		assert.equal(pointerCapture.routeScope, undefined);
		assert.equal(pointerCapture.draining, false, 'the source has already reset when the route is interrupted');
		remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		assert.equal(calls[calls.length - 1], PointerButton.Primary, 'the first fresh press after native blur/reset is not swallowed');
		remote.release();
	}
});

test('native producer cancellation ends a routed guest hold without a successful release or blocking the next fresh press', t => {
	const { editor, host, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('guest'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	game.setInput({ left: 20, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope, isVisible: () => true,
		getBounds: () => extent, getClip: () => extent, draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } });
	const snapshot = createInputControllerSnapshot();
	let remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true },
		{ type: 'button', button: 'secondary', down: true }]);
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 5);
	remote.release();
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(pointerCapture.routeScope, undefined);
	assert.equal(pointerCapture.guestBinding, undefined);
	assert.equal(pointerCapture.draining, false);
	remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
	remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
	host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 1);
	remote.release(); game.dispose();
});

test('resetting one registered pointer producer retains another producer hold in the canonical admission drain', t => {
	const { host } = fixture(t);
	host.input.connectInputDevice({ id: 'pointer:1', kind: 'pointer' });
	host.input.inputButton('pointer:0', 'pointer_primary', true, 1, 0, 1);
	host.input.inputButton('pointer:1', 'pointer_secondary', true, 1, 0, 2);
	host.input.resetInput('pointer:0');
	assert.equal(host.input.pointerButtonsDown, true);
	assert.equal(pointerCapture.draining, true);
	host.input.resetInput('pointer:1');
	assert.equal(host.input.pointerButtonsDown, false);
	assert.equal(pointerCapture.draining, false);
});


test('real window hide and root-modal admission cancel true producer guest holds and drain all remaining buttons', async t => {
	const { editor, host, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorGroup.focusScope); tree.bindKeyboard(() => {});
	const model = new WorkbenchWindowModel({ left: 30, top: 40, right: 350, bottom: 260 }, 100, 80);
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.paneSurface,
		focusReturn: tree, workArea: extent,
		content: { draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } },
		layoutContent: bounds => game.setInput(bounds), retireContentInput: () => game.clearInput(),
		restoreContentInput: () => game.setInput(model.client), focusContent: () => game.focusTarget.focus(),
	});
	const game = new GameInputControl(window.clientFocusTarget, host.input, { kind: 'direct', presenter: host.presenter });
	const show = () => { window.show(false); window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); game.focusTarget.focus(); };
	t.after(() => { game.dispose(); window.dispose(); });
	show();
	const snapshot = createInputControllerSnapshot();
	const sample = () => { host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal); return snapshot.pointerButtons; };
	for (const action of ['hide', 'modal']) {
		const remote = new RemoteInput(host.input, host.clock, undefined, event => editor.dispatchPointer(event));
		remote.apply([{ type: 'pointer', x: 150, y: 150 }, { type: 'button', button: 'primary', down: true }]);
		assert.equal(sample(), 1);
		if (action === 'hide') { window.hide(); show(); }
		else { const decision = editor.actionPrompt.show(PROMPT_REQUEST); editor.actionPrompt.close(); await decision; }
		assert.equal(sample(), 0);
		assert.equal(pointerCapture.draining, true);
		remote.apply([{ type: 'button', button: 'secondary', down: true }]);
		assert.equal(sample(), 0, 'a new button in the interrupted producer hold cannot acquire another route');
		remote.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false },
			{ type: 'button', button: 'primary', down: true }]);
		assert.equal(sample(), 1);
		remote.release();
	}
});

test('retiring the press owner cannot admit that occurrence to a replacement viewport, even for a complete short click', t => {
	const { editor, host, pointer, extent } = fixture(t);
	const scope = new InputFocusScope(Symbol('replaced preview'));
	const owner = inputFocus.createTarget(null, scope); owner.bindKeyboard(() => {});
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter });
	game.setInput(extent);
	const snapshot = createInputControllerSnapshot();
	for (const shortClick of [false, true]) {
		let replacement: ReturnType<typeof editor.surfaces.attach>;
		const original = editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope,
			isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
			onRetire: () => pointerCapture.cancelScope(scope.surfaceScope),
			handlePointer: () => {
				original.dispose();
				replacement = editor.surfaces.attach({ role: 'content', captureScope: scope.surfaceScope,
					isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
					handlePointer: event => { game.handlePointer(event); },
					onRetire: () => pointerCapture.cancelScope(scope.surfaceScope) });
				game.focusTarget.focus();
			},
		});
		if (shortClick) editor.dispatchPointer({ x: 100, y: 100, buttons: 0, pressedButtons: PointerButton.Primary,
			releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 });
		else pointer(100, 100, PointerButton.Primary);
		host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		assert.equal(snapshot.pointerButtons, 0, 'the retired owner consumes its press rather than creating a replacement gesture');
		pointer(100, 100, 0);
		pointer(100, 100, PointerButton.Primary);
		host.input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		assert.equal(snapshot.pointerButtons, 1, 'the replacement admits only a genuinely new press');
		pointer(100, 100, 0);
		replacement!.dispose(); game.focusTarget.release();
	}
	game.dispose();
});

test('actual menu tab commands retain their invoking group and retired origins never retarget the main group', t => {
	const { editor, extent } = fixture(t);
	const group = createTestEditorGroup(editor.commands);
	const surface = editor.surfaces.attach({ role: 'content', captureScope: group.captureScope,
		getBounds: () => extent, getClip: () => extent, isVisible: () => true, draw() {} });
	const mainInputs = [...editor.editorGroup.model.tabs], mainActive = editor.editorGroup.model.activeTab;
	const first = new HostErrorInput('first'), second = new GameViewInput();
	let origin!: InputFocusTarget;
	try {
		group.openEditor(first); group.openEditor(second);
		origin = inputFocus.target!;
		editor.editorGroup.panes.activePane?.focus();
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'tabs.next' }], editor.commands,
			{ selectFirst: true, invocationOrigin: origin });
		assert.equal(editor.contextMenu.model.rows[0].enabled, true);
		editor.contextMenu.accept();
		assert.equal(group.model.activeTab, first);
		assert.equal(editor.editorGroup.model.activeTab, mainActive);
		assert.deepEqual(editor.editorGroup.model.tabs, mainInputs);
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'tabs.close' }], editor.commands,
			{ selectFirst: true, invocationOrigin: origin });
		editor.contextMenu.accept();
		assert.deepEqual(group.model.tabs, [second]);
		assert.equal(editor.editorGroup.model.activeTab, mainActive);
	} finally { group.dispose(); surface.dispose(); }
	assert.equal(editor.commands.isEnabled('tabs.close', origin), false);
	assert.equal(editor.commands.isEnabled('tabs.next', origin), false);
	editor.commands.execute('tabs.close', origin);
	editor.commands.execute('tabs.next', origin);
	assert.equal(editor.editorGroup.model.activeTab, mainActive);
	assert.deepEqual(editor.editorGroup.model.tabs, mainInputs);
});
