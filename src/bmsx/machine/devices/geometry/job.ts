export type GeometryJobState = {
	cmd: number;
	src0: number;
	src1: number;
	src2: number;
	dst0: number;
	dst1: number;
	count: number;
	param0: number;
	param1: number;
	stride0: number;
	stride1: number;
	stride2: number;
	processed: number;
	resultCount: number;
	exactPairCount: number;
	broadphasePairCount: number;
};
