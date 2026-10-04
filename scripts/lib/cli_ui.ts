import pc from 'picocolors';
import stringWidth from 'string-width';

import { TaskProgressReporter } from './task_progress';
import { CliTerminal, truncateTerminalText } from './cli_terminal';

export type LogEntryType = undefined | 'error' | 'warning';

export interface CliUi {
	writeOut(text: string, type?: LogEntryType): void;
	printBanner(): void;
	createProgress(verbose?: boolean): TaskProgressReporter;
	info(message: string): void;
	warn(message: string): void;
	ok(message: string): void;
	bullet(label: string, value: string): void;
	divider(title: string): void;
}

export function createCliUi(options: { bannerTitle: string; labelWidth?: number; }): CliUi {
	const glyph = {
		info: pc.blue('ℹ'),
		warn: pc.yellow('⚠'),
		ok: pc.green('✔'),
		arrow: pc.cyan('›'),
		title: pc.magenta('◆'),
	};
	const labelWidth = options.labelWidth ?? 14;
	const terminal = new CliTerminal();

	const writeOut = (text: string, type?: LogEntryType): void => {
		if (type === 'error') {
			terminal.write(pc.red(text), 'stderr');
			return;
		}
		if (type === 'warning') {
			terminal.write(pc.yellow(text), 'stderr');
			return;
		}
		terminal.write(text);
	};

	const printBanner = (): void => {
		const innerWidth = Math.max(0, Math.min(78, terminal.lineWidth - 2));
		const top = `╔${'═'.repeat(innerWidth)}╗`;
		const text = truncateTerminalText(`${options.bannerTitle} by Boaz©®℗™`, innerWidth);
		const textWidth = stringWidth(text);
		const left = (innerWidth - textWidth) >> 1;
		const right = innerWidth - textWidth - left;
		const middle = `║${' '.repeat(left)}${pc.white(text)}${' '.repeat(right)}║`;
		const bottom = `╚${'═'.repeat(innerWidth)}╝`;
		writeOut(pc.bold(pc.green(`${top}\n${middle}\n${bottom}\n`)));
	};

	const createProgress = (verbose = false): TaskProgressReporter => new TaskProgressReporter(terminal, verbose);
	const info = (message: string): void => writeOut(`${glyph.info} ${message}\n`);
	const warn = (message: string): void => writeOut(`${glyph.warn} ${message}\n`, 'warning');
	const ok = (message: string): void => writeOut(`${glyph.ok} ${message}\n`);
	const bullet = (label: string, value: string): void => {
		const padded = label.padEnd(labelWidth, ' ');
		writeOut(`${glyph.arrow} ${pc.bold(padded)} ${pc.dim('·')} ${value}\n`);
	};
	const divider = (title: string): void => writeOut(`\n${glyph.title} ${pc.bold(title)}\n`);

	return {
		writeOut,
		printBanner,
		createProgress,
		info,
		warn,
		ok,
		bullet,
		divider,
	};
}
