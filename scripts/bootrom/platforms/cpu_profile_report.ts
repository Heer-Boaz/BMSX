export type CpuProfileReporter = {
	formatCpuProfilerReport(): string;
};

export function formatHeadlessCpuProfile(reporter: CpuProfileReporter): string {
	return reporter.formatCpuProfilerReport();
}

export function printHeadlessCpuProfile(reporter: CpuProfileReporter, target: 'cli' | 'headless'): void {
	console.log(`[bootrom:${target}] Fantasy CPU profiler report:`);
	console.log(formatHeadlessCpuProfile(reporter));
}
