module.exports.schedule = async function schedule({ logger }) {
  logger('collision probe init');
  setTimeout(() => {
    const game = globalThis.$;
    const world = game.world;
    const objects = Array.from(world.objects({ scope: 'all' }));
    const player = objects.find(o => o.__luaDefinitionId === 'marlies2020.player');
    if (!player) {
      console.log('[TEST] no player');
      return;
    }
    game.event_emitter.on('overlapBegin', (eventName, emitter, payload) => {
      if (emitter.id === player.id) {
        console.log('[TEST] overlap', emitter.id, payload.otherId);
      }
    }, 'collision-probe');
    console.log('[TEST] listener ready', player.id);
  }, 500);
};
