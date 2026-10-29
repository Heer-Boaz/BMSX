import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../machine/ts/common/rect';
import { clamp } from '../../../machine/ts/common/clamp';

/** Reserved geometry for the shared sash's complete pointer target. */
export const WORKBENCH_SPLIT_SIZE = 8;

/** The shared sash consumes geometry and resize actions, not its owner's sizing representation. */
export interface WorkbenchSashView {
	readonly bounds: Readonly<RectBounds>;
	readonly orientation: 'horizontal' | 'vertical';
	readonly resizable: boolean;
	readonly position: number;
	canMoveTo(position: number): boolean;
	moveTo(position: number): void;
	reset(): void;
}

/** Retained two-pane geometry; resizing never rebuilds a domain's data projection. */
export class WorkbenchSplitView implements WorkbenchSashView {
	public readonly bounds = create_rect_bounds();
	private ratioValue: number;
	private readonly ratioListeners = new Set<() => void>();
	private resizeListeners: Set<() => void> | undefined;
	public minimumFirstSize = 0;
	public minimumSecondSize = 0;
	public revision = 0;
	public constructor(public readonly defaultRatio: number, public readonly orientation: 'horizontal' | 'vertical' = 'horizontal') { this.ratioValue = defaultRatio; }
	public get ratio(): number { return this.ratioValue; }
	public onDidChangeRatio(listener: () => void): () => void {
		this.ratioListeners.add(listener);
		return () => { this.ratioListeners.delete(listener); };
	}
	/** Native sizing is distinct from the arrangement's coordinated topology/intent publication. */
	public onDidResize(listener: () => void): () => void {
		const listeners = this.resizeListeners ??= new Set();
		listeners.add(listener);
		return () => { listeners.delete(listener); };
	}
	/** Requested view intent is retained independently of current placement constraints. */
	public set ratio(value: number) {
		if (this.ratioValue === value) return;
		this.ratioValue = value; this.revision++;
		for (const listener of this.ratioListeners) listener();
	}
	public get start(): number { return this.orientation === 'horizontal' ? this.bounds.left : this.bounds.top; }
	public get end(): number { return this.orientation === 'horizontal' ? this.bounds.right : this.bounds.bottom; }
	public get resizable(): boolean { return this.end - this.start > this.minimumFirstSize + this.minimumSecondSize; }
	public get position(): number {
		return this.positionFor(this.start, this.end, this.minimumFirstSize, this.minimumSecondSize);
	}
	/** Project the retained preference into another admitted interval without changing this split. */
	public positionFor(start: number, end: number, minimumFirstSize: number, minimumSecondSize: number): number {
		return clamp(Math.round(start + (end - start) * this.ratio), start + minimumFirstSize, end - minimumSecondSize);
	}
	public layout(left: number, top: number, right: number, bottom: number): void { write_rect_bounds(this.bounds, left, top, right, bottom); }
	public resize(ratio: number): void {
		if (!this.resizable) return;
		const size = this.end - this.start;
		const min = this.minimumFirstSize / size;
		const max = (size - this.minimumSecondSize) / size;
		const requested = clamp(ratio, min, max);
		if (requested === this.ratio) return;
		this.ratio = requested;
		if (this.resizeListeners !== undefined) for (const listener of this.resizeListeners) listener();
	}
	public canMoveTo(position: number): boolean {
		return this.resizable && clamp(Math.round(position), this.start + this.minimumFirstSize, this.end - this.minimumSecondSize) !== this.position;
	}
	public moveTo(position: number): void { this.resize((Math.round(position) - this.start) / (this.end - this.start)); }
	public reset(): void { this.resize(this.defaultRatio); }
}

/** A side region retains its requested content width while its adjacent client absorbs free space. */
export class WorkbenchFixedEdgeSplitView implements WorkbenchSashView {
	public readonly bounds = create_rect_bounds();
	public minimumFirstSize = 0;
	public minimumSecondSize = 0;
	public preferredSize = 0;
	/** The containing arrangement may publish several requested sizes together. */
	public requestedSize: number | undefined;
	private readonly resizeListeners = new Set<() => void>();
	public constructor(public readonly edge: 'start' | 'end', public readonly orientation: 'horizontal' | 'vertical' = 'horizontal') {}
	/** A native resize/reset is distinct from the arrangement's coordinated state publication. */
	public onDidResize(listener: () => void): () => void {
		this.resizeListeners.add(listener);
		return () => { this.resizeListeners.delete(listener); };
	}
	public get start(): number { return this.orientation === 'horizontal' ? this.bounds.left : this.bounds.top; }
	public get end(): number { return this.orientation === 'horizontal' ? this.bounds.right : this.bounds.bottom; }
	public get resizable(): boolean { return this.end - this.start > this.minimumFirstSize + this.minimumSecondSize; }
	public get position(): number {
		const size = (this.requestedSize ?? this.preferredSize) + WORKBENCH_SPLIT_SIZE / 2;
		const requested = this.edge === 'start' ? this.start + size : this.end - size;
		return clamp(Math.round(requested), this.start + this.minimumFirstSize, this.end - this.minimumSecondSize);
	}
	public layout(left: number, top: number, right: number, bottom: number): void { write_rect_bounds(this.bounds, left, top, right, bottom); }
	public canMoveTo(position: number): boolean {
		return this.resizable && clamp(Math.round(position), this.start + this.minimumFirstSize, this.end - this.minimumSecondSize) !== this.position;
	}
	public moveTo(position: number): void {
		if (!this.resizable) return;
		position = clamp(Math.round(position), this.start + this.minimumFirstSize, this.end - this.minimumSecondSize);
		if (position === this.position) return;
		const size = (this.edge === 'start' ? position - this.start : this.end - position) - WORKBENCH_SPLIT_SIZE / 2;
		if (size === this.requestedSize) return;
		this.requestedSize = size;
		for (const listener of this.resizeListeners) listener();
	}
	public reset(): void {
		if (this.requestedSize === undefined) return;
		this.requestedSize = undefined;
		for (const listener of this.resizeListeners) listener();
	}
}
