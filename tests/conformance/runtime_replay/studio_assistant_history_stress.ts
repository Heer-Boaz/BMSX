import type { AssistantInput } from '../../../ide/workbench/contrib/assistant/editor_input';
import { PieceTreeBuffer } from '../../../ide/editor/text/piece_tree_buffer';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { check, type StudioFixture } from './studio_fixture';

/** Synthetic historical data, ordinary visible keyboard/pointer/resize afterwards.
 * This is a viewport stress fixture, not 5,000 model calls or a user's real history. */
export async function exerciseLongAssistantHistory(test: StudioFixture, view: AssistantInput, capture: (name: string) => Promise<void>) {
	const { conversation, transcript, viewport } = view;
	conversation.entries.length = 0;
	for (let index = 0; index < 5000; index++) conversation.entries.push({ index, kind: index % 2 ? 'assistant' : 'user', resetRevision: 0,
		text: new PieceTreeBuffer(`### History message ${index}\n\n` + 'Read **source**, compare `velocity_x_q8`, then step one frame. '.repeat(12)) });
	transcript.reset();
	conversation.notice('Synthetic 5,000-message viewport exercise. No model requests.');
	const loadedAt = performance.now(); await test.frame(); const loadMs = performance.now() - loadedAt;
	await test.click(viewport.bounds); await test.press('End'); await capture('history-5000-end');
	check(transcript.rows.at(-1)!.entry === conversation.entries.length - 1, 'stress: keyboard End reaches the newest entry');
	await test.press('Home'); await capture('history-5000-start');
	check(transcript.rowAt(0)!.entry === 0, 'stress: keyboard Home reaches the oldest entry');
	test.movePointer(viewport.scrollbar.getThumb()!); await test.frame();
	test.setPointerButton('pointer_primary', true); await test.frame();
	const track = viewport.scrollbar.getTrack();
	for (const fraction of [0.2, 0.4, 0.6]) {
		const top = track.top + (track.bottom - track.top) * fraction;
		test.movePointer({ left: track.left, right: track.right, top, bottom: top + 1 }); await test.frame();
		check(pointerCapture.active, 'stress: refining unseen message heights does not break a thumb drag');
	}
	await capture('history-5000-drag');
	test.setPointerButton('pointer_primary', false); await test.frame();
	check(!pointerCapture.active, 'stress: releasing the thumb ends capture');
	await test.press('Home');
	for (let index = 0; index < 7; index++) await test.press('PageDown');
	const anchor = conversation.entries[transcript.rowAt(Math.trunc(viewport.scrollTop / view.layout.rowHeight))!.entry];
	await capture('history-5000-reading');
	const resizeAt = performance.now();
	test.presenter.setFixedRenderTargetSize(640, 480);
	test.ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport');
	test.ide.editor.updateViewport(test.ide.overlayRenderer.viewportSize); await test.frame();
	const resizeMs = performance.now() - resizeAt;
	check(conversation.entries[transcript.rowAt(Math.trunc(viewport.scrollTop / view.layout.rowHeight))!.entry] === anchor,
		'stress: resizing preserves the message being read');
	await capture('history-5000-resized');
	await test.click(view.composerBounds);
	await test.clipboard.writeText('**Still editable** with @cart');
	const editAt = performance.now(); await test.press('ControlLeft', 'KeyV'); const editMs = performance.now() - editAt;
	await capture('history-5000-reference');
	// Click the bottom visible suggestion, leaving text focus in the composer.
	await test.click({ left: view.composerBounds.left + 8, right: view.composerBounds.left + 24,
		top: view.composerBounds.top - 10, bottom: view.composerBounds.top - 6 });
	check(view.draft.annotations.length === 1 && view.draft.focusTarget.hasFocus, 'stress: pointer accepts a source suggestion without moving text focus');
	return { entries: conversation.entries.length, loadMs, resizeMs, editMs, visibleRows: transcript.rows.length };
}
