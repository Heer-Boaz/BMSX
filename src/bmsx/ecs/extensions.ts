import type { World, WorldModule } from "../core/world";
import type { NodeSpec } from "./pipeline";
import type { ECSPipelineRegistry } from "./pipeline";

export interface ECSPipelineExtensionContext {
	world: World;
	registry: ECSPipelineRegistry;
}

export type ECSPipelineExtension = (ctx: ECSPipelineExtensionContext) => NodeSpec[] | void;

export function collectEcsPipelineExtensionsFromWorldModules(ctx: ECSPipelineExtensionContext): NodeSpec[] {
	const out: NodeSpec[] = [];
	const seenModules = new Set<WorldModule>();
	for (const mod of ctx.world.modules) {
		if (!mod || typeof mod !== 'object' || seenModules.has(mod)) continue;
		seenModules.add(mod);
		const ecs = mod.ecs;
		if (!ecs) throw new Error(`Module ${mod.id} has no ECS definition.`);
		if (Array.isArray(ecs.systems)) {
			for (const desc of ecs.systems) {
				if (!ctx.registry.get(desc.id)) ctx.registry.register(desc);
			}
		}
		const nodes = typeof ecs.nodes === 'function' ? ecs.nodes(ctx) : ecs.nodes;
		if (Array.isArray(nodes)) out.push(...nodes);
	}
	return out;
}
