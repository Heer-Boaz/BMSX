import { compareBuildVersions, isBuildTerminal, type StudioBuildJob, type StudioBuildRequest, type StudioBuildSnapshot, type StudioBuildChange } from '../../hosts/common/studio_builds';
import type { WorkspaceBuilds } from '../workbench/services/builds';
import { generateUuid } from '../common/uuid';
import type { StudioHttpSession } from './http_session';
import { StoredBuildRequests } from './build_requests';

class BuildHttpError extends Error {
	public constructor(public readonly status: number, detail: string) { super(detail); }
}

/** Browser owns observation and uncertain request receipts, never producer lifetime. */
export class HttpWorkspaceBuilds implements WorkspaceBuilds {
	public jobs: readonly StudioBuildJob[] = [];
	private revision = -1;
	private readonly requests: StoredBuildRequests;
	public constructor(private readonly session: StudioHttpSession, private readonly finished: (job: StudioBuildJob) => void) {
		this.requests = new StoredBuildRequests(session.baseUrl);
	}
	public get pending(): readonly StudioBuildRequest[] { return this.requests.pending; }
	public dispose(): void { this.requests.dispose(); }

	public snapshot(snapshot: StudioBuildSnapshot): void {
		const observed = new Map(this.jobs.map(job => [job.request.requestId, job]));
		const jobs = new Map<string, StudioBuildJob>();
		for (const job of snapshot.jobs) {
			const id = job.request.requestId, previous = observed.get(id);
			if (previous !== undefined && compareBuildVersions(previous.version, job.version) >= 0) jobs.set(id, previous);
			else {
				jobs.set(id, job);
				if (previous !== undefined && !isBuildTerminal(previous.state) && isBuildTerminal(job.state)) this.finished(job);
			}
			if (previous === undefined) this.requests.delete(job.request.requestId);
		}
		const version = { generation: snapshot.generation, sequence: snapshot.revision };
		for (const job of observed.values()) {
			// An HTTP receipt can overtake the stream's initial/backpressure snapshot.
			if (compareBuildVersions(job.version, version) > 0) jobs.set(job.request.requestId, job);
		}
		this.revision = snapshot.revision; this.retain([...jobs.values()]);
	}
	public change(change: StudioBuildChange): void {
		if (change.revision !== this.revision + 1) throw new Error('Build observation sequence interrupted; a fresh snapshot is required');
		this.revision = change.revision;
		const job = change.job, previous = this.jobs.find(entry => entry.request.requestId === job.request.requestId);
		if (previous !== undefined && compareBuildVersions(previous.version, job.version) >= 0) return;
		this.retain([job, ...this.jobs.filter(entry => entry.request.requestId !== job.request.requestId)]);
		if (previous === undefined) this.requests.delete(job.request.requestId);
		if (isBuildTerminal(job.state) && previous?.state !== job.state) this.finished(job);
	}

	public async targets(): Promise<readonly string[]> { return (await this.request('/targets')).json(); }
	public async submit(target: string, debug: boolean, optLevel: 0 | 1 | 2 | 3): Promise<StudioBuildJob> {
		const request = { requestId: generateUuid(), target, debug, optLevel };
		this.requests.add(request); // Commit recovery identity before making the request.
		try {
			const response = await this.request(`/jobs/${request.requestId}`, 'PUT', request);
			const job = await response.json() as StudioBuildJob;
			return this.acknowledge(job);
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
		return this.acknowledge(job);
	}
	public async cancel(id: string): Promise<StudioBuildJob> {
		const job = await (await this.request(`/jobs/${id}/cancel`, 'POST')).json() as StudioBuildJob;
		return this.acknowledge(job);
	}
	public async log(id: string): Promise<string> { return (await this.request(`/jobs/${id}/log`)).json(); }

	public forget(id: string): void { this.requests.delete(id); }

	private acknowledge(job: StudioBuildJob): StudioBuildJob {
		const id = job.request.requestId, current = this.jobs.find(entry => entry.request.requestId === id);
		if (current === undefined || compareBuildVersions(job.version, current.version) > 0) {
			this.retain([job, ...this.jobs.filter(entry => entry !== current)]);
		} else job = current;
		this.requests.delete(id);
		return job;
	}
	private retain(jobs: StudioBuildJob[]): void {
		// Like the server, never evict a running/queued job to retain an older completed receipt.
		if (jobs.length <= 50) { this.jobs = jobs; return; }
		const active: StudioBuildJob[] = [], terminal: StudioBuildJob[] = [];
		for (const job of jobs) (isBuildTerminal(job.state) ? terminal : active).push(job);
		terminal.sort((a, b) => b.acceptedAt - a.acceptedAt);
		this.jobs = [...active, ...terminal.slice(0, 50 - active.length)];
	}
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
