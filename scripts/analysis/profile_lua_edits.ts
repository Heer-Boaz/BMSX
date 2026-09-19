// npx tsx --tsconfig tsconfig.base.json scripts/analysis/profile_lua_edits.ts \
//   /tmp/pietious-workspace.json director.lua player/player.lua
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';
import { LuaSyntaxKind, type LuaFunctionExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';

const [dumpPath, ...paths] = process.argv.slice(2);
assert(dumpPath && paths.length, 'Usage: profile_lua_edits.ts workspace.json file.lua [file.lua ...]');
const files: { path: string; source: string }[] = JSON.parse(readFileSync(dumpPath, 'utf8'));
const workspace = new LuaSemanticWorkspace();
workspace.updateFiles(files.map(file => buildLuaFileSemanticData(file.source, file.path)));
const baseline = workspace.getSnapshot();
const warmup = 20;
const samples = 50;

function distribution(values: number[]) {
	values.sort((a, b) => a - b);
	return { p50: values[values.length >> 1], p95: values[Math.trunc(values.length * 0.95)], max: values[values.length - 1] };
}

const results = [];
for (const path of paths) {
	const file = baseline.getFileData(path)!;
	assert(file, `No workspace source: ${path}`);
	assert.equal(file.syntaxError, null, `${path} must start with valid syntax`);
	const tokens = new LuaLexer(file.source, path).scanTokens();
	const identifier = tokens.find(token => token.type === LuaTokenType.Identifier)!;
	const lines = file.source.split('\n');
	const lineOffsets = [0];
	for (let row = 1; row < lines.length; row++) lineOffsets.push(lineOffsets[row - 1] + lines[row - 1].length + 1);
	const identifierOffset = lineOffsets[identifier.line - 1] + identifier.column - 1;
	let editedFunction: LuaFunctionExpression;
	walkLuaAst(file.chunk, node => {
		if (editedFunction !== undefined) return false;
		if (node.kind === LuaSyntaxKind.FunctionExpression && node.body.body.length > 0) {
			editedFunction = node;
			return false;
		}
	});
	assert(editedFunction!, `${path} needs a nonempty function for the body-edit workload`);
	const bodyStart = editedFunction!.body.body[0].range.start;
	const bodyOffset = lineOffsets[bodyStart.line - 1] + bodyStart.column - 1;
	const scenarios = [
		{ name: 'leading-newline', source: '\n' + file.source },
		{ name: 'leading-comment', source: '-- incremental edit benchmark\n' + file.source },
		{ name: 'function-body-statement', source: file.source.slice(0, bodyOffset) + 'do end; ' + file.source.slice(bodyOffset) },
		{
			name: 'rename-first-binding',
			source: file.source.slice(0, identifierOffset) + identifier.lexeme + '_edited'
				+ file.source.slice(identifierOffset + identifier.lexeme.length),
		},
	];

	for (const scenario of scenarios) {
		const measurements = {
			lex: [] as number[], parse: [] as number[], bind: [] as number[],
			publish: [] as number[], firstMember: [] as number[], completionAfterMember: [] as number[],
			total: [] as number[], publicUpdate: [] as number[],
		};
		let query: { name: string; line: number; column: number };
		let targetCount = 0;
		let memberCount = 0;
		for (let iteration = 0; iteration < warmup + samples; iteration++) {
			// Both edit and undo must do real work; never time an unchanged-source hit.
			const source = iteration % 2 === 0 ? scenario.source : file.source;
			const start = performance.now();
			const lexed = new LuaLexer(source, path).scanTokensWithRecovery();
			const lexEnd = performance.now();
			const parsed = new LuaParser(lexed.tokens, path, source).parseChunkWithRecovery();
			const parseEnd = performance.now();
			const analysis = buildLuaFileSemanticData(source, path, {
				chunk: parsed.path, tokens: lexed.tokens, syntaxError: null,
			});
			const bindEnd = performance.now();
			workspace.updateFiles([analysis]);
			const snapshot = workspace.getSnapshot();
			const publishEnd = performance.now();
			const reference = analysis.refs.find(ref => ref.referenceKind === 'method' || ref.referenceKind === 'member')!;
			const queryStart = performance.now();
			targetCount = snapshot.symbolResolver.resolveReferenceTargets(reference).length;
			const queryEnd = performance.now();
			memberCount = snapshot.symbolResolver.getMembers(reference.receiverValue).length;
			const completionEnd = performance.now();
			assert.equal(lexed.syntaxError, null);
			assert.equal(parsed.syntaxError, null);
			query = { name: reference.name, ...reference.range.start };
			if (iteration < warmup) continue;
			measurements.lex.push(lexEnd - start);
			measurements.parse.push(parseEnd - lexEnd);
			measurements.bind.push(bindEnd - parseEnd);
			measurements.publish.push(publishEnd - bindEnd);
			measurements.firstMember.push(queryEnd - queryStart);
			measurements.completionAfterMember.push(completionEnd - queryEnd);
			measurements.total.push(completionEnd - start);
		}
		// Separate pass through the real workspace entrypoint. This is the series
		// that will exercise incremental updates, not the deliberately full phases.
		workspace.updateFile(path, file.source);
		for (let iteration = 0; iteration < warmup + samples; iteration++) {
			const source = iteration % 2 === 0 ? scenario.source : file.source;
			const start = performance.now();
			workspace.updateFile(path, source);
			workspace.getSnapshot();
			const elapsed = performance.now() - start;
			if (iteration >= warmup) measurements.publicUpdate.push(elapsed);
		}
		results.push({ path, edit: scenario.name, query: query!, targetCount, memberCount,
			milliseconds: Object.fromEntries(Object.entries(measurements).map(([phase, values]) => [phase, distribution(values)])),
		});
	}
	workspace.updateFiles([file]);
}

console.log(JSON.stringify({
	node: process.version, cpu: cpus()[0].model, workspaceFiles: files.length, warmup, samples,
	note: 'Full phases and publicUpdate are separate passes. Completion follows the member query; not a cold completion or UI-frame measurement.',
	results,
}, null, 2));
