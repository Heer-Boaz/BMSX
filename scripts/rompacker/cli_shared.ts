import pc from 'picocolors';

import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export type LogEntryType = undefined | 'error' | 'warning';

export interface CliUi {
	writeOut(text: string, type?: LogEntryType): void;
	printBanner(): void;
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
		error: pc.red('✖'),
		ok: pc.green('✔'),
		arrow: pc.cyan('›'),
		title: pc.magenta('◆'),
	};
	const labelWidth = options.labelWidth ?? 14;

	const writeOut = (text: string, type?: LogEntryType): void => {
		let toWrite = text;
		if (type === 'error') toWrite = pc.red(text);
		else if (type === 'warning') toWrite = pc.yellow(text);
		process.stdout.write(toWrite);
	};

	const clearScreen = (): void => {
		if (process.stdout.isTTY) {
			console.clear();
		}
	};

	const printBanner = (): void => {
		clearScreen();
		writeOut(pc.bold(pc.green('╔════════════════════════════════════════════════════════════════════════════════╗\n')));
		const innerWidth = 78;
		const text = `${options.bannerTitle} by Boaz©®℗™`;
		const left = Math.max(0, Math.floor((innerWidth - text.length) / 2));
		const right = Math.max(0, innerWidth - text.length - left);
		writeOut(pc.bold(pc.green(`║${' '.repeat(left)}${pc.white(text)}${' '.repeat(right)}║\n`)));
		writeOut(pc.bold(pc.green('╚════════════════════════════════════════════════════════════════════════════════╝\n')));
	};

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
		info,
		warn,
		ok,
		bullet,
		divider,
	};
}

export function ensureRelativePath(candidate: string): string {
	if (!candidate) return candidate;
	if (isAbsolute(candidate)) return candidate;
	if (candidate.startsWith('./') || candidate.startsWith('../')) return candidate;
	return `./${candidate}`;
}

export function normalizePathKey(candidate: string): string {
	return ensureRelativePath(candidate).replace(/\\/g, '/');
}

export function isDirectoryPath(candidate: string): boolean {
	try {
		return statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

export function findExistingDirectory(candidates: Array<string>): string {
	const visited = new Set<string>();
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = normalizePathKey(candidate);
		if (visited.has(normalized)) continue;
		visited.add(normalized);
		if (existsSync(normalized) && isDirectoryPath(normalized)) {
			return normalized;
		}
	}
	return undefined;
}

export function parseArgsVector(argv: string[], flagsWithValues: ReadonlySet<string>): Set<string> {
	const seen = new Set<string>();
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token.startsWith('-')) continue;
		seen.add(token);
		if (flagsWithValues.has(token)) {
			i += 1;
		}
	}
	return seen;
}

export function getParamOrEnv(
	args: string[],
	flag: string,
	envVar: string,
	fallback: string,
	knownFlags?: ReadonlySet<string>,
): string {
	const idx = args.indexOf(flag);
	if (idx !== -1) {
		const valueIdx = idx + 1;
		if (valueIdx >= args.length) {
			throw new Error(`Flag "${flag}" expects a value.`);
		}
		const candidate = args[valueIdx];
		if (knownFlags && knownFlags.has(candidate)) {
			throw new Error(`Flag "${flag}" expects a value, but received another flag "${candidate}".`);
		}
		return candidate;
	}
	const envValue = process.env[envVar];
	if (envValue && envValue.length > 0) return envValue;
	return fallback;
}
