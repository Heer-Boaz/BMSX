`timescale 1ns/1ps
// Actual current-format live slot register owner: all raw words, active/paused
// phases, selected window, transactional PLAY commit and rebinding request.
// Source binder, player and timeline are boundary stimuli, not substitutes for
// their complete implementations.
module apu_slot_bank_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0;reg [3:0] selected_slot=0;
 reg access_valid=0,access_write=0,timeline_ready=1;
 reg [4:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready,response_valid;wire [31:0] response_data;
 reg commit_valid=0;wire commit_ready;reg [1:0] commit_action=0;
 reg [3:0] commit_slot=0;reg [671:0] commit_parameters=0;
 reg [2:0] commit_phase=0;reg [4:0] commit_index=0;reg [31:0] commit_word=0;
 reg commit_cartridge=0,rebind_valid=0,rebind_cartridge=0;reg [3:0] rebind_slot=0,fetch_slot=0;
 wire fetch_active,fetch_cartridge;wire [671:0] fetch_parameters;wire [15:0] render_mask;
 wire update_valid;reg update_ready=1;wire [3:0] update_slot;wire [4:0] update_index;
 wire [31:0] update_word;wire [671:0] update_parameters;
 wire [2:0] selected_phase;wire selected_active;wire [31:0] selected_source_address;wire [15:0] active_mask;
 wire [3:0] event_slot=0;wire [31:0] event_source_address;
 apu_slot_bank dut(.*);
 integer s,i;
 initial begin #1000000;$fatal(1,"watchdog");end
 task automatic access(input bit writing,input [3:0] slot,input [4:0] idx,input [31:0] data,expected);
  begin
   @(negedge clk);selected_slot=slot;access_valid=1;access_write=writing;access_index=idx;access_wdata=data;
   do @(posedge clk);while(!access_ready);
   @(negedge clk);access_valid=0;access_write=0;
   if(!response_valid || (!writing && response_data!==expected))
    $fatal(1,"slot=%0d index=%0d read=%h expected=%h",slot,idx,response_data,expected);
  end
 endtask
 task automatic commit(input [1:0] op,input [3:0] slot,input [2:0] phase,input [4:0] idx,input [31:0] word,input [671:0] data);
  begin
   @(negedge clk);commit_valid=1;commit_action=op;commit_slot=slot;commit_phase=phase;commit_index=idx;commit_word=word;commit_parameters=data;
   do @(posedge clk);while(!commit_ready);
   @(negedge clk);commit_valid=0;
  end
 endtask
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  for(s=0;s<16;s=s+1) begin
   selected_slot=s;
   if(selected_active!==0 || selected_source_address!==0 || selected_phase!==0) $fatal(1,"reset slot %0d",s);
   for(i=0;i<21;i=i+1) access(0,s,i,0,0);
  end
  // Inactive writes retain all raw bits without creating an update event or
  // activating the slot. SLOT in the selected bank is ordinary data.
  selected_slot=5;update_ready=0;
  access(1,5,0,32'hdeadcafe,0);access(1,5,10,32'hf123456e,0);
  if(selected_active || selected_source_address!==0 || update_valid)$fatal(1,"inactive write side effect");
  access(0,5,0,0,32'hdeadcafe);access(0,5,10,0,32'hf123456e);update_ready=1;
  // A validated PLAY installs all 21 words on one edge; all 16 slots remain
  // distinct, including every high/low raw bit of each word.
  for(s=0;s<16;s=s+1) begin
   for(i=0;i<21;i=i+1) commit_parameters[i*32 +:32]=32'h80000000 | (s<<8) | i;
   commit(0,s,0,0,0,commit_parameters);
  end
  if(active_mask!==16'hffff || render_mask!==16'hffff)$fatal(1,"active/render masks after installs %h %h",active_mask,render_mask);
  for(s=0;s<16;s=s+1) begin
   selected_slot=s;fetch_slot=s;#1;
   if(!selected_active || selected_phase!==1 || selected_source_address!==(32'h80000000 | (s<<8))) $fatal(1,"slot source/phase %0d",s);
   for(i=0;i<21;i=i+1) begin
    if(fetch_parameters[i*32+:32]!==(32'h80000000 | (s<<8) | i))$fatal(1,"fetch slot %0d word %0d",s,i);
    access(0,s,i,0,32'h80000000 | (s<<8) | i);
    $display("ORACLE %08h",response_data);
   end
  end
  // A pending active selected write cannot modify the bank before both the
  // audio timeline and playback owner are ready. The event exposes the whole
  // postwrite snapshot, not the preceding bank.
  @(negedge clk);selected_slot=7;access_valid=1;access_write=1;access_index=3;access_wdata=32'hffffffff;timeline_ready=0;update_ready=0;
  repeat(2) @(negedge clk);if(access_ready || update_valid)$fatal(1,"timeline gating");
  timeline_ready=1;#1;
  if(access_ready || !update_valid || update_slot!==7 || update_index!==3 || update_word!==32'hffffffff ||
     update_parameters[3*32 +:32]!==32'hffffffff || update_parameters[0+:32]!==32'h80000700)
   $fatal(1,"live write snapshot or backpressure");
  repeat(2) @(negedge clk);if(access_ready)$fatal(1,"accepted while update blocked");
  update_ready=1;@(negedge clk);if(!response_valid)$fatal(1,"live response absent");access_valid=0;access_write=0;
  access(0,7,3,0,32'hffffffff);
  // Committed SET_SLOT_GAIN updates an active bank and waits for its live
  // playback owner; selected accesses cannot pass a pending commit.
  @(negedge clk);commit_valid=1;commit_action=3;commit_slot=7;commit_index=12;commit_word=32'h80000000;update_ready=0;
  selected_slot=6;access_valid=1;access_write=0;access_index=0;#1;
  if(commit_ready || access_ready || !update_valid || update_slot!==7 || update_index!==12 || update_parameters[12*32+:32]!==32'h80000000)
   $fatal(1,"commit arbitration or event");
  repeat(2) @(negedge clk);update_ready=1;@(negedge clk);commit_valid=0;
  do @(posedge clk);while(!access_ready);@(negedge clk);access_valid=0;
  if(!response_valid || response_data!==32'h80000600)$fatal(1,"selected access after commit");
  access(0,7,12,0,32'h80000000);
  // Paused/fading retain their words and remain active; failed live source
  // binding selects IDLE without clearing the already written raw bank.
  commit(2,7,5,0,0,0);selected_slot=7;#1;
  if(selected_phase!==5 || !selected_active || active_mask[7]!==1 || render_mask[7]!==0)$fatal(1,"pause active/render semantics");
  commit(2,7,6,0,0,0);if(selected_phase!==6 || !selected_active || render_mask[7]!==0)$fatal(1,"paused fade render semantics");
  commit(2,7,2,0,0,0);if(selected_phase!==2 || !selected_active || render_mask[7]!==1)$fatal(1,"fading render semantics");
  commit(2,7,0,0,0,0);if(selected_phase!==0 || selected_active || selected_source_address!==0 || render_mask[7]!==0)$fatal(1,"deactivate semantics");
  access(0,7,3,0,32'hffffffff);access(0,7,12,0,32'h80000000);
  commit(1,7,0,0,0,0);for(i=0;i<21;i=i+1)access(0,7,i,0,0);
  if(active_mask!==16'hff7f)$fatal(1,"clear mask %h",active_mask);
  // A true hardware reset clears every retained word and activity bit.
  @(negedge clk);reset_n=0;@(negedge clk);reset_n=1;
  if(active_mask!==0)$fatal(1,"reset mask");
  for(s=0;s<16;s=s+1) for(i=0;i<21;i=i+1) access(0,s,i,0,0);
  $display("PASS APU 16x21 raw slot banks, atomic install, active masks, selected writes, timeline and playback handshake");$finish;
 end
endmodule
