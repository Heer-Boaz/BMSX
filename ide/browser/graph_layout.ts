import type { ElkNode } from 'elkjs/lib/elk-api';
import type { IDisposable } from '../common/lifecycle';
import type { GraphLayoutEngine } from '../workbench/services/graph_layout/engine';
import type { GraphLayoutReply, GraphLayoutRequest } from '../workbench/services/graph_layout/worker_protocol';

type PendingLayout = { resolve: (graph: ElkNode) => void; reject: (error: unknown) => void };

/** Owns the supplied native Worker, including its pending replies on failure/close. */
export class BrowserGraphLayoutEngine implements GraphLayoutEngine, IDisposable {
	private readonly pending = new Map<number, PendingLayout>();
	private nextRequest = 1;
	private terminalError: Error | undefined;

	public constructor(private readonly worker: Worker) {
		worker.onmessage = (event: MessageEvent<GraphLayoutReply>) => {
			const reply = event.data;
			// Request zero registers Layered; the native worker queue orders it before layouts.
			if (reply.id === 0) {
				if ('error' in reply) this.terminate(new Error('Graph layout algorithm registration failed', { cause: reply.error }));
				return;
			}
			const pending = this.pending.get(reply.id)!;
			this.pending.delete(reply.id);
			if ('error' in reply) pending.reject(reply.error);
			else pending.resolve(reply.data!);
		};
		worker.onerror = event => {
			event.preventDefault();
			this.terminate(new Error('Graph layout worker failed to load or execute', { cause: event.error }));
		};
		worker.onmessageerror = () => this.terminate(new Error('Graph layout worker reply could not be deserialized'));
		const registration: GraphLayoutRequest = { id: 0, cmd: 'register', algorithms: ['layered'] };
		worker.postMessage(registration);
	}

	public layout(graph: ElkNode): Promise<ElkNode> {
		if (this.terminalError !== undefined) return Promise.reject(this.terminalError);
		const request: GraphLayoutRequest = { id: this.nextRequest++, cmd: 'layout', graph };
		return new Promise((resolve, reject) => {
			this.pending.set(request.id, { resolve, reject });
			try {
				this.worker.postMessage(request);
			} catch (error) {
				// Structured-clone/send failure is a failed request, not a pending reply.
				this.pending.delete(request.id);
				reject(error);
			}
		});
	}

	public dispose(): void {
		this.terminate(new Error('Graph layout worker disposed'));
	}

	private terminate(error: Error): void {
		if (this.terminalError !== undefined) return;
		this.terminalError = error;
		this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
		this.worker.terminate();
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}
