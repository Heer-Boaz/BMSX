`timescale 1ns/1ps
// Exercises the real command FIFO and raw slot bank with a controlled source
// binder and a controlled playback acceptance boundary. Those test owners do
// not establish that physical ROM binding or playback is implemented.
module apu_command_executor_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,service_ready=0,access_valid=0,access_write=0;
 reg [4:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready,ingress_rsp;wire [31:0] ingress_data;
 wire fault_raise;wire [31:0] fault_detail_unused;
 wire [3:0] ingress_selection;wire [4:0] count;
 wire command_valid,command_consume;wire [31:0] command_word;
 wire [671:0] command_parameters;
 apu_command_ingress ingress(.clk(clk),.reset_n(reset_n),.access_valid(access_valid),
  .access_write(access_write),.access_index(access_index),.access_wdata(access_wdata),
  .timeline_ready(1'b1),.access_ready(access_ready),.response_valid(ingress_rsp),
  .response_data(ingress_data),.fault_raise(fault_raise),.fault_detail(fault_detail_unused),
  .selected_slot(ingress_selection),.queued_count(count),.command_valid(command_valid),
  .command_consume(command_consume),.command_word(command_word),.command_parameters(command_parameters));
 reg selected_cartridge=0,bind_ready=0,bind_rsp_valid=0,bind_rsp_ok=0;
 wire busy,reservation_valid,bind_valid,bind_rsp_ready;wire [3:0] query_slot;
 wire [671:0] bind_parameters;wire bind_cartridge;
 wire action_valid,action_ready;reg playback_ready=0;
 wire [1:0] action_bank_op;wire [31:0] action_command,action_word;
 wire [3:0] action_slot;wire [671:0] action_parameters;
 wire [2:0] action_phase;wire [4:0] action_index;wire action_cartridge;
 wire fault_valid;reg fault_ready=0;wire [31:0] fault_code,fault_detail;
 wire commit_ready;wire [2:0] selected_phase;wire selected_active;
 wire [15:0] active_mask;wire [31:0] selected_source_address;
 wire selected_update;wire [3:0] selected_update_slot;wire [4:0] selected_update_index;
 wire [31:0] selected_update_word;wire [671:0] selected_update_parameters;
 reg update_ready=1,rebind_valid=0,rebind_cartridge=0;reg [3:0] rebind_slot=0,fetch_slot=0;
 wire fetch_active,fetch_cartridge;
 reg [3:0] inspection_slot=0;
 wire [3:0] bank_selection=reservation_valid ? query_slot : inspection_slot;
 reg bank_access_valid=0,bank_access_write=0;reg [4:0] bank_access_index=0;reg [31:0] bank_access_wdata=0;
 wire bank_access_ready,bank_rsp;wire [31:0] bank_data;
 apu_command_executor dut(.clk(clk),.reset_n(reset_n),.service_ready(service_ready),
  .command_valid(command_valid),.command_consume(command_consume),.command_word(command_word),
  .command_parameters(command_parameters),.selected_cartridge(selected_cartridge),.busy(busy),.reservation_valid(reservation_valid),
  .query_slot(query_slot),.slot_phase(selected_phase),.bind_valid(bind_valid),.bind_ready(bind_ready),
  .bind_parameters(bind_parameters),.bind_cartridge(bind_cartridge),.bind_rsp_valid(bind_rsp_valid),
  .bind_rsp_ready(bind_rsp_ready),.bind_rsp_ok(bind_rsp_ok),.action_valid(action_valid),
  .action_ready(action_ready),.action_bank_op(action_bank_op),.action_command(action_command),
  .action_slot(action_slot),.action_parameters(action_parameters),.action_phase(action_phase),
  .action_index(action_index),.action_word(action_word),.action_cartridge(action_cartridge),
  .fault_valid(fault_valid),.fault_ready(fault_ready),.fault_code(fault_code),.fault_detail(fault_detail));
 assign action_ready=commit_ready && playback_ready;
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(bank_selection),
  .access_valid(bank_access_valid),.access_write(bank_access_write),.access_index(bank_access_index),
  .access_wdata(bank_access_wdata),.timeline_ready(!reservation_valid),.access_ready(bank_access_ready),
  .response_valid(bank_rsp),.response_data(bank_data),.commit_valid(action_valid && playback_ready),
  .commit_ready(commit_ready),.commit_action(action_bank_op),.commit_slot(action_slot),
  .commit_parameters(action_parameters),.commit_phase(action_phase),.commit_index(action_index),
  .commit_word(action_word),.commit_cartridge(action_cartridge),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fetch_slot(fetch_slot),.fetch_active(fetch_active),.fetch_cartridge(fetch_cartridge),.event_slot(4'd0),.event_source_address(),
  .update_valid(selected_update),.update_ready(update_ready),
  .update_slot(selected_update_slot),.update_index(selected_update_index),.update_word(selected_update_word),
  .update_parameters(selected_update_parameters),.selected_phase(selected_phase),.selected_active(selected_active),
  .selected_source_address(selected_source_address),.active_mask(active_mask));
 task automatic write_reg(input [4:0] idx,input [31:0] val);
  begin @(negedge clk);access_valid=1;access_write=1;access_index=idx;access_wdata=val;
   @(negedge clk);if(!ingress_rsp)$fatal(1,"ingress did not accept");access_valid=0;access_write=0;end
 endtask
 task automatic send_cmd(input [31:0] cmd,input [31:0] slot,input [31:0] generator,input [31:0] arg);
  begin write_reg(10,slot);write_reg(19,generator);
   if(cmd==2) write_reg(18,arg); else if(cmd==3) write_reg(12,arg); else if(cmd==1) write_reg(0,arg);
   write_reg(21,cmd);end
 endtask
 task automatic finish_action(input [31:0] cmd,input [3:0] slot,input [1:0] op,input [2:0] phase);
  begin wait(action_valid);#1;
   if(action_command!==cmd || action_slot!==slot || action_bank_op!==op || action_phase!==phase)
    $fatal(1,"action mismatch cmd=%d slot=%d op=%d phase=%d",action_command,action_slot,action_bank_op,action_phase);
   repeat(3) begin @(negedge clk);if(!action_valid || action_command!==cmd || action_slot!==slot)$fatal(1,"action not held");end
   playback_ready=1;@(negedge clk);playback_ready=0;
   wait(!busy);
  end
 endtask
 task automatic check_bank(input [3:0] slot,input [4:0] idx,input [31:0] expected);
  begin @(negedge clk);inspection_slot=slot;bank_access_valid=1;bank_access_index=idx;
   @(negedge clk);if(!bank_rsp || bank_data!==expected)$fatal(1,"bank slot=%d idx=%d got=%h expected=%h",slot,idx,bank_data,expected);
   bank_access_valid=0;end
 endtask
 integer i;
`ifdef DEBUG
 always @(dut.state) $display("%t state=%d cmd=%d queued=%d",$time,dut.state,command_word,count);
`endif
 initial begin
  repeat(2) @(negedge clk);reset_n=1;
  send_cmd(1,3,1,32'h12345678);if(count!==1)$fatal(1,"no queued command");
  // A live-window write attempting the admission edge must not pass the new
  // command; the reservation identifies the incoming slot before busy rises.
  @(negedge clk);inspection_slot=7;bank_access_valid=1;bank_access_write=1;
  bank_access_index=0;bank_access_wdata=32'hfeed1234;service_ready=1;#1;
  if(!command_consume || !reservation_valid || query_slot!==3 || bank_access_ready)
   $fatal(1,"admission edge not reserved");
  @(negedge clk);bank_access_valid=0;bank_access_write=0;
  finish_action(1,3,0,1);check_bank(7,0,0);
  inspection_slot=3;#1;if(!selected_active || selected_phase!==1)$fatal(1,"generator PLAY failed");
  fetch_slot=3;#1;if(!fetch_active || fetch_cartridge!==0)$fatal(1,"generator socket not installed");
  check_bank(3,0,32'h12345678);
  // PLAY captures socket at execution, binder stalls, then rejects. Neither the
  // previous bank nor the playing phase may change; fault is held for owner.
  selected_cartridge=1;send_cmd(1,3,0,32'h00002100);wait(bind_valid);#1;
  if(bind_parameters[0+:32]!==32'h00002100 || bind_cartridge!==1)$fatal(1,"binding capture");
  selected_cartridge=0;repeat(2) @(negedge clk);
  if(!bind_valid || bind_cartridge!==1)$fatal(1,"binding request not retained");
  bind_ready=1;@(negedge clk);bind_ready=0;wait(bind_rsp_ready);@(negedge clk);bind_rsp_ok=0;bind_rsp_valid=1;
  @(negedge clk);bind_rsp_valid=0;wait(fault_valid);#1;
  if(fault_code!==32'h102 || fault_detail!==32'h2100 || action_valid)$fatal(1,"bad failed PLAY");
  repeat(2) @(negedge clk);if(!fault_valid)$fatal(1,"fault lost under stall");fault_ready=1;
  @(negedge clk);fault_ready=0;wait(!busy);
  inspection_slot=3;#1;if(selected_phase!==1)$fatal(1,"failed PLAY changed phase");
  fetch_slot=3;#1;if(fetch_cartridge!==0)$fatal(1,"failed PLAY changed original socket");
  check_bank(3,0,32'h12345678);
  // Successful external binding commits the captured source and cartridge,
  // even if the system selection changes before the physical owner responds.
  selected_cartridge=1;send_cmd(1,4,0,32'h40001000);wait(bind_valid);#1;
  if(bind_cartridge!==1 || bind_parameters[0+:32]!==32'h40001000)$fatal(1,"valid bind request");
  @(negedge clk);bind_ready=1;@(negedge clk);bind_ready=0;selected_cartridge=0;
  wait(bind_rsp_ready);@(negedge clk);bind_rsp_ok=1;bind_rsp_valid=1;
  @(negedge clk);bind_rsp_valid=0;wait(action_valid);#1;
  if(action_cartridge!==1)$fatal(1,"bound cartridge selection lost");
  finish_action(1,4,0,1);check_bank(4,0,32'h40001000);
  fetch_slot=4;#1;if(!fetch_active || fetch_cartridge!==1)$fatal(1,"committed PLAY socket lost");
  // A binder can produce a valid result on the same edge it accepts the
  // request. Both request and response handshakes must happen together.
  selected_cartridge=1;send_cmd(1,6,0,32'h40002000);wait(bind_valid);
  @(negedge clk);bind_ready=1;bind_rsp_valid=1;bind_rsp_ok=1;#1;
  if(!bind_rsp_ready)$fatal(1,"immediate PLAY binder response not accepted");
  @(negedge clk);bind_ready=0;bind_rsp_valid=0;selected_cartridge=0;
  finish_action(1,6,0,1);fetch_slot=6;#1;
  if(!fetch_active || fetch_cartridge!==1)$fatal(1,"immediate bind socket not committed");
  // An immediate failed bind is a failed PLAY, not a live-source write: the
  // old voice, raw words and bound socket all remain unchanged while the
  // first-fault consumer stalls.
  selected_cartridge=1;send_cmd(1,3,0,32'h40003000);wait(bind_valid);
  @(negedge clk);bind_ready=1;bind_rsp_valid=1;bind_rsp_ok=0;#1;
  if(!bind_rsp_ready)$fatal(1,"immediate failed PLAY response not accepted");
  @(negedge clk);bind_ready=0;bind_rsp_valid=0;selected_cartridge=0;
  wait(fault_valid);fetch_slot=3;#1;
  if(action_valid || fault_code!==32'h102 || fault_detail!==32'h40003000 ||
     !fetch_active || fetch_cartridge!==0)$fatal(1,"immediate failed PLAY changed old voice");
  repeat(2)begin @(negedge clk);if(!fault_valid || action_valid)$fatal(1,"immediate PLAY fault not held");end
  fault_ready=1;@(negedge clk);fault_ready=0;wait(!busy);check_bank(3,0,32'h12345678);
  // Inactive PAUSE and RESUME have no slot action.
  send_cmd(4,5,0,0);wait(busy);wait(!busy);if(active_mask[5])$fatal(1,"pause activated idle slot");
  send_cmd(5,5,0,0);wait(busy);wait(!busy);if(active_mask[5])$fatal(1,"resume activated idle slot");
  send_cmd(2,3,0,7);finish_action(2,3,2,2);
  send_cmd(4,3,0,0);finish_action(4,3,2,6);
  send_cmd(5,3,0,0);finish_action(5,3,2,2);
  send_cmd(3,3,0,32'hffff8001);finish_action(3,3,3,2);check_bank(3,12,32'hffff8001);
  send_cmd(2,3,0,0);finish_action(2,3,1,0);check_bank(3,0,0);
  // Fill and overwrite: 17 commands in a sixteen-entry FIFO leave slot 1 at
  // the head. Once consumed, that snapshot survives subsequent full overwrite.
  service_ready=0;
  for(i=0;i<17;i=i+1)send_cmd(1,i,1,32'h10000000+i);
  if(count!==16 || command_parameters[10*32+:4]!==1)$fatal(1,"FIFO overwrite order");
  service_ready=1;wait(action_valid);#1;
  if(action_slot!==1 || action_parameters[0+:32]!==32'h10000001)$fatal(1,"oldest snapshot");
  service_ready=0;send_cmd(1,1,1,32'hdead0001);send_cmd(1,2,1,32'hdead0002);
  if(count!==16 || action_slot!==1 || action_parameters[0+:32]!==32'h10000001)$fatal(1,"in-flight snapshot overwritten");
  playback_ready=1;@(negedge clk);playback_ready=0;wait(!busy);
  check_bank(1,0,32'h10000001);
  $display("PASS real ingress, executor and slot bank: FIFO overwrite/snapshot, bind failure, pause/resume, fade, gain and stalls; external binder/playback");$finish;
 end
 initial begin #2000000;$fatal(1,"timeout");end
endmodule
