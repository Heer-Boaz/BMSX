import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioSessionDescriptor, StudioSessionInfo, StudioToolEvent, StudioToolOperation, StudioToolReply, StudioToolResult } from '../../common/studio_tools';

type Pending = { resolve: (result: StudioToolResult) => void; reject: (error: unknown) => void };
type Session = { info: StudioSessionInfo; response: ServerResponse; lifetime: AbortController; requests: Map<string, Pending> };

/** Live Studio windows, not agent conversations. The HTTP composition authorizes before entry. */
export class StudioSessions {
	private readonly sessions = new Map<string, Session>();
	private closing = false;

	public list(): StudioSessionInfo[] { return Array.from(this.sessions.values(), session => session.info); }

	public async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
		if (this.closing) { response.writeHead(503).end('Studio tools are shutting down'); return; }
		if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
		if (pathname !== '/__bmsx__/studio/connect' && pathname !== '/__bmsx__/studio/reply') { response.writeHead(404).end(); return; }
		if (request.headers['content-type'] !== 'application/json') { response.writeHead(415).end('Expected application/json'); return; }
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		let body: StudioSessionDescriptor | StudioToolReply;
		try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
		catch { response.writeHead(400).end('Malformed Studio message'); return; }
		if (pathname === '/__bmsx__/studio/connect') {
			const session: Session = { info: { ...body as StudioSessionDescriptor, id: randomUUID() }, response,
				lifetime: new AbortController(), requests: new Map() };
			const disconnect = () => this.retire(session);
			response.once('close', disconnect); response.once('error', disconnect);
			this.sessions.set(session.info.id, session);
			response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
			this.publish(session, { type: 'connected', session: session.info.id });
			return;
		}
		const session = this.sessions.get(request.headers['x-bmsx-studio-session'] as string);
		if (!session) { response.writeHead(410).end('Studio window has disconnected'); return; }
		const reply = body as StudioToolReply, pending = session.requests.get(reply.request);
		if (!pending) { response.writeHead(409).end('Studio tool request has retired'); return; }
		session.requests.delete(reply.request);
		pending.resolve(reply);
		response.writeHead(204).end();
	}

	public async invoke(id: string, operation: StudioToolOperation, signal: AbortSignal): Promise<StudioToolResult> {
		signal.throwIfAborted();
		const session = this.sessions.get(id);
		if (!session) throw new Error('Studio window has disconnected. List sessions and explicitly open a new context.');
		const request = randomUUID(), pending = Promise.withResolvers<StudioToolResult>();
		const cancel = () => {
			session.requests.delete(request);
			this.publish(session, { type: 'cancel', request });
			pending.reject(signal.reason);
		};
		session.requests.set(request, pending);
		signal.addEventListener('abort', cancel, { once: true });
		const completion = pending.promise.finally(() => {
			session.requests.delete(request);
			signal.removeEventListener('abort', cancel);
		});
		// Node's writable buffer owns backpressure; commands are never replayed.
		const drain = this.publish(session, { type: 'request', request, operation })
			? Promise.resolve() : once(session.response, 'drain', { signal: session.lifetime.signal });
		const [, result] = await Promise.all([drain, completion]);
		return result;
	}

	public release(id: string, context: string): void {
		const session = this.sessions.get(id);
		if (session) this.publish(session, { type: 'release', context });
	}

	private publish(session: Session, event: StudioToolEvent): boolean {
		if (session.lifetime.signal.aborted) return true;
		return session.response.write(`${JSON.stringify(event)}\n`);
	}

	private retire(session: Session): void {
		this.sessions.delete(session.info.id);
		const error = new Error('Studio window disconnected');
		session.lifetime.abort(error);
		for (const request of session.requests.values()) request.reject(error);
		session.requests.clear();
	}

	public close(): void {
		this.closing = true;
		for (const session of this.sessions.values()) { this.retire(session); session.response.end(); }
	}
}
