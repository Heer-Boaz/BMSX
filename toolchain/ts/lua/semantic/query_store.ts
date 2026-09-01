import { SemanticCallGraph, SemanticCallWorklist, type CallFact } from './call_graph';
import { SemanticDemandIndex } from './demand_index';
import {
	FunctionSummaryStore,
	type SemanticNameID,
} from './function_summary';
import { WorkspaceValueIdentityIndex } from './identity';
import { SemanticInstantiationQuery } from './instantiate';
import { SemanticMemberQuery } from './member_query';
import type { FileSemanticData, SymbolID } from './model';
import type {
	CallValueEntry,
	SemanticValueSource,
	WorkspaceValueFactsInput,
} from './value_graph';

type MemberCacheEntry = {
	readonly name: SemanticNameID;
	revision: number;
	result: readonly SymbolID[];
};

type FunctionCacheEntry = {
	revision: number;
	result: readonly SymbolID[];
};

export type LuaSemanticQueryMetrics = {
	readonly resolverEngine: 'query-store';
	readonly functionSummaries: number;
	readonly instantiatedCalls: number;
	readonly callFactPasses: number;
};

export class LuaSemanticQueryStore {
	private readonly summaries: FunctionSummaryStore;
	private readonly demand: SemanticDemandIndex;
	private readonly worklist = new SemanticCallWorklist();
	private readonly instantiation: SemanticInstantiationQuery;
	private readonly members: SemanticMemberQuery;
	private readonly calls: SemanticCallGraph;
	private readonly memberCache: MemberCacheEntry[][] = [];
	private readonly functionCache: (FunctionCacheEntry | undefined)[] = [];
	private readonly memberScratch: SymbolID[] = [];
	private readonly allMemberScratch: SymbolID[] = [];
	private readonly functionScratch: SymbolID[] = [];

	constructor(
		files: readonly FileSemanticData[],
		globalValues: ReadonlyMap<string, SymbolID>,
	) {
		const input: WorkspaceValueFactsInput = { files, globalValues };
		const identities = new WorkspaceValueIdentityIndex(input);
		this.summaries = new FunctionSummaryStore(files, identities);
		this.demand = new SemanticDemandIndex(files, this.summaries);
		this.instantiation = new SemanticInstantiationQuery(
			this.summaries,
			this.demand,
			(call, ownerFrame) => this.worklist.enqueue(call, ownerFrame),
		);
		this.members = new SemanticMemberQuery(this.summaries, this.instantiation);
		this.calls = new SemanticCallGraph(
			this.summaries,
			this.demand,
			this.instantiation,
			this.members,
			this.worklist,
		);
	}

	public member(source: SemanticValueSource, name: string): readonly SymbolID[] {
		const term = this.summaries.terms.compileSource(source);
		const nameId = this.members.nameId(name);
		this.instantiation.demandTermEffects(term);
		this.instantiation.demandEffectName(nameId);
		const owner = this.summaries.terms.summaryOwner(term);
		if (owner !== undefined) {
			this.calls.querySummary(owner);
		}
		this.calls.activate(term);
		this.calls.solve();
		let entries = this.memberCache[term];
		if (!entries) {
			entries = [];
			this.memberCache[term] = entries;
		}
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			if (entry.name === nameId && entry.revision === this.instantiation.getRevision()) {
				return entry.result;
			}
		}
		this.resolveMembersStable(source, nameId, this.memberScratch);
		const result = this.memberScratch.slice();
		for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
			const entry = entries[entryIndex];
			if (entry.name === nameId) {
				entry.revision = this.instantiation.getRevision();
				entry.result = result;
				return result;
			}
		}
		entries.push({
			name: nameId,
			revision: this.instantiation.getRevision(),
			result,
		});
		return result;
	}

	public allMembers(source: SemanticValueSource): readonly SymbolID[] {
		this.allMemberScratch.length = 0;
		const names = this.demand.names();
		for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
			const members = this.member(source, this.summaries.terms.name(names[nameIndex]));
			for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
				if (!this.allMemberScratch.includes(members[memberIndex])) {
					this.allMemberScratch.push(members[memberIndex]);
				}
			}
		}
		return this.allMemberScratch.slice();
	}

	public functions(source: SemanticValueSource): readonly SymbolID[] {
		const term = this.summaries.terms.compileSource(source);
		this.instantiation.demandTermEffects(term);
		const owner = this.summaries.terms.summaryOwner(term);
		if (owner !== undefined) {
			this.calls.querySummary(owner);
		}
		this.calls.activate(term);
		this.calls.solve();
		const cached = this.functionCache[term];
		if (cached && cached.revision === this.instantiation.getRevision()) {
			return cached.result;
		}
		this.members.resolveFunctionDeclarations(source, this.functionScratch);
		const result = this.functionScratch.slice();
		this.functionCache[term] = {
			revision: this.instantiation.getRevision(),
			result,
		};
		return result;
	}

	public callee(call: CallValueEntry): readonly CallFact[] {
		return this.calls.callee(call);
	}

	public incoming(symbol: SymbolID, name: string): readonly CallFact[] {
		return this.calls.incoming(symbol, this.members.nameId(name));
	}

	public outgoing(symbol: SymbolID): readonly CallFact[] {
		return this.calls.outgoing(symbol);
	}

	public metrics(): LuaSemanticQueryMetrics {
		return {
			resolverEngine: 'query-store',
			functionSummaries: this.summaries.count,
			instantiatedCalls: this.instantiation.frames.count,
			callFactPasses: this.calls.getSolvePasses(),
		};
	}

	private resolveMembersStable(
		source: SemanticValueSource,
		name: SemanticNameID,
		out: SymbolID[],
	): void {
		const term = this.summaries.terms.compileSource(source);
		for (;;) {
			this.calls.activate(term);
			this.calls.solve();
			const revision = this.instantiation.getRevision();
			this.members.resolveMembers(source, name, out);
			this.calls.solve();
			if (revision === this.instantiation.getRevision()) {
				return;
			}
		}
	}
}
