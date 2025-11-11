import { clamp } from '../utils/utils.ts';

export type LuaDebuggerStepMode = 'none' | 'into' | 'over';
export type LuaDebuggerPauseReason = 'breakpoint' | 'step' | 'exception';

export class LuaDebuggerController {
	private readonly breakpoints = new Map<string, Set<number>>();
	private stepMode: LuaDebuggerStepMode = 'none';
	private stepDepth = 0;
	private readonly suppressedBoundaries = new Set<string>();

	public isActive(): boolean {
		return this.breakpoints.size > 0 || this.stepMode !== 'none';
	}

	public setBreakpoints(entries: ReadonlyMap<string, Iterable<number>>): void {
		this.breakpoints.clear();
		this.clearSuppressedBoundaries();
		for (const [chunkName, lines] of entries) {
			const normalizedChunk = this.normalizeChunkName(chunkName);
			const normalizedLines = new Set<number>();
			for (const rawLine of lines) {
				const resolved = this.normalizeLineNumber(rawLine);
				if (resolved !== null) {
					normalizedLines.add(resolved);
				}
			}
			if (normalizedLines.size > 0) {
				this.breakpoints.set(normalizedChunk, normalizedLines);
			}
		}
	}

	public clearBreakpoints(): void {
		this.breakpoints.clear();
		this.clearSuppressedBoundaries();
	}

	public requestStepInto(): void {
		this.stepMode = 'into';
		this.stepDepth = 0;
		this.clearSuppressedBoundaries();
	}

	public requestStepOver(depth: number): void {
		this.stepMode = 'over';
		this.stepDepth = Math.max(0, depth | 0);
		this.clearSuppressedBoundaries();
	}

	public clearStepping(): void {
		this.stepMode = 'none';
		this.stepDepth = 0;
		this.clearSuppressedBoundaries();
	}

	public suppressNextAtBoundary(chunk: string, line: number, depth: number): void {
		const normalizedChunk = this.normalizeChunkName(chunk);
		const normalizedLine = this.normalizeLineNumber(line);
		if (normalizedLine === null) {
			return;
		}
		const normalizedDepth = Math.max(0, depth | 0);
		this.suppressedBoundaries.add(this.buildBoundaryKey(normalizedChunk, normalizedLine, normalizedDepth));
	}

	public clearSuppressedBoundaries(): void {
		this.suppressedBoundaries.clear();
	}

	public shouldPause(chunkName: string, line: number, depth: number): LuaDebuggerPauseReason | null {
		const normalizedChunk = this.normalizeChunkName(chunkName);
		const resolvedLine = this.normalizeLineNumber(line);
		if (resolvedLine === null) {
			return null;
		}
		const normalizedDepth = Math.max(0, depth | 0);
		const boundaryKey = this.buildBoundaryKey(normalizedChunk, resolvedLine, normalizedDepth);
		if (this.suppressedBoundaries.delete(boundaryKey)) {
			return null;
		}
		const chunkBreakpoints = this.breakpoints.get(normalizedChunk);
		if (chunkBreakpoints && chunkBreakpoints.has(resolvedLine)) {
			return 'breakpoint';
		}
		if (this.stepMode === 'into') {
			this.stepMode = 'none';
			return 'step';
		}
		if (this.stepMode === 'over' && normalizedDepth <= this.stepDepth) {
			this.stepMode = 'none';
			return 'step';
		}
		return null;
	}

	private buildBoundaryKey(chunk: string, line: number, depth: number): string {
		return `${chunk}:${line}:${depth}`;
	}

	private normalizeChunkName(name: string): string {
		let normalized = name.trim();
		if (normalized.startsWith('@')) {
			normalized = normalized.slice(1);
		}
		return normalized.replace(/\\/g, '/');
	}

	private normalizeLineNumber(value: number): number | null {
		if (!Number.isFinite(value)) {
			return null;
		}
		const resolved = clamp(Math.floor(value), 1, Number.MAX_SAFE_INTEGER);
		return resolved;
	}
}
