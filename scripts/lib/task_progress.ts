import pc from 'picocolors';
import type { BuildEvent, BuildReporter } from './build_reporter';
import type { CliTerminal } from './cli_terminal';

/** Sequential build phases; only producers with a known item count supply a denominator. */
export class TaskProgressReporter {
	private phase = '';
	private step = 0;
	private detail: Extract<BuildEvent, { type: 'detail' | 'item' }> | undefined;
	private lastDrawAt = 0;
	private redraw: ReturnType<typeof setTimeout> | undefined;
	private readonly startedAt = performance.now();

	constructor(private readonly terminal: CliTerminal, private readonly verbose = false) {}

	public readonly report: BuildReporter = event => {
		switch (event.type) {
			case 'diagnostic':
				this.terminal.write(event.level === 'warning' ? pc.yellow(`${event.message}\n`) : `${event.message}\n`,
					event.level === 'warning' ? 'stderr' : 'stdout');
				break;
			case 'phase':
				this.phase = event.message;
				this.step++;
				this.detail = undefined;
				this.draw();
				break;
			case 'detail':
			case 'item':
				this.detail = event;
				if (this.verbose) this.draw();
				else if (this.terminal.interactiveProgress) {
					const remaining = 50 - (performance.now() - this.lastDrawAt);
					if (remaining <= 0) this.draw();
					else if (this.redraw === undefined) this.redraw = setTimeout(() => this.draw(), remaining);
				}
				break;
		}
	};

	private line(): string {
		let line = `[${this.step}] ${this.phase}`;
		if (this.detail !== undefined) {
			if (this.detail.type === 'item') line += ` [${this.detail.current}/${this.detail.total}]`;
			line += ` · ${this.detail.message}`;
		}
		return line;
	}

	private draw(): void {
		clearTimeout(this.redraw);
		this.redraw = undefined;
		if (this.verbose || !this.terminal.interactiveProgress) this.terminal.write(`${this.line()}\n`);
		else this.terminal.showProgress(this.line());
		this.lastDrawAt = performance.now();
	}

	public finish(message: string): void {
		clearTimeout(this.redraw);
		this.terminal.stopProgress();
		const seconds = ((performance.now() - this.startedAt) / 1000).toFixed(1);
		this.terminal.write(`${pc.green(message)} (${seconds}s)\n`);
	}

	public fail(): void {
		clearTimeout(this.redraw);
		this.terminal.stopProgress();
		// Retain the failing phase and item in full, even when the live line was elided.
		this.terminal.write(`${pc.red(`FAILED: ${this.line()}`)}\n`, 'stderr');
	}
}
