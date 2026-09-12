import { SemanticCallGraph, SemanticCallWorklist, type CallFact } from './call_graph';
import type { SemanticCallContext } from './call_context';
import { SemanticDemandIndex } from './demand_index';
import {
	FunctionSummaryStore,
	type SemanticNameID,
} from './function_summary';
import { WorkspaceValueIdentityIndex } from './identity';
import { SemanticInstantiationQuery } from './instantiate';
import { SemanticMemberQuery } from './member_query';
import type { FileSemanticData, SymbolID } from './model';
import { SemanticQueryResults } from './query_dependencies';
import { LuaSourceCallQuery, type LuaSourceCallGraph } from './source_call_graph';
import { LuaSourceValueQuery } from './source_value_query';
import type { LuaWrittenSourceQuery } from './written_sources';
import type {
	CallValueEntry,
	SemanticValueSource,
	WorkspaceValueFactsInput,
} from './value_graph';

type MemberQueryEntry = {
	readonly name: SemanticNameID;
	readonly query: number;
};

export type LuaSemanticQueryMetrics = {
	readonly resolverEngine: 'query-store';
	readonly functionSummaries: number;
	readonly instantiatedCalls: number;
	readonly callFactPasses: number;
	readonly callEvaluations: number;
	readonly callerContextEvaluations: number;
	readonly callableUseEvaluations: number;
	readonly valueEvaluations: number;
	readonly memberEvaluations: number;
	readonly locationEvaluations: number;
	readonly prototypeEvaluations: number;
	readonly indexEvaluations: number;
	readonly prototypeJoinEvaluations: number;
	readonly staticCalleeEvaluations: number;
	readonly effectBodyEvaluations: number;
};

export class LuaSemanticQueryStore {
	private readonly summaries: FunctionSummaryStore;
	private readonly demand: SemanticDemandIndex;
	private readonly worklist: SemanticCallWorklist;
	private readonly instantiation: SemanticInstantiationQuery;
	private readonly members: SemanticMemberQuery;
	private readonly calls: SemanticCallGraph;
	private sourceCalls: LuaSourceCallQuery | undefined;
	private sourceValues: LuaSourceValueQuery | undefined;
	private readonly memberEntries: MemberQueryEntry[][] = [];
	private readonly memberResults: SemanticQueryResults<SymbolID>;
	private readonly allMemberResults: SemanticQueryResults<SymbolID>;
	private readonly functionResults: SemanticQueryResults<SymbolID>;
	private memberQueryCount = 0;

	constructor(
		files: readonly FileSemanticData[],
		globalValues: ReadonlyMap<string, SymbolID>,
	) {
		const input: WorkspaceValueFactsInput = { files, globalValues };
		const identities = new WorkspaceValueIdentityIndex(input);
		this.summaries = new FunctionSummaryStore(files, identities);
		this.memberResults = new SemanticQueryResults<SymbolID>(this.summaries.terms.dependencies);
		this.allMemberResults = new SemanticQueryResults<SymbolID>(this.summaries.terms.dependencies);
		this.functionResults = new SemanticQueryResults<SymbolID>(this.summaries.terms.dependencies);
		this.worklist = new SemanticCallWorklist(this.summaries.terms.dependencies);
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
		let entries = this.memberEntries[term];
		if (!entries) {
			entries = [];
			this.memberEntries[term] = entries;
		}
		let entry: MemberQueryEntry | undefined;
		for (let index = 0; index < entries.length; index += 1) {
			if (entries[index].name === nameId) {
				entry = entries[index];
				break;
			}
		}
		if (!entry) {
			entry = { name: nameId, query: this.memberQueryCount++ };
			entries.push(entry);
		}
		const query = entry.query;
		if (this.memberResults.isCurrent(query)) return this.memberResults.values(query);
		this.instantiation.demandTermEffects(term);
		this.instantiation.projectName(nameId);
		this.instantiation.demandEffectName(nameId);
		const owner = this.summaries.terms.summaryOwner(term);
		if (owner !== undefined) this.calls.querySummary(owner);
		for (;;) {
			this.calls.activate(term);
			this.calls.solve();
			this.memberResults.begin(query);
			const values = this.memberResults.buffer(0);
			this.members.resolveMembers(source, nameId, values);
			const result = this.memberResults.publish(query, values);
			this.calls.solve();
			if (this.memberResults.isCurrent(query)) return result;
		}
	}

	public allMembers(source: SemanticValueSource): readonly SymbolID[] {
		const term = this.summaries.terms.compileSource(source);
		if (this.allMemberResults.isCurrent(term)) return this.allMemberResults.values(term);
		const names = this.demand.names();
		for (;;) {
			this.allMemberResults.begin(term);
			const values = this.allMemberResults.buffer(0);
			for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
				const members = this.member(source, this.summaries.terms.name(names[nameIndex]));
				for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
					if (!values.includes(members[memberIndex])) values.push(members[memberIndex]);
				}
			}
			const result = this.allMemberResults.publish(term, values);
			this.calls.solve();
			if (this.allMemberResults.isCurrent(term)) return result;
		}
	}

	public functions(source: SemanticValueSource): readonly SymbolID[] {
		const term = this.summaries.terms.compileSource(source);
		if (this.functionResults.isCurrent(term)) return this.functionResults.values(term);
		this.instantiation.demandTermEffects(term);
		const owner = this.summaries.terms.summaryOwner(term);
		if (owner !== undefined) this.calls.querySummary(owner);
		for (;;) {
			this.calls.activate(term);
			this.calls.solve();
			this.functionResults.begin(term);
			const values = this.functionResults.buffer(0);
			this.members.resolveFunctionDeclarations(source, values);
			const result = this.functionResults.publish(term, values);
			this.calls.solve();
			if (this.functionResults.isCurrent(term)) return result;
		}
	}

	public callee(call: CallValueEntry): readonly CallFact[] {
		return this.calls.callee(call);
	}

	public callContexts(call: CallValueEntry): readonly SemanticCallContext[] {
		return this.calls.callContexts(call);
	}

	public callSources(call: CallValueEntry): LuaSourceCallGraph {
		if (this.sourceCalls === undefined) this.sourceCalls = new LuaSourceCallQuery(this.summaries, this.instantiation, this.calls);
		return this.sourceCalls.ancestry(call);
	}

	public contextualSources(written: LuaWrittenSourceQuery): LuaSourceValueQuery {
		if (this.sourceCalls === undefined) this.sourceCalls = new LuaSourceCallQuery(this.summaries, this.instantiation, this.calls);
		if (this.sourceValues === undefined) this.sourceValues = new LuaSourceValueQuery(written, this.sourceCalls, this.summaries);
		return this.sourceValues;
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
			callEvaluations: this.worklist.evaluation.count,
			callerContextEvaluations: this.calls.getCallerContextEvaluations(),
			callableUseEvaluations: this.calls.getCallableUseEvaluations(),
			valueEvaluations: this.members.valueEvaluations,
			memberEvaluations: this.members.memberEvaluations,
			locationEvaluations: this.members.locationEvaluations,
			prototypeEvaluations: this.members.prototypeEvaluations,
			indexEvaluations: this.members.indexEvaluations,
			prototypeJoinEvaluations: this.members.prototypeJoinEvaluations,
			staticCalleeEvaluations: this.demand.staticCalleeEvaluations,
			effectBodyEvaluations: this.demand.effectBodyEvaluations,
		};
	}

}
