module.exports.schedule = async function schedule({ logger }) {
  logger('collision probe init');
  setTimeout(() => {
    const game = globalThis.$;
    const world = game.world;
    const objects = Array.from(world.objects({ scope: 'all' }));
    const player = objects.find(o => o.__lua_definition_id === 'marlies2020.player');
    if (!player) {
      console.log('[TEST] no player');
      return;
    }
    game.event_emitter.on('overlap.begin', (eventName, emitter, payload) => {
      if (emitter.id === player.id) {
        console.log('[TEST] overlap', emitter.id, payload.other_id);
      }
    }, 'collision-probe');
    console.log('[TEST] listener ready', player.id);
  }, 500);
};
