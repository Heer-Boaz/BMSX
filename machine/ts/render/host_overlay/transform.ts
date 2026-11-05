/** Host logical draw coordinates; independent of guest transforms and GPU registers. */
export type HostOverlayTransform = {
	scale: number;
	offsetX: number;
	offsetY: number;
};

export const IDENTITY_HOST_OVERLAY_TRANSFORM: Readonly<HostOverlayTransform> = { scale: 1, offsetX: 0, offsetY: 0 };

/** CPU raster boundary: compose logical drawing scopes with the frame-to-target mapping. */
export class HostOverlayRasterTransform {
	public viewportScaleX = 1;
	public viewportScaleY = 1;
	public scaleX = 1;
	public scaleY = 1;
	public offsetX = 0;
	public offsetY = 0;
	public logical: Readonly<HostOverlayTransform> = IDENTITY_HOST_OVERLAY_TRANSFORM;

	public reset(logicalWidth: number, logicalHeight: number, width: number, height: number): void {
		this.viewportScaleX = width / logicalWidth;
		this.viewportScaleY = height / logicalHeight;
		this.set(IDENTITY_HOST_OVERLAY_TRANSFORM);
	}

	public set(transform: Readonly<HostOverlayTransform>): void {
		this.logical = transform;
		this.scaleX = transform.scale * this.viewportScaleX;
		this.scaleY = transform.scale * this.viewportScaleY;
		this.offsetX = transform.offsetX * this.viewportScaleX;
		this.offsetY = transform.offsetY * this.viewportScaleY;
	}
}
