import type { StudioBuildJobs } from '../builds/jobs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { StudioBrowserSessionInfo, StudioHeadlessCloseResult, StudioHeadlessSessionInfo, StudioHeadlessStartRequest,
	StudioHeadlessStartResult, StudioSessionDescriptor, StudioSessionInfo, StudioToolEvent, StudioToolOperation, StudioToolReply, StudioToolResult } from '../../common/studio_tools';
import { STUDIO_HEARTBEAT_MS, STUDIO_LIVENESS_MS } from '../../common/studio_tools';
import type { HeadlessStudio } from './headless';

type Pending = { resolve: (result: StudioToolResult) => void; reject: (error: unknown) => void };
type BrowserSession = { info: StudioBrowserSessionInfo; response: ServerResponse; lifetime: AbortController; requests: Map<string, Pending>;
	timer: ReturnType<typeof setInterval>; sequence: number; awaiting: boolean; sentAt: number; buildsBlocked: boolean };
type HostedSession = { info: StudioHeadlessSessionInfo; host: HeadlessStudio; unlisten: () => void;
	closing?: { discardUnsaved: boolean; completion: Promise<StudioHeadlessCloseResult> } };
type Session = BrowserSession | HostedSession;
type HeadlessStart = { request: StudioHeadlessStartRequest; ready: Promise<StudioHeadlessSessionInfo> };

/** Explicit Studio lifetimes, not agent conversations. Browser transport and hosted workspaces retain their own IO. */
export class StudioSessions {
	private readonly sessions = new Map<string, Session>();
	private readonly starts = new Map<string, HeadlessStart>();
	private closing = false;
	private shutdown: Promise<void> | undefined;
	public readonly incarnation = randomUUID();
	private readonly stopBuildObservation: (() => void) | undefined;
	public constructor(private readonly builds?: StudioBuildJobs) {
		this.stopBuildObservation = builds?.subscribe(change => {
			for (const session of this.sessions.values()) {
				if ('response' in session && session.info.builds && !session.buildsBlocked) session.buildsBlocked = !this.publish(session, { type: 'build-change', change });
			}
		});
	}

	public list(): StudioSessionInfo[] { return Array.from(this.sessions.values()).filter(session => session.info.tools).map(session => session.info); }

	/** Admission survives an MCP request cancellation. Reusing its UUID reconciles one physical start, never retries it. */
	public async startHeadless(request: StudioHeadlessStartRequest): Promise<StudioHeadlessStartResult> {
		if (this.closing) throw new Error('Studio sessions are shutting down');
		let start = this.starts.get(request.requestId);
		if (start !== undefined) {
			if (start.request.buildRequestId !== request.buildRequestId || start.request.sourceAccess !== request.sourceAccess) {
				throw new Error('Headless request ID already names a different Studio session');
			}
		} else {
			const accepted = { ...request };
			start = { request: accepted, ready: this.openHeadless(accepted) };
			this.starts.set(request.requestId, start);
		}
		const info = await start.ready;
		return this.sessions.has(info.id) ? { requestId: request.requestId, status: 'ready', session: info }
			: { requestId: request.requestId, status: 'closed', session: info.id };
	}

	private async openHeadless(request: StudioHeadlessStartRequest): Promise<StudioHeadlessSessionInfo> {
		if (this.builds === undefined) throw new Error('This server has no workspace build service');
		const job = this.builds.get(request.buildRequestId);
		if (job === undefined || job.state !== 'completed') throw new Error('Headless Studio requires a completed workspace build');
		if (job.project === undefined) throw new Error('This build artifact is not admitted to a source project. Rebuild the project before starting headless Studio.');
		const artifact = await this.builds.artifacts.read(job.artifact!);
		const directory = this.builds.artifacts.directory(artifact.id);
		const systemRomPath = join(directory, artifact.system.outputs.find(output => output.file.endsWith('.rom'))!.file);
		const cartridgeRomPath = join(directory, artifact.cart!.outputs.find(output => output.file.endsWith('.rom'))!.file);
		if (this.closing) throw new Error('Studio sessions are shutting down');
		const { HeadlessStudio } = await import('./headless');
		const info: StudioHeadlessSessionInfo = { id: randomUUID(), kind: 'headless', title: artifact.target, tools: true, builds: false,
			requestId: request.requestId, buildRequestId: request.buildRequestId, sourceAccess: request.sourceAccess, reviewApproval: 'agent' };
		const host = await HeadlessStudio.open({ workspaceRoot: this.builds.workspace, project: job.project, systemRomPath,
			cartridgeSlots: [cartridgeRomPath, null], sourceAccess: request.sourceAccess, recoveryIdentity: request.requestId });
		if (this.closing) { await host.shutdown(); throw new Error('Studio sessions are shutting down'); }
		if (host.closed) throw new Error('Headless Studio exited during startup');
		const session: HostedSession = { info, host, unlisten: undefined };
		session.unlisten = host.onDidClose(() => this.retireHosted(session));
		this.sessions.set(info.id, session);
		return info;
	}

	/** Closing a hosted target cannot close a human's browser window or silently discard its drafts. */
	public async closeHeadless(id: string, discardUnsaved: boolean): Promise<StudioHeadlessCloseResult> {
		const session = this.sessions.get(id);
		if (session === undefined) throw new Error('Headless Studio session is no longer active');
		if (!('host' in session)) throw new Error('Only server-owned headless Studio sessions can be closed here');
		if (session.closing !== undefined) {
			if (session.closing.discardUnsaved !== discardUnsaved) throw new Error('A different close request is already pending');
			return session.closing.completion;
		}
		const completion = session.host.close({ discardUnsaved }).finally(() => { session.closing = undefined; });
		session.closing = { discardUnsaved, completion };
		const result = await completion;
		if (result.status === 'closed') this.retireHosted(session);
		return result;
	}

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
			const descriptor = body as StudioSessionDescriptor;
			const session: BrowserSession = { info: { title: descriptor.title, url: descriptor.url, tools: descriptor.tools, builds: descriptor.builds,
				id: randomUUID(), kind: 'browser', sourceAccess: 'edit', reviewApproval: 'user' }, response,
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
		if (session === undefined || !('response' in session)) { response.writeHead(410).end('Studio window has disconnected'); return; }
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
		if (this.closing) throw new Error('Studio sessions are shutting down');
		const session = this.sessions.get(id);
		if (session === undefined) throw new Error('Studio session has closed. List sessions and explicitly open a new context.');
		if (!session.info.tools) throw new Error('External tools are not enabled in this Studio session.');
		if ('host' in session) {
			if (session.closing !== undefined) throw new Error('Headless Studio session is closing');
			return session.host.execute(operation, signal);
		}
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
		if (session !== undefined) {
			if ('host' in session) session.host.release(context);
			else this.publish(session, { type: 'release', context });
		}
	}

	private publish(session: BrowserSession, event: StudioToolEvent): boolean {
		if (session.lifetime.signal.aborted) return true;
		return session.response.write(`${JSON.stringify(event)}\n`);
	}

	private retire(session: BrowserSession): void {
		clearInterval(session.timer);
		this.sessions.delete(session.info.id);
		const error = new Error('Studio window disconnected. An unanswered operation may have executed; do not replay it.');
		session.lifetime.abort(error);
		for (const request of session.requests.values()) request.reject(error);
		session.requests.clear();
	}

	private retireHosted(session: HostedSession): void {
		this.sessions.delete(session.info.id);
		session.unlisten();
	}

	public close(): Promise<void> {
		if (this.shutdown !== undefined) return this.shutdown;
		this.closing = true;
		this.stopBuildObservation?.();
		for (const session of this.sessions.values()) {
			if ('response' in session) { this.retire(session); session.response.end(); }
		}
		this.shutdown = this.closeHosted();
		return this.shutdown;
	}

	private async closeHosted(): Promise<void> {
		await Promise.allSettled(Array.from(this.starts.values(), start => start.ready));
		await Promise.all(Array.from(this.sessions.values(), async session => {
			if ('host' in session) { await session.host.shutdown(); this.retireHosted(session); }
		}));
	}
}
