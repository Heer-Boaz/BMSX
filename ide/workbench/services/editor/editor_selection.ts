import { DisposableStore } from '../../../common/lifecycle';

/** Contribution-owned location data; only the matching concrete pane restores it. */
export abstract class EditorPaneSelection extends DisposableStore {
	private readonly retirementListeners = new Set<() => void>();
	/** A captured location can retire independently of its retained editor input. */
	public onDidRetire(listener: () => void): () => void {
		this.retirementListeners.add(listener);
		return () => this.retirementListeners.delete(listener);
	}
	public override dispose(): void {
		if (this.isDisposed) return;
		super.dispose();
		for (const listener of this.retirementListeners) listener();
		this.retirementListeners.clear();
	}
	public abstract matches(other: EditorPaneSelection): boolean;
}
