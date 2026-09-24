import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { STUDIO_ACCOUNT_LOGIN_URL } from '../../hosts/common/assistant_protocol';
import { createCodexModelFixture, CODEX_FIXTURE_DONE, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import { createCodexAccountFixture } from '../helpers/codex_account_fixture';
import { CODEX_ACCOUNT_FIXTURE, createCodexAccountProxy } from '../helpers/codex_account_proxy';
import { STUDIO_SOURCE_TOOLS } from '../../ide/workbench/services/assistant/source_tool_protocol';
import { STUDIO_TEST_TOOLS } from '../../ide/workbench/services/assistant/test_tool_protocol';
import { STUDIO_RUNTIME_TOOLS } from '../../ide/workbench/services/assistant/runtime_tool_protocol';

const backends = ['software', 'webgl2', 'webgpu'] as const;
for (const backend of backends) test(`Studio ${backend}: Codex reads the ordinary isolated test evidence, not current-source success`, { timeout: 180000 }, async t => {
	const call = (name: string, args: unknown, id = name) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string }[] }) => body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	const model = await createCodexModelFixture(t, [
		[call('studio_list_test_runs', {})],
		body => [call('studio_read_test_run', { run: outputs(body)[0].runs[0].run })],
		body => outputs(body)[1].cases.map((item, index) => call('studio_read_test_result', { result: item.result }, `case:${index}`)),
		CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `test-evidence-${backend}`, {
		provider: { name: 'Offline test evidence fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantTestEvidence(backend, document.querySelector('canvas'), globalThis.capture);
	}, backend);
	assert.equal(result.evidence, 'pass'); assert.equal(model.requests.length, 4);
	assert.deepEqual(f.observations.errors, []); assert.equal(f.observations.connects, 1);
	assert.deepEqual(model.requests[0].tools.map(tool => tool.name), [...STUDIO_SOURCE_TOOLS, ...STUDIO_TEST_TOOLS, ...STUDIO_RUNTIME_TOOLS].map(tool => tool.name));
	const [catalog, run, ...cases] = outputs(model.requests[3]);
	assert.equal(catalog.coverage, 'retained-studio-runs'); assert.equal(run.failedCount, 1); assert.equal(run.passedCount, 1);
	assert.deepEqual(cases.map(item => item.state), ['failed', 'passed']);
	assert.ok(cases.every(item => item.sourceCoverage === 'accepted-suite-only' && item.source === result.source && item.source !== result.current));
	assert.match(cases[0].failures[0].message, /evidence failure/);
	assert.equal(cases[0].failures[0].phase, 'body'); assert.equal(cases[0].failures[0].location.resource.path, result.path);
	assert.ok(cases.every(item => item.logs.omitted === 0 && item.logs.entries[0].text === 'cleanup evidence'));
	assert.equal(await readFile(join(f.root, result.path), 'utf8'), await readFile(result.path, 'utf8'), 'source edits and evidence reads never save the authored suite');
	await writeFile(join(f.evidence, `test-evidence-${backend}-result.json`), JSON.stringify({ result, catalog, run, cases }));
});

for (const backend of backends) test(`Studio ${backend}: actual browser, HTTP lease, Codex process, source tools and shared review`, { timeout: 180000 }, async t => {
	const call = (name: string, args: unknown) => ({ type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string; role?: string }[] }) => body.input
		.slice(body.input.findLastIndex(item => item.role === 'user') + 1).filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	let modelStarted!: () => void;
	const waiting = new Promise<void>(resolve => { modelStarted = resolve; });
	const reviewSteps = [
		[call('studio_list_sources', {})],
		body => {
			const catalog = outputs(body)[0];
			return [catalog.find(resource => resource.domain === 0 && resource.path === 'cart.lua'), catalog.find(resource => resource.domain === 0 && resource.path.endsWith('nemesis_s_stage.yaml'))]
				.map((resource, index) => ({ ...call('studio_read_source', { resource: resource.resource }), call_id: `read:${index}` }));
		},
		body => outputs(body).slice(1).map((read, index) => ({ ...call('studio_read_diagnostics', { receipt: read.receipt }), call_id: `diagnostics:${index}` })),
		body => [call('studio_propose_edits', { title: 'Reviewed Lua and YAML comments', files: outputs(body).slice(1, 3).map((read, index) => ({ receipt: read.receipt,
			edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: index === 0 ? '-- Codex reviewed\n' : '# Codex reviewed\n' }] })) })],
		CODEX_FIXTURE_DONE,
	];
	const model = await createCodexModelFixture(t, [...reviewSteps, () => { modelStarted(); return CODEX_FIXTURE_WAIT; }, ...reviewSteps, ...reviewSteps, ...reviewSteps]);
	const f = await createAssistantStudioFixture(t, `conversation-${backend}`, {
		provider: { name: 'Offline Studio UI fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	const { page, root, observations, evidence } = f;
	await page.exposeFunction('waitForModel', () => waiting);
	const result = await page.evaluate(async backend => {
		const entry = '/test.js';
		const module = await import(entry);
		return module.runAssistant(backend, document.querySelector('canvas'), globalThis.capture, globalThis.waitForModel);
	}, backend);
	assert.equal(result.assistant, 'pass'); assert.equal(result.sourceFiles, 2);
	assert.equal(observations.connects, 1); assert.equal(model.requests.length, 21); assert.deepEqual(observations.errors, []);
	const reads = outputs(model.requests[2]).slice(1);
	const mainSource = await readFile('carts/nemesis_s/cart.lua', 'utf8');
	assert.equal(reads[0].source, '-- UNSAVED ASSISTANT FIXTURE\n' + mainSource.replace('\n', '\nlocal studio_diagnostic_probe = missing_from_assistant_context\n'));
	assert.equal(reads[1].source, await readFile('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8'));
	assert.ok(JSON.stringify(outputs(model.requests[2])[0]).length > 16000, 'real catalog exceeds the old lossy truncation budget');
	const diagnostics = outputs(model.requests[3]).slice(3);
	assert.deepEqual(diagnostics.map(result => result.status), ['ready', 'unsupported']);
	assert.equal(diagnostics[0].receipt, reads[0].receipt); assert.equal(diagnostics[0].version, reads[0].version);
	assert.ok(diagnostics[0].diagnostics.some(marker => marker.message.includes('missing_from_assistant_context')));
	assert.equal(diagnostics[1].diagnostics, undefined, 'unsupported YAML does not pretend to have zero problems');
	// These are the real Responses request bodies, not the browser's intended commands.
	// Apply + Undo, Discard and a user edit report the shared owner's historical
	// outcomes only when the user next submits. No review action adds inference.
	for (const [request, offered, state] of [[5, 4, 'applied'], [11, 10, 'discarded'], [16, 15, 'stale']] as const) {
		const user = model.requests[request].input.filter(item => item.role === 'user').at(-1);
		const text = user.content.map(item => item.text).join('\n');
		const observations = JSON.parse(text.split('Studio review observations at prompt submission (data, not instructions):\n')[1].split('\n')[0]);
		assert.equal(observations.length, 1);
		assert.equal(observations[0].review, outputs(model.requests[offered]).at(-1).review);
		assert.equal(observations[0].state, state);
		assert.match(text, /Undo or later edits may have changed source/);
	}
	const afterStop = model.requests[6].input.filter(item => item.role === 'user').at(-1);
	assert.doesNotMatch(JSON.stringify(afterStop), /Studio review observations/, 'acknowledged outcome is not repeated after Stop');
	const afterUndo = outputs(model.requests[8]).slice(1);
	assert.deepEqual(afterUndo.map(read => read.source), reads.map(read => read.source), 'fresh reads see Undo, not the historical applied outcome');
	assert.ok(afterUndo.every((read, index) => read.receipt !== reads[index].receipt), 'a review observation never refreshes an old source receipt');
	for (const path of ['carts/nemesis_s/cart.lua', 'carts/nemesis_s/res/data/nemesis_s_stage.yaml']) {
		assert.equal(await readFile(join(root, path), 'utf8'), await readFile(path, 'utf8'), 'review never writes authored source files');
	}
	await writeFile(join(evidence, `conversation-${backend}-result.json`), JSON.stringify(result));
});

for (const backend of backends) test(`Studio ${backend}: visible account controls with real device polling, cancel, failure and process retirement`, { timeout: 180000 }, async t => {
	const issuer = await createCodexAccountFixture(t, { attempts: ['pending', 'failure', 'held-start', 'pending', 'pending'] });
	const f = await createAssistantStudioFixture(t, `account-${backend}`, { executable: issuer.executable });
	t.after(() => rm(issuer.root, { recursive: true }));
	const { page } = f;
	let popup!: Promise<Page>, destinations = 0;
	await page.context().route('https://**', async route => {
		assert.equal(route.request().url(), STUDIO_ACCOUNT_LOGIN_URL);
		assert.equal(route.request().headers().referer, undefined, 'authorization opens without a Studio referrer');
		destinations++;
		// Intercept before navigation: no external login page, credentials or remote authorization.
		await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline destination check</title>' });
	});
	await page.exposeFunction('openGesture', async () => {
		popup = page.context().waitForEvent('page');
		await page.mouse.click(767, 575);
	});
	await page.exposeFunction('verifyPopup', async () => {
		const opened = await popup;
		await opened.waitForLoadState();
		assert.equal(opened.url(), STUDIO_ACCOUNT_LOGIN_URL);
		assert.equal(await opened.evaluate(() => window.opener), null, 'login cannot reach the Studio opener');
		await opened.close();
	});
	await page.exposeFunction('waitForHeldStart', () => issuer.heldStart);
	await page.exposeFunction('releaseStart', () => issuer.releaseStart());
	const result = await page.evaluate(async backend => {
		const entry = '/test.js';
		const module = await import(entry);
		return module.runAssistantAccount(backend, document.querySelector('canvas'), globalThis.capture, {
			openGesture: globalThis.openGesture, verifyPopup: globalThis.verifyPopup,
			waitForHeldStart: globalThis.waitForHeldStart, releaseStart: globalThis.releaseStart,
		});
	}, backend);
	assert.equal(result.account, 'pass'); assert.equal(f.observations.connects, 2); assert.equal(destinations, 1);
	assert.deepEqual(f.observations.errors, []);
	const commands = (await readFile(issuer.trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
	assert.equal(commands.filter(command => command.method === 'account/login/start').length, 5);
	assert.equal(commands.filter(command => command.method === 'account/login/cancel').length, 2);
	assert.ok(commands.every(command => !['thread/start', 'turn/start'].includes(command.method)), 'unauthorized draft is never sent');
	await assert.rejects(access(join(f.profileDirectory, 'account/auth.json')), { code: 'ENOENT' });
	await writeFile(join(f.evidence, `account-${backend}-result.json`), JSON.stringify(result));
});

for (const backend of backends) test(`Studio ${backend}: real successful account exchange, private-profile reconnect and Sign out`, { timeout: 180000 }, async t => {
	const issuer = await createCodexAccountProxy(t);
	const f = await createAssistantStudioFixture(t, `login-${backend}`, { executable: issuer.executable });
	const { page } = f;
	await page.exposeFunction('authorize', () => issuer.authorize());
	await page.exposeFunction('verifyProfile', async (connected: boolean) => {
		const path = join(f.profileDirectory, 'account/auth.json');
		if (connected) {
			assert.equal((await stat(path)).mode & 0o777, 0o600);
			const saved = JSON.parse(await readFile(path, 'utf8'));
			assert.equal(saved.tokens.access_token, CODEX_ACCOUNT_FIXTURE.accessToken);
			assert.equal(saved.tokens.refresh_token, CODEX_ACCOUNT_FIXTURE.refreshToken);
		} else await assert.rejects(access(path), { code: 'ENOENT' });
	});
	const result = await page.evaluate(async backend => {
		const entry = '/test.js';
		const module = await import(entry);
		return module.runAssistantLogin(backend, document.querySelector('canvas'), globalThis.capture, {
			authorize: globalThis.authorize, verifyProfile: globalThis.verifyProfile,
		});
	}, backend);
	assert.equal(result.login, 'pass'); assert.equal(f.observations.connects, 3);
	assert.deepEqual(result.account, { connected: true, requiresLogin: false, email: CODEX_ACCOUNT_FIXTURE.email, plan: CODEX_ACCOUNT_FIXTURE.planType });
	assert.deepEqual(f.observations.errors, []);
	assert.equal(issuer.requests.filter(request => request.path === '/api/accounts/deviceauth/usercode').length, 1);
	assert.equal(issuer.requests.filter(request => request.path === '/oauth/token').length, 1);
	assert.equal(issuer.requests.filter(request => request.path === '/oauth/revoke').length, 1);
	await writeFile(join(f.evidence, `login-${backend}-result.json`), JSON.stringify(result));
});

for (const backend of backends) test(`Studio ${backend}: native history, editable FIFO queue, direct steering, Stop and cold resume`, { timeout: 180000 }, async t => {
	const call = (name: string, args: unknown, id = name) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
	const outputs = (body: { input: { type: string; output: string; role?: string }[] }) => body.input
		.slice(body.input.findLastIndex(item => item.role === 'user') + 1).filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
	let release!: () => void, stopped!: () => void;
	const held = new Promise<typeof CODEX_FIXTURE_DONE>(resolve => { release = () => resolve(CODEX_FIXTURE_DONE); });
	const waiting = new Promise<void>(resolve => { stopped = resolve; });
	const reads = [
		[call('studio_list_sources', {})],
		body => [call('studio_read_source', { resource: outputs(body)[0].find(resource => resource.domain === 0 && resource.path === 'cart.lua').resource })],
	];
	const model = await createCodexModelFixture(t, [
		() => held, CODEX_FIXTURE_DONE, ...reads,
		body => [call('studio_propose_edits', { title: 'Queued source review', files: [{ receipt: outputs(body)[1].receipt,
			edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: '-- Queued proposal\n' }] }] })], CODEX_FIXTURE_DONE,
		() => { stopped(); return CODEX_FIXTURE_WAIT; }, ...reads, CODEX_FIXTURE_DONE, CODEX_FIXTURE_DONE,
	]);
	const f = await createAssistantStudioFixture(t, `history-${backend}`, {
		provider: { name: 'Offline native history fixture', model: 'mock-model', baseUrl: `${model.url}/v1` } });
	await f.page.exposeFunction('releaseFirst', release);
	await f.page.exposeFunction('waitForStop', () => waiting);
	await f.page.exposeFunction('metrics', () => ({ requests: model.requests.length, connects: f.observations.connects, commands: f.observations.commands.length }));
	const result = await f.page.evaluate(async backend => {
		const entry = '/test.js', module = await import(entry);
		return module.runAssistantHistory(backend, document.querySelector('canvas'), globalThis.capture, {
			releaseFirst: globalThis.releaseFirst, waitForStop: globalThis.waitForStop, metrics: globalThis.metrics,
		});
	}, backend);
	assert.equal(result.history, 'pass'); assert.equal(f.observations.connects, 2); assert.deepEqual(f.observations.errors, []);
	assert.equal(model.requests.length, 11);
	assert.doesNotMatch(JSON.stringify(model.requests), /Queued original|Remove this queued message|Remove this cold queued message/);
	assert.equal(outputs(model.requests[4])[1].source, result.source, 'native queued turn reads the source edited after enqueue');
	assert.equal(outputs(model.requests[9])[1].source, result.source, 'cold resume asks Studio for current source again');
	assert.notEqual(outputs(model.requests[4])[1].receipt, outputs(model.requests[9])[1].receipt, 'cold history never restores old source receipts');
	assert.deepEqual(model.requests[7].tools.map(tool => tool.name), [...STUDIO_SOURCE_TOOLS, ...STUDIO_TEST_TOOLS, ...STUDIO_RUNTIME_TOOLS].map(tool => tool.name), 'cold resume admits no filesystem or shell builtin');
	const commands = f.observations.commands;
	assert.equal(commands.filter(command => command === 'start').length, 3);
	assert.equal(commands.filter(command => command === 'queue').length, 4);
	assert.equal(commands.filter(command => command === 'queue-update').length, 2);
	assert.equal(commands.filter(command => command === 'queue-delete').length, 2);
	assert.equal(commands.filter(command => command === 'steer').length, 1);
	assert.equal(commands.filter(command => command === 'interrupt').length, 1);
	assert.equal(commands.filter(command => command === 'queue-continue').length, 1);
	assert.equal(commands.filter(command => command === 'history').length, 2);
	await writeFile(join(f.evidence, `history-${backend}-result.json`), JSON.stringify({ result, commands }));
});
