import assert from 'node:assert/strict';
import { SemanticTermStore, type TermID } from '../../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../../toolchain/ts/lua/semantic/identity';
import { SemanticQueryResults } from '../../../toolchain/ts/lua/semantic/query_dependencies';
import { medianMilliseconds } from '../../helpers/performance';

// Public pre-slice entrypoints let the same fixture bundle the baseline owner.
for (const objects of [32, 256]) {
	let evaluations = 0;
	const milliseconds = medianMilliseconds(() => {
		const terms = new SemanticTermStore(
			new WorkspaceValueIdentityIndex({ files: [], globalValues: new Map() }), new Map(), new Map(),
		);
		const queries = new SemanticQueryResults<TermID>(terms.dependencies);
		const names = [terms.nameId('existing'), terms.nameId('later')];
		const bases: TermID[] = [];
		for (let index = 0; index < objects; index += 1) {
			const base = terms.root({ kind: 'global', symbolKey: `object_${index}` });
			bases.push(base);
			terms.member(base, names[0]);
		}
		function read(): void {
			for (let index = 0; index < bases.length; index += 1) {
				for (let name = 0; name < names.length; name += 1) {
					const query = index * names.length + name;
					if (queries.isCurrent(query)) continue;
					queries.begin(query);
					const result = queries.buffer(0);
					const path = terms.retainedMember(bases[index], names[name]);
					if (path !== undefined) result.push(path);
					queries.publish(query, result);
				}
			}
		}
		read();
		for (let name = 0; name < 8; name += 1) {
			const unrelated = terms.nameId(`unrelated_${name}`);
			for (const base of bases) terms.member(base, unrelated);
			read();
		}
		for (let index = 0; index < bases.length; index += 1) {
			assert.deepEqual(queries.values(index * 2 + 1), []);
			terms.member(bases[index], names[1]);
		}
		read();
		for (let index = 0; index < bases.length; index += 1) {
			assert.deepEqual(queries.values(index * 2 + 1), [terms.retainedMember(bases[index], names[1])]);
		}
		evaluations = queries.count;
	});
	console.log(JSON.stringify({ objects, unrelatedFields: 8, milliseconds, evaluations,
		boundary: 'fresh term universe; positive and negative lookups; eight unrelated growth rounds then requested-path creation; no parsing, calls, guest execution or editor frames' }));
}
