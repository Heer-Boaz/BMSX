export type ImageCopyPlan = {
	baseAddr: number;
	writeWidth: number;
	writeHeight: number;
	writeStride: number;
	targetStride: number;
	sourceStride: number;
	writeSize: number;
	clipped: boolean;
};
