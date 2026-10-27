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
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../lua/cpu_test_harness';
import { linkTestSystemBlua32 } from './blua32';
import { createTestEditorGroup, TEST_EDITOR_TAB_LAYOUT_CONTEXT, TEST_EDITOR_TAB_RENDER_CONTEXT } from './editor_panes';
import { create_rect_bounds, write_rect_bounds } from '../../machine/ts/common/rect';
import { createHostFrameFixture } from './host_frame';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from './runtime_sources';

/** Two real Source panes share one real workbench's services, never a substituted editor facade. */
export function createActualSourcePanes(t: TestContext, sameModel = false) {
	const source = 'local alpha = 1\nreturn alpha\n', otherSource = 'local beta = 2\nreturn beta\n';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, 'first.lua'), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'first.lua',
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	for (const [path, text] of [['first.lua', source], ['second.lua', otherSource]]) {
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
	const editor = ide.editor, firstGroup = editor.editorGroup;
	const firstInput = resolveLuaCodeEditorInput(sources.catalog, sources.catalog.resolveResource({ contextId: sources.systemContextId, path: 'first.lua' })!);
	firstGroup.openEditor(firstInput);
	const first = firstGroup.panes.getPane('code_editor') as CodeEditorPane;
	let secondGroup: EditorGroupView;
	secondGroup = createTestEditorGroup(editor.commands, scope => new CodeEditorPane(scope, secondGroup, editor, clipboard,
		sources, ide.guest, ide.fault, host.runtime, ide.debugger, host.clock), editor.editorClose.close, {
		surfaces: editor.surfaces, owner: firstGroup.paneSurface.lifetimeOwner!, focusScope: inputFocus.workbenchScope,
		workArea: firstGroup.workArea, renderContext: TEST_EDITOR_TAB_RENDER_CONTEXT,
	});
	editor.editorGroups.push(secondGroup);
	const firstBounds = { left: 0, top: 32, right: 384, bottom: 290 };
	const secondBounds = { left: 400, top: 32, right: 800, bottom: 290 };

	const secondInput = resolveLuaCodeEditorInput(sources.catalog, sameModel ? firstInput.workingCopy.resource
		: sources.catalog.resolveResource({ contextId: sources.systemContextId, path: 'second.lua' })!);
	secondGroup.panes.layout(secondBounds); secondGroup.openEditor(secondInput);
	const second = secondGroup.panes.getPane('code_editor') as CodeEditorPane;
	const firstTabs = create_rect_bounds(), secondTabs = create_rect_bounds();
	const arrange = () => {
		write_rect_bounds(firstTabs, firstBounds.left, firstBounds.top - editorViewState.tabBarHeight, firstBounds.right, firstBounds.top);
		write_rect_bounds(secondTabs, secondBounds.left, secondBounds.top - editorViewState.tabBarHeight, secondBounds.right, secondBounds.top);
		firstGroup.tabStrip.layout(firstTabs, TEST_EDITOR_TAB_LAYOUT_CONTEXT);
		secondGroup.tabStrip.layout(secondTabs, TEST_EDITOR_TAB_LAYOUT_CONTEXT);
		firstGroup.panes.layout(firstBounds); secondGroup.panes.layout(secondBounds);
	};
	const update = (milliseconds = 0) => {
		host.clock.advance(milliseconds); editor.update(milliseconds / 1000); secondGroup.panes.activePane?.update(milliseconds / 1000); arrange(); runBackgroundTasks(host.clock);
	};
	const key = (code: string, modifiers = KeyModifier.none) => {
		editor.dispatchKey(new KeyInputEvent(code, modifiers)); editor.dispatchKey(new KeyInputEvent(code, modifiers, false, false)); update();
	};
	const paint = () => {
		arrange(); ide.overlayRenderer.beginFrame(host.presenter); api.beginFrame(ide.overlayRenderer);
		editor.draw(); ide.overlayRenderer.endFrame(); return host.presenter.hostOverlayQueue.consumeOverlayFrame();
	};
	t.after(async () => {
		editor.editorGroups.splice(editor.editorGroups.indexOf(secondGroup), 1); secondGroup.dispose();
		inputFocus.setTarget(null); pointerCapture.interrupt(false);
		await editor.shutdown(); clearBackgroundTasks(); host.audio.dispose(); host.input.dispose();
	});
	editorRuntimeState.active = true; host.input.setPointerAdmissionMode('routed'); update();
	return { ide, editor, host, sources, firstGroup, secondGroup, first, second, firstInput, secondInput,
		firstBounds, secondBounds, arrange, update, key, paint, source, otherSource };
}
