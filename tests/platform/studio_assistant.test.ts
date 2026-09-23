import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { STUDIO_ACCOUNT_LOGIN_URL } from '../../hosts/common/assistant_protocol';
import { createCodexModelFixture, CODEX_FIXTURE_DONE, CODEX_FIXTURE_WAIT } from '../helpers/codex_model_fixture.mjs';
import { createAssistantStudioFixture } from '../helpers/studio_assistant_fixture';
import { createCodexAccountFixture } from '../helpers/codex_account_fixture';

const backends = ['software', 'webgl2', 'webgpu'] as const;
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
		body => [call('studio_propose_edits', { title: 'Reviewed Lua and YAML comments', files: outputs(body).slice(1).map((read, index) => ({ receipt: read.receipt,
			edits: [{ offset: 0, deleteLength: 0, expectedText: '', text: index === 0 ? '-- Codex reviewed\n' : '# Codex reviewed\n' }] })) })],
		CODEX_FIXTURE_DONE,
	];
	const model = await createCodexModelFixture(t, [...reviewSteps, () => { modelStarted(); return CODEX_FIXTURE_WAIT; }, ...reviewSteps]);
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
	assert.equal(observations.connects, 1); assert.equal(model.requests.length, 9); assert.deepEqual(observations.errors, []);
	const reads = outputs(model.requests[2]).slice(1);
	assert.equal(reads[0].source, '-- UNSAVED ASSISTANT FIXTURE\n' + await readFile('carts/nemesis_s/cart.lua', 'utf8'));
	assert.equal(reads[1].source, await readFile('carts/nemesis_s/res/data/nemesis_s_stage.yaml', 'utf8'));
	assert.ok(JSON.stringify(outputs(model.requests[2])[0]).length > 16000, 'real catalog exceeds the old lossy truncation budget');
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
