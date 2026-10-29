import { Worker } from 'node:worker_threads';
import { DiskWorkspaceRecordProvider } from '../../../ide/node/workspace_records';
import type { StudioHeadlessCloseResult, StudioToolOperation, StudioToolResult } from '../../common/studio_tools';
import type { HeadlessStudioOptions, HeadlessStudioReply, StudioWorkspaceRequest, StudioWorkspaceReply, StudioWorkspaceValue } from './headless_protocol';

export type { HeadlessStudioOptions } from './headless_protocol';

type Pending<T> = { resolve(value: T): void; reject(error: unknown): void };

/** One Node realm owns one Studio's documents, physical target and asynchronous lifetime. */
export class HeadlessStudio {
	private readonly worker: Worker;
	private readonly ready = Promise.withResolvers<void>();
	private readonly exited = Promise.withResolvers<number>();
	private readonly operations = new Map<string, Pending<StudioToolResult>>();
	private readonly closures = new Map<string, Pending<StudioHeadlessCloseResult>>();
	private readonly closeListeners = new Set<() => void>();
	private readonly workspace: DiskWorkspaceRecordProvider;
	private readonly workspaceOperations = new Set<Promise<void>>();
	private sequence = 0;
	private closing = false;
	private stopped = false;
	private closeOperation: Promise<StudioHeadlessCloseResult> | undefined;
	private shutdownOperation: Promise<void> | undefined;
	private failure: Error | undefined;

	private constructor(options: HeadlessStudioOptions) {
		this.workspace = new DiskWorkspaceRecordProvider(options.workspaceRoot);
		this.worker = new Worker(new URL('./headless_worker.mjs', import.meta.url), { workerData: options });
		this.worker.on('message', (reply: HeadlessStudioReply) => {
			switch (reply.type) {
				case 'workspace-request': {
					const operation = this.accessWorkspace(reply);
					this.workspaceOperations.add(operation);
					void operation.finally(() => this.workspaceOperations.delete(operation));
					break;
				}
				case 'ready': this.ready.resolve(); break;
				case 'failed': this.fail(reply.error); break;
				case 'result': {
					const pending = this.operations.get(reply.request);
					if (pending === undefined) return; // A cancelled operation can finish after its caller has retired.
					this.operations.delete(reply.request);
					pending.resolve(reply.result);
					break;
				}
				case 'closed': {
					const pending = this.closures.get(reply.request)!;
					this.closures.delete(reply.request);
					pending.resolve(reply.result);
					break;
				}
			}
		});
		this.worker.on('error', (error: Error) => this.fail(error));
		this.worker.on('messageerror', error => {
			this.fail(new Error('Headless Studio reply could not be deserialized.', { cause: error }));
			void this.worker.terminate();
		});
		this.worker.once('exit', async code => {
			this.stopped = true;
			if (!this.closing || this.operations.size !== 0 || this.closures.size !== 0) this.fail(new Error(`Headless Studio exited (${code}). An unanswered operation may have executed; do not replay it.`));
			await Promise.all(this.workspaceOperations);
			this.exited.resolve(code);
			for (const listener of this.closeListeners) listener();
			this.closeListeners.clear();
		});
	}

	private async accessWorkspace(message: StudioWorkspaceRequest): Promise<void> {
		let reply: StudioWorkspaceReply;
		try {
			const operation = message.operation;
			let value: StudioWorkspaceValue;
			switch (operation.method) {
				case 'read': value = await this.workspace.read(operation.path); break;
				case 'readDirectory': value = await this.workspace.readDirectory(operation.path); break;
				case 'createDirectory': await this.workspace.createDirectory(operation.path); break;
				case 'write': await this.workspace.write(operation.path, operation.record, operation.overwrite, operation.expectedSource); break;
				case 'delete': await this.workspace.delete(operation.path); break;
			}
			reply = { type: 'workspace-result', request: message.request, success: true, value };
		} catch (error) {
			reply = { type: 'workspace-result', request: message.request, success: false, error: error as Error };
		}
		if (!this.stopped) this.worker.postMessage(reply);
	}
	public get closed(): boolean { return this.stopped; }
	public onDidClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	public static async open(options: HeadlessStudioOptions): Promise<HeadlessStudio> {
		const studio = new HeadlessStudio(options);
		try { await studio.ready.promise; }
		catch (error) { await studio.exited.promise; throw error; }
		return studio;
	}

	public execute(operation: StudioToolOperation, signal: AbortSignal): Promise<StudioToolResult> {
		signal.throwIfAborted();
		this.assertOpen();
		const request = String(++this.sequence);
		const completion = Promise.withResolvers<StudioToolResult>();
		const cancel = () => {
			this.operations.delete(request);
			this.worker.postMessage({ type: 'cancel', request });
			completion.reject(signal.reason);
		};
		this.operations.set(request, completion);
		signal.addEventListener('abort', cancel, { once: true });
		this.worker.postMessage({ type: 'execute', request, operation });
		return completion.promise.finally(() => signal.removeEventListener('abort', cancel));
	}

	public release(context: string): void {
		if (!this.closing && this.failure === undefined) this.worker.postMessage({ type: 'release', context });
	}

	public close(options: { discardUnsaved: boolean }): Promise<StudioHeadlessCloseResult> {
		if (this.closeOperation !== undefined) return this.closeOperation;
		this.assertOpen();
		this.closing = true;
		const request = String(++this.sequence), completion = Promise.withResolvers<StudioHeadlessCloseResult>();
		this.closures.set(request, completion);
		this.worker.postMessage({ type: 'close', request, discardUnsaved: options.discardUnsaved });
		this.closeOperation = (async () => {
			let result: StudioHeadlessCloseResult;
			try { result = await completion.promise; }
			catch (error) { await this.exited.promise; throw error; }
			if (result.status === 'closed') await this.exited.promise;
			else { this.closing = false; this.closeOperation = undefined; }
			return result;
		})();
		return this.closeOperation;
	}

	public shutdown(): Promise<void> {
		if (this.shutdownOperation !== undefined) return this.shutdownOperation;
		this.closing = true;
		this.shutdownOperation = (async () => {
			try {
				if (this.closeOperation !== undefined) await this.closeOperation;
				if (this.failure !== undefined || this.stopped) return;
				this.closing = true;
				const request = String(++this.sequence), completion = Promise.withResolvers<StudioHeadlessCloseResult>();
				this.closures.set(request, completion);
				this.worker.postMessage({ type: 'shutdown', request });
				await completion.promise;
			} finally { await this.exited.promise; }
		})();
		return this.shutdownOperation;
	}

	private assertOpen(): void {
		if (this.failure !== undefined) throw this.failure;
		if (this.closing) throw new Error('Headless Studio is closing.');
	}

	private fail(error: Error): void {
		if (this.failure !== undefined) return;
		this.failure = error;
		this.ready.reject(error);
		for (const request of this.operations.values()) request.reject(error);
		for (const request of this.closures.values()) request.reject(error);
		this.operations.clear(); this.closures.clear();
	}
}
