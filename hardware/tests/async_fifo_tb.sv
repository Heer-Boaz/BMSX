`timescale 1ns/1ps
// Separate 54/13.5 MHz clock domains with deliberately offset phases. This
// exercises actual pointer/handshake logic; it is not metastability or STA.
module async_fifo_tb;
 reg w_clk=0,r_clk=0,reset_n=0,w_valid=0,r_ready=0;reg [63:0] w_data=0;
 wire w_ready,r_valid;wire [63:0] r_data;
 always #9.259259 w_clk=~w_clk;
 initial begin #7;forever #37.037037 r_clk=~r_clk;end
 async_fifo #(.WIDTH(64),.ADDR_BITS(4)) dut(.reset_n(reset_n),.w_clk(w_clk),.w_valid(w_valid),.w_ready(w_ready),.w_data(w_data),.r_clk(r_clk),.r_valid(r_valid),.r_ready(r_ready),.r_data(r_data));
 integer full_stalls=0,read_stalls=0,wr=0,rd=0;reg [63:0] saved;
 always @(posedge w_clk) if(reset_n && w_valid && !w_ready)full_stalls=full_stalls+1;
 always @(posedge r_clk) if(reset_n && r_valid && !r_ready)read_stalls=read_stalls+1;
 task automatic producer(input integer count);
  integer i;begin for(i=0;i<count;i=i+1) begin
   @(negedge w_clk);w_valid=1;w_data={32'(i),~32'(i)};
   while(!w_ready)@(negedge w_clk);
   @(negedge w_clk);w_valid=0;wr=wr+1;
   if(i%7==0)repeat(2)@(negedge w_clk);
  end end
 endtask
 task automatic consumer(input integer count,input integer initial_delay);
  integer i,k;begin repeat(initial_delay)@(negedge r_clk);
   for(i=0;i<count;i=i+1) begin
    @(negedge r_clk);while(!r_valid)@(negedge r_clk);
    saved=r_data;if(saved!=={32'(i),~32'(i)})$fatal(1,"sample %0d expected %h got %h",i,{32'(i),~32'(i)},saved);
    for(k=0;k<(i%3);k=k+1)begin @(negedge r_clk);if(!r_valid||r_data!==saved)$fatal(1,"held sample %0d",i);end
    r_ready=1;@(negedge r_clk);r_ready=0;rd=rd+1;
   end
  end
 endtask
 integer i;
 initial begin
  repeat(3)@(negedge w_clk);reset_n=1;
  fork producer(1024);consumer(1024,20);join
  if(wr!=1024||rd!=1024||full_stalls==0||read_stalls==0)$fatal(1,"coverage wr=%0d rd=%0d full=%0d stall=%0d",wr,rd,full_stalls,read_stalls);
  // Insert old words without a consumer, then assert the common reset; they
  // must not be published as entries of the new epoch.
  for(i=0;i<8;i=i+1)begin @(negedge w_clk);w_data={32'hdeadbeef,32'(i)};w_valid=1;
   while(!w_ready)@(negedge w_clk);@(negedge w_clk);w_valid=0;end
  repeat(4)@(negedge r_clk);if(!r_valid)$fatal(1,"pre-reset data absent");
  reset_n=0;repeat(3)@(negedge w_clk);reset_n=1;repeat(6)@(negedge r_clk);
  if(r_valid)$fatal(1,"old entry survived common reset");wr=0;rd=0;
  fork producer(512);consumer(512,4);join
  if(wr!=512||rd!=512)$fatal(1,"reset epoch counts");
  $display("PASS dual-clock FIFO: 1536 ordered 64-bit words, wrap/full/empty, response stalls and common reset, ideal 54/13.5-MHz clocks; write stalls=%0d read stalls=%0d",full_stalls,read_stalls);$finish;
 end
 initial begin #10000000;$fatal(1,"timeout");end
endmodule
