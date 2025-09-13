import type { BuildDiagnostics } from "./pipeline";

export function dumpEcsPipeline(diag: BuildDiagnostics): void {
	console.log('ECS Pipeline (final order):');
	console.log('  ', diag.finalOrder.join(' -> '));
	console.log('ECS Pipeline by TickGroup:');
	for (const k of Object.keys(diag.groupOrders).map(x => +x).sort((a, b) => a - b)) {
		console.log(`  [${k}]`, diag.groupOrders[k]?.join(' -> ') ?? '');
	}
	console.log('Constraints:');
	for (const c of diag.constraints) {
		const before = c.before.length ? ` before=[${c.before.join(', ')}]` : '';
		const after = c.after.length ? ` after=[${c.after.join(', ')}]` : '';
		console.log(`  ${c.ref}:${before}${after}`);
	}
	if (diag.cyclesDetected) {
		console.warn('[ECS] Cycle(s) detected; fell back to priority order. Affected groups:');
		for (const g of diag.cycleGroups ?? []) console.warn(`  group=${g.group}: [${g.refs.join(', ')}]`);
	}
}

