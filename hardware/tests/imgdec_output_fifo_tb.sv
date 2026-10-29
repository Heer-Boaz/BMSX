`timescale 1ns/1ps
module imgdec_output_fifo_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,clear=0,push_valid=0,pop_ready=0;
 reg [4:0] push_count=1; reg [511:0] push_words=0;
 wire push_ready,pop_valid; wire [31:0] pop_word;wire [6:0] occupancy;
 imgdec_output_fifo dut(.*);
 reg [31:0] expected[0:200000];
 integer wr=0,rd=0,seq=0,cycles=0,observed_header_stalls=0;
 reg [31:0] rng=32'h4a39b70d;
 always @(posedge clk) begin
  if(reset_n && !clear) begin
   if(pop_valid && pop_ready) begin
    if(rd==wr || pop_word!==expected[rd])
     $fatal(1,"fifo word index %0d actual %h expected %h",rd,pop_word,expected[rd]);
    rd=rd+1;
   end
   if(push_valid && push_ready) begin
    for(integer i=0;i<push_count;i=i+1) begin expected[wr]=push_words[i*32+:32];wr=wr+1;end
   end
   if(push_valid && push_count==3 && !push_ready && occupancy>=62) observed_header_stalls=observed_header_stalls+1;
  end else begin wr=0;rd=0;end
 end
 task automatic step(input integer n,input reg write_en,input reg read_en);
  begin
   @(negedge clk);
   if(occupancy !== (wr-rd))$fatal(1,"occupancy %0d expected %0d",occupancy,wr-rd);
   push_count=n;push_valid=write_en;pop_ready=read_en;
   for(integer i=0;i<16;i=i+1) begin push_words[i*32+:32]=32'hbc000000+seq+i;end
   seq=seq+16;
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  // Fill exactly 64 and test rejection at 0, 1, 2 free places, then
  // acceptance with 3. A simultaneous pop must return the old front word.
  repeat(4)step(16,1,0);
  step(3,1,0);step(3,1,1);step(3,1,1);step(3,1,1);
  step(3,1,1);step(1,0,0);
  if(observed_header_stalls!=4)$fatal(1,"header stalls %0d",observed_header_stalls);
  // Individually admit and drain every batch width at successive ring offsets.
  while(occupancy!=0)step(1,0,1);
  step(1,0,0);
  for(integer n=1;n<=16;n=n+1) begin
   step(n,1,0);step(1,0,0);
   if(occupancy!=n)$fatal(1,"batch width %0d was not admitted",n);
   while(occupancy!=0)step(1,0,1);
   step(1,0,0);
  end
  // Exercise further ring wraps and simultaneous admissions and pops.
  for(integer t=0;t<10000;t=t+1) begin
   rng={rng[30:0],rng[31]^rng[21]^rng[1]^rng[0]};
   step(1+rng[3:0],rng[4],rng[5]);
  end
  while(occupancy!=0)step(1,0,1);
  step(1,0,0);
  if(wr!=rd)$fatal(1,"words left after drain");
  // Clearing a non-empty FIFO discards the queue, not the underlying RAM.
  step(4,1,0);step(1,0,0);clear=1;step(1,0,0);clear=0;
  if(occupancy!=0 || pop_valid)$fatal(1,"clear did not discard queue");
  $display("PASS IMGDEC output FIFO: 1..16-word atomic batches, header at 0/1/2/3 free, wrap, simultaneous push/pop, clear");
  $finish;
 end
 initial begin #2000000;$fatal(1,"FIFO test watchdog");end
endmodule
