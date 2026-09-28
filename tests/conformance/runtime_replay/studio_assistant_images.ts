import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { createStudioFixture } from './studio_fixture';
import { reachNemesisTitle } from './studio_nemesis_navigation';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

/** Real DOM keyboard/clipboard input is driven from Playwright, not injected into the text model. */
export async function startAssistantImageTest(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit), true);
	await test.until(() => test.cycles() > test.runtime.timing.cpuHz * 13, 'images: boot cart');
	await reachNemesisTitle(test);
	test.harness.openLuaSource('cart.lua'); await test.frame();
	await test.runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant expected');
	await test.click(view.composerBounds);
	const cycles = test.cycles();
	test.clipboard.text = 'STALE INTERNAL CLIPBOARD';
	return {
		async frame() { await test.frame(); },
		async capture(name: string) { for (let i = 0; i < 6; i++) await test.frame(); await renderer.capture!(name); },
		snapshot() { return { text: view.draft.text, images: view.attachments.urls, ready: view.attachments.ready, state: view.conversation.state,
			entries: view.conversation.entries.map(entry => ({ kind: entry.kind, images: entry.images, text: entry.text.getText() })),
			queued: view.conversation.queued, paused: test.cycles() === cycles, composer: view.composerBounds, layout: view.layout }; },
		async composer() { await test.click(view.composerBounds); },
		async key(...keys: string[]) { await test.press(...keys); },
		async submit() { await test.press('ControlLeft', 'Enter'); await test.until(() => view.conversation.state === 'ready', 'images: model completed'); },
		async history() {
			const thread = view.conversation.thread!.id;
			await view.conversation.newConversation(); await test.frame();
			await view.conversation.openConversation(thread); await test.frame();
		},
		async narrow() {
			test.presenter.setFixedRenderTargetSize(260, 320);
			test.ide.overlayRenderer.setRenderingViewportType(test.presenter, 'viewport'); test.ide.editor.updateViewport(test.ide.overlayRenderer.viewportSize);
			await test.frame();
		},
		async finish() { await renderer.finish(); },
	};
}
