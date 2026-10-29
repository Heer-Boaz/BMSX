import assert from 'node:assert/strict';
import test, { after, before, afterEach, beforeEach, type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import type { EditorActionRequest } from '../../ide/commands/action_request';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createHostFrameFixture } from '../helpers/host_frame';
import { createLoadedTestRuntimeSourceState, createTestRuntime, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { buildScenarioMediaFixture, type ScenarioMediaFixture } from '../helpers/scenario_media';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

let directory: string, media: ScenarioMediaFixture;
before(async () => {
	directory = await mkdtemp(join(tmpdir(), 'bmsx-workspace-run-'));
	media = await buildScenarioMediaFixture(directory, [], {
		systemSource: 'module<entry>\nreturn true', systemModules: [],
		cartSource: "module<entry>\nrequire('scene')\nreturn require('alpha') + require('beta')",
		cartModules: [{ path: 'alpha', source: 'return 1' }, { path: 'beta', source: 'return 2' },
			{ path: 'scene', source: SCENE_VIEWPORT_SOURCE },
			{ path: 'cartlib/world/scene_library', source: 'return {register=function() end}' }],
	});
});
after(() => rm(directory, { recursive: true, force: true }));
beforeEach(() => openWorkspaceRecords(new MemoryWorkspaceFiles()));
afterEach(() => closeWorkspaceRecords());

/** Actual installed cartridges and canonical inputs; execution stops at the confirmed request boundary. */
async function fixture(t: TestContext) {
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, media.cartRom]);
	const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
	const host = createHostFrameFixture(createTestRuntime(media.systemRom)); host.runtime.boot();
	const externalWork = (): never => { throw new Error('Run command capture must not execute a build or guest target.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor, part = editor.editorParts.createDocument(), group = part.activeGroup;
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	ide.boots.didReplaceMachine(); editorRuntimeState.active = true; editor.interaction.setActive(true);
	host.input.setPointerAdmissionMode('routed');
	const first = resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'alpha.lua' })!);
	const second = resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'beta.lua' })!);
	group.openEditor(first, { pinned: true }); group.openEditor(second, { pinned: true }); group.openEditor(first);
	const update = () => editor.update(0); update(); group.panes.activePane!.focus();
	const target = group.panes.activePane!.commandTarget;
	const requests: EditorActionRequest[] = [];
	t.mock.method(editor.commands, 'executeConfirmedAction', async request => { requests.push(request); return false; });
	const key = (code: string) => {
		editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none)); editor.dispatchKey(new KeyInputEvent(code, KeyModifier.none, false, false)); update();
	};
	return { ide, editor, sources, host, part, group, first, second, target, update, key, requests };
}

/** A real native pending value publishes valid canonical Lua in the captured attachment. */
function pendingDraft(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, afterAcceptance?: () => void) {
	const model = f.first.workingCopy, text = model.buffer.getText(), version = model.version;
	const control = new ValueInput(f.target, INTEGER_INPUT_FORMAT, value => {
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: `return ${value}` }]);
		afterAcceptance?.();
	});
	control.setValue(1); control.layout(f.group.panes.contentBounds); control.field.focusTarget.focus();
	assert.equal(control.field.replaceText(0, control.field.text.length, '17'), true);
	t.after(() => { control.cancel(); control.field.focusTarget.release(); control.dispose(); });
	return { control, model, text, version };
}

for (const command of ['runCurrentFile', 'runProject'] as const) {
	for (const explicit of [false, true]) test(`${command} captures ${explicit ? 'inactive explicit' : 'attached'} source before pending draft acceptance`, async t => {
		const f = await fixture(t), draft = pendingDraft(t, f), cycles = f.host.runtime.machine.scheduler.nowCycles;
		const subject = explicit ? f.second : f.first, domain = explicit ? 1 : 0;
		assert.equal(f.editor.commands.isEnabled(command, f.target, explicit ? subject : undefined), true);
		f.editor.commands.execute(command, f.target, explicit ? subject : undefined); f.update();
		assert.equal(draft.control.pending, false); assert.equal(draft.model.version, draft.version + 1);
		assert.equal(draft.model.buffer.getText(), 'return 17'); assert.equal(f.part.quickInput.visible, true);
		assert.equal(f.part.quickInput.model.items.length, 1);
		f.key('Enter'); await setImmediate();
		assert.equal(f.editor.actionPrompt.visible, true);
		f.editor.actionPrompt.close('secondary'); await setImmediate();
		assert.equal(f.requests.length, 1);
		const request = f.requests[0]; assert.equal(request.action, 'run');
		assert.ok(request.action === 'run');
		assert.ok(request.expectedImage === f.sources.currentBlua32Media.cartridgeSlots[domain]);
		assert.deepEqual(request.entry, command === 'runCurrentFile' ? { domain, sourcePath: subject.resource.path } : { domain });
		assert.ok(f.group.model.activeTab === f.first);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

	for (const explicit of [false, true]) test(`${command} retains its ${explicit ? 'explicit' : 'implicit'} subject across a foreign receiver`, async t => {
		const f = await fixture(t), draft = pendingDraft(t, f);
		const receiver = f.editor.editorParts.main.activeGroup;
		f.editor.commands.execute(command, f.target, explicit ? f.first : undefined, receiver.focusTarget); f.update();
		assert.equal(draft.control.pending, false); assert.equal(f.part.quickInput.visible, true);
		assert.equal(f.editor.editorParts.main.quickInput.visible, false);
		f.key('Enter'); await setImmediate(); f.editor.actionPrompt.close('secondary'); await setImmediate();
		assert.equal(f.requests.length, 1); const request = f.requests[0]; assert.ok(request.action === 'run');
		assert.ok(request.expectedImage === f.sources.currentBlua32Media.cartridgeSlots[0]);
		assert.deepEqual(request.entry, command === 'runCurrentFile' ? { domain: 0, sourcePath: f.first.resource.path } : { domain: 0 });
	});

	for (const restore of [false, true]) test(`${command} rejects accepted draft attachment retarget ${restore ? 'A→B→A' : 'A→B'}`, async t => {
		const f = await fixture(t), draft = pendingDraft(t, f, () => {
			f.group.openEditor(f.second); if (restore) f.group.openEditor(f.first);
		});
		f.editor.commands.execute(command, f.target); await setImmediate(); f.update();
		assert.equal(draft.model.buffer.getText(), 'return 17'); assert.equal(draft.model.version, draft.version + 1);
		assert.equal(f.part.quickInput.visible, false); assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.requests.length, 0);
		assert.ok(f.group.model.activeTab === (restore ? f.first : f.second));
	});

	test(`${command} project picker cannot borrow a newer editor after source attachment replacement`, async t => {
		const f = await fixture(t), draft = pendingDraft(t, f);
		f.editor.commands.execute(command, f.target); f.update(); assert.equal(f.part.quickInput.visible, true);
		f.group.openEditor(f.second); f.group.openEditor(f.first); f.update();
		assert.equal(f.part.quickInput.visible, false);
		f.key('Enter'); await setImmediate();
		assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.requests.length, 0);
		assert.ok(f.group.model.activeTab === f.first); assert.equal(draft.control.pending, false);
	});

	test(`${command} Main implicit origin cannot borrow its runnable document while explicit retained input remains authoritative`, async t => {
		const f = await fixture(t), parts = f.editor.editorParts, group = parts.main.activeGroup;
		assert.equal(parts.moveEditor(f.group, f.first, { kind: 'group', group }), true);
		const explicit = f.second.createView();
		group.openEditor(explicit, { pinned: true }); group.openEditor(f.first); f.update();
		const documentTarget = group.panes.activePane!.commandTarget;
		const resource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
		assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, documentTarget), true);
		const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
		selectSceneOutlineRow(primary.view.hierarchy, 1); primary.hierarchy.update(); primary.details.update(); f.update();
		const control = primary.details.control.controls[0]; control.field.focusTarget.focus();
		assert.equal(control.field.replaceText(0, control.field.text.length, '17'), true);
		const version = model.version, text = model.buffer.getText(), target = primary.commandTarget;
		assert.equal(f.editor.commands.isEnabled(command, documentTarget), true);
		assert.equal(f.editor.commands.isEnabled(command, target), false);
		f.editor.commands.execute(command, target);
		f.editor.commands.execute(command, target, undefined, documentTarget); f.update();
		assert.equal(parts.main.quickInput.visible, false); assert.equal(f.part.quickInput.visible, false);
		assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.requests.length, 0);
		assert.equal(model.version, version); assert.equal(model.buffer.getText(), text); assert.equal(control.pending, true);
		assert.ok(group.model.activeTab === f.first && inputFocus.target === control.field.focusTarget);
		assert.equal(f.editor.commands.isEnabled(command, target, explicit), true);
		f.editor.commands.execute(command, target, explicit); f.update();
		assert.equal(parts.main.quickInput.visible, true); assert.equal(parts.main.quickInput.model.items.length, 1);
		f.key('Enter'); await setImmediate(); assert.equal(f.editor.actionPrompt.visible, true);
		f.editor.actionPrompt.close('secondary'); await setImmediate();
		assert.equal(f.requests.length, 1); const request = f.requests[0]; assert.ok(request.action === 'run');
		assert.ok(request.expectedImage === f.sources.currentBlua32Media.cartridgeSlots[1]);
		assert.deepEqual(request.entry, command === 'runCurrentFile' ? { domain: 1, sourcePath: explicit.resource.path } : { domain: 1 });
	});
}
