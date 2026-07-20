// Headless IDE test: hot-resume tracked-heap behaviour.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_heap.idetest.js
//
function fmt(s) {
	return `tracked=${s.tracked} obj=${s.objectBytes} str=${s.stringBytes} code=${s.codeBytes} protos=${s.protos} consts=${s.constPool} modCache=${s.moduleCache} globals=${s.globals}`;
}

await t.waitForCart();
await t.frames(400); // warm up so lazy modules load like real play

const warm = t.debugStats();
t.log(`warm ${fmt(warm)}`);

const RESUMES = 8;
let baseline;
for (let i = 0; i < RESUMES; i += 1) {
	await t.hotResume();
	await t.frames(8);
	const s = t.debugStats();
	t.log(`resume ${i + 1}/${RESUMES}: ${fmt(s)}`);
	if (i === 0) {
		t.assert(s.codeBytes === warm.codeBytes, `first no-op hot-resume grew code from ${warm.codeBytes} to ${s.codeBytes}`);
		t.assert(s.protos === warm.protos, `first no-op hot-resume grew protos from ${warm.protos} to ${s.protos}`);
		t.assert(s.constPool === warm.constPool, `first no-op hot-resume grew constants from ${warm.constPool} to ${s.constPool}`);
		baseline = s;
		continue;
	}
	t.assert(s.codeBytes === baseline.codeBytes, `no-op hot-resume grew code from ${baseline.codeBytes} to ${s.codeBytes}`);
	t.assert(s.protos === baseline.protos, `no-op hot-resume grew protos from ${baseline.protos} to ${s.protos}`);
	t.assert(s.constPool === baseline.constPool, `no-op hot-resume grew constants from ${baseline.constPool} to ${s.constPool}`);
	t.assert(s.tracked === baseline.tracked, `no-op hot-resume changed live heap from ${baseline.tracked} to ${s.tracked}`);
}
