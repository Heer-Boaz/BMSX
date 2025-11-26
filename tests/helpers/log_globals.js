module.exports.schedule = async function schedule({ logger }) {
  logger('module initializing');
  setTimeout(() => {
	const $ = globalThis.$;
	console.log('[TEST] keys', Object.keys($).slice(0, 20));
  }, 1000);
};
