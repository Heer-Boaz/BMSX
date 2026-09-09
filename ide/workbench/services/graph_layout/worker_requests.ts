import type { ElkNode } from 'elkjs/lib/elk-api';
import type { GraphLayoutReply, GraphLayoutRequest } from './worker_protocol';

type PendingLayout = { resolve: (graph: ElkNode) => void; reject: (error: unknown) => void };

/** ELK protocol/request ownership shared by the native browser and Node transports. */
export class GraphLayoutRequests {
	private readonly pending = new Map<number, PendingLayout>();
	private nextRequest = 1;
	private terminalError: Error | undefined;

	public constructor(private readonly send: (request: GraphLayoutRequest) => void, private readonly stop: (error: Error) => void) {
		// The native queue orders registration before all layout requests.
		send({ id: 0, cmd: 'register', algorithms: ['layered'] });
	}

	public accept(reply: GraphLayoutReply): void {
		if (reply.id === 0) {
			if ('error' in reply) this.stop(new Error('Graph layout algorithm registration failed', { cause: reply.error }));
			return;
		}
		const pending = this.pending.get(reply.id)!;
		this.pending.delete(reply.id);
		if ('error' in reply) pending.reject(reply.error);
		else pending.resolve(reply.data!);
	}

	public layout(graph: ElkNode): Promise<ElkNode> {
		if (this.terminalError !== undefined) return Promise.reject(this.terminalError);
		const request: GraphLayoutRequest = { id: this.nextRequest++, cmd: 'layout', graph };
		return new Promise((resolve, reject) => {
			this.pending.set(request.id, { resolve, reject });
			try { this.send(request); }
			catch (error) {
				this.pending.delete(request.id);
				reject(error);
			}
		});
	}

	public fail(error: Error): void {
		if (this.terminalError !== undefined) return;
		this.terminalError = error;
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}
