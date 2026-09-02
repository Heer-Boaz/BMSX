import { computeSourceLabel } from '../../../common/paths';
import type { ResourceIdentity } from '../../../common/resource';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { isScenarioTestAsset } from '../../../../toolchain/ts/rompack/scenario_test';

export type ScenarioTestId = `scenario:${0 | 1}:${string}`;
export type ScenarioTestRootId = `scenario-root:${0 | 1}`;

export type ScenarioTestItem = {
	readonly id: ScenarioTestId;
	readonly parentId: ScenarioTestRootId;
	readonly label: string;
	readonly resource: ResourceIdentity;
	readonly assetId: string;
	readonly sourceTimestamp: number;
};

export type ScenarioTestRoot = {
	readonly id: ScenarioTestRootId;
	readonly domain: 0 | 1;
	readonly label: string;
	readonly testCount: number;
	children: readonly ScenarioTestItem[] | null;
};

type ScenarioTestCandidate = {
	readonly assetId: string;
	readonly sourcePath: string;
	readonly sourceTimestamp: number;
};

export function scenarioTestId(domain: 0 | 1, assetId: string): ScenarioTestId {
	return `scenario:${domain}:${assetId}`;
}

/** Retained test tree. Cartridge source registries are scanned exactly once. */
export class ScenarioTestCollection {
	public readonly roots: readonly ScenarioTestRoot[];
	private readonly rootsById = new Map<ScenarioTestRootId, ScenarioTestRoot>();
	private readonly candidatesByRootId = new Map<ScenarioTestRootId, readonly ScenarioTestCandidate[]>();
	private readonly testsById = new Map<ScenarioTestId, ScenarioTestItem>();

	public constructor(sources: RuntimeSourceState) {
		const roots: ScenarioTestRoot[] = [];
		for (const domain of CARTRIDGE_RESOURCE_DOMAINS) {
			const cartridge = sources.cartridgeSlots[domain];
			if (cartridge === null) {
				continue;
			}
			const candidates: ScenarioTestCandidate[] = [];
			const records = cartridge.luaSources.records;
			for (let index = 0; index < records.length; index += 1) {
				const record = records[index];
				if (!isScenarioTestAsset(record)) {
					continue;
				}
				candidates.push({
					assetId: record.resid,
					sourcePath: record.source_path,
					sourceTimestamp: record.update_timestamp,
				});
			}
			if (candidates.length === 0) {
				continue;
			}
			candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
			const rootId: ScenarioTestRootId = `scenario-root:${domain}`;
			const projectLabel = computeSourceLabel(cartridge.projectRootPath);
			const root: ScenarioTestRoot = {
				id: rootId,
				domain,
				label: `CART ${domain} / ${projectLabel}`,
				testCount: candidates.length,
				children: null,
			};
			roots.push(root);
			this.rootsById.set(rootId, root);
			this.candidatesByRootId.set(rootId, candidates);
		}
		this.roots = roots;
	}

	public resolveRoot(rootId: ScenarioTestRootId): readonly ScenarioTestItem[] {
		const root = this.rootsById.get(rootId)!;
		if (root.children !== null) {
			return root.children;
		}
		const candidates = this.candidatesByRootId.get(rootId)!;
		const children = new Array<ScenarioTestItem>(candidates.length);
		for (let index = 0; index < candidates.length; index += 1) {
			const candidate = candidates[index];
			const test: ScenarioTestItem = {
				id: scenarioTestId(root.domain, candidate.assetId),
				parentId: rootId,
				label: computeSourceLabel(candidate.sourcePath),
				resource: { domain: root.domain, path: candidate.sourcePath },
				assetId: candidate.assetId,
				sourceTimestamp: candidate.sourceTimestamp,
			};
			children[index] = test;
			this.testsById.set(test.id, test);
		}
		root.children = children;
		return children;
	}

	public getTest(testId: ScenarioTestId): ScenarioTestItem {
		return this.testsById.get(testId)!;
	}

	public findTestBySourcePath(domain: 0 | 1, sourcePath: string): ScenarioTestItem {
		const rootId: ScenarioTestRootId = `scenario-root:${domain}`;
		const children = this.resolveRoot(rootId);
		for (let index = 0; index < children.length; index += 1) {
			if (children[index].resource.path === sourcePath) {
				return children[index];
			}
		}
		throw new Error(`Scenario '${sourcePath}' is not packaged in cartridge ${domain}.`);
	}
}
