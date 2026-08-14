import { clearLine, cursorTo } from 'node:readline';

export class CliTerminal {
	private progressLine = '';
	private progressActive = false;
	private progressVisible = false;
	private progressSuspendDepth = 0;
	private readonly progressEnabled = process.stdout.isTTY && !process.env.CI;

	public get interactiveProgress(): boolean {
		return this.progressEnabled;
	}

	public get lineWidth(): number {
		return Math.max(1, (process.stdout.columns || 80) - 1);
	}

	public write(text: string): void {
		this.suspendProgress();
		process.stdout.write(text);
		this.resumeProgress();
	}

	public showProgress(line: string): void {
		this.progressLine = line;
		this.progressActive = true;
		if (!this.progressEnabled || this.progressSuspendDepth > 0) {
			return;
		}
		cursorTo(process.stdout, 0);
		process.stdout.write(line);
		clearLine(process.stdout, 1);
		this.progressVisible = true;
	}

	public completeProgress(line: string): void {
		this.progressLine = line;
		this.progressActive = false;
		this.progressSuspendDepth = 0;
		if (this.progressEnabled) {
			cursorTo(process.stdout, 0);
			process.stdout.write(line);
			clearLine(process.stdout, 1);
			process.stdout.write('\n');
			this.progressVisible = false;
		}
	}

	public stopProgress(): void {
		this.progressActive = false;
		this.progressSuspendDepth = 0;
		this.clearVisibleProgress();
		this.progressLine = '';
	}

	public suspendProgress(): void {
		if (!this.progressEnabled || !this.progressActive) {
			return;
		}
		if (this.progressSuspendDepth === 0) {
			this.clearVisibleProgress();
		}
		this.progressSuspendDepth += 1;
	}

	public resumeProgress(redraw = true): void {
		if (!this.progressActive || this.progressSuspendDepth === 0) {
			return;
		}
		this.progressSuspendDepth -= 1;
		if (redraw && this.progressSuspendDepth === 0) {
			this.showProgress(this.progressLine);
		}
	}

	private clearVisibleProgress(): void {
		if (!this.progressEnabled || !this.progressVisible) {
			return;
		}
		cursorTo(process.stdout, 0);
		clearLine(process.stdout, 0);
		this.progressVisible = false;
	}
}
