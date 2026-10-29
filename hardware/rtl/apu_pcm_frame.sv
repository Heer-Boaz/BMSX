`timescale 1ns/1ps
// One PCM source-frame read through an aligned 32-bit memory-word service.
// The source owner supplies the raw byte address of this frame, the full
// channel-count and bit-depth words. It retains source binding, dispatches
// BADP separately, and decides how a word address reaches local SRAM or an
// external ROM. For requests dispatched here, the datapath selects PCM16 only
// for bit-depth word 16 and PCM8 otherwise. A single channel is duplicated.
//
// Up to two ordered word requests cover an unaligned frame. The response is
// retained until accepted. No frame-count, source-range, or missing-data policy
// is fabricated here: the memory service owns the actual addressed words.
// MAME's YMZ280B and MiSTer SNES DSP likewise separate source memory service
// from decoded voice/mixer data paths; their PCM formats are not BMSX rules:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/ymz280b.cpp
// https://github.com/MiSTer-devel/SNES_MiSTer/blob/master/rtl/DSP.vhd
module apu_pcm_frame (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,
 input wire [31:0] req_byte_address,req_channels,req_bits_per_sample,
 output wire memory_req_valid,input wire memory_req_ready,
 output wire [31:0] memory_req_address,
 input wire memory_rsp_valid,input wire [31:0] memory_rsp_word,
 output wire rsp_valid,input wire rsp_ready,output reg [31:0] rsp_samples
);
 localparam [2:0] IDLE=0,WORD0=1,WAIT0=2,WORD1=3,WAIT1=4,ASSEMBLE=5,REPLY=6;
 reg [2:0] state;
 reg [31:0] word_address,first_word,second_word;
 reg [1:0] byte_offset;
 reg mono,pcm16,second_needed;
 wire [2:0] requested_bytes=req_bits_per_sample==32'd16 ? (req_channels==32'd1 ? 3'd2:3'd4) :
                                                             (req_channels==32'd1 ? 3'd1:3'd2);
 wire [63:0] source_window={second_word,first_word} >> {byte_offset,3'b000};
 wire [15:0] left_sample=pcm16 ? source_window[15:0] : {source_window[7:0]^8'h80,8'h00};
 wire [15:0] right_sample=mono ? left_sample : pcm16 ? source_window[31:16] : {source_window[15:8]^8'h80,8'h00};
 assign req_ready=reset_n && state==IDLE;
 assign memory_req_valid=reset_n && (state==WORD0 || state==WORD1);
 assign memory_req_address=word_address+(state==WORD1 ? 32'd4:32'd0);
 assign rsp_valid=reset_n && state==REPLY;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;word_address<=0;first_word<=0;second_word<=0;byte_offset<=0;
   mono<=0;pcm16<=0;second_needed<=0;rsp_samples<=0;
  end else case(state)
   IDLE: if(req_valid && req_ready) begin
    word_address<={req_byte_address[31:2],2'b00};byte_offset<=req_byte_address[1:0];
    mono<=req_channels==32'd1;pcm16<=req_bits_per_sample==32'd16;
    second_needed<=({1'b0,req_byte_address[1:0]}+requested_bytes)>3'd4;
    state<=WORD0;
   end
   WORD0: if(memory_req_ready) begin
    if(memory_rsp_valid) begin
     first_word<=memory_rsp_word;
     if(second_needed) state<=WORD1;
     else begin second_word<=0;state<=ASSEMBLE;end
    end else state<=WAIT0;
   end
   WAIT0: if(memory_rsp_valid) begin
    first_word<=memory_rsp_word;
    if(second_needed) state<=WORD1;
    else begin second_word<=0;state<=ASSEMBLE;end
   end
   WORD1: if(memory_req_ready) begin
    if(memory_rsp_valid) begin second_word<=memory_rsp_word;state<=ASSEMBLE;end
    else state<=WAIT1;
   end
   WAIT1: if(memory_rsp_valid) begin second_word<=memory_rsp_word;state<=ASSEMBLE;end
   ASSEMBLE: begin rsp_samples<={right_sample,left_sample};state<=REPLY;end
   REPLY: if(rsp_ready) state<=IDLE;
  endcase
 end
endmodule
