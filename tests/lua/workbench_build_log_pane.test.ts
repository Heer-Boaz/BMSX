import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { StudioBuildJob } from '../../hosts/common/studio_builds';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import * as colors from '../../ide/common/constants';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { ScrollbarController } from '../../ide/editor/ui/scrollbar_controller';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { BuildLogInput } from '../../ide/workbench/contrib/builds/editor_input';
import { BuildLogPane } from '../../ide/workbench/contrib/builds/editor_pane';
import type { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import type { WorkspaceBuilds } from '../../ide/workbench/services/builds';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const ERROR = 'compiler: first\r\n\t' + 'a_real_long_authored_path/'.repeat(15) + ':1:48: unexpected )\n';

async function fixture(t: TestContext, variant: 'tiny' | 'msx', theme: 'light' | 'dark', failed = true) {
	const oldTheme = colors.getActiveIdeThemeVariant(), oldScrollbar = editorViewState.scrollbarController;
	configureFontVariant(new VirtualHeadlessClock(), variant, null); colors.setIdeThemeVariant(theme);
	const job: StudioBuildJob = { request: { requestId: 'actual-request-identity', target: 'cpu_soak', debug: true, optLevel: 0 },
		state: failed ? 'failed' : 'completed', phase: 'Done', version: { generation: 1, sequence: 1 }, acceptedAt: 0, updatedAt: 1,
		error: failed ? ERROR : undefined };
	let reads = 0;
	const builds: WorkspaceBuilds = { jobs: [job], pending: [], targets: async () => ['cpu_soak'], submit: async () => job,
		get: async () => { reads++; return job; }, cancel: async () => job, forget() {}, log: async () => '' };
	const input = new BuildLogInput(job, builds), clipboard = new HeadlessClipboard();
	const vertical = input.document.viewport.scrollbar, horizontal = new Scrollbar('horizontal');
	editorViewState.scrollbarController = new ScrollbarController({ codeVertical: vertical, viewerVertical: vertical,
		resourceVertical: vertical, codeHorizontal: horizontal, resourceHorizontal: horizontal }, () => {}, pointerCapture);
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const bounds = { left: 13, top: 21, right: 333, bottom: 241 };
	const surfaces = new WorkbenchSurfaceService();
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('build log pane'), getBounds: () => bounds,
		getClip: () => bounds, isVisible: () => true, draw() {} });
	const pane = new BuildLogPane({ hide() {} } as ResourcePanelController, clipboard, menu, surfaces, owner, bounds);
	await input.refresh(); pane.setInput(input, bounds); pane.focus();
	const overlay = createHostOverlayFixture(384, 288);
	const draw = () => {
		pane.update(); overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		pane.draw(); pane.drawStatusBar({ left: 0, top: 260, right: 384, bottom: 278 }, colors.COLOR_RESOURCE_VIEWER_TEXT);
		overlay.renderer.endFrame(); const frame = overlay.queue.consumeOverlayFrame(), text: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
			text.push((frame.commandRefs[index] as GlyphRenderSubmission).items as string);
		return text;
	};
	t.after(() => {
		pane.clearInput(); inputFocus.setTarget(null); pane.dispose(); menu.dispose(); input.dispose();
		pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); editorViewState.scrollbarController = oldScrollbar;
		colors.setIdeThemeVariant(oldTheme);
	});
	return { input, pane, clipboard, bounds, draw, reads: () => reads };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	test(`${variant}/${theme} Build Output presents distinct raw documents and retains each reader across channel and pane changes`, async t => {
		const f = await fixture(t, variant, theme), error = f.input.error!;
		assert.equal(f.input.channel, 'error'); assert.equal(f.input.resource, undefined); assert.equal(f.input.isDirty(), false);
		assert.equal(inputFocus.target!.clipboard!.readOnly, true);
		assert.ok(f.draw().some(text => text.startsWith('Failure diagnostic')));
		assert.ok(f.draw().includes('Debug -O0'), 'the title row identifies the recipe rather than repeating the target and state');
		assert.ok(error.projection.rows.length > 3, 'the real reader wraps, not an ellipsized list entry');
		error.select(0, 8); error.setQuery('path'); error.nextMatch(1);
		const selection = [error.selectionAnchor, error.cursorOffset], query = error.query;
		f.pane.execute('buildLog.copyAll'); await Promise.resolve(); assert.equal(f.clipboard.text, ERROR);
		f.pane.execute('buildLog.output'); assert.equal(f.input.document, f.input.output);
		assert.ok(f.draw().includes('No output'));
		assert.ok(f.draw().some(text => text.startsWith('Captured output')));
		assert.equal(f.pane.isEnabled('buildLog.copyAll'), false);
		f.pane.execute('buildLog.copyAll'); await Promise.resolve(); assert.equal(f.clipboard.text, ERROR, 'empty Copy All cannot wipe the clipboard');
		f.pane.execute('buildLog.error');
		assert.deepEqual([error.selectionAnchor, error.cursorOffset], selection); assert.equal(error.query, query);
		assert.ok(f.draw().some(text => text.startsWith('Failure diagnostic')));
		const reads = f.reads(); f.pane.clearInput(); f.pane.setInput(f.input, f.bounds); f.pane.focus();
		assert.equal(f.reads(), reads, 'view attachment never requests or reconstructs source');
		assert.equal(f.input.document, error); assert.deepEqual([error.selectionAnchor, error.cursorOffset], selection);
		f.bounds.right = f.bounds.left + (variant === 'tiny' ? 80 : 120); f.pane.layout(f.bounds);
		assert.ok(!f.draw().includes('…'), 'priority actions never leave a pointless single-glyph heading at minimum width');
		f.pane.execute('buildLog.output'); assert.ok(f.draw().includes('No output'));
		assert.ok(editorViewState.font.measure('No output') <= f.input.output.viewport.bounds.right - f.input.output.viewport.bounds.left - 8,
			'the compact empty notice fits the actual font at the minimum width');
	});
}

test('successful empty output is a readable empty document, not a no-match search or a fabricated error', async t => {
	const f = await fixture(t, 'tiny', 'light', false);
	assert.equal(f.input.channel, 'output'); assert.equal(f.input.error, undefined);
	assert.ok(f.draw().includes('No output'));
	assert.ok(!f.draw().some(text => /NO MATCHING ITEMS/i.test(text)));
	assert.equal(f.input.actions.items.filter(item => item.visible && (item.command === 'buildLog.error' || item.command === 'buildLog.output')).length, 0);
	assert.equal(f.pane.isEnabled('buildLog.error'), false); f.pane.execute('buildLog.error');
	assert.equal(f.input.channel, 'output'); assert.equal(f.pane.isEnabled('buildLog.copyAll'), false);
});

test('document Find belongs to the document/query leaf and cannot mutate a resource working copy', async t => {
	const f = await fixture(t, 'tiny', 'dark');
	const source = new EditorTextModel({ domain: 0, path: 'owned.lua', source: { type: 'lua', resid: 'owned' } }, 'lua', 'return 1');
	t.after(() => source.dispose());
	source.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	const text = source.buffer.getText(), version = source.version, dirty = source.dirty;
	const leaf = inputFocus.target!;
	const command = resolveEditorCommandKeybinding('KeyF', KeyModifier.ctrl, undefined, leaf);
	assert.equal(command?.command, 'text.find');
	const actions = leaf.next!;
	assert.equal(actions.parent === leaf.parent, true, 'Tab reaches the actual sibling title actions, not the pane itself');
	actions.focus();
	assert.equal(resolveEditorCommandKeybinding('KeyF', KeyModifier.ctrl, undefined)?.command, 'text.find', 'the title actions expose the same document command');
	leaf.focus();
	assert.equal(leaf.getCommand('undo'), undefined); assert.equal(leaf.getCommand('redo'), undefined);
	leaf.getCommand('text.find')!.run(); f.pane.update();
	const query = inputFocus.target!;
	assert.notEqual(query, leaf); assert.equal(query.getCommand('text.find')!.isEnabled(), true);
	assert.equal(query.next === actions, true, 'Find participates in the pane navigation, not a two-control Tab trap');
	assert.equal(query.getCommand('buildLog.error')!.isEnabled(), true);
	f.bounds.right = f.bounds.left + 18; f.pane.layout(f.bounds); f.pane.update();
	assert.equal(query.canFocus!(), false); assert.equal(leaf.next === actions, true, 'an unarranged query cannot block Tab');
	f.bounds.right = f.bounds.left + 320; f.pane.layout(f.bounds); f.pane.update();
	assert.equal(leaf.next === query, true); assert.equal(query.next === actions, true);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, true));
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, false));
	f.pane.update(); assert.equal(inputFocus.target, leaf); assert.equal(leaf.next === actions, true);
	assert.equal(source.buffer.getText(), text); assert.equal(source.version, version); assert.equal(source.dirty, dirty);
	assert.equal(f.input.isDirty(), false);
});
