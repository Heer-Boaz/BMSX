import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationObserverCommand, ConversationObserverEvent } from '../../common/conversation_observer';
import { CodexObserver } from './observer';

type Viewer = { id: string; response: ServerResponse; lifetime: AbortController; observer?: CodexObserver; done: Promise<void> };

/** Same trusted-LAN admission as Studio. Only this bounded read surface reaches the native daemon. */
export class CodexObserverHttpApi {
	private readonly viewers = new Map<string, Viewer>();
	private closing = false;
	public constructor(private readonly codexHome: string) {}
	public async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
		if (this.closing) { response.writeHead(503).end('Conversation viewers are shutting down'); return; }
		if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
		if (pathname === '/__bmsx__/conversations/connect') {
			const viewer: Viewer = { id: randomUUID(), response, lifetime: new AbortController(), done: undefined };
			this.viewers.set(viewer.id, viewer);
			viewer.done = this.connect(viewer); await viewer.done; return;
		}
		if (pathname !== '/__bmsx__/conversations/command') { response.writeHead(404).end(); return; }
		const viewer = this.viewers.get(request.headers['x-bmsx-conversation-lease'] as string);
		if (!viewer?.observer || viewer.lifetime.signal.aborted) { response.writeHead(410).end('Conversation viewer has retired'); return; }
		if (request.headers['content-type'] !== 'application/json') { response.writeHead(415).end('Expected application/json'); return; }
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		let command: ConversationObserverCommand;
		try { command = JSON.parse(Buffer.concat(parts).toString('utf8')); }
		catch { response.writeHead(400).end('Malformed conversation operation'); return; }
		if (viewer.lifetime.signal.aborted) { response.writeHead(410).end('Conversation viewer has retired'); return; }
		try {
			const result = await viewer.observer.command(command);
			if (result === undefined) response.writeHead(204).end();
			else response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
		} catch (error) { response.writeHead(409, { 'Cache-Control': 'no-store' }).end((error as Error).message); }
	}
	private async connect(viewer: Viewer): Promise<void> {
		const { response, lifetime } = viewer;
		const disconnect = () => lifetime.abort();
		const drain = () => viewer.observer!.setOutputPaused(false);
		response.once('close', disconnect); response.once('error', disconnect);
		try {
			viewer.observer = await CodexObserver.open(this.codexHome, lifetime.signal, event => this.publish(viewer, event));
			lifetime.signal.throwIfAborted();
			response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
			response.on('drain', drain);
			this.publish(viewer, { type: 'connected', lease: viewer.id });
			await viewer.observer.closed;
			if (!lifetime.signal.aborted) this.publish(viewer, { type: 'closed', error: 'Shared Codex daemon disconnected. Reopen the viewer to connect again.' });
		} catch (error) {
			if (!response.headersSent && !response.destroyed) response.writeHead(503, { 'Cache-Control': 'no-store' }).end(
				`Cannot connect to the shared Codex daemon. Start it with "codex app-server daemon start", then continue the same thread using "codex resume --remote unix:// <thread-id>". Leave a standalone CLI session before resuming it there. No conversation was copied or started.\n${(error as Error).message}`);
		} finally {
			lifetime.abort();
			if (viewer.observer) await viewer.observer.close();
			response.removeListener('drain', drain); response.removeListener('close', disconnect); response.removeListener('error', disconnect);
			response.end(); this.viewers.delete(viewer.id);
		}
	}
	private publish(viewer: Viewer, event: ConversationObserverEvent): void {
		if (!viewer.response.headersSent || viewer.lifetime.signal.aborted) return;
		if (!viewer.response.write(`${JSON.stringify(event)}\n`)) viewer.observer!.setOutputPaused(true);
	}
	public async close(): Promise<void> {
		this.closing = true;
		await Promise.all(Array.from(this.viewers.values(), viewer => { viewer.lifetime.abort(); return viewer.done; }));
	}
}
