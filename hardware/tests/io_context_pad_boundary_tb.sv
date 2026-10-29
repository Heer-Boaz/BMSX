`timescale 1ns/1ps
// Real serial context input through U7, then the actual accessory pad request.
// A context change during a frame must not tear that frame's frozen payload.
module io_context_pad_boundary_tb;
 reg clk=0, reset_n=0;
 always #5 clk=~clk;
 reg [15:0] width=320,height=240;
 reg [31:0] epoch=32'h12345678;
 wire display_context,pad_clk;
 wire [3:0] pad_cmd,pad_select_n;
 wire accessory_data,accessory_oe;
 wire [3:0] pad_data={3'b111,accessory_oe ? accessory_data : 1'b1};
 tri [31:0] sys_ad;
 tri1 sys_ready_n,supervisor_n;
 wire [21:0] rom_address;
 wire rom_ce_n,rom_oe_n;
 wire accepted,context_valid;
 wire [15:0] seen_width,seen_height;
 wire [31:0] seen_epoch;
 display_context_tx source(.clk(clk),.reset_n(reset_n),.context_valid(1'b1),
  .display_width(width),.display_height(height),.display_epoch(epoch),.display_context(display_context));
 io_system_pins dut(.clk(clk),.reset_n(reset_n),.cs_io_n(1'b1),.cs_rom_n(1'b1),
  .sys_ad(sys_ad),.sys_as_n(1'b1),.sys_rd_n(1'b1),.sys_wr_n(1'b1),.sys_be_n(4'hf),
  .sys_ready_n(sys_ready_n),.vblank_evt(1'b0),.supervisor_raw_n(1'b1),.supervisor_n(supervisor_n),
  .ps2_kbd_clk(1'b1),.ps2_kbd_data(1'b1),.display_context(display_context),
  .pad_clk(pad_clk),.pad_cmd(pad_cmd),.pad_select_n(pad_select_n),.pad_data(pad_data),
  .rom_data(16'd0),.rom_address(rom_address),.rom_ce_n(rom_ce_n),.rom_oe_n(rom_oe_n));
 pad_accessory accessory(.clk(clk),.reset_n(reset_n),.pad_clk(pad_clk),
  .pad_select_n(pad_select_n[0]),.pad_command(pad_cmd[0]),.pad_data(accessory_data),
  .pad_data_oe(accessory_oe),.pad_words(224'd0),.pointer_words(128'd0),
  .request_accepted(accepted),.apply_accepted(),.last_apply_tag(),.requested_intensity(),
  .requested_duration_ms(),.motor_level_q16(),.remaining_ms(),.context_valid(context_valid),
  .display_width(seen_width),.display_height(seen_height),.display_epoch(seen_epoch));
 initial begin
  repeat(5) @(negedge clk); reset_n=1;
  wait(accepted && context_valid); @(negedge clk);
  if(seen_width!==320 || seen_height!==240 || seen_epoch!==32'h12345678)
   $fatal(1,"Initial context did not arrive intact at accessory");
  @(negedge pad_select_n[0]); repeat(100) @(negedge clk);
  width=640;height=480;epoch=32'h89abcdef;
  @(posedge accepted); @(negedge clk);
  if(!context_valid || seen_width!==320 || seen_height!==240 || seen_epoch!==32'h12345678)
   $fatal(1,"In-flight pad request was changed by later serial context");
  @(posedge accepted); @(negedge clk);
  if(!context_valid || seen_width!==640 || seen_height!==480 || seen_epoch!==32'h89abcdef)
   $fatal(1,"Subsequent pad request did not carry complete new context");
  $display("PASS U7 context pin to accessory: complete context and in-flight frame retention");
  $finish;
 end
 initial begin #10000000; $fatal(1,"context-to-pad timeout");end
endmodule
