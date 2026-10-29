`timescale 1ns/1ps
// Proposed 13.5-MHz physical beam phase owner. Book I's half-line period is
// (H*D)/(2*13.5 MHz*LC): each physical reference edge advances numerator
// phase by 2*LC modulo H*D. The interval may be shorter than one reference
// period, so this owner counts *all* representable half-line and field
// crossings rather than clamping to one event per tick. The 8-stage quotient
// networks are bounded because 2*LC <= 254 and the prior remainder is below
// the divisor; field crossings cannot exceed half-line crossings.
//
// cfg_valid is an already coherent transfer into this clock domain. A valid
// new timing configuration restarts at zero on that edge, in accordance with
// the caller's beam-restart request. CPU-to-beam CDC and the relation of that
// edge to a CPU write are not implemented here. This owner supplies phase and
// counts and the vertical VBlank/VSync/FIELD landmarks: CSR IRQ coalescing,
// live-vs-displayed register
// latches, DAC/HSYNC waveform and physical-sample-to-logical-grid mapping are
// separate unqualified owners. No public register contract is changed here.
// Production timing generators use separate counters for timing and data:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/video.py
module gfx_pcrtc_beam_phase #(
 parameter integer SYSTEM_CLOCK=0,
 // Four times the 13.5 MHz reference, with 2x period encoding.
 parameter integer REFERENCE_CLOCK_X4=0,
 parameter integer PHASE_BITS=SYSTEM_CLOCK ? 32 : 23,
 parameter integer INCREMENT_BITS=SYSTEM_CLOCK ? 17 : 8
)(
 input wire clk,reset_n,soft_reset,
 input wire cfg_valid,
 input wire [31:0] cfg_smode1,cfg_smode1_high,cfg_synch1_low,cfg_synch1_high,
 input wire [31:0] cfg_synch2_low,cfg_syncv_low,cfg_syncv_high,
 output reg running,
 output reg [PHASE_BITS-1:0] period_numerator,phase,
 output reg [INCREMENT_BITS-1:0] increment,
 output reg [14:0] total_half_lines,field_half_line,active_half_lines,vsync_half_line,
 output reg [63:0] elapsed_half_lines,elapsed_fields,
 output reg [7:0] crossed_half_lines,crossed_fields,crossed_vblank_entries,crossed_vsyncs,
 output wire [7:0] vblank_before_write,
 output wire vblank_after_restart,
 output wire hsync_before_write,vsync_before_write,vsync_after_restart,field_before_write,
 output reg vblank_active,field
);
 wire [17:0] h_sum={7'd0,cfg_synch1_low[10:0]}+{7'd0,cfg_synch1_low[21:11]}+
  {2'd0,cfg_synch1_high[26:11]}+{7'd0,cfg_synch2_low[10:0]}+{2'd0,cfg_synch2_low[26:11]};
 wire [4:0] divider={2'd0,cfg_smode1[2:0]}*({3'd0,cfg_smode1[11:10]}+5'd1);
 wire [22:0] reference_period=h_sum*divider;
 // 27 MHz / 33.8688 MHz = 625 / 784. In the system-clock
 // instance the phase accumulator therefore advances 625*LC modulo
 // 784*H*D; the reference-clock instance retains its original 2*LC/H*D.
 wire [PHASE_BITS-1:0] new_period=SYSTEM_CLOCK ? reference_period*32'd784 :
  REFERENCE_CLOCK_X4 ? {reference_period,1'b0} : reference_period;
 wire [INCREMENT_BITS-1:0] new_increment=SYSTEM_CLOCK ? cfg_smode1[9:3]*17'd625 :
  REFERENCE_CLOCK_X4 ? cfg_smode1[9:3] : {cfg_smode1[9:3],1'b0};
 wire [13:0] v_sum={4'd0,cfg_syncv_low[9:0]}+{4'd0,cfg_syncv_low[19:10]}+
  {2'd0,cfg_syncv_low[31:20]}+{4'd0,cfg_syncv_high[9:0]}+
  {3'd0,cfg_syncv_high[20:10]}+{3'd0,cfg_syncv_high[31:21]};
 wire [14:0] new_total=cfg_smode1_high[4] ? {v_sum,1'b0} : {1'b0,v_sum};
 wire [13:0] vsync_sum={3'd0,cfg_syncv_high[20:10]}+{4'd0,cfg_syncv_low[9:0]}+{4'd0,cfg_syncv_low[19:10]};
 wire [14:0] new_active=cfg_smode1_high[4] ? {3'd0,cfg_syncv_high[20:10],1'b0} : {4'd0,cfg_syncv_high[20:10]};
 wire [14:0] new_vsync=cfg_smode1_high[4] ? {vsync_sum,1'b0} : {1'b0,vsync_sum};
 wire new_running=!cfg_smode1[16] && !cfg_smode1[17] && new_period!=0 && new_increment!=0 && new_total!=0;
 reg field_toggles;
 reg [PHASE_BITS+7:0] remainder_work,trial;
 reg [7:0] half_count;
 reg [PHASE_BITS-1:0] next_phase;
 reg [23:0] field_remainder_work,field_trial;
 reg [7:0] field_count;
 reg [14:0] next_field_line;
 reg [8:0] vblank_count,vsync_count;
 assign vblank_before_write=reset_n && SYSTEM_CLOCK && running ? vblank_count[7:0] : 8'd0;
 assign vblank_after_restart=reset_n && cfg_valid && new_running && new_active==0;
 // HSYNC cadence is every two elapsed half-lines from the current restart,
 // even across odd-length fields. An acknowledged pending event is rearmed
 // strictly after the current half-line; no suppressed crossings are replayed.
 assign hsync_before_write=reset_n && SYSTEM_CLOCK && running &&
    (elapsed_half_lines[0] ? half_count>=1 : half_count>=2);
 assign vsync_before_write=reset_n && SYSTEM_CLOCK && running && vsync_count!=0;
 assign vsync_after_restart=reset_n && cfg_valid && new_running && new_vsync==0;
 wire field_after_old=vsync_count!=0 ? (field_toggles ? field^vsync_count[0] : 1'b1) : field;
 assign field_before_write=SYSTEM_CLOCK && running ? field_after_old : field;
 integer k;
 always @* begin
  remainder_work=phase+{{(PHASE_BITS+8-INCREMENT_BITS){1'b0}},increment};trial=0;half_count=0;
  if(running) begin
   for(k=7;k>=0;k=k-1) begin
    trial={{8{1'b0}},period_numerator}<<k;
    if(remainder_work>=trial) begin remainder_work=remainder_work-trial;half_count[k]=1'b1;end
   end
  end
  next_phase=remainder_work[PHASE_BITS-1:0];
  field_remainder_work={9'd0,field_half_line}+{16'd0,half_count};field_trial=0;field_count=0;
  if(running) begin
   for(k=7;k>=0;k=k-1) begin
    field_trial={9'd0,total_half_lines}<<k;
    if(field_remainder_work>=field_trial) begin field_remainder_work=field_remainder_work-field_trial;field_count[k]=1'b1;end
   end
  end
  next_field_line=field_remainder_work[14:0];
  // Each complete field crosses each landmark once. Compare the endpoints
  // to account for the partial fields, including landmarks at 0 or total.
  vblank_count={1'b0,field_count}+{8'd0,(next_field_line>=active_half_lines)}-{8'd0,(field_half_line>=active_half_lines)};
  vsync_count={1'b0,field_count}+{8'd0,(next_field_line>=vsync_half_line)}-{8'd0,(field_half_line>=vsync_half_line)};
 end
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   running<=0;period_numerator<=0;increment<=0;total_half_lines<=0;phase<=0;
   field_half_line<=0;elapsed_half_lines<=0;elapsed_fields<=0;crossed_half_lines<=0;crossed_fields<=0;
   active_half_lines<=0;vsync_half_line<=0;crossed_vblank_entries<=0;crossed_vsyncs<=0;
   vblank_active<=0;field<=0;field_toggles<=0;
  end else if(soft_reset) begin
   // Software RESET installs the reset timing on this edge. The beam does not
   // spend an extra system clock stopped before starting the reset epoch.
   running<=new_running;period_numerator<=new_period;increment<=new_increment;total_half_lines<=new_total;phase<=0;
   field_half_line<=0;elapsed_half_lines<=0;elapsed_fields<=0;crossed_half_lines<=0;crossed_fields<=0;
   active_half_lines<=new_active;vsync_half_line<=new_vsync;crossed_vblank_entries<=0;crossed_vsyncs<=0;
   vblank_active<=0;field<=0;field_toggles<=cfg_smode1[14:13]!=0 && cfg_syncv_low[0];
  end else if(cfg_valid) begin
   running<=new_running;period_numerator<=new_period;increment<=new_increment;total_half_lines<=new_total;
   phase<=0;field_half_line<=0;elapsed_half_lines<=0;elapsed_fields<=0;
   crossed_half_lines<=SYSTEM_CLOCK ? half_count : 0;crossed_fields<=SYSTEM_CLOCK ? field_count : 0;
   active_half_lines<=new_active;vsync_half_line<=new_vsync;field_toggles<=cfg_smode1[14:13]!=0 && cfg_syncv_low[0];
   // A zero landmark is due at the restart epoch itself, not one physical
   // reference tick later. The coherent cfg edge is that local epoch; any
   // transport delay from a CPU register write remains the CDC owner's job.
   // In the system-clock owner the old beam is serviced through this
   // edge before the write installs its new epoch. Preserve both any old
   // landmark and a zero landmark of the new configuration; consumers must
   // keep the same ordering when taking display snapshots or raising IRQs.
   crossed_vblank_entries<=(SYSTEM_CLOCK ? vblank_count[7:0] : 8'd0)+(new_running && new_active==0);
   crossed_vsyncs<=(SYSTEM_CLOCK ? vsync_count[7:0] : 8'd0)+(new_running && new_vsync==0);
   vblank_active<=new_running && new_active==0;
   if(new_running && new_vsync==0) begin
    if(cfg_smode1[14:13]!=0 && cfg_syncv_low[0]) field<=~(SYSTEM_CLOCK ? field_after_old : field);
    else field<=1'b1;
   end else if(SYSTEM_CLOCK) field<=field_after_old;
  end else if(running) begin
   phase<=next_phase;field_half_line<=next_field_line;
   elapsed_half_lines<=elapsed_half_lines+half_count;elapsed_fields<=elapsed_fields+field_count;
   crossed_half_lines<=half_count;crossed_fields<=field_count;
   crossed_vblank_entries<=vblank_count[7:0];crossed_vsyncs<=vsync_count[7:0];
   vblank_active<=next_field_line>=active_half_lines;
   if(vsync_count!=0) begin
    if(field_toggles) field<=field^vsync_count[0];
    else field<=1'b1;
   end
  end else begin crossed_half_lines<=0;crossed_fields<=0;crossed_vblank_entries<=0;crossed_vsyncs<=0;end
 end
endmodule
