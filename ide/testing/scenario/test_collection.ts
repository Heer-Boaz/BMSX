import { computeSourceLabel } from '../../common/paths';
import type { RuntimeSourceState } from '../../runtime/sources';
import { developmentCartridgeSource } from '../../runtime/sources';
import {
	isScenarioTestAsset,
	SCENARIO_TEST_SOURCE_SUFFIX,
} from '../../../toolchain/ts/rompack/scenario_test';

export type ScenarioTestId = `scenario:${0 | 1}:${string}`;
export type ScenarioTestRootId = `scenario-root:${0 | 1}`;

export type ScenarioTestItem = {
	readonly id: ScenarioTestId;
	readonly parentId: ScenarioTestRootId;
	readonly label: string;
	readonly resource: {
		readonly domain: 0 | 1;
		readonly path: string;
	};
	readonly assetId: string;
	readonly sourceTimestamp: number;
};

export type ScenarioTestRoot = {
	readonly id: ScenarioTestRootId;
	readonly domain: 0 | 1;
	readonly projectLabel: string;
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

	public constructor(sources: RuntimeSourceState) {
		const roots: ScenarioTestRoot[] = [];
		const cartridge = developmentCartridgeSource(sources);
		if (cartridge !== null) {
			const domain = cartridge.domain;
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
			if (candidates.length > 0) {
				candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
				const rootId: ScenarioTestRootId = `scenario-root:${domain}`;
				const projectLabel = computeSourceLabel(cartridge.projectRootPath);
				const root: ScenarioTestRoot = {
					id: rootId,
					domain,
					projectLabel,
					label: `CART ${domain} / ${projectLabel}`,
					testCount: candidates.length,
					children: null,
				};
				roots.push(root);
				this.rootsById.set(rootId, root);
				this.candidatesByRootId.set(rootId, candidates);
			}
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
			const sourceLabel = computeSourceLabel(candidate.sourcePath);
			let testLabel = sourceLabel.slice(0, -SCENARIO_TEST_SOURCE_SUFFIX.length);
			const projectPrefix = `${root.projectLabel}_`;
			if (testLabel.startsWith(projectPrefix)) {
				testLabel = testLabel.slice(projectPrefix.length);
			}
			const test: ScenarioTestItem = {
				id: scenarioTestId(root.domain, candidate.assetId),
				parentId: rootId,
				label: testLabel.replaceAll('_', ' '),
				resource: { domain: root.domain, path: candidate.sourcePath },
				assetId: candidate.assetId,
				sourceTimestamp: candidate.sourceTimestamp,
			};
			children[index] = test;
		}
		root.children = children;
		return children;
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
