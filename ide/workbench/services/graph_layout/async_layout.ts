import type { IDisposable } from '../../../common/lifecycle';
import type { WorkbenchGraphModel } from '../../ui/graph/model';
import type { GraphLayoutEngine } from './engine';

export type AsyncGraphLayoutState<Model> =
	| { readonly kind: 'idle' | 'pending' | 'disposed' }
	| { readonly kind: 'ready'; readonly model: Model }
	| { readonly kind: 'failed'; readonly error: unknown };

type LayoutFactory<Model> = (engine: GraphLayoutEngine) => Promise<Model>;
const IDLE = { kind: 'idle' } as const;
const PENDING = { kind: 'pending' } as const;
const DISPOSED = { kind: 'disposed' } as const;
const SETTLED = Promise.resolve();

/**
 * Input-owned layout lifetime: one running generation and the latest pending factory.
 * Factories create fresh unpublished geometry only when actually admitted. Results
 * never activate a pane; a view consumes this state through its ordinary update path.
 */
export class AsyncGraphLayout<Model extends WorkbenchGraphModel> implements IDisposable {
	private engine: (GraphLayoutEngine & IDisposable) | undefined;
	private pending: LayoutFactory<Model> | undefined;
	private generation = 0;
	private running = false;
	private completion = SETTLED;
	private stateValue: AsyncGraphLayoutState<Model> = IDLE;

	public constructor(private readonly createEngine: () => GraphLayoutEngine & IDisposable) {}

	public get state(): AsyncGraphLayoutState<Model> { return this.stateValue; }
	public get settled(): Promise<void> { return this.completion; }

	public request(factory: LayoutFactory<Model>): void {
		if (this.stateValue.kind === 'disposed') throw new Error('Cannot request a disposed graph layout');
		this.generation += 1;
		this.pending = factory;
		this.stateValue = PENDING;
		if (!this.running) {
			this.running = true;
			this.completion = this.drain();
		}
	}

	/** Source changed while hidden, or the selected definition no longer exists. */
	public invalidate(): void {
		if (this.stateValue.kind === 'disposed') throw new Error('Cannot invalidate a disposed graph layout');
		this.generation += 1;
		this.pending = undefined;
		this.stateValue = IDLE;
	}

	public dispose(): void {
		this.generation += 1;
		this.pending = undefined;
		this.stateValue = DISPOSED;
		this.engine?.dispose();
		this.engine = undefined;
	}

	private async drain(): Promise<void> {
		while (this.pending !== undefined) {
			const factory = this.pending;
			const generation = this.generation;
			this.pending = undefined;
			try {
				if (this.engine === undefined) this.engine = this.createEngine();
				const model = await factory(this.engine);
				if (generation === this.generation) this.stateValue = { kind: 'ready', model };
			} catch (error) {
				if (generation === this.generation) this.stateValue = { kind: 'failed', error };
			}
		}
		this.running = false;
	}
}
