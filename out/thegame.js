System.register("BoazEngineJS/keystatecontainer", [], function (exports_1, context_1) {
    "use strict";
    var __moduleName = context_1 && context_1.id;
    return {
        setters: [],
        execute: function () {
        }
    };
});
System.register("BoazEngineJS/interfaces", [], function (exports_2, context_2) {
    "use strict";
    var __moduleName = context_2 && context_2.id;
    return {
        setters: [],
        execute: function () {
        }
    };
});
System.register("BoazEngineJS/msx", [], function (exports_3, context_3) {
    "use strict";
    var TileSize, Tile, MSXConstants;
    var __moduleName = context_3 && context_3.id;
    return {
        setters: [],
        execute: function () {
            exports_3("TileSize", TileSize = 8);
            Tile = class Tile {
                get toCoord() {
                    return this.t * TileSize;
                }
                static conversionMethod(v) {
                    return { t: v };
                }
                static ToCoord(x, y) {
                    if (!y)
                        return x * TileSize;
                    return { x: x * TileSize, y: y * TileSize };
                }
            };
            exports_3("Tile", Tile);
            (function (MSXConstants) {
                MSXConstants.MSX1ScreenWidth = 256;
                MSXConstants.MSX1ScreenHeight = 192;
                MSXConstants.MSX2ScreenWidth = 256;
                MSXConstants.MSX2ScreenHeight = 212;
                MSXConstants.Msx1Colors = [
                    { r: 0, g: 0, b: 0 },
                    { r: 0, g: 241, b: 20 },
                    { r: 68, g: 249, b: 86 },
                    { r: 85, g: 79, b: 255 },
                    { r: 128, g: 111, b: 2550 },
                    { r: 250, g: 80, b: 51 },
                    { r: 12, g: 255, b: 255 },
                    { r: 255, g: 81, b: 52 },
                    { r: 255, g: 115, b: 86 },
                    { r: 226, g: 210, b: 4 },
                    { r: 242, g: 217, b: 71 },
                    { r: 4, g: 212, b: 19 },
                    { r: 231, g: 80, b: 229 },
                    { r: 208, g: 208, b: 208 },
                    { r: 255, g: 255, b: 255 },
                ];
                MSXConstants.Msx1ExtColors = [{ r: 104, g: 104, b: 104 }];
            })(MSXConstants || (MSXConstants = {}));
            exports_3("MSXConstants", MSXConstants);
        }
    };
});
System.register("BoazEngineJS/direction", [], function (exports_4, context_4) {
    "use strict";
    var Direction;
    var __moduleName = context_4 && context_4.id;
    return {
        setters: [],
        execute: function () {
            (function (Direction) {
                Direction[Direction["Up"] = 0] = "Up";
                Direction[Direction["Right"] = 1] = "Right";
                Direction[Direction["Down"] = 2] = "Down";
                Direction[Direction["Left"] = 3] = "Left";
                Direction[Direction["None"] = 4] = "None";
            })(Direction || (Direction = {}));
            exports_4("Direction", Direction);
        }
    };
});
System.register("src/gameconstants", ["BoazEngineJS/msx"], function (exports_5, context_5) {
    "use strict";
    var msx_1, GameConstants;
    var __moduleName = context_5 && context_5.id;
    return {
        setters: [
            function (msx_1_1) {
                msx_1 = msx_1_1;
            }
        ],
        execute: function () {
            (function (GameConstants) {
                GameConstants.SoundEnabled = false;
                GameConstants.InitialFullscreen = false;
                GameConstants.InitialScale = 1;
                GameConstants.PauseGameOnKillFocus = false;
                GameConstants.AnimateFoeHealthLevel = false;
                GameConstants.EnemiesAfootAsProperty = false;
                GameConstants.Belmont_MaxHealth_AtStart = 48;
                GameConstants.Belmont_MaxHealth_Increase = 2;
                GameConstants.Belmont_MaxHearts = 99;
                GameConstants.CheckpointAtRoomEntry = false;
                GameConstants.ManualCheckpoints = !GameConstants.CheckpointAtRoomEntry;
                GameConstants.WindowTitle = "";
                GameConstants.HUDHeight = 36;
                GameConstants.GameScreenWidth = msx_1.MSXConstants.MSX2ScreenWidth;
                GameConstants.GameScreenHeight = msx_1.MSXConstants.MSX2ScreenHeight - GameConstants.HUDHeight;
                GameConstants.StageScreenWidthTiles = (GameConstants.GameScreenWidth / msx_1.TileSize);
                GameConstants.StageScreenHeightTiles = (GameConstants.GameScreenHeight / msx_1.TileSize);
                GameConstants.GameScreenStartX = 0;
                GameConstants.GameScreenStartY = 36;
                GameConstants.ImageBasePath = "./Content/Images/";
                GameConstants.Extension_PNG = ".png";
                GameConstants.WaitAfterLoadGame = 1000;
                GameConstants.WaitAfterRoomSwitch = 500;
                GameConstants.WaitAfterGameStart1 = 2;
                GameConstants.WaitAfterGameStart2 = 4;
            })(GameConstants || (GameConstants = {}));
            exports_5("GameConstants", GameConstants);
        }
    };
});
System.register("BoazEngineJS/model", [], function (exports_6, context_6) {
    "use strict";
    var GameState, GameSubstate, Model;
    var __moduleName = context_6 && context_6.id;
    return {
        setters: [],
        execute: function () {
            (function (GameState) {
                GameState[GameState["None"] = 0] = "None";
            })(GameState || (GameState = {}));
            exports_6("GameState", GameState);
            (function (GameSubstate) {
                GameSubstate[GameSubstate["Default"] = 0] = "Default";
            })(GameSubstate || (GameSubstate = {}));
            exports_6("GameSubstate", GameSubstate);
            Model = class Model {
                get OldState() {
                    return this.gameOldState;
                }
                set OldState(value) {
                    this.gameOldState = value;
                }
                get State() {
                    return this.gameState;
                }
                set State(value) {
                    this.gameState = value;
                }
                get OldSubstate() {
                    return this.gameOldSubstate;
                }
                set OldSubstate(value) {
                    this.gameOldSubstate = value;
                }
                get Substate() {
                    return this.gameSubstate;
                }
                set Substate(value) {
                    this.gameSubstate = value;
                }
                constructor() {
                    this.initModelForGameStart();
                }
                initModelForGameStart() {
                    this.objects = [];
                    this.id2object = new Map();
                    this.gameState = GameState.None;
                    this.gameSubstate = GameSubstate.Default;
                    this.paused = false;
                }
                clearModel() {
                    this.objects.forEach(x => {
                        x.exile();
                    });
                    this.objects.length = 0;
                    this.id2object.clear();
                    this.paused = false;
                }
                spawn(o, pos) {
                    if (o == null)
                        throw ("Cannot spawn object of type null.");
                    if (this.objects.indexOf(o) > -1)
                        throw ("GameObject already exists in the game model!");
                    this.objects.push(o);
                    if (o.id != null)
                        this.id2object[o.id] = o;
                    if (pos)
                        o.spawn(pos);
                    else
                        o.spawn(null);
                }
                remove(o) {
                    if (o == null)
                        throw new Error("Cannot remove object of type null.");
                    let index = this.objects.indexOf(o);
                    if (index > -1) {
                        delete this.objects[index];
                        this.objects.splice(index, 1);
                    }
                    else
                        throw new Error("Could not find object to remove.");
                    if (o.id != null && this.id2object.has(o.id))
                        this.id2object.delete(o.id);
                }
            };
            exports_6("Model", Model);
        }
    };
});
System.register("BoazEngineJS/constants", ["BoazEngineJS/model"], function (exports_7, context_7) {
    "use strict";
    var model_1, Constants;
    var __moduleName = context_7 && context_7.id;
    return {
        setters: [
            function (model_1_1) {
                model_1 = model_1_1;
            }
        ],
        execute: function () {
            (function (Constants) {
                Constants.INITIAL_GAMESTATE = model_1.GameState.None;
                Constants.INITIAL_GAMESUBSTATE = model_1.GameSubstate.Default;
                Constants.IMAGE_PATH = 'img/';
                Constants.AUDIO_PATH = 'snd/';
                Constants.GAMESCREEN_WIDTH = 1000;
                Constants.GAMESCREEN_HEIGHT = 600;
                Constants.DRAWBITMAP_NO_OPTION = 0;
                Constants.DRAWBITMAP_HFLIP = 0x1;
                Constants.DRAWBITMAP_VFLIP = 0x2;
                Constants.SaveSlotCount = 6;
                Constants.SaveSlotCheckpoint = -1;
                Constants.SaveGamePath = "./Saves/sintervania.sa";
                Constants.CheckpointGamePath = "./Saves/sintervania.chk";
                Constants.OptionsPath = "./sintervania.ini";
            })(Constants || (Constants = {}));
            exports_7("Constants", Constants);
        }
    };
});
System.register("BoazEngineJS/btimer", [], function (exports_8, context_8) {
    "use strict";
    var BStopwatch;
    var __moduleName = context_8 && context_8.id;
    return {
        setters: [],
        execute: function () {
            BStopwatch = class BStopwatch {
                constructor() {
                    this.pauseDuringMenu = true;
                    this.pauseAtFocusLoss = true;
                    this.running = false;
                    this.elapsedMilliseconds = 0;
                    this.start = () => {
                        this.running = true;
                    };
                    this.stop = () => {
                        this.running = false;
                    };
                    this.restart = () => {
                        this.running = true;
                        this.elapsedMilliseconds = 0;
                    };
                    this.reset = () => {
                        this.elapsedMilliseconds = 0;
                    };
                    this.updateTime = (elapsedMs) => {
                        if (!this.running)
                            return;
                        this.elapsedMilliseconds += elapsedMs;
                    };
                }
                static createWatch() {
                    let result = new BStopwatch();
                    BStopwatch.Watches.push(result);
                    return result;
                }
                static addWatch(watch) {
                    if (BStopwatch.Watches.indexOf(watch) > -1)
                        BStopwatch.Watches.push(watch);
                }
                static removeWatch(watch) {
                    let index = BStopwatch.Watches.indexOf(watch);
                    if (index > -1) {
                        delete BStopwatch.Watches[index];
                        BStopwatch.Watches.splice(index, 1);
                    }
                }
                static updateTimers(elapsedMs) {
                    BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
                }
                static pauseAllRunningWatches(pauseCausedByMenu) {
                    BStopwatch.Watches.filter(s => !s.running).forEach(s => { s.running = false; });
                    BStopwatch.Watches.forEach(w => {
                        if (w.running && (!pauseCausedByMenu || w.pauseDuringMenu)) {
                            w.stop();
                            BStopwatch.watchesThatHaveBeenStopped.push(w);
                        }
                    });
                }
                static resumeAllPausedWatches() {
                    BStopwatch.watchesThatHaveBeenStopped.filter(s => !s.running).forEach(s => { s.running = false; });
                }
                static pauseWatchesOnFocusLoss() {
                    BStopwatch.Watches.forEach(w => {
                        if (w.running && w.pauseAtFocusLoss) {
                            w.stop();
                            this.watchesThatHaveBeenStoppedAtFocusLoss.push(w);
                        }
                    });
                }
                static resumeAllPausedWatchesOnFocus() {
                    this.watchesThatHaveBeenStoppedAtFocusLoss.forEach(w => w.start());
                    this.watchesThatHaveBeenStoppedAtFocusLoss.length = 0;
                }
            };
            BStopwatch.watchesThatHaveBeenStopped = [];
            BStopwatch.watchesThatHaveBeenStoppedAtFocusLoss = [];
            BStopwatch.Watches = [];
            exports_8("BStopwatch", BStopwatch);
        }
    };
});
System.register("BoazEngineJS/controller", ["BoazEngineJS/btimer", "BoazEngineJS/engine"], function (exports_9, context_9) {
    "use strict";
    var btimer_1, engine_1, Controller;
    var __moduleName = context_9 && context_9.id;
    return {
        setters: [
            function (btimer_1_1) {
                btimer_1 = btimer_1_1;
            },
            function (engine_1_1) {
                engine_1 = engine_1_1;
            }
        ],
        execute: function () {
            Controller = class Controller {
                constructor() {
                    this.timer = btimer_1.BStopwatch.createWatch();
                    this.timer.restart;
                }
                takeTurn(elapsedMs) {
                    if (engine_1.model.paused) {
                        this.doPausedState();
                        return;
                    }
                    if (engine_1.model.startAfterLoad) {
                        this.doStartAfterLoadState();
                    }
                    btimer_1.BStopwatch.updateTimers(elapsedMs);
                    let toRemove = engine_1.model.objects.filter(o => o.disposeFlag).forEach(o => { engine_1.model.remove(o); o.exile(); });
                }
                doPausedState() {
                }
                doStartAfterLoadState() {
                }
                switchState(newstate) {
                    this.disposeOldState(newstate);
                    this.initNewState(newstate);
                    engine_1.model.gameOldState = engine_1.model.gameState;
                    engine_1.model.gameState = newstate;
                }
                switchSubstate(newsubstate) {
                    this.disposeOldSubstate(newsubstate);
                    this.initNewSubstate(newsubstate);
                    engine_1.model.gameOldSubstate = engine_1.model.gameSubstate;
                    engine_1.model.gameSubstate = newsubstate;
                }
                disposeOldState(newstate) {
                }
                disposeOldSubstate(newsubstate) {
                }
                initNewSubstate(newsubstate) {
                }
                initNewState(newstate) {
                }
            };
            exports_9("Controller", Controller);
        }
    };
});
System.register("BoazEngineJS/view", ["BoazEngineJS/constants", "BoazEngineJS/engine"], function (exports_10, context_10) {
    "use strict";
    var constants_1, engine_2, DrawBitmap, View;
    var __moduleName = context_10 && context_10.id;
    return {
        setters: [
            function (constants_1_1) {
                constants_1 = constants_1_1;
            },
            function (engine_2_1) {
                engine_2 = engine_2_1;
            }
        ],
        execute: function () {
            (function (DrawBitmap) {
                DrawBitmap[DrawBitmap["HFLIP"] = 1] = "HFLIP";
                DrawBitmap[DrawBitmap["VFLIP"] = 2] = "VFLIP";
            })(DrawBitmap || (DrawBitmap = {}));
            exports_10("DrawBitmap", DrawBitmap);
            View = class View {
                constructor() {
                    this.canvas = $('#gamescreen')[0];
                    this.context = this.canvas.getContext('2d');
                }
                init() {
                    this.handleResize();
                }
                setRelativeToScreenSize(element, size) {
                    element.style.width = [size.x * this.dx, 'px'].join('');
                    element.style.height = [size.y * this.dy, 'px'].join('');
                }
                calculateSize() {
                    let w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
                    let h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
                    this.windowSize = { x: w, y: h };
                    this.dx = this.windowSize.x / constants_1.Constants.GAMESCREEN_WIDTH;
                    this.dy = this.windowSize.y / constants_1.Constants.GAMESCREEN_HEIGHT;
                    this.dxy = Math.min(this.dx, this.dy);
                }
                handleResize() {
                    if (document.getElementById('gamescreen').style.visibility == 'hidden')
                        return;
                    engine_2.view.calculateSize();
                    document.getElementById('gamescreen').style.transform = ['scale(', engine_2.view.dx, ',', engine_2.view.dy, ')'].join('');
                    document.getElementById('gamescreen').style.transformOrigin = '0 0';
                    document.getElementById('gamescreen').style.width = (engine_2.view.windowSize.x * (1 + engine_2.view.dx)) + 'px';
                    document.getElementById('gamescreen').style.height = (engine_2.view.windowSize.y * (1 + engine_2.view.dy)) + 'px';
                }
                clear(context) {
                    if (context == null)
                        context = this.context;
                    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
                }
                draw() {
                }
                drawLoading() {
                    this.clear();
                    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.context.font = '18pt Calibri';
                    this.context.fillStyle = 'white';
                    this.context.fillText('Loading...', 10, 25);
                }
                DrawBitmap(imgid, x, y, options) {
                    this.drawImg(imgid, { x: x, y: y }, options || undefined);
                }
                DrawColoredBitmap(imgid, x, y, r, g, b, a) {
                    this.DrawBitmap(imgid, x, y, 0);
                }
                drawImg(imgid, pos, options) {
                    var img = engine_2.images[imgid];
                    if (!img)
                        throw new Error("Cannot find image with id '" + imgid + "'");
                    this.context.save();
                    this.context.translate(pos.x, pos.y);
                    this.context.drawImage(img, 0, 0);
                    this.context.restore();
                }
                DrawRectangle(x, y, ex, ey, c) {
                    this.context.save();
                    this.context.beginPath();
                    this.context.strokeStyle = this.toRgb(c);
                    this.context.rect(x, y, ex - x, ey - y);
                    this.context.stroke();
                    this.context.restore();
                }
                FillRectangle(x, y, ex, ey, c) {
                    this.context.save();
                    this.context.beginPath();
                    let colorRgb = this.toRgb(c);
                    this.context.fillStyle = colorRgb;
                    this.context.strokeStyle = colorRgb;
                    this.context.fillRect(x, y, ex - x, ey - y);
                    this.context.stroke();
                    this.context.restore();
                }
                toRgb(c) {
                    return `rgb(${c.r},${c.g},${c.b})`;
                }
            };
            exports_10("View", View);
        }
    };
});
System.register("BoazEngineJS/song", [], function (exports_11, context_11) {
    "use strict";
    var __moduleName = context_11 && context_11.id;
    return {
        setters: [],
        execute: function () {
        }
    };
});
System.register("BoazEngineJS/effect", [], function (exports_12, context_12) {
    "use strict";
    var __moduleName = context_12 && context_12.id;
    return {
        setters: [],
        execute: function () {
        }
    };
});
System.register("BoazEngineJS/soundmaster", ["BoazEngineJS/engine"], function (exports_13, context_13) {
    "use strict";
    var engine_3, SoundMaster;
    var __moduleName = context_13 && context_13.id;
    return {
        setters: [
            function (engine_3_1) {
                engine_3 = engine_3_1;
            }
        ],
        execute: function () {
            SoundMaster = class SoundMaster {
                static OnMusicBufferEnd() {
                    if (this.MusicBeingPlayed && this.MusicBeingPlayed.NextSong) {
                        let nextSong = this.MusicBeingPlayed.NextSong;
                        this.MusicBeingPlayed = nextSong;
                        this.PlayMusic(nextSong);
                    }
                    else
                        this.MusicBeingPlayed = null;
                }
                static OnEffectBufferEnd() {
                    this.EffectBeingPlayed = null;
                }
                static StopEffect() {
                    if (!this.EffectBeingPlayed.AudioId)
                        return;
                    engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].pause();
                    engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].currentTime = 0;
                    this.EffectBeingPlayed = null;
                }
                static playEffect(audioId) {
                    engine_3.audio[`${audioId}`].pause();
                    engine_3.audio[`${audioId}`].currentTime = 0;
                    engine_3.audio[`${audioId}`].play();
                }
                static PlayEffect(effect) {
                    if (this.EffectBeingPlayed) {
                        if (SoundMaster.LimitToOneEffect) {
                            if (effect.Priority >= this.EffectBeingPlayed.Priority) {
                                this.StopEffect();
                                this.playEffect(effect.AudioId);
                                this.EffectBeingPlayed = effect;
                                return;
                            }
                        }
                    }
                    else {
                        this.playEffect(effect.AudioId);
                        this.EffectBeingPlayed = effect;
                    }
                }
                static StopMusic() {
                    if (!this.MusicBeingPlayed.Music)
                        return;
                    engine_3.audio[`${this.MusicBeingPlayed.Music}`].pause();
                    engine_3.audio[`${this.MusicBeingPlayed.Music}`].currentTime = 0;
                    this.MusicBeingPlayed = null;
                }
                static PlayMusic(song, stopCurrent = true) {
                    if (stopCurrent)
                        this.StopMusic();
                    this.MusicBeingPlayed = song;
                    engine_3.audio[`${song.Music}`].pause();
                    engine_3.audio[`${song.Music}`].currentTime = 0;
                    engine_3.audio[`${song.Music}`].Loop = song.Loop || false;
                    engine_3.audio[`${song.Music}`].play();
                }
                static ResumeEffect() {
                    engine_3.audio[`${this.EffectBeingPlayed.AudioId}`].play();
                }
                static ResumeMusic() {
                    engine_3.audio[`${this.MusicBeingPlayed.Music}`].play();
                }
                static SetEffectsVolume(volume) {
                    throw Error("Implementeer deze meuk!");
                }
                static SetMusicVolume(volume) {
                    throw Error("Implementeer deze meuk!");
                }
            };
            SoundMaster.LimitToOneEffect = true;
            exports_13("SoundMaster", SoundMaster);
        }
    };
});
System.register("BoazEngineJS/engine", ["BoazEngineJS/constants", "BoazEngineJS/view", "BoazEngineJS/soundmaster"], function (exports_14, context_14) {
    "use strict";
    var constants_2, view_1, soundmaster_1, game, model, controller, sound, view, gameview, images, audio, Game;
    var __moduleName = context_14 && context_14.id;
    return {
        setters: [
            function (constants_2_1) {
                constants_2 = constants_2_1;
            },
            function (view_1_1) {
                view_1 = view_1_1;
            },
            function (soundmaster_1_1) {
                soundmaster_1 = soundmaster_1_1;
            }
        ],
        execute: function () {
            exports_14("images", images = new Map());
            exports_14("audio", audio = new Map());
            Game = class Game {
                constructor() {
                    exports_14("game", game = this);
                    exports_14("sound", sound = new soundmaster_1.SoundMaster());
                    exports_14("view", view = new view_1.View());
                    this.fps = 50;
                }
                setModel(m) {
                    exports_14("model", model = m);
                }
                setController(c) {
                    exports_14("controller", controller = c);
                }
                setGameView(v) {
                    exports_14("gameview", gameview = v);
                }
                get TurnCounter() {
                    return this.turnCounter;
                }
                GameOptionsChanged() {
                    throw Error("Not implemented yet :-(");
                }
                loadGameOptions() {
                    throw Error("Not implemented yet :-(");
                }
                startAfterLoad() {
                    controller.switchState(constants_2.Constants.INITIAL_GAMESTATE);
                    controller.switchSubstate(constants_2.Constants.INITIAL_GAMESUBSTATE);
                    requestAnimationFrame(function (timestamp) {
                        game.run(timestamp);
                    });
                    $(window).on('resize', function () {
                        view.handleResize();
                    });
                    window.addEventListener('orientationchange', view.handleResize, false);
                    view.handleResize();
                }
                update(elapsedMs) {
                    controller.takeTurn(elapsedMs);
                }
                draw(elapsedMs) {
                    gameview.drawGame(elapsedMs);
                }
                run(timestamp) {
                    let elapsedMs = timestamp - this.lastUpdate;
                    this.lastUpdate = timestamp;
                    this.update(elapsedMs);
                    this.draw(elapsedMs);
                    let t = this;
                    requestAnimationFrame(function (timestamp) {
                        game.run(timestamp);
                        ++t.turnCounter;
                    });
                }
            };
            exports_14("Game", Game);
            $(function () {
            });
            if (typeof Array.isArray === 'undefined') {
                Array.isArray = function (obj) {
                    return Object.prototype.toString.call(obj) === '[object Array]';
                };
            }
            ;
        }
    };
});
System.register("BoazEngineJS/resourceids", [], function (exports_15, context_15) {
    "use strict";
    var BitmapId, AudioId;
    var __moduleName = context_15 && context_15.id;
    return {
        setters: [],
        execute: function () {
            (function (BitmapId) {
                BitmapId[BitmapId["None"] = -1] = "None";
                BitmapId[BitmapId["Room"] = 0] = "Room";
                BitmapId[BitmapId["Belmont_l1"] = 1] = "Belmont_l1";
                BitmapId[BitmapId["Belmont_l2"] = 2] = "Belmont_l2";
                BitmapId[BitmapId["Belmont_l3"] = 3] = "Belmont_l3";
                BitmapId[BitmapId["Belmont_r1"] = 4] = "Belmont_r1";
                BitmapId[BitmapId["Belmont_r2"] = 5] = "Belmont_r2";
                BitmapId[BitmapId["Belmont_r3"] = 6] = "Belmont_r3";
                BitmapId[BitmapId["Belmont_ld"] = 7] = "Belmont_ld";
                BitmapId[BitmapId["Belmont_rd"] = 8] = "Belmont_rd";
                BitmapId[BitmapId["Belmont_lw1"] = 9] = "Belmont_lw1";
                BitmapId[BitmapId["Belmont_lw2"] = 10] = "Belmont_lw2";
                BitmapId[BitmapId["Belmont_lw3"] = 11] = "Belmont_lw3";
                BitmapId[BitmapId["Belmont_rw1"] = 12] = "Belmont_rw1";
                BitmapId[BitmapId["Belmont_rw2"] = 13] = "Belmont_rw2";
                BitmapId[BitmapId["Belmont_rw3"] = 14] = "Belmont_rw3";
                BitmapId[BitmapId["Belmont_lwd1"] = 15] = "Belmont_lwd1";
                BitmapId[BitmapId["Belmont_lwd2"] = 16] = "Belmont_lwd2";
                BitmapId[BitmapId["Belmont_lwd3"] = 17] = "Belmont_lwd3";
                BitmapId[BitmapId["Belmont_rwd1"] = 18] = "Belmont_rwd1";
                BitmapId[BitmapId["Belmont_rwd2"] = 19] = "Belmont_rwd2";
                BitmapId[BitmapId["Belmont_rwd3"] = 20] = "Belmont_rwd3";
                BitmapId[BitmapId["Belmont_ldead"] = 21] = "Belmont_ldead";
                BitmapId[BitmapId["Belmont_rdead"] = 22] = "Belmont_rdead";
                BitmapId[BitmapId["Belmont_lhitdown"] = 23] = "Belmont_lhitdown";
                BitmapId[BitmapId["Belmont_rhitdown"] = 24] = "Belmont_rhitdown";
                BitmapId[BitmapId["Belmont_lhitfly"] = 25] = "Belmont_lhitfly";
                BitmapId[BitmapId["Belmont_rhitfly"] = 26] = "Belmont_rhitfly";
                BitmapId[BitmapId["HUD"] = 27] = "HUD";
                BitmapId[BitmapId["HUD_EnergyStripe_belmont"] = 28] = "HUD_EnergyStripe_belmont";
                BitmapId[BitmapId["HUD_EnergyStripe_boss"] = 29] = "HUD_EnergyStripe_boss";
                BitmapId[BitmapId["MenuCursor"] = 30] = "MenuCursor";
                BitmapId[BitmapId["Font_A"] = 31] = "Font_A";
                BitmapId[BitmapId["Font_B"] = 32] = "Font_B";
                BitmapId[BitmapId["Font_C"] = 33] = "Font_C";
                BitmapId[BitmapId["Font_D"] = 34] = "Font_D";
                BitmapId[BitmapId["Font_E"] = 35] = "Font_E";
                BitmapId[BitmapId["Font_F"] = 36] = "Font_F";
                BitmapId[BitmapId["Font_G"] = 37] = "Font_G";
                BitmapId[BitmapId["Font_H"] = 38] = "Font_H";
                BitmapId[BitmapId["Font_I"] = 39] = "Font_I";
                BitmapId[BitmapId["Font_J"] = 40] = "Font_J";
                BitmapId[BitmapId["Font_K"] = 41] = "Font_K";
                BitmapId[BitmapId["Font_L"] = 42] = "Font_L";
                BitmapId[BitmapId["Font_M"] = 43] = "Font_M";
                BitmapId[BitmapId["Font_N"] = 44] = "Font_N";
                BitmapId[BitmapId["Font_O"] = 45] = "Font_O";
                BitmapId[BitmapId["Font_P"] = 46] = "Font_P";
                BitmapId[BitmapId["Font_Q"] = 47] = "Font_Q";
                BitmapId[BitmapId["Font_R"] = 48] = "Font_R";
                BitmapId[BitmapId["Font_S"] = 49] = "Font_S";
                BitmapId[BitmapId["Font_T"] = 50] = "Font_T";
                BitmapId[BitmapId["Font_U"] = 51] = "Font_U";
                BitmapId[BitmapId["Font_V"] = 52] = "Font_V";
                BitmapId[BitmapId["Font_W"] = 53] = "Font_W";
                BitmapId[BitmapId["Font_X"] = 54] = "Font_X";
                BitmapId[BitmapId["Font_IJ"] = 55] = "Font_IJ";
                BitmapId[BitmapId["Font_Y"] = 56] = "Font_Y";
                BitmapId[BitmapId["Font_Z"] = 57] = "Font_Z";
                BitmapId[BitmapId["Font_0"] = 58] = "Font_0";
                BitmapId[BitmapId["Font_1"] = 59] = "Font_1";
                BitmapId[BitmapId["Font_2"] = 60] = "Font_2";
                BitmapId[BitmapId["Font_3"] = 61] = "Font_3";
                BitmapId[BitmapId["Font_4"] = 62] = "Font_4";
                BitmapId[BitmapId["Font_5"] = 63] = "Font_5";
                BitmapId[BitmapId["Font_6"] = 64] = "Font_6";
                BitmapId[BitmapId["Font_7"] = 65] = "Font_7";
                BitmapId[BitmapId["Font_8"] = 66] = "Font_8";
                BitmapId[BitmapId["Font_9"] = 67] = "Font_9";
                BitmapId[BitmapId["Font_Comma"] = 68] = "Font_Comma";
                BitmapId[BitmapId["Font_Dot"] = 69] = "Font_Dot";
                BitmapId[BitmapId["Font_Exclamation"] = 70] = "Font_Exclamation";
                BitmapId[BitmapId["Font_QuestionMark"] = 71] = "Font_QuestionMark";
                BitmapId[BitmapId["Font_Line"] = 72] = "Font_Line";
                BitmapId[BitmapId["Font_Apostroph"] = 73] = "Font_Apostroph";
                BitmapId[BitmapId["Font_Space"] = 74] = "Font_Space";
                BitmapId[BitmapId["Font_Continue"] = 75] = "Font_Continue";
                BitmapId[BitmapId["Font_Colon"] = 76] = "Font_Colon";
                BitmapId[BitmapId["Font_SpeakStart"] = 77] = "Font_SpeakStart";
                BitmapId[BitmapId["Font_SpeakEnd"] = 78] = "Font_SpeakEnd";
                BitmapId[BitmapId["Font_Streep"] = 79] = "Font_Streep";
                BitmapId[BitmapId["Font_Slash"] = 80] = "Font_Slash";
                BitmapId[BitmapId["Font_Percent"] = 81] = "Font_Percent";
                BitmapId[BitmapId["Titel"] = 82] = "Titel";
                BitmapId[BitmapId["HUD_FoeHealthBar"] = 83] = "HUD_FoeHealthBar";
                BitmapId[BitmapId["CurtainPart"] = 84] = "CurtainPart";
                BitmapId[BitmapId["TitelKonami"] = 85] = "TitelKonami";
                BitmapId[BitmapId["TitelBoven"] = 86] = "TitelBoven";
                BitmapId[BitmapId["TitelOnder"] = 87] = "TitelOnder";
                BitmapId[BitmapId["Chest"] = 88] = "Chest";
                BitmapId[BitmapId["Heart_big"] = 89] = "Heart_big";
                BitmapId[BitmapId["Heart_fly"] = 90] = "Heart_fly";
                BitmapId[BitmapId["Heart_small"] = 91] = "Heart_small";
                BitmapId[BitmapId["Key_big"] = 92] = "Key_big";
                BitmapId[BitmapId["Key_small"] = 93] = "Key_small";
                BitmapId[BitmapId["ZakFoe_1"] = 94] = "ZakFoe_1";
                BitmapId[BitmapId["ZakFoe_2"] = 95] = "ZakFoe_2";
                BitmapId[BitmapId["ZakFoe_3"] = 96] = "ZakFoe_3";
                BitmapId[BitmapId["FoeKill_1"] = 97] = "FoeKill_1";
                BitmapId[BitmapId["FoeKill_2"] = 98] = "FoeKill_2";
                BitmapId[BitmapId["Candle_1"] = 99] = "Candle_1";
                BitmapId[BitmapId["Candle_2"] = 100] = "Candle_2";
                BitmapId[BitmapId["Door"] = 101] = "Door";
                BitmapId[BitmapId["GCandle_1"] = 102] = "GCandle_1";
                BitmapId[BitmapId["GCandle_2"] = 103] = "GCandle_2";
                BitmapId[BitmapId["Chandelier_1"] = 104] = "Chandelier_1";
                BitmapId[BitmapId["Chandelier_2"] = 105] = "Chandelier_2";
                BitmapId[BitmapId["Chandelier_3"] = 106] = "Chandelier_3";
                BitmapId[BitmapId["Chandelier_4"] = 107] = "Chandelier_4";
                BitmapId[BitmapId["Chandelier_5"] = 108] = "Chandelier_5";
                BitmapId[BitmapId["Hag_1"] = 109] = "Hag_1";
                BitmapId[BitmapId["Hag_2"] = 110] = "Hag_2";
                BitmapId[BitmapId["Pietula_1"] = 111] = "Pietula_1";
                BitmapId[BitmapId["Pietula_2"] = 112] = "Pietula_2";
                BitmapId[BitmapId["Pietula_3"] = 113] = "Pietula_3";
            })(BitmapId || (BitmapId = {}));
            exports_15("BitmapId", BitmapId);
            (function (AudioId) {
                AudioId[AudioId["None"] = -1] = "None";
                AudioId[AudioId["Init"] = 0] = "Init";
                AudioId[AudioId["Selectie"] = 1] = "Selectie";
                AudioId[AudioId["Fout"] = 2] = "Fout";
                AudioId[AudioId["Whip"] = 3] = "Whip";
                AudioId[AudioId["Heart"] = 4] = "Heart";
                AudioId[AudioId["Hit"] = 5] = "Hit";
                AudioId[AudioId["ItemDrop"] = 6] = "ItemDrop";
                AudioId[AudioId["ItemPickup"] = 7] = "ItemPickup";
                AudioId[AudioId["KeyGrab"] = 8] = "KeyGrab";
                AudioId[AudioId["Knife"] = 9] = "Knife";
                AudioId[AudioId["Land"] = 10] = "Land";
                AudioId[AudioId["Lightning"] = 11] = "Lightning";
                AudioId[AudioId["Munnies"] = 12] = "Munnies";
                AudioId[AudioId["Ohnoes"] = 13] = "Ohnoes";
                AudioId[AudioId["PlayerDamage"] = 14] = "PlayerDamage";
                AudioId[AudioId["Portal"] = 15] = "Portal";
                AudioId[AudioId["Wall_break"] = 16] = "Wall_break";
                AudioId[AudioId["Humiliation"] = 17] = "Humiliation";
                AudioId[AudioId["Huray"] = 18] = "Huray";
                AudioId[AudioId["Prologue"] = 19] = "Prologue";
                AudioId[AudioId["Stage"] = 20] = "Stage";
                AudioId[AudioId["Boss"] = 21] = "Boss";
                AudioId[AudioId["Ending"] = 22] = "Ending";
            })(AudioId || (AudioId = {}));
            exports_15("AudioId", AudioId);
        }
    };
});
System.register("src/resourcemaster", ["BoazEngineJS/resourceids"], function (exports_16, context_16) {
    "use strict";
    var resourceids_1, img2src, snd2src, ResourceMaster;
    var __moduleName = context_16 && context_16.id;
    return {
        setters: [
            function (resourceids_1_1) {
                resourceids_1 = resourceids_1_1;
            }
        ],
        execute: function () {
            exports_16("img2src", img2src = new Map());
            exports_16("snd2src", snd2src = new Map());
            ResourceMaster = class ResourceMaster {
                constructor() {
                    this.SoundEffectList = new Map();
                    this.MusicList = new Map();
                }
                static get _() {
                    return ResourceMaster._instance != null ? ResourceMaster._instance : (ResourceMaster._instance = new ResourceMaster());
                }
                static get Sound() {
                    return ResourceMaster._.SoundEffectList;
                }
                static get Music() {
                    return ResourceMaster._.MusicList;
                }
                static AddImg(key, src) {
                    img2src.set(key, src);
                }
                static AddSnd(key, src) {
                    snd2src.set(key, src);
                }
                static reloadImg(key, src) {
                    img2src.set(key, src);
                    throw new Error("Reloading nodig!");
                }
                LoadGameResources() {
                    this.loadViewResources();
                    this.loadAudioResources();
                }
                loadViewResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Titel, "./Resources/Graphics/Belmont/Belmont_l1.png");
                    this.loadBelmontResources();
                    this.loadFXResources();
                    this.loadMiscResources();
                    this.loadFontResources();
                    this.loadItemResources();
                    this.loadFoeResources();
                    this.loadNPCResources();
                    this.loadDecorResources();
                }
                loadFXResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.FoeKill_1, "./Resources/Graphics/FX/Foekill_1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.FoeKill_2, "./Resources/Graphics/FX/Foekill_2.png");
                }
                loadDecorResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Candle_1, "./Resources/Graphics/Decor/Candle_1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Candle_2, "./Resources/Graphics/Decor/Candle_2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.GCandle_1, "./Resources/Graphics/Decor/GCandle_1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.GCandle_2, "./Resources/Graphics/Decor/GCandle_2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Door, "./Resources/Graphics/Decor/Door.png");
                }
                loadBelmontResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l1, "./Resources/Graphics/Belmont/Belmont_l1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l2, "./Resources/Graphics/Belmont/Belmont_l2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_l3, "./Resources/Graphics/Belmont/Belmont_l3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_ld, "./Resources/Graphics/Belmont/Belmont_ld.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw1, "./Resources/Graphics/Belmont/Belmont_lw1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw2, "./Resources/Graphics/Belmont/Belmont_lw2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lw3, "./Resources/Graphics/Belmont/Belmont_lw3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd1, "./Resources/Graphics/Belmont/Belmont_lwd1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd2, "./Resources/Graphics/Belmont/Belmont_lwd2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lwd3, "./Resources/Graphics/Belmont/Belmont_lwd3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_ldead, "./Resources/Graphics/Belmont/Belmont_ldead.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lhitdown, "./Resources/Graphics/Belmont/Belmont_lhitdown.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_lhitfly, "./Resources/Graphics/Belmont/Belmont_lhitfly.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r1, "./Resources/Graphics/Belmont/Belmont_r1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r2, "./Resources/Graphics/Belmont/Belmont_r2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_r3, "./Resources/Graphics/Belmont/Belmont_r3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rd, "./Resources/Graphics/Belmont/Belmont_rd.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw1, "./Resources/Graphics/Belmont/Belmont_rw1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw2, "./Resources/Graphics/Belmont/Belmont_rw2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rw3, "./Resources/Graphics/Belmont/Belmont_rw3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd1, "./Resources/Graphics/Belmont/Belmont_rwd1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd2, "./Resources/Graphics/Belmont/Belmont_rwd2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rwd3, "./Resources/Graphics/Belmont/Belmont_rwd3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rdead, "./Resources/Graphics/Belmont/Belmont_rdead.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rhitdown, "./Resources/Graphics/Belmont/Belmont_rhitdown.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Belmont_rhitfly, "./Resources/Graphics/Belmont/Belmont_rhitfly.png");
                }
                loadMiscResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.HUD, "./Resources/Graphics/HUD/HUD.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.HUD_EnergyStripe_belmont, "./Resources/Graphics/HUD/Energybarstripe_Belmont.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.HUD_EnergyStripe_boss, "./Resources/Graphics/HUD/EnergybarStripe_Boss.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.CurtainPart, "./Resources/Graphics/Misc/CurtainPart.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.MenuCursor, "./Resources/Graphics/Menu/MenuCursor.png");
                }
                loadFontResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_A, "./Resources/Graphics/Font/Letter_A.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_B, "./Resources/Graphics/Font/Letter_B.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_C, "./Resources/Graphics/Font/Letter_C.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_D, "./Resources/Graphics/Font/Letter_D.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_E, "./Resources/Graphics/Font/Letter_E.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_F, "./Resources/Graphics/Font/Letter_F.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_G, "./Resources/Graphics/Font/Letter_G.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_H, "./Resources/Graphics/Font/Letter_H.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_I, "./Resources/Graphics/Font/Letter_I.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_J, "./Resources/Graphics/Font/Letter_J.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_K, "./Resources/Graphics/Font/Letter_K.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_L, "./Resources/Graphics/Font/Letter_L.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_M, "./Resources/Graphics/Font/Letter_M.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_N, "./Resources/Graphics/Font/Letter_N.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_O, "./Resources/Graphics/Font/Letter_O.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_P, "./Resources/Graphics/Font/Letter_P.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Q, "./Resources/Graphics/Font/Letter_Q.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_R, "./Resources/Graphics/Font/Letter_R.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_S, "./Resources/Graphics/Font/Letter_S.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_T, "./Resources/Graphics/Font/Letter_T.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_U, "./Resources/Graphics/Font/Letter_U.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_V, "./Resources/Graphics/Font/Letter_V.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_W, "./Resources/Graphics/Font/Letter_W.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_X, "./Resources/Graphics/Font/Letter_X.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_IJ, "./Resources/Graphics/Font/Letter_IJ.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Y, "./Resources/Graphics/Font/Letter_Y.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Z, "./Resources/Graphics/Font/Letter_Z.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_0, "./Resources/Graphics/Font/Letter_0.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_1, "./Resources/Graphics/Font/Letter_1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_2, "./Resources/Graphics/Font/Letter_2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_3, "./Resources/Graphics/Font/Letter_3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_4, "./Resources/Graphics/Font/Letter_4.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_5, "./Resources/Graphics/Font/Letter_5.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_6, "./Resources/Graphics/Font/Letter_6.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_7, "./Resources/Graphics/Font/Letter_7.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_8, "./Resources/Graphics/Font/Letter_8.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_9, "./Resources/Graphics/Font/Letter_9.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Comma, "./Resources/Graphics/Font/Letter_Comma.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Dot, "./Resources/Graphics/Font/Letter_Dot.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Exclamation, "./Resources/Graphics/Font/Letter_Exclamation.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_QuestionMark, "./Resources/Graphics/Font/Letter_Question.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Line, "./Resources/Graphics/Font/Letter_Line.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Apostroph, "./Resources/Graphics/Font/Letter_Apostroph.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Space, "./Resources/Graphics/Font/Letter_Space.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Continue, "./Resources/Graphics/Font/Letter_Continue.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Colon, "./Resources/Graphics/Font/Letter_Colon.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Streep, "./Resources/Graphics/Font/Letter_Streep.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Slash, "./Resources/Graphics/Font/Letter_Slash.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_Percent, "./Resources/Graphics/Font/Letter_Percent.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_SpeakStart, "./Resources/Graphics/Font/Letter_SpeakStart.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Font_SpeakEnd, "./Resources/Graphics/Font/Letter_SpeakEnd.png");
                }
                loadItemResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Chest, "./Resources/Graphics/Item/Chest.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_big, "./Resources/Graphics/Item/Heart_big.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_small, "./Resources/Graphics/Item/Heart_small.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Heart_fly, "./Resources/Graphics/Item/Heart_fly.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Key_big, "./Resources/Graphics/Item/Key_big.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Key_small, "./Resources/Graphics/Item/Key_small.png");
                }
                loadFoeResources() {
                    ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_1, "./Resources/Graphics/Foe/ZakFoe1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_2, "./Resources/Graphics/Foe/ZakFoe2.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.ZakFoe_3, "./Resources/Graphics/Foe/ZakFoe3.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Chandelier_1, "./Resources/Graphics/Foe/chandelier.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Hag_1, "./Resources/Graphics/Foe/Hag_1.png");
                    ResourceMaster.AddImg(resourceids_1.BitmapId.Hag_2, "./Resources/Graphics/Foe/Hag_2.png");
                }
                loadNPCResources() {
                }
                loadAudioResources() {
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Init, "./Resources/Sound/Init.wav");
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Fout, "./Resources/Sound/Fout.wav");
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Selectie, "./Resources/Sound/Selectie.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Init, { AudioId: resourceids_1.AudioId.Init, Priority: -1 });
                    this.SoundEffectList.set(resourceids_1.AudioId.Fout, { AudioId: resourceids_1.AudioId.Fout, Priority: 0 });
                    this.SoundEffectList.set(resourceids_1.AudioId.Selectie, { AudioId: resourceids_1.AudioId.Selectie, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Heart, "./Resources/Sound/Heart.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Heart, { AudioId: resourceids_1.AudioId.Heart, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Hit, "./Resources/Sound/Hit.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Hit, { AudioId: resourceids_1.AudioId.Hit, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.ItemDrop, "./Resources/Sound/Item_drop.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.ItemDrop, { AudioId: resourceids_1.AudioId.ItemDrop, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.ItemPickup, "./Resources/Sound/Item_pickup.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.ItemPickup, { AudioId: resourceids_1.AudioId.ItemPickup, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.KeyGrab, "./Resources/Sound/Key_grab.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.KeyGrab, { AudioId: resourceids_1.AudioId.KeyGrab, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Knife, "./Resources/Sound/Knife.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Knife, { AudioId: resourceids_1.AudioId.Knife, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Land, "./Resources/Sound/Land.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Land, { AudioId: resourceids_1.AudioId.Land, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Lightning, "./Resources/Sound/Lightning.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Lightning, { AudioId: resourceids_1.AudioId.Lightning, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Munnies, "./Resources/Sound/Munnies.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Munnies, { AudioId: resourceids_1.AudioId.Munnies, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.PlayerDamage, "./Resources/Sound/Player_damage.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.PlayerDamage, { AudioId: resourceids_1.AudioId.PlayerDamage, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Portal, "./Resources/Sound/Portal.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Portal, { AudioId: resourceids_1.AudioId.Portal, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Wall_break, "./Resources/Sound/Wall_break.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Wall_break, { AudioId: resourceids_1.AudioId.Wall_break, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Whip, "./Resources/Sound/Whip.wav");
                    this.SoundEffectList.set(resourceids_1.AudioId.Whip, { AudioId: resourceids_1.AudioId.Whip, Priority: 0 });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Boss, "./Resources/Music/Boss.wav");
                    this.MusicList.set(resourceids_1.AudioId.Boss, { Music: resourceids_1.AudioId.Boss, Loop: true, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Ending, "./Resources/Music/Ending.wav");
                    this.MusicList.set(resourceids_1.AudioId.Ending, { Music: resourceids_1.AudioId.Ending, Loop: true, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Humiliation, "./Resources/Music/Humiliation.wav");
                    this.MusicList.set(resourceids_1.AudioId.Humiliation, { Music: resourceids_1.AudioId.Humiliation, Loop: false, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Huray, "./Resources/Music/Huray.wav");
                    this.MusicList.set(resourceids_1.AudioId.Huray, { Music: resourceids_1.AudioId.Huray, Loop: false, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Ohnoes, "./Resources/Music/Ohnoes.wav");
                    this.MusicList.set(resourceids_1.AudioId.Ohnoes, { Music: resourceids_1.AudioId.Ohnoes, Loop: false, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Prologue, "./Resources/Music/Prologue.wav");
                    this.MusicList.set(resourceids_1.AudioId.Prologue, { Music: resourceids_1.AudioId.Prologue, Loop: false, NextSong: null });
                    ResourceMaster.AddSnd(resourceids_1.AudioId.Stage, "./Resources/Music/Stage.wav");
                    this.MusicList.set(resourceids_1.AudioId.Stage, { Music: resourceids_1.AudioId.Stage, Loop: true, NextSong: null });
                }
            };
            exports_16("ResourceMaster", ResourceMaster);
        }
    };
});
System.register("src/room", ["BoazEngineJS/msx", "BoazEngineJS/direction", "src/gameconstants", "BoazEngineJS/engine", "BoazEngineJS/resourceids", "src/resourcemaster"], function (exports_17, context_17) {
    "use strict";
    var msx_2, direction_1, gameconstants_1, engine_4, resourceids_2, resourcemaster_1, Room;
    var __moduleName = context_17 && context_17.id;
    return {
        setters: [
            function (msx_2_1) {
                msx_2 = msx_2_1;
            },
            function (direction_1_1) {
                direction_1 = direction_1_1;
            },
            function (gameconstants_1_1) {
                gameconstants_1 = gameconstants_1_1;
            },
            function (engine_4_1) {
                engine_4 = engine_4_1;
            },
            function (resourceids_2_1) {
                resourceids_2 = resourceids_2_1;
            },
            function (resourcemaster_1_1) {
                resourcemaster_1 = resourcemaster_1_1;
            }
        ],
        execute: function () {
            Room = class Room {
                static LoadRoom(data) {
                    var result = new Room();
                    result.Id = data.Id;
                    result.CollisionData = data.CollisionMap;
                    result.Exits = data.Exits;
                    result.initFunction = data.InitFunction;
                    result.BitmapPath = data.BitmapPath;
                    resourcemaster_1.ResourceMaster.reloadImg(resourceids_2.BitmapId.Room, data.BitmapPath);
                    return result;
                }
                InitRoom() {
                    if (this.initFunction)
                        this.initFunction(this);
                }
                TakeTurn() {
                }
                AnyCollisionsTiles(takeWallFoesIntoAccount, ...coordinatesToCheck) {
                    return coordinatesToCheck.some(x => this.IsCollisionTile(x.x, x.y, takeWallFoesIntoAccount));
                }
                NearingRoomExit(x, y) {
                    let _x = x / msx_2.TileSize;
                    let _y = y / msx_2.TileSize;
                    let result = { destRoom: Room.NO_ROOM_EXIT, direction: direction_1.Direction.None };
                    if ((x < 0)) {
                        let dest = this.RoomExit(direction_1.Direction.Left);
                        result = { destRoom: dest, direction: direction_1.Direction.Left };
                    }
                    else if ((_x >= gameconstants_1.GameConstants.StageScreenWidthTiles)) {
                        let dest = this.RoomExit(direction_1.Direction.Right);
                        result = { destRoom: dest, direction: direction_1.Direction.Right };
                    }
                    else if ((_y < 2)) {
                        let dest = this.RoomExit(direction_1.Direction.Up);
                        result = { destRoom: dest, direction: direction_1.Direction.Up };
                    }
                    else if ((_y >= gameconstants_1.GameConstants.StageScreenHeightTiles)) {
                        let dest = this.RoomExit(direction_1.Direction.Down);
                        result = { destRoom: dest, direction: direction_1.Direction.Down };
                    }
                    return result;
                }
                IsCollisionTile(x, y, takeWallFoesIntoAccount) {
                    let TileSize = 0;
                    let DirectionDown = 0;
                    let DirectionLeft = 0;
                    let DirectionRight = 0;
                    let DirectionUp = 0;
                    let CSStageScreenWidthTiles = 0;
                    let CSStageScreenHeightTiles = 0;
                    let _x = (x / TileSize);
                    let _y = (y / TileSize);
                    if ((x < 0)) {
                        if (this.CanLeaveRoom(DirectionLeft)) {
                            _x = 0;
                        }
                        else {
                            return true;
                        }
                    }
                    else if ((_x >= CSStageScreenWidthTiles)) {
                        if (this.CanLeaveRoom(DirectionRight)) {
                            _x = (CSStageScreenWidthTiles - 1);
                        }
                        else {
                            return true;
                        }
                    }
                    if (((_y < 1)
                        && (_y >= -1))) {
                        if (this.CanLeaveRoom(DirectionUp)) {
                            _y = 0;
                        }
                        else {
                            return true;
                        }
                    }
                    else if ((_y >= CSStageScreenHeightTiles)) {
                        if (this.CanLeaveRoom(DirectionDown)) {
                            _y = (CSStageScreenHeightTiles - 1);
                        }
                        else {
                            return true;
                        }
                    }
                    if ((this.CollisionData[_y][_x] != '.')) {
                        return true;
                    }
                    return false;
                }
                RoomExit(dir) {
                    let RoomExitsLocked = true;
                    if (RoomExitsLocked) {
                        return Room.NO_ROOM_EXIT;
                    }
                    return this.Exits[(dir)];
                }
                CanLeaveRoom(dir) {
                    let RoomExitsLocked = true;
                    if (RoomExitsLocked) {
                        return false;
                    }
                    return (this.RoomExit(dir) != Room.NO_ROOM_EXIT);
                }
                Paint() {
                    engine_4.view.DrawBitmap(this.ImageID, gameconstants_1.GameConstants.GameScreenStartX, gameconstants_1.GameConstants.GameScreenStartY);
                }
            };
            Room.RoomWidth = 0;
            Room.RoomHeight = 0;
            Room.NO_ROOM_EXIT = 0;
            exports_17("Room", Room);
        }
    };
});
System.register("BoazEngineJS/common", ["BoazEngineJS/direction"], function (exports_18, context_18) {
    "use strict";
    var direction_2;
    var __moduleName = context_18 && context_18.id;
    function moveArea(a, p) {
        return {
            start: { x: a.start.x + p.x, y: a.start.y + p.y },
            end: { x: a.end.x + p.x, y: a.end.y + p.y },
        };
    }
    exports_18("moveArea", moveArea);
    function addPoints(a, b) {
        return { x: a.x + b.x, y: a.y + b.y };
    }
    exports_18("addPoints", addPoints);
    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1) + min);
    }
    exports_18("randomInt", randomInt);
    function newPoint(x, y) {
        return { x: x, y: y };
    }
    exports_18("newPoint", newPoint);
    function copyPoint(toCopy) {
        return { x: toCopy.x, y: toCopy.y };
    }
    exports_18("copyPoint", copyPoint);
    function newArea(sx, sy, ex, ey) {
        return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
    }
    exports_18("newArea", newArea);
    function newSize(x, y) {
        return { x: x, y: y };
    }
    exports_18("newSize", newSize);
    function setPoint(p, new_x, new_y) {
        p.x = new_x;
        p.y = new_y;
    }
    exports_18("setPoint", setPoint);
    function setSize(s, new_x, new_y) {
        s.x = new_x;
        s.y = new_y;
    }
    exports_18("setSize", setSize);
    function area2size(a) {
        return { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
    }
    exports_18("area2size", area2size);
    function waitDuration(timer, duration) {
        if (!timer.running)
            timer.restart();
        if (timer.elapsedMilliseconds >= duration) {
            timer.restart();
            return true;
        }
        return false;
    }
    exports_18("waitDuration", waitDuration);
    function addToScreen(element) {
        let gamescreen = document.getElementById('gamescreen');
        gamescreen.appendChild(element);
    }
    exports_18("addToScreen", addToScreen);
    function removeFromScreen(element) {
        let gamescreen = document.getElementById('gamescreen');
        gamescreen.removeChild(element);
    }
    exports_18("removeFromScreen", removeFromScreen);
    function createDivSprite(img, imgsrc, classnames) {
        let result = document.createElement('div');
        if (classnames) {
            classnames.forEach(x => {
                result.classList.add(x);
            });
        }
        let rimg = document.createElement('img');
        if (imgsrc)
            rimg.src = imgsrc;
        else if (img)
            rimg.src = img.src;
        else
            throw ('Cannot create sprite without an image or image source!');
        result.appendChild(rimg);
        return result;
    }
    exports_18("createDivSprite", createDivSprite);
    function GetDeltaFromSourceToTarget(source, target) {
        let delta = { x: 0, y: 0 };
        if (Math.abs(target.x - source.x - 0) < 0.01) {
            delta.x = 0;
            delta.y = (target.y - source.y) > 0 ? 1 : -1;
        }
        else if (Math.abs(target.y - source.y - 0) < 0.01) {
            delta.x = (target.x - source.x) > 0 ? 1 : -1;
            delta.y = 0;
        }
        else if (Math.abs((target.x - source.x)) > Math.abs((target.y - source.y))) {
            delta.x = (target.x - source.x) > 0 ? 1 : -1;
            delta.y = (target.y - source.y) / (Math.abs(target.x - source.x));
        }
        else {
            delta.x = (target.x - source.x) / (Math.abs(target.y - source.y));
            delta.y = (target.y - source.y) > 0 ? 1 : -1;
        }
        return delta;
    }
    exports_18("GetDeltaFromSourceToTarget", GetDeltaFromSourceToTarget);
    function LineLength(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - 1;
    }
    exports_18("LineLength", LineLength);
    function storageAvailable(type) {
        try {
            var storage = window[type], x = '__storage_test__';
            storage.setItem(x, x);
            storage.removeItem(x);
            return true;
        }
        catch (e) {
            return e instanceof DOMException && (e.code === 22 ||
                e.code === 1014 ||
                e.name === 'QuotaExceededError' ||
                e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
                storage.length !== 0;
        }
    }
    exports_18("storageAvailable", storageAvailable);
    function localStorageAvailable() {
        return storageAvailable('localStorage');
    }
    exports_18("localStorageAvailable", localStorageAvailable);
    function sessionStorageAvailable() {
        return storageAvailable('sessionStorage');
    }
    exports_18("sessionStorageAvailable", sessionStorageAvailable);
    function LookAt(subjectpos, targetpos) {
        let delta = { x: subjectpos.x - targetpos.x, y: subjectpos.x - targetpos.y };
        if (Math.abs(delta.x) >= Math.abs(delta.y)) {
            if (delta.x < 0)
                return direction_2.Direction.Right;
            else
                return direction_2.Direction.Left;
        }
        else {
            if (delta.y < 0)
                return direction_2.Direction.Down;
            else
                return direction_2.Direction.Up;
        }
    }
    exports_18("LookAt", LookAt);
    function Opposite(dir) {
        switch (dir) {
            case direction_2.Direction.Up:
                return direction_2.Direction.Down;
            case direction_2.Direction.Right:
                return direction_2.Direction.Left;
            case direction_2.Direction.Down:
                return direction_2.Direction.Up;
            case direction_2.Direction.Left:
                return direction_2.Direction.Right;
            default:
                return direction_2.Direction.None;
        }
    }
    exports_18("Opposite", Opposite);
    return {
        setters: [
            function (direction_2_1) {
                direction_2 = direction_2_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("BoazEngineJS/sprite", ["BoazEngineJS/engine", "BoazEngineJS/common"], function (exports_19, context_19) {
    "use strict";
    var engine_5, common_1, Sprite;
    var __moduleName = context_19 && context_19.id;
    return {
        setters: [
            function (engine_5_1) {
                engine_5 = engine_5_1;
            },
            function (common_1_1) {
                common_1 = common_1_1;
            }
        ],
        execute: function () {
            Sprite = class Sprite {
                constructor(initialPos, imageId) {
                    this.postpaint = (offset) => {
                    };
                    this.objectCollide = (o) => {
                        return this.areaCollide(common_1.moveArea(o.hitarea, o.pos));
                    };
                    this.areaCollide = (a) => {
                        let o1 = this;
                        let o1p = o1.pos;
                        let o1a = o1.hitarea;
                        let o2a = a;
                        return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
                            o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
                    };
                    this.id = null;
                    this.pos = initialPos || { x: 0, y: 0 };
                    this.size = { x: 0, y: 0 };
                    this.hitarea = {
                        start: { x: 0, y: 0 },
                        end: { x: 0, y: 0 }
                    };
                    this.visible = true;
                    this.hittable = true;
                    this.flippedH = false;
                    this.flippedV = false;
                    this.priority = 0;
                    this.rawAscii = false;
                    this.disposeFlag = false;
                    this.imgid = null;
                    this.extendedProperties = new Map();
                    if (imageId)
                        this.imgid = imageId;
                }
                spawn(spawningPos) {
                    if (spawningPos)
                        this.pos = spawningPos;
                }
                exile() {
                    throw new Error("Method not implemented.");
                }
                takeTurn() {
                }
                paint(offset) {
                    engine_5.view.drawImg(this.imgid, offset ? common_1.addPoints(this.pos, offset) : this.pos);
                }
                collide(o) {
                    if (o.id)
                        return this.objectCollide(o);
                    else
                        return this.areaCollide(o);
                }
                inside(p) {
                    let o1 = this;
                    let o1p = o1.pos;
                    let o1a = o1.hitarea;
                    return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
                        o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
                }
                handleResizeEvent() {
                    throw new Error("Method not implemented.");
                }
                setExtendedProperty(key, value) {
                    this.extendedProperties.set(key, value);
                }
            };
            Sprite.objectCollide = (o1, o2) => {
                return o1.objectCollide(o2);
            };
            exports_19("Sprite", Sprite);
        }
    };
});
System.register("src/creature", ["BoazEngineJS/sprite", "BoazEngineJS/common", "BoazEngineJS/direction", "src/sintervaniamodel", "BoazEngineJS/msx", "BoazEngineJS/engine", "BoazEngineJS/constants"], function (exports_20, context_20) {
    "use strict";
    var sprite_1, common_2, direction_3, sintervaniamodel_1, msx_3, engine_6, constants_3, Creature;
    var __moduleName = context_20 && context_20.id;
    return {
        setters: [
            function (sprite_1_1) {
                sprite_1 = sprite_1_1;
            },
            function (common_2_1) {
                common_2 = common_2_1;
            },
            function (direction_3_1) {
                direction_3 = direction_3_1;
            },
            function (sintervaniamodel_1_1) {
                sintervaniamodel_1 = sintervaniamodel_1_1;
            },
            function (msx_3_1) {
                msx_3 = msx_3_1;
            },
            function (engine_6_1) {
                engine_6 = engine_6_1;
            },
            function (constants_3_1) {
                constants_3 = constants_3_1;
            }
        ],
        execute: function () {
            Creature = class Creature extends sprite_1.Sprite {
                constructor(p) {
                    super(p);
                    this.currentWalkAnimationFrame = 0;
                    this.customId = null;
                    this.originPos = { x: this.pos.x, y: this.pos.y };
                }
                get WallHitArea() {
                    return this.hitarea;
                }
                set WallHitArea(value) {
                }
                get Direction() {
                    return this._direction;
                }
                set Direction(value) {
                    this.OldDirection = this._direction;
                    this._direction = value;
                }
                Paint(offset = null) {
                    if (this.disposeFlag || !this.visible)
                        return;
                    let options = this.flippedH ? constants_3.Constants.DRAWBITMAP_HFLIP : 0;
                    if (offset == null)
                        engine_6.view.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
                    else
                        engine_6.view.DrawBitmap(this.imgid, this.pos.x + offset.x, this.pos.y + offset.y, options);
                }
                get id() {
                    return this.customId != null ? this.customId : `${this.constructor.name}:${sintervaniamodel_1.GameModel._.CurrentRoom.Id}:${this.originPos.x},${this.originPos.y}`;
                }
                set id(value) {
                    this.customId = value;
                }
                DetermineFrame() {
                    this.imgid = this.movementSprites[this.Direction][this.currentWalkAnimationFrame];
                    this.flippedH = this.Direction == direction_3.Direction.Right;
                }
                AnimateMovement(movedDistance) {
                    if (movedDistance > 0) {
                        this.moveLeftBeforeFrameChange -= movedDistance;
                        if (this.moveLeftBeforeFrameChange < 0) {
                            this.moveLeftBeforeFrameChange = this.moveBeforeFrameChange;
                            if (++this.currentWalkAnimationFrame >= this.movementSprites[this.Direction].Length) {
                                this.currentWalkAnimationFrame = 1;
                            }
                        }
                    }
                    else {
                        this.currentWalkAnimationFrame = 0;
                        this.DetermineFrame();
                    }
                }
                checkWallSpriteCollisions() {
                    return sintervaniamodel_1.GameModel._.objects.filter(o => o != this && o.extendedProperties[sintervaniamodel_1.GameModel.PROPERTY_ACT_AS_WALL] && o.hittable).some(o => o.areaCollide(common_2.moveArea(this.WallHitArea, this.pos)));
                }
                checkWallCollision() {
                    let startx = this.pos.x + this.WallHitArea.start.x;
                    let starty = this.pos.y + this.WallHitArea.start.y;
                    let endx = this.pos.x + this.WallHitArea.end.x;
                    let endy = this.pos.y + this.WallHitArea.end.y;
                    switch (this.Direction) {
                        case direction_3.Direction.Up:
                            return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true);
                        case direction_3.Direction.Right:
                            return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                        case direction_3.Direction.Down:
                            return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                        case direction_3.Direction.Left:
                            return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true);
                        case direction_3.Direction.None:
                            return sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_1.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                        default:
                            return false;
                    }
                }
                handleWallCollision() {
                    switch (this.Direction) {
                        case direction_3.Direction.Up:
                            if (this.pos.y >= 0)
                                this.pos.y = (this.pos.y / msx_3.TileSize + 1) * msx_3.TileSize;
                            this.pos.y = this.pos.y / msx_3.TileSize * msx_3.TileSize;
                            break;
                        case direction_3.Direction.Right:
                            this.pos.x = this.pos.x / msx_3.TileSize * msx_3.TileSize;
                            break;
                        case direction_3.Direction.Down:
                            this.pos.y = this.pos.y / msx_3.TileSize * msx_3.TileSize;
                            break;
                        case direction_3.Direction.Left:
                            if (this.pos.x >= 0)
                                this.pos.x = (this.pos.x / msx_3.TileSize + 1) * msx_3.TileSize;
                            this.pos.x = this.pos.x / msx_3.TileSize * msx_3.TileSize;
                            break;
                    }
                }
            };
            exports_20("Creature", Creature);
        }
    };
});
System.register("src/projectile", ["BoazEngineJS/sprite", "BoazEngineJS/direction", "BoazEngineJS/common", "BoazEngineJS/constants", "src/sintervaniamodel", "BoazEngineJS/engine"], function (exports_21, context_21) {
    "use strict";
    var sprite_2, direction_4, common_3, constants_4, sintervaniamodel_2, engine_7, Projectile;
    var __moduleName = context_21 && context_21.id;
    return {
        setters: [
            function (sprite_2_1) {
                sprite_2 = sprite_2_1;
            },
            function (direction_4_1) {
                direction_4 = direction_4_1;
            },
            function (common_3_1) {
                common_3 = common_3_1;
            },
            function (constants_4_1) {
                constants_4 = constants_4_1;
            },
            function (sintervaniamodel_2_1) {
                sintervaniamodel_2 = sintervaniamodel_2_1;
            },
            function (engine_7_1) {
                engine_7 = engine_7_1;
            }
        ],
        execute: function () {
            Projectile = class Projectile extends sprite_2.Sprite {
                constructor(pos, speed) {
                    super({ x: pos.x, y: pos.y });
                    this.speed = speed;
                }
                Paint(offset = null) {
                    if (this.disposeFlag || !this.visible)
                        return;
                    let options = this.flippedH ? constants_4.Constants.DRAWBITMAP_HFLIP : 0;
                    options = options || this.flippedV ? constants_4.Constants.DRAWBITMAP_VFLIP : 0;
                    engine_7.view.DrawBitmap(this.imgid, this.pos.x, this.pos.y, options);
                }
                checkWallSpriteCollisions() {
                    return sintervaniamodel_2.GameModel._.objects.filter(o => o.extendedProperties[sintervaniamodel_2.GameModel.PROPERTY_ACT_AS_WALL]).some(o => o.areaCollide(common_3.moveArea(this.hitarea, this.pos)));
                }
                checkWallCollision() {
                    let startx = this.pos.x + this.hitarea.start.x;
                    let starty = this.pos.y + this.hitarea.start.y;
                    let endx = this.pos.x + this.hitarea.end.x;
                    let endy = this.pos.y + this.hitarea.end.y;
                    switch (this.Direction) {
                        case direction_4.Direction.Up:
                            return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true);
                        case direction_4.Direction.Right:
                            return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                        case direction_4.Direction.Down:
                            return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(endx, endy, true);
                        case direction_4.Direction.Left:
                            return sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, starty, true) || sintervaniamodel_2.GameModel._.CurrentRoom.IsCollisionTile(startx, endy, true);
                        default:
                            return false;
                    }
                }
            };
            exports_21("Projectile", Projectile);
        }
    };
});
System.register("src/pprojectile", ["src/projectile", "src/sintervaniamodel"], function (exports_22, context_22) {
    "use strict";
    var projectile_1, sintervaniamodel_3, PlayerProjectile;
    var __moduleName = context_22 && context_22.id;
    return {
        setters: [
            function (projectile_1_1) {
                projectile_1 = projectile_1_1;
            },
            function (sintervaniamodel_3_1) {
                sintervaniamodel_3 = sintervaniamodel_3_1;
            }
        ],
        execute: function () {
            PlayerProjectile = class PlayerProjectile extends projectile_1.Projectile {
                constructor(fpos, speed) {
                    super(fpos, speed);
                    this.foesThatWereHit = new Array();
                }
                CheckAndInvokeHit() {
                    let enemyWasHit = false;
                    sintervaniamodel_3.GameModel._.Foes.filter(f => f.hittable && this.objectCollide(f)).filter((f) => !this.foesThatWereHit.includes(f)).forEach((f) => {
                        this.foesThatWereHit.push(f);
                        f.HandleHit(this);
                        enemyWasHit = true;
                    });
                    return enemyWasHit;
                }
            };
            exports_22("PlayerProjectile", PlayerProjectile);
        }
    };
});
System.register("src/bootstrapper", ["src/sintervaniamodel", "BoazEngineJS/common", "BoazEngineJS/msx"], function (exports_23, context_23) {
    "use strict";
    var sintervaniamodel_4, common_4, msx_4, Bootstrapper;
    var __moduleName = context_23 && context_23.id;
    return {
        setters: [
            function (sintervaniamodel_4_1) {
                sintervaniamodel_4 = sintervaniamodel_4_1;
            },
            function (common_4_1) {
                common_4 = common_4_1;
            },
            function (msx_4_1) {
                msx_4 = msx_4_1;
            }
        ],
        execute: function () {
            Bootstrapper = class Bootstrapper {
                static BootstrapGame(chapter) {
                    switch (chapter) {
                        case sintervaniamodel_4.Chapter.Debug:
                            Bootstrapper.bootstrapGameForDebug();
                            break;
                        case sintervaniamodel_4.Chapter.GameStart:
                            Bootstrapper.bootstrapGameForGameStart();
                            break;
                    }
                }
                static bootstrapGameForGameStart() {
                    sintervaniamodel_4.GameModel._.LoadRoom(1);
                    common_4.setPoint(sintervaniamodel_4.GameModel._.Belmont.pos, msx_4.Tile.ToCoord(15), msx_4.Tile.ToCoord(10));
                }
                static bootstrapGameForDebug() {
                    sintervaniamodel_4.GameModel._.LoadRoom(100);
                    common_4.setPoint(sintervaniamodel_4.GameModel._.Belmont.pos, msx_4.Tile.ToCoord(15), msx_4.Tile.ToCoord(10));
                }
            };
            exports_23("Bootstrapper", Bootstrapper);
        }
    };
});
System.register("BoazEngineJS/savegame", [], function (exports_24, context_24) {
    "use strict";
    var Savegame;
    var __moduleName = context_24 && context_24.id;
    return {
        setters: [],
        execute: function () {
            Savegame = class Savegame {
            };
            exports_24("Savegame", Savegame);
        }
    };
});
System.register("src/weaponitem", ["BoazEngineJS/sprite", "src/sintervaniamodel", "src/item", "BoazEngineJS/resourceids", "BoazEngineJS/common", "src/gamecontroller"], function (exports_25, context_25) {
    "use strict";
    var sprite_3, sintervaniamodel_5, item_1, resourceids_3, common_5, gamecontroller_1, WeaponItem, WeaponType;
    var __moduleName = context_25 && context_25.id;
    return {
        setters: [
            function (sprite_3_1) {
                sprite_3 = sprite_3_1;
            },
            function (sintervaniamodel_5_1) {
                sintervaniamodel_5 = sintervaniamodel_5_1;
            },
            function (item_1_1) {
                item_1 = item_1_1;
            },
            function (resourceids_3_1) {
                resourceids_3 = resourceids_3_1;
            },
            function (common_5_1) {
                common_5 = common_5_1;
            },
            function (gamecontroller_1_1) {
                gamecontroller_1 = gamecontroller_1_1;
            }
        ],
        execute: function () {
            WeaponItem = class WeaponItem extends sprite_3.Sprite {
                constructor(type, pos) {
                    super(pos);
                    this.ItsType = type;
                    this.hitarea = item_1.Item.ItemHitArea;
                    this.size = common_5.area2size(item_1.Item.ItemHitArea);
                    this.imgid = WeaponItem.Type2Image(type);
                }
                static WeaponItem2SecWeaponType(weaponItem) {
                    if (weaponItem == null)
                        return sintervaniamodel_5.SecWeaponType.None;
                    switch (weaponItem.Type) {
                        case WeaponType.None:
                        default:
                            return sintervaniamodel_5.SecWeaponType.None;
                        case WeaponType.Cross:
                            return sintervaniamodel_5.SecWeaponType.Cross;
                    }
                }
                static SecWeaponType2WeaponItemType(secWeapontype) {
                    switch (secWeapontype) {
                        case sintervaniamodel_5.SecWeaponType.None:
                        default:
                            return WeaponType.None;
                        case sintervaniamodel_5.SecWeaponType.Cross:
                            return WeaponType.Cross;
                    }
                }
                TakeTurn() {
                    if (this.areaCollide(common_5.moveArea(sintervaniamodel_5.GameModel._.Belmont.RoomCollisionArea, sintervaniamodel_5.GameModel._.Belmont.pos))) {
                        gamecontroller_1.GameController._.PickupWeaponItem(this);
                        this.disposeFlag = true;
                    }
                }
                static Type2Image(type) {
                    switch (type) {
                        default:
                            return resourceids_3.BitmapId.None;
                    }
                }
                Dispose() {
                }
            };
            WeaponItem.ItemHitArea = {
                start: { x: 0, y: 0 }, end: { x: 16, y: 16 }
            };
            WeaponItem.Descriptions = new Map();
            exports_25("WeaponItem", WeaponItem);
            (function (WeaponType) {
                WeaponType[WeaponType["None"] = -1] = "None";
                WeaponType[WeaponType["Cross"] = 0] = "Cross";
            })(WeaponType || (WeaponType = {}));
            exports_25("WeaponType", WeaponType);
        }
    };
});
System.register("BoazEngineJS/event", [], function (exports_26, context_26) {
    "use strict";
    var InputEvent, ClickEvent, MoveEvent, KeydownEvent, KeyupEvent, BlurEvent, TouchStartEvent, TouchMoveEvent, TouchEndEvent;
    var __moduleName = context_26 && context_26.id;
    return {
        setters: [],
        execute: function () {
            InputEvent = class InputEvent {
                constructor() {
                    this.fire = (source, ...args) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, args);
                        }
                    };
                    this.subscribe = (subscriber) => {
                        this.subscribers.push(subscriber);
                    };
                    this.subscribers = [];
                }
            };
            exports_26("InputEvent", InputEvent);
            ClickEvent = class ClickEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, x, y) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, x, y);
                        }
                    };
                }
            };
            exports_26("ClickEvent", ClickEvent);
            MoveEvent = class MoveEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, x, y) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, x, y);
                        }
                    };
                }
            };
            exports_26("MoveEvent", MoveEvent);
            KeydownEvent = class KeydownEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, keycode) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, keycode);
                        }
                    };
                }
            };
            exports_26("KeydownEvent", KeydownEvent);
            KeyupEvent = class KeyupEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, keycode) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, keycode);
                        }
                    };
                }
            };
            exports_26("KeyupEvent", KeyupEvent);
            BlurEvent = class BlurEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source);
                        }
                    };
                }
            };
            exports_26("BlurEvent", BlurEvent);
            TouchStartEvent = class TouchStartEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, event) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, event);
                        }
                    };
                }
            };
            exports_26("TouchStartEvent", TouchStartEvent);
            TouchMoveEvent = class TouchMoveEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, event) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, event);
                        }
                    };
                }
            };
            exports_26("TouchMoveEvent", TouchMoveEvent);
            TouchEndEvent = class TouchEndEvent extends InputEvent {
                constructor() {
                    super();
                    this.fire = (source, event) => {
                        for (let i = 0; i < this.subscribers.length; i++) {
                            this.subscribers[i](source, event);
                        }
                    };
                }
            };
            exports_26("TouchEndEvent", TouchEndEvent);
        }
    };
});
System.register("BoazEngineJS/input", ["BoazEngineJS/event"], function (exports_27, context_27) {
    "use strict";
    var Event, mouseMoved, mouseClicked, keydowned, keyupped, blurred, touchStarted, touchMoved, touchEnded, KeyState;
    var __moduleName = context_27 && context_27.id;
    function mouseMove(source, x, y) {
        mouseMoved.fire(source, x, y);
    }
    exports_27("mouseMove", mouseMove);
    function mouseClick(source, x, y) {
        mouseClicked.fire(source, x, y);
    }
    exports_27("mouseClick", mouseClick);
    function keydown(source, keycode) {
        keydowned.fire(source, keycode);
    }
    exports_27("keydown", keydown);
    function keyup(source, keycode) {
        keyupped.fire(source, keycode);
    }
    exports_27("keyup", keyup);
    function blur(source) {
        blurred.fire(source);
    }
    exports_27("blur", blur);
    function touchStart(source, evt) {
        touchStarted.fire(source, evt);
    }
    exports_27("touchStart", touchStart);
    function touchMove(source, evt) {
        touchMoved.fire(source, evt);
    }
    exports_27("touchMove", touchMove);
    function touchEnd(source, evt) {
        touchEnded.fire(source, evt);
    }
    exports_27("touchEnd", touchEnd);
    function getMousePos(evt) {
        return { x: 0, y: 0 };
    }
    exports_27("getMousePos", getMousePos);
    function init() {
        exports_27("KeyState", KeyState = {
            KC_UP: false,
            KC_RIGHT: false,
            KC_DOWN: false,
            KC_LEFT: false,
            KC_SPACE: false,
            KC_M: false,
            KU_UP: false,
            KU_RIGHT: false,
            KU_DOWN: false,
            KU_LEFT: false,
            KU_SPACE: false,
            KU_M: false,
            KD_UP: false,
            KD_RIGHT: false,
            KD_DOWN: false,
            KD_LEFT: false,
            KD_SPACE: false,
            KD_M: false
        });
    }
    exports_27("init", init);
    return {
        setters: [
            function (Event_1) {
                Event = Event_1;
            }
        ],
        execute: function () {
            exports_27("mouseMoved", mouseMoved = new Event.MoveEvent());
            exports_27("mouseClicked", mouseClicked = new Event.ClickEvent());
            exports_27("keydowned", keydowned = new Event.KeydownEvent());
            exports_27("keyupped", keyupped = new Event.KeyupEvent());
            exports_27("blurred", blurred = new Event.BlurEvent());
            exports_27("touchStarted", touchStarted = new Event.TouchStartEvent());
            exports_27("touchMoved", touchMoved = new Event.TouchMoveEvent());
            exports_27("touchEnded", touchEnded = new Event.TouchEndEvent());
        }
    };
});
System.register("BoazEngineJS/animation", ["BoazEngineJS/btimer", "BoazEngineJS/common"], function (exports_28, context_28) {
    "use strict";
    var btimer_2, common_6, Animation;
    var __moduleName = context_28 && context_28.id;
    function createAniData(data, times, constantStepTime) {
        if (!times && !constantStepTime)
            throw ("Either [times] or [constantStepTime] must be given when creating a new animation!");
        let result = new Array();
        let i = 0;
        for (let d of data) {
            result.push({ time: times ? times[i] : constantStepTime, data: d });
            ++i;
        }
        return result;
    }
    function wrapInAniCompound(scalarStepValue) {
        return { nextStepValue: scalarStepValue };
    }
    return {
        setters: [
            function (btimer_2_1) {
                btimer_2 = btimer_2_1;
            },
            function (common_6_1) {
                common_6 = common_6_1;
            }
        ],
        execute: function () {
            Animation = class Animation {
                constructor(dataAndOrTime, timesOrConstantStepTime, repeat) {
                    if (timesOrConstantStepTime) {
                        if (Array.isArray(timesOrConstantStepTime)) {
                            let aniData = createAniData(dataAndOrTime, timesOrConstantStepTime, undefined);
                            this.animationDataAndTime = aniData;
                        }
                        else {
                            this.constantStepTime = timesOrConstantStepTime;
                            let aniData = createAniData(dataAndOrTime, undefined, timesOrConstantStepTime);
                            this.animationDataAndTime = aniData;
                        }
                    }
                    else {
                        this.animationDataAndTime = dataAndOrTime;
                    }
                    this.currentStepTime = 0;
                    this.repeat = repeat || false;
                    this.stepCounter = 0;
                }
                stepValue() {
                    return this.animationDataAndTime[this.stepCounter].data;
                }
                stepTime() {
                    if (this.constantStepTime != null)
                        return this.constantStepTime;
                    return this.animationDataAndTime[this.stepCounter].time;
                }
                hasNext() {
                    return this.stepCounter < this.animationDataAndTime.length - 1;
                }
                finished() {
                    return this.stepCounter >= this.animationDataAndTime.length;
                }
                nextStep() {
                    ++this.stepCounter;
                    if (!this.finished())
                        return this.stepValue();
                    else {
                        if (this.repeat) {
                            this.stepCounter = 0;
                            return this.stepValue();
                        }
                        else
                            return null;
                    }
                }
                doAnimation(timer, nextStepRef) {
                    if (!nextStepRef) {
                        if (timer instanceof btimer_2.BStopwatch)
                            return this.doAnimationTimer(timer);
                        return this.doAnimationStep(timer);
                    }
                    else {
                        let nextStepReturned = null;
                        if (this.waitForNextStep(timer)) {
                            nextStepReturned = this.nextStep();
                            nextStepRef.nextStepValue = nextStepReturned;
                            return { value: nextStepReturned, next: true };
                        }
                        return { value: null, next: false };
                    }
                }
                doAnimationTimer(timer) {
                    let nextStep = null;
                    if (this.waitForNextStep(timer)) {
                        nextStep = this.nextStep();
                        return { value: nextStep, next: true };
                    }
                    return { value: null, next: false };
                }
                doAnimationStep(step) {
                    let nextStep = null;
                    this.currentStepTime += step;
                    if (this.currentStepTime >= this.stepTime()) {
                        this.currentStepTime = 0;
                        nextStep = this.nextStep();
                        return { value: nextStep, next: true };
                    }
                    nextStep = this.stepValue();
                    return { value: nextStep, next: false };
                }
                waitForNextStep(timer) {
                    return common_6.waitDuration(timer, this.stepTime());
                }
                restart() {
                    this.stepCounter = 0;
                }
            };
            exports_28("Animation", Animation);
        }
    };
});
System.register("src/belmont", ["BoazEngineJS/direction", "src/creature", "BoazEngineJS/btimer", "src/gameconstants", "BoazEngineJS/common", "BoazEngineJS/animation", "BoazEngineJS/msx", "BoazEngineJS/resourceids", "BoazEngineJS/input", "src/room", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/sintervaniamodel", "BoazEngineJS/engine", "BoazEngineJS/view"], function (exports_29, context_29) {
    "use strict";
    var direction_5, creature_1, btimer_3, gameconstants_2, common_7, animation_1, msx_5, resourceids_4, input_1, room_1, common_8, soundmaster_2, resourcemaster_2, gamecontroller_2, sintervaniamodel_6, engine_8, view_2, RoeState, Belmont, State, JumpState, HitState, HitStateStep, DyingState;
    var __moduleName = context_29 && context_29.id;
    return {
        setters: [
            function (direction_5_1) {
                direction_5 = direction_5_1;
            },
            function (creature_1_1) {
                creature_1 = creature_1_1;
            },
            function (btimer_3_1) {
                btimer_3 = btimer_3_1;
            },
            function (gameconstants_2_1) {
                gameconstants_2 = gameconstants_2_1;
            },
            function (common_7_1) {
                common_7 = common_7_1;
                common_8 = common_7_1;
            },
            function (animation_1_1) {
                animation_1 = animation_1_1;
            },
            function (msx_5_1) {
                msx_5 = msx_5_1;
            },
            function (resourceids_4_1) {
                resourceids_4 = resourceids_4_1;
            },
            function (input_1_1) {
                input_1 = input_1_1;
            },
            function (room_1_1) {
                room_1 = room_1_1;
            },
            function (soundmaster_2_1) {
                soundmaster_2 = soundmaster_2_1;
            },
            function (resourcemaster_2_1) {
                resourcemaster_2 = resourcemaster_2_1;
            },
            function (gamecontroller_2_1) {
                gamecontroller_2 = gamecontroller_2_1;
            },
            function (sintervaniamodel_6_1) {
                sintervaniamodel_6 = sintervaniamodel_6_1;
            },
            function (engine_8_1) {
                engine_8 = engine_8_1;
            },
            function (view_2_1) {
                view_2 = view_2_1;
            }
        ],
        execute: function () {
            RoeState = class RoeState {
                constructor() {
                    this.aniTimer = new btimer_3.BStopwatch();
                    this.Roeing = false;
                    this.CurrentFrame = 0;
                }
                Start() {
                    this.aniTimer.restart();
                    this.Roeing = true;
                    this.CurrentFrame = 0;
                }
                Stop() {
                    this.aniTimer.stop();
                    this.Roeing = false;
                    this.CurrentFrame = 0;
                }
            };
            RoeState.msPerFrame = [50, 25, 100];
            RoeState.RoeSprites = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rw1, resourceids_4.BitmapId.Belmont_rw2, resourceids_4.BitmapId.Belmont_rw3]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lw1, resourceids_4.BitmapId.Belmont_lw2, resourceids_4.BitmapId.Belmont_lw3]],
            ]);
            RoeState.RoeSpritesCrouching = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rwd1, resourceids_4.BitmapId.Belmont_rwd2, resourceids_4.BitmapId.Belmont_rwd3]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lwd1, resourceids_4.BitmapId.Belmont_lwd2, resourceids_4.BitmapId.Belmont_lwd3]],
            ]);
            RoeState.RoeSpritePosOffset = new Map([
                [direction_5.Direction.Right, [common_8.newPoint(-16, 0), common_8.newPoint(-16, 0), common_8.newPoint(0, 0)]],
                [direction_5.Direction.Left, [common_8.newPoint(0, 0), common_8.newPoint(0, 0), common_8.newPoint(-25, 0)]],
            ]);
            RoeState.RoeSpritePosOffsetCrouching = new Map([
                [direction_5.Direction.Right, [common_8.newPoint(-16, 0), common_8.newPoint(-16, 0), common_8.newPoint(0, 0)]],
            ]);
            exports_29("RoeState", RoeState);
            Belmont = class Belmont extends creature_1.Creature {
                constructor() {
                    super(null);
                    this.EventTouchHitArea = common_7.newArea(0, 24, 16, 32);
                    this.imgid = resourceids_4.BitmapId.Belmont_r1;
                    this.flippedH = false;
                    this.CarryingShield = false;
                    this.Direction = direction_5.Direction.Right;
                    this.id = "Belmont";
                    this.state = State.Normal;
                    common_7.setSize(this.size, 16, 32);
                    this.Health = gameconstants_2.GameConstants.Belmont_MaxHealth_AtStart;
                    this.MaxHealth = gameconstants_2.GameConstants.Belmont_MaxHealth_AtStart;
                    this.Crouching = false;
                    this.hitState = new HitState();
                    this.dyingState = new DyingState();
                    this.roeState = new RoeState();
                    this.jumpState = new JumpState();
                    this.hitState.BlinkTimer = btimer_3.BStopwatch.createWatch();
                    this.hitState.RecoveryTimer = btimer_3.BStopwatch.createWatch();
                    this.hitState.CrouchTimer = btimer_3.BStopwatch.createWatch();
                    this.dyingState.aniTimer = btimer_3.BStopwatch.createWatch();
                    this.roeState.aniTimer = btimer_3.BStopwatch.createWatch();
                    this.setExtendedProperty(sintervaniamodel_6.GameModel.PROPERTY_KEEP_AT_ROOMSWITCH, true);
                }
                get HealthPercentage() {
                    return Math.min((Math.round(this.Health / this.MaxHealth * 100)), 100);
                }
                get RecoveringFromHit() {
                    return this.hitState.CurrentStep != HitStateStep.None;
                }
                get movementSpeed() {
                    return 2;
                }
                get Blink() {
                    return this.hitState.Blink;
                }
                get Dying() {
                    return this.state == State.Dying || this.state == State.Dead;
                }
                get Roeing() {
                    return this.roeState.Roeing;
                }
                get Jumping() {
                    return this.jumpState.Jumping;
                }
                get moveBeforeFrameChange() {
                    return Belmont.MoveBeforeFrameChange;
                }
                get movementSprites() {
                    if (this.CarryingShield)
                        return Belmont.MovementSpritesWShield;
                    return Belmont.MovementSpritesNoShield;
                }
                get WallHitArea() {
                    return this.EventTouchHitArea;
                }
                set WallHitArea(value) {
                }
                get EventButtonHitArea() {
                    switch (this.Direction) {
                        case direction_5.Direction.Up:
                            return Belmont.buttonPressEventHitAreaUp;
                        case direction_5.Direction.Right:
                            return Belmont.buttonPressEventHitAreaRight;
                        case direction_5.Direction.Down:
                            return Belmont.buttonPressEventHitAreaDown;
                        case direction_5.Direction.Left:
                            return Belmont.buttonPressEventHitAreaLeft;
                        default:
                            return null;
                    }
                }
                get RoomCollisionArea() {
                    return this.EventTouchHitArea;
                }
                get hitarea() {
                    return Belmont._hitarea;
                }
                set hitarea(value) {
                }
                get Vulnerable() {
                    return !this.hitState.BlinkingAndInvulnerable && !this.Dying;
                }
                ResetToDefaultFrame() {
                    this.currentWalkAnimationFrame = 0;
                    this.moveLeftBeforeFrameChange = Belmont.MoveBeforeFrameChange;
                    this.roeState.Stop();
                    this.DetermineFrame();
                    this.state = State.Normal;
                }
                GetProjectileOrigin() {
                    let result = common_7.copyPoint(this.pos);
                    switch (this.Direction) {
                        case direction_5.Direction.Right:
                            result.x += 8;
                            result.y += 12;
                            break;
                        case direction_5.Direction.Left:
                            result.y += 12;
                            break;
                    }
                    return result;
                }
                TakeTurn() {
                    if (this.state == State.Dying) {
                        this.doDeath();
                        return;
                    }
                    if (this.state == State.Dead)
                        return;
                    if (this.hitState.BlinkingAndInvulnerable) {
                        if (common_7.waitDuration(this.hitState.BlinkTimer, HitState.BlinkTimePerSwitch))
                            this.hitState.Blink = !this.hitState.Blink;
                        if (common_7.waitDuration(this.hitState.RecoveryTimer, HitState.TotalBlinkTime)) {
                            this.hitState.BlinkingAndInvulnerable = false;
                            this.hitState.Blink = false;
                            this.hitState.BlinkTimer.stop();
                            this.hitState.RecoveryTimer.stop();
                            this.state = State.Normal;
                        }
                    }
                    if (this.hitState.CurrentStep == HitStateStep.Flying) {
                        this.doHitFlying();
                    }
                    else if (this.hitState.CurrentStep == HitStateStep.Falling) {
                        this.doHitFall();
                    }
                    else if (this.hitState.CurrentStep == HitStateStep.Crouching) {
                        this.doHitCrouching();
                    }
                    else if (this.roeState.Roeing) {
                        if (common_7.waitDuration(this.roeState.aniTimer, RoeState.msPerFrame[this.roeState.CurrentFrame])) {
                            if (++this.roeState.CurrentFrame >= RoeState.msPerFrame.length) {
                                this.roeState.Stop();
                            }
                            else {
                                this.roeState.aniTimer.restart();
                            }
                        }
                    }
                    else {
                        let walked = false;
                        if (!this.FloorCollision || this.Jumping || this.hitState.CurrentStep != HitStateStep.None) {
                            this.Crouching = false;
                            walked = false;
                            this.AnimateMovement(0);
                        }
                        else {
                            this.handleInput(walked);
                            if (walked) {
                                this.doWalk();
                            }
                            else {
                                this.AnimateMovement(0);
                                this.firstPressedButton = direction_5.Direction.None;
                            }
                        }
                    }
                    if (!this.FloorCollision && (!this.Jumping || !this.jumpState.GoingUp) && this.hitState.CurrentStep != HitStateStep.Flying && this.hitState.CurrentStep != HitStateStep.Falling) {
                        let originalPos = { x: this.pos.x, y: this.pos.y };
                        this.checkAndHandleCollisions(originalPos);
                        if (!this.FloorCollision)
                            this.pos.y += 4;
                        this.checkAndHandleCollisions(originalPos);
                        if (this.FloorCollision)
                            soundmaster_2.SoundMaster.PlayEffect(resourcemaster_2.ResourceMaster.Sound[resourceids_4.AudioId.Land]);
                    }
                    if (this.Jumping) {
                        this.doJump();
                    }
                    this.DetermineFrame();
                }
                doHitFlying() {
                    let delta = { nextStepValue: { x: 0, y: 0 } };
                    this.hitState.HitAni.doAnimation(1, delta);
                    let originalPos = common_7.copyPoint(this.pos);
                    this.pos.x += this.Direction == direction_5.Direction.Right ? delta.nextStepValue.x : -delta.nextStepValue.x;
                    let dir = this.Direction;
                    this.Direction = this.Direction == direction_5.Direction.Left ? direction_5.Direction.Right : direction_5.Direction.Left;
                    this.checkAndHandleWallAndCeilingCollisions(originalPos);
                    this.Direction = dir;
                    this.pos.y += delta.nextStepValue.y;
                    if (!this.hitState.HitAni.hasNext) {
                        this.hitState.CurrentStep = HitStateStep.Falling;
                    }
                }
                doHitFall() {
                    let originalPos = common_7.copyPoint(this.pos);
                    this.pos.x += this.Direction == direction_5.Direction.Right ? -2 : 2;
                    let dir = this.Direction;
                    this.Direction = this.Direction == direction_5.Direction.Left ? direction_5.Direction.Right : direction_5.Direction.Left;
                    this.checkAndHandleWallAndCeilingCollisions(originalPos);
                    this.Direction = dir;
                    if (!this.FloorCollision) {
                        this.pos.y += 4;
                        if (this.FloorCollision) {
                            this.handleFloorCollision();
                        }
                    }
                }
                doHitCrouching() {
                    if (common_7.waitDuration(this.hitState.CrouchTimer, HitState.CrouchTime)) {
                        this.hitState.CurrentStep = HitStateStep.None;
                        if (this.Health <= 0) {
                            this.initDyingState();
                            gamecontroller_2.GameController._.BelmontDied();
                        }
                    }
                }
                doJump() {
                    let originalPos = common_7.copyPoint(this.pos);
                    this.pos.y += this.jumpState.JumpAni.stepValue();
                    let dummy = { nextStepValue: 0 };
                    this.jumpState.JumpAni.doAnimation(1, dummy);
                    if (!this.jumpState.JumpAni.hasNext) {
                        this.jumpState.Stop();
                    }
                    this.checkAndHandleWallAndCeilingCollisions(originalPos);
                    originalPos = common_7.copyPoint(this.pos);
                    if (this.jumpState.JumpDirection == direction_5.Direction.Right)
                        this.pos.x += this.movementSpeed;
                    if (this.jumpState.JumpDirection == direction_5.Direction.Left)
                        this.pos.x -= this.movementSpeed;
                    if (this.jumpState.GoingUp) {
                        this.checkAndHandleWallAndCeilingCollisions(originalPos);
                    }
                    else {
                        this.checkAndHandleCollisions(originalPos);
                    }
                }
                doWalk() {
                    if (this.currentWalkAnimationFrame == 0)
                        this.currentWalkAnimationFrame = 1;
                    this.AnimateMovement(1);
                    if (!this.multipleDirButtonsPressed())
                        this.firstPressedButton = this.Direction;
                }
                DetermineFrame() {
                    switch (this.state) {
                        case State.Normal:
                        case State.HitRecovery:
                            if (this.hitState.CurrentStep != HitStateStep.None) {
                                if (this.hitState.CurrentStep == HitStateStep.Falling || this.hitState.CurrentStep == HitStateStep.Flying)
                                    this.imgid = this.Direction == direction_5.Direction.Right ? resourceids_4.BitmapId.Belmont_rhitfly : resourceids_4.BitmapId.Belmont_lhitfly;
                                else
                                    this.imgid = this.Direction == direction_5.Direction.Right ? resourceids_4.BitmapId.Belmont_rhitdown : resourceids_4.BitmapId.Belmont_lhitdown;
                            }
                            else if (!this.roeState.Roeing) {
                                if (!this.Crouching && !this.Jumping) {
                                    this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShield[this.Direction][this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShield[this.Direction][this.currentWalkAnimationFrame];
                                }
                                else {
                                    this.imgid = this.CarryingShield ? Belmont.MovementSpritesWShieldCrouching[this.Direction][this.currentWalkAnimationFrame] : Belmont.MovementSpritesNoShieldCrouching[this.Direction][this.currentWalkAnimationFrame];
                                }
                            }
                            else {
                                if (!this.Crouching && !this.Jumping) {
                                    this.imgid = RoeState.RoeSprites[this.Direction][this.roeState.CurrentFrame];
                                }
                                else {
                                    this.imgid = RoeState.RoeSpritesCrouching[this.Direction][this.roeState.CurrentFrame];
                                }
                            }
                            break;
                        case State.Dying:
                        case State.Dead:
                            break;
                    }
                }
                TakeDamage(amount) {
                    if (!this.hittable)
                        return;
                    if (this.state != State.HitRecovery && this.state != State.Dying) {
                        this.Health -= amount;
                        this.initHitRecoveryState();
                        if (this.jumpState.Jumping)
                            this.jumpState.Stop();
                        if (this.Roeing) {
                            this.roeState.Stop();
                        }
                        soundmaster_2.SoundMaster.PlayEffect(resourcemaster_2.ResourceMaster.Sound[resourceids_4.AudioId.PlayerDamage]);
                    }
                }
                doDeath() {
                    let stepValue;
                    if (this.dyingState.DeathAni.doAnimation(this.dyingState.aniTimer, stepValue)) {
                        if (this.dyingState.DeathAni.finished()) {
                            gamecontroller_2.GameController._.BelmontDeathAniFinished();
                            this.dyingState.Stop();
                            this.state = State.Dead;
                        }
                        else {
                            this.imgid = stepValue.nextStepValue.image;
                        }
                    }
                }
                UseRoe() {
                    if (!this.Roeing && this.state != State.Dying) {
                        this.initRoeState();
                    }
                }
                initHitRecoveryState() {
                    this.state = State.HitRecovery;
                    this.hitState.Start();
                }
                initDyingState() {
                    this.dyingState.Start();
                    this.state = State.Dying;
                }
                initRoeState() {
                    this.roeState.Start();
                    this.DetermineFrame();
                }
                handleInput(moved) {
                    if (input_1.KeyState.KD_DOWN && !this.ignoreDirButtonPress(direction_5.Direction.Down)) {
                        this.Crouching = true;
                        if (input_1.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(direction_5.Direction.Right))
                            this.Direction = direction_5.Direction.Right;
                        if (input_1.KeyState.KD_LEFT && !this.ignoreDirButtonPress(direction_5.Direction.Left))
                            this.Direction = direction_5.Direction.Left;
                    }
                    else if (input_1.KeyState.KC_UP && !this.ignoreDirButtonPress(direction_5.Direction.Up)) {
                        this.Crouching = false;
                        let jumpDir = direction_5.Direction.Up;
                        if (input_1.KeyState.KD_RIGHT) {
                            jumpDir = direction_5.Direction.Right;
                            this.Direction = direction_5.Direction.Right;
                        }
                        else if (input_1.KeyState.KD_LEFT) {
                            jumpDir = direction_5.Direction.Left;
                            this.Direction = direction_5.Direction.Left;
                        }
                        this.jumpState.Start(jumpDir);
                    }
                    else if (input_1.KeyState.KD_RIGHT && !this.ignoreDirButtonPress(direction_5.Direction.Right)) {
                        this.Crouching = false;
                        this.doMovement(direction_5.Direction.Right, moved);
                    }
                    else if (input_1.KeyState.KD_LEFT && !this.ignoreDirButtonPress(direction_5.Direction.Left)) {
                        this.Crouching = false;
                        this.doMovement(direction_5.Direction.Left, moved);
                    }
                    else {
                        this.Crouching = false;
                        this.firstPressedButton = direction_5.Direction.None;
                    }
                }
                doMovement(dir, moved) {
                    let speed = this.movementSpeed;
                    let originalPos = common_7.copyPoint(this.pos);
                    switch (dir) {
                        case direction_5.Direction.Right:
                            this.pos.x += speed;
                            this.Direction = direction_5.Direction.Right;
                            break;
                        case direction_5.Direction.Left:
                            this.pos.x -= speed;
                            this.Direction = direction_5.Direction.Left;
                            break;
                    }
                    this.checkAndHandleCollisions(originalPos);
                    moved = true;
                }
                checkAndHandleWallAndCeilingCollisions(originalPos) {
                    if (this.checkWallSpriteCollisions())
                        common_7.setPoint(this.pos, originalPos.x, originalPos.y);
                    if (this.checkWallCollision())
                        this.handleWallCollision();
                    if (this.CeilingCollision) {
                        this.handleCeilingCollision();
                    }
                    let possibleRoomExit = this.nearRoomExit();
                    if (possibleRoomExit && possibleRoomExit.destRoom != room_1.Room.NO_ROOM_EXIT) {
                        gamecontroller_2.GameController._.HandleRoomExitViaMovement(possibleRoomExit.destRoom, possibleRoomExit.direction);
                    }
                }
                checkAndHandleFloorCollisions(originalPos) {
                    if (this.FloorCollision) {
                        this.handleFloorCollision();
                    }
                    else
                        this.checkAndHandleRoomExit();
                }
                checkAndHandleCollisions(originalPos) {
                    this.checkAndHandleWallAndCeilingCollisions(originalPos);
                    this.checkAndHandleFloorCollisions(originalPos);
                }
                checkAndHandleRoomExit() {
                    let possibleRoomExit = this.nearRoomExit();
                    if (possibleRoomExit && possibleRoomExit.destRoom != room_1.Room.NO_ROOM_EXIT) {
                        gamecontroller_2.GameController._.HandleRoomExitViaMovement(possibleRoomExit.destRoom, possibleRoomExit.direction);
                    }
                }
                checkWallCollision() {
                    switch (this.Direction) {
                        case direction_5.Direction.Right:
                            return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 25, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 16, this.pos.y + 31, true);
                        case direction_5.Direction.Left:
                            return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 25, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x, this.pos.y + 31, true);
                        default:
                            return false;
                    }
                }
                handleWallCollision() {
                    switch (this.Direction) {
                        case direction_5.Direction.Right:
                            this.pos.x = (this.pos.x / msx_5.TileSize) * msx_5.TileSize;
                            break;
                        case direction_5.Direction.Down:
                            this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
                            break;
                        case direction_5.Direction.Left:
                            if (this.pos.x >= 0)
                                this.pos.x = (this.pos.x / msx_5.TileSize + 1) * msx_5.TileSize;
                            this.pos.x = this.pos.x / msx_5.TileSize * msx_5.TileSize;
                            break;
                    }
                }
                get CeilingCollision() {
                    return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 8, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 8, true);
                }
                get FloorCollision() {
                    return sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 1, this.pos.y + 32, true) || sintervaniamodel_6.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 15, this.pos.y + 32, true);
                }
                handleFloorCollision() {
                    this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
                    if (this.Jumping) {
                        this.jumpState.Stop();
                    }
                    if (this.hitState.CurrentStep == HitStateStep.Falling) {
                        this.hitState.CurrentStep = HitStateStep.Crouching;
                        this.hitState.CrouchTimer.restart();
                    }
                }
                handleCeilingCollision() {
                    if (this.pos.y >= 0)
                        this.pos.y = (this.pos.y / msx_5.TileSize + 1) * msx_5.TileSize;
                    else
                        this.pos.y = (this.pos.y / msx_5.TileSize) * msx_5.TileSize;
                    this.jumpState.GoingUp = false;
                }
                nearRoomExit() {
                    let exitUp = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 8);
                    if (exitUp != null)
                        return exitUp;
                    let exitRight = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 16, this.pos.y + 25);
                    if (exitRight != null)
                        return exitRight;
                    let exitDown = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x + 1, this.pos.y + 32);
                    if (exitDown != null)
                        return exitDown;
                    let exitLeft = sintervaniamodel_6.GameModel._.CurrentRoom.NearingRoomExit(this.pos.x, this.pos.y + 25);
                    if (exitLeft != null)
                        return exitLeft;
                    return null;
                }
                ignoreDirButtonPress(dir) {
                    return this.multipleDirButtonsPressed() && dir == this.firstPressedButton;
                }
                multipleDirButtonsPressed() {
                    let u = input_1.KeyState.KD_UP ? 1 : 0;
                    let r = input_1.KeyState.KD_RIGHT ? 1 : 0;
                    let d = input_1.KeyState.KD_DOWN ? 1 : 0;
                    let l = input_1.KeyState.KD_LEFT ? 1 : 0;
                    return u + r + d + l > 1;
                }
                Paint(offset = null) {
                    let roeOffset = { x: 0, y: 0 };
                    if (this.Roeing) {
                        if (!this.Crouching) {
                            roeOffset.x += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].x;
                            roeOffset.y += RoeState.RoeSpritePosOffset[this.Direction][this.roeState.CurrentFrame].y;
                        }
                        else {
                            roeOffset.x += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].x;
                            roeOffset.y += RoeState.RoeSpritePosOffsetCrouching[this.Direction][this.roeState.CurrentFrame].y;
                        }
                    }
                    if (!this.hitState.Blink || gamecontroller_2.GameController._.InEventState) {
                        let options = this.flippedH ? view_2.DrawBitmap.HFLIP : 0;
                        if (offset == null)
                            engine_8.view.DrawBitmap(this.imgid, this.pos.x + roeOffset.x, this.pos.y + roeOffset.y, options);
                        else
                            engine_8.view.DrawBitmap(this.imgid, this.pos.x + roeOffset.x + offset.x, this.pos.y + roeOffset.y + offset.y, options);
                    }
                    else {
                        if (this.disposeFlag || !this.visible)
                            return;
                        let options = this.flippedH ? view_2.DrawBitmap.HFLIP : 0;
                        if (offset == null)
                            engine_8.view.DrawColoredBitmap(this.imgid, this.pos.x + roeOffset.x, this.pos.y + roeOffset.y, options, 50.0, .0, .0);
                        else
                            engine_8.view.DrawColoredBitmap(this.imgid, this.pos.x + roeOffset.x + offset.x, this.pos.y + roeOffset.y + offset.y, options, 50.0, .0, .0);
                    }
                }
                Dispose() {
                    btimer_3.BStopwatch.removeWatch(this.hitState.BlinkTimer);
                    btimer_3.BStopwatch.removeWatch(this.hitState.RecoveryTimer);
                    btimer_3.BStopwatch.removeWatch(this.dyingState.aniTimer);
                    btimer_3.BStopwatch.removeWatch(this.roeState.aniTimer);
                }
            };
            Belmont.MoveBeforeFrameChange = 4;
            Belmont.MovementSpritesNoShield = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_r1, resourceids_4.BitmapId.Belmont_r3, resourceids_4.BitmapId.Belmont_r2, resourceids_4.BitmapId.Belmont_r3, resourceids_4.BitmapId.Belmont_r1]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_l1, resourceids_4.BitmapId.Belmont_l3, resourceids_4.BitmapId.Belmont_l2, resourceids_4.BitmapId.Belmont_l3, resourceids_4.BitmapId.Belmont_l1]],
            ]);
            Belmont.MovementSpritesNoShieldCrouching = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld]]
            ]);
            Belmont.MovementSpritesWShieldCrouching = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd, resourceids_4.BitmapId.Belmont_rd]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld, resourceids_4.BitmapId.Belmont_ld]],
            ]);
            Belmont.MovementSpritesHit = new Map([
                [direction_5.Direction.Right, [resourceids_4.BitmapId.Belmont_rhitfly, resourceids_4.BitmapId.Belmont_rhitdown]],
                [direction_5.Direction.Left, [resourceids_4.BitmapId.Belmont_lhitfly, resourceids_4.BitmapId.Belmont_lhitdown]],
            ]);
            Belmont.MovementSpritesWShield = new Map([]);
            Belmont.buttonPressEventHitAreaUp = common_7.newArea(0, 20, 16, 28);
            Belmont.buttonPressEventHitAreaRight = common_7.newArea(4, 24, 20, 32);
            Belmont.buttonPressEventHitAreaDown = common_7.newArea(0, 28, 16, 36);
            Belmont.buttonPressEventHitAreaLeft = common_7.newArea(-4, 24, 12, 32);
            Belmont._hitarea = common_7.newArea(2, 8, 14, 30);
            exports_29("Belmont", Belmont);
            (function (State) {
                State[State["Normal"] = 0] = "Normal";
                State[State["HitRecovery"] = 1] = "HitRecovery";
                State[State["Dying"] = 2] = "Dying";
                State[State["Dead"] = 3] = "Dead";
            })(State || (State = {}));
            exports_29("State", State);
            JumpState = class JumpState {
                constructor() {
                    this.JumpTimer = new btimer_3.BStopwatch();
                    this.Jumping = false;
                    this.GoingUp = false;
                    this.JumpAni = new animation_1.Animation(JumpState.jumpYDelta, 1, false);
                }
                get JumpHeightReached() {
                    return this.JumpAni.stepValue() >= 0;
                }
                Stop() {
                    this.JumpTimer.stop();
                    this.Jumping = false;
                    this.GoingUp = false;
                }
                Start(jumpDir) {
                    this.JumpTimer.restart();
                    this.Jumping = true;
                    this.GoingUp = true;
                    this.JumpDirection = jumpDir;
                    this.JumpAni.restart();
                }
            };
            JumpState.jumpYDelta = [0, -8, -4, -4, -4, -4, -4, -4, -4, -2, -2, -1, -1, 0, 0, 0, 0, 1, 1, 2, 2, 4, 4, 4, 4, 4, 4, 4, 8, 0];
            exports_29("JumpState", JumpState);
            HitState = class HitState {
                constructor() {
                    this.Blink = false;
                    this.BlinkingAndInvulnerable = false;
                    this.CurrentStep = HitStateStep.None;
                    this.HitAni = new animation_1.Animation(HitState.hitDelta, 1);
                }
                Stop() {
                    this.BlinkTimer.stop();
                    this.RecoveryTimer.stop();
                    this.CrouchTimer.stop();
                    this.Blink = false;
                    this.BlinkingAndInvulnerable = false;
                    this.CurrentStep = HitStateStep.None;
                }
                Start() {
                    this.Blink = true;
                    this.BlinkingAndInvulnerable = true;
                    this.CurrentStep = HitStateStep.Flying;
                    this.BlinkTimer.restart();
                    this.RecoveryTimer.restart();
                    this.CrouchTimer.reset();
                    this.HitAni.restart();
                }
            };
            HitState.TotalBlinkTime = 2000;
            HitState.BlinkTimePerSwitch = 20;
            HitState.CrouchTime = 500;
            HitState.hitDelta = new Array(common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-2, -2), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, -1), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-1, 0), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1), common_8.newPoint(-2, 1));
            exports_29("HitState", HitState);
            (function (HitStateStep) {
                HitStateStep[HitStateStep["None"] = 0] = "None";
                HitStateStep[HitStateStep["Flying"] = 1] = "Flying";
                HitStateStep[HitStateStep["Falling"] = 2] = "Falling";
                HitStateStep[HitStateStep["Crouching"] = 3] = "Crouching";
            })(HitStateStep || (HitStateStep = {}));
            exports_29("HitStateStep", HitStateStep);
            DyingState = class DyingState {
                constructor() {
                    this.DeathAni = new animation_1.Animation(DyingState.dyingFrames, DyingState.dyingFrameTimes);
                }
                Start() {
                    this.aniTimer.restart();
                    this.DeathAni.restart();
                }
                Stop() {
                    this.aniTimer.stop();
                }
            };
            DyingState.MsPerFrame = 300;
            DyingState.dyingFrames = new Array({ image: resourceids_4.BitmapId.Belmont_rhitdown, dir: direction_5.Direction.Right }, { image: resourceids_4.BitmapId.Belmont_rdead, dir: direction_5.Direction.Right });
            DyingState.dyingFrameTimes = [100, 2000];
            exports_29("DyingState", DyingState);
        }
    };
});
System.register("src/triroe", ["src/pprojectile", "src/belmont", "src/sintervaniamodel", "BoazEngineJS/resourceids", "BoazEngineJS/common"], function (exports_30, context_30) {
    "use strict";
    var pprojectile_1, belmont_1, sintervaniamodel_7, resourceids_5, common_9, TriRoe;
    var __moduleName = context_30 && context_30.id;
    return {
        setters: [
            function (pprojectile_1_1) {
                pprojectile_1 = pprojectile_1_1;
            },
            function (belmont_1_1) {
                belmont_1 = belmont_1_1;
            },
            function (sintervaniamodel_7_1) {
                sintervaniamodel_7 = sintervaniamodel_7_1;
            },
            function (resourceids_5_1) {
                resourceids_5 = resourceids_5_1;
            },
            function (common_9_1) {
                common_9 = common_9_1;
            }
        ],
        execute: function () {
            TriRoe = class TriRoe extends pprojectile_1.PlayerProjectile {
                constructor(pos, dir) {
                    super({ x: pos.x, y: pos.y }, { x: 0, y: 0 });
                    this.Direction = dir;
                    this.pos = sintervaniamodel_7.GameModel._.Belmont.pos;
                }
                get hitarea() {
                    if (!sintervaniamodel_7.GameModel._.Belmont.roeState.Roeing || sintervaniamodel_7.GameModel._.Belmont.RecoveringFromHit)
                        return null;
                    if (!sintervaniamodel_7.GameModel._.Belmont.Crouching)
                        return TriRoe.hitareas[sintervaniamodel_7.GameModel._.Belmont.imgid] + belmont_1.RoeState.RoeSpritePosOffset[sintervaniamodel_7.GameModel._.Belmont.Direction][sintervaniamodel_7.GameModel._.Belmont.roeState.CurrentFrame];
                    return TriRoe.hitareas[sintervaniamodel_7.GameModel._.Belmont.imgid] + belmont_1.RoeState.RoeSpritePosOffsetCrouching[sintervaniamodel_7.GameModel._.Belmont.Direction][sintervaniamodel_7.GameModel._.Belmont.roeState.CurrentFrame];
                }
                set hitarea(value) {
                }
                get DamageDealt() {
                    return 1;
                }
                TakeTurn() {
                    if (sintervaniamodel_7.GameModel._.Belmont.Dying || !sintervaniamodel_7.GameModel._.Belmont.roeState.Roeing) {
                        this.disposeFlag = true;
                        return;
                    }
                    this.pos = sintervaniamodel_7.GameModel._.Belmont.pos;
                    this.CheckAndInvokeHit();
                }
                Paint(offset = null) {
                }
                Dispose() {
                }
            };
            TriRoe.hitareas = new Map([
                [resourceids_5.BitmapId.Belmont_rw1, common_9.newArea(0, 9, 7, 26)],
                [resourceids_5.BitmapId.Belmont_rw2, common_9.newArea(0, 6, 15, 16)],
                [resourceids_5.BitmapId.Belmont_rw3, common_9.newArea(20, 8, 41, 16)],
                [resourceids_5.BitmapId.Belmont_rwd1, common_9.newArea(0, 15, 7, 32)],
                [resourceids_5.BitmapId.Belmont_rwd2, common_9.newArea(0, 12, 15, 22)],
                [resourceids_5.BitmapId.Belmont_rwd3, common_9.newArea(20, 14, 41, 22)],
                [resourceids_5.BitmapId.Belmont_lw1, common_9.newArea(24, 9, 31, 26)],
                [resourceids_5.BitmapId.Belmont_lw2, common_9.newArea(17, 6, 31, 16)],
                [resourceids_5.BitmapId.Belmont_lw3, common_9.newArea(0, 8, 19, 16)],
                [resourceids_5.BitmapId.Belmont_lwd1, common_9.newArea(24, 15, 31, 32)],
                [resourceids_5.BitmapId.Belmont_lwd2, common_9.newArea(17, 12, 31, 22)],
                [resourceids_5.BitmapId.Belmont_lwd3, common_9.newArea(0, 14, 19, 22)],
            ]);
            exports_30("TriRoe", TriRoe);
        }
    };
});
System.register("src/weaponfirehandler", ["src/sintervaniamodel", "src/triroe", "BoazEngineJS/soundmaster", "src/resourcemaster", "BoazEngineJS/resourceids", "BoazEngineJS/common"], function (exports_31, context_31) {
    "use strict";
    var sintervaniamodel_8, triroe_1, soundmaster_3, resourcemaster_3, resourceids_6, common_10, WeaponFireHandler;
    var __moduleName = context_31 && context_31.id;
    return {
        setters: [
            function (sintervaniamodel_8_1) {
                sintervaniamodel_8 = sintervaniamodel_8_1;
            },
            function (triroe_1_1) {
                triroe_1 = triroe_1_1;
            },
            function (soundmaster_3_1) {
                soundmaster_3 = soundmaster_3_1;
            },
            function (resourcemaster_3_1) {
                resourcemaster_3 = resourcemaster_3_1;
            },
            function (resourceids_6_1) {
                resourceids_6 = resourceids_6_1;
            },
            function (common_10_1) {
                common_10 = common_10_1;
            }
        ],
        execute: function () {
            WeaponFireHandler = class WeaponFireHandler {
                static get mainWeaponCurrentCooldown() {
                    return WeaponFireHandler._mainWeaponCurrentCooldown;
                }
                static set mainWeaponCurrentCooldown(value) {
                    if (value > WeaponFireHandler._mainWeaponCurrentCooldown || !sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.running)
                        WeaponFireHandler._mainWeaponCurrentCooldown = value;
                }
                static get MainWeaponOnCooldown() {
                    if (sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.running) {
                        if (common_10.waitDuration(sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer, WeaponFireHandler.mainWeaponCurrentCooldown)) {
                            sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.stop();
                            return false;
                        }
                        return true;
                    }
                    return false;
                }
                static get secWeaponCurrentCooldown() {
                    return WeaponFireHandler._secWeaponCurrentCooldown;
                }
                static set secWeaponCurrentCooldown(value) {
                    if (value > WeaponFireHandler._secWeaponCurrentCooldown || !sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.running)
                        WeaponFireHandler._secWeaponCurrentCooldown = value;
                }
                static get SecWeaponOnCooldown() {
                    if (sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.running) {
                        if (common_10.waitDuration(sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer, WeaponFireHandler.secWeaponCurrentCooldown)) {
                            sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.stop();
                            return false;
                        }
                        return true;
                    }
                    return false;
                }
                static HandleFireMainWeapon() {
                    if (WeaponFireHandler.MainWeaponOnCooldown)
                        return;
                    switch (sintervaniamodel_8.GameModel._.SelectedMainWeapon) {
                        case sintervaniamodel_8.MainWeaponType.TriRoe:
                            WeaponFireHandler.handleTriRoe();
                            break;
                    }
                }
                static setMainWeaponCooldown(cooldown) {
                    sintervaniamodel_8.GameModel._.MainWeaponCooldownTimer.restart();
                    WeaponFireHandler.mainWeaponCurrentCooldown = cooldown;
                }
                static setSecWeaponCooldown(cooldown) {
                    sintervaniamodel_8.GameModel._.SecWeaponCooldownTimer.restart();
                    WeaponFireHandler.secWeaponCurrentCooldown = cooldown;
                }
                static handleTriRoe() {
                    if (sintervaniamodel_8.GameModel._.Belmont.Roeing || sintervaniamodel_8.GameModel._.Belmont.RecoveringFromHit)
                        return;
                    WeaponFireHandler.setMainWeaponCooldown(0);
                    let roe = new triroe_1.TriRoe(sintervaniamodel_8.GameModel._.Belmont.pos, sintervaniamodel_8.GameModel._.Belmont.Direction);
                    sintervaniamodel_8.GameModel._.spawn(roe);
                    sintervaniamodel_8.GameModel._.Belmont.UseRoe();
                    soundmaster_3.SoundMaster.PlayEffect(resourcemaster_3.ResourceMaster.Sound[resourceids_6.AudioId.Whip]);
                }
                static handleFireCross() {
                    WeaponFireHandler.setSecWeaponCooldown(WeaponFireHandler.msCrossCooldown);
                }
                static HandleFireSecondaryWeapon() {
                    if (WeaponFireHandler.SecWeaponOnCooldown)
                        return;
                    if (sintervaniamodel_8.GameModel._.Hearts > 0) {
                        return;
                    }
                    switch (sintervaniamodel_8.GameModel._.SelectedSecondaryWeapon) {
                        case sintervaniamodel_8.SecWeaponType.Cross:
                            WeaponFireHandler.handleFireCross();
                            break;
                    }
                }
            };
            WeaponFireHandler.msCrossCooldown = 500;
            WeaponFireHandler.msTriRoeCooldown = 1000;
            exports_31("WeaponFireHandler", WeaponFireHandler);
        }
    };
});
System.register("src/gameoptions", ["src/gameconstants", "BoazEngineJS/msx"], function (exports_32, context_32) {
    "use strict";
    var gameconstants_3, msx_6, GameOptions;
    var __moduleName = context_32 && context_32.id;
    return {
        setters: [
            function (gameconstants_3_1) {
                gameconstants_3 = gameconstants_3_1;
            },
            function (msx_6_1) {
                msx_6 = msx_6_1;
            }
        ],
        execute: function () {
            GameOptions = class GameOptions {
                constructor() {
                    this.Scale = gameconstants_3.GameConstants.InitialScale;
                    this.Fullscreen = gameconstants_3.GameConstants.InitialFullscreen;
                    this.EffectsVolumePercentage = 100;
                    this.MusicVolumePercentage = 100;
                }
                static get _() {
                    return GameOptions._instance != null ? GameOptions._instance : (GameOptions._instance = new GameOptions());
                }
                static set _(value) {
                    GameOptions._instance = value;
                }
                get WindowWidth() {
                    return (msx_6.MSXConstants.MSX2ScreenWidth * GameOptions._.Scale);
                }
                get WindowHeight() {
                    return (msx_6.MSXConstants.MSX2ScreenHeight * GameOptions._.Scale);
                }
                get BufferWidth() {
                    return (msx_6.MSXConstants.MSX2ScreenWidth * GameOptions._.Scale);
                }
                get BufferHeight() {
                    return (msx_6.MSXConstants.MSX2ScreenHeight * GameOptions._.Scale);
                }
            };
            exports_32("GameOptions", GameOptions);
        }
    };
});
System.register("src/textwriter", ["BoazEngineJS/engine", "BoazEngineJS/resourceids", "src/gameoptions"], function (exports_33, context_33) {
    "use strict";
    var engine_9, resourceids_7, gameoptions_1, TextWriterType, TextWriter;
    var __moduleName = context_33 && context_33.id;
    return {
        setters: [
            function (engine_9_1) {
                engine_9 = engine_9_1;
            },
            function (resourceids_7_1) {
                resourceids_7 = resourceids_7_1;
            },
            function (gameoptions_1_1) {
                gameoptions_1 = gameoptions_1_1;
            }
        ],
        execute: function () {
            (function (TextWriterType) {
                TextWriterType[TextWriterType["Billboard"] = 0] = "Billboard";
                TextWriterType[TextWriterType["Story"] = 1] = "Story";
            })(TextWriterType || (TextWriterType = {}));
            exports_33("TextWriterType", TextWriterType);
            TextWriter = class TextWriter {
                constructor(pos, end, type) {
                    this.Type = type;
                    this.Pos = pos;
                    this.End = end;
                    this.Text = new Array();
                    this.visible = false;
                }
                SetText(text) {
                    this.Text.length = 0;
                    this.Text.push(text);
                }
                AddText(text) {
                    this.Text.push(...text);
                }
                TakeTurn() {
                    switch (this.Type) {
                        case TextWriterType.Billboard:
                            break;
                        case TextWriterType.Story:
                            {
                            }
                            break;
                    }
                }
                static DrawText(x, y, textToWrite, color = null) {
                    let startPos = { x: x, y: y };
                    let stepX = TextWriter.FontWidth;
                    let stepY = TextWriter.FontHeight;
                    let pos = { x: startPos.x, y: startPos.y };
                    let letter;
                    for (let text of textToWrite) {
                        for (let i = 0; i < text.length; i++) {
                            let c = text[i];
                            letter = TextWriter.getBitmapForLetter(c);
                            if (!color)
                                engine_9.view.DrawBitmap(letter, pos.x, pos.y);
                            else
                                engine_9.view.DrawColoredBitmap(letter, pos.x, pos.y, color.r / 255.0, color.g / 255.0, color.b / 255.0);
                            pos.x += stepX;
                        }
                        pos.x = startPos.x;
                        pos.y += stepY;
                        if (pos.y >= gameoptions_1.GameOptions._.BufferHeight)
                            break;
                    }
                    ;
                }
                Paint() {
                    if (!this.visible)
                        return;
                    if (this.Text.length == 0)
                        return;
                    let startPos = { x: this.Pos.x, y: this.Pos.y };
                    let stepX = TextWriter.FontWidth;
                    let stepY = TextWriter.FontHeight;
                    let pos = { x: startPos.x, y: startPos.y };
                    let letter;
                    for (let text of this.Text) {
                        for (let c of text) {
                            if (pos.y < -TextWriter.FontHeight)
                                break;
                            letter = TextWriter.getBitmapForLetter(c);
                            engine_9.view.DrawBitmap(letter, pos.x, pos.y);
                            pos.x += stepX;
                        }
                        ;
                        pos.x = startPos.x;
                        pos.y += stepY;
                        if (pos.y >= gameoptions_1.GameOptions._.BufferHeight)
                            break;
                    }
                    ;
                }
                static getBitmapForLetter(c) {
                    let letter;
                    switch (c) {
                        case '0':
                            letter = resourceids_7.BitmapId.Font_0;
                            break;
                        case '1':
                            letter = resourceids_7.BitmapId.Font_1;
                            break;
                        case '2':
                            letter = resourceids_7.BitmapId.Font_2;
                            break;
                        case '3':
                            letter = resourceids_7.BitmapId.Font_3;
                            break;
                        case '4':
                            letter = resourceids_7.BitmapId.Font_4;
                            break;
                        case '5':
                            letter = resourceids_7.BitmapId.Font_5;
                            break;
                        case '6':
                            letter = resourceids_7.BitmapId.Font_6;
                            break;
                        case '7':
                            letter = resourceids_7.BitmapId.Font_7;
                            break;
                        case '8':
                            letter = resourceids_7.BitmapId.Font_8;
                            break;
                        case '9':
                            letter = resourceids_7.BitmapId.Font_9;
                            break;
                        case 'a':
                            letter = resourceids_7.BitmapId.Font_A;
                            break;
                        case 'b':
                            letter = resourceids_7.BitmapId.Font_B;
                            break;
                        case 'c':
                            letter = resourceids_7.BitmapId.Font_C;
                            break;
                        case 'd':
                            letter = resourceids_7.BitmapId.Font_D;
                            break;
                        case 'e':
                            letter = resourceids_7.BitmapId.Font_E;
                            break;
                        case 'f':
                            letter = resourceids_7.BitmapId.Font_F;
                            break;
                        case 'g':
                            letter = resourceids_7.BitmapId.Font_G;
                            break;
                        case 'h':
                            letter = resourceids_7.BitmapId.Font_H;
                            break;
                        case 'i':
                            letter = resourceids_7.BitmapId.Font_I;
                            break;
                        case 'j':
                            letter = resourceids_7.BitmapId.Font_J;
                            break;
                        case 'k':
                            letter = resourceids_7.BitmapId.Font_K;
                            break;
                        case 'l':
                            letter = resourceids_7.BitmapId.Font_L;
                            break;
                        case 'm':
                            letter = resourceids_7.BitmapId.Font_M;
                            break;
                        case 'n':
                            letter = resourceids_7.BitmapId.Font_N;
                            break;
                        case 'o':
                            letter = resourceids_7.BitmapId.Font_O;
                            break;
                        case 'p':
                            letter = resourceids_7.BitmapId.Font_P;
                            break;
                        case 'q':
                            letter = resourceids_7.BitmapId.Font_Q;
                            break;
                        case 'r':
                            letter = resourceids_7.BitmapId.Font_R;
                            break;
                        case 's':
                            letter = resourceids_7.BitmapId.Font_S;
                            break;
                        case 't':
                            letter = resourceids_7.BitmapId.Font_T;
                            break;
                        case 'u':
                            letter = resourceids_7.BitmapId.Font_U;
                            break;
                        case 'v':
                            letter = resourceids_7.BitmapId.Font_V;
                            break;
                        case 'w':
                            letter = resourceids_7.BitmapId.Font_W;
                            break;
                        case 'x':
                            letter = resourceids_7.BitmapId.Font_X;
                            break;
                        case 'y':
                            letter = resourceids_7.BitmapId.Font_Y;
                            break;
                        case 'z':
                            letter = resourceids_7.BitmapId.Font_Z;
                            break;
                        case 'A':
                            letter = resourceids_7.BitmapId.Font_A;
                            break;
                        case 'B':
                            letter = resourceids_7.BitmapId.Font_B;
                            break;
                        case 'C':
                            letter = resourceids_7.BitmapId.Font_C;
                            break;
                        case 'D':
                            letter = resourceids_7.BitmapId.Font_D;
                            break;
                        case 'E':
                            letter = resourceids_7.BitmapId.Font_E;
                            break;
                        case 'F':
                            letter = resourceids_7.BitmapId.Font_F;
                            break;
                        case 'G':
                            letter = resourceids_7.BitmapId.Font_G;
                            break;
                        case 'H':
                            letter = resourceids_7.BitmapId.Font_H;
                            break;
                        case 'I':
                            letter = resourceids_7.BitmapId.Font_I;
                            break;
                        case 'J':
                            letter = resourceids_7.BitmapId.Font_J;
                            break;
                        case 'K':
                            letter = resourceids_7.BitmapId.Font_K;
                            break;
                        case 'L':
                            letter = resourceids_7.BitmapId.Font_L;
                            break;
                        case 'M':
                            letter = resourceids_7.BitmapId.Font_M;
                            break;
                        case 'N':
                            letter = resourceids_7.BitmapId.Font_N;
                            break;
                        case 'O':
                            letter = resourceids_7.BitmapId.Font_O;
                            break;
                        case 'P':
                            letter = resourceids_7.BitmapId.Font_P;
                            break;
                        case 'Q':
                            letter = resourceids_7.BitmapId.Font_Q;
                            break;
                        case 'R':
                            letter = resourceids_7.BitmapId.Font_R;
                            break;
                        case 'S':
                            letter = resourceids_7.BitmapId.Font_S;
                            break;
                        case 'T':
                            letter = resourceids_7.BitmapId.Font_T;
                            break;
                        case 'U':
                            letter = resourceids_7.BitmapId.Font_U;
                            break;
                        case 'V':
                            letter = resourceids_7.BitmapId.Font_V;
                            break;
                        case 'W':
                            letter = resourceids_7.BitmapId.Font_W;
                            break;
                        case 'X':
                            letter = resourceids_7.BitmapId.Font_X;
                            break;
                        case '¡':
                            letter = resourceids_7.BitmapId.Font_IJ;
                            break;
                        case 'Y':
                            letter = resourceids_7.BitmapId.Font_Y;
                            break;
                        case 'Z':
                            letter = resourceids_7.BitmapId.Font_Z;
                            break;
                        case ',':
                            letter = resourceids_7.BitmapId.Font_Comma;
                            break;
                        case '.':
                            letter = resourceids_7.BitmapId.Font_Dot;
                            break;
                        case '!':
                            letter = resourceids_7.BitmapId.Font_Exclamation;
                            break;
                        case '?':
                            letter = resourceids_7.BitmapId.Font_QuestionMark;
                            break;
                        case '\'':
                            letter = resourceids_7.BitmapId.Font_Apostroph;
                            break;
                        case ' ':
                            letter = resourceids_7.BitmapId.Font_Space;
                            break;
                        case ':':
                            letter = resourceids_7.BitmapId.Font_Colon;
                            break;
                        case '-':
                            letter = resourceids_7.BitmapId.Font_Streep;
                            break;
                        case '/':
                            letter = resourceids_7.BitmapId.Font_Slash;
                            break;
                        case '%':
                            letter = resourceids_7.BitmapId.Font_Percent;
                            break;
                        case '[':
                            letter = resourceids_7.BitmapId.Font_SpeakStart;
                            break;
                        case ']':
                            letter = resourceids_7.BitmapId.Font_SpeakEnd;
                            break;
                        default:
                            letter = resourceids_7.BitmapId.Font_QuestionMark;
                            break;
                    }
                    return letter;
                }
            };
            TextWriter.FontWidth = 8;
            TextWriter.FontHeight = 8;
            exports_33("TextWriter", TextWriter);
        }
    };
});
System.register("BoazEngineJS/gamesaver", ["BoazEngineJS/constants", "BoazEngineJS/gamestateloader"], function (exports_34, context_34) {
    "use strict";
    var constants_5, gamestateloader_1, GameSaver;
    var __moduleName = context_34 && context_34.id;
    return {
        setters: [
            function (constants_5_1) {
                constants_5 = constants_5_1;
            },
            function (gamestateloader_1_1) {
                gamestateloader_1 = gamestateloader_1_1;
            }
        ],
        execute: function () {
            (function (GameSaver) {
                function saveGame(m, slot) {
                    throw "Not implemented yet :(";
                }
                GameSaver.saveGame = saveGame;
                function GetCheckpoint(m) {
                    saveGame(m, constants_5.Constants.SaveSlotCheckpoint);
                    return gamestateloader_1.LoadGame(constants_5.Constants.SaveSlotCheckpoint);
                }
                GameSaver.GetCheckpoint = GetCheckpoint;
            })(GameSaver || (GameSaver = {}));
            exports_34("GameSaver", GameSaver);
        }
    };
});
System.register("BoazEngineJS/gamestateloader", ["BoazEngineJS/constants", "BoazEngineJS/gamesaver"], function (exports_35, context_35) {
    "use strict";
    var constants_6, gamesaver_1;
    var __moduleName = context_35 && context_35.id;
    function LoadGame(slot) {
        throw "Not implemented yet :(";
    }
    exports_35("LoadGame", LoadGame);
    function SlotExists(slot) {
        let file = GetSavepath(slot);
        throw "Not implemented yet :(";
    }
    exports_35("SlotExists", SlotExists);
    function GetCheckpoint(m) {
        gamesaver_1.GameSaver.saveGame(m, constants_6.Constants.SaveSlotCheckpoint);
        return LoadGame(constants_6.Constants.SaveSlotCheckpoint);
    }
    exports_35("GetCheckpoint", GetCheckpoint);
    function GetSavepath(slot) {
        return slot !== constants_6.Constants.SaveSlotCheckpoint ? `${constants_6.Constants.SaveGamePath}${slot}` : constants_6.Constants.CheckpointGamePath;
    }
    exports_35("GetSavepath", GetSavepath);
    return {
        setters: [
            function (constants_6_1) {
                constants_6 = constants_6_1;
            },
            function (gamesaver_1_1) {
                gamesaver_1 = gamesaver_1_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("src/mainmenu", ["src/sintervaniamodel", "src/resourcemaster", "BoazEngineJS/soundmaster", "BoazEngineJS/direction", "src/gamecontroller", "src/textwriter", "BoazEngineJS/engine", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/input", "BoazEngineJS/gamestateloader", "BoazEngineJS/model", "BoazEngineJS/resourceids"], function (exports_36, context_36) {
    "use strict";
    var sintervaniamodel_9, resourcemaster_4, soundmaster_4, direction_6, sintervaniamodel_10, gamecontroller_3, textwriter_1, engine_10, msx_7, constants_7, input_2, gamestateloader_2, model_2, resourceids_8, State, MenuItem, MainMenu;
    var __moduleName = context_36 && context_36.id;
    return {
        setters: [
            function (sintervaniamodel_9_1) {
                sintervaniamodel_9 = sintervaniamodel_9_1;
                sintervaniamodel_10 = sintervaniamodel_9_1;
            },
            function (resourcemaster_4_1) {
                resourcemaster_4 = resourcemaster_4_1;
            },
            function (soundmaster_4_1) {
                soundmaster_4 = soundmaster_4_1;
            },
            function (direction_6_1) {
                direction_6 = direction_6_1;
            },
            function (gamecontroller_3_1) {
                gamecontroller_3 = gamecontroller_3_1;
            },
            function (textwriter_1_1) {
                textwriter_1 = textwriter_1_1;
            },
            function (engine_10_1) {
                engine_10 = engine_10_1;
            },
            function (msx_7_1) {
                msx_7 = msx_7_1;
            },
            function (constants_7_1) {
                constants_7 = constants_7_1;
            },
            function (input_2_1) {
                input_2 = input_2_1;
            },
            function (gamestateloader_2_1) {
                gamestateloader_2 = gamestateloader_2_1;
            },
            function (model_2_1) {
                model_2 = model_2_1;
            },
            function (resourceids_8_1) {
                resourceids_8 = resourceids_8_1;
            }
        ],
        execute: function () {
            (function (State) {
                State[State["SelectMain"] = 0] = "SelectMain";
                State[State["SubMenu"] = 1] = "SubMenu";
                State[State["SelectChapter"] = 2] = "SelectChapter";
            })(State || (State = {}));
            exports_36("State", State);
            (function (MenuItem) {
                MenuItem[MenuItem["NewGame"] = 0] = "NewGame";
                MenuItem[MenuItem["Continue"] = 1] = "Continue";
                MenuItem[MenuItem["LoadGame"] = 2] = "LoadGame";
                MenuItem[MenuItem["Options"] = 3] = "Options";
                MenuItem[MenuItem["ToMainMenu"] = 4] = "ToMainMenu";
                MenuItem[MenuItem["Prologue"] = 5] = "Prologue";
                MenuItem[MenuItem["Chapter0"] = 6] = "Chapter0";
                MenuItem[MenuItem["Chapter1"] = 7] = "Chapter1";
                MenuItem[MenuItem["Debug"] = 8] = "Debug";
            })(MenuItem || (MenuItem = {}));
            exports_36("MenuItem", MenuItem);
            MainMenu = class MainMenu {
                constructor() {
                }
                get cursorX() {
                    return MainMenu.cursorPosX;
                }
                get cursorY() {
                    return MainMenu.itemYs[this.selectedIndex];
                }
                get selectedItem() {
                    switch (this.state) {
                        case State.SelectMain:
                            return MainMenu.menuOptions[this.selectedIndex];
                        case State.SelectChapter:
                            return MainMenu.chapterOptions[this.selectedIndex];
                        default:
                            return MenuItem.ToMainMenu;
                    }
                }
                Init() {
                    this.reset();
                }
                reset() {
                    this.selectedIndex = 0;
                    this.state = State.SelectMain;
                }
                HandleInput() {
                    let selectionChanged = false;
                    if (input_2.KeyState.KC_UP)
                        this.changeSelection(direction_6.Direction.Up, selectionChanged);
                    else if (input_2.KeyState.KC_RIGHT)
                        this.changeSelection(direction_6.Direction.Right, selectionChanged);
                    else if (input_2.KeyState.KC_DOWN)
                        this.changeSelection(direction_6.Direction.Down, selectionChanged);
                    else if (input_2.KeyState.KC_LEFT)
                        this.changeSelection(direction_6.Direction.Left, selectionChanged);
                    if (selectionChanged)
                        soundmaster_4.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
                    if (input_2.KeyState.KC_SPACE) {
                        switch (this.state) {
                            case State.SelectMain:
                                soundmaster_4.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
                                switch (this.selectedItem) {
                                    case MenuItem.NewGame:
                                        this.state = State.SelectChapter;
                                        this.selectedIndex = 0;
                                        break;
                                    case MenuItem.Continue:
                                        if (gamestateloader_2.SlotExists(constants_7.Constants.SaveSlotCheckpoint))
                                            gamecontroller_3.GameController._.LoadCheckpoint();
                                        else
                                            soundmaster_4.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Fout]);
                                        break;
                                    case MenuItem.LoadGame:
                                        input_2.KeyState.KC_SPACE = false;
                                        sintervaniamodel_10.GameModel._.GameMenu.Open(MenuItem.LoadFromMainMenu);
                                        this.state = State.SubMenu;
                                        break;
                                    case MenuItem.Options:
                                        input_2.KeyState.KC_SPACE = false;
                                        sintervaniamodel_10.GameModel._.GameMenu.Open(MenuItem.OptionsFromMainMenu);
                                        this.state = State.SubMenu;
                                        break;
                                }
                                break;
                            case State.SelectChapter:
                                soundmaster_4.SoundMaster.PlayEffect(resourcemaster_4.ResourceMaster.Sound[resourceids_8.AudioId.Selectie]);
                                switch (this.selectedItem) {
                                    case MenuItem.Debug:
                                        sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Debug;
                                        gamecontroller_3.GameController._.SwitchToState(model_2.GameState.Game);
                                        break;
                                    case MenuItem.Prologue:
                                        sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Prologue;
                                        gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                        break;
                                    case MenuItem.Chapter0:
                                        sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.Chapter_0;
                                        gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                        break;
                                    case MenuItem.Chapter1:
                                        sintervaniamodel_10.GameModel._.SelectedChapterToPlay = sintervaniamodel_9.Chapter.GameStart;
                                        gamecontroller_3.GameController._.SwitchToState(model_2.GameState.GameStart1);
                                        break;
                                    case MenuItem.ToMainMenu:
                                        this.state = State.SelectMain;
                                        this.selectedIndex = 0;
                                        break;
                                }
                                break;
                            case State.SubMenu:
                                break;
                        }
                    }
                }
                changeSelection(dir, selectionChanged) {
                    if (this.state == State.SubMenu)
                        return;
                    let currentItems;
                    switch (this.state) {
                        case State.SelectMain:
                        default:
                            currentItems = MainMenu.items;
                            break;
                        case State.SelectChapter:
                            currentItems = MainMenu.chapterItems;
                            break;
                    }
                    switch (dir) {
                        case direction_6.Direction.Up:
                            if (this.selectedIndex > 0)
                                this.selectedIndex--;
                            else
                                this.selectedIndex = currentItems.length - 1;
                            selectionChanged = true;
                            break;
                        case direction_6.Direction.Down:
                            if (this.selectedIndex < currentItems.length - 1)
                                this.selectedIndex++;
                            else
                                this.selectedIndex = 0;
                            selectionChanged = true;
                            break;
                    }
                }
                TakeTurn() {
                }
                Paint() {
                    engine_10.view.DrawBitmap(resourceids_8.BitmapId.Titel, 0, 0);
                    engine_10.view.FillRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, msx_7.MSXConstants.Msx1Colors[4]);
                    engine_10.view.DrawRectangle(MainMenu.boxX, MainMenu.boxY, MainMenu.boxEndX, MainMenu.boxEndY, msx_7.MSXConstants.Msx1Colors[15]);
                    switch (this.state) {
                        case State.SubMenu:
                        case State.SelectMain:
                            for (let i = 0; i < MainMenu.items.length; i++) {
                                switch (MainMenu.menuOptions[i]) {
                                    case MenuItem.Continue:
                                        if (gamestateloader_2.SlotExists(constants_7.Constants.SaveSlotCheckpoint))
                                            textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                                        else
                                            textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i], msx_7.MSXConstants.Msx1Colors[0]);
                                        break;
                                    default:
                                        textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.items[i]);
                                        break;
                                }
                            }
                            break;
                        case State.SelectChapter:
                            for (let i = 0; i < MainMenu.chapterItems.length; i++) {
                                textwriter_1.TextWriter.DrawText(MainMenu.itemsX, MainMenu.itemYs[i], MainMenu.chapterItems[i]);
                            }
                            break;
                    }
                    engine_10.view.DrawBitmap(resourceids_8.BitmapId.MenuCursor, this.cursorX, this.cursorY);
                }
                GameMenuClosed() {
                    this.reset();
                }
            };
            MainMenu.items = new Array("New game", "Continue game", "Load game", "Options");
            MainMenu.menuOptions = new Array(MenuItem.NewGame, MenuItem.Continue, MenuItem.LoadGame, MenuItem.Options);
            MainMenu.chapterItems = new Array("Debug", "Prologue", "Chapter 0", "Chapter 1", "Back");
            MainMenu.chapterOptions = new Array(MenuItem.Debug, MenuItem.Prologue, MenuItem.Chapter0, MenuItem.Chapter1, MenuItem.ToMainMenu);
            MainMenu.itemYs = new Array(140, 156, 172, 188, 196, 204);
            MainMenu.itemsX = 48;
            MainMenu.cursorPosX = 36;
            MainMenu.boxX = MainMenu.cursorPosX - 8;
            MainMenu.boxY = 132;
            MainMenu.boxEndX = MainMenu.boxX + 176 + 32;
            MainMenu.boxEndY = MainMenu.boxY + 24 + 48;
            exports_36("MainMenu", MainMenu);
        }
    };
});
System.register("src/hud", ["BoazEngineJS/btimer", "src/item", "BoazEngineJS/resourceids", "src/sintervaniamodel", "src/gameconstants", "BoazEngineJS/engine", "src/gameview", "BoazEngineJS/common", "src/textwriter"], function (exports_37, context_37) {
    "use strict";
    var btimer_4, item_2, resourceids_9, sintervaniamodel_11, gameconstants_4, engine_11, gameview_1, common_11, textwriter_2, HUD;
    var __moduleName = context_37 && context_37.id;
    return {
        setters: [
            function (btimer_4_1) {
                btimer_4 = btimer_4_1;
            },
            function (item_2_1) {
                item_2 = item_2_1;
            },
            function (resourceids_9_1) {
                resourceids_9 = resourceids_9_1;
            },
            function (sintervaniamodel_11_1) {
                sintervaniamodel_11 = sintervaniamodel_11_1;
            },
            function (gameconstants_4_1) {
                gameconstants_4 = gameconstants_4_1;
            },
            function (engine_11_1) {
                engine_11 = engine_11_1;
            },
            function (gameview_1_1) {
                gameview_1 = gameview_1_1;
            },
            function (common_11_1) {
                common_11 = common_11_1;
            },
            function (textwriter_2_1) {
                textwriter_2 = textwriter_2_1;
            }
        ],
        execute: function () {
            HUD = class HUD {
                constructor() {
                    this.barTimer = btimer_4.BStopwatch.createWatch();
                    this.barTimer.pauseDuringMenu = false;
                    this.barTimer.restart();
                    this.foebarTimer = btimer_4.BStopwatch.createWatch();
                    this.foebarTimer.pauseDuringMenu = false;
                    this.foebarTimer.restart();
                    this.SetShownLevelsToProperValues();
                }
                SetShownLevelsToProperValues() {
                    if (sintervaniamodel_11.GameModel._ != null) {
                        if (sintervaniamodel_11.GameModel._.Belmont != null)
                            this.shownHealthLevel = sintervaniamodel_11.GameModel._.Belmont.HealthPercentage;
                        this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
                        this.foeForWhichHealthLevelIsShown = gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven;
                    }
                }
                TakeTurn() {
                    if (sintervaniamodel_11.GameModel._.Belmont.Dying)
                        this.shownHealthLevel = sintervaniamodel_11.GameModel._.Belmont.HealthPercentage;
                    if (sintervaniamodel_11.GameModel._.LastFoeThatWasHit != null && sintervaniamodel_11.GameModel._.LastFoeThatWasHit.disposeFlag)
                        this.shownFoeHealthLevel = 0;
                    if (common_11.waitDuration(this.barTimer, HUD.MsDurationBarChange)) {
                        if (this.shownHealthLevel > sintervaniamodel_11.GameModel._.Belmont.HealthPercentage)
                            this.shownHealthLevel--;
                        else if (this.shownHealthLevel < sintervaniamodel_11.GameModel._.Belmont.HealthPercentage)
                            this.shownHealthLevel++;
                    }
                    if (gameconstants_4.GameConstants.AnimateFoeHealthLevel) {
                        if (common_11.waitDuration(this.foebarTimer, HUD.MsDurationFoeBarChange)) {
                            if (this.shownFoeHealthLevel > gameview_1.GameView._.FoeHealthPercentage)
                                this.shownFoeHealthLevel--;
                            else if (this.shownFoeHealthLevel < gameview_1.GameView._.FoeHealthPercentage)
                                this.shownFoeHealthLevel++;
                        }
                    }
                    else
                        this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
                }
                percentageToBarLength(percentage) {
                    return percentage == 0 ? 0 : (HUD.HealthBarSizeX / 100 * percentage) + 1;
                }
                Paint() {
                    engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD, HUD.Pos_X, HUD.Pos_Y);
                    let pos = { x: HUD.HealthBarPosX, y: HUD.HealthBarPosY };
                    for (let i = 0; i < this.percentageToBarLength(this.shownHealthLevel); i++) {
                        engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_belmont, pos.x, pos.y);
                        pos.x += 1;
                    }
                    textwriter_2.TextWriter.DrawText(HUD.HeartsPosX, HUD.HeartsPosY, `${sintervaniamodel_11.GameModel._.Hearts.toPrecision(2)}`);
                    if (sintervaniamodel_11.GameModel._.ItemsInInventory.find(x => x.Type == item_2.ItemType.KeyBig)) {
                        engine_11.view.DrawBitmap(item_2.Item.Type2Image(item_2.ItemType.KeyBig), HUD.KeyPos.x, HUD.KeyPos.y);
                    }
                    common_11.setPoint(pos, HUD.FoeBarStripePosX, HUD.FoeBarStripePosY);
                    let lengthShown, lengthBefore;
                    if (sintervaniamodel_11.GameModel._.BossBattle) {
                        if (gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven != this.foeForWhichHealthLevelIsShown) {
                            this.foeForWhichHealthLevelIsShown = gameview_1.GameView._.FoeForWhichHealthPercentageIsGiven;
                            this.shownFoeHealthLevel = gameview_1.GameView._.FoeHealthPercentage;
                        }
                        lengthShown = this.percentageToBarLength(this.shownFoeHealthLevel);
                        lengthBefore = this.percentageToBarLength(gameview_1.GameView._.FoeHealthPercentage);
                    }
                    else {
                        lengthShown = this.percentageToBarLength(100);
                        lengthBefore = this.percentageToBarLength(100);
                    }
                    if (lengthBefore != -1) {
                        if (lengthBefore > 0) {
                            for (let i = 0; i <= lengthBefore; i++) {
                                engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_boss, pos.x, pos.y);
                                pos.x += 1;
                            }
                        }
                        if (lengthBefore != lengthShown) {
                            for (let i = lengthBefore; i <= lengthShown; i++) {
                                engine_11.view.DrawBitmap(resourceids_9.BitmapId.HUD_EnergyStripe_boss, pos.x, pos.y);
                                pos.x += 1;
                            }
                        }
                    }
                }
            };
            HUD.Pos_X = 0;
            HUD.Pos_Y = 0;
            HUD.MsDurationBarChange = 100;
            HUD.MsDurationFoeBarChange = 10;
            HUD.HealthBarPosX = HUD.Pos_X + 60;
            HUD.HealthBarPosY = HUD.Pos_Y + 18;
            HUD.HeartsPosX = HUD.Pos_X + 193;
            HUD.HeartsPosY = HUD.Pos_Y + 5;
            HUD.WeaponPosX = HUD.Pos_X + 214 - (24 + 24);
            HUD.WeaponPosY = HUD.Pos_Y + 3;
            HUD.AmmoPosX = HUD.Pos_X + 214 - 24;
            HUD.AmmoPosY = HUD.Pos_Y + 6;
            HUD.ItemPosX = HUD.Pos_X + 227;
            HUD.ItemPosY = HUD.Pos_Y + 3;
            HUD.KeyPos = { x: HUD.Pos_X + 168, y: HUD.Pos_Y + 18 };
            HUD.FoeBarStripePosX = HUD.Pos_X + 60;
            HUD.FoeBarStripePosY = HUD.Pos_Y + 27;
            HUD.HealthBarSizeX = 63;
            exports_37("HUD", HUD);
        }
    };
});
System.register("src/itscurtainsforyou", ["BoazEngineJS/btimer", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/common", "BoazEngineJS/engine", "src/gamecontroller", "BoazEngineJS/resourceids"], function (exports_38, context_38) {
    "use strict";
    var btimer_5, msx_8, constants_8, common_12, engine_12, gamecontroller_4, resourceids_10, ItsCurtainsForYou;
    var __moduleName = context_38 && context_38.id;
    return {
        setters: [
            function (btimer_5_1) {
                btimer_5 = btimer_5_1;
            },
            function (msx_8_1) {
                msx_8 = msx_8_1;
            },
            function (constants_8_1) {
                constants_8 = constants_8_1;
            },
            function (common_12_1) {
                common_12 = common_12_1;
            },
            function (engine_12_1) {
                engine_12 = engine_12_1;
            },
            function (gamecontroller_4_1) {
                gamecontroller_4 = gamecontroller_4_1;
            },
            function (resourceids_10_1) {
                resourceids_10 = resourceids_10_1;
            }
        ],
        execute: function () {
            ItsCurtainsForYou = class ItsCurtainsForYou {
                constructor() {
                    this.msCurtainPartWait = 18;
                    this.maxCurtainParts = constants_8.Constants.GAMESCREEN_WIDTH / msx_8.TileSize;
                }
                Init() {
                    this.curtainPartCount = 0;
                    if (this.timer == null) {
                        this.timer = btimer_5.BStopwatch.createWatch();
                    }
                    this.timer.restart();
                }
                Stop() {
                    this.curtainPartCount = 0;
                    btimer_5.BStopwatch.removeWatch(this.timer);
                }
                TakeTurn() {
                    if (common_12.waitDuration(this.timer, this.msCurtainPartWait)) {
                        this.curtainPartCount++;
                        if (this.curtainPartCount >= this.maxCurtainParts)
                            gamecontroller_4.GameController._.ItsCurtainsAniFinished();
                    }
                }
                Paint() {
                    let pos = { x: 0, y: 0 };
                    for (let i = 0; i < this.curtainPartCount; i++) {
                        engine_12.view.DrawBitmap(resourceids_10.BitmapId.CurtainPart, pos.x, pos.y);
                        pos.x += msx_8.TileSize;
                    }
                }
            };
            exports_38("ItsCurtainsForYou", ItsCurtainsForYou);
        }
    };
});
System.register("src/gameover", ["src/sintervaniamodel", "BoazEngineJS/direction", "src/textwriter", "BoazEngineJS/msx", "BoazEngineJS/engine", "BoazEngineJS/resourceids", "BoazEngineJS/input", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/mainmenu"], function (exports_39, context_39) {
    "use strict";
    var sintervaniamodel_12, direction_7, textwriter_3, msx_9, engine_13, resourceids_11, input_3, soundmaster_5, resourcemaster_5, gamecontroller_5, mainmenu_1, State, GameOver;
    var __moduleName = context_39 && context_39.id;
    return {
        setters: [
            function (sintervaniamodel_12_1) {
                sintervaniamodel_12 = sintervaniamodel_12_1;
            },
            function (direction_7_1) {
                direction_7 = direction_7_1;
            },
            function (textwriter_3_1) {
                textwriter_3 = textwriter_3_1;
            },
            function (msx_9_1) {
                msx_9 = msx_9_1;
            },
            function (engine_13_1) {
                engine_13 = engine_13_1;
            },
            function (resourceids_11_1) {
                resourceids_11 = resourceids_11_1;
            },
            function (input_3_1) {
                input_3 = input_3_1;
            },
            function (soundmaster_5_1) {
                soundmaster_5 = soundmaster_5_1;
            },
            function (resourcemaster_5_1) {
                resourcemaster_5 = resourcemaster_5_1;
            },
            function (gamecontroller_5_1) {
                gamecontroller_5 = gamecontroller_5_1;
            },
            function (mainmenu_1_1) {
                mainmenu_1 = mainmenu_1_1;
            }
        ],
        execute: function () {
            (function (State) {
                State[State["SelectContOrLoad"] = 0] = "SelectContOrLoad";
                State[State["SelectFile"] = 1] = "SelectFile";
            })(State || (State = {}));
            exports_39("State", State);
            GameOver = class GameOver {
                constructor() {
                }
                get cursorX() {
                    return GameOver.cursorPosX;
                }
                get cursorY() {
                    return GameOver.itemYs[this.selectedIndex];
                }
                Init() {
                    this.reset();
                }
                reset() {
                    this.selectedIndex = 0;
                    this.state = State.SelectContOrLoad;
                }
                HandleInput() {
                    let selectionChanged = false;
                    if (input_3.KeyState.KC_UP)
                        this.changeSelection(direction_7.Direction.Up, selectionChanged);
                    else if (input_3.KeyState.KC_RIGHT)
                        this.changeSelection(direction_7.Direction.Right, selectionChanged);
                    else if (input_3.KeyState.KC_DOWN)
                        this.changeSelection(direction_7.Direction.Down, selectionChanged);
                    else if (input_3.KeyState.KC_LEFT)
                        this.changeSelection(direction_7.Direction.Left, selectionChanged);
                    if (input_3.KeyState.KC_SPACE) {
                        switch (this.state) {
                            case State.SelectContOrLoad:
                                switch (this.selectedIndex) {
                                    case 0:
                                        gamecontroller_5.GameController._.LoadCheckpoint();
                                        break;
                                    case 1:
                                        soundmaster_5.SoundMaster.PlayEffect(resourcemaster_5.ResourceMaster.Sound[resourceids_11.AudioId.Selectie]);
                                        input_3.KeyState.KC_SPACE = false;
                                        sintervaniamodel_12.GameModel._.GameMenu.Open(mainmenu_1.MenuItem.LoadFromGameOver);
                                        this.state = State.SelectFile;
                                        break;
                                }
                                break;
                            case State.SelectFile:
                                break;
                        }
                    }
                    if (selectionChanged) {
                        soundmaster_5.SoundMaster.PlayEffect(resourcemaster_5.ResourceMaster.Sound[resourceids_11.AudioId.Selectie]);
                    }
                }
                changeSelection(dir, selectionChanged) {
                    if (this.state == State.SelectFile)
                        return;
                    switch (dir) {
                        case direction_7.Direction.Up:
                            if (this.selectedIndex > 0) {
                                this.selectedIndex = 0;
                                selectionChanged = true;
                            }
                            break;
                        case direction_7.Direction.Down:
                            if (this.selectedIndex < 1) {
                                this.selectedIndex = 1;
                                selectionChanged = true;
                            }
                            break;
                    }
                }
                TakeTurn() {
                }
                Paint() {
                    textwriter_3.TextWriter.DrawText(60, 56, ["Je bent vernederd!"]);
                    textwriter_3.TextWriter.DrawText(32, 80, ["Wat ga je doen,Belmont?"]);
                    engine_13.view.DrawRectangle(GameOver.boxX, GameOver.boxY, GameOver.boxEndX, GameOver.boxEndY, msx_9.MSXConstants.Msx1Colors[15]);
                    for (let i = 0; i < GameOver.items.length; i++)
                        textwriter_3.TextWriter.DrawText(GameOver.itemsX, GameOver.itemYs[i], [GameOver.items[i]]);
                    engine_13.view.DrawBitmap(resourceids_11.BitmapId.MenuCursor, this.cursorX, this.cursorY);
                }
                GameMenuClosed() {
                    this.reset();
                }
            };
            GameOver.items = new Array("Start bij controlepunt", "Laad spel");
            GameOver.itemYs = new Array(112, 128);
            GameOver.itemsX = 48;
            GameOver.cursorPosX = 36;
            GameOver.boxX = GameOver.cursorPosX - 8;
            GameOver.boxY = 104;
            GameOver.boxEndX = GameOver.boxX + 176 + 32;
            GameOver.boxEndY = GameOver.boxY + 24 + 16;
            exports_39("GameOver", GameOver);
        }
    };
});
System.register("src/title", ["BoazEngineJS/animation", "BoazEngineJS/common", "BoazEngineJS/resourceids", "src/gamecontroller", "BoazEngineJS/input", "BoazEngineJS/engine"], function (exports_40, context_40) {
    "use strict";
    var animation_2, common_13, resourceids_12, gamecontroller_6, input_4, engine_14, State, Title;
    var __moduleName = context_40 && context_40.id;
    return {
        setters: [
            function (animation_2_1) {
                animation_2 = animation_2_1;
            },
            function (common_13_1) {
                common_13 = common_13_1;
            },
            function (resourceids_12_1) {
                resourceids_12 = resourceids_12_1;
            },
            function (gamecontroller_6_1) {
                gamecontroller_6 = gamecontroller_6_1;
            },
            function (input_4_1) {
                input_4 = input_4_1;
            },
            function (engine_14_1) {
                engine_14 = engine_14_1;
            }
        ],
        execute: function () {
            (function (State) {
                State[State["WaitForIt"] = 0] = "WaitForIt";
                State[State["Konami"] = 1] = "Konami";
                State[State["TitleTop"] = 2] = "TitleTop";
                State[State["TitleBottom"] = 3] = "TitleBottom";
                State[State["WaitForItAgain"] = 4] = "WaitForItAgain";
                State[State["Other"] = 5] = "Other";
            })(State || (State = {}));
            exports_40("State", State);
            Title = class Title {
                constructor() {
                    this.titleAni = new animation_2.Animation(Title.titleStates, Title.titleMoves);
                    this.titleTopPos = { x: 0, y: 0 };
                    this.titleBottomPos = { x: 0, y: 0 };
                }
                Init() {
                    this.reset();
                }
                reset() {
                    common_13.setPoint(this.titleTopPos, Title.titleTopStartX, Title.titleTopY);
                    common_13.setPoint(this.titleBottomPos, Title.titleBottomStartX, Title.titleBottomY);
                    this.titleAni.restart();
                    this.state = this.titleAni.stepValue();
                }
                TakeTurn() {
                    let newState = { nextStepValue: this.state };
                    if (input_4.KeyState.KC_SPACE) {
                        gamecontroller_6.GameController._.PreludeFinished();
                        input_4.KeyState.KC_SPACE = false;
                        return;
                    }
                    switch (this.state) {
                        case State.WaitForIt:
                        case State.WaitForItAgain:
                            if (this.titleAni.doAnimation(1, newState)) {
                                this.state = newState.nextStepValue;
                            }
                            break;
                        case State.Konami:
                            if (this.titleAni.doAnimation(1, newState)) {
                                this.state = newState.nextStepValue;
                            }
                            break;
                        case State.TitleTop:
                            if ((engine_14.game.TurnCounter & 1) == 0) {
                                this.titleTopPos.x += Title.deltaX;
                                if (this.titleAni.doAnimation(Title.deltaX, newState)) {
                                    this.state = newState.nextStepValue;
                                }
                            }
                            break;
                        case State.TitleBottom:
                            if ((engine_14.game.TurnCounter & 1) == 0) {
                                this.titleBottomPos.x -= Title.deltaX;
                                if (this.titleAni.doAnimation(Title.deltaX, newState)) {
                                    this.state = newState.nextStepValue;
                                }
                            }
                            break;
                        case State.Other:
                            gamecontroller_6.GameController._.PreludeFinished();
                            break;
                    }
                }
                Paint() {
                    engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelBoven, this.titleTopPos.x, this.titleTopPos.y);
                    engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelOnder, this.titleBottomPos.x, this.titleBottomPos.y);
                    if (this.state != State.WaitForIt)
                        engine_14.view.DrawBitmap(resourceids_12.BitmapId.TitelKonami, Title.konamiX, Title.konamiY);
                }
            };
            Title.titleTopY = 16;
            Title.titleBottomY = 41;
            Title.titleTopStartX = -216;
            Title.titleBottomStartX = 256;
            Title.titleTopEndX = 24;
            Title.titleBottomEndX = 64;
            Title.deltaX = 8;
            Title.waitFrames = 50;
            Title.waitKonamiFrames = 100;
            Title.konamiX = 76;
            Title.konamiY = 103;
            Title.titleStates = new Array(State.WaitForIt, State.Konami, State.TitleTop, State.TitleBottom, State.WaitForItAgain, State.Other);
            Title.titleMoves = new Array(Title.waitFrames, Title.waitKonamiFrames, -Title.titleTopStartX + Title.titleTopEndX, Title.titleBottomStartX - Title.titleBottomEndX, Title.waitFrames, 0);
            exports_40("Title", Title);
        }
    };
});
System.register("src/enddemo", ["src/textwriter", "BoazEngineJS/btimer", "BoazEngineJS/animation", "BoazEngineJS/msx"], function (exports_41, context_41) {
    "use strict";
    var textwriter_4, btimer_6, animation_3, msx_10, State, EndDemo;
    var __moduleName = context_41 && context_41.id;
    return {
        setters: [
            function (textwriter_4_1) {
                textwriter_4 = textwriter_4_1;
            },
            function (btimer_6_1) {
                btimer_6 = btimer_6_1;
            },
            function (animation_3_1) {
                animation_3 = animation_3_1;
            },
            function (msx_10_1) {
                msx_10 = msx_10_1;
            }
        ],
        execute: function () {
            (function (State) {
                State[State["Sint"] = 0] = "Sint";
                State[State["WaitForBoaz"] = 1] = "WaitForBoaz";
                State[State["Boaz"] = 2] = "Boaz";
                State[State["None"] = 3] = "None";
            })(State || (State = {}));
            exports_41("State", State);
            EndDemo = class EndDemo {
                constructor() {
                    this.ani = new animation_3.Animation(EndDemo.states, EndDemo.waits);
                    this.timer = btimer_6.BStopwatch.createWatch();
                }
                Init() {
                    this.reset();
                }
                reset() {
                    this.ani.restart();
                    this.timer.restart();
                    this.state = this.ani.stepValue();
                }
                TakeTurn() {
                    let newState;
                    switch (this.state) {
                        case State.Sint:
                        case State.WaitForBoaz:
                            if (this.ani.doAnimation(this.timer, newState)) {
                                this.state = newState.nextStepValue;
                            }
                            break;
                        default:
                            break;
                    }
                }
                Paint() {
                    switch (this.state) {
                        case State.Sint:
                            textwriter_4.TextWriter.DrawText(20, 192, "Redelijk gedaan, Belmont!");
                            break;
                        case State.Boaz:
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(9), "Zo, dat was het weer!");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(11), "ervan hebben genoten");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(12), "en dat is ook terecht.");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(14), "Dit verhaal is nog niet");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(15), "afgelopen,dus bij");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(16), "belangstelling komt er");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(17), "wellicht een nieuw");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(18), "hoofdstuk in dit");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(19), "spannende en meeslepende");
                            textwriter_4.TextWriter.DrawText(msx_10.Tile.ToCoord(1), msx_10.Tile.ToCoord(20), "verhaal!");
                            break;
                    }
                }
            };
            EndDemo.states = [State.Sint, State.WaitForBoaz, State.Boaz];
            EndDemo.waits = [10000, 1000, 0];
            exports_41("EndDemo", EndDemo);
        }
    };
});
System.register("BoazEngineJS/gameoptions", ["BoazEngineJS/msx"], function (exports_42, context_42) {
    "use strict";
    var msx_11, GameOptions;
    var __moduleName = context_42 && context_42.id;
    return {
        setters: [
            function (msx_11_1) {
                msx_11 = msx_11_1;
            }
        ],
        execute: function () {
            GameOptions = class GameOptions {
                static get WindowWidth() {
                    return (msx_11.MSXConstants.MSX2ScreenWidth * GameOptions.Scale);
                }
                static get WindowHeight() {
                    return (msx_11.MSXConstants.MSX2ScreenHeight * GameOptions.Scale);
                }
                static get BufferWidth() {
                    return (msx_11.MSXConstants.MSX2ScreenWidth * GameOptions.Scale);
                }
                static get BufferHeight() {
                    return (msx_11.MSXConstants.MSX2ScreenHeight * GameOptions.Scale);
                }
            };
            GameOptions.INITIAL_SCALE = 1;
            GameOptions.INITIAL_FULLSCREEN = false;
            GameOptions.Scale = GameOptions.INITIAL_SCALE;
            GameOptions.Fullscreen = GameOptions.INITIAL_FULLSCREEN;
            GameOptions.EffectsVolumePercentage = 100;
            GameOptions.MusicVolumePercentage = 100;
            exports_42("GameOptions", GameOptions);
        }
    };
});
System.register("src/gameview", ["src/hud", "src/itscurtainsforyou", "src/gameover", "src/mainmenu", "src/title", "BoazEngineJS/model", "src/gameconstants", "src/sintervaniamodel", "src/textwriter", "BoazEngineJS/engine", "BoazEngineJS/msx", "src/enddemo", "BoazEngineJS/gameoptions"], function (exports_43, context_43) {
    "use strict";
    var hud_1, itscurtainsforyou_1, gameover_1, mainmenu_2, title_1, model_3, gameconstants_5, sintervaniamodel_13, textwriter_5, engine_15, msx_12, enddemo_1, gameoptions_2, GameView;
    var __moduleName = context_43 && context_43.id;
    return {
        setters: [
            function (hud_1_1) {
                hud_1 = hud_1_1;
            },
            function (itscurtainsforyou_1_1) {
                itscurtainsforyou_1 = itscurtainsforyou_1_1;
            },
            function (gameover_1_1) {
                gameover_1 = gameover_1_1;
            },
            function (mainmenu_2_1) {
                mainmenu_2 = mainmenu_2_1;
            },
            function (title_1_1) {
                title_1 = title_1_1;
            },
            function (model_3_1) {
                model_3 = model_3_1;
            },
            function (gameconstants_5_1) {
                gameconstants_5 = gameconstants_5_1;
            },
            function (sintervaniamodel_13_1) {
                sintervaniamodel_13 = sintervaniamodel_13_1;
            },
            function (textwriter_5_1) {
                textwriter_5 = textwriter_5_1;
            },
            function (engine_15_1) {
                engine_15 = engine_15_1;
            },
            function (msx_12_1) {
                msx_12 = msx_12_1;
            },
            function (enddemo_1_1) {
                enddemo_1 = enddemo_1_1;
            },
            function (gameoptions_2_1) {
                gameoptions_2 = gameoptions_2_1;
            }
        ],
        execute: function () {
            GameView = class GameView {
                constructor() {
                    GameView._instance = this;
                }
                static get _() {
                    return GameView._instance;
                }
                get ShowFoeBar() {
                    return sintervaniamodel_13.GameModel._.BossBattle;
                }
                get FoeHealthPercentage() {
                    let foe = sintervaniamodel_13.GameModel._.LastFoeThatWasHit;
                    if (foe == null) {
                        if (!sintervaniamodel_13.GameModel._.BossBattle)
                            return -1;
                        else
                            foe = sintervaniamodel_13.GameModel._.Boss;
                    }
                    if (foe.disposeFlag)
                        return 0;
                    return foe.HealthPercentage;
                }
                get FoeForWhichHealthPercentageIsGiven() {
                    return sintervaniamodel_13.GameModel._.LastFoeThatWasHit != null ? sintervaniamodel_13.GameModel._.LastFoeThatWasHit : sintervaniamodel_13.GameModel._.Boss;
                }
                static DetermineMaxScaleForFullscreen(clientWidth, clientHeight, originalBufferWidth, originalBufferHeight) {
                    if (clientWidth >= clientHeight) {
                        return clientHeight / originalBufferHeight;
                    }
                    else {
                        return clientWidth / originalBufferWidth;
                    }
                }
                ChangeScale(newScale) {
                    gameoptions_2.GameOptions.Scale = newScale;
                    this.scaleChanged();
                }
                scaleChanged() {
                    throw Error("Not implemented!");
                }
                ToFullscreen() {
                    throw Error("Not implemented!");
                }
                ToWindowed() {
                    throw Error("Not implemented!");
                }
                init() {
                    this.Hud = new hud_1.HUD();
                    this.ItsCurtains = new itscurtainsforyou_1.ItsCurtainsForYou();
                    this.GameOverScreen = new gameover_1.GameOver();
                    this.MainMenu = new mainmenu_2.MainMenu();
                    this.Title = new title_1.Title();
                    this.EndDemo = new enddemo_1.EndDemo();
                }
                drawGame(elapsedMs) {
                    console.info(`drawGame wordt nu uitgevoerd. ElapsedMs: ${elapsedMs}`);
                    if (sintervaniamodel_13.GameModel._.startAfterLoad)
                        return;
                    switch (sintervaniamodel_13.GameModel._.gameState) {
                        case model_3.GameState.Prelude:
                            this.Title.Paint();
                            break;
                        case model_3.GameState.TitleScreen:
                            this.MainMenu.Paint();
                            sintervaniamodel_13.GameModel._.GameMenu.Paint();
                            break;
                        case model_3.GameState.EndDemo:
                            this.EndDemo.Paint();
                            break;
                        case model_3.GameState.Game:
                        case model_3.GameState.Event:
                            let gamescreenOffset = { x: gameconstants_5.GameConstants.GameScreenStartX, y: gameconstants_5.GameConstants.GameScreenStartY };
                            if (sintervaniamodel_13.GameModel._.gameSubstate != model_3.GameSubstate.SwitchRoom) {
                                sintervaniamodel_13.GameModel._.CurrentRoom.Paint();
                                sintervaniamodel_13.GameModel._.objects.sort(o => o.priority).sort(o => o.pos.y + o.size.y).forEach(o => o.paint(gamescreenOffset));
                            }
                            this.Hud.Paint();
                            switch (sintervaniamodel_13.GameModel._.gameSubstate) {
                                case model_3.GameSubstate.SwitchRoom:
                                case model_3.GameSubstate.BelmontDies:
                                case model_3.GameSubstate.ItsCurtainsForYou:
                                case model_3.GameSubstate.ToEndDemo:
                                case model_3.GameSubstate.GameOver:
                                    break;
                                default:
                                    break;
                            }
                            if (sintervaniamodel_13.GameModel._.gameSubstate != model_3.GameSubstate.SwitchRoom) {
                            }
                            if (sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.ItsCurtainsForYou || sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.ToEndDemo) {
                                this.ItsCurtains.Paint();
                            }
                            else if (sintervaniamodel_13.GameModel._.gameSubstate == model_3.GameSubstate.GameOver) {
                                this.ItsCurtains.Paint();
                                this.GameOverScreen.Paint();
                            }
                            sintervaniamodel_13.GameModel._.GameMenu.Paint();
                            if (sintervaniamodel_13.GameModel._.paused) {
                                engine_15.view.FillRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, msx_12.MSXConstants.Msx1Colors[1]);
                                engine_15.view.DrawRectangle(GameView.pausePosX, GameView.pausePosY, GameView.pauseEndX, GameView.pauseEndY, msx_12.MSXConstants.Msx1Colors[15]);
                                textwriter_5.TextWriter.DrawText(GameView.pauseTextPosX, GameView.pauseTextPosY, GameView.pauseText);
                            }
                            break;
                    }
                }
            };
            GameView.pausePosX = 80;
            GameView.pausePosY = 80;
            GameView.pauseTextPosX = 104;
            GameView.pauseTextPosY = 96;
            GameView.pauseEndX = 176;
            GameView.pauseEndY = 120;
            GameView.pauseText = "Paused";
            exports_43("GameView", GameView);
        }
    };
});
System.register("src/gamemenu", ["src/mainmenu", "src/gameview", "BoazEngineJS/resourceids", "BoazEngineJS/direction", "src/textwriter", "BoazEngineJS/input", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "src/sintervaniamodel", "BoazEngineJS/gamestateloader", "BoazEngineJS/gameoptions", "BoazEngineJS/msx", "BoazEngineJS/constants", "BoazEngineJS/common", "BoazEngineJS/engine", "BoazEngineJS/model"], function (exports_44, context_44) {
    "use strict";
    var mainmenu_3, gameview_2, resourceids_13, direction_8, textwriter_6, input_5, soundmaster_6, resourcemaster_6, gamecontroller_7, sintervaniamodel_14, gamestateloader_3, gameoptions_3, msx_13, constants_9, common_14, engine_16, model_4, GameMenu;
    var __moduleName = context_44 && context_44.id;
    return {
        setters: [
            function (mainmenu_3_1) {
                mainmenu_3 = mainmenu_3_1;
            },
            function (gameview_2_1) {
                gameview_2 = gameview_2_1;
            },
            function (resourceids_13_1) {
                resourceids_13 = resourceids_13_1;
            },
            function (direction_8_1) {
                direction_8 = direction_8_1;
            },
            function (textwriter_6_1) {
                textwriter_6 = textwriter_6_1;
            },
            function (input_5_1) {
                input_5 = input_5_1;
            },
            function (soundmaster_6_1) {
                soundmaster_6 = soundmaster_6_1;
            },
            function (resourcemaster_6_1) {
                resourcemaster_6 = resourcemaster_6_1;
            },
            function (gamecontroller_7_1) {
                gamecontroller_7 = gamecontroller_7_1;
            },
            function (sintervaniamodel_14_1) {
                sintervaniamodel_14 = sintervaniamodel_14_1;
            },
            function (gamestateloader_3_1) {
                gamestateloader_3 = gamestateloader_3_1;
            },
            function (gameoptions_3_1) {
                gameoptions_3 = gameoptions_3_1;
            },
            function (msx_13_1) {
                msx_13 = msx_13_1;
            },
            function (constants_9_1) {
                constants_9 = constants_9_1;
            },
            function (common_14_1) {
                common_14 = common_14_1;
            },
            function (engine_16_1) {
                engine_16 = engine_16_1;
            },
            function (model_4_1) {
                model_4 = model_4_1;
            }
        ],
        execute: function () {
            GameMenu = class GameMenu {
                constructor() {
                    this.visible = false;
                    this.cursorPos = { x: 0, y: 0 };
                    this.selectedItemIndex = 0;
                    this.CurrentScreen = mainmenu_3.MenuItem.Main;
                }
                Open(currentscreen = mainmenu_3.MenuItem.Main) {
                    this.selectedItemIndex = 0;
                    this.visible = true;
                    this.CurrentScreen = currentscreen;
                    if (this.CurrentScreen == mainmenu_3.MenuItem.Main)
                        soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                }
                Close() {
                    this.visible = false;
                    this.selectedItemIndex = 0;
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                            gameview_2.GameView._.MainMenu.GameMenuClosed();
                            break;
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                            gameview_2.GameView._.MainMenu.GameMenuClosed();
                            break;
                        default:
                            sintervaniamodel_14.GameModel._.ItemsInInventory.filter(i => i.Amount != 0);
                            break;
                    }
                }
                TakeTurn() {
                    if (!this.visible)
                        return;
                    common_14.setPoint(this.cursorPos, this.calculateCursorX(), this.calculateCursorY());
                }
                HandleInput() {
                    let selectionChanged = false;
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Main:
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                        case mainmenu_3.MenuItem.Save:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                            if (input_5.KeyState.KC_UP)
                                this.changeSelection(direction_8.Direction.Up, selectionChanged);
                            else if (input_5.KeyState.KC_RIGHT)
                                this.changeSelection(direction_8.Direction.Right, selectionChanged);
                            else if (input_5.KeyState.KC_DOWN)
                                this.changeSelection(direction_8.Direction.Down, selectionChanged);
                            else if (input_5.KeyState.KC_LEFT)
                                this.changeSelection(direction_8.Direction.Left, selectionChanged);
                            break;
                    }
                    if (input_5.KeyState.KC_SPACE) {
                        switch (this.CurrentScreen) {
                            case mainmenu_3.MenuItem.Main:
                                soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.ReturnToGame:
                                        gamecontroller_7.GameController._.CloseGameMenu();
                                        break;
                                    case mainmenu_3.MenuItem.ChangeOptions:
                                        this.CurrentScreen = mainmenu_3.MenuItem.Options;
                                        this.selectedItemIndex = 0;
                                        break;
                                    case mainmenu_3.MenuItem.LoadGame:
                                        this.CurrentScreen = mainmenu_3.MenuItem.Load;
                                        this.selectedItemIndex = 0;
                                        break;
                                    case mainmenu_3.MenuItem.SaveGame:
                                        if (sintervaniamodel_14.GameModel._.State != model_4.GameState.Event) {
                                            this.CurrentScreen = mainmenu_3.MenuItem.Save;
                                            this.selectedItemIndex = 0;
                                        }
                                        else
                                            soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                        break;
                                    case mainmenu_3.MenuItem.ExitGame:
                                        throw Error("Game afluiten is niet geimplementeerd :-o");
                                        break;
                                }
                                break;
                            case mainmenu_3.MenuItem.Load:
                            case mainmenu_3.MenuItem.LoadFromGameOver:
                            case mainmenu_3.MenuItem.LoadFromMainMenu:
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.ReturnToMain:
                                        soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                        switch (this.CurrentScreen) {
                                            case mainmenu_3.MenuItem.LoadFromGameOver:
                                            case mainmenu_3.MenuItem.LoadFromMainMenu:
                                                this.Close();
                                                break;
                                            default:
                                                this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                                this.selectedItemIndex = 0;
                                                break;
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.SaveSlot:
                                        {
                                            let slot = this.selectedItemIndex - 1;
                                            if (gamestateloader_3.SlotExists(slot)) {
                                                let sg = gamestateloader_3.LoadGame(slot);
                                                gamecontroller_7.GameController._.LoadGame(sg);
                                            }
                                            else
                                                soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                        }
                                        break;
                                }
                                break;
                            case mainmenu_3.MenuItem.Save:
                                soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.ReturnToMain:
                                        this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                        this.selectedItemIndex = 0;
                                        break;
                                    case mainmenu_3.MenuItem.SaveSlot:
                                        {
                                            let slot = this.selectedItemIndex - 1;
                                            gamecontroller_7.GameController._.SaveGame(slot);
                                        }
                                        break;
                                }
                                break;
                            case mainmenu_3.MenuItem.Options:
                            case mainmenu_3.MenuItem.OptionsFromMainMenu:
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.ReturnToMain:
                                        soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                                        switch (this.CurrentScreen) {
                                            case mainmenu_3.MenuItem.OptionsFromMainMenu:
                                                this.Close();
                                                break;
                                            default:
                                                this.CurrentScreen = mainmenu_3.MenuItem.Main;
                                                this.selectedItemIndex = 0;
                                                break;
                                        }
                                        break;
                                    default:
                                        soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Fout]);
                                        break;
                                }
                                break;
                        }
                    }
                    if (input_5.KeyState.KC_RIGHT) {
                        switch (this.CurrentScreen) {
                            case mainmenu_3.MenuItem.Options:
                            case mainmenu_3.MenuItem.OptionsFromMainMenu:
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.Scale:
                                        if (!gameoptions_3.GameOptions.Fullscreen) {
                                            gameview_2.GameView._.ChangeScale(gameoptions_3.GameOptions.Scale + 1);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.Fullscreen:
                                        if (gameoptions_3.GameOptions.Fullscreen) {
                                            gameoptions_3.GameOptions.Fullscreen = false;
                                            gameview_2.GameView._.ToWindowed();
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.EffectVolume:
                                        if (gameoptions_3.GameOptions.EffectsVolumePercentage < 100) {
                                            gameoptions_3.GameOptions.EffectsVolumePercentage += 10;
                                            if (gameoptions_3.GameOptions.EffectsVolumePercentage > 100)
                                                gameoptions_3.GameOptions.EffectsVolumePercentage = 100;
                                            soundmaster_6.SoundMaster.SetEffectsVolume(gameoptions_3.GameOptions.EffectsVolumePercentage / 100);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.MusicVolume:
                                        if (gameoptions_3.GameOptions.MusicVolumePercentage < 100) {
                                            gameoptions_3.GameOptions.MusicVolumePercentage += 10;
                                            if (gameoptions_3.GameOptions.MusicVolumePercentage > 100)
                                                gameoptions_3.GameOptions.MusicVolumePercentage = 100;
                                            soundmaster_6.SoundMaster.SetMusicVolume(gameoptions_3.GameOptions.MusicVolumePercentage / 100);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                }
                                break;
                        }
                    }
                    if (input_5.KeyState.KC_LEFT) {
                        switch (this.CurrentScreen) {
                            case mainmenu_3.MenuItem.Options:
                            case mainmenu_3.MenuItem.OptionsFromMainMenu:
                                switch (this.selectedItem) {
                                    case mainmenu_3.MenuItem.Scale:
                                        if (!gameoptions_3.GameOptions.Fullscreen && gameoptions_3.GameOptions.Scale > 1) {
                                            gameview_2.GameView._.ChangeScale(gameoptions_3.GameOptions.Scale - 1);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.Fullscreen:
                                        if (!gameoptions_3.GameOptions.Fullscreen) {
                                            gameoptions_3.GameOptions.Fullscreen = true;
                                            gameview_2.GameView._.ToFullscreen();
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.EffectVolume:
                                        if (gameoptions_3.GameOptions.EffectsVolumePercentage > 0) {
                                            gameoptions_3.GameOptions.EffectsVolumePercentage -= 10;
                                            if (gameoptions_3.GameOptions.EffectsVolumePercentage < 0)
                                                gameoptions_3.GameOptions.EffectsVolumePercentage = 0;
                                            soundmaster_6.SoundMaster.SetEffectsVolume(gameoptions_3.GameOptions.EffectsVolumePercentage / 100);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                    case mainmenu_3.MenuItem.MusicVolume:
                                        if (gameoptions_3.GameOptions.MusicVolumePercentage > 0) {
                                            gameoptions_3.GameOptions.MusicVolumePercentage -= 10;
                                            if (gameoptions_3.GameOptions.MusicVolumePercentage < 0)
                                                gameoptions_3.GameOptions.MusicVolumePercentage = 0;
                                            soundmaster_6.SoundMaster.SetMusicVolume(gameoptions_3.GameOptions.MusicVolumePercentage / 100);
                                            engine_16.game.GameOptionsChanged();
                                        }
                                        break;
                                }
                                break;
                        }
                    }
                    if (selectionChanged) {
                        soundmaster_6.SoundMaster.PlayEffect(resourcemaster_6.ResourceMaster.Sound[resourceids_13.AudioId.Selectie]);
                    }
                }
                calculateCursorX() {
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                        case mainmenu_3.MenuItem.Main:
                            return GameMenu.menuPosX + GameMenu.mainItemsOffsetX + GameMenu.cursorOffsetX;
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                        case mainmenu_3.MenuItem.Save:
                            return GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX + GameMenu.cursorOffsetX;
                    }
                    return 0;
                }
                calculateCursorY() {
                    switch (this.CurrentScreen) {
                        default:
                            return GameMenu.cursorOffsetY + GameMenu.cursorVerticalSkipPerEntry * this.selectedItemIndex;
                    }
                }
                changeSelection(direction, selectionChanged) {
                    let maxX, maxY, x, y;
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Main:
                            x = 0;
                            y = this.selectedItemIndex;
                            maxX = 0;
                            maxY = GameMenu.mainItems.length - 1;
                            break;
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                            x = 0;
                            y = this.selectedItemIndex;
                            maxX = 0;
                            maxY = GameMenu.optionsItems.length - 1;
                            break;
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.Save:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                            x = 0;
                            y = this.selectedItemIndex;
                            maxX = 0;
                            maxY = constants_9.Constants.SaveSlotCount;
                            break;
                        default:
                            maxX = maxY = x = y = 0;
                            break;
                    }
                    switch (direction) {
                        case direction_8.Direction.Up:
                            if (y > 0)
                                y--;
                            else
                                y = maxY;
                            selectionChanged = true;
                            break;
                        case direction_8.Direction.Right:
                            if (x < maxX) {
                                x++;
                                selectionChanged = true;
                            }
                            break;
                        case direction_8.Direction.Down:
                            if (y < maxY)
                                y++;
                            else
                                y = 0;
                            selectionChanged = true;
                            break;
                        case direction_8.Direction.Left:
                            if (x > 0) {
                                x--;
                                selectionChanged = true;
                            }
                            break;
                    }
                    this.selectedItemIndex = y;
                }
                get selectedItem() {
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Main:
                        default:
                            return GameMenu.mainItems[this.selectedItemIndex].type;
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.Save:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                            return this.selectedItemIndex > 0 ? mainmenu_3.MenuItem.SaveSlot : mainmenu_3.MenuItem.ReturnToMain;
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                            return GameMenu.optionsItems[this.selectedItemIndex].type;
                    }
                }
                Paint() {
                    if (!this.visible)
                        return;
                    engine_16.view.FillRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, msx_13.MSXConstants.Msx1Colors[1]);
                    engine_16.view.DrawRectangle(GameMenu.menuPosX, GameMenu.menuPosY, GameMenu.menuEndX, GameMenu.menuEndY, msx_13.MSXConstants.Msx1Colors[15]);
                    let titleToDraw;
                    let titleX, titleY;
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Main:
                            titleToDraw = GameMenu.menuText;
                            titleX = GameMenu.mainMenuTextX;
                            titleY = GameMenu.mainMenuTextY;
                            break;
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                            titleToDraw = GameMenu.optionMenuText;
                            titleX = GameMenu.mainMenuTextX;
                            titleY = GameMenu.mainMenuTextY;
                            break;
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                            titleToDraw = GameMenu.loadMenuText;
                            titleX = GameMenu.mainMenuTextX;
                            titleY = GameMenu.mainMenuTextY;
                            break;
                        case mainmenu_3.MenuItem.Save:
                            titleToDraw = GameMenu.saveMenuText;
                            titleX = GameMenu.mainMenuTextX;
                            titleY = GameMenu.mainMenuTextY;
                            break;
                        default:
                            titleToDraw = "No title to draw!";
                            titleX = GameMenu.mainMenuTextX;
                            titleY = GameMenu.mainMenuTextY;
                            break;
                    }
                    textwriter_6.TextWriter.DrawText(titleX, titleY, titleToDraw);
                    let y = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
                    switch (this.CurrentScreen) {
                        case mainmenu_3.MenuItem.Main:
                        default:
                            {
                                GameMenu.mainItems.forEach(function (item) {
                                    switch (item.type) {
                                        case mainmenu_3.MenuItem.SaveGame:
                                            if (sintervaniamodel_14.GameModel._.State != model_4.GameState.Event)
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                            else
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, msx_13.MSXConstants.Msx1ExtColors[0]);
                                            break;
                                        default:
                                            textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                            break;
                                    }
                                    y += GameMenu.itemOffsetY;
                                });
                                break;
                            }
                        case mainmenu_3.MenuItem.Options:
                        case mainmenu_3.MenuItem.OptionsFromMainMenu:
                            {
                                GameMenu.optionsItems.forEach(function (item) {
                                    let offsetX = GameMenu.menuPosX + GameMenu.mainItemsOffsetX;
                                    switch (item.type) {
                                        case mainmenu_3.MenuItem.Scale:
                                            let textToDisplay;
                                            if (!gameoptions_3.GameOptions.Fullscreen) {
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                                offsetX += GameMenu.scaleText.length * textwriter_6.TextWriter.FontWidth;
                                                textwriter_6.TextWriter.DrawText(offsetX, y, `${gameoptions_3.GameOptions.Scale}X`);
                                            }
                                            else {
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label, msx_13.MSXConstants.Msx1ExtColors[0]);
                                                offsetX += GameMenu.scaleText.length * textwriter_6.TextWriter.FontWidth;
                                                textwriter_6.TextWriter.DrawText(offsetX, y, `${gameoptions_3.GameOptions.Scale}X`);
                                            }
                                            break;
                                        case mainmenu_3.MenuItem.Fullscreen:
                                            textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                            this.printFullscreenOptionRectangle(y);
                                            break;
                                        case mainmenu_3.MenuItem.EffectVolume:
                                            {
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                                offsetX += GameMenu.effectVolumeText.length * textwriter_6.TextWriter.FontWidth;
                                                let text = gameoptions_3.GameOptions.EffectsVolumePercentage > 0 ? gameoptions_3.GameOptions.EffectsVolumePercentage + "%" : "Off";
                                                textwriter_6.TextWriter.DrawText(offsetX, y, text);
                                            }
                                            break;
                                        case mainmenu_3.MenuItem.MusicVolume:
                                            {
                                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                                offsetX += GameMenu.musicVolumeText.length * textwriter_6.TextWriter.FontWidth;
                                                let text = gameoptions_3.GameOptions.MusicVolumePercentage > 0 ? gameoptions_3.GameOptions.MusicVolumePercentage + "%" : "Off";
                                                textwriter_6.TextWriter.DrawText(offsetX, y, text);
                                            }
                                            break;
                                        default:
                                            textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.mainItemsOffsetX, y, item.label);
                                            break;
                                    }
                                    y += GameMenu.itemOffsetY;
                                });
                                break;
                            }
                        case mainmenu_3.MenuItem.Load:
                        case mainmenu_3.MenuItem.LoadFromGameOver:
                        case mainmenu_3.MenuItem.LoadFromMainMenu:
                            {
                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                                y += GameMenu.itemOffsetY;
                                for (let i = 0; i < constants_9.Constants.SaveSlotCount; i++) {
                                    this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                                    y += GameMenu.itemOffsetY;
                                }
                                break;
                            }
                        case mainmenu_3.MenuItem.Save:
                            {
                                textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, GameMenu.backText);
                                y += GameMenu.itemOffsetY;
                                for (let i = 0; i < constants_9.Constants.SaveSlotCount; i++) {
                                    this.printSaveSlot(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, i);
                                    y += GameMenu.itemOffsetY;
                                }
                                break;
                            }
                    }
                    engine_16.view.DrawBitmap(resourceids_13.BitmapId.MenuCursor, this.cursorPos.x, this.cursorPos.y);
                }
                printFullscreenOptionRectangle(y) {
                    let selectedIndex = gameoptions_3.GameOptions.Fullscreen ? 0 : 1;
                    engine_16.view.DrawRectangle(GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY, GameMenu.fullscreenOptionsOffsets[selectedIndex] + GameMenu.fullscreenOptionsRectangleSize.x + GameMenu.menuPosX + GameMenu.optionItemsOffsetX, y + GameMenu.fullscreenOptionsOffsetY + GameMenu.fullscreenOptionsRectangleSize.y, msx_13.MSXConstants.Msx1Colors[6]);
                }
                printSaveSlot(x, y, slotIndex) {
                    let exists = gamestateloader_3.SlotExists(slotIndex);
                    if (!exists) {
                        textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex} + 1: ${GameMenu.emptySlot}`);
                        return;
                    }
                    let savegame = gamestateloader_3.LoadGame(slotIndex);
                    let time = savegame.Timestamp;
                    textwriter_6.TextWriter.DrawText(GameMenu.menuPosX + GameMenu.loadsaveItemOffsetX, y, `${slotIndex + 1}: ${time.getDay().toFixed(2)}/${time.getMonth().toFixed(2)}/${time.getFullYear().toFixed(2)} - ${time.getHours().toFixed(2)}:${time.getMinutes().toFixed(2)}`);
                }
            };
            GameMenu.menuPosX = 24;
            GameMenu.menuPosY = 24;
            GameMenu.menuEndX = 240;
            GameMenu.menuEndY = 176;
            GameMenu.cursorVerticalSkipPerEntry = 16;
            GameMenu.mainItemsOffsetX = 56;
            GameMenu.loadsaveItemOffsetX = 24;
            GameMenu.optionItemsOffsetX = 56;
            GameMenu.itemOffsetY = 16;
            GameMenu.itemVerticalSkipPerEntry = GameMenu.cursorVerticalSkipPerEntry;
            GameMenu.menuText = "- Game Menu -";
            GameMenu.loadMenuText = "- Load game -";
            GameMenu.saveMenuText = "- Save game -";
            GameMenu.optionMenuText = "- Options -";
            GameMenu.backText = "Back";
            GameMenu.emptySlot = "----";
            GameMenu.scaleText = "Scale: ";
            GameMenu.effectVolumeText = "Effects: ";
            GameMenu.musicVolumeText = "Music: ";
            GameMenu.mainMenuTextX = GameMenu.menuPosX + 56;
            GameMenu.mainMenuTextY = GameMenu.menuPosY + 16;
            GameMenu.cursorOffsetX = -16;
            GameMenu.cursorOffsetY = GameMenu.mainMenuTextY + GameMenu.itemOffsetY;
            GameMenu.mainItems = [
                { type: mainmenu_3.MenuItem.ChangeOptions, label: "Options" },
                { type: mainmenu_3.MenuItem.LoadGame, label: "Load game" },
                { type: mainmenu_3.MenuItem.SaveGame, label: "Save game" },
                { type: mainmenu_3.MenuItem.ExitGame, label: "Exit game" },
                { type: mainmenu_3.MenuItem.ReturnToGame, label: "Return to game" },
            ];
            GameMenu.optionsItems = [
                { type: mainmenu_3.MenuItem.ReturnToMain, label: GameMenu.backText },
                { type: mainmenu_3.MenuItem.Scale, label: GameMenu.scaleText },
                { type: mainmenu_3.MenuItem.Fullscreen, label: "Fullscreen: y n" },
                { type: mainmenu_3.MenuItem.MusicVolume, label: GameMenu.musicVolumeText },
                { type: mainmenu_3.MenuItem.EffectVolume, label: GameMenu.effectVolumeText }
            ];
            GameMenu.fullscreenOptionsOffsets = [textwriter_6.TextWriter.FontWidth * 12 - 1, textwriter_6.TextWriter.FontWidth * 14 - 1];
            GameMenu.fullscreenOptionsOffsetY = -1;
            GameMenu.fullscreenOptionsRectangleSize = common_14.newSize(textwriter_6.TextWriter.FontWidth + 2, textwriter_6.TextWriter.FontHeight + 2);
            exports_44("GameMenu", GameMenu);
        }
    };
});
System.register("src/gamecontroller", ["BoazEngineJS/btimer", "src/item", "BoazEngineJS/resourceids", "BoazEngineJS/direction", "src/bootstrapper", "src/sintervaniamodel", "BoazEngineJS/model", "BoazEngineJS/input", "src/weaponfirehandler", "src/room", "src/gamemenu", "BoazEngineJS/common", "BoazEngineJS/soundmaster", "src/resourcemaster", "BoazEngineJS/constants", "src/gameview", "src/gameconstants", "BoazEngineJS/gamestateloader", "BoazEngineJS/gamesaver", "BoazEngineJS/controller"], function (exports_45, context_45) {
    "use strict";
    var btimer_7, item_3, resourceids_14, direction_9, bootstrapper_1, sintervaniamodel_15, model_5, input_6, weaponfirehandler_1, room_2, gamemenu_1, common_15, soundmaster_7, resourcemaster_7, constants_10, gameview_3, gameconstants_6, gamestateloader_4, gamesaver_2, controller_1, GameController;
    var __moduleName = context_45 && context_45.id;
    return {
        setters: [
            function (btimer_7_1) {
                btimer_7 = btimer_7_1;
            },
            function (item_3_1) {
                item_3 = item_3_1;
            },
            function (resourceids_14_1) {
                resourceids_14 = resourceids_14_1;
            },
            function (direction_9_1) {
                direction_9 = direction_9_1;
            },
            function (bootstrapper_1_1) {
                bootstrapper_1 = bootstrapper_1_1;
            },
            function (sintervaniamodel_15_1) {
                sintervaniamodel_15 = sintervaniamodel_15_1;
            },
            function (model_5_1) {
                model_5 = model_5_1;
            },
            function (input_6_1) {
                input_6 = input_6_1;
            },
            function (weaponfirehandler_1_1) {
                weaponfirehandler_1 = weaponfirehandler_1_1;
            },
            function (room_2_1) {
                room_2 = room_2_1;
            },
            function (gamemenu_1_1) {
                gamemenu_1 = gamemenu_1_1;
            },
            function (common_15_1) {
                common_15 = common_15_1;
            },
            function (soundmaster_7_1) {
                soundmaster_7 = soundmaster_7_1;
            },
            function (resourcemaster_7_1) {
                resourcemaster_7 = resourcemaster_7_1;
            },
            function (constants_10_1) {
                constants_10 = constants_10_1;
            },
            function (gameview_3_1) {
                gameview_3 = gameview_3_1;
            },
            function (gameconstants_6_1) {
                gameconstants_6 = gameconstants_6_1;
            },
            function (gamestateloader_4_1) {
                gamestateloader_4 = gamestateloader_4_1;
            },
            function (gamesaver_2_1) {
                gamesaver_2 = gamesaver_2_1;
            },
            function (controller_1_1) {
                controller_1 = controller_1_1;
            }
        ],
        execute: function () {
            GameController = class GameController extends controller_1.Controller {
                static get _() {
                    return GameController._instance != null ? GameController._instance : (GameController._instance = new GameController());
                }
                Initialize() {
                    sintervaniamodel_15.GameModel._.OldState = model_5.GameState.None;
                    this.timer = btimer_7.BStopwatch.createWatch();
                    this.startAfterLoadTimer = btimer_7.BStopwatch.createWatch();
                }
                SwitchToState(newState) {
                    sintervaniamodel_15.GameModel._.OldState = sintervaniamodel_15.GameModel._.State;
                    if (this.DisposeOldState(sintervaniamodel_15.GameModel._.State, newState)) {
                        this.InitNewState(newState);
                    }
                    sintervaniamodel_15.GameModel._.State = newState;
                }
                DisposeOldState(oldState, newState) {
                    switch (oldState) {
                        case model_5.GameState.TitleScreen:
                            soundmaster_7.SoundMaster.StopMusic();
                            if (newState == model_5.GameState.Game)
                                this.setupGameStart(newState);
                            break;
                        case model_5.GameState.GameStart2:
                            this.setupGameStart(newState);
                            break;
                        case model_5.GameState.Game:
                            break;
                        default:
                            break;
                    }
                    return true;
                }
                SwitchToOldState() {
                    this.SwitchToState(sintervaniamodel_15.GameModel._.OldState);
                }
                SwitchToOldSubstate() {
                    this.switchToSubstate(sintervaniamodel_15.GameModel._.OldSubstate);
                }
                InitNewState(newState) {
                    switch (newState) {
                        case model_5.GameState.Prelude:
                            gameview_3.GameView._.Title.Init();
                            break;
                        case model_5.GameState.TitleScreen:
                            gameview_3.GameView._.MainMenu.Init();
                            break;
                        case model_5.GameState.EndDemo:
                            gameview_3.GameView._.EndDemo.Init();
                            break;
                        case model_5.GameState.GameStart1:
                            this.timer.restart();
                            break;
                        case model_5.GameState.GameStart2:
                            this.timer.restart();
                            soundmaster_7.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Stage]);
                            break;
                        case model_5.GameState.Game:
                            break;
                        default:
                            break;
                    }
                }
                switchToSubstate(newSubstate) {
                    sintervaniamodel_15.GameModel._.OldSubstate = sintervaniamodel_15.GameModel._.Substate;
                    switch (newSubstate) {
                        case sintervaniamodel_15.GameModel.GameSubstate.Conversation:
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                            soundmaster_7.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Ohnoes]);
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                        case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                            gameview_3.GameView._.ItsCurtains.Init();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                            soundmaster_7.SoundMaster.PlayMusic(resourcemaster_7.ResourceMaster.Music[resourceids_14.AudioId.Humiliation]);
                            gameview_3.GameView._.GameOverScreen.Init();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.IngameMenu:
                            btimer_7.BStopwatch.pauseAllRunningWatches(true);
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                            btimer_7.BStopwatch.pauseAllRunningWatches(true);
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                            this.timer.restart();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.Default:
                            if (sintervaniamodel_15.GameModel._.OldSubstate == sintervaniamodel_15.GameModel.GameSubstate.IngameMenu || sintervaniamodel_15.GameModel._.OldSubstate == sintervaniamodel_15.GameModel.GameSubstate.GameMenu)
                                btimer_7.BStopwatch.resumeAllPausedWatches();
                            break;
                    }
                    sintervaniamodel_15.GameModel._.Substate = newSubstate;
                }
                takeTurn(elapsedMs) {
                    console.info(`takeTurn wordt nu uitgevoerd. ElapsedMs: ${elapsedMs}`);
                    if (sintervaniamodel_15.GameModel._.paused) {
                        this.handlePausedState();
                        return;
                    }
                    if (sintervaniamodel_15.GameModel._.startAfterLoad) {
                        this.handleStartAfterLoadState();
                        return;
                    }
                    this.ElapsedMsDelta = elapsedMs;
                    switch (sintervaniamodel_15.GameModel._.State) {
                        case model_5.GameState.Prelude:
                            gameview_3.GameView._.Title.TakeTurn();
                            break;
                        case model_5.GameState.TitleScreen:
                            gameview_3.GameView._.MainMenu.HandleInput();
                            gameview_3.GameView._.MainMenu.TakeTurn();
                            if (sintervaniamodel_15.GameModel._.GameMenu.visible) {
                                sintervaniamodel_15.GameModel._.GameMenu.HandleInput();
                                sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                            }
                            break;
                        case model_5.GameState.EndDemo:
                            gameview_3.GameView._.EndDemo.TakeTurn();
                            break;
                        case model_5.GameState.GameStart1:
                            if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterGameStart1)) {
                                this.SwitchToState(model_5.GameState.GameStart2);
                            }
                            break;
                        case model_5.GameState.GameStart2:
                            if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterGameStart2)) {
                                this.SwitchToState(model_5.GameState.Game);
                            }
                            break;
                        case model_5.GameState.Game:
                            switch (sintervaniamodel_15.GameModel._.Substate) {
                                case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                                    this.handleInputDuringGame();
                                    sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                                    this.handleInputDuringGame();
                                    sintervaniamodel_15.GameModel._.Belmont.TakeTurn();
                                    gameview_3.GameView._.Hud.TakeTurn();
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                                case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                                    this.handleInputDuringGame();
                                    sintervaniamodel_15.GameModel._.Belmont.TakeTurn();
                                    gameview_3.GameView._.Hud.TakeTurn();
                                    gameview_3.GameView._.ItsCurtains.TakeTurn();
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                                    this.handleInputDuringGame();
                                    gameview_3.GameView._.GameOverScreen.TakeTurn();
                                    sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                                    if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterRoomSwitch)) {
                                        this.SwitchToOldSubstate();
                                        if (gameconstants_6.GameConstants.CheckpointAtRoomEntry)
                                            this.StoreCheckpoint();
                                    }
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.Default:
                                    this.handleInputDuringGame();
                                    sintervaniamodel_15.GameModel._.objects.forEach(o => o.takeTurn());
                                    sintervaniamodel_15.GameModel._.objects.filter(o => o.disposeFlag).forEach(o => sintervaniamodel_15.GameModel._.remove(o));
                                    sintervaniamodel_15.GameModel._.CurrentRoom.TakeTurn();
                                    gameview_3.GameView._.Hud.TakeTurn();
                                    break;
                            }
                            break;
                        case model_5.GameState.Event:
                            if (sintervaniamodel_15.GameModel._.Belmont.Dying)
                                this.SwitchToOldState();
                            switch (sintervaniamodel_15.GameModel._.Substate) {
                                case sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom:
                                    if (common_15.waitDuration(this.timer, gameconstants_6.GameConstants.WaitAfterRoomSwitch)) {
                                        this.SwitchToOldSubstate();
                                    }
                                    break;
                                case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                                    this.handleInputDuringGame();
                                    sintervaniamodel_15.GameModel._.GameMenu.TakeTurn();
                                    break;
                                default:
                                    sintervaniamodel_15.GameModel._.objects.forEach(o => o.takeTurn());
                                    sintervaniamodel_15.GameModel._.objects.filter(o => o.disposeFlag).forEach(o => sintervaniamodel_15.GameModel._.remove(o));
                                    sintervaniamodel_15.GameModel._.CurrentRoom.TakeTurn();
                                    gameview_3.GameView._.Hud.TakeTurn();
                                    if (input_6.KeyState.KC_F5 && !sintervaniamodel_15.GameModel._.GameMenu.visible)
                                        this.OpenGameMenu();
                                    break;
                            }
                            break;
                        default:
                            break;
                    }
                }
                handleInputDuringGame() {
                    if (input_6.KeyState.KC_F1)
                        this.PauseGame();
                    switch (sintervaniamodel_15.GameModel._.Substate) {
                        case sintervaniamodel_15.GameModel.GameSubstate.BelmontDies:
                        case sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou:
                        case sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo:
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameOver:
                            gameview_3.GameView._.GameOverScreen.HandleInput();
                            if (sintervaniamodel_15.GameModel._.GameMenu.visible)
                                this.handleInputDuringGameMenu();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.GameMenu:
                            this.handleInputDuringGameMenu();
                            break;
                        case sintervaniamodel_15.GameModel.GameSubstate.Default:
                        default:
                            if (input_6.KeyState.KC_SPACE) {
                                weaponfirehandler_1.WeaponFireHandler.HandleFireMainWeapon();
                            }
                            if (input_6.KeyState.KC_M) {
                                weaponfirehandler_1.WeaponFireHandler.HandleFireSecondaryWeapon();
                            }
                            else if (input_6.KeyState.KC_F5 && !sintervaniamodel_15.GameModel._.GameMenu.visible)
                                this.OpenGameMenu();
                            break;
                    }
                }
                handleInputDuringPause() {
                    if (input_6.KeyState.KC_F1)
                        this.UnpauseGame();
                }
                handleInputDuringGameMenu() {
                    sintervaniamodel_15.GameModel._.GameMenu.HandleInput();
                    if (input_6.KeyState.KC_F5) {
                        this.CloseGameMenu();
                    }
                }
                KillFocus() {
                    if (!sintervaniamodel_15.GameModel._.paused && sintervaniamodel_15.GameModel._.State == model_5.GameState.Game && sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.Default && gameconstants_6.GameConstants.PauseGameOnKillFocus)
                        this.PauseGame();
                }
                SetFocus() {
                }
                handlePausedState() {
                    this.handleInputDuringPause();
                }
                handleStartAfterLoadState() {
                    if (common_15.waitDuration(this.startAfterLoadTimer, gameconstants_6.GameConstants.WaitAfterLoadGame)) {
                        sintervaniamodel_15.GameModel._.startAfterLoad = false;
                        btimer_7.BStopwatch.removeWatch(this.startAfterLoadTimer);
                        if (soundmaster_7.SoundMaster.MusicBeingPlayed != null)
                            soundmaster_7.SoundMaster.PlayMusic(soundmaster_7.SoundMaster.MusicBeingPlayed);
                    }
                }
                BelmontDied() {
                    this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.BelmontDies);
                }
                BelmontDeathAniFinished() {
                    this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou);
                }
                ItsCurtainsAniFinished() {
                    if (sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.ItsCurtainsForYou)
                        this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.GameOver);
                    else
                        this.SwitchToState(model_5.GameState.EndDemo);
                }
                PreludeFinished() {
                    this.SwitchToState(model_5.GameState.TitleScreen);
                }
                BossDefeated() {
                    this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.ToEndDemo);
                }
                HandleRoomExitViaMovement(targetRoom, dir) {
                    let Belmont = sintervaniamodel_15.GameModel._.Belmont;
                    switch (dir) {
                        case direction_9.Direction.Up:
                            common_15.setPoint(Belmont.pos, Belmont.pos.x, room_2.Room.RoomHeight - (Belmont.size.y + 1));
                            break;
                        case direction_9.Direction.Right:
                            common_15.setPoint(Belmont.pos, 0, Belmont.pos.y);
                            break;
                        case direction_9.Direction.Down:
                            common_15.setPoint(Belmont.pos, Belmont.pos.x, 0);
                            break;
                        case direction_9.Direction.Left:
                            common_15.setPoint(Belmont.pos, room_2.Room.RoomWidth - (Belmont.size.x + 1), Belmont.pos.y);
                            break;
                    }
                    this.DoRoomExit(targetRoom);
                }
                DoRoomExit(targetRoom) {
                    sintervaniamodel_15.GameModel._.LastFoeThatWasHit = null;
                    sintervaniamodel_15.GameModel._.LoadRoom(targetRoom);
                    this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.SwitchRoom);
                }
                setupGameStart(newState) {
                    sintervaniamodel_15.GameModel._.InitModelForGameStart();
                    bootstrapper_1.Bootstrapper.BootstrapGame(sintervaniamodel_15.GameModel._.SelectedChapterToPlay);
                    gameview_3.GameView._.Hud.SetShownLevelsToProperValues();
                    sintervaniamodel_15.GameModel._.State = newState;
                    this.StoreCheckpoint();
                }
                PauseGame() {
                    sintervaniamodel_15.GameModel._.paused = true;
                    btimer_7.BStopwatch.pauseAllRunningWatches();
                    soundmaster_7.SoundMaster.StopEffect();
                    soundmaster_7.SoundMaster.StopMusic();
                }
                UnpauseGame() {
                    sintervaniamodel_15.GameModel._.paused = false;
                    btimer_7.BStopwatch.resumeAllPausedWatches();
                    soundmaster_7.SoundMaster.ResumeEffect();
                    soundmaster_7.SoundMaster.ResumeMusic();
                }
                OpenGameMenu() {
                    sintervaniamodel_15.GameModel._.GameMenu.Open();
                    this.switchToSubstate(sintervaniamodel_15.GameModel.GameSubstate.GameMenu);
                }
                CloseGameMenu() {
                    sintervaniamodel_15.GameModel._.GameMenu.Close();
                    this.SwitchToOldSubstate();
                }
                LoadGame(sg) {
                    soundmaster_7.SoundMaster.StopEffect();
                    soundmaster_7.SoundMaster.StopMusic();
                    let oldcheckpoint = sintervaniamodel_15.GameModel._.Checkpoint;
                    sintervaniamodel_15.GameModel._ = sg.Model;
                    sintervaniamodel_15.GameModel._.Checkpoint = gamestateloader_4.LoadGame(constants_10.Constants.SaveSlotCheckpoint);
                    btimer_7.BStopwatch.Watches = sg.RegisteredWatches;
                    sintervaniamodel_15.GameModel._.InitAfterGameLoad();
                    sintervaniamodel_15.GameModel._.GameMenu = new gamemenu_1.GameMenu();
                    gameview_3.GameView._.init();
                    sintervaniamodel_15.GameModel._.startAfterLoad = true;
                    this.startAfterLoadTimer.pauseDuringMenu = false;
                    this.startAfterLoadTimer.restart();
                    btimer_7.BStopwatch.addWatch(this.startAfterLoadTimer);
                    btimer_7.BStopwatch.addWatch(this.timer);
                    soundmaster_7.SoundMaster.MusicBeingPlayed = sg.MusicBeingPlayed;
                    resourcemaster_7.ResourceMaster.reloadImg(resourceids_14.BitmapId.Room, sintervaniamodel_15.GameModel._.CurrentRoom.BitmapPath);
                }
                SaveGame(slot) {
                    if (sintervaniamodel_15.GameModel._.Substate == sintervaniamodel_15.GameModel.GameSubstate.GameMenu)
                        this.CloseGameMenu();
                    btimer_7.BStopwatch.removeWatch(this.timer);
                    gamesaver_2.GameSaver.saveGame(sintervaniamodel_15.GameModel._, slot);
                    btimer_7.BStopwatch.addWatch(this.timer);
                }
                StoreCheckpoint() {
                    btimer_7.BStopwatch.removeWatch(this.timer);
                    sintervaniamodel_15.GameModel._.Checkpoint = gamesaver_2.GameSaver.GetCheckpoint(sintervaniamodel_15.GameModel._);
                    btimer_7.BStopwatch.addWatch(this.timer);
                }
                LoadCheckpoint() {
                    if (sintervaniamodel_15.GameModel._.Checkpoint == null)
                        sintervaniamodel_15.GameModel._.Checkpoint = gamestateloader_4.LoadGame(constants_10.Constants.SaveSlotCheckpoint);
                    this.LoadGame(sintervaniamodel_15.GameModel._.Checkpoint);
                }
                PickupItem(source) {
                    if (source.id != null)
                        sintervaniamodel_15.GameModel._.ItemsPickedUp[source.id] = true;
                    sintervaniamodel_15.GameModel._.AddItemToInventory(source.ItsType);
                }
                UseItem(itemType) {
                    let bagitem = sintervaniamodel_15.GameModel._.ItemsInInventory.find(i => i.Type == itemType);
                    if (bagitem.Amount > 0) {
                        if (item_3.Item.ItemUsable(itemType) != item_3.Item.Usable.Infinite)
                            --bagitem.Amount;
                        this.HandleUseItem(itemType);
                    }
                }
                HandleUseItem(itemType) {
                    switch (itemType) {
                        case item_3.Item.Type.None:
                            sintervaniamodel_15.GameModel._.Belmont.Health = sintervaniamodel_15.GameModel._.Belmont.MaxHealth;
                            break;
                    }
                }
                PickupWeaponItem(source) {
                    sintervaniamodel_15.GameModel._.AddWeaponToInventory(source.ItsType);
                    if (source.id != null)
                        sintervaniamodel_15.GameModel._.ItemsPickedUp[source.id] = true;
                }
            };
            exports_45("GameController", GameController);
        }
    };
});
System.register("src/item", ["BoazEngineJS/sprite", "BoazEngineJS/common", "src/sintervaniamodel", "BoazEngineJS/soundmaster", "src/resourcemaster", "src/gamecontroller", "BoazEngineJS/resourceids"], function (exports_46, context_46) {
    "use strict";
    var sprite_4, common_16, sintervaniamodel_16, soundmaster_8, resourcemaster_8, gamecontroller_8, resourceids_15, ItemType, Usable, Item;
    var __moduleName = context_46 && context_46.id;
    return {
        setters: [
            function (sprite_4_1) {
                sprite_4 = sprite_4_1;
            },
            function (common_16_1) {
                common_16 = common_16_1;
            },
            function (sintervaniamodel_16_1) {
                sintervaniamodel_16 = sintervaniamodel_16_1;
            },
            function (soundmaster_8_1) {
                soundmaster_8 = soundmaster_8_1;
            },
            function (resourcemaster_8_1) {
                resourcemaster_8 = resourcemaster_8_1;
            },
            function (gamecontroller_8_1) {
                gamecontroller_8 = gamecontroller_8_1;
            },
            function (resourceids_15_1) {
                resourceids_15 = resourceids_15_1;
            }
        ],
        execute: function () {
            (function (ItemType) {
                ItemType[ItemType["None"] = 0] = "None";
                ItemType[ItemType["HeartSmall"] = 1] = "HeartSmall";
                ItemType[ItemType["HeartBig"] = 2] = "HeartBig";
                ItemType[ItemType["KeySmall"] = 3] = "KeySmall";
                ItemType[ItemType["KeyBig"] = 4] = "KeyBig";
            })(ItemType || (ItemType = {}));
            exports_46("ItemType", ItemType);
            (function (Usable) {
                Usable[Usable["No"] = 0] = "No";
                Usable[Usable["Yes"] = 1] = "Yes";
                Usable[Usable["Infinite"] = 2] = "Infinite";
            })(Usable || (Usable = {}));
            exports_46("Usable", Usable);
            Item = class Item extends sprite_4.Sprite {
                constructor(type, pos) {
                    super(pos);
                    this.ItsType = type;
                    this.hitarea = Item.ItemHitArea;
                    this.size = common_16.area2size(Item.ItemHitArea);
                    this.imgid = Item.Type2Image(type);
                }
                TakeTurn() {
                    if (this.areaCollide(common_16.moveArea(sintervaniamodel_16.GameModel._.Belmont.EventTouchHitArea, sintervaniamodel_16.GameModel._.Belmont.pos))) {
                        gamecontroller_8.GameController._.PickupItem(this);
                        switch (this.ItsType) {
                            case ItemType.HeartSmall:
                            case ItemType.HeartBig:
                                soundmaster_8.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.Heart]);
                                break;
                            case ItemType.KeySmall:
                            case ItemType.KeyBig:
                                soundmaster_8.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.KeyGrab]);
                                break;
                            default:
                                soundmaster_8.SoundMaster.PlayEffect(resourcemaster_8.ResourceMaster.Sound[resourceids_15.AudioId.ItemPickup]);
                                break;
                        }
                        this.disposeFlag = true;
                    }
                }
                static Type2Image(type) {
                    switch (type) {
                        case ItemType.KeyBig:
                            return resourceids_15.BitmapId.Key_big;
                        default:
                            return resourceids_15.BitmapId.None;
                    }
                }
                static ItemUsable(type) {
                    switch (type) {
                        default:
                            return Usable.No;
                    }
                }
                Dispose() {
                }
            };
            Item.ItemHitArea = common_16.newArea(0, 0, 16, 16);
            exports_46("Item", Item);
        }
    };
});
System.register("src/fx", ["BoazEngineJS/sprite", "BoazEngineJS/btimer"], function (exports_47, context_47) {
    "use strict";
    var sprite_5, btimer_8, FX;
    var __moduleName = context_47 && context_47.id;
    return {
        setters: [
            function (sprite_5_1) {
                sprite_5 = sprite_5_1;
            },
            function (btimer_8_1) {
                btimer_8 = btimer_8_1;
            }
        ],
        execute: function () {
            FX = class FX extends sprite_5.Sprite {
                constructor(pos) {
                    super(pos);
                    this.timer = btimer_8.BStopwatch.createWatch();
                }
                init() {
                    this.imgid = this.animation.stepValue();
                    this.timer.restart();
                }
                TakeTurn() {
                    this.doAnimation();
                }
                doAnimation() {
                    let aniresult = this.animation.doAnimationTimer(this.timer);
                    if (aniresult.next) {
                        if (this.animation.finished())
                            this.disposeFlag = true;
                        this.imgid = aniresult.value;
                    }
                }
                Dispose() {
                    btimer_8.BStopwatch.removeWatch(this.timer);
                }
            };
            exports_47("FX", FX);
        }
    };
});
System.register("src/heartsmall", ["BoazEngineJS/sprite", "BoazEngineJS/animation", "BoazEngineJS/resourceids", "src/gameconstants", "src/resourcemaster", "BoazEngineJS/common", "src/sintervaniamodel", "BoazEngineJS/soundmaster"], function (exports_48, context_48) {
    "use strict";
    var sprite_6, animation_4, resourceids_16, gameconstants_7, resourcemaster_9, common_17, sintervaniamodel_17, soundmaster_9, HeartSmallState, HeartSmall;
    var __moduleName = context_48 && context_48.id;
    return {
        setters: [
            function (sprite_6_1) {
                sprite_6 = sprite_6_1;
            },
            function (animation_4_1) {
                animation_4 = animation_4_1;
            },
            function (resourceids_16_1) {
                resourceids_16 = resourceids_16_1;
            },
            function (gameconstants_7_1) {
                gameconstants_7 = gameconstants_7_1;
            },
            function (resourcemaster_9_1) {
                resourcemaster_9 = resourcemaster_9_1;
            },
            function (common_17_1) {
                common_17 = common_17_1;
            },
            function (sintervaniamodel_17_1) {
                sintervaniamodel_17 = sintervaniamodel_17_1;
            },
            function (soundmaster_9_1) {
                soundmaster_9 = soundmaster_9_1;
            }
        ],
        execute: function () {
            (function (HeartSmallState) {
                HeartSmallState[HeartSmallState["Flying"] = 0] = "Flying";
                HeartSmallState[HeartSmallState["Standing"] = 1] = "Standing";
            })(HeartSmallState || (HeartSmallState = {}));
            exports_48("HeartSmallState", HeartSmallState);
            HeartSmall = class HeartSmall extends sprite_6.Sprite {
                constructor(pos) {
                    super(pos, resourceids_16.BitmapId.Heart_fly);
                    this.animationData = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
                    this.State = HeartSmallState.Flying;
                    this.animation = new animation_4.Animation(this.animationData, 1, true);
                    this.uglyBitThing = false;
                }
                get hitarea() {
                    return this.State == HeartSmallState.Flying ? HeartSmall.HitAreaFly : HeartSmall.HitAreaStand;
                }
                set hitarea(value) {
                }
                get floorCollision() {
                    return sintervaniamodel_17.GameModel._.CurrentRoom.IsCollisionTile(this.pos.x + 5, this.pos.y + 8, false);
                }
                Dispose() {
                }
                TakeTurn() {
                    if (this.State == HeartSmallState.Flying) {
                        let delta = 0;
                        delta = this.animation.doAnimation(1).value;
                        this.pos.x += delta;
                        if (this.uglyBitThing)
                            ++this.pos.y;
                        this.uglyBitThing = !this.uglyBitThing;
                        if (this.pos.y > gameconstants_7.GameConstants.GameScreenHeight) {
                            this.disposeFlag = true;
                            return;
                        }
                        if (this.floorCollision) {
                            this.State = HeartSmallState.Standing;
                            this.pos.y -= 3;
                            this.imgid = resourceids_16.BitmapId.Heart_small;
                        }
                    }
                    if (this.objectCollide(sintervaniamodel_17.GameModel._.Belmont)) {
                        ++sintervaniamodel_17.GameModel._.Hearts;
                        this.disposeFlag = true;
                        soundmaster_9.SoundMaster.PlayEffect(resourcemaster_9.ResourceMaster.Sound[resourceids_16.AudioId.Heart]);
                    }
                }
                Paint(offset = null) {
                    super.paint(offset);
                }
            };
            HeartSmall.HitAreaFly = common_17.newArea(0, 0, 9, 8);
            HeartSmall.HitAreaStand = common_17.newArea(0, 0, 12, 11);
            exports_48("HeartSmall", HeartSmall);
        }
    };
});
System.register("src/foeexplosion", ["src/item", "BoazEngineJS/animation", "src/fx", "src/heartsmall", "BoazEngineJS/resourceids", "src/sintervaniamodel", "BoazEngineJS/common"], function (exports_49, context_49) {
    "use strict";
    var item_4, animation_5, fx_1, heartsmall_1, resourceids_17, sintervaniamodel_18, common_18, FoeExplosion;
    var __moduleName = context_49 && context_49.id;
    return {
        setters: [
            function (item_4_1) {
                item_4 = item_4_1;
            },
            function (animation_5_1) {
                animation_5 = animation_5_1;
            },
            function (fx_1_1) {
                fx_1 = fx_1_1;
            },
            function (heartsmall_1_1) {
                heartsmall_1 = heartsmall_1_1;
            },
            function (resourceids_17_1) {
                resourceids_17 = resourceids_17_1;
            },
            function (sintervaniamodel_18_1) {
                sintervaniamodel_18 = sintervaniamodel_18_1;
            },
            function (common_18_1) {
                common_18 = common_18_1;
            }
        ],
        execute: function () {
            FoeExplosion = class FoeExplosion extends fx_1.FX {
                constructor(pos, itemSpawned = item_4.ItemType.None) {
                    super(pos);
                    this.animation = new animation_5.Animation(FoeExplosion.AnimationFrames, null, false);
                    this.init();
                    this.itemSpawnedAfterKill = itemSpawned;
                }
                TakeTurn() {
                    let nextStep = this.animation.doAnimation(this.timer);
                    if (nextStep.next) {
                        this.imgid = nextStep.value;
                        if (this.animation.finished()) {
                            this.disposeFlag = true;
                            if (this.itemSpawnedAfterKill == item_4.ItemType.HeartSmall) {
                                sintervaniamodel_18.GameModel._.spawn(new heartsmall_1.HeartSmall(common_18.addPoints({ x: this.pos.x, y: this.pos.y }, { x: 4, y: 8 })));
                            }
                        }
                    }
                }
            };
            FoeExplosion.AnimationFrames = new Array({ time: 100, data: resourceids_17.BitmapId.FoeKill_1 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_2 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_1 }, { time: 100, data: resourceids_17.BitmapId.FoeKill_2 });
            exports_49("FoeExplosion", FoeExplosion);
        }
    };
});
System.register("src/foe", ["src/creature", "src/item", "src/sintervaniamodel", "BoazEngineJS/soundmaster", "src/foeexplosion", "BoazEngineJS/resourceids", "src/resourcemaster"], function (exports_50, context_50) {
    "use strict";
    var creature_2, item_5, sintervaniamodel_19, soundmaster_10, foeexplosion_1, resourceids_18, resourcemaster_10, Foe;
    var __moduleName = context_50 && context_50.id;
    return {
        setters: [
            function (creature_2_1) {
                creature_2 = creature_2_1;
            },
            function (item_5_1) {
                item_5 = item_5_1;
            },
            function (sintervaniamodel_19_1) {
                sintervaniamodel_19 = sintervaniamodel_19_1;
            },
            function (soundmaster_10_1) {
                soundmaster_10 = soundmaster_10_1;
            },
            function (foeexplosion_1_1) {
                foeexplosion_1 = foeexplosion_1_1;
            },
            function (resourceids_18_1) {
                resourceids_18 = resourceids_18_1;
            },
            function (resourcemaster_10_1) {
                resourcemaster_10 = resourcemaster_10_1;
            }
        ],
        execute: function () {
            Foe = class Foe extends creature_2.Creature {
                Paint(offset) {
                    throw new Error("Method not implemented.");
                }
                get HealthPercentage() {
                    return Math.min((Math.round(this.Health / this.MaxHealth * 100)), 100);
                }
                constructor(pos) {
                    super(pos);
                }
                get RespawnAtRoomEntry() {
                    return false;
                }
                get IsAfoot() {
                    return this.CanHurtPlayer;
                }
                TakeTurn() {
                    if (this.CanHurtPlayer && this.objectCollide(sintervaniamodel_19.GameModel._.Belmont)) {
                        sintervaniamodel_19.GameModel._.Belmont.TakeDamage(this.DamageToPlayer);
                    }
                }
                HandleHit(source) {
                    sintervaniamodel_19.GameModel._.LastFoeThatWasHit = this;
                    soundmaster_10.SoundMaster.PlayEffect(resourcemaster_10.ResourceMaster.Sound[resourceids_18.AudioId.Hit]);
                }
                loseHealth(source) {
                    this.Health -= source.DamageDealt;
                    if (this.Health <= 0)
                        this.Die();
                }
                handleDie() {
                    this.disposeFlag = true;
                    sintervaniamodel_19.GameModel._.FoeDefeated(this);
                }
                Die() {
                    if (this.itemSpawnedAfterKill == item_5.ItemType.HeartSmall) {
                        this.dieWithItem(this.itemSpawnedAfterKill);
                    }
                    else
                        this.dieWithoutItem();
                }
                dieWithoutItem() {
                    this.handleDie();
                    sintervaniamodel_19.GameModel._.spawn(new foeexplosion_1.FoeExplosion(this.pos));
                }
                dieWithItem(itemToSpawn = item_5.ItemType.None) {
                    this.handleDie();
                    if (itemToSpawn != item_5.ItemType.None) {
                        sintervaniamodel_19.GameModel._.spawn(new foeexplosion_1.FoeExplosion(this.pos, itemToSpawn));
                    }
                }
            };
            exports_50("Foe", Foe);
        }
    };
});
System.register("src/bossfoe", ["src/foe", "src/sintervaniamodel"], function (exports_51, context_51) {
    "use strict";
    var foe_1, sintervaniamodel_20, BossFoe;
    var __moduleName = context_51 && context_51.id;
    return {
        setters: [
            function (foe_1_1) {
                foe_1 = foe_1_1;
            },
            function (sintervaniamodel_20_1) {
                sintervaniamodel_20 = sintervaniamodel_20_1;
            }
        ],
        execute: function () {
            BossFoe = class BossFoe extends foe_1.Foe {
                constructor(pos) {
                    super(pos);
                    this.extendedProperties.set(sintervaniamodel_20.GameModel.PROPERTY_KEEP_AT_ROOMSWITCH, true);
                }
                StartBossfight() {
                    throw new Error('not implemented');
                }
            };
            exports_51("BossFoe", BossFoe);
        }
    };
});
System.register("src/sintervaniamodel", ["src/belmont", "BoazEngineJS/model", "BoazEngineJS/btimer", "src/weaponitem", "src/gameconstants", "src/gamemenu", "src/RoomFactory"], function (exports_52, context_52) {
    "use strict";
    var belmont_2, model_6, btimer_9, weaponitem_1, gameconstants_8, gamemenu_2, RoomFactory_1, Chapter, BagItem, BagWeapon, Location, Switch, CombatType, MainWeaponType, SecWeaponType, GameModel;
    var __moduleName = context_52 && context_52.id;
    return {
        setters: [
            function (belmont_2_1) {
                belmont_2 = belmont_2_1;
            },
            function (model_6_1) {
                model_6 = model_6_1;
            },
            function (btimer_9_1) {
                btimer_9 = btimer_9_1;
            },
            function (weaponitem_1_1) {
                weaponitem_1 = weaponitem_1_1;
            },
            function (gameconstants_8_1) {
                gameconstants_8 = gameconstants_8_1;
            },
            function (gamemenu_2_1) {
                gamemenu_2 = gamemenu_2_1;
            },
            function (RoomFactory_1_1) {
                RoomFactory_1 = RoomFactory_1_1;
            }
        ],
        execute: function () {
            (function (Chapter) {
                Chapter[Chapter["Debug"] = 0] = "Debug";
                Chapter[Chapter["Prologue"] = 1] = "Prologue";
                Chapter[Chapter["Chapter_0"] = 2] = "Chapter_0";
                Chapter[Chapter["GameStart"] = 3] = "GameStart";
            })(Chapter || (Chapter = {}));
            exports_52("Chapter", Chapter);
            BagItem = class BagItem {
            };
            exports_52("BagItem", BagItem);
            BagWeapon = class BagWeapon {
            };
            exports_52("BagWeapon", BagWeapon);
            Location = class Location {
            };
            exports_52("Location", Location);
            (function (Switch) {
                Switch[Switch["None"] = 0] = "None";
                Switch[Switch["Dummy"] = 1] = "Dummy";
                Switch[Switch["GameStart"] = 2] = "GameStart";
                Switch[Switch["Room1Aanloop"] = 3] = "Room1Aanloop";
                Switch[Switch["Room1GebouwUitleg"] = 4] = "Room1GebouwUitleg";
                Switch[Switch["VijandenUitRaam"] = 5] = "VijandenUitRaam";
                Switch[Switch["SchuurSleutelGevonden"] = 6] = "SchuurSleutelGevonden";
                Switch[Switch["PraatOverTroep"] = 7] = "PraatOverTroep";
                Switch[Switch["NaarEindbaas"] = 8] = "NaarEindbaas";
                Switch[Switch["WaterEnBroodGevonden"] = 9] = "WaterEnBroodGevonden";
                Switch[Switch["WaterEnBroodGegeven"] = 10] = "WaterEnBroodGegeven";
                Switch[Switch["VillaSleutelGevonden"] = 11] = "VillaSleutelGevonden";
                Switch[Switch["Ch0_Chapter0Intro"] = 12] = "Ch0_Chapter0Intro";
                Switch[Switch["Ch0_LigpietOnderzocht"] = 13] = "Ch0_LigpietOnderzocht";
                Switch[Switch["Ch0_SpeelgoedOntdekt"] = 14] = "Ch0_SpeelgoedOntdekt";
                Switch[Switch["Ch0_KruidnootschieterGevonden"] = 15] = "Ch0_KruidnootschieterGevonden";
                Switch[Switch["Ch0_SleutelGevonden"] = 16] = "Ch0_SleutelGevonden";
                Switch[Switch["Ch0_SpeelgoedOntdekt2"] = 17] = "Ch0_SpeelgoedOntdekt2";
                Switch[Switch["Ch0_BossIntro"] = 18] = "Ch0_BossIntro";
                Switch[Switch["Ch0_LangVerhaal"] = 19] = "Ch0_LangVerhaal";
            })(Switch || (Switch = {}));
            exports_52("Switch", Switch);
            (function (CombatType) {
                CombatType[CombatType["Encounter"] = 0] = "Encounter";
                CombatType[CombatType["Boss"] = 1] = "Boss";
            })(CombatType || (CombatType = {}));
            exports_52("CombatType", CombatType);
            (function (MainWeaponType) {
                MainWeaponType[MainWeaponType["None"] = 0] = "None";
                MainWeaponType[MainWeaponType["TriRoe"] = 1] = "TriRoe";
            })(MainWeaponType || (MainWeaponType = {}));
            exports_52("MainWeaponType", MainWeaponType);
            (function (SecWeaponType) {
                SecWeaponType[SecWeaponType["None"] = 0] = "None";
                SecWeaponType[SecWeaponType["Cross"] = 1] = "Cross";
            })(SecWeaponType || (SecWeaponType = {}));
            exports_52("SecWeaponType", SecWeaponType);
            GameModel = class GameModel extends model_6.Model {
                constructor() {
                    super();
                    GameModel._instance = this;
                    this.Initialize();
                }
                static get _() {
                    return GameModel._instance;
                }
                static set _(value) {
                    GameModel._instance = value;
                }
                get Hearts() {
                    return this._hearts;
                }
                set Hearts(value) {
                    if (value > gameconstants_8.GameConstants.Belmont_MaxHearts)
                        this._hearts = gameconstants_8.GameConstants.Belmont_MaxHearts;
                    else if (value < 0)
                        this._hearts = 0;
                    else
                        this._hearts = value;
                }
                get SelectedMainWeapon() {
                    return MainWeaponType.TriRoe;
                }
                get SelectedSecondaryWeapon() {
                    return this._selectedSecondaryWeapon;
                }
                set SelectedSecondaryWeapon(value) {
                    this._selectedSecondaryWeapon = value;
                }
                get SelectedSecBagWeapon() {
                    let weaponItemInBagType = weaponitem_1.WeaponItem.SecWeaponType2WeaponItemType(this.SelectedSecondaryWeapon);
                    let index = this.WeaponsInInventory.findIndex(bw => bw.Type == weaponItemInBagType);
                    if (index == -1)
                        return null;
                    return GameModel._.WeaponsInInventory[index];
                }
                get LastFoeThatWasHit() {
                    if (this._lastFoeThatWasHit == null)
                        return null;
                    if (this._lastFoeThatWasHit.disposeFlag)
                        return null;
                    return this._lastFoeThatWasHit;
                }
                set LastFoeThatWasHit(value) {
                    this._lastFoeThatWasHit = value;
                }
                get SelectedItem() {
                    return this._selectedItem;
                }
                set SelectedItem(value) {
                    this._selectedItem = value;
                }
                Initialize() {
                    this.objects = new Array();
                    this.Foes = new Array();
                    this.ItemsInInventory = new Array();
                    this.WeaponsInInventory = new Array();
                    this.Switches = new Map();
                    this.GameMenu = new gamemenu_2.GameMenu();
                    this.id2object = new Map();
                    this.FoesDefeated = new Map();
                    this.ItemsPickedUp = new Map();
                    this.WeaponItemsPickedUp = new Map();
                    this.DoorsOpened = new Map();
                    this.MainWeaponCooldownTimer = btimer_9.BStopwatch.createWatch();
                    this.SecWeaponCooldownTimer = btimer_9.BStopwatch.createWatch();
                    RoomFactory_1.RoomFactory.PrepareData();
                }
                InitModelForGameStart() {
                    GameModel._.BossBattle = false;
                    GameModel._.RoomExitsLocked = false;
                    GameModel._.Switches.clear();
                    Object.keys(Switch).forEach(t => GameModel._.Switches[t] = false);
                    GameModel._.ItemsInInventory.length = 0;
                    GameModel._.WeaponsInInventory.length = 0;
                    GameModel._.FoesDefeated.clear();
                    GameModel._.ItemsPickedUp.clear();
                    GameModel._.WeaponItemsPickedUp.clear();
                    GameModel._.spawn(new belmont_2.Belmont());
                }
                InitAfterGameLoad() {
                }
                spawn(o) {
                    if (o instanceof belmont_2.Belmont) {
                        if (this.objects.findIndex(ob => ob instanceof belmont_2.Belmont) > -1)
                            throw ("There is already a Belmont in the game! \"There can be only one!\"");
                        else
                            GameModel._.Belmont = o;
                    }
                    let f = o;
                    if (f) {
                        if (!f.RespawnAtRoomEntry) {
                            let wasDefeated;
                            let exists = this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id] == true;
                            if (!exists) {
                                this.FoesDefeated.set(f.id, false);
                                wasDefeated = false;
                            }
                            if (!wasDefeated)
                                this.Foes.push(f);
                            else
                                return;
                        }
                        else
                            this.Foes.push(f);
                    }
                    super.spawn(o);
                }
                FoeDefeated(f) {
                    if (f.RespawnAtRoomEntry)
                        return;
                    if (this.FoesDefeated.has(f.id) && this.FoesDefeated[f.id].defeated)
                        this.FoesDefeated[f.id] = true;
                    else
                        this.FoesDefeated.set(f.id, true);
                }
                GetFoeDefeated(id) {
                    return this.FoesDefeated.has(id) ? this.FoesDefeated[id] : false;
                }
                get FoesPresentInCurrentRoom() {
                    return this.Foes.length > 0;
                }
                GetSwitchState(s) {
                    return this.Switches.has(s) ? this.Switches[s] : false;
                }
                GetItemPickedUp(id) {
                    return this.ItemsPickedUp.has(id);
                }
                DoorOpened(id) {
                    return this.DoorsOpened.has(id) ? true : false;
                }
                AddItemToInventory(itemType) {
                    let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
                    if (!itemInInventory) {
                        let newBagItem = new BagItem();
                        newBagItem.Amount = 1;
                        newBagItem.Type = itemType;
                        this.ItemsInInventory.push(newBagItem);
                    }
                }
                AddWeaponToInventory(itemType) {
                    let itemInInventory = this.WeaponsInInventory.find(i => i.Type == itemType);
                    if (!itemInInventory == null) {
                        let newWeapon = new BagWeapon();
                        newWeapon.Type = itemType;
                        this.WeaponsInInventory.push(newWeapon);
                    }
                }
                RemoveItemFromInventory(itemType, removeAll = false) {
                    let itemInInventory = this.ItemsInInventory.find(i => i.Type == itemType);
                    if (!itemInInventory)
                        throw `Item is not in inventory while trying to remove an item: ${itemType}`;
                    if (itemInInventory.Amount > 1 && !removeAll)
                        itemInInventory.Amount--;
                    else {
                        if (this.SelectedItem.Type == itemType)
                            this.SelectedItem = null;
                        let index = this.ItemsInInventory.indexOf(itemInInventory);
                        if (index > -1) {
                            delete this.ItemsInInventory[index];
                            this.ItemsInInventory.splice(index, 1);
                        }
                    }
                }
                LoadRoom(id) {
                    let objectsToRemove = this.objects.filter(o => {
                        return !o.extendedProperties[GameModel.PROPERTY_KEEP_AT_ROOMSWITCH];
                    });
                    objectsToRemove.forEach(o => this.remove(o));
                    this.CurrentRoom = RoomFactory_1.RoomFactory.LoadRoom(id);
                    this.CurrentRoom.InitRoom();
                }
            };
            GameModel.PROPERTY_KEEP_AT_ROOMSWITCH = "p_rs";
            GameModel.PROPERTY_ACT_AS_WALL = "p_wall";
            exports_52("GameModel", GameModel);
        }
    };
});
System.register("src/candle", ["src/foe", "BoazEngineJS/btimer", "src/item", "BoazEngineJS/animation", "BoazEngineJS/direction", "BoazEngineJS/resourceids", "BoazEngineJS/common"], function (exports_53, context_53) {
    "use strict";
    var foe_2, btimer_10, item_6, animation_6, direction_10, resourceids_19, common_19, Candle;
    var __moduleName = context_53 && context_53.id;
    return {
        setters: [
            function (foe_2_1) {
                foe_2 = foe_2_1;
            },
            function (btimer_10_1) {
                btimer_10 = btimer_10_1;
            },
            function (item_6_1) {
                item_6 = item_6_1;
            },
            function (animation_6_1) {
                animation_6 = animation_6_1;
            },
            function (direction_10_1) {
                direction_10 = direction_10_1;
            },
            function (resourceids_19_1) {
                resourceids_19 = resourceids_19_1;
            },
            function (common_19_1) {
                common_19 = common_19_1;
            }
        ],
        execute: function () {
            Candle = class Candle extends foe_2.Foe {
                constructor(pos, itemSpawned = item_6.ItemType.HeartSmall) {
                    super(pos);
                    this.CanHurtPlayer = false;
                    this.animation = new animation_6.Animation(Candle.AnimationFrames, Candle.ElapsedMsPerFrame);
                    this.animation.repeat = true;
                    this.timer = btimer_10.BStopwatch.createWatch();
                    this.imgid = this.animation.stepValue();
                    this.timer.restart();
                    this.hitarea = Candle.CandleHitArea;
                    this.itemSpawnedAfterKill = itemSpawned;
                }
                get DamageToPlayer() {
                    return 0;
                }
                get moveBeforeFrameChange() {
                    return 0;
                }
                get RespawnAtRoomEntry() {
                    return true;
                }
                get movementSprites() {
                    return Candle.candleSprites;
                }
                TakeTurn() {
                    let imageId = { nextStepValue: this.imgid };
                    this.animation.doAnimation(this.timer, imageId);
                    this.imgid = imageId.nextStepValue;
                }
                Dispose() {
                    btimer_10.BStopwatch.removeWatch(this.timer);
                }
                HandleHit(source) {
                    super.HandleHit(source);
                    this.loseHealth(source);
                }
                Paint(offset = null) {
                    super.Paint(offset);
                }
            };
            Candle.CandleHitArea = common_19.newArea(0, 0, 10, 16);
            Candle.candleSprites = new Map([[direction_10.Direction.None, [resourceids_19.BitmapId.Candle_1]]]);
            Candle.AnimationFrames = [resourceids_19.BitmapId.Candle_1, resourceids_19.BitmapId.Candle_2];
            Candle.ElapsedMsPerFrame = [200, 200];
            exports_53("Candle", Candle);
        }
    };
});
System.register("src/gardencandle", ["BoazEngineJS/animation", "src/candle", "BoazEngineJS/direction", "BoazEngineJS/resourceids", "src/item", "BoazEngineJS/common"], function (exports_54, context_54) {
    "use strict";
    var animation_7, candle_1, direction_11, resourceids_20, item_7, common_20, GardenCandle;
    var __moduleName = context_54 && context_54.id;
    return {
        setters: [
            function (animation_7_1) {
                animation_7 = animation_7_1;
            },
            function (candle_1_1) {
                candle_1 = candle_1_1;
            },
            function (direction_11_1) {
                direction_11 = direction_11_1;
            },
            function (resourceids_20_1) {
                resourceids_20 = resourceids_20_1;
            },
            function (item_7_1) {
                item_7 = item_7_1;
            },
            function (common_20_1) {
                common_20 = common_20_1;
            }
        ],
        execute: function () {
            GardenCandle = class GardenCandle extends candle_1.Candle {
                constructor(pos, itemSpawned = item_7.ItemType.HeartSmall) {
                    super(pos, itemSpawned);
                    this.animation = new animation_7.Animation(GardenCandle.AnimationFrames, candle_1.Candle.ElapsedMsPerFrame, true);
                    this.imgid = this.animation.stepValue();
                    this.hitarea = GardenCandle.CandleHitArea;
                    this.itemSpawnedAfterKill = itemSpawned;
                }
            };
            GardenCandle.candleSprites = new Map([[direction_11.Direction.None, [resourceids_20.BitmapId.GCandle_1]]]);
            GardenCandle.CandleHitArea = common_20.newArea(0, 0, 16, 16);
            GardenCandle.AnimationFrames = new Array(resourceids_20.BitmapId.GCandle_1, resourceids_20.BitmapId.GCandle_2);
            exports_54("GardenCandle", GardenCandle);
        }
    };
});
System.register("src/RoomFactory", ["src/room", "BoazEngineJS/common", "BoazEngineJS/msx", "src/sintervaniamodel", "src/gardencandle"], function (exports_55, context_55) {
    "use strict";
    var room_3, common_21, msx_14, sintervaniamodel_21, gardencandle_1, RoomDataContainer, RoomMap, RoomFactory;
    var __moduleName = context_55 && context_55.id;
    return {
        setters: [
            function (room_3_1) {
                room_3 = room_3_1;
            },
            function (common_21_1) {
                common_21 = common_21_1;
            },
            function (msx_14_1) {
                msx_14 = msx_14_1;
            },
            function (sintervaniamodel_21_1) {
                sintervaniamodel_21 = sintervaniamodel_21_1;
            },
            function (gardencandle_1_1) {
                gardencandle_1 = gardencandle_1_1;
            }
        ],
        execute: function () {
            RoomDataContainer = class RoomDataContainer {
                constructor(id, cmap, exits, bitmapPath, map, initFunction) {
                    this.Id = id;
                    this.CollisionMap = cmap;
                    this.Exits = exits;
                    this.BitmapPath = bitmapPath;
                    this.Map = map;
                    this.InitFunction = initFunction;
                }
            };
            exports_55("RoomDataContainer", RoomDataContainer);
            (function (RoomMap) {
                RoomMap[RoomMap["Debug"] = 0] = "Debug";
                RoomMap[RoomMap["Dungeon1"] = 1] = "Dungeon1";
                RoomMap[RoomMap["Dungeon2"] = 2] = "Dungeon2";
                RoomMap[RoomMap["Town1"] = 3] = "Town1";
            })(RoomMap || (RoomMap = {}));
            exports_55("RoomMap", RoomMap);
            RoomFactory = class RoomFactory {
                static RoomExists(id) {
                    return RoomFactory.rooms.has(id);
                }
                static LoadRoom(id) {
                    if (!RoomFactory.rooms.has(id)) {
                        throw Error("Room " + id + " could not be found in dictionary!");
                    }
                    return room_3.Room.LoadRoom(RoomFactory.rooms[id]);
                }
                static posOnMap(map, id) {
                    for (let y = 0; (y < map.length); y++) {
                        for (let x = 0; (x < map[y].length); x++) {
                            if ((map[y][x] == id)) {
                                return common_21.newPoint(x, y);
                            }
                        }
                    }
                    throw new Error("Could not find room with Id {0} on the map:" + id);
                }
                static roomExits(map, id) {
                    let result = new Array(4);
                    let pos = RoomFactory.posOnMap(map, id);
                    for (let i = 0; (i < RoomFactory.dirOffsets.length); i++) {
                        let x = (pos.x + RoomFactory.dirOffsets[i][0]);
                        let y = (pos.y + RoomFactory.dirOffsets[i][1]);
                        if (((x < 0)
                            || ((x >= map[y].length)
                                || ((y < 0)
                                    || (y >= map.length))))) {
                            result[i] = room_3.Room.NO_ROOM_EXIT;
                        }
                        else {
                            result[i] = map[y][x];
                        }
                    }
                    return result;
                }
                static PrepareData() {
                    RoomFactory.rooms = new Map();
                }
                static PrepareDummyData() {
                    RoomFactory.rooms = new Map();
                    let collisionData;
                    let id;
                    let bitmapPath;
                    let map;
                    id = 1;
                    map = RoomFactory.RoomMap_debug;
                    bitmapPath = "./Resources/Graphics/Stage/Dummy/DummyRoom.png";
                    collisionData = [
                        "................................",
                        "................................",
                        "................................",
                        "................................",
                        "................................",
                        "................................",
                        ".......................##.......",
                        ".......................##.......",
                        "......................###.......",
                        "......................#######...",
                        "......................#######...",
                        ".......................#######..",
                        ".......................#######..",
                        ".......................#######..",
                        ".......................########.",
                        ".......................########.",
                        ".......................########.",
                        ".......................########.",
                        ".........#.............########.",
                        "......######............########",
                        "...#########............########",
                        "...########.............########",
                        "...########.....................",
                        "...########.....................",
                    ];
                    RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, null));
                    RoomFactory.rooms.set(2, new RoomDataContainer(2, collisionData, RoomFactory.roomExits(map, 2), bitmapPath, map, null));
                    RoomFactory.rooms.set(3, new RoomDataContainer(3, collisionData, RoomFactory.roomExits(map, 3), bitmapPath, map, null));
                    RoomFactory.rooms.set(4, new RoomDataContainer(4, collisionData, RoomFactory.roomExits(map, 4), bitmapPath, map, null));
                }
                static PrepareStage0Data() {
                    let collisionData;
                    let id;
                    let bitmapPath;
                    let map;
                    let initFunction;
                    id = 100;
                    map = RoomFactory.RoomMap_stage0;
                    bitmapPath = "./Resources/Graphics/Stage/castle_entrance_3.png";
                    collisionData = [
                        "################################",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#..............................#",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "#...............................",
                        "################################",
                        "################################",
                        "################################",
                        "################################"
                    ];
                    initFunction = (r) => {
                        let candle = new gardencandle_1.GardenCandle(msx_14.Tile.ToCoord(8, 14));
                        sintervaniamodel_21.GameModel._.spawn(candle);
                        let candle2 = new gardencandle_1.GardenCandle(msx_14.Tile.ToCoord(24, 14));
                        sintervaniamodel_21.GameModel._.spawn(candle2);
                    };
                    RoomFactory.rooms.set(id, new RoomDataContainer(id, collisionData, RoomFactory.roomExits(map, id), bitmapPath, map, initFunction));
                }
            };
            RoomFactory.dirOffsets = [
                { x: 0, y: -1 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
                { x: -1, y: 0 },
            ];
            RoomFactory.RoomMap_debug = [
                [0, 3, 0,],
                [2, 1, 4,],
                [0, 0, 0,],
                [0, 0, 0,],
            ];
            RoomFactory.RoomMap_stage0 = [
                [0, 0, 0, 0, 0,],
                [0, 0, 100, 0, 0,],
                [0, 0, 0, 0, 0,],
                [0, 0, 0, 0, 0,],
            ];
            exports_55("RoomFactory", RoomFactory);
        }
    };
});
System.register("src/chandelier", ["BoazEngineJS/btimer", "BoazEngineJS/direction", "BoazEngineJS/animation", "src/foe", "src/item", "BoazEngineJS/resourceids", "BoazEngineJS/common", "src/sintervaniamodel"], function (exports_56, context_56) {
    "use strict";
    var btimer_11, direction_12, animation_8, foe_3, item_8, resourceids_21, common_22, sintervaniamodel_22, Chandelier, ChandelierState;
    var __moduleName = context_56 && context_56.id;
    return {
        setters: [
            function (btimer_11_1) {
                btimer_11 = btimer_11_1;
            },
            function (direction_12_1) {
                direction_12 = direction_12_1;
            },
            function (animation_8_1) {
                animation_8 = animation_8_1;
            },
            function (foe_3_1) {
                foe_3 = foe_3_1;
            },
            function (item_8_1) {
                item_8 = item_8_1;
            },
            function (resourceids_21_1) {
                resourceids_21 = resourceids_21_1;
            },
            function (common_22_1) {
                common_22 = common_22_1;
            },
            function (sintervaniamodel_22_1) {
                sintervaniamodel_22 = sintervaniamodel_22_1;
            }
        ],
        execute: function () {
            Chandelier = class Chandelier extends foe_3.Foe {
                constructor(pos, itemSpawned = item_8.ItemType.HeartSmall) {
                    super(pos);
                    this.animation = new animation_8.Animation(Chandelier.AnimationFrames);
                    this.animation.repeat = true;
                    this.timer = btimer_11.BStopwatch.createWatch();
                    this.imgid = resourceids_21.BitmapId.Chandelier_1;
                    this.hitarea = Chandelier.ChandelierHitArea;
                    this.size = common_22.newSize(50, 64);
                    this.itemSpawnedAfterKill = item_8.ItemType.None;
                    this.Health = 0;
                    this.state = ChandelierState.None;
                }
                get DamageToPlayer() {
                    return 3;
                }
                get moveBeforeFrameChange() {
                    return 0;
                }
                get RespawnAtRoomEntry() {
                    return true;
                }
                get movementSprites() {
                    return Chandelier.chandelierSprites;
                }
                get CanHurtPlayer() {
                    return this.state == ChandelierState.Crashing ? true : false;
                }
                set CanHurtPlayer(value) {
                }
                TakeTurn() {
                    switch (this.state) {
                        case ChandelierState.None:
                            if (sintervaniamodel_22.GameModel._.Belmont.x_plus_width >= this.pos.x && sintervaniamodel_22.GameModel._.Belmont.pos.x <= this.x_plus_width) {
                                this.state = ChandelierState.Falling;
                            }
                            break;
                        case ChandelierState.Falling:
                            this.pos.y += 8;
                            break;
                        case ChandelierState.Crashing:
                            if (this.animation.doAnimation(this.timer))
                                this.imgid = this.animation.stepValue();
                            if (this.animation.finished()) {
                                this.timer.stop();
                                this.state = ChandelierState.Crashed;
                            }
                            break;
                    }
                }
                Dispose() {
                    btimer_11.BStopwatch.removeWatch(this.timer);
                }
                HandleHit(source) {
                    super.HandleHit(source);
                    this.loseHealth(source);
                }
                Paint(offset = null) {
                    super.Paint(offset);
                }
            };
            Chandelier.ChandelierHitArea = common_22.newArea(14, 0, 35, 64);
            Chandelier.chandelierSprites = new Map([
                [direction_12.Direction.None, [resourceids_21.BitmapId.Chandelier_1]]
            ]);
            Chandelier.AnimationFrames = [
                { time: 125, data: resourceids_21.BitmapId.Chandelier_2 },
                { time: 125, data: resourceids_21.BitmapId.Chandelier_3 },
                { time: 125, data: resourceids_21.BitmapId.Chandelier_4 },
                { time: 125, data: resourceids_21.BitmapId.Chandelier_5 },
            ];
            exports_56("Chandelier", Chandelier);
            (function (ChandelierState) {
                ChandelierState[ChandelierState["None"] = 0] = "None";
                ChandelierState[ChandelierState["Falling"] = 1] = "Falling";
                ChandelierState[ChandelierState["Crashing"] = 2] = "Crashing";
                ChandelierState[ChandelierState["Crashed"] = 3] = "Crashed";
            })(ChandelierState || (ChandelierState = {}));
            exports_56("ChandelierState", ChandelierState);
        }
    };
});
System.register("src/fprojectile", ["src/gameconstants", "src/projectile", "BoazEngineJS/common", "src/sintervaniamodel"], function (exports_57, context_57) {
    "use strict";
    var gameconstants_9, projectile_2, common_23, sintervaniamodel_23, FProjectile;
    var __moduleName = context_57 && context_57.id;
    return {
        setters: [
            function (gameconstants_9_1) {
                gameconstants_9 = gameconstants_9_1;
            },
            function (projectile_2_1) {
                projectile_2 = projectile_2_1;
            },
            function (common_23_1) {
                common_23 = common_23_1;
            },
            function (sintervaniamodel_23_1) {
                sintervaniamodel_23 = sintervaniamodel_23_1;
            }
        ],
        execute: function () {
            FProjectile = class FProjectile extends projectile_2.Projectile {
                get CanHurtPlayer() {
                    return true;
                }
                constructor(pos, speed) {
                    super(pos, speed);
                    this.speed = speed;
                }
                TakeTurn() {
                    this.pos = common_23.addPoints(this.pos, this.speed);
                    if (this.CanHurtPlayer && this.objectCollide(sintervaniamodel_23.GameModel._.Belmont))
                        sintervaniamodel_23.GameModel._.Belmont.TakeDamage(this.DamageDealt);
                    if (this.checkWallSpriteCollisions() || this.checkWallCollision())
                        this.disposeFlag = true;
                    if (this.pos.x < 0 || this.pos.x + this.size.x >= gameconstants_9.GameConstants.GameScreenWidth || this.pos.y < 0 || this.pos.y + this.size.y >= gameconstants_9.GameConstants.GameScreenHeight)
                        this.disposeFlag = true;
                }
            };
            exports_57("FProjectile", FProjectile);
        }
    };
});
System.register("src/game", ["BoazEngineJS/engine", "src/sintervaniamodel", "src/gamecontroller", "src/gameview"], function (exports_58, context_58) {
    "use strict";
    var engine, sintervaniamodel_24, gamecontroller_9, gameview_4;
    var __moduleName = context_58 && context_58.id;
    function Annnndddd___Go() {
        new engine.Game();
        engine.game.setModel(new sintervaniamodel_24.GameModel());
        engine.game.setController(new gamecontroller_9.GameController());
        let gameview = new gameview_4.GameView();
        engine.game.setGameView(gameview);
        gameview.init();
        return engine.game;
    }
    exports_58("Annnndddd___Go", Annnndddd___Go);
    return {
        setters: [
            function (engine_17) {
                engine = engine_17;
            },
            function (sintervaniamodel_24_1) {
                sintervaniamodel_24 = sintervaniamodel_24_1;
            },
            function (gamecontroller_9_1) {
                gamecontroller_9 = gamecontroller_9_1;
            },
            function (gameview_4_1) {
                gameview_4 = gameview_4_1;
            }
        ],
        execute: function () {
        }
    };
});
System.register("src/hag", ["BoazEngineJS/btimer", "BoazEngineJS/animation", "BoazEngineJS/direction", "BoazEngineJS/resourceids", "src/item", "src/foe", "src/gameconstants"], function (exports_59, context_59) {
    "use strict";
    var btimer_12, animation_9, direction_13, resourceids_22, item_9, foe_4, gameconstants_10, Hag;
    var __moduleName = context_59 && context_59.id;
    return {
        setters: [
            function (btimer_12_1) {
                btimer_12 = btimer_12_1;
            },
            function (animation_9_1) {
                animation_9 = animation_9_1;
            },
            function (direction_13_1) {
                direction_13 = direction_13_1;
            },
            function (resourceids_22_1) {
                resourceids_22 = resourceids_22_1;
            },
            function (item_9_1) {
                item_9 = item_9_1;
            },
            function (foe_4_1) {
                foe_4 = foe_4_1;
            },
            function (gameconstants_10_1) {
                gameconstants_10 = gameconstants_10_1;
            }
        ],
        execute: function () {
            Hag = class Hag extends foe_4.Foe {
                constructor({ pos, dir, itemSpawned = item_9.ItemType.HeartSmall }) {
                    super(pos);
                    this.CanHurtPlayer = true;
                    this.animation = new animation_9.Animation(Hag.AnimationFrames, null, true);
                    this.timer = btimer_12.BStopwatch.createWatch();
                    this.imgid = this.animation.stepValue();
                    this.timer.restart();
                    this.size = Hag.HagSize;
                    this.hitarea = Hag.HagHitArea;
                    this.itemSpawnedAfterKill = itemSpawned;
                    this.Health = 1;
                    this.Direction = dir;
                }
                get DamageToPlayer() {
                    return 1;
                }
                get moveBeforeFrameChange() {
                    return 0;
                }
                get RespawnAtRoomEntry() {
                    return true;
                }
                TakeTurn() {
                    let stepValue = { nextStepValue: this.imgid };
                    this.animation.doAnimation(this.timer, stepValue);
                    this.imgid = stepValue.nextStepValue;
                    this.flippedH = this.Direction == direction_13.Direction.Left;
                    this.pos.x += this.Direction == direction_13.Direction.Left ? -2 : 2;
                    if (this.pos.x >= gameconstants_10.GameConstants.GameScreenWidth || (0 > this.pos.x + this.size.x)) {
                        this.disposeFlag = true;
                    }
                }
                Dispose() {
                    btimer_12.BStopwatch.removeWatch(this.timer);
                }
                HandleHit(source) {
                    super.HandleHit(source);
                    this.loseHealth(source);
                }
                Paint(offset = null) {
                    super.Paint(offset);
                }
            };
            Hag.HagSize = { x: 16, y: 32 };
            Hag.HagHitArea = { start: { x: 2, y: 2 }, end: { x: 14, y: 32 } };
            Hag.hagSprites = new Map([[direction_13.Direction.None, [resourceids_22.BitmapId.Hag_1, resourceids_22.BitmapId.Hag_2]]]);
            Hag.movementSprites = Hag.hagSprites;
            Hag.AnimationFrames = new Array({ time: 250, data: resourceids_22.BitmapId.Hag_1 }, { time: 250, data: resourceids_22.BitmapId.Hag_2 });
            exports_59("Hag", Hag);
        }
    };
});
System.register("src/haggenerator", ["BoazEngineJS/btimer", "src/sintervaniamodel", "BoazEngineJS/animation", "src/hag"], function (exports_60, context_60) {
    "use strict";
    var btimer_13, sintervaniamodel_25, animation_10, hag_1, HagGenerator;
    var __moduleName = context_60 && context_60.id;
    return {
        setters: [
            function (btimer_13_1) {
                btimer_13 = btimer_13_1;
            },
            function (sintervaniamodel_25_1) {
                sintervaniamodel_25 = sintervaniamodel_25_1;
            },
            function (animation_10_1) {
                animation_10 = animation_10_1;
            },
            function (hag_1_1) {
                hag_1 = hag_1_1;
            }
        ],
        execute: function () {
            HagGenerator = class HagGenerator {
                get hitbox_sx() {
                    return this.pos.x + this.hitarea.start.x;
                }
                get hitbox_sy() {
                    return this.pos.y + this.hitarea.start.y;
                }
                get hitbox_ex() {
                    return this.pos.x + this.hitarea.end.x;
                }
                get hitbox_ey() {
                    return this.pos.y + this.hitarea.end.y;
                }
                get x_plus_width() {
                    return 0;
                }
                get y_plus_height() {
                    return 0;
                }
                get z_plus_depth() {
                    return 0;
                }
                constructor(pos, directionOfHags) {
                    this.spawnAnimation = new animation_10.Animation([true], [2000], true);
                    this.timer = btimer_13.BStopwatch.createWatch();
                    this.timer.restart();
                    this.directionOfHags = directionOfHags;
                }
                takeTurn() {
                    let stepValue = { nextStepValue: false };
                    if (this.spawnAnimation.doAnimation(this.timer, stepValue))
                        sintervaniamodel_25.GameModel._.spawn(new hag_1.Hag({ pos: { x: this.pos.x, y: this.pos.y }, dir: this.directionOfHags }));
                }
                Dispose() {
                    btimer_13.BStopwatch.removeWatch(this.timer);
                }
                spawn(spawningPos) {
                    if (spawningPos != null)
                        this.pos = spawningPos;
                }
                objectCollide(o) {
                    return false;
                }
                areaCollide(a) {
                    return false;
                }
                handleResizeEvent() {
                }
                exile() {
                    btimer_13.BStopwatch.removeWatch(this.timer);
                }
            };
            exports_60("HagGenerator", HagGenerator);
        }
    };
});
System.register("src/pietula", ["BoazEngineJS/animation", "BoazEngineJS/btimer", "src/bossfoe", "BoazEngineJS/direction", "BoazEngineJS/resourceids", "BoazEngineJS/common"], function (exports_61, context_61) {
    "use strict";
    var animation_11, btimer_14, bossfoe_1, direction_14, resourceids_23, common_24, PietulaState, Pietula;
    var __moduleName = context_61 && context_61.id;
    return {
        setters: [
            function (animation_11_1) {
                animation_11 = animation_11_1;
            },
            function (btimer_14_1) {
                btimer_14 = btimer_14_1;
            },
            function (bossfoe_1_1) {
                bossfoe_1 = bossfoe_1_1;
            },
            function (direction_14_1) {
                direction_14 = direction_14_1;
            },
            function (resourceids_23_1) {
                resourceids_23 = resourceids_23_1;
            },
            function (common_24_1) {
                common_24 = common_24_1;
            }
        ],
        execute: function () {
            (function (PietulaState) {
                PietulaState[PietulaState["None"] = 0] = "None";
                PietulaState[PietulaState["ThrowingZakFoes"] = 1] = "ThrowingZakFoes";
                PietulaState[PietulaState["Bla"] = 2] = "Bla";
            })(PietulaState || (PietulaState = {}));
            Pietula = class Pietula extends bossfoe_1.BossFoe {
                constructor(pos) {
                    super(pos);
                    this.CanHurtPlayer = true;
                    this.animation = new animation_11.Animation(Pietula.AnimationFrames, null, true);
                    this.timer = btimer_14.BStopwatch.createWatch();
                    this.imgid = this.animation.stepValue().img;
                    this.timer.restart();
                    this.hitarea = Pietula.PietulaHitArea;
                    this.size = common_24.newSize(this.hitarea.end.x, this.hitarea.end.y);
                    this.Health = 20;
                }
                get DamageToPlayer() {
                    return 5;
                }
                get moveBeforeFrameChange() {
                    return 0;
                }
                get RespawnAtRoomEntry() {
                    return true;
                }
                get movementSprites() {
                    return Pietula.pietulaSprites;
                }
                StartBossfight() {
                    throw "Not implemented!";
                }
                TakeTurn() {
                    let stepValue = { nextStepValue: { img: this.imgid, dy: 0 } };
                    this.animation.doAnimation(this.timer, stepValue);
                    this.imgid = stepValue.nextStepValue.img;
                    this.pos.y += stepValue.nextStepValue.dy;
                }
                Dispose() {
                    btimer_14.BStopwatch.removeWatch(this.timer);
                }
                HandleHit(source) {
                    super.HandleHit(source);
                    this.loseHealth(source);
                }
                Paint(offset = null) {
                    super.Paint(offset);
                }
                Die() {
                    super.Die();
                }
            };
            Pietula.PietulaHitArea = common_24.newArea(0, 0, 10, 16);
            Pietula.pietulaSprites = new Map([[direction_14.Direction.None, [resourceids_23.BitmapId.Pietula_1]]]);
            Pietula.AnimationFrames = new Array({ time: 250, data: { img: resourceids_23.BitmapId.Pietula_1, dy: -1 } }, { time: 250, data: { img: resourceids_23.BitmapId.Pietula_2, dy: 1 } });
            exports_61("Pietula", Pietula);
        }
    };
});
System.register("src/story", [], function (exports_62, context_62) {
    "use strict";
    var Story;
    var __moduleName = context_62 && context_62.id;
    return {
        setters: [],
        execute: function () {
            Story = class Story {
            };
            exports_62("Story", Story);
        }
    };
});
System.register("src/zakfoe", ["src/foe", "BoazEngineJS/btimer", "src/item", "BoazEngineJS/direction", "BoazEngineJS/common", "BoazEngineJS/resourceids", "src/sintervaniamodel", "src/gameconstants", "BoazEngineJS/msx"], function (exports_63, context_63) {
    "use strict";
    var foe_5, btimer_15, item_10, direction_15, common_25, resourceids_24, sintervaniamodel_26, gameconstants_11, msx_15, ZakFoe;
    var __moduleName = context_63 && context_63.id;
    return {
        setters: [
            function (foe_5_1) {
                foe_5 = foe_5_1;
            },
            function (btimer_15_1) {
                btimer_15 = btimer_15_1;
            },
            function (item_10_1) {
                item_10 = item_10_1;
            },
            function (direction_15_1) {
                direction_15 = direction_15_1;
            },
            function (common_25_1) {
                common_25 = common_25_1;
            },
            function (resourceids_24_1) {
                resourceids_24 = resourceids_24_1;
            },
            function (sintervaniamodel_26_1) {
                sintervaniamodel_26 = sintervaniamodel_26_1;
            },
            function (gameconstants_11_1) {
                gameconstants_11 = gameconstants_11_1;
            },
            function (msx_15_1) {
                msx_15 = msx_15_1;
            }
        ],
        execute: function () {
            ZakFoe = class ZakFoe extends foe_5.Foe {
                constructor(pos, itemSpawned = item_10.Item.Type.HeartSmall) {
                    super(pos);
                    this.CanHurtPlayer = true;
                    throw new Error("ZakFoe compileert nog niet omdat er gewoon nog wat zaken missen.");
                    this.timer = btimer_15.BStopwatch.createWatch();
                    this.imgid = this.animation.stepValue().img;
                    this.timer.restart();
                    this.hitarea = ZakFoe.ZakFoeHitArea;
                    this.size = common_25.newSize(16, 16);
                    this.itemSpawnedAfterKill = itemSpawned;
                    this.Direction = direction_15.Direction.Left;
                    this.Health = 1;
                }
                get DamageToPlayer() {
                    return 1;
                }
                get moveBeforeFrameChange() {
                    return 0;
                }
                get RespawnAtRoomEntry() {
                    return true;
                }
                get movementSprites() {
                    return ZakFoe.zakFoeSprites;
                }
                TakeTurn() {
                    let stepValue = { nextStepValue: { img: this.imgid, dy: 0 } };
                    this.animation.doAnimation(this.timer, stepValue);
                    this.imgid = stepValue.nextStepValue.img;
                    this.pos.y += stepValue.nextStepValue.dy;
                    if (this.imgid == resourceids_24.BitmapId.ZakFoe_2) {
                        switch (this.Direction) {
                            case direction_15.Direction.Left:
                                this.pos.x -= 1;
                                if (this.pos.x <= 0)
                                    this.Direction = direction_15.Direction.Right;
                                if (sintervaniamodel_26.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_sy }, { x: this.hitbox_sx, y: this.hitbox_ey }))
                                    this.Direction = direction_15.Direction.Right;
                                if (!sintervaniamodel_26.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_sx, y: this.hitbox_ey + msx_15.TileSize + 4 }))
                                    this.Direction = direction_15.Direction.Right;
                                break;
                            case direction_15.Direction.Right:
                                this.pos.x += 1;
                                if (this.pos.x >= gameconstants_11.GameConstants.GameScreenWidth)
                                    this.Direction = direction_15.Direction.Left;
                                if (sintervaniamodel_26.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_sy }, { x: this.hitbox_ex, y: this.hitbox_ey }))
                                    this.Direction = direction_15.Direction.Left;
                                if (!sintervaniamodel_26.GameModel._.CurrentRoom.AnyCollisionsTiles(true, { x: this.hitbox_ex, y: this.hitbox_ey + msx_15.TileSize + 4 }))
                                    this.Direction = direction_15.Direction.Left;
                                break;
                        }
                    }
                    super.TakeTurn();
                }
                Dispose() {
                    btimer_15.BStopwatch.removeWatch(this.timer);
                }
                HandleHit(source) {
                    super.HandleHit(source);
                    this.loseHealth(source);
                }
                Paint(offset = null) {
                    this.flippedH = this.Direction == direction_15.Direction.Left ? true : false;
                    super.Paint(offset);
                }
            };
            ZakFoe.ZakFoeHitArea = common_25.newArea(2, 2, 14, 14);
            ZakFoe.zakFoeSprites = new Map([
                [direction_15.Direction.Right, [resourceids_24.BitmapId.ZakFoe_1, resourceids_24.BitmapId.ZakFoe_2, resourceids_24.BitmapId.ZakFoe_3]],
                [direction_15.Direction.Left, [resourceids_24.BitmapId.ZakFoe_1, resourceids_24.BitmapId.ZakFoe_2, resourceids_24.BitmapId.ZakFoe_3]],
            ]);
            exports_63("ZakFoe", ZakFoe);
        }
    };
});
