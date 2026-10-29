`timescale 1ns/1ps
// Direct handshakes exercise backpressure and transport interruption at the
// DMA block boundary; dma_block_integration_tb exercises real CORE/CAD pins.
module dma_block_transfer_tb;
    reg clk=0; always #5 clk=!clk;
    reg reset_n=0,block_valid=0,req_ready=0,rsp_valid=0,rsp_timeout=0;
    reg [31:0] block_read_address=0,block_write_address=0,block_transfer_count=0,block_control=0,rsp_rdata=0;
    wire block_ready,result_valid,result_timeout,result_write_in_doubt;
    wire [31:0] result_read_address,result_write_address,result_transfer_count;
    wire req_valid,req_write,req_hold,req_data_timeout_enable;
    wire [31:0] req_address,req_wdata,req_access;
    wire [2:0] req_size_bytes;
    wire [3:0] req_be_n;
    wire [7:0] req_bus_signals;
    wire [17:0] req_data_wait_last;
    dma_block_transfer dut(.*);
    task automatic submit(input [31:0] a,b,n,c);
        begin
            @(negedge clk);block_read_address=a;block_write_address=b;
            block_transfer_count=n;block_control=c;block_valid=1;
            do @(posedge clk);while(!block_ready);
            @(negedge clk);block_valid=0;
            block_read_address=0;block_write_address=0;block_transfer_count=0;block_control=0;
        end
    endtask
    task automatic accept(input bit writing,input [31:0] a,word,input [7:0] flags,input bit hold);
        integer n;
        begin
            while(!req_valid) @(negedge clk);
            for(n=0;n<3;n=n+1) begin
                if(!req_valid || req_write!==writing || req_address!==a || req_bus_signals!==flags ||
                   req_hold!==hold || req_size_bytes!==4 || req_be_n!==0 || req_data_timeout_enable!==0 ||
                   req_access!==(writing ? 32'h402 : 32'h401) || (writing && req_wdata!==word))
                    $fatal(1,"backpressured request changed: write=%b addr=%h flags=%h hold=%b",req_write,req_address,req_bus_signals,req_hold);
                @(negedge clk);
            end
            req_ready=1;@(posedge clk);@(negedge clk);req_ready=0;
        end
    endtask
    task automatic respond(input bit timed,input [31:0] word);
        begin
            @(negedge clk);rsp_valid=1;rsp_timeout=timed;rsp_rdata=word;
            @(posedge clk);@(negedge clk);rsp_valid=0;rsp_timeout=0;
        end
    endtask
    initial begin
        repeat(3) @(negedge clk);reset_n=1;
        // Two admitted words out of three. Read slot 0 and write slot 1;
        // both addresses advance but the scheduler's control can change.
        submit(32'h10000001,32'h30000001,3,32'h663);
        accept(0,32'h10000001,0,8'h05,1);respond(0,32'hcafebabe);
        accept(1,32'h30000001,32'hcafebabe,8'h0d,1);respond(0,0);
        accept(0,32'h10000005,0,8'h07,1);respond(0,32'h11223344);
        accept(1,32'h30000005,32'h11223344,8'h0f,0);respond(1,0);
        if(!result_valid || !result_timeout || !result_write_in_doubt ||
           result_read_address!==32'h10000005 || result_write_address!==32'h30000005 ||
           result_transfer_count!==2)
            $fatal(1,"timed-out write did not expose uncertain side effect and completed prefix");
        // A read timeout does not claim an uncertain destination write.
        submit(32'h10000000,32'h30000000,1,32'h260);
        accept(0,32'h10000000,0,8'h07,1);respond(1,0);
        if(!result_valid || !result_timeout || result_write_in_doubt ||
           result_read_address!==32'h10000000 || result_write_address!==32'h30000000 ||
           result_transfer_count!==1)
            $fatal(1,"read timeout changed state or marked a destination write");
        // Address words wrap naturally after an unaligned U32 operation;
        // invalid endpoint faults are owned by the CORE, not this datapath.
        submit(32'hfffffffe,32'hffffffff,1,32'h3);
        accept(0,32'hfffffffe,0,8'h03,1);respond(0,0);
        accept(1,32'hffffffff,0,8'h03,0);respond(0,0);
        if(!result_valid || result_timeout || result_read_address!==2 ||
           result_write_address!==3 || result_transfer_count!==0)
            $fatal(1,"DMA address-word increment did not wrap");
        $display("PASS DMA block backpressure, independent socket flags, last-word hold and timeout ownership");
        $finish;
    end
endmodule
