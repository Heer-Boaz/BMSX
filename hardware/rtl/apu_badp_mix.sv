`timescale 1ns/1ps
// A scheduled PCM/BADP/square/interpolation/filter/gain datapath. The caller supplies the
// resolved current frame, neighbor frame, Q16 fraction and current gain for
// exactly sixteen ordered slots. Cursor/loop/rate calculation, fade,
// MMIO, source binding lifetime and output cadence belong to other owners.
// Each active slot requests current then neighbor, preserving decoder state even
// when fraction is zero. The decoder and mixer below are the existing owners,
// not alternate implementations. Source memory traffic passes unmodified to
// the real sample-word memory controller.
// slot_reset requests a BADP reset (also used on a live seek); the independent
// slot_filter_clear denotes PLAY and must be retained by the scheduling owner
// until that slot's first accepted sample. A seek or live-source replacement
// need not clear filter histories. PCM and BADP share the same slot filter bank.
// PCM uses an independent byte-addressed memory request port, so its owner can
// route local RAM, system ROM or cartridge ROM without truncating the address.
// The caller supplies the original source data address, channel and bit words.
// As in MiSTer's SNES DSP, voice preparation and accumulation are scheduled
// as distinct datapath stages: https://github.com/MiSTer-devel/SNES_MiSTer/blob/master/rtl/DSP.vhd
// This is not the SNES arithmetic and does not constitute a full BMSX APU.
module apu_badp_mix (
 input wire clk,reset_n,
 input wire bind_valid,input wire [3:0] bind_voice,
 input wire [18:0] bind_source_base,input wire [19:0] bind_source_bytes,
 input wire [18:0] bind_data_offset,input wire [31:0] bind_frames,
 input wire [1:0] bind_channels,input wire [18:0] bind_seek_base,
 input wire [31:0] bind_seek_count,bind_loop_start,bind_loop_end,
 input wire source_write_valid,input wire [16:0] source_write_word,
 input wire [4:0] source_write_words,input wire epoch_begin,epoch_active,
 input wire epoch_change_valid,input wire [16:0] epoch_change_first,epoch_change_last,
 output wire memory_req_valid,input wire memory_req_ready,
 output wire [16:0] memory_req_word_address,input wire memory_rsp_valid,
 input wire [31:0] memory_rsp_word,
 output wire pcm_memory_req_valid,input wire pcm_memory_req_ready,
 output wire [31:0] pcm_memory_req_address,input wire pcm_memory_rsp_valid,
 input wire [31:0] pcm_memory_rsp_word,
 input wire start_valid,output wire start_ready,
 input wire slot_valid,output wire slot_ready,
 input wire slot_active,slot_reset,input wire [31:0] slot_frame,slot_neighbor,
 input wire [31:0] slot_bits_per_sample,slot_channels,slot_data_address,
 input wire [31:0] slot_generator_kind,slot_generator_duty_q12,
 input wire [15:0] slot_fraction,input wire signed [31:0] slot_gain_q12,
 input wire [31:0] slot_level_lr_q14,
 input wire slot_filter_clear,input wire [31:0] slot_filter_control,
 input wire [31:0] slot_filter_b0_b1,slot_filter_b2_a1,slot_filter_a2,
 output wire frame_valid,input wire frame_ready_out,
 output wire signed [15:0] frame_left,frame_right
);
 localparam [4:0] IDLE=0,ACQUIRE=1,RESET_REQ=2,RESET_WAIT=3,CUR_REQ=4,CUR_WAIT=5,
  NEXT_REQ=6,NEXT_WAIT=7,SUBMIT=8,FRAME_WAIT=9,FILTER_CLEAR=10,FILTER_REQ=11,FILTER_WAIT=12,
  PCM_CUR_REQ=13,PCM_CUR_WAIT=14,PCM_NEXT_REQ=15,PCM_NEXT_WAIT=16;
 reg [4:0] state;reg [3:0] index;
 reg active,square;reg [31:0] current_frame,neighbor_frame;reg [15:0] fraction;
 reg signed [31:0] gain;reg [31:0] level_lr,current_sample,neighbor_sample;
 reg reset_pending;reg [31:0] filter_control,filter_b0_b1,filter_b2_a1,filter_a2,filtered_sample;
 reg [31:0] bits_per_sample,channels,data_address;
 wire badp=bits_per_sample==32'd4;
 wire decoder_req_valid=state==RESET_REQ || state==CUR_REQ || state==NEXT_REQ;
 wire decoder_req_ready,decoder_rsp_valid;wire [31:0] decoder_rsp_samples;
 apu_badp_decoder decoder(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(bind_voice),
  .bind_source_base(bind_source_base),.bind_source_bytes(bind_source_bytes),.bind_data_offset(bind_data_offset),
  .bind_frames(bind_frames),.bind_channels(bind_channels),.bind_seek_base(bind_seek_base),
  .bind_seek_count(bind_seek_count),.bind_loop_start(bind_loop_start),.bind_loop_end(bind_loop_end),
  .req_valid(decoder_req_valid),.req_ready(decoder_req_ready),.req_reset(state==RESET_REQ),
  .req_voice(index),.req_frame(state==NEXT_REQ ? neighbor_frame : current_frame),
  .rsp_valid(decoder_rsp_valid),.rsp_samples(decoder_rsp_samples),
  .source_write_valid(source_write_valid),.source_write_word(source_write_word),.source_write_words(source_write_words),
  .epoch_begin(epoch_begin),.epoch_active(epoch_active),.epoch_change_valid(epoch_change_valid),.epoch_change_first(epoch_change_first),.epoch_change_last(epoch_change_last),.memory_req_valid(memory_req_valid),
  .memory_req_ready(memory_req_ready),.memory_req_word_address(memory_req_word_address),
  .memory_rsp_valid(memory_rsp_valid),.memory_rsp_word(memory_rsp_word));
 wire pcm_req_valid=state==PCM_CUR_REQ || state==PCM_NEXT_REQ;
 wire pcm_req_ready,pcm_rsp_valid;wire [31:0] pcm_rsp_samples;
 wire [31:0] pcm_source_frame=state==PCM_NEXT_REQ ? neighbor_frame : current_frame;
 wire [31:0] pcm_sample_index=pcm_source_frame*channels;
 wire [31:0] pcm_byte_address=data_address+(bits_per_sample==32'd16 ? pcm_sample_index<<1 : pcm_sample_index);
 apu_pcm_frame pcm(.clk(clk),.reset_n(reset_n),.req_valid(pcm_req_valid),.req_ready(pcm_req_ready),
  .req_byte_address(pcm_byte_address),.req_channels(channels),.req_bits_per_sample(bits_per_sample),
  .memory_req_valid(pcm_memory_req_valid),.memory_req_ready(pcm_memory_req_ready),
  .memory_req_address(pcm_memory_req_address),.memory_rsp_valid(pcm_memory_rsp_valid),
  .memory_rsp_word(pcm_memory_rsp_word),.rsp_valid(pcm_rsp_valid),
  .rsp_ready(state==PCM_CUR_WAIT || state==PCM_NEXT_WAIT),.rsp_samples(pcm_rsp_samples));
 wire signed [16:0] delta_l=$signed({neighbor_sample[15],neighbor_sample[15:0]})-$signed({current_sample[15],current_sample[15:0]});
 wire signed [16:0] delta_r=$signed({neighbor_sample[31],neighbor_sample[31:16]})-$signed({current_sample[31],current_sample[31:16]});
 wire signed [33:0] scaled_l=delta_l*$signed({1'b0,fraction});
 wire signed [33:0] scaled_r=delta_r*$signed({1'b0,fraction});
 wire signed [33:0] interpolated_l=$signed({{18{current_sample[15]}},current_sample[15:0]})+(scaled_l>>>16);
 wire signed [33:0] interpolated_r=$signed({{18{current_sample[31]}},current_sample[31:16]})+(scaled_r>>>16);
 wire filter_clear_ready,filter_req_ready,filter_rsp_valid;
 wire [31:0] filter_rsp_samples;
 apu_biquad filter(.clk(clk),.reset_n(reset_n),.clear_valid(state==FILTER_CLEAR),
  .clear_ready(filter_clear_ready),.clear_slot(index),
  .req_valid(state==FILTER_REQ),.req_ready(filter_req_ready),.req_slot(index),
  .req_control(filter_control),.req_b0_b1(filter_b0_b1),.req_b2_a1(filter_b2_a1),.req_a2(filter_a2),
  .req_samples({interpolated_r[15:0],interpolated_l[15:0]}),
  .rsp_valid(filter_rsp_valid),.rsp_ready(state==FILTER_WAIT),.rsp_samples(filter_rsp_samples));
 wire mixer_start_ready,mixer_slot_ready;
 assign start_ready=state==IDLE && mixer_start_ready;
 assign slot_ready=state==ACQUIRE && mixer_slot_ready;
 apu_mix_engine mixer(.clk(clk),.reset_n(reset_n),.start_valid(start_valid && state==IDLE),.start_ready(mixer_start_ready),
  .slot_valid(state==SUBMIT),.slot_ready(mixer_slot_ready),.slot_active(active),
  .slot_left(filter_control[0] ? filtered_sample[15:0] : interpolated_l[15:0]),
  .slot_right(filter_control[0] ? filtered_sample[31:16] : interpolated_r[15:0]),.slot_gain_q12(gain),
  .slot_level_lr_q14(level_lr),
  .frame_valid(frame_valid),.frame_ready_out(frame_ready_out),.frame_left(frame_left),.frame_right(frame_right));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin state<=IDLE;index<=0;active<=0;square<=0;current_frame<=0;neighbor_frame<=0;
   fraction<=0;gain<=0;level_lr<=0;current_sample<=0;neighbor_sample<=0;reset_pending<=0;
   filter_control<=0;filter_b0_b1<=0;filter_b2_a1<=0;filter_a2<=0;filtered_sample<=0;
   bits_per_sample<=0;channels<=0;data_address<=0;end
  else case(state)
   IDLE: if(start_valid && start_ready) begin index<=0;state<=ACQUIRE;end
   ACQUIRE: if(slot_valid && slot_ready) begin
    active<=slot_active;current_frame<=slot_frame;neighbor_frame<=slot_neighbor;
    fraction<=slot_fraction;gain<=slot_gain_q12;level_lr<=slot_level_lr_q14;
    reset_pending<=slot_reset;filter_control<=slot_filter_control;
    bits_per_sample<=slot_bits_per_sample;channels<=slot_channels;data_address<=slot_data_address;
    square<=slot_generator_kind==32'd1;
    filter_b0_b1<=slot_filter_b0_b1;filter_b2_a1<=slot_filter_b2_a1;filter_a2<=slot_filter_a2;
    if(slot_generator_kind==32'd1) begin
     current_sample<=({20'd0,slot_fraction[15:4]}<slot_generator_duty_q12) ? 32'h7fff7fff : 32'h80008000;
     neighbor_sample<=({20'd0,slot_fraction[15:4]}<slot_generator_duty_q12) ? 32'h7fff7fff : 32'h80008000;
    end
    if(!slot_active) state<=SUBMIT;
    else if(slot_filter_clear) state<=FILTER_CLEAR;
    else if(slot_generator_kind==32'd1) state<=slot_filter_control[0] ? FILTER_REQ : SUBMIT;
    else if(slot_bits_per_sample==32'd4 && slot_reset) state<=RESET_REQ;
    else state<=slot_bits_per_sample==32'd4 ? CUR_REQ : PCM_CUR_REQ;
   end
   FILTER_CLEAR: if(filter_clear_ready) state<=square ? (filter_control[0] ? FILTER_REQ : SUBMIT) :
    badp ? (reset_pending ? RESET_REQ : CUR_REQ) : PCM_CUR_REQ;
   RESET_REQ: if(decoder_req_ready) state<=RESET_WAIT;
   RESET_WAIT: if(decoder_rsp_valid) state<=CUR_REQ;
   CUR_REQ: if(decoder_req_ready) state<=CUR_WAIT;
   CUR_WAIT: if(decoder_rsp_valid) begin current_sample<=decoder_rsp_samples;
    if(current_frame==neighbor_frame) begin neighbor_sample<=decoder_rsp_samples;state<=filter_control[0] ? FILTER_REQ : SUBMIT;end
    else state<=NEXT_REQ;
   end
   NEXT_REQ: if(decoder_req_ready) state<=NEXT_WAIT;
   NEXT_WAIT: if(decoder_rsp_valid) begin neighbor_sample<=decoder_rsp_samples;state<=filter_control[0] ? FILTER_REQ : SUBMIT;end
   PCM_CUR_REQ: if(pcm_req_ready) state<=PCM_CUR_WAIT;
   PCM_CUR_WAIT: if(pcm_rsp_valid) begin current_sample<=pcm_rsp_samples;
    if(current_frame==neighbor_frame) begin neighbor_sample<=pcm_rsp_samples;state<=filter_control[0] ? FILTER_REQ : SUBMIT;end
    else state<=PCM_NEXT_REQ;
   end
   PCM_NEXT_REQ: if(pcm_req_ready) state<=PCM_NEXT_WAIT;
   PCM_NEXT_WAIT: if(pcm_rsp_valid) begin neighbor_sample<=pcm_rsp_samples;state<=filter_control[0] ? FILTER_REQ : SUBMIT;end
   FILTER_REQ: if(filter_req_ready) state<=FILTER_WAIT;
   FILTER_WAIT: if(filter_rsp_valid) begin filtered_sample<=filter_rsp_samples;state<=SUBMIT;end
   SUBMIT: if(mixer_slot_ready) begin if(index==15) state<=FRAME_WAIT;
    else begin index<=index+1'b1;state<=ACQUIRE;end end
   FRAME_WAIT: if(frame_valid && frame_ready_out) state<=IDLE;
  endcase
 end
endmodule
