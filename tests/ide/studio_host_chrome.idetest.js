await t.waitForCart();
await t.frames(140);

const studio = t.studio();
t.assert(studio !== null, 'Studio board media was not admitted by the workbench');
t.assert(studio.model.ready, 'Studio descriptor did not publish');

let snapshot = studio.model.snapshot;
t.assert(snapshot.objectCount === 1, 'outliner did not read the guest object record');
t.assert(snapshot.componentCount === 1, 'outliner did not read the guest component record');
const objectHandle = snapshot.objects.peek(0).handle;
const componentHandle = snapshot.components.peek(0).handle;
t.assert(objectHandle !== 0, 'guest object handle is zero');
t.assert(componentHandle !== 0, 'guest component handle is zero');

let timestamp = 1;
let pressId = 1;
const movePointer = (x, y) => {
	t.postInput({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_position', x, y, timestamp });
	t.postInput({ type: 'axis2', deviceId: 'pointer:0', code: 'pointer_controller_position', x, y, timestamp });
	timestamp += 1;
};
const tap = async (x, y) => {
	movePointer(x, y);
	t.postInput({ type: 'button', deviceId: 'pointer:0', code: 'pointer_primary', down: true, value: 1, timestamp, pressId });
	await t.frames(1);
	timestamp += 1;
	t.postInput({ type: 'button', deviceId: 'pointer:0', code: 'pointer_primary', down: false, value: 0, timestamp, pressId });
	pressId += 1;
	await t.frames(6);
	timestamp += 1;
	snapshot = studio.model.snapshot;
};

// First outliner row: object. This must traverse the retained host tree view,
// write the raw board command, ring the mailbox, and return through guest state.
await tap(12, 33);
t.assert(snapshot.selectedObjectHandle === objectHandle, 'outliner object click did not reach guest selection');
t.assert(snapshot.selectedComponentHandle === 0, 'object click selected a component');

// X plus in Details.
const initialXWord = snapshot.objects.peek(0).xWord;
await tap(309, 75);
t.assert(snapshot.objects.peek(0).xWord !== initialXWord, 'details X edit did not update the guest record');
t.assert(snapshot.objects.peek(0).x === 81, 'details X edit did not apply the one-unit step');

// Visible is a guest-owned property. Toggle it off and back on through the same command lane.
await tap(250, 120);
t.assert((snapshot.objects.peek(0).flags & 2) === 0, 'details visible toggle did not clear the guest flag');
await tap(250, 120);
t.assert((snapshot.objects.peek(0).flags & 2) !== 0, 'details visible toggle did not restore the guest flag');

// Second outliner row: the object's component.
await tap(12, 43);
t.assert(snapshot.selectedObjectHandle === objectHandle, 'component click lost its guest owner handle');
t.assert(snapshot.selectedComponentHandle === componentHandle, 'outliner component click did not reach guest selection');

await tap(250, 75);
t.assert((snapshot.components.peek(0).flags & 1) === 0, 'details enabled toggle did not clear the guest flag');
await tap(250, 75);
t.assert((snapshot.components.peek(0).flags & 1) !== 0, 'details enabled toggle did not restore the guest flag');

// Edit/Play changes only the gameplay clock; the machine and Studio guest keep advancing.
await tap(110, 8);
t.assert((snapshot.flags & 1) === 0, 'Edit did not pause the guest gameplay clock');
const editRevision = snapshot.revision;
await t.frames(4);
snapshot = studio.model.snapshot;
t.assert(snapshot.revision !== editRevision, 'Edit stopped the frame/Studio clock');
await tap(72, 8);
t.assert((snapshot.flags & 1) !== 0, 'Play did not resume the guest gameplay clock');
