import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createCodexContractFixture } from '../helpers/codex_app_server.mjs';
import { createCodexModelFixture, CODEX_FIXTURE_DONE } from '../helpers/codex_model_fixture.mjs';

const readCall = { type: 'function_call', call_id: 'read-source', name: 'studio_read', arguments: '{"resource":"cart.lua"}' };

test('pinned App Server with an isolated profile routes Studio tools without shell/patch capabilities', { timeout: 15000 }, async t => {
	const model = await createCodexModelFixture(t, [[readCall], CODEX_FIXTURE_DONE]);
	const codex = await createCodexContractFixture(t, model.url);
	const config = await codex.request('config/read', { includeLayers: false });
	assert.deepEqual(config.config.mcp_servers, {}, 'the isolated test profile has no ambient MCP processes');
	const threadId = await codex.startThread();
	const { turn } = await codex.request('turn/start', { threadId,
		input: [{ type: 'text', text: 'Exercise the fixture source tool.', text_elements: [] }] });
	const call = await codex.wait(message => message.method === 'item/tool/call');
	assert.equal(call.params.threadId, threadId);
	assert.equal(call.params.turnId, turn.id);
	assert.equal(call.params.callId, readCall.call_id);
	assert.deepEqual(call.params.arguments, { resource: 'cart.lua' });
	codex.write({ id: call.id, result: { success: true, contentItems: [{ type: 'inputText', text: 'UNSAVED STUDIO SNAPSHOT' }] } });
	const completed = await codex.wait(message => message.method === 'turn/completed');
	assert.equal(completed.params.turn.status, 'completed');
	const output = model.requests[1].input.find(item => item.type === 'function_call_output');
	assert.equal(output.output, 'UNSAVED STUDIO SNAPSHOT');
	const tools = model.requests[0].tools.map(tool => tool.name);
	assert.deepEqual(tools, ['request_user_input', 'skills', 'studio_read']);
	await assert.rejects(access(codex.ambientMarker), { code: 'ENOENT' });
	assert.equal(await readFile(codex.sourcePath, 'utf8'), 'return 42\n');
});

test('invented file/shell tool calls are rejected even when an external model emits them anyway', { timeout: 15000 }, async t => {
	const attempts = [
		{ type: 'custom_tool_call', call_id: 'patch', name: 'apply_patch', input: '*** Begin Patch\n*** Delete File: cart.lua\n*** End Patch' },
		{ type: 'function_call', call_id: 'exec', name: 'exec_command', arguments: '{"cmd":"printf corrupt > cart.lua"}' },
		{ type: 'function_call', call_id: 'shell', name: 'shell', arguments: '{"command":["sh","-c","printf corrupt > cart.lua"]}' },
	];
	const model = await createCodexModelFixture(t, [attempts, CODEX_FIXTURE_DONE]);
	const codex = await createCodexContractFixture(t, model.url);
	const threadId = await codex.startThread();
	await codex.request('turn/start', { threadId,
		input: [{ type: 'text', text: 'Exercise rejected fixture tools.', text_elements: [] }] });
	const completed = await codex.wait(message => message.method === 'turn/completed');
	assert.equal(completed.params.turn.status, 'completed');
	const outputs = model.requests[1].input.filter(item => item.type === 'function_call_output' || item.type === 'custom_tool_call_output');
	assert.equal(outputs.length, attempts.length);
	for (const output of outputs) assert.match(output.output, /unsupported|unknown|not found/i);
	await assert.rejects(access(codex.ambientMarker), { code: 'ENOENT' });
	assert.equal(await readFile(codex.sourcePath, 'utf8'), 'return 42\n');
});

test('interrupt completes an actual turn waiting for a Studio tool result without another model request', { timeout: 15000 }, async t => {
	const model = await createCodexModelFixture(t, [[readCall]]);
	const codex = await createCodexContractFixture(t, model.url);
	const threadId = await codex.startThread();
	const { turn } = await codex.request('turn/start', { threadId,
		input: [{ type: 'text', text: 'Wait for a fixture source result.', text_elements: [] }] });
	await codex.wait(message => message.method === 'item/tool/call');
	await codex.request('turn/interrupt', { threadId, turnId: turn.id });
	const completed = await codex.wait(message => message.method === 'turn/completed');
	assert.equal(completed.params.turn.status, 'interrupted');
	assert.equal(model.requests.length, 1);
	assert.equal(await readFile(codex.sourcePath, 'utf8'), 'return 42\n');
});

test('an empty MCP map override does NOT revoke inherited process capabilities', { timeout: 15000 }, async t => {
	const model = await createCodexModelFixture(t, []);
	const codex = await createCodexContractFixture(t, model.url, true);
	const config = await codex.request('config/read', { includeLayers: false });
	assert.ok(config.config.mcp_servers.ambient, 'the real config merge retains an inherited server despite -c mcp_servers={}');
	await assert.rejects(access(codex.ambientMarker), { code: 'ENOENT' }, 'configuration inspection alone must not start the inherited process');
	assert.equal(model.requests.length, 0, 'this profile must not be admitted to a model turn');
});

test('closing stdio with an unanswered Studio request drains the real App Server without forced termination', { timeout: 15000 }, async t => {
	const model = await createCodexModelFixture(t, [[readCall]]);
	const codex = await createCodexContractFixture(t, model.url);
	const threadId = await codex.startThread();
	await codex.request('turn/start', { threadId,
		input: [{ type: 'text', text: 'Wait for a fixture source result.', text_elements: [] }] });
	await codex.wait(message => message.method === 'item/tool/call');
	assert.equal(model.requests.length, 1);
	// Fixture teardown closes stdin and asserts actual exit status/signal before
	// deleting the private profile. It does not answer the pending tool request.
});
