import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { ImagePreviewOverlay } from '../../ide/workbench/ui/image_preview_overlay';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as colors from '../../ide/common/constants';
import { decodeImage, encodePngImage } from '../../hosts/node/headless/screenshot';
import type { ImageDecoder } from '../../hosts/common/image';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import { ELLIPSIS } from '../../ide/common/text';
import { RuntimeIdeState } from '../../ide/workbench/state';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { createHostFrameFixture } from '../helpers/host_frame';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import { IdeMicrotaskQueue } from '../../ide/common/microtask_queue';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { captureInstalledLuaSources, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { parseLuaChunk } from './cpu_test_harness';
import { getActiveTab, getTabs, openEditorTab, setActiveTab } from '../../ide/workbench/ui/tabs';
import { createCodeEditorInput, retainEntryTabContext } from '../../ide/workbench/ui/code_tab/contexts';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';

const pixels = { width: 2, height: 1, pixels: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) };
const bounds = { left: 0, top: 10, right: 140, bottom: 100 };
const otherBounds = { left: 140, top: 10, right: 220, bottom: 100 };

function fixture(t: TestContext, commands: EditorCommandRunner = { isEnabled: () => true, execute() {} }, variant: FontVariant = 'tiny',
	decode: ImageDecoder = async () => pixels) {
	let changes = 0, wheel = 0, selections = 0, decodes = 0;
	let ownerBounds = bounds;
	const previousFont = editorViewState.font;
	editorViewState.font = new EditorFont(variant);
	const previousCommands = inputFocus.workbenchScope.commands;
	inputFocus.workbenchScope.commands = commands;
	const surfaces = new WorkbenchSurfaceService(() => { changes++; });
	const owner = surfaces.attach({
		role: 'content', captureScope: Symbol('image pane'), isVisible: () => true,
		getBounds: () => ownerBounds, getClip: () => ownerBounds, draw() {},
		handlePointer() { selections++; }, handleWheel() { wheel++; return true; },
	});
	const other = surfaces.attach({
		role: 'content', captureScope: Symbol('unrelated pane'), isVisible: () => true,
		getBounds: () => otherBounds, getClip: () => otherBounds, draw() {},
	});
	const cache = new ImagePreviewCache((...args) => { decodes++; return decode(...args); });
	const preview = new ImagePreviewOverlay(cache, surfaces, owner, commands);
	const origin = inputFocus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	const layout = (area: typeof bounds, rowHeight: number) => { ownerBounds = area; preview.layout(area, rowHeight); };
	layout(bounds, 6);
	t.after(() => {
		preview.dispose(); cache.dispose(); surfaces.dispose(); inputFocus.setTarget(null);
		inputFocus.workbenchScope.commands = previousCommands;
		editorViewState.font = previousFont;
		pointerCapture.cancel();
	});
	return { preview, cache, surfaces, owner, other, origin, layout,
		changes: () => changes, wheel: () => wheel, selections: () => selections, decodes: () => decodes };
}

/** A real workbench is required when the contract includes application shortcut admission. */
function workbenchFixture(t: TestContext) {
	const source = 'return 42', path = 'lightbox.lua';
	const image = linkTestSystemBlua32(compileLuaChunkToProgram(parseLuaChunk(source, path), [],
		{ entrySource: source, programDomain: 'system', optLevel: 0 }));
	const host = createHostFrameFixture(createTestRuntime(image.romBytes)); host.runtime.boot();
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: path,
		projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'lightbox', type: 'lua', src: source, base_src: source,
		source_path: path, normalized_source_path: path, module_path: 'lightbox', update_timestamp: 0,
		base_update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports,
		captureInstalledLuaSources(registry)), cartridgeSlots: [null, null] };
	const unused = (): never => { throw new Error('Lightbox keyboard routing does not request domain work.'); };
	const ide = new RuntimeIdeState(host.runtime, host.presenter, { capture: unused }, unused,
		{ measureDisplay: () => ({ left: 0, top: 0, width: editorViewState.viewportWidth, height: editorViewState.viewportHeight }) },
		host.input, host.audio, host.tasks, host.execution, host.rewind, host.clock, new HeadlessClipboard(),
		new IdeMicrotaskQueue(), { log() {} }, 0.3, { width: 384, height: 288 }, sources, new Map(), unused, unused, unused);
	const editor = ide.editor;
	openEditorTab(editor.editorPanes, createCodeEditorInput(retainEntryTabContext(sources)));
	editorRuntimeState.active = true; editor.update(0);
	const cache = new ImagePreviewCache(async () => pixels);
	const preview = new ImagePreviewOverlay(cache, editor.surfaces, editor.paneSurface, editor.commands);
	preview.layout(bounds, 6);
	t.after(async () => {
		preview.dispose(); cache.dispose(); inputFocus.setTarget(null);
		await editor.shutdown(); host.audio.dispose(); host.input.dispose();
	});
	return { editor, preview };
}

test('the isolated lightbox admits only explicit tab commands, closing and returning focus before their actual workbench runner', t => {
	const { editor, preview } = workbenchFixture(t), sourceTab = getActiveTab()!;
	openEditorTab(editor.editorPanes, new GameViewInput()); openEditorTab(editor.editorPanes, new HostErrorInput('Diagnostic'));
	setActiveTab(editor.editorPanes, sourceTab.id); editor.update(0);
	const order: string[] = [], executed: EditorCommandId[] = [];
	let origin = inputFocus.target!;
	const execute = editor.commands.execute;
	t.mock.method(editor.commands, 'execute', (command, target) => {
		assert.equal(preview.visible, false, 'the image must close before a tab action changes its owner');
		assert.ok(inputFocus.target === origin, 'the actual originating control must regain focus before execution');
		assert.ok(target === origin, 'the tab action keeps its captured origin, not the retired modal');
		assert.equal(inputFocus.commandRunner, editor.commands);
		executed.push(command); order.push(command);
		execute.call(editor.commands, command, target);
	});
	for (const [code, modifiers, command] of [
		['KeyW', KeyModifier.ctrl, 'tabs.close'],
		['Tab', KeyModifier.ctrl, 'tabs.next'],
		['Tab', KeyModifier.ctrl | KeyModifier.shift, 'tabs.previous'],
	] as const) {
		origin = inputFocus.target!;
		const before = getTabs().slice(), active = getActiveTab();
		const unbind = origin.onDidFocus(() => {
			assert.equal(preview.visible, false, 'return-focus publication cannot expose an open lightbox');
			order.push('return origin');
		});
		preview.open('image');
		const modal = inputFocus.target;
		assert.equal(inputFocus.commandRunner, undefined, 'the modal must not inherit the application command route');
		for (const [blockedCode, blockedModifiers] of [
			['KeyS', KeyModifier.ctrl], ['KeyP', KeyModifier.ctrl | KeyModifier.shift],
		] as const) {
			const event = new KeyInputEvent(blockedCode, blockedModifiers);
			editor.dispatchKey(event);
			assert.equal(preview.visible, true); assert.ok(inputFocus.target === modal);
			assert.equal(editor.quickInput.visible, false);
			assert.deepEqual(order, [], 'Save or Palette borrowed the underlying application command route');
		}
		const event = new KeyInputEvent(code, modifiers);
		editor.dispatchKey(event); unbind(); editor.update(0);
		assert.equal(event.consumed, true);
		assert.deepEqual(order, ['return origin', command]);
		assert.notEqual(getActiveTab(), active, 'the real workbench performs the admitted tab operation');
		if (command === 'tabs.close') { assert.equal(getTabs().length, before.length - 1); assert.ok(!getTabs().includes(active!)); }
		else assert.deepEqual(getTabs(), before);
		order.length = 0;
	}
	assert.deepEqual(executed, ['tabs.close', 'tabs.next', 'tabs.previous']);
});

test('a disabled explicit tab command is consumed without closing or escaping the isolated lightbox', t => {
	const { editor, preview } = workbenchFixture(t), active = getActiveTab();
	assert.equal(getTabs().length, 1); assert.equal(editor.commands.isEnabled('tabs.next'), false);
	const execute = t.mock.method(editor.commands, 'execute');
	preview.open('image');
	const modal = inputFocus.target;
	assert.equal(inputFocus.commandRunner, undefined);
	const event = new KeyInputEvent('Tab', KeyModifier.ctrl);
	editor.dispatchKey(event);
	assert.equal(event.consumed, true); assert.equal(execute.mock.callCount(), 0);
	assert.equal(preview.visible, true); assert.ok(inputFocus.target === modal); assert.ok(getActiveTab() === active);
});

test('the shared lightbox owns local pointer and wheel admission rather than asking each pane to block', t => {
	const f = fixture(t);
	assert.equal(f.surfaces.hitTest(40, 40), f.owner);
	f.preview.open('image');
	assert.equal(inputFocus.target!.scope.surfaceScope, f.preview.surface.captureScope,
		'keyboard, clipboard and command admission use the same local modal surface as pointer targeting');
	assert.equal(f.preview.surface.lifetimeOwner, f.owner);
	assert.equal(f.preview.surface.presentationParent, f.owner);
	assert.equal(f.surfaces.isAdmitted(f.owner), false);
	assert.equal(f.surfaces.isAdmitted(f.preview.surface), true);
	assert.equal(f.surfaces.isAdmitted(f.other), true);
	assert.equal(f.surfaces.hitTest(160, 40), f.other, 'the modal blocks only the owning pane');
	const hit = f.surfaces.hitTest(40, 40)!;
	assert.equal(hit, f.preview.surface);
	hit.handleWheel?.({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40, deltaX: 0, deltaY: 1, modifiers: KeyModifier.none });
	assert.equal(f.wheel(), 0, 'an unhandled wheel stays with the opaque lightbox rather than the underlying pane');
	hit.handlePointer!({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40,
		spaceDown: false, modifiers: KeyModifier.none, pressedButtons: PointerButton.Secondary,
		justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0 }, 1);
	assert.equal(f.preview.visible, true, 'secondary input is blocked, not forwarded or treated as primary dismissal');
	assert.equal(f.selections(), 0);
	hit.handlePointer!({ valid: true, insideViewport: true, viewportX: 40, viewportY: 40,
		spaceDown: false, modifiers: KeyModifier.none, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 }, 2);
	assert.equal(f.preview.visible, false);
	assert.equal(f.selections(), 0, 'the dismissing occurrence is never replayed into the underlying pane');
	assert.equal(inputFocus.target, f.origin);
	assert.equal(f.surfaces.isAdmitted(f.owner), true);
});

test('Escape and Enter dismiss from lightbox focus while replacement and retirement preserve correct focus ownership', t => {
	const f = fixture(t);
	assert.equal(f.preview.origin, null);
	for (const code of ['Escape', 'Enter']) {
		f.preview.open('first');
		assert.equal(f.preview.origin, f.origin, 'the modal exposes its actual captured return relationship');
		f.preview.open('second');
		assert.equal(f.preview.origin, f.origin, 'replacing pixels does not replace the actual originating control');
		const event = new KeyInputEvent(code, KeyModifier.none);
		inputFocus.handleKeyboard(event);
		assert.equal(event.consumed, true);
		assert.equal(f.preview.visible, false);
		assert.equal(f.preview.origin, null);
		assert.equal(inputFocus.target, f.origin, 'replacing the image does not replace the return target with the modal itself');
	}
	f.preview.open('image');
	const elsewhere = inputFocus.createTarget(); elsewhere.bindKeyboard(() => {}); elsewhere.focus();
	f.preview.close();
	assert.equal(inputFocus.target, elsewhere, 'closing a local lightbox cannot steal focus back from another active surface');
	f.origin.focus(); f.preview.open('image');
	f.owner.dispose();
	assert.equal(f.preview.visible, false);
	assert.equal(f.preview.surface.retired, true);
	assert.equal(inputFocus.target, f.origin);
	assert.equal(f.surfaces.findByScope(f.preview.surface.captureScope), undefined);
});

test('only changed lightbox geometry and visibility publish invalidation, and separate surface painting retains its decoded bitmap', async t => {
	const f = fixture(t), renderer = createHostOverlayFixture(220, 110);
	const changes = f.changes();
	for (let frame = 0; frame < 100; frame++) f.layout(bounds, 6);
	assert.equal(f.changes(), changes, 'unchanged layout does not rebuild or publish surface state');
	f.preview.open('image'); await Promise.resolve();
	for (let frame = 0; frame < 4; frame++) {
		f.cache.beginFrame();
		// The pane completes its thumbnail frame before root-owned lightbox paint.
		f.cache.endFrame();
		renderer.renderer.beginFrame(renderer.presenter); api.beginFrame(renderer.renderer);
		f.surfaces.draw(api); renderer.renderer.endFrame();
		assert.ok(renderer.queue.consumeOverlayFrame().commandCount > 0);
	}
	assert.equal(f.decodes(), 1, 'drawing a root-owned overlay after its pane frame reuses the attached image');
	const expanded = { ...bounds, right: 180 };
	f.layout(expanded, 6);
	assert.equal(f.changes(), changes + 2, 'opening and one geometry change each publish once');
	assert.equal(f.preview.surface.getBounds().right, 180);
	f.preview.close();
	const closed = f.changes(); f.preview.close();
	assert.equal(f.changes(), closed, 'closing an already absent lightbox is not a structural change');
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} minimum lightbox captions fit their actual modal surface and clean frames never remeasure`, t => {
		const previousTheme = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme);
		t.after(() => colors.setIdeThemeVariant(previousTheme));
		const f = fixture(t, undefined, variant), narrow = { ...bounds, right: variant === 'tiny' ? 78 : 118, bottom: 180 };
		f.layout(narrow, editorViewState.font.lineHeight);
		const overlay = createHostOverlayFixture(220, 180), font = editorViewState.font, advance = font.advance.bind(font);
		let measurements = 0;
		t.mock.method(font, 'advance', char => { measurements++; return advance(char); });
		f.preview.open('image');
		const paint = () => {
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
			return overlay.queue.consumeOverlayFrame();
		};
		const frame = paint(), labels: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			assert.equal(typeof run.items, 'string');
			const label = run.items as string; labels.push(label);
			assert.ok(run.x >= narrow.left + 8 && run.x + run.font!.measure(label) <= narrow.right - 8,
				`actual painted caption '${label}' fits the modal's padded width`);
		}
		assert.ok(labels.includes('Image preview')); assert.ok(labels.includes('Click/Esc close'));
		assert.ok(measurements > 0, 'the newly exposed loading state is measured once');
		const measured = measurements, changes = f.changes();
		for (let frame = 0; frame < 50; frame++) { f.layout(narrow, font.lineHeight); paint(); }
		assert.equal(measurements, measured); assert.equal(f.changes(), changes);
		editorViewState.font = new EditorFont(variant); f.layout(narrow, font.lineHeight);
		assert.equal(f.changes(), changes + 1, 'font identity, not only line height, owns caption invalidation');
	});
}

async function scrollableError(t: TestContext) {
	const reason = 'Image header failed.\nToken_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 expected PNG signature.\nFinal decoder explanation suffix.';
	const pending = Promise.reject(new Error(reason)), f = fixture(t, undefined, 'msx', () => pending);
	const compact = { left: 0, top: 24, right: 118, bottom: 80 };
	f.layout(compact, 8); f.preview.open('scrollable-error'); await pending.catch(() => {});
	const overlay = createHostOverlayFixture(384, 288);
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), lines: string[] = [], area = f.preview.surface.getBounds();
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			if (run.y === area.top + 8 || run.y === area.bottom - editorViewState.font.lineHeight - 6) continue;
			assert.equal(typeof run.items, 'string'); lines.push(run.items as string);
		}
		return lines;
	};
	const key = (code: string) => {
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none));
		inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	return { ...f, reason: `Error: ${reason}`, compact, paint, key };
}

test('the complete error remains keyboard-readable through newlines and long tokens in a two-line body', async t => {
	const f = await scrollableError(t);
	let previous = f.paint(), read = previous.join('');
	assert.equal(previous.length, 2);
	for (let step = 0; step < f.reason.length; step++) {
		f.key('ArrowDown'); const current = f.paint();
		if (current.join('') === previous.join('')) break;
		read += current.at(-1)!; previous = current;
	}
	assert.equal(read.replace(/\s/g, ''), f.reason.replace(/\s/g, ''));
	assert.ok(!read.includes(ELLIPSIS));
	f.key('Home'); assert.ok(f.paint()[0].startsWith('Error:'));
	f.key('PageDown'); assert.ok(!f.paint()[0].startsWith('Error:'));
	f.key('End'); assert.ok(f.paint().join(' ').endsWith('suffix.'));
	f.key('PageUp'); assert.ok(!f.paint().join(' ').endsWith('suffix.'));
});

test('End intent survives fitting content, height-only changes, font reflow and a temporarily hidden body', async t => {
	const f = await scrollableError(t), font = editorViewState.font, advance = font.advance.bind(font);
	let measures = 0; t.mock.method(font, 'advance', char => { measures++; return advance(char); });
	f.paint(); const measured = measures;
	f.layout({ ...f.compact, bottom: 274 }, 8); f.key('End');
	f.layout(f.compact, 8); assert.ok(f.paint().join(' ').endsWith('suffix.'));
	f.layout({ ...f.compact, bottom: f.compact.top }, 8); f.key('Home');
	f.layout(f.compact, 8); assert.ok(f.paint()[0].startsWith('Error:'));
	f.layout({ ...f.compact, top: 26, bottom: 82 }, 8); f.paint();
	assert.equal(measures, measured, 'height and position only project the existing complete text document');
	f.key('End'); editorViewState.font = new EditorFont('tiny');
	f.layout(f.compact, 6); assert.ok(f.paint().join(' ').endsWith('suffix.'));
});

test('body wheel and its visible track scroll without dismissing, retain modal scope and cancel before close', async t => {
	const f = await scrollableError(t); f.paint();
	const event = { valid: true, insideViewport: true, viewportX: 20, viewportY: 48, deltaX: 0, deltaY: 1, modifiers: KeyModifier.none };
	assert.equal(f.preview.surface.handleWheel!(event), true); assert.equal(f.preview.visible, true);
	assert.ok(!f.paint()[0].startsWith('Error:')); f.key('Home');
	const down = { ...event, viewportX: 108, viewportY: 45, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	const scope = f.preview.surface.captureScope;
	pointerCapture.beginRoute(scope, down); f.preview.surface.handlePointer!(down, 1);
	assert.equal(pointerCapture.active, true); assert.equal(f.preview.visible, true); assert.equal(inputFocus.target!.scope.surfaceScope, scope);
	pointerCapture.dispatch({ ...down, viewportY: 59, justPressedButtons: 0 }, false, 2, scope);
	assert.ok(f.paint().join(' ').endsWith('suffix.'));
	f.preview.close(); assert.equal(pointerCapture.active, false); assert.equal(inputFocus.target, f.origin);
	const up = { ...down, viewportY: 59, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary };
	pointerCapture.dispatch(up, false, 3, scope); pointerCapture.endRoute(up);
	assert.equal(f.preview.visible, false); assert.equal(inputFocus.target, f.origin);
});

test('new messages reset old End intent while geometry retirement cancels an actual body capture', async t => {
	const f = await scrollableError(t); f.key('End'); assert.ok(f.paint().join(' ').endsWith('suffix.'));
	f.preview.open('new-error-generation'); await Promise.resolve();
	assert.ok(f.paint()[0].startsWith('Error:'));
	const down = { valid: true, insideViewport: true, viewportX: 108, viewportY: 45, spaceDown: false, modifiers: KeyModifier.none,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	f.preview.surface.handlePointer!(down, 1); assert.equal(pointerCapture.active, true);
	f.layout({ ...f.compact, bottom: 88 }, 8); assert.equal(pointerCapture.active, false); assert.equal(f.preview.visible, true);
	f.key('Escape'); assert.equal(f.preview.visible, false); assert.equal(inputFocus.target, f.origin);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} a zero-height or compressed body produces no inverted bitmap quad or chrome overlap`, async t => {
	const f = fixture(t, undefined, variant), overlay = createHostOverlayFixture(220, 110);
	f.preview.open('bitmap'); await Promise.resolve();
	for (const height of [0, 24]) {
		f.layout({ left: 0, top: 24, right: variant === 'tiny' ? 78 : 118, bottom: 24 + height }, editorViewState.font.lineHeight);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); let bitmaps = 0, emptyClips = 0;
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Bitmap) {
				const { area } = frame.commandRefs[index] as HostBitmapRenderSubmission;
				assert.equal(area.top, area.bottom); assert.equal(area.left, area.right); bitmaps++;
			}
			if (frame.commandKinds[index] === Host2DKind.Clip) {
				const clip = frame.commandRefs[index] as typeof bounds;
				assert.ok(clip.left <= clip.right && clip.top <= clip.bottom);
				if (clip.top === clip.bottom) emptyClips++;
			}
		}
		assert.equal(bitmaps, 1); assert.ok(emptyClips > 0, 'the bitmap remains in its genuinely empty body clip');
	}
});

test('loading and an asynchronous decode error are each measured once, with status geometry invalidated by width or font', async t => {
	const pending = Promise.withResolvers<Awaited<ReturnType<ImageDecoder>>>();
	const f = fixture(t, undefined, 'tiny', () => pending.promise), narrow = { ...bounds, right: 78, bottom: 180 };
	f.layout(narrow, 6); f.preview.open('unavailable-image');
	const overlay = createHostOverlayFixture(220, 180), font = editorViewState.font, advance = font.advance.bind(font);
	let measurements = 0;
	t.mock.method(font, 'advance', char => { measurements++; return advance(char); });
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), labels: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			assert.equal(typeof run.items, 'string'); const label = run.items as string; labels.push(label);
			assert.ok(run.x + run.font!.measure(label) <= f.preview.surface.getBounds().right - 8);
		}
		return labels;
	};
	paint(); const loading = measurements;
	for (let frame = 0; frame < 50; frame++) paint(); assert.equal(measurements, loading);
	pending.reject(new Error('The attached image could not be decoded because its encoded PNG image bytes are unavailable'));
	await pending.promise.catch(() => {});
	assert.ok(paint().some(label => label.startsWith('Error:'))); const unavailable = measurements;
	assert.ok(unavailable > loading);
	for (let frame = 0; frame < 50; frame++) paint(); assert.equal(measurements, unavailable);
	f.layout(bounds, 6); paint(); assert.ok(measurements > unavailable);
	const expanded = measurements; for (let frame = 0; frame < 50; frame++) paint(); assert.equal(measurements, expanded);
});

test('a real Node PNG decode reaches the modal bitmap and remains leased while its transcript thumbnail is offscreen', async t => {
	const url = await encodePngImage(pixels), decoded = await decodeImage(url, 512, 512);
	const f = fixture(t), resource = f.cache.use(url, decoded), overlay = createHostOverlayFixture(220, 110);
	let disposed = 0; resource.bitmap!.onDispose(() => { disposed++; });
	f.preview.open(url); assert.equal(resource.retained, 1);
	for (let frame = 0; frame < 4; frame++) {
		f.cache.beginFrame(); f.cache.endFrame();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const commands = overlay.queue.consumeOverlayFrame(); let found = false;
		for (let index = 0; index < commands.commandCount; index++) if (commands.commandKinds[index] === Host2DKind.Bitmap) {
			const submission = commands.commandRefs[index] as HostBitmapRenderSubmission;
			assert.equal(submission.bitmap.image, decoded); assert.deepEqual([...submission.bitmap.image.pixels], [...pixels.pixels]); found = true;
		}
		assert.equal(found, true); assert.equal(resource.retired, false); assert.equal(disposed, 0);
	}
	assert.equal(f.decodes(), 0, 'already decoded producer pixels are not decoded again for modal presentation');
	f.preview.close(); f.cache.beginFrame(); f.cache.endFrame(); assert.equal(resource.retired, true); assert.equal(disposed, 1);
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} minimum modal wraps the complete real PNG decode error within its body`, async t => {
		const previousTheme = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme);
		t.after(() => colors.setIdeThemeVariant(previousTheme));
		let decoding!: ReturnType<ImageDecoder>;
		const f = fixture(t, undefined, variant, (...args) => { decoding = decodeImage(...args); return decoding; });
		const narrow = { left: 0, top: 24, right: variant === 'tiny' ? 78 : 118, bottom: 260 };
		const url = 'data:image/png;base64,aW52YWxpZA==';
		f.layout(narrow, editorViewState.font.lineHeight); f.preview.open(url); await decoding.catch(() => {});
		const reason = f.cache.use(url).error!;
		assert.ok(reason.length >= 40, 'the real decoder supplies a reason longer than a narrow line');
		const overlay = createHostOverlayFixture(384, 288), font = editorViewState.font.renderFont();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), lines: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			if (run.y === narrow.top + 8 || run.y === narrow.bottom - font.lineHeight - 6) continue;
			assert.equal(typeof run.items, 'string'); const text = run.items as string; lines.push(text);
			assert.ok(run.x >= narrow.left + 10 && run.x + font.measure(text) <= narrow.right - 10);
			assert.ok(run.y >= narrow.top + font.lineHeight + 12 && run.y + font.lineHeight <= narrow.bottom - font.lineHeight - 12,
				'error rows stay between the actual heading and close-hint regions');
		}
		assert.ok(lines.length > 1, 'the explanation uses the available body, not a one-line truncation');
		assert.equal(lines.join('').replace(/\s/g, ''), reason.replace(/\s/g, ''));
		assert.ok(lines.every(line => !line.includes(ELLIPSIS)), 'this common PNG reason fits without loss');
	});
}
