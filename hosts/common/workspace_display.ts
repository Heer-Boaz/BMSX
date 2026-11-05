/** Host work-area allocation in CSS units, independent of the video target.
 * The active workbench chooses logical dimensions and pixels per unit; the host
 * only publishes available space and fits the resulting image at that scale. */
export class WorkspaceDisplay {
	private resize: ((width: number, height: number) => void) | undefined;
	public pixelsPerUnit = 1;

	public constructor(private availableWidth: number, private availableHeight: number,
		private readonly invalidateLayout: () => void) {}
	public get active(): boolean { return this.resize !== undefined; }

	public open(resize: (width: number, height: number) => void): void {
		this.resize = resize;
		this.refresh();
	}
	public close(): void {
		this.resize = undefined;
		this.invalidateLayout();
	}
	/** A workbench preference change reallocates within the current host work area. */
	public refresh(): void {
		this.resize?.(this.availableWidth, this.availableHeight);
		this.invalidateLayout();
	}
	public layout(width: number, height: number): void {
		if (width === this.availableWidth && height === this.availableHeight) return;
		this.availableWidth = width;
		this.availableHeight = height;
		this.resize?.(width, height);
	}
}
