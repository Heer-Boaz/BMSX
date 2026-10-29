`timescale 1ns/1ps
// Sixteen physical slot-context banks, one shared stereo nibble datapath and a
// native sample-word port. Byte addresses are assembled here, at the codec's
// memory boundary. Current/previous decoded samples are never invalidated by
// source writes. Two canonical checkpoint latches per voice accelerate repeated
// loop operands without changing that retained-state contract.
//
// A checkpoint is usable only for an unchanged source and a canonical predictor
// prefix, or after the reference operation itself would seek/reload the block.
// The previous-frame latch is patched for one-step forward and first-frame seek
// cases. Thus a two-frame loop and a partially rewritten predictor prefix do not
// acquire the semantics of a persistent decoded-sample cache.
//
// The caller owns cursor/neighbor selection and the logical sample epoch. A
// publication during a live epoch dirties the NEXT epoch, whose word port must
// supply that epoch's snapshot. This module is not the command FIFO, mixer or
// transfer controller. For overdue frames the caller supplies that frame's
// saved epoch_change interval at its actual render start; future physical
// publications must not be injected into this decoder as earlier epochs.
// Unspecified BADP LUT indices remain an open format edge.
module apu_badp_decoder (
    input wire clk, reset_n,
    input wire bind_valid,
    input wire [3:0] bind_voice,
    input wire [18:0] bind_source_base,
    input wire [19:0] bind_source_bytes,
    input wire [18:0] bind_data_offset,
    input wire [31:0] bind_frames,
    input wire [1:0] bind_channels,
    input wire [18:0] bind_seek_base,
    input wire [31:0] bind_seek_count,
    input wire [31:0] bind_loop_start, bind_loop_end,
    input wire req_valid,
    output wire req_ready,
    input wire req_reset,
    input wire [3:0] req_voice,
    input wire [31:0] req_frame,
    output reg rsp_valid,
    output reg [31:0] rsp_samples,
    input wire source_write_valid,
    input wire [16:0] source_write_word,
    input wire [4:0] source_write_words,
    input wire epoch_begin, epoch_active,
    input wire epoch_change_valid,
    input wire [16:0] epoch_change_first, epoch_change_last,
    output wire memory_req_valid,
    input wire memory_req_ready,
    output wire [16:0] memory_req_word_address,
    input wire memory_rsp_valid,
    input wire [31:0] memory_rsp_word
);
    typedef struct packed {
        logic signed [15:0] pred_l, pred_r;
        logic [7:0] index_l, index_r;
        logic [31:0] next_frame, block_end, block_frames, block_index;
        logic [31:0] payload_offset, nibble_cursor;
        logic [31:0] decoded_frame, decoded_sample, previous_frame, previous_sample;
        logic predictor_clean, decoded_clean, previous_clean;
    } context_t;
    context_t ctx, candidate, stepped, lookup_context;
    // Context and checkpoint payloads use three independently addressed SRAM
    // banks. Context clean bits are separate because a source publication can
    // invalidate several voices at once without rewriting their retained PCM.
    // Valid bits define the post-reset/bind empty row; the SRAM has no reset.
    localparam integer CONTEXT_BITS=2*16+2*8+10*32+3;
    localparam [CONTEXT_BITS-1:0] EMPTY_CONTEXT=
        {48'd0,192'd0,32'hffffffff,32'd0,32'hffffffff,32'd0,3'd0};
    reg [CONTEXT_BITS-4:0] context_data [0:15];
    reg [CONTEXT_BITS-1:0] checkpoint0_data [0:15], checkpoint1_data [0:15];
    reg [CONTEXT_BITS-4:0] context_read;
    reg [CONTEXT_BITS-1:0] checkpoint0_read, checkpoint1_read;
    reg [15:0] context_valid;
    reg [2:0] context_clean [0:15];
    reg [31:0] checkpoint_valid;
    reg [15:0] replacement, dirty, source_bound, observed_valid;
    reg [18:0] source_base [0:15], data_offset [0:15], seek_base [0:15];
    reg [16:0] observed_first [0:15], observed_last [0:15];
    reg epoch_writes_valid;
    reg [16:0] epoch_write_first, epoch_write_last;
    reg [31:0] frame_count [0:15], seek_count [0:15], loop_start [0:15], loop_end [0:15];
    reg [1:0] channels [0:15];
    reg [3:0] voice;
    reg [31:0] target;
    reg reset_request, reset_operation, fill_checkpoint;
    reg [4:0] state, return_state;
    localparam [4:0] IDLE=0, LOOKUP=1, SEEK=2, SEARCH=3, SEEK_FRAME=4,
        SEEK_OFFSET=5, SCAN_BLOCK=6, HEADER=7, HEADER_DONE=8, ADVANCE=9,
        PAYLOAD=10, STEP=11, FINISH=12, WORD_ISSUE=13, WORD_WAIT=14;
    reg [31:0] search_lo, search_hi, search_selected, search_mid;
    reg [31:0] scan_frame, scan_offset;
    reg seeking, header_clean;
    reg [127:0] header_buffer;
    reg [2:0] header_sent, header_received;
    wire [2:0] header_words=channels[voice]==2 ? 3'd4 : 3'd3;
    wire [127:0] aligned_header=header_buffer >> {byte_address[1:0],3'b000};
    wire loop_enabled=loop_end[voice]>loop_start[voice];
    reg [18:0] byte_address;
    reg [31:0] assembled;
    reg [1:0] assembled_index;
    reg [2:0] assembled_bytes;
    reg word_valid;
    reg [16:0] word_address;
    reg [31:0] word_data;
    reg [7:0] payload_byte;
    reg cache_hit;
    reg [4:0] cache_index;
    reg [15:0] touched, epoch_touched, invalidate;
    reg [17:0] write_end;
    reg [16:0] write_first, write_last;
    reg late_read_dirty;
    integer i;

    wire [18:0] data_base=source_base[voice]+data_offset[voice];
    wire byte_ready=word_valid && word_address==byte_address[18:2];
    wire [7:0] fetched_byte=word_data >> {byte_address[1:0],3'b000};
    wire [31:0] assembled_byte=(assembled & ~(32'hff << {assembled_index,3'b000})) |
        ({24'd0,fetched_byte} << {assembled_index,3'b000});
    wire signed [15:0] next_l, next_r;
    wire [6:0] next_index_l, next_index_r;
    wire [7:0] stereo_codes=channels[voice]==1 ?
        (ctx.nibble_cursor[0] ? {payload_byte[3:0],payload_byte[3:0]} :
                              {payload_byte[7:4],payload_byte[7:4]}) : payload_byte;
    apu_badp_step step_datapath (
        .predictor_l(ctx.pred_l),.predictor_r(channels[voice]==1 ? ctx.pred_l : ctx.pred_r),
        .step_index_l(ctx.index_l),.step_index_r(channels[voice]==1 ? ctx.index_l : ctx.index_r),
        .packed_codes(stereo_codes),.next_predictor_l(next_l),.next_predictor_r(next_r),
        .next_step_index_l(next_index_l),.next_step_index_r(next_index_r)
    );
    assign req_ready=reset_n && state==IDLE && !bind_valid && !epoch_begin;
    assign memory_req_valid=reset_n &&
        (state==WORD_ISSUE || (state==HEADER && header_sent<header_words));
    assign memory_req_word_address=byte_address[18:2]+(state==HEADER ? header_sent : 3'd0);

    // Single-port banks are read together only at request admission. Decode
    // and checkpoint writes occur later, so read/write collision behavior is
    // not part of this interface. Invalid rows never supply architectural data.
    always @(posedge clk) begin
        if(req_valid && req_ready) begin
            context_read<=context_data[req_voice];
            checkpoint0_read<=checkpoint0_data[req_voice];
            checkpoint1_read<=checkpoint1_data[req_voice];
        end
        if(reset_n && state==FINISH) context_data[voice]<=ctx[CONTEXT_BITS-1:3];
        if(reset_n && state==STEP && loop_enabled && stepped.decoded_clean && !invalidate[voice]) begin
            if(stepped.decoded_frame==loop_start[voice]) checkpoint0_data[voice]<=stepped;
            if(stepped.decoded_frame==loop_end[voice]-1'b1) checkpoint1_data[voice]<=stepped;
        end
        if(reset_n && state==FINISH && fill_checkpoint && !loop_enabled && ctx.decoded_frame==target &&
           ctx.decoded_clean && !invalidate[voice]) begin
            if(replacement[voice]) checkpoint1_data[voice]<=ctx;
            else checkpoint0_data[voice]<=ctx;
        end
    end

    // One producer for the exact post-recurrence register row. Checkpoints
    // observe endpoints already traversed by a necessary prefix decode; they
    // do not speculatively decode or read any future compressed source bytes.
    always @* begin
        stepped=ctx;
        stepped.pred_l=next_l;stepped.index_l={1'b0,next_index_l};
        if(channels[voice]==2) begin stepped.pred_r=next_r;stepped.index_r={1'b0,next_index_r};end
        stepped.previous_frame=ctx.decoded_frame;stepped.previous_sample=ctx.decoded_sample;
        stepped.previous_clean=ctx.decoded_clean;
        stepped.decoded_frame=ctx.next_frame;stepped.decoded_sample={next_r,next_l};
        stepped.decoded_clean=ctx.predictor_clean;
        stepped.next_frame=ctx.next_frame+1'b1;stepped.block_index=ctx.block_index+1'b1;
        stepped.nibble_cursor=ctx.nibble_cursor+channels[voice];
    end

    // Cache provenance follows actual decoded/seek word reads, not SOURCE_BYTES:
    // the public decoder contract permits reading beyond the binding extent.
    // Per-voice inclusive envelopes conservatively represent all observed words;
    // a gap may cause an extra invalidation but cannot preserve a stale cache.
    // Wrapped writes widen their interval over the whole native RAM address
    // space. A snapshot-epoch write that precedes a later word read must also
    // dirty that voice, because the epoch still returns the old word.
    always @* begin
        touched=0; epoch_touched=0; write_end={1'b0,source_write_word}+source_write_words;
        write_first=write_end[17] && write_end[16:0]!=0 ? 17'd0 : source_write_word;
        write_last=write_end[17] && write_end[16:0]!=0 ? 17'h1ffff : write_end[16:0]-1'b1;
        for(integer n=0;n<16;n=n+1) begin
            if(source_write_valid && source_bound[n] && observed_valid[n])
                touched[n]=observed_last[n]>=write_first && observed_first[n]<=write_last;
            if(epoch_change_valid && source_bound[n] && observed_valid[n])
                epoch_touched[n]=observed_last[n]>=epoch_change_first && observed_first[n]<=epoch_change_last;
        end
        late_read_dirty=epoch_active && !epoch_begin && memory_req_valid && memory_req_ready &&
            ((epoch_writes_valid && memory_req_word_address>=epoch_write_first &&
              memory_req_word_address<=epoch_write_last) ||
             (source_write_valid && memory_req_word_address>=write_first &&
              memory_req_word_address<=write_last));
        invalidate=epoch_begin ? dirty|touched|epoch_touched : !epoch_active ? touched : 16'd0;
    end

    // Canonical checkpoint lookup occurs AFTER the two architecturally retained
    // frame comparisons. A write cannot turn an old retained frame into new PCM.
    always @* begin
        lookup_context=context_valid[voice] ? {context_read,context_clean[voice]} : EMPTY_CONTEXT;
        candidate='0;cache_hit=0;cache_index={voice,1'b0};
        for(integer c=0;c<2;c=c+1) begin
            candidate=c==0 ? checkpoint0_read : checkpoint1_read;
            if(checkpoint_valid[{voice,1'b0}+c] && candidate.decoded_frame==target &&
               !invalidate[voice] && !reset_request &&
               ((target<lookup_context.next_frame && target<frame_count[voice]) ||
                (target>=lookup_context.next_frame && lookup_context.predictor_clean))) begin
                if(target<lookup_context.next_frame) begin
                    if(candidate.block_index==1 ||
                       (candidate.previous_clean && candidate.previous_frame==target-1'b1)) begin
                        cache_hit=1;cache_index={voice,1'b0}+c;
                    end
                end else if(target==lookup_context.next_frame ||
                            (candidate.previous_clean && candidate.previous_frame==target-1'b1)) begin
                    cache_hit=1;cache_index={voice,1'b0}+c;
                end
            end
        end
        candidate=cache_index[0] ? checkpoint1_read : checkpoint0_read;
    end

    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            state<=IDLE;return_state<=IDLE;ctx<=EMPTY_CONTEXT;voice<=0;target<=0;reset_request<=0;reset_operation<=0;fill_checkpoint<=0;
            checkpoint_valid<=0;context_valid<=0;replacement<=0;dirty<=0;source_bound<=0;observed_valid<=0;
            epoch_writes_valid<=0;epoch_write_first<=0;epoch_write_last<=0;
            rsp_valid<=0;rsp_samples<=0;search_lo<=0;search_hi<=0;
            search_selected<=0;search_mid<=0;scan_frame<=0;scan_offset<=0;
            seeking<=0;header_clean<=0;header_buffer<=0;header_sent<=0;header_received<=0;
            byte_address<=0;assembled<=0;assembled_index<=0;assembled_bytes<=0;
            word_valid<=0;word_address<=0;word_data<=0;payload_byte<=0;
            for(i=0;i<16;i=i+1) begin
                context_clean[i]<=0;source_base[i]<=0;data_offset[i]<=0;
                observed_first[i]<=0;observed_last[i]<=0;
                frame_count[i]<=0;channels[i]<=0;seek_base[i]<=0;seek_count[i]<=0;loop_start[i]<=0;loop_end[i]<=0;
            end
        end else begin
            rsp_valid<=0;
            if(epoch_begin) begin dirty<=0;epoch_writes_valid<=0;end
            else if(epoch_active) begin
                dirty<=dirty|touched;
                if(late_read_dirty) dirty[voice]<=1;
                if(source_write_valid) begin
                    if(!epoch_writes_valid || write_first<epoch_write_first) epoch_write_first<=write_first;
                    if(!epoch_writes_valid || write_last>epoch_write_last) epoch_write_last<=write_last;
                    epoch_writes_valid<=1;
                end
            end
            if(memory_req_valid && memory_req_ready) begin
                if(!observed_valid[voice] || memory_req_word_address<observed_first[voice])
                    observed_first[voice]<=memory_req_word_address;
                if(!observed_valid[voice] || memory_req_word_address>observed_last[voice])
                    observed_last[voice]<=memory_req_word_address;
                observed_valid[voice]<=1;
            end
            if(bind_valid && state==IDLE) begin
                source_bound[bind_voice]<=1;
                observed_valid[bind_voice]<=0;
                source_base[bind_voice]<=bind_source_base;
                data_offset[bind_voice]<=bind_data_offset;frame_count[bind_voice]<=bind_frames;
                channels[bind_voice]<=bind_channels;seek_base[bind_voice]<=bind_seek_base;
                seek_count[bind_voice]<=bind_seek_count;
                loop_start[bind_voice]<=bind_loop_start;loop_end[bind_voice]<=bind_loop_end;
                context_valid[bind_voice]<=0;context_clean[bind_voice]<=0;
                checkpoint_valid[{bind_voice,1'b0}+:2]<=0;replacement[bind_voice]<=0;
            end
            case(state)
                IDLE: if(req_valid && req_ready) begin
                    voice<=req_voice;target<=req_frame;reset_request<=req_reset;reset_operation<=req_reset;
                    word_valid<=0;fill_checkpoint<=0;
                    state<=LOOKUP;
                end
                LOOKUP: begin
                    ctx<=lookup_context;
                    if(reset_request) begin
                        ctx<=EMPTY_CONTEXT;
                        reset_request<=0;state<=SEEK;
                    end else if(lookup_context.decoded_frame==target) state<=FINISH;
                    else if(lookup_context.previous_frame==target) begin
                        rsp_samples<=lookup_context.previous_sample;state<=FINISH;
                    end else if(cache_hit) begin
                        ctx<=candidate;
                        if(target<lookup_context.next_frame && candidate.block_index==1) begin
                            ctx.previous_frame<=32'hffffffff;ctx.previous_sample<=0;ctx.previous_clean<=0;
                        end else if(target==lookup_context.next_frame) begin
                            ctx.previous_frame<=lookup_context.decoded_frame;ctx.previous_sample<=lookup_context.decoded_sample;
                            ctx.previous_clean<=lookup_context.decoded_clean;
                        end
                        replacement[voice]<=!cache_index[0];state<=FINISH;
                    end else if(target<lookup_context.next_frame) state<=SEEK;
                    else begin seeking<=0;state<=ADVANCE;end
                end
                SEEK: begin
                    ctx.decoded_frame<=32'hffffffff;ctx.decoded_sample<=0;
                    ctx.previous_frame<=32'hffffffff;ctx.previous_sample<=0;
                    ctx.decoded_clean<=0;ctx.previous_clean<=0;
                    if(target>=frame_count[voice]) begin
                        ctx.next_frame<=frame_count[voice];ctx.predictor_clean<=0;seeking<=0;
                        state<=reset_operation ? FINISH : ADVANCE;
                    end else if(seek_count[voice]==0) begin
                        scan_frame<=0;scan_offset<=0;seeking<=1;
                        header_clean<=1;header_sent<=0;header_received<=0;
                        byte_address<=data_base;state<=HEADER;
                    end else begin
                        search_lo<=0;search_hi<=seek_count[voice]-1'b1;search_selected<=0;
                        search_mid<=(seek_count[voice]-1'b1)>>1;
                        assembled<=0;assembled_index<=0;assembled_bytes<=4;
                        byte_address<=seek_base[voice]+(((seek_count[voice]-1'b1)>>1)<<3);
                        state<=SEARCH;
                    end
                end
                SEARCH: if(!byte_ready) begin return_state<=SEARCH;state<=WORD_ISSUE;end
                    else if(assembled_index+1'b1<assembled_bytes) begin
                        assembled<=assembled_byte;assembled_index<=assembled_index+1'b1;byte_address<=byte_address+1'b1;
                    end else begin
                        assembled<=0;assembled_index<=0;
                        if(assembled_byte<=target) begin
                            search_selected<=search_mid;
                            if(search_mid>=search_hi) begin
                                byte_address<=seek_base[voice]+(search_mid<<3);state<=SEEK_FRAME;
                            end else begin
                                search_lo<=search_mid+1'b1;search_mid<=(search_mid+1'b1+search_hi)>>1;
                                byte_address<=seek_base[voice]+(((search_mid+1'b1+search_hi)>>1)<<3);
                            end
                        end else if(search_mid==0 || search_mid<=search_lo) begin
                            byte_address<=seek_base[voice]+(search_selected<<3);state<=SEEK_FRAME;
                        end else begin
                            search_hi<=search_mid-1'b1;search_mid<=(search_lo+search_mid-1'b1)>>1;
                            byte_address<=seek_base[voice]+(((search_lo+search_mid-1'b1)>>1)<<3);
                        end
                    end
                SEEK_FRAME: if(!byte_ready) begin return_state<=SEEK_FRAME;state<=WORD_ISSUE;end
                    else if(assembled_index+1'b1<assembled_bytes) begin
                        assembled<=assembled_byte;assembled_index<=assembled_index+1'b1;byte_address<=byte_address+1'b1;
                    end else begin
                        scan_frame<=assembled_byte;assembled<=0;assembled_index<=0;
                        byte_address<=byte_address+1'b1;state<=SEEK_OFFSET;
                    end
                SEEK_OFFSET: if(!byte_ready) begin return_state<=SEEK_OFFSET;state<=WORD_ISSUE;end
                    else if(assembled_index+1'b1<assembled_bytes) begin
                        assembled<=assembled_byte;assembled_index<=assembled_index+1'b1;byte_address<=byte_address+1'b1;
                    end else begin
                        scan_offset<=assembled_byte;seeking<=1;
                        header_clean<=1;header_sent<=0;header_received<=0;
                        byte_address<=data_base+assembled_byte;state<=HEADER;
                    end
                HEADER: begin
                    if(memory_req_valid && memory_req_ready) header_sent<=header_sent+1'b1;
                    if(memory_rsp_valid) begin
                        header_buffer[header_received*32+:32]<=memory_rsp_word;
                        header_received<=header_received+1'b1;
                        if(header_received+1'b1==header_words) begin
                            word_data<=memory_rsp_word;word_address<=byte_address[18:2]+header_received;
                            word_valid<=1;state<=HEADER_DONE;
                        end
                    end
                end
                HEADER_DONE: begin
                    ctx.block_frames<={16'd0,aligned_header[15:0]};
                    ctx.block_end<=scan_offset+{16'd0,aligned_header[31:16]};
                    ctx.pred_l<=aligned_header[47:32];ctx.index_l<=aligned_header[55:48];
                    if(channels[voice]==2) begin
                        ctx.pred_r<=aligned_header[79:64];ctx.index_r<=aligned_header[87:80];
                    end
                    ctx.block_index<=0;ctx.payload_offset<=scan_offset+4+(channels[voice]<<2);
                    ctx.nibble_cursor<=0;ctx.predictor_clean<=header_clean;
                    if(seeking) state<=SCAN_BLOCK;
                    else begin
                        byte_address<=data_base+scan_offset+4+(channels[voice]<<2);
                        state<=PAYLOAD;
                    end
                end
                SCAN_BLOCK: if(scan_frame+ctx.block_frames<=target) begin
                    scan_frame<=scan_frame+ctx.block_frames;scan_offset<=ctx.block_end;
                    header_clean<=1;header_sent<=0;header_received<=0;
                    byte_address<=data_base+ctx.block_end;state<=HEADER;
                end else begin ctx.next_frame<=scan_frame;seeking<=0;state<=ADVANCE;end
                ADVANCE: if(ctx.next_frame>target) state<=FINISH;
                    else if(ctx.block_index>=ctx.block_frames) begin
                        scan_offset<=ctx.block_end;
                        // Sequential headers cannot repair a rewritten frame/block map.
                        header_clean<=ctx.predictor_clean;header_sent<=0;header_received<=0;
                        byte_address<=data_base+ctx.block_end;state<=HEADER;
                    end else begin byte_address<=data_base+ctx.payload_offset+(ctx.nibble_cursor>>1);state<=PAYLOAD;end
                PAYLOAD: if(!byte_ready) begin return_state<=PAYLOAD;state<=WORD_ISSUE;end
                    else begin payload_byte<=fetched_byte;state<=STEP;end
                STEP: begin
                    ctx<=stepped;state<=ADVANCE;
                    if(ctx.next_frame==target) fill_checkpoint<=1;
                    if(loop_enabled && stepped.decoded_clean && !invalidate[voice]) begin
                        if(stepped.decoded_frame==loop_start[voice]) begin
                            checkpoint_valid[{voice,1'b0}]<=1;
                        end
                        if(stepped.decoded_frame==loop_end[voice]-1'b1) begin
                            checkpoint_valid[{voice,1'b1}]<=1;
                        end
                    end
                end
                FINISH: begin
                    context_valid[voice]<=1;context_clean[voice]<=ctx[2:0];
                    rsp_samples<=ctx.previous_frame==target ? ctx.previous_sample : ctx.decoded_sample;
                    rsp_valid<=1;state<=IDLE;
                    if(fill_checkpoint && !loop_enabled && ctx.decoded_frame==target &&
                       ctx.decoded_clean && !invalidate[voice]) begin
                        checkpoint_valid[{voice,replacement[voice]}]<=1;
                        replacement[voice]<=!replacement[voice];
                    end
                end
                WORD_ISSUE: if(memory_req_ready) state<=WORD_WAIT;
                WORD_WAIT: if(memory_rsp_valid) begin
                    word_data<=memory_rsp_word;word_address<=byte_address[18:2];word_valid<=1;
                    state<=return_state;
                end
            endcase
            // Invalidation is last so a coincident publication cannot create a
            // clean checkpoint from a partially old source. Retained PCM stays.
            if(state==IDLE && req_valid && req_ready && invalidate[req_voice]) begin
                ctx.predictor_clean<=0;ctx.decoded_clean<=0;ctx.previous_clean<=0;
            end
            for(i=0;i<16;i=i+1) if(invalidate[i]) begin
                checkpoint_valid[{i[3:0],1'b0}+:2]<=0;
                context_clean[i]<=0;
                if(voice==i && state!=IDLE) begin
                    ctx.predictor_clean<=0;ctx.decoded_clean<=0;ctx.previous_clean<=0;
                    header_clean<=0;word_valid<=0;
                end
            end
        end
    end
endmodule
