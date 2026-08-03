import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import type { InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';

test('host and programmatic supervisor requests drive independent wired-OR sources', () => {
	const clock = { now: () => 0 } as HostClock;
	const source: InputSource = {
		devices: () => [],
		subscribe: () => () => {},
	};
	const input = new Input(clock, source, -1);

	input.setSupervisorRequestLine(true);
	input.setProgrammaticSupervisorRequestLine(true);
	input.setSupervisorRequestLine(false);
	assert.equal(input.supervisorRequestLineHigh(), true);

	input.resetInput();
	assert.equal(input.supervisorRequestLineHigh(), true);
	input.setProgrammaticSupervisorRequestLine(false);
	assert.equal(input.supervisorRequestLineHigh(), false);
	input.dispose();
});
