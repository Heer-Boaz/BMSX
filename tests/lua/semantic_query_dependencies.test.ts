import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticCallWorklist } from '../../toolchain/ts/lua/semantic/call_graph';
import { SemanticDemandIndex } from '../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore, type TermID } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { InstantiationFrames, SemanticInstantiationQuery, WriteSet } from '../../toolchain/ts/lua/semantic/instantiate';
import { SemanticMemberQuery } from '../../toolchain/ts/lua/semantic/member_query';
import { buildLuaFileSemanticData, type SymbolID } from '../../toolchain/ts/lua/semantic/model';
import { SemanticDependencyIndex, SemanticQueryDependencies, SemanticQueryEvaluation, SemanticQueryResults } from '../../toolchain/ts/lua/semantic/query_dependencies';
import { LuaSemanticQueryStore } from '../../toolchain/ts/lua/semantic/query_store';
import { BidirectionalTermRelation } from '../../toolchain/ts/lua/semantic/term_relation';
import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';

test('empty index rows invalidate on their first fact, not on unrelated writes', () => {
	const dependencies = new SemanticQueryDependencies();
	const facts = new SemanticDependencyIndex(dependencies);
	const results = new SemanticQueryResults<number>(dependencies);
	assert.equal(results.isCurrent(0), false);
	results.begin(0);
	facts.read(17);
	const empty = results.publish(0, []);
	assert.equal(results.isCurrent(0), true);
	facts.changed(18);
	assert.equal(results.isCurrent(0), true);
	assert.equal(results.values(0), empty);
	facts.changed(17);
	assert.equal(results.isCurrent(0), false);
	results.begin(0);
	facts.read(17);
	assert.deepEqual(results.publish(0, [23]), [23]);
	assert.equal(results.isCurrent(0), true);
	assert.equal(results.count, 2);
});

test('a cached child records the parent dependency and transitive invalidations coalesce', () => {
	const dependencies = new SemanticQueryDependencies();
	const facts = new SemanticDependencyIndex(dependencies);
	const scheduled: number[] = [];
	const queries = new SemanticQueryEvaluation(dependencies, key => scheduled.push(key));
	queries.begin(0);
	facts.read(7);
	queries.end(0);
	queries.begin(1);
	assert.equal(queries.isCurrent(0), true);
	queries.end(1);
	queries.begin(2);
	assert.equal(queries.isCurrent(1), true);
	queries.end(2);
	facts.changed(8);
	assert.deepEqual(scheduled, []);
	facts.changed(7);
	facts.changed(7);
	assert.deepEqual(scheduled, [0, 1, 2]);
	assert.equal(queries.isCurrent(2), false);
	assert.equal(queries.count, 3, 'publication schedules but does not evaluate');
});

test('a write during evaluation cannot be stamped as an already-consumed input', () => {
	const dependencies = new SemanticQueryDependencies();
	const facts = new SemanticDependencyIndex(dependencies);
	const query = new SemanticQueryEvaluation(dependencies);
	query.begin(0);
	facts.read(5);
	facts.changed(5);
	facts.changed(5);
	query.end(0);
	assert.equal(query.isCurrent(0), false);
	query.begin(0);
	facts.read(5);
	query.end(0);
	assert.equal(query.isCurrent(0), true);
});

test('changed output wakes a late cyclic reader even when the producer is already dirty', () => {
	const dependencies = new SemanticQueryDependencies();
	const facts = new SemanticDependencyIndex(dependencies);
	const queries = new SemanticQueryResults<number>(dependencies);
	queries.begin(0);
	facts.read(4);
	facts.changed(4);
	queries.begin(1);
	assert.equal(queries.isCurrent(0), false);
	assert.equal(queries.isComputing(0), true);
	assert.deepEqual(queries.values(0), []);
	queries.publish(1, []);
	queries.publish(0, [11]);
	assert.equal(queries.isCurrent(1), false, 'it read the old approximation after input invalidation');
	queries.begin(0);
	facts.read(4);
	queries.publish(0, [11]);
	queries.begin(1);
	assert.equal(queries.isCurrent(0), true);
	queries.publish(1, queries.values(0));
	assert.equal(queries.isCurrent(1), true);
	assert.deepEqual(queries.values(1), [11]);
});

test('self-recursive query approximations converge by changed output, not a global revision', () => {
	const dependencies = new SemanticQueryDependencies();
	const query = new SemanticQueryResults<number>(dependencies);
	const edges = [[1], [2], []];
	while (!query.isCurrent(0)) {
		query.begin(0);
		assert.equal(query.isCurrent(0), false);
		assert.equal(query.isComputing(0), true);
		const previous = query.values(0);
		const next = query.buffer(0);
		next.push(0);
		for (const node of previous) {
			if (!next.includes(node)) next.push(node);
			for (const successor of edges[node]) if (!next.includes(successor)) next.push(successor);
		}
		query.publish(0, next);
	}
	assert.deepEqual(query.values(0), [0, 1, 2]);
	assert.equal(query.count, 4);
});

test('mutually recursive queries retain complete prior approximations and reach a fixed point', () => {
	const dependencies = new SemanticQueryDependencies();
	const facts = new SemanticDependencyIndex(dependencies);
	const queries = new SemanticQueryResults<number>(dependencies);
	const additions = [[11], [22]];
	function resolve(key: number, depth: number): readonly number[] {
		if (queries.isCurrent(key) || queries.isComputing(key)) return queries.values(key);
		queries.begin(key);
		facts.read(key);
		const output = queries.buffer(depth);
		output.push(...additions[key]);
		for (const value of resolve(1 - key, depth + 1)) if (!output.includes(value)) output.push(value);
		output.sort((left, right) => left - right);
		return queries.publish(key, output);
	}
	while (!queries.isCurrent(0) || !queries.isCurrent(1)) resolve(0, 0);
	assert.deepEqual(queries.values(0), [11, 22]);
	assert.deepEqual(queries.values(1), [11, 22]);
	const count = queries.count;
	assert.equal(resolve(0, 0), queries.values(0));
	assert.equal(queries.count, count);
	additions[1].push(33);
	facts.changed(1);
	while (!queries.isCurrent(0) || !queries.isCurrent(1)) resolve(0, 0);
	assert.deepEqual(queries.values(0), [11, 22, 33]);
	assert.deepEqual(queries.values(1), [11, 22, 33]);
});

test('fact relations publish forward, inverse and extent changes without synthetic links', () => {
	const dependencies = new SemanticQueryDependencies();
	const relation = new BidirectionalTermRelation(dependencies);
	const query = new SemanticQueryEvaluation(dependencies);
	query.begin(0);
	assert.equal(relation.first(11 as TermID), 0);
	query.end(0);
	query.begin(1);
	assert.equal(relation.firstReverse(22 as TermID), 0);
	query.end(1);
	query.begin(2);
	assert.equal(relation.count, 0);
	query.end(2);
	relation.add(33 as TermID, 44 as TermID);
	assert.equal(query.isCurrent(0), true);
	assert.equal(query.isCurrent(1), true);
	assert.equal(query.isCurrent(2), false);
	relation.add(11 as TermID, 22 as TermID);
	assert.equal(query.isCurrent(0), false);
	assert.equal(query.isCurrent(1), false);
	assert.equal(relation.count, 2);
	const revision = dependencies.getRevision();
	assert.equal(relation.add(11 as TermID, 22 as TermID), false);
	assert.equal(dependencies.getRevision(), revision);
});

test('creation of a retained access invalidates its previously absent lookup only for that base', () => {
	const file = buildLuaFileSemanticData('local first = {}\nlocal second = {}', 'paths.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const terms = summaries.terms;
	const first = terms.compileSource(declarationValueSource(file.decls.find(entry => entry.name === 'first')!.id));
	const second = terms.compileSource(declarationValueSource(file.decls.find(entry => entry.name === 'second')!.id));
	const name = terms.nameId('missing');
	const query = new SemanticQueryEvaluation(terms.dependencies);
	query.begin(0);
	assert.equal(terms.retainedMember(first, name), undefined);
	query.end(0);
	terms.member(second, name);
	assert.equal(query.isCurrent(0), true);
	const member = terms.member(first, name);
	assert.equal(query.isCurrent(0), false);
	query.begin(0);
	assert.equal(terms.retainedMember(first, name), member);
	query.end(0);
	terms.member(first, name);
	assert.equal(query.isCurrent(0), true);
});

test('call work items are keyed by site and owner frame, and only dependent work is rescheduled', () => {
	const file = buildLuaFileSemanticData('local function run() end\nrun()', 'work.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const work = new SemanticCallWorklist(summaries.terms.dependencies);
	const facts = new SemanticDependencyIndex(summaries.terms.dependencies);
	const call = demand.topLevelCalls[0];
	work.enqueue(call, 0);
	work.enqueue(call, 0);
	work.enqueue(call, 1);
	assert.equal(work.pendingCount, 2);
	const first = work.take();
	work.evaluation.begin(first);
	facts.read(11);
	work.evaluation.end(first);
	const second = work.take();
	work.evaluation.begin(second);
	facts.read(22);
	work.evaluation.end(second);
	assert.equal(work.ownerFrame(first), 0);
	assert.equal(work.ownerFrame(second), 1);
	assert.equal(work.pendingCount, 0);
	facts.changed(33);
	assert.equal(work.pendingCount, 0);
	facts.changed(11);
	facts.changed(11);
	assert.equal(work.pendingCount, 1);
	assert.equal(work.take(), first);
	assert.equal(work.evaluation.count, 2, 'no synchronous evaluation from mutation');
	assert.equal(work.evaluation.isCurrent(second), true);
});

test('unrelated public member and function queries keep solved query work current', () => {
	const file = buildLuaFileSemanticData(`local function first() return { left = 11 } end
local function second() return { right = 22 } end
local left_result = first()
local right_result = second()`, 'independent.lua');
	const queries = new LuaSemanticQueryStore([file], new Map());
	const left = declarationValueSource(file.decls.find(entry => entry.name === 'left_result')!.id);
	const right = declarationValueSource(file.decls.find(entry => entry.name === 'right_result')!.id);
	const first = declarationValueSource(file.decls.find(entry => entry.name === 'first')!.id);
	const second = declarationValueSource(file.decls.find(entry => entry.name === 'second')!.id);
	const member = queries.member(left, 'left');
	const fn = queries.functions(first);
	assert.equal(member.length, 1);
	assert.equal(fn.length, 1);
	assert.equal(queries.member(right, 'right').length, 1);
	assert.equal(queries.functions(second).length, 1);
	const afterUnrelated = queries.metrics();
	assert.equal(queries.member(left, 'left'), member);
	assert.equal(queries.functions(first), fn);
	assert.deepEqual(queries.metrics(), afterUnrelated);
});

test('write-index dependencies follow both the base and the requested member name', () => {
	const file = buildLuaFileSemanticData('local first = { left = 11 }\nlocal second = { right = 22 }', 'writes.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const first = demand.staticWrites(summaries.terms.nameId('left'))[0];
	const second = demand.staticWrites(summaries.terms.nameId('right'))[0];
	const writes = new WriteSet(summaries.terms.dependencies);
	const queries = new SemanticQueryEvaluation(summaries.terms.dependencies);
	queries.begin(0);
	assert.equal(writes.first(first.base), 0);
	queries.end(0);
	queries.begin(1);
	assert.equal(writes.firstName(first.name), 0);
	queries.end(1);
	writes.add(second);
	assert.equal(queries.isCurrent(0), true);
	assert.equal(queries.isCurrent(1), true);
	writes.add(first);
	assert.equal(queries.isCurrent(0), false);
	assert.equal(queries.isCurrent(1), false);
});

test('a new actual frame invalidates a summary-context query, but not another summary', () => {
	const file = buildLuaFileSemanticData('local function first() end\nlocal function second() end\nfirst()\nsecond()', 'frames.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const frames = new InstantiationFrames(summaries.terms.dependencies);
	const queries = new SemanticQueryEvaluation(summaries.terms.dependencies);
	const [first, second] = summaries.list();
	queries.begin(0);
	assert.equal(frames.first(first.id), 0);
	queries.end(0);
	frames.intern(demand.topLevelCalls[1].site, second.id, 0, 0, []);
	assert.equal(queries.isCurrent(0), true);
	const frame = frames.intern(demand.topLevelCalls[0].site, first.id, 0, 0, []);
	assert.equal(queries.isCurrent(0), false);
	queries.begin(0);
	assert.equal(frames.first(first.id), frame);
	queries.end(0);
	assert.equal(frames.intern(demand.topLevelCalls[0].site, first.id, 0, 0, []), frame);
	assert.equal(queries.isCurrent(0), true);
});

test('an empty prototype join wakes when the first prototype fact arrives', () => {
	const file = buildLuaFileSemanticData('local prototype = { marker = 11 }\nlocal object = {}', 'prototype.lua');
	const summaries = new FunctionSummaryStore([file], new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() }));
	const demand = new SemanticDemandIndex([file], summaries);
	const instantiation = new SemanticInstantiationQuery(summaries, demand, () => assert.fail('no call in this fixture'));
	const members = new SemanticMemberQuery(summaries, instantiation);
	const queries = new SemanticQueryResults<SymbolID>(summaries.terms.dependencies);
	const object = declarationValueSource(file.decls.find(entry => entry.name === 'object')!.id);
	const prototype = declarationValueSource(file.decls.find(entry => entry.name === 'prototype')!.id);
	const marker = summaries.terms.nameId('marker');
	while (!queries.isCurrent(0)) {
		queries.begin(0);
		const result = queries.buffer(0);
		members.resolveMembers(object, marker, result);
		queries.publish(0, result);
	}
	assert.deepEqual(queries.values(0), []);
	instantiation.prototypes.add(summaries.terms.compileSource(object), summaries.terms.compileSource(prototype));
	assert.equal(queries.isCurrent(0), false);
	while (!queries.isCurrent(0)) {
		queries.begin(0);
		const result = queries.buffer(0);
		members.resolveMembers(object, marker, result);
		queries.publish(0, result);
	}
	assert.deepEqual(queries.values(0), [file.decls.find(entry => entry.name === 'marker')!.id]);
});
