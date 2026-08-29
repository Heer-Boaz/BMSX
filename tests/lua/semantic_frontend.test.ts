import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLuaSemanticFrontend, type LuaSemanticFrontendFile, type LuaSemanticNavigationTarget } from '../../toolchain/ts/lua/semantic/frontend';
import { createLuaSemanticFrontendFromSnapshot } from '../../ide/editor/contrib/intellisense/semantic/workspace/index';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

test('LuaSemanticFrontend rejects host-published machine word globals', () => {
	const source = 'return sys_boot_cart, sys_vdp_stream_base, cart_manifest';
	const frontend = buildLuaSemanticFrontend([{ path: 'globals.lua', source }]);
	const diagnostics = frontend.getFile('globals.lua').diagnostics;
	assert.equal(diagnostics.length, 3);
	assert.equal(diagnostics[0].message, `'sys_boot_cart' is not defined.`);
	assert.equal(diagnostics[1].message, `'sys_vdp_stream_base' is not defined.`);
	assert.equal(diagnostics[2].message, `'cart_manifest' is not defined.`);
});

test('LuaSemanticFrontend rejects machine word value constants as implicit runtime globals', () => {
	const source = 'return sys_bus_fault_access_word, irq_vblank, sys_irq_flags, sys_irq_ack, sys_irq_mask';
	const frontend = buildLuaSemanticFrontend([{ path: 'abi_constant.lua', source }]);
	const diagnostics = frontend.getFile('abi_constant.lua').diagnostics;
	assert.equal(diagnostics.length, 5);
	assert.equal(diagnostics[0].message, `'sys_bus_fault_access_word' is not defined.`);
	assert.equal(diagnostics[1].message, `'irq_vblank' is not defined.`);
	assert.equal(diagnostics[2].message, `'sys_irq_flags' is not defined.`);
	assert.equal(diagnostics[3].message, `'sys_irq_ack' is not defined.`);
	assert.equal(diagnostics[4].message, `'sys_irq_mask' is not defined.`);
});

test('LuaSemanticFrontend preserves shadowed locals instead of retargeting them to outer const bindings', () => {
	const source = [
		'local outer<const> = 1',
		'local function read_shadow()',
		'\tlocal outer = 2',
		'\touter = outer + 1',
		'\treturn outer',
		'end',
		'return read_shadow()',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'shadow.lua', source }]);
	assert.deepEqual(frontend.getFile('shadow.lua').diagnostics, []);
});

test('LuaSemanticFrontend follows compiler scoping for recursive const closures', () => {
	const source = [
		'local recurse<const> = function(value)',
		'\tif value == 0 then',
		'\t\treturn value',
		'\tend',
		'\treturn recurse(value - 1)',
		'end',
		'return recurse(2)',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'recursive_const.lua', source }]);
	const recursiveCall = findPosition(source, '\treturn recurse', 'recurse');
	const target = firstNavigationTarget(frontend.getFile('recursive_const.lua'),
		recursiveCall.line,
		recursiveCall.column,
	);

	assert.deepEqual(frontend.getFile('recursive_const.lua').diagnostics, []);
	assert.deepEqual(target.range, {
		path: 'recursive_const.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 13 },
	});
});

test('LuaSemanticFrontend allows direct indexed memory-map access', () => {
	const source = [
		'local base = 0',
		'return mem[base], mem8[base], mem32le[base], memf32le[base]',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'mem.lua', source }]);
	assert.deepEqual(frontend.getFile('mem.lua').diagnostics, []);
});

test('LuaSemanticFrontend does not flag member access on call results as undefined globals', () => {
	const source = [
		'local state = { nested = { transition_guards = 1 } }',
		'function state:get_nested()',
		'\treturn self.nested',
		'end',
		'return state:get_nested().transition_guards',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'members.lua', source }]);
	assert.deepEqual(frontend.getFile('members.lua').diagnostics, []);
});

test('LuaSemanticFrontend returns every valid definition target', () => {
	const source = [
		'local left<const> = {}',
		'function left:run() end',
		'local right<const> = {}',
		'function right:run() end',
		'local selected<const> = left or right',
		'left:run()',
		'right:run()',
		'selected:run()',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'alternatives.lua', source }]);
	const position = findPosition(source, 'selected:run()', 'run');
	const navigation = frontend.getFile('alternatives.lua').findNavigationAt(
		position.line,
		position.column,
	);
	assert.ok(navigation);
	assert.equal(navigation.label, 'selected:run');
	assert.deepEqual(navigation.origin, {
		path: 'alternatives.lua',
		start: position,
		end: { line: position.line, column: position.column + 2 },
	});

	assert.deepEqual(
		navigation.targets.map((target) => target.range.start.line),
		[2, 4],
	);
	const references = frontend.findReferencesByPosition(
		'alternatives.lua',
		position.line,
		position.column,
	);
	assert.ok(references);
	assert.equal(references.label, 'selected:run');
	assert.deepEqual(
		references.targets.map(target => target.declaration.range.start.line),
		[2, 4],
	);
	assert.deepEqual(
		references.references.map(reference => reference.range.start.line),
		[6, 7, 8],
	);
});

test('LuaSemanticFrontend treats implicit global writes inside nested scopes as globals', () => {
	const source = [
		'local vdp_stream_base<const> = 0',
		'while true do',
		'\tvdp_stream_cursor = vdp_stream_base',
		'\tlocal used_bytes<const> = vdp_stream_cursor - vdp_stream_base',
		'\tbreak',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'globalscope.lua', source }]);
	assert.deepEqual(frontend.getFile('globalscope.lua').diagnostics, []);
});

test('LuaSemanticFrontend binds declarations and references to retained syntax identity', () => {
	const source = 'value = 1';
	const path = 'syntax_identity.lua';
	const retainedChunk = parseLuaChunk(source, path).chunk;
	const frontend = buildLuaSemanticFrontend([{ path, source, chunk: retainedChunk }]);
	const assignment = retainedChunk.body[0];
	assert.equal(assignment.kind, LuaSyntaxKind.AssignmentStatement);
	const identifier = assignment.left[0];
	assert.equal(identifier.kind, LuaSyntaxKind.IdentifierExpression);

	const file = frontend.getFile(path);
	const declaration = file.getDeclaration(identifier);
	const reference = file.getReference(identifier);
	assert.ok(declaration);
	assert.ok(reference);
	assert.equal(reference.ref.target, declaration.id);
	assert.equal(reference.ref.isWrite, true);

	const reparsedAssignment = parseLuaChunk(source, path).chunk.body[0];
	assert.equal(reparsedAssignment.kind, LuaSyntaxKind.AssignmentStatement);
	const reparsedIdentifier = reparsedAssignment.left[0];
	assert.equal(reparsedIdentifier.kind, LuaSyntaxKind.IdentifierExpression);
	assert.equal(file.getDeclaration(reparsedIdentifier), undefined);
	assert.equal(file.getReference(reparsedIdentifier), undefined);
});

test('LuaSemanticFrontend allows omitted trailing optional arguments for user functions', () => {
	const source = [
		'local function add(a, b, c)',
		'\tif c then',
		'\t\treturn a + b + c',
		'\tend',
		'\treturn a + b',
		'end',
		'return add(1, 2)',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'optional_args.lua', source }]);
	assert.deepEqual(frontend.getFile('optional_args.lua').diagnostics, []);
});

test('LuaSemanticFrontend binds method self independently of out-of-scope sibling locals', () => {
	const source = [
		'local t = {}',
		'function t.new()',
		'\tlocal self<const> = {}',
		'\treturn self',
		'end',
		'function t:add_space(space_id)',
		'\treturn self',
		'end',
	].join('\n');
	const parsed = parseLuaChunk(source, 'method_self.lua');
	const frontend = buildLuaSemanticFrontend([{ path: 'method_self.lua', source, parsed }]);
	const file = frontend.getFile('method_self.lua');
	const method = parsed.chunk.body[2];
	assert.equal(method.kind, LuaSyntaxKind.FunctionDeclarationStatement);
	const returnStatement = method.functionExpression.body.body[0];
	assert.equal(returnStatement.kind, LuaSyntaxKind.ReturnStatement);
	const self = returnStatement.expressions[0];
	assert.equal(self.kind, LuaSyntaxKind.IdentifierExpression);
	const ref = file.getReference(self);
	assert.ok(ref);
	assert.equal(ref.kind, 'implicit_self');
	assert.deepEqual(file.diagnostics, []);
});

test('LuaSemanticFrontend does not treat self as an ambient global outside methods', () => {
	const frontend = buildLuaSemanticFrontend([{ path: 'plain_self.lua', source: 'return self' }]);
	const diagnostics = frontend.getFile('plain_self.lua').diagnostics;
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].message, `'self' is not defined.`);
});

test('LuaSemanticFrontend resolves navigation targets by lexical scope instead of first textual occurrence', () => {
	const source = [
		'local value = 1',
		'local function outer()',
		'\tlocal value = 2',
		'\treturn value',
		'end',
		'return value',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'scope.lua', source }]);
	const file = frontend.getFile('scope.lua');
	const innerPosition = findPosition(source, '\treturn value', 'value');
	const innerTarget = firstNavigationTarget(file, innerPosition.line, innerPosition.column);
	assert.deepEqual(innerTarget.range, {
		path: 'scope.lua',
		start: { line: 3, column: 8 },
		end: { line: 3, column: 12 },
	});
	const outerTarget = firstNavigationTarget(file, 6, 8);
	assert.deepEqual(outerTarget.range, {
		path: 'scope.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 11 },
	});
});

test('LuaSemanticFrontend keeps table field definitions out of unqualified storage references', () => {
	const source = [
		'bss counter: word',
		'return { counter = counter }',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'storage.lua', source }]);
	const file = frontend.getFile('storage.lua');
	const keyTarget = firstNavigationTarget(file, 2, 10);
	assert.deepEqual(keyTarget.range, {
		path: 'storage.lua',
		start: { line: 2, column: 10 },
		end: { line: 2, column: 16 },
	});
	const valueTarget = firstNavigationTarget(file, 2, 20);
	assert.deepEqual(valueTarget.range, {
		path: 'storage.lua',
		start: { line: 1, column: 5 },
		end: { line: 1, column: 11 },
	});
});

test('LuaSemanticFrontend keeps ordinary strings and comments out of identifier navigation', () => {
	const source = [
		'local target = 1',
		'-- target',
		'local text = "target"',
		'return target',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'literals.lua', source }]);
	const file = frontend.getFile('literals.lua');
	const commentPosition = findPosition(source, '-- target', 'target');
	const stringPosition = findPosition(source, 'local text = "target"', 'target');
	const livePosition = findPosition(source, 'return target', 'target');
	assert.equal(file.findNavigationAt(commentPosition.line, commentPosition.column), null);
	assert.equal(file.findNavigationAt(stringPosition.line, stringPosition.column), null);
	const liveTarget = firstNavigationTarget(file, livePosition.line, livePosition.column);
	assert.deepEqual(liveTarget.range, {
		path: 'literals.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 12 },
	});
});

test('LuaSemanticFrontend resolves require strings to their target module files', () => {
	const entrySource = [
		'local util<const> = require("lib/util")',
		'return util',
	].join('\n');
	const utilSource = [
		'local m = {}',
		'return m',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([
		{ path: 'main.lua', source: entrySource },
		{ path: 'lib/util.lua', source: utilSource },
	]);
	const file = frontend.getFile('main.lua');
	const requirePosition = findPosition(entrySource, 'require("lib/util")', 'lib/util');
	const navigation = file.findNavigationAt(requirePosition.line, requirePosition.column);
	assert.ok(navigation);
	assert.equal(navigation.label, 'lib/util');
	assert.deepEqual(navigation.origin, {
		path: 'main.lua',
		start: { line: requirePosition.line, column: requirePosition.column - 1 },
		end: { line: requirePosition.line, column: requirePosition.column + 'lib/util'.length },
	});
	assert.equal(navigation.targets.length, 1);
	const target = navigation.targets[0];
	assert.deepEqual(target, {
		kind: 'require_module',
		moduleName: 'lib/util',
		range: {
			path: 'lib/util.lua',
			start: { line: 1, column: 1 },
			end: { line: 2, column: 9 },
		},
	});
});

test('LuaSemanticFrontend can build from immutable analysis snapshots without reparsing source state', () => {
	const workspace = new LuaSemanticWorkspace();
	const mainSource = [
		'local util<const> = require("lib/util")',
		'return util.answer',
	].join('\n');
	const utilSource = [
		'local m = { answer = 42 }',
		'return m',
	].join('\n');
	workspace.updateFile('main.lua', mainSource);
	workspace.updateFile('lib/util.lua', utilSource);

	const frontend = buildLuaSemanticFrontend([
		{ path: 'main.lua', source: mainSource, analysis: workspace.getFileData('main.lua') },
		{ path: 'lib/util.lua', source: utilSource, analysis: workspace.getFileData('lib/util.lua') },
	]);
	const requirePosition = findPosition(mainSource, 'require("lib/util")', 'lib/util');
	const target = firstNavigationTarget(frontend.getFile('main.lua'), requirePosition.line, requirePosition.column);
	assert.deepEqual(target, {
		kind: 'require_module',
		moduleName: 'lib/util',
		range: {
			path: 'lib/util.lua',
			start: { line: 1, column: 1 },
			end: { line: 2, column: 9 },
		},
	});
});

test('workspace semantic frontends are cached per version and remain immutable across updates', () => {
	const workspace = new LuaSemanticWorkspace();
	const initialSource = [
		'local value = 1',
		'return value',
	].join('\n');
	workspace.updateFile('main.lua', initialSource);
	const firstSnapshot = workspace.getSnapshot();
	const first = createLuaSemanticFrontendFromSnapshot(firstSnapshot);
	const firstAgain = createLuaSemanticFrontendFromSnapshot(firstSnapshot);
	assert.equal(first.snapshot, firstSnapshot, 'frontend retains the prepared workspace program');
	assert.equal(first, firstAgain);
	workspace.updateFile('main.lua', initialSource);
	assert.equal(workspace.getSnapshot(), firstSnapshot, 'unchanged source retains the program generation');
	const oldTarget = firstNavigationTarget(first.getFile('main.lua'), 2, 8);
	assert.ok(oldTarget);
	assert.deepEqual(oldTarget.range, {
		path: 'main.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 11 },
	});

	workspace.updateFile('main.lua', [
		'local answer = 1',
		'return answer',
	].join('\n'));
	const second = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	assert.notEqual(first, second);
	const preservedTarget = firstNavigationTarget(first.getFile('main.lua'), 2, 8);
	const updatedTarget = firstNavigationTarget(second.getFile('main.lua'), 2, 8);
	assert.ok(preservedTarget);
	assert.deepEqual(preservedTarget.range, {
		path: 'main.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 11 },
	});
	assert.ok(updatedTarget);
	assert.deepEqual(updatedTarget.range, {
		path: 'main.lua',
		start: { line: 1, column: 7 },
		end: { line: 1, column: 12 },
	});
});

test('workspace semantic frontend cache follows retained environment identity', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', 'return host_value');
	const snapshot = workspace.getSnapshot();
	const environment = { extraGlobalNames: ['host_value'] };
	const first = createLuaSemanticFrontendFromSnapshot(snapshot, environment);
	assert.equal(createLuaSemanticFrontendFromSnapshot(snapshot, environment), first);
	assert.notEqual(
		createLuaSemanticFrontendFromSnapshot(snapshot, { extraGlobalNames: ['host_value'] }),
		first,
	);
});

test('workspace publishes immutable semantic snapshots per version', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', [
		'local value = 1',
		'return value',
	].join('\n'));

	const firstSnapshot = workspace.getSnapshot();
	const firstData = firstSnapshot.getFileData('main.lua');
	assert.equal(firstSnapshot.files.length, 1);
	assert.equal(firstSnapshot.files[0], firstData, 'program stores the semantic file record itself');
	assert.equal(firstData.source, [
		'local value = 1',
		'return value',
	].join('\n'));

	workspace.updateFile('main.lua', [
		'local answer = 1',
		'return answer',
	].join('\n'));

	const secondSnapshot = workspace.getSnapshot();
	assert.notEqual(firstSnapshot, secondSnapshot);
	assert.equal(firstSnapshot.getFileData('main.lua'), firstData);
	assert.equal(firstSnapshot.getFileData('main.lua').source, [
		'local value = 1',
		'return value',
	].join('\n'));
	assert.equal(secondSnapshot.getFileData('main.lua').source, [
		'local answer = 1',
		'return answer',
	].join('\n'));
});

test('workspace resolves global receiver members per immutable snapshot without republishing unchanged files', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('globals.lua', [
		'hero = {}',
		'function hero.walk()',
		'\treturn 1',
		'end',
	].join('\n'));
	workspace.updateFile('usage.lua', 'return hero.walk');

	const usageData = workspace.getFileData('usage.lua');
	const firstSnapshot = workspace.getSnapshot();
	const first = createLuaSemanticFrontendFromSnapshot(firstSnapshot);
	const firstTarget = firstNavigationTarget(first.getFile('usage.lua'), 1, 13);
	assert.ok(firstTarget);
	assert.deepEqual(firstTarget.range, {
		path: 'globals.lua',
		start: { line: 2, column: 15 },
		end: { line: 2, column: 18 },
	});

	workspace.updateFile('globals.lua', [
		'hero = {}',
		'function hero.run()',
		'\treturn 1',
		'end',
	].join('\n'));

	const secondSnapshot = workspace.getSnapshot();
	const second = createLuaSemanticFrontendFromSnapshot(secondSnapshot);
	assert.equal(workspace.getFileData('usage.lua'), usageData, 'unchanged file analysis is retained');
	assert.equal(secondSnapshot.files[1], usageData, 'new program retains the unchanged file record identity');
	assert.equal(first.snapshot, firstSnapshot);
	assert.equal(second.snapshot, secondSnapshot);
	const preservedTarget = firstNavigationTarget(first.getFile('usage.lua'), 1, 13);
	const updatedTarget = firstNavigationTarget(second.getFile('usage.lua'), 1, 13);
	assert.ok(preservedTarget);
	assert.deepEqual(preservedTarget.range, {
		path: 'globals.lua',
		start: { line: 2, column: 15 },
		end: { line: 2, column: 18 },
	});
	assert.equal(updatedTarget, null);
});

test('workspace rebinds direct global lookups immutably across updates', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('globals.lua', 'hero = 1');
	workspace.updateFile('usage.lua', 'return hero');

	const first = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	const firstTarget = firstNavigationTarget(first.getFile('usage.lua'), 1, 8);
	assert.ok(firstTarget);
	assert.deepEqual(firstTarget.range, {
		path: 'globals.lua',
		start: { line: 1, column: 1 },
		end: { line: 1, column: 4 },
	});

	workspace.updateFile('globals.lua', 'villain = 1');

	const second = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot());
	const preservedTarget = firstNavigationTarget(first.getFile('usage.lua'), 1, 8);
	const updatedTarget = firstNavigationTarget(second.getFile('usage.lua'), 1, 8);
	assert.ok(preservedTarget);
	assert.deepEqual(preservedTarget.range, {
		path: 'globals.lua',
		start: { line: 1, column: 1 },
		end: { line: 1, column: 4 },
	});
	assert.equal(updatedTarget, null);
});

test('LuaSemanticFrontend provides one incoming-call layer and groups call sites by caller', () => {
	const source = [
		'local function target() end',
		'local function direct()',
		'\ttarget()',
		'\ttarget()',
		'end',
		'local function indirect()',
		'\tdirect()',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'calls.lua', source }]);
	const targetPosition = findPosition(source, 'local function target', 'target');
	const target = frontend.findSymbolsByPosition('calls.lua', targetPosition.line, targetPosition.column);
	assert.ok(target);

	const directCalls = frontend.provideIncomingCalls(target.targets[0].id);
	assert.equal(directCalls.length, 1);
	assert.equal(directCalls[0].from.kind, 'symbol');
	assert.equal(directCalls[0].from.label, 'direct');
	assert.deepEqual(
		directCalls[0].fromRanges.map(range => range.start.line),
		[3, 4],
	);
	if (directCalls[0].from.kind !== 'symbol') {
		assert.fail('direct caller must resolve to its function declaration');
	}

	const indirectCalls = frontend.provideIncomingCalls(directCalls[0].from.symbolId);
	assert.equal(indirectCalls.length, 1);
	assert.equal(indirectCalls[0].from.label, 'indirect');
	assert.deepEqual(
		indirectCalls[0].fromRanges.map(range => range.start.line),
		[7],
	);
});

test('LuaSemanticFrontend retains recursive calls as incoming call sites', () => {
	const source = [
		'local function recurse(value)',
		'\tif value > 0 then',
		'\t\treturn recurse(value - 1)',
		'\tend',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'recursive_calls.lua', source }]);
	const target = frontend.findSymbolsByPosition('recursive_calls.lua', 1, 16);
	assert.ok(target);

	const calls = frontend.provideIncomingCalls(target.targets[0].id);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].from.label, 'recurse');
	assert.equal(calls[0].fromRanges[0].start.line, 3);
});

test('LuaSemanticFrontend classifies member and method calls at the reference producer', () => {
	const source = [
		'local target = {}',
		'function target.member() end',
		'function target:method() end',
		'local function caller()',
		'\tlocal member = target.member',
		'\ttarget.member()',
		'\ttarget:method()',
		'end',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'member_calls.lua', source }]);
	const memberPosition = findPosition(source, 'function target.member', 'member');
	const methodPosition = findPosition(source, 'function target:method', 'method');
	const member = frontend.findSymbolsByPosition('member_calls.lua', memberPosition.line, memberPosition.column);
	const method = frontend.findSymbolsByPosition('member_calls.lua', methodPosition.line, methodPosition.column);
	assert.ok(member);
	assert.ok(method);

	const memberCalls = frontend.provideIncomingCalls(member.targets[0].id);
	const methodCalls = frontend.provideIncomingCalls(method.targets[0].id);
	assert.equal(memberCalls.length, 1);
	assert.equal(methodCalls.length, 1);
	assert.equal(memberCalls[0].from.label, 'caller');
	assert.equal(methodCalls[0].from.label, 'caller');
	assert.deepEqual(memberCalls[0].fromRanges.map(range => range.start.line), [6]);
	assert.deepEqual(methodCalls[0].fromRanges.map(range => range.start.line), [7]);

	const memberCallPosition = findPosition(source, '\ttarget.member()', 'member');
	const methodCallPosition = findPosition(source, '\ttarget:method()', 'method');
	assert.equal(
		frontend.findSymbolsByPosition('member_calls.lua', memberCallPosition.line, memberCallPosition.column)?.label,
		'target.member',
	);
	assert.equal(
		frontend.findSymbolsByPosition('member_calls.lua', methodCallPosition.line, methodCallPosition.column)?.label,
		'target:method',
	);
});

function firstNavigationTarget(
	file: LuaSemanticFrontendFile,
	line: number,
	column: number,
): LuaSemanticNavigationTarget | null {
	const navigation = file.findNavigationAt(line, column);
	if (!navigation) {
		return null;
	}
	assert.ok(navigation.targets.length <= 1, 'expected at most one navigation target');
	return navigation.targets[0];
}

function findPosition(source: string, lineFragment: string, needle: string): { line: number; column: number } {
	const lines = source.split('\n');
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const fragmentIndex = line.indexOf(lineFragment);
		if (fragmentIndex === -1) {
			continue;
		}
		const needleIndex = line.indexOf(needle, fragmentIndex);
		if (needleIndex === -1) {
			break;
		}
		return {
			line: lineIndex + 1,
			column: needleIndex + 1,
		};
	}
	throw new Error(`Unable to find '${needle}' inside '${lineFragment}'.`);
}
