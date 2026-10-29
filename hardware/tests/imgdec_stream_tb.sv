`timescale 1ns/1ps
// Existing TS/C++ IMGDEC owners provide the reference packet. The chosen
// texture endpoint falls within a repeat run; the rest continues after CLUT.
module imgdec_stream_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,stream_start=0,permit=1;
 reg [31:0] texture_destination=32'hfedc1234,texture_size=32'h12345678,clut_destination=32'h8080abcd;
 reg input_valid=0,input_exhausted=0;reg [31:0] input_word=0;
 wire input_ready,header_valid,word_valid,production_complete,format_fault;
 wire [31:0] header_word0,header_word1,header_word2,word_data,decoded_words,expected_output_words;
 reg header_ready=0,word_ready=0,output_has_space=0,force_full=0,force_no_word_grant=0;
 reg [31:0] input_words[0:11],gold[0:63];
 integer received=0,gold_count=0,cycle=0,f,rc;
 wire [31:0] payload_run_remaining,payload_stage_remaining; wire payload_literal;
 imgdec_stream dut(.*);
 task automatic verify(input [31:0] actual);
  begin
   if(received>=gold_count || actual!==gold[received])
    $fatal(1,"word %0d got=%h expected=%h",received,actual,gold[received]);
   received=received+1;
  end
 endtask
 always @(posedge clk) if(reset_n) begin
  if(header_valid && header_ready)begin
   verify(header_word0);verify(header_word1);verify(header_word2);
  end
  if(word_valid && word_ready)verify(word_data);
  if(header_valid && word_valid)$fatal(1,"header and payload simultaneously admitted");
 end
 always @(negedge clk) begin
  cycle=cycle+1;
  output_has_space=!force_full && (cycle%5)!=0;
  word_ready=output_has_space && !force_no_word_grant;
  header_ready=output_has_space && (cycle%7)!=0;
 end
 task automatic send(input [31:0] value);
  begin
   @(negedge clk);input_word=value;input_valid=1;
   @(posedge clk);while(!input_ready)@(posedge clk);
   @(negedge clk);input_valid=0;
  end
 endtask
 task automatic restart;
  begin
   @(negedge clk);stream_start=1;input_valid=0;input_exhausted=0;force_full=0;force_no_word_grant=0;
   @(negedge clk);stream_start=0;received=0;
  end
 endtask
 initial begin
  $readmemh("tests/imgdec_payload_vectors.hex",input_words);
  f=$fopen("build/tests/imgdec_stream_reference_ts.txt","r");if(!f)$fatal(1,"missing TS owner packet");
  for(integer n=0;n<29;n=n+1)begin rc=$fscanf(f,"%h",gold[n]);if(rc!=1)$fatal(1,"oracle word %0d",n);end
  if($fscanf(f,"%h",input_word)==1)$fatal(1,"too many oracle words");$fclose(f);
  gold_count=29;
  repeat(3)@(negedge clk);reset_n=1;input_valid=1;input_word=32'hffffffff;
  repeat(3)@(negedge clk);if(input_ready || format_fault)$fatal(1,"input consumed before start");
  input_valid=0;restart();
  send(32'h31444d49);send(3);send(20);
  for(integer n=0;n<12;n=n+1)send(input_words[n]);
  @(negedge clk);input_exhausted=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || received!=29 || decoded_words!=23 || expected_output_words!=29)
   $fatal(1,"cross-stage packet incomplete: received=%0d decoded=%0d",received,decoded_words);
  // Empty image still emits a texture upload header.
  restart();gold_count=3;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  send(32'h31444d49);send(0);send(0);@(negedge clk);input_exhausted=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || received!=3 || decoded_words!=0 || expected_output_words!=3)
   $fatal(1,"empty texture header incorrect");
  // A zero texture count still emits its header before the CLUT header.
  restart();gold_count=8;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  gold[3]=32'ha0000000;gold[4]=clut_destination;gold[5]=32'h00010010;
  gold[6]=32'h44445555;gold[7]=32'haabbccdd;
  send(32'h31444d49);send(0);send(2);send(1);send(gold[6]);send(gold[7]);
  @(negedge clk);input_exhausted=1;wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || received!=8 || decoded_words!=2 || expected_output_words!=8)
   $fatal(1,"empty texture / nonempty CLUT order incorrect");
  // An invalid magic faults before any packet is published.
  restart();gold_count=0;send(32'h31444d48);wait(format_fault);@(negedge clk);
  if(received!=0 || production_complete)$fatal(1,"bad magic published output");
  // A repeat run extending beyond the only payload word faults after that
  // word; the already accepted header and word are not withdrawn.
  restart();gold_count=4;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;gold[3]=32'h12345678;
  send(32'h31444d49);send(1);send(0);send(32'h40000001);send(32'h12345678);
  @(negedge clk);input_exhausted=1;wait(format_fault);@(negedge clk);
  if(received!=4 || decoded_words!=1 || production_complete)$fatal(1,"overlong run effect incorrect");
  // A token at the input FIFO is not consumed while the output FIFO is full.
  restart();gold_count=4;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;gold[3]=32'h11223344;
  send(32'h31444d49);send(1);send(0);wait(received==3);
  @(negedge clk);force_full=1;input_word=0;input_valid=1;
  repeat(6)begin @(negedge clk);if(input_ready || format_fault)$fatal(1,"token consumed while output full");end
  force_full=0;@(posedge clk);while(!input_ready)@(posedge clk);
  @(negedge clk);input_valid=0;send(32'h11223344);@(negedge clk);input_exhausted=1;
  wait(production_complete || format_fault);@(negedge clk);
  if(format_fault || received!=4 || decoded_words!=1)$fatal(1,"stalled token did not resume");
  // Header exhaustion is an error, not a fabricated zero count.
  restart();gold_count=0;send(32'h31444d49);@(negedge clk);input_exhausted=1;
  wait(format_fault);@(negedge clk);if(received!=0)$fatal(1,"truncated header published output");
  // Unfinished input cannot fault while the output FIFO is full. Once the
  // FIFO has space, a missing repeat value faults without creating a word.
  restart();gold_count=3;gold[0]=32'ha0000000;gold[1]=texture_destination;gold[2]=texture_size;
  send(32'h31444d49);send(2);send(0);wait(received==3);send(32'h40000001);
  @(negedge clk);force_full=1;input_exhausted=1;
  repeat(6)@(negedge clk);if(format_fault || received!=3)$fatal(1,"fault during output-full stall");
  force_full=0;wait(format_fault);@(negedge clk);
  if(received!=3 || decoded_words!=0)$fatal(1,"missing repeat emitted output");
  // Existing FIFO space, rather than an arbitrated word grant, governs
  // exhausted literal input. Preserve the already emitted literal prefix.
  restart();gold_count=4;gold[3]=32'h01234567;
  send(32'h31444d49);send(2);send(0);send(1);send(gold[3]);
  @(negedge clk);force_no_word_grant=1;input_exhausted=1;
  wait(format_fault);@(negedge clk);
  if(word_ready || received!=4 || decoded_words!=1)$fatal(1,"literal exhaustion depended on output grant");
  // Trailing input after an empty image is also deferred while output is full.
  restart();gold_count=3;send(32'h31444d49);send(0);send(0);wait(received==3);
  @(negedge clk);force_full=1;input_valid=1;input_word=0;
  repeat(6)@(negedge clk);if(format_fault || input_ready)$fatal(1,"trailing input mishandled while full");
  force_full=0;wait(format_fault);@(negedge clk);
  if(input_ready || received!=3)$fatal(1,"trailing token was consumed");
  // A back-reference into an empty history reports its fault on the token
  // acceptance itself, without an extra wrapper-state cycle.
  restart();gold_count=3;send(32'h31444d49);send(1);send(0);wait(received==3);
  send(32'h80000000);
  if(!format_fault || received!=3)$fatal(1,"invalid back-reference fault delayed");
  // The externally visible output-count arithmetic remains a raw wrapping
  // word even when the requested payload would be impractically long.
  restart();gold_count=3;send(32'h31444d49);send(32'hffffffff);send(2);
  wait(received==3);@(negedge clk);
  if(expected_output_words!==32'd7 || format_fault)$fatal(1,"output count did not wrap");
  $display("PASS IMGDEC stream: real TS/C++ packet, CLUT-crossing run, stalls, empty, faults and 32-bit count wrap");
  $finish;
 end
 initial begin #1000000;$fatal(1,"IMGDEC stream watchdog");end
endmodule
