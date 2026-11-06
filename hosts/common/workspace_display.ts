export type WorkspaceAllocation = {
	width: number; height: number;
	pixelWidth: number; pixelHeight: number;
};

/** Host work area in CSS units and device pixels. UI scale belongs to the
 * workbench; changing it never changes the physical allocation. */
export class WorkspaceDisplay {
	private resize: ((allocation: Readonly<WorkspaceAllocation>) => void) | undefined;
	private readonly allocation: WorkspaceAllocation;

	public constructor(width: number, height: number, private pixelRatio: number,
		private readonly invalidateLayout: () => void) {
		this.allocation = { width, height, pixelWidth: Math.round(width * pixelRatio), pixelHeight: Math.round(height * pixelRatio) };
	}
	public get active(): boolean { return this.resize !== undefined; }
	public get devicePixelRatio(): number { return this.pixelRatio; }

	public open(resize: (allocation: Readonly<WorkspaceAllocation>) => void): void {
		this.resize = resize;
		this.refresh();
		this.invalidateLayout();
	}
	public close(): void {
		this.resize = undefined;
		this.invalidateLayout();
	}
	/** Recompute logical layout within the same host allocation. */
	public refresh(): void {
		this.resize?.(this.allocation);
	}
	public layout(width: number, height: number, pixelRatio: number): void {
		const allocation = this.allocation;
		if (width === allocation.width && height === allocation.height && pixelRatio === this.pixelRatio) return;
		allocation.width = width; allocation.height = height;
		allocation.pixelWidth = Math.round(width * pixelRatio); allocation.pixelHeight = Math.round(height * pixelRatio);
		this.pixelRatio = pixelRatio;
		this.resize?.(allocation);
	}
}
