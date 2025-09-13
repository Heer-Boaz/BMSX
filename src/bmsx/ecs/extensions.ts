import type { World } from "../core/world";
import type { NodeSpec } from "./pipeline";
import type { ECSPipelineRegistry } from "./pipeline";

export type ECSPipelineExtension = (ctx: { world: World; profile?: string; registry: ECSPipelineRegistry }) => NodeSpec[] | void;

const _extensions: ECSPipelineExtension[] = [];

export function registerEcsPipelineExtension(ext: ECSPipelineExtension): void {
	_extensions.push(ext);
}

export function collectEcsPipelineExtensions(ctx: { world: World; profile?: string; registry: ECSPipelineRegistry }): NodeSpec[] {
	const out: NodeSpec[] = [];
	for (const fn of _extensions) {
		try {
			const res = fn(ctx);
			if (Array.isArray(res)) out.push(...res);
		} catch (e) {
			console.error('[ECS] Extension error:', e);
		}
	}
	return out;
}

