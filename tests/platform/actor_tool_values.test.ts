import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { asInteger, valueBool, valueFloat, valueFloatBits, valueInteger, valueNil, valueString, ValueTag, valuePayload } from '../../machine/ts/machine/cpu/value';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { afterTest } from '../helpers/test_cleanup';

/** Real BIOS, cartlib World admission and the ordinary tool context. This is
 * an in-process headless wire test, not browser UI or an external MCP session. */
test('Actor tool calls preserve int32/f32 payloads and advertise their distinct return tags', async t => {
	const f = await createLiveStudioFixture(t), { ide, sources, runtime, editor } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const source = cart.buffer.getText(), offset = source.indexOf('world:start()');
	assert.ok(offset >= 0);
	cart.pushEditOperations([{ offset, deleteLength: 0, text: `
function studio_test_actor:typed_probe(big, rounded, word, minimum, integer, floating, negative_zero, positive_zero, fraction, flag, missing, text)
 self.tool_call_count = (self.tool_call_count or 0) + 1
 self.tool_arguments = {big, rounded, word, minimum, integer, floating, negative_zero, positive_zero, fraction, flag, missing, text}
 return big, rounded, word, minimum, integer, floating, negative_zero, positive_zero, fraction, flag, missing, text,
  self, self.typed_probe, coroutine.create(function() end)
end
` }]);
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => ide.guest.global('studio_test_ready') === valueBool(true));
	ide.transport.pause(); editor.interaction.setActive(true);
	const version = cart.version, text = cart.buffer.getText();
	const lifetime = new AbortController(), tools = ide.tools.open(lifetime.signal);
	afterTest(t, () => lifetime.abort());
	const target = ide.inspection.target;
	const inspected = await tools.execute('studio_inspect_runtime', { target });
	assert.ok('inspection' in inspected.data);
	const listed = await tools.execute('studio_list_actors', { inspection: inspected.data.inspection, start: 0, count: 20 });
	assert.ok('actors' in listed.data);
	const actor = listed.data.actors.find(item => item.id.display === 'studio_test.first')!;
	assert.ok(actor);
	const tree = await tools.execute('studio_read_actor_tree', { actor: actor.reference, start: 0, count: 100 });
	assert.ok('nodes' in tree.data);
	const node = tree.data.nodes.find(item => item.kind === 'actor')!;
	const operations = await tools.execute('studio_list_actor_operations', { node: node.reference });
	assert.ok('methods' in operations.data && operations.data.methods.some(method => method.name === 'typed_probe'));
	const pending = tools.execute('studio_call_actor_method', { node: node.reference, method: 'typed_probe',
		arguments: '16777217, 16777217.0, 0xffffffff, 0x80000000, 1, 1.0, -0.0, 0.0, 0.25, false, nil, "32-bit"' });
	const operation = ide.actorExecution.active;
	assert.ok(operation, 'the tool starts the shared World-admitted Actor execution');
	await f.until(() => operation.result !== undefined);
	const returned = await pending, wire = JSON.parse(JSON.stringify(returned.data));
	assert.equal(wire.status, 'completed'); assert.equal(wire.invoked, true);
	const cpu = runtime.machine.cpu, guest = ide.guest;
	const expected = [valueInteger(16777217), valueFloat(16777217), valueInteger(-1), valueInteger(-2147483648),
		valueInteger(1), valueFloat(1), valueFloatBits(0x80000000), valueFloatBits(0), valueFloat(0.25), valueBool(false), valueNil(),
		valueString(cpu.stringPool.find('32-bit')!)];
	assert.deepEqual(wire.tags, [ValueTag.Integer, ValueTag.Float, ValueTag.Integer, ValueTag.Integer, ValueTag.Integer,
		ValueTag.Float, ValueTag.Float, ValueTag.Float, ValueTag.Float, ValueTag.False, ValueTag.Nil, ValueTag.String,
		ValueTag.Table, ValueTag.Closure, ValueTag.Thread]);
	assert.deepEqual(wire.values.slice(0, expected.length), expected.map(value => guest.formatValue(value)));
	// Observe fresh heap borrows after the operation, not pre-call handles or
	// rounded display strings: payloads and subtype must both survive admission.
	const current = guest.global('studio_test_actor'), stored = valuePayload(guest.readStringMember(current, 'tool_arguments'));
	assert.deepEqual(expected.map((_, index) => cpu.gc.tables.getInteger(stored, index + 1)), expected);
	assert.equal(asInteger(guest.readStringMember(current, 'tool_call_count')), 1);
	assert.throws(() => tools.execute('studio_list_actor_operations', { node: node.reference }), 'call entry expires the old suspended inspection');
	assert.equal(cart.version, version); assert.equal(cart.buffer.getText(), text);
});
