import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

/** Local deterministic Responses SSE. No real model, account, billable request or remote provider. */
export async function createCodexModelFixture(t, steps) {
	const requests = [];
	const server = createServer(async (request, response) => {
		const parts = [];
		for await (const part of request) parts.push(part);
		assert.equal(request.url, '/v1/responses');
		const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
		const step = steps[requests.length];
		assert.ok(step !== undefined, 'unexpected extra model request');
		const items = typeof step === 'function' ? step(body) : step;
		requests.push(body);
		const id = `fixture-response-${requests.length}`;
		const events = [{ type: 'response.created', response: { id } },
			...items.map(item => ({ type: 'response.output_item.done', item })),
			{ type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }];
		response.writeHead(200, { 'Content-Type': 'text/event-stream' });
		response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
	});
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
	return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

export const CODEX_FIXTURE_DONE = [{ type: 'message', id: 'fixture-message', role: 'assistant',
	content: [{ type: 'output_text', text: 'Contract fixture finished.' }] }];
