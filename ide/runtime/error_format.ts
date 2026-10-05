import type { StackTraceFrame } from './stack_trace';

function ensureWorkspaceRelativePath(source: string): string {
	if (!source || source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
		return source;
	}
	if (/^[A-Za-z]:[\\/]/.test(source) || source.startsWith('\\\\')) {
		return source;
	}
	return `./${source}`;
}

export function sanitizeLuaErrorMessage(message: string): string {
	return message.replace(/^\[mod:[^\]]+]\s*/, '');
}

export function formatRuntimeErrorLocation(path: string, line: number, column: number): string {
	const label = path ? ensureWorkspaceRelativePath(path) : '';
	const suffix = `${line}:${column}`;
	return label ? `${label}:${suffix}` : suffix;
}

export function formatRuntimeStackFrame(frame: StackTraceFrame): string {
	if (frame.kind === 'instruction') {
		return frame.functionName;
	}
	const source = frame.workspacePath;
	let location = source ? ensureWorkspaceRelativePath(source) : '';
	if (frame.line) {
		location = location ? `${location}:${frame.line}` : `${frame.line}`;
		if (frame.column) {
			location += `:${frame.column}`;
		}
	}
	return location ? `${frame.functionName}(${location})` : frame.functionName;
}

export function buildErrorStackString(
	name: string,
	message: string,
	frames: ReadonlyArray<StackTraceFrame>,
): string {
	const header = `${name}: ${message}`;
	if (frames.length === 0) {
		return header;
	}
	const lines: string[] = [header];
	for (let index = 0; index < frames.length; index += 1) {
		lines.push(`  at ${formatRuntimeStackFrame(frames[index])}`);
	}
	return lines.join('\n');
}
