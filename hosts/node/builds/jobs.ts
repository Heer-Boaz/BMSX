import { BuildLedger } from './ledger';
import { BuildRequestError } from './errors';
import { fork, type ChildProcess } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isBuildTerminal, type StudioBuildRequest, type StudioBuildJob, type StudioBuildSnapshot, type StudioBuildChange } from '../../common/studio_builds';
import { RomArtifactStore, type PreparedRomArtifact } from '../../../scripts/rompacker/artifacts';
import type { MediaBuildOptions } from '../../../scripts/rompacker/build';

const RECENT_JOBS = 50, QUEUE_LIMIT = 8, LOG_BYTES = 256 * 1024;
type WorkerMessage = { type: 'progress'; phase: string } | { type: 'prepared'; result: PreparedRomArtifact } | { type: 'failed'; error: string };
type Running = { id: string; child: ChildProcess; stop?: 'cancelled' | 'interrupted'; publishing: boolean; done: Promise<void> };

/** One workspace's durable admission ledger and serialized producer lifetime. No browser/process authority leaks into it. */
export class StudioBuildJobs {
	private readonly jobs = new Map<string, StudioBuildJob>();
	private readonly admitting = new Map<string, { request: StudioBuildRequest; result: Promise<StudioBuildJob> }>();
	private readonly listeners = new Set<(change: StudioBuildChange) => void>();
	private readonly queue: string[] = [];
	private running: Running | undefined;
	private draining: Promise<void> | undefined;
	private closing = false;
	private revision = 0;
	public readonly artifacts: RomArtifactStore;

	private constructor(public readonly workspace: string, public readonly root: string, private readonly ledger: BuildLedger) { this.artifacts = new RomArtifactStore(root); }

	public static async open(workspace: string, root: string): Promise<StudioBuildJobs> {
		const ledger = await BuildLedger.open(root), owner = new StudioBuildJobs(workspace, root, ledger);
		try {
			await mkdir(join(root, 'jobs'), { recursive: true });
			for (const previous of ledger.unfinished()) {
				let committed = false;
				if (previous.state === 'publishing') {
					try { await owner.artifacts.read(previous.artifact!); committed = true; }
					catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
				}
				owner.transition(previous, { state: committed ? 'completed' : 'interrupted',
					phase: committed ? 'Published' : 'Server stopped before publication' });
				await rm(owner.artifacts.staging(previous.request.requestId), { recursive: true, force: true });
			}
			owner.jobs.clear();
			for (const job of ledger.recent(RECENT_JOBS)) owner.jobs.set(job.request.requestId, job);
			return owner;
		} catch (error) { ledger.close(); throw error; }
	}

	public snapshot(): StudioBuildSnapshot { return { generation: this.ledger.generation, revision: this.revision, jobs: [...this.jobs.values()] }; }
	public subscribe(listener: (change: StudioBuildChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public async targets(): Promise<string[]> {
		const entries = await readdir(join(this.workspace, 'carts'), { withFileTypes: true });
		return entries.filter(entry => entry.isDirectory() && /^[a-z0-9_-]+$/.test(entry.name)).map(entry => entry.name).sort();
	}

	public get(id: string): StudioBuildJob | undefined {
		const retained = this.jobs.get(id);
		if (retained !== undefined) return retained;
		return this.ledger.read(id);
	}

	public async admit(request: StudioBuildRequest): Promise<StudioBuildJob> {
		const pending = this.admitting.get(request.requestId);
		const previous = pending === undefined ? this.get(request.requestId) : undefined;
		const accepted = pending?.request ?? previous?.request;
		if (accepted !== undefined) {
			if (accepted.target !== request.target || accepted.debug !== request.debug || accepted.optLevel !== request.optLevel) {
				throw new BuildRequestError(409, 'Request ID already names a different build');
			}
			return pending === undefined ? previous! : pending.result;
		}
		const result = this.accept(request);
		this.admitting.set(request.requestId, { request, result });
		try { return await result; } finally { this.admitting.delete(request.requestId); }
	}

	private async accept(request: StudioBuildRequest): Promise<StudioBuildJob> {
		if (!(await this.targets()).includes(request.target)) throw new BuildRequestError(404, 'Unknown cartridge target');
		// Admission is synchronous from here: concurrent discovery cannot overfill the queue
		// or admit new work after close() has stopped admission.
		if (this.closing) throw new BuildRequestError(503, 'Build service is shutting down');
		if (this.queue.length >= QUEUE_LIMIT) throw new BuildRequestError(429, 'Build queue is full');
		const job = this.changed({ request, state: 'queued', phase: 'Waiting to capture saved inputs', acceptedAt: Date.now(), updatedAt: Date.now() }, true);
		this.queue.push(request.requestId); this.pump();
		return job;
	}

	public async cancel(id: string): Promise<StudioBuildJob> {
		const admission = this.admitting.get(id);
		if (admission !== undefined) await admission.result;
		const job = this.get(id);
		if (job === undefined) throw new BuildRequestError(404, 'Unknown build request ID');
		if (isBuildTerminal(job.state)) return job;
		if (this.running?.id === id) {
			if (!this.running.publishing) { this.running.stop = 'cancelled'; this.running.child.kill('SIGKILL'); }
			await this.running.done; // Cancellation acknowledges termination, not merely a signal.
		} else {
			this.queue.splice(this.queue.indexOf(id), 1);
			this.transition(job, { state: 'cancelled', phase: 'Cancelled before input capture' });
		}
		return this.get(id)!;
	}

	private pump(): void {
		if (this.draining !== undefined) return;
		this.draining = this.drain().catch(error => { this.closing = true; console.error('Build ledger unavailable:', error); }).finally(() => { this.draining = undefined; if (this.queue.length !== 0 && !this.closing) this.pump(); });
	}

	private async drain(): Promise<void> {
		while (this.queue.length !== 0 && !this.closing) {
			const id = this.queue.shift()!;
			const job = this.jobs.get(id)!;
			const child = fork(fileURLToPath(new URL('../../../scripts/rompacker/worker.ts', import.meta.url)), [], {
				cwd: this.workspace, execArgv: ['--import', createRequire(import.meta.url).resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
			});
			const running: Running = { id, child, publishing: false, done: undefined };
			this.running = running;
			running.done = this.execute(job, running);
			await running.done;
			this.running = undefined;
		}
	}

	private async execute(job: StudioBuildJob, running: Running): Promise<void> {
		const stage = this.artifacts.staging(job.request.requestId);
		const log = createWriteStream(join(this.root, 'jobs', `${job.request.requestId}.log`));
		let logged = 0, result: PreparedRomArtifact | undefined, failure: string | undefined, progressTimer: ReturnType<typeof setTimeout> | undefined, phase = '';
		const logClosed = finished(log).catch(error => { failure = `Build log: ${String(error)}`; running.child.kill('SIGKILL'); });
		const output = (bytes: Buffer) => {
			if (log.destroyed || logged >= LOG_BYTES) return;
			const chunk = bytes.subarray(0, LOG_BYTES - logged); log.write(chunk); logged += chunk.length;
			if (logged === LOG_BYTES) log.write('\n[Build log truncated at 256 KiB]\n');
		};
		running.child.stdout!.on('data', output); running.child.stderr!.on('data', output);
		const flushProgress = () => { progressTimer = undefined; this.changed({ ...this.jobs.get(job.request.requestId)!, phase, updatedAt: Date.now() }); };
		running.child.on('message', (message: WorkerMessage) => {
			if (message.type === 'prepared') result = message.result;
			else if (message.type === 'failed') failure = message.error;
			else { phase = message.phase; if (progressTimer === undefined) progressTimer = setTimeout(flushProgress, 100); }
		});
		const exited = new Promise<void>(resolve => {
			running.child.once('error', error => { failure = String(error); });
			running.child.once('close', () => resolve());
		});
		try {
			job = this.transition(job, { state: 'running', phase: 'Capture inputs' });
			const options: MediaBuildOptions = { domain: 'cart', target: job.request.target, debug: job.request.debug, optLevel: job.request.optLevel, force: false };
			running.child.send({ options, root: this.root, stage });
			await exited;
			log.end(); await logClosed;
			clearTimeout(progressTimer);
			if (running.stop !== undefined) { this.transition(job, { state: running.stop, phase: 'Producer stopped' }); return; }
			if (failure !== undefined || result === undefined) throw new Error(failure ?? 'Build worker exited without a result');
			running.publishing = true;
			job = this.transition(job, { state: 'publishing', phase: 'Publish complete artifact', artifact: result.artifact.id });
			// No await between cancellation arbitration and entering publication; publication wins from here.
			if (!result.reused) await this.artifacts.publish(stage, result.artifact);
			this.transition(job, { state: 'completed', phase: result.reused ? 'Unchanged artifact available' : 'New artifact available' });
		} catch (error) {
			running.child.kill('SIGKILL'); await exited;
			let committed = false;
			if (job.state === 'publishing') {
				try { await this.artifacts.read(job.artifact!); committed = true; }
				catch (readError) { if ((readError as NodeJS.ErrnoException).code !== 'ENOENT') throw readError; }
			}
			this.transition(job, { state: committed ? 'completed' : running.stop ?? 'failed', phase: committed ? 'Published; catalog update failed' : 'Producer stopped', error: error instanceof Error ? error.message : String(error) });
		} finally {
			clearTimeout(progressTimer);
			if (!log.writableEnded) log.end();
			await logClosed;
			await rm(stage, { recursive: true, force: true });
		}
	}

	private changed(value: Omit<StudioBuildJob, 'version'>, durable = false): StudioBuildJob {
		const job: StudioBuildJob = { ...value, version: { generation: this.ledger.generation, sequence: this.revision + 1 } };
		if (durable) this.ledger.record(job); // Commit admission/transitions before acknowledgement or publication.
		this.jobs.set(job.request.requestId, job);
		if (this.jobs.size > RECENT_JOBS) {
			const oldest = [...this.jobs.values()].filter(job => isBuildTerminal(job.state)).sort((a, b) => a.acceptedAt - b.acceptedAt)[0];
			if (oldest !== undefined) this.jobs.delete(oldest.request.requestId);
		}
		const change = { revision: ++this.revision, job };
		for (const listener of this.listeners) listener(change);
		return job;
	}
	private transition(job: StudioBuildJob, update: Partial<StudioBuildJob>): StudioBuildJob {
		return this.changed({ ...job, ...update, updatedAt: Date.now() }, true);
	}
	public async close(): Promise<void> {
		this.closing = true;
		await Promise.allSettled([...this.admitting.values()].map(admission => admission.result));
		for (const id of this.queue.splice(0)) this.transition(this.jobs.get(id)!, { state: 'interrupted', phase: 'Server stopped before input capture' });
		if (this.running !== undefined && !this.running.publishing) {
			this.running.stop = 'interrupted'; this.running.child.kill('SIGKILL');
		}
		await this.draining;
		this.ledger.close();
	}
}
