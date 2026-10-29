`timescale 1ns/1ps
// Real live slot bank, live-update owner and source router. Binder, decoder,
// timeline barrier and memory responders are controlled here, not full APU.
module apu_live_source_update_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg [3:0] selected_slot=4,fetch_slot=4;reg selected_cartridge=0;
 reg access_valid=0,access_write=0;reg [4:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready,response_valid;wire [31:0] response_data;
 reg install_valid=0,phase_valid=0;reg [3:0] install_slot=0,phase_slot=0;reg [2:0] phase_value=0;reg [671:0] install_parameters=0;reg install_cartridge=0;
 wire commit_ready,update_valid,update_ready;wire [3:0] update_slot;wire [4:0] update_index;
 wire [31:0] update_word;wire [671:0] update_parameters;
 wire [2:0] selected_phase;wire selected_active;wire [31:0] selected_source_address;wire [15:0] active_mask;
 wire rebind_valid,rebind_cartridge,fetch_active,fetch_cartridge;wire [3:0] rebind_slot;
 wire busy,bind_valid,bind_cartridge,bind_rsp_ready,action_valid,action_success,action_source_replace,action_cartridge,fault_valid;
 wire [671:0] bind_parameters,action_parameters;wire [3:0] action_slot;wire [4:0] action_index;wire [31:0] action_word,fault_code,fault_detail;
 reg bind_ready=0,bind_rsp_valid=0,bind_rsp_ok=0,playback_ready=0,fault_ready=0;
 wire fail_action=action_valid && !action_success;
 wire action_ready=playback_ready && (!fail_action || commit_ready);
 apu_slot_bank bank(.clk(clk),.reset_n(reset_n),.selected_slot(selected_slot),
  .access_valid(access_valid),.access_write(access_write),.access_index(access_index),.access_wdata(access_wdata),
  .timeline_ready(!busy),.access_ready(access_ready),.response_valid(response_valid),.response_data(response_data),
  .commit_valid(install_valid || phase_valid || fail_action && playback_ready),.commit_ready(commit_ready),
  .commit_action(install_valid ? 2'd0 : 2'd2),.commit_slot(install_valid ? install_slot : phase_valid ? phase_slot : action_slot),
  .commit_parameters(install_parameters),.commit_phase(phase_valid ? phase_value : 3'd0),.commit_index(5'd0),.commit_word(32'd0),.commit_cartridge(install_cartridge),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fetch_slot(fetch_slot),.fetch_active(fetch_active),.fetch_cartridge(fetch_cartridge),.event_slot(4'd0),.event_source_address(),
  .update_valid(update_valid),.update_ready(update_ready),.update_slot(update_slot),.update_index(update_index),
  .update_word(update_word),.update_parameters(update_parameters),.selected_phase(selected_phase),.selected_active(selected_active),
  .selected_source_address(selected_source_address),.active_mask(active_mask));
 apu_live_source_update live(.clk(clk),.reset_n(reset_n),.update_valid(update_valid),.update_ready(update_ready),
  .update_slot(update_slot),.update_index(update_index),.update_word(update_word),.update_parameters(update_parameters),
  .selected_cartridge(selected_cartridge),.busy(busy),.bind_valid(bind_valid),.bind_ready(bind_ready),
  .bind_parameters(bind_parameters),.bind_cartridge(bind_cartridge),.bind_rsp_valid(bind_rsp_valid),.bind_rsp_ready(bind_rsp_ready),.bind_rsp_ok(bind_rsp_ok),
  .action_valid(action_valid),.action_ready(action_ready),.action_success(action_success),.action_source_replace(action_source_replace),
  .action_slot(action_slot),.action_index(action_index),.action_word(action_word),.action_parameters(action_parameters),.action_cartridge(action_cartridge),
  .rebind_valid(rebind_valid),.rebind_slot(rebind_slot),.rebind_cartridge(rebind_cartridge),
  .fault_valid(fault_valid),.fault_ready(fault_ready),.fault_code(fault_code),.fault_detail(fault_detail));
 reg source_valid=0;wire source_ready,rom_valid,rom_rsp_ready,source_rsp;wire [7:0] rom_signals;
 reg rom_ready=0,rom_rsp_valid=0;wire [31:0] source_data;
 apu_source_word_router router(.clk(clk),.reset_n(reset_n),.req_valid(source_valid),.req_ready(source_ready),
  .req_local(1'b0),.req_local_word(17'd0),.req_rom_address(32'h10001234),.req_rom_signals({4'd0,fetch_cartridge,1'b1,2'b00}),
  .req_timeout_enable(1'b0),.req_wait_last(18'd0),.local_valid(),.local_ready(1'b0),.local_word(),.local_rsp_valid(1'b0),.local_rsp_data(32'd0),
  .rom_valid(rom_valid),.rom_ready(rom_ready),.rom_address(),.rom_signals(rom_signals),.rom_timeout_enable(),.rom_wait_last(),
  .rom_rsp_valid(rom_rsp_valid),.rom_rsp_ready(rom_rsp_ready),.rom_rsp_data(32'habcdef01),.rom_rsp_fault(32'd0),.rom_rsp_timeout(1'b0),
  .rsp_valid(source_rsp),.rsp_ready(1'b1),.rsp_data(source_data),.rsp_fault(),.rsp_timeout());
 task automatic install(input [3:0] slot,input bit cart);
  begin @(negedge clk);install_slot=slot;install_cartridge=cart;install_parameters=0;install_parameters[0+:32]=32'h10000000;
   install_parameters[32+:32]=32'd4096;install_valid=1;@(negedge clk);install_valid=0;end
 endtask
 task automatic write_word(input [4:0] idx,input [31:0] value,input bit cart);
  begin @(negedge clk);selected_cartridge=cart;access_index=idx;access_wdata=value;access_write=1;access_valid=1;#1;
   if(!access_ready || !update_valid || !update_ready)$fatal(1,"live write not accepted");
   @(negedge clk);access_valid=0;access_write=0;end
 endtask
 task automatic bind_result(input bit ok);
  begin wait(bind_valid);repeat(2)@(negedge clk);bind_ready=1;@(negedge clk);bind_ready=0;
   wait(bind_rsp_ready);@(negedge clk);bind_rsp_ok=ok;bind_rsp_valid=1;@(negedge clk);bind_rsp_valid=0;end
 endtask
 task automatic complete_action;
  begin wait(action_valid);repeat(2)@(negedge clk);playback_ready=1;@(negedge clk);playback_ready=0;end
 endtask
 initial begin
  repeat(2)@(negedge clk);reset_n=1;install(4,0);install(7,1);fetch_slot=4;#1;
  if(!fetch_active || fetch_cartridge!==0)$fatal(1,"initial socket");
  @(negedge clk);source_valid=1;@(negedge clk);source_valid=0;wait(rom_valid);#1;if(rom_signals!==8'h04)$fatal(1,"old request socket");
  write_word(0,32'h10001000,1);selected_cartridge=0;
  if(!busy || !bind_valid || bind_cartridge!==1 || bind_parameters[0+:32]!==32'h10001000 || fetch_cartridge!==0)$fatal(1,"pending live binding");
  @(negedge clk);access_valid=1;access_write=1;access_index=12;access_wdata=0;#1;
  if(access_ready)$fatal(1,"timeline admitted a write while bind pending");
  @(negedge clk);access_valid=0;access_write=0;
  bind_result(1);wait(action_valid);#1;
  if(!action_success || !action_source_replace || action_cartridge!==1 || fetch_cartridge!==0 || rom_signals!==8'h04)$fatal(1,"premature replacement");
  complete_action();#1;if(fetch_cartridge!==1 || rom_signals!==8'h04)$fatal(1,"socket not retained at request");
  rom_ready=1;@(negedge clk);rom_ready=0;rom_rsp_valid=1;@(negedge clk);rom_rsp_valid=0;wait(source_rsp);@(negedge clk);
  source_valid=1;@(negedge clk);source_valid=0;wait(rom_valid);#1;if(rom_signals!==8'h0c)$fatal(1,"new request socket");
  rom_ready=1;@(negedge clk);rom_ready=0;rom_rsp_valid=1;@(negedge clk);rom_rsp_valid=0;wait(source_rsp);@(negedge clk);
  // A non-source update changes the register but cannot rebind the socket.
  write_word(12,32'h11111111,0);wait(action_valid);#1;if(action_source_replace || bind_valid)$fatal(1,"gain caused source bind");
  complete_action();#1;if(fetch_cartridge!==1)$fatal(1,"gain changed bound socket");
  // Generator replacement needs no memory bind, but it is still a live
  // source update and publishes the captured socket on accepted playback.
  write_word(19,1,0);wait(action_valid);#1;
  if(!action_source_replace || !action_success || bind_valid || fetch_cartridge!==1)$fatal(1,"generator update");
  complete_action();#1;if(fetch_cartridge!==0)$fatal(1,"generator socket not captured");
  write_word(19,0,1);wait(bind_valid);@(negedge clk);bind_ready=1;bind_rsp_valid=1;bind_rsp_ok=1;#1;
  if(!bind_rsp_ready)$fatal(1,"immediate binder response not accepted");
  @(negedge clk);bind_ready=0;bind_rsp_valid=0;wait(action_valid);complete_action();
  #1;if(fetch_cartridge!==1)$fatal(1,"return from generator lost socket");
  // A failed live bind leaves the new raw address in the bank and deactivates
  // the voice before SOURCE_RANGE; socket remains the last successful one.
  write_word(0,32'h10002000,0);bind_result(0);wait(action_valid);#1;
  if(action_success || fetch_cartridge!==1 || !fetch_active)$fatal(1,"failed bind changed early state");
  complete_action();wait(fault_valid);#1;
  if(fault_code!==32'h102 || fault_detail!==32'h10002000 || fetch_active || fetch_cartridge!==1)$fatal(1,"failed live action");
  @(negedge clk);fault_ready=1;@(negedge clk);fault_ready=0;wait(!busy);
  @(negedge clk);access_valid=1;access_write=0;access_index=0;@(negedge clk);
  if(!response_valid || response_data!==32'h10002000)$fatal(1,"failed live raw word not retained");access_valid=0;
  fetch_slot=7;#1;if(!fetch_active || fetch_cartridge!==1)$fatal(1,"other slot changed");
  // A paused slot remains active and must accept live source writes. Its
  // phase and old binding remain stable until playback accepts the rebind.
  @(negedge clk);phase_slot=7;phase_value=3'd5;phase_valid=1;@(negedge clk);phase_valid=0;selected_slot=7;
  #1;if(selected_phase!==5 || !fetch_active)$fatal(1,"paused slot lost active status");
  write_word(0,32'h10003000,0);
  if(!bind_valid || bind_cartridge!==0 || fetch_cartridge!==1 || selected_phase!==5)$fatal(1,"paused bind did not retain previous source");
  bind_result(1);wait(action_valid);#1;
  if(!action_source_replace || !action_success || selected_phase!==5 || fetch_cartridge!==1)$fatal(1,"paused bind changed state early");
  complete_action();#1;if(fetch_cartridge!==0 || selected_phase!==5 || !fetch_active)$fatal(1,"paused binding or phase lost");
  $display("PASS live source update: raw-word-first binding, socket capture, in-flight request, paused source rebind, non-source write and failed-rebind deactivation");$finish;
 end
 initial begin #100000;$fatal(1,"watchdog");end
endmodule
