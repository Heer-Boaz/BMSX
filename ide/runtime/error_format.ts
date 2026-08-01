import type { LuaCallFrame } from '../language/lua/interpreter/interpreter';
import { buildLuaFrameRawLabel } from '../../toolchain/ts/lua/stack_frame_label';
import type { StackTraceFrame } from './stack_trace';
import type { ResourceDomain } from '../common/resource';
import { resolveRuntimeLuaSource, type RuntimeSourceState } from './sources';

function ensureWorkspaceRelativePath(source: string): string {
	if (!source || source.startsWith('./') || source.startsWith('../') || source.startsWith('/')) {
		return source;
	}
	if (/^[A-Za-z]:[\\/]/.test(source) || source.startsWith('\\\\')) {
		return source;
	}
	return `./${source}`;
}

export function convertLuaCallFrames(
	callFrames: ReadonlyArray<LuaCallFrame>,
	sources: RuntimeSourceState,
	domain: ResourceDomain,
): StackTraceFrame[] {
	const frames: StackTraceFrame[] = [];
	for (let index = callFrames.length - 1; index >= 0; index -= 1) {
		const frame = callFrames[index];
		const sourceRecord = resolveRuntimeLuaSource(sources, {
			domain,
			path: frame.source,
		})!.record;
		frames.push({
			resource: { domain, path: sourceRecord.source_path },
			functionName: frame.functionName,
			source: frame.source,
			line: frame.line,
			column: frame.column,
			raw: buildLuaFrameRawLabel(frame.functionName, frame.source),
		});
	}
	return frames;
}

export { buildLuaFrameRawLabel };

export function sanitizeLuaErrorMessage(message: string): string {
	return message.replace(/^\[mod:[^\]]+]\s*/, '');
}

export function formatRuntimeErrorLocation(path: string, line: number, column: number): string {
	const label = path ? ensureWorkspaceRelativePath(path) : '';
	const suffix = `${line}:${column}`;
	return label ? `${label}:${suffix}` : suffix;
}

export function formatRuntimeStackFrame(frame: StackTraceFrame): string {
	const source = frame.workspacePath || frame.source;
	let location = source ? ensureWorkspaceRelativePath(source) : '';
	if (frame.line) {
		location = location ? `${location}:${frame.line}` : `${frame.line}`;
		if (frame.column) {
			location += `:${frame.column}`;
		}
	}
	const name = frame.functionName || frame.raw || frame.source || '(anonymous)';
	return location ? `${name}(${location})` : name;
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
