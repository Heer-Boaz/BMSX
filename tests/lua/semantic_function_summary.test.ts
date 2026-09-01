import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FunctionSummaryStore, TermKind } from '../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';

test('function summaries retain an uncalled receiver write', () => {
	const file = buildLuaFileSemanticData([
		'local attachment<const> = {}',
		'attachment.__index = attachment',
		'function attachment:on_attach()',
		'\tself.parent.actioneffects = self',
		'end',
		'return attachment',
	].join('\n'), 'attachment.lua');
	const identities = new WorkspaceValueIdentityIndex({
		files: [file],
		globalValues: new Map(),
	});
	const summaries = new FunctionSummaryStore([file], identities);
	const summary = summaries.list().find(
		entry => entry.source.functionValue.root.kind === 'declaration'
			&& entry.source.functionValue.root.declId.includes('attachment.on_attach'),
	);

	assert.ok(summary);
	assert.equal(summary.calls.length, 0, 'the summary does not require a caller');
	assert.equal(summary.writes.length, 1);
	const write = summary.writes[0];
	assert.equal(summaries.terms.name(write.name), 'actioneffects');
	assert.equal(write.value, summary.parameters[0]);
	assert.equal(summaries.terms.kind(write.base), TermKind.Member);
	assert.equal(
		summaries.terms.name(summaries.terms.operand(write.base)),
		'parent',
	);
	assert.equal(summaries.terms.base(write.base), summary.parameters[0]);
});
