import type { vec3 } from '../rompack/rompack';

export interface PathSample { u: number; p: vec3; fwd: vec3; }
export interface Path {
	readonly length: number;
	sample(u: number): PathSample;
	distanceAtU(u: number): number;
	uAtDistance(d: number): number;
	// Optional segment meta accessor (returns meta for segment containing u)
	// Implementations can return undefined if unsupported.
	segmentMetaAt?(u: number): PathSegmentMeta | undefined;
}

export interface PathPoint { p: vec3; t?: number; meta?: PathSegmentMeta; }
export interface PathSegmentMeta { tag?: string; speedScale?: number; easing?: string; bank?: number; data?: any; }
