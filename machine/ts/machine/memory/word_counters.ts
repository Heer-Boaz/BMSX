/** Raw memory-bus words, counted in the region selected by Memory's decoder. */
export type MemoryWordCounters = {
	ramWords: number;
	systemRomWords: number;
	cartridgeWords: number;
	otherWords: number;
};
