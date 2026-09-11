/** Host logical draw coordinates; independent of guest transforms and GPU registers. */
export type HostOverlayTransform = {
	scale: number;
	offsetX: number;
	offsetY: number;
};

export const IDENTITY_HOST_OVERLAY_TRANSFORM: Readonly<HostOverlayTransform> = { scale: 1, offsetX: 0, offsetY: 0 };
