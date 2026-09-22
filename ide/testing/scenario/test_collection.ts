import type { LuaSourceRegistry } from '../../runtime/source_registry';
import { computeSourceLabel } from '../../common/paths';
import type { RuntimeSourceState } from '../../runtime/sources';
import { developmentCartridgeSource } from '../../runtime/sources';
import { isScenarioTestAsset, SCENARIO_TEST_SOURCE_SUFFIX } from '../../../toolchain/ts/rompack/scenario_test';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxError } from '../../../toolchain/ts/lua/errors';
import type { LuaSourceRange } from '../../../toolchain/ts/lua/syntax/ast';
import { discoverGuestTestSuite, type GuestTestSuite } from '../../../toolchain/ts/rompack/test_suite';

export type ScenarioTestId = `scenario:${0 | 1}:${string}`;
export type ScenarioTestRootId = `scenario-root:${0 | 1}`;
export type ScenarioTestModuleId = `scenario-module:${0 | 1}:${string}`;
export type ScenarioTestNodeId = ScenarioTestRootId | ScenarioTestModuleId | ScenarioTestId;

type TestResource = { readonly domain: 0 | 1; readonly path: string };
export type ScenarioTestItem = {
	readonly kind: 'test';
	readonly caseName: string;
	readonly id: ScenarioTestId;
	readonly parentId: ScenarioTestModuleId;
	readonly label: string;
	readonly resource: TestResource;
	readonly assetId: string;
	readonly sourceTimestamp: number;
	readonly range: LuaSourceRange;
};

export type ScenarioTestModule = {
	readonly kind: 'module';
	readonly id: ScenarioTestModuleId;
	readonly parentId: ScenarioTestRootId;
	readonly label: string;
	readonly resource: TestResource;
	readonly assetId: string;
	source: string;
	sourceTimestamp: number;
	suite: GuestTestSuite | null;
	diagnostic: LuaSyntaxError | null;
	children: readonly ScenarioTestItem[];
};

export type ScenarioTestRoot = {
	readonly kind: 'root';
	readonly id: ScenarioTestRootId;
	readonly domain: 0 | 1;
	readonly label: string;
	testCount: number;
	readonly children: ScenarioTestModule[];
};
export type ScenarioTestNode = ScenarioTestRoot | ScenarioTestModule | ScenarioTestItem;

export function scenarioTestId(domain: 0 | 1, assetId: string, caseName: string): ScenarioTestId {
	return `scenario:${domain}:${JSON.stringify([assetId, caseName])}`;
}

/** Source-derived project/module/case identities. Discovery never runs guest code. */
export class ScenarioTestCollection {
	public readonly roots: ScenarioTestRoot[] = [];
	private sourceRevision = -1;
	private sourceRegistry: LuaSourceRegistry | null = null;
	private sourceDomain: 0 | 1 | null = null;
	public revision = 0;
	private readonly nodes = new Map<ScenarioTestNodeId, ScenarioTestNode>();

	public constructor(private readonly sources: RuntimeSourceState) {
		this.refresh();
	}

	/** Membership follows the source registry, including newly authored source-only suites. */
	public refresh(): boolean {
		const cartridge = developmentCartridgeSource(this.sources);
		const registry = cartridge === null ? null : cartridge.luaSources;
		const domain = cartridge === null ? null : cartridge.domain;
		const ownerChanged = registry !== this.sourceRegistry || domain !== this.sourceDomain;
		if (!ownerChanged && (registry === null || registry.revision === this.sourceRevision)) return false;
		if (ownerChanged) {
			this.roots.length = 0;
			this.nodes.clear();
			this.sourceRegistry = registry;
			this.sourceDomain = domain;
		}
		if (cartridge === null) { this.revision += 1; return true; }
		this.sourceRevision = cartridge.luaSources.revision;
		let root = this.roots[0];
		const members = new Set<ScenarioTestModuleId>();
		for (const record of cartridge.luaSources.records) {
			if (!isScenarioTestAsset(record)) continue;
			if (root === undefined) {
				root = { kind: 'root', id: `scenario-root:${cartridge.domain}`, domain: cartridge.domain,
					label: computeSourceLabel(cartridge.projectRootPath), testCount: 0, children: [] };
				this.roots.push(root);
				this.nodes.set(root.id, root);
			}
			const id: ScenarioTestModuleId = `scenario-module:${root.domain}:${record.resid}`;
			members.add(id);
			const existing = this.nodes.get(id) as ScenarioTestModule | undefined;
			if (existing !== undefined) {
				this.updateSource(existing, record.src, record.update_timestamp);
				continue;
			}
			const module: ScenarioTestModule = {
				kind: 'module', id, parentId: root.id,
				label: computeSourceLabel(record.source_path).slice(0, -SCENARIO_TEST_SOURCE_SUFFIX.length),
				resource: { domain: root.domain, path: record.source_path }, assetId: record.resid,
				source: record.src, sourceTimestamp: record.update_timestamp,
				suite: null, diagnostic: null, children: [],
			};
			root.children.push(module);
			this.nodes.set(id, module);
			this.discover(module);
			root.testCount += module.children.length;
		}
		if (root !== undefined) {
			for (let index = root.children.length - 1; index >= 0; index -= 1) {
				const module = root.children[index];
				if (members.has(module.id)) continue;
				for (const test of module.children) this.nodes.delete(test.id);
				root.testCount -= module.children.length;
				this.nodes.delete(module.id);
				root.children.splice(index, 1);
			}
			root.children.sort((left, right) => left.resource.path.localeCompare(right.resource.path));
			if (root.children.length === 0) {
				this.nodes.delete(root.id);
				this.roots.length = 0;
			}
		}
		this.revision += 1;
		return true;
	}

	private discover(module: ScenarioTestModule): void {
		for (const test of module.children) this.nodes.delete(test.id);
		module.children = [];
		module.suite = null;
		module.diagnostic = null;
		try {
			const chunk = parseLuaChunk(module.source, module.resource.path).chunk;
			module.suite = discoverGuestTestSuite(chunk, module.resource.path);
		} catch (error) {
			if (!(error instanceof LuaSyntaxError)) throw error;
			module.diagnostic = error;
			return;
		}
		module.children = module.suite.tests.map(test => {
			const item: ScenarioTestItem = {
				kind: 'test', caseName: test.name, id: scenarioTestId(module.resource.domain, module.assetId, test.name),
				parentId: module.id, label: test.name, resource: module.resource, assetId: module.assetId,
				sourceTimestamp: module.sourceTimestamp, range: test.range,
			};
			this.nodes.set(item.id, item);
			return item;
		});
	}

	public updateSource(module: ScenarioTestModule, source: string, revision: number): void {
		if (source === module.source && revision === module.sourceTimestamp) return;
		module.source = source;
		module.sourceTimestamp = revision;
		const root = this.nodes.get(module.parentId) as ScenarioTestRoot;
		root.testCount -= module.children.length;
		this.discover(module);
		root.testCount += module.children.length;
		this.revision += 1;
	}

	public getNode(id: ScenarioTestNodeId): ScenarioTestNode | undefined { return this.nodes.get(id); }

	public resolveRoot(rootId: ScenarioTestRootId): readonly ScenarioTestModule[] {
		return (this.nodes.get(rootId) as ScenarioTestRoot).children;
	}

	public findModuleBySourcePath(domain: 0 | 1, sourcePath: string): ScenarioTestModule {
		for (const module of this.resolveRoot(`scenario-root:${domain}`)) {
			if (module.resource.path === sourcePath) return module;
		}
		throw new Error(`Test module '${sourcePath}' is not packaged in cartridge ${domain}.`);
	}

	public resolveNode(node: ScenarioTestNode): readonly ScenarioTestItem[] {
		if (node.kind === 'test') return [node];
		if (node.kind === 'module') {
			if (node.diagnostic !== null) throw node.diagnostic;
			return node.children;
		}
		return node.children.flatMap(module => this.resolveNode(module));
	}
}
