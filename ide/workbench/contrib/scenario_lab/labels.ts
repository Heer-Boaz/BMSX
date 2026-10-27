import type { ScenarioTestItem, ScenarioTestModule, ScenarioTestRoot } from '../../../testing/scenario/test_collection';

/** One sibling pass disambiguates names; the parent already supplies the exact project namespace. */
export function scenarioModuleCaptions(root: ScenarioTestRoot): ReadonlyMap<ScenarioTestModule, string> {
	const counts = new Map<string, number>();
	for (const module of root.children) counts.set(module.label, (counts.get(module.label) ?? 0) + 1);
	const namespace = root.label + '_';
	const captions = new Map<ScenarioTestModule, string>();
	for (const module of root.children) {
		let caption = module.label;
		if (counts.get(module.label)! > 1) caption = module.resource.path;
		else if (caption.startsWith(namespace) && caption.length > namespace.length) {
			const compact = caption.slice(namespace.length);
			if (!counts.has(compact)) caption = compact;
		}
		captions.set(module, caption);
	}
	return captions;
}

/** Full source membership is independent of the contextual tree caption and current catalog. */
export function scenarioTestIdentity(test: ScenarioTestItem): string {
	return `${test.resource.path}\n${test.caseName}`;
}
