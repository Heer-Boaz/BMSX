import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssistantCommand, AssistantEvent } from '../../common/assistant_protocol';
import { CodexSession, type CodexSessionOptions } from './session';
import type { CodexSessionEvent, CodexToolResult } from './protocol';

type PendingTool = { resolve: (result: CodexToolResult) => void; detach: () => void };
type Connection = {
	id: string;
	lifetime: AbortController;
	response: ServerResponse;
	ready: boolean;
	tools: Map<string, PendingTool>;
	session?: CodexSession;
	done: Promise<void>;
};

/** The HTTP composition must authorize local Host/origin/capability BEFORE calling this owner. */
export class CodexHttpApi {
	private connection: Connection | undefined;
	private closing = false;

	public constructor(private readonly options: Pick<CodexSessionOptions, 'profileDirectory' | 'executable' | 'provider' | 'tools'>) {}

	public async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
		if (this.closing) { response.writeHead(503).end('Studio assistant is shutting down'); return; }
		if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
		if (pathname === '/__bmsx__/assistant/connect') {
			// An explicit new connection may wait for the old process to drain, but
			// never take over a live browser lease or replay its operations.
			if (this.connection?.lifetime.signal.aborted) await this.connection.done;
			if (this.closing) { response.writeHead(503).end('Studio assistant is shutting down'); return; }
			if (this.connection) { response.writeHead(409).end('A Studio assistant connection is already active'); return; }
			const connection: Connection = { id: randomUUID(), lifetime: new AbortController(), response, ready: false,
				tools: new Map(), done: undefined };
			this.connection = connection;
			connection.done = this.connect(connection);
			await connection.done;
			return;
		}
		if (pathname !== '/__bmsx__/assistant/command') { response.writeHead(404).end(); return; }
		const connection = this.connection;
		if (!connection || !connection.ready || connection.lifetime.signal.aborted || request.headers['x-bmsx-assistant-lease'] !== connection.id) {
			response.writeHead(410).end('Studio assistant connection has retired'); return;
		}
		if (request.headers['content-type'] !== 'application/json') { response.writeHead(415).end('Expected application/json'); return; }
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		let command: AssistantCommand;
		try { command = JSON.parse(Buffer.concat(parts).toString('utf8')); }
		catch { response.writeHead(400).end('Malformed Studio operation'); return; }
		// A request body can arrive after its streaming connection has disconnected.
		if (connection.lifetime.signal.aborted) { response.writeHead(410).end('Studio assistant connection has retired'); return; }
		try {
			switch (command.type) {
				case 'start': {
					const turnId = await connection.session!.startTurn(command.prompt, command.reviews);
					response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ turnId }));
					return;
				}
				case 'interrupt': await connection.session!.interrupt(); break;
				case 'login-start': await connection.session!.startLogin(); break;
				case 'login-cancel': await connection.session!.cancelLogin(); break;
				case 'sign-out': await connection.session!.signOut(); break;
				case 'tool-result': {
					const tool = connection.tools.get(command.requestId);
					if (!tool) { response.writeHead(409).end('Tool request has retired or was already answered'); return; }
					connection.tools.delete(command.requestId); tool.detach();
					tool.resolve({ success: command.success, text: command.text });
					break;
				}
				default: response.writeHead(400).end('Unknown Studio operation'); return;
			}
			response.writeHead(204).end();
		} catch (error) {
			response.writeHead(409, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end((error as Error).message);
		}
	}

	private async connect(connection: Connection): Promise<void> {
		const { response, lifetime } = connection;
		const disconnect = () => lifetime.abort(new Error('Studio assistant event stream disconnected'));
		response.once('close', disconnect);
		response.once('error', disconnect);
		try {
			const session = await CodexSession.open({ ...this.options, signal: lifetime.signal,
				executeTool: (call, signal) => {
					signal.throwIfAborted(); lifetime.signal.throwIfAborted();
					const requestId = randomUUID();
					return new Promise((resolve, reject) => {
						const cancel = () => {
							connection.tools.delete(requestId);
							this.publish(connection, { type: 'tool-cancelled', requestId });
							reject(signal.reason);
						};
						connection.tools.set(requestId, { resolve, detach: () => signal.removeEventListener('abort', cancel) });
						signal.addEventListener('abort', cancel, { once: true });
						this.publish(connection, { type: 'tool-request', requestId, name: call.tool, arguments: call.arguments });
					});
				},
				onEvent: event => this.onEvent(connection, event),
			});
			connection.session = session;
			const account = await session.readAccount();
			lifetime.signal.throwIfAborted();
			response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
			connection.ready = true;
			this.publish(connection, { type: 'connected', lease: connection.id, account: { connected: account.account !== null,
				requiresLogin: account.requiresOpenaiAuth && account.account === null, email: account.account?.email, plan: account.account?.planType } });
			await session.closed;
		} catch (error) {
			if (!response.headersSent && !response.destroyed) response.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end((error as Error).message);
		} finally {
			lifetime.abort();
			try { if (connection.session) await connection.session.close(); }
			finally {
				response.removeListener('close', disconnect);
				response.removeListener('error', disconnect);
				response.end();
				this.connection = undefined;
			}
		}
	}

	private onEvent(connection: Connection, event: CodexSessionEvent): void {
		if (event.type === 'closed') {
			this.publish(connection, { type: 'closed', error: event.error?.message });
			connection.lifetime.abort(event.error);
		} else if (event.type === 'turn-completed') {
			this.publish(connection, { type: 'turn-completed', turnId: event.turn.id,
				status: event.turn.status as 'completed' | 'interrupted' | 'failed', error: event.turn.error?.message });
		} else if (event.type === 'account-changed') {
			this.publish(connection, { type: 'account-changed', account: { connected: event.account.account !== null,
				requiresLogin: event.account.requiresOpenaiAuth && event.account.account === null,
				email: event.account.account?.email, plan: event.account.account?.planType } });
		} else this.publish(connection, event);
	}

	private publish(connection: Connection, event: AssistantEvent): void {
		if (!connection.ready || connection.lifetime.signal.aborted) return;
		connection.response.write(`${JSON.stringify(event)}\n`);
		// A stalled browser must not create an unbounded token-event queue or block
		// Codex response processing. Overflow retires the entire connection; no events
		// are silently dropped/replayed and no pending edit authority survives.
		if (connection.response.writableLength > 8 * 1024 * 1024) {
			connection.lifetime.abort(new Error('Studio assistant event queue exceeded its 8 MiB transport budget'));
			connection.response.destroy();
		}
	}

	public async close(): Promise<void> {
		this.closing = true;
		const connection = this.connection;
		if (connection) { connection.lifetime.abort(); await connection.done; }
	}
}
