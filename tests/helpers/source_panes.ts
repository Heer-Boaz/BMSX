import { measureText, measureTextRange } from '../../ide/editor/common/text/layout';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import type { TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { api } from '../../ide/runtime/overlay_api';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../lua/cpu_test_harness';
import { linkTestSystemBlua32 } from './blua32';
import { createHostFrameFixture } from './host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from './runtime_sources';

/** Two real Source panes share one real workbench's services, never a substituted editor facade. */
export function createActualSourcePanes(t: TestContext, sameModel = false, additionalSources: readonly (readonly [string, string])[] = []) {
	const source = 'local alpha = 1\nreturn alpha\n', otherSource = 'local beta = 2\nreturn beta\n';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'first.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'first.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	for (const [path, text] of [['first.lua', source], ['second.lua', otherSource], ...additionalSources]) {
		registerLuaSourceRecord(registry, { resid: path, type: 'lua', src: text, base_src: text,
			source_path: path, normalized_source_path: path, module_path: path.slice(0, -4), update_timestamp: 0,
			base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	}
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), sources.systemContextId), cartridgeSlots: [null, null] };
	const externalWork = (): never => { throw new Error('Source pane acceptance does not request external work.'); };
	const clipboard = new HeadlessClipboard();
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: externalWork }, externalWork,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, clipboard,
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 800, height: 320 }, sources, new Map(), externalWork, externalWork, externalWork);
	const editor = ide.editor;
	const firstBounds = { left: 0, top: 32, right: 384, bottom: 290 };
	const secondBounds = { left: 400, top: 32, right: 800, bottom: 290 };
	const firstPart = editor.editorParts.createDocument(firstBounds), firstGroup = firstPart.group;
	const secondPart = editor.editorParts.createDocument(secondBounds), secondGroup = secondPart.group;
	const firstInput = resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: sources.systemContextId, path: 'first.lua' })!);
	firstGroup.openEditor(firstInput);
	const first = firstGroup.panes.getPane('code_editor') as CodeEditorPane;
	const secondInput = resolveLuaCodeEditorInput(sources.catalog, sameModel ? firstInput.workingCopy.resource
		: sources.catalog.resolveResource({ contextId: sources.systemContextId, path: 'second.lua' })!);
	secondGroup.openEditor(secondInput);
	const second = secondGroup.panes.getPane('code_editor') as CodeEditorPane;
	const arrange = () => {
		if (!firstPart.retired) { firstPart.window!.model.setRequestedBounds(firstBounds); firstPart.window!.layout(editorViewState.font.renderFont(), measureTextRange, measureText); }
		if (!secondPart.retired) { secondPart.window!.model.setRequestedBounds(secondBounds); secondPart.window!.layout(editorViewState.font.renderFont(), measureTextRange, measureText); }
	};
	const update = (milliseconds = 0) => {
		host.clock.advance(milliseconds); arrange(); editor.update(milliseconds / 1000); runBackgroundTasks(host.clock);
	};
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); update();
	};
	const paint = () => {
		arrange(); editor.update(0); ide.overlayRenderer.beginFrame(host.presenter); api.beginFrame(ide.overlayRenderer);
		editor.draw(); ide.overlayRenderer.endFrame(); return host.presenter.hostOverlayQueue.consumeOverlayFrame();
	};
	t.after(async () => {
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); update();
	return { ide, editor, host, sources, firstPart, secondPart, firstGroup, secondGroup, first, second, firstInput, secondInput,
		firstBounds, secondBounds, arrange, update, key, paint, source, otherSource };
}
