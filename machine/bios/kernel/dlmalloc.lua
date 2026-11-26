--[[
Copyright 2023 Doug Lea

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
]]
module<const>

-- C:<line> and H:<line> refer to the pinned dlmalloc.c and dlmalloc.h.
-- `a` is the arena's state offset; links and API results are RAM offsets, not
-- mapped addresses. Only a typed view adds RAM_BASE. Integer arithmetic wraps
-- to 32 bits and >> is logical. For unsigned comparisons of potentially
-- high-bit-set words, use the sign-bit rotation from math.ult. Byte offsets
-- and chunk spans bounded by installed RAM compare identically as Integers.
local ram_base<const> = 0x08000000 -- H:11-16; replace the supplied host view with the main RAM address
local sign_bit<const> = 0x80000000 -- C:28; representation of unsigned ordering
local pinuse<const> = 1 -- C:32
local cinuse<const> = 2 -- C:32
local object_flag<const> = 4 -- C:32
local flags<const> = 7 -- C:32
local min_chunk<const> = 16 -- C:32
local min_large<const> = 256 -- C:32

struct bmsx_dlmalloc_chunk
	prev_foot: u32 -- C:81,88
	head: u32 -- C:80,87
	forward: addr -- C:82,89
	back: addr -- C:83,90
	child: addr[2] -- C:84,91
	parent: addr -- C:85,92
	index: u32 -- C:86,93
end

struct bmsx_dlmalloc_state
	smallmap: u32 -- C:95-96
	treemap: u32 -- C:97-98
	dvsize: u32 -- C:99-100
	topsize: u32 -- C:101-102
	dv: addr -- C:103-104
	top: addr -- C:105-106
	-- The sentinel pairs overlap: its forward/back fields are at +8/+12.
	smallbins: u32[66] -- C:107-109
	treebins: addr[32] -- C:110
	floor: addr -- C:451-452
	limit: addr -- C:453-454
	segment: addr -- C:455-456
	occupied: u32 -- C:457-458,460
end

-- Both views and arbitrary word accesses use the CPU memory path. This is
-- also the write-watch boundary: firmware does not store host history bits.
local read_word<const> = function(offset) -- C:56
	local word<const>: *u32 = ram_base + offset -- C:58-62,78
	return *word -- C:63
end

local store_word<const> = function(offset, value) -- C:68
	local word<const>: *u32 = ram_base + offset -- C:70-73,79
	*word = value -- C:73-75 H:21-22
end

-- Implement the nonzero-input bit-scan intrinsics with word shifts and masks.
local highest_bit<const> = function(bits) -- C:38-42,52
	local index = 0 -- C:40-41,52
	if bits >> 16 ~= 0 then bits = bits >> 16; index = index + 16 end -- C:41,52
	if bits >> 8 ~= 0 then bits = bits >> 8; index = index + 8 end -- C:41,52
	if bits >> 4 ~= 0 then bits = bits >> 4; index = index + 4 end -- C:41,52
	if bits >> 2 ~= 0 then bits = bits >> 2; index = index + 2 end -- C:41,52
	return index + (bits >> 1) -- C:42,52
end

local lowest_bit<const> = function(bits) -- C:44-48,53
	local index = 0 -- C:46-47,53
	if bits & 0xffff == 0 then bits = bits >> 16; index = index + 16 end -- C:47,53
	if bits & 0xff == 0 then bits = bits >> 8; index = index + 8 end -- C:47,53
	if bits & 0xf == 0 then bits = bits >> 4; index = index + 4 end -- C:47,53
	if bits & 3 == 0 then bits = bits >> 2; index = index + 2 end -- C:47,53
	return index + (1 - (bits & 1)) -- C:48,53
end

local smallbin<const> = function(a, i) -- C:109
	return a + offsetof(bmsx_dlmalloc_state.smallbins) + 8 * i -- C:109
end

local treelink<const> = function(a, i) -- C:110
	return a + offsetof(bmsx_dlmalloc_state.treebins) + 4 * i -- C:110
end

local chunksize<const> = function(a, p) -- C:112
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:112
	return chunk.head & ~flags -- C:112
end

local leftmost_child<const> = function(a, p) -- C:113
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:115
	local c<const> = chunk.child[0] -- C:115
	if c ~= 0 then return c end -- C:116
	return chunk.child[1] -- C:116
end

local request2size<const> = function(bytes) -- C:118
	if (bytes ~ sign_bit) < (11 ~ sign_bit) then return min_chunk end -- C:120
	return (bytes + 11) & ~7 -- C:120
end

local idx2bit<const> = function(i) -- C:122
	return 1 << i -- C:122
end

local left_bits<const> = function(bit) -- C:123
	return 0 - (bit << 1) -- C:123
end

local tree_index<const> = function(size) -- C:124
	local x<const> = size >> 8 -- C:126
	if x == 0 then return 0 end -- C:127
	if x > 0xffff then return 31 end -- C:128
	local k<const> = highest_bit(x) -- C:129
	return (k << 1) + ((size >> (k + 7)) & 1) -- C:130
end

local leftshift_for_tree_index<const> = function(i) -- C:132
	if i == 31 then return 0 end -- C:132
	return 25 - (i >> 1) -- C:132
end

local free_head<const> = function(a, p, size) -- C:135
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:137
	chunk.head = size | pinuse -- C:137
	local next<const>: *bmsx_dlmalloc_chunk = ram_base + p + size -- C:138
	next.prev_foot = size -- C:138
end

local set_free_with_pinuse<const> = function(a, p, size, next) -- C:140
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + next -- C:142
	chunk.head = chunk.head & ~pinuse -- C:142
	free_head(a, p, size) -- C:143
end

local set_inuse<const> = function(a, p, size) -- C:145
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:147
	chunk.head = (chunk.head & pinuse) | size | cinuse -- C:147
	local next<const>: *bmsx_dlmalloc_chunk = ram_base + p + size -- C:148
	next.head = next.head | pinuse -- C:148
end

local inuse_head<const> = function(a, p, size) -- C:150
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:152
	chunk.head = size | pinuse | cinuse -- C:152
end

local set_inuse_and_pinuse<const> = function(a, p, size) -- C:154
	inuse_head(a, p, size) -- C:156
	local next<const>: *bmsx_dlmalloc_chunk = ram_base + p + size -- C:157
	next.head = next.head | pinuse -- C:157
end

local insert_small_chunk<const> = function(a, p, size) -- C:160
	local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:165
	local i<const> = size >> 3 -- C:162
	local b<const> = smallbin(a, i) -- C:163
	local bit<const> = idx2bit(i) -- C:163
	local f = b -- C:164
	local bin<const>: *bmsx_dlmalloc_chunk = ram_base + b -- C:166-167
	if s.smallmap & bit == 0 then -- C:165
		s.smallmap = s.smallmap | bit -- C:165
	else -- C:166
		f = bin.forward -- C:166
	end
	bin.forward = p -- C:167
	local forward<const>: *bmsx_dlmalloc_chunk = ram_base + f -- C:168
	forward.back = p -- C:168
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:169
	chunk.forward = f -- C:169
	chunk.back = b -- C:170
end

local unlink_small_chunk<const> = function(a, p, size) -- C:172
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:174
	local f<const> = chunk.forward -- C:174
	local b<const> = chunk.back -- C:174
	if b == f then -- C:175
		local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:175
		s.smallmap = s.smallmap & ~idx2bit(size >> 3) -- C:175
	else -- C:176
		local forward<const>: *bmsx_dlmalloc_chunk = ram_base + f -- C:177
		forward.back = b -- C:177
		local back<const>: *bmsx_dlmalloc_chunk = ram_base + b -- C:178
		back.forward = f -- C:178
	end
end

local unlink_first_small_chunk<const> = function(a, b, p, i) -- C:181
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p -- C:183
	local f<const> = chunk.forward -- C:183
	if b == f then -- C:184
		local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:184
		s.smallmap = s.smallmap & ~idx2bit(i) -- C:184
	else -- C:185
		local forward<const>: *bmsx_dlmalloc_chunk = ram_base + f -- C:186
		forward.back = b -- C:186
		local back<const>: *bmsx_dlmalloc_chunk = ram_base + b -- C:187
		back.forward = f -- C:187
	end
end

local replace_dv<const> = function(a, p, size) -- C:190
	local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:192
	local bytes<const> = s.dvsize -- C:192
	if bytes ~= 0 then insert_small_chunk(a, s.dv, bytes) end -- C:193
	s.dvsize = size -- C:194
	s.dv = p -- C:195
end

local insert_large_chunk<const> = function(a, x, size) -- C:198
	local i<const> = tree_index(size) -- C:200
	local h<const> = treelink(a, i) -- C:200
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + x -- C:201
	chunk.index = i -- C:201
	chunk.child[1] = 0 -- C:202
	chunk.child[0] = chunk.child[1] -- C:202
	local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:203
	if s.treemap & idx2bit(i) == 0 then -- C:203
		s.treemap = s.treemap | idx2bit(i) -- C:204
		store_word(h, x) -- C:205
		chunk.parent = h -- C:206
		chunk.back = x -- C:207
		chunk.forward = chunk.back -- C:207
	else -- C:208
		local t = read_word(h) -- C:209
		local k = size << leftshift_for_tree_index(i) -- C:210
		while true do -- C:211
			if chunksize(a, t) ~= size then -- C:212
				local c<const> = t + offsetof(bmsx_dlmalloc_chunk.child) + (k >> 31) * 4 -- C:213
				k = k << 1 -- C:214
				if read_word(c) ~= 0 then -- C:215
					t = read_word(c) -- C:215
				else -- C:216
					store_word(c, x) -- C:217
					chunk.parent = t -- C:218
					chunk.back = x -- C:219
					chunk.forward = chunk.back -- C:219
					break -- C:220
				end
			else -- C:222
				local current<const>: *bmsx_dlmalloc_chunk = ram_base + t -- C:223
				local f<const> = current.forward -- C:223
				local forward<const>: *bmsx_dlmalloc_chunk = ram_base + f -- C:224
				forward.back = x -- C:224
				current.forward = forward.back -- C:224
				chunk.forward = f -- C:225
				chunk.back = t -- C:226
				chunk.parent = 0 -- C:227
				break -- C:228
			end
		end
	end
end

local unlink_large_chunk<const> = function(a, x) -- C:234
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + x -- C:236
	local xp<const> = chunk.parent -- C:236
	local r -- C:237
	if chunk.back ~= x then -- C:238
		local f<const> = chunk.forward -- C:239
		r = chunk.back -- C:240
		local forward<const>: *bmsx_dlmalloc_chunk = ram_base + f -- C:241
		forward.back = r -- C:241
		local replacement<const>: *bmsx_dlmalloc_chunk = ram_base + r -- C:242
		replacement.forward = f -- C:242
	else -- C:243
		local rp = x + offsetof(bmsx_dlmalloc_chunk.child) + 4 -- C:244-245
		r = read_word(rp) -- C:245
		if r == 0 then -- C:245
			rp = x + offsetof(bmsx_dlmalloc_chunk.child) -- C:245
			r = read_word(rp) -- C:245
		end
		if r ~= 0 then -- C:245
			while true do -- C:247
				local cp = r + offsetof(bmsx_dlmalloc_chunk.child) + 4 -- C:246-247
				if read_word(cp) == 0 then -- C:247
					cp = r + offsetof(bmsx_dlmalloc_chunk.child) -- C:247
					if read_word(cp) == 0 then break end -- C:247
				end
				rp = cp -- C:247
				r = read_word(rp) -- C:247
			end
			store_word(rp, 0) -- C:248
		end
	end
	if xp ~= 0 then -- C:251
		local h<const> = treelink(a, chunk.index) -- C:252
		if x == read_word(h) then -- C:253
			store_word(h, r) -- C:254
			if r == 0 then -- C:255
				local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:255
				s.treemap = s.treemap & ~idx2bit(chunk.index) -- C:255
			end
		else -- C:256-257
			local parent<const>: *bmsx_dlmalloc_chunk = ram_base + xp -- C:256
			if parent.child[0] == x then -- C:256
				parent.child[0] = r -- C:256
			else -- C:257
				parent.child[1] = r -- C:257
			end
		end
		if r ~= 0 then -- C:258
			local replacement<const>: *bmsx_dlmalloc_chunk = ram_base + r -- C:259
			replacement.parent = xp -- C:259
			local c0<const> = chunk.child[0] -- C:260
			local c1<const> = chunk.child[1] -- C:260
			if c0 ~= 0 then -- C:261
				replacement.child[0] = c0 -- C:261
				local child<const>: *bmsx_dlmalloc_chunk = ram_base + c0 -- C:261
				child.parent = r -- C:261
			end
			if c1 ~= 0 then -- C:262
				replacement.child[1] = c1 -- C:262
				local child<const>: *bmsx_dlmalloc_chunk = ram_base + c1 -- C:262
				child.parent = r -- C:262
			end
		end
	end
end

local insert_chunk<const> = function(a, p, size) -- C:267
	if size < min_large then -- C:269
		insert_small_chunk(a, p, size) -- C:269
	else -- C:270
		insert_large_chunk(a, p, size) -- C:270
	end
end

local unlink_chunk<const> = function(a, p, size) -- C:272
	if size < min_large then -- C:274
		unlink_small_chunk(a, p, size) -- C:274
	else -- C:275
		unlink_large_chunk(a, p) -- C:275
	end
end

local tmalloc_large<const> = function(a, nb) -- C:279
	local v = 0 -- C:281
	local rsize = 0 - nb -- C:281
	local idx<const> = tree_index(nb) -- C:282
	local t = read_word(treelink(a, idx)) -- C:283
	if t ~= 0 then -- C:284
		local sizebits = nb << leftshift_for_tree_index(idx) -- C:285
		local rst = 0 -- C:285
		while true do -- C:286
			local trem<const> = chunksize(a, t) - nb -- C:287
			if (trem ~ sign_bit) < (rsize ~ sign_bit) then -- C:288
				v = t -- C:289
				rsize = trem -- C:290
				if rsize == 0 then break end -- C:290
			end
			local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + t -- C:292
			local rt<const> = chunk.child[1] -- C:292
			t = chunk.child[sizebits >> 31] -- C:293
			if rt ~= 0 and rt ~= t then rst = rt end -- C:294
			if t == 0 then t = rst; break end -- C:295
			sizebits = sizebits << 1 -- C:296
		end
	end
	local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:300,308
	if t == 0 and v == 0 then -- C:299
		local leftbits<const> = left_bits(idx2bit(idx)) & s.treemap -- C:300
		if leftbits ~= 0 then t = read_word(treelink(a, lowest_bit(leftbits))) end -- C:301
	end
	while t ~= 0 do -- C:303
		local trem<const> = chunksize(a, t) - nb -- C:304
		if (trem ~ sign_bit) < (rsize ~ sign_bit) then rsize = trem; v = t end -- C:305
		t = leftmost_child(a, t) -- C:306
	end
	if v ~= 0 and (rsize ~ sign_bit) < ((s.dvsize - nb) ~ sign_bit) then -- C:308
		unlink_large_chunk(a, v) -- C:309
		if rsize < min_chunk then -- C:310
			set_inuse_and_pinuse(a, v, rsize + nb) -- C:310
		else -- C:311
			inuse_head(a, v, nb) -- C:312
			free_head(a, v + nb, rsize) -- C:313
			insert_chunk(a, v + nb, rsize) -- C:314
		end
		return v + 8 -- C:316
	end
	return 0 -- C:318
end

local tmalloc_small<const> = function(a, nb) -- C:321
	local s<const>: *bmsx_dlmalloc_state = ram_base + a -- C:323
	local t = read_word(treelink(a, lowest_bit(s.treemap))) -- C:323
	local v = t -- C:324
	local rsize = chunksize(a, t) - nb -- C:324
	while true do -- C:325
		t = leftmost_child(a, t) -- C:325
		if t == 0 then break end -- C:325
		local trem<const> = chunksize(a, t) - nb -- C:326
		if trem < rsize then rsize = trem; v = t end -- C:327
	end
	unlink_large_chunk(a, v) -- C:329
	if rsize < min_chunk then -- C:330
		set_inuse_and_pinuse(a, v, rsize + nb) -- C:330
	else -- C:331
		inuse_head(a, v, nb) -- C:332
		free_head(a, v + nb, rsize) -- C:333
		replace_dv(a, v + nb, rsize) -- C:334
	end
	return v + 8 -- C:336
end

local mspace_malloc<const> = function(a, bytes) -- C:339
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	local nb -- C:341
	if (bytes ~ sign_bit) <= (244 ~ sign_bit) then -- C:342
		nb = request2size(bytes) -- C:343
		local idx = nb >> 3 -- C:344
		local smallbits<const> = s.smallmap >> idx -- C:345
		if (smallbits & 3) ~= 0 then -- C:346
			idx = idx + (~smallbits & 1) -- C:347
			local b<const> = smallbin(a, idx) -- C:348
			local bin<const>: *bmsx_dlmalloc_chunk = ram_base + b
			local p<const> = bin.forward -- C:348
			unlink_first_small_chunk(a, b, p, idx) -- C:349
			set_inuse_and_pinuse(a, p, idx << 3) -- C:350
			return p + 8 -- C:351
		elseif nb > s.dvsize then -- C:352
			if smallbits ~= 0 then -- C:353
				local i<const> = lowest_bit(smallbits << idx) -- C:354
				local b<const> = smallbin(a, i) -- C:355
				local bin<const>: *bmsx_dlmalloc_chunk = ram_base + b
				local p<const> = bin.forward -- C:355
				local r<const> = p + nb -- C:355
				local rsize<const> = (i << 3) - nb -- C:356
				unlink_first_small_chunk(a, b, p, i) -- C:357
				inuse_head(a, p, nb) -- C:358
				free_head(a, r, rsize) -- C:359
				replace_dv(a, r, rsize) -- C:360
				return p + 8 -- C:361
			elseif s.treemap ~= 0 then -- C:362
				local payload<const> = tmalloc_small(a, nb) -- C:363
				if payload ~= 0 then return payload end -- C:364
			end
		end
	else -- C:367
		if (bytes ~ sign_bit) >= (((0 - min_chunk) << 2) ~ sign_bit) then return 0 end -- C:368
		nb = request2size(bytes) -- C:369
		if s.treemap ~= 0 then -- C:370
			local payload<const> = tmalloc_large(a, nb) -- C:371
			if payload ~= 0 then return payload end -- C:372
		end
	end

	if (nb ~ sign_bit) <= (s.dvsize ~ sign_bit) then -- C:376
		local rsize<const>, p<const> = s.dvsize - nb, s.dv -- C:377
		if rsize >= min_chunk then -- C:378
			local r<const> = p + nb -- C:379
			s.dv = r -- C:380
			s.dvsize = rsize -- C:381
			free_head(a, r, rsize) -- C:382
			inuse_head(a, p, nb) -- C:383
		else -- C:384
			local dvs<const> = s.dvsize -- C:385
			s.dvsize = 0 -- C:386
			s.dv = s.dvsize -- C:386
			set_inuse_and_pinuse(a, p, dvs) -- C:387
		end
		return p + 8 -- C:389
	elseif (nb ~ sign_bit) < (s.topsize ~ sign_bit) then -- C:390
		local rsize<const>, p<const> = s.topsize - nb, s.top -- C:391
		local r<const>: *bmsx_dlmalloc_chunk = ram_base + p + nb -- C:391
		s.topsize = rsize -- C:392
		s.top = p + nb -- C:393
		r.head = rsize | pinuse -- C:394
		inuse_head(a, p, nb) -- C:395
		return p + 8 -- C:396
	end
	return 0 -- C:398
end

local dispose_chunk<const> = function(a, p, psize) -- C:403
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	local next_chunk<const> = p + psize -- C:405
	local successor<const>: *bmsx_dlmalloc_chunk = ram_base + next_chunk
	local current<const>: *bmsx_dlmalloc_chunk = ram_base + p
	local head<const> = current.head -- C:406
	if (head & pinuse) == 0 then -- C:407
		if (head & object_flag) ~= 0 then current.head = head & ~object_flag end -- C:409
		local prevsize<const> = current.prev_foot -- C:410
		p = p - prevsize -- C:411
		psize = psize + prevsize -- C:412
		if p ~= s.dv then -- C:413
			unlink_chunk(a, p, prevsize) -- C:413
		elseif (successor.head & (pinuse | cinuse)) == (pinuse | cinuse) then -- C:414
			s.dvsize = psize -- C:415
			set_free_with_pinuse(a, p, psize, next_chunk) -- C:416
			return -- C:417
		end
	end
	if (successor.head & cinuse) == 0 then -- C:420
		if next_chunk == s.top then -- C:421
			local tsize<const> = s.topsize + psize -- C:422
			s.topsize = tsize -- C:423
			s.top = p -- C:424
			local merged<const>: *bmsx_dlmalloc_chunk = ram_base + p
			merged.head = tsize | pinuse -- C:425
			if p == s.dv then -- C:426
				s.dvsize = 0 -- C:426
				s.dv = s.dvsize -- C:426
			end
			return -- C:427
		elseif next_chunk == s.dv then -- C:428
			local dsize<const> = s.dvsize + psize -- C:429
			s.dvsize = dsize -- C:430
			s.dv = p -- C:431
			free_head(a, p, dsize) -- C:432
			return -- C:433
		else -- C:434
			local nsize<const> = chunksize(a, next_chunk) -- C:435
			psize = psize + nsize -- C:436
			unlink_chunk(a, next_chunk, nsize) -- C:437
			free_head(a, p, psize) -- C:438
			if p == s.dv then -- C:439
				s.dvsize = psize -- C:439
				return -- C:439
			end
		end
	else -- C:441
		set_free_with_pinuse(a, p, psize, next_chunk) -- C:441
	end
	insert_chunk(a, p, psize) -- C:442
end

local arena_top_foot<const> = 40 -- C:459
local page_bytes<const> = 4096 -- H:20

local bmsx_dlmalloc_reset<const> = function(a, floor, limit) -- C:462
	for w = a, treelink(a, 32) - 4, 4 do store_word(w, 0) end -- C:464
	for i = 0, 31 do -- C:465
		local b<const> = smallbin(a, i) -- C:466
		local bin<const>: *bmsx_dlmalloc_chunk = ram_base + b
		bin.back = b -- C:467
		bin.forward = bin.back -- C:467
	end
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	s.floor = floor -- C:469
	s.limit = limit -- C:470
	s.segment = limit -- C:471
	s.occupied = 0 -- C:472
end

local prepend_alloc<const> = function(a, p, oldfirst, nb) -- C:475
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	local q<const> = p + nb -- C:477
	local qsize = oldfirst - q -- C:478
	if nb ~= 0 then inuse_head(a, p, nb) end -- C:479
	if oldfirst == s.top then -- C:480
		local size<const> = s.topsize + qsize -- C:481
		s.topsize = size -- C:482
		s.top = q -- C:483
		local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + q
		chunk.head = size | pinuse -- C:484
	elseif oldfirst == s.dv then -- C:485
		local size<const> = s.dvsize + qsize -- C:486
		s.dvsize = size -- C:487
		s.dv = q -- C:488
		free_head(a, q, size) -- C:489
	else -- C:490
		local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + oldfirst
		if (chunk.head & cinuse) == 0 then -- C:491
			local nsize<const> = chunksize(a, oldfirst) -- C:492
			unlink_chunk(a, oldfirst, nsize) -- C:493
			oldfirst = oldfirst + nsize -- C:494
			qsize = qsize + nsize -- C:495
		end
		set_free_with_pinuse(a, q, qsize, oldfirst) -- C:497
		insert_chunk(a, q, qsize) -- C:498
	end
	return p + 8 -- C:500
end

local allocate_from_ram<const> = function(a, bytes) -- C:503
	local allocated<const> = mspace_malloc(a, bytes) -- C:505
	if allocated ~= 0 then return allocated end -- C:506
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	local top<const>, first<const> = s.top, s.segment -- C:507
	local floor<const> = s.floor -- C:508
	local available<const> = first - floor -- C:508
	if available == 0 or (bytes ~ sign_bit) > ((s.limit - floor) ~ sign_bit) then return 0 end -- C:509
	local size<const> = request2size(bytes) -- C:510
	local reserve<const> = size + (top ~= 0 and min_chunk or arena_top_foot + min_chunk) -- C:511
	if top == 0 then -- C:512
		if available <= size + arena_top_foot then return 0 end -- C:513
		local begin<const> = reserve <= available and (first - reserve) & ~(page_bytes - 1) or floor -- C:514
		local last<const> = s.limit - arena_top_foot -- C:515
		s.segment = begin -- C:516
		s.top = begin -- C:517
		s.topsize = last - begin -- C:518
		local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + begin
		chunk.head = (last - begin) | pinuse -- C:519
		local foot<const>: *bmsx_dlmalloc_chunk = ram_base + last
		foot.head = arena_top_foot -- C:520
		return mspace_malloc(a, bytes) -- C:521
	end
	if reserve <= available then -- C:523
		local begin<const> = (first - reserve) & ~(page_bytes - 1) -- C:524
		s.segment = begin -- C:525
		return prepend_alloc(a, begin, first, size) -- C:526
	end

	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + first
	local head<const> = chunk.head -- C:532
	local span<const> = available + ((head & cinuse) ~= 0 and 0 or (head & ~flags)) -- C:533
	if size > span or (first == top and size == span) then return 0 end -- C:534
	s.segment = floor -- C:535
	prepend_alloc(a, floor, first, 0) -- C:536
	return mspace_malloc(a, bytes) -- C:537
end

local bmsx_dlmalloc_set_floor<const> = function(a, floor) -- C:543
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	local leading<const> = s.segment -- C:545
	if floor <= leading then -- C:546
		s.floor = floor -- C:547
		return 1 -- C:548
	end
	local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + leading
	if (chunk.head & cinuse) ~= 0 then return 0 end -- C:550
	local last<const> = leading + chunksize(a, leading) -- C:551
	if leading == s.top then -- C:552
		if floor < last then -- C:553
			s.top = floor -- C:554
			s.segment = s.top -- C:554
			s.topsize = last - floor -- C:555
			local first<const>: *bmsx_dlmalloc_chunk = ram_base + floor
			first.head = (last - floor) | pinuse -- C:556
		else -- C:557
			s.segment = s.limit -- C:558
			s.topsize = 0 -- C:559
			s.top = s.topsize -- C:559
		end
	else -- C:561
		if last < floor then return 0 end -- C:562
		local size<const> = last - floor -- C:563
		local is_dv<const> = leading == s.dv -- C:564
		if not is_dv then unlink_chunk(a, leading, last - leading) end -- C:565
		if size < min_chunk then -- C:566
			if is_dv then -- C:567
				s.dvsize = 0 -- C:567
				s.dv = s.dvsize -- C:567
			end
			local successor<const>: *bmsx_dlmalloc_chunk = ram_base + last
			successor.head = successor.head | pinuse -- C:568
			s.segment = last -- C:569
		else -- C:570
			s.segment = floor -- C:571
			free_head(a, floor, size) -- C:572
			if is_dv then -- C:573
				s.dv = floor -- C:573
				s.dvsize = size -- C:573
			else -- C:574
				insert_chunk(a, floor, size) -- C:574
			end
		end
	end
	s.floor = floor -- C:577
	return 1 -- C:578
end

local bmsx_dlmalloc_floor<const> = function(a) -- C:581
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	return s.floor -- C:581
end

local bmsx_dlmalloc_occupied_bytes<const> = function(a) -- C:582
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	return s.occupied -- C:582
end

local bmsx_dlmalloc_allocate<const> = function(a, bytes, object) -- C:584
	local payload<const> = allocate_from_ram(a, bytes) -- C:586
	if payload ~= 0 then -- C:587
		local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + payload - 8 -- C:588
		local head<const> = chunk.head -- C:588
		local s<const>: *bmsx_dlmalloc_state = ram_base + a
		s.occupied = s.occupied + (head & ~flags) -- C:589
		if object ~= 0 then chunk.head = head | object_flag end -- C:590
	end
	return payload -- C:592
end

local bmsx_dlmalloc_free<const> = function(a, offset) -- C:595
	local p<const> = offset - 8 -- C:597
	local size<const> = chunksize(a, p) -- C:597
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	s.occupied = s.occupied - size -- C:598
	dispose_chunk(a, p, size) -- C:599
end

local bmsx_dlmalloc_shrink<const> = function(a, offset, bytes) -- C:602
	local p<const>, size<const> = offset - 8, request2size(bytes) -- C:605
	local remainder<const> = chunksize(a, p) - size -- C:606
	if (remainder ~ sign_bit) < (min_chunk ~ sign_bit) then return end -- C:607
	local tail<const> = p + size -- C:608
	set_inuse(a, p, size) -- C:609
	set_inuse(a, tail, remainder) -- C:610
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	s.occupied = s.occupied - remainder -- C:611
	dispose_chunk(a, tail, remainder) -- C:612
end

local bmsx_dlmalloc_reserve_backing<const> = function(a, offset, bytes) -- C:617
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	if (bytes ~ sign_bit) > ((s.limit - s.floor) ~ sign_bit) then return 0 end -- C:619
	local p<const> = offset - 8 -- C:620
	local old<const>, nb<const> = chunksize(a, p), request2size(bytes) -- C:620
	if nb <= old then -- C:621
		bmsx_dlmalloc_shrink(a, offset, bytes) -- C:622
		return offset -- C:623
	end
	local next_chunk<const> = p + old -- C:625
	local successor<const>: *bmsx_dlmalloc_chunk = ram_base + next_chunk
	local current<const>: *bmsx_dlmalloc_chunk = ram_base + p
	if (successor.head & cinuse) == 0 then -- C:626
		local total<const> = old + chunksize(a, next_chunk) -- C:627
		if next_chunk == s.top and total > nb then -- C:628
			s.top = p + nb -- C:629
			s.topsize = total - nb -- C:630
			local top_chunk<const>: *bmsx_dlmalloc_chunk = ram_base + p + nb
			top_chunk.head = (total - nb) | pinuse -- C:631
			current.head = nb | (current.head & pinuse) | cinuse -- C:632
			s.occupied = s.occupied + nb - old -- C:633
			return offset -- C:634
		end
		if next_chunk ~= s.top and total >= nb then -- C:636
			local remainder<const> = total - nb -- C:637
			local is_dv<const> = next_chunk == s.dv -- C:638
			if not is_dv then unlink_chunk(a, next_chunk, total - old) end -- C:639
			if remainder >= min_chunk then -- C:640
				local tail<const> = p + nb -- C:641
				current.head = nb | (current.head & pinuse) | cinuse -- C:642
				free_head(a, tail, remainder) -- C:643
				if is_dv then -- C:644
					s.dv = tail -- C:644
					s.dvsize = remainder -- C:644
				else -- C:645
					insert_chunk(a, tail, remainder) -- C:645
				end
				s.occupied = s.occupied + nb - old -- C:646
			else -- C:647
				if is_dv then -- C:648
					s.dv = 0 -- C:648
					s.dvsize = 0 -- C:648
				end
				set_inuse(a, p, total) -- C:649
				s.occupied = s.occupied + total - old -- C:650
			end
			return offset -- C:652
		end
	end
	return bmsx_dlmalloc_allocate(a, bytes, 0) -- C:655
end

local bmsx_dlmalloc_resize_backing<const> = function(a, offset, bytes) -- C:658
	local dest<const> = bmsx_dlmalloc_reserve_backing(a, offset, bytes) -- C:660
	if dest == 0 or dest == offset then return dest end -- C:661
	local old<const> = chunksize(a, offset - 8) -- C:662
	local retained<const> = old - 4 -- C:664
	-- Chunk sizes are multiples of eight and both payloads are word-aligned.
	-- BLua stores, not a shadow watch table, consume RAM history watches.
	local from<const>: *u32 = ram_base + offset -- C:665-666
	local to<const>: *u32 = ram_base + dest -- C:665-666
	for i = 0, (retained >> 2) - 1 do -- C:665-666
		to[i] = from[i] -- C:665-669; byte copy and owning RAM write effect
	end
	bmsx_dlmalloc_free(a, offset) -- C:670
	return dest -- C:671
end

local bmsx_dlmalloc_allocation_bytes<const> = function(a, offset) -- C:674
	return chunksize(a, offset - 8) -- C:676
end

local bmsx_dlmalloc_is_object<const> = function(a, offset) -- C:679
	local s<const>: *bmsx_dlmalloc_state = ram_base + a
	if (offset ~ sign_bit) >= ((s.segment + 8) ~ sign_bit) and (offset ~ sign_bit) < (s.limit ~ sign_bit) then -- C:681
		local chunk<const>: *bmsx_dlmalloc_chunk = ram_base + offset - 8
		if (chunk.head & (cinuse | object_flag)) == (cinuse | object_flag) then return 1 end -- C:682
	end
	return 0 -- C:681-682
end

return {
	-- The compiler resolves each static call through this symbol table. This
	-- module is private firmware; none of these names is a cart BIOS import.
	internal = {
		read_word = read_word,
		store_word = store_word,
		highest_bit = highest_bit,
		lowest_bit = lowest_bit,
		smallbin = smallbin,
		treelink = treelink,
		chunksize = chunksize,
		leftmost_child = leftmost_child,
		request2size = request2size,
		idx2bit = idx2bit,
		left_bits = left_bits,
		tree_index = tree_index,
		leftshift_for_tree_index = leftshift_for_tree_index,
		free_head = free_head,
		set_free_with_pinuse = set_free_with_pinuse,
		set_inuse = set_inuse,
		inuse_head = inuse_head,
		set_inuse_and_pinuse = set_inuse_and_pinuse,
		insert_small_chunk = insert_small_chunk,
		unlink_small_chunk = unlink_small_chunk,
		unlink_first_small_chunk = unlink_first_small_chunk,
		replace_dv = replace_dv,
		insert_large_chunk = insert_large_chunk,
		unlink_large_chunk = unlink_large_chunk,
		insert_chunk = insert_chunk,
		unlink_chunk = unlink_chunk,
		tmalloc_large = tmalloc_large,
		tmalloc_small = tmalloc_small,
		mspace_malloc = mspace_malloc,
		dispose_chunk = dispose_chunk,
		prepend_alloc = prepend_alloc,
		allocate_from_ram = allocate_from_ram,
	},
	bmsx_dlmalloc_reset = bmsx_dlmalloc_reset,
	bmsx_dlmalloc_set_floor = bmsx_dlmalloc_set_floor,
	bmsx_dlmalloc_floor = bmsx_dlmalloc_floor,
	bmsx_dlmalloc_allocate = bmsx_dlmalloc_allocate,
	bmsx_dlmalloc_free = bmsx_dlmalloc_free,
	bmsx_dlmalloc_reserve_backing = bmsx_dlmalloc_reserve_backing,
	bmsx_dlmalloc_resize_backing = bmsx_dlmalloc_resize_backing,
	bmsx_dlmalloc_shrink = bmsx_dlmalloc_shrink,
	bmsx_dlmalloc_allocation_bytes = bmsx_dlmalloc_allocation_bytes,
	bmsx_dlmalloc_occupied_bytes = bmsx_dlmalloc_occupied_bytes,
	bmsx_dlmalloc_is_object = bmsx_dlmalloc_is_object,
}
