/** Producer events, independent of terminal rendering and Studio's worker transport. */
export type BuildEvent =
	| { type: 'phase'; message: string }
	| { type: 'detail'; message: string }
	| { type: 'item'; message: string; current: number; total: number }
	| { type: 'diagnostic'; level: 'info' | 'warning'; message: string };

export type BuildReporter = (event: BuildEvent) => void;

/** Standalone producer utilities print diagnostics, not progress. */
export function reportBuildDiagnostics(event: BuildEvent): void {
	if (event.type === 'diagnostic') {
		const stream = event.level === 'warning' ? process.stderr : process.stdout;
		stream.write(`${event.message}\n`);
	}
}
