`timescale 1ns/1ps
module apu_frame_scheduler_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,frame_valid=0;
 reg worker_start_ready=0,worker_slot_ready=0,worker_frame_valid=0,output_ready=0;
 reg [15:0] active_mask=0;
 wire frame_ready,frame_done,decoder_epoch_begin,worker_start_valid,worker_slot_valid,worker_slot_active,worker_frame_ready;
 wire [3:0] worker_slot_index;
 apu_frame_scheduler dut(.*);
 integer n,j,delay;reg [15:0] mask,lfsr=16'hace1;
 initial begin #2000000;$fatal(1,"timeout");end
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<128;n=n+1)begin
   // The all-inactive case uses exactly the same ordered 16-slot protocol.
   mask=n==0 ? 16'd0 : lfsr;lfsr={lfsr[14:0],lfsr[15]^lfsr[13]^lfsr[12]^lfsr[10]};
   @(negedge clk);active_mask=mask;frame_valid=1;worker_start_ready=0;
   #1;if(!worker_start_valid||frame_ready||decoder_epoch_begin||frame_done)$fatal(1,"stalled start");
   @(negedge clk);worker_start_ready=1;#1;
   if(!decoder_epoch_begin||!frame_ready||frame_done)$fatal(1,"start handshake");
   @(negedge clk);frame_valid=0;active_mask=~mask;worker_start_ready=0;
   for(j=0;j<16;j=j+1)begin
    if(!worker_slot_valid||worker_slot_index!=j||worker_slot_active!==mask[j])$fatal(1,"mask %h slot %0d",mask,j);
    delay=(n+j)%3;
    repeat(delay)begin @(negedge clk);if(!worker_slot_valid||worker_slot_index!=j||worker_slot_active!==mask[j])$fatal(1,"unstable slot");end
    worker_slot_ready=1;@(negedge clk);worker_slot_ready=0;
   end
   if(worker_slot_valid||frame_done||worker_frame_ready)$fatal(1,"premature frame completion");
   worker_frame_valid=1;
   repeat(3)begin @(negedge clk);if(frame_done||worker_frame_ready)$fatal(1,"stalled output completed");end
   output_ready=1;#1;if(!frame_done||!worker_frame_ready)$fatal(1,"frame output acceptance");
   @(negedge clk);worker_frame_valid=0;output_ready=0;
   if(frame_done)$fatal(1,"duplicate completion");
  end
  $display("PASS 128 masks including empty, all 16 ordered active/inactive slots, start/slot/output backpressure and epoch-before-retirement");$finish;
 end
endmodule
