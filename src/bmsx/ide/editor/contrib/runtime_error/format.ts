import { LuaCallFrame } from '../../../../lua/runtime';
import { StackTraceFrame } from '../../../../lua/value';
import { splitText } from '../../../../common/text_lines';
import { RuntimeErrorDetails } from '../../../common/models';
import { createMinimalSourceMapConsumer, InlineSourceMap, MinimalSourceMapConsumer, originalPositionFor } from '../../../../machine/program/sourcemap_minimal';

type InlineSourceMapRegistry = Map<string, InlineSourceMap>;

function getInlineSourceMapRegistry(): InlineSourceMapRegistry {
	return (globalThis as { __bmsx_sourceMaps?: InlineSourceMapRegistry }).__bmsx_sourceMaps;
}

function getInlineSourceMapConsumerCache(): Map<string, MinimalSourceMapConsumer> {
	const g = globalThis as { __bmsx_sourceMapConsumers?: Map<string, MinimalSourceMapConsumer> };
	if (!g.__bmsx_sourceMapConsumers) {
		g.__bmsx_sourceMapConsumers = new Map<string, MinimalSourceMapConsumer>();
	}
	return g.__bmsx_sourceMapConsumers;
}

function normalizeMappedSourcePathForEditor(source: string): string {
	if (!source || source.length === 0) {
		return source;
	}
	// Keep original case as provided by the sourcemap. VS Code's file opening in a
	// remote/WSL setup is case-sensitive and absolute paths are not linkable here.
	// We normalize only the *shape* of the path so it becomes workspace-relative.
	const normalized = source.replace(/\\/g, '/');
	const srcIndex = normalized.indexOf('/src/');
	if (srcIndex >= 0) {
		return `./${normalized.slice(srcIndex + 1)}`;
	}
	if (normalized.startsWith('./')) {
		return normalized.slice(2);
	}
	if (normalized.startsWith('../')) {
		return `./${normalized.replace(/^(\.\.\/)+/, '')}`;
	}
	return `./${normalized}`;
}

function ensureDotSlashPrefix(source: string): string {
	if (!source || source.length === 0) {
		return source;
	}
	if (source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
		return source;
	}
	if (/^[A-Za-z]:[\\/]/.test(source) || source.startsWith('\\\\')) {
		return source;
	}
	return `./${source}`;
}

const DIST_OUTPUT_PATHS = new Map<string, string>([
	['engine.js', 'dist/engine.js'],
	['engine.debug.js', 'dist/engine.debug.js'],
	['index.html', 'dist/index.html'],
	['headless.js', 'dist/headless.js'],
	['headless_debug.js', 'dist/headless_debug.js'],
	['cli.js', 'dist/cli.js'],
	['cli_debug.js', 'dist/cli_debug.js'],
]);

function mapDistOutputPath(source: string): string {
	const normalized = source.replace(/^\.?\//, '');
	const mapped = DIST_OUTPUT_PATHS.get(normalized);
	return mapped ? mapped : source;
}

function normalizeJsStackSourceForDisplay(source: string): string {
	if (!source || source.length === 0) {
		return source;
	}
	if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('file://')) {
		const withoutScheme = source.replace(/^[a-z]+:\/\//i, '');
		const pathStart = withoutScheme.indexOf('/');
		const pathWithQuery = pathStart >= 0 ? withoutScheme.slice(pathStart) : '';
		const pathOnly = pathWithQuery.split(/[?#]/, 1)[0];
		if (pathOnly.length === 0) {
			return source;
		}
		const normalized = pathOnly.startsWith('/') ? pathOnly.slice(1) : pathOnly;
		return ensureDotSlashPrefix(mapDistOutputPath(normalized));
	}
	return ensureDotSlashPrefix(mapDistOutputPath(source));
}

function mapJsFrameToOriginalSource(frame: StackTraceFrame): StackTraceFrame {
	if (frame.origin !== 'js') {
		return frame;
	}
	if (!frame.source || !frame.line || !frame.column) {
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
	if (!mapped.source || !mapped.line) {
		return frame;
	}
	return {
		...frame,
		source: normalizeMappedSourcePathForEditor(mapped.source),
		line: mapped.line,
		column: mapped.column || 0,
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
		const rawLabel = buildLuaFrameRawLabel(frame.functionName, frame.source);
		const runtimeFrame: StackTraceFrame = {
			origin: 'lua',
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: rawLabel,
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
	const lines = splitText(stack);
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


export function formatRuntimeErrorLocation(path: string, line: number, column: number): string {
	const label = path && path.length > 0 ? ensureDotSlashPrefix(path) : '';
	const suffix = `${line}:${column}`;
	return label.length > 0 ? `${label}:${suffix}` : suffix;
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
	const luaDisplaySource = frame.pathPath && frame.pathPath.length > 0 ? frame.pathPath : frame.source;
	const sourceLabel = frame.origin === 'js'
		? normalizeJsStackSourceForDisplay(frame.source)
		: ensureDotSlashPrefix(luaDisplaySource);
	let location = '';
	if (sourceLabel && sourceLabel.length > 0) {
		location = sourceLabel;
	}
	if (frame.line) {
		location = location.length > 0 ? `${location}:${frame.line}` : `${frame.line}`;
		if (frame.column) {
			location += `:${frame.column}`;
		}
	}
	if (frame.origin === 'js') {
		const functionName = frame.functionName;
		if (functionName && functionName.length > 0) {
			const suffix = location.length > 0 ? `(${location})` : '';
			return originLabel.length > 0 ? `[${originLabel}] ${functionName}${suffix}` : `${functionName}${suffix}`;
		}
		if (location.length > 0) {
			return originLabel.length > 0 ? `[${originLabel}] ${location}` : location;
		}
		const fallback = sourceLabel && sourceLabel.length > 0 ? sourceLabel : '(anonymous)';
		return originLabel.length > 0 ? `[${originLabel}] ${fallback}` : fallback;
	}

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
