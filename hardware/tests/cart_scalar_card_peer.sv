`timescale 1ns/1ps
// Reference card peer for the scalar CAD protocol. It observes only socket pins.
// The five-byte memories make capacity tails and ignored whole writes observable.
module cart_scalar_card_peer #(
    parameter integer RAM_BYTES=5, ROM_BYTES=5
)(
    input wire clk, reset_n, cs_n, cal_lo, cal_hi, rd_n, wr_n,
    input wire [1:0] be_n,
    input wire stall,
    inout wire [15:0] cad,
    output wire ready_n,
    output wire irq_n, dreq_read, dreq_write
);
    reg [7:0] ram [0:RAM_BYTES-1];
    reg [7:0] rom [0:ROM_BYTES-1];
    reg [31:0] address, staged, data_word, control_word, read_value;
    reg [2:0] size_bytes;
    reg pending, seen, ack, half;
    reg [3:0] delay_count;
    integer n, commits, write_beats, read_beats, irq_edges;
    reg [31:0] value, offset, mapped;
    reg [15:0] sampled_data;
    reg [1:0] sampled_be;
    realtime cad_changed=0, be_changed=0, read_data_at=0;
    always @(cad) begin
        cad_changed=$realtime;
        if(!cs_n && !rd_n && cad===(half ? read_value[31:16] : read_value[15:0]))
            read_data_at=$realtime;
    end
    always @(be_n) be_changed=$realtime;
    assign ready_n = cs_n ? 1'b1 : !ack;
    assign irq_n = !pending;
    assign dreq_read=control_word[1];
    assign dreq_write=control_word[2];
    assign #(80,80,10) cad = !cs_n && !rd_n ?
        (half ? read_value[31:16] : read_value[15:0]) : 16'bz;
    initial begin
        address=0;staged=0;data_word=0;control_word=0;read_value=0;
        size_bytes=0;pending=0;seen=0;ack=0;half=0;delay_count=0;
        commits=0;write_beats=0;read_beats=0;irq_edges=0;sampled_data=0;sampled_be=3;
        for(n=0;n<RAM_BYTES;n=n+1) ram[n]=0;
        for(n=0;n<ROM_BYTES;n=n+1) rom[n]=8'h10+n;
    end
    always @(negedge cal_lo) if(!cs_n && reset_n) begin
        address[15:0]=cad;
        case(be_n)
            0: size_bytes=1;
            1: size_bytes=2;
            2: size_bytes=4;
            3: size_bytes=4;
        endcase
    end
    always @(negedge cal_hi) if(!cs_n && reset_n) address[31:16]=cad;
    always @(posedge cs_n) begin seen=0;ack=0;half=0;delay_count=0;end
    always @(posedge clk) begin
        if(!reset_n) begin data_word=0;control_word=0;pending=0;seen=0;ack=0;half=0;delay_count=0;end
        else if(!cs_n) begin
            if(rd_n && wr_n) begin seen=0;ack=0;delay_count=0;end
            else if(!seen) begin
                seen=1;delay_count=6;
                if(!rd_n && !wr_n) $fatal(1,"read and write asserted together");
                if(be_n !== (size_bytes==1 ? 2'b10 : 2'b00)) $fatal(1,"incorrect scalar byte enables");
                sampled_be=be_n;
                if(!rd_n) begin
                    read_beats=read_beats+1;
                    if(!half) begin
                        value=0;
                        if(address<32'h30000000) begin
                            offset=address-32'h10000000;
                            for(n=0;n<size_bytes;n=n+1)
                                if(offset+n<ROM_BYTES) value[n*8 +:8]=rom[offset+n];
                        end else if(address<32'h30f00000) begin
                            offset=address-32'h30000000;
                            for(n=0;n<size_bytes;n=n+1)
                                if(offset+n<RAM_BYTES) value[n*8 +:8]=ram[offset+n];
                        end else begin
                            offset=address-32'h30f00000;
                            case(offset & 32'hfffffffc)
                                0: mapped=data_word;
                                4: mapped=control_word;
                                8: mapped={31'd0,pending};
                                default: mapped=0;
                            endcase
                            case(size_bytes)
                                1: value=(mapped >> (address[1:0]*8)) & 32'hff;
                                2: value=(mapped >> (address[1]*16)) & 32'hffff;
                                4: value=mapped;
                            endcase
                        end
                        read_value=value;
                    end
                end else begin
                    if($realtime-cad_changed<20 || $realtime-be_changed<20)
                        $fatal(1,"write data or byte-enable setup too short");
                    sampled_data=cad;
                    write_beats=write_beats+1;
                    if(size_bytes==4 && !half) staged[15:0]=cad;
                    else begin
                        if(size_bytes==4) value={cad,staged[15:0]};
                        else if(size_bytes==2) value={16'd0,cad};
                        else value={24'd0,cad[7:0]};
                        if(address>=32'h30000000 && address<32'h30f00000) begin
                            offset=address-32'h30000000;
                            if(offset+size_bytes<=RAM_BYTES) begin
                                for(n=0;n<size_bytes;n=n+1) ram[offset+n]=value[n*8 +:8];
                                commits=commits+1;
                            end
                        end else if(address>=32'h30f00000 && size_bytes==4) begin
                            offset=address-32'h30f00000;
                            case(offset)
                                0: begin data_word=value;commits=commits+1;end
                                4: begin control_word=value & 32'hfffffffe;
                                    if(value[0] && !pending) begin pending=1;irq_edges=irq_edges+1;end
                                    commits=commits+1;end
                                12: if(value!=0) begin pending=0;commits=commits+1;end
                            endcase
                        end
                    end
                end
            end else if(!stall && !ack) begin
                if(!wr_n && (cad!==sampled_data || be_n!==sampled_be))
                    $fatal(1,"write data or byte enables changed while waiting");
                if(delay_count!=0) delay_count=delay_count-1;
                else begin
                    if(!rd_n && $realtime-read_data_at<20) $fatal(1,"READY before read-data setup");
                    ack=1;
                end
            end
        end
    end
    always @(posedge rd_n or posedge wr_n) if(!cs_n && reset_n && size_bytes==4 && seen) begin
        // Only the active strobe's rising edge terminates a halfword.
        if(rd_n && wr_n) half=1;
    end
endmodule
