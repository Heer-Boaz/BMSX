import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
import { submitAssistantText } from './studio_assistant_navigation';
import { setFieldText } from '../../../ide/editor/ui/inline/text_field';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, createStudioFixture } from './studio_fixture';
import { createStudioRenderer, type StudioRendererKind } from './studio_renderer';

type AccountIssuerControl = {
	authorize: () => Promise<void>;
	verifyProfile: (connected: boolean) => Promise<void>;
};

/** Real account commands and profile persistence; only the external TLS issuer is a fixture. */
export async function runAssistantLogin(kind: StudioRendererKind, canvas: HTMLCanvasElement, capture: (name: string) => Promise<void>, issuer: AccountIssuerControl) {
	const renderer = await createStudioRenderer(kind, canvas, capture), http = new StudioHttpSession();
	const test = await createStudioFixture(canvas, renderer.backend, renderer.capture, (signal, emit) => AssistantHttpConnection.open(http, signal, emit));
	const { ide, until, press, frame } = test;
	await until(() => test.cycles() > test.runtime.timing.cpuHz * 13, 'login: boot actual cart');
	await press('ControlRight', 'ShiftRight'); await test.runPaletteCommand('Run: Pause');
	ide.editor.setFontVariant('tiny');
	await test.runPaletteCommand('View: Codex Assistant');
	const view = getActiveTab(); if (view.kind !== 'assistant') throw new Error('Assistant pane expected');
	const conversation = ide.editor.assistant;
	await submitAssistantText(test, 'Keep this draft; do not submit.');
	// The implicit attempt is the ordinary browser method, and the destination it publishes is
	// the one the real process produced: unrewritten, and admitted by production on its shape.
	await until(() => conversation.loginUrl !== undefined, 'login: unchanged official loopback authorization');
	check(conversation.loginCode === undefined && new URL(conversation.loginUrl!).origin === 'https://auth.openai.com',
		'the real process supplied an admitted authorization destination with no code to carry');
	check(view.draft.text === 'Keep this draft; do not submit.' && conversation.entries.every(entry => entry.kind !== 'user'),
		'implicit connect and browser authorization retain the unsent prompt');
	await submitAssistantText(test, '/cancel');
	await until(() => conversation.state === 'ready', 'login: cancel the implicit browser attempt');
	// This fixture authorizes through the device-code issuer, so the exchange below uses it.
	await submitAssistantText(test, '/login device');
	await until(() => conversation.loginCode !== undefined, 'login: unchanged official device-code protocol');
	check(conversation.loginCode === 'TEST-CODE', 'the real process supplied the fixture device code');
	// Typed while the attempt is pending: completing authorization must not consume or send it.
	setFieldText(view.draft, 'Keep this draft; do not submit.', true);
	await issuer.authorize();
	await until(() => conversation.state === 'ready' && !conversation.accountRefreshing && conversation.account!.connected, 'login: OAuth exchange and authoritative account snapshot');
	const account = { ...conversation.account! };
	check(conversation.canSend && conversation.loginCode === undefined, 'only the completed account refresh opens prompt admission');
	check(conversation.entries.at(-1)!.text.getText() === 'Studio account connected.', 'successful completion is visible');
	check(view.draft.text === 'Keep this draft; do not submit.' && conversation.entries.every(entry => entry.kind !== 'user'), 'account authorization does not consume or automatically send the draft');
	await issuer.verifyProfile(true);
	await frame(); await renderer.capture!('signed-in');
	ide.editor.setFontVariant('msx'); await frame(); await renderer.capture!('signed-in-msx');
	ide.editor.setFontVariant('tiny'); await frame();
	await press('ControlLeft', 'KeyW');
	check(conversation.state === 'disconnected' && conversation.account === undefined, 'closing the pane retires authority without signing out');
	await test.runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, '/history');
	await until(() => conversation.state === 'ready', 'login: new process resumes the private account, not conversation authority');
	check(JSON.stringify(conversation.account) === JSON.stringify(account), 'the explicit reconnect reads the persisted account');
	await until(() => !(getActiveTab() as typeof view).commandPending, 'login: history finished');
	await press('Escape');
	check(conversation.entries.every(entry => entry.kind !== 'user'), 'earlier drafts are not silently replayed');
	await submitAssistantText(test, '/logout');
	await until(() => conversation.state === 'disconnected', 'login: Sign out revokes and removes credentials before disconnecting');
	await issuer.verifyProfile(false);
	await frame(); await renderer.capture!('signed-out');
	await test.runPaletteCommand('View: Codex Assistant');
	await submitAssistantText(test, '/history');
	await until(() => conversation.state === 'ready', 'login: reconnect after Sign out needs new authorization');
	check(conversation.account!.requiresLogin && !conversation.account!.connected && !conversation.canSend, 'retired credentials cannot reopen prompt admission');
	await until(() => !(getActiveTab() as typeof view).commandPending, 'login: final history finished');
	await press('Escape');
	await press('ControlLeft', 'KeyW');
	await renderer.finish(); await ide.editor.shutdown();
	return { login: 'pass', account, frames: test.observations.hostFrames };
}
