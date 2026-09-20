// npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_edits.ts \
//   /tmp/pietious-workspace.json director.lua player/player.lua
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { updateLuaTokens } from '../../toolchain/ts/lua/syntax/lexical_update';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';
import { LuaSyntaxKind, type LuaFunctionExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { SourceChangeMap, type SourceTextChange } from '../../toolchain/ts/text/source_changes';

const [dumpPath, ...paths] = process.argv.slice(2);
assert(dumpPath && paths.length, 'Usage: profile_lua_edits.ts workspace.json file.lua [file.lua ...]');
const files: { path: string; source: string }[] = JSON.parse(readFileSync(dumpPath, 'utf8'));
const workspace = new LuaSemanticWorkspace();
workspace.updateFiles(files.map(file => buildLuaFileSemanticData(file.source, file.path)));
const baseline = workspace.getSnapshot();
const warmup = 20;
const samples = 50;

type Scenario = {
	name: string;
	source: string;
	forward: readonly SourceTextChange[];
	undo: readonly SourceTextChange[];
};

function distribution(values: number[]) {
	values.sort((a, b) => a - b);
	return { p50: values[values.length >> 1], p95: values[Math.trunc(values.length * 0.95)], max: values[values.length - 1] };
}

const results = [];
const lexicalWorkloads = [];
for (const path of paths) {
	const file = baseline.getFileData(path)!;
	assert(file, `No workspace source: ${path}`);
	assert.equal(file.syntaxError, null, `${path} must start with valid syntax`);
	const cursor = file.chunk.tokens.cursor();
	while (cursor.token!.type !== LuaTokenType.Identifier) cursor.advance();
	const identifier = cursor.token!;
	const identifierOffset = cursor.offset;
	let editedFunction: LuaFunctionExpression;
	walkLuaAst(file.chunk, node => {
		if (editedFunction !== undefined) return false;
		if (node.kind === LuaSyntaxKind.FunctionExpression && node.body.body.length > 0) {
			editedFunction = node;
			return false;
		}
	});
	assert(editedFunction!, `${path} needs a nonempty function for the body-edit workload`);
	const bodySpan = editedFunction!.body.body[0].span;
	const bodyOffset = file.chunk.locations.offset(bodySpan.unit, bodySpan.start);
	const comment = '-- incremental edit benchmark\n';
	const statement = 'do end; ';
	const renamed = identifier.lexeme + '_edited';
	const scenarios: Scenario[] = [
		{
			name: 'leading-newline', source: '\n' + file.source,
			forward: [{ offset: 0, deletedLength: 0, insertedLength: 1 }],
			undo: [{ offset: 0, deletedLength: 1, insertedLength: 0 }],
		},
		{
			name: 'leading-comment', source: comment + file.source,
			forward: [{ offset: 0, deletedLength: 0, insertedLength: comment.length }],
			undo: [{ offset: 0, deletedLength: comment.length, insertedLength: 0 }],
		},
		{
			name: 'function-body-statement', source: file.source.slice(0, bodyOffset) + statement + file.source.slice(bodyOffset),
			forward: [{ offset: bodyOffset, deletedLength: 0, insertedLength: statement.length }],
			undo: [{ offset: bodyOffset, deletedLength: statement.length, insertedLength: 0 }],
		},
		{
			name: 'rename-first-binding',
			source: file.source.slice(0, identifierOffset) + renamed + file.source.slice(identifierOffset + identifier.lexeme.length),
			forward: [{ offset: identifierOffset, deletedLength: identifier.lexeme.length, insertedLength: renamed.length }],
			undo: [{ offset: identifierOffset, deletedLength: renamed.length, insertedLength: identifier.lexeme.length }],
		},
		{
			name: 'disjoint-leading-and-body',
			source: comment + file.source.slice(0, bodyOffset) + statement + file.source.slice(bodyOffset),
			forward: [
				{ offset: 0, deletedLength: 0, insertedLength: comment.length },
				{ offset: bodyOffset + comment.length, deletedLength: 0, insertedLength: statement.length },
			],
			undo: [
				{ offset: bodyOffset + comment.length, deletedLength: statement.length, insertedLength: 0 },
				{ offset: 0, deletedLength: comment.length, insertedLength: 0 },
			],
		},
	];

	for (const scenario of scenarios) {
		const forward = SourceChangeMap.unchanged(file.source.length).append(scenario.forward);
		const undo = SourceChangeMap.unchanged(scenario.source.length).append(scenario.undo);
		assert.equal(forward.newLength, scenario.source.length);
		assert.equal(undo.newLength, file.source.length);
		const milliseconds: Record<string, ReturnType<typeof distribution> | Record<string, ReturnType<typeof distribution>>> = {};
		let query: { name: string; line: number; column: number };
		let targetCount = 0;
		let memberCount = 0;
		for (const mode of ['fullSourcePhases', 'incrementalLexicalPhases'] as const) {
			workspace.updateFiles([file]);
			let previousTokens = file.chunk.tokens;
			const measurements = {
				lex: [] as number[], parse: [] as number[], bind: [] as number[],
				publish: [] as number[], firstMember: [] as number[], completionAfterMember: [] as number[], total: [] as number[],
			};
			for (let iteration = 0; iteration < warmup + samples; iteration++) {
				// Both edit and undo do real work; never time an unchanged-source hit.
				const source = iteration % 2 === 0 ? scenario.source : file.source;
				const changes = iteration % 2 === 0 ? forward : undo;
				const start = performance.now();
				const tokens = mode === 'fullSourcePhases'
					? new LuaLexer(source, path).scanSequence()
					: updateLuaTokens(previousTokens, source, path, changes);
				const lexEnd = performance.now();
				const parsed = new LuaParser(tokens, path, source).parseChunkWithRecovery();
				const parseEnd = performance.now();
				const analysis = buildLuaFileSemanticData(source, path, {
					chunk: parsed.path, tokens, syntaxError: parsed.syntaxError,
				});
				const bindEnd = performance.now();
				workspace.updateFiles([analysis]);
				const snapshot = workspace.getSnapshot();
				const publishEnd = performance.now();
				const reference = analysis.refs.find(ref => ref.receiverValue !== undefined
					&& (ref.referenceKind === 'method' || ref.referenceKind === 'member'))!;
				const queryStart = performance.now();
				targetCount = snapshot.symbolResolver.resolveReferenceTargets(reference).length;
				const queryEnd = performance.now();
				memberCount = snapshot.symbolResolver.getMembers(reference.receiverValue).length;
				const completionEnd = performance.now();
				assert.equal(parsed.syntaxError, null);
				query = { name: reference.name, ...reference.range.start };
				previousTokens = tokens;
				if (iteration < warmup) continue;
				measurements.lex.push(lexEnd - start);
				measurements.parse.push(parseEnd - lexEnd);
				measurements.bind.push(bindEnd - parseEnd);
				measurements.publish.push(publishEnd - bindEnd);
				measurements.firstMember.push(queryEnd - queryStart);
				measurements.completionAfterMember.push(completionEnd - queryEnd);
				measurements.total.push(completionEnd - start);
			}
			milliseconds[mode] = Object.fromEntries(Object.entries(measurements).map(([phase, values]) => [phase, distribution(values)]));
		}
		// Independent real-entrypoint passes. Omitting the optional input requests
		// full-source analysis; the map-input pass exercises incremental publication.
		for (const mode of ['publicFullSourceUpdate', 'publicComposedChangesUpdate'] as const) {
			workspace.updateFiles([file]);
			const measurements: number[] = [];
			for (let iteration = 0; iteration < warmup + samples; iteration++) {
				const source = iteration % 2 === 0 ? scenario.source : file.source;
				const changes = iteration % 2 === 0 ? forward : undo;
				const start = performance.now();
				const analysis = mode === 'publicFullSourceUpdate'
					? workspace.updateFile(path, source)
					: workspace.updateFile(path, source, changes);
				workspace.getSnapshot();
				const elapsed = performance.now() - start;
				assert.equal(analysis.syntaxError, null);
				if (iteration >= warmup) measurements.push(elapsed);
			}
			milliseconds[mode] = distribution(measurements);
		}
		results.push({ path, edit: scenario.name, query: query!, targetCount, memberCount, milliseconds });
		lexicalWorkloads.push({ path, file, scenario, forward, undo });
	}
	workspace.updateFiles([file]);
}

// Instrument only after every timed pass: patching the scanner must not change
// optimized callsites or count work inside the measurements above.
const scanBlock = LuaLexer.prototype.scanBlock;
let scannedBlocks = 0, scannedItems = 0, scannedWidth = 0;
const lexicalWork = [];
LuaLexer.prototype.scanBlock = function (untilOffset?: number) {
	const block = scanBlock.call(this, untilOffset);
	scannedBlocks++;
	scannedItems += block.items.length;
	for (const item of block.items) scannedWidth += item.width;
	return block;
};
for (const { path, file, scenario, forward, undo } of lexicalWorkloads) {
	let previousTokens = file.chunk.tokens;
	for (const direction of ['forward', 'undo'] as const) {
		const source = direction === 'forward' ? scenario.source : file.source;
		const changes = direction === 'forward' ? forward : undo;
		for (const mode of ['fullSource', 'incrementalLexical'] as const) {
			scannedBlocks = scannedItems = scannedWidth = 0;
			const tokens = mode === 'fullSource'
				? new LuaLexer(source, path).scanSequence()
				: updateLuaTokens(previousTokens, source, path, changes);
			lexicalWork.push({ path, edit: scenario.name, direction, mode, scannedBlocks, scannedItems, scannedWidth });
			if (mode === 'incrementalLexical') previousTokens = tokens;
		}
	}
}

console.log(JSON.stringify({
	node: process.version, cpu: cpus()[0].model, workspaceFiles: files.length, warmup, samples,
	note: 'Full-source phases, incremental-lexical phases and both public updates are separate warm passes. Parsing and binding remain whole-file. Public timings include getSnapshot, not queries. Maps are composed from known forward/undo deltas outside timing. Completion follows the member query; not a cold completion or UI-frame measurement. Lexical work counts are a separate untimed forward/undo pass after all timings; scannedWidth counts consumed UTF-16 units, not lookahead reads.',
	results, lexicalWork,
}, null, 2));
