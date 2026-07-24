// Headless IDE test: hot-resume tracked-heap behaviour.
// Run: npm run ide:test -- <gameromname> tests/ide/hot_resume_heap.idetest.js
//
function fmt(s) {
	return `tracked=${s.tracked} obj=${s.objectBytes} str=${s.stringBytes} code=${s.codeBytes} functions=${s.functions} consts=${s.constants} modules=${s.moduleFunctions} globals=${s.globals}`;
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
		t.assert(s.functions === warm.functions, `first no-op hot-resume grew functions from ${warm.functions} to ${s.functions}`);
		t.assert(s.constants === warm.constants, `first no-op hot-resume grew constants from ${warm.constants} to ${s.constants}`);
		t.assert(s.moduleFunctions === warm.moduleFunctions, `first no-op hot-resume grew module functions from ${warm.moduleFunctions} to ${s.moduleFunctions}`);
		baseline = s;
		continue;
	}
	t.assert(s.codeBytes === baseline.codeBytes, `no-op hot-resume grew code from ${baseline.codeBytes} to ${s.codeBytes}`);
	t.assert(s.functions === baseline.functions, `no-op hot-resume grew functions from ${baseline.functions} to ${s.functions}`);
	t.assert(s.constants === baseline.constants, `no-op hot-resume grew constants from ${baseline.constants} to ${s.constants}`);
	t.assert(s.moduleFunctions === baseline.moduleFunctions, `no-op hot-resume grew module functions from ${baseline.moduleFunctions} to ${s.moduleFunctions}`);
	t.assert(s.tracked === baseline.tracked, `no-op hot-resume changed live heap from ${baseline.tracked} to ${s.tracked}`);
}
