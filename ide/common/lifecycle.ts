export interface IDisposable { dispose(): void }

/** A lifetime owner, not a registry of services or a substitute for ownership. */
export class DisposableStore implements IDisposable {
	private readonly items = new Set<IDisposable>();
	private disposed = false;

	public get isDisposed(): boolean { return this.disposed; }

	public add<T extends IDisposable>(item: T): T {
		if (this.disposed) throw new Error('Cannot attach a resource to a disposed owner');
		this.items.add(item);
		return item;
	}

	public dispose(): void {
		this.disposed = true;
		for (const item of this.items) item.dispose();
		this.items.clear();
	}
}
