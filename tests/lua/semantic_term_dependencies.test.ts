import assert from 'node:assert/strict';
import test from 'node:test';
import { SemanticTermStore, type FunctionSummaryID, type TermID } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { SemanticDependencyPairIndex, SemanticQueryDependencies, SemanticQueryEvaluation } from '../../toolchain/ts/lua/semantic/query_dependencies';
import { TermRelation } from '../../toolchain/ts/lua/semantic/term_relation';

function createTerms(): SemanticTermStore {
	return new SemanticTermStore(
		new WorkspaceValueIdentityIndex({ files: [], globalValues: new Map() }), new Map(), new Map(),
	);
}

test('contextual templates retain the complete access path and both indexed operands', () => {
	const terms = createTerms();
	const owner = terms.local(1 as FunctionSummaryID, 0);
	const key = terms.parameter(1 as FunctionSummaryID, 0);
	const boundOwner = terms.contextRoot(owner, 7);
	const boundKey = terms.contextRoot(key, 9);
	const name = terms.nameId('run');
	const templates = [terms.member(owner, name), terms.index(owner, key), terms.element(owner),
		terms.call(owner), terms.instance(owner), terms.metatable(owner)];
	const bound = [terms.member(boundOwner, name), terms.index(boundOwner, boundKey), terms.element(boundOwner),
		terms.call(boundOwner), terms.instance(boundOwner), terms.metatable(boundOwner)];
	for (let index = 0; index < templates.length; index += 1) assert.equal(terms.retainedTemplate(bound[index]), templates[index]);
	assert.equal(terms.retainedTemplate(owner), owner);
	assert.equal(terms.retainedTemplate(boundOwner), owner);
	const nested = terms.member(terms.index(owner, key), name);
	assert.equal(terms.retainedTemplate(terms.member(terms.index(boundOwner, boundKey), name)), nested);
});

test('template lookup does not create unwritten paths and observes their subsequent creation', () => {
	const terms = createTerms();
	const owner = terms.local(1 as FunctionSummaryID, 0);
	const name = terms.nameId('not_written');
	const bound = terms.member(terms.contextRoot(owner, 7), name);
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	queries.begin(0);
	assert.equal(terms.retainedTemplate(bound), undefined);
	assert.equal(terms.retainedMember(owner, name), undefined);
	queries.end(0);
	terms.member(owner, terms.nameId('different'));
	assert.ok(queries.isCurrent(0));
	const written = terms.member(owner, name);
	assert.equal(queries.isCurrent(0), false);
	assert.equal(terms.retainedTemplate(bound), written);
});

test('pair-index reads depend on both coordinates, including an absent row', () => {
	const dependencies = new SemanticQueryDependencies();
	const index = new SemanticDependencyPairIndex(dependencies);
	const queries = new SemanticQueryEvaluation(dependencies);
	queries.begin(0);
	index.read(11, 22);
	queries.end(0);
	index.changed(11, 23);
	index.changed(12, 22);
	index.changed(22, 11);
	assert.equal(queries.isCurrent(0), true);
	index.changed(11, 22);
	assert.equal(queries.isCurrent(0), false);
	queries.begin(0);
	index.read(11, 22);
	queries.end(0);
	index.changed(11, 22);
	assert.equal(queries.isCurrent(0), false, 'a growing fact row is not an immutable identity');
});

test('access-path misses wake only for their own kind, base and operand', () => {
	const terms = createTerms();
	const template = terms.root({ kind: 'global', symbolKey: 'template' });
	const base = terms.root({ kind: 'global', symbolKey: 'base' });
	const key = terms.root({ kind: 'literal', literal: { kind: 'number', value: 7 } });
	const otherKey = terms.root({ kind: 'literal', literal: { kind: 'number', value: 8 } });
	const name = terms.nameId('member');
	const create: ((base: TermID) => TermID)[] = [
		base => terms.member(base, name),
		base => terms.index(base, key),
		base => terms.element(base),
		base => terms.call(base),
		base => terms.instance(base),
		base => terms.metatable(base),
	];
	const templates = create.map(path => path(template));
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	for (let index = 0; index < templates.length; index += 1) {
		queries.begin(index);
		assert.equal(terms.retainedAccessWithBase(templates[index], base), undefined);
		queries.end(index);
	}
	terms.member(base, terms.nameId('unrelated'));
	terms.index(base, otherKey);
	for (let index = 0; index < templates.length; index += 1) assert.equal(queries.isCurrent(index), true);
	for (let index = 0; index < templates.length; index += 1) {
		const path = create[index](base);
		for (let query = 0; query < templates.length; query += 1) {
			assert.equal(queries.isCurrent(query), query !== index, `creating path ${index} affects query ${query}`);
		}
		queries.begin(index);
		assert.equal(terms.retainedAccessWithBase(templates[index], base), path);
		queries.end(index);
	}
	assert.equal(queries.count, templates.length * 2);
});

test('existing interned access identities need no dependency on further paths', () => {
	const terms = createTerms();
	const base = terms.root({ kind: 'global', symbolKey: 'base' });
	const key = terms.root({ kind: 'literal', literal: { kind: 'number', value: 7 } });
	const paths = [terms.member(base, terms.nameId('fixed')), terms.index(base, key),
		terms.element(base), terms.call(base), terms.instance(base), terms.metatable(base)];
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	queries.begin(0);
	for (const path of paths) assert.equal(terms.retainedAccessWithBase(path, base), path);
	queries.end(0);
	terms.member(base, terms.nameId('new_field'));
	terms.index(base, terms.root({ kind: 'literal', literal: { kind: 'number', value: 8 } }));
	assert.equal(queries.isCurrent(0), true);
});

test('an indexed-path collection remains dependent on later indices but not other path kinds', () => {
	const terms = createTerms();
	const base = terms.root({ kind: 'global', symbolKey: 'base' });
	const firstKey = terms.root({ kind: 'literal', literal: { kind: 'number', value: 7 } });
	const secondKey = terms.root({ kind: 'literal', literal: { kind: 'number', value: 8 } });
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	queries.begin(0);
	assert.deepEqual(terms.indices(base), []);
	queries.end(0);
	terms.member(base, terms.nameId('unrelated'));
	terms.element(base);
	assert.equal(queries.isCurrent(0), true);
	const first = terms.index(base, firstKey);
	assert.equal(queries.isCurrent(0), false);
	queries.begin(0);
	assert.deepEqual(terms.indices(base), [first]);
	queries.end(0);
	const second = terms.index(base, secondKey);
	assert.equal(queries.isCurrent(0), false);
	assert.deepEqual(terms.indices(base), [first, second]);
});

test('unknown index keys follow element-path creation, not concrete indices', () => {
	const terms = createTerms();
	const base = terms.root({ kind: 'global', symbolKey: 'base' });
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	queries.begin(0);
	assert.equal(terms.retainedIndex(base, terms.unknown()), undefined);
	queries.end(0);
	terms.index(base, terms.root({ kind: 'literal', literal: { kind: 'number', value: 7 } }));
	assert.equal(queries.isCurrent(0), true);
	const element = terms.index(base, terms.unknown());
	assert.equal(queries.isCurrent(0), false);
	queries.begin(0);
	assert.equal(terms.retainedIndex(base, terms.unknown()), element);
	queries.end(0);
	terms.instance(base);
	assert.equal(queries.isCurrent(0), true);
});

test('a fixed access identity still reads changes to its growing value relation', () => {
	const terms = createTerms();
	const base = terms.root({ kind: 'global', symbolKey: 'base' });
	const name = terms.nameId('field');
	const member = terms.member(base, name);
	const first = terms.root({ kind: 'global', symbolKey: 'first' });
	const second = terms.root({ kind: 'global', symbolKey: 'second' });
	const values = new TermRelation(terms.dependencies);
	values.add(member, first);
	const queries = new SemanticQueryEvaluation(terms.dependencies);
	queries.begin(0);
	const path = terms.retainedMember(base, name)!;
	assert.equal(values.target(values.first(path)), first);
	queries.end(0);
	terms.member(base, terms.nameId('unrelated'));
	assert.equal(queries.isCurrent(0), true);
	values.add(member, second);
	assert.equal(queries.isCurrent(0), false);
});

test('relation emptiness settles once while exact extent and row reads keep changing', () => {
	const dependencies = new SemanticQueryDependencies();
	const relation = new TermRelation(dependencies);
	const queries = new SemanticQueryEvaluation(dependencies);
	queries.begin(0);
	assert.equal(relation.empty, true);
	queries.end(0);
	queries.begin(1);
	assert.equal(relation.count, 0);
	queries.end(1);
	relation.add(11 as TermID, 22 as TermID);
	assert.equal(queries.isCurrent(0), false);
	assert.equal(queries.isCurrent(1), false);
	queries.begin(0);
	assert.equal(relation.empty, false);
	queries.end(0);
	queries.begin(1);
	assert.equal(relation.count, 1);
	queries.end(1);
	queries.begin(2);
	assert.equal(relation.target(relation.first(11 as TermID)), 22);
	queries.end(2);
	relation.add(11 as TermID, 23 as TermID);
	assert.equal(queries.isCurrent(0), true);
	assert.equal(queries.isCurrent(1), false);
	assert.equal(queries.isCurrent(2), false);
	assert.equal(relation.count, 2);
});
