import type { NodeSpec } from "../../ecs/pipeline";
import { gameplaySpec } from "./gameplay";

export function editorSpec(): NodeSpec[] {
	const base = gameplaySpec();
	const cloned: NodeSpec[] = [];
	for (let i = 0; i < base.length; i++) cloned.push({ ...base[i] });
	return cloned;
}
