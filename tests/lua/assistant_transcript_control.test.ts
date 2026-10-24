import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { decodeImage, encodeScreenshotPng } from '../../hosts/node/headless/screenshot';
import * as colors from '../../ide/common/constants';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { measureStyledText } from '../../ide/editor/render/markdown';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { AssistantTranscriptControl } from '../../ide/workbench/contrib/assistant/transcript_control';
import { AssistantAttachmentStrip } from '../../ide/workbench/contrib/assistant/attachment_strip';
import { AssistantAttachments } from '../../ide/workbench/contrib/assistant/attachments';
import { ConversationObserverInput } from '../../ide/workbench/contrib/conversations/editor_input';
import { ObservedConversation } from '../../ide/workbench/services/assistant/observed_conversation';
import type { AssistantEntry } from '../../ide/workbench/services/assistant/transcript';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ImagePreviewCache } from '../../ide/workbench/ui/image_preview';
import { ImagePreviewOverlay } from '../../ide/workbench/ui/image_preview_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { RectRenderKind } from '../../machine/ts/render/shared/submissions';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createTestRuntime } from '../helpers/runtime_sources';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { compileLuaSource } from './cpu_test_harness';
import { contrastRatio } from '../helpers/contrast.mjs';

const FIRST = `data:image/png;base64,${readFileSync(join(__dirname, '../../carts/nemesis_s/res/img/title_screen_1@atlas=title.png')).toString('base64')}`;
const SECOND = `data:image/png;base64,${readFileSync(join(__dirname, '../../carts/nemesis_s/res/img/intro_konami@atlas=intro.png')).toString('base64')}`;
const captureDirectory = process.env.BMSX_UI_CAPTURE_DIR;
const captureRuntime = captureDirectory === undefined ? undefined : createTestRuntime(linkTestSystemBlua32(compileLuaSource('return nil', 'transcript_image', 0)).romBytes);
if (captureDirectory !== undefined) mkdirSync(captureDirectory, { recursive: true });

/** Typed transcript publication, deliberately without a provider, connection factory or tool authority. */
class TranscriptProducer extends ObservedConversation {
	public message(text: string, images?: readonly string[]): AssistantEntry { return this.append('assistant', text, undefined, undefined, images); }
	public proposal(proposal: WorkspaceEditProposal): AssistantEntry { return this.append('proposal', proposal.title, proposal); }
	public reset(): void { this.resetTranscript(); }
	public prepend(text: string, images?: readonly string[]): AssistantEntry {
		const entry: AssistantEntry = { kind: 'assistant', text: new PieceTreeBuffer(text), images, index: 0, resetRevision: 0 };
		this.entries.unshift(entry);
		for (let index = 0; index < this.entries.length; index++) this.entries[index].index = index;
		this.changed(1, 'prepend'); return entry;
	}
	public replace(entry: AssistantEntry, text: string): void {
		entry.text.replace(0, entry.text.length, text); entry.resetRevision++;
		this.changed(entry.index, 'text');
	}
}

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 384, theme = 'light', withReview = false) {
	const previousTheme = colors.getActiveIdeThemeVariant();
	configureFontVariant(new VirtualHeadlessClock(), variant, null); colors.setIdeThemeVariant(theme);
	const conversation = new TranscriptProducer(), input = new ConversationObserverInput(conversation), surfaces = new WorkbenchSurfaceService();
	const parent = inputFocus.createTarget(); parent.bindKeyboard(() => {});
	const composer = inputFocus.createTarget(parent); composer.bindKeyboard(() => {}); composer.focus();
	const overlay = createHostOverlayFixture(384, 288); overlay.presenter.initialize(new RenderPassLibrary(overlay.backend, overlay.presenter));
	const reads: Promise<unknown>[] = [], decoded: string[] = [];
	const cache = new ImagePreviewCache((url, maxWidth, maxHeight) => {
		decoded.push(url); const image = decodeImage(url, maxWidth, maxHeight); reads.push(image); return image;
	});
	const owner = surfaces.attach({ role: 'content', captureScope: parent.scope.surfaceScope, getBounds: () => input.layout,
		getClip: () => input.layout, isVisible: () => true, draw() {
			api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
			cache.beginFrame(); control.draw(); cache.endFrame();
		}, handlePointer(snapshot) { if (!control.handleSelection(snapshot)) control.scroll.handlePointer(snapshot); } });
	const preview = new ImagePreviewOverlay(cache, surfaces, owner, { isEnabled: () => false, execute() { assert.fail('image inspection cannot run workbench commands'); } });
	const reviews: WorkspaceEditProposal[] = [];
	const control = new AssistantTranscriptControl(parent, cache, preview, withReview ? () => { reviews.push(input.selection.proposal!); } : undefined);
	control.setInput(input);
	const unbind = inputFocus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope); return surface !== undefined && surfaces.isAdmitted(surface);
	});
	const layout = (nextWidth = input.layout.right, nextVariant: 'tiny' | 'msx' = input.layout.font!.variant, bottom = input.layout.bottom) => {
		if (editorViewState.font.variant !== nextVariant) configureFontVariant(new VirtualHeadlessClock(), nextVariant, null);
		const changed = input.layout.right !== nextWidth || input.layout.font !== editorViewState.font || input.layout.bottom !== bottom
			|| input.layout.top !== 24 || input.layout.rowHeight !== editorViewState.lineHeight;
		Object.assign(input.layout, { left: 0, top: 24, right: nextWidth, bottom, font: editorViewState.font, rowHeight: editorViewState.lineHeight });
		input.transcript.update(conversation.entries, nextWidth - colors.SCROLLBAR_WIDTH - 16, measureStyledText, editorViewState.font);
		control.layout(28, bottom - 4, false, changed); preview.layout(input.layout, input.layout.rowHeight);
	};
	Object.assign(input.layout, { right: width, bottom: 260, font: editorViewState.font }); layout(width, variant);
	const key = (code: string, down = true, repeat = false, modifiers = KeyModifier.none) => {
		const event = new KeyInputEvent(code, modifiers, repeat, down); inputFocus.handleKeyboard(event); return event;
	};
	const press = (code: string) => { key(code); key(code, false); layout(); };
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		return overlay.queue.consumeOverlayFrame();
	};
	const tile = (entry: AssistantEntry, imageIndex: number) => {
		const row = input.transcript.getSelectionTop(entry, imageIndex), top = input.viewport.offsetTop + row * input.layout.rowHeight, frame = paint();
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] !== Host2DKind.Rect) continue;
			const rect = frame.commandRefs[index] as RectRenderSubmission;
			if (rect.kind === RectRenderKind.Fill && rect.color === resolveThemeTokenColor(colors.COLOR_MARKDOWN_CODE_BACKGROUND)
				&& rect.area.top >= top && rect.area.top < top + input.layout.rowHeight) return { ...rect.area };
		}
		assert.fail('the selected actual image tile must be painted before pointer targeting');
	};
	const pointer = (x: number, y: number, down: number = PointerButton.Primary, up = 0) => {
		const snapshot = { valid: true, insideViewport: true, viewportX: x, viewportY: y, spaceDown: false,
			modifiers: KeyModifier.none, pressedButtons: down & ~up, justPressedButtons: down, justReleasedButtons: up };
		if (!pointerCapture.dispatch(snapshot, false, 0)) surfaces.hitTest(x, y)?.handlePointer?.(snapshot, 0);
	};
	const capture = (label: string) => {
		if (captureDirectory === undefined) return;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		overlay.presenter.configurePresentation('completed', false);
		overlay.presenter.present(captureRuntime!.machine.gxGpu.readDeviceOutput(), 0, 0);
		writeFileSync(join(captureDirectory, `${label}.png`), encodeScreenshotPng(384, 288, overlay.backend.borrowPresentedPixels()));
	};
	t.after(() => { control.dispose(); preview.dispose(); cache.dispose(); unbind(); surfaces.dispose(); input.dispose(); conversation.dispose();
		pointerCapture.cancel(); inputFocus.setTarget(null); overlay.presenter.dispose(); colors.setIdeThemeVariant(previousTheme); });
	assert.equal(conversation.available, false);
	return { input, conversation, control, preview, cache, decoded, reviews, parent, composer, surfaces, owner, overlay,
		layout, key, press, paint, tile, pointer, capture, load: async () => { await Promise.allSettled(reads); } };
}

test('keyboard navigation reaches each real image slot; Enter/Space open only its image and return to transcript focus', async t => {
	const f = fixture(t), entry = f.conversation.message('**Original** Markdown', [FIRST, FIRST]), next = f.conversation.message('', [SECOND]);
	f.conversation.message('Final message'); f.layout(); f.control.scroll.focusTarget.focus();
	f.press('ArrowDown'); assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, undefined);
	assert.equal(f.control.scroll.focusTarget.clipboard!.copy!(), '**Original** Markdown');
	f.press('Enter'); assert.equal(f.preview.visible, false);
	for (const index of [0, 1]) {
		f.press('ArrowDown'); assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, index);
		assert.equal(f.control.scroll.focusTarget.clipboard!.copy!(), null, 'an image slot cannot replace the clipboard with empty/wrong message text');
		f.press(index === 0 ? 'Enter' : 'Space'); assert.equal(f.preview.visible, true); await f.load();
		assert.equal(f.cache.use(FIRST).retained, 1);
		f.press('Escape'); assert.equal(f.preview.visible, false); assert.equal(f.cache.use(FIRST).retained, 0);
		assert.equal(inputFocus.target, f.control.scroll.focusTarget); assert.equal(f.input.selection.imageIndex, index);
	}
	f.press('ArrowDown'); assert.equal(f.input.selection.entry, next); assert.equal(f.input.selection.imageIndex, 0);
	f.press('Enter'); await f.load(); assert.equal(f.cache.use(SECOND).retained, 1); f.press('Escape');
	assert.deepEqual(f.reviews, []); assert.equal(f.decoded.filter(url => url === FIRST).length, 1);
});

test('image press focuses its exact painted transcript target before capturing modal return focus', async t => {
	const f = fixture(t), entry = f.conversation.message('Two screenshots', [FIRST, SECOND]); f.layout();
	const bounds = f.tile(entry, 1); f.composer.focus();
	f.pointer(bounds.left + 2, bounds.top + 2); await f.load();
	assert.equal(f.preview.visible, true); assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 1);
	f.pointer(bounds.left + 2, bounds.top + 2, 0, PointerButton.Primary);
	assert.equal(f.preview.visible, true, 'the opening pointer release does not dismiss its new modal');
	f.press('Escape'); assert.equal(inputFocus.target, f.control.scroll.focusTarget);
	assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 1);
});

for (const variant of ['tiny', 'msx'] as const) for (const width of [384, variant === 'tiny' ? 78 : 118]) {
	test(`${variant}/${width} paint and pointer use the same tile including its edges, not the blank gutter or row padding`, t => {
		const f = fixture(t, variant, width), entry = f.conversation.message('', [FIRST]); f.layout();
		const bounds = f.tile(entry, 0);
		f.pointer(bounds.right + 1, bounds.top + 2); f.pointer(bounds.right + 1, bounds.top + 2, 0, PointerButton.Primary);
		assert.equal(f.preview.visible, false); assert.equal(f.input.selection.entry, undefined);
		f.pointer(bounds.left + 2, bounds.top - 1); f.pointer(bounds.left + 2, bounds.top - 1, 0, PointerButton.Primary);
		assert.equal(f.preview.visible, false);
		f.pointer(bounds.right - 1, bounds.top + 2); f.pointer(bounds.right - 1, bounds.top + 2, 0, PointerButton.Primary);
		assert.equal(f.preview.visible, true);
		f.press('Escape'); assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 0);
	});
}

test('opening key holds, repeats and late releases cannot dismiss or reopen an image or invoke Review', t => {
	const f = fixture(t, 'tiny', 384, 'light', true), entry = f.conversation.message('', [FIRST]); f.layout();
	f.control.scroll.focusTarget.focus(); f.press('ArrowDown');
	assert.equal(f.key('Enter').consumed, true); assert.equal(f.preview.visible, true);
	f.key('Enter', true, true); assert.equal(f.preview.visible, true);
	f.key('Enter', false); assert.equal(f.preview.visible, true);
	f.press('Escape'); assert.equal(f.preview.visible, false); assert.equal(f.input.selection.entry, entry);
	f.key('Enter'); assert.equal(f.preview.visible, true);
	f.press('Escape'); assert.equal(f.preview.visible, false);
	f.key('Enter', true, true); assert.equal(f.preview.visible, false, 'a held opening key cannot reopen after Escape returned focus');
	f.key('Enter', false); assert.equal(f.preview.visible, false); assert.deepEqual(f.reviews, []);
	const modified = f.key('Enter', true, false, KeyModifier.ctrl); assert.equal(modified.consumed, false); assert.equal(f.preview.visible, false);
	f.key('Enter', false, false, KeyModifier.ctrl);
});

test('prepend retains the exact open slot; reset retires it before a same-index, same-URL replacement', async t => {
	const f = fixture(t), entry = f.conversation.message('Original', [FIRST, FIRST]); f.layout();
	f.input.selection.select(entry, 1); f.control.scroll.focusTarget.focus(); f.press('Enter'); await f.load();
	const preview = f.cache.use(FIRST); assert.equal(preview.retained, 1);
	f.conversation.prepend('Older page', [FIRST]); f.layout();
	assert.equal(f.preview.visible, true); assert.equal(f.input.selection.entry, entry); assert.equal(entry.index, 1); assert.equal(f.input.selection.imageIndex, 1);
	assert.equal(preview.retained, 1); f.conversation.reset();
	assert.equal(f.preview.visible, false); assert.equal(f.input.selection.entry, undefined); assert.equal(preview.retained, 0);
	const replacement = f.conversation.message('Replacement', [FIRST, FIRST]); f.layout();
	f.key('Enter', false); assert.equal(f.preview.visible, false); assert.notEqual(replacement, entry); assert.equal(f.input.selection.entry, undefined);
});

test('detach closes the image before releasing transcript focus and removes the old target subscription', async t => {
	const f = fixture(t), entry = f.conversation.message('', [FIRST]); f.layout();
	f.input.selection.select(entry, 0); f.control.scroll.focusTarget.focus(); f.press('Enter'); await f.load();
	f.control.clearInput(); assert.equal(f.preview.visible, false); assert.equal(f.control.scroll.focusTarget.hasFocus, false);
	assert.equal(f.cache.use(FIRST).retained, 0);
	const otherConversation = new TranscriptProducer(), other = new ConversationObserverInput(otherConversation);
	t.after(() => { other.dispose(); otherConversation.dispose(); });
	const target = otherConversation.message('', [SECOND]);
	Object.assign(other.layout, f.input.layout); f.control.setInput(other);
	other.transcript.update(otherConversation.entries, 360, measureStyledText, editorViewState.font);
	other.selection.select(target, 0); f.control.scroll.focusTarget.focus(); f.key('Enter'); assert.equal(f.preview.visible, true);
	f.input.selection.select(undefined); assert.equal(f.preview.visible, true, 'the detached input cannot retire another attached subject');
	f.key('Enter', false); f.key('Escape'); assert.equal(f.preview.visible, false);
});

test('transcript selection and detach cannot retire an actual draft-attachment preview with another origin', t => {
	const f = fixture(t), entry = f.conversation.message('', [SECOND]), attachments = new AssistantAttachments();
	attachments.set([FIRST]); f.layout();
	const strip = new AssistantAttachmentStrip(f.cache, url => f.preview.open(url)); strip.setInput(attachments);
	strip.layout(4, 180, 300, f.input.layout.rowHeight); t.after(() => strip.clearInput());
	strip.focusTarget.focus(); f.key('Enter'); f.key('Enter', false);
	assert.equal(f.preview.visible, true); assert.equal(f.preview.origin, strip.focusTarget);
	f.input.selection.select(entry, 0); assert.equal(f.preview.visible, true, 'a transcript target change does not own the draft subject');
	f.control.clearInput(); assert.equal(f.preview.visible, true, 'detaching transcript controls does not own the draft subject');
	f.key('Escape'); assert.equal(f.preview.visible, false); assert.equal(inputFocus.target, strip.focusTarget);
});

test('a painted image keeps its exact entry when a page is prepended before the next layout', t => {
	const f = fixture(t), entry = f.conversation.message('Painted entry', [FIRST]); f.layout();
	const bounds = f.tile(entry, 0), older = f.conversation.prepend('New index zero', [SECOND]);
	// No intervening layout: the physical pointer still addresses the exact old painted card.
	f.pointer(bounds.left + 2, bounds.top + 2); f.pointer(bounds.left + 2, bounds.top + 2, 0, PointerButton.Primary);
	assert.equal(f.preview.visible, true); assert.equal(f.input.selection.entry, entry); assert.notEqual(f.input.selection.entry, older);
	assert.equal(f.input.selection.imageIndex, 0); assert.equal(f.cache.use(FIRST).retained, 1);
	f.press('Escape'); f.conversation.reset(); f.conversation.message('Replacement at the same index', [FIRST]);
	f.pointer(bounds.left + 2, bounds.top + 2); f.pointer(bounds.left + 2, bounds.top + 2, 0, PointerButton.Primary);
	assert.equal(f.preview.visible, false, 'reset retires old painted rows before a same-index replacement can inherit a click');
	assert.equal(f.input.selection.entry, undefined);
});

test('focused image follows same-entry text growth, but manual scrolling remains in control through font reflow', t => {
	const f = fixture(t), entry = f.conversation.message('Caption', [FIRST]);
	for (let index = 0; index < 40; index++) f.conversation.message(`Later message ${index}`);
	f.layout(); f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('ArrowDown');
	f.conversation.replace(entry, '> '.repeat(80) + 'Long wrapped message '.repeat(100)); f.layout();
	const visible = () => {
		const top = f.input.transcript.getSelectionTop(entry, 0) * f.input.layout.rowHeight;
		return top >= f.input.viewport.scrollTop && top + 6 * f.input.layout.rowHeight <= f.input.viewport.scrollTop + f.input.viewport.height;
	};
	assert.ok(visible(), 'same-entry updates cannot leave its focused image offscreen');
	f.press('Home'); assert.equal(f.input.viewport.scrollTop, 0);
	f.layout(118, 'msx'); assert.equal(f.input.viewport.scrollTop, 0, 'font reflow cannot reactivate selection-follow after an admitted manual scroll');
	assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 0);
	f.press('ArrowDown'); f.press('ArrowUp'); assert.ok(visible(), 'new explicit target navigation resumes selection-follow');
});

test('warm focused reveal through a fractional-row viewport does not rematerialize its source rows', t => {
	const f = fixture(t), entry = f.conversation.message('Long source '.repeat(100), [FIRST]);
	for (let index = 0; index < 40; index++) f.conversation.message(`Later ${index}`);
	f.layout(118, 'tiny', 259); f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('ArrowDown');
	assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 0);
	assert.ok(f.input.viewport.scrollTop > 0);
	const append = t.mock.fn(f.input.transcript.rows.push.bind(f.input.transcript.rows)), advance = t.mock.method(editorViewState.font, 'advance');
	f.input.transcript.rows.push = append;
	for (let index = 0; index < 1000; index++) f.layout();
	assert.equal(append.mock.callCount(), 0, 'steady focused frames do not rebuild the visible row list');
	assert.equal(advance.mock.callCount(), 0, 'steady focused frames do not measure text or thumbnail captions');
});

test('only an explicitly selected proposal message invokes the real source Review callback', t => {
	const f = fixture(t, 'tiny', 384, 'light', true), models = new EditorTextModelService(), source = 'return before\n';
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('review.lua', 1, source)]), model = models.retain(sources.luaResources[0], 'lua', source);
	const proposal = new WorkspaceEditProposal('Review source', new WorkspaceSourceContext(models, sources), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 7, deleteLength: 6, text: 'after' }] }]]),
	});
	t.after(() => { proposal.dispose(); models.clear(); });
	f.conversation.message('Ordinary reply'); const entry = f.conversation.proposal(proposal); f.layout();
	f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('Enter'); assert.deepEqual(f.reviews, []);
	f.press('ArrowDown'); assert.equal(f.input.selection.entry, entry); f.press('Enter'); assert.deepEqual(f.reviews, [proposal]);
	assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false); assert.equal(proposal.state, 'pending');
});

test('focused image identity and visibility survive real font/width reflow without decoding offscreen history', async t => {
	const f = fixture(t);
	f.conversation.message(`> ${'source words '.repeat(300)}`);
	const entry = f.conversation.message('Three distinct image slots', [FIRST, FIRST, FIRST]);
	for (let index = 0; index < 100; index++) f.conversation.message(`Unexposed history ${index}`);
	f.conversation.message('Offscreen image', [SECOND]); f.layout(); f.control.scroll.focusTarget.focus();
	for (let step = 0; step < 5; step++) f.press('ArrowDown');
	assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 2);
	for (const [width, variant] of [[384, 'tiny'], [78, 'tiny'], [118, 'msx'], [384, 'msx']] as const) {
		f.layout(width, variant); f.paint(); await f.load();
		const top = f.input.transcript.getSelectionTop(entry, 2) * f.input.layout.rowHeight;
		assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 2);
		assert.ok(top >= f.input.viewport.scrollTop && top + 6 * f.input.layout.rowHeight <= f.input.viewport.scrollTop + f.input.viewport.height,
			'the focused image tile remains fully visible after predecessor wrapping changes');
	}
	assert.deepEqual(f.decoded, [FIRST], 'only exposed thumbnails decode; duplicate slots reuse one bitmap');
});

test('loading and real decode failures stay on the exact selected slot and use the existing modal feedback', async t => {
	const f = fixture(t, 'msx', 118), url = 'data:image/png;base64,bm90LWFuLWltYWdl';
	const entry = f.conversation.message('', [url]); f.layout(); f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('Enter');
	assert.equal(f.preview.visible, true); assert.equal(f.input.selection.entry, entry); assert.equal(f.cache.use(url).retained, 1);
	let frame = f.paint();
	assert.ok(frame.commandRefs.slice(0, frame.commandCount).some((ref, index) => frame.commandKinds[index] === Host2DKind.Glyphs
		&& ((ref as GlyphRenderSubmission).items as string).startsWith('Loading')));
	await f.load(); assert.notEqual(f.cache.use(url).error, undefined);
	frame = f.paint(); assert.equal(f.preview.visible, true); assert.equal(f.input.selection.imageIndex, 0);
	assert.ok(frame.commandRefs.slice(0, frame.commandCount).some((ref, index) => frame.commandKinds[index] === Host2DKind.Glyphs
		&& ((ref as GlyphRenderSubmission).items as string).startsWith('Image un')));
	const body: string[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
		const run = frame.commandRefs[index] as GlyphRenderSubmission;
		if (run.x === f.input.layout.left + 10) body.push((run.items as string).slice(run.item_start, run.item_end));
	}
	assert.ok(body.length > 1, 'a real decoder failure uses the available modal body rather than one truncated label');
	assert.equal(body.join(' ').replace(/\s/g, ''), f.cache.use(url).error!.replace(/\s/g, ''), 'all actual decoder-reason characters remain readable');
	f.capture('transcript-msx-minimum-unavailable');
	f.press('Escape'); assert.equal(inputFocus.target, f.control.scroll.focusTarget); assert.equal(f.cache.use(url).retained, 0);
});

test('a real decode reason remains reachable by modal keyboard scrolling when the pane body is only two rows high', async t => {
	const f = fixture(t, 'msx', 118), url = 'data:image/png;base64,bm90LWFuLWltYWdl';
	f.conversation.message('', [url]); f.layout(118, 'msx', 80); f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('Enter');
	await f.load();
	const body = () => {
		const frame = f.paint(), text: string[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs) {
			const run = frame.commandRefs[index] as GlyphRenderSubmission;
			if (run.x === f.input.layout.left + 10) text.push((run.items as string).slice(run.item_start, run.item_end));
		}
		return text;
	};
	const first = body(); assert.ok(f.cache.use(url).error!.trimStart().startsWith(first[0]));
	f.capture('transcript-msx-short-unavailable-home'); f.press('End');
	const last = body(); assert.notDeepEqual(last, first);
	assert.ok(f.cache.use(url).error!.trimEnd().endsWith(last.at(-1)!), 'End reveals the actual source suffix, not an ellipsis');
	assert.equal(f.preview.visible, true); f.capture('transcript-msx-short-unavailable-end');
	f.press('Home'); assert.deepEqual(body(), first);
	f.press('Escape'); assert.equal(inputFocus.target, f.control.scroll.focusTarget); assert.equal(f.preview.visible, false);
});

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) for (const width of [384, variant === 'tiny' ? 78 : 118]) {
	test(`${theme}/${variant}/${width} image focus and the actual decoded modal stay bounded and retain layout on clean frames`, async t => {
		const f = fixture(t, variant, width, theme), entry = f.conversation.message('**Screenshots**', [FIRST, SECOND]); f.layout();
		f.control.scroll.focusTarget.focus(); f.press('ArrowDown'); f.press('ArrowDown'); f.paint(); await f.load();
		const bounds = f.tile(entry, 0), frame = f.paint();
		let focus: RectRenderSubmission | undefined, tile: RectRenderSubmission | undefined, body: RectRenderSubmission | undefined, bitmap = false;
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Rect) {
				const rect = frame.commandRefs[index] as RectRenderSubmission;
				if (rect.kind === RectRenderKind.Rect && rect.color === resolveThemeTokenColor(colors.COLOR_BODY_ACCENT)) {
					assert.deepEqual(rect.area, bounds); focus = rect;
				} else if (rect.kind === RectRenderKind.Fill) {
					if (rect.area.left === bounds.left && rect.area.top === bounds.top
						&& rect.area.right === bounds.right && rect.area.bottom === bounds.bottom) tile = rect;
					else if (rect.area.left === f.input.layout.left && rect.area.top === f.input.layout.top
						&& rect.area.right === f.input.layout.right && rect.area.bottom === f.input.layout.bottom) body = rect;
				}
			} else if (frame.commandKinds[index] === Host2DKind.Bitmap) {
				const image = frame.commandRefs[index] as HostBitmapRenderSubmission;
				assert.ok(image.area.left >= f.input.viewport.bounds.left && image.area.right <= f.input.viewport.bounds.right);
				bitmap = true;
			}
		}
		assert.ok(focus && bitmap && tile && body, 'the selected actual decoded image has a focus frame on its real tile and body surfaces');
		assert.equal(tile.color, resolveThemeTokenColor(colors.COLOR_MARKDOWN_CODE_BACKGROUND));
		assert.equal(body.color, resolveThemeTokenColor(colors.COLOR_CODE_BACKGROUND));
		assert.ok(contrastRatio(focus.color, tile.color) >= 3, 'the image focus frame contrasts with its inset tile, not arbitrary image pixels');
		assert.ok(contrastRatio(focus.color, body.color) >= 3, 'the image focus frame also contrasts with its actual outer body');
		f.capture(`transcript-${theme}-${variant}-${width}-selected`);
		const rows = [...f.input.transcript.rows], advance = t.mock.method(editorViewState.font, 'advance');
		for (let index = 0; index < 100; index++) { f.layout(); f.paint(); }
		assert.equal(advance.mock.callCount(), 0, 'idle frames do not measure thumbnail labels or transcript text');
		assert.ok(f.input.transcript.rows.every((row, index) => row === rows[index])); advance.mock.restore();
		f.press('ArrowDown'); assert.equal(f.input.selection.imageIndex, 1); f.press('Enter'); await f.load();
		f.capture(`transcript-${theme}-${variant}-${width}-modal`);
		const modal = f.paint();
		let captions = 0;
		for (let index = 0; index < modal.commandCount; index++) if (modal.commandKinds[index] === Host2DKind.Glyphs) {
			const run = modal.commandRefs[index] as GlyphRenderSubmission;
			if (run.y === f.input.layout.top + 8 || run.y === f.input.layout.bottom - f.input.layout.rowHeight - 6) {
				captions++;
				assert.ok(run.x >= f.input.layout.left && run.x + run.font!.measure(run.items as string) <= f.input.layout.right,
					'the actual modal header and closing hint remain inside their real owning pane');
			}
		}
		assert.equal(captions, 2, 'the actual modal header and closing hint were both painted and checked');
		f.press('Escape'); assert.equal(f.input.selection.entry, entry); assert.equal(f.input.selection.imageIndex, 1);
	});
}
