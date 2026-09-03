await t.waitForCart();
await t.frames(8);

const runtime = t.runtime();
const sourceState = t.sourceState();
const cpu = runtime.machine.cpu;
const globalKey = name => cpu.stringPool.intern(name);
const globalValue = name => cpu.getGlobalByKey(globalKey(name));
const objectValue = (object, name) => object.getStringKey(globalKey(name));
const request = async (name, value = 1) => {
	cpu.setGlobalByKey(globalKey(name), numberValueTag, value, null);
	await t.frames(2);
};
const assertPosition = (object, x, y, z, context) => {
	t.assert(
		objectValue(object, 'x') === x
			&& objectValue(object, 'y') === y
			&& objectValue(object, 'z') === z,
		`${context} did not preserve the expected position`,
	);
};
const revisionSource = (record, x) => record.base_src.replace(
	'pos = { x = 10, y = 20, z = 30 }',
	`pos = { x = ${x}, y = 20, z = 30 }`,
);
const installSceneRevision = async (record, x) => {
	t.openLuaSource('root.scene.lua');
	t.replaceActiveCodeSource(revisionSource(record, x));
	await t.performHotResume();
	await t.frames(8);
};

const cartridge = sourceState.cartridgeSlots[cpu.activeCartridgeSlot()];
const sceneRecord = cartridge.luaSources.path2lua['root.scene.lua'];
const initialObject = globalValue('scene_test_object');
const initialRuntimeId = objectValue(initialObject, 'id');
t.assert(globalValue('scene_test_applied_revision') === 1, 'initial scene revision was not applied');
t.assert(globalValue('scene_test_pending_revision') === null, 'initial scene retained a pending revision');
t.assert(objectValue(initialObject, 'runtime_value') === 73, 'fixture gameplay state was not initialized');
assertPosition(initialObject, 10, 20, 30, 'initial scene object');

await installSceneRevision(sceneRecord, 25);
const retainedObject = globalValue('scene_test_object');
t.assert(t.runtime() === runtime && runtime.machine.cpu === cpu, 'Hot Resume replaced the live Runtime or CPU');
t.assert(retainedObject === initialObject, 'scene revision replaced an unchanged member object');
t.assert(objectValue(retainedObject, 'id') === initialRuntimeId, 'scene revision changed the runtime identity');
t.assert(objectValue(retainedObject, 'runtime_value') === 73, 'scene revision reset live gameplay state');
t.assert(globalValue('scene_test_applied_revision') === 2, 'Hot Resume scene revision did not commit');
t.assert(globalValue('scene_test_pending_revision') === null, 'Hot Resume scene revision remained pending');
assertPosition(retainedObject, 25, 20, 30, 'Hot Resume retained object');

await request('scene_test_dispose_request');
t.assert(globalValue('scene_test_object') === null, 'gameplay disposal retained the scene member object');
t.assert(globalValue('scene_test_tombstoned') === true, 'gameplay disposal did not retain a member tombstone');

await installSceneRevision(sceneRecord, 26);
t.assert(globalValue('scene_test_applied_revision') === 3, 'tombstoned scene revision did not commit');
t.assert(globalValue('scene_test_object') === null, 'Hot Resume respawned a tombstoned member');
t.assert(globalValue('scene_test_tombstoned') === true, 'Hot Resume discarded a member tombstone');

await request('scene_test_reload_request');
const reloadedObject = globalValue('scene_test_object');
t.assert(reloadedObject !== null && reloadedObject !== retainedObject, 'explicit reload did not reconstruct the member');
const reloadedRuntimeId = objectValue(reloadedObject, 'id');
t.assert(reloadedRuntimeId !== initialRuntimeId, 'explicit reload reused a terminal runtime identity');
t.assert(globalValue('scene_test_tombstoned') === null, 'explicit reload retained a member tombstone');
assertPosition(reloadedObject, 26, 20, 30, 'explicitly reloaded object');

await request('scene_test_runtime_value_request', 91);
t.assert(objectValue(globalValue('scene_test_object'), 'runtime_value') === 91, 'fixture did not update gameplay state');

await request('scene_test_prepare_pending_request');
t.assert(globalValue('scene_test_pending_ready') === true, 'fixture did not retain an open World barrier');
t.assert(globalValue('scene_test_applied_revision') === 3, 'pending scene revision changed the applied revision');
t.assert(globalValue('scene_test_pending_revision') === 4, 'pending scene revision was not retained');
assertPosition(globalValue('scene_test_object'), 26, 20, 30, 'pending scene object');

const savedState = t.captureRuntimeSaveState();
await request('scene_test_commit_pending_request');
const committedObject = globalValue('scene_test_object');
t.assert(globalValue('scene_test_applied_revision') === 4, 'pending revision did not commit');
t.assert(globalValue('scene_test_pending_revision') === null, 'committed revision remained pending');
t.assert(globalValue('scene_test_pending_ready') === false, 'fixture retained a closed World barrier');
t.assert(objectValue(committedObject, 'runtime_value') === 91, 'pending commit reset gameplay state');
assertPosition(committedObject, 40, 50, 60, 'committed pending revision');

await request('scene_test_runtime_value_request', 999);
t.restoreRuntimeSaveState(savedState);

const restoredObject = globalValue('scene_test_object');
t.assert(globalValue('scene_test_pending_ready') === true, 'save-state restore lost the open World barrier');
t.assert(globalValue('scene_test_applied_revision') === 3, 'save-state restore lost the applied scene revision');
t.assert(globalValue('scene_test_pending_revision') === 4, 'save-state restore lost the pending scene revision');
t.assert(objectValue(restoredObject, 'id') === reloadedRuntimeId, 'save-state restore changed the retained runtime identity');
t.assert(objectValue(restoredObject, 'runtime_value') === 91, 'save-state restore lost live gameplay state');
assertPosition(restoredObject, 26, 20, 30, 'restored pending scene object');

await request('scene_test_commit_pending_request');
const restoredCommittedObject = globalValue('scene_test_object');
t.assert(globalValue('scene_test_applied_revision') === 4, 'restored pending revision did not commit');
t.assert(globalValue('scene_test_pending_revision') === null, 'restored commit retained a pending revision');
t.assert(globalValue('scene_test_pending_ready') === false, 'restored commit retained the World barrier');
t.assert(objectValue(restoredCommittedObject, 'runtime_value') === 91, 'restored commit reset gameplay state');
assertPosition(restoredCommittedObject, 40, 50, 60, 'restored pending revision commit');
