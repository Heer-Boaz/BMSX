import './test_setup';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { machineManager } from '../../machine/ts/core/machine_manager';
import { scheduleRuntimeTask } from '../../machine/ts/ide/common/background_tasks';
import { defaultMicrotaskQueue } from '../../machine/ts/platform/platform';

test('IDE runtime tasks complete serially in submission order', async () => {
	const order: string[] = [];
	let releaseFirst!: () => void;
	const firstBlocked = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let finishSecond!: () => void;
	const secondCompleted = new Promise<void>((resolve) => {
		finishSecond = resolve;
	});
	scheduleRuntimeTask(async () => {
		order.push('first:start');
		await firstBlocked;
		order.push('first:end');
	}, assert.fail);
	scheduleRuntimeTask(() => {
		assert.equal(machineManager.paused, true);
		order.push('second');
		finishSecond();
	}, assert.fail);
	assert.equal(machineManager.paused, true);

	defaultMicrotaskQueue.flush();
	await Promise.resolve();
	assert.deepEqual(order, ['first:start']);

	releaseFirst();
	await secondCompleted;
	await Promise.resolve();
	assert.deepEqual(order, ['first:start', 'first:end', 'second']);
	assert.equal(machineManager.paused, false);

	let finishFailedBatch!: () => void;
	const failedBatchCompleted = new Promise<void>((resolve) => {
		finishFailedBatch = resolve;
	});
	scheduleRuntimeTask(() => {
		throw new Error('expected failure');
	}, () => {});
	scheduleRuntimeTask(() => {
		finishFailedBatch();
	}, assert.fail);
	defaultMicrotaskQueue.flush();
	await failedBatchCompleted;
	await Promise.resolve();
	assert.equal(machineManager.paused, true);

	let finishRecovery!: () => void;
	const recoveryCompleted = new Promise<void>((resolve) => {
		finishRecovery = resolve;
	});
	scheduleRuntimeTask(finishRecovery, assert.fail);
	defaultMicrotaskQueue.flush();
	await recoveryCompleted;
	await Promise.resolve();
	assert.equal(machineManager.paused, false);
});
