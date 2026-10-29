`timescale 1ns/1ps
module context_link_tb;
    reg clk=0;
    always #14.762849584278 clk=!clk;
    reg io_clk=0;
    initial begin #7; forever #14.762849584278 io_clk=!io_clk; end
    reg reset_n=1,pcrtc_write=0;
    reg [4:0] pcrtc_word_index=0;
    reg [31:0] pcrtc_word=0;
    wire pin;
    wire [15:0] source_width,source_height,width,height;
    wire [31:0] source_epoch,epoch;
    wire context_valid,context_update;
    reg corrupt=0;
    integer received=0;
    wire source_valid;
    gfx_pcrtc_control gfx (.clk(clk),.reset_n(reset_n),.access_valid(pcrtc_write),.access_write(1'b1),
        .access_index(pcrtc_word_index),.access_wdata(pcrtc_word),.access_rdata(),.other_events(5'd0),
        .display_context_valid(source_valid),.display_width(source_width),.display_height(source_height),
        .display_epoch(source_epoch));
    display_context_tx transmitter (.clk(clk),.reset_n(reset_n),.context_valid(source_valid),
        .display_width(source_width),.display_height(source_height),.display_epoch(source_epoch),.display_context(pin));
    display_context_rx io (.clk(io_clk),.reset_n(reset_n),.display_context(pin ^ corrupt),
        .context_valid(context_valid),.display_width(width),.display_height(height),
        .display_epoch(epoch),.context_update(context_update));
    always @(posedge io_clk) if (context_update) received=received+1;
    task automatic write_word(input [4:0] index,input [31:0] value);
        begin
            @(negedge clk);pcrtc_write=1;pcrtc_word_index=index;pcrtc_word=value;
            @(negedge clk);pcrtc_write=0;
        end
    endtask
    task automatic commit;
        // Drive a VBlank boundary at the real presentation-bank owner.
        begin @(negedge clk);force gfx.beam.vblank_before_write=8'd1;
            @(negedge clk);release gfx.beam.vblank_before_write;repeat(2) @(negedge clk);end
    endtask
    task automatic expect_extent(input [15:0] w,h);
        integer timeout_count;
        begin
            timeout_count=0;
            while ((!context_valid || width!=w || height!=h || epoch!=source_epoch) && timeout_count<2000) begin
                @(negedge io_clk);timeout_count=timeout_count+1;
            end
            if(timeout_count==2000) $fatal(1,"Context did not converge to %0dx%0d (got %0dx%0d epoch%0d/%0d)",w,h,width,height,epoch,source_epoch);
        end
    endtask
    initial begin
        #1;reset_n=0;repeat(5) @(negedge clk);reset_n=1;
        expect_extent(0,0);
        if(epoch!=0) $fatal(1,"Reset empty context acquired an invented epoch");
        write_word(5,32'h000bf3ff);write_word(0,1);
        repeat(50) @(negedge clk);
        if(source_width!=0 || source_height!=0) $fatal(1,"Programmed words escaped display latch");
        commit();expect_extent(256,192);
        // Width follows signal-step boundaries, not the magnification nibble.
        write_word(4,32'h018252a9); // X681, right1705: ceil(1705/4)-ceil(681/4)=256
        write_word(5,32'h000bf3fe); // span1023: right1704 =>426-171=255
        commit();expect_extent(255,192);
        // Both windows form one rectangle; Y positions are not physical scanlines.
        write_word(8,32'h00005003);write_word(9,32'h00007004);write_word(0,3);
        commit();expect_extent(425,224);
        // All raw extrema are losslessly representable in the16-bit fields.
        write_word(12,32'h40206504); // step1
        write_word(4,32'h007fffff);write_word(5,32'h007fffff);
        write_word(8,0);write_word(9,0);
        commit();expect_extent(8191,4095);
        // One-pixel signal window can round to zero width despite active timing.
        write_word(12,32'h40806504);write_word(0,1);
        write_word(4,1);write_word(5,0);
        commit();expect_extent(0,1);
        // Fast context writes during a wire burst cannot tear the receive bank.
        write_word(4,0);write_word(5,32'h00009027);commit(); //10x10
        write_word(5,32'h0001304f);commit(); //20x20, may supersede unsent10
        expect_extent(20,20);
        // A mid-payload fault must not clock the retained receiver fields.
        wait(transmitter.state==2 && transmitter.bit_index==32);
        @(negedge clk);corrupt=1;repeat(8) @(negedge clk);corrupt=0;
        write_word(5,32'h0001d077);commit(); //30x30
        expect_extent(30,30);
        // Zero step is the PCRTC no-output rule, not a default640x480 image.
        write_word(12,32'h40006504);commit();expect_extent(0,0);
        write_word(12,32'h40826504);commit();expect_extent(0,0); //SINT
        write_word(22,32'h00000200);
        repeat(8) @(negedge clk);expect_extent(0,0);
        if(received<8) $fatal(1,"Did not exercise repeated atomic context reception");
        $display("PASS: PCRTC presentation bank, extent boundaries/extrema/empty output, epoch and single-wire context");
        $finish;
    end
    initial begin #2000000;$fatal(1,"Context test timeout");end
endmodule
