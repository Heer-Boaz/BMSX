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
import { InputInteraction } from '../../ide/input/interaction';
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
import { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostExecutionControl } from '../../hosts/common/execution_control';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { HostRewind } from '../../hosts/common/rewind';
import { createRuntimeDebuggerState } from '../../ide/runtime/debugger_state';
import { RuntimeDebuggerExecution } from '../../ide/runtime/debugger_execution';
import { RuntimeFrameNavigation } from '../../ide/runtime/frame_navigation';
import { createRuntimeFaultState } from '../../ide/runtime/fault_state';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { PlayHandle } from '../../ide/workbench/services/play/service';
import { PlayEditorInput } from '../../ide/workbench/contrib/play/editor_input';
import { performHotResume, performReboot } from '../../ide/commands/actions';
import type { EditorActionRequest } from '../../ide/commands/action_request';
import type { BootOperation, BootResult } from '../../ide/workbench/services/execution/boot';
import type { HotResumeAdmissionResult, HotResumeOperation, HotResumeResult } from '../../ide/workbench/services/execution/hot_resume';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
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
	editor.interaction.setActive(true);
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
	f.editor.editorParts.main.activeGroup.openEditor(input); f.editor.update(0);
	const pane = f.editor.editorParts.main.activeGroup.panes.activePane;
	assert.ok(pane instanceof ActorLabEditorPane);
	return { ...f, controller, input, pane, sourceModel };
}

for (const button of [PointerButton.Primary, PointerButton.Secondary]) test(`Actor row button ${button} admits the exact live subject and contextual action owner`, t => {
	const { editor, pointer, input, pane, controller } = actorFixture(t);
	const primary = pane.commandTarget, index = input.outline.rows.findIndex(row => row.element.node.kind === 'state');
	assert.ok(index >= 0);
	const subject = input.outline.rows[index].element.node;
	editor.commands.execute('resources.focus', primary); editor.update(0);
	assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	assert.ok(inputFocus.admittedTarget !== primary);
	pointer(input.outline.layout.contentRight - 4, input.outline.layout.contentTop + (index + 0.5) * input.outline.layout.rowHeight, button);
	assert.ok(controller.selected(input) === subject);
	assert.equal(editor.contextMenu.visible, button === PointerButton.Secondary);
	if (button === PointerButton.Secondary) assert.ok(editor.contextMenu.invocationOrigin === primary);
});

for (const button of [PointerButton.Primary, PointerButton.Secondary]) for (const destination of ['files', 'editor'] as const) test(`Actor row button ${button} cancels its old subject after focus admits ${destination}`, t => {
	const { editor, host, pointer, input, pane, controller, sourceModel } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	const primary = pane.commandTarget, selected = controller.selected(input), path = input.selectionPath;
	const index = input.outline.rows.findIndex(row => row.element.node.kind === 'state');
	assert.ok(index >= 0 && input.outline.rows[index].element.node !== selected);
	const source = sourceModel.buffer.getText(), version = sourceModel.version, cycles = host.runtime.machine.scheduler.currentNowCycles();
	editor.commands.execute('resources.focus', primary); editor.update(0);
	assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	assert.ok(inputFocus.admittedTarget !== primary);
	let admissions = 0, replacement: GameViewInput | undefined;
	t.after(primary.onDidFocus(() => {
		admissions++;
		if (destination === 'files') editor.commands.execute('resources.focus', primary);
		else { replacement = new GameViewInput(); group.openEditor(replacement); }
	}));
	pointer(input.outline.layout.contentRight - 4, input.outline.layout.contentTop + (index + 0.5) * input.outline.layout.rowHeight, button);
	assert.equal(admissions, 1);
	assert.ok(controller.selected(input) === selected && input.selectionPath === path);
	assert.equal(editor.contextMenu.visible, false);
	if (destination === 'files') {
		assert.ok(editor.resourcePanel.isVisible() && inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
		assert.ok(group.panes.activePane === pane && pane.input === input);
	} else {
		assert.ok(group.model.activeTab === replacement && group.panes.activePane?.input === replacement);
		assert.ok(inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
	}
	assert.equal(sourceModel.buffer.getText(), source); assert.equal(sourceModel.version, version);
	assert.equal(host.runtime.machine.scheduler.currentNowCycles(), cycles);
});

for (const button of [PointerButton.Primary, PointerButton.Secondary]) for (const destination of ['files', 'editor'] as const) test(`Actor graph button ${button} cancels stale shared-control mutation after focus admits ${destination}`, t => {
	const { editor, pointer, input, pane } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0);
	const graph = input.stateGraph!, primary = pane.commandTarget;
	editor.commands.execute('resources.focus', primary); editor.update(0);
	assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	const selected = graph.viewport.selection, offered = graph.viewport.model.nodes.find(node => node !== selected)!;
	assert.ok(selected !== null && offered !== undefined);
	graph.viewport.reveal(offered);
	const x = graph.viewport.graphToViewportX((offered.bounds.left + offered.bounds.right) / 2);
	const y = graph.viewport.graphToViewportY((offered.bounds.top + offered.bounds.bottom) / 2);
	assert.ok(graph.viewport.hitTest(x, y) === offered);
	let admissions = 0, replacement: GameViewInput | undefined;
	t.after(primary.onDidFocus(() => {
		admissions++;
		if (destination === 'files') editor.commands.execute('resources.focus', primary);
		else { replacement = new GameViewInput(); group.openEditor(replacement); }
	}));
	pointer(x, y, button);
	assert.equal(admissions, 1);
	assert.ok(graph.viewport.selection === selected, 'the shared graph control cannot mutate its old selection after rejected focus');
	assert.equal(editor.contextMenu.visible, false); assert.equal(pointerCapture.active, false);
	if (destination === 'files') {
		assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
		assert.ok(group.panes.activePane === pane && pane.input === input);
	} else {
		assert.ok(group.model.activeTab === replacement && group.panes.activePane?.input === replacement);
		assert.ok(inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
	}
});

test('Actor outline selection publication ignores semantic reselection and passive refresh', t => {
	const { editor, input, controller } = actorFixture(t);
	let publications = 0; t.after(input.onDidChangeSelection(() => { publications++; }));
	input.rememberSelection(); controller.refresh(input); editor.update(0);
	assert.equal(publications, 0);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	assert.equal(publications, 1); const path = input.selectionPath;
	input.rememberSelection();
	assert.equal(publications, 1); assert.ok(input.selectionPath === path);
});

test('Actor outline keyboard navigation stops its old layout when selection publication replaces the pane', t => {
	const { editor, input, pane } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	pane.focus(); const replacement = new GameViewInput(); let publications = 0;
	const unbind = input.onDidChangeSelection(() => { unbind(); publications++; group.openEditor(replacement); }); t.after(unbind);
	editor.dispatchKey(new KeyInputEvent('ArrowDown', KeyModifier.none));
	editor.dispatchKey(new KeyInputEvent('ArrowDown', KeyModifier.none, false, false));
	assert.equal(publications, 1);
	assert.ok(group.model.activeTab === replacement && inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
});

for (const button of [PointerButton.Primary, PointerButton.Secondary]) for (const destination of ['files', 'editor', 'selection'] as const) test(`Actor outline button ${button} stops its old continuation after selection publication admits ${destination}`, t => {
	const { editor, pointer, input, pane } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	const primary = pane.commandTarget, selected = input.outline.rows[input.outline.selectionIndex];
	const index = input.outline.rows.findIndex(row => row !== selected && (button === PointerButton.Primary ? row.children.length > 0 && !row.collapsed : row.element.node.kind === 'state'));
	assert.ok(index >= 0); const offered = input.outline.rows[index], collapsed = offered.collapsed;
	const newerIndex = input.outline.rows.findIndex(row => row !== offered), newer = input.outline.rows[newerIndex];
	assert.ok(newer !== undefined);
	let publications = 0, replacement: GameViewInput | undefined;
	const unbind = input.onDidChangeSelection(() => {
		unbind(); publications++; assert.ok(input.outline.rows[input.outline.selectionIndex] === offered);
		if (destination === 'files') editor.commands.execute('resources.focus', primary);
		else if (destination === 'editor') { replacement = new GameViewInput(); group.openEditor(replacement); }
		else { input.outline.selectionIndex = newerIndex; input.rememberSelection(); }
	});
	t.after(unbind);
	const tree = input.outline.layout;
	const x = button === PointerButton.Primary ? tree.contentLeft + offered.depth * tree.indentWidth + tree.twistieWidth / 2 : tree.contentRight - 4;
	pointer(x, tree.contentTop + (index + 0.5) * tree.rowHeight, button);
	assert.equal(publications, 1); assert.equal(editor.contextMenu.visible, false);
	assert.equal(offered.collapsed, collapsed, 'a selection subscriber can retire the original disclosure continuation');
	if (destination === 'files') assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	else if (destination === 'editor') assert.ok(group.model.activeTab === replacement && inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
	else assert.ok(input.outline.rows[input.outline.selectionIndex] === newer && inputFocus.admittedTarget === primary);
});

for (const gesture of ['context', 'activate'] as const) for (const destination of ['files', 'editor', 'selection'] as const) test(`Actor graph ${gesture} stops its old continuation after selection publication admits ${destination}`, t => {
	const { editor, pointer, input, pane } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0);
	const graph = input.stateGraph!, primary = pane.commandTarget, selected = graph.viewport.selection;
	assert.ok(selected?.kind === 'node');
	const offered = graph.viewport.model.nodes.find(node => node !== selected)!; assert.ok(offered !== undefined);
	graph.viewport.reveal(offered);
	const x = graph.viewport.graphToViewportX((offered.bounds.left + offered.bounds.right) / 2);
	const y = graph.viewport.graphToViewportY((offered.bounds.top + offered.bounds.bottom) / 2);
	assert.ok(graph.viewport.hitTest(x, y) === offered);
	if (gesture === 'activate') {
		pointer(x, y, PointerButton.Primary); pointer(x, y, 0);
		assert.ok(graph.viewport.selection === offered); assert.ok(graph.selectTarget(selected.target));
	}
	let publications = 0, replacement: GameViewInput | undefined;
	const unbind = graph.onDidChangeSelection(() => {
		unbind(); publications++; assert.ok(graph.viewport.selection === offered);
		if (destination === 'files') editor.commands.execute('resources.focus', primary);
		else if (destination === 'editor') { replacement = new GameViewInput(); group.openEditor(replacement); }
		else assert.ok(graph.selectTarget(selected.target));
	});
	t.after(unbind);
	pointer(x, y, gesture === 'context' ? PointerButton.Secondary : PointerButton.Primary);
	assert.equal(publications, 1); assert.equal(editor.contextMenu.visible, false); assert.equal(input.detailsWindow.open, false);
	if (destination === 'files') assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	else if (destination === 'editor') assert.ok(group.model.activeTab === replacement && inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
	else assert.ok(graph.viewport.selection === selected && inputFocus.admittedTarget === primary);
});

for (const presentation of ['outline', 'graph'] as const) test(`Actor ${presentation} menu handoff cannot retarget Details after return focus changes the selected member`, t => {
	const { editor, pointer, input, pane } = actorFixture(t);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	if (presentation === 'graph') { editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0); }
	const primary = pane.commandTarget;
	if (presentation === 'outline') {
		const tree = input.outline;
		pointer(tree.layout.contentRight - 4, tree.layout.contentTop + (tree.selectionIndex + 0.5) * tree.layout.rowHeight, PointerButton.Secondary);
	} else {
		const view = input.stateGraph!.viewport, selected = view.selection!;
		pointer(view.graphToViewportX((selected.bounds.left + selected.bounds.right) / 2),
			view.graphToViewportY((selected.bounds.top + selected.bounds.bottom) / 2), PointerButton.Secondary);
	}
	assert.equal(editor.contextMenu.visible, true);
	editor.contextMenu.model.selectedIndex = editor.contextMenu.model.rows.findIndex(row => row.command === 'actorLab.details');
	assert.ok(editor.contextMenu.model.selectedIndex >= 0 && editor.contextMenu.model.rows[editor.contextMenu.model.selectedIndex].enabled);
	let returned = 0;
	const unbind = primary.onDidFocus(() => {
		unbind(); returned++;
		if (presentation === 'outline') { input.outline.selectionIndex = 0; input.rememberSelection(); }
		else {
			const graph = input.stateGraph!, other = graph.viewport.model.nodes.find(node => node !== graph.viewport.selection)!;
			graph.viewport.selection = other; graph.rememberSelection();
		}
	});
	t.after(unbind);
	editor.contextMenu.accept();
	assert.equal(returned, 1); assert.equal(editor.contextMenu.visible, false);
	assert.equal(input.detailsWindow.open, false, 'an accepted old-subject action cannot run against the newly selected member');
	assert.ok(inputFocus.admittedTarget === primary);
});

test('retiring Actor menu subject cannot dismiss a newer popup owned by Files during handoff', t => {
	const { editor, pointer, input, pane } = actorFixture(t), primary = pane.commandTarget;
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	const tree = input.outline;
	pointer(tree.layout.contentRight - 4, tree.layout.contentTop + (tree.selectionIndex + 0.5) * tree.layout.rowHeight, PointerButton.Secondary);
	editor.contextMenu.model.selectedIndex = editor.contextMenu.model.rows.findIndex(row => row.command === 'actorLab.details');
	assert.ok(editor.contextMenu.visible && editor.contextMenu.model.selectedIndex >= 0);
	let returned = 0;
	const unbind = primary.onDidFocus(() => {
		unbind(); returned++;
		editor.commands.execute('resources.focus', primary);
		editor.contextMenu.show(0, 0, [{ type: 'command', command: 'resources.focus' }], editor.commands,
			{ invocationOrigin: editor.resourcePanel.focusTarget, selectFirst: true });
		input.outline.selectionIndex = 0; input.rememberSelection();
	});
	t.after(unbind);
	editor.contextMenu.accept();
	assert.equal(returned, 1); assert.equal(input.detailsWindow.open, false);
	assert.equal(editor.contextMenu.visible, true);
	assert.ok(editor.contextMenu.invocationOrigin === editor.resourcePanel.focusTarget);
});

for (const presentation of ['outline', 'graph'] as const) test(`Actor ${presentation} keyboard and More expose the same scoped contextual commands`, t => {
	const { editor, input, pane } = actorFixture(t);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	if (presentation === 'graph') { editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0); }
	const primary = pane.commandTarget; pane.focus();
	for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const) {
		editor.dispatchKey(new KeyInputEvent(code, modifiers));
		editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false));
		assert.equal(editor.contextMenu.visible, true); assert.ok(editor.contextMenu.invocationOrigin === primary);
		const commands = editor.contextMenu.model.rows.map(row => row.command);
		assert.equal(commands.includes('graph.zoomIn'), presentation === 'graph');
		assert.ok(commands.includes(presentation === 'graph' ? 'actorLab.outline' : 'actorLab.stateGraph'));
		editor.contextMenu.hide();
		editor.commands.execute('actorLab.more', primary);
		assert.equal(editor.contextMenu.visible, true); assert.ok(editor.contextMenu.invocationOrigin === primary);
		assert.deepEqual(editor.contextMenu.model.rows.map(row => row.command), commands);
		editor.contextMenu.hide();
	}
});

test('Actor keyboard graph menu anchors within the visible graph client without replacing its pan or zoom', t => {
	const { editor, input, pane } = actorFixture(t);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
	editor.commands.execute('actorLab.stateGraph', pane.commandTarget); editor.update(0);
	const graph = input.stateGraph!, view = graph.viewport;
	view.selection = view.model.nodes[0]; graph.rememberSelection();
	view.setZoom(8); view.pan(10_000, 10_000);
	const selected = view.selection!, projectedX = view.graphToViewportX(selected.bounds.left), projectedY = view.graphToViewportY(selected.bounds.bottom);
	assert.ok(projectedX < view.bounds.left || projectedX > view.bounds.right || projectedY < view.bounds.top || projectedY > view.bounds.bottom);
	const zoom = view.zoom, x = view.scrollX, y = view.scrollY;
	const show = editor.contextMenu.show.bind(editor.contextMenu);
	let anchors = 0;
	t.mock.method(editor.contextMenu, 'show', (...args: Parameters<typeof show>) => {
		anchors++;
		// This is the component's anchor-placement policy, not a workflow pixel oracle.
		assert.ok(args[0] >= view.bounds.left && args[0] <= view.bounds.right);
		assert.ok(args[1] >= view.bounds.top && args[1] <= view.bounds.bottom);
		return show(...args);
	});
	editor.commands.execute('contextMenu', pane.commandTarget);
	assert.equal(anchors, 1); assert.equal(editor.contextMenu.visible, true);
	assert.equal(view.zoom, zoom); assert.equal(view.scrollX, x); assert.equal(view.scrollY, y);
});

test('Actor row press cannot reuse an identical input after focus detached and reattached its pane', t => {
	const { editor, pointer, input, pane, controller } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	const primary = pane.commandTarget, selected = controller.selected(input), context = primary.scope.contextGeneration;
	const index = input.outline.rows.findIndex(row => row.element.node.kind === 'state');
	assert.ok(index >= 0 && input.outline.rows[index].element.node !== selected);
	editor.commands.execute('resources.focus', primary); editor.update(0);
	assert.ok(inputFocus.admittedTarget === editor.resourcePanel.focusTarget);
	let admissions = 0;
	const unbind = primary.onDidFocus(() => {
		unbind(); admissions++;
		group.openEditor(new GameViewInput()); group.openEditor(input);
	});
	t.after(unbind);
	pointer(input.outline.layout.contentRight - 4, input.outline.layout.contentTop + (index + 0.5) * input.outline.layout.rowHeight, PointerButton.Secondary);
	assert.equal(admissions, 1); assert.ok(primary.scope.contextGeneration > context);
	assert.ok(group.panes.activePane === pane && pane.input === input);
	assert.ok(controller.selected(input) === selected && inputFocus.admittedTarget === primary);
	assert.equal(editor.contextMenu.visible, false);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Actor preview reorientation retains its guest binding and retirement drains the held input`, t => {
	const { editor, host, pointer, input, pane } = actorFixture(t);
	editor.setFontVariant(variant); editor.update(0); pane.focus();
	const primary = inputFocus.target!, selected = input.outline.rows[input.outline.selectionIndex];
	const center = () => ({ x: (input.previewBounds.left + input.previewBounds.right) / 2,
		y: (input.previewBounds.top + input.previewBounds.bottom) / 2 });
	const sample = createInputControllerSnapshot();
	let point = center(); pointer(point.x, point.y, PointerButton.Primary);
	const preview = inputFocus.target!, binding = preview.guestInput!;
	assert.ok(preview !== primary && binding.recipient === host.input);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1); assert.ok(pointerCapture.guestBinding === binding);
	editor.updateViewport({ width: 320, height: 400 }); editor.update(0);
	assert.equal(input.layout.previewVisible, true, 'the actual tall client retains a stacked preview');
	assert.ok(input.layout.split === input.rowSplit);
	assert.ok(preview.guestInput === binding && inputFocus.target === preview && pointerCapture.guestBinding === binding);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 1);
	editor.updateViewport({ width: 640, height: 360 }); editor.update(0);
	assert.ok(input.layout.split === input.split && preview.guestInput === binding && inputFocus.target === preview);
	editor.updateViewport({ width: 320, height: 160 }); editor.update(0);
	assert.ok(preview.guestInput === undefined, 'withheld preview retires its actual input attachment');
	assert.ok(inputFocus.target === primary && editor.guestInputRecipient === null);
	preview.focus(); assert.ok(inputFocus.target === primary, 'a withheld preview is not a direct focus destination');
	assert.ok(pointerCapture.guestBinding === undefined); assert.equal(pointerCapture.draining, true);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 0);
	const otherRow = input.outline.selectionIndex === 0 ? 1 : 0;
	pointer((input.outline.layout.contentLeft + input.outline.layout.contentRight) / 2,
		input.outline.layout.contentTop + (otherRow + 0.5) * input.outline.layout.rowHeight,
		PointerButton.Primary | PointerButton.Secondary);
	assert.ok(input.outline.rows[input.outline.selectionIndex] === selected, 'the interrupted guest hold cannot select the newly expanded tree');
	editor.updateViewport({ width: 320, height: 400 }); editor.update(0);
	assert.equal(input.layout.previewVisible, true); assert.ok(input.layout.split === input.rowSplit);
	assert.ok(preview.guestInput === binding, 'reappearance reuses the same viewport binding');
	assert.ok(inputFocus.target === primary, 'reappearance does not steal primary keyboard focus');
	point = center(); pointer(point.x, point.y, PointerButton.Primary | PointerButton.Secondary | PointerButton.Auxiliary);
	assert.ok(inputFocus.target === primary && pointerCapture.guestBinding === undefined);
	assert.ok(input.outline.rows[input.outline.selectionIndex] === selected);
	pointer(point.x, point.y, 0); assert.equal(pointerCapture.draining, false);
	pointer(point.x, point.y, PointerButton.Primary);
	assert.ok(inputFocus.target === preview && pointerCapture.guestBinding === binding);
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 1);
	pointer(point.x, point.y, 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Actor sash reorientation cancels the old axis capture and admits only the active keyboard axis`, t => {
	const { editor, host, pointer, input, pane, sourceModel } = actorFixture(t);
	editor.setFontVariant(variant); editor.update(0); pane.focus();
	const primary = inputFocus.target!, selected = input.outline.rows[input.outline.selectionIndex], path = input.selectionPath;
	const source = sourceModel.buffer.getText(), version = sourceModel.version, cycles = host.runtime.machine.scheduler.currentNowCycles();
	const timeline = input.timeline, viewport = input.previewBounds;
	const x = input.split.position, y = (input.split.bounds.top + input.split.bounds.bottom) / 2;
	pointer(x, y, PointerButton.Primary); assert.equal(pointerCapture.active, true);
	const horizontalRatio = input.split.ratio;
	editor.updateViewport({ width: 320, height: 400 }); editor.update(0);
	assert.equal(input.layout.previewVisible, true); assert.ok(input.layout.split === input.rowSplit);
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	assert.ok(inputFocus.target === primary && inputFocus.target.guestInput === undefined);
	const rowRatio = input.rowSplit.ratio;
	const rowX = (input.rowSplit.bounds.left + input.rowSplit.bounds.right) / 2, rowY = input.rowSplit.position;
	pointer(rowX, rowY + 12, PointerButton.Primary | PointerButton.Secondary); editor.update(0);
	assert.equal(input.rowSplit.ratio, rowRatio); assert.equal(input.split.ratio, horizontalRatio);
	pointer(rowX, rowY + 12, 0); assert.equal(pointerCapture.draining, false);
	assert.equal(inputFocus.moveFocus(false), true); assert.equal(inputFocus.moveFocus(false), true);
	const sash = inputFocus.target!;
	assert.ok(sash !== primary && sash.guestInput === undefined && sash.canFocus!());
	editor.dispatchKey(new KeyInputEvent('ArrowRight', KeyModifier.none));
	editor.dispatchKey(new KeyInputEvent('ArrowRight', KeyModifier.none, false, false)); editor.update(0);
	assert.equal(input.rowSplit.ratio, rowRatio, 'horizontal arrows cannot resize the stacked sash');
	editor.dispatchKey(new KeyInputEvent('ArrowDown', KeyModifier.none));
	editor.dispatchKey(new KeyInputEvent('ArrowDown', KeyModifier.none, false, false)); editor.update(0);
	assert.notEqual(input.rowSplit.ratio, rowRatio); assert.equal(input.split.ratio, horizontalRatio);
	const keyboardRowRatio = input.rowSplit.ratio, currentY = input.rowSplit.position;
	pointer(rowX, currentY, PointerButton.Primary); assert.equal(pointerCapture.active, true);
	pointer(rowX, currentY + 12); editor.update(0);
	pointer(rowX, currentY + 12, 0);
	assert.notEqual(input.rowSplit.ratio, keyboardRowRatio); assert.equal(input.split.ratio, horizontalRatio);
	const requestedRowRatio = input.rowSplit.ratio;
	editor.updateViewport({ width: 640, height: 360 }); editor.update(0);
	assert.ok(input.layout.split === input.split); assert.equal(input.split.ratio, horizontalRatio);
	editor.updateViewport({ width: 320, height: 400 }); editor.update(0);
	assert.ok(input.layout.split === input.rowSplit); assert.equal(input.rowSplit.ratio, requestedRowRatio);
	assert.ok(input.outline.rows[input.outline.selectionIndex] === selected && input.selectionPath === path);
	assert.ok(input.timeline === timeline && input.previewBounds === viewport);
	const navigation = pane.getSelection(); t.after(() => navigation.dispose());
	input.split.ratio = 0.7; input.rowSplit.ratio = 0.6;
	pane.setOptions(undefined, navigation); editor.update(0);
	assert.equal(input.split.ratio, horizontalRatio); assert.equal(input.rowSplit.ratio, requestedRowRatio);
	assert.equal(sourceModel.buffer.getText(), source); assert.equal(sourceModel.version, version);
	assert.equal(host.runtime.machine.scheduler.currentNowCycles(), cycles);
});

test('Actor preview retirement keeps newer outside focus admitted by the departing guest control', t => {
	const { editor, host, pointer, input, pane } = actorFixture(t);
	pane.focus();
	pointer((input.previewBounds.left + input.previewBounds.right) / 2,
		(input.previewBounds.top + input.previewBounds.bottom) / 2, PointerButton.Primary);
	const preview = inputFocus.target!, outside = editor.resourcePanel.focusTarget;
	assert.ok(preview.guestInput !== undefined);
	let blurs = 0;
	t.after(preview.onDidBlur(() => { blurs++; editor.commands.execute('resources.focus', pane.commandTarget); }));
	editor.updateViewport({ width: 320, height: 160 }); editor.update(0);
	assert.equal(blurs, 1); assert.ok(editor.resourcePanel.isVisible() && inputFocus.admittedTarget === outside);
	assert.ok(editor.editorParts.main.activeGroup.panes.activePane === pane && pane.input === input);
	assert.ok(preview.guestInput === undefined && pointerCapture.guestBinding === undefined);
	const sample = createInputControllerSnapshot();
	host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal); assert.equal(sample.pointerButtons, 0);
});

test('Actor preview retirement stops the old pane update when guest blur opens another real editor', t => {
	const { editor, host, pointer, input, pane } = actorFixture(t), group = editor.editorParts.main.activeGroup;
	pane.focus();
	pointer((input.previewBounds.left + input.previewBounds.right) / 2,
		(input.previewBounds.top + input.previewBounds.bottom) / 2, PointerButton.Primary);
	const preview = inputFocus.target!, replacement = new GameViewInput(), cycles = host.runtime.machine.scheduler.currentNowCycles();
	assert.ok(preview.guestInput !== undefined);
	let blurs = 0;
	t.after(preview.onDidBlur(() => { blurs++; group.openEditor(replacement); }));
	editor.updateViewport({ width: 320, height: 160 }); editor.update(0);
	assert.equal(blurs, 1);
	assert.ok(group.model.activeTab === replacement && group.panes.activePane?.input === replacement);
	assert.ok(inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
	assert.ok(preview.guestInput === undefined && pointerCapture.guestBinding === undefined);
	assert.equal(host.runtime.machine.scheduler.currentNowCycles(), cycles);
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
		assert.ok(sash !== primary); assert.equal(sash.guestInput, undefined);
		pane.focus();
		const y = (input.split.bounds.top + input.split.bounds.bottom) / 2;
		const x = input.split.position;
		pointer(x, y, PointerButton.Primary);
		assert.equal(pointerCapture.active, true); assert.ok(inputFocus.target === primary);
		pointer(x + 12, y); editor.update(0);
		const ratio = input.split.ratio;
		editor.updateViewport({ width: 320, height: 160 }); editor.update(0);
		assert.equal(pointerCapture.active, false, 'withholding the split retires its captured control');
		assert.equal(pointerCapture.draining, true); assert.equal(sash.canFocus!(), false);
		assert.ok(inputFocus.target === primary);
		for (const backward of [false, true]) {
			const visited = new Set<typeof primary>();
			do {
				assert.ok(!visited.has(inputFocus.target!), 'the visible focus ring returns to the actual primary client');
				visited.add(inputFocus.target!);
				assert.ok(inputFocus.target !== sash); assert.equal(inputFocus.target!.guestInput, undefined);
				assert.equal(inputFocus.moveFocus(backward), true);
			} while (inputFocus.target !== primary);
		}
		pane.focus(); pointer(220, y, PointerButton.Primary | PointerButton.Secondary); pointer(220, y, 0);
		assert.equal(input.split.ratio, ratio); assert.ok(input.outline.rows[input.outline.selectionIndex] === selected);
		assert.ok(input.selectionPath === path);
		editor.updateViewport({ width: 640, height: 360 }); editor.update(0);
		assert.equal(sash.canFocus!(), true); assert.equal(input.split.ratio, ratio); assert.ok(inputFocus.target === primary);
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
		for (const size of [{ width: 320, height: 400 }, { width: 320, height: 160 }, { width: 640, height: 360 }]) {
			editor.updateViewport(size); editor.update(0);
			assert.ok(inputFocus.target === detailsFocus, 'preview retirement does not blur an independently focused Details client');
			assert.ok(input.stateGraph === graph); assert.ok(graph.viewport.model === model); assert.ok(graph.viewport.selection === selection);
			assert.ok(graph.viewport === viewport);
			assert.deepEqual({ zoom: viewport.zoom, x: viewport.scrollX, y: viewport.scrollY }, viewState);
			assert.ok(input.detailsWindow === detailsModel); assert.ok(details.subject === subject); assert.equal(details.locked, true);
			assert.ok(pane.commandTarget === graphFocus, 'compact composition retains the real graph command origin');
		}
		pane.focus(); assert.ok(inputFocus.target === graphFocus);
		editor.updateViewport({ width: 320, height: 160 }); editor.update(0);
		assert.ok(inputFocus.target === graphFocus);
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
	editor.editorParts.main.activeGroup.openEditor(input); editor.update(0);
	assert.ok(inputFocus.target === input.draft.focusTarget);
	assert.equal(inputFocus.moveFocus(false), true);
	const client = inputFocus.target!;
	assert.notEqual(client, input.draft.focusTarget);
	for (const command of ['assistant.send', 'assistant.queue', 'assistant.direct'] as const) assert.equal(client.getCommand(command), undefined,
		'the unavailable turn toolbar is omitted; Tab reaches the actual transcript, not a pane alias');
	assert.equal(inputFocus.moveFocus(true), true); assert.ok(inputFocus.target === input.draft.focusTarget);
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === client);
	for (const command of ['assistant.review', 'assistant.copy'] as const) {
		assert.ok(client.getCommand(command), 'the transcript publishes its real selected-message action');
		assert.equal(client.getCommand(command), client.parent!.getCommand(command));
		assert.equal(editor.commands.isEnabled(command, client), false);
	}
	input.selection.select(message);
	assert.equal(editor.commands.isEnabled('assistant.copy', client), true);
	assert.equal(editor.commands.isEnabled('assistant.review', client), false);
	editor.commands.execute('assistant.copy', client);
	assert.equal((await editor.clipboard.read()).text, message.text.getText());
	input.selection.select(proposed);
	editor.update(0);
	assert.equal(editor.commands.isEnabled('assistant.review', client), true);
	input.draft.focusTarget.focus(); assert.equal(inputFocus.moveFocus(false), true);
	const turnActions = inputFocus.target!;
	assert.ok(turnActions !== client && turnActions !== input.draft.focusTarget);
	assert.equal(input.turnActions.hasFocus, true);
	assert.equal(turnActions.getCommand('assistant.review'), client.getCommand('assistant.review'));
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === client);
	assert.equal(inputFocus.moveFocus(true), true); assert.ok(inputFocus.target === turnActions);
	input.selection.select(undefined); editor.update(0);
	assert.ok(inputFocus.target === input.draft.focusTarget, 'retiring the focused turn actions returns to the actual composer');
	assert.equal(input.turnActions.hasFocus, false);
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === client);
	assert.equal(inputFocus.moveFocus(true), true); assert.ok(inputFocus.target === input.draft.focusTarget);
	input.selection.select(proposed); editor.update(0);
	editor.editorParts.main.activeGroup.panes.clearEditor();
	for (const command of ['assistant.review', 'assistant.copy'] as const) assert.equal(editor.commands.isEnabled(command, client), false);
	editor.commands.execute('assistant.review', client); assert.equal(editor.editorParts.main.activeGroup.panes.activePane, null);
	editor.editorParts.main.activeGroup.panes.openEditor(input); inputFocus.moveFocus(false); inputFocus.moveFocus(false);
	assert.ok(inputFocus.target === client);
	assert.equal(editor.commands.isEnabled('assistant.review', client), true);
	editor.commands.execute('assistant.review', client);
	const review = editor.editorParts.main.activeGroup.panes.activePane!.input;
	assert.equal(review.kind, 'workspace_edit_review');
	assert.ok(review.kind === 'workspace_edit_review' && review.proposal === proposal);
	assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	const group = editor.editorParts.main.activeGroup, companion = new GameViewInput();
	group.openEditor(input); editor.update(0);
	assert.equal(inputFocus.moveFocus(false), true); assert.ok(inputFocus.target === turnActions);
	let retired = 0;
	const unbindBlur = turnActions.onDidBlur(() => { retired++; group.openEditor(companion); });
	input.selection.select(undefined);
	try { editor.update(0); } finally { unbindBlur(); }
	assert.equal(retired, 1);
	assert.ok(group.panes.activePane!.input === companion);
	assert.ok(inputFocus.target === group.panes.activePane!.commandTarget,
		'toolbar retirement must preserve the newer actual client selected by its blur callback');
});

test('Assistant borrows its draft command context only for the concrete input attachment', t => {
	const { editor } = fixture(t), group = editor.editorParts.main.activeGroup;
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
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope), leaf = inputFocus.createTarget(parent);
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

test('global run controls and audio retain their selected physical owner independently of editor focus', async t => {
	const { ide, editor, host, sources } = fixture(t), other = createHostFrameFixture();
	const audio = new HostAudioOutput(host.audio.device, other.runtime.machine.audioController, other.runtime.timing.ufpsScaled);
	const execution = new HostExecutionControl(audio), tasks = new RuntimeTaskQueue(audio, other.presenter);
	const rewind = new HostRewind(other.runtime, other.presenter, other.screen, tasks, audio, { log() {} });
	const state = createRuntimeDebuggerState(other.runtime, sources), fault = createRuntimeFaultState();
	const guest = new SuspendedGuestSession(other.runtime);
	const navigation = new RuntimeFrameNavigation(other.runtime, execution, rewind, tasks, state, fault, guest);
	const debuggerExecution = new RuntimeDebuggerExecution(other.runtime, state, execution, rewind, tasks, fault, guest, navigation);
	const transport = new RuntimeTransport(other.runtime, execution, rewind, navigation, () => tasks.ready);
	const selected = { transport, audio, debuggerExecution };
	t.after(async () => {
		ide.runTargets.retire(selected);
		navigation.dispose(); debuggerExecution.dispose(); await tasks.join();
		audio.dispose(); other.audio.dispose(); other.input.dispose();
	});
	host.execution.setPauseReason(HostPauseReason.Requested, true);
	execution.setPauseReason(HostPauseReason.Requested, true);
	ide.runTargets.select(selected);
	assert.ok(host.audio.device.selected === audio);
	editor.commands.execute('gameView'); editor.update(0);
	assert.ok(ide.runTargets.selected === selected, 'opening a primary-target view cannot select it for global execution');
	assert.ok(host.audio.device.selected === audio);
	const pane = editor.editorParts.main.activeGroup.panes.activePane!, primaryPause = t.mock.method(ide.transport, 'pause');
	editor.commands.execute('pause', null);
	assert.equal(execution.userPaused, false);
	assert.equal(host.execution.userPaused, true);
	assert.equal(editor.isActive, true, 'resuming another target does not hide the authoring workbench');
	editor.commands.execute('runtime.pause', inputFocus.target);
	assert.equal(primaryPause.mock.callCount(), 1, 'the primary view retains its own explicit local transport');
	assert.equal(execution.userPaused, false);
	assert.ok(ide.runTargets.selected === selected);
	execution.setPauseReason(HostPauseReason.Requested, true);
	editor.commands.execute('stepFrame', null);
	assert.equal(execution.frameStepPending, true);
	assert.equal(host.execution.frameStepPending, false);
	assert.ok(editor.editorParts.main.activeGroup.panes.activePane === pane, 'a global step on another target cannot replace the main view');
	execution.finishFrameStep(); navigation.afterHostFrame();
	assert.equal(editor.commands.isEnabled('debugContinue', null), false, 'Continue still requires a source debugger stop');
	assert.equal(editor.commands.isEnabled('debugStepInto', null), false);
	const localScope = new InputFocusScope(editor.editorParts.main.activeGroup.focusScope.surfaceScope, editor.editorParts.main.activeGroup.focusScope);
	const local = new InputInteraction(transport);
	localScope.interaction = local;
	const client = inputFocus.createTarget(null, localScope); client.bindKeyboard(() => {});
	localScope.runtime = { target: client, interaction: local };
	client.commandContext = pane.commandTarget;
	client.focus();
	editor.commands.execute('runtime.playback', client);
	assert.equal(local.running, true); assert.equal(execution.userPaused, false);
	assert.equal(host.execution.userPaused, true, 'a different command subject cannot replace the actual local runtime');
	assert.equal(primaryPause.mock.callCount(), 1);
	editor.commands.execute('runtime.focusTimeline', client);
	assert.equal(editor.editorParts.main.activeGroup.timeline.available, true);
	assert.ok(inputFocus.target!.commandContext === client, 'Timeline retains the actual runtime client rather than its authoring command alias');
	transport.retire();
	assert.ok(inputFocus.target === pane.commandTarget, 'retirement returns focus through the actual owning pane');
	assert.ok(editor.editorParts.main.activeGroup.timeline.focusScope.runtime === pane.commandTarget.scope.runtimeOwner!.runtime,
		'the newly activated client, not global run selection, supplies the replacement Timeline attachment');
	assert.equal(editor.commands.isEnabled('runtime.pause', client), false);
	editor.commands.execute('runtime.pause', client);
	assert.equal(primaryPause.mock.callCount(), 1, 'retiring a local physical target never redirects it to the selected target');
	ide.runTargets.retire(selected);
	assert.equal(host.audio.device.selected, null);
	for (const command of ['pause', 'stepFrame', 'debugContinue', 'runtime.pause'] as const)
		assert.equal(editor.commands.isEnabled(command, null), false, 'retirement cannot redirect a global action to primary');
	const revision = host.execution.revision;
	editor.commands.execute('pause', null); editor.commands.execute('stepFrame', null); editor.commands.execute('runtime.pause', null);
	assert.equal(host.execution.revision, revision);
	assert.ok(editor.editorParts.main.activeGroup.panes.activePane === pane);
});

test('a preparing Play client cannot redirect its unavailable local transport or Timeline to primary', t => {
	const { ide, editor } = fixture(t);
	const handle = new PlayHandle({ contextId: TEST_SYSTEM_CONTEXT_ID, path: 'preparing.lua' }, 'Preparing fixture', '', 0, null, undefined);
	handle.preparation = Promise.resolve();
	editor.editorParts.main.activeGroup.openEditor(new PlayEditorInput(handle, ide.play)); editor.update(0);
	const pane = editor.editorParts.main.activeGroup.panes.activePane!, primaryPause = t.mock.method(ide.transport, 'pause');
	assert.ok(pane.commandTarget !== undefined);
	assert.equal(pane.commandTarget.scope.runtime!.interaction.transport, null);
	assert.equal(editor.editorParts.main.activeGroup.timeline.available, false);
	editor.editorParts.main.activeGroup.timeline.focus();
	assert.equal(editor.editorParts.main.activeGroup.timeline.visible, false);
	assert.equal(editor.commands.isEnabled('runtime.pause', pane.commandTarget), false);
	editor.commands.execute('runtime.pause', pane.commandTarget);
	assert.equal(primaryPause.mock.callCount(), 0);
	assert.ok(ide.runTargets.selected === ide, 'unavailable local state does not change global run selection');
	editor.commands.execute('runtime.pause', null);
	assert.equal(primaryPause.mock.callCount(), 1, 'the separate global invocation still addresses the selected primary');
});

for (const action of ['run', 'reboot', 'hot-resume'] as const) for (const newer of ['none', 'selection', 'editor'] as const) {
	test(`${action} receipt admits only its retained run intent and editor presentation after newer ${newer}`, async t => {
		const { ide, editor, host, sources } = actorFixture(t), group = editor.editorParts.main.activeGroup;
		host.presenter.initialize(new RenderPassLibrary(host.backend, host.presenter));
		t.after(() => host.presenter.dispose());
		const presentation = { group, generation: group.panes.openGeneration };
		const request: Extract<EditorActionRequest, { action: 'run' | 'reboot' | 'hot-resume' }> = action === 'run'
			? { action, entry: { domain: 0 }, expectedImage: sources.currentBlua32Media.system!,
				selectionRequest: ide.runTargets.request(), presentation }
			: { action, presentation };
		// This is a success-presentation regression: only the physical receipt
		// producer is replaced. Build/source admission has its own owner tests.
		const bootDone = Promise.withResolvers<BootResult>();
		const boot: BootOperation = { id: 1, kind: 'reboot', sourceSnapshots: [], entry: undefined,
			status: 'queued', result: null, completion: bootDone.promise };
		const admission = Promise.withResolvers<HotResumeAdmissionResult>(), applyDone = Promise.withResolvers<HotResumeResult>();
		const hot: HotResumeOperation = { id: 1, sourceSnapshots: [], status: 'queued', applied: false, result: null,
			admission: admission.promise, completion: applyDone.promise };
		t.mock.method(ide.boots, 'reboot', () => boot);
		t.mock.getter(ide.boots, 'latestOperation', () => boot);
		t.mock.method(ide.hotResumes, 'resume', () => hot);
		t.mock.getter(ide.hotResumes, 'latestOperation', () => hot);
		if (newer === 'none') {
			const prompt = editor.actionPrompt.show({ title: 'Source decision', message: '', primary: 'Apply',
				secondary: 'Keep working', primaryEnabled: true, defaultChoice: 'primary' });
			editor.actionPrompt.close('primary'); await prompt;
			assert.equal(group.panes.openGeneration, presentation.generation,
				'the command\'s own prompt changes keyboard focus, not editor attachment admission');
		}
		if (request.action === 'hot-resume')
			performHotResume(ide.hotResumes, editor, host.execution, ide.overlayRenderer, ide.logOutput, ide.runTargets, request);
		else performReboot(ide.boots, editor, host.execution, ide.overlayRenderer, ide.logOutput, ide.runTargets, request);
		if (newer === 'selection') ide.runTargets.select(undefined);
		if (newer === 'editor') group.openEditor(new GameViewInput());
		const revision = host.execution.revision, pane = group.panes.activePane;
		if (action === 'hot-resume') {
			admission.resolve({ status: 'accepted', mode: 'applied' }); await admission.promise;
			applyDone.resolve({ status: 'completed', applied: true }); await applyDone.promise;
		} else {
			bootDone.resolve({ status: 'reset', installed: true, reset: true }); await bootDone.promise;
		}
		await Promise.resolve();
		if (newer === 'none') {
			assert.ok(host.execution.revision > revision);
			assert.equal(host.execution.userPaused, false);
			assert.equal(editor.isActive, false);
		} else {
			assert.equal(host.execution.revision, revision, 'an old receipt cannot publish a newer execution intent');
			assert.equal(host.execution.userPaused, true);
			assert.equal(editor.isActive, true);
			assert.ok(group.panes.activePane === pane, 'physical success cannot replace or hide the newer interaction');
		}
		assert.ok(ide.runTargets.selected === (newer === 'selection' ? undefined : ide));
	});
}

test('root Palette in an empty group cannot revive commands from its detached last-focused pane', t => {
	const { editor } = fixture(t), group = editor.editorParts.main.activeGroup;
	group.openEditor(new HostErrorInput('previous document'));
	const detached = group.panes.activePane!.commandTarget;
	let staleExecutions = 0;
	detached.registerCommand('editor.source', { isEnabled: () => true, run: () => { staleExecutions++; } });
	detached.focus();
	assert.ok(detached.scope.lastFocused === detached);
	group.clear();
	assert.equal(group.panes.activePane, null);
	assert.ok(detached.scope.lastFocused === detached, 'the concrete pane retains focus memory independently of its attachment');
	assert.equal(detached.getCommand('editor.source')!.isEnabled(), true);
	inputFocus.setTarget(null);
	editor.commands.execute('commandPalette', null);
	const items = editor.quickInput.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	assert.ok(editor.quickInput.invocationOrigin === group.tabFocusTarget);
	assert.equal(items.some(item => item.command === 'editor.source'), false);
	assert.ok(items.every(item => item.target === group.tabFocusTarget));
	const row = editor.quickInput.model.list.rows.findIndex(row => items[row.itemIndex].command === 'home');
	assert.ok(row >= 0);
	editor.quickInput.model.list.selectionIndex = row;
	editor.quickInput.accept();
	assert.equal(group.panes.activePane?.input.kind, 'home');
	assert.equal(staleExecutions, 0);
});

test('chrome Palette after a preserve-focus switch addresses the new attached client rather than old focus memory', t => {
	const { editor } = fixture(t), group = editor.editorParts.main.activeGroup;
	group.openEditor(new HostErrorInput('previous document'));
	const detached = group.panes.activePane!.commandTarget;
	let staleExecutions = 0, currentExecutions = 0;
	detached.registerCommand('editor.source', { isEnabled: () => true, run: () => { staleExecutions++; } });
	detached.focus();
	editor.resourcePanel.show();
	const chrome = inputFocus.target;
	assert.equal(chrome, editor.resourcePanel.focusTarget);
	const next = new GameViewInput();
	group.openEditor(next, { preserveFocus: true });
	const attached = group.panes.activePane!.commandTarget;
	assert.ok(attached !== detached);
	assert.ok(inputFocus.target === chrome);
	assert.ok(detached.scope.lastFocused === detached);
	attached.registerCommand('editor.source', {
		isEnabled: () => true,
		run: () => { assert.equal(group.panes.activePane!.input, next); currentExecutions++; },
	});
	editor.commands.execute('commandPalette', chrome);
	const items = editor.quickInput.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	const item = items.find(item => item.command === 'editor.source');
	assert.ok(item);
	assert.ok(item.target === attached);
	// The active editor supplies view actions; Files retains its own local capabilities.
	assert.ok(editor.quickInput.invocationOrigin === chrome);
	const row = editor.quickInput.model.list.rows.findIndex(row => items[row.itemIndex] === item);
	assert.ok(row >= 0);
	editor.quickInput.model.list.selectionIndex = row;
	editor.quickInput.accept();
	assert.equal(currentExecutions, 1);
	assert.equal(staleExecutions, 0);
	assert.equal(group.panes.activePane!.input, next);
	assert.ok(inputFocus.target === chrome);
});

test('chrome Palette retains Host Error body Copy and writes the exact attached document bytes', async t => {
	const { editor } = fixture(t), group = editor.editorParts.main.activeGroup;
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
	assert.ok(inputFocus.target === chrome);
	assert.equal(group.panes.activePane, pane);
});

test('Conversations publishes older-page admission on its real transcript client for the attached input lifetime', t => {
	const { editor } = fixture(t), conversation = new ObservedConversation(), replacement = new ObservedConversation();
	const input = new ConversationObserverInput(conversation), next = new ConversationObserverInput(replacement);
	const older = t.mock.method(conversation, 'older', async () => {}), nextOlder = t.mock.method(replacement, 'older', async () => {});
	t.after(() => { input.dispose(); next.dispose(); conversation.dispose(); replacement.dispose(); });
	conversation.olderCursor = 'previous-page'; replacement.olderCursor = 'replacement-page';
	editor.editorParts.main.activeGroup.panes.openEditor(input);
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
	conversation.olderCursor = 'previous-page'; editor.editorParts.main.activeGroup.panes.clearEditor();
	assert.notEqual(inputFocus.admittedTarget, client);
	assert.equal(editor.commands.isEnabled('conversations.older', client), false);
	editor.commands.execute('conversations.older', client); assert.equal(older.mock.callCount(), 1);
	editor.editorParts.main.activeGroup.panes.openEditor(next);
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
	editor.editorParts.main.activeGroup.panes.layout(bounds); editor.editorParts.main.activeGroup.panes.openEditor(input);
	const rows = input.transcript.rows.length, footer = input.footer.lines.slice(), height = input.viewport.contentHeight;
	// This focused layout contract changes the origin only; neither producer text nor available width changes.
	editor.editorParts.main.activeGroup.panes.layout({ ...bounds, left: bounds.left + 80, right: bounds.right + 80 });
	editor.editorParts.main.activeGroup.panes.activePane!.update(0);
	assert.equal(input.transcript.rows.length, rows); assert.equal(input.viewport.contentHeight, height);
	assert.deepEqual(input.footer.lines, footer);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} Assistant client translation and real Files reflow preserve the draft owner and selection`, t => {
	const { editor } = fixture(t), input = new AssistantInput(editor.assistant);
	t.after(() => input.dispose());
	editor.setFontVariant(variant);
	editor.editorParts.main.activeGroup.openEditor(input); editor.update(0);
	insertValue(input.draft, 'A retained assistant draft wraps at the actual client width without changing its text or selection. '.repeat(6));
	input.draft.setSelection(7, 31); editor.editorParts.main.activeGroup.panes.activePane!.update(0);
	const state = input.draft.readText(), rows = input.composer.rows.slice(), bounds = { ...input.layout }, composer = { ...input.composerBounds };
	// Equal-width translation is the layout algorithm under test, not an incidental screen position.
	editor.editorParts.main.activeGroup.panes.layout({ ...bounds, left: bounds.left + 40, right: bounds.right + 40 });
	editor.editorParts.main.activeGroup.panes.activePane!.update(0);
	assert.deepEqual(input.composer.rows, rows);
	assert.deepEqual(input.composerBounds, { ...composer, left: composer.left + 40, right: composer.right + 40 });
	assert.deepEqual(input.draft.readText(), state); assert.ok(inputFocus.target === input.draft.focusTarget);
	editor.resourcePanel.show(); editor.editorParts.main.activeGroup.panes.activePane!.focus(); editor.update(0);
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
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope);
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
	const input = editor.animations.openResource(editor.editorParts.main.activeGroup, sources.catalog.luaResources.find(resource => resource.path === path)!); editor.update(0);
	assert.ok(input !== undefined);
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
		for (const command of ['editor.source', 'animation.fit', 'animation.snap', 'animation.addFrame'] as const) {
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
	showCommandPalette(editor.editorParts.main.quickInput, editor.commands);
	assert.equal(input.document!.tracks[0].keys[0].value!.value, 2, 'ordinary Palette blur first publishes the actual field draft');
	assert.equal(editor.editorParts.main.quickInput.invocationOrigin, details, 'the retired field resolves to its actual Details owner before catalog enumeration');
	const palette = editor.editorParts.main.quickInput.model.list;
	assert.ok(palette.rows.some(row => (row.item as CommandQuickPickItem).command === 'animation.tracks'));
	editor.editorParts.main.quickInput.hide();
	const edited = input.workingCopy.buffer.getText();
	editor.commands.execute('animation.tracks', field); assert.equal(input.activeClient, 'tracks');
	assert.equal(input.workingCopy.buffer.getText(), edited);
	editor.editorParts.main.activeGroup.panes.clearEditor();
	for (const client of [...clients, field]) for (const command of commands) assert.equal(editor.commands.isEnabled(command, client), false);
	const detachedPicks = buildCommandQuickPickItems(editor.commands, field);
	for (const command of commands) assert.equal(detachedPicks.some(item => item.command === command), false);
	editor.editorParts.main.activeGroup.openEditor(input); editor.update(0);
	for (const client of [...clients, field]) for (const command of commands) assert.equal(editor.commands.isEnabled(command, client), true);
	assert.equal(input.workingCopy.buffer.getText(), edited);
	const timeline = editor.animations.openResource(editor.editorParts.main.activeGroup, sources.catalog.luaResources.find(resource => resource.path === timelinePath)!);
	assert.ok(timeline !== undefined);
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
	assert.equal(inputFocus.target, valueField); assert.equal(editor.editorParts.main.quickInput.visible, false);
	assert.equal(timeline.workingCopy.buffer.getText(), timelineSource);
	assert.equal(valueText.replaceText(0, valueText.readText().text.length, '2'), true);
	editor.commands.execute('animation.addKey', valueField);
	assert.equal(editor.editorParts.main.quickInput.inputBox, true, 'the actual Add Key handler opens its owned value prompt after publishing the old property');
	assert.equal(timeline.document!.tracks[0].keys[0].value!.value, 2);
	assert.equal(valueField.getCommand('undo'), localUndo);
	editor.editorParts.main.quickInput.hide(); timeline.workingCopy.undo();
	assert.equal(timeline.workingCopy.buffer.getText(), timelineSource); assert.equal(timeline.workingCopy.undo(), null);
	editor.editorParts.main.activeGroup.panes.clearEditor();
	for (const client of [...clients, field, valueField]) for (const command of ['editor.source', 'animation.fit', 'animation.snap', 'animation.addKey', 'animation.addFrame'] as const)
		assert.equal(editor.commands.isEnabled(command, client), false);
});

test('clipboard admission and execution retain the supplied leaf rather than its alias or ambient focus', async t => {
	const { editor } = fixture(t), parent = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope), selected = new TextField(parent), other = new TextField(parent);
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
	assert.equal(editor.editorParts.main.activeGroup.panes.activePane, null);
	editor.commands.execute('runtime.playback');
	assert.equal(toggle.mock.callCount(), 1, 'the transport operation does not depend on an optional capture view');
	editor.commands.execute('events');
	const pane = editor.editorParts.activeGroup.panes.activePane!;
	assert.equal(pane.input.kind, 'event_viewer');
	assert.equal(pane.commandTarget!.getCommand('runtime.pause'), undefined, 'a latch is not a partial public command');
	pane.commandTarget.scope.runtime!.interaction.running = true; host.execution.setPauseReason(HostPauseReason.Requested, false);
	assert.equal(pane.commandTarget.scope.runtime!.interaction.running, true);
	editor.commands.execute('runtime.pause', pane.commandTarget);
	assert.equal(pane.commandTarget.scope.runtime!.interaction.running, false); assert.equal(host.execution.userPaused, true);
	editor.commands.execute('runtime.playback', pane.commandTarget);
	assert.equal(pane.commandTarget.scope.runtime!.interaction.running, true); assert.equal(host.execution.userPaused, false);
	assert.equal(toggle.mock.callCount(), 2);
});

for (const command of ['events', 'gpuDebugger', 'gteDebugger'] as const) test(`${command} reading client owns complete pane actions without a semantic alias lookup`, t => {
	const { editor } = fixture(t); editor.commands.execute(command);
	const owner = inputFocus.target!.commandContext;
	assert.notEqual(inputFocus.target, owner, 'the actual reading control, not its pane action context, has focus');
	for (const action of ['pause', 'stepFrameBack', 'stepFrame', command === 'events' ? 'events.filter' : command === 'gpuDebugger' ? 'gpu.follow' : 'gte.follow'] as const)
		assert.equal(inputFocus.target!.getCommand(action), owner.getCommand(action), 'the client publishes the actual complete command handler');
	assert.equal(inputFocus.target!.getCommand('runtime.pause'), undefined, 'private capture state is not exposed as a partial public transport command');
});

for (const command of ['events', 'gpuDebugger', 'gteDebugger'] as const) test(`${command} timeline Tab boundaries return to its actual reading client`, t => {
	const { editor } = fixture(t); editor.commands.execute(command); editor.update(0);
	const client = inputFocus.target!;
	const timeline = editor.editorParts.activePart.activeGroup.timeline;
	assert.notEqual(client, inputFocus.target!.commandContext);
	timeline.focus(); assert.equal(inputFocus.moveFocus(true), true);
	assert.ok(inputFocus.target === client, 'Shift+Tab restores the actual reading client');
	timeline.focus(); assert.equal(inputFocus.moveFocus(false), true);
	assert.ok(inputFocus.target === client, 'an unavailable history range leaves no intermediate slider stop');
});

test('revealing Timeline from its own chrome retains the invoking client instead of attaching chrome to itself', t => {
	const { editor } = fixture(t);
	editor.commands.execute('events');
	const client = inputFocus.target!;
	const timeline = editor.editorParts.activePart.activeGroup.timeline;
	const logical = client.scope.runtimeOwner!.runtime!;
	editor.commands.execute('runtime.focusTimeline', client);
	const chrome = inputFocus.target!, scope = timeline.focusScope;
	assert.ok(chrome.commandContext === logical.target);
	for (let invocation = 0; invocation < 3; invocation++) {
		editor.commands.execute('runtime.focusTimeline', chrome);
		assert.ok(inputFocus.target === chrome);
		assert.ok(chrome.commandContext === logical.target);
		assert.ok(scope.interactionOrigin === logical.target.scope);
	}
	editor.commands.execute('runtime.hideTimeline', chrome);
	assert.ok(inputFocus.target === client);
	editor.commands.execute('runtime.toggleTimeline', client);
	assert.ok(inputFocus.target === chrome);
	assert.ok(chrome.commandContext === logical.target);
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
	const origin = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
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
	assert.equal(editor.surfaces.isAdmitted(editor.editorParts.main.activeGroup.paneSurface), false);
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
	assert.equal(editor.surfaces.isAdmitted(editor.editorParts.main.activeGroup.paneSurface), true);
	assert.equal(inputFocus.target, origin);
});


test('menu presentation follows its invoking window session and retires on owner hide or close', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); tree.bindKeyboard(() => {});
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
	const tree = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); tree.bindKeyboard(() => {});
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, editor.contextMenu, {
		model: new WorkbenchWindowModel({ left: 20, top: 30, right: 250, bottom: 240 }, 100, 80),
		actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.editorParts.main.activeGroup.paneSurface,
		presentationParent: editor.surfaces.windowContext(editor.editorParts.main.activeGroup.paneSurface),
		focusScope: tree.scope, focusReturn: tree, workArea: extent, content: { draw() {} }, layoutContent() {},
		retireContentInput: () => inspector.hide(),
		restoreContentInput: () => inspector.show({ title: 'DETAILS', items: [{ label: 'A', value: 'B', description: '', warning: false }],
			focusReturn: tree, canOpenSource: () => false, openSource() {} }, false),
		focusContent: () => inspector.focusTarget.focus(),
	});
	const inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, window.clientFocusTarget, 'client');
	t.after(() => { window.dispose(); inspector.dispose(); });
	for (const retirement of ['surface', 'detach', 'hide'] as const) {
		window.show(false);
		window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		inspector.focusTarget.focus();
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
		const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
		assert.ok(popup.lifetimeOwner === window.clientSurface);
		assert.ok(inputFocus.target === editor.contextMenu.focusTarget);
		if (retirement === 'surface') window.surface!.dispose();
		else if (retirement === 'detach') window.detach();
		else window.hide();
		assert.equal(window.surface, undefined);
		assert.equal(window.clientSurface, undefined);
		assert.equal(inspector.visible, false);
		assert.equal(editor.contextMenu.visible, false);
		assert.equal(popup.retired, true);
		assert.ok(inputFocus.target === tree, `${retirement} returns focus before its popup ownership is removed`);
		assert.ok(inputFocus.admittedTarget === tree, 'the returned target is eligible under the real root admission policy');
	}
});

test('session popup promotes to its actual root or owner-local modal context, never above the admission boundary', t => {
	const { editor, extent } = fixture(t);
	const tree = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); tree.bindKeyboard(() => {}); tree.focus();
	const rootScope = Symbol('root modal');
	const root = editor.surfaces.attach({
		role: 'modal', blockedScope: null, presentationParent: null, captureScope: rootScope,
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
		role: 'modal', blockedScope: editor.editorParts.main.activeGroup.paneSurface, presentationParent: editor.editorParts.main.activeGroup.paneSurface, lifetimeOwner: editor.editorParts.main.activeGroup.paneSurface, captureScope: localScope,
		isVisible: () => true, getBounds: editor.editorParts.main.activeGroup.paneSurface.getBounds, getClip: editor.editorParts.main.activeGroup.paneSurface.getClip, draw() {},
	});
	const localTarget = inputFocus.createTarget(tree, new InputFocusScope(localScope));
	localTarget.canFocus = () => local.visible;
	localTarget.bindKeyboard(() => {}); localTarget.focus();
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const localPopup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(localPopup.lifetimeOwner, local);
	assert.equal(localPopup.presentationParent, local);
	assert.equal(editor.surfaces.isAdmitted(localPopup), true);
	assert.equal(editor.surfaces.isAdmitted(editor.editorParts.main.activeGroup.paneSurface), false);
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
	const origin = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
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
	const preview = new ImagePreviewOverlay(cache, editor.surfaces, editor.editorParts.main.activeGroup.paneSurface, editor.commands);
	preview.layout(editor.editorParts.main.activeGroup.paneSurface.getBounds(), editorViewState.lineHeight);
	t.after(() => { preview.dispose(); cache.dispose(); });
	preview.open('fixture:image');
	editor.contextMenu.show(100, 60, [{ type: 'command', command: 'save' }], editor.commands);
	const popup = editor.surfaces.findByScope(editor.contextMenu.pointerScope)!;
	assert.equal(preview.visible, true);
	assert.equal(editor.contextMenu.focusTarget.hasFocus, true);
	assert.equal(popup.lifetimeOwner, preview.surface);
	assert.equal(popup.presentationParent, preview.surface);
	assert.equal(editor.surfaces.isInContext(popup.captureScope, preview.surface.captureScope), true);
	assert.equal(editor.surfaces.isAdmitted(editor.editorParts.main.activeGroup.paneSurface), false);
	preview.close();
	assert.equal(editor.contextMenu.visible, false);
	assert.equal(popup.retired, true);
	assert.equal(editor.surfaces.findByScope(editor.contextMenu.pointerScope), undefined);
});


test('a newly shown menu accepts the next native row click before any workbench update', t => {
	const { editor, pointer } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
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
		editor.editorParts.main.activeGroup.panes.openEditor(game);
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
		editor.editorParts.main.activeGroup.panes.openEditor(new HostErrorInput('replacement'));
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
			editor.editorParts.main.activeGroup.panes.openEditor(new HostErrorInput('existing'));
			inputFocus.setTarget(owner);
			const decision = kind === 'prompt' ? editor.actionPrompt.show(PROMPT_REQUEST) : undefined;
			if (kind === 'picker') editor.quickInput.pick('Choose', '', () => new TextQuickPickProvider([
				{ label: 'one', description: '', detail: '' },
			]), () => {});
			const sessionFocus = inputFocus.target;
			editor.editorParts.main.activeGroup.panes.clearEditor();
			assert.equal(editor.actionPrompt.visible, kind === 'prompt');
			assert.equal(editor.quickInput.visible, kind === 'picker');
			assert.ok(inputFocus.target === sessionFocus, 'pane retirement does not steal an independent surface focus');
			if (decision !== undefined) { editor.actionPrompt.close(); assert.equal(await decision, 'cancel'); }
			else editor.quickInput.hide();
			assert.ok(inputFocus.target === owner);
		}
	}
	window.dispose();
});

test('a blocked retained focus or a root modal without focus cannot dispatch root keyboard commands', t => {
	const { editor, extent } = fixture(t);
	const origin = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
	const modal = editor.surfaces.attach({ role: 'modal', blockedScope: null, presentationParent: null, captureScope: Symbol('focusless modal'),
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
	const origin = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); origin.bindKeyboard(() => {}); origin.focus();
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
	const tree = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); tree.bindKeyboard(() => {});
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
	assert.equal(popup.lifetimeOwner, editor.editorParts.main.activeGroup.paneSurface);
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
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds);
	let paneOccurrences = 0, windowOccurrences = 0;
	editor.surfaces.attach({
		role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope, isVisible: () => true,
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
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	const bounds = { left: 100, top: 60, right: 300, bottom: 240 };
	game.setInput(bounds); game.focusTarget.focus();
	let uiOccurrences = 0;
	editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope, isVisible: () => true,
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
	const firstGame = new GameInputControl(owner, first, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	const secondGame = new GameInputControl(owner, second, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	firstGame.setInput({ left: 20, top: 60, right: 170, bottom: 240 });
	secondGame.setInput({ left: 200, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope, isVisible: () => true,
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
	editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface,
		captureScope: Symbol('new input owner'), isVisible: () => true,
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
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	game.setInput({ left: 20, top: 60, right: 350, bottom: 240 });
	editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope, isVisible: () => true,
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
	const tree = inputFocus.createTarget(null, editor.editorParts.main.activeGroup.focusScope); tree.bindKeyboard(() => {});
	const model = new WorkbenchWindowModel({ left: 30, top: 40, right: 350, bottom: 260 }, 100, 80);
	const window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, editor.surfaces, editor.commands, editor.contextMenu, {
		model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: editor.editorParts.main.activeGroup.paneSurface,
		presentationParent: editor.surfaces.windowContext(editor.editorParts.main.activeGroup.paneSurface),
		focusScope: tree.scope, focusReturn: tree, workArea: extent,
		content: { draw() {}, handlePointer: snapshot => { game.handlePointer(snapshot); } },
		layoutContent: bounds => game.setInput(bounds), retireContentInput: () => game.clearInput(),
		restoreContentInput: () => game.setInput(model.client), focusContent: () => game.focusTarget.focus(),
	});
	const game = new GameInputControl(window.clientFocusTarget, host.input, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
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
	const game = new GameInputControl(owner, host.input, { kind: 'direct', presenter: host.presenter }, editor.commands.transport);
	game.setInput(extent);
	const snapshot = createInputControllerSnapshot();
	for (const shortClick of [false, true]) {
		let replacement: ReturnType<typeof editor.surfaces.attach>;
		const original = editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope,
			isVisible: () => true, getBounds: () => extent, getClip: () => extent, draw() {},
			onRetire: () => pointerCapture.cancelScope(scope.surfaceScope),
			handlePointer: () => {
				original.dispose();
				replacement = editor.surfaces.attach({ role: 'content', lifetimeOwner: editor.editorParts.main.surface, presentationParent: editor.editorParts.main.surface, captureScope: scope.surfaceScope,
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
	const mainInputs = [...editor.editorParts.main.activeGroup.model.tabs], mainActive = editor.editorParts.main.activeGroup.model.activeTab;
	const first = new HostErrorInput('first'), second = new GameViewInput();
	let origin!: InputFocusTarget;
	try {
		group.openEditor(first); group.openEditor(second);
		origin = inputFocus.target!;
		editor.editorParts.main.activeGroup.panes.activePane?.focus();
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'tabs.next' }], editor.commands,
			{ selectFirst: true, invocationOrigin: origin });
		assert.equal(editor.contextMenu.model.rows[0].enabled, true);
		editor.contextMenu.accept();
		assert.equal(group.model.activeTab, first);
		assert.equal(editor.editorParts.main.activeGroup.model.activeTab, mainActive);
		assert.deepEqual(editor.editorParts.main.activeGroup.model.tabs, mainInputs);
		editor.contextMenu.show(100, 60, [{ type: 'command', command: 'tabs.close' }], editor.commands,
			{ selectFirst: true, invocationOrigin: origin });
		editor.contextMenu.accept();
		assert.deepEqual(group.model.tabs, [second]);
		assert.equal(editor.editorParts.main.activeGroup.model.activeTab, mainActive);
	} finally { group.dispose(); surface.dispose(); }
	assert.equal(editor.commands.isEnabled('tabs.close', origin), false);
	assert.equal(editor.commands.isEnabled('tabs.next', origin), false);
	editor.commands.execute('tabs.close', origin);
	editor.commands.execute('tabs.next', origin);
	assert.equal(editor.editorParts.main.activeGroup.model.activeTab, mainActive);
	assert.deepEqual(editor.editorParts.main.activeGroup.model.tabs, mainInputs);
});
