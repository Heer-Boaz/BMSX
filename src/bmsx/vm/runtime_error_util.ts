import { LuaCallFrame } from '../lua/luaruntime';
import { StackTraceFrame } from '../lua/luavalue';
import { normalizeEndingsAndSplitLines } from './ide/text_utils';
import { RuntimeErrorDetails } from './ide/types';

export function buildLuaFrameRawLabel(functionName: string, source: string): string {
	if (functionName) {
		if (source) {
			return `${functionName} @ ${source}`;
		}
		return functionName;
	}
	if (source) {
		return source;
	}
	return '';
}

export function convertLuaCallFrames(callFrames: ReadonlyArray<LuaCallFrame>): StackTraceFrame[] {
	const frames: StackTraceFrame[] = [];
	for (let index = callFrames.length - 1; index >= 0; index -= 1) {
		const frame = callFrames[index];
		const source = frame.source ? frame.source : null;
		const effectiveLine = frame.line > 0 ? frame.line : null;
		const effectiveColumn = frame.column > 0 ? frame.column : null;
		let rawLabel = '';
		if (frame.functionName) {
			rawLabel = frame.functionName;
		}
		if (source) {
			rawLabel = rawLabel.length > 0 ? `${rawLabel} @ ${source}` : source;
		}
		const runtimeFrame: StackTraceFrame = {
			origin: 'lua',
			functionName: frame.functionName ? frame.functionName : null,
			source,
			line: effectiveLine,
			column: effectiveColumn,
			raw: rawLabel ?? '[unknown]', // We explicitly don't check for rawLabel.length here because we want to support empty labels (e.g. 'lua]' is implicit and thus empty)
		};
		frames.push(runtimeFrame);
	}
	return frames;
}

export function sanitizeLuaErrorMessage(message: string): string {
	return message.replace(/^\[mod:[^\]]+]\s*/, '');
}

export function parseJsStackFrames(stack: string): StackTraceFrame[] {
	if (!stack || stack.length === 0) {
		return [];
	}
	const lines = normalizeEndingsAndSplitLines(stack);
	const frames: StackTraceFrame[] = [];
	for (let index = 1; index < lines.length; index += 1) {
		const trimmed = lines[index].trim();
		if (trimmed.length === 0) {
			continue;
		}
		if (!trimmed.startsWith('at ')) {
			continue;
		}
		const parsed = parseJsStackLine(trimmed);
		if (parsed) {
			frames.push(parsed);
		}
	}
	return frames;
}

export function parseJsStackLine(line: string): StackTraceFrame {
	let content = line;
	if (content.startsWith('at ')) {
		content = content.slice(3).trim();
	}
	let functionName: string = null;
	let location = content;
	const openIndex = content.indexOf('(');
	const closeIndex = content.lastIndexOf(')');
	if (openIndex >= 0 && closeIndex > openIndex) {
		const prefix = content.slice(0, openIndex).trim();
		functionName = prefix.length > 0 ? prefix : null;
		location = content.slice(openIndex + 1, closeIndex).trim();
	}
	let source: string = null;
	let lineNumber: number = null;
	let columnNumber: number = null;
	const locationText = location;
	if (locationText.length > 0) {
		const lastColon = locationText.lastIndexOf(':');
		if (lastColon > 0) {
			const columnText = locationText.slice(lastColon + 1);
			const columnValue = Number.parseInt(columnText, 10);
			if (Number.isFinite(columnValue) && columnValue > 0) {
				columnNumber = columnValue;
				const withoutColumn = locationText.slice(0, lastColon);
				const lineColon = withoutColumn.lastIndexOf(':');
				if (lineColon > 0) {
					const lineText = withoutColumn.slice(lineColon + 1);
					const lineValue = Number.parseInt(lineText, 10);
					if (Number.isFinite(lineValue) && lineValue > 0) {
						lineNumber = lineValue;
						source = withoutColumn.slice(0, lineColon);
					} else {
						source = withoutColumn;
					}
				} else {
					source = withoutColumn;
				}
			} else {
				source = locationText;
			}
		} else {
			source = locationText;
		}
	}
	if (source) {
		source = source.trim();
		if (source.length === 0) {
			source = null;
		}
	}
	return {
		origin: 'js',
		functionName,
		source,
		line: lineNumber,
		column: columnNumber,
		raw: line,
	};
}


export function formatRuntimeErrorLocation(chunkName: string, line: number, column: number): string {
	let label = chunkName && chunkName.length > 0 ? chunkName : '';
	if (line !== null && line !== undefined) {
		const suffix = column !== null && column !== undefined ? `${line}:${column}` : `${line}`;
		label = label.length > 0 ? `${label}:${suffix}` : `${suffix}`;
	}
	return label.length > 0 ? label : null;
}

export function formatRuntimeStackFrameForVM(frame: StackTraceFrame): string {
	const origin = frame.origin === 'lua' ? 'Lua' : 'JS';
	let name = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '';
	if (name.length === 0 && frame.raw && frame.raw.length > 0) {
		name = frame.raw;
	}
	if (name.length === 0 && frame.source && frame.source.length > 0) {
		name = frame.source;
	}
	if (name.length === 0) {
		name = '(anonymous)';
	}
	let location = '';
	if (frame.source && frame.source.length > 0) {
		location = frame.source;
	}
	if (frame.line !== null) {
		location = location.length > 0 ? `${location}:${frame.line}` : `${frame.line}`;
		if (frame.column !== null) {
			location += `:${frame.column}`;
		}
	}
	return location.length > 0 ? `[${origin}] ${name} (${location})` : `[${origin}] ${name}`;
}

export function buildStackLines(details: RuntimeErrorDetails, includeJsStackTraces: boolean = false): string[] {
	if (!details) {
		return [];
	}
	const frames: StackTraceFrame[] = [];
	for (let index = 0; index < details.luaStack.length; index += 1) {
		frames.push(details.luaStack[index]);
	}
	if (includeJsStackTraces) {
		for (let index = 0; index < details.jsStack.length; index += 1) {
			frames.push(details.jsStack[index]);
		}
	}
	if (frames.length === 0) {
		return [];
	}
	const lines: string[] = ['Stack trace:'];
	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		lines.push(`  ${formatRuntimeStackFrameForVM(frame)}`);
	}
	return lines;
}

export function prettyPrintRuntimeError(chunkName: string, line: number, column: number, message: string): string {
	const location = formatRuntimeErrorLocation(chunkName, line, column);
	const sanitized = sanitizeLuaErrorMessage(message);
	return location ? `Runtime error at ${location}: ${sanitized}` : `Runtime error: ${sanitized}`;
}

export function buildErrorStackString(name: string, message: string, details: RuntimeErrorDetails, includeJsStackTraces: boolean): string {
	const sanitizedMessage = sanitizeLuaErrorMessage(message);
	const header = `${name}: ${sanitizedMessage}`;
	if (!details) {
		return header;
	}
	const frames: StackTraceFrame[] = [];
	for (let index = 0; index < details.luaStack.length; index += 1) {
		frames.push(details.luaStack[index]);
	}
	if (includeJsStackTraces) {
		for (let index = 0; index < details.jsStack.length; index += 1) {
			frames.push(details.jsStack[index]);
		}
	}
	if (frames.length === 0) {
		return header;
	}
	const lines: string[] = [header];
	for (let index = 0; index < frames.length; index += 1) {
		const frame = frames[index];
		const fn = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '<anonymous>';
		let location = '';
		if (frame.source && frame.source.length > 0) {
			location = frame.source;
			if (frame.line !== null && frame.line !== undefined) {
				location += `:${frame.line}`;
				if (frame.column !== null && frame.column !== undefined) {
					location += `:${frame.column}`;
				}
			}
		}
		lines.push(location.length > 0 ? `  at ${fn} (${location})` : `  at ${fn}`);
	}
	return lines.join('\n');
}
