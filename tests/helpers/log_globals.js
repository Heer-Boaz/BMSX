module.exports.schedule = async function schedule({ logger }) {
	logger('module initializing');
	setTimeout(() => {
	const machineManager = globalThis.machineManager;
	console.log('[TEST] keys', Object.keys(machineManager).slice(0, 20));
	}, 1000);
};
