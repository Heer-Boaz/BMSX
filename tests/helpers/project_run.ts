import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { clearBackgroundTasks } from '../../ide/common/background_tasks';
import { SYSTEM_RESOURCE_DOMAIN } from '../../ide/common/resource';
import type { EditorActionRequest } from '../../ide/commands/action_request';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { linkTestBlua32Pair } from './blua32';
import { cartridgeSlots } from './cartridge';
import { createHostFrameFixture } from './host_frame';
import { createTestRuntimeSourceState, createTestRomToolingLayer, TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from './runtime_sources';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

const SYSTEM_SOURCE = 'return true', CART_SOURCE = 'return 1';
const IMAGES = linkTestBlua32Pair(
	compileLuaChunkToProgram(parseLuaChunk(SYSTEM_SOURCE, 'entry.lua').chunk, [], { entrySource: SYSTEM_SOURCE, programDomain: 'system', optLevel: 0 }),
	compileLuaChunkToProgram(parseLuaChunk(CART_SOURCE, 'entry.lua').chunk, [], { entrySource: CART_SOURCE, programDomain: 'cart', optLevel: 0 }),
);

function registry(root: string, bootable: boolean) {
	const result = createLuaSourceRegistry(root, 'entry.lua');
	for (const [path, source] of [['entry.lua', CART_SOURCE], ['file.lua', 'return 2'], ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]) registerLuaSourceRecord(result, {
		resid: path, type: 'lua', src: source, base_src: source, source_path: path, normalized_source_path: `${root}/${path}`,
		module_path: path.slice(0, -4), update_timestamp: 0, base_update_timestamp: 0, generated: false,
		sourceKind: 'project', program_module: true,
	});
	result.can_boot_from_source = bootable;
	return result;
}

/** Physical synthetic images and independently admitted namespaces; no project or guest launch is executed. */
export function createProjectRunFixture(t: TestContext, bootable = true, attachments: readonly [0 | 1 | null, 0 | 1 | null] = [0, 1]) {
	const admitted = createTestRuntimeSourceState(registry('synthetic-system', false),
		[registry('synthetic-project-a', bootable), registry('synthetic-project-b', true)], SYSTEM_RESOURCE_DOMAIN);
	const system = createTestRomToolingLayer('system', 'synthetic-system', IMAGES.systemRomBytes);
	const layers = [createTestRomToolingLayer('cart', 'synthetic-project-a', IMAGES.cartRomBytes),
		createTestRomToolingLayer('cart', 'synthetic-project-b', IMAGES.cartRomBytes)] as const;
	const [first, second] = attachments;
	const sources = createRuntimeSourceState(system, [first === null ? null : layers[first], second === null ? null : layers[second]], {
		catalog: admitted.catalog, systemContextId: TEST_SYSTEM_CONTEXT_ID,
		cartridgeContextIds: [first === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[first], second === null ? null : TEST_CARTRIDGE_CONTEXT_IDS[second]],
	});
	const runtime = new Runtime({ systemRomBytes: IMAGES.systemRomBytes,
		cartridgeSlots: cartridgeSlots(first === null ? null : IMAGES.cartRomBytes, second === null ? null : IMAGES.cartRomBytes), machineModel: PSX_MACHINE_SPEC },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	const host = createHostFrameFixture(runtime); runtime.boot();
	const externalWork = (): never => { throw new Error('Project command admission must not build or launch a guest.'); };
	const ide = new RuntimeIdeState(runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor, part = editor.editorParts.createDocument(), group = part.activeGroup;
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false); await editor.shutdown();
		clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	ide.boots.didReplaceMachine(); editorRuntimeState.active = true; editor.interaction.setActive(true);
	host.input.setPointerAdmissionMode('routed');
	const update = () => editor.update(0);
	const open = (contextId: string) => {
		const resource = sources.catalog.resolveResource({ contextId, path: 'file.lua' })!;
		const input = resolveLuaCodeEditorInput(sources.catalog, resource);
		group.openEditor(input, { pinned: true }); update(); return { input, target: group.panes.activePane!.commandTarget };
	};
	const openMain = async (contextId: string = TEST_CARTRIDGE_CONTEXT_IDS[0]) => {
		const resource = sources.catalog.resolveResource({ contextId, path: 'scene.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource), document = ide.sceneSources.get(model);
		assert.equal(await editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target!), true);
		update(); const primary = editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
		return { model, primary };
	};
	const requests: EditorActionRequest[] = [];
	t.mock.method(editor.commands, 'executeConfirmedAction', async request => { requests.push(request); return false; });
	return { ide, editor, host, sources, part, group, update, open, openMain, requests };
}
