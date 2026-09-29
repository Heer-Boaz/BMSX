import type { StudioBuildJobs } from '../builds/jobs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioSessionDescriptor, StudioSessionInfo, StudioToolEvent, StudioToolOperation, StudioToolReply, StudioToolResult } from '../../common/studio_tools';
import { STUDIO_HEARTBEAT_MS, STUDIO_LIVENESS_MS } from '../../common/studio_tools';

type Pending = { resolve: (result: StudioToolResult) => void; reject: (error: unknown) => void };
type Session = { info: StudioSessionInfo; response: ServerResponse; lifetime: AbortController; requests: Map<string, Pending>;
	timer: ReturnType<typeof setInterval>; sequence: number; awaiting: boolean; sentAt: number; buildsBlocked: boolean };

/** Live Studio windows, not agent conversations. The HTTP composition authorizes before entry. */
export class StudioSessions {
	private readonly sessions = new Map<string, Session>();
	private closing = false;
	public readonly incarnation = randomUUID();
	private readonly stopBuildObservation: (() => void) | undefined;
	public constructor(private readonly builds?: StudioBuildJobs) {
		this.stopBuildObservation = builds?.subscribe(change => {
			for (const session of this.sessions.values()) {
				if (session.info.builds && !session.buildsBlocked) session.buildsBlocked = !this.publish(session, { type: 'build-change', change });
			}
		});
	}

	public list(): StudioSessionInfo[] { return Array.from(this.sessions.values()).filter(session => session.info.tools).map(session => session.info); }

	public async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
		if (this.closing) { response.writeHead(503).end('Studio tools are shutting down'); return; }
		if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
		if (!['/__bmsx__/studio/connect', '/__bmsx__/studio/reply', '/__bmsx__/studio/heartbeat'].includes(pathname)) { response.writeHead(404).end(); return; }
		if (request.headers['content-type'] !== 'application/json') { response.writeHead(415).end('Expected application/json'); return; }
		const parts: Buffer[] = [];
		for await (const part of request) parts.push(part);
		let body: StudioSessionDescriptor | StudioToolReply | { sequence: number };
		try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
		catch { response.writeHead(400).end('Malformed Studio message'); return; }
		if (pathname === '/__bmsx__/studio/connect') {
			const session: Session = { info: { ...body as StudioSessionDescriptor, id: randomUUID() }, response,
				lifetime: new AbortController(), requests: new Map(), timer: undefined, sequence: 0, awaiting: false, sentAt: 0, buildsBlocked: false };
			const disconnect = () => this.retire(session);
			response.once('close', disconnect); response.once('error', disconnect);
			this.sessions.set(session.info.id, session);
			response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
			this.publish(session, { type: 'connected', session: session.info.id, server: this.incarnation, builds: session.info.builds ? this.builds!.snapshot() : undefined });
			response.on('drain', () => {
				if (session.buildsBlocked) session.buildsBlocked = !this.publish(session, { type: 'build-snapshot', snapshot: this.builds!.snapshot() });
			});
			session.timer = setInterval(() => {
				if (session.awaiting) {
					if (performance.now() - session.sentAt >= STUDIO_LIVENESS_MS) { this.retire(session); response.destroy(); }
					return;
				}
				session.awaiting = true; session.sentAt = performance.now();
				this.publish(session, { type: 'heartbeat', sequence: ++session.sequence });
			}, STUDIO_HEARTBEAT_MS);
			session.timer.unref();
			return;
		}
		const session = this.sessions.get(request.headers['x-bmsx-studio-session'] as string);
		if (!session) { response.writeHead(410).end('Studio window has disconnected'); return; }
		if (pathname === '/__bmsx__/studio/heartbeat') {
			if ((body as { sequence: number }).sequence !== session.sequence) { response.writeHead(409).end(); return; }
			session.awaiting = false;
			response.writeHead(204).end(); return;
		}
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
		if (!session.info.tools) throw new Error('External tools are not enabled in this Studio window.');
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
		clearInterval(session.timer);
		this.sessions.delete(session.info.id);
		const error = new Error('Studio window disconnected. An unanswered operation may have executed; do not replay it.');
		session.lifetime.abort(error);
		for (const request of session.requests.values()) request.reject(error);
		session.requests.clear();
	}

	public close(): void {
		this.closing = true;
		this.stopBuildObservation?.();
		for (const session of this.sessions.values()) { this.retire(session); session.response.end(); }
	}
}
