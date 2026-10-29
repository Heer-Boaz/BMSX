`timescale 1ns/1ps
// Independent logical-memory model against the real multi-fence write owner.
// Multiple snapshots, repeated writes to the same addresses, cyclic pointer
// reuse and output stalls are deliberate. This is a word-service fixture,
// not an SRAM pin or real-time workload qualification.
module apu_upload_multisnapshot_stress_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg stage_valid=0,start_valid=0,epoch_begin=0,epoch_end=0,read_valid=0;
 reg [31:0] stage_word=0;reg [16:0] live_word_address=0,read_address=0;
 wire start_ready,batch_busy,publish_valid,epoch_active,snapshot_ready,snapshot_overflow,read_ready,read_rsp_valid;
 wire [4:0] snapshots_pending;wire [6:0] queued_words,epoch_words;
 wire [31:0] read_rsp_word,store_req_wdata;wire store_req_valid,store_req_write;
 wire [16:0] store_req_word_address;wire [3:0] store_req_be_n;
 reg [31:0] store_rsp_rdata=0;reg store_rsp_valid=0;
 integer cycle=0;wire store_req_ready=cycle%7!=0;
 reg [31:0] backing[0:15],logical[0:15],views[0:15][0:15];
 integer ref_head=0,ref_tail=0,ref_count=0,frames=0,writes=0,replacements=0;
 reg [31:0] rng=32'h91b4cc83;integer op,n,i,a;reg [31:0] value;
 apu_upload_commit dut(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),
  .stage_valid(stage_valid),.stage_index(4'd0),.stage_word(stage_word),.start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),
  .cancel(1'b0),.live_word_address(live_word_address),.batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(),.publish_base(),
  .commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),.epoch_begin(epoch_begin),.epoch_end(epoch_end),
  .epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(snapshots_pending),
  .queued_words(queued_words),.epoch_words(epoch_words),.read_valid(read_valid),.read_ready(read_ready),.read_word_address(read_address),
  .read_rsp_valid(read_rsp_valid),.read_rsp_word(read_rsp_word),.memory_ready(1'b1),
  .store_req_valid(store_req_valid),.store_req_ready(store_req_ready),.store_req_write(store_req_write),
  .store_req_word_address(store_req_word_address),.store_req_wdata(store_req_wdata),.store_req_be_n(store_req_be_n),
  .store_rsp_valid(store_rsp_valid),.store_rsp_rdata(store_rsp_rdata));
 always @(posedge clk) begin
  cycle<=cycle+1;store_rsp_valid<=reset_n&&store_req_valid&&store_req_ready;
  if(store_req_valid&&store_req_ready)begin
   if(store_req_word_address>15 || store_req_be_n!=0)$fatal(1,"unexpected backing word");
   if(store_req_write)backing[store_req_word_address]<=store_req_wdata;
   else store_rsp_rdata<=backing[store_req_word_address];
  end
 end
 task automatic step_rng;begin rng=rng^(rng<<13);rng=rng^(rng>>17);rng=rng^(rng<<5);end endtask
 task automatic snapshot;
  begin @(negedge clk);if(!snapshot_ready)$fatal(1,"snapshot not ready");
   for(integer k=0;k<16;k=k+1)views[ref_tail][k]=logical[k];
   epoch_begin=1;@(negedge clk);epoch_begin=0;ref_tail=(ref_tail+1)&15;ref_count=ref_count+1;frames=frames+1;
   if(snapshots_pending!==ref_count)$fatal(1,"snapshot count after capture");end
 endtask
 task automatic publish(input integer address,input [31:0] val);
  begin @(negedge clk);stage_word=val;live_word_address=address;stage_valid=1;
   @(negedge clk);stage_valid=0;if(!start_ready)$fatal(1,"unexpected write admission backpressure");start_valid=1;
   @(negedge clk);start_valid=0;while(!publish_valid)@(negedge clk);@(negedge clk);logical[address]=val;writes=writes+1;end
 endtask
 task automatic read_oldest;
  begin for(integer k=0;k<16;k=k+1)begin
   @(negedge clk);read_address=k;read_valid=1;#1;while(!read_ready)@(negedge clk);
   @(negedge clk);read_valid=0;while(!read_rsp_valid)@(negedge clk);
   if(read_rsp_word!==views[ref_head][k])$fatal(1,"frame %0d word %0d expected %h got %h",frames-ref_count,k,views[ref_head][k],read_rsp_word);
  end end
 endtask
 task automatic finish_oldest(input bit replace);
  begin read_oldest();@(negedge clk);epoch_end=1;
   if(replace)begin
    for(integer k=0;k<16;k=k+1)views[ref_tail][k]=logical[k];epoch_begin=1;replacements=replacements+1;
   end
   @(negedge clk);epoch_end=0;epoch_begin=0;ref_head=(ref_head+1)&15;ref_count=ref_count-1;
   if(replace)begin ref_tail=(ref_tail+1)&15;ref_count=ref_count+1;frames=frames+1;end
   if(snapshots_pending!==ref_count)$fatal(1,"snapshot count after finish");
  end
 endtask
 initial begin
  for(i=0;i<16;i=i+1)begin backing[i]=32'h10203040+i;logical[i]=backing[i];end
  repeat(2)@(negedge clk);reset_n=1;snapshot();
  // Enough operations to wrap both fence and write FIFO indices repeatedly.
  for(n=0;n<180;n=n+1)begin
   step_rng();a=rng&15;step_rng();value=rng;
   if(ref_count>=10 || queued_words>=48)finish_oldest((n&3)==0);
   publish(a,value);
   if(n%3==0 && ref_count<12)snapshot();
   if(n%7==0 && ref_count>3)finish_oldest((n&1)==0);
  end
  while(ref_count>0)finish_oldest(0);
  wait(queued_words==0 && !batch_busy);repeat(3)@(negedge clk);
  for(i=0;i<16;i=i+1)if(backing[i]!==logical[i])$fatal(1,"final physical word %0d",i);
  if(frames<32||writes!=180||replacements<5)$fatal(1,"insufficient stress");
  $display("PASS %0d frame views, %0d word publications, %0d simultaneous retire/captures, 16-address reference and cyclic FIFO reuse",frames,writes,replacements);$finish;
 end
 initial begin #10000000;$fatal(1,"timeout n=%0d refs=%0d frames=%0d writes=%0d queued=%0d state=%0d req=%b ready=%b response=%b batch=%b",n,ref_count,frames,writes,queued_words,dut.state,read_valid,read_ready,read_rsp_valid,batch_busy);end
endmodule
