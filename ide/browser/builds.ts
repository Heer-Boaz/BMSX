import { isBuildTerminal, type StudioBuildJob, type StudioBuildRequest, type StudioBuildSnapshot, type StudioBuildChange } from '../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../workbench/services/builds';
import { generateUuid } from '../common/uuid';
import type { StudioHttpSession } from './http_session';

class BuildHttpError extends Error {
	public constructor(public readonly status: number, detail: string) { super(detail); }
}

/** Browser owns observation and uncertain request receipts, never producer lifetime. */
export class HttpWorkspaceBuilds implements WorkspaceBuilds {
	public jobs: readonly StudioBuildJob[] = [];
	public pending: readonly StudioBuildRequest[];
	private revision = -1;
	private readonly storageKey: string;
	public constructor(private readonly session: StudioHttpSession, private readonly finished: (job: StudioBuildJob) => void) {
		this.storageKey = `bmsx-build-requests:${session.baseUrl}`;
		const saved = localStorage.getItem(this.storageKey);
		this.pending = saved === null ? [] : JSON.parse(saved);
	}

	public snapshot(snapshot: StudioBuildSnapshot): void {
		for (const job of snapshot.jobs) {
			const previous = this.jobs.find(entry => entry.request.requestId === job.request.requestId);
			if (previous !== undefined && !isBuildTerminal(previous.state) && isBuildTerminal(job.state)) this.finished(job);
		}
		this.revision = snapshot.revision; this.jobs = snapshot.jobs;
		this.pending = this.pending.filter(request => !this.jobs.some(job => job.request.requestId === request.requestId));
		this.persist();
	}
	public change(change: StudioBuildChange): void {
		if (change.revision !== this.revision + 1) throw new Error('Build observation sequence interrupted; a fresh snapshot is required');
		this.revision = change.revision;
		const job = change.job, previous = this.jobs.find(entry => entry.request.requestId === job.request.requestId);
		this.jobs = [job, ...this.jobs.filter(entry => entry.request.requestId !== job.request.requestId)].slice(0, 50);
		if (this.pending.some(request => request.requestId === job.request.requestId)) {
			this.pending = this.pending.filter(request => request.requestId !== job.request.requestId); this.persist();
		}
		if (isBuildTerminal(job.state) && previous?.state !== job.state) this.finished(job);
	}

	public async targets(): Promise<readonly string[]> { return (await this.request('/targets')).json(); }
	public async submit(target: string, debug: boolean, optLevel: 0 | 1 | 2 | 3): Promise<StudioBuildJob> {
		const request = { requestId: generateUuid(), target, debug, optLevel };
		this.pending = [...this.pending, request]; this.persist(); // Survives a reload before the acknowledgement.
		try {
			const response = await this.request(`/jobs/${request.requestId}`, 'PUT', request);
			const job = await response.json() as StudioBuildJob;
			this.pending = this.pending.filter(entry => entry.requestId !== request.requestId); this.persist();
			return job;
		} catch (error) {
			if (error instanceof BuildHttpError && error.status >= 400 && error.status < 500) {
				this.forget(request.requestId); throw error;
			}
			throw new Error(`Build acknowledgement unavailable. Inspect request ${request.requestId} in Build Jobs before starting another build. ${String(error)}`); }
	}
	public async get(id: string): Promise<StudioBuildJob | undefined> {
		const response = await this.request(`/jobs/${id}`, 'GET', undefined, true);
		if (response.status === 404) return undefined;
		const job = await response.json() as StudioBuildJob;
		this.pending = this.pending.filter(entry => entry.requestId !== id); this.persist();
		return job;
	}
	public async cancel(id: string): Promise<StudioBuildJob> { return (await this.request(`/jobs/${id}/cancel`, 'POST')).json(); }
	public async log(id: string): Promise<string> { return (await this.request(`/jobs/${id}/log`)).json(); }

	public forget(id: string): void { this.pending = this.pending.filter(request => request.requestId !== id); this.persist(); }

	private persist(): void { localStorage.setItem(this.storageKey, JSON.stringify(this.pending)); }
	private async request(path: string, method = 'GET', body?: unknown, allowNotFound = false): Promise<Response> {
		for (let attempt = 0; ; attempt++) {
			const admission = this.session.connect();
			const response = await fetch(`${this.session.baseUrl}/__bmsx__/builds${path}`, { method, cache: 'no-store',
				headers: { Authorization: `Bearer ${await admission}`, 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
			if (response.status === 401 && attempt === 0) { this.session.expire(admission); continue; } // Explicit pre-operation rejection only.
			if (!response.ok && !(allowNotFound && response.status === 404)) throw new BuildHttpError(response.status, await response.text());
			return response;
		}
	}
}
