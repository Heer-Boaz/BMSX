import { AssistantHttpConnection } from '../../../ide/browser/assistant_connection';
import { StudioHttpSession } from '../../../ide/browser/http_session';
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
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.connect')!.bounds);
	await until(() => conversation.state === 'ready', 'login: isolated empty profile');
	check(conversation.account!.requiresLogin && !conversation.canSend, 'authorization is initially required');
	await test.click(view.composerBounds); test.clipboard.text = 'Keep this draft; do not submit.'; await press('ControlLeft', 'KeyV');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signIn')!.bounds);
	await until(() => conversation.loginCode !== undefined, 'login: unchanged official device-code protocol');
	check(conversation.loginCode === 'TEST-CODE', 'the real process supplied the fixture device code');
	await issuer.authorize();
	await until(() => conversation.state === 'ready' && !conversation.accountRefreshing && conversation.account!.connected, 'login: OAuth exchange and authoritative account snapshot');
	const account = { ...conversation.account! };
	check(conversation.canSend && conversation.loginCode === undefined, 'only the completed account refresh opens prompt admission');
	check(conversation.entries.at(-1)!.text.getText() === 'Studio account connected.', 'successful completion is visible');
	await issuer.verifyProfile(true);
	await frame(); await renderer.capture!('signed-in');
	ide.editor.setFontVariant('msx'); await frame(); await renderer.capture!('signed-in-msx');
	ide.editor.setFontVariant('tiny'); await frame();
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.disconnect')!.bounds);
	check(conversation.state === 'disconnected' && conversation.account === undefined, 'Disconnect retires authority without signing out');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.connect')!.bounds);
	await until(() => conversation.state === 'ready', 'login: new process resumes the private account, not conversation authority');
	check(JSON.stringify(conversation.account) === JSON.stringify(account), 'the explicit reconnect reads the persisted account');
	check(conversation.entries.at(-1)!.text.getText().includes('display-only'), 'earlier messages are not silently replayed');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.signOut')!.bounds);
	await until(() => conversation.state === 'disconnected', 'login: Sign out revokes and removes credentials before disconnecting');
	await issuer.verifyProfile(false);
	await frame(); await renderer.capture!('signed-out');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.connect')!.bounds);
	await until(() => conversation.state === 'ready', 'login: reconnect after Sign out needs new authorization');
	check(conversation.account!.requiresLogin && !conversation.account!.connected && !conversation.canSend, 'retired credentials cannot reopen prompt admission');
	check(view.draft.text === 'Keep this draft; do not submit.', 'account operations never consume the unsent draft');
	await test.click(view.accountActions.items.find(item => item.command === 'assistant.disconnect')!.bounds);
	await renderer.finish(); await ide.editor.shutdown();
	return { login: 'pass', account, frames: test.observations.hostFrames };
}
