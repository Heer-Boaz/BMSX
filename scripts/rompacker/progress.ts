import pc from 'picocolors';
import stringWidth from 'string-width';

import { renderProgressBar } from '../rominspector/asciiart';
import type { CliTerminal } from './terminal';

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

function truncateTerminalText(text: string, maxWidth: number): string {
	if (maxWidth <= 0) {
		return '';
	}
	if (stringWidth(text) <= maxWidth) {
		return text;
	}
	if (maxWidth === 1) {
		return '…';
	}
	let truncated = '';
	let width = 0;
	for (const char of text) {
		const charWidth = stringWidth(char);
		if (width + charWidth > maxWidth - 1) {
			break;
		}
		truncated += char;
		width += charWidth;
	}
	return `${truncated}…`;
}

export type TaskProgressLineState = {
	completed: number;
	total: number;
	label: string;
	detail: string;
	lineWidth: number;
	failed: boolean;
};

function renderStatusText(label: string, detail: string, maxWidth: number, failed: boolean): string {
	if (maxWidth <= 0) {
		return '';
	}
	const detailText = detail && detail !== label ? ` · ${detail}` : '';
	const text = `${label}${detailText}`;
	if (stringWidth(text) > maxWidth) {
		const truncated = truncateTerminalText(text, maxWidth);
		return failed ? pc.red(truncated) : pc.cyan(truncated);
	}
	if (failed) {
		return pc.red(text);
	}
	return `${pc.cyan(label)}${detailText ? pc.dim(detailText) : ''}`;
}

export function renderTaskProgressLine(state: TaskProgressLineState): string {
	const completed = Math.min(state.completed, state.total);
	const pct = Math.round((completed / state.total) * 100);
	const countText = `${completed}/${state.total}`;
	const pctText = `${pct}%`;
	const suffixWidth = 1 + stringWidth(countText) + 1 + stringWidth(pctText);
	const availableWidth = Math.max(1, state.lineWidth - 2 - suffixWidth);
	const detailText = state.detail && state.detail !== state.label ? ` · ${state.detail}` : '';
	const fullStatusWidth = stringWidth(`${state.label}${detailText}`);
	const minBarSize = 10;
	const maxBarSize = 80;
	let barSize = Math.min(maxBarSize, availableWidth);
	let statusWidth = 0;
	if (fullStatusWidth > 0 && availableWidth > minBarSize + 1) {
		const targetStatusWidth = Math.min(fullStatusWidth, Math.max(1, Math.round(state.lineWidth * 0.35)));
		const barCandidate = availableWidth - targetStatusWidth - 1;
		if (barCandidate >= minBarSize) {
			barSize = Math.min(maxBarSize, barCandidate);
			statusWidth = availableWidth - barSize - 1;
		} else {
			barSize = minBarSize;
			statusWidth = availableWidth - barSize - 1;
		}
	}
	const bar = renderProgressBar(completed, state.total, barSize, {
		complete: pc.green('█'),
		incomplete: pc.dim('░'),
	});
	const status = renderStatusText(state.label, state.detail, statusWidth, state.failed);
	const statusSegment = status ? ` ${status}` : '';
	return `${pc.dim('[')}${bar}${pc.dim(']')} ${pc.dim(countText)} ${pc.cyan(pctText)}${statusSegment}`;
}

export class TaskProgressReporter {
	private tasks: string[];
	private totalTasks: number;
	private completedTasks = 0;
	private started = false;
	private failed = false;
	private detail = '';
	private lastDrawAt = 0;
	private readonly updateIntervalMs = 50;
	private readonly terminal: CliTerminal;

	constructor(tasks: string[], terminal: CliTerminal) {
		this.tasks = [...tasks];
		this.totalTasks = this.tasks.length;
		this.terminal = terminal;
	}

	private currentTask(): string {
		return this.tasks[0] as string;
	}

	public getCurrentTask(): string {
		return this.currentTask();
	}

	private recalcTotals(): void {
		this.totalTasks = this.completedTasks + this.tasks.length;
	}

	private renderLine(label: string): string {
		return renderTaskProgressLine({
			completed: this.completedTasks,
			total: this.totalTasks,
			label,
			detail: this.detail,
			lineWidth: this.terminal.lineWidth,
			failed: this.failed,
		});
	}

	private draw(label: string, force = false): void {
		if (!this.terminal.interactiveProgress || !this.started) return;
		const now = Date.now();
		if (!force && now - this.lastDrawAt < this.updateIntervalMs) {
			return;
		}
		this.terminal.showProgress(this.renderLine(label));
		this.lastDrawAt = now;
	}

	public showInitial(): void {
		if (this.started) return;
		this.started = true;
		this.draw(this.currentTask(), true);
	}

	public async taskCompleted(): Promise<void> {
		const finishedTask = this.tasks.shift() as string;
		this.completedTasks += 1;
		this.detail = '';
		this.recalcTotals();
		this.draw(this.currentTask() || finishedTask, true);
		await this.pulse();
	}

	public skipTasks(count: number): void {
		for (let i = 0; i < count && this.tasks.length; i += 1) {
			this.tasks.shift();
			this.completedTasks += 1;
		}
		this.recalcTotals();
		this.draw(this.currentTask(), true);
	}

	public removeTask(task: string): void {
		const index = this.tasks.indexOf(task);
		if (index === -1) {
			throw new Error(`TaskProgressReporter cannot remove unknown task "${task}".`);
		}
		this.tasks.splice(index, 1);
		this.recalcTotals();
		this.draw(this.currentTask(), true);
	}

	public removeTasks(tasks: string[]): void {
		for (const task of tasks) {
			this.removeTask(task);
		}
	}

	public async showDone(): Promise<void> {
		if (this.started && !this.failed) {
			this.completedTasks = this.totalTasks;
			if (this.terminal.interactiveProgress) {
				this.terminal.completeProgress(this.renderLine('Gereed'));
			}
			this.started = false;
		}
		await this.pulse();
	}

	public async pulse(): Promise<void> {
		if (!this.terminal.interactiveProgress) return;
		await timer(100);
	}

	public setDetail(detail: string): void {
		this.detail = detail;
		this.draw(this.currentTask());
	}

	public clearDetail(): void {
		this.detail = '';
		this.draw(this.currentTask(), true);
	}

	public async runWithDetail<T>(detail: string, action: () => Promise<T>): Promise<T> {
		const shouldShowDetail = detail !== this.currentTask();
		if (shouldShowDetail) {
			this.setDetail(detail);
		}
		try {
			return await action();
		} finally {
			if (shouldShowDetail) {
				this.clearDetail();
			}
		}
	}

	public suspend(): void {
		if (!this.started) return;
		this.terminal.suspendProgress();
	}

	public resume(label?: string, redraw = true): void {
		if (!this.started) return;
		if (label) {
			this.terminal.showProgress(this.renderLine(label));
		}
		this.terminal.resumeProgress(redraw);
	}

	public async runWithOutput<T>(detail: string, action: () => Promise<T>): Promise<T> {
		const shouldShowDetail = detail !== this.currentTask();
		if (shouldShowDetail) {
			this.setDetail(detail);
		}
		this.suspend();
		try {
			return await action();
		} finally {
			this.detail = '';
			this.resume(undefined, false);
		}
	}

	public stop(): void {
		if (!this.started) return;
		this.terminal.stopProgress();
	}

	public fail(task: string, summary: string): void {
		if (!this.started) return;
		this.failed = true;
		this.detail = `✘ ${summary}`;
		if (this.terminal.interactiveProgress) {
			this.terminal.completeProgress(this.renderLine(task || 'Pipeline'));
		}
		this.started = false;
	}
}
