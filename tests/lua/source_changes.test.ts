import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceChangeMap, type SourceTextChange, type SourceUnchangedGap } from '../../toolchain/ts/text/source_changes';

test('source change maps preserve disjoint gaps and application-order coordinates', () => {
	const original = SourceChangeMap.unchanged(20);
	const changed = original.append([
		{ offset: 2, deletedLength: 2, insertedLength: 4 },
		{ offset: 14, deletedLength: 3, insertedLength: 1 },
	]);
	assert.equal(changed.oldLength, 20);
	assert.equal(changed.newLength, 20);
	assert.deepEqual([...changed.changes()], [
		{ oldStart: 2, oldEnd: 4, newStart: 2, newEnd: 6 },
		{ oldStart: 12, oldEnd: 15, newStart: 14, newEnd: 15 },
	]);
	assert.deepEqual([...changed.gaps()], [
		{ oldStart: 0, newStart: 0, length: 2 },
		{ oldStart: 4, newStart: 6, length: 8 },
		{ oldStart: 15, newStart: 15, length: 5 },
	]);
	assert.deepEqual([...original.gaps()], [{ oldStart: 0, newStart: 0, length: 20 }]);
	assert.deepEqual([...original.changes()], []);
});

test('insertions at both endpoints and complete deletion have exact empty spans', () => {
	const original = SourceChangeMap.unchanged(5);
	const inserted = original.append([
		{ offset: 0, deletedLength: 0, insertedLength: 2 },
		{ offset: 7, deletedLength: 0, insertedLength: 3 },
	]);
	assert.deepEqual([...inserted.changes()], [
		{ oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 2 },
		{ oldStart: 5, oldEnd: 5, newStart: 7, newEnd: 10 },
	]);
	const deleted = inserted.append([{ offset: 0, deletedLength: 10, insertedLength: 0 }]);
	assert.equal(deleted.newLength, 0);
	assert.deepEqual([...deleted.gaps()], []);
	assert.deepEqual([...deleted.changes()], [{ oldStart: 0, oldEnd: 5, newStart: 0, newEnd: 0 }]);
	const empty = SourceChangeMap.unchanged(0);
	assert.deepEqual([...empty.gaps()], []);
	assert.deepEqual([...empty.changes()], []);
	assert.deepEqual([...empty.append([{ offset: 0, deletedLength: 0, insertedLength: 4 }]).changes()], [
		{ oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 4 },
	]);
});

test('overlapping replacements retain only surviving original runs', () => {
	const changed = SourceChangeMap.unchanged(12).append([
		{ offset: 3, deletedLength: 4, insertedLength: 6 },
		{ offset: 1, deletedLength: 5, insertedLength: 2 },
		{ offset: 4, deletedLength: 4, insertedLength: 0 },
	]);
	assert.deepEqual([...changed.gaps()], [
		{ oldStart: 0, newStart: 0, length: 1 },
		{ oldStart: 9, newStart: 4, length: 3 },
	]);
	assert.deepEqual([...changed.changes()], [{ oldStart: 1, oldEnd: 9, newStart: 1, newEnd: 4 }]);
});

test('undo-like insertion removal coalesces gaps without assuming text equality', () => {
	const original = SourceChangeMap.unchanged(10);
	const inserted = original.append([{ offset: 4, deletedLength: 0, insertedLength: 3 }]);
	const removed = inserted.append([{ offset: 4, deletedLength: 3, insertedLength: 0 }]);
	assert.deepEqual([...removed.changes()], []);
	assert.deepEqual([...removed.gaps()], [{ oldStart: 0, newStart: 0, length: 10 }]);
	const reinserted = original.append([
		{ offset: 4, deletedLength: 3, insertedLength: 0 },
		{ offset: 4, deletedLength: 0, insertedLength: 3 },
	]);
	assert.deepEqual([...reinserted.changes()], [{ oldStart: 4, oldEnd: 7, newStart: 4, newEnd: 7 }]);
	assert.equal(original.append([]), original);
	assert.equal(original.append([{ offset: 5, deletedLength: 0, insertedLength: 0 }]), original);
});

test('edits inside inserted text stay one changed span and adjacent replacements merge', () => {
	const changed = SourceChangeMap.unchanged(10).append([
		{ offset: 3, deletedLength: 2, insertedLength: 5 },
		{ offset: 4, deletedLength: 2, insertedLength: 4 },
		{ offset: 10, deletedLength: 2, insertedLength: 1 },
	]);
	assert.deepEqual([...changed.changes()], [{ oldStart: 3, oldEnd: 7, newStart: 3, newEnd: 11 }]);
	assert.deepEqual([...changed.gaps()], [
		{ oldStart: 0, newStart: 0, length: 3 },
		{ oldStart: 7, newStart: 11, length: 3 },
	]);
});

test('storage describes huge unchanged sources without per-character expansion', () => {
	const length = 2 ** 40;
	const original = SourceChangeMap.unchanged(length);
	const changed = original.append([{ offset: 3, deletedLength: 1, insertedLength: 2 }]);
	assert.equal(changed.newLength, length + 1);
	assert.deepEqual([...changed.gaps()], [
		{ oldStart: 0, newStart: 0, length: 3 },
		{ oldStart: 4, newStart: 5, length: length - 4 },
	]);
});

function oracleGaps(tags: readonly number[]): SourceUnchangedGap[] {
	const gaps: SourceUnchangedGap[] = [];
	for (let position = 0; position < tags.length;) {
		if (tags[position] < 0) {
			position++;
			continue;
		}
		const newStart = position;
		const oldStart = tags[position++];
		while (position < tags.length && tags[position] === oldStart + position - newStart) position++;
		gaps.push({ oldStart, newStart, length: position - newStart });
	}
	return gaps;
}

function verifyTags(map: SourceChangeMap, original: readonly number[], current: readonly number[]): void {
	assert.equal(map.oldLength, original.length);
	assert.equal(map.newLength, current.length);
	assert.deepEqual([...map.gaps()], oracleGaps(current));
	const reconstructed: number[] = [];
	let oldPosition = 0;
	let newPosition = 0;
	for (const change of map.changes()) {
		assert.equal(change.oldStart - oldPosition, change.newStart - newPosition);
		assert.ok(change.oldStart >= oldPosition);
		assert.ok(change.newStart >= newPosition);
		assert.ok(change.oldEnd > change.oldStart || change.newEnd > change.newStart);
		reconstructed.push(...original.slice(oldPosition, change.oldStart), ...current.slice(change.newStart, change.newEnd));
		oldPosition = change.oldEnd;
		newPosition = change.newEnd;
	}
	assert.equal(map.oldLength - oldPosition, map.newLength - newPosition);
	reconstructed.push(...original.slice(oldPosition));
	assert.deepEqual(reconstructed, current);
}

test('random application-order composition agrees with tagged-character oracle and retains snapshots', () => {
	for (let seed = 1; seed <= 80; seed++) {
		let state = seed;
		const random = (limit: number): number => {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			return state % limit;
		};
		const original = Array.from({ length: random(70) }, (_, index) => index);
		let current = original.slice();
		let map = SourceChangeMap.unchanged(original.length);
		let nextTag = -1;
		const history: { map: SourceChangeMap; tags: number[] }[] = [];
		for (let batch = 0; batch < 100; batch++) {
			history.push({ map, tags: current.slice() });
			const changes: SourceTextChange[] = [];
			let single = map;
			for (let index = 0, count = 1 + random(5); index < count; index++) {
				const offset = random(current.length + 1);
				const available = current.length - offset;
				const deletedLength = random((seed % 2 === 0 ? available : Math.min(available, 4)) + 1);
				const insertedLength = random(12);
				const change = { offset, deletedLength, insertedLength };
				changes.push(change);
				current.splice(offset, deletedLength, ...Array.from({ length: insertedLength }, () => nextTag--));
				single = single.append([change]);
				verifyTags(single, original, current);
			}
			map = map.append(changes);
			verifyTags(map, original, current);
			assert.deepEqual([...map.changes()], [...single.changes()]);
			const retained = history[random(history.length)];
			verifyTags(retained.map, original, retained.tags);
			const fork = retained.map.append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]);
			verifyTags(fork, original, [-1, ...retained.tags]);
		}
	}
});
