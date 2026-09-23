import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { submitAssistantText } from './studio_assistant_navigation';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

type AccountFixtureControl = {
	openGesture: () => Promise<void>;
	verifyPopup: () => Promise<void>;
	waitForHeldStart: () => Promise<void>;
	releaseStart: () => Promise<void>;
};

/** All account commands use visible controls. The issuer only supplies pending/failed authorization. */
export async function runAssistantAccount(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>, issuer: AccountFixtureControl) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame } = test;
	await until(() => test.cycles() > test.runtime.timing.cpuHz * 13, 'account: boot actual cart');
	await press('ControlRight', 'ShiftRight'); await test.runPaletteCommand('Run: Pause');
	ide.editor.setFontVariant('tiny');
	await test.runPaletteCommand('View: Codex Assistant');
	let view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane expected');
	const conversation = ide.editor.assistant;
	check(conversation.state === 'disconnected', 'view attachment does not start authentication');
	await submitAssistantText(test, 'Do not send before authorization.');
	await until(() => conversation.loginCode !== undefined, 'account: actual device-code request reaches the pane');
	check(view.draft.text === 'Do not send before authorization.' && conversation.entries.every(entry => entry.kind !== 'user'), 'implicit connect and login retain the unsent prompt');
	check(conversation.loginCode === 'ABCD-EFGH' && !conversation.canSend, 'only the public code is available while polling');
	await frame(); await renderer.capture!('code');
	ide.editor.setFontVariant('msx'); await frame(); await renderer.capture!('code-msx');
	ide.editor.setFontVariant('tiny'); await frame();
	await submitAssistantText(test, '/copy-code');
	check(test.clipboard.text === 'ABCD-EFGH', 'Copy code copies exactly the public device code');
	check(await navigator.clipboard.readText() === 'ABCD-EFGH', 'Copy code reaches the authorized browser clipboard');
	// Supply native transient activation; popup blocking remains enabled in Chromium.
	await issuer.openGesture();
	await submitAssistantText(test, '/open');
	await issuer.verifyPopup();
	await submitAssistantText(test, '/cancel');
	await until(() => conversation.state === 'ready', 'account: cancel actual polling attempt');
	check(conversation.loginCode === undefined && !conversation.canSend, 'cancellation hides code and does not authorize a prompt');
	await submitAssistantText(test, '/login');
	await until(() => conversation.entries.some(entry => entry.text.getText().includes('Sign-in failed:')), 'account: real issuer polling failure is visible');
	check(conversation.state === 'ready' && conversation.loginCode === undefined, 'failed authorization requires an explicit retry');
	await frame(); await renderer.capture!('failed');
	await submitAssistantText(test, '/login');
	await issuer.waitForHeldStart();
	await submitAssistantText(test, '/cancel');
	check(conversation.state === 'cancelling-sign-in' && conversation.loginCode === undefined, 'Cancel is available before the device-code response');
	await issuer.releaseStart();
	await until(() => conversation.state === 'ready', 'account: late start response cannot restore canceled code');
	check(conversation.loginCode === undefined, 'no late code is projected');
	await submitAssistantText(test, '/login');
	await until(() => conversation.loginCode !== undefined, 'account: another explicit pending attempt');
	await press('ControlLeft', 'KeyW');
	check(conversation.state === 'disconnected' && conversation.loginCode === undefined, 'closing the pane retires pending authentication');
	await test.runPaletteCommand('View: Codex Assistant');
	view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane expected');
	check(conversation.state === 'disconnected', 'reopening never retries login');
	await submitAssistantText(test, '/login');
	await until(() => conversation.loginCode !== undefined, 'account: new process owns its own attempt');
	await press('ControlLeft', 'KeyW');
	check(conversation.state === 'disconnected' && conversation.loginCode === undefined, 'closing the new pane retires its pending authentication');
	await test.runPaletteCommand('View: Codex Assistant');
	await frame(); await renderer.capture!('disconnected');
	await renderer.finish(); await ide.editor.shutdown();
	return { account: 'pass', frames: test.observations.hostFrames };
}
