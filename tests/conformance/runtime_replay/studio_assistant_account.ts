import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
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
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.connect')!.bounds);
	await until(() => conversation.state === 'ready', 'account: private process connected without credentials');
	check(conversation.account!.requiresLogin && !conversation.account!.connected, 'initial account requires explicit sign-in');
	await test.click(view.composerBounds); test.clipboard.text = 'Do not send before authorization.'; await press('ControlLeft', 'KeyV');
	await press('ControlLeft', 'Enter');
	check(conversation.entries.length === 0 && view.draftHasText, 'blocked submission retains the draft and sends nothing');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await until(() => conversation.loginCode !== undefined, 'account: actual device-code request reaches the pane');
	check(conversation.loginCode === 'ABCD-EFGH' && !conversation.canSend, 'only the public code is available while polling');
	await frame(); await renderer.capture!('code');
	ide.editor.setFontVariant('msx'); await frame(); await renderer.capture!('code-msx');
	ide.editor.setFontVariant('tiny'); await frame();
	await test.click(view.loginActions.items.find(item => item.command === 'assistant.copyCode')!.bounds);
	check(test.clipboard.text === 'ABCD-EFGH', 'Copy code copies exactly the public device code');
	check(await navigator.clipboard.readText() === 'ABCD-EFGH', 'Copy code reaches the authorized browser clipboard');
	// Supply native transient activation; popup blocking remains enabled in Chromium.
	await issuer.openGesture();
	await test.click(view.loginActions.items.find(item => item.command === 'assistant.openLogin')!.bounds);
	await issuer.verifyPopup();
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.cancelLogin')!.bounds);
	await until(() => conversation.state === 'ready', 'account: cancel actual polling attempt');
	check(conversation.loginCode === undefined && view.loginLabel === '' && !conversation.canSend, 'cancellation hides code and does not authorize a prompt');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await until(() => conversation.entries.some(entry => entry.text.getText().includes('Sign-in failed:')), 'account: real issuer polling failure is visible');
	check(conversation.state === 'ready' && conversation.loginCode === undefined, 'failed authorization requires an explicit retry');
	await frame(); await renderer.capture!('failed');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await issuer.waitForHeldStart();
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.cancelLogin')!.bounds);
	check(conversation.state === 'cancelling-sign-in' && conversation.loginCode === undefined, 'Cancel is available before the device-code response');
	await issuer.releaseStart();
	await until(() => conversation.state === 'ready', 'account: late start response cannot restore canceled code');
	check(conversation.loginCode === undefined && view.loginLabel === '', 'no late code is projected');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await until(() => conversation.loginCode !== undefined, 'account: another explicit pending attempt');
	await press('ControlLeft', 'KeyW');
	check(conversation.state === 'disconnected' && conversation.loginCode === undefined, 'closing the pane retires pending authentication');
	await test.runPaletteCommand('View: Codex Assistant');
	view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane expected');
	check(conversation.state === 'disconnected', 'reopening never retries login');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.connect')!.bounds);
	await until(() => conversation.state === 'ready', 'account: explicit reconnect waits for the previous process to drain');
	check(conversation.account!.requiresLogin && !conversation.account!.connected, 'retired attempt did not create an account');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await until(() => conversation.loginCode !== undefined, 'account: new process owns its own attempt');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.disconnect')!.bounds);
	check(conversation.state === 'disconnected' && conversation.loginCode === undefined, 'Disconnect also retires pending authentication');
	await frame(); await renderer.capture!('disconnected');
	await renderer.finish(); await ide.editor.shutdown();
	return { account: 'pass', frames: test.observations.hostFrames };
}
