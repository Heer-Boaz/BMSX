-- bmsx-lint:disable
-- dkc1 player physics - direct assembly translation
-- source: .external/dkc1/routine_macros_dkc1.asm
-- this is a literal translation of assembly to lua - intentionally inefficient and verbose
-- all variable names, function names, and logic flow match assembly exactly

local constants = require('constants')

local player = {}
player.__index = player

-- ============================================================================
-- joypad button masks (from assembly defines)
-- ============================================================================
local joypad_b      = 0x8000  -- button b
local joypad_y      = 0x4000  -- button y
local joypad_select = 0x2000  -- select
local joypad_start  = 0x1000  -- start
local joypad_dpadu  = 0x0800  -- d-pad up
local joypad_dpadd  = 0x0400  -- d-pad down
local joypad_dpadl  = 0x0200  -- d-pad left
local joypad_dpadr  = 0x0100  -- d-pad right
local joypad_a      = 0x0080  -- button a
local joypad_x      = 0x0040  -- button x
local joypad_l      = 0x0020  -- button l
local joypad_r      = 0x0010  -- button r

-- ============================================================================
-- animation ids (from misc_defines_dkc1.asm)
-- ============================================================================
local define_dkc1_animationid_dk_idle = 0x0001
local define_dkc1_animationid_dk_run = 0x0002
local define_dkc1_animationid_dk_walk = 0x0003
local define_dkc1_animationid_dk_turn = 0x0006
local define_dkc1_animationid_dk_inactivejump = 0x0007
local define_dkc1_animationid_dk_jump = 0x0005
local define_dkc1_animationid_dk_getoffanimalbuddy = 0x0008
local define_dkc1_animationid_rambiriddenbydk_jumpontire = 0x0036
local define_dkc1_animationid_dk_holdjump = 0x004D
local define_dkc1_animationid_dk_hurt = 0x000C
local define_dkc1_animationid_dk_hurtunderwater = 0x000D
local define_dkc1_animationid_dk_dead = 0x0010
local define_dkc1_animationid_dk_swimaway = 0x000F
local define_dkc1_animationid_dk_fall = 0x0015
local define_dkc1_animationid_dk_unknowngroundstomp = 0x0016
local define_dkc1_animationid_dk_bounce = 0x0017
local define_dkc1_animationid_dk_roll = 0x0018
local define_dkc1_animationid_dk_endroll = 0x0019
local define_dkc1_animationid_dk_cancelroll = 0x001a
local define_dkc1_animationid_dk_jumpoffverticalrope = 0x0052
local define_dkc1_animationid_dk_bouncewhileholding = 0x0053
local define_dkc1_animationid_dk_jumpaway = 0x0054
local define_dkc1_animationid_dk_duckintocrawlspace = 0x0056
local define_dkc1_animationid_dk_crawling = 0x005A
local define_dkc1_animationid_dk_incrawlspace = 0x0057
local define_dkc1_animationid_dk_leavecrawlspace = 0x0059
local define_dkc1_animationid_dk_unknownbonusroomexit = 0x0051
local define_dkc1_animationid_dk_hangontoverticalrope = 0x005E
local define_dkc1_animationid_dk_swimming = 0x0060
local define_dkc1_animationid_dk_lookup = 0x0061
local define_dkc1_animationid_dk_initrunaway = 0x0014
local define_dkc1_animationid_dk_ridesteelkeg = 0x004E
local define_dkc1_animationid_dk_getknockedoffunderwateranimalbuddy = 0x0066
local define_dkc1_animationid_dk_climbupverticalrope = 0x0039
local define_dkc1_animationid_dk_climbdownverticalrope = 0x003A
local define_dkc1_animationid_rambiriddenbydk_walk = 0x0035
local define_dkc1_animationid_rambiriddenbydk_stab = 0x0048
local define_dkc1_animationid_enguarderiddenbydk_stab = 0x0048
local define_dkc1_animationid_enguarderiddenbydk_idle = 0x0021
local define_dkc1_animationid_enguarderiddenbydhk_swim = 0x0029
local define_dkc1_animationid_dk_getoffunderwateranimalbuddy = 0x0065
local define_dkc1_animationid_dk_pickup = 0x0040
local define_dkc1_animationid_dk_throw = 0x0041
local define_dkc1_norspr06_klump = 0x0006
local define_dkc1_norspr09_rambi = 0x0009
local define_dkc1_norspr0a_expresso = 0x000A
local define_dkc1_norspr0b_winky = 0x000B
local define_dkc1_norspr0c_enguarde = 0x000C
local define_dkc1_norspr2c_itemcache = 0x002C
local define_dkc1_norspr2f_army = 0x002F
local define_dkc1_norspr30_verticalrope = 0x0030
local define_dkc1_norspr31_swingingrope = 0x0031
local define_dkc1_norspr51_minecart = 0x0051
local define_dkc1_norspr46_bluekrusha = 0x0046
local define_dkc1_entranceid_minecartmadness_main = 0x0027
local define_dkc1_entranceid_minecartmadness_checkpointbarrel = 0x003B
local define_dkc1_entranceid_minecartmadness_exitbonus1 = 0x008C
local define_dkc1_entranceid_minecartmadness_exitbonus2 = 0x008D
local define_dkc1_entranceid_minecartmadness_exitbonus3 = 0x008E
local define_dkc1_entranceid_minecartcarnage_main = 0x002E
local define_dkc1_entranceid_minecartcarnage_checkpointbarrel = 0x0038
local define_dkc1_entranceid_minecartcarnage_warp = 0x00CC
local define_dkc1_entranceid_oildrumalley_enterbonus2 = 0x0061
local define_dkc1_entranceid_animaltokentest_main = 0x0034
local define_dkc1_entranceid_gangplankgalleon_main = 0x0068
local define_dkc1_entranceid_verygnawtyslair_main = 0x00E0
local define_dkc1_entranceid_neckysnuts_main = 0x00E1
local define_dkc1_entranceid_reallygnawtyrampage_main = 0x00E2
local define_dkc1_entranceid_bossdumbdrum_main = 0x00E3
local define_dkc1_entranceid_neckysrevenge_main = 0x00E4
local define_dkc1_entranceid_bumblebrumble_main = 0x00E5
local define_dkc1_entranceid_chimpcavernsmap = 0x00E6
local define_dkc1_entranceid_kremkrocindustriesincmap = 0x00E7
local define_dkc1_entranceid_gorillaglaciermap = 0x00E8
local define_dkc1_entranceid_vinevalleymap = 0x00E9
local define_dkc1_entranceid_kongojunglemap = 0x00EC
local define_dkc1_entranceid_monkeyminesmap = 0x00ED
local define_dkc1_entranceid_invalidmap = 0x00EB
local define_dkc1_entranceid_junglehijinxs_enterfullkongsbananahoard = 0x004C
local define_dkc1_entranceid_credits = 0x005E
local define_dkc1_entranceid_junglehijinxs_main = 0x0016
local define_dkc1_soundid_unpause = 0x002D
local define_dkc1_soundid_getonanimalbuddy = 0x0058
local define_dkc1_soundid_animalbuddyjump = 0x005F
local define_dkc1_soundid_lostlife = 0x0007
local define_dkc1_soundid_stompenemy = 0x0008
local define_dkc1_musicid_deathmusic = 0x0011
local define_dkc1_global_startinglives = 0x0005
local define_dkc1_global_50livescheatstartinglives = 0x0032
local define_dkc1_cheatflags_50lives = 0x0004

-- Visual mode routing driven from DKC1 animation id ($16AD).
local data_visual_mode_by_animation = {
	[define_dkc1_animationid_dk_idle] = 'idle',
	[define_dkc1_animationid_dk_lookup] = 'idle',
	[define_dkc1_animationid_dk_pickup] = 'idle',
	[define_dkc1_animationid_dk_throw] = 'idle',
	[define_dkc1_animationid_dk_incrawlspace] = 'idle',

	[define_dkc1_animationid_dk_walk] = 'walk',
	[define_dkc1_animationid_dk_crawling] = 'walk',
	[define_dkc1_animationid_dk_duckintocrawlspace] = 'walk',
	[define_dkc1_animationid_dk_leavecrawlspace] = 'walk',
	[define_dkc1_animationid_dk_climbupverticalrope] = 'walk',
	[define_dkc1_animationid_dk_climbdownverticalrope] = 'walk',
	[define_dkc1_animationid_enguarderiddenbydk_idle] = 'walk',

	[define_dkc1_animationid_dk_run] = 'run',
	[define_dkc1_animationid_dk_turn] = 'run',
	[define_dkc1_animationid_dk_initrunaway] = 'run',
	[define_dkc1_animationid_rambiriddenbydk_walk] = 'run',
	[define_dkc1_animationid_enguarderiddenbydhk_swim] = 'run',
	[define_dkc1_animationid_rambiriddenbydk_stab] = 'run',
	[define_dkc1_animationid_enguarderiddenbydk_stab] = 'run',

	[define_dkc1_animationid_dk_roll] = 'roll',
	[define_dkc1_animationid_dk_endroll] = 'roll',
	[define_dkc1_animationid_dk_cancelroll] = 'roll',
	[define_dkc1_animationid_dk_ridesteelkeg] = 'roll',
	[define_dkc1_animationid_dk_unknowngroundstomp] = 'roll',

	[define_dkc1_animationid_dk_inactivejump] = 'air',
	[define_dkc1_animationid_dk_jump] = 'air',
	[define_dkc1_animationid_rambiriddenbydk_jumpontire] = 'air',
	[define_dkc1_animationid_dk_holdjump] = 'air',
	[define_dkc1_animationid_dk_getoffanimalbuddy] = 'air',
	[define_dkc1_animationid_dk_hurt] = 'air',
	[define_dkc1_animationid_dk_hurtunderwater] = 'air',
	[define_dkc1_animationid_dk_dead] = 'air',
	[define_dkc1_animationid_dk_swimaway] = 'air',
	[define_dkc1_animationid_dk_fall] = 'air',
	[define_dkc1_animationid_dk_bounce] = 'air',
	[define_dkc1_animationid_dk_jumpoffverticalrope] = 'air',
	[define_dkc1_animationid_dk_bouncewhileholding] = 'air',
	[define_dkc1_animationid_dk_jumpaway] = 'air',
	[define_dkc1_animationid_dk_unknownbonusroomexit] = 'air',
	[define_dkc1_animationid_dk_hangontoverticalrope] = 'air',
	[define_dkc1_animationid_dk_swimming] = 'air',
	[define_dkc1_animationid_dk_getknockedoffunderwateranimalbuddy] = 'air',
	[define_dkc1_animationid_dk_getoffunderwateranimalbuddy] = 'air',
}

-- ============================================================================
-- jump tables used by code_bfb27c dispatch
-- ============================================================================

local data_bfc1c5 = {
	'code_bfb64b',
	'code_bfb64b',
	'code_bfba39',
	'code_bfb634',
	'code_bfb5da',
	'code_bfb5da',
	'code_bfb5e4',
	'code_bfba39',
	'code_bfc192',
	'code_bfb64b',
	'code_bfba39',
	'code_bfb64b',
	'code_bfb640',
	'code_bfba39',
	'code_bfb64b',
	'code_bfb5d1',
	'code_bfba39',
	'code_bfb5b6',
	'code_bfba39',
}

local data_bfc1eb = {
	'code_bfb75a',
	'code_bfb75a',
	'code_bfba39',
	'code_bfb743',
	'code_bfb6f1',
	'code_bfb6f1',
	'code_bfb6fb',
	'code_bfba39',
	'code_bfc192',
	'code_bfb75a',
	'code_bfba39',
	'code_bfb75a',
	'code_bfb74f',
	'code_bfba39',
	'code_bfb75a',
	'code_bfb6e8',
	'code_bfba39',
	'code_bfb6cd',
	'code_bfba39',
}

local data_bfc2f5 = {
	'code_bfc192',
	'code_bfc192',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfc192',
	'code_bfba39',
	'code_bfba39',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfc192',
	'code_bfba39',
}

local data_bfc283 = {
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfba39',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfba6f',
	'code_bfba6f',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfbbaf',
	'code_bfb8e5',
	'code_bfbc53',
	'code_bfbf54',
}

local data_bfc2a9 = {
	'code_bfbc6b',
	'code_bfbc6b',
	'code_bfbed1',
	'code_bfba39',
	'code_bfbed1',
	'code_bfbc6b',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfbc53',
	'code_bfbf5b',
}

-- DATA_BF84C5: main player-state dispatch table (RAMTable1029).
local data_bf84c5 = {
	'code_bf874a',
	'code_bf87f2',
	'code_bf8984',
	'code_bf8ac8',
	'code_bf8bcc',
	'code_bf8bfd',
	'code_bf8cef',
	'code_bf8d41',
	'code_bf8d50',
	'code_bf8d5f',
	'code_bf8dea',
	'code_bf8f97',
	'code_bf8fb9',
	'code_bf8fba',
	'code_bf8fc6',
	'code_bf8fef',
	'code_bf8ff8',
	'code_bf9001',
	'code_bf9006',
	'code_bf903b',
	'code_bf905b',
	'code_bf9151',
	'code_bf916d',
	'code_bf9172',
	'code_bf9192',
	'code_bf91a6',
	'code_bf91ba',
	'code_bf91d1',
	'code_bf9217',
	'code_bf923c',
	'code_bf9277',
	'code_bf9296',
	'code_bf9316',
	'code_bf9329',
	'code_bf9351',
	'code_bf93e9',
	'code_bf9492',
	'code_bf94b3',
	'code_bf9538',
	'code_bf9606',
	'code_bf9638',
	'code_bf96d3',
	'code_bf9729',
	'code_bf9763',
	'code_bf9776',
	'code_bf97d6',
	'code_bf97f2',
	'code_bf9835',
	'code_bf9862',
	'code_bf98db',
	'code_bf996b',
	'code_bf9973',
	'code_bf99ac',
	'code_bf9a3c',
	'code_bf9a7d',
	'code_bf9a9a',
	'code_bf9b31',
	'code_bf9b39',
	'code_bf9b66',
	'code_bf9b72',
	'code_bf9b9a',
	'code_bf9bcf',
	'code_bf9c04',
	'code_bf9c10',
	'code_bf9c28',
	'code_bf9c4f',
	'code_bf9ca2',
	'code_bf9ca7',
	'code_bf9cb5',
	'code_bf9cbd',
	'code_bf9cda',
	'code_bf9db1',
	'code_bf9db8',
	'code_bf9de6',
	'code_bf9e00',
	'code_bf9e09',
	'code_bf9e2b',
	'code_bf9e47',
	'code_bf9eac',
	'code_bf9f22',
	'code_bf9f51',
	'code_bf9f5a',
	'code_bf9f61',
	'code_bf9f78',
	'code_bf9fbe',
	'code_bf9fe9',
	'code_bf9fee',
}

-- DATA_818409: collision low-bit remap table (line 14703)
local data_818409 = {
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
	0x01, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
	0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
	0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04,
	0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x05,
	0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x06, 0x06,
	0x06, 0x06, 0x06, 0x06, 0x86, 0x80, 0x00,
}

-- DATA_8184C9: collision nibble-shape dispatch table (indices 1..63; 0 handled separately).
local data_8184c9 = {
	'code_818547', 'code_81854b', 'code_81854f', 'code_818553', 'code_818557', 'code_81855b', 'code_81855f', 'code_818563',
	'code_818567', 'code_8186b0', 'code_8186a9', 'code_8186a2', 'code_81869b', 'code_818694', 'code_81868d', 'code_818686',
	'code_81867f', 'code_8186b3', 'code_8186b9', 'code_8186bb', 'code_8186c1', 'code_8186c7', 'code_8186cd', 'code_8186d3',
	'code_8186d9', 'code_8186df', 'code_818672', 'code_818665', 'code_81865c', 'code_81864f', 'code_818642', 'code_818635',
	'code_818628', 'code_81861b', 'code_81860e', 'code_818601', 'code_8185ce', 'code_8185d3', 'code_8185d8', 'code_8185dd',
	'code_8185de', 'code_8185e3', 'code_8185e8', 'code_8185ed', 'code_8185f2', 'code_8185f7', 'code_8185fc', 'code_8185c8',
	'code_8185c2', 'code_8185bc', 'code_8185ba', 'code_8185b4', 'code_8185ae', 'code_8185a8', 'code_818583', 'code_81857c',
	'code_818575', 'code_818572', 'code_81856b', 'code_81858a', 'code_818599', 'code_81854b', 'code_81855b',
}

local data_8186e5 = {
	0x01, 0x02, 0x02, 0x03, 0x04, 0x04, 0x05, 0x06,
	0x06, 0x07, 0x08, 0x08, 0x09, 0x0A, 0x0A, 0x0B,
	0x0C, 0x0C, 0x0D, 0x0E, 0x0E, 0x0F, 0x10, 0x10,
	0x11, 0x12, 0x12, 0x13, 0x14, 0x14, 0x15, 0x16,
}

-- DATA_BBA428 from DKC1 (used by CODE_BBA4C8 when A is loaded by caller).
local data_bba428 = {
	{ 0xFFF8, 0xFFD0, 0x0018, 0x0020 },
	{ 0xFFF6, 0xFFE2, 0x0015, 0x001E },
	{ 0x0000, 0xFFEF, 0x001A, 0x0014 },
	{ 0xFFEE, 0xFFE7, 0x001F, 0x0020 },
	{ 0xFFF2, 0xFFD6, 0x0019, 0x0023 },
	{ 0xFFF2, 0xFFD5, 0x003C, 0x002E },
	{ 0xFFFA, 0xFFFC, 0x000A, 0x0006 },
	{ 0xFFEC, 0xFFD8, 0x002A, 0x0028 },
	{ 0xFFF9, 0xFFF7, 0x000C, 0x000E },
	{ 0xFFE7, 0xFFD7, 0x0024, 0x002B },
	{ 0xFFEA, 0xFFE0, 0x0027, 0x002A },
	{ 0xFFE8, 0xFFE5, 0x002D, 0x002D },
	{ 0xFFF1, 0xFFDD, 0x001B, 0x0020 },
	{ 0xFFED, 0xFFCF, 0x0039, 0x0059 },
	{ 0xFFEE, 0xFFBE, 0x0028, 0x0047 },
	{ 0x0000, 0xFFED, 0x0022, 0x0014 },
	{ 0xFFF4, 0xFFE8, 0x002E, 0x001A },
	{ 0xFFD9, 0xFFC8, 0x0051, 0x0060 },
	{ 0xFFF5, 0xFFDD, 0x0020, 0x002C },
	{ 0x0000, 0xFFCC, 0x0035, 0x003C },
}

-- DATA_BB8000 subset (index 0x00..0x3F) and pointed hitboxes from DKC1.
local data_bb9800 = { 0x0000, 0x0000, 0x0000, 0x0000 }
local data_bb980e = { 0xFFF9, 0xFFDD, 0x0018, 0x0022 }
local data_bb9816 = { 0xFFF4, 0xFFE3, 0x0013, 0x0022 }
local data_bb981e = { 0xFFE7, 0xFFF9, 0x0030, 0x000C }
local data_bb9826 = { 0xFFE7, 0x0003, 0x0030, 0x000C }
local data_bb982e = { 0xFFF4, 0xFFE3, 0x0013, 0x0022 }
local data_bb9836 = { 0xFFF9, 0xFFDD, 0x0018, 0x0022 }
local data_bb983e = { 0xFFF9, 0xFFDD, 0x0018, 0x0022 }
local data_bb9846 = { 0xFFF1, 0xFFDD, 0x0018, 0x0022 }
local data_bb984e = { 0xFFF1, 0xFFDD, 0x0018, 0x0022 }

local data_bb8000 = {
	data_bb9800, data_bb980e, data_bb980e, data_bb980e, data_bb980e, data_bb980e, data_bb980e, data_bb980e,
	data_bb9816, data_bb9816, data_bb9816, data_bb9816, data_bb9816, data_bb9816, data_bb9816, data_bb9816,
	data_bb981e, data_bb9826, data_bb9826, data_bb982e, data_bb982e, data_bb982e, data_bb982e, data_bb982e,
	data_bb982e, data_bb982e, data_bb9836, data_bb9836, data_bb9836, data_bb9836, data_bb9836, data_bb9836,
	data_bb9836, data_bb9836, data_bb983e, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846,
	data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846,
	data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846, data_bb9846,
	data_bb984e, data_bb984e, data_bb984e, data_bb984e, data_bb984e, data_bb984e, data_bb984e, data_bb984e,
}

-- DATA_BE984F: DK death animation script (gameplay-affecting steps only).
local data_be984f = {
	{ op = 'wait', frames = 8 },
	{ op = 'call', fn = 'code_be9835' },
	{ op = 'call', fn = 'code_be9cea' },
	{ op = 'wait', frames = 2 },
	{ op = 'call', fn = 'code_be9956' },
	{ op = 'call', fn = 'code_be9937' },
	{ op = 'call', fn = 'code_b6a856' },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait_grounded' }, -- Op83(CODE_BE84DA)
	{ op = 'call', fn = 'code_be9945' },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait', frames = 5 },
	{ op = 'wait_grounded' }, -- Op83(CODE_BE84DA)
	{ op = 'call', fn = 'code_be993e' },
	{ op = 'wait', frames = 6 },
	{ op = 'wait_grounded' }, -- Op83(CODE_BE84DA)
	{ op = 'call', fn = 'code_be994c' },
	{ op = 'wait', frames = 28 },
	{ op = 'call', fn = 'code_b6a868' },
	{ op = 'wait', frames = 6 },
	{ op = 'wait', frames = 6 },
	{ op = 'wait', frames = 6 },
	{ op = 'loop' }, -- DATA_BE98B1 scratch loop (no additional gameplay-side state writes needed)
}

-- DATA_BEA6A9: DK jump script (direct OpXX/Op81/Op83/Op84/Op80 flow).
local data_bea6a9 = {
	{ op = 'call', fn = 'code_beb233' },
	{ op = 'wait', frames = 2 },
	{ op = 'call', fn = 'code_bea7d6' },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'call', fn = 'code_beb23c' },
	{ op = 'gate', fn = 'code_be851b_gate' },
	{ op = 'call', fn = 'code_bea765' },
	{ op = 'hook', fn = 'code_bea755' },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 2 },
	{ op = 'wait', frames = 3 },
	{ op = 'wait', frames = 4 },
	{ op = 'gate', fn = 'code_be84da_gate' },
	{ op = 'call', fn = 'code_bea737' },
	{ op = 'hook', fn = nil },
	{ op = 'call', fn = 'code_bea715' },
	{ op = 'call', fn = 'code_bea724' },
	{ op = 'wait', frames = 4 },
	{ op = 'wait', frames = 3 },
	{ op = 'wait', frames = 3 },
	{ op = 'call', fn = 'code_bea778' },
	{ op = 'loop' },
}

-- ============================================================================
-- helper functions
-- ============================================================================

local function to_signed_16(value)
	if value >= 0x8000 then
		return value - 0x10000
	end
	return value
end

local function to_unsigned_16(value)
	return value & 0xffff
end

local function abs_16(value)
	local signed = to_signed_16(value)
	if signed < 0 then
		return -signed
	end
	return signed
end

local function cmp_bpl_16(a, imm)
	return (((a - imm) & 0x8000) == 0)
end

local function visual_frame_cycle(frames, phase)
	local count = #frames
	local idx = (phase % count) + 1
	return frames[idx]
end

-- $32 is level-context state in DKC1 and is initialized by level setup routines
-- (e.g. CODE_B9859E: STZ.b $32 for jungle). Keep player-side reads synced from level data.
local function read_level_state32(level)
	return level.dkc1_state32 & 0xFFFF
end

local data_8081e5 = {
	'code_80827b',
	'code_809713',
}

local data_81d102 = {
	0x0001,0x0009,0x0032,0x0022,0x0032,0x0022,0x0062,0x0059,
	0x0042,0x000A,0x0051,0x000A,0x0011,0x0041,0x0042,0x0012,
	0x005A,0x0232,0x0049,0x0156,0x0015,0x005A,0x0041,0x0001,
	0x0009,0x0002,0x0022,0x0022,0x0232,0x0052,0x0032,0x0032,
	0x0032,0x0022,0x0041,0x000A,0x0001,0x0042,0x004A,0x0001,
	0x0002,0x004A,0x0042,0x0001,0x0002,0x0052,0x0001,0x0001,
	0x0001,0x0011,0x0032,0x0232,0x0001,0x0842,0x0011,0x0232,
	0x0002,0x0002,0x0002,0x0002,0x0012,0x0012,0x0041,0x0042,
	0x0041,0x0001,0x0041,0x0041,0x0042,0x0002,0x0222,0x0022,
	0x0222,0x0232,0x0222,0x0222,0x0022,0x0222,0x0022,0x0062,
	0x0222,0x0042,0x0222,0x0022,0x0802,0x0222,0x0022,0x0022,
	0x0042,0x0042,0x0232,0x0032,0x0022,0x0222,0x0022,0x0042,
	0x0222,0x0022,0x0A02,0x0222,0x0222,0x0802,0x0222,0x0022,
	0x0002,0x0222,0x0222,0x0022,0x0402,0x0201,0x0042,0x0012,
	0x0012,0x0052,0x0052,0x0052,0x0052,0x0052,0x0002,0x0002,
	0x005A,0x005A,0x004A,0x004A,0x004A,0x000A,0x000A,0x000A,
	0x0052,0x0052,0x0012,0x0012,0x0012,0x0012,0x0002,0x0002,
	0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0042,
	0x0042,0x0042,0x0002,0x0002,0x0002,0x0002,0x0002,0x0022,
	0x0022,0x0062,0x0022,0x0222,0x0222,0x0022,0x0022,0x0022,
	0x0022,0x0222,0x0222,0x0022,0x0001,0x0001,0x0402,0x0041,
	0x0042,0x0002,0x0002,0x0202,0x0042,0x0042,0x0042,0x0042,
	0x0042,0x0042,0x0042,0x0222,0x0022,0x0002,0x0002,0x0022,
	0x0022,0x0222,0x0002,0x0002,0x0002,0x0802,0x0022,0x0041,
	0x0042,0x0136,0x0116,0x0136,0x0116,0x0022,0x0222,0x0202,
	0x0202,0x000A,0x0022,0x0202,0x0802,0x0812,0x0041,0x0042,
	0x0001,0x0002,0x0402,0x0402,0x0022,0x0222,0x0042,0x0022,
	0x0042,0x0041,0x0042,0x0002,0x0022,0x0002,0x0041,0x0042,
	0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,
	0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,
	0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,
	0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,0x0002,
}

local data_bcba67 = {
	0x01,0xEA,0x01,0x0C,0xEE,0xEA,0xBF,0xF4,0x17,0x17,0xFA,0xE0,0x31,0x31,0xF5,0x31,
	0x31,0xFB,0x42,0xEF,0xE1,0xA4,0xA4,0xF9,0xA4,0xA4,0xD0,0x43,0xFF,0x0D,0x0D,0xF3,
	0xDE,0x14,0x14,0xFC,0x14,0x14,0xF6,0x14,0xF6,0xCE,0x18,0x18,0xFD,0x18,0x18,0x22,
	0x22,0x22,0xF1,0x22,0x22,0x27,0x27,0xF7,0x41,0x0A,0xF8,0x36,0x36,0xFE,0x2B,0x2B,
	0x2B,0xF2,0x2B,0x2B,0xE4,0x00,
}

local data_bcbaba = {
	0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x16,0x01,0x0A,0x01,0x0C,0x0D,0x16,0x0C,
	0x07,0x11,0x12,0x14,0x14,0x07,0x16,0x17,0x18,0x17,0x1A,0x1B,0x1C,0x0D,0x1E,0x1F,
	0x20,0x21,0x22,0x18,0x24,0x16,0x01,0x27,0x24,0x12,0x22,0x2B,0x2B,0x0A,0x2E,0x2F,
	0x30,0x31,0x32,0x33,0x34,0x42,0x36,0x37,0x2E,0x2F,0x30,0x27,0x31,0x36,0x3E,0x3E,
	0x40,0x41,0x42,0x43,0x40,0x41,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F,
	0x50,0xD9,0x52,0x53,0xA4,0x55,0x56,0x57,0x42,0x43,0x5A,0x5B,0x5C,0x5D,0x5E,0x16,
	0x60,0x61,0x6D,0x63,0x64,0xA5,0x66,0x67,0x68,0x69,0x6A,0x6B,0x6C,0x6D,0x16,0x0C,
	0x0C,0x0D,0x0D,0x0D,0x0D,0x0D,0x17,0x17,0x07,0x07,0x12,0x12,0x12,0x18,0x18,0x18,
	0x0A,0x0A,0x31,0x31,0x36,0x36,0x2B,0x2B,0x2F,0x2F,0x2F,0x30,0x27,0x27,0x27,0x40,
	0x40,0x40,0x41,0x41,0x24,0x24,0x24,0x97,0x98,0x99,0x9A,0x9B,0x9C,0x9D,0x9E,0x9F,
	0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA7,0xA4,0xA5,0x6D,0xA7,0xA7,0x42,0x42,
	0x42,0x43,0x43,0xB3,0xB4,0xA4,0xA4,0xB7,0xB8,0xB9,0xA5,0xA5,0xA5,0x2F,0xBE,0xBF,
	0xBF,0xC1,0x14,0xC3,0x14,0xC5,0xC6,0x6D,0x6D,0x01,0xCA,0x6D,0x2E,0x31,0xCE,0xCE,
	0xD0,0xD0,0xD2,0xD3,0xD4,0xD5,0xCE,0xD7,0xCE,0xD9,0xD9,0xD0,0xDC,0xD0,0xDE,0xDE,
	0xE0,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,0xE7,0xE8,0xE9,0xEA,0xEB,0xEC,0xED,0xEE,0xEF,
	0xF0,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFB,0xFC,0xFD,0xFE,0xFF,
}


local data_bcbef0 = {
0x0038, 0x0160, 0x0138, 0x0130, 0x6938, 0x0150, 0x6C38, 0x0150, 
0x6D38, 0x00B0, 0x6C38, 0x0150, 0x6940, 0x0050, 0x1B38, 0x00F0, 
0x1025, 0x00F4, 0x0600, 0x00B4, 0x033C, 0x004F, 0x1264, 0x0090, 
0x1770, 0x005A, 0x3840, 0x0140, 0x0018, 0x0168, 0x24C0, 0x018D, 
0x2E78, 0x01FF, 0x4000, 0x0020, 0x40B8, 0x012F, 0x7A40, 0x00B0, 
0x7148, 0x00CF, 0x2928, 0x011E, 0x0018, 0x0168, 0x63C0, 0x0044, 
0x8640, 0x00AF, 0x7750, 0x016F, 0x5D90, 0x002F, 0x5D88, 0x013F, 
0x5F9E, 0x004F, 0x47C8, 0x0148, 0x6090, 0x012F, 0x6190, 0x012F, 
0x5E00, 0x002F, 0x5D88, 0x0030, 0x0170, 0x6460, 0x99E5, 0x01A8, 
0x0248, 0x0047, 0x080C, 0x00D8, 0x0F37, 0x0186, 0x001D, 0x015A, 
0x1D68, 0x00E8, 0x5005, 0x01B8, 0x037C, 0x69DE, 0x3B28, 0x0094, 
0x5350, 0x0110, 0x1920, 0x015A, 0x0040, 0x00F0, 0x6BA8, 0x00CF, 
0x99A8, 0x0094, 0x34C8, 0x0050, 0x5B60, 0x0130, 0x5B60, 0x0050, 
0xAF40, 0x0030, 0x3040, 0x01FF, 0x6248, 0x004F, 0x9148, 0x0030, 
0x1D32, 0x0092, 0x805A, 0x013A, 0xABD2, 0x0120, 0x1A44, 0x0118, 
0x4860, 0x0170, 0x7640, 0x010A, 0x0028, 0x535F, 0x0192, 0x5B10, 
0x0238, 0x011F, 0x2FA0, 0x015F, 0x08A0, 0x0030, 0x3480, 0x002F, 
0x15A0, 0x012A, 0x40A0, 0x0130, 0xAF40, 0x0150, 0xB0C0, 0x002F, 
0xB340, 0x0050, 0x5E40, 0x0150, 0x0080, 0x0020, 0x0140, 0x0050, 
0xB0C0, 0x002F, 0xAF40, 0x0150, 0xC9A0, 0x002F, 0xC9A0, 0x002F, 
0xC9A0, 0x002F, 0xD882, 0x01FF, 0x0058, 0x014F, 0x0048, 0x002F, 
0x26CE, 0x01FF, 0x6680, 0x0020, 0x0048, 0x002F, 0x0048, 0x002F, 
0x1B60, 0x00F0, 0x4980, 0x0100, 0x5F90, 0x004F, 0x5F90, 0x012F, 
0x00E0, 0x0127, 0x8FE0, 0x0020, 0x00E0, 0x012F, 0x0088, 0x00AF, 
0x5938, 0x015F, 0x5938, 0x003F, 0x0420, 0x6B38, 0x5D80, 0x0020, 
0x5E38, 0x005F, 0x27A0, 0x01FF, 0x3A08, 0x0167, 0x3A30, 0x0027, 
0x0000, 0x0128, 0x3980, 0x0020, 0x4020, 0x0047, 0x3A30, 0x0027, 
0x9628, 0x0150, 0x0040, 0x63EF, 0x10E4, 0x01FF, 0x2938, 0x00E8, 
0x3464, 0x01FF, 0x5780, 0x01FF, 0x5004, 0x01FF, 0x5888, 0x01FF, 
0x5910, 0x01FF, 0x5C88, 0x00F8, 0x7720, 0x0138, 0x7A80, 0x00D8, 
0x2540, 0x00D4, 0x3ED0, 0x01FF, 0x5554, 0x01FF, 0x6528, 0x00EF, 
0x67C0, 0x0088, 0x86B0, 0x01FF, 0x9928, 0x01FF, 0xAE24, 0x01FF, 
0x21D0, 0x01FF, 0x2788, 0x01FF, 0x4AF0, 0x01FF, 0x4D10, 0x01FF, 
0x6510, 0x01FF, 0x8031, 0x0078, 0x3DA0, 0x01FF, 0x6AC8, 0x01FF, 
0x7F60, 0x01FF, 0x98C0, 0x01FF, 0x8060, 0x01FF, 0x9C50, 0x01FF, 
0x0FC8, 0x01FF, 0x24E0, 0x01FF, 0x3870, 0x01FF, 0x04B0, 0x01FF, 
0x0B50, 0x01FF, 0x20D0, 0x01FF, 0x51B0, 0x01FF, 0x56C0, 0x01FF, 
0x0370, 0x01FF, 0x1D68, 0x01FF, 0x2570, 0x01FF, 0x6C38, 0x0150, 
0x6C38, 0x0150, 0xAF40, 0x0030, 0x6C38, 0x0150, 0xAF40, 0x0150, 
0x4000, 0x0020, 0xC9B0, 0x002F, 0xC9B0, 0x002F, 0xC9B0, 0x002F, 
0xC9B0, 0x002F, 0xCAB8, 0x0050, 0xCAB8, 0x0050, 0x5948, 0x003F, 
0x0090, 0x006B, 0x0260, 0x0090, 0x02B0, 0x4FC8, 0x4400, 0x0047, 
0x56C0, 0x0100, 0x1140, 0x0074, 0x1560, 0x0138, 0x0150, 0x66EF, 
0x4C20, 0x01FF, 0x6260, 0x01FF, 0x0AF0, 0x01FF, 0x1230, 0x01FF, 
0x1750, 0x01FF, 0x3BB0, 0x01FF, 0x5256, 0x01FF, 0x2980, 0x0020, 
0x2A40, 0x002B, 0x0238, 0x01FF, 0x1A60, 0x01FF, 0x2C40, 0x012F, 
0x2C40, 0x012F, 0x2C40, 0x004F, 0x0AF0, 0x01FF, 0x12C0, 0x01FF, 
0x27A0, 0x01FF, 0x9760, 0x01FF, 0x5948, 0x003F, 0x0018, 0x4628, 
0x033C, 0x4978, 0x6C38, 0x0150, 0x7CD0, 0x01FF, 0x6CC0, 0x014F, 
0x8510, 0x01FF, 0x0660, 0x6E2F, 0x0450, 0x62AF, 0x0060, 0x65AF, 
0x0620, 0x63AF, 0x0920, 0x01FF, 0x06D0, 0x6E2F, 0x0568, 0x6950, 
0x44B8, 0x01FF, 0x53B0, 0x01FF, 0x2B50, 0x0109, 0x3ABC, 0x0120, 
0x3060, 0x008F, 0x3F40, 0x0128, 0x6BE0, 0x0187, 0xBEB0, 0x002F, 
0x5940, 0x004F, 0x4E40, 0x0145, 0x4B48, 0x01FF, 0x2A40, 0x002B, 
0x3070, 0x01FF, 0xCCA0, 0x004F, 0xD420, 0x0128, 0x5798, 0x01FF, 
0x2C40, 0x012F, 0x54F0, 0x01FF, 0x0030, 0x3F90, 0x0432, 0x427C, 
0x0030, 0x012F, 0x0130, 0x0033, 0x0030, 0x012F, 0x0130, 0x0033, 
0x0130, 0x0033, 0x0030, 0x012F
}


-- ============================================================================
-- player object
-- ============================================================================

function player:new(config)
	local instance = setmetatable({}, player)
	
	-- store config
	instance.level = config.level
	instance.player_index = config.player_index or 1
	instance.spawn_x = config.spawn_x
	instance.spawn_y = config.spawn_y
	instance.width = config.width or constants.player.width
	instance.height = config.height or constants.player.height
	
	-- initialize all ram variables as instance members
	player.ctor(instance, config)
	
	return instance
end

-- ctor is called by the engine's spawn_object → apply_definition → apply_ctor
-- receives (self, addons, def_id) where addons = {id, level, spawn_x, spawn_y, pos}
function player.ctor(self, addons)
	-- initialize all ram variables
	self.ram_1699 = 0
	self.ram_169d = 0
	self.ram_16a1 = 0
	self.ram_16a5 = 0
	self.ram_16a9 = 0
	self.ram_16ad = define_dkc1_animationid_dk_idle
	self.ram_16cd = 0
	self.ram_16c1 = 0
	self.ram_16c5 = 0
	self.ram_16d1 = 0
	self.ram_16d9 = 0
	self.ram_16dd = 0
	self.ram_16e9 = 0
	self.ram_16ed = 0
	self.ram_16e1 = 0
	self.ram_16e5 = 0
	self.ram_16d5 = 0
	self.ram_16f1 = 0
	self.ram_16f5 = 0
	self.ram_16f9 = 0xffb8
	self.ram_16fd = 0
	self.ram_180f = 0
	
	self.ram_xspeedlo = 0
	self.ram_yspeedlo = 0
	self.ram_xposlo = self.spawn_x
	self.ram_yposlo = self.spawn_y
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0000
	self.ram_ramtable12a5lo = 0x0001
	self.ram_ramtable1209lo = 0
	self.ram_ramtable123dlo = 0
	self.ram_ramtable1271lo = 0
	self.ram_ramtable1631lo = 0
	self.ram_ramtable11a1lo = 0
	self.ram_ramtable1595lo = 0
	self.ram_ramtable0f8dlo = 0
	self.ram_ramtable14c5lo = 0
	self.ram_yxppccctlo = 0
	self.ram_oamzposlo = 0x00E4
	
	self.zp_28 = 0
	self.zp_32 = read_level_state32(self.level)
	self.zp_44 = (self.player_index or 1) - 1
	self.zp_46 = 0
	self.zp_48 = 0
	self.zp_4c = 0
	self.zp_7e = 0
	self.zp_80 = 0
	self.ram_16e9 = 0
	self.ram_16ed = 0
	self.zp_84 = 0x0002
	self.zp_86 = 0
	self.zp_ba = 0
	-- set by startup init in DKC1 (CODE_8083FD: STX.b $F3, X=0006 in normal gameplay path)
	self.zp_f3 = 0x0006
	self.zp_9c = 0
	self.zp_9e = 0
	self.zp_9b = 0
	self.zp_92 = 0
	self.zp_76 = 0
	self.zp_94 = 0
	self.zp_96 = 0
	self.zp_98 = 0
	self.zp_9a_fn = 'code_818547'
	
	self.ram_0512 = 0
	self.ram_0514 = 0
	self.ram_0516 = 0
	self.ram_0518 = 0
	self.ram_1e15 = 0
	self.ram_1e25 = 0
	self.ram_1e3d = 0
	self.ram_1e23 = 0
	self.ram_1e17 = 0
	self.ram_1e19 = 0
	self.ram_0579 = 0
	self.ram_057d = 0
	self.ram_0583 = {}
	self.ram_0683 = 0
	self.ram_0559 = 0
	self.ram_055b = 0
	self.ram_0563 = 0
	self.ram_055f = 0
	self.ram_0561 = 0
	self.ram_0565 = 0
	self.ram_1a69 = 0
	self.ram_1ad1 = 0
	self.ram_1ad5 = 0
	self.ram_1ad7 = 0
	self.ram_1ad9 = 0
	self.ram_1adb = 0
	self.ram_1add = 0
	self.ram_1adf = 0
	self.ram_1ae1 = 0
	self.ram_1ae3 = 0
	self.ram_1ae5 = 0
	self.ram_1ae7 = 0
	self.ram_1ae9 = 0
	self.ram_1aeb = 0
	self.ram_1aed = 0
	self.ram_1aef = 0
	self.ram_1af1 = 0
	self.ram_1e35 = 0
	self.ram_1df5 = 0
	self.ram_1df7 = 0
	self.ram_1df9 = 0
	self.ram_1dfb = 0
	self.ram_1dfd = 0
	self.ram_1dff = 0
	self.zp_e1 = 0
	self.zp_e3 = 0
	self.zp_e5 = 0
	self.zp_e7 = 0
	self.zp_e9 = 0
	self.zp_eb = 0
	self.zp_ed = 0
	self.ram_register_mode7matrixparametera = 0
	self.ram_register_mode7matrixparameterc = 0
	self.ram_register_mode7centerx = 0
	self.ram_register_mode7centery = 0
	self.ram_0514 = 0
	self.ram_1e23 = 0
	self.ram_1929 = 0
	self.ram_1915 = 0
	self.ram_1917 = 0
	self.ram_1921 = 0
	self.ram_1927 = 0
	self.ram_1925 = 0
	self.ram_1afd = 0
	self.ram_1aff = 0
	self.ram_1b01 = 0
	self.ram_1b21 = 0
	self.ram_1b23 = 0
	self.ram_1b25 = 0
	self.ram_1b0f = 'code_81800d'
	self.ram_08ab = 0
	self.ram_db = 0
	self.ram_d3_words = {}
	self.ram_d7_bytes = {}
	self.ram_1e2b = 0
	self.ram_1e25 = 0
	self.ram_1e3d = 0
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
	self.ram_ramtable1375lo = 0
	self.ram_ramtable13e9lo = 0
	self.ram_ramtable145dlo = 0
	self.ram_ramtable1491lo = 0
	self.ram_ramtable152dlo = 0
	self.ram_ramtable15c9lo = 0
	self.ram_ramtable0db9lo = 0
	self.ram_ramtable0e21lo = 0
	self.ram_ramtable0ebdlo = 0
	self.ram_ramtable0fc1lo = 0
	self.ram_ramtable0ff5lo = 0
	self.ram_ramtable0c35lo = 0
	self.ram_displaycurrentposetimerlo = 0
	self.ram_animationscriptindexlo = 0
	self.ram_ramtable130dlo = 0
	self.ram_ramtable1341lo = 0
	self.ram_animation_speed = 0x0100
	self.ram_global_screendisplayregister = 0
	self.ram_global_entranceidlo = 0
	self.ram_fileselect_currentselectionlo = 0
	self.ram_sound_last = 0
	self.ram_global_cheatcodeflagslo = 0
	self.ram_player_currentkonglo = 0x0001
	self.ram_player_currentlifecountlo = self.ram_player_currentlifecountlo or 0x0005
	self.ram_player_displayedlifecountlo = self.ram_player_currentlifecountlo
	self.ram_player_collectedkongletterslo = 0
	self.ram_player_winkytokencount = 0
	self.ram_layer1yposlo = 0
	self.ram_layer1xposlo = 0
	self.ram_1811 = 0
	self.ram_1813 = 0
	self.ram_1815 = {}
	self.ram_1855 = {}
	self.ram_1895 = {}
	self.ram_18d5 = {}
	self.ram_16b9_slots = {}
	self.ram_16bd_slots = {}
	self.ram_1705 = {}
	for i = 1, 256 do
		self.ram_1705[i] = 0
	end
	self.ram_draworderindexlo = 0
	self.ram_currentoamzposlo = 0
	self.ram_draw_order_slots = {}
	self.ram_draw_order_z = {}
	for i = 1, 1500 do
		self.ram_draw_order_slots[i] = 0
		self.ram_draw_order_z[i] = 0
	end
	self.ram_draworderindexlo = 0
	self.ram_currentoamzposlo = 0
	self.ram_draw_order_slots = {}
	self.ram_draw_order_z = {}
	for i = 1, 1500 do
		self.ram_draw_order_slots[i] = 0
		self.ram_draw_order_z[i] = 0
	end
	self.ram_0683 = 0
	self.ram_palettes_loaded = {}
	self.ram_palette_upload_log = {}
	self.ram_7f36b5 = {}
	self.ram_7f36fd = {}
	self.ram_7f3745 = {}
	self.ram_7f378d = {}
	self.ram_7f37d5 = {}
	self.ram_norspr_spriteidlo = {}
	self.ram_norspr_ramtable1665lo = {}
	self.ram_slot_yxppccctlo = {}
	self.ram_norspr_yxppccctlo = {}
	self.ram_norspr_xposlo = {}
	self.ram_norspr_yposlo = {}
	self.ram_norspr_xspeedlo = {}
	self.ram_norspr_yspeedlo = {}
	self.ram_norspr_ramtable0f25lo = {}
	self.ram_norspr_ramtable1595lo = {}
	self.ram_norspr_ramtable15c9lo = {}
	self.ram_norspr_ramtable1029lo = {}
	self.ram_norspr_ramtable1271lo = {}
	self.ram_norspr_ramtable1631lo = {}
	self.ram_norspr_ramtable1375lo = {}
	self.ram_norspr_ramtable13e9lo = {}
	self.ram_norspr_ramtable145dlo = {}
	self.ram_norspr_ramtable0e55lo = {}
	self.ram_norspr_ramtable14c5lo = {}
	self.ram_norspr_ramtable1491lo = {}
	self.ram_norspr_ramtable152dlo = {}
	self.ram_norspr_ramtable11a1lo = {}
	self.ram_norspr_currentposelo = {}
	self.ram_norspr_animationspeedlo = {}
	self.ram_norspr_ramtable15fdlo = {}
	self.ram_norspr_displayedposelo = {}
	self.ram_norspr_oamzposlo = {}
	self.ram_1a6f = {}
	for i = 1, 0x12 do
		self.ram_7f36b5[i] = 0
		self.ram_7f36fd[i] = 0
		self.ram_7f3745[i] = 0
		self.ram_7f378d[i] = 0
		self.ram_7f37d5[i] = 0
	end
	for i = 1, 0x1A do
		self.ram_norspr_spriteidlo[i] = 0
		self.ram_norspr_ramtable1665lo[i] = 0
		self.ram_norspr_ramtable15fdlo[i] = 0
		self.ram_norspr_displayedposelo[i] = 0
		self.ram_slot_yxppccctlo[i] = 0
		self.ram_norspr_yxppccctlo[i] = 0
		self.ram_norspr_xposlo[i] = 0
		self.ram_norspr_yposlo[i] = 0
		self.ram_norspr_xspeedlo[i] = 0
		self.ram_norspr_yspeedlo[i] = 0
		self.ram_norspr_ramtable0f25lo[i] = 0
		self.ram_norspr_ramtable1595lo[i] = 0
		self.ram_norspr_ramtable15c9lo[i] = 0
		self.ram_norspr_ramtable1029lo[i] = 0
		self.ram_norspr_ramtable1271lo[i] = 0
		self.ram_norspr_ramtable1631lo[i] = 0
		self.ram_norspr_ramtable1375lo[i] = 0
		self.ram_norspr_ramtable13e9lo[i] = 0
		self.ram_norspr_ramtable145dlo[i] = 0
		self.ram_norspr_ramtable0e55lo[i] = 0
		self.ram_norspr_ramtable14c5lo[i] = 0
		self.ram_norspr_ramtable1491lo[i] = 0
		self.ram_norspr_ramtable152dlo[i] = 0
		self.ram_norspr_ramtable11a1lo[i] = 0
		self.ram_norspr_currentposelo[i] = 0
		self.ram_norspr_animationspeedlo[i] = 0
		self.ram_norspr_oamzposlo[i] = 0
	end
	for i = 1, 16 do
		self.ram_1a6f[i] = 0
	end
	self.ram_lowmem = {}
	for i = 1, 0x2000 do
		self.ram_lowmem[i] = 0
	end
	self.ram_player_currentbananacountlo = 0
	self.ram_player_displayedbananacountlo = 0
	self.ram_player_bananacountonesdigit = 0
	self.ram_player_bananacounthundredsdigit = 0
	self.zp_42 = 0
	self.zp_40 = 0
	self.zp_4a = 0x0200
	self.zp_f5 = 0
	self.reset_requested = false
	
	-- subpixel position
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	-- visual/gameplay state
	self.visual_frame_id = 'esther_dk_idle_01'
	self.pose_name = 'grounded'
	
	-- debug counters
	self.debug_frame = 0
	self.debug_time_ms = 0

	-- roll animation-script bridge (DATA_BE927E / DATA_BE9218 / DATA_BE91F5)
	self.roll_script_kind = nil
	self.roll_script_frame = 0
	self.jump_script_kind = nil
	self.jump_script_frame = 0
	self.jump_script_pc = 1
	self.jump_script_wait = 0
	self.jump_script_hook = nil
	self.death_script_kind = nil
	self.death_script_pc = 1
	self.death_script_wait = 0
	
	-- previous frame button state for edge detection
	self.prev_7e = 0

	self.ram_0508 = 0
	self.ram_050a = data_8081e5
	self.ram_050c = 0
	self.ram_0537 = 0
	self.ram_0539 = {}
	self.ram_1a2b = {}
	self.ram_7ef9fc = {}
	self.ram_7efafc = {}
	self.ram_7efbfc = {}
	self.ram_7efc00 = {}
	self.ram_7efbe6 = 0
	self.ram_7efbe7 = 0
	self.ram_7efbea = 0
	self.ram_7efbec = 0
	self.ram_7efbee = 0
	self.ram_7efbf0 = 0
	self.ram_7efbf2 = 0
	self.ram_7efbf4 = 0
	self.ram_7efbf6 = 0
	self.ram_7efbf8 = 0
	self.ram_7efbfa = 0
	self.ram_7effac = 0
	self.ram_7effc0 = 0
	self.ram_7efc50 = 0
	self.ram_7effd4 = 0
	self.ram_7efd08 = 0
	self.ram_save_wram_window = {}
	for i = 1, 0x2231 do
		self.ram_save_wram_window[i] = 0
	end
	self.ram_global_oamindexlo = 0
	self.ram_global_oambuffer = 0
	self.ram_upperoambuffer = {}
	for i = 1, 16 do
		self.ram_upperoambuffer[i] = 0
	end
	self.ram_global_oamindexlo = 0
	self.ram_global_oambuffer = 0
	self.ram_upperoambuffer = {}
	for i = 1, 16 do
		self.ram_upperoambuffer[i] = 0
	end
	for i = 1, 9 do
		self.ram_0539[i] = 0
		self.ram_1a2b[i] = 0
	end
	for i = 1, 256 do
		self.ram_0583[i] = 0
		self.ram_7ef9fc[i] = 0
		self.ram_7efafc[i] = 0
	end
	for i = 1, 4 do
		self.ram_7efbfc[i] = 0
	end
	for i = 1, 1024 do
		self.ram_7efc00[i] = 0
	end
	self:code_818c66_dummy()
end

function player:reset_runtime()
	self.ram_1699 = 0
	self.ram_169d = 0
	self.ram_16a5 = -0x7fffffff
	self.ram_16f9 = 0xffb8
	self.ram_16fd = 0
	self.ram_16d5 = 0
	self.ram_16c1 = 0
	self.ram_16c5 = 0
	self.ram_16d1 = 0
	self.ram_16d9 = 0
	self.ram_180f = 0
	
	self.ram_xspeedlo = 0
	self.ram_yspeedlo = 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0000
	self.ram_ramtable12a5lo = 0x0001
	self.ram_ramtable0f8dlo = 0
	self.ram_ramtable14c5lo = 0
	self.ram_ramtable11a1lo = 0
	self.ram_ramtable1595lo = 0
	self.ram_0579 = 0
	self.ram_057d = 0
	self.ram_0583 = {}
	self.ram_1929 = 0
	self.ram_1915 = 0
	self.ram_1917 = 0
	self.ram_1921 = 0
	self.ram_1927 = 0
	self.ram_1925 = 0
	self.ram_1afd = 0
	self.ram_1aff = 0
	self.ram_1b01 = 0
	self.ram_1b21 = 0
	self.ram_1b23 = 0
	self.ram_1b25 = 0
	self.ram_1b0f = 'code_81800d'
	self.ram_08ab = 0
	self.ram_db = 0
	self.ram_d3_words = {}
	self.ram_d7_bytes = {}
	self.ram_1e2b = 0
	self.ram_1df5 = 0
	self.ram_1df7 = 0
	self.ram_1df9 = 0
	self.ram_1dfb = 0
	self.ram_1dfd = 0
	self.ram_1dff = 0
	self.zp_e1 = 0
	self.zp_e3 = 0
	self.zp_e5 = 0
	self.zp_e7 = 0
	self.zp_e9 = 0
	self.zp_eb = 0
	self.zp_ed = 0
	self.ram_register_mode7matrixparametera = 0
	self.ram_register_mode7matrixparameterc = 0
	self.ram_register_mode7centerx = 0
	self.ram_register_mode7centery = 0
	self.ram_0559 = 0
	self.ram_055b = 0
	self.ram_0563 = 0
	self.ram_055f = 0
	self.ram_0561 = 0
	self.ram_0565 = 0
	self.ram_1a69 = 0
	self.ram_1ad1 = 0
	self.ram_1ad5 = 0
	self.ram_1ad7 = 0
	self.ram_1ad9 = 0
	self.ram_1adb = 0
	self.ram_1add = 0
	self.ram_1adf = 0
	self.ram_1ae1 = 0
	self.ram_1ae3 = 0
	self.ram_1ae5 = 0
	self.ram_1ae7 = 0
	self.ram_1ae9 = 0
	self.ram_1aeb = 0
	self.ram_1aed = 0
	self.ram_1aef = 0
	self.ram_1af1 = 0
	self.ram_1e35 = 0
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
	self.ram_oamzposlo = 0x00E4
	self.ram_ramtable1375lo = 0
	self.ram_ramtable13e9lo = 0
	self.ram_ramtable145dlo = 0
	self.ram_ramtable1491lo = 0
	self.ram_ramtable152dlo = 0
	self.ram_ramtable15c9lo = 0
	self.ram_ramtable0db9lo = 0
	self.ram_ramtable0e21lo = 0
	self.ram_ramtable0ebdlo = 0
	self.ram_ramtable0fc1lo = 0
	self.ram_ramtable0ff5lo = 0
	self.ram_displaycurrentposetimerlo = 0
	self.ram_animationscriptindexlo = 0
	self.ram_ramtable130dlo = 0
	self.ram_ramtable1341lo = 0
	self.ram_animation_speed = 0x0100
	self.ram_global_screendisplayregister = 0
	self.ram_global_entranceidlo = 0
	self.ram_fileselect_currentselectionlo = 0
	self.ram_sound_last = 0
	self.ram_global_cheatcodeflagslo = 0
	self.ram_player_currentkonglo = 0x0001
	self.ram_player_winkytokencount = 0
	self.ram_player_collectedkongletterslo = 0
	self.ram_layer1yposlo = 0
	self.ram_layer1xposlo = 0
	self.ram_1811 = 0
	self.ram_1813 = 0
	self.ram_1815 = {}
	self.ram_1855 = {}
	self.ram_1895 = {}
	self.ram_18d5 = {}
	self.ram_16b9_slots = {}
	self.ram_16bd_slots = {}
	self.ram_1705 = {}
	for i = 1, 256 do
		self.ram_1705[i] = 0
	end
	self.ram_palettes_loaded = {}
	self.ram_palette_upload_log = {}
	self.ram_7f36b5 = {}
	self.ram_7f36fd = {}
	self.ram_7f3745 = {}
	self.ram_7f378d = {}
	self.ram_7f37d5 = {}
	self.ram_norspr_spriteidlo = {}
	self.ram_norspr_ramtable1665lo = {}
	self.ram_slot_yxppccctlo = {}
	self.ram_norspr_yxppccctlo = {}
	self.ram_norspr_xposlo = {}
	self.ram_norspr_yposlo = {}
	self.ram_norspr_xspeedlo = {}
	self.ram_norspr_yspeedlo = {}
	self.ram_norspr_ramtable0f25lo = {}
	self.ram_norspr_ramtable1595lo = {}
	self.ram_norspr_ramtable15c9lo = {}
	self.ram_norspr_ramtable1029lo = {}
	self.ram_norspr_ramtable1271lo = {}
	self.ram_norspr_ramtable1631lo = {}
	self.ram_norspr_ramtable1375lo = {}
	self.ram_norspr_ramtable13e9lo = {}
	self.ram_norspr_ramtable145dlo = {}
	self.ram_norspr_ramtable0e55lo = {}
	self.ram_norspr_ramtable14c5lo = {}
	self.ram_norspr_ramtable1491lo = {}
	self.ram_norspr_ramtable152dlo = {}
	self.ram_norspr_ramtable11a1lo = {}
	self.ram_norspr_currentposelo = {}
	self.ram_norspr_animationspeedlo = {}
	self.ram_norspr_ramtable15fdlo = {}
	self.ram_norspr_displayedposelo = {}
	self.ram_norspr_oamzposlo = {}
	self.ram_1a6f = {}
	for i = 1, 0x12 do
		self.ram_7f36b5[i] = 0
		self.ram_7f36fd[i] = 0
		self.ram_7f3745[i] = 0
		self.ram_7f378d[i] = 0
		self.ram_7f37d5[i] = 0
	end
	for i = 1, 0x1A do
		self.ram_norspr_spriteidlo[i] = 0
		self.ram_norspr_ramtable1665lo[i] = 0
		self.ram_norspr_ramtable15fdlo[i] = 0
		self.ram_norspr_displayedposelo[i] = 0
		self.ram_slot_yxppccctlo[i] = 0
		self.ram_norspr_yxppccctlo[i] = 0
		self.ram_norspr_xposlo[i] = 0
		self.ram_norspr_yposlo[i] = 0
		self.ram_norspr_xspeedlo[i] = 0
		self.ram_norspr_yspeedlo[i] = 0
		self.ram_norspr_ramtable0f25lo[i] = 0
		self.ram_norspr_ramtable1595lo[i] = 0
		self.ram_norspr_ramtable15c9lo[i] = 0
		self.ram_norspr_ramtable1029lo[i] = 0
		self.ram_norspr_ramtable1271lo[i] = 0
		self.ram_norspr_ramtable1631lo[i] = 0
		self.ram_norspr_ramtable1375lo[i] = 0
		self.ram_norspr_ramtable13e9lo[i] = 0
		self.ram_norspr_ramtable145dlo[i] = 0
		self.ram_norspr_ramtable0e55lo[i] = 0
		self.ram_norspr_ramtable14c5lo[i] = 0
		self.ram_norspr_ramtable1491lo[i] = 0
		self.ram_norspr_ramtable152dlo[i] = 0
		self.ram_norspr_ramtable11a1lo[i] = 0
		self.ram_norspr_currentposelo[i] = 0
		self.ram_norspr_animationspeedlo[i] = 0
		self.ram_norspr_oamzposlo[i] = 0
	end
	for i = 1, 16 do
		self.ram_1a6f[i] = 0
	end
	self.ram_lowmem = {}
	for i = 1, 0x2000 do
		self.ram_lowmem[i] = 0
	end
	self.ram_player_currentbananacountlo = 0
	self.ram_player_displayedbananacountlo = 0
	self.ram_player_bananacountonesdigit = 0
	self.ram_player_bananacounthundredsdigit = 0
	self.zp_42 = 0
	self.zp_46 = 0
	self.zp_48 = 0
	self.zp_40 = 0
	self.zp_4a = 0x0200
	self.zp_f5 = 0
	self.reset_requested = false
	
	self.ram_xposlo = self.spawn_x
	self.ram_yposlo = self.spawn_y
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	self.zp_28 = 0
	self.zp_32 = read_level_state32(self.level)
	self.zp_7e = 0
	self.zp_80 = 0
	self.zp_84 = 0x0002
	self.zp_86 = 0
	self.zp_ba = 0
	self.zp_9c = 0
	self.zp_9e = 0
	self.zp_9b = 0
	self.zp_92 = 0
	self.zp_76 = 0
	self.zp_94 = 0
	self.zp_96 = 0
	self.zp_98 = 0
	self.zp_9a_fn = 'code_818547'
	
	self.facing = 1
	self.grounded = true
	self.x = self.ram_xposlo
	self.y = self.ram_yposlo
	
	self.draw_scale_x = 1.0
	self.draw_scale_y = 1.0
	self.roll_visual = 0
	
	self.debug_frame = 0
	self.debug_time_ms = 0
	self.roll_script_kind = nil
	self.roll_script_frame = 0
	self.jump_script_kind = nil
	self.jump_script_frame = 0
	self.jump_script_pc = 1
	self.jump_script_wait = 0
	self.jump_script_hook = nil
	self.death_script_kind = nil
	self.death_script_pc = 1
	self.death_script_wait = 0
	self.prev_7e = 0

	self.ram_0508 = 0
	self.ram_050a = data_8081e5
	self.ram_050c = 0
	self.ram_0537 = 0
	self.ram_0539 = {}
	self.ram_1a2b = {}
	self.ram_7ef9fc = {}
	self.ram_7efafc = {}
	self.ram_7efbfc = {}
	self.ram_7efc00 = {}
	self.ram_7efbe6 = 0
	self.ram_7efbe7 = 0
	self.ram_7efbea = 0
	self.ram_7efbec = 0
	self.ram_7efbee = 0
	self.ram_7efbf0 = 0
	self.ram_7efbf2 = 0
	self.ram_7efbf4 = 0
	self.ram_7efbf6 = 0
	self.ram_7efbf8 = 0
	self.ram_7efbfa = 0
	self.ram_7effac = 0
	self.ram_7effc0 = 0
	self.ram_7efc50 = 0
	self.ram_7effd4 = 0
	self.ram_7efd08 = 0
	self.ram_save_wram_window = {}
	for i = 1, 0x2231 do
		self.ram_save_wram_window[i] = 0
	end
	for i = 1, 9 do
		self.ram_0539[i] = 0
		self.ram_1a2b[i] = 0
	end
	for i = 1, 256 do
		self.ram_0583[i] = 0
		self.ram_7ef9fc[i] = 0
		self.ram_7efafc[i] = 0
	end
	for i = 1, 4 do
		self.ram_7efbfc[i] = 0
	end
	for i = 1, 1024 do
		self.ram_7efc00[i] = 0
	end
	self:code_818c66_dummy()
end

function player:code_818c66_dummy()
	local ctx = self.level.dkc1_asm_collision
	self.ram_d3_words = ctx.d3_words
	self.ram_d7_bytes = ctx.d7_bytes
	self.ram_db = ctx.db & 0xFFFF
	self.ram_1b0f = ctx.dispatch_label
end

-- ============================================================================
-- data tables (assembly jump tables)
-- ============================================================================

-- data_bfb255: profile divisor functions (line 110688)
function player:data_bfb255_profile(profile_id, value)
	if profile_id == 0 then return value >> 3 end      -- code_bfb278: ÷8
	if profile_id == 1 then return value >> 4 end      -- code_bfb277: ÷16
	if profile_id == 2 then return value >> 5 end      -- code_bfb276: ÷32
	if profile_id == 3 then return value >> 6 end      -- code_bfb275: ÷64
	if profile_id == 4 then return value >> 7 end      -- code_bfb274: ÷128
	if profile_id == 5 then return value >> 8 end      -- code_bfb273: ÷256
	if profile_id == 6 then return value >> 2 end      -- code_bfb279: ÷4
	if profile_id == 7 then return value >> 1 end      -- code_bfb27a: ÷2
	if profile_id == 8 then                            -- code_bfb267: ÷32 + ÷64
		local temp = value >> 5
		local temp2 = value >> 6
		return temp + temp2
	end
	return 0
end

-- ============================================================================
-- code routines (direct assembly translation)
-- ============================================================================

-- code_bfb159: profile selection logic (line 110537)
function player:code_bfb159()
	-- lda.b $32                                    ; LINE 110537: LDA.b $32
	local state = self.zp_32
	
	-- cmp.w #$0004                                 ; LINE 110540: CMP.w #$0004
	-- beq.b code_bfb167                            ; LINE 110542: BEQ.b CODE_BFB167
	-- cmp.w #$0009                                 ; LINE 110544: CMP.w #$0009
	if state == 0x0004 or state == 0x0009 then
		-- code_bfb167: grounded state detected
		-- lda.w !ram_dkc1_norspr_ramtable12a5lo,y      ; LINE 110550: LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,y
		-- and.w #$0001                                 ; LINE 110553: AND.w #$0001
		-- beq.b code_bfb187                            ; LINE 110555: BEQ.b CODE_BFB187
		if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
			-- ldy.b $84                                ; LINE 110557: LDY.b $84
			-- lda.w $1699,y                             ; LINE 110561: LDA.w $1699,y
			-- and.w #$0004                              ; LINE 110564: AND.w #$0004
			-- beq.b code_bfb180                         ; LINE 110566: BEQ.b CODE_BFB180
			if (self.ram_1699 & 0x0004) ~= 0 then
				-- code_bfb17e: running
				-- lda.w #$0008                         ; LINE 110568: LDA.w #$0008
				return 8  -- profile 8 (÷21.33)
			else
				-- code_bfb180: walking
				-- lda.w #$0003                         ; LINE 110574: LDA.w #$0003
				return 3  -- profile 3 (÷64)
			end
		end
	end
	
	-- code_bfb187: default (airborne/roll)
	-- lda.w #$0000                                 ; LINE 110582: LDA.w #$0000
	return 0  -- profile 0 (÷8)
end

-- CODE_BFB1A8 + DATA_BFB255: target-speed smoothing step.
function player:code_bfb1a8()
	local profile_id = self:code_bfb159()
	self:code_bfb191(profile_id)
	if self.ram_ramtable1029lo ~= 0x0012 then
		self.ram_16f1 = abs_16(self.ram_xspeedlo)
	end
end

-- CODE_BFB18C / CODE_BFB191: target-speed smoothing using explicit profile id.
function player:code_bfb18c()
	self:code_bfb191(self.ram_ramtable11d5lo & 0xFFFF)
end

function player:code_bfb191(profile_id)
	local target = self.ram_ramtable0f25lo
	local target_with_acc = to_unsigned_16(target + self.ram_ramtable123dlo)

	local target_signed = to_signed_16(target_with_acc)
	local current_signed = to_signed_16(self.ram_xspeedlo)
	local delta = target_signed - current_signed
	local abs_delta = delta
	if abs_delta < 0 then
		abs_delta = -abs_delta
	end

	local step = self:data_bfb255_profile(profile_id, abs_delta)
	if step == 0 then
		current_signed = target_signed
	else
		if delta < 0 then
			step = -step
		end
		current_signed = current_signed + step
	end

	self.ram_xspeedlo = to_unsigned_16(current_signed)
end

-- code_bfa555: accumulator post-step hook (line 108861)
function player:code_bfa555()
	-- jsr.w code_bfa575 / bcs.b code_bfa55b
	if not self:code_bfa575() then
		return
	end

	-- code_bfa55b:
	-- ldy.b $84 / lda.w $16ad,y / cmp.w #!Define_DKC1_AnimationID_DK_Roll
	if self.ram_16ad == define_dkc1_animationid_dk_roll then
		return
	end
	-- lda.w $16f5,y / bne.b code_bfa574
	if self.ram_16f5 ~= 0 then
		return
	end
	-- stz.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	self.ram_ramtable1029lo = 0
	-- lda.w #!Define_DKC1_AnimationID_DK_Fall
	self.ram_16ad = define_dkc1_animationid_dk_fall
end

-- code_bfa575: accumulator population entry (line 108880)
function player:code_bfa575()
	-- lda.w !ram_dkc1_norspr_ramtable12a5lo,x
	-- and.w #$1001
	-- cmp.w #$0001
	local flags = self.ram_ramtable12a5lo & 0x1001
	if flags ~= 0x0001 then
		-- code_bfa582:
		self.ram_ramtable123dlo = 0
		return false
	end

	-- code_bfa587:
	-- lda.b $32
	-- cmp.w #$0004
	-- beq.b code_bfa5de
	-- cmp.w #$0009
	-- beq.b code_bfa5de
	if self.zp_32 == 0x0004 or self.zp_32 == 0x0009 then
		return self:code_bfa5de()
	end

	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0007
	-- cmp.b $f3
	-- bpl.b code_bfa59f
	local anim_idx = self.ram_ramtable1209lo & 0x0007
	if anim_idx < self.zp_f3 then
		self.ram_ramtable123dlo = 0
		return false
	end
	return self:code_bfa59f()
end

-- code_bfa59f / code_bfa5bb: direction-change boost (line 108902)
function player:code_bfa59f()
	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0080
	-- bne.b code_bfa5bb
	if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
		-- code_bfa5bb:
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- bmi.b code_bfa5cd
		if to_signed_16(self.ram_ramtable0f25lo) < 0 then
			return false
		end
		-- lda.w !ram_dkc1_norspr_xspeedlo,x
		-- bmi.b code_bfa5cd
		if to_signed_16(self.ram_xspeedlo) < 0 then
			return false
		end
		-- lda.w #$0180
		self.ram_ramtable123dlo = 0x0180
		return true
	end

	-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
	-- dec
	-- bpl.b code_bfa5cd
	if (to_signed_16(self.ram_ramtable0f25lo) - 1) >= 0 then
		return false
	end
	-- lda.w !ram_dkc1_norspr_xspeedlo,x
	-- dec
	-- bpl.b code_bfa5cd
	if (to_signed_16(self.ram_xspeedlo) - 1) >= 0 then
		return false
	end
	-- lda.w #$fe80
	self.ram_ramtable123dlo = 0xFE80
	return true
end

-- code_bfa5de: grounded animation boost (line 108935)
function player:code_bfa5de()
	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0007
	local anim_idx = self.ram_ramtable1209lo & 0x0007
	-- cmp.b $f3
	-- beq.b code_bfa60c
	if anim_idx == self.zp_f3 then
		return self:code_bfa60c()
	end

	local boost_table = {0x0000, 0x0080, 0x0100, 0x0180, 0x01F0, 0x0280, 0x0400}
	local boost = boost_table[anim_idx + 1]

	-- bit.w !ram_dkc1_norspr_ramtable1209lo-$01,x
	-- bmi.b code_bfa5f9
	-- (-$01 misalignment makes BMI observe bit 7 of low byte => 0x0080)
	if (self.ram_ramtable1209lo & 0x0080) == 0 then
		boost = ((-boost) & 0xFFFF)
	end

	-- code_bfa5f9:
	self.ram_ramtable123dlo = boost
	return false
end

-- code_bfa60c: special grounded direction-change boost (line 108980)
function player:code_bfa60c()
	-- bit.w !ram_dkc1_norspr_ramtable1209lo-$01,x
	-- bmi.b code_bfa625
	-- (-$01 misalignment makes BMI observe bit 7 of low byte => 0x0080)
	if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
		-- code_bfa625:
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- bmi.b code_bfa637
		if to_signed_16(self.ram_ramtable0f25lo) < 0 then
			return false
		end
		-- lda.w !ram_dkc1_norspr_xspeedlo,x
		-- bmi.b code_bfa637
		if to_signed_16(self.ram_xspeedlo) < 0 then
			return false
		end
		-- lda.w #$0500
		self.ram_ramtable123dlo = 0x0500
		return true
	end

	-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
	-- dec
	-- bpl.b code_bfa637
	if (to_signed_16(self.ram_ramtable0f25lo) - 1) >= 0 then
		return false
	end
	-- lda.w !ram_dkc1_norspr_xspeedlo,x
	-- dec
	-- bpl.b code_bfa637
	if (to_signed_16(self.ram_xspeedlo) - 1) >= 0 then
		return false
	end
	-- lda.w #$fb00
	self.ram_ramtable123dlo = 0xFB00
	return true
end

-- code_bfb538: get run speed (line 111078)
function player:code_bfb538()
	if self.ram_0512 ~= 0 then
		local buddy = self:dkc1_get_any_sprite_by_slot(self.ram_0512)
		if buddy ~= nil then
			local sid = buddy.dkc1_sprite_id
			if sid == define_dkc1_norspr0a_expresso then
				return 0x0400
			end
			if sid == define_dkc1_norspr0b_winky then
				return 0x0300
			end
			return 0x0380
		end
	end
	
	-- code_bfb55d: normal player run speed            ; LINE 111116: CODE_BFB55D
	-- lda.w !ram_dkc1_norspr_ramtable1029lo,x      ; LINE 111116: LDA.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	-- cmp.w #$0027                                 ; LINE 111119: CMP.w #$0027
	if self.ram_ramtable1029lo == 0x0027 then
		-- lda.w #$0180                              ; LINE 111160: LDA.w #$0180
		return 0x0180  -- slower
	end
	
	-- lda.w #$0300                                 ; LINE 111116: LDA.w #$0300
	return 0x0300
end

-- code_bfb573: get walk speed (line 111141)
function player:code_bfb573()
	if self.ram_0512 ~= 0 then
		local buddy = self:dkc1_get_any_sprite_by_slot(self.ram_0512)
		if buddy ~= nil then
			local sid = buddy.dkc1_sprite_id
			if sid == define_dkc1_norspr0a_expresso then
				return 0x0300
			end
			if sid == define_dkc1_norspr0b_winky then
				return 0x0200
			end
			return 0x0200
		end
	end
	
	-- code_bfb598: normal player walk speed           ; LINE 111164: CODE_BFB598
	-- lda.w !ram_dkc1_norspr_ramtable1029lo,x      ; LINE 111164: LDA.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	-- cmp.w #$0027                                 ; LINE 111167: CMP.w #$0027
	if self.ram_ramtable1029lo == 0x0027 then
		-- lda.w #$0180                              ; LINE 111169: LDA.w #$0180
		return 0x0180
	end
	
	-- lda.w #$0200                                 ; LINE 111164: LDA.w #$0200
	return 0x0200
end

-- code_bfb503: apply diddy speed multiplier (line 111104)
function player:code_bfb503(base_speed)
	-- sta.b $4c
	self.zp_4c = base_speed
	
	if self.zp_84 == 0x0004 then
		local plus_eighth = self.zp_4c >> 3
		self.zp_4c = to_unsigned_16(self.zp_4c + plus_eighth)
	end

	return self.zp_4c
end

-- code_bfb4e3: get target speed (line 111058)
function player:code_bfb4e3()
	-- ldy.b $84                                    ; LINE 111058: LDY.b $84
	-- lda.b $7e                                    ; LINE 111060: LDA.b $7E
	-- and.w #$4000                                 ; LINE 111062: AND.w #$4000
	-- beq.b code_bfb522                            ; LINE 111064: BEQ.b CODE_BFB522
	if (self.zp_7e & joypad_y) ~= 0 then
		-- code_bfb4ec: run path
		-- lda.w $1699,y                             ; LINE 111073: LDA.w $1699,y
		-- ora.w #$0004                              ; LINE 111076: ORA.w #$0004
		-- sta.w $1699,y                             ; LINE 111078: STA.w $1699,y
		self.ram_1699 = self.ram_1699 | 0x0004
		
		-- store timestamps
		-- lda.w $16dd,y                             ; LINE 111084: LDA.w $16DD,y
		-- sta.w $16e1,y                             ; LINE 111087: STA.w $16E1,y
		self.ram_16e1 = self.ram_16dd
		-- lda.b $28                                 ; LINE 111089: LDA.b $28
		-- sta.w $16dd,y                             ; LINE 111091: STA.w $16DD,y
		self.ram_16dd = self.zp_28
		
		-- jsr.w code_bfb538                         ; LINE 111093: JSR.w CODE_BFB538
		local speed = self:code_bfb538()
		-- jmp.w code_bfb503                         ; LINE 111095: JMP.w CODE_BFB503
		return self:code_bfb503(speed)
	end
	
	-- code_bfb522: walk path                        ; LINE 111122: CODE_BFB522
	-- lda.w $1699,y                                ; LINE 111122: LDA.w $1699,y
	-- and.w #$0200                                 ; LINE 111125: AND.w #$0200
	-- bne.b code_bfb52d                            ; LINE 111127: BNE.b CODE_BFB52D
	if (self.ram_1699 & 0x0200) ~= 0 then
		-- code_bfb52d: forced run flag still set
		-- lda.w $1699,y                             ; LINE 111133: LDA.w $1699,y
		-- ora.w #$0004                              ; LINE 111136: ORA.w #$0004
		-- sta.w $1699,y                             ; LINE 111138: STA.w $1699,y
		self.ram_1699 = self.ram_1699 | 0x0004
		-- jsr.w code_bfb538                         ; LINE 111140: JSR.w CODE_BFB538
		local speed = self:code_bfb538()
		-- jmp.w code_bfb503                         ; LINE 111142: JMP.w CODE_BFB503
		return self:code_bfb503(speed)
	end
	
	-- clear run flag
	-- lda.w $1699,y                                ; LINE 111144: LDA.w $1699,y
	-- and.w #$fffb                                 ; LINE 111147: AND.w #$FFFB
	-- sta.w $1699,y                                ; LINE 111149: STA.w $1699,y
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- jsr.w code_bfb573                             ; LINE 111151: JSR.w CODE_BFB573
	local speed = self:code_bfb573()
	-- jmp.w code_bfb503                             ; LINE 111153: JMP.w CODE_BFB503
	return self:code_bfb503(speed)
end

-- code_bfb5b6: ground left handler (line 111222)
function player:code_bfb5b6()
	-- lda.w #$fe00
	self.ram_ramtable0f25lo = 0xfe00  -- -512 in 16-bit
	
	-- check for speed boost flag
	-- lda.w $1e15 / and.w #$0400
	if (self.ram_1e15 & 0x0400) ~= 0 then
		-- subtract extra
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- sec / sbc.w #$0100
		local val = to_signed_16(self.ram_ramtable0f25lo)
		val = val - 0x0100
		self.ram_ramtable0f25lo = to_unsigned_16(val)
	end
end

-- code_bfb5d1: fixed left target (line 111249)
function player:code_bfb5d1()
	self.ram_ramtable0f25lo = 0xFE00
end

-- code_bfb634: set facing-left flip flag (line 111292)
function player:code_bfb634()
	self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
end

-- code_bfb640: force left then continue into code_bfb64b (line 111304)
function player:code_bfb640()
	self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
	self:code_bfb64b()
end

-- code_bfb5da: conditional left dispatch (line 111252)
function player:code_bfb5da()
	-- BIT.w !RAM_DKC1_NorSpr_YXPPCCCTLo,x / BVC.b CODE_BFB5E2
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		return
	end
	self:code_bfb64b()
end

-- code_bfb5e4: left turn helper (line 111262)
function player:code_bfb5e4()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / LSR / BCC.b CODE_BFB5F7
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BMI.b CODE_BFB5F7
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return
		end
	end

	self:code_bfb634()

	local target_signed = to_signed_16(self.ram_ramtable0f25lo)
	if target_signed == 0 then
		if self.ram_16ad ~= define_dkc1_animationid_dk_endroll then
			self.ram_16f1 = 0xFE00
			self.ram_xspeedlo = 0xFE00
			self.ram_ramtable0f25lo = 0xFE00
		end
		return
	end

	if target_signed > 0 then
		self.ram_ramtable0f25lo = to_unsigned_16(-target_signed)
		return
	end

	local magnitude = -target_signed
	if magnitude < 0x0300 then
		magnitude = 0x0300
	end
	self.ram_ramtable0f25lo = to_unsigned_16(-magnitude)
end

-- code_bfb64b: left handler (line 111307)
function player:code_bfb64b()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable1631Lo,x / BMI.b CODE_BFB671
	if to_signed_16(self.ram_ramtable1631lo) >= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / AND.w #$1001 / CMP.w #$0001 / BNE.b CODE_BFB671
		if (self.ram_ramtable12a5lo & 0x1001) == 0x0001 then
			-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0080 / BEQ.b CODE_BFB671
			if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BPL.b CODE_BFB6B4
				local anim_idx = self.ram_ramtable1209lo & 0x0007
				if anim_idx >= self.zp_f3 then
					self.ram_ramtable0f25lo = 0
					return
				end
			end
		end
	end

	-- CODE_BFB671:
	if self.ram_16ad == define_dkc1_animationid_dk_holdjump
		or self.ram_16ad == define_dkc1_animationid_dk_jumpoffverticalrope
		or self.ram_16ad == define_dkc1_animationid_dk_jump
	then
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
	end

	-- LDA.w $180F / CMP.w #$0001 / BEQ.b CODE_BFB6A9
	if self.ram_180f ~= 0x0001 then
		-- LDY.b $84 / LDA.w $0512,y / BNE.b CODE_BFB6A9
		if self.ram_0512 == 0 then
			-- LDA.w $16F5,y / BNE.b CODE_BFB6A9
			if self.ram_16f5 == 0 then
				-- LDA.w #$FFFB / JSL.l CODE_BFB801 / BCS.b CODE_BFB6B8
				if self:code_bfb801(0xFFFB) then
					self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
					self:code_bfb7d0()
					return
				end
			end
		end
	end

	-- CODE_BFB6A9:
	local target = self:code_bfb4e3()
	target = ((-target) & 0xFFFF)
	self.ram_ramtable0f25lo = target
end

-- code_bfb6cd: ground right handler (line 111373)
function player:code_bfb6cd()
	-- lda.w #$0200
	self.ram_ramtable0f25lo = 0x0200
	
	-- speed boost check
	if (self.ram_1e15 & 0x0400) ~= 0 then
		local val = to_signed_16(self.ram_ramtable0f25lo)
		val = val + 0x0100
		self.ram_ramtable0f25lo = to_unsigned_16(val)
	end
end

-- code_bfb6e8: fixed right target (line 111398)
function player:code_bfb6e8()
	self.ram_ramtable0f25lo = 0x0200
end

-- code_bfb743: set facing-right flip clear (line 111543)
function player:code_bfb743()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
end

-- code_bfb74f: force right then continue into code_bfb75a (line 111556)
function player:code_bfb74f()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	self:code_bfb75a()
end

-- code_bfb6f1: conditional right dispatch (line 111409)
function player:code_bfb6f1()
	-- BIT.w !RAM_DKC1_NorSpr_YXPPCCCTLo,x / BVS.b CODE_BFB6F9
	if (self.ram_yxppccctlo & 0x4000) == 0 then
		return
	end
	self:code_bfb75a()
end

-- code_bfb6fb: right turn helper (line 111418)
function player:code_bfb6fb()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / LSR / BCC.b CODE_BFB70E
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BMI.b CODE_BFB70E
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return
		end
	end

	self:code_bfb743()

	local target_signed = to_signed_16(self.ram_ramtable0f25lo)
	if target_signed == 0 then
		if self.ram_16ad ~= define_dkc1_animationid_dk_endroll then
			self.ram_16f1 = 0x0200
			self.ram_xspeedlo = 0x0200
			self.ram_ramtable0f25lo = 0x0200
		end
		return
	end

	if target_signed < 0 then
		self.ram_ramtable0f25lo = to_unsigned_16(-target_signed)
		return
	end

	if target_signed < 0x0300 then
		target_signed = 0x0300
	end
	self.ram_ramtable0f25lo = to_unsigned_16(target_signed)
end

-- code_bfb75a: right handler (line 111450)
function player:code_bfb75a()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable1631Lo,x / BMI.b CODE_BFB780
	if to_signed_16(self.ram_ramtable1631lo) >= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / AND.w #$1001 / CMP.w #$0001 / BNE.b CODE_BFB780
		if (self.ram_ramtable12a5lo & 0x1001) == 0x0001 then
			-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0080 / BNE.b CODE_BFB780
			if (self.ram_ramtable1209lo & 0x0080) == 0 then
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BPL.b CODE_BFB7BF
				local anim_idx = self.ram_ramtable1209lo & 0x0007
				if anim_idx >= self.zp_f3 then
					self.ram_ramtable0f25lo = 0
					return
				end
			end
		end
	end

	-- CODE_BFB780:
	if self.ram_16ad == define_dkc1_animationid_dk_holdjump
		or self.ram_16ad == define_dkc1_animationid_dk_jumpoffverticalrope
		or self.ram_16ad == define_dkc1_animationid_dk_jump
	then
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	end

	-- LDA.w $180F / CMP.w #$0001 / BEQ.b CODE_BFB7B8
	if self.ram_180f ~= 0x0001 then
		-- LDY.b $84 / LDA.w $0512,y / BNE.b CODE_BFB7B8
		if self.ram_0512 == 0 then
			-- LDA.w $16F5,y / BNE.b CODE_BFB7B8
			if self.ram_16f5 == 0 then
				-- LDA.w #$0005 / JSL.l CODE_BFB801 / BCS.b CODE_BFB7C3
				if self:code_bfb801(0x0005) then
					self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
					self:code_bfb7d0()
					return
				end
			end
		end
	end

	-- CODE_BFB7B8:
	self.ram_ramtable0f25lo = self:code_bfb4e3()
end

-- code_bfba39: air neutral handler (line 111765)
function player:code_bfba39()
	-- rts  (does nothing - preserves target!)
	return
end

-- code_bfc192: neutral target clear (line 112759)
function player:code_bfc192()
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1271lo = self.ram_ramtable1271lo & 0xFFFE
end

-- code_bfc18a: dispatch entry (line 112751)
function player:code_bfc18a()
	self:code_bfc192()
end

-- code_bfb801: ledge check helper (line 111873)
function player:code_bfb801(_offset)
	self.zp_76 = _offset & 0xFFFF
	if (self.ram_ramtable12a5lo & 0x0001) == 0 then
		return false
	end
	if (self.ram_ramtable1209lo & 0x0007) >= self.zp_f3 then
		return false
	end
	local h = self:code_818003(to_unsigned_16(self.ram_xposlo + self.zp_76))
	local d = to_signed_16(h - self.ram_yposlo)
	if d < 0 then
		return false
	end
	if d < 0x0008 then
		return false
	end
	return true
end

-- code_bfac45: wall/ledge probe helper (line 109933)
function player:code_bfac45()
	if to_signed_16(self.ram_yspeedlo - 1) >= 0 then
		return false
	end
	local xs = self.ram_xspeedlo
	if to_signed_16(xs) < 0 then
		xs = to_unsigned_16(-to_signed_16(xs))
	end
	if xs >= 0x0110 then
		return false
	end
	if (self.ram_ramtable12a5lo & 0x1111) ~= 0x0101 then
		return false
	end
	local probe = 0x000F
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		probe = 0xFFF1
	end
	local h = self:code_818003(to_unsigned_16(self.ram_xposlo + probe))
	local d = to_signed_16(self.ram_yposlo - h)
	if d < 0 then
		return false
	end
	if d < 0x0030 then
		return false
	end
	return true
end

-- code_bf902b: roll wall helper (line 106277)
function player:code_bf902b()
	if not self:code_bfac45() then
		return
	end
	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
end

-- code_bfb7d0: wall push helper (line 111568)
function player:code_bfb7d0()
	-- dummied out in original disassembly (RTS)
end

-- code_bfbe39: pickup probe (line 112769)
function player:code_bfbe39()
	if (self.ram_ramtable12a5lo & 0x0001) == 0 then
		return false
	end
	if self.ram_16ad == define_dkc1_animationid_dk_throw then
		return false
	end
	self:code_bba4c8(0x0002)
	if not self:code_bba58d_any(0x0010) then
		return false
	end
	if self.zp_88 < 0x0006 then
		return false
	end

	self.ram_16f5 = self.zp_88
	local target = self:dkc1_get_any_sprite_by_slot(self.ram_16f5)
	target.dkc1_ramtable1595lo = 0x0010
	target.dkc1_ramtable1375lo = self.zp_84
	target.dkc1_ramtable13e9lo = 0x0000
	target.dkc1_ramtable145dlo = 0x0000
	local orient = (self.ram_yxppccctlo ~ target.dkc1_yxppccctlo) & 0xC000
	target.dkc1_yxppccctlo = (orient ~ target.dkc1_yxppccctlo) & 0xFFFF
	target.dkc1_oamzposlo = 0x00E0
	self.ram_oamzposlo = 0x00E4

	self.ram_ramtable0f25lo = 0x0000
	self.ram_ramtable1029lo = 0x0017
	self.ram_1699 = self.ram_1699 & 0xFF3F
	self:code_be80a4(define_dkc1_animationid_dk_pickup)
	return true
end

-- code_bfbed1: Y-press timestamp helper (line 112849)
function player:code_bfbed1()
	self.ram_169d = self.zp_28
	if (self.zp_80 & joypad_y) ~= 0 then
		self.ram_16a1 = self.zp_28
	end
end

-- code_bfbec5: clear $1699 bit $0010 (line 112362)
function player:code_bfbec5()
	self.ram_1699 = self.ram_1699 & 0xFFEF
end

-- code_bfbc53: animal-buddy Y handler (line 112033)
function player:code_bfbc53()
	return
end

-- code_bfbf5b: special state jump handler (line 113241)
function player:code_bfbf60()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable14C5Lo,x / CMP.w #$0020 / BPL
	if self.ram_ramtable14c5lo < 0x0020 then
		return
	end
	-- LDA.b $32 / CMP.w #$0003 / BEQ
	if self.zp_32 == 0x0003 then
		self.ram_ramtable1029lo = 0x002B
		self.ram_1929 = 0
		return
	end
	self.ram_ramtable1029lo = 0x0001
	self.ram_1929 = 0
end

function player:code_bfbf54()
	-- LDA.b $80 / AND.w #$8000 / BNE.b CODE_BFBF60
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self:code_bfbf60()
end

function player:code_bfbf5b()
	-- CODE_BFBF5B:
	-- LDA.b $80 / AND.w #$4000
	if (self.zp_80 & joypad_y) == 0 then
		return
	end
	self:code_bfbf60()
end

-- code_bfb8e5: buffered B press stamp (line 111597)
function player:code_bfb8e5()
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self.ram_16a5 = self.zp_28
end

-- code_bfb8f7_full: B BUTTON handler (CODE_BFB8F7, line 111605)
-- Called from inside code_bfb27c when B is HELD ($7E & Joypad_B)
-- This is the FULL translation including jump initiation (CODE_BFB94F)
function player:code_bfb8f7_full()
	-- LDA.b $80 / AND.w #$8000
	if (self.zp_80 & joypad_b) ~= 0 then
		-- CODE_BFB919
		self.ram_16a5 = self.zp_28
	else
		-- LDA.w $1699,y / ORA.w #$0001 / STA.w $1699,y
		self.ram_1699 = self.ram_1699 | 0x0001
		-- LDA.b $28 / SEC / SBC.w $16A5,y
		local frame_delta = self.zp_28 - self.ram_16a5
		if frame_delta < 0 then
			return
		end
		-- CMP.w #$000C / BMI.b CODE_BFB91E
		if frame_delta >= 0x000C then
			return
		end
	end

	-- LDA.w $180F / CMP.w #$0001 / BEQ.b CODE_BFB918
	if self.ram_180f == 0x0001 then
		return
	end

	-- CMP.w #$000C / BNE.b CODE_BFB92E / JMP.w CODE_BFB9B2
	if self.ram_180f == 0x000C then
		return
	end

	-- CODE_BFB92E
	local state1029 = self.ram_ramtable1029lo
	if state1029 == 0x0012 or state1029 == 0x0013 or state1029 == 0x0019 then
		-- branch target CODE_BFB94F
	else
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1631Lo,x / BNE.b CODE_BFB9B1
		if self.ram_ramtable1631lo ~= 0 then
			return
		end

		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BPL.b CODE_BFB9B1
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return
		end
	end

	-- CODE_BFB94F
	self.ram_1699 = self.ram_1699 | 0x0003
	self.ram_16cd = self.ram_16cd | 0x0001

	if self.zp_44 == 0 then
		self.ram_16f9 = 0xFFB8
	else
		self.ram_16f9 = 0xFFA6
	end
	self.ram_16e5 = 0
	self.ram_ramtable11a1lo = 0x00C1
	self.ram_1e17 = 0
	self:code_bfbec5()
	self.ram_1699 = self.ram_1699 & 0xFF7F

	-- LDA.b $BA / AND.w #$0001 / BNE.b CODE_BFB9DB
	if (self.zp_ba & 0x0001) ~= 0 then
		self.ram_yspeedlo = 0x0A00
		self.ram_0579 = self.ram_0579 | 0x1000
		self.ram_16f9 = 0xFFB0
		self.ram_0579 = self.ram_0579 | 0x0008
		self:code_bfa13b()
		self.ram_1e19 = self.ram_1e19 | 0x0001
		return
	end

	-- LDA.w $0512,y / BNE.b CODE_BFBA08
	if self.ram_0512 ~= 0 then
		self.ram_ramtable1029lo = 0x0015
		self.ram_16f9 = 0xFFB8
		self:code_be8092(define_dkc1_animationid_rambiriddenbydk_jumpontire)
		self.ram_1e19 = self.ram_1e19 | 0x0001
		return
	end

	-- LDA.w $16F5,y / BEQ.b CODE_BFB9A2 / JMP.w CODE_BFBA21
	if self.ram_16f5 ~= 0 then
		self.ram_ramtable1029lo = 0x001A
		self.ram_16f9 = 0xFFB8
		self:code_be80a4(define_dkc1_animationid_dk_holdjump)
		self.jump_script_kind = nil
		self.jump_script_frame = 0
		self.jump_script_pc = 1
		self.jump_script_wait = 0
		self.jump_script_hook = nil
		self.ram_1e19 = self.ram_1e19 | 0x0001
		return
	end

	-- CODE_BFB9A2
	self.ram_ramtable1029lo = 0x0001
	self:code_be80a4(define_dkc1_animationid_dk_jump)
	self.jump_script_kind = 'data_bea6a9'
	self.jump_script_frame = 0
	self.jump_script_pc = 1
	self.jump_script_wait = 0
	self.jump_script_hook = nil
	self.ram_1e19 = self.ram_1e19 | 0x0001
end

-- code_bfbd4f: roll setup (line 112176)
function player:code_bfbd4f()
	-- LDA.w #$0001 / STA.w $16E5,y
	self.ram_16e5 = 0x0001
	-- STZ.w $1E17
	self.ram_1e17 = 0
	-- LDA.w #$0100 / STA.w $16F1,y
	self.ram_16f1 = 0x0100
	-- LDA.b $7E / AND.w #$0300 / BEQ.b CODE_BFBD6B
	if (self.zp_7e & 0x0300) ~= 0 then
		-- LDA.w #$0300 / STA.w $16F1,y
		self.ram_16f1 = 0x0300
	end
	-- LDA.b $28 / STA.w $16A1,y / STA.w $16A9,y
	self.ram_16a1 = self.zp_28
	self.ram_16a9 = self.zp_28
	-- SEC / SBC.w $16E1,y / CMP.w #$0010
	local dt_frames = self.zp_28 - self.ram_16e1
	if dt_frames < 0x0010 then
		-- LDA.w #$0400 / STA.w $16F1,y
		self.ram_16f1 = 0x0400
		-- LDA.w #$0040 / ORA.w $1699,y / BRA.b CODE_BFBD90
		self.ram_1699 = self.ram_1699 | 0x0040
	else
		-- LDA.w #$FFBF / AND.w $1699,y
		self.ram_1699 = self.ram_1699 & 0xFFBF
	end

	-- CODE_BFBD90:
	-- LDA.b !RAM_DKC1_NorSpr_CurrentIndexLo / CMP.w #$0002 / BEQ.b CODE_BFBDA8
	if self.zp_84 ~= 0x0002 then
		-- LDA.w $16F1,y / STA.b $76 / LSRx3 / CLC / ADC.b $76 / STA.w $16F1,y
		local speed = self.ram_16f1
		local base = speed
		speed = (speed >> 3) + base
		self.ram_16f1 = speed & 0xFFFF
	end
end

-- ============================================================================
-- roll animation script callbacks (direct from DATA_BE927E / DATA_BE9218 / DATA_BE91F5)
-- ============================================================================

function player:code_be9f2d()
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end
	self.ram_ramtable11a1lo = 0x00C1
	self.ram_ramtable1029lo = 0x0000
end

function player:code_be9cb8()
	self:code_be9f2d()
	self:code_be80a4(define_dkc1_animationid_dk_run)
	self.roll_script_kind = nil
	self.roll_script_frame = 0
end

function player:code_be9c96()
	if (self.ram_1699 & 0x0004) ~= 0 then
		self:code_be9cb8()
		return
	end

	self.ram_1699 = self.ram_1699 & 0xFDFF
	self:code_be9f2d()
	self:code_be80a4(define_dkc1_animationid_dk_idle)
	self.roll_script_kind = nil
	self.roll_script_frame = 0
end

function player:code_be9202()
	self:code_be9c96()
	self.ram_16e5 = 0
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be924d()
	self.ram_xspeedlo = 0
end

function player:code_be9241()
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be9251()
	self:code_be9c96()
	self.ram_16e5 = 0
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be9267()
	local frame_delta = self.zp_28 - self.ram_16a1
	if frame_delta >= 0x0014 then
		return
	end
	self:code_bfbd4f()
	self:code_bfbda9()
end

function player:code_be92ad()
	self.ram_ramtable1029lo = 0x0013
end

function player:code_be92fd()
	-- Stage-specific probes used by DKC1 roll edge logic.
	-- In this cart the corresponding terrain tables are not present.
	return false
end

function player:code_be92b4()
	if (self.ram_ramtable12a5lo & 0x0001) == 0 then
		return
	end
	if self:code_be92fd() then
		return
	end
	if self.ram_16e5 == 0x0002 or self.ram_16e5 == 0x0003 then
		self:code_be80a4(define_dkc1_animationid_dk_cancelroll)
		self.roll_script_kind = 'cancelroll'
		self.roll_script_frame = 0
		return
	end
	if (self.ram_1699 & 0x0040) ~= 0 then
		self.ram_ramtable0f25lo = 0
		self:code_be80a4(define_dkc1_animationid_dk_endroll)
		self.roll_script_kind = 'endroll'
		self.roll_script_frame = 0
		return
	end
	if self.ram_16a1 ~= self.ram_16a9 then
		self.ram_ramtable0f25lo = 0
		self:code_be80a4(define_dkc1_animationid_dk_endroll)
		self.roll_script_kind = 'endroll'
		self.roll_script_frame = 0
		return
	end
	if (self.ram_16ed & joypad_y) ~= 0 then
		self:code_be80a4(define_dkc1_animationid_dk_cancelroll)
		self.roll_script_kind = 'cancelroll'
		self.roll_script_frame = 0
		return
	end
	self.ram_ramtable0f25lo = 0
	self:code_be80a4(define_dkc1_animationid_dk_endroll)
	self.roll_script_kind = 'endroll'
	self.roll_script_frame = 0
end

-- CODE_BEA7D6 callback (DATA_BEA6A9): launch jump with $0700
function player:code_bea7d6()
	self.ram_yspeedlo = 0x0700
	if (self.ram_ramtable1271lo & 0x8000) == 0 then
		self.ram_0579 = self.ram_0579 | 0x1000
	end
end

function player:code_be84da_gate()
	return (self.ram_ramtable12a5lo & 0x0001) ~= 0
end

function player:code_be851b_gate()
	local a = to_unsigned_16(self.ram_ramtable1631lo - 1)
	if to_signed_16(a) >= 0 then
		return false
	end
	if a < 0xFFB8 then
		return false
	end
	return true
end

function player:code_bea715()
	self.ram_animation_speed = 0x0100
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end
	self.ram_ramtable1029lo = 0x0000
end

function player:code_bea724()
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end
	if (self.ram_1699 & 0x0004) == 0 then
		return
	end
	self:code_be9cb8()
end

function player:code_bea737()
	if (self.ram_ramtable12a5lo & 0x1011) ~= 0x0001 then
		return
	end
end

function player:code_bea755()
	if self.ram_ramtable1631lo ~= 0 then
		return
	end
	self.ram_animation_speed = 0x0400
	self.ram_displaycurrentposetimerlo = 0x0000
end

function player:code_bea765()
	if (self.ram_ramtable1209lo & 0x0007) < self.zp_f3 then
		return
	end
	self:code_be80a4(define_dkc1_animationid_dk_fall)
end

function player:code_bea778()
	if (self.ram_ramtable1271lo & 0x8000) == 0 then
		self:code_be9c96()
		return
	end
	self:code_be80a4(define_dkc1_animationid_dk_idle)
end

-- CODE_BEB233 / CODE_BEB23C callbacks toggle $16E5 during jump script.
function player:code_beb233()
	self.ram_16e5 = 0x0004
end

function player:code_beb23c()
	self.ram_16e5 = 0x0000
end

-- CODE_BEA02E callback used by DK jump/air script to settle back to idle/state 0.
function player:code_bea02e()
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end

	if self.ram_ramtable0f25lo ~= 0 then
		local flipped = (self.ram_yxppccctlo << 1) & 0xFFFF
		local turned = (flipped ~ self.ram_ramtable0f25lo) & 0x8000
		if turned ~= 0 then
			return
		end
	end

	local speed_abs = abs_16(self.ram_xspeedlo)
	if speed_abs >= 0x0030 then
		return
	end
	if self.zp_32 == 0x0004 and self.ram_ramtable0f25lo ~= 0 then
		return
	end

	self:code_be9f2d()
	self:code_be80a4(define_dkc1_animationid_dk_idle)
end

-- CODE_BE9835: death-music path in original game (non-physics side effects).
function player:code_be9835()
	if (self.ram_1e15 & 0x0020) ~= 0 then
		return
	end
	self:code_b99036(define_dkc1_musicid_deathmusic)
	self.ram_register_irqnmiandjoypadenableflags = 0x0081
end

-- CODE_BE9CEA callback from DATA_BE984F.
function player:code_be9cea()
	if (self.ram_1e15 & 0x0020) == 0 then
		return
	end
	self.ram_ramtable1029lo = 0x0050
	self.ram_1929 = 0x0003
	self.ram_global_screendisplayregister = 0x820F
end

-- CODE_BE9956 callback from DATA_BE984F.
function player:code_be9956()
	self.ram_1929 = 0x0000
end

-- CODE_BE9937 callback from DATA_BE984F.
function player:code_be9937()
	self.ram_ramtable1029lo = 0x000B
end

-- CODE_BE993E callback from DATA_BE984F.
function player:code_be993e()
	self.ram_yspeedlo = 0x0200
end

-- CODE_BE9945 callback from DATA_BE984F.
function player:code_be9945()
	self.ram_yspeedlo = 0x0500
end

-- CODE_BE994C callback from DATA_BE984F.
function player:code_be994c()
	self.ram_ramtable0f25lo = 0x0000
	self.ram_xspeedlo = 0x0000
	self.ram_ramtable123dlo = 0x0000
end

function player:start_data_be984f()
	self.death_script_kind = 'data_be984f'
	self.death_script_pc = 1
	self.death_script_wait = 0
end

function player:update_death_animation_script()
	if self.death_script_kind ~= 'data_be984f' then
		return
	end

	if self.death_script_wait > 0 then
		self.death_script_wait = self.death_script_wait - 1
		return
	end

	while true do
		local step = data_be984f[self.death_script_pc]
		if step == nil then
			self.death_script_kind = 'done'
			return
		end

		if step.op == 'wait' then
			self.death_script_wait = step.frames
			self.death_script_pc = self.death_script_pc + 1
			if self.death_script_wait > 0 then
				self.death_script_wait = self.death_script_wait - 1
				return
			end
		elseif step.op == 'wait_grounded' then
			if (self.ram_ramtable12a5lo & 0x0001) == 0 then
				return
			end
			self.death_script_pc = self.death_script_pc + 1
		elseif step.op == 'call' then
			self[step.fn](self)
			self.death_script_pc = self.death_script_pc + 1
		elseif step.op == 'loop' then
			return
		end
	end
end

function player:update_roll_animation_script()
	if self.roll_script_kind == nil then
		return
	end

	self.roll_script_frame = self.roll_script_frame + 1

	if self.roll_script_kind == 'roll' then
		local frame = ((self.roll_script_frame - 1) % 33) + 1
		if frame == 9 then
			self:code_be92ad()
			return
		end
		if frame == 30 then
			self:code_be92b4()
			return
		end
		return
	end

	if self.roll_script_kind == 'endroll' then
		if self.roll_script_frame == 3 then
			self:code_be924d()
			return
		end
		if self.roll_script_frame == 11 then
			self:code_be9241()
			return
		end
		if self.roll_script_frame == 17 then
			self:code_be9267()
			if self.roll_script_kind == 'roll' then
				return
			end
			self:code_be9251()
			if self.roll_script_kind ~= 'roll' then
				self.roll_script_kind = nil
				self.roll_script_frame = 0
			end
		end
		return
	end

	if self.roll_script_kind == 'cancelroll' then
		if self.roll_script_frame == 3 then
			self:code_be9202()
			self.roll_script_kind = nil
			self.roll_script_frame = 0
		end
	end
end

function player:update_jump_animation_script()
	if self.jump_script_kind ~= 'data_bea6a9' then
		return
	end

	if self.ram_16ad ~= define_dkc1_animationid_dk_jump then
		self.jump_script_kind = nil
		self.jump_script_frame = 0
		self.jump_script_pc = 1
		self.jump_script_wait = 0
		self.jump_script_hook = nil
		return
	end

	self.jump_script_frame = self.jump_script_frame + 1

	if self.jump_script_hook ~= nil then
		self[self.jump_script_hook](self)
	end

	if self.jump_script_wait > 0 then
		self.jump_script_wait = self.jump_script_wait - 1
		return
	end

	while true do
		local step = data_bea6a9[self.jump_script_pc]
		if step == nil then
			self.jump_script_pc = 1
			return
		end

		if step.op == 'wait' then
			self.jump_script_wait = step.frames
			self.jump_script_pc = self.jump_script_pc + 1
			if self.jump_script_wait > 0 then
				self.jump_script_wait = self.jump_script_wait - 1
			end
			return
		elseif step.op == 'call' then
			self[step.fn](self)
			self.jump_script_pc = self.jump_script_pc + 1
			if self.ram_16ad ~= define_dkc1_animationid_dk_jump then
				return
			end
		elseif step.op == 'gate' then
			if not self[step.fn](self) then
				return
			end
			self.jump_script_pc = self.jump_script_pc + 1
		elseif step.op == 'hook' then
			self.jump_script_hook = step.fn
			self.jump_script_pc = self.jump_script_pc + 1
		elseif step.op == 'loop' then
			self.jump_script_pc = 1
			return
		end
	end
end

-- code_bfbc6b: Y BUTTON handler for state 0 (roll/pickup, line 112045)
-- Called from inside code_bfb27c when Y is HELD
function player:code_bfbc6b()
	-- LDA.w $0512,y / BEQ.b CODE_BFBC75
	if self.ram_0512 ~= 0 then
		return
	end

	-- LDA.w $16F5,y / BEQ.b CODE_BFBC7D
	if self.ram_16f5 ~= 0 then
		return
	end

	-- JSR.w CODE_BFBE39 / BCS.b CODE_BFBC8C
	if self:code_bfbe39() then
		return
	end

	local roll_state = self.ram_16e5

	if roll_state == 0 then
		-- CODE_BFBCD7
		if to_signed_16(self.ram_ramtable1631lo) < 0 then
			return
		end

		if (to_signed_16(self.ram_ramtable1631lo) - 1) >= 0 then
			if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
				self.ram_16e5 = 0
			end
			return
		end

		if to_signed_16(self.ram_yspeedlo) >= 0 then
			if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
				self.ram_16e5 = 0
			end
			return
		end

		if (self.zp_80 & joypad_y) ~= 0 then
			if (self.ram_ramtable1209lo & 0x0007) < self.zp_f3 then
				self:code_bfbd4f()
				self:code_bfbda9()
			end
			return
		end

		local frame_delta = self.zp_28 - self.ram_16a1
		if frame_delta < 0 or frame_delta >= 0x0008 then
			return
		end
		if (self.ram_ramtable1209lo & 0x0007) < self.zp_f3 then
			self:code_bfbd4f()
			self:code_bfbda9()
		end
		return
	end

	if roll_state == 1 or roll_state == 3 then
		-- CODE_BFBDD5
		if (self.zp_80 & joypad_y) ~= 0 then
			self.ram_16a1 = self.zp_28
		end
		return
	end

	if roll_state == 2 then
		-- CODE_BFBDE7
		self:code_bfbde7()
		return
	end

	if roll_state == 4 then
		-- CODE_BFBC97 -> CODE_BFBD3A
		if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
			self.ram_16e5 = 0
		end
	end
end

-- code_bfb27c: FULL button handler entry (line 110730)
-- REAL assembly: handles ALL buttons (up/down/left/right/A/B/X/Y/L/R/select/start)
function player:code_bfb27c(state_180f)
	if state_180f ~= nil then
		self.ram_180f = state_180f & 0xFFFF
	end
	-- STA.w $180F                                  ; LINE 110730
	-- (already set by caller)
	-- STZ.w $1E19                                  ; LINE 110735
	self.ram_1e19 = 0
	self.ram_16e9 = self.zp_80
	self.ram_16ed = self.zp_7e
	
	-- CODE_BFB2C7: clear run-active bit
	-- LDA.w $1699,y / AND.w #$FFFB / STA.w $1699,y ; LINE 110750-755
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- ================================================================
	-- UP/DOWN/VERTICAL NEUTRAL (LINE 110786-110804)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_DPadU              ; LINE 110786
	if (self.zp_7e & joypad_dpadu) ~= 0 then
		-- JSR CODE_BFB38A (up handler - jump table via DATA_BFC211)
		-- For $180F=0: DATA_BFC211[0] = CODE_BFBA39 (RTS/noop)
		-- skip for now
	-- LDA.b $7E / AND.w #Joypad_DPadD              ; LINE 110793
	elseif (self.zp_7e & joypad_dpadd) ~= 0 then
		-- JSR CODE_BFB3FE (down handler - jump table via DATA_BFC237)
		-- For $180F=0: similar
		-- skip for now
	else
		-- JSR CODE_BFC1A1 (vertical neutral)        ; LINE 110802
		-- CODE_BFC1A1: LDA $180F / ASL / TAX / JMP (DATA_BFC31B,x)
		-- DATA_BFC31B[0] = CODE_BFBA39 (RTS/noop for $180F=0)
		-- skip for now
	end
	
	-- ================================================================
	-- LEFT/RIGHT/HORIZONTAL NEUTRAL (LINE 110805-110819)
	-- ================================================================
	-- CODE_BFB305:
	-- LDA.b $7E / AND.w #Joypad_DPadL              ; LINE 110805
	if (self.zp_7e & joypad_dpadl) ~= 0 then
		-- JSR CODE_BFB5AE                            ; LINE 110808
		-- CODE_BFB5AE: LDA $180F / ASL / TAX / JMP (DATA_BFC1C5,x)
		self[data_bfc1c5[self.ram_180f + 1]](self)
	-- LDA.b $7E / AND.w #Joypad_DPadR              ; LINE 110811
	elseif (self.zp_7e & joypad_dpadr) ~= 0 then
		-- JSR CODE_BFB6C5                            ; LINE 110815
		-- CODE_BFB6C5: LDA $180F / ASL / TAX / JMP (DATA_BFC1EB,x)
		self[data_bfc1eb[self.ram_180f + 1]](self)
	else
		-- JSR CODE_BFC18A                            ; LINE 110819
		-- CODE_BFC18A: LDA $180F / ASL / TAX / JMP (DATA_BFC2F5,x)
		self[data_bfc2f5[self.ram_180f + 1]](self)
	end
	
	-- ================================================================
	-- A BUTTON (LINE 110820)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_A                  ; LINE 110820
	-- For $180F=0: DATA_BFC25D[0] = CODE_BFB838 (tag action)
	-- Not essential for basic physics, skip for now
	
	-- ================================================================
	-- B BUTTON / JUMP (LINE 110824-110835)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_B                  ; LINE 110824
	if (self.zp_7e & joypad_b) ~= 0 then
		-- JSR CODE_BFB8DD                            ; LINE 110828
		-- CODE_BFB8DD: LDA $180F / ASL / TAX / JMP (DATA_BFC283,x)
		self[data_bfc283[self.ram_180f + 1]](self)
	else
		-- JSR CODE_BFC1B9                            ; LINE 110834
		-- CODE_BFC1B9: LDX $84 / LDA $1699,x / AND #$FFFC / STA $1699,x
		self.ram_1699 = self.ram_1699 & 0xfffc
	end
	
	-- ================================================================
	-- X BUTTON (LINE 110837)
	-- ================================================================
	-- Skip for now
	
	-- ================================================================
	-- Y BUTTON / RUN-ROLL (LINE 110841-110851)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_Y                  ; LINE 110841
	if (self.zp_7e & joypad_y) ~= 0 then
		-- JSR CODE_BFBC4B                            ; LINE 110845
		-- CODE_BFBC4B: LDA $180F / ASL / TAX / JMP (DATA_BFC2A9,x)
		self[data_bfc2a9[self.ram_180f + 1]](self)
	else
		-- JSR CODE_BFBC06 (Y release)                ; LINE 110849
		-- CODE_BFBC06: checks $16F5 for carried object
		-- For no carried object ($16F5=0): RTS
		-- skip (no carry mechanic yet)
	end
	
	-- ================================================================
	-- L/R/SELECT/START (LINE 110852+)
	-- ================================================================
	-- Skip for now
	
	-- LDA.w $1E19 / LSR / RTS                      ; LINE 110883
	-- return carry = bit 0 of $1E19
	return (self.ram_1e19 & 0x0001) ~= 0
end

-- code_bfba88: rope jump (line 111806)
function player:code_bfba88()
	-- lda.w #$0700
	self.ram_yspeedlo = 0x0700
	
	-- ldy.b $84
	-- lda.w $1699,y / ora.w #$0203
	self.ram_1699 = self.ram_1699 | 0x0203
	
	-- lda.w $16cd,y / ora.w #$0001
	self.ram_16cd = self.ram_16cd | 0x0001
	
	-- lda.w #$ffb8
	self.ram_16f9 = 0xffb8
	
	-- lda.w #$0000 / sta.w $16e5,y
	self.ram_16e5 = 0
	
	-- lda.w #$00c1
	self.ram_ramtable11a1lo = 0x00C1

	-- jsr.w code_bfbec5
	self:code_bfbec5()
	-- lda.w $1699,y / and.w #$ff7f
	self.ram_1699 = self.ram_1699 & 0xFF7F

	-- lda.w #$0001 / sta.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	self.ram_ramtable1029lo = 0x0001
	self.ram_1e19 = self.ram_1e19 | 0x0001
	-- lda.w #!Define_DKC1_AnimationID_DK_JumpOffVerticalRope
	self:code_be80a4(define_dkc1_animationid_dk_jumpoffverticalrope)

	self.jump_script_kind = nil
	self.jump_script_frame = 0
	self.jump_script_pc = 1
	self.jump_script_wait = 0
	self.jump_script_hook = nil

	-- lda.b $7E / and.w #$0300 / bne.b CODE_BFBADB
	local dpad_lr = self.zp_7e & 0x0300
	if dpad_lr == 0 then
		return
	end

	-- and.w #$0100 / bne.b CODE_BFBAEC
	if (dpad_lr & 0x0100) == 0 then
		-- face left
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
		return
	end

	-- face right
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
end

-- code_bfb3c4: vertical-rope neutral helper (line 110961)
function player:code_bfb3c4()
	-- Rope lookup table path is not wired in this cart runtime.
	-- Keep the branch side-effect that sets $0F8D from left/right intent.
	if (self.zp_7e & joypad_y) == 0 then
		self.ram_ramtable0f8dlo = 0x0180
		return
	end
	self.ram_ramtable0f8dlo = 0x0280
end

-- code_bfba6f: vertical-rope B handler (line 111783)
function player:code_bfba6f()
	if (self.zp_7e & 0x0300) ~= 0 then
		if (self.zp_80 & joypad_b) ~= 0 then
			self:code_bfba88()
		end
		return
	end
	if (self.zp_7e & 0x0C00) ~= 0 then
		return
	end
	self:code_bfb3c4()
end

-- code_bfbbdc helper (line 112093)
function player:code_bfbbdc()
	local vertical = self.zp_7e & 0x0C00
	if vertical == 0 then
		return 0x0200
	end
	if (vertical & 0x0800) ~= 0 then
		return 0x0280
	end
	return 0x0100
end

-- code_bfbbaf: swim-jump B handler (line 111935)
function player:code_bfbbaf()
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self.ram_yspeedlo = self:code_bfbbdc()
end

-- code_bfaf38: air gravity (line 110236)
function player:code_bfaf38()
	-- ldx.b !ram_dkc1_norspr_currentindexlo      ; LINE 110236: LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
	-- ldy.b $84                                    ; LINE 110237: LDY.b $84
	-- lda.w $1699,y                                ; LINE 110238: LDA.w $1699,y
	-- and.w #$0002                                 ; LINE 110241: AND.w #$0002 (check jump-hold)
	local gravity
	if (self.ram_1699 & 0x0002) ~= 0 then
		-- holding jump
		-- lda.w $16f9,y                             ; LINE 110243: LDA.w $16F9,y
		gravity = self.ram_16f9  -- $ffb8 or $ffa6
	else
		-- code_bfaf4e / code_bfaf49:
		-- cpx.w #$0004 / beq.b code_bfaf49
		-- lda.w #$ff90
		gravity = 0xff90  -- -112 dec
	end
	
	-- clc                                          ; LINE 110256: CLC
	-- adc.w !ram_dkc1_norspr_yspeedlo,x            ; LINE 110258: ADC.w !RAM_DKC1_NorSpr_YSpeedLo,x
	local yspeed_signed = to_signed_16(self.ram_yspeedlo)
	local gravity_signed = to_signed_16(gravity)
	yspeed_signed = yspeed_signed + gravity_signed
	
	-- max fall speed check
	-- bpl.b code_bfaf64                            ; LINE 110260: BPL.b CODE_BFAF64
	-- cmp.w #$f800                                 ; LINE 110262: CMP.w #$F800 (-8.0 px)
	if yspeed_signed < 0 and yspeed_signed < -0x0800 then
		-- lda.w #$f800                              ; LINE 110266: LDA.w #$F800
		yspeed_signed = -0x0800
	end
	
	-- code_bfaf64: sta.w !ram_dkc1_norspr_yspeedlo,x ; LINE 110267: STA.w !RAM_DKC1_NorSpr_YSpeedLo,x
	self.ram_yspeedlo = to_unsigned_16(yspeed_signed)
end

function player:code_bfa441()
	self.ram_oamzposlo = 0x00E4
end

function player:code_bfa49a()
	self.ram_ramtable11a1lo = 0x00C0
	self.ram_16d9 = 0
	self.ram_16d1 = 0x0060
	self.ram_16d5 = 0x0070
end

-- CODE_BFA44A: hurt/death blink + pose masking timers.
function player:code_bfa44a()
	if self.ram_16d5 ~= 0 then
		self.ram_16d5 = to_unsigned_16(self.ram_16d5 - 1)
		if self.ram_16d5 == 0 then
			self.ram_ramtable11a1lo = 0x00C1
		else
			self.ram_ramtable11a1lo = 0x00C0
		end
	end

	if self.ram_16d1 == 0 then
		return
	end

	self.ram_16d1 = to_unsigned_16(self.ram_16d1 - 1)
	if self.ram_16d1 == 0 then
		self.ram_currentposelo = self.ram_16d9
		return
	end

	if self.ram_currentposelo ~= 0 and self.ram_currentposelo ~= self.ram_16d9 then
		self.ram_16d9 = self.ram_currentposelo
	end

	if (self.zp_28 & 0x0002) ~= 0 then
		self.ram_currentposelo = self.ram_16d9
		return
	end

	self.ram_currentposelo = 0
end

-- CODE_BFA0D5: roll re-arm when ground-contact bit toggles in RAMTable12A5.
function player:code_bfa0d5()
	local flags = self.ram_ramtable12a5lo & 0xFFFF
	local xba = (((flags & 0x00FF) << 8) | ((flags >> 8) & 0x00FF)) & 0xFFFF
	if ((xba ~ flags) & 0x0001) == 0 then
		return
	end
	if self.ram_16ad ~= define_dkc1_animationid_dk_roll then
		return
	end
	self.ram_16ad = define_dkc1_animationid_dk_roll
end

-- CODE_BFA51B: crawlspace headroom probe.
function player:code_bfa51b()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / AND #$1001 / CMP #$0001 / BNE
	if (self.ram_ramtable12a5lo & 0x1001) ~= 0x0001 then
		return false
	end

	-- LDA.w !RAM_DKC1_NorSpr_YSpeedLo,x / DEC / BPL
	if to_signed_16(self.ram_yspeedlo - 1) >= 0 then
		return false
	end

	-- LDA.w YPos / PHA / CLC / ADC #$0020 / STA YPos
	local old_y = self.ram_yposlo
	self.ram_yposlo = to_unsigned_16(old_y + 0x0020)

	-- JSL CODE_818000 / CMP YPos / BMI fail
	local probe_y = self:code_818000()
	if to_signed_16(probe_y - self.ram_yposlo) < 0 then
		self.ram_yposlo = old_y
		return false
	end

	-- LDA $9C / AND #$0040 / BNE fail
	if (self.zp_9c & 0x0040) ~= 0 then
		self.ram_yposlo = old_y
		return false
	end

	-- PLA / STA YPos / SEC / RTS
	self.ram_yposlo = old_y
	return true
end

-- CODE_BFA4E3: horizontal push-out used by crawl/roll transitions.
function player:code_bfa4e3()
	self.ram_ramtable1375lo = self.ram_xposlo
	self.ram_ramtable13e9lo = 0x0001
	while true do
		self.ram_xposlo = to_unsigned_16(self.ram_ramtable1375lo + self.ram_ramtable13e9lo)
		if not self:code_bfa51b() then
			break
		end

		self.ram_xposlo = to_unsigned_16(self.ram_ramtable1375lo - self.ram_ramtable13e9lo)
		if not self:code_bfa51b() then
			break
		end

		self.ram_ramtable13e9lo = to_unsigned_16(self.ram_ramtable13e9lo + 1)
	end

	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
end

-- CODE_BFA4B7 / CODE_BFA4DA: crawlspace transition gates.
function player:code_bfa4b7()
	if not self:code_bfa51b() then
		return
	end
	if self.ram_0512 == 0 and self.ram_16f5 == 0 then
		self.ram_ramtable1029lo = 0x0027
		self.ram_16ad = define_dkc1_animationid_dk_duckintocrawlspace
		return
	end
	self:code_bfa4e3()
end

function player:code_bfa4da()
	if self:code_bfa51b() then
		self:code_bfa4e3()
	end
end

function player:code_bfc0d0()
	local xi = (0x0002 >> 1) + 1
	local yi = (0x0002 >> 1) + 1
	self.ram_16b9_slots[yi] = self.ram_norspr_xposlo[xi] & 0xFFFF
	self.ram_16bd_slots[yi] = self.ram_norspr_yposlo[xi] & 0xFFFF

	xi = (0x0004 >> 1) + 1
	yi = (0x0000 >> 1) + 1
	self.ram_16b9_slots[yi] = self.ram_norspr_xposlo[xi] & 0xFFFF
	self.ram_16bd_slots[yi] = self.ram_norspr_yposlo[xi] & 0xFFFF
end

-- CODE_BFA260: release held object ($16F5 path).
function player:code_bfa260()
	if self.ram_16f5 == 0 then
		return false
	end
	local carried_slot = self.ram_16f5
	self.ram_16f5 = 0
	local carried = self:dkc1_get_any_sprite_by_slot(carried_slot)
	if carried == nil then
		return false
	end
	carried.dkc1_ramtable1595lo = 0x0080
	local throw_x = 0x0100
	if (carried.dkc1_yxppccctlo & 0x4000) ~= 0 then
		throw_x = to_unsigned_16(-to_signed_16(throw_x))
	end
	carried.x_speed_subpx = throw_x
	carried.dkc1_ramtable0f25lo = throw_x
	carried.y_speed_subpx = 0x0400
	if self.zp_32 ~= 0x0007 then
		carried.dkc1_yxppccctlo = carried.dkc1_yxppccctlo | 0x3000
	end
	return false
end

-- CODE_BFA2A0: dismount animal buddy ($0512 path).
function player:code_bfa2a0()
	if self.ram_0512 == 0 then
		return false
	end
	local buddy_slot = self.ram_0512
	self.ram_0512 = 0
	self.ram_0516 = 0
	self.ram_0518 = 0
	local buddy = self:dkc1_get_any_sprite_by_slot(buddy_slot)
	if buddy == nil then
		return false
	end
	buddy.dkc1_ramtable1595lo = 0x0010
	self.ram_1929 = 0xFFF1
	if buddy.dkc1_sprite_id ~= define_dkc1_norspr0c_enguarde then
		self.ram_yspeedlo = 0x0600
		self.ram_ramtable1029lo = 0x000D
		self.ram_16ad = define_dkc1_animationid_dk_getoffanimalbuddy
		self:code_bfa49a()
		return true
	end
	self.ram_yspeedlo = 0x0200
	self.ram_ramtable0f8dlo = 0x0000
	self.ram_ramtable1029lo = 0x004A
	self.ram_16ad = define_dkc1_animationid_dk_getknockedoffunderwateranimalbuddy
	self:code_bfa49a()
	return true
end

-- CODE_BFA13B: handling for $1595 == #$0080.
function player:code_bfa13b()
	self.ram_16e5 = 0x0000
	if self.ram_0512 ~= 0 then
		self.ram_16ad = define_dkc1_animationid_rambiriddenbydk_jumpontire
		self.ram_ramtable1029lo = 0x0015
		self.ram_1e19 = self.ram_1e19 | 0x0001
		return true
	end
	if self.ram_16f5 ~= 0 then
		self.ram_16ad = define_dkc1_animationid_dk_bouncewhileholding
		self.ram_ramtable1029lo = 0x001A
		self.ram_1e19 = self.ram_1e19 | 0x0001
		return true
	end
	self.ram_ramtable1029lo = 0x0001
	self.ram_16ad = define_dkc1_animationid_dk_jumpoffverticalrope
	self.ram_1e19 = self.ram_1e19 | 0x0001
	return true
end

-- CODE_BFA17E: hurt/death dispatch.
function player:code_bfa17e()
	if self:code_bfa2a0() then
		return
	end
	self:code_bfa260()
	if (self.ram_0579 & 0x0001) ~= 0 then
		self.ram_16c1 = self.ram_xspeedlo
		self.ram_16c5 = self.ram_yspeedlo
		self.ram_ramtable1029lo = 0x000D
		self.ram_xspeedlo = 0x0000
		self.ram_ramtable0f25lo = 0x0000
		self.ram_yspeedlo = 0x0800
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
		self.ram_1929 = 0x0003
		self.ram_ramtable11a1lo = 0x0000
		self.ram_16ad = define_dkc1_animationid_dk_hurt
		self.death_script_kind = nil
		if (self.ram_0579 & 0x0800) == 0 then
			self:code_bfc0d0()
		end
		return
	end
	if (self.ram_0579 & 0x0400) ~= 0 then
		self.ram_0579 = self.ram_0579 | 0x0800
		self.ram_16c1 = self.ram_xspeedlo
		self.ram_16c5 = self.ram_yspeedlo
		self.ram_ramtable1029lo = 0x000D
		self.ram_xspeedlo = 0x0000
		self.ram_ramtable0f25lo = 0x0000
		self.ram_yspeedlo = 0x0800
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
		self.ram_1929 = 0x0003
		self.ram_ramtable11a1lo = 0x0000
		self.ram_16ad = define_dkc1_animationid_dk_hurt
		self.death_script_kind = nil
		if (self.ram_0579 & 0x0800) == 0 then
			self:code_bfc0d0()
		end
		return
	end
	self.ram_ramtable1029lo = 0x0011
	self.ram_yspeedlo = 0x0800
	local launch_x = 0x00C8
	if (self.ram_yxppccctlo & 0x4000) == 0 then
		launch_x = to_unsigned_16(-to_signed_16(launch_x))
	end
	self.ram_xspeedlo = launch_x
	self.ram_ramtable0f25lo = launch_x
	self.ram_ramtable11a1lo = 0x0000
	self.ram_16d5 = 0x0000
	self:code_bfa441()
	self.ram_16ad = define_dkc1_animationid_dk_dead
	self:start_data_be984f()
	self.ram_1929 = 0x0003
end

-- CODE_BFA0F7: process pending hit flags in $1595.
function player:code_bfa0f7()
	local hit_flags = self.ram_ramtable1595lo & 0x7FFF
	if hit_flags == 0x0001 or hit_flags == 0x0020 then
		self.ram_ramtable1595lo = 0x0000
		self:code_bfa17e()
		return true
	end
	if hit_flags == 0x0040 then
		self.ram_ramtable1595lo = 0x0000
		self.ram_ramtable11a1lo = 0x00C0
		self.ram_ramtable1029lo = 0x0019
		self.ram_16ad = define_dkc1_animationid_dk_ridesteelkeg
		self:code_bfa260()
		return true
	end
	if hit_flags == 0x0080 then
		self.ram_ramtable1595lo = 0x0000
		self:code_bfa13b()
		return true
	end
	return false
end

function player:code_bfc745()
	self.ram_ramtable1595lo = 0x0001
	return true
end

function player:code_bfc75a()
	local delta_y = to_signed_16(to_unsigned_16(self.zp_a8 - self.zp_b4))
	if delta_y >= 0x000A then
		return self:code_bfc745()
	end
	return false
end

function player:code_bfc713()
	if not self:code_bba58d(0x0001) then
		return false
	end
	local hit_sprite = self:dkc1_get_any_sprite_by_slot(self.zp_88)
	if (hit_sprite.dkc1_ramtable1699lo & 0x0080) ~= 0 then
		return false
	end
	if hit_sprite.dkc1_animationid == define_dkc1_animationid_dk_bounce then
		return false
	end
	if hit_sprite.dkc1_animationid == define_dkc1_animationid_dk_unknowngroundstomp then
		return self:code_bfc75a()
	end
	if (hit_sprite.dkc1_ramtable12a5lo & 0x0101) ~= 0x0101 then
		return self:code_bfc75a()
	end
	return self:code_bfc745()
end

function player:code_bfc70f()
	self:code_bba4d5()
	return self:code_bfc713()
end

-- CODE_BFC70F feed wrapper: enemy/projectile overlap writes player $1595.
function player:code_bfc70f_feed_hit_event()
	if self.ram_ramtable1595lo ~= 0 then
		return
	end
	self:code_bfc70f()
end

function player:dkc1_world_to_virtual_ypos(world_y)
	return to_unsigned_16(self.zp_4a - world_y - self.ram_layer1yposlo)
end

function player:dkc1_virtual_to_world_ypos(virtual_ypos)
	local signed_virtual = to_signed_16(virtual_ypos)
	return self.zp_4a - signed_virtual - self.ram_layer1yposlo
end

-- CODE_B6A856: life decrement entry used by death transitions.
function player:code_b6a856()
	self.ram_player_displayedlifecountlo = self.ram_player_currentlifecountlo
	if self.ram_ramtable13e9lo ~= 0 then
		return
	end
	self.ram_player_currentlifecountlo = to_unsigned_16(self.ram_player_currentlifecountlo - 1)
	self.ram_ramtable13e9lo = to_unsigned_16(self.ram_ramtable13e9lo + 1)
end

function player:code_b6a804()
	if (self.ram_1e25 & 0xFFFF) ~= 0 then
		return
	end
	self:code_bf8148()
	self:code_b5804c('DATA_B5E62B')
	self.ram_1e25 = self.zp_86 & 0xFFFF
	local x = self.ram_1e25 & 0xFFFF
	local i = (x >> 1) + 1
	local a = self.ram_yxppccctlo
	local pal = self.ram_1ad5 & 0xFFFF
	if pal >= 0x849A and pal < 0x8512 then
		a = 0x0200
	end
	a = a & 0x0E00
	local yx = self.ram_norspr_yxppccctlo[i]
	a = (a ~ yx) & 0x0E00
	a = (a ~ yx) & 0xFFFF
	self.ram_norspr_yxppccctlo[i] = a
	self.ram_player_displayedlifecountlo = self.ram_player_currentlifecountlo
	self.ram_ramtable1375lo = 0
	self.ram_ramtable13e9lo = 0
	self.ram_ramtable14f9lo = 0
end

function player:code_bf8148()
	self:code_bdf3a2()
end

function player:code_b5804c(_ptr)
	self.ram_spawn_script_ptr = _ptr
end

function player:code_be80af(anim)
	self:code_be80a4(anim)
end

function player:code_b6a84b()
	self:code_b6a804()
	self.ram_player_currentlifecountlo = to_unsigned_16(self.ram_player_currentlifecountlo + 1)
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo + 1)
end

function player:code_b99036(music_id)
	self.ram_music_last = music_id & 0xFFFF
end

function player:code_b6a868()
	local keep = self.zp_84 & 0xFFFF
	self.zp_84 = self.ram_1e25 or keep
	self:code_be80af(0x0034)
	self:code_bffb27(define_dkc1_soundid_lostlife)
	self.zp_84 = keep
end

function player:code_bfa6e4()
	self.ram_ramtable1029lo = 0x003B
	self.ram_ramtable1375lo = 0x0060
	self.ram_1929 = 0x0001
	self:code_b6a856()
end

function player:code_bfa6fd()
	self.ram_ramtable1029lo = 0x003F
	self.ram_1929 = 0x0001
	self.ram_global_screendisplayregister = 0x820F
end

-- CODE_BFA697: out-of-bounds/death gate.
function player:code_bfa697()
	local death_gate = false
	if (self.ram_1e15 & 0x0200) ~= 0 then
		local cmp_value = to_unsigned_16(self.zp_4a - self.ram_yposlo - self.ram_layer1yposlo)
		if cmp_bpl_16(cmp_value, 0x0120) then
			death_gate = true
		end
	end

	if not death_gate then
		local signed_ypos = to_signed_16(self.ram_yposlo)
		if signed_ypos >= 0 then
			local masked_flags = self.ram_ramtable12a5lo & 0x1111
			if masked_flags == 0x0101 then
				self.ram_a = self.ram_ramtable0c35lo
			else
				self.ram_a = masked_flags
			end
			return
		end
		if signed_ypos >= -0x0030 then
			return
		end
		death_gate = true
	end

	if (self.ram_1e15 & 0x0020) ~= 0 then
		self:code_bfa6fd()
		return
	end
	if self.ram_0512 == 0 then
		self:code_bfa6e4()
		return
	end
	self.ram_0512 = 0
	self.ram_0516 = 0
	self.ram_0518 = 0
	self:code_bfa6e4()
end

-- code_bfa712: collision/bounce gate (line 109102)
function player:code_bfa712()
	-- stz.w !ram_dkc1_norspr_ramtable1271lo
	self.ram_ramtable1271lo = 0

	-- ldy.b $84 / lda.w $16ad,y / cmp.w #!Define_DKC1_AnimationID_DK_Bounce
	if self.ram_16ad ~= define_dkc1_animationid_dk_bounce then
		-- code_bfa72c:
		-- lda.w #$0001 / sta.w !ram_dkc1_norspr_ramtable1271lo
		self.ram_ramtable1271lo = 0x0001
		-- lda.w !ram_dkc1_norspr_yspeedlo,x / bmi.b code_bfa73e
		if to_signed_16(self.ram_yspeedlo) >= 0 then
			-- cmp.w #$0140 / bpl.b code_bfa72b
			if self.ram_yspeedlo < 0x0140 then
				return
			end
		end
	end

	-- code_bfa73e:
	-- lda.w !ram_dkc1_norspr_ramtable1271lo,x / bmi.b code_bfa72b
	if to_signed_16(self.ram_ramtable1271lo) < 0 then
		return
	end

	-- lda.w !ram_dkc1_norspr_ramtable12a5lo,x / and.w #$0001 / beq.b code_bfa752
	if (self.ram_ramtable12a5lo & 0x0001) == 0x0001 then
		return
	end

	-- code_bfa752
	local hitbox_index = 0x0009
	if self.zp_84 == 0x0004 then
		hitbox_index = 0x0012
	end
	self:code_bba4c8(hitbox_index)

	local scan_mask = 0x0003
	if self.ram_ramtable1029lo == 0x0028 then
		scan_mask = 0x0103
	end
	if not self:code_bba58d(scan_mask) then
		return
	end
	if self.zp_88 < 0x0006 then
		return
	end
	if self.ram_ramtable1271lo ~= 0 then
		local delta_y = self.zp_b0 - self.zp_ac
		if delta_y >= 0x0030 then
			return
		end
	end

	self:code_bfa86a()

	local target = self:dkc1_get_stomp_sprite_by_slot(self.zp_88)
	if target == nil then
		return
	end

	if (target.dkc1_ramtable109dlo & 0x0001) == 0 then
		self:code_bfa79c(target)
		return
	end

	if self.zp_84 == 0x0002 then
		local sid = target.dkc1_sprite_id
		if sid == define_dkc1_norspr06_klump
			or sid == define_dkc1_norspr2f_army
			or sid == define_dkc1_norspr46_bluekrusha
		then
			self:code_bfa79c(target)
			return
		end
	end

	self.ram_yspeedlo = 0x0300
	local launch_x = 0x0200
	if ((self.ram_xspeedlo ~ target.x_speed_subpx) & 0x8000) ~= 0 then
		launch_x = 0x0280
	end
	if (self.ram_yxppccctlo & 0x4000) == 0 then
		launch_x = to_unsigned_16(-to_signed_16(launch_x))
	end
	self.ram_xspeedlo = launch_x
	self.ram_ramtable0f25lo = launch_x
	self.ram_ramtable11a1lo = 0x0000
	self.ram_ramtable1029lo = 0x000F
	if (target.dkc1_ramtable11a1lo & 0x0004) ~= 0 then
		target.dkc1_ramtable1595lo = 0x0004
		target.dkc1_ramtable15c9lo = self.zp_84
		self:code_bffa6c()
		if self.ram_16d5 < 0x0010 then
			self.ram_16d5 = 0x0010
		end
	end
	self.ram_16ad = define_dkc1_animationid_dk_getoffanimalbuddy
end

function player:code_bf_rtl()
	-- explicit RTS/RTL sink for unimplemented labels in DATA_BF84C5.
end

-- CODE_BF86DE: clamp movement when camera-edge lock would be exceeded.
function player:code_bf86de()
	local xs = to_signed_16(self.ram_xspeedlo)
	if xs == 0 then
		return
	end
	if xs < 0 then
		local cmp = to_signed_16(self.ram_xposlo) - 0x0012
		if cmp < to_signed_16(self.ram_1b23) then
			self.ram_xspeedlo = 0
			self.ram_ramtable0f25lo = 0
		end
		return
	end
	local cmp = to_signed_16(self.ram_xposlo) - 0x00EE
	if cmp >= to_signed_16(self.ram_1b25) then
		self.ram_xspeedlo = 0
		self.ram_ramtable0f25lo = 0
	end
end

-- CODE_BF870D: update screen-edge collision helper bounds (BBA4D5 path).
function player:code_bf870d()
	self:code_bba4d5()
end

-- CODE_BFAA82: animation-speed routing.
function player:code_bfaa82()
	local abs_xs = abs_16(self.ram_xspeedlo)
	if self.ram_16ad == define_dkc1_animationid_dk_run then
		local v = ((abs_xs >> 3) + (abs_xs >> 4) + (abs_xs >> 5)) & 0xFFFF
		if v < 0x0060 then
			v = 0x0060
		end
		self.ram_animation_speed = v
		return
	end
	if self.ram_16ad == define_dkc1_animationid_dk_walk then
		local v = ((abs_xs >> 2) + (abs_xs >> 3)) - 0x0020
		if v < 0x0060 then
			v = 0x0060
		end
		self.ram_animation_speed = v & 0xFFFF
		return
	end
	if self.ram_16ad == define_dkc1_animationid_dk_holdjump then
		local v = (abs_xs >> 1) + (abs_xs >> 2)
		if v < 0x0100 then
			v = 0x0100
		end
		self.ram_animation_speed = v & 0xFFFF
		return
	end
	if self.ram_16ad == define_dkc1_animationid_dk_crawling
		or self.ram_16ad == define_dkc1_animationid_dk_duckintocrawlspace
	then
		local v = abs_xs + (abs_xs >> 2)
		if v < 0x00A0 then
			v = 0x00A0
		end
		self.ram_animation_speed = v & 0xFFFF
	end
end

-- CODE_BF8584 / CODE_BF8587 / CODE_BF8576 state-core movement runners.
function player:code_bf8576()
	self:code_bfb1a8()
	self:code_bfa89a()
	self:integrate_and_collide()
end

function player:code_bf8587()
	self:code_bfb1a8()
	self:code_bf858b()
end

function player:code_bf858b()
	self:code_bf86de()
	self:code_bfa89a()
	self:integrate_and_collide()
	self:code_bf870d()
	self:code_bfaa82()
	self:code_be80e1()
	self:code_bfa44a()
	self:code_bfa697()
end

function player:code_bf8584()
	self:code_bfaf38()
	self:code_bf8587()
end

-- CODE_BF8948: convert to unknown-ground-stomp when falling with $1699 bit $0010.
function player:code_bf8948()
	if (self.ram_1699 & 0x0010) == 0 then
		return
	end
	if self.ram_16ad == define_dkc1_animationid_dk_getoffanimalbuddy
		or self.ram_16ad == define_dkc1_animationid_dk_bounce
		or self.ram_16ad == define_dkc1_animationid_dk_unknowngroundstomp
	then
		return
	end
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		return
	end
	if self.ram_yspeedlo >= 0x0300 then
		return
	end
	self.ram_ramtable11a1lo = 0x00C1
	self.ram_16ad = define_dkc1_animationid_dk_unknowngroundstomp
end

-- CODE_BF888E: animal-buddy mount probe path.
function player:code_bf888e()
	if to_signed_16(self.ram_yspeedlo) >= 0 then
		return false
	end
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		return false
	end
	self:code_bba4c8(0x0001)
	if not self:code_bba58d(0x0008) then
		return false
	end
	if self.zp_88 < 0x0006 then
		return false
	end

	local yi = (self.zp_88 >> 1) + 1
	self.ram_0512 = self.zp_88 & 0xFFFF
	self.ram_0516 = self.ram_norspr_spriteidlo[yi] & 0xFFFF
	if self.ram_0516 == define_dkc1_norspr51_minecart then
		self:code_be80a4(0x0000)
		return false
	end

	self.ram_norspr_ramtable1595lo[yi] = 0x0008
	self.ram_norspr_ramtable1375lo[yi] = self.zp_84 & 0xFFFF
	self.ram_ramtable1029lo = 0x0014
	self.ram_yspeedlo = 0
	self.ram_ramtable11a1lo = 0x00C3
	self.ram_norspr_ramtable13e9lo[yi] = 0
	self.ram_norspr_ramtable145dlo[yi] = 0
	self.ram_oamzposlo = 0x00DC
	self.ram_norspr_oamzposlo[yi] = 0x00E4
	self.ram_xposlo = self.ram_norspr_xposlo[yi] & 0xFFFF
	self.ram_yposlo = self.ram_norspr_yposlo[yi] & 0xFFFF

	self.zp_76 = self.ram_norspr_yxppccctlo[yi] & 0xFFFF
	local a = ((self.ram_yxppccctlo ~ self.ram_norspr_yxppccctlo[yi]) & 0x0E00) ~ self.ram_norspr_yxppccctlo[yi]
	self.ram_norspr_ramtable0e55lo[yi] = a & 0xFFFF
	self.ram_norspr_ramtable1271lo[yi] = (self.ram_norspr_ramtable1271lo[yi] | 0x4000) & 0xFFFF
	a = ((self.zp_76 ~ self.ram_yxppccctlo) & 0x0E00) ~ self.ram_yxppccctlo
	self.ram_yxppccctlo = a & 0xFFFF
	self:code_be8092(0x0050)
	return true
end

-- CODE_BF881C: vertical-rope transition checks.
function player:code_bf881c()
	if self.ram_1afd == 0 then
		if self.ram_1b01 ~= 0 then
			local rope = self:dkc1_get_any_sprite_by_slot(self.ram_1b01)
			if rope ~= nil and rope.dkc1_sprite_id == 0x0030 then
				self.ram_1b01 = 0
			end
		end
	else
		if (self.ram_1afd ~ self.ram_1b01) == 0 then
			self.ram_1afd = 0
			return
		end
		self.ram_1b01 = self.ram_1afd
		self.ram_1afd = 0
		self.ram_ramtable1029lo = 0x0025
		self.ram_yspeedlo = 0
		self.ram_ramtable0f8dlo = 0
		self.ram_xspeedlo = 0
		self.ram_ramtable0f25lo = 0
		self.ram_16ad = define_dkc1_animationid_dk_hangontoverticalrope
		return
	end

	if self.ram_1aff == 0 then
		return
	end
	if (self.ram_1aff ~ self.ram_1b01) == 0 then
		self.ram_1aff = 0
		return
	end
	self.ram_1b01 = self.ram_1aff
	self.ram_1aff = 0
	self.ram_ramtable1029lo = 0x0026
	self.ram_yspeedlo = 0
	self.ram_ramtable0f8dlo = 0
	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
end

-- CODE_BF876C: queued external transitions ($1E2B).
function player:code_bf876c()
	local gate = self.ram_1e2b & 0xFFFF
	if gate == 0 then
		return
	end

	if gate == 0x0004 then
		self.ram_ramtable1029lo = 0x004E
		self.ram_global_screendisplayregister = 0x820F
		return
	end

	if gate == 0x0003 or gate == 0x0001 then
		if (self.ram_ramtable12a5lo & 0x0001) ~= 0x0001 then
			return
		end
		if gate == 0x0003 then
			self.ram_ramtable1029lo = 0x0055
		else
			self.ram_ramtable1029lo = 0x0011
		end
		self.ram_1e2b = 0
		self.ram_ramtable11a1lo = 0
		if (self.ram_1e15 & 0x0020) == 0 then
			self:code_bfa260()
		end
		return
	end

	if gate == 0x0002 then
		if (self.ram_ramtable12a5lo & 0x1001) ~= 0x0001 then
			return
		end
		self.ram_1e2b = 0
		self.ram_ramtable1029lo = 0x0011
		self.ram_ramtable11a1lo = 0
	end
end

-- CODE_BF874A: state $0000 main.
function player:code_bf874a()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0000
	if self:code_bfb27c() then
		return
	end
	self:code_bf8948()
	self:code_bf8584()
	self:code_bfa712()
	self:code_bfa555()
	self:code_bfa4b7()
	self:code_bf876c()
end

-- CODE_BF87F2: state $0001 main (jump/airborne).
function player:code_bf87f2()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0001
	self:code_bfb27c()
	self:code_bf8948()
	self.ram_ramtable123dlo = 0
	self:code_bf8584()
	if self:code_bf888e() then
		return
	end
	self:code_bfa712()
	self:code_bfa555()
	self:code_bf881c()
	self:code_bf876c()
end

function player:code_bf8a5d()
	local d = to_signed_16(self.ram_16b9 - self.ram_xposlo)
	if d < 0 then
		d = -d
	end
	return to_unsigned_16(d)
end

function player:code_bf8a6b()
	local d = to_signed_16(self.ram_16bd - self.ram_yposlo)
	if d < 0 then
		d = -d
	end
	return to_unsigned_16(d)
end

function player:code_bf8a79()
	self.zp_4c = self.ram_1921
	if self.zp_4c == define_dkc1_animationid_dk_bounce
		or self.zp_4c == define_dkc1_animationid_dk_incrawlspace
		or self.zp_4c == define_dkc1_animationid_dk_duckintocrawlspace
		or self.zp_4c == define_dkc1_animationid_dk_crawling
	then
		self:code_bfa9b3(define_dkc1_animationid_dk_bounce)
		return
	end
	if self.zp_4c == define_dkc1_animationid_dk_getoffanimalbuddy then
		self:code_bfa9b3(define_dkc1_animationid_dk_bounce)
	end
end

function player:code_bf8aee()
	local d = to_signed_16(self.ram_xposlo - self.ram_16b9)
	local v = abs_16(to_unsigned_16(d)) | 0x0800
	local prod = v & 0xFFFF
	if d < 0 then
		self.ram_xspeedlo = prod
		self.ram_16b9_xspeed = to_unsigned_16(-to_signed_16(prod))
	else
		self.ram_16b9_xspeed = prod
		self.ram_xspeedlo = to_unsigned_16(-to_signed_16(prod))
	end
	self.ram_yspeedlo = 0x00FF
	self.ram_16bd_yspeed = 0x00FF
	self.ram_ramtable1375lo = 0x0020
end

function player:code_bf8be4()
	if to_signed_16(self.ram_yspeedlo) >= 0 then
		return
	end
	if to_signed_16(self.ram_16bd - self.ram_yposlo) < 0 then
		return
	end
	self.ram_yposlo = self.ram_16bd
end

function player:code_bf8c67()
	local d = to_signed_16(self.ram_16b9 - self.ram_xposlo)
	self.zp_4c = to_unsigned_16(d)
	if d == 0 then
		self.ram_xspeedlo = 0
		return
	end
	self.zp_4e = abs_16(self.zp_4c)
	local s = to_unsigned_16(d << 4)
	self.ram_xspeedlo = s
end

function player:code_bf8c8e()
	local other_x = self.ram_16b9
	local d = to_unsigned_16(other_x - self.ram_xposlo)
	local v = ((d >> 1) ~ self.ram_yxppccctlo) & 0x4000
	if v ~= 0 then
		self.ram_1917 = self.ram_1917 | 0x0010
	end
end

function player:code_bf8cb0()
	if (self.ram_1917 & 0x0010) == 0 then
		return
	end
	self.ram_1917 = self.ram_1917 ~ 0x0010
	if self.zp_32 ~= 0x0003
		and self.ram_16ad ~= define_dkc1_animationid_dk_inactivejump
		and self.ram_16ad ~= define_dkc1_animationid_dk_duckintocrawlspace
		and self.ram_16ad ~= define_dkc1_animationid_dk_crawling
	then
		self:code_bfa9b3(define_dkc1_animationid_dk_turn)
		return
	end
	self.ram_yxppccctlo = self.ram_yxppccctlo ~ 0x4000
end

function player:code_bf8984()
	self.ram_ramtable1271lo = self.ram_ramtable1271lo | 0x8000
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	local other_state = self.ram_norspr_ramtable1029lo[oi] & 0xFFFF
	if other_state == 0x0026 then
		local d = abs_16((self.ram_norspr_xposlo[oi] - self.ram_xposlo) & 0xFFFF)
		if d < 0x0018 then
			self.ram_ramtable1029lo = 0x0033
			return
		end
	end
	if other_state == 0x0025 then
		local d = abs_16((self.ram_norspr_xposlo[oi] - self.ram_xposlo) & 0xFFFF)
		if d < 0x000C then
			self.ram_ramtable1029lo = 0x0034
			return
		end
	end
	if other_state == 0x0029 then
		local dx = abs_16((self.ram_norspr_xposlo[oi] - self.ram_xposlo) & 0xFFFF)
		if dx < 0x0020 then
			local dy = abs_16((self.ram_norspr_yposlo[oi] - self.ram_yposlo) & 0xFFFF)
			if dy < 0x0010 then
				self.ram_xposlo = self.ram_norspr_xposlo[oi] & 0xFFFF
				self.ram_yposlo = self.ram_norspr_yposlo[oi] & 0xFFFF
				self:code_bcb872()
				self.ram_ramtable1029lo = 0x0035
				return
			end
		end
	end
	if other_state == 0x002F or other_state == 0x0040 then
		self.ram_1917 = self.ram_1917 | 0x0020
	end
	self:code_bfc42d()
	self:code_bf8cb0()
	self:code_bf8a79()
	if (self.ram_16cd & 0x0001) ~= 0 then
		self.ram_16cd = self.ram_16cd ~ 0x0001
		self:code_be80a4(define_dkc1_animationid_dk_inactivejump)
	end
	self.ram_animation_speed = 0x0100
	self:code_be80e1()
	self:code_bfa8b5()
	self.ram_1917 = self.ram_1917 & 0xFFFC
	if self.ram_ramtable1631lo == 0 and (self.ram_0579 & 0x2000) ~= 0 then
		self:code_be80a4(define_dkc1_animationid_dk_idle)
		self.ram_ramtable1029lo = 0x000C
	end
end

function player:code_bf8ac8()
	if to_signed_16(self.ram_ramtable1375lo) < 0 then
		self:code_bfc0d0()
		self:code_bf8aee()
		return
	end
	self:code_bfaf38()
	self:code_bfaf9b()
	self:code_bfafc9()
	self:code_bf8be4()
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if self.ram_ramtable1375lo ~= 0 then
		self:code_be80e1()
		return
	end
	self.ram_16e5 = 0
	self.ram_16e7 = 0
	self.ram_ramtable1029lo = 0
	self.ram_1929 = 0
	self.ram_1699 = self.ram_1699 & 0xFFF7
	self:code_bcb872()
end

function player:code_bf8bcc()
	if to_signed_16(self.ram_ramtable1375lo) < 0 then
		return
	end
	self:code_bfaf38()
	self:code_bfaf9b()
	self:code_bfafc9()
	self:code_bf8be4()
	self:code_be80e1()
end

function player:code_bf8bfd()
	self.ram_ramtable1271lo = self.ram_ramtable1271lo | 0x8000
	self:code_bfaf38()
	self:code_bf8c67()
	if (self.zp_4e >> 3) == 0 then
		self:code_bf8c8e()
	end
	self:code_bf8cb0()
	self:code_bffb7f()
	local d = abs_16(to_unsigned_16(self.ram_16b9 - self.ram_xposlo))
	if d < 0x001C then
		d = 0x0003
	end
	self:code_be80e1()
	if self.ram_1927 ~= self.ram_1813 then
		self.ram_ramtable1029lo = 0x0006
		self:code_bcb82a()
		return
	end
	self.ram_1699 = self.ram_1699 & 0xFFF7
	self.ram_ramtable1029lo = 0x0002
	if self.ram_ramtable1631lo == 0 and (self.ram_0579 & 0x2000) ~= 0 then
		self:code_be80a4(define_dkc1_animationid_dk_idle)
		self.ram_ramtable1029lo = 0x000C
	end
end

function player:code_bf8cef()
	self.ram_ramtable1271lo = self.ram_ramtable1271lo | 0x8000
	local idx = self.ram_1811
	self.ram_16b9 = self.ram_1815[idx + 1]
	self.ram_16bd = self.ram_1855[idx + 1]
	self:code_bfa9bf()
	self:code_bfaf9b()
	self:code_bfafc9()
	local dx = to_unsigned_16(self.ram_16b9 - self.ram_xposlo)
	local dy = to_unsigned_16(self.ram_16bd - self.ram_yposlo)
	if (dx | dy) ~= 0 then
		self:code_be80e1()
		return
	end
	self.ram_1699 = self.ram_1699 & 0xFFF7
	self.ram_ramtable1029lo = 0x0002
end

function player:code_bf8dbf(prev_x)
	local d = abs_16(to_unsigned_16(prev_x - self.ram_xposlo))
	if d >= 0x0004 then
		self.ram_ramtable1375lo = 0
		return
	end
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo + 1)
end

function player:code_bf8dd8()
	self.ram_ramtable1029lo = 0x000C
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
	self.ram_ramtable11a1lo = 0
end

function player:code_bf8d5f()
	self.ram_0579 = self.ram_0579 | 0x0002
	if self:code_bdf7d0() then
		self:code_bf8dd8()
		return
	end
	self.ram_ramtable11a1lo = 0
	if (self.ram_ramtable12a5lo & 0x0002) ~= 0 then
		self.ram_yspeedlo = 0x0800
		self.ram_xspeedlo = 0x0400
		self.ram_ramtable0f25lo = 0x0400
	end
	self:code_bfaf4e()
	local prev_x = self.ram_xposlo
	self:code_bf8587()
	self:code_bf8dbf(prev_x)
	if self.ram_ramtable1375lo < 0x0008 then
		return
	end
	self.ram_yspeedlo = 0
	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0054
	self:code_be80a4(define_dkc1_animationid_dk_jumpaway)
end

function player:code_bf8ef4()
	self:code_be80e1()
	self:code_bfa44a()
end

function player:code_bf8dea()
	self:code_bfa9bf()
	self:code_bfaf9b()
	self:code_bfafc9()
	if self.zp_32 == 0x0003 then
		self:code_bf8ef4()
		return
	end
	local xs = abs_16(self.ram_xspeedlo)
	local ys = abs_16(self.ram_yspeedlo)
	if ((xs | ys) & 0xFFE0) ~= 0 then
		self:code_be80e1()
		self:code_bfa44a()
		self.ram_ramtable11a1lo = 0
		return
	end
	self.ram_16e5 = 0
	self.ram_16e7 = 0
	self.ram_ramtable11a1lo = 0x00C0
	self.ram_xposlo = self.ram_16b9
	self.ram_ramtable0db9lo = 0x8000
	self.ram_yposlo = self.ram_16bd
	self.ram_ramtable0e21lo = 0x8000
	self:code_be80a4(define_dkc1_animationid_dk_jump)
	self.ram_0579 = self.ram_0579 & 0xFFFE
	self.ram_ramtable1029lo = 0x0001
	self.ram_1929 = 0
	self.ram_1699 = self.ram_1699 & 0xFFF7
	self.ram_yspeedlo = 0x0A00
	self.ram_1b01 = 0
	self:code_b880ce()
	if self.zp_42 == 0x0001 then
		self.ram_ramtable1029lo = 0x0053
		self.ram_ramtable1375lo = self.ram_currentposelo
		self.ram_ramtable14c5lo = 0
		self.ram_1929 = 0x0003
	end
end

function player:code_bf9309(slot_x)
	local x = slot_x or (self.zp_84 & 0xFFFF)
	local i = (x >> 1) + 1
	local v = self.ram_slot_yxppccctlo[i]
	v = ((v & 0xCFFF) | 0x2000) & 0xFFFF
	self.ram_slot_yxppccctlo[i] = v
	if x == (self.zp_84 & 0xFFFF) then
		self.ram_yxppccctlo = v
	end
end

function player:code_bf92e5()
	self:code_bf9309(0x0002)
	self:code_bf9309(0x0004)
	self:code_809b9c()
	if self.ram_0512 ~= 0 then
		self:code_bf9309(self.ram_0512 & 0xFFFF)
	end
end

function player:code_bf92c5()
	self.ram_1699 = self.ram_1699 & 0xFFFB
	if self.ram_0512 == 0 then
		self:code_be80a4(define_dkc1_animationid_dk_walk)
	else
		self:code_be8092(define_dkc1_animationid_rambiriddenbydk_walk)
	end
end

function player:code_bf9276()
end

function player:code_bf91db()
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		self:code_bf91fc()
		return
	end
	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x001C
	self:code_be80a4(define_dkc1_animationid_dk_unknownbonusroomexit)
end

function player:code_bf91fc()
	self:code_bf92e5()
	self.ram_xspeedlo = 0x0200
	self.ram_ramtable0f25lo = 0x0200
	self:code_bf92c5()
	self.ram_ramtable1029lo = 0x001D
	self:code_bfa260()
end

function player:code_bf9288()
	if (self.ram_global_screendisplayregister & 0x000F) ~= 0 then
		return
	end
	self:code_b88383()
end

function player:code_bf91d1()
	self.ram_1929 = 0x0001
	self:code_bf91fc()
end

function player:code_bf9217()
	if (self.ram_ramtable12a5lo & 0x0001) == 0 then
		self:code_bf8584()
		return
	end
	self:code_bf92e5()
	self.ram_xspeedlo = 0x0200
	self.ram_ramtable0f25lo = 0x0200
	self:code_bf92c5()
	self.ram_ramtable1029lo = 0x001D
end

function player:code_bf923c()
	self.ram_xspeedlo = 0x0200
	self.ram_ramtable0f25lo = 0x0200
	self.ram_yspeedlo = 0x0020
	self:code_bf8576()
	self:code_be80d2()
	local rel = to_unsigned_16(self.ram_xposlo - self.ram_layer1xposlo)
	if rel < 0x00F0 then
		return
	end
	self:code_bf9276()
	self.ram_ramtable1029lo = 0x001E
	self.ram_global_screendisplayregister = 0x820F
end

function player:code_bf9277()
	self.ram_yspeedlo = 0
	self:code_bf8576()
	self:code_be80d2()
	self:code_bf9288()
end

function player:code_bf9296()
	local s = 0x0200
	if (self.ram_ramtable145dlo & 0x0001) ~= 0 then
		s = to_unsigned_16(-to_signed_16(s))
	end
	self.ram_xspeedlo = s
	self.ram_ramtable0f25lo = s
	self:code_bf92c5()
	self.ram_ramtable1029lo = 0x0020
	self:code_bf92e5()
	self:code_bfa260()
	self.ram_ramtable11a1lo = 0
end

function player:code_bf9316()
	self.ram_yspeedlo = 0
	self:code_bf8576()
	self:code_be80d2()
	self.ram_ramtable11a1lo = 0
end

function player:code_bf9329()
	if self:code_bfa0f7() then
		return
	end
	self.ram_ramtable0f25lo = 0
	local next_ys = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFFD0)
	if next_ys < 0 and next_ys < to_signed_16(0xFB00) then
		next_ys = to_signed_16(0xFB00)
	end
	self.ram_yspeedlo = to_unsigned_16(next_ys)
	self:code_bf8587()
end

function player:code_bf9351()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0008
	self:code_bfb27c()
	self:code_bf8948()
	self:code_bf8584()
	self:code_bfa712()
	self:code_bfa555()
	self:code_bf876c()
end

function player:code_bfa095()
	if self.ram_1b01 == 0 then
		return
	end
	local rope = self:dkc1_get_any_sprite_by_slot(self.ram_1b01)
	if rope == nil then
		return
	end
	local v = to_signed_16(rope.dkc1_ramtable14c5lo + self.ram_ramtable0f8dlo)
	if v < 0 then
		return
	end
	local rel = to_signed_16(self.zp_4a - self.ram_yposlo - self.ram_layer1yposlo - 0x0028)
	if rel >= 0 then
		return
	end
	self.ram_ramtable0f8dlo = 0
	self.ram_yposlo = to_unsigned_16(self.ram_yposlo + rel)
end

function player:code_bfa0be()
	if self.ram_1b01 == 0 then
		return
	end
	local rope = self:dkc1_get_any_sprite_by_slot(self.ram_1b01)
	if rope == nil then
		return
	end
	local d = to_signed_16(self.ram_yposlo - rope.y + 0x0018)
	if d < 0 then
		self:code_bf952b()
	end
end

function player:code_bf936e()
	self.ram_1699 = self.ram_1699 & 0xFFFD
	self.ram_xposlo = self.ram_ramtable1491lo & 0xFFFF
	self.ram_yposlo = self.ram_ramtable14c5lo & 0xFFFF
	self:code_bfa02c()
	self:code_bcb872()
	self.ram_1929 = 0
	if ((self.ram_0579 & 0x0800) ~= 0) then
		self.ram_0579 = (self.ram_0579 ~ 0x0800) & 0xFFFF
		if self.ram_player_currentkonglo ~= 0 then
			self.ram_player_currentkonglo = (self.ram_player_currentkonglo ~ 0x0003) & 0xFFFF
		end
		self:code_bfa49a()
		self.ram_yspeedlo = 0
		self.ram_xspeedlo = 0
		self.ram_ramtable0f25lo = 0
		self.ram_0579 = self.ram_0579 & 0xFFFE
		self.ram_ramtable1029lo = 0x0001
		self:code_be80a4(define_dkc1_animationid_dk_jump)
		return
	end
	self.ram_yspeedlo = 0
	if self.zp_32 ~= 0x0003 then
		self:code_be80a4(define_dkc1_animationid_dk_idle)
	else
		self:code_be80a4(define_dkc1_animationid_dk_swimming)
	end
end

function player:code_bf93e9()
	self.ram_ramtable1271lo = self.ram_ramtable1271lo | 0x8000
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if to_signed_16(self.ram_ramtable1375lo) < 0 then
		self:code_bf936e()
		return
	end
	self.ram_xspeedlo = to_unsigned_16(to_signed_16(self.ram_xspeedlo) + to_signed_16(self.ram_ramtable0f25lo))
	self.ram_xposlo = to_unsigned_16(self.ram_16b9 + (to_signed_16(self.ram_xspeedlo) >> 5))
	self.ram_yspeedlo = to_unsigned_16(to_signed_16(self.ram_yspeedlo) + to_signed_16(self.ram_ramtable0f8dlo))
	self.ram_yposlo = to_unsigned_16(self.ram_16bd + (to_signed_16(self.ram_yspeedlo) >> 5))
	local v = to_signed_16(self.ram_ramtable145dlo + 0xFFA0)
	if v < to_signed_16(0xFA00) then
		v = to_signed_16(0xFA00)
	end
	self.ram_ramtable145dlo = to_unsigned_16(v)
	self.ram_ramtable13e9lo = to_unsigned_16(to_signed_16(self.ram_ramtable13e9lo) + v)
	self:code_be80e1()
end

function player:code_bf9492()
	self:code_bf8576()
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
	if self.ram_0512 ~= 0 then
		local i = ((self.ram_0512 & 0xFFFF) >> 1) + 1
		self.ram_norspr_displayedposelo[i] = 0
		self.ram_norspr_currentposelo[i] = 0
		self.ram_norspr_animationspeedlo[i] = 0
	end
end

function player:code_bf94b3()
	if self:code_bfa0f7() then
		return
	end
	self.ram_0579 = self.ram_0579 | 0x0088
	local rope_slot = self.ram_1b01 & 0xFFFF
	local ri = (rope_slot >> 1) + 1
	if self.ram_norspr_spriteidlo[ri] ~= define_dkc1_norspr30_verticalrope then
		self:code_bf952b()
		return
	end
	self.ram_xposlo = self.ram_norspr_xposlo[ri] & 0xFFFF
	self:code_bfa0be()
	self.ram_180f = 0x0009
	self:code_bfb27c()
	self:code_bfb1e5(0x0000)
	self:code_bfa095()
	self.ram_ramtable13e9lo = self.ram_ramtable0f25lo
	self.ram_ramtable0f25lo = 0
	local keep = self.ram_yspeedlo
	if rope_slot ~= 0 then
		self.ram_yspeedlo = to_unsigned_16(self.ram_yspeedlo + (self.ram_norspr_ramtable14c5lo[ri] & 0xFFFF))
	end
	self:code_bf8587()
	self.ram_yspeedlo = keep
	self.ram_1a69 = 0
	if rope_slot ~= 0 and self.ram_norspr_ramtable152dlo[ri] == 0x0002 and to_signed_16(self.ram_norspr_xspeedlo[ri]) >= 0 then
		self.ram_1a69 = 0x0050
	end
end

function player:code_bf9538()
	if self:code_bfa0f7() then
		return
	end
	self.ram_0579 = self.ram_0579 | 0x0080
	local rope_slot = self.ram_1b01 & 0xFFFF
	local ri = (rope_slot >> 1) + 1
	if self.ram_norspr_spriteidlo[ri] ~= define_dkc1_norspr31_swingingrope then
		self:code_bf9584()
		return
	end
	self.ram_animationspeedlo = 0
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	self.ram_180f = 0x000A
	self:code_bfb27c()
	local prev_x = self.ram_xposlo
	self:code_bf8587()
	local dx = to_signed_16(prev_x - self.ram_xposlo)
	self.ram_1a69 = to_unsigned_16(dx << 1)
	self:code_bf876c()
	self.ram_1a69 = 0
end

function player:code_bf9584()
	self.ram_ramtable1029lo = 0
end

function player:code_bf9638()
	if self.zp_32 == 0x0003 then
		if self:code_bfa38f() then
			return
		end
	else
		if self:code_bfa0f7() then
			return
		end
	end
	self.ram_1811 = ((self.ram_1813 - 2) & 0x003F)
	self.ram_0579 = self.ram_0579 | 0x0088
	if to_signed_16(self.ram_ramtable13e9lo) >= 0 then
		self.ram_ramtable13e9lo = to_unsigned_16(self.ram_ramtable13e9lo - 1)
	else
		self.ram_180f = 0x000E
		self:code_bfb27c()
	end
	if to_signed_16(self.ram_ramtable1375lo) >= 0 then
		self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	else
		if self.zp_32 == 0x0003 then
			self:code_bfaf69()
			self.ram_ramtable11d5lo = 0x0002
			self:code_bfb18c()
		else
			self:code_bfaf38()
			self:code_bfb21f(0x0002)
		end
	end
	if self.zp_32 == 0x0003 then
		self:code_bf8667()
	else
		self:code_bf858b()
	end
	self.ram_1a69 = 0
	if self.ram_0512 == 0 then
		self:code_bfa712()
		self:code_bf876c()
	else
		self:code_bf90b3()
		self:code_bf876c()
	end
end

function player:code_bf96d3()
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
	self.ram_ramtable11a1lo = 0
	self.ram_16e5 = 0
	if self.ram_0512 ~= 0 then
		local b = self:dkc1_get_any_sprite_by_slot(self.ram_0512)
		if b ~= nil then
			b.dkc1_currentposelo = 0
			b.dkc1_displayedposelo = 0
			b.dkc1_animationspeedlo = 0
		end
	end
	self.ram_ramtable12a5lo = 0
	self.ram_ramtable1631lo = 0x0001
	self.ram_1699 = (self.ram_1699 | 0x0200) & 0xFF7F
	self.ram_0579 = self.ram_0579 | 0x0008
	self.ram_180f = 0x000D
	self:code_bfb27c()
	self:code_bba4c8(0x000C)
	self:code_bf8711()
end

function player:code_bf9729()
	if self:code_bfa0f7() then
		return
	end
	self.ram_0579 = self.ram_0579 | 0x0008
	if (self.zp_28 & 0x0001) ~= 0 then
		self:code_b5801c()
	end
	self:code_bf858b()
	self.ram_1a69 = 0
	local rel = to_signed_16(self.zp_4a - self.ram_yposlo - self.ram_layer1yposlo)
	if rel < 0 then
		self.ram_ramtable1029lo = 0x0049
		self.ram_global_screendisplayregister = 0x820F
	end
end

function player:code_bf9763()
	if self:code_bfa38f() then
		return
	end
	self.ram_180f = 0x000F
	self:code_bfb27c()
	self:code_bf8658()
	self:code_bf876c()
end

function player:code_bf9799()
	if self.ram_ramtable145dlo ~= 0 then
		if (self.ram_ramtable145dlo & 0x7FFF) == 0 then
			self.ram_ramtable145dlo = 0x000C
		elseif self.ram_ramtable145dlo >= 0x0008 then
			self.ram_ramtable145dlo = to_unsigned_16(self.ram_ramtable145dlo - 1)
		else
			self.ram_ramtable145dlo = to_unsigned_16(self.ram_ramtable145dlo - 1)
			local n = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFF90)
			if n < 0 and n < to_signed_16(0xFD00) then
				n = to_signed_16(0xFD00)
			end
			self.ram_yspeedlo = to_unsigned_16(n)
			return
		end
		if to_signed_16(self.ram_yspeedlo) < 0 then
			self.ram_yspeedlo = 0
		end
		return
	end
	local n = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFF90)
	if n < 0 and n < to_signed_16(0xFD00) then
		n = to_signed_16(0xFD00)
	end
	self.ram_yspeedlo = to_unsigned_16(n)
end

function player:code_bf9776()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x000C
	self:code_bfb27c()
	self.ram_1699 = self.ram_1699 | 0x0200
	self.ram_ramtable123dlo = 0
	self:code_bf9799()
	self:code_bf8587()
end

function player:code_bf97d6()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0000
	self:code_bfb27c()
	self:code_bf9799()
	self:code_bfb191(0x0006)
	self:code_bf858b()
end

function player:code_bf97f2()
	if self:code_bfa0f7() then
		return
	end
	self.ram_0579 = self.ram_0579 | 0x0080
	self.ram_1699 = self.ram_1699 | 0x0200
	self.ram_yspeedlo = 0xF000
	self.ram_xspeedlo = 0
	self.ram_180f = 0x0010
	self:code_bfb27c()
	self:code_bba4c8(0x000C)
	self:code_bf8711()
	self:code_bfa44a()
	self:code_bfa697()
	self:code_bf876c()
end

function player:code_bf9835()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0001
	self:code_bfb27c()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	self:code_bf8948()
	self.ram_ramtable123dlo = 0
	self:code_bf8584()
	self:code_bfa712()
	self:code_bfa041()
	self:code_bf881c()
end

function player:code_bf988a()
	self:code_bba4c8(0x000F)
	if not self:code_bba58d(0x0022) then
		return
	end
	self:code_bf98ac()
end

function player:code_bf98ac()
	if self.ram_16ad == define_dkc1_animationid_enguarderiddenbydk_stab then
		return
	end
	self:code_be8092(define_dkc1_animationid_rambiriddenbydk_stab)
	self.ram_yspeedlo = 0
	self.ram_ramtable1029lo = 0x004C
	if self.ram_ramtable0f25lo ~= 0 then
		local v = ((self.ram_ramtable0f25lo >> 1) ~ self.ram_yxppccctlo) & 0x4000
		self.ram_yxppccctlo = self.ram_yxppccctlo ~ v
	end
end

function player:code_bf9862()
	if self:code_bfa38f() then
		return
	end
	self.ram_180f = 0x0011
	self:code_bfb27c()
	self.ram_ramtable11d5lo = 0x0002
	self:code_bfb18c()
	self:code_bfb1e5(0x0002)
	self:code_bf8667()
	self:code_bf988a()
	self:code_bf876c()
end

function player:code_bf98f7()
	self.ram_yxppccctlo = 0x3000
	if self.zp_32 == 0x0007 then
		self.ram_yxppccctlo = 0x2000
	end
	if self.ram_0512 ~= 0 then
		local bi = ((self.ram_0512 & 0xFFFF) >> 1) + 1
		self.ram_norspr_yxppccctlo[bi] = (self.ram_norspr_yxppccctlo[bi] | self.ram_yxppccctlo) & 0xFFFF
	end
	self.ram_1929 = 0
	self.ram_ramtable1029lo = 0
	self.ram_yxppccctlo = (self.ram_yxppccctlo | self.ram_yxppccctlo) & 0xFFFF
	self.ram_ramtable1631lo = 0
	self.ram_yspeedlo = 0xFE0C
	self:code_bffb7f()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_yxppccctlo[oi] = (self.ram_norspr_yxppccctlo[oi] | self.ram_yxppccctlo) & 0xFFFF
	if self.ram_norspr_ramtable1029lo[oi] == 0x0032 then
		self:code_bfa02c()
		self.ram_norspr_ramtable1631lo[oi] = 0
		local keep = self.zp_84
		self.zp_84 = other_slot
		self.ram_norspr_yspeedlo[oi] = 0xFE0C
		self.zp_84 = keep
		self:code_bcb872()
	end
end

function player:code_bf98db()
	self:code_bfb075()
	self:code_be80e1()
	local rel = to_signed_16(self.ram_xposlo - self.ram_layer1xposlo)
	if rel < 0 or rel < to_signed_16(self.ram_ramtable1375lo) then
		return
	end
	self:code_bf98f7()
end

function player:code_bf996b()
	self:code_bfb075()
	self:code_be80e1()
end

function player:code_bf9973()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_ramtable1271lo[oi] = (self.ram_norspr_ramtable1271lo[oi] | 0x8000) & 0xFFFF
	if self.ram_norspr_ramtable1029lo[oi] == 0x0026 then
		local v = (self.ram_norspr_yxppccctlo[oi] ~ self.ram_yxppccctlo) & 0x4000
		self.ram_yxppccctlo = self.ram_yxppccctlo ~ v
		return
	end
	self.ram_ramtable1029lo = 0x0002
	self:code_be80a4(define_dkc1_animationid_dk_inactivejump)
	self:code_bcb872()
end

function player:code_bf99ac()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_ramtable1271lo[oi] = (self.ram_norspr_ramtable1271lo[oi] | 0x8000) & 0xFFFF
	if self.ram_norspr_ramtable1029lo[oi] ~= 0x0025 then
		self.ram_ramtable1029lo = 0x0002
		self:code_be80a4(define_dkc1_animationid_dk_inactivejump)
		self:code_bcb872()
		return
	end
	local v = (self.ram_norspr_yxppccctlo[oi] ~ self.ram_yxppccctlo) & 0x4000
	self.ram_yxppccctlo = self.ram_yxppccctlo ~ v
	self.ram_xposlo = self.ram_norspr_xposlo[oi] & 0xFFFF
	self.ram_yposlo = self.ram_norspr_yposlo[oi] & 0xFFFF
	if self.zp_84 ~= 0x0002 then
		local pose = (self.ram_norspr_currentposelo[oi] - 0x0714) & 0xFFFF
		if pose < 0x0018 then
			self.ram_currentposelo = (pose + 0x0DC0) & 0xFFFF
			return
		end
	else
		local pose = (self.ram_norspr_currentposelo[oi] - 0x0DC0) & 0xFFFF
		if pose < 0x0018 then
			self.ram_currentposelo = (pose + 0x0714) & 0xFFFF
			return
		end
	end
	local buddy_anim = self.ram_16ad & 0xFFFF
	if buddy_anim ~= define_dkc1_animationid_dk_climbupverticalrope
		and buddy_anim ~= define_dkc1_animationid_dk_climbdownverticalrope
	then
		return
	end
	self:code_bfa9b3(buddy_anim)
	self:code_be80e1()
end

function player:code_bf9a3c()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_ramtable1271lo[oi] = (self.ram_norspr_ramtable1271lo[oi] | 0x8000) & 0xFFFF
	if self.ram_norspr_ramtable1029lo[oi] == 0x0029 then
		self.ram_currentposelo = 0
		return
	end
	self.ram_xposlo = self.ram_norspr_xposlo[oi] & 0xFFFF
	self.ram_yposlo = self.ram_norspr_yposlo[oi] & 0xFFFF
	self.ram_ramtable1029lo = 0x0002
	self:code_be80a4(define_dkc1_animationid_dk_bounce)
	self:code_bcb872()
	self.ram_currentposelo = 0
	self.ram_displayedposelo = 0
end

function player:code_bf9a7d()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_ramtable1271lo[oi] = (self.ram_norspr_ramtable1271lo[oi] | 0x8000) & 0xFFFF
	self:code_bfc501()
	self:code_bf8cb0()
	self:code_be80e1()
	self.ram_1917 = self.ram_1917 & 0xFFFC
end

function player:code_bf9b1a()
	local x = self.zp_84 & 0xFFFF
	local i = (x >> 1) + 1
	local y = (x - 2) & 0xFFFF
	self.ram_norspr_xposlo[i] = self.ram_16b9
	self.ram_norspr_yposlo[i] = self.ram_16bd
	self.ram_norspr_xspeedlo[i] = 0
	self.ram_norspr_yspeedlo[i] = 0
end

function player:code_bf9af3()
	local keep_84 = self.zp_84
	local x = 0x0002
	while true do
		local i = (x >> 1) + 1
		self.ram_norspr_xspeedlo[i] = 0
		self.zp_84 = x
		self:code_be80a4(define_dkc1_animationid_dk_swimming)
		if x == 0x0004 then
			break
		end
		x = 0x0004
	end
	self.zp_84 = keep_84
end

function player:code_bf9a9a()
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if to_signed_16(self.ram_ramtable1375lo) >= 0 then
		self:code_bfb075()
		self:code_be80e1()
		return
	end
	self.ram_ramtable11a1lo = 0x00C1
	self:code_bf9b1a()
	self.ram_ramtable1029lo = 0x002B
	local z0 = self.ram_oamzposlo & 0xFFFF
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.zp_84 = other_slot
	self:code_bf9b1a()
	self:code_bfa02c()
	local z1 = self.ram_norspr_oamzposlo[oi] & 0xFFFF
	self.ram_norspr_oamzposlo[oi] = z0
	self.zp_84 = (other_slot ~ 0x0006) & 0xFFFF
	self.ram_oamzposlo = z1
	self.ram_1929 = 0
	self.ram_1699 = (self.ram_1699 & 0xFFF7) & 0xFFFF
	self:code_bf9af3()
	self:code_bcb872()
end

function player:code_bf9b31()
	self:code_bfb075()
	self:code_be80e1()
end

function player:code_bf9b39()
	self.ram_0579 = self.ram_0579 | 0x0002
	if not self:code_bdf7d0() then
		self.ram_xspeedlo = 0x0400
		self.ram_ramtable0f25lo = 0x0400
		self:code_bfb075()
		self:code_bf8670()
		return
	end
	self.ram_ramtable1029lo = 0x000C
	self.ram_currentposelo = 0
	self.ram_ramtable11a1lo = 0
end

function player:code_bf9b66()
	self.ram_0579 = self.ram_0579 | 0x0002
	self:code_bf8658()
end

function player:code_bf9bba()
	if self.ram_0512 == 0 then
		self:code_bfa9b3(define_dkc1_animationid_dk_swimming)
	else
		self:code_be8092(define_dkc1_animationid_rambiriddenbydk_walk)
	end
end

function player:code_bf9b9a()
	self.ram_1929 = 0x0001
	self:code_bf92e5()
	self.ram_xspeedlo = 0x0100
	self.ram_ramtable0f25lo = 0x0100
	self:code_bf9bba()
	self.ram_ramtable1029lo = 0x003D
end

function player:code_bf9bcf()
	self.ram_xspeedlo = 0x0200
	self.ram_ramtable0f25lo = 0x0200
	self.ram_yspeedlo = 0x0020
	self:code_bfb075()
	self:code_be80d2()
	local rel = to_unsigned_16(self.ram_xposlo - self.ram_layer1xposlo)
	if rel < 0x0100 then
		return
	end
	self.ram_ramtable1029lo = 0x003E
	self:code_bf9276()
	self.ram_global_screendisplayregister = 0x820F
end

function player:code_bf9c04()
	self.ram_yspeedlo = 0
	self:code_bfb075()
	self:code_bf9288()
end

function player:code_bf9c28()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0001
	self:code_bfb27c()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	self.ram_ramtable123dlo = 0
	self:code_bf8584()
	self:code_bfa712()
	self:code_bf881c()
end

function player:code_bf9c86(state_id)
	self.ram_ramtable1029lo = state_id & 0xFFFF
	local keep = self.zp_84
	self.zp_84 = (self.zp_84 - 2) & 0xFFFF
	self:code_be80a4(define_dkc1_animationid_dk_lookup)
	self.zp_84 = keep
end

function player:code_bf9c4f()
	self:code_bfb075()
	self:code_be80e1()
	local rel = to_signed_16(self.ram_xposlo - self.ram_layer1xposlo)
	if rel < 0 or rel < 0x0080 then
		return
	end
	self:code_bf98f7()
	self:code_bf9c86(0x0042)
	if (self.ram_0579 & 0x0001) ~= 0 then
		local keep = self.zp_84
		self.zp_84 = (self.zp_84 ~ 0x0006) & 0xFFFF
		self:code_bf9c86(0x0043)
		self.zp_84 = keep
	end
end

function player:code_bf9ca2()
	self:code_be80e1()
end

function player:code_bf9ca7()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_ramtable1271lo[oi] = (self.ram_norspr_ramtable1271lo[oi] | 0x8000) & 0xFFFF
	self:code_be80e1()
end

function player:code_bf9cb5()
	self:code_be80d2()
	self:code_bf9288()
end

function player:code_bf9cbd()
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if to_signed_16(self.ram_ramtable1375lo) < 0 then
		self:code_808131()
		return
	end
	if self.ram_ramtable1375lo == 0x0040 then
		self:code_b6a868()
	end
	self:code_be80e1()
end

function player:code_bf9d30()
	self.ram_yxppccctlo = 0x3000
	if self.zp_32 == 0x000C or self.zp_32 == 0x0007 then
		self.ram_yxppccctlo = 0x2000
	end
	if self.ram_0512 ~= 0 then
		local bi = ((self.ram_0512 & 0xFFFF) >> 1) + 1
		self.ram_norspr_yxppccctlo[bi] = (self.ram_norspr_yxppccctlo[bi] | self.ram_yxppccctlo) & 0xFFFF
		self.ram_ramtable1029lo = 0x0014
	else
		self.ram_ramtable1029lo = 0
	end
	self.ram_1929 = 0
	self.ram_yxppccctlo = (self.ram_yxppccctlo | self.ram_yxppccctlo) & 0xFFFF
	self.ram_ramtable1631lo = 0
	self.ram_yspeedlo = 0xFE0C
	self:code_bffb7f()
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	self.ram_norspr_yxppccctlo[oi] = (self.ram_norspr_yxppccctlo[oi] | self.ram_yxppccctlo) & 0xFFFF
	if self.ram_norspr_ramtable1029lo[oi] == 0x0032 then
		local keep = self.zp_84
		self:code_bfa02c()
		self.ram_norspr_ramtable1631lo[oi] = 0
		self.zp_84 = other_slot
		self.ram_norspr_yspeedlo[oi] = 0xFE0C
		self.zp_84 = keep
		self:code_bcb864()
	end
end

function player:code_bf9cda()
	local s = self.ram_xspeedlo
	local v = ((s >> 1) ~ self.ram_yxppccctlo) & 0x4000
	self.ram_yxppccctlo = self.ram_yxppccctlo ~ v
	local other_slot = (self.zp_84 ~ 0x0006) & 0xFFFF
	local oi = (other_slot >> 1) + 1
	local v2 = ((s >> 1) ~ self.ram_norspr_yxppccctlo[oi]) & 0x4000
	self.ram_norspr_yxppccctlo[oi] = self.ram_norspr_yxppccctlo[oi] ~ v2
	self:code_bfb075()
	self:code_bfaa82()
	self:code_be80e1()
	local x = to_signed_16(self.ram_xposlo)
	local limit = to_signed_16(self.ram_ramtable1375lo)
	if to_signed_16(self.ram_xspeedlo) < 0 then
		if x >= to_signed_16(0xFC00) or x >= limit then
			return
		end
	else
		if x >= to_signed_16(0xFC00) or x <= limit then
			return
		end
	end
	self:code_bf9d30()
end

function player:code_bf9db1()
	self.ram_1a69 = 0x0030
end

function player:code_bf9db8()
	if self:code_bfa0f7() then
		return
	end
	self.ram_1811 = ((self.ram_1813 - 2) & 0x003F)
	self:code_bfb075()
	self.ram_ramtable12a5lo = 0
	self:code_be80e1()
	self.ram_1a69 = 0
	self.ram_ramtable145dlo = to_unsigned_16(self.ram_ramtable145dlo - 1)
	if to_signed_16(self.ram_ramtable145dlo) < 0 then
		self.ram_ramtable1029lo = 0x0028
	end
end

function player:code_bf9de6()
	self.ram_yspeedlo = 0
	self:code_bf8576()
	self:code_be80d2()
	if (self.ram_global_screendisplayregister & 0x000F) ~= 0 then
		return
	end
	self:code_b88383()
end

function player:code_bf9e00()
	if self:code_bfa38f() then
		return
	end
	self:code_bf8658()
end

function player:code_bf9e09()
	self.ram_0579 = self.ram_0579 | 0x0002
	local n = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFF90)
	if n < 0 and n < to_signed_16(0xFA00) then
		n = to_signed_16(0xFA00)
	end
	self.ram_yspeedlo = to_unsigned_16(n)
	self:code_bf865b()
end

function player:code_bf9e2b()
	if self:code_bfa38f() then
		return
	end
	self.ram_ramtable11d5lo = 0x0002
	self:code_bfb18c()
	self:code_bfb1e5(0x0002)
	self:code_bf8667()
end

function player:code_bf9e66()
	self:code_bba4c8(0x0010)
	if not self:code_bba58d(0x0022) then
		return
	end
	if self.zp_88 < 0x0006 then
		return
	end
	if self.zp_88 == self.ram_0512 then
		return
	end
	local yi = ((self.zp_88 & 0xFFFF) >> 1) + 1
	self.ram_yspeedlo = 0
	self.ram_norspr_ramtable1595lo[yi] = 0x0001
	local xs = to_unsigned_16((self.ram_xspeedlo << 1) & 0xFFFF)
	self.ram_norspr_xspeedlo[yi] = xs
	self.ram_norspr_ramtable0f25lo[yi] = xs
	self:code_b5802f()
	self:code_bffb09(define_dkc1_soundid_animalbuddyjump)
end

function player:code_bf9e47()
	if self:code_bfa38f() then
		return
	end
	self.ram_ramtable11d5lo = 0x0002
	self:code_bfb18c()
	self:code_bfb1e5(0x0002)
	self:code_bf8667()
	self:code_bf9e66()
end

function player:code_bf9ef8()
	if (self.ram_1e15 & 0x0020) ~= 0 then
		self.ram_0565 = to_unsigned_16(-to_signed_16(self.ram_0565))
		return
	end
	if self.ram_global_entranceidlo == define_dkc1_entranceid_animaltokentest_main then
		self.ram_0565 = self.ram_global_entranceidlo & 0xFFFF
	else
		local idx = self:code_bcbaad(self.ram_global_entranceidlo) & 0x00FF
		self.ram_0565 = self.ram_7ef9fc[idx + 1] & 0x00FF
	end
end

function player:code_bf9eac()
	self.ram_1929 = 0x0011
	if (self.ram_global_screendisplayregister & 0x000F) ~= 0 then
		return
	end
	self:code_bf9ef8()
	self:code_809b9c()
	self.ram_0561 = self.ram_0516
	self.ram_055f = self.ram_0512
	self.ram_0559 = self.ram_player_currentbananacountlo
	self.ram_055b = self.ram_0579
	self.ram_0579 = self.ram_0579 & 0xFFFE
	self.ram_player_displayedbananacountlo = 0
	self.ram_player_currentbananacountlo = 0
	self.ram_player_bananacountonesdigit = 0
	self.ram_player_bananacounthundredsdigit = 0
	self.ram_1929 = 0
	self:code_b88383()
end

function player:code_bf9f22()
	self.ram_1929 = 0x0003
	if (self.ram_global_screendisplayregister & 0x000F) ~= 0 then
		return
	end
	self.ram_player_currentbananacountlo = self.ram_0559
	self.ram_player_displayedbananacountlo = self.ram_0559
	self:code_b8994e()
	self.ram_0579 = ((self.ram_055b ~ self.ram_0579) & 0x0001) ~ self.ram_0579
	self:code_b88383()
end

function player:code_bf9f51()
	self.ram_yspeedlo = 0
	self:code_bf9288()
end

function player:code_bf9f5a()
	self:code_bfa44a()
	self:code_bf876c()
end

function player:code_bf9f61()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0007
	self:code_bfb27c()
	self:code_bf8584()
	self:code_bfa575()
	self:code_bfa4da()
end

function player:code_bf9fb6()
	self:code_bffb27(define_dkc1_soundid_unpause)
end

function player:code_bf9f78()
	self.ram_180f = 0x0012
	self:code_bfb27c()
	if self.ram_ramtable1029lo ~= 0x0053 then
		return
	end
	self.zp_28 = self.zp_28 - 1
	local old = self.ram_ramtable14c5lo
	self.ram_ramtable14c5lo = to_unsigned_16((self.ram_ramtable14c5lo + 1) & 0x0FFF)
	if (((self.ram_ramtable14c5lo ~ old) & 0x0010) == 0) then
		return
	end
	if (old & 0x0010) == 0 then
		self.ram_currentposelo = 0
		self.ram_displayedposelo = 0
		return
	end
	self.ram_currentposelo = self.ram_ramtable1375lo
	self:code_bf9fb6()
end

function player:code_bf9fbe()
	if not self:code_bdf7d0() then
		self.ram_1699 = self.ram_1699 | 0x0002
		self.ram_16f9 = 0x0008
		self:code_bf8573()
		self:code_bfaa82()
		self:code_be80e1()
		return
	end
	self:code_bf8dd8()
end

function player:code_bf9fe9()
	self:code_be80e1()
end

function player:code_bf9fee()
	self.ram_180f = 0x0012
	self:code_bfb27c()
	if self.ram_ramtable1029lo ~= 0x0056 then
		return
	end
	self.zp_28 = self.zp_28 - 1
	local old = self.ram_ramtable14c5lo
	self.ram_ramtable14c5lo = to_unsigned_16((self.ram_ramtable14c5lo + 1) & 0x0FFF)
	if (((self.ram_ramtable14c5lo ~ old) & 0x0010) == 0) then
		return
	end
	if (old & 0x0010) == 0 then
		self.ram_currentposelo = 0
		self.ram_displayedposelo = 0
		return
	end
	self.ram_currentposelo = self.ram_ramtable1375lo
	self:code_bf9fb6()
end

-- CODE_BF8D41: state $0007 main.
function player:code_bf8d41()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0002)
	self:code_bf8584()
end

-- CODE_BF8D50: state $0008 main.
function player:code_bf8d50()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0003)
	self:code_bf8584()
end

-- CODE_BF8F97: death-launch airborne state ($1029 == #$000B).
function player:code_bf8f97()
	self.ram_0579 = self.ram_0579 | 0x0002
	local next_ys = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFF90)
	if next_ys < 0 and next_ys < to_signed_16(0xFA00) then
		next_ys = to_signed_16(0xFA00)
	end
	self.ram_yspeedlo = to_unsigned_16(next_ys)
	self:code_bf8587()
end

function player:code_bf8fb9()
	self:code_bf_rtl()
end

function player:code_bf8fba()
	self.ram_0579 = self.ram_0579 | 0x0002
	self:code_bf8584()
end

-- CODE_BF8FC6: post-hit timer gate.
function player:code_bf8fc6()
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if to_signed_16(self.ram_ramtable1375lo) >= 0 then
		return
	end
	self:code_bfa49a()
	self.ram_ramtable1029lo = 0x000A
	if self.zp_32 == 0x0003 then
		self.ram_16ad = define_dkc1_animationid_dk_swimaway
		return
	end
	self.ram_16ad = define_dkc1_animationid_dk_initrunaway
end

function player:code_bf8fef()
	self.ram_180f = 0x0004
	self:code_bfb27c()
	self:code_bf8584()
end

function player:code_bf8ff8()
	self.ram_180f = 0x0005
	self:code_bfb27c()
	self:code_bf8584()
end

-- CODE_BF9001: script-only state ($1029 == #$0011).
function player:code_bf9001()
	self:update_death_animation_script()
end

-- CODE_BF9006: roll state ($1029 == #$0012).
function player:code_bf9006()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0006
	self:code_bfb27c()
	self.ram_yspeedlo = 0xFFFF
	self:code_bf902b()
	self:code_bf8587()
	self:code_bfa0d5()
	self:code_bfa575()
	self:code_bfa4da()
end

-- CODE_BF903B: roll-follow state ($1029 == #$0013).
function player:code_bf903b()
	if self:code_bfa0f7() then
		return
	end
	self.ram_180f = 0x0006
	self:code_bfb27c()
	self:code_bf902b()
	self:code_bf8584()
	self:code_bfa0d5()
	self:code_bfa575()
	self:code_bfa4da()
	self:code_bf876c()
end

-- CODE_BF905B: animal-buddy mounted movement state.
function player:code_bf905b()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0000)
	self:code_bfaf38()

	local profile_id = 0x0002
	local buddy_slot = self.ram_0512
	if buddy_slot ~= 0 then
		local bi = ((buddy_slot & 0xFFFF) >> 1) + 1
		local sid = self.ram_norspr_spriteidlo[bi] & 0xFFFF
		if sid == define_dkc1_norspr0a_expresso then
			profile_id = 0x0006
		elseif sid == define_dkc1_norspr0b_winky then
			profile_id = 0x0000
		end
	end

	self:code_bfb191(profile_id)
	self:code_bf858b()
	self:code_bf90b3()
	self:code_bfa0d5()
	self:code_bfa575()
	self:code_bf876c()
end

-- CODE_BF90B3 / CODE_BF9122: mounted attack hit-probe.
function player:code_bf90b3()
	local buddy_slot = self.ram_0512
	if buddy_slot == 0 then
		return
	end
	local bi = ((buddy_slot & 0xFFFF) >> 1) + 1
	local buddy_id = self.ram_norspr_spriteidlo[bi] & 0xFFFF

	if buddy_id == define_dkc1_norspr09_rambi then
		self:code_bba4c8(0x0005)
		if not self:code_bba58d(0x0023) then
			return
		end
		local hit_slot = self.zp_88
		if hit_slot < 0x0006 or hit_slot == buddy_slot then
			return
		end
		local hi = ((hit_slot & 0xFFFF) >> 1) + 1
		if (self.ram_norspr_spriteidlo[hi] & 0xFFFF) == define_dkc1_norspr2c_itemcache then
			self:code_bf9122()
			return
		end
		if self.ram_16ad ~= define_dkc1_animationid_rambiriddenbydk_stab then
			self:code_be8092(define_dkc1_animationid_rambiriddenbydk_stab)
		end
		return
	end

	if buddy_id ~= define_dkc1_norspr0b_winky then
		return
	end
	self:code_bba4d5()
	self.zp_ac = to_unsigned_16(self.zp_ac - 0x0010)
	if not self:code_bba58d(0x0022) then
		return
	end
	local hit_slot = self.zp_88
	if hit_slot < 0x0006 or hit_slot == buddy_slot then
		return
	end
	self:code_bf9122()
end

function player:code_bf9122()
	local yi = ((self.zp_88 & 0xFFFF) >> 1) + 1
	self.ram_norspr_ramtable1595lo[yi] = 0x0001
	self.ram_norspr_ramtable15c9lo[yi] = self.zp_84 & 0xFFFF
	local launch = to_unsigned_16((self.ram_xspeedlo << 1) & 0xFFFF)
	self.ram_norspr_xspeedlo[yi] = launch
	self.ram_norspr_ramtable0f25lo[yi] = launch
	self:code_bffb2b(define_dkc1_soundid_getonanimalbuddy)
	self:code_b5802f()
	self.ram_yspeedlo = 0x0A00
end

-- CODE_BF9151: mounted neutral state.
function player:code_bf9151()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x000C)
	self.ram_ramtable123dlo = 0
	self:code_bf8584()
	self:code_bf90b3()
	self:code_bf876c()
end

-- CODE_BF916D: script-only state.
function player:code_bf916d()
	self:code_be80e1()
end

-- CODE_BF9172: mounted roll-follow state.
function player:code_bf9172()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0000)
	self:code_bf8584()
	self:code_bfa712()
	self:code_bfa0d5()
	self:code_bfa575()
	self:code_bfa4da()
	self:code_bf876c()
end

function player:code_bf9192()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0002)
	self:code_bf8584()
	self:code_bf876c()
end

function player:code_bf91a6()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x0007)
	self:code_bf8584()
	self:code_bf876c()
end

function player:code_bf91ba()
	if self:code_bfa0f7() then
		return
	end
	self:code_bfb27c(0x000C)
	self:code_bf8948()
	self:code_bf8584()
	self:code_bfa712()
end

-- CODE_BF9606: crawlspace state ($1029 == #$0027).
function player:code_bf9606()
	if self:code_bfa0f7() then
		return
	end

	self.ram_180f = 0x000B
	self:code_bfb27c()
	self:code_bf8584()

	if self:code_bfa51b() then
		return
	end

	if self.ram_16ad == define_dkc1_animationid_dk_leavecrawlspace then
		return
	end

	if self.ram_ramtable1029lo ~= 0x0027 then
		return
	end

	self:code_be80a4(define_dkc1_animationid_dk_leavecrawlspace)
end

-- CODE_BF9B72: death-state update for $1029 == #$003B.
function player:code_bf9b72()
	self.ram_ramtable1375lo = to_unsigned_16(self.ram_ramtable1375lo - 1)
	if to_signed_16(self.ram_ramtable1375lo) < 0 then
		self:code_808131()
		return
	end
	if self.ram_ramtable1375lo == 0x0040 then
		self:code_b6a868()
	end
	self.ram_xposlo = self.ram_xposlo ~ 0x0004
	self.ram_yposlo = 0xFE00
end

-- CODE_BF9C10: death-state update for $1029 == #$003F.
function player:code_bf9c10()
	self.ram_yspeedlo = 0
	self.ram_xposlo = self.ram_xposlo ~ 0x0004
	self.ram_yposlo = 0xFE00
	self:code_808131()
end

-- Main player entry dispatch (DKC1_NorSpr01_DonkeyKong_Main -> DATA_BF84C5).
function player:code_bf84a8()
	self.zp_ba = self.ram_16fd
	self.ram_16fd = 0
	self.ram_ramtable1271lo = self.ram_ramtable1271lo & 0x7FFF
	local state = self.ram_ramtable1029lo & 0xFFFF
	local label = data_bf84c5[state + 1]
	self[label](self)
end

function player:code_bba4e5(hitbox)
	local x_off = to_signed_16(hitbox[1])
	local y_off = to_signed_16(hitbox[2])
	local w = to_signed_16(hitbox[3])
	local h = to_signed_16(hitbox[4])

	if (self.ram_yxppccctlo & 0x4000) == 0 then
		self.zp_a6 = self.ram_xposlo + x_off
		self.zp_aa = self.zp_a6 + w
	else
		self.zp_aa = self.ram_xposlo - x_off
		self.zp_a6 = self.zp_aa - w
	end

	if (self.ram_yxppccctlo & 0x8000) == 0 then
		self.zp_a8 = self.ram_yposlo - y_off
		self.zp_ac = self.zp_a8 - h
	else
		self.zp_ac = self.ram_yposlo + y_off
		self.zp_a8 = self.zp_ac + h
	end
end

-- CODE_BBA4C8 equivalent (player hitbox setup used by CODE_BFA752).
function player:code_bba4c8(hitbox_index)
	self.zp_b6 = self.zp_84
	local hitbox = data_bba428[hitbox_index + 1]
	self:code_bba4e5(hitbox)
end

-- CODE_BBA4D5: pose-derived hitbox setup (used by CODE_BFC70F path).
function player:code_bba4d5()
	self.zp_b6 = self.zp_84
	local pose_index = (self.ram_16ad & 0xFFFF) >> 1
	local hitbox = data_bb8000[pose_index + 1]
	self:code_bba4e5(hitbox)
end

function player:dkc1_get_any_sprite_by_slot(slot)
	local stomp_targets = self.level.stomp_targets
	for i = 1, #stomp_targets do
		local target = stomp_targets[i]
		if target.dkc1_slot == slot then
			return target
		end
	end

	local barrels = self.level.barrels
	for i = 1, #barrels do
		local barrel = barrels[i]
		if barrel.dkc1_slot == slot then
			return barrel
		end
	end
	return nil
end

function player:dkc1_get_stomp_sprite_by_slot(slot)
	local sprite = self:dkc1_get_any_sprite_by_slot(slot)
	if sprite == nil then
		return nil
	end
	local role = sprite.dkc1_collision_role
	if role ~= 'enemy' and role ~= 'projectile' then
		return nil
	end
	return sprite
end

function player:dkc1_stomp_sprite_active(sprite)
	if sprite.state == 'broken' then
		return false
	end
	local role = sprite.dkc1_collision_role
	if role ~= 'enemy' and role ~= 'projectile' then
		return false
	end
	local visible = self.debug_frame >= sprite.spawn_frame or sprite.state ~= 'idle'
	if not visible then
		return false
	end
	return sprite.dkc1_sprite_id ~= 0
end

function player:dkc1_any_sprite_active(sprite)
	if sprite.state == 'broken' then
		return false
	end
	local visible = self.debug_frame >= sprite.spawn_frame or sprite.state ~= 'idle'
	if not visible then
		return false
	end
	return sprite.dkc1_sprite_id ~= 0
end

function player:dkc1_build_sprite_bbox(sprite)
	local hitbox = sprite.dkc1_hitbox
	local x_off = to_signed_16(hitbox[1])
	local y_off = to_signed_16(hitbox[2])
	local w = to_signed_16(hitbox[3])
	local h = to_signed_16(hitbox[4])

	if (sprite.dkc1_yxppccctlo & 0x4000) == 0 then
		self.zp_ae = sprite.x + x_off
		self.zp_b2 = self.zp_ae + w
	else
		self.zp_b2 = sprite.x - x_off
		self.zp_ae = self.zp_b2 - w
	end

	if (sprite.dkc1_yxppccctlo & 0x8000) == 0 then
		self.zp_b0 = sprite.y - y_off
		self.zp_b4 = self.zp_b0 - h
	else
		self.zp_b4 = sprite.y + y_off
		self.zp_b0 = self.zp_b4 + h
	end
end

function player:code_bba58d_any(mask)
	self.zp_b8 = mask
	self.zp_88 = 0x001E
	while true do
		self.zp_88 = self.zp_88 - 2
		if self.zp_88 == 0 then
			return false
		end
		local sprite = self:dkc1_get_any_sprite_by_slot(self.zp_88)
		if sprite ~= nil and self:dkc1_any_sprite_active(sprite) then
			if self.zp_88 ~= self.zp_b6 and (self.zp_b8 & sprite.dkc1_ramtable11a1lo) ~= 0 then
				self:dkc1_build_sprite_bbox(sprite)
				if self.zp_b2 >= self.zp_a6
					and self.zp_aa >= self.zp_ae
					and self.zp_b0 >= self.zp_ac
					and self.zp_a8 >= self.zp_b4
				then
					return true
				end
			end
		end
	end
end

-- CODE_BBA58D equivalent (masked sprite overlap scan).
function player:code_bba58d(mask)
	self.zp_b8 = mask
	self.zp_88 = 0x001E
	while true do
		self.zp_88 = self.zp_88 - 2
		if self.zp_88 == 0 then
			return false
		end
		local sprite = self:dkc1_get_stomp_sprite_by_slot(self.zp_88)
		if sprite ~= nil and self:dkc1_stomp_sprite_active(sprite) then
			if self.zp_88 ~= self.zp_b6 and (self.zp_b8 & sprite.dkc1_ramtable11a1lo) ~= 0 then
				self:dkc1_build_sprite_bbox(sprite)
				if self.zp_b2 >= self.zp_a6
					and self.zp_aa >= self.zp_ae
					and self.zp_b0 >= self.zp_ac
					and self.zp_a8 >= self.zp_b4
				then
					return true
				end
			end
		end
	end
end

-- CODE_BFA79C branch (main bounce launch + target handoff flags).
function player:code_bfa79c(target)
	if self.zp_84 == 0x0002 then
		self.ram_yspeedlo = 0x0720
	else
		self.ram_yspeedlo = 0x0880
	end
	target.dkc1_ramtable1595lo = 0x0001
	target.dkc1_ramtable15c9lo = self.zp_84
	if self.ram_16d5 < 0x0004 then
		self.ram_16d5 = 0x0004
	end
	self.ram_1699 = self.ram_1699 | 0x0003
	self.ram_1929 = 0xFFFE
	self.ram_16ad = define_dkc1_animationid_dk_bounce
	self:code_bffa6c()
end

-- CODE_BFA86A: release carried sprite before bounce branch.
function player:code_bfa86a()
	if self.ram_16f5 == 0 then
		return false
	end
	local carried_slot = self.ram_16f5
	self.ram_16f5 = 0
	local carried = self:dkc1_get_any_sprite_by_slot(carried_slot)
	if carried == nil then
		return false
	end
	carried.dkc1_ramtable1595lo = 0x0008
	local xs = 0x0500
	if (carried.dkc1_yxppccctlo & 0x4000) ~= 0 then
		xs = to_unsigned_16(-to_signed_16(xs))
	end
	carried.x_speed_subpx = xs
	carried.dkc1_ramtable0f25lo = xs
	carried.y_speed_subpx = 0xFF00
	return false
end

-- CODE_BFA89A: rotate collision-state flags in RAMTable12A5Lo.
-- Moves low-byte state into high-byte history before fresh collision writes.
function player:code_bfa89a()
	local flags = self.ram_ramtable12a5lo & 0xFFFF
	local prev_low_to_high = ((flags & 0x00FF) << 8) & 0xFFFF
	local low_nibble_history = (flags >> 4) & 0x000F
	self.ram_ramtable12a5lo = (prev_low_to_high | low_nibble_history) & 0xFFFF
end

function player:code_bffa6c()
	if (self.ram_1e17 & 0xFFFF) >= 0x0007 then
		self:code_b6a84b()
		return
	end
	self.ram_1e17 = (self.ram_1e17 + 1) & 0xFFFF
	self:code_bffb2b(define_dkc1_soundid_stompenemy)
end

function player:code_be80a4(anim)
	self.ram_16ad = anim & 0xFFFF
	self.ram_animation_speed = 0x0100
	self.ram_displaycurrentposetimerlo = 0
	self.ram_ramtable130dlo = 0
	self.ram_animationscriptindexlo = self.ram_16ad << 1
end

function player:code_be8092(anim)
	self.ram_16ad = anim & 0xFFFF
end

function player:code_be80e1()
	self.ram_displaycurrentposetimerlo = to_unsigned_16(self.ram_displaycurrentposetimerlo - self.ram_animation_speed)
	local dt = to_signed_16(self.ram_displaycurrentposetimerlo)
	if dt < 0 or self.ram_displaycurrentposetimerlo == 0 then
		self:update_roll_animation_script()
		self:update_jump_animation_script()
		self:update_death_animation_script()
	end
	if self.ram_ramtable130dlo ~= 0 then
		self.zp_7c = self.ram_ramtable130dlo
		self.zp_7a = self.ram_ramtable1341lo
	end
end

function player:code_be80d2()
	local keep = self.ram_ramtable1029lo
	self:code_be80e1()
	self.ram_ramtable1029lo = keep
end

function player:code_bcb872()
	local y = self:code_809b9c()
	local x = (y ~ 0x0006) & 0xFFFF
	local a = self.ram_ramtable1029lo
	if a == 0x0029 then
		a = 0x0000
	elseif a == 0x0027 then
		a = 0x005A
	else
		a = 0x0003
	end
	self.zp_76 = a & 0xFFFF

	local other_x = self.ram_16b9
	local other_y = self.ram_16bd
	local dx = to_signed_16(self.ram_ramtable0fc1lo - other_x)
	local dy = to_signed_16(self.ram_ramtable0ff5lo - other_y)
	self.zp_4c = to_unsigned_16(dx)
	self.zp_4e = to_unsigned_16(dy)
	self.zp_54 = to_unsigned_16(-dx)
	self.zp_56 = to_unsigned_16(-dy)
	self.zp_50 = other_x
	self.zp_52 = other_y

	for xi = 0, 0x001E, 0x0002 do
		self.zp_54 = to_unsigned_16(self.zp_54 + self.zp_4c)
		local sx = to_signed_16(self.zp_54) >> 5
		self.ram_1815[(xi >> 1) + 1] = to_unsigned_16(self.zp_50 + sx)
		self.zp_56 = to_unsigned_16(self.zp_56 + self.zp_4e)
		local sy = to_signed_16(self.zp_56) >> 5
		self.ram_1855[(xi >> 1) + 1] = to_unsigned_16(self.zp_52 + sy)
		self.ram_1895[(xi >> 1) + 1] = 0
		self.ram_18d5[(xi >> 1) + 1] = self.zp_76
	end
	self.ram_1811 = 0
	self.ram_1813 = 0x0020
end

function player:code_bcb82a()
	local x = (self.ram_1813 - 2) & 0x003F
	local i = (x >> 1) + 1
	local save1815 = self.ram_1815[i]
	local save1855 = self.ram_1855[i]
	local save1895 = self.ram_1895[i]
	local save18d5 = self.ram_18d5[i]
	self:code_bcb872()
	local j = ((self.ram_1813 & 0x003F) >> 1) + 1
	self.ram_18d5[j] = save18d5
	self.ram_1895[j] = save1895
	self.ram_1855[j] = save1855
	self.ram_1815[j] = save1815
	self.ram_1813 = (self.ram_1813 + 2) & 0x003F
end

function player:code_bcb864()
	local a = 0x0002
	self:code_bcb895(a)
end

function player:code_bcb895(a)
	self:code_809b9c()
	local y = self.zp_84
	local x = (y ~ 0x0006) & 0xFFFF
	self.zp_76 = a & 0xFFFF
	local other_x = self.ram_16b9
	local other_y = self.ram_16bd
	local dx = to_signed_16(self.ram_ramtable0fc1lo - other_x)
	local dy = to_signed_16(self.ram_ramtable0ff5lo - other_y)
	self.zp_4c = to_unsigned_16(dx)
	self.zp_4e = to_unsigned_16(dy)
	self.zp_54 = to_unsigned_16(-dx)
	self.zp_56 = to_unsigned_16(-dy)
	self.zp_50 = other_x
	self.zp_52 = other_y
	for xi = 0, 0x001E, 0x0002 do
		self.zp_54 = to_unsigned_16(self.zp_54 + self.zp_4c)
		local sx = to_signed_16(self.zp_54) >> 5
		self.ram_1815[(xi >> 1) + 1] = to_unsigned_16(self.zp_50 + sx)
		self.zp_56 = to_unsigned_16(self.zp_56 + self.zp_4e)
		local sy = to_signed_16(self.zp_56) >> 5
		self.ram_1855[(xi >> 1) + 1] = to_unsigned_16(self.zp_52 + sy)
		self.ram_1895[(xi >> 1) + 1] = 0
		self.ram_18d5[(xi >> 1) + 1] = self.zp_76
	end
	self.ram_1811 = 0
	self.ram_1813 = 0x0020
end

local data_b885f5 = {
	0x00, 0x00, 0x00, 0x02, 0x08, 0xFE, 0x10, 0x02, 0x08, 0x00, 0x00,
}


local data_b89853 = {
0x16, 0x16, 0x0C, 0x0C, 0x0C, 0xEE, 0x0C, 0xEE, 0xEA, 0x01, 0xEA, 0x01, 0x01, 0x01, 0xBF, 0xBF, 
0xBF, 0xF4, 0xBF, 0xF4, 0x17, 0x17, 0x17, 0xFA, 0x17, 0xFA, 0xE0, 0xD9, 0xD9, 0x2E, 0x2E, 0x2E, 
0x07, 0x07, 0x07, 0x31, 0x31, 0x31, 0xFB, 0x31, 0x31, 0xF5, 0x31, 0xF5, 0x42, 0x42, 0x42, 0xEF, 
0x42, 0xEF, 0xE1, 0xA5, 0xA5, 0xA4, 0xA4, 0xA4, 0xD0, 0xA4, 0xA4, 0xF9, 0xD0, 0xD0, 0x43, 0x43, 
0x43, 0xFF, 0x43, 0xFF, 0x0D, 0x0D, 0x0D, 0xF3, 0x0D, 0xF3, 0xDE, 0xDE, 0xDE, 0xE5, 0x24, 0x24, 
0x6D, 0x6D, 0x6D, 0xA7, 0xA7, 0xA7, 0x3E, 0x3E, 0x3E, 0xF0, 0x3E, 0xF0, 0x14, 0x14, 0x14, 0xF6, 
0x14, 0x14, 0xFC, 0x14, 0xF6, 0xCE, 0xCE, 0xCE, 0xE2, 0x40, 0x40, 0x2F, 0x2F, 0x2F, 0x18, 0x18, 
0x18, 0x22, 0x18, 0x18, 0xFD, 0x22, 0x22, 0x27, 0x22, 0x22, 0xF1, 0x27, 0x27, 0xF7, 0x27, 0xF7, 
0x41, 0x41, 0x41, 0xE3, 0x30, 0x30, 0x12, 0x12, 0x12, 0x0A, 0x0A, 0x0A, 0xF8, 0x0A, 0xF8, 0x36, 
0x36, 0x36, 0xFE, 0x36, 0xFE, 0x2B, 0x2B, 0x2B, 0xF2, 0x2B, 0x2B, 0xE4, 0x16, 0xEB, 0xEC, 0xE0, 
0xEC, 0xED, 0xE1, 0xED, 0xE9, 0xE5, 0xE9, 0xE8, 0xE2, 0xE8, 0xE7, 0xE3, 0xE7, 0xE6, 0xE4, 0xE6, 
0x68, 0x00
}

local data_b88197 = {
	0x0018, 0x0014, 0x0012, 0x0011,
}

function player:code_bdf254(palette_ptr, palette_slot)
	self.ram_palette_upload_log[#self.ram_palette_upload_log + 1] = { ptr = palette_ptr, slot = palette_slot & 0xFFFF }
	self.ram_palettes_loaded[palette_slot & 0xFFFF] = palette_ptr
end

function player:code_b88133()
	self.ram_1df5 = 0
	self.ram_1df7 = 0
	self.ram_1df9 = 0
	self.ram_1dfb = 0
	self.ram_1dfd = 0
	self.ram_1dff = 0
	self.zp_e1 = 0
	self.zp_e3 = 0
	self.zp_e5 = 0
	self.zp_e7 = 0
	self.zp_e9 = 0
	self.zp_eb = 0
	self.zp_ed = 0
	self.zp_4c = 0
	self.zp_4e = 0
	self.zp_50 = 0
	self.ram_register_mode7matrixparametera = 0
	self.ram_register_mode7matrixparameterc = 0
	self.ram_register_mode7centerx = 0
	self.ram_register_mode7centery = 0
end

function player:code_b88166(a)
	local x = a & 0xFFFF
	if x ~= 0 then
		if x < 0x000A then
			local mask = data_b88197[(x >> 1)] or 0
			if (mask & self.ram_player_collectedkongletterslo) ~= 0 then
				self.ram_ramtable1375lo = 0
				x = 0
			end
		end
	end
	self.ram_0683 = (self.ram_0683 + 1) & 0xFFFF
	if self.ram_0683 == 0x0008 then
		self.ram_0683 = 0
		self.ram_ramtable1375lo = 0x0015
		x = (0x0015 << 1) & 0xFFFF
	end
	return x
end

function player:code_b8819f()
	self.ram_oamsizeanddataareadesignation = {}
	self.ram_multiplicand = {}
	for i = 1, 0x2D do
		self.ram_oamsizeanddataareadesignation[i] = 0
	end
	for i = 1, 0x0B do
		self.ram_multiplicand[i] = 0
	end
	self.ram_register_screendisplayregister = 0x008F
	self.ram_register_vramaddressincrementvalue = 0x0080
	self.ram_register_mode7tilemapsettings = 0x0080
	self.ram_register_colormathselectandenable = 0
	self.ram_register_initialscreensettings = 0
	self.ram_register_irqnmiandjoypadenableflags = 0
	self.ram_register_programmableioportoutput = 0x00FF
	self.ram_register_fixedcolordata = 0x00E0
	self.ram_register_colormathinitialsettings = 0x0030
	self.ram_register_mosaicsizeandbgenable = 0
	self.ram_register_bg1horizscrolloffset = 0
	self.ram_register_bg2horizscrolloffset = 0
	self.ram_register_bg3horizscrolloffset = 0
	self.ram_register_bg1vertscrolloffset = 0
	self.ram_register_bg2vertscrolloffset = 0
	self.ram_register_bg3vertscrolloffset = 0
	self.ram_dma_parameters = {}
	self.ram_hdma_parameters = {}
	for i = 1, 0x0B do
		self.ram_dma_parameters[i] = 0
		self.ram_hdma_parameters[i] = 0
	end
end

function player:code_b880d2()
	self.zp_4c = 0
	if self.zp_42 == 0x0002 and self.zp_44 ~= 0 then
		self.zp_4c = 0x003C
	end
	if self.ram_player_currentkonglo ~= 0x0001 then
		local x = 0x0004
		x = self:code_b88128(x)
		self:code_bdf254('DATA_BC8422+' .. string.format('0x%04X', self.zp_4c), x)
		x = 0x0002
		self:code_bdf254('DATA_BC84B8+' .. string.format('0x%04X', self.zp_4c), x)
		return
	end
	local x = 0x0002
	x = self:code_b88128(x)
	self:code_bdf254('DATA_BC849A+' .. string.format('0x%04X', self.zp_4c), x)
	x = 0x0004
	self:code_bdf254('DATA_BC8440+' .. string.format('0x%04X', self.zp_4c), x)
end

function player:code_b88128(x)
	local y = (x - 2) & 0xFFFF
	if self.ram_0512 ~= 0 then
		return self.ram_0512
	end
	return x
end

function player:code_b8822b()
	local x = self.zp_84 & 0xFFFF
	self.zp_84 = (x - 2) & 0xFFFF
	self.ram_oamzposlo = 0x00D8
	if (self.ram_0579 & 0x0001) == 0 then
		self.ram_currentposelo = 0
		self.ram_displayedposelo = 0
		self.ram_ramtable11a1lo = 0
		self.ram_ramtable1029lo = 0x000C
		return
	end
	self.ram_ramtable1029lo = 0x0036
	self:code_be80a4(define_dkc1_animationid_dk_swimming)
end

function player:code_b88268()
	for i = 0x004A, 0x00FF do
		self.ram_lowmem[i + 1] = 0
	end
end

function player:code_b88278()
	for i = 0x0687, 0x1FFF do
		self.ram_lowmem[i + 1] = 0
	end
end

function player:code_b88261()
	self:code_b88268()
	self:code_b88278()
end

function player:code_b8994e()
	local banana = self.ram_player_currentbananacountlo & 0xFFFF
	local hundreds = math.floor(banana / 100)
	local rem = banana % 100
	local tens = math.floor(rem / 10)
	local ones = rem % 10
	self.ram_player_bananacounthundredsdigit = hundreds & 0x00FF
	self.ram_player_bananacounttensdigit = tens & 0x00FF
	self.ram_player_bananacountonesdigit = ones & 0x00FF
end

function player:code_b899da()
	for x = 0x00FE, 0, -2 do
		self.ram_0583[(x >> 1) + 1] = 0
	end
	for i = 1, 0x282 do
		self.ram_7efafc[i] = 0
	end
	for x = 0x00FF, 0, -1 do
		self.ram_7ef9fc[x + 1] = x & 0x00FF
	end
	self.ram_7efbe7 = 0x0001
	self.ram_7efbea = 0x0303
	self.ram_7efbec = 0x0303
	self.ram_7efbee = 0x0303
	self.ram_7efbf0 = 0x0505
	self.ram_7efbf2 = 0x0505
	self.ram_7efbf4 = 0x0505
	self.ram_7efbf6 = 0x0404
	self.ram_7efbf8 = 0x0404
	self.ram_7efbfa = 0x0404
	self.ram_7effac = 0x00EC
	self.ram_7effc0 = 0x0014
	self.ram_7efc50 = 0x00F0
	self.ram_7effd4 = 0x0042
	self.ram_7efd08 = 0x00F5
end

function player:code_bdf3a2()
	local x = 0x0002
	while x ~= 0x001E do
		local i = (x >> 1) + 1
		if self.ram_norspr_spriteidlo[i] == 0 then
			self.zp_86 = x
			self.ram_norspr_ramtable15fdlo[i] = 0x8000
			return false
		end
		x = (x + 2) & 0xFFFF
	end
	self.zp_86 = 0
	return true
end

function player:code_bdf3c3()
	local x = 0x001E
	while x ~= 0x0034 do
		local i = (x >> 1) + 1
		if self.ram_norspr_spriteidlo[i] == 0 then
			self.zp_86 = x
			self.ram_norspr_ramtable15fdlo[i] = 0x8000
			return false
		end
		x = (x + 2) & 0xFFFF
	end
	self.zp_86 = 0
	return true
end

function player:code_bdf2eb()
	self.zp_4e = self.zp_4c
	local y = 0x001C
	while y >= 0x0008 do
		local idx = (y >> 1) + 1
		if self.ram_1a6f[idx] == 0 then
			break
		end
		y = y - 2
	end
	if y < 0x0008 then
		return true
	end
	while true do
		self.zp_4c = (self.zp_4c - 1) & 0xFFFF
		if self.zp_4c == 0 then
			break
		end
		y = y - 2
		if y < 0x0008 then
			return true
		end
		while true do
			local idx = (y >> 1) + 1
			if self.ram_1a6f[idx] == 0 then
				break
			end
			self.zp_4c = self.zp_4e
			y = y - 2
			if y < 0x0008 then
				return true
			end
		end
	end
	local nibble = ((y << 4) & 0x01FF)
	self.ram_yxppccctlo = ((self.ram_yxppccctlo & 0xFE1F) | nibble) & 0xFFFF
	while true do
		local idx = (y >> 1) + 1
		self.ram_1a6f[idx] = self.zp_84 & 0xFFFF
		self.zp_4e = (self.zp_4e - 1) & 0xFFFF
		if self.zp_4e == 0 then
			return false
		end
		y = y + 2
	end
end

function player:code_bdf346()
	local y = 0x001C
	while y >= 0x0008 do
		local idx = (y >> 1) + 1
		if self.ram_1a6f[idx] == 0 then
			self.ram_1a6f[idx] = self.zp_84 & 0xFFFF
			local nibble = ((y << 4) & 0x01FF)
			self.ram_yxppccctlo = ((self.ram_yxppccctlo & 0xFE1F) | nibble) & 0xFFFF
			return false
		end
		y = y - 2
	end
	return true
end

function player:code_bdf3e0(a)
	self.zp_4c = a & 0xFFFF
	if self:code_bdf3a2() then
		return true
	end
	local i = (self.zp_86 >> 1) + 1
	self.ram_norspr_displayedposelo[i] = 0
	if self:code_bdf2eb() then
		return true
	end
	return false
end

function player:code_b88288()
	self:code_b899da()
	self.ram_0512 = 0
	self.ram_0514 = 0
	self.ram_0516 = 0
	self.ram_0518 = 0
	self.ram_player_currentkonglo = 0x0001
	self.ram_player_currentbananacountlo = 0
	self.ram_player_displayedbananacountlo = 0
	self.ram_player_bananacountonesdigit = 0
	self.ram_player_bananacounthundredsdigit = 0
	self.ram_player_winkytokencount = 0
	self.zp_46 = 0
	self.zp_48 = 0
	self.ram_0579 = 0
	local lives = define_dkc1_global_startinglives
	if (self.ram_global_cheatcodeflagslo & define_dkc1_cheatflags_50lives) ~= 0 then
		lives = define_dkc1_global_50livescheatstartinglives
	end
	self.ram_player_currentlifecountlo = lives
	self.ram_player_displayedlifecountlo = lives
	self.ram_0683 = 0
	self.ram_global_entranceidlo = define_dkc1_entranceid_invalidmap
	self.zp_40 = define_dkc1_entranceid_kongojunglemap
end

function player:code_b882f2()
	local x = ((self.ram_global_entranceidlo & 0xFFFF) << 1) + 1
	local px = data_bcbef0[x]
	local py = data_bcbef0[x + 1]
	self.ram_xposlo = px & 0xFFFF
	self.ram_ramtable0fc1lo = px & 0xFFFF
	self.ram_yposlo = py & 0xFFFF
	self.ram_ramtable0ff5lo = py & 0xFFFF
end

function player:code_b89a60()
	local y = self.ram_global_oamindexlo & 0xFFFF
	local limit = 0x01B8
	local function emit(a, x)
		if y < limit then
			self:code_b89e78(a, x)
			y = (y + 8) & 0xFFFF
		end
	end
	emit(self.ram_palettes_loaded[1] or 0, 0x4010)
	emit(self.ram_1ae3, 0x4038)
	emit(self.ram_1ad5, 0x5010)
	emit(self.ram_1ae5, 0x5038)
	emit(self.ram_1ad7, 0x6010)
	emit(self.ram_1ae7, 0x6038)
	emit(self.ram_1ad9, 0x7010)
	emit(self.ram_1ae9, 0x7038)
	emit(self.ram_1adb, 0x8010)
	emit(self.ram_1aeb, 0x8038)
	emit(self.ram_1add, 0x9010)
	emit(self.ram_1aed, 0x9038)
	emit(self.ram_1adf, 0xA010)
	emit(self.ram_1aef, 0xA038)
	emit(self.ram_1ae1, 0xB010)
	emit(self.ram_1af1, 0xB038)
	emit(self.ram_1e35, 0x7860)
	self.ram_global_oamindexlo = y
end

function player:code_b89e78(a, x)
	self.ram_oam_debug = self.ram_oam_debug or {}
	self.ram_oam_debug[#self.ram_oam_debug + 1] = { value = a & 0xFFFF, tile = x & 0xFFFF }
end

function player:code_b8830e()
	if self.ram_1e3d == 0 then
		return
	end
	self.ram_global_oamindexlo = self.ram_global_oambuffer
	for i = 1, 10 do
		self.ram_upperoambuffer[i] = 0
	end
	self:code_b89a60()
	self.ram_0579 = (self.ram_0579 | 0x0040) & 0xFFFF
end

function player:code_b88344()
	local y = self.ram_draworderindexlo & 0xFFFF
	self.zp_6c = self.ram_draw_order_z[(y >> 1) + 1]
	local x = 0x0AAF
	while x ~= 0x0AE1 do
		local slot_y = self.ram_draw_order_slots[((x + 4) >> 1) + 1]
		local z = self.ram_draw_order_z[(slot_y >> 1) + 1]
		local cmp_with = self.zp_6c & 0xFFFF
		self.zp_6c = z
		if z > cmp_with then
			local idx2 = ((x + 2) >> 1) + 1
			local idx4 = ((x + 4) >> 1) + 1
			local a = self.ram_draw_order_slots[idx2]
			self.ram_draw_order_slots[idx4] = a
			self.ram_draw_order_slots[idx2] = slot_y
		end
		x = (x + 2) & 0xFFFF
	end
	while true do
		local slot_y = self.ram_draw_order_slots[(x >> 1) + 1]
		local z = self.ram_draw_order_z[(slot_y >> 1) + 1]
		local cmp_with = self.zp_6c & 0xFFFF
		self.zp_6c = z
		if z < cmp_with then
			local idx0 = ((x + 0) >> 1) + 1
			local idx2 = ((x + 2) >> 1) + 1
			local a = self.ram_draw_order_slots[idx2]
			self.ram_draw_order_slots[idx0] = a
			self.ram_draw_order_slots[idx2] = slot_y
		end
		if x == 0x0AAF then
			break
		end
		x = (x - 2) & 0xFFFF
	end
end

function player:code_b88685(v)
	if (v & 0x0080) ~= 0 then
		return v | 0xFF00
	end
	return v & 0x00FF
end

function player:code_b886fa(start_x)
	local x = start_x & 0xFFFF
	while x < 0x0024 do
		local i = (x >> 1) + 1
		if self.ram_7f36b5[i] == 0 then
			return x
		end
		x = (x + 2) & 0xFFFF
	end
	return 0x0024
end

function player:code_b886e3(a, y, x)
	local i = (x >> 1) + 1
	self.ram_7f36b5[i] = (a + self.ram_1e23) & 0xFFFF
	self.ram_7f37d5[i] = (a + 0x0006) & 0xFFFF
	self.ram_7f378d[i] = y & 0xFFFF
end

function player:code_bffa4d()
	return (self.zp_28 * 37 + 0x1234) & 0xFFFF
end

function player:code_b88692()
	if (self.zp_28 & 0x0003) ~= 0 then
		return
	end
	local x = self:code_b886fa(0x0010)
	if x >= 0x0024 then
		return
	end
	local r = self:code_bffa4d()
	local t = r & 0x01FF
	self.zp_4c = t
	local xx = ((((t << 1) + t) >> 2) - 0x0020 + self.ram_layer1xposlo) & 0xFFFF
	local i = (x >> 1) + 1
	self.ram_7f36fd[i] = (xx << 2) & 0xFFFF
	self.ram_7f3745[i] = ((0x00F0 + self.ram_layer1yposlo) << 2) & 0xFFFF
	local y = (r >> 8) & 0x0007
	if y >= 0x0006 then
		y = (self.zp_28 & 0x000C) >> 2
	end
	self:code_b886e3(0, y, x)
end

function player:code_b88545(x)
	local i = (x >> 1) + 1
	if self.ram_7f36b5[i] == 0 then
		return
	end
	self.ram_7f3745[i] = (self.ram_7f3745[i] - self.ram_7f37d5[i]) & 0xFFFF
	local y = (((self.ram_7f3745[i] >> 2) - self.ram_layer1yposlo + 0x0010) & 0xFFFF)
	if to_signed_16(y) < 0 then
		self.ram_7f36b5[i] = 0
		return
	end
	local xview = (((self.ram_7f36fd[i] >> 2) - self.ram_layer1xposlo) & 0xFFFF)
	if to_signed_16(xview) < 0 then
		xview = (xview + 0x0020) & 0xFFFF
		if to_signed_16(xview) < 0 then
			self.ram_7f36b5[i] = 0
			return
		end
	end
	xview = (xview - 0x0120) & 0xFFFF
	if to_signed_16(xview) >= 0 then
		self.ram_7f36b5[i] = 0
		return
	end
	local phase = self.ram_7f378d[i]
	if to_signed_16(phase) < 0 then
		local a = self:code_b88685(phase)
		if a ~= 0 then
			self.ram_7f36fd[i] = (self.ram_7f36fd[i] + a) & 0xFFFF
			if to_signed_16(a) < 0 then
				self.ram_7f378d[i] = (self.ram_7f378d[i] + 1) & 0xFFFF
			else
				self.ram_7f378d[i] = (self.ram_7f378d[i] - 1) & 0xFFFF
			end
			return
		end
		self.ram_7f378d[i] = a
	end
	phase = self.ram_7f378d[i]
	if phase == 0 then
		if (y & 0x0007) == 0 then
			self.ram_7f378d[i] = 0x0100
		end
		return
	end
	self:code_b885c7(i, phase)
end

function player:code_b885c7(i, phase)
	local low = (phase - 1) & 0x00FF
	local high = (phase >> 8) & 0x00FF
	if to_signed_16(low) < 0 then
		high = (high + 2) & 0x00FF
		local t = data_b885f5[(high + 2)]
		if t ~= 0 then
			high = t
		end
	end
	self.ram_7f378d[i] = ((high << 8) | low) & 0xFFFF
	local delta = self:code_b88685(data_b885f5[high + 1])
	self.ram_7f36fd[i] = (self.ram_7f36fd[i] + delta) & 0xFFFF
end

function player:code_b88669(a, y)
	local x = self:code_b886fa(0x0000)
	if x < 0x0024 then
		local i = (x >> 1) + 1
		self.ram_7f36fd[i] = self.zp_4e & 0xFFFF
		self.ram_7f3745[i] = self.zp_4c & 0xFFFF
		self:code_b886e3(a & 0xFFFF, y & 0xFFFF, x)
	end
end

function player:code_b8864d()
	self:code_b88669(0x0005, 0x80F0)
	self:code_b88669(0x0003, 0x80F2)
	self:code_b88669(0x0002, 0x80F4)
end

function player:code_b88614()
	self:code_b88669(0x0005, 0x8010)
	self:code_b88669(0x0003, 0x800E)
	self:code_b88669(0x0002, 0x800C)
end

function player:code_b88600(y)
	self.zp_4c = y & 0xFFFF
	local a = self:code_b88685(self.zp_4c)
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		a = to_unsigned_16((~a + 1) - 0x0007)
	end
	self.zp_4e = to_unsigned_16((a + self.ram_xposlo) << 2)
	local high = (self.zp_4c >> 8) & 0x00FF
	local ay = self:code_b88685(high)
	self.zp_4c = to_unsigned_16((ay + self.zp_4a - self.ram_yposlo) << 2)
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		self:code_b8864d()
		return
	end
	self:code_b88614()
end

function player:code_b8852c()
	if self.ram_1e23 == 0 then
		return
	end
	self:code_b88532()
end

function player:code_b88532()
	self:code_b88692()
	local x = 0x0000
	while x < 0x0024 do
		self:code_b88545(x)
		x = (x + 2) & 0xFFFF
	end
end

function player:code_b882d9()
	if (self.ram_0579 & 0x0200) ~= 0 then
		return
	end
	for x = 0x0006, 0x0032, 0x0002 do
		local i = (x >> 1) + 1
		self.ram_norspr_spriteidlo[i] = self.ram_norspr_ramtable1665lo[i]
	end
end

function player:code_bdf78c()
	local layer_x = (self.ram_layer1xposlo - 0x0020) & 0xFFFF
	local spr_x = self.ram_xposlo & 0xFFFF
	if to_signed_16(layer_x) >= 0 then
		if layer_x >= spr_x then
			return true
		end
		local right = (layer_x + 0x0140) & 0xFFFF
		if right < spr_x then
			return true
		end
	else
		if layer_x < 0xFC00 then
			if layer_x >= spr_x then
				return true
			end
		else
			if layer_x < spr_x then
				return true
			end
		end
	end
	local a = ((self.zp_4a + 0x0020 - self.ram_yposlo) & 0xFFFF)
	self.zp_76 = a
	if self.ram_layer1yposlo >= self.zp_76 then
		return true
	end
	local b = (self.ram_layer1yposlo + 0x0120) & 0xFFFF
	if b < self.zp_76 then
		return true
	end
	return false
end

function player:code_bdf6ff()
	local layer_x = (self.ram_layer1xposlo - 0x0020) & 0xFFFF
	local spr_x = self.ram_xposlo & 0xFFFF
	if to_signed_16(layer_x) >= 0 then
		if layer_x >= spr_x then
			return true
		end
		local right = (layer_x + 0x0140) & 0xFFFF
		if right < spr_x then
			return true
		end
	else
		if layer_x < 0xFC00 then
			if layer_x >= spr_x then
				return true
			end
		else
			if layer_x < spr_x then
				return true
			end
		end
	end
	local a = ((self.zp_4a + 0x0020 - self.ram_yposlo) & 0xFFFF)
	if to_signed_16(a) < 0 then
		if to_signed_16(self.ram_yposlo) >= 0 and self.ram_yposlo < 0x0200 then
			return false
		end
		return true
	end
	self.zp_76 = a
	if self.ram_layer1yposlo >= self.zp_76 then
		return true
	end
	local b = (self.ram_layer1yposlo + 0x0120) & 0xFFFF
	if b < self.zp_76 then
		return true
	end
	return false
end

function player:code_bdf751()
	local layer_x = (self.ram_layer1xposlo - 0x0020) & 0xFFFF
	local spr_x = self.ram_xposlo & 0xFFFF
	if to_signed_16(layer_x) >= 0 then
		if layer_x >= spr_x then
			return true
		end
	else
		if layer_x < 0xFC00 then
			if layer_x >= spr_x then
				return true
			end
		else
			if layer_x < spr_x then
				return true
			end
		end
	end
	self.zp_76 = (self.zp_4a + 0x0080 - self.ram_yposlo) & 0xFFFF
	if self.ram_layer1yposlo >= self.zp_76 then
		return true
	end
	local b = (self.ram_layer1yposlo + 0x0180) & 0xFFFF
	if b < self.zp_76 then
		return true
	end
	return false
end

function player:code_bdf7d4()
	local layer_x = (self.ram_layer1xposlo - 0x0080) & 0xFFFF
	local spr_x = self.ram_xposlo & 0xFFFF
	if to_signed_16(layer_x) >= 0 then
		if layer_x >= spr_x then
			return true
		end
		local right = (layer_x + 0x0200) & 0xFFFF
		if right < spr_x then
			return true
		end
	else
		if layer_x < 0xFC00 then
			if layer_x >= spr_x then
				return true
			end
		else
			if layer_x < spr_x then
				return true
			end
		end
	end
	self.zp_76 = (self.zp_4a + 0x0020 - self.ram_yposlo) & 0xFFFF
	if self.ram_layer1yposlo >= self.zp_76 then
		return true
	end
	local b = (self.ram_layer1yposlo + 0x0120) & 0xFFFF
	if b < self.zp_76 then
		return true
	end
	return false
end

function player:code_bdf818()
	return self:code_bdf7d4()
end

function player:code_bdf81c()
	local layer_x = (self.ram_layer1xposlo - 0x00C0) & 0xFFFF
	local spr_x = self.ram_xposlo & 0xFFFF
	if to_signed_16(layer_x) >= 0 then
		if layer_x >= spr_x then
			return true
		end
		local right = (layer_x + 0x0280) & 0xFFFF
		if right < spr_x then
			return true
		end
		return false
	end
	if layer_x < 0xFC00 then
		if layer_x >= spr_x then
			return true
		end
		return false
	end
	if layer_x < spr_x then
		return true
	end
	return false
end

function player:code_bdf845()
	return self:code_bdf81c()
end

function player:code_bdf85b()
	self.zp_76 = (self.zp_4a + 0x0040 - self.ram_yposlo) & 0xFFFF
	if to_signed_16(self.ram_yspeedlo) < 0 then
		local b = (self.ram_layer1yposlo + 0x0160) & 0xFFFF
		if b < self.zp_76 then
			return true
		end
		return false
	end
	if self.ram_layer1yposlo >= self.zp_76 then
		return true
	end
	return false
end

function player:code_bdf886()
	self:code_bdf88a()
end

function player:code_bdf88a()
	local a = (self.ram_layer1xposlo - 0x0020) & 0xFFFF
	if a >= 0xFC00 then
		a = 0
	end
	self.zp_ef = a
	self.zp_f1 = (a + 0x0140) & 0xFFFF
end

function player:code_b88383()
	self.ram_057d = self.ram_057d | 0x0001
	self.ram_1a6d = 0
	self.ram_1a6b = 0
	if (self.ram_1e15 & 0x0020) ~= 0 then
		if to_signed_16(self.ram_0565) < 0 then
			self.ram_0565 = to_unsigned_16(-to_signed_16(self.ram_0565))
			local y = (self:code_809b9c() - 2) & 0xFFFF
			self.zp_40 = self.ram_1705[(y >> 1) + 1]
			self:code_8081c5(data_8081e5)
			return
		end
		if self.ram_global_entranceidlo == define_dkc1_entranceid_oildrumalley_enterbonus2 then
			local y = (self:code_809b9c() - 2) & 0xFFFF
			local entry = self.ram_1705[(y >> 1) + 1]
			local flags = data_81d102[(entry & 0xFFFF) + 1]
			if (flags & 0x0020) ~= 0 then
				self.zp_40 = entry
				self:code_8081c5(data_8081e5)
				return
			end
		end
		self.zp_40 = self.ram_0565
		self.ram_0565 = 0
		self:code_8081c5(data_8081e5)
		return
	end

	if (self.ram_1e15 & 0x0400) ~= 0 then
		local y = (self:code_809b9c() - 2) & 0xFFFF
		self.ram_0512 = self.ram_055f
		self.ram_0516 = self.ram_0561
		self.zp_40 = self.ram_0565
		self.ram_0565 = 0
		self:code_8081c5(data_8081e5)
		return
	end

	local y = (self:code_809b9c() - 2) & 0xFFFF
	self.zp_40 = self.ram_1705[(y >> 1) + 1]
	local map_flags = data_81d102[(self.zp_40 & 0xFFFF) + 1]
	if (map_flags & 0x0020) ~= 0 or (map_flags & 0x0400) ~= 0 or (map_flags & 0x0800) ~= 0 then
		if self.ram_0512 ~= 0 then
			self.ram_level_givebackanimalbuddyflaglo = self.ram_0516
		end
		self:code_bcbbba()
		self:code_8081c5(data_8081e5)
		return
	end

	self.ram_0512 = 0
	self.ram_0514 = 0
	local normalized = self:code_bcbaad(self.ram_global_entranceidlo)
	if normalized == define_dkc1_entranceid_verygnawtyslair_main then
		self:code_b884b4((define_dkc1_entranceid_kongojunglemap << 8) | define_dkc1_entranceid_monkeyminesmap)
		return
	end
	if normalized == define_dkc1_entranceid_neckysnuts_main then
		self:code_b884b4((define_dkc1_entranceid_monkeyminesmap << 8) | define_dkc1_entranceid_vinevalleymap)
		return
	end
	if normalized == define_dkc1_entranceid_bumblebrumble_main then
		self:code_b884b4((define_dkc1_entranceid_vinevalleymap << 8) | define_dkc1_entranceid_gorillaglaciermap)
		return
	end
	if normalized == define_dkc1_entranceid_reallygnawtyrampage_main then
		self:code_b884b4((define_dkc1_entranceid_gorillaglaciermap << 8) | define_dkc1_entranceid_kremkrocindustriesincmap)
		return
	end
	if normalized == define_dkc1_entranceid_bossdumbdrum_main then
		self:code_b884b4((define_dkc1_entranceid_kremkrocindustriesincmap << 8) | define_dkc1_entranceid_chimpcavernsmap)
		return
	end
	if normalized == define_dkc1_entranceid_neckysrevenge_main then
		self:code_b884b4((define_dkc1_entranceid_chimpcavernsmap << 8) | define_dkc1_entranceid_gangplankgalleon_main)
		return
	end
	if normalized == define_dkc1_entranceid_gangplankgalleon_main then
		self:code_b8851a()
		self.ram_global_entranceidlo = define_dkc1_entranceid_junglehijinxs_enterfullkongsbananahoard
		self.zp_40 = define_dkc1_entranceid_junglehijinxs_enterfullkongsbananahoard
		self.ram_057d = self.ram_057d | 0x0400
		self.ram_0579 = self.ram_0579 | 0x0001
		self.ram_player_currentkonglo = 0x0001
		self.ram_global_entranceidlo = define_dkc1_entranceid_credits
		self:code_bcb912(0x0000)
		self.zp_40 = define_dkc1_entranceid_junglehijinxs_main
		self.ram_global_entranceidlo = define_dkc1_entranceid_junglehijinxs_main
		self.ram_0565 = define_dkc1_entranceid_junglehijinxs_main
		self.ram_0563 = define_dkc1_entranceid_junglehijinxs_main
		self:code_b89633()
		self:code_80eaa6()
		return
	end

	self:code_bcb963()
	self:code_808159()
end

function player:code_b884b4(word)
	self:code_b8851a()
	local lo = word & 0x00FF
	local hi = (word >> 8) & 0x00FF
	self.zp_40 = lo
	self.ram_global_entranceidlo = hi
	self:code_b8851a()
	self:code_bcb9c2(lo, hi)
	self.ram_057d = self.ram_057d & 0xFFEF
	self:code_808159()
end

function player:code_b8851a()
	self:code_bcb999()
	self:code_bcb912(0x0000)
end

function player:code_bcbab1(v)
	return data_bcbaba[(v & 0x00FF) + 1]
end

function player:code_bcbaad(v)
	return self:code_bcbab1(v)
end

function player:code_bcb912(a)
	local x = a & 0xFFFF
	local mask
	if x == 0 then
		local map_index = self:code_bcbab1(self.ram_global_entranceidlo) & 0x00FF
		local v = self.ram_0583[map_index + 1]
		if (v & 0x0001) == 0 then
			self.ram_057d = self.ram_057d | 0x0010
		end
		local k = ((self.ram_player_currentkonglo - 1) & 0xFFFF)
		mask = ((k >> 1) | (((k & 0x0001) << 15) & 0xFFFF)) & 0xFFFF
		mask = ((mask >> 1) | (((mask & 0x0001) << 15) & 0xFFFF)) & 0xFFFF
		mask = ((mask << 8) & 0xFFFF) | ((mask >> 8) & 0x00FF)
		mask = mask | 0x0001
	else
		mask = 0x0001
		while x ~= 0 do
			mask = (mask << 1) & 0xFFFF
			x = (x - 1) & 0xFFFF
		end
	end
	if self.ram_global_entranceidlo == define_dkc1_entranceid_oildrumalley_enterbonus2 then
		mask = 0x0040
	end
	local idx = self:code_bcbab1(self.ram_global_entranceidlo) & 0x00FF
	self.ram_0583[idx + 1] = (self.ram_0583[idx + 1] | mask) & 0xFFFF
end

function player:code_bcb99d()
	local y = self:code_809b9c()
	local idx = self:code_bcbab1(self.ram_global_entranceidlo) & 0x00FF
	local v = self.ram_7efafc[idx + 1]
	if (v & 0x00FF) == 0 then
		local hi = v & 0xFF00
		self.ram_7efafc[idx + 1] = (hi | ((y >> 1) & 0x00FF)) & 0xFFFF
	end
end

function player:code_bcb999()
	self:code_bcb99d()
end

function player:code_bcb9e4()
	local a = self.zp_76
	self.zp_76 = self.zp_78
	self.zp_78 = a
end

function player:code_bcb9ed()
	local base = ((self.zp_76 & 0x00FF) << 2) & 0x03FC
	for i = 0, 3 do
		local slot = ((base + i) & 0x03FF) + 1
		local v = self.ram_7efc00[slot]
		if (v & 0x00FF) ~= 0 then
			if (v & 0x00FF) == (self.zp_78 & 0x00FF) then
				return true
			end
		else
			self.ram_7efc00[slot] = ((v | (self.zp_78 & 0x00FF)) & 0xFFFF)
			return false
		end
	end
	return true
end

function player:code_bcba14()
	for i = 1, 4 do
		local v = self.ram_7efbfc[i]
		if (v & 0x00FF) == 0 then
			self.ram_7efbfc[i] = (v | (self.zp_76 & 0x00FF)) & 0xFFFF
			local w = self.ram_7efc00[i]
			self.ram_7efc00[i] = (w | (self.zp_78 & 0x00FF)) & 0xFFFF
			return
		end
	end
end

function player:code_bcb9c6(tx, ty)
	self.zp_78 = self:code_bcbab1(tx) & 0x00FF
	self.zp_76 = self:code_bcbab1(ty) & 0x00FF
	if self:code_bcb9ed() then
		return
	end
	self:code_bcb9e4()
	self:code_bcb9ed()
	self:code_bcb9e4()
	self:code_bcba14()
end

function player:code_bcb9c2(tx, ty)
	self:code_bcb9c6(tx, ty)
end

function player:code_bcba3c()
	local x = 1
	while true do
		local v = data_bcba67[x]
		if v == nil or v == 0x00 then
			return
		end
		if v == (self.ram_global_entranceidlo & 0x00FF) then
			local ty = data_bcba67[x + 1] & 0x00FF
			local tx = data_bcba67[x + 2] & 0x00FF
			self:code_bcb9c6(tx, ty)
		end
		x = x + 3
	end
end

function player:code_bcb963()
	local idx = self:code_bcbab1(self.ram_global_entranceidlo) & 0x00FF
	self.ram_7ef9fc[idx + 1] = idx
	self.ram_7efbfc[1] = 0
	self.ram_7efbfc[2] = 0
	self.ram_7efbfc[3] = 0
	self.ram_7efbfc[4] = 0
	self.ram_7efc00[1] = 0
	self.ram_7efc00[2] = 0
	self.ram_7efc00[3] = 0
	self.ram_7efc00[4] = 0
	self:code_bcb99d()
	self:code_bcb9c6(self.zp_40 & 0x00FF, self.ram_global_entranceidlo & 0x00FF)
	self.ram_global_entranceidlo = self:code_bcbab1(self.ram_global_entranceidlo) & 0x00FF
	self:code_bcba3c()
end

function player:code_bcbbba()
	self.ram_0537 = self.ram_global_entranceidlo & 0xFFFF
	for x = 0x0010, 0, -2 do
		self.ram_0539[(x >> 1) + 1] = self.ram_1a2b[(x >> 1) + 1]
	end
end

function player:code_8081c5(data_ptr)
	self.ram_050a = data_ptr
	self.ram_050c = 0
	self:code_8081d4()
end

function player:code_8081d4()
	local x = ((self.ram_050c & 0xFFFF) << 1) + 1
	self.ram_0508 = self.ram_050a[x]
end

function player:code_80812b()
	self.ram_global_entranceidlo = 0
	self.reset_requested = true
end

function player:code_808131()
	if to_signed_16(self.ram_player_currentlifecountlo) < 0 then
		self:code_80812b()
		return
	end
	self.ram_global_entranceidlo = self:code_bcbaad(self.ram_global_entranceidlo) & 0xFFFF
	if self.zp_42 == 0x0001 and self.ram_player_currentkonglo ~= 0 then
		self.ram_player_currentkonglo = (self.ram_player_currentkonglo ~ 0x0003) & 0xFFFF
	end
	self.ram_057d = (self.ram_057d | 0x0008) & 0xFFFF
	self:code_808159()
end

function player:code_808159()
	if self.zp_42 == 0x0002 then
		self:code_b89256()
		local lives = self.ram_player_currentlifecountlo
		self:code_b89256()
		if to_signed_16(lives) >= 0 then
			self.ram_057d = self.ram_057d | 0x0040
		end
	end
	self:code_80817b()
end

function player:code_80817b()
	local a = self.zp_40 & 0xFFFF
	if a == 0 then
		a = self.ram_global_entranceidlo & 0xFFFF
		self.zp_40 = a
	end
	if a == define_dkc1_entranceid_invalidmap then
		self.zp_40 = define_dkc1_entranceid_kongojunglemap
		self.ram_transition_route = 'map'
		return
	end
	if a == define_dkc1_entranceid_chimpcavernsmap
		or a == define_dkc1_entranceid_kremkrocindustriesincmap
		or a == define_dkc1_entranceid_gorillaglaciermap
		or a == define_dkc1_entranceid_vinevalleymap
		or a == define_dkc1_entranceid_kongojunglemap
		or a == define_dkc1_entranceid_monkeyminesmap
		or a == define_dkc1_entranceid_gangplankgalleon_main
	then
		self.ram_transition_route = 'map'
		return
	end
	self.ram_transition_route = 'level'
end

function player:code_b89256()
	local w0 = self.ram_7efbfc[1]
	local w1 = self.ram_7efbfc[2]
	local w2 = self.ram_7efc00[1]
	local w3 = self.ram_7efc00[2]
	self:code_b89283()
	self.ram_7efc00[2] = w3
	self.ram_7efc00[1] = w2
	self.ram_7efbfc[2] = w1
	self.ram_7efbfc[1] = w0
end

function player:code_b89333()
	if (self.zp_44 & 0xFFFF) == 0 then
		self.ram_wram_address = 0x7F2331
	else
		self.ram_wram_address = 0x7F2555
	end
end

function player:code_b899e4()
	for i = 1, 0x282 do
		self.ram_7efafc[i] = 0
	end
	for x = 0x00FF, 0, -1 do
		self.ram_7ef9fc[x + 1] = x & 0x00FF
	end
end

function player:code_b892fe()
	self:code_b89333()
	for i = 0, 0x000B do
		self.ram_save_wram_window[i + 1] = self.ram_save_wram_window[i + 1]
	end
	for i = 0, 0x0117 do
		self.ram_save_wram_window[0x0010 + i + 1] = self.ram_save_wram_window[0x0010 + i + 1]
	end
	for i = 0, 0x00FF do
		self.ram_save_wram_window[0x0200 + i + 1] = self.ram_7ef9fc[i + 1] & 0x00FF
	end
end

function player:code_b892ba()
	self:code_b89333()
	for i = 0, 0x00FF do
		self.ram_7ef9fc[i + 1] = self.ram_save_wram_window[0x0200 + i + 1] & 0x00FF
	end
	self.ram_player_displayedbananacountlo = self.ram_player_currentbananacountlo
	self:code_b8994e()
end

function player:code_b892e9()
	for i = 0, 0x00FF do
		self.ram_7ef9fc[i + 1] = self.ram_save_wram_window[0x0200 + i + 1] & 0x00FF
	end
end

function player:code_b892a3()
	self:code_bcb9c2(0x0001, 0x00EC)
	self.ram_7efbe6 = (self.ram_7efafc[1] >> 8) & 0x00FF
end

function player:code_b897de()
	self:code_b899e4()
	local x = 1
	while true do
		local a = data_b89853[x]
		if a == nil or a == 0x00 then
			break
		end
		local y = a & 0x00FF
		if ((self.ram_0583[y + 1] or 0) & 0x0001) ~= 0 then
			local ty = data_b89853[x + 1] & 0x00FF
			local tx = data_b89853[x + 2] & 0x00FF
			self:code_bcb9c2(tx, ty)
		end
		x = x + 3
	end
	for i = 0x00FF, 1, -1 do
		local v = self.ram_0583[i + 1]
		local c = (v >> 1) & 0x0001
		if c ~= 0 then
			local add = ((v & 0x0040) ~= 0) and 0x0002 or 0x0001
			self.ram_7efafc[i + 1] = (self.ram_7efafc[i + 1] | add) & 0xFFFF
		end
	end
	self.ram_7efbfc[1] = 0
	self.ram_7efbfc[2] = 0
	self.ram_7efc00[1] = 0
	self.ram_7efc00[2] = 0
	self:code_bcb9c2(0x0001, 0x00EC)
end

function player:code_b8953c(slot)
	self.ram_ramtable14f9lo = (slot << 1) & 0xFFFF
end

function player:code_b89283()
	if self.zp_42 ~= 0x0002 then
		return
	end
	self:code_b892fe()
	self.zp_44 = self.zp_44 ~ 0x0001
	self:code_b892ba()
	self:code_b897de()
	self:code_b892e9()
	self:code_b892a3()
end

function player:code_b89633()
	local slot = self.ram_fileselect_currentselectionlo
	self:code_b8953c(slot)
	if self.zp_42 == 0x0002 then
		self:code_b89283()
		self:code_b8953c(slot)
		self:code_b89283()
	end
end

function player:code_80eaa6()
	self.ram_transition_route = 'credits'
end

function player:code_b880ce()
	self:code_b880d2()
end

function player:code_b5801c()
	if self:code_bdf3bf() then
		return true
	end
	self.ram_ramtable1595lo = 0
	self.ram_ramtable11a1lo = 0
	self.ram_ramtable123dlo = 0
	return false
end

function player:code_b5802f()
	if self:code_bdf404() then
		return true
	end
	self.ram_ramtable123dlo = 0
	self.ram_ramtable11d5lo = 0
	self.ram_ramtable1595lo = 0
	self.ram_ramtable11a1lo = 0
	return false
end

function player:code_b6bb49()
	local e = self.ram_global_entranceidlo & 0xFFFF
	if e == define_dkc1_entranceid_minecartmadness_main
		or e == define_dkc1_entranceid_minecartmadness_checkpointbarrel
		or e == define_dkc1_entranceid_minecartmadness_exitbonus1
		or e == define_dkc1_entranceid_minecartmadness_exitbonus2
		or e == define_dkc1_entranceid_minecartmadness_exitbonus3
	then
		local x = self.ram_xposlo & 0xFFFF
		local y = self.ram_yposlo & 0xFFFF
		local rows = {
			{ 0xFFC0, 0x0290, 0x2490, 0xFFC0 },
			{ 0x2530, 0x27A0, 0xFFC0, 0x2830 },
			{ 0x2A80, 0xFFC0, 0x2B10, 0x2BC0 },
			{ 0xFFC0, 0x2CA0, 0x2E50, 0xFFC0 },
			{ 0x2ED0, 0x3480, 0xFFC0, 0x3500 },
			{ 0x37D0, 0x0000, 0x0000, 0x0000 },
		}
		for i = 1, #rows do
			local r = rows[i]
			local miny, minx, maxx, flag = r[1], r[2], r[3], r[4]
			if x >= minx and x < maxx and y >= miny then
				return true
			end
			if flag ~= 0 and (flag & 0xFFFF) ~= 0 then
				-- continue scan
			end
		end
		return false
	end
	if e == define_dkc1_entranceid_minecartcarnage_main
		or e == define_dkc1_entranceid_minecartcarnage_checkpointbarrel
		or e == define_dkc1_entranceid_minecartcarnage_warp
	then
		local x = self.ram_xposlo & 0xFFFF
		local y = self.ram_yposlo & 0xFFFF
		local miny, minx, maxx = 0xFFC0, 0x01D0, 0x4880
		if x >= minx and x < maxx and y >= miny then
			return true
		end
		return false
	end
	return false
end

function player:code_bffb2b(sound_id)
	self.zp_f5 = sound_id & 0xFFFF
	if self.zp_32 == 0x0005 then
		self:code_bffb19(0x0500)
	else
		self:code_bffb19(0x0600)
	end
end

function player:code_bffb27(sound_id)
	self:code_bffb2b(sound_id)
end

function player:code_bffb09(sound_id)
	self.zp_f5 = sound_id & 0xFFFF
	if self.zp_32 == 0x0005 then
		self:code_bffb19(0x0400)
	else
		self:code_bffb19(0x0500)
	end
end

function player:code_bffb19(prefix)
	self.ram_sound_last = to_unsigned_16((prefix & 0xFF00) | (self.zp_f5 & 0x00FF))
	self:code_8ab1aa(self.ram_sound_last)
end

function player:code_8ab1aa(_cmd)
	self.ram_apu_port0 = self.ram_apu_port0 or 0
	self.ram_apu_port1 = self.ram_apu_port1 or 0
	self.ram_apu_port1 = _cmd & 0xFFFF
	self.ram_apu_port0 = ((self.ram_apu_port0 ~ 0x80) | 0x01) & 0xFF
end

function player:code_809b9c()
	return self.zp_84
end

function player:code_bdf3bf()
	return self:code_bdf3c3()
end

function player:code_bdf404()
	if self:code_bdf3c3() then
		return true
	end
	local i = (self.zp_86 >> 1) + 1
	self.ram_norspr_displayedposelo[i] = 0
	if self:code_bdf346() then
		return true
	end
	return false
end

function player:code_bdf7d0()
	return self:code_bdf78c()
end

function player:code_bfa02c()
	if self.zp_32 == 0x0003 then
		self.ram_ramtable1029lo = 0x0036
	else
		self.ram_ramtable1029lo = 0x0002
	end
end

function player:code_bf952b()
	self.ram_ramtable1029lo = 0
	self:code_be80a4(define_dkc1_animationid_dk_getoffanimalbuddy)
end

function player:code_bfa8b5()
	self:code_bfaa82()
end

function player:code_bfa9b3(anim)
	if self.ram_16ad == (anim & 0xFFFF) then
		return
	end
	self:code_be80a4(anim)
end

function player:code_bfa9de(v)
	local n = to_signed_16(v)
	if n == 0 then
		return 0
	end
	if n < 0 then
		n = -n
		if n < 0x0004 then
			return to_unsigned_16(-(n << 8))
		end
		n = n << 4
		if n < 0x0300 then
			n = 0x0300
		end
		return to_unsigned_16(-n)
	end
	if n < 0x0004 then
		return to_unsigned_16(n << 8)
	end
	n = n << 4
	if n < 0x0300 then
		n = 0x0300
	end
	return to_unsigned_16(n)
end

function player:code_bfa9bf()
	local dx = to_unsigned_16(self.ram_16b9 - self.ram_xposlo)
	self.ram_xspeedlo = self:code_bfa9de(dx)
	local dy = to_unsigned_16(self.ram_16bd - self.ram_yposlo)
	self.ram_yspeedlo = self:code_bfa9de(dy)
end

function player:code_bfaf4e()
	self:code_bfaf38()
end

function player:code_bfaf9b()
	local pos = self.ram_xposlo
	local speed = self.ram_xspeedlo
	local frac = self.ram_ramtable0db9lo
	local hi = (speed >> 8) & 0xFF
	if (speed & 0x8000) ~= 0 then
		hi = hi | 0xFF00
	end
	frac = to_unsigned_16(frac + (hi & 0xFF00))
	pos = to_unsigned_16(pos + to_signed_16(hi))
	self.ram_ramtable0db9lo = frac
	self.ram_xposlo = pos
end

function player:code_bfafc9()
	local pos = self.ram_yposlo
	local speed = self.ram_yspeedlo
	local frac = self.ram_ramtable0e21lo
	local hi = (speed >> 8) & 0xFF
	if (speed & 0x8000) ~= 0 then
		hi = hi | 0xFF00
	end
	frac = to_unsigned_16(frac + (hi & 0xFF00))
	pos = to_unsigned_16(pos + to_signed_16(hi))
	self.ram_ramtable0e21lo = frac
	self.ram_yposlo = pos
end

function player:code_bfb1e5(profile_id)
	local pid = profile_id & 0xFFFF
	local target = self.ram_ramtable0f8dlo
	local current = self.ram_yspeedlo
	local delta = to_signed_16(target - current)
	local ad = delta
	if ad < 0 then
		ad = -ad
	end
	local step = self:data_bfb255_profile(pid, ad)
	if step == 0 then
		self.ram_yspeedlo = target
		return
	end
	if delta < 0 then
		step = -step
	end
	self.ram_yspeedlo = to_unsigned_16(to_signed_16(current) + step)
end

function player:code_bfb21f(profile_id)
	local pid = profile_id & 0xFFFF
	local target = self.ram_ramtable0f25lo
	local current = self.ram_xspeedlo
	local delta = to_signed_16(target - current)
	local ad = delta
	if ad < 0 then
		ad = -ad
	end
	local step = self:data_bfb255_profile(pid, ad)
	if step == 0 then
		self.ram_xspeedlo = target
		return
	end
	if delta < 0 then
		step = -step
	end
	self.ram_xspeedlo = to_unsigned_16(to_signed_16(current) + step)
end

function player:code_bfaf69()
	self.zp_4c = 0xFEC0
	if (self.ram_16ed & 0x0400) ~= 0 then
		self.zp_4c = 0xFE00
	end
	local n = to_signed_16(self.ram_yspeedlo) + to_signed_16(0xFFF4)
	if n < to_signed_16(self.zp_4c) then
		n = to_signed_16(self.zp_4c)
	end
	self.ram_yspeedlo = to_unsigned_16(n)
end

function player:code_bf8658()
	self:code_bfaf69()
	self:code_bf865b()
end

function player:code_bf865b()
	self.ram_ramtable11d5lo = 0x0002
	self:code_bfb18c()
	self:code_bf8667()
end

function player:code_bf8667()
	self:code_bf86de()
	self:code_bfa89a()
	self:code_bfacda()
	self:code_bf8670()
end

function player:code_bf8670()
	self:code_bf870d()
	self:code_bf867e()
	self:code_be80e1()
	self:code_bfa44a()
end

function player:code_bf8711()
	local left = self.zp_a6
	self.ram_1b23 = left
	self.ram_1b25 = self.zp_aa
end

function player:code_bfa041()
	if self.ram_ramtable13e9lo == 0 then
		return
	end
	local cart = self:dkc1_get_any_sprite_by_slot(self.ram_ramtable13e9lo)
	if cart == nil or cart.dkc1_sprite_id ~= define_dkc1_norspr51_minecart then
		self.ram_ramtable1029lo = 0x0040
		self.ram_xspeedlo = self.ram_ramtable0ebdlo
		self.ram_ramtable0f25lo = self.ram_ramtable0ebdlo
		return
	end
	local rel = to_signed_16(self.zp_4a - cart.y - self.ram_layer1yposlo)
	if rel >= 0x00E0 and (self.ram_ramtable12a5lo & 0x0001) == 0 then
		self.ram_ramtable1029lo = 0x0040
		self.ram_xspeedlo = self.ram_ramtable0ebdlo
		self.ram_ramtable0f25lo = self.ram_ramtable0ebdlo
		return
	end
	self.ram_xposlo = cart.x
	self.ram_ramtable0ebdlo = cart.x_speed_subpx
	self.ram_xspeedlo = 0
	self.ram_1a69 = 0x0060
	self.ram_0579 = self.ram_0579 | 0x0080
end

function player:code_bfa38f()
	local hit_flags = self.ram_ramtable1595lo & 0x7FFF
	if hit_flags == 0x0001 or hit_flags == 0x0020 then
		self.ram_ramtable1595lo = 0
		self:code_bfa17e()
		return true
	end
	self.ram_ramtable1595lo = 0
	return false
end

function player:code_bf867e()
	if self.ram_16ad == define_dkc1_animationid_dk_swimming then
		self.ram_animation_speed = math.max(0x0100, to_unsigned_16(self.ram_animation_speed - 0x0010))
		return
	end
	if self.ram_16ad == define_dkc1_animationid_enguarderiddenbydk_idle
		or self.ram_16ad == define_dkc1_animationid_enguarderiddenbydhk_swim
	then
		local ay = abs_16(self.ram_yspeedlo)
		local ax = abs_16(self.ram_xspeedlo)
		local v = ax
		if ay > v then
			v = ay
		end
		if v < 0x00C0 then
			v = 0x00C0
		end
		self.ram_animation_speed = v
		return
	end
	if self.ram_16ad == define_dkc1_animationid_dk_getoffunderwateranimalbuddy then
		self.ram_animation_speed = 0x0100
	end
end

function player:code_bfacb3()
	local probe_y = self:code_818000()
	self.ram_ramtable0c35lo = probe_y
	if (self.zp_9e & 0x0020) == 0 then
		local delta = to_unsigned_16(probe_y - self.ram_yposlo)
		self.ram_ramtable1631lo = delta
		return to_unsigned_16(delta - 1)
	end
	local delta = to_unsigned_16(self.ram_yposlo - probe_y)
	self.ram_ramtable1631lo = delta
	return delta
end

function player:code_bfacda()
	local saved_x = self.ram_xposlo
	local saved_y = self.ram_yposlo

	local a = self:code_bfacb3()
	if to_signed_16(a) < 0 then
		self:code_bfaf9b()
		local probe_y = self:code_818000()
		self.ram_ramtable0c35lo = probe_y
		if (self.zp_9e & 0x0020) == 0 then
			local delta = to_unsigned_16(probe_y - self.ram_yposlo)
			self.ram_ramtable1631lo = delta
			a = to_unsigned_16(delta - 1)
			if to_signed_16(a) >= 0 then
				if a < 0x0003 then
					self.ram_yposlo = to_unsigned_16(a + self.ram_yposlo + 1)
				elseif (self.zp_9c & 0x0020) == 0 then
					self.ram_ramtable0f25lo = 0x0000
					self.ram_xspeedlo = 0x0000
					self.ram_xposlo = saved_x
					self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0002
				end
			end
		else
			a = to_unsigned_16(self.ram_yposlo - probe_y)
			self.ram_ramtable1631lo = a
			if to_signed_16(a) >= 0 then
				if a < 0x0003 then
					local v = (a ~ 0xFFFF) & 0xFFFF
					v = to_unsigned_16(v - 1)
					self.ram_yposlo = to_unsigned_16(v + self.ram_yposlo)
				elseif (self.zp_9c & 0x0020) == 0 then
					self.ram_ramtable0f25lo = 0x0000
					self.ram_xspeedlo = 0x0000
					self.ram_xposlo = saved_x
					self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0002
				end
			end
		end
	else
		if a < 0x0003 then
			self.ram_yposlo = to_unsigned_16(a + self.ram_yposlo + 1)
		elseif (self.zp_9c & 0x0040) ~= 0 then
			self:code_bfaf9b()
		end
	end

	a = self:code_bfacb3()
	if to_signed_16(a) >= 0 then
		self:code_bfafc9()
		self.ram_ramtable1209lo = self.zp_9c
		return
	end

	if to_signed_16(self.ram_yspeedlo) < 0 then
		self:code_bfafc9()
		local probe_y = self:code_818000()
		local delta = to_unsigned_16(probe_y - self.ram_yposlo)
		if (self.zp_9e & 0x0020) == 0 then
			if to_signed_16(delta) >= 0 then
				self.ram_yposlo = probe_y
				self.ram_yspeedlo = 0x0000
				self.ram_ramtable1631lo = 0x0000
				self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
				self.ram_ramtable1209lo = self.zp_9c
				return
			end
		elseif to_signed_16(delta) < 0 then
			self.ram_yposlo = probe_y
			self.ram_yspeedlo = 0x0000
			self.ram_ramtable1631lo = 0x0000
			self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
			self.ram_ramtable1209lo = self.zp_9c
			return
		end

		self.ram_ramtable1631lo = delta
		if (self.ram_ramtable12a5lo & 0x0101) == 0x0100 then
			self.ram_yspeedlo = 0xFFFF
		end
		self.ram_ramtable1209lo = self.zp_9c
		return
	end

	self:code_bfafc9()
	a = self:code_bfacb3()
	if to_signed_16(a) >= 0 and (self.zp_9b & 0x4000) == 0 then
		self.ram_yposlo = saved_y
		self.ram_yspeedlo = 0x0000
	end
	self.ram_ramtable1209lo = self.zp_9c
end

function player:code_bfc42d()
	local idx = self.ram_1811 & 0x003F
	self.ram_ramtable0fc1lo = self.ram_xposlo
	self.ram_ramtable0ff5lo = self.ram_yposlo
	self.ram_xposlo = self.ram_1815[idx + 1]
	self.ram_yposlo = self.ram_1855[idx + 1]
	self.ram_1921 = self.ram_18d5[idx + 1]
	self.ram_16cd = self.ram_1895[idx + 1]
	local prev = (self.ram_1813 - 2) & 0x003F
	local dx = to_signed_16(self.ram_1815[prev + 1] - self.ram_xposlo)
	self.zp_76 = dx & 0xFFFF
	if dx ~= 0 then
		self:code_bf8c8e()
	end
	self.ram_ramtable1631lo = to_unsigned_16(self:code_818000() - self.ram_yposlo)
	if self.ram_ramtable1631lo == 0 then
		local adx = abs_16(self.zp_76)
		if (self.ram_1917 & 0x0020) ~= 0 then
			self.ram_1917 = self.ram_1917 ~ 0x0020
		elseif (self.ram_1917 & 0x0008) == 0 then
			if adx >= 0x001C then
				self.ram_1917 = self.ram_1917 | 0x0008
			end
		elseif adx < 0x001C then
			self.ram_1917 = self.ram_1917 & 0xFFF7
		end
		local n = (self.ram_1811 + 2) & 0x003F
		if n ~= self.ram_1813 then
			self.ram_1811 = n
			self.ram_1917 = self.ram_1917 | 0x0004
			self.ram_1915 = 0x0003
		end
		return
	end
	local n = (self.ram_1811 + 2) & 0x003F
	if n ~= self.ram_1813 then
		self.ram_1811 = n
		self.ram_1917 = self.ram_1917 | 0x0002
	end
end

function player:code_bfc501()
	local idx = self.ram_1811 & 0x003F
	self.ram_ramtable0fc1lo = self.ram_xposlo
	self.ram_ramtable0ff5lo = self.ram_yposlo
	self.ram_xposlo = self.ram_1815[idx + 1]
	self.ram_yposlo = self.ram_1855[idx + 1]
	self.ram_1921 = self.ram_18d5[idx + 1]
	self.ram_16cd = self.ram_1895[idx + 1]
	local prev = (self.ram_1813 - 2) & 0x003F
	local dx = to_signed_16(self.ram_1815[prev + 1] - self.ram_xposlo)
	self.zp_76 = dx & 0xFFFF
	if dx ~= 0 then
		self:code_bf8c8e()
	end
end

function player:code_bfb075()
	self:code_bfaf9b()
	self:code_bfafc9()
end

function player:code_bfb0d1()
	local spd = self.ram_xspeedlo
	local hi = (spd >> 8) & 0xFF
	if (spd & 0x8000) ~= 0 then
		hi = hi | 0xFF00
	end
	self.ram_ramtable0db9lo = to_unsigned_16(self.ram_ramtable0db9lo + (hi & 0xFF00))
	self.ram_xposlo = to_unsigned_16(self.ram_xposlo + to_signed_16(hi))
end

function player:code_bfb0fe()
	local spd = self.ram_yspeedlo
	local hi = (spd >> 8) & 0xFF
	if (spd & 0x8000) ~= 0 then
		hi = hi | 0xFF00
	end
	self.ram_ramtable0e21lo = to_unsigned_16(self.ram_ramtable0e21lo + (hi & 0xFF00))
	self.ram_yposlo = to_unsigned_16(self.ram_yposlo + to_signed_16(hi))
end

function player:code_bffb7f()
	if (self.ram_ramtable12a5lo & 0x0400) == 0 then
		self.zp_2c = self.ram_xposlo
		self:code_bfb0d1()
		self.zp_92 = self:code_818000()
		local d = to_signed_16(self.zp_92 - self.ram_yposlo)
		if d > 0 then
			if d >= 0x0009 then
				if (self.zp_9c & 0x0020) == 0 then
					self.ram_ramtable0f25lo = 0
					self.ram_xspeedlo = 0
					self.ram_xposlo = self.zp_2c
					self.ram_ramtable0db9lo = 0
					self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0002
				end
				self.zp_92 = self:code_818000()
				self.ram_ramtable0c35lo = self.zp_92
				self.ram_ramtable1631lo = to_unsigned_16(self.zp_92 - self.ram_yposlo)
				if to_signed_16(self.ram_ramtable1631lo) >= 0 then
					self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0004
				end
				self.ram_ramtable1209lo = self.zp_9c
				return
			end
			if (self.zp_9c & 0x0007) < self.zp_f3 then
				self.ram_yposlo = self.zp_92
			else
				self.ram_ramtable0f25lo = 0
				self.ram_xspeedlo = 0
				self.ram_xposlo = self.zp_2c
				self.ram_ramtable0db9lo = 0
				self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0002
			end
		end
	else
		self.zp_2c = self.ram_xposlo
		self:code_bfb0d1()
		self.zp_92 = self:code_818000()
		local d = to_signed_16(self.zp_92 - self.ram_yposlo)
		if d >= 0x0003 then
			if (self.zp_9c & 0x0040) == 0 then
				self.ram_xposlo = self.zp_2c
				self.ram_ramtable0db9lo = 0
				self.ram_ramtable0f25lo = 0
				self.ram_xspeedlo = 0
				self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0002
			end
			self.zp_92 = self:code_818000()
			self.ram_ramtable0c35lo = self.zp_92
			self.ram_ramtable1631lo = to_unsigned_16(self.zp_92 - self.ram_yposlo)
			if to_signed_16(self.ram_ramtable1631lo) >= 0 then
				self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0004
			end
			self.ram_ramtable1209lo = self.zp_9c
			return
		end
		if d > 0 then
			self.ram_yposlo = self.zp_92
		end
	end

	if to_signed_16(self.ram_yspeedlo) < 0 then
		self:code_bfb0fe()
		local h = self:code_818000()
		local d = to_signed_16(h - self.ram_yposlo)
		if d >= to_signed_16(0xFFFC) then
			self.ram_yposlo = h
			self.ram_ramtable1209lo = self.zp_9c
			self.ram_yspeedlo = 0xFD00
			self.ram_ramtable0e21lo = 0
			self.ram_ramtable1631lo = 0
			self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
			return
		end
		self.ram_ramtable1631lo = to_unsigned_16(d)
		self.ram_ramtable0c35lo = h
		if (self.ram_ramtable12a5lo & 0x0100) ~= 0 then
			self.ram_yspeedlo = 0xFFFF
		end
		self.ram_ramtable1209lo = self.zp_9c
		return
	end

	self.zp_2c = self.ram_yposlo
	self:code_bfb0fe()
	local h = self:code_818000()
	local d = to_signed_16(h - self.ram_yposlo)
	if d > 0 and (self.zp_9b & 0x4000) == 0 then
		self.ram_yposlo = self.zp_2c
		self.ram_yspeedlo = 0
		self.ram_ramtable0c35lo = self:code_818000()
		self.ram_ramtable1631lo = to_unsigned_16(self.ram_ramtable0c35lo - self.ram_yposlo)
		self.ram_ramtable1209lo = self.zp_9c
		return
	end
	self.ram_ramtable1631lo = to_unsigned_16(d)
	self.ram_ramtable0c35lo = h
	self.ram_ramtable1209lo = self.zp_9c
end

function player:code_bf8573()
	self:code_bfaf38()
	self:code_bf8576()
end

-- code_bfbda9: roll initiation (line 112223)
function player:code_bfbda9()
	-- lda.w #$0012
	self.ram_ramtable1029lo = 0x0012  -- roll state
	
	-- lda.w $16f1,y  (current x speed)
	local speed = self.ram_16f1
	
	-- bit.w !ram_dkc1_norspr_yxppccctlo,x
	-- bvc.b code_bfbdbb
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		-- facing left, negate
		-- eor.w #$ffff / inc
		speed = ((-to_signed_16(speed)) & 0xffff)
	end
	
	-- code_bfbdbb:
	-- sta.w !ram_dkc1_norspr_ramtable0f25lo,x
	self.ram_ramtable0f25lo = speed
	
	-- set roll flag
	-- lda.w $1699,y / ora.w #$0080
	self.ram_1699 = self.ram_1699 | 0x0080
	
	-- lda.w #!define_dkc1_animationid_dk_roll
	self:code_be80a4(define_dkc1_animationid_dk_roll)
	self.roll_script_kind = 'roll'
	self.roll_script_frame = 0

	-- jsr.w code_bf902b
	self:code_bf902b()
	self.ram_1e19 = self.ram_1e19 | 0x0001
end

-- code_bfbde7: roll chain (line 112246)
function player:code_bfbde7()
	-- lda.w #$0003
	self.ram_16e5 = 0x0003
	
	-- lda.b $28 / sta.w $16a1,y
	self.ram_16a1 = self.zp_28
	
	-- lda.w $16f1,y
	local speed = self.ram_16f1
	-- clc / adc.w #$0100
	speed = speed + 0x0100
	
	-- cmp.w #$0800
	if speed >= 0x0800 then
		speed = 0x0800
	end
	
	-- code_bfbe05:
	-- sta.w $16f1,y
	self.ram_16f1 = speed
	
	-- jsl.l code_bfbda9
	self:code_bfbda9()
end

-- ============================================================================
-- collision & physics integration
-- ============================================================================

function player:get_overlapping_solid(x, y)
	local solids = self.level.solids
	for i = 1, #solids do
		local box = solids[i]
		if x < (box.x + box.w) and (x + self.width) > box.x and 
		   y < (box.y + box.h) and (y + self.height) > box.y then
			return box
		end
	end
	return nil
end

function player:is_grounded_probe()
	return self:get_overlapping_solid(self.ram_xposlo, self.ram_yposlo + 1) ~= nil
end

function player:move_horizontal_pixels(step_pixels)
	if step_pixels == 0 then
		return false, nil
	end
	local direction = 1
	if step_pixels < 0 then
		direction = -1
	end
	local remaining = abs_16(step_pixels)
	
		while remaining > 0 do
			local next_x = self.ram_xposlo + direction
			local solid = self:get_overlapping_solid(next_x, self.ram_yposlo)
			if solid ~= nil then
				-- collision
				self.ram_xspeedlo = 0
				self.pos_subx = self.ram_xposlo * 0x0100
				return true, solid
			end
			self.ram_xposlo = next_x
			remaining = remaining - 1
		end
	return false, nil
end

function player:move_vertical_pixels(step_pixels)
	if step_pixels == 0 then
		return false, false, nil
	end
	local direction = 1
	if step_pixels < 0 then
		direction = -1
	end
	local remaining = abs_16(step_pixels)
	local grounded = false
	
	while remaining > 0 do
		local next_y = self.ram_yposlo + direction
		local solid = self:get_overlapping_solid(self.ram_xposlo, next_y)
			if solid ~= nil then
				-- collision
				if direction > 0 then
				-- hit ground
				grounded = true
				self.ram_yspeedlo = 0xFFFF
				self.ram_ramtable1631lo = 0
			else
				self.ram_yspeedlo = 0
				self.ram_ramtable1631lo = 0xFFFF
				end
				self.pos_suby = self.ram_yposlo * 0x0100
				return true, grounded, solid
			end
			self.ram_yposlo = next_y
			remaining = remaining - 1
		end
	return false, grounded, nil
end

function player:resolve_collision_raw_9c(solid)
	return solid.dkc1_collision9c & 0xFFFF
end

function player:code_818003_read_d3_word(offset)
	local idx = (offset >> 1) + 1
	return self.ram_d3_words[idx] & 0xFFFF
end

function player:code_818003_read_d7_byte(offset)
	return self.ram_d7_bytes[offset + 1] & 0x00FF
end

function player:code_818003(sample_x)
	self.zp_4c = sample_x & 0xFFFF
	self.ram_08ab = self.zp_84 & 0xFFFF
	return self[self.ram_1b0f](self)
end

function player:code_818448(a)
	return self[self.zp_9a_fn](self, a & 0xFFFF)
end

function player:code_8180ff(y)
	self.zp_94 = self.zp_98 & 0xFFFF
	local a = self:code_818003_read_d3_word(y & 0xFFFF)
	local x = y & 0xFFFF
	self.zp_9a = a & 0xFFFF
	if self.zp_9a == 0 then
		return 0xFFFF
	end
	if (self.zp_9a & 0x4000) ~= 0 then
		self.zp_94 = (self.zp_98 ~ 0x001F) & 0xFFFF
	end
	a = self.zp_9a & 0x3FFF
	if a >= self.ram_db then
		return 0xFFFF
	end
	y = (a << 1) & 0xFFFF
	if (self.zp_94 & 0x0010) ~= 0 then
		y = (y + 1) & 0xFFFF
	end
	a = self:code_818003_read_d7_byte(y)
	if (a & 0x0080) ~= 0 then
		self.zp_94 = (self.zp_94 ~ 0x000F) & 0xFFFF
		a = self:code_818003_read_d7_byte(y)
	end
	y = x
	if (self.zp_9a & 0x4000) ~= 0 then
		a = (a ~ 0x0080) & 0x00FF
	end
	self.zp_9c = a & 0xFFFF
	a = a & 0x003F
	if a == 0 then
		return 0xFFFF
	end
	self.zp_9a_fn = data_8184c9[a]
	a = self.zp_94 & 0x000F
	a = self:code_818448(a)
	if to_signed_16(to_unsigned_16(a - 0x001F)) >= 0 then
		a = 0x001F
	end
	return a & 0xFFFF
end

function player:code_81800d()
	self.zp_98 = self.zp_4c & 0x001F
	self.zp_9c = 0x0000
	local a = self.ram_yposlo & 0xFFFF
	if to_signed_16(a) < 0 then
		a = 0x0000
	end
	if a >= 0x01FF then
		a = 0x01FF
	end
	self.zp_96 = a & 0x01E0
	self.zp_4c = self.zp_4c & 0xFFE0
	a = ((self.zp_96 ~ 0x01E0) >> 4) & 0xFFFF
	local y = (a + self.zp_4c) & 0xFFFF
	a = self:code_8180ff(y)
	self.zp_9e = self.zp_9c
	if to_signed_16(a) < 0 then
		y = (y + 2) & 0xFFFF
		if (y & 0x001E) == 0 then
			self.zp_9c = 0x0000
			return 0xFFC0
		end
		self.zp_96 = (self.zp_96 - 0x0020) & 0xFFFF
		a = self:code_8180ff(y)
		if to_signed_16(a) < 0 then
			y = (y + 2) & 0xFFFF
			if (y & 0x001E) == 0 then
				self.zp_9c = 0x0000
				return 0xFFC0
			end
			self.zp_96 = (self.zp_96 - 0x0020) & 0xFFFF
			a = self:code_8180ff(y)
			if to_signed_16(a) < 0 then
				self.zp_9c = 0x0000
				return 0xFFC0
			end
		end
		y = a & 0xFFFF
		a = (y | self.zp_96) & 0xFFFF
	else
		if a == 0x001F then
			if (y & 0x001E) ~= 0 then
				y = (y - 2) & 0xFFFF
				self.zp_4c = self.zp_9c
				a = self:code_8180ff(y)
				if to_signed_16(a) < 0 then
					self.zp_9c = self.zp_4c
					y = 0x001F
					a = (0x001F | self.zp_96) & 0xFFFF
				else
					y = a & 0xFFFF
					a = ((y | 0x0020) + self.zp_96) & 0xFFFF
				end
			else
				y = 0x001F
				a = 0x01FF
			end
		else
			y = a & 0xFFFF
			a = (y | self.zp_96) & 0xFFFF
		end
	end
	local collision_y = a & 0xFFFF
	self.zp_4c = self.zp_9c
	local map_index = self.zp_9c & 0x003F
	self.zp_9c = self.zp_9c & (~map_index & 0xFFFF)
	local lo = data_818409[map_index + 1]
	local hi = data_818409[map_index + 2]
	local mapped = ((hi << 8) | lo) & 0x801F
	if (mapped & 0x8000) ~= 0 and y ~= 0x000F then
		mapped = mapped & 0x001F
	end
	self.zp_9c = (self.zp_9c | mapped) & 0xFFFF
	local kind = self.zp_9e & 0x007F
	if kind == 0x0045 or kind == 0x0041 then
		self.zp_9c = self.zp_9c | 0x0020
	end
	if collision_y == 0x01FF then
		collision_y = 0x0800
	end
	return collision_y & 0xFFFF
end

function player:code_818547(a) return 0xFFFF end
function player:code_81854b(a) return 0x001F end
function player:code_81854f(a) return 0x001B end
function player:code_818553(a) return 0x0017 end
function player:code_818557(a) return 0x0013 end
function player:code_81855b(a) return 0x000F end
function player:code_81855f(a) return 0x000B end
function player:code_818563(a) return 0x0007 end
function player:code_818567(a) return 0x0003 end
function player:code_81856b(a) return to_unsigned_16((a << 2) + 0x0010) end
function player:code_818572(a) return to_unsigned_16(a << 2) end
function player:code_818575(a) return to_unsigned_16((a << 2) - 0x0010) end
function player:code_81857c(a) return to_unsigned_16((a << 2) - 0x0020) end
function player:code_818583(a) return to_unsigned_16((a << 2) - 0x0030) end
function player:code_81858a(a)
	a = to_unsigned_16((a << 2) - 0x0010)
	if a >= 0x000F then
		a = 0x000F
	end
	return a
end
function player:code_818599(a)
	a = to_unsigned_16((a << 2) - 0x0010)
	if a < 0x000F then
		a = 0x000F
	end
	return a
end
function player:code_8185a8(a) return to_unsigned_16((a << 1) + 0x0018) end
function player:code_8185ae(a) return to_unsigned_16((a << 1) + 0x0010) end
function player:code_8185b4(a) return to_unsigned_16((a << 1) + 0x0008) end
function player:code_8185ba(a) return to_unsigned_16(a << 1) end
function player:code_8185bc(a) return to_unsigned_16((a << 1) - 0x0008) end
function player:code_8185c2(a) return to_unsigned_16((a << 1) - 0x0010) end
function player:code_8185c8(a) return to_unsigned_16((a << 1) - 0x0018) end
function player:code_8185ce(a) return to_unsigned_16(a - 0x000C) end
function player:code_8185d3(a) return to_unsigned_16(a - 0x0008) end
function player:code_8185d8(a) return to_unsigned_16(a - 0x0004) end
function player:code_8185dd(a) return a & 0xFFFF end
function player:code_8185de(a) return to_unsigned_16(a + 0x0004) end
function player:code_8185e3(a) return to_unsigned_16(a + 0x0008) end
function player:code_8185e8(a) return to_unsigned_16(a + 0x000C) end
function player:code_8185ed(a) return to_unsigned_16(a + 0x0010) end
function player:code_8185f2(a) return to_unsigned_16(a + 0x0014) end
function player:code_8185f7(a) return to_unsigned_16(a + 0x0018) end
function player:code_8185fc(a) return to_unsigned_16(a + 0x001C) end
function player:code_818601(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x001C) end
function player:code_81860e(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x0018) end
function player:code_81861b(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x0014) end
function player:code_818628(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x0010) end
function player:code_818635(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x000C) end
function player:code_818642(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x0008) end
function player:code_81864f(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) + 0x0004) end
function player:code_81865c(a) return data_8186e5[a + 1] & 0x00FF end
function player:code_818665(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) - 0x0004) end
function player:code_818672(a) return to_unsigned_16((data_8186e5[a + 1] & 0x00FF) - 0x0008) end
function player:code_81867f(a) return to_unsigned_16((a >> 2) + 0x001C) end
function player:code_818686(a) return to_unsigned_16((a >> 2) + 0x0018) end
function player:code_81868d(a) return to_unsigned_16((a >> 2) + 0x0014) end
function player:code_818694(a) return to_unsigned_16((a >> 2) + 0x0010) end
function player:code_81869b(a) return to_unsigned_16((a >> 2) + 0x000C) end
function player:code_8186a2(a) return to_unsigned_16((a >> 2) + 0x0008) end
function player:code_8186a9(a) return to_unsigned_16((a >> 2) + 0x0004) end
function player:code_8186b0(a) return to_unsigned_16(a >> 2) end
function player:code_8186b3(a) return to_unsigned_16((a >> 1) - 0x0004) end
function player:code_8186b9(a) return to_unsigned_16(a >> 1) end
function player:code_8186bb(a) return to_unsigned_16((a >> 1) + 0x0004) end
function player:code_8186c1(a) return to_unsigned_16((a >> 1) + 0x0008) end
function player:code_8186c7(a) return to_unsigned_16((a >> 1) + 0x000C) end
function player:code_8186cd(a) return to_unsigned_16((a >> 1) + 0x0010) end
function player:code_8186d3(a) return to_unsigned_16((a >> 1) + 0x0014) end
function player:code_8186d9(a) return to_unsigned_16((a >> 1) + 0x0018) end
function player:code_8186df(a) return to_unsigned_16((a >> 1) + 0x001C) end

function player:code_818000()
	return self:code_818003(self.ram_xposlo)
end

-- CODE_818087/CODE_81820F/CODE_81839B post-probe collision-flag remap (line 14191+)
function player:code_818087_remap_9c(collision_y)
	self.zp_9e = self.zp_9c
	local map_index = self.zp_9c & 0x003F
	self.zp_9c = self.zp_9c & (~map_index & 0xFFFF)
	local lo = data_818409[map_index + 1] or 0x00
	local hi = data_818409[map_index + 2] or 0x00
	local mapped = ((hi << 8) | lo) & 0x801F
	if (mapped & 0x8000) ~= 0 and collision_y ~= 0x000F then
		mapped = mapped & 0x001F
	end
	self.zp_9c = (self.zp_9c | mapped) & 0xFFFF
	local kind = self.zp_9e & 0x007F
	if kind == 0x0045 or kind == 0x0041 then
		self.zp_9c = self.zp_9c | 0x0020
	end
end

-- CODE_BFAD92/CODE_BFAE6B/CODE_BFAF09/CODE_BFFC72:
-- LDA.b $9C / STA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x
function player:commit_collision_9c_to_1209()
	self.ram_ramtable1209lo = self.zp_9c & 0xFFFF
end

function player:integrate_and_collide()
	local sp = 0x0100
	
	-- x integration
	local want_subx = self.pos_subx + to_signed_16(self.ram_xspeedlo)
	local want_x = math.floor(want_subx / sp)
	local step_x = want_x - self.ram_xposlo
	local collided_x, collided_x_solid = self:move_horizontal_pixels(step_x)
	if not collided_x then
		self.pos_subx = want_subx
	end
	
	-- y integration
	self.grounded = false
	local want_suby = self.pos_suby - to_signed_16(self.ram_yspeedlo)
	local want_y = math.floor(want_suby / sp)
	local step_y = want_y - self.ram_yposlo
	local collided_y, grounded, collided_y_solid = self:move_vertical_pixels(step_y)
	if not collided_y then
		self.pos_suby = want_suby
	end

	local step_y_signed = to_signed_16(step_y)
	if grounded then
		self.ram_ramtable1631lo = 0
	elseif step_y_signed == 0 then
		self.ram_ramtable1631lo = 0x0001
	else
		self.ram_ramtable1631lo = to_unsigned_16(step_y_signed)
	end
	
	-- ground probe
	local probe_solid = nil
	if not grounded and self:is_grounded_probe() then
		probe_solid = self:get_overlapping_solid(self.ram_xposlo, self.ram_yposlo + 1)
		grounded = true
		self.ram_yspeedlo = 0xFFFF
		self.pos_suby = self.ram_yposlo * sp
		self.ram_ramtable1631lo = 0
	end
	
	self.grounded = grounded
	
	-- world bounds
	local max_x = self.level.world_width - self.width
	if self.ram_xposlo < 0 then
		self.ram_xposlo = 0
		self.ram_xspeedlo = 0
		self.pos_subx = 0
	elseif self.ram_xposlo > max_x then
		self.ram_xposlo = max_x
		self.ram_xspeedlo = 0
		self.pos_subx = max_x * sp
	end
	
	-- update grounded flags
	if self.grounded then
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
	else
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo & 0xfffe
	end

	-- collision source mirrors CODE_818000 probe output ($9C), then stores into 1209.
	local collision_solid = collided_y_solid
	if collision_solid == nil then
		collision_solid = probe_solid
	end
	if collision_solid == nil then
		collision_solid = collided_x_solid
	end
	if collision_solid ~= nil then
		self.zp_9c = self:resolve_collision_raw_9c(collision_solid)
	else
		self.zp_9c = 0x0000
	end
	self:code_818087_remap_9c(0)
	self:commit_collision_9c_to_1209()
end

-- ============================================================================
-- input sampling
-- ============================================================================

function player:fill_dkc1_input_ram_from_actions()
	local player_index = self.player_index

	local left_held = action_triggered('left[p]', player_index)
	local right_held = action_triggered('right[p]', player_index)
	local up_held = action_triggered('up[p]', player_index)
	local down_held = action_triggered('down[p]', player_index)

	-- Emulate physical D-pad constraints from SNES controllers:
	-- opposite directions cannot be held at once.
	if left_held and right_held then
		left_held = false
		right_held = false
	end
	if up_held and down_held then
		up_held = false
		down_held = false
	end

	local held = 0
	if left_held then
		held = held | joypad_dpadl
	end
	if right_held then
		held = held | joypad_dpadr
	end
	if up_held then
		held = held | joypad_dpadu
	end
	if down_held then
		held = held | joypad_dpadd
	end
	if action_triggered('b[p]', player_index) then
		held = held | joypad_b
	end
	if action_triggered('a[p]', player_index) then
		held = held | joypad_a
	end
	if action_triggered('y[p]', player_index) then
		held = held | joypad_y
	end
	if action_triggered('x[p]', player_index) then
		held = held | joypad_x
	end
	if action_triggered('start[p]', player_index) then
		held = held | joypad_start
	end
	if action_triggered('select[p]', player_index) then
		held = held | joypad_select
	end
	if action_triggered('lb[p]', player_index) then
		held = held | joypad_l
	end
	if action_triggered('rb[p]', player_index) then
		held = held | joypad_r
	end

	self.prev_7e = self.zp_7e
	self.zp_7e = held & 0xFFFF
	self.zp_80 = (self.zp_7e & (~self.prev_7e)) & 0xFFFF
	self.ram_16ed = self.zp_7e
	self.ram_16e9 = self.zp_80
end

function player:sample_input()
	self:fill_dkc1_input_ram_from_actions()
end

-- ============================================================================
-- main tick loop
-- ============================================================================

function player:tick(dt)
	-- increment frame counter (code_bfb2c7 area)
	self.zp_28 = self.zp_28 + 1
	self.debug_frame = self.zp_28
	self.debug_time_ms = self.debug_time_ms + (dt * 1000)

	-- keep $32 sourced from level-context flow (disassembly level init state).
	self.zp_32 = read_level_state32(self.level)
	
	-- sample input
	self:sample_input()

	-- DKC1_NorSpr01_DonkeyKong_Main -> DATA_BF84C5 dispatch.
	self:code_bf84a8()

	self:finish_tick_visual(dt)
end

function player:finish_tick_visual(dt)
	self.x = self.ram_xposlo
	self.y = self.ram_yposlo
	self.camera_anchor_x = self.x + (self.width * 0.5)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	self:update_visual_frame(dt)
end

-- ============================================================================
-- visual frame update
-- ============================================================================

function player:update_visual_frame(dt)
	local _ = dt
	local animation = self.ram_16ad & 0xFFFF
	local mode = data_visual_mode_by_animation[animation]
	if mode == nil then
		mode = 'idle'
	end

	local phase = (0x00FF - ((self.ram_displaycurrentposetimerlo >> 8) & 0x00FF)) & 0x00FF

	if mode == 'roll' then
		self.pose_name = 'roll'
		self.visual_frame_id = visual_frame_cycle(constants.animation.roll.frames, phase)
	elseif mode == 'air' then
		self.pose_name = 'airborne'
		if to_signed_16(self.ram_yspeedlo) >= 0 then
			self.visual_frame_id = constants.animation.air.rise_frame
		else
			self.visual_frame_id = constants.animation.air.fall_frame
		end
	elseif mode == 'run' then
		self.pose_name = 'run'
		self.visual_frame_id = visual_frame_cycle(constants.animation.run.frames, phase)
	elseif mode == 'walk' then
		self.pose_name = 'walk'
		self.visual_frame_id = visual_frame_cycle(constants.animation.walk.frames, phase)
	else
		self.pose_name = 'idle'
		self.visual_frame_id = visual_frame_cycle(constants.animation.idle.frames, phase)
	end

	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		self.facing = -1
	else
		self.facing = 1
	end
	self.grounded = (self.ram_ramtable12a5lo & 0x0001) ~= 0
end

-- ============================================================================
-- timeline system
-- ============================================================================

function player:respawn()
	self:reset_runtime()
end

function player:consume_reset_request()
	local requested = self.reset_requested
	self.reset_requested = false
	return requested
end

-- ============================================================================
-- module export
-- ============================================================================

local player_def_id = 'dkc_player_asm'
local player_instance_id = 'player_1'
local player_fsm_id = 'dkc_player_asm_fsm'

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'active',
		states = {
			active = {
				tick = function(self, dt)
					self:tick(dt)
				end,
			},
		},
	})
end

local function register_player_definition()
	define_world_object({
		def_id = player_def_id,
		class = player,
		fsms = { player_fsm_id },
		components = {},
			defaults = {
				player_index = 1,
				width = constants.player.width,
				height = constants.player.height,
				facing = 1,
				grounded = true,
				draw_scale_x = 1.0,
			draw_scale_y = 1.0,
			roll_visual = 0,
		},
	})
end

return {
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = player_def_id,
	player_instance_id = player_instance_id,
	player_fsm_id = player_fsm_id,
	register = register_player_definition,
	player = player,
}
