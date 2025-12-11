import { LuaCallFrame } from '../lua/luaruntime';
import { StackTraceFrame } from '../lua/luavalue';
import { normalizeEndingsAndSplitLines } from './ide/text_utils';
import { RuntimeErrorDetails } from './ide/types';
import { createMinimalSourceMapConsumer, InlineSourceMap, MinimalSourceMapConsumer, originalPositionFor } from './sourcemap_minimal';

type InlineSourceMapRegistry = Map<string, InlineSourceMap>;

function getInlineSourceMapRegistry(): InlineSourceMapRegistry {
	return (globalThis as unknown as { __bmsx_sourceMaps?: InlineSourceMapRegistry }).__bmsx_sourceMaps;
}

function getInlineSourceMapConsumerCache(): Map<string, MinimalSourceMapConsumer> {
	const g = globalThis as unknown as { __bmsx_sourceMapConsumers?: Map<string, MinimalSourceMapConsumer> };
	if (!g.__bmsx_sourceMapConsumers) {
		g.__bmsx_sourceMapConsumers = new Map<string, MinimalSourceMapConsumer>();
	}
	return g.__bmsx_sourceMapConsumers;
}

function mapJsFrameToOriginalSource(frame: StackTraceFrame): StackTraceFrame {
	if (frame.origin !== 'js') {
		return frame;
	}
	if (!frame.source || frame.line === null || frame.column === null) {
		return frame;
	}
	const registry = getInlineSourceMapRegistry();
	if (!registry) {
		return frame;
	}
	const rawMap = registry.get(frame.source);
	if (!rawMap) {
		return frame;
	}
	const cache = getInlineSourceMapConsumerCache();
	let consumer = cache.get(frame.source);
	if (!consumer) {
		consumer = createMinimalSourceMapConsumer(rawMap);
		cache.set(frame.source, consumer);
	}
	// Stack traces use 1-based columns; source maps expect 0-based columns.
	const mapped = originalPositionFor(consumer, { line: frame.line, column: frame.column - 1 });
	if (!mapped.source || mapped.line === null) {
		return frame;
	}
	return {
		...frame,
		source: mapped.source,
		line: mapped.line,
		column: mapped.column === null ? null : mapped.column,
	};
}

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
	return message.replace(/^\[mod:[^\]]+]\s*/, ''); // Remove mod prefix if present
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

export function collectRuntimeStackFrames(details: RuntimeErrorDetails, includeJsStackTraces: boolean = true): StackTraceFrame[] {
	if (!details) {
		return [];
	}
	const frames: StackTraceFrame[] = [];
	for (let index = 0; index < details.luaStack.length; index += 1) {
		frames.push(details.luaStack[index]);
	}
	if (includeJsStackTraces) {
		for (let index = 0; index < details.jsStack.length; index += 1) {
			frames.push(mapJsFrameToOriginalSource(details.jsStack[index]));
		}
	}
	return frames;
}

export function formatRuntimeStackFrame(frame: StackTraceFrame): string {
	const originLabel = frame.origin === 'lua' ? '' : 'JS';
	let name = frame.functionName && frame.functionName.length > 0 ? frame.functionName : '';
	if (name.length === 0) {
		if (frame.raw && frame.raw.length > 0) {
			name = frame.raw;
		} else if (frame.source && frame.source.length > 0) {
			name = frame.source;
		}
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
	const suffix = location.length > 0 ? `(${location})` : '';
	return originLabel.length > 0 ? `[${originLabel}] ${name}${suffix}` : `${name}${suffix}`;
}

export function buildErrorStackString(name: string, message: string, details: RuntimeErrorDetails, includeJsStackTraces: boolean): string {
	const sanitizedMessage = sanitizeLuaErrorMessage(message);
	const header = `${name}: ${sanitizedMessage}`;
	if (!details) {
		return header;
	}
	const frames = collectRuntimeStackFrames(details, includeJsStackTraces);
	if (frames.length === 0) {
		return header;
	}
	const lines: string[] = [header];
	for (let index = 0; index < frames.length; index += 1) {
		lines.push(`  at ${formatRuntimeStackFrame(frames[index])}`);
	}
	return lines.join('\n');
}
