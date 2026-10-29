`timescale 1ns/1ps
// Sample cursor owner: sixteen slots by default, or four per parallel lane.
// The caller supplies the phase quotient and
// signed remainder already resolved from RATE_STEP_Q16 and source Hz. Loading
// is the PLAY/seek/restore boundary; the command/source owner must serialize
// live changes with frame admission. Cursor and phase values are raw signed
// integer Q16 and signed 44100-denominator remainders, not floating point.
//
// A frame scheduler submits slots in order, including inactive ones. The
// resulting descriptor is held until the mixer accepts it; only then are that
// slot's cursor and remainder advanced. An ended flag accompanies the final
// emitted sample (or an out-of-range unlooped start). Natural-end events and
// slot-bank clearing belong to the caller, after the frame's output edge.
// No latency guarantee or snapshot-overflow recovery is implied.
//
// Typical in-range and single-wrap phases avoid division. A shared restoring
// modulo datapath handles long signed advances and loop-bound edits without
// clamping or repeated unbounded subtraction. Its 64-cycle long path is real
// work and must be budgeted by the whole APU scheduler.
// PSX MiSTer likewise time-multiplexes per-voice phase state and sample work:
// https://github.com/MiSTer-devel/PSX_MiSTer/blob/cd17b5a0ad261005c321d9d5ba41b8dbe313a7d3/rtl/spu.vhd
module apu_voice_cursor #(parameter integer SLOT_BITS=4) (
 input wire clk, reset_n,
 input wire load_valid, output wire load_ready, input wire [3:0] load_slot,
 input wire signed [63:0] load_cursor_q16, load_step_q16,
 input wire signed [31:0] load_remainder, load_step_remainder,
 input wire [31:0] load_frames, load_loop_start, load_loop_end,
 input wire req_valid, output wire req_ready, input wire [3:0] req_slot, input wire req_active,
 output wire rsp_valid, input wire rsp_ready,
 output reg [3:0] rsp_slot, output reg rsp_active, rsp_ended,
 output reg [31:0] rsp_frame, rsp_neighbor, output reg [15:0] rsp_fraction,
 output reg signed [63:0] rsp_next_cursor_q16, output reg signed [31:0] rsp_next_remainder
);
 localparam [2:0] IDLE=0, NORMAL_CURRENT=1, PREPARE=2, NORMAL_NEXT=3, DIVIDE=4, HOLD=5;
 reg [2:0] state, divide_return;
 reg signed [63:0] cursors[0:(1<<SLOT_BITS)-1],steps[0:(1<<SLOT_BITS)-1];
 reg signed [31:0] remainders[0:(1<<SLOT_BITS)-1],step_remainders[0:(1<<SLOT_BITS)-1];
 reg [31:0] frames[0:(1<<SLOT_BITS)-1],loop_starts[0:(1<<SLOT_BITS)-1],loop_ends[0:(1<<SLOT_BITS)-1];
 reg [3:0] slot;
 reg [31:0] frames_work, loop_start_work,loop_end_work;
 reg signed [63:0] cursor_work,step_work;
 reg signed [31:0] remainder_work,step_remainder_work;
 reg [63:0] dividend,divisor,divide_remainder;
 reg [6:0] divide_count;
 reg divide_negative;
 wire loop_enabled=loop_end_work>loop_start_work;
 wire signed [63:0] loop_start_q16=$signed({16'd0,loop_start_work,16'd0});
 wire signed [63:0] loop_end_q16=$signed({16'd0,loop_end_work,16'd0});
 wire signed [63:0] frame_end_q16=$signed({16'd0,frames_work,16'd0});
 wire signed [63:0] loop_length=loop_end_q16-loop_start_q16;
 wire signed [63:0] relative_cursor=cursor_work-loop_start_q16;
 wire [63:0] shifted_remainder={divide_remainder[62:0],dividend[63]};
 wire [63:0] reduced_remainder=shifted_remainder>=divisor ? shifted_remainder-divisor : shifted_remainder;
 wire [63:0] unsigned_wrapped=divide_negative && reduced_remainder!=0 ? divisor-reduced_remainder : reduced_remainder;
 wire signed [32:0] accumulated_remainder=$signed({remainder_work[31],remainder_work})+$signed({step_remainder_work[31],step_remainder_work});
 wire signed [63:0] phase_carry=accumulated_remainder>=33'sd44100 ? 64'sd1 : accumulated_remainder<=-33'sd44100 ? -64'sd1 : 64'sd0;
 wire signed [32:0] adjusted_remainder=accumulated_remainder>=33'sd44100 ? accumulated_remainder-33'sd44100 : accumulated_remainder<=-33'sd44100 ? accumulated_remainder+33'sd44100 : accumulated_remainder;
 wire [32:0] next_frame={1'b0,cursor_work[47:16]}+33'd1;
 assign load_ready=reset_n && state==IDLE;
 assign req_ready=reset_n && state==IDLE && !load_valid;
 assign rsp_valid=reset_n && state==HOLD;
 integer i;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;divide_return<=IDLE;slot<=0;frames_work<=0;loop_start_work<=0;loop_end_work<=0;
   cursor_work<=0;step_work<=0;remainder_work<=0;step_remainder_work<=0;
   dividend<=0;divisor<=0;divide_remainder<=0;divide_count<=0;divide_negative<=0;
   rsp_slot<=0;rsp_active<=0;rsp_ended<=0;rsp_frame<=0;rsp_neighbor<=0;rsp_fraction<=0;
   rsp_next_cursor_q16<=0;rsp_next_remainder<=0;
   for(i=0;i<(1<<SLOT_BITS);i=i+1)begin cursors[i]<=0;steps[i]<=0;remainders[i]<=0;step_remainders[i]<=0;frames[i]<=0;loop_starts[i]<=0;loop_ends[i]<=0;end
  end else case(state)
   IDLE: begin
    if(load_valid && load_ready) begin
     cursors[load_slot[SLOT_BITS-1:0]]<=load_cursor_q16;steps[load_slot[SLOT_BITS-1:0]]<=load_step_q16;
     remainders[load_slot[SLOT_BITS-1:0]]<=load_remainder;step_remainders[load_slot[SLOT_BITS-1:0]]<=load_step_remainder;
     frames[load_slot[SLOT_BITS-1:0]]<=load_frames;loop_starts[load_slot[SLOT_BITS-1:0]]<=load_loop_start;loop_ends[load_slot[SLOT_BITS-1:0]]<=load_loop_end;
    end else if(req_valid && req_ready) begin
     slot<=req_slot;rsp_slot<=req_slot;rsp_active<=req_active;rsp_ended<=0;
     rsp_frame<=0;rsp_neighbor<=0;rsp_fraction<=0;
     cursor_work<=cursors[req_slot[SLOT_BITS-1:0]];step_work<=steps[req_slot[SLOT_BITS-1:0]];
     remainder_work<=remainders[req_slot[SLOT_BITS-1:0]];step_remainder_work<=step_remainders[req_slot[SLOT_BITS-1:0]];
     frames_work<=frames[req_slot[SLOT_BITS-1:0]];loop_start_work<=loop_starts[req_slot[SLOT_BITS-1:0]];loop_end_work<=loop_ends[req_slot[SLOT_BITS-1:0]];
     rsp_next_cursor_q16<=cursors[req_slot[SLOT_BITS-1:0]];rsp_next_remainder<=remainders[req_slot[SLOT_BITS-1:0]];
     state<=req_active ? NORMAL_CURRENT : HOLD;
    end
   end
   NORMAL_CURRENT,NORMAL_NEXT: begin
    if(loop_enabled && (cursor_work<loop_start_q16 || cursor_work>=loop_end_q16)) begin
     if(cursor_work>=loop_end_q16 && cursor_work-loop_end_q16<loop_length) begin
      cursor_work<=cursor_work-loop_length;
      if(state==NORMAL_CURRENT) state<=PREPARE;
      else begin rsp_next_cursor_q16<=cursor_work-loop_length;rsp_next_remainder<=remainder_work;state<=HOLD;end
     end else if(cursor_work<loop_start_q16 && loop_start_q16-cursor_work<=loop_length) begin
      cursor_work<=cursor_work+loop_length;
      if(state==NORMAL_CURRENT) state<=PREPARE;
      else begin rsp_next_cursor_q16<=cursor_work+loop_length;rsp_next_remainder<=remainder_work;state<=HOLD;end
     end else begin
      dividend<=relative_cursor<0 ? -relative_cursor : relative_cursor;
      divide_negative<=relative_cursor<0;divisor<=loop_length;divide_remainder<=0;divide_count<=0;
      divide_return<=state;state<=DIVIDE;
     end
    end else if(state==NORMAL_CURRENT) begin
     if(!loop_enabled && (cursor_work<0 || cursor_work>=frame_end_q16)) begin
      rsp_active<=0;rsp_ended<=1;state<=HOLD;
     end else state<=PREPARE;
    end else begin
     rsp_next_cursor_q16<=cursor_work;rsp_next_remainder<=remainder_work;
     rsp_ended<=!loop_enabled && (cursor_work<0 || cursor_work>=frame_end_q16);state<=HOLD;
    end
   end
   PREPARE: begin
    rsp_frame<=cursor_work[47:16];rsp_fraction<=cursor_work[15:0];
    if(loop_enabled && next_frame>={1'b0,loop_end_work}) rsp_neighbor<=loop_start_work;
    else if(!loop_enabled && next_frame>={1'b0,frames_work}) rsp_neighbor<=cursor_work[47:16];
    else rsp_neighbor<=next_frame[31:0];
    cursor_work<=cursor_work+step_work+phase_carry;remainder_work<=adjusted_remainder[31:0];
    state<=NORMAL_NEXT;
   end
   DIVIDE: begin
    dividend<=dividend<<1;divide_remainder<=reduced_remainder;divide_count<=divide_count+1'b1;
    if(divide_count==63) begin
     cursor_work<=loop_start_q16+$signed(unsigned_wrapped);
     if(divide_return==NORMAL_CURRENT) state<=PREPARE;
     else begin rsp_next_cursor_q16<=loop_start_q16+$signed(unsigned_wrapped);rsp_next_remainder<=remainder_work;state<=HOLD;end
    end
   end
   HOLD: if(rsp_ready) begin
    if(rsp_active) begin cursors[slot[SLOT_BITS-1:0]]<=rsp_next_cursor_q16;remainders[slot[SLOT_BITS-1:0]]<=rsp_next_remainder;end
    state<=IDLE;
   end
  endcase
 end
endmodule
