import type { ElkNode } from 'elkjs/lib/elk-api';
import type { IDisposable } from '../common/lifecycle';
import type { GraphLayoutEngine } from '../workbench/services/graph_layout/engine';
import { GraphLayoutRequests } from '../workbench/services/graph_layout/worker_requests';
import type { GraphLayoutReply } from '../workbench/services/graph_layout/worker_protocol';

/** Owns the supplied native Worker, including its pending replies on failure/close. */
export class BrowserGraphLayoutEngine implements GraphLayoutEngine, IDisposable {
	private readonly requests: GraphLayoutRequests;

	public constructor(private readonly worker: Worker) {
		this.requests = new GraphLayoutRequests(request => worker.postMessage(request), error => this.terminate(error));
		worker.onmessage = (event: MessageEvent<GraphLayoutReply>) => this.requests.accept(event.data);
		worker.onerror = event => {
			event.preventDefault();
			this.terminate(new Error('Graph layout worker failed to load or execute', { cause: event.error }));
		};
		worker.onmessageerror = () => this.terminate(new Error('Graph layout worker reply could not be deserialized'));
	}

	public layout(graph: ElkNode): Promise<ElkNode> { return this.requests.layout(graph); }
	public dispose(): void { this.terminate(new Error('Graph layout worker disposed')); }

	private terminate(error: Error): void {
		this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
		this.worker.terminate();
		this.requests.fail(error);
	}
}
