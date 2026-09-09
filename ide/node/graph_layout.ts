import { Worker } from 'node:worker_threads';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { IDisposable } from '../common/lifecycle';
import type { GraphLayoutEngine } from '../workbench/services/graph_layout/engine';
import { GraphLayoutRequests } from '../workbench/services/graph_layout/worker_requests';
import type { GraphLayoutReply } from '../workbench/services/graph_layout/worker_protocol';

/** Node's real thread owns termination; the upstream in-process endpoint does not. */
export class NodeGraphLayoutEngine implements GraphLayoutEngine, IDisposable {
	private readonly requests: GraphLayoutRequests;

	public constructor(private readonly worker: Worker) {
		this.requests = new GraphLayoutRequests(request => worker.postMessage(request), error => this.terminate(error));
		worker.on('message', (reply: GraphLayoutReply) => this.requests.accept(reply));
		worker.on('error', error => this.terminate(new Error('Graph layout thread failed to load or execute', { cause: error })));
		worker.on('messageerror', error => this.terminate(new Error('Graph layout thread reply could not be deserialized', { cause: error })));
		worker.on('exit', code => this.requests.fail(new Error(`Graph layout thread exited (${code})`)));
	}

	public layout(graph: ElkNode): Promise<ElkNode> { return this.requests.layout(graph); }
	public dispose(): void { this.terminate(new Error('Graph layout thread disposed')); }

	private terminate(error: Error): void {
		this.worker.removeAllListeners('message');
		this.requests.fail(error);
		void this.worker.terminate();
	}
}
