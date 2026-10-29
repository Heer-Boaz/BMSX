`timescale 1ns/1ps
// Current Book I staging/capture contract, tested as a physical command owner.
// timeline_ready represents the still separate frame-synchronization owner.
module apu_command_ingress_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,access_valid=0,access_write=0,timeline_ready=1,command_consume=0;
 reg [4:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready,response_valid,fault_raise,command_valid;wire [31:0] response_data,fault_detail,command_word;
 wire [3:0] selected_slot;wire [4:0] queued_count;wire [671:0] command_parameters;
 apu_command_ingress dut(.*);
 integer i;
 initial begin #1000000;$fatal(1,"watchdog");end
 task automatic access(input bit wr,input [4:0] idx,input [31:0] word,expected);
  begin
   @(negedge clk);access_valid=1;access_write=wr;access_index=idx;access_wdata=word;
   do @(posedge clk);while(!access_ready);
   @(negedge clk);access_valid=0;access_write=0;
   if(!response_valid || (!wr && response_data!==expected)) $fatal(1,"access %0d response %b %h expected %h",idx,response_valid,response_data,expected);
  end
 endtask
 task automatic wr(input [4:0] idx,input [31:0] word);begin access(1,idx,word,0);end endtask
 task automatic rd(input [4:0] idx,input [31:0] word);begin access(0,idx,0,word);end endtask
 task automatic add(input [31:0] word);
  begin wr(0,word);wr(21,1);end
 endtask
 task automatic pop(input [31:0] source);
  begin
   @(negedge clk);
   if(!command_valid || command_word!==1 || command_parameters[31:0]!==source)
    $fatal(1,"pop expected %h command=%h source=%h count=%0d",source,command_word,command_parameters[31:0],queued_count);
   $display("ORACLE %08h",command_parameters[31:0]);
   command_consume=1;@(negedge clk);command_consume=0;
  end
 endtask
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  rd(3,0);rd(11,32'h10000);rd(12,32'h1000);rd(15,32'h4000);rd(20,32'h800);rd(21,0);
  if(queued_count!==0 || command_valid || selected_slot!==0)$fatal(1,"reset state");
  // Staging is independent; a CMD write waits for earlier audio edges.
  @(negedge clk);timeline_ready=0;
  wr(0,32'habcdef01);rd(0,32'habcdef01);
  @(negedge clk);access_valid=1;access_write=1;access_index=21;access_wdata=0;
  repeat(4) @(negedge clk);if(access_ready || response_valid || queued_count!=0)$fatal(1,"timeline gate");
  timeline_ready=1;@(negedge clk);access_valid=0;access_write=0;rd(0,32'habcdef01);
  wr(10,32'hf123456b);if(selected_slot!==11)$fatal(1,"selector lost low nibble");
  wr(21,0);rd(0,32'habcdef01);rd(10,32'hf123456b);if(queued_count!=0 || selected_slot!=11)$fatal(1,"NONE modified staging");
  // Every staging word is captured atomically, including raw SLOT bits.
  for(i=0;i<21;i=i+1) wr(i,32'ha0000000+i);
  wr(21,1);
  if(!command_valid || command_word!==1 || queued_count!==1 || selected_slot!==0)$fatal(1,"capture bookkeeping");
  for(i=0;i<21;i=i+1) if(command_parameters[i*32 +:32]!==32'ha0000000+i)$fatal(1,"snapshot index %0d",i);
  rd(3,0);rd(11,32'h10000);rd(12,32'h1000);rd(15,32'h4000);rd(20,32'h800);rd(21,0);
  wr(0,32'h777);if(command_parameters[31:0]!==32'ha0000000)$fatal(1,"snapshot mutated");
  pop(32'ha0000000);
  // Unsupported full raw command raises a pulse, clears stage, does not enqueue.
  wr(10,13);wr(21,32'h80000001);
  if(!fault_raise || fault_detail!==32'h80000001 || queued_count!==0 || selected_slot!==0)$fatal(1,"invalid command");
  rd(0,0);rd(11,32'h10000);
  // A full FIFO accepts another command and discards only its oldest entry.
  for(i=0;i<16;i=i+1) add(i);
  if(queued_count!==16)$fatal(1,"FIFO not full");
  add(16);if(queued_count!==16)$fatal(1,"overwrite changed FIFO count");
  for(i=1;i<=16;i=i+1) pop(i);
  if(command_valid || queued_count!==0)$fatal(1,"FIFO did not drain");
  // Simultaneous dequeue and enqueue from full yields old head first; no extra
  // overwrite and the arriving snapshot becomes the newest command.
  for(i=0;i<16;i=i+1) add(100+i);
  wr(0,200);
  @(negedge clk);if(!command_valid || command_parameters[31:0]!==100)$fatal(1,"concurrent initial head");
  $display("ORACLE %08h",command_parameters[31:0]);
  access_valid=1;access_write=1;access_index=21;access_wdata=1;command_consume=1;
  @(negedge clk);access_valid=0;access_write=0;command_consume=0;
  if(queued_count!==16)$fatal(1,"concurrent count");
  for(i=101;i<=115;i=i+1) pop(i);
  pop(200);if(command_valid || queued_count!==0)$fatal(1,"concurrent FIFO tail");
  // Reset discards staged and queued commands regardless of stored SRAM bits.
  add(333);wr(10,7);@(negedge clk);reset_n=0;@(negedge clk);reset_n=1;
  if(command_valid || queued_count!==0 || selected_slot!==0)$fatal(1,"reset replay");
  rd(0,0);rd(11,32'h10000);rd(12,32'h1000);
  $display("PASS APU raw 21-word command staging, synchronized admission, snapshot, full overwrite, simultaneous pop and reset");$finish;
 end
endmodule
