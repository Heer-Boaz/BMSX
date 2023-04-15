const base64SnareDrumSample = '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Rv1B/T79QP1D/U39Uf1R/VH9UP1R/VL9Uf1L/Un9S/1O/Vf9Xf1d/Vz9XP1c/V39Xv1d/V/9Wf1Y/Vr9Xf1n/Wz9bP1s/Wz9bf1u/W79b/1w/Wv9af1q/W/9eP19/X79fv1+/X/9f/2A/YH9e/1z/YT9mf2H/Sn9sfxt/In81/wS/ST9Jf0u/Tz9Rv1H/Ur9S/1L/U79T/1Q/U79Tf1L/Uf9Qf09/T39Pv1F/Un9Sf1J/Uj9Sv1K/Ur9Sv1I/UT9Qf1C/UL9Sf1K/Uj9R/1F/UX9Q/1D/T39Of06/Tv9Qv1F/UX9Q/1B/UD9QP1A/T/9P/0//Tn9N/03/Tn9P/1A/UD9Pv0+/T39Pf08/Tr9Ov00/TP9Mv00/Tr9O/07/Tn9OP03/TX9NP0z/TT9Lv0s/Sv9K/0x/TT9NP0x/S79Lv0t/S39K/0r/SX9If0h/SL9Kf0r/Sn9J/0l/SX9JP0d/Rr9Hv0j/R79G/0Z/Rn9H/0h/SH9Hv0b/Rv9Gv0a/RT9EP0V/Rn9Gv0U/Q79E/0X/Rj9Fv0T/RP9E/0U/Q79C/0X/Rb99fy5/Ij8gfyl/Mb81/ze/OH85/zj/N/83vzk/On86vzp/Of85fzk/OL82fzT/NP81PzU/NX82/zf/N/83fza/Nj82PzQ/M38zPzO/M/81fzY/Nb81PzR/ND8zvzM/Mv8yvzE/MD8wPzC/ML8yfzM/Mz8yfzG/MX8xPzE/MP8vPy4/Lf8ufzB/MX8xPzC/MD8vvy9/Lz8tfyx/LD8s/y7/MD8v/y9/Lr8uPy3/Lb8tvy1/K38qvyq/K38rvy1/Lj8tvy0/LL8svyw/Kj8pPyk/K38q/yn/Kb8rPyx/LH8r/ys/Kn8qfyp/Kn8qPyg/J38nfyg/KH8p/yr/Kr8qfyn/KT8pPyj/J38mfyY/Jv8nfyl/Kj8qPym/KP8ovyh/Jv8l/yd/KP8nvya/KD8qfya/Gb8JfwM/CH8Sfxi/Gb8Z/xt/Hr8gPx5/HH8cPx4/H/8f/x7/Hn8d/x3/HX8bfxn/Gb8b/x0/HX8c/xz/HL8cfxx/HD8cPxw/Gr8Zvxl/G78cvxz/HD8b/xt/Gz8bPxk/GH8Yfxj/GX8Zvxu/HH8cfxv/Gz8a/xq/GT8YPxg/GP8Zfxt/HH8cfxv/Gz8bPxr/Gv8a/xq/Gr8ZPxi/GL8Zfxn/G38cfxx/HD8b/xt/G38Zvxk/GT8Z/xp/Gn8cPx0/HX8cvxw/G/8b/xw/Gn8ZPxm/G/8dfx2/HP8cvxx/HL8cvxy/HL8avxo/Gn8bfx1/Hn8efx4/Hf8d/x2/Hb8b/xt/G78dvx2/HP8c/x7/H/8gPx+/H38ffx8/H38ffx+/H/8fvx5/HH8dvyI/IT8Wfwb/PT7Avwn/EP8SfxN/FP8XPxh/Gf8Z/xl/GX8Zfxm/Gb8Yvxe/Fz8Xvxe/GT8Zvxn/GX8ZPxk/GT8Zvxm/Gf8Z/xi/GD8Yfxo/Gf8Y/xj/Gj8bfxt/Gz8avxp/Gn8afxl/GL8Yvxq/G78cPxu/G78bvxt/G78bvxv/G/8avxp/Gn8cvx2/Hf8dfx0/HT8dfx2/HH8bvxv/HH8dPx1/Hz8fvx+/H38fPx9/H38d/x1/Hb8efx7/ID8hPyE/IT8g/yE/IP8gvyD/IP8hfyA/H78f/yB/IT8ivyM/I38jPyM/Iz8i/yH/IX8h/yJ/Ir8jPyR/JX8lvyU/JP8k/yU/JT8kPyO/I78lvyb/J38nPya/Jv8m/yd/J38nPyd/Jn8mfyf/KP8oPyd/Kr8q/yQ/Fj8IfwW/DT8Wvxy/HT8dvx7/In8kPyO/Iv8ifyL/Iz8jfyN/Iv8i/yK/Ir8g/yA/ID8iPyO/I/8j/yP/I78j/yJ/Ib8h/yK/Iz8k/yX/Jf8lvyU/JL8kvyL/Ij8ifyM/I78lfyZ/Jn8mfyX/Jb8lvyW/Jf8l/yY/JL8j/yQ/Jn8mfyW/JT8nfyi/KP8ofyh/KD8mfyW/Jf8mvyc/J38pfyp/Kr8qPym/KX8pfym/Kb8pvyg/J38oPyp/K/8r/ys/Kz8rPyt/K38pfyj/KT8qPyq/LH8tfy1/LX8s/yy/LL8svyt/Kn8o/yj/K38tfy9/L/8vvy8/Lz8u/y5/Lr8uvy7/LX8sfyz/Lb8ufzB/MT8xPzD/MP8w/zC/Lz8ufy7/L78v/zC/Mn8zvzO/Mz8y/zL/Mz8zPzE/ML8xPzO/NT81PzT/NL80/zU/NP80/zU/Nb80PzM/M782Pze/N/83fzd/N383fze/Nf81fzW/N/83/zd/N385fzp/Ov86fzo/Oj86Pzp/OL84Pzh/Or88Pzr/OX85vzv/PX89vzz/PL88/z0/O786vzr/O788Pz5/P38/vz9/Pv8+/z7/Pz8/Pz1/PP89Pz3/AD9Bf0G/QX9A/0D/QP9BP0E/QT9/vz8/P38B/0M/Q79DP0K/Qv9C/0L/Qz9DP0H/QT9Bf0I/Qv9C/0T/Rf9Gf0X/RX9Ff0V/RX9Ff0W/RH9Dv0O/RH9Gv0e/R/9Hv0e/R79Hf0e/Rf9E/0V/Rj9Iv0n/Sb9Jf0k/SP9JP0k/SX9Hv0b/Rb9Hf0p/TD9Kf0p/TH9MP0P/dP8ofyd/MH85Pzv/Oz89fwA/Q79E/0I/Qn9C/0O/Qj9A/0D/QT9Bv0G/QT9A/0K/Qz9DP0D/Qb9Cf0K/QT9AP0B/QP9C/0P/Q79Df0L/Qn9Cf0I/Qn9CP0A/f78/vwG/Qz9DP0F/Qf9Cf0L/QT9AP0A/QL9BP0G/QX9Bv0N/RL9Ef0H/QP9Cf0Q/RH9B/0D/QP9Bf0P/Qz9Cf0I/Q79FP0U/RP9Ef0P/Qn9Bv0B/QH9CP0P/Rf9Gf0Y/Rb9Ff0U/RL9Ev0S/Qr9CP0J/Q39Ff0Y/Rn9F/0V/RX9Ff0W/RX9FP0P/Qz9DP0P/Rj9Hf0d/Rr9Gf0Z/Rj9Gf0Y/RP9EP0L/Qz9E/0Y/SH9I/0k/SH9H/0f/R79Hf0e/R79Gf0W/Rb9Gf0i/SX9Jv0e/Rn9If0n/Sn9If0b/R39IP0o/Sz9LP0r/Sr9Kf0q/Sr9Kf0q/SP9IP0i/SX9L/0z/TP9Mv0x/TD9Mf0x/TD9Mf0r/Sn9Jf0q/S/9OP07/Tv9Ov04/Tj9Mf0v/S/9Mf00/Tb9Nv03/T/9Qv1C/UD9QP0//Tj9Nf0x/TX9O/1E/Uf9SP1G/UT9RP1D/UT9RP1D/T79O/08/T/9SP1M/Uz9S/1J/Ur9Sv1L/Ur9Sv1E/UL9Qv1F/U79Uv1T/Ur9Rv1N/VP9U/1M/Uj9Sf1M/VT9Wf1Y/Vb9Vv1V/VX9Vf1V/VT9T/1M/Uj9Sf1R/VX9Xv1h/WL9YP1d/V39Xf1c/Vz9Vv1T/VT9V/1f/WT9ZP1i/WL9Yf1h/WL9Yv1h/Vz9Wf1a/V39Zv1r/WX9X/1m/XL9aP08/f781vze/AL9Hv0u/TX9Qf1J/Uv9Sf1G/UT9P/0+/UD9R/1E/UL9QP0+/UT9Rf1E/T39Of1A/UT9RP0//Tv9O/0+/T/9QP1A/T/9RP1H/UD9Pf1A/UL9P/07/Tr9O/08/UL9RP1D/UL9Qf07/T79QP1C/T39Of06/Tv9Qf1F/UT9Pf1A/UL9Q/0+/Tr9O/09/T79P/1A/T/9Rf1I/UL9Pv1D/UX9Qv0+/Tj9Pf1B/Un9S/1E/UD9Rf1I/UT9QP1D/Uj9RP1C/Tr9Pv1D/Uv9TP1M/Ur9SP1I/Uj9R/1H/UL9P/1B/UP9Sv1N/Uz9Rv1D/Uf9TP1N/Ub9Q/1E/UX9Tf1P/U/9Sf1L/U39T/1O/U79Tv1I/Uf9R/1J/Uv9TP1R/VX9Vf1T/VP9Tf1K/Uv9Tf1O/VD9Uf1R/VL9WP1a/Vr9Wf1Z/VP9Vf1Z/Vr9VP1S/VP9VP1c/V/9Xv1e/V39Xf1d/V79Xf1Z/Vf9Uf1X/V39ZP1n/WH9Xf1i/Wb9Zv1g/V39Xf1l/Wn9ZP1h/WD9Zv1r/Wv9ZP1h/Wf9a/1o/WT9Y/1m/Wj9av1q/Wn9av1w/XL9bv1q/W39cv1u/Wr9av1r/W39c/12/XD9cv10/XX9cP1y/XT9cf1v/W79cf1y/Xj9ev11/XL9dv17/Xz9df1y/XP9dP13/Xj9d/19/YD9e/14/Xz9f/18/Xn9cf12/Xz9g/2G/YX9fv2A/YP9g/2D/YL9gv1+/Xz9df11/X79g/2L/Y39i/2F/Yf9iP2K/YT9gP17/Xr9gv2I/Y/9kf2P/Yn9hv2K/ZX9h/1Q/Rb9Av0Z/Tn9Tv1W/V39Y/1p/Wv9av1p/Wj9aP1q/Wv9av1q/Wn9Z/1n/Wb9ZP1k/WT9Y/1k/WX9ZP1l/Wb9Zf1m/Wb9Zf1m/WX9Zv1m/WT9ZP1k/WP9Y/1j/WL9Y/1i/WL9Yv1i/WL9Yv1i/WL9Yv1j/WL9Y/1j/WL9Y/1j/WL9Y/1j/WP9Y/1j/WP9ZP1k/WP9ZP1k/WP9ZP1k/WT9Zf1l/WT9Zf1l/WT9Zf1l/WX9Zf1m/WX9Zv1m/WX9Zv1m/WX9Zv1m/Wb9Z/1n/Wb9Z/1n/Wb9Z/1n/Wf9aP1o/Wf9aP1o/Wf9aP1o/Wj9af1p/Wj9af1p/Wn9av1q/Wn9av1q/Wr9a/1r/Wv9bP1s/Wv9bP1t/Wz9bf1t/W39bv1u/W79b/1v/W/9bv1v/XD9cP1x/XH9cf1y/XL9cv1z/XP9c/10/XX9dP11/Xb9df13/Xf9d/14/Xj9eP15/Xn9ef14/Xr9ev16/Xv9fP17/X39ff19/X79fv1+/X/9f/1//YD9gf2A/YH9gv2B/YH9gv2D/YL9hP2E/YT9hf2F/YX9hv2G/Yb9h/2H/Yf9iP2J/Yj9iP2J/Yn9if2K/Yv9i/2M/Yz9jP2N/Y39jf2O/Y79jv2N/Y79j/2P/ZD9kP2Q/ZH9kv2R/ZL9k/2S/ZP9lP2T/ZP9lP2V/ZT9lv2W/Zb9l/2X/Zf9mP2Y/Zj9l/2Z/Zn9mf2a/Zr9mv2b/Zz9m/2b/Zz9nf2c/Z79nv2e/Z/9n/2f/aD9oP2g/Z/9of2h/aH9ov2j/aL9o/2k/aP9o/2k/aX9pf2m/ab9pv2n/af9p/2n/aj9qP2o/an9qv2q/av9q/2r/ar9q/2s/az9rf2u/a39rv2v/a/9rv2v/bD9sP2x/bH9sf2y/bP9sv2y/bP9tP20/bX9tf21/bb9tv22/bb9t/23/bf9uf25/bn9uP25/br9uv27/bz9u/28/b39vf28/b39vv2+/b/9v/2//b/9wP3B/cD9wv3C/cL9wf3D/cP9w/3E/cX9xP3E/cX9xv3G/cf9x/3H/cj9yP3I/cj9yf3J/cn9yv3L/cv9yv3L/cz9zP3N/c39zf3N/c79z/3O/dD90P3Q/c/90P3R/dH90v3S/dL90v3T/dT90/3V/dX91f3U/dX91v3W/df91/3X/df92P3Z/dj92P3Z/dr92v3b/dv92/3a/dz93P3c/d393v3d/d393v3f/d794P3g/eD93/3g/eH94f3g/eL94v3i/eP95P3j/eP95P3l/eX95v3m/eb95f3m/ef95/3m/ej96P3o/en96v3p/en96v3r/er96v3r/ez97P3t/e397f3s/e797v3u/e/97/3v/e/98P3x/fD98P3x/fL98v3z/fP98/3y/fP99P30/fP99P31/fX99P32/fb99v33/fj99/33/fj9+f34/fj9+f36/fr9+/37/fv9+v37/fz9/P37/fz9/f39/fz9/v3+/f79//0A/v/9//0A/gH+AP4A/gH+Av4B/gH+Av4D/gP+BP4E/gT+A/4E/gX+Bf4E/gX+Bv4G/gX+B/4H/gf+Bv4I/gj+CP4J/gr+Cf4J/gr+Cv4K/gr+C/4L/gv+C/4M/g3+DP4M/g3+Dv4N/g3+Dv4P/g/+Dv4P/hD+EP4R/hH+Ef4Q/hH+Ev4S/hH+Ev4T/hP+Ev4T/hT+FP4T/hT+Ff4V/hT+Fv4W/hb+Ff4X/hf+F/4W/hj+GP4Y/hf+Gf4Z/hn+Gv4a/hr+Gv4b/hv+G/4a/hz+HP4c/hz+Hf4d/h3+Hf4e/h7+Hv4e/h/+H/4f/h/+IP4g/iD+IP4h/iH+If4h/iL+Iv4i/iL+I/4j/iP+I/4k/iT+JP4k/iX+Jf4l/iX+Jv4m/ib+Jv4n/if+J/4n/ij+KP4o/ij+Kf4p/in+Kf4q/ir+Kv4q/iv+K/4r/iv+Kv4s/iz+LP4s/i3+Lf4t/i3+Lv4u/i7+Lv4v/i/+L/4v/jD+MP4w/jD+Mf4x/jH+Mf4y/jL+Mv4y/jP+M/4z/jP+NP40/jT+NP4z/jT+Nf41/jT+Nv42/jb+Nv43/jf+N/42/jj+OP44/jf+Of45/jn+OP46/jr+Ov45/jn+Ov47/jv+Ov47/jz+PP47/jz+Pf49/jz+Pf4+/j7+Pf4+/j/+P/4+/j7+P/5A/kD+P/5A/kH+Qf5A/kH+Qv5C/kH+Qv5D/kP+Qv5B/kP+RP5D/kP+RP5F/kX+RP5F/kb+Rf5F/kT+Rv5H/kb+Rv5H/kj+R/5H/kj+SP5I/kj+Sf5J/kn+Sf5I/kr+Sv5K/kn+S/5L/kv+S/5M/kz+TP5L/kv+TP5N/k3+TP5N/k7+Tv5N/k3+Tv5P/k/+Tv5P/lD+UP5P/lD+Uf5R/lD+UP5R/lL+Uv5R/lL+U/5T/lL+Uf5T/lT+U/5T/lT+Vf5V/lT+U/5V/lb+Vf5V/lb+V/5W/lb+V/5X/lf+V/5W/lj+WP5Y/lf+Wf5Z/ln+WP5Y/ln+Wv5a/ln+W/5b/lv+Wv5a/lv+XP5c/lv+XP5d/l3+XP5c/l3+Xv5e/l3+Xv5f/l/+Xv5d/l/+YP5f/l/+Xv5g/mH+YP5g/mH+Yv5h/mH+YP5i/mL+Yv5i/mP+Y/5j/mP+Yv5j/mT+ZP5j/mP+ZP5l/mX+ZP5l/mb+Zv5l/mX+Zv5n/mf+Zv5n/mj+aP5n/mf+aP5p/mn+aP5n/mn+av5p/mn+av5r/mr+av5p/mv+a/5r/mv+av5s/mz+bP5s/mv+bP5t/m3+bP5u/m7+bv5t/m3+bv5v/m/+bv5u/m/+cP5w/m/+cP5x/nH+cP5w/nH+cv5x/nH+cP5y/nP+cv5y/nH+c/5z/nP+c/5y/nT+dP50/nT+df51/nX+dP50/nX+dv52/nX+df52/nf+d/52/nb+d/54/nj+d/53/nj+ef55/nj+d/55/nr+ef55/nr+e/56/nr+ef57/nv+e/57/nr+e/58/nz+e/57/nz+ff59/nz+fP59/n7+fv59/n3+fv5//n/+fv59/n/+gP6A/n/+fv6A/oH+gP6A/n/+gf6B/oH+gf6A/oL+gv6C/oH+gf6C/oP+g/6C/oL+g/6E/oT+g/6D/oT+hf6F/oT+hP6F/ob+hv6F/oT+hv6H/ob+hv6F/of+h/6H/of+hv6I/oj+iP6H/of+iP6J/on+iP6I/on+iv6K/on+if6K/ov+i/6K/on+i/6M/oz+i/6K/or+jP6N/oz+jP6L/o3+jf6N/o3+jP6O/o7+jv6N/o3+jv6P/o/+jv6O/o/+kP6Q/o/+j/6Q/pH+kf6Q/o/+j/6R/pL+kf6R/pD+kv6T/pL+kv6R/pP+k/6T/pP+kv6T/pT+lP6T/pP+lP6V/pX+lP6U/pP+lf6W/pb+lf6V/pb+l/6X/pb+lf6X/pj+l/6X/pb+lv6Y/pj+mP6Y/pf+mf6Z/pn+mP6Y/pn+mv6a/pn+mf6Z/pr+m/6b/pr+mv6b/pz+nP6b/pr+nP6d/pz+nP6b/pv+nf6d/p3+nf6c/p7+nv6e/p3+nf6d/p7+n/6f/p7+nv6f/qD+oP6f/p/+oP6h/qH+oP6g/p/+of6i/qH+of6g/qL+o/6i/qL+of6h/qP+o/6j/qP+ov6k/qT+pP6j/qP+o/6k/qX+pf6k/qT+pf6m/qb+pf6l/qT+pv6n/qf+pv6l/qX+p/6o/qf+p/6m/qj+qf6o/qj+p/6n/qn+qf6p/qj+qP6q/qr+qv6p/qn+qf6q/qv+q/6q/qr+qv6r/qz+rP6r/qv+rP6t/q3+rP6r/qv+rf6u/q3+rf6s/qz+rv6u/q7+rv6t/q/+r/6v/q/+rv6u/q/+sP6w/q/+r/6v/rD+sf6x/rD+sP6w/rH+sv6y/rH+sf6y/rP+s/6y/rL+sf6z/rT+s/6z/rL+sv60/rX+tP60/rP+s/61/rX+tf61/rT+tP62/rb+tv61/rX+t/63/rf+tv62/rb+t/64/rj+t/63/rf+uP65/rn+uP64/rf+uf66/rr+uf65/rj+uv67/rr+uv65/rn+u/68/rv+u/66/rr+vP68/rz+vP67/rv+vf69/r3+vf68/rz+vv6+/r7+vf69/r3+vv6//r/+vv6+/r7+v/7A/sD+v/6//r/+wP7B/sH+wP7A/r/+wf7C/sL+wf7B/sD+wv7D/sP+wv7B/sH+w/7E/sP+w/7C/sL+xP7F/sT+xP7D/sP+xf7F/sX+xf7E/sT+xv7G/sb+xv7F/sX+xf7G/sf+x/7G/sb+xv7H/sj+yP7H/sf+x/7I/sn+yf7I/sj+yP7J/sr+yv7J/sn+yf7K/sv+y/7K/sr+yv7J/sv+zP7M/sv+y/7K/sz+zf7N/sz+zP7L/s3+zv7N/s3+zP7M/sz+zv7P/s7+zv7N/s3+z/7Q/s/+z/7O/s7+0P7R/tD+0P7P/s/+z/7R/tH+0f7R/tD+0P7S/tL+0v7S/tH+0f7T/tP+0/7S/tL+0v7S/tP+1P7U/tP+0/7T/tT+1f7V/tT+1P7U/tT+1f7W/tb+1f7V/tX+1v7X/tf+1v7W/tb+1v7X/tj+2P7X/tf+1/7Y/tn+2f7Y/tj+2P7Y/tn+2v7a/tn+2f7Z/tr+2/7b/tr+2v7Z/tn+2/7c/tz+2/7b/tr+2v7c/t3+3P7c/tz+2/7d/t7+3f7d/tz+3P7c/t7+3/7e/t7+3f7d/t3+3/7g/t/+3/7e/t7+4P7h/uD+4P7f/t/+3/7h/uH+4f7h/uD+4P7g/uL+4v7i/uL+4f7h/uP+4/7j/uP+4v7i/uL+5P7k/uT+5P7j/uP+4/7l/uX+5f7l/uT+5P7k/ub+5v7m/ub+5f7l/uX+5/7n/uf+5/7m/ub+5v7n/uj+6P7n/uf+5/7n/uj+6f7p/uj+6P7o/ur+6v7q/un+6f7p/un+6v7r/uv+6v7q/ur+6v7r/uz+7P7r/uv+6/7r/uz+7f7t/uz+7P7s/uz+7f7u/u7+7f7t/u3+7f7u/u/+7/7u/u7+7v7u/u/+8P7w/u/+7/7v/u/+7/7w/vH+8f7w/vD+8P7w/vH+8v7y/vH+8f7x/vH+8v7z/vP+8v7y/vL+8v7z/vT+9P7z/vP+8/7z/vT+9f71/vT+9P70/vP+9f72/vb+9f71/vT+9P70/vb+9/73/vb+9v72/vX+9/74/vj+9/73/vb+9v74/vn++f74/vj+9/73/vn++v75/vn++f74/vj++P76/vv++v76/vr++f75/vv+/P77/vv++/76/vr++v78/v3+/P78/vz++/77/v3+/v79/v3+/P78/vz+/v7//v7+/v79/v3+/f79/v/+//7//v/+/v7+/v7+AP8A/wD/AP///v/+//7//gH/Af8B/wH/AP8A/wD/Av8C/wL/Av8B/wH/Af8B/wP/A/8D/wP/Av8C/wL/Av8E/wT/BP8E/wP/A/8D/wX/Bf8F/wX/BP8E/wT/BP8G/wb/Bv8G/wX/Bf8F/wX/Bv8H/wf/B/8G/wb/Bv8I/wj/CP8I/wf/B/8H/wf/CP8J/wn/Cf8I/wj/CP8I/wn/Cv8K/wr/Cf8J/wn/Cf8K/wv/C/8L/wr/Cv8K/wr/C/8M/wz/C/8L/wv/C/8M/w3/Df8M/wz/DP8M/wz/Df8O/w7/Df8N/w3/Df8N/w7/D/8P/w7/Dv8O/w7/Dv8P/xD/EP8P/w//D/8P/w//EP8R/xH/EP8Q/xD/EP8Q/xH/Ev8S/xH/Ef8R/xH/Ef8S/xP/E/8S/xL/Ev8S/xH/E/8U/xT/E/8T/xP/E/8S/xT/Ff8V/xT/FP8U/xP/E/8T/xX/Fv8W/xX/Ff8V/xT/FP8W/xf/F/8W/xb/Fv8V/xX/F/8Y/xj/F/8X/xb/Fv8W/xj/Gf8Y/xj/GP8X/xf/F/8X/xn/Gv8a/xn/Gf8Y/xj/GP8a/xv/Gv8a/xr/Gf8Z/xn/G/8b/xv/G/8a/xr/Gv8a/xr/HP8c/xz/HP8b/xv/G/8b/x3/Hf8d/x3/HP8c/xz/HP8e/x7/Hv8e/x3/Hf8d/x3/Hf8e/x//H/8f/x7/Hv8e/x7/H/8g/yD/IP8f/x//H/8f/x//IP8h/yH/If8g/yD/IP8g/yD/If8i/yL/Iv8h/yH/If8h/yL/I/8j/yL/Iv8i/yL/Iv8i/yP/JP8k/yP/I/8j/yP/I/8j/yT/Jf8l/yT/JP8k/yT/JP8l/yb/Jv8l/yX/Jf8l/yT/JP8m/yf/J/8m/yb/Jv8m/yX/Jf8n/yj/KP8n/yf/J/8m/yb/Jv8o/yn/Kf8o/yj/J/8n/yf/J/8p/yr/Kv8p/yn/KP8o/yj/Kv8r/yr/Kv8q/yn/Kf8p/yn/K/8s/yv/K/8q/yr/Kv8q/yr/LP8s/yz/LP8r/yv/K/8r/yv/Lf8t/y3/Lf8s/yz/LP8s/yz/LP8u/y7/Lv8u/y3/Lf8t/y3/Lf8u/y//L/8v/y7/Lv8u/y7/Lv8v/zD/MP8w/y//L/8v/y//L/8w/zH/Mf8x/zD/MP8w/zD/MP8x/zL/Mv8x/zH/Mf8x/zH/Mf8y/zP/M/8y/zL/Mv8y/zL/Mf8x/zP/NP80/zP/M/8z/zP/M/8y/zT/Nf81/zT/NP80/zT/M/8z/zP/Nf82/zb/Nf81/zX/NP80/zT/Nv83/zf/Nv82/zX/Nf81/zX/N/84/zj/N/83/zb/Nv82/zb/Nv84/zn/Of84/zj/N/83/zf/N/83/zn/Ov85/zn/OP84/zj/OP84/zr/Ov86/zr/Of85/zn/Of85/zn/O/87/zv/O/86/zr/Ov86/zr/Ov87/zz/PP88/zv/O/87/zv/O/88/z3/Pf89/zz/PP88/zz/PP88/z3/Pv8+/z7/Pf89/z3/Pf89/z3/Pv8//z//Pv8+/z7/Pv8+/z3/Pf8//0D/QP8//z//P/8//z7/Pv8+/0D/Qf9B/0D/QP9A/0D/P/8//z//Qf9C/0L/Qf9B/0H/QP9A/0D/QP9C/0P/Q/9C/0L/Qf9B/0H/Qf9B/0P/RP9E/0P/Q/9C/0L/Qv9C/0L/RP9F/0T/RP9D/0P/Q/9D/0P/Q/9F/0X/Rf9F/0T/RP9E/0T/RP9E/0T/Rv9G/0b/Rv9F/0X/Rf9F/0X/Rf9G/0f/R/9H/0b/Rv9G/0b/Rv9G/0f/SP9I/0j/R/9H/0f/R/9H/0f/R/9I/0n/Sf9J/0j/SP9I/0j/SP9I/0n/Sv9K/0n/Sf9J/0n/Sf9I/0j/Sv9L/0v/Sv9K/0r/Sv9J/0n/Sf9J/0v/TP9M/0v/S/9L/0r/Sv9K/0r/Sv9M/03/Tf9M/0z/S/9L/0v/S/9L/03/Tv9O/03/Tf9M/0z/TP9M/0z/TP9O/0//T/9O/07/Tf9N/03/Tf9N/03/T/9Q/1D/T/9O/07/Tv9O/07/Tv9O/1D/Uf9Q/1D/T/9P/0//T/9P/0//T/9R/1H/Uf9R/1D/UP9Q/1D/UP9Q/1H/Uv9S/1L/Uf9R/1H/Uf9R/1H/Uf9S/1P/U/9T/1L/Uv9S/1L/Uv9S/1L/U/9U/1T/VP9T/1P/U/9T/1P/Uv9T/1P/VP9V/1X/VP9U/1T/VP9U/1P/U/9T/1X/Vv9W/1X/Vf9V/1X/VP9U/1T/VP9W/1f/V/9W/1b/Vv9V/1X/Vf9V/1X/V/9Y/1j/V/9X/1b/Vv9W/1b/Vv9W/1b/WP9Z/1n/WP9Y/1f/V/9X/1f/V/9X/1n/Wv9a/1n/Wf9Y/1j/WP9Y/1j/WP9Y/1r/W/9b/1r/Wf9Z/1n/Wf9Z/1n/Wf9b/1z/W/9b/1r/Wv9a/1r/Wv9a/1r/Wv9c/1z/XP9c/1v/W/9b/1v/W/9b/1v/Xf9d/13/Xf9c/1z/XP9c/1z/XP9c/1z/Xv9e/17/Xv9d/13/Xf9d/13/Xf9d/13/Xv9f/1//X/9e/17/Xv9e/17/Xv9e/17/X/9g/2D/X/9f/1//X/9f/1//Xv9f/1//YP9h/2H/YP9g/2D/YP9g/1//X/9f/1//Yf9i/2L/Yf9h/2H/Yf9g/2D/YP9g/2D/Yv9j/2P/Yv9i/2L/Yf9h/2H/Yf9h/2H/Y/9k/2T/Y/9j/2L/Yv9i/2L/Yv9i/2L/ZP9l/2X/ZP9k/2P/Y/9j/2P/Y/9j/2P/Y/9l/2b/Zv9l/2X/ZP9k/2T/ZP9k/2T/ZP9m/2f/Zv9m/2X/Zf9l/2X/Zf9l/2X/Zf9n/2j/Z/9n/2b/Zv9m/2b/Zv9m/2b/Zv9m/2j/aP9o/2j/Z/9n/2f/Z/9n/2f/Z/9n/2f/af9p/2n/af9o/2j/aP9o/2j/aP9o/2j/av9q/2r/av9p/2n/af9p/2n/af9p/2n/af9q/2v/a/9r/2r/av9q/2r/av9q/2r/av9q/2v/bP9s/2v/a/9r/2v/a/9r/2v/a/9r/2v/bP9t/23/bP9s/2z/bP9s/2z/a/9r/2z/bP9t/27/bv9t/23/bf9t/23/bP9s/2z/bP9t/27/b/9v/27/bv9u/27/bf9t/23/bf9t/23/b/9w/3D/b/9v/2//bv9u/27/bv9u/27/bv9w/3H/cf9w/3D/b/9v/2//b/9v/2//b/9v/2//cf9y/3L/cf9x/3D/cP9w/3D/cP9w/3D/cP9y/3P/c/9y/3L/cf9x/3H/cf9x/3H/cf9x/3H/c/90/3P/c/9y/3L/cv9y/3L/cv9y/3L/cv90/3X/dP90/3P/c/9z/3P/c/9z/3P/c/9z/3P/df92/3X/df90/3T/dP90/3T/dP90/3T/dP90/3b/dv92/3b/df91/3X/df91/3X/df91/3X/d/93/3f/d/92/3b/dv92/3b/dv92/3b/dv92/3j/eP94/3j/d/93/3f/d/93/3f/d/93/3f/d/94/3n/ef95/3j/eP94/3j/eP94/3j/eP94/3j/eP95/3r/ev96/3n/ef95/3n/ef95/3n/ef95/3n/ev97/3v/ev96/3r/ev96/3r/ev96/3r/ev96/3v/fP98/3v/e/97/3v/e/96/3r/ev97/3v/e/97/3z/ff99/3z/fP98/3z/fP97/3v/e/97/3v/fP99/37/fv99/33/ff99/3z/fP98/3z/fP98/3z/fP9+/3//f/9+/37/fv99/33/ff99/33/ff99/33/ff9//4D/gP9//3//f/9+/37/fv9+/37/fv9+/37/gP+B/4H/gP+A/3//f/9//3//f/9//3//f/9//3//gf+C/4L/gf+B/4D/gP+A/4D/gP+A/4D/gP+A/4D/gP+C/4P/g/+C/4L/gf+B/4H/gf+B/4H/gf+B/4H/gf+D/4T/g/+D/4L/gv+C/4L/gv+C/4L/gv+C/4L/gv+E/4X/hP+E/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+F/4X/hf+F/4T/hP+E/4T/hP+E/4T/hP+E/4T/hP+E/4b/hv+G/4b/hf+F/4X/hf+F/4X/hf+F/4X/hf+F/4X/h/+H/4f/h/+G/4b/hv+G/4b/hv+G/4b/hv+G/4b/h/+I/4j/iP+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+I/4n/if+J/4j/iP+I/4j/iP+I/4j/iP+I/4j/iP+I/4n/iv+K/4n/if+J/4n/if+J/4n/if+J/4n/if+J/4n/iv+L/4v/iv+K/4r/iv+K/4r/if+K/4r/iv+K/4r/iv+K/4v/jP+M/4v/i/+L/4v/i/+L/4r/iv+K/4v/i/+L/4r/jP+N/43/jP+M/4z/jP+M/4v/i/+L/4v/i/+L/4v/i/+L/43/jv+O/43/jf+N/43/jP+M/4z/jP+M/4z/jP+M/4z/jv+P/4//jv+O/47/jf+N/43/jf+N/43/jf+N/43/jf+N/4//kP+Q/4//j/+P/47/jv+O/47/jv+O/47/jv+O/47/jv+Q/5H/kf+Q/5D/j/+P/4//j/+P/4//j/+P/4//j/+P/4//kf+S/5L/kf+R/5D/kP+Q/5D/kP+Q/5D/kP+Q/5D/kP+Q/5L/k/+S/5L/kv+R/5H/kf+R/5H/kf+R/5H/kf+R/5H/kf+R/5P/lP+T/5P/kv+S/5L/kv+S/5L/kv+S/5L/kv+S/5L/kv+U/5T/lP+U/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+V/5X/lf+V/5T/lP+U/5T/lP+U/5T/lP+U/5T/lP+U/5T/lv+W/5b/lv+V/5X/lf+V/5X/lf+V/5X/lf+V/5X/lf+V/5X/lv+X/5f/l/+W/5b/lv+W/5b/lv+W/5b/lv+W/5b/lv+W/5b/lv+X/5j/mP+Y/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+Y/5n/mf+Z/5j/mP+Y/5j/mP+Y/5j/mP+Y/5j/mP+Y/5j/mP+Z/5r/mv+Z/5n/mf+Z/5n/mf+Y/5j/mP+Z/5n/mf+Z/5n/mf+Z/5r/m/+b/5r/mv+a/5r/mv+Z/5n/mf+Z/5n/mf+Z/5n/mf+Z/5n/m/+c/5z/m/+b/5v/m/+b/5r/mv+a/5r/mv+a/5r/mv+a/5r/mv+c/53/nf+c/5z/nP+c/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/53/nv+e/53/nf+d/5z/nP+c/5z/nP+c/5z/nP+c/5z/nP+c/5z/nv+f/5//nv+e/53/nf+d/53/nf+d/53/nf+d/53/nf+d/53/nf+f/6D/oP+f/5//nv+e/57/nv+e/57/nv+e/57/nv+e/57/nv+e/57/oP+h/6H/oP+g/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/6H/ov+i/6H/of+g/6D/oP+g/6D/oP+g/6D/oP+g/6D/oP+g/6D/oP+i/6P/ov+i/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/of+h/6H/o/+j/6P/o/+i/6L/ov+i/6L/ov+i/6L/ov+i/6L/ov+i/6L/ov+i/6L/pP+k/6T/pP+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6X/pf+l/6X/pP+k/6T/pP+k/6T/pP+k/6T/pP+k/6T/pP+k/6T/pP+k/6X/pv+m/6b/pf+l/6X/pf+l/6X/pf+l/6X/pf+l/6X/pf+l/6X/pf+l/6b/p/+n/6f/pv+m/6b/pv+m/6X/pf+l/6b/pv+m/6b/pv+m/6b/pv+m/6f/qP+o/6f/p/+n/6f/p/+m/6b/pv+m/6b/pv+m/6b/pv+m/6b/p/+n/6f/qP+p/6n/qP+o/6j/qP+o/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/qP+p/6r/qv+p/6n/qf+p/6j/qP+o/6j/qP+o/6j/qP+o/6j/qP+o/6j/qP+q/6v/q/+q/6r/qv+p/6n/qf+p/6n/qf+p/6n/qf+p/6n/qf+p/6n/qf+p/6n/q/+s/6z/q/+r/6v/qv+q/6r/qv+q/6r/qv+q/6r/qv+q/6r/qv+q/6r/qv+s/63/rf+s/6z/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/rf+u/67/rf+t/6z/rP+s/6z/rP+s/6z/rP+s/6z/rP+s/6z/rP+s/6z/rP+s/67/r/+v/67/rv+t/63/rf+t/63/rf+t/63/rf+t/63/rf+t/63/rf+t/63/rf+v/7D/r/+v/67/rv+u/67/rv+u/67/rv+u/67/rv+u/67/rv+u/67/rv+u/67/sP+x/7D/sP+v/6//r/+v/6//r/+v/6//r/+v/6//r/+v/6//r/+v/6//r/+v/6//sf+x/7H/sf+w/7D/sP+w/7D/sP+w/7D/sP+w/7D/sP+w/7D/sP+w/7D/sP+w/7D/sv+y/7L/sv+x/7H/sf+x/7H/sf+x/7H/sf+x/7H/sf+x/7H/sf+x/7H/sf+x/7H/s/+z/7P/s/+y/7L/sv+y/7L/sv+y/7L/sv+y/7L/sv+y/7L/sv+y/7L/sv+y/7L/sv+z/7T/tP+0/7P/s/+z/7P/s/+y/7L/sv+z/7P/s/+z/7P/s/+z/7P/s/+z/7P/s/+0/7X/tf+0/7T/tP+0/7T/s/+z/7P/s/+z/7P/s/+z/7P/s/+z/7T/tP+0/7T/tP+0/7T/tf+2/7b/tf+1/7X/tf+0/7T/tP+0/7T/tP+0/7T/tP+0/7T/tP+0/7T/tf+1/7X/tf+2/7f/t/+2/7b/tv+2/7X/tf+1/7X/tf+1/7X/tf+1/7X/tf+1/7X/tf+1/7X/tv+2/7b/t/+4/7j/t/+3/7f/tv+2/7b/tv+2/7b/tv+2/7b/tv+2/7b/tv+2/7b/tv+2/7b/tv+2/7j/uf+5/7j/uP+3/7f/t/+3/7f/t/+3/7f/t/+3/7f/t/+3/7f/t/+3/7f/t/+3/7f/t/+5/7r/uv+5/7n/uP+4/7j/uP+4/7j/uP+4/7j/uP+4/7j/uP+4/7j/uP+4/7j/uP+4/7j/uP+6/7v/u/+6/7r/uf+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+5/7n/uf+7/7z/vP+7/7v/uv+6/7r/uv+6/7r/uv+6/7r/uv+6/7r/uv+6/7r/uv+6/7r/uv+6/7r/uv+6/7z/vf+8/7z/u/+7/7v/u/+7/7v/u/+7/7v/u/+7/7v/u/+7/7v/u/+7/7v/u/+7/7v/u/+7/73/vv+9/73/vP+8/7z/vP+8/7z/vP+8/7z/vP+8/7z/vP+8/7z/vP+8/7z/vP+8/7z/vP+8/7z/vP++/77/vv++/73/vf+9/73/vf+9/73/vf+9/73/vf+9/73/vf+9/73/vf+9/73/vf+9/73/vf+9/7//v/+//7//vv++/77/vv++/77/vv++/77/vv++/77/vv++/77/vv++/77/vv++/77/vv++/77/vv/A/8D/wP/A/7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v/+//7//v//A/8H/wf/B/8D/wP/A/8D/wP/A/8D/wP/A/8D/wP/A/8D/wP/A/8D/wP/A/8D/wP/A/8D/wP/A/8D/wf/C/8L/wf/B/8H/wf/B/8D/wP/A/8D/wf/B/8H/wf/B/8H/wf/B/8H/wf/B/8H/wf/B/8H/wf/B/8H/wf/C/8P/w//C/8L/wv/C/8L/wf/B/8H/wf/B/8H/wf/B/8H/wf/B/8L/wv/C/8L/wv/C/8L/wv/C/8L/wv/D/8T/xP/D/8P/w//D/8L/wv/C/8L/wv/C/8L/wv/C/8L/wv/C/8L/wv/C/8P/w//D/8P/w//D/8P/w//D/8P/xP/F/8X/xP/E/8T/xP/D/8P/w//D/8P/w//D/8P/w//D/8P/w//D/8P/w//D/8P/w//D/8P/w//D/8P/w//F/8b/xv/F/8X/xf/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xP/E/8T/xv/H/8f/xv/G/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/xf/F/8X/x//I/8j/x//H/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/xv/G/8b/yP/J/8n/yP/I/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//J/8r/yv/J/8n/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8j/yP/I/8r/y//K/8r/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/J/8n/yf/L/8z/y//L/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/K/8r/yv/M/8z/zP/M/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//L/8v/y//N/83/zf/N/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/M/8z/zP/O/87/zv/O/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zf/N/83/zv/P/8//z//O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/87/zv/O/8//0P/Q/9D/z//P/8//z//P/87/zv/O/8//z//P/87/zv/O/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//P/8//z//Q/9H/0f/Q/9D/0P/Q/9D/z//P/8//z//P/8//z//P/8//z//P/8//z//Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9H/0v/S/9H/0f/R/9H/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9D/0P/Q/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0v/T/9P/0v/S/9L/0v/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9H/0f/R/9P/1P/U/9P/0//T/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9L/0v/S/9T/1f/V/9T/1P/U/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/0//T/9P/1f/W/9b/1f/V/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9T/1P/U/9b/1//X/9b/1v/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/V/9X/1f/X/9j/2P/X/9f/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9b/1v/W/9j/2f/Y/9j/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/1//X/9f/2f/a/9n/2f/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2P/Y/9j/2v/a/9r/2v/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/Z/9n/2f/b/9v/2//b/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/2v/a/9r/3P/c/9z/3P/b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/2//b/9v/3P/d/93/3f/c/9z/3P/c/9z/2//b/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3P/d/97/3v/e/93/3f/d/93/3P/c/9z/3P/c/9z/3P/c/9z/3P/c/9z/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/e/9//3//e/97/3v/e/97/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3f/d/93/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/9//4P/g/9//3//f/9//3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/e/97/3v/f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/+D/4f/h/+D/4P/g/+D/3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//f/9//3//h/+L/4v/h/+H/4f/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/g/+D/4P/i/+P/4//i/+L/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4f/h/+H/4//k/+T/4//j/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/5P/l/+X/5P/k/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/4//j/+P/5f/m/+b/5f/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+T/5P/k/+b/5//m/+b/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/l/+X/5f/n/+j/5//n/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/m/+b/5v/o/+j/6P/o/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+n/6f/p/+n/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+j/6P/o/+r/6v/q/+r/6f/p/+n/6f/p/+j/6P/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/p/+r/6//r/+v/6v/q/+r/6v/p/+n/6f/p/+n/6f/p/+n/6f/p/+n/6f/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v/q/+r/6v9MSVNUGAAAAElORk9JVFJLDAAAAC0xMTQyMzU4MDE2AF9QTVgNAQAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNS4xLjIiPgogPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgeG1sbnM6eG1wRE09Imh0dHA6Ly9ucy5hZG9iZS5jb20veG1wLzEuMC9EeW5hbWljTWVkaWEvIgogICB4bXBETTpjb21wb3Nlcj0iIi8+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoA';

const base64DrumSample = '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cP/4/yIA0P9v/0j/Wf92/33/Qf+x/gj+n/22/V/+cf9WAE0ASf86/hL+v/5k/3r/Tf8w/xb/xf5r/j/+WP6q/kz/EAB6AFAA6P/A/63/Q/+Z/lj+rP7m/oX+Hf6I/qj/TQDd//r+nv7a/hP/Ff9L/9z/TwDp/8j+5f3p/aD+NP9R/0z/Rv8C/4X+Zv4D/5//W/+M/l3+Sv9XAE0ATv+O/tj+xP9RAPz/8f7v/ar9YP6X/00A3/+//vr9Bv5z/qf+jf6m/kX/7f/p/yf/YP40/r7+pP9nAIwA/f8p/7D+vf7d/sf+2/5v//f/mv99/tr9Yv5m/5P/xP4t/rH+5v+fAFsAvP+K/7D/eP+1/i3+nP6R/9T/8P7n/ej94f6c/1X/kP4t/lH+n/79/qf/bwCGAI3/Uv79/b/+pP+V/7T+/P00/iL/6P/P/+n+F/4l/v/+tv+u/0j/Uf/a/wwAhf/T/qv+6P7W/lL+7/1G/lT/YgCRAKH/Uf7K/ZL+3/9WAKn/zP6y/if/NP+H/uT9H/4W/8T/ov8v/0f/8/9cAOX/Bf96/oT+zv4Y/zn/Hf+4/nD+rP40/2z/Rv9N/7D/7P+m/0X/Uv+0/+D/tP9y/13/bv91/2f/Vv9X/17/Zf9o/2L/X/9h/2b/av9s/3X/ev97/3r/eP93/3f/cf9u/2//cf9z/3v/f/+A/3//fv9//4D/gP+B/4L/hf+B/37/f/+C/4T/jP+Q/5H/j/+P/47/j/+I/4X/gf+C/4v/kv+a/53/nP+Z/5j/l/+X/5f/kP+O/4//mv+h/6H/n/+e/53/nv+e/57/nv+Y/5b/l/+a/6P/qf+q/6n/p/+n/6b/pv+g/53/nv+n/6f/pP+j/6v/sv+z/7H/r/+u/6//r/+v/6//r/+p/6b/p/+q/6z/tf+6/7r/uP+3/7b/tv+v/6v/rP+v/7H/uf+9/73/u/+7/7v/uv+z/6//r/+y/7T/vP+//7//vf+8/7v/uv+7/7z/vP+7/7T/sf+y/7r/uP+1/7T/u//A/8D/vv+8/73/vv+9/7b/sf+y/7v/wP/A/73/vP+7/7v/u/+6/7v/vP+2/7L/sv+7/8D/wP++/7z/u/+7/7v/tP+w/6r/q/+1/7v/w//E/8P/wP++/73/u/+0/7D/sf+z/7X/vf/C/8L/wP++/7z/vP+7/7v/uv+6/7T/sf+y/7T/tf+9/8L/wv/A/77/vf+8/7X/sf+y/7T/tv+3/77/wf/B/7//vv++/77/vf+1/7L/sv+7/8D/wP++/73/vP+8/7v/u/+6/7z/tv+z/7P/vP/A/8H/vv+9/7z/vP+8/7T/sf+x/7r/uv+4/7f/vv/C/8H/v/+9/7z/u/+7/7T/sP+x/7r/v/+4/7X/tP+9/8H/wP++/7z/u/+7/7T/sP+w/7L/tP+7/7//vv++/73/vP+7/7P/r/+v/7H/s/+7/77/vv+8/7r/uf+4/7n/uf+5/7j/sf+u/67/t/+1/7H/sP+3/7z/vP+5/7f/tv+x/67/rv+v/7H/sf+4/7v/u/+4/7b/tf+1/7T/s/+z/6z/qf+r/7X/uv+5/7b/tf+0/7T/s/+r/6j/qP+r/63/tP+3/7f/tv+1/7T/s/+y/7H/qv+n/6f/qf+r/7L/tf+1/7P/sf+w/7H/sf+x/7D/qf+l/6b/qP+p/7D/tP+z/7H/sP+v/67/p/+j/6X/qP+q/6r/sP+z/7P/sf+u/63/rP+s/6X/of+i/6T/rf+w/7L/sP+v/63/rP+r/6v/qv+j/6D/of+q/67/rv+s/6v/qv+q/6v/pP+h/6H/qf+n/6T/o/+q/67/rv+s/6r/qf+o/6j/of+d/5//qf+u/6f/of+g/6j/rf+s/6r/qP+n/6H/nf+W/5X/nv+k/67/sf+v/6z/qf+o/6f/pv+l/57/m/+c/57/pv+q/6n/p/+m/6f/p/+m/6X/pP+e/5r/m/+k/6j/qP+m/6X/pP+k/6P/o/+i/5v/mv+V/5T/nP+i/6r/rP+q/6f/pf+k/6P/ov+i/6L/m/+Y/5j/nP+l/6n/qP+l/6T/o/+i/6L/m/+X/5j/mv+j/6f/pv+k/6L/ov+j/6P/ov+b/5f/mP+a/5z/o/+m/6b/pP+i/6H/of+g/6D/n/+Z/5f/mf+b/5z/o/+m/6b/o/+i/6H/oP+Z/5X/lv+Y/5r/m/+i/6X/p/+l/6P/of+g/6D/mf+V/5b/mP+g/6T/pP+i/6D/oP+f/5//nv+e/5n/l/+X/5n/of+l/6T/ov+g/6D/n/+Y/5T/lf+X/5n/mv+a/6H/pv+n/6T/ov+g/5//n/+Y/5T/lf+X/6D/nf+Z/5j/n/+k/6T/of+f/6D/mv+X/5D/jv+X/53/pf+n/6X/o/+h/6D/n/+e/53/lv+U/5T/l/+h/6X/pf+i/6D/n/+f/57/nv+d/5f/lP+V/5f/n/+j/6P/of+f/5//oP+g/6D/mP+V/4//jv+X/53/pf+n/6X/o/+h/6D/n/+e/57/nf+X/5b/l/+Z/6H/pP+k/6L/oP+f/5//n/+X/5T/lf+X/6D/pP+k/6L/oP+f/6D/of+g/5//mP+V/5b/mP+g/6T/pP+i/6D/oP+f/5//nv+e/5f/lf+V/5n/ov+m/6X/o/+h/6D/oP+f/5j/lf+V/5j/mv+b/6L/pf+l/6P/of+g/6H/m/+X/5f/mf+b/6L/pv+l/6P/of+h/6D/n/+f/5//mP+V/5b/mP+h/6b/p/+l/6P/ov+h/6H/oP+g/5n/lv+X/5n/of+l/6X/o/+i/6H/of+g/5v/mP+Z/5v/o/+n/6b/pP+j/6L/of+h/6D/oP+Z/5f/kf+Q/5n/n/+n/6r/qv+o/6b/pP+j/6L/of+a/5f/mP+a/6P/pv+m/6T/o/+i/6L/of+h/6H/mv+Z/5v/nf+l/6j/p/+l/6T/o/+j/6L/ov+b/5j/kv+R/5r/oP+p/6v/qf+o/6f/pv+e/5n/mf+i/6H/nv+c/53/pf+p/6j/pf+k/6P/o/+j/5z/mP+Z/5v/n/+h/6H/oP+n/6r/qv+n/6X/pP+k/53/mf+a/6L/qP+o/6b/pP+k/6T/o/+k/6X/nv+b/5v/nf+m/6r/qf+n/6b/pf+l/6T/nf+a/5r/nf+f/6D/p/+q/6r/qv+p/6f/pv+f/5v/m/+e/6D/p/+r/6r/qf+n/6b/pf+l/6T/pP+e/5v/nP+e/6H/qv+t/6z/qv+o/6f/p/+m/6X/n/+c/5z/n/+n/6v/q/+p/6f/p/+m/6b/n/+d/5//of+p/63/rP+q/6n/qP+n/6f/pv+m/6D/nf+d/6D/ov+i/6n/rf+t/6v/qf+q/6P/oP+f/6j/pv+j/6L/qf+t/67/q/+p/6j/qP+o/6j/p/+h/57/n/+h/6P/o/+s/7H/sP+u/6v/qv+q/6P/n/+f/6L/pP+r/6//rv+s/6v/qv+p/6L/n/+f/6j/rv+p/6X/pP+s/7D/sP+t/6v/q/+r/6r/o/+g/6D/qf+o/6X/pP+r/7D/sP+u/6z/q/+t/63/pv+i/6L/q/+w/7D/rv+s/6z/rP+r/6v/q/+r/6T/of+i/6v/sP+w/67/rf+t/67/r/+n/6P/o/+m/6j/qP+v/7P/s/+x/6//rv+t/6b/o/+j/6X/qP+v/7P/s/+x/6//sP+w/6//rv+u/6f/pP+e/53/pv+s/7X/t/+1/7P/sf+w/6//qP+k/57/nf+n/63/tf+5/7j/tf+z/7H/sP+v/6j/pf+m/6//tP+0/7L/sf+w/7D/r/+v/6//qP+l/6b/qf+r/6v/tP+4/7j/tv+z/7L/q/+n/6f/sP+u/6z/q/+y/7f/t/+0/7L/sf+x/7H/sf+x/7H/qv+n/6r/rf+u/7X/uP+4/7b/tf+0/7P/rP+o/6n/q/+t/7X/uP+4/7b/tf+0/7P/rP+p/6n/sv+5/7v/uf+2/7X/tf+0/7T/s/+z/7P/tP+t/6r/q/+0/7L/r/+u/7X/uv+6/7j/tv+2/7X/tf+w/63/rf+2/7v/u/+5/7f/tv+2/7b/tf+1/7X/r/+s/63/tv+7/7v/uf+4/7f/t/+3/7D/rP+o/6j/sf+3/7//wf+//7z/uv+5/7j/sf+t/67/sP+z/7r/vv+9/7v/uv+5/7j/uP+4/7j/uP+z/7H/sf+z/7T/u/+//7//vf+7/7r/uv+z/6//qf+o/7L/uP/A/8P/wf++/73/u/+6/7r/s/+x/7P/vP/A/8D/vv+8/7v/u/+7/7r/uv+6/7T/sf+y/7v/wP/A/77/vf+8/7z/vP+1/7H/sv+7/7v/uf+4/7//w//D/8D/vv+9/73/vf+9/7z/vP+9/73/tv+z/7P/vP/B/8L/wP+//77/vv+3/7P/tP+4/7v/wv/F/8X/wv/B/8D/v/+4/7T/tP+3/7n/wf/E/8T/wv/B/8D/v/+//77/vv++/7j/tf+2/77/vv+8/7v/wv/G/8b/xP/C/8H/uv+3/7f/uf+7/7z/w//G/8b/xP/C/8H/wf/A/8D/wP+5/7f/t//A/8f/yP/G/8T/w//C/8L/u/+3/7H/sP+6/0xJU1QOAAAASU5GT0lUUksCAAAAMABfUE1YDQEAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuMS4yIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgIHhtbG5zOnhtcERNPSJodHRwOi8vbnMuYWRvYmUuY29tL3htcC8xLjAvRHluYW1pY01lZGlhLyIKICAgeG1wRE06Y29tcG9zZXI9IiIvPgogPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KAA==';

const base64HihatSample = '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0wbUBtoG4AbhBuEG4gbiBt0G3AbeBuQG4wbiBuIG6AbsBuwG6gbpBukG6AboBugG5gblBuAG3gbdBt4G3wbjBuUG5AbhBuAG3gbcBtYG0gbQBs8G0AbVBtUG1AbRBs4GzAbKBsMGvwa+BsIGxQbEBsAGvga8BrkGtga1BrQGsQaxBq8GqAalBqQGqAamBqIGnwakBqYGpAahBp4GmwabBpkGkQaOBo0GkQaVBpMGkAaOBowGigaJBocGhQaEBn4GegZ6Bn8GgQaABn4GegZ5BngGdgZwBmwGagZrBmwGagZvBnAGbgZsBmkGZgZlBl8GWgZaBloGWQZeBmAGXQZbBlgGVgZVBlMGUAZQBk4GRwZEBkMGRAZEBkcGSQZHBkMGQQY/BjwGNgYyBjAGMQYxBi8GMwY0BjIGLwYsBikGJwYlBh8GGwYZBh8GIQYeBhwGGAYWBhQGEgYPBg4GDAYGBgIGAAYFBgcGBAYBBv4F+wX6BfcF7wXrBeoF7wXsBecF5AXoBegF5wXjBd8F3QXbBdkF1wXTBdIFzwXNBcYFwQW/BcQFxQXFBcEFvQW7BbgFsAWsBaoFqgWpBawFrQWqBaYFowWgBZ4FlgWQBY8FjgWNBZEFkQWQBYwFiAWFBYIFfwV9BXsFegVyBW0FbAVwBWwFaAVlBWkFagVnBWQFYAVdBVYFUQVQBU8FTQVMBVAFUQVOBUoFRwVEBUAFPwU8BTsFNAUvBS0FMgU1BTIFLgUrBSkFKAUlBR0FGQUXBRYFFgUVBRkFGgUWBRMFEAUOBQwFAwX/BPcE+wT+BP4EAQUBBf8E/AT3BPUE8gTxBO8E7ATmBOIE4QThBN8E4wTkBOME4ATcBNoE2ATSBM0EygTLBMsEywTOBM4EzATJBMcExATBBL8EuAS1BLQEuAS7BLkEtwS0BLEErwStBKwEqgSpBKMEngSdBKIEpQSkBJ8EnQSbBJsEmQSRBI0EjASSBI8EjASJBIwEjwSNBIsEiASFBIQEggR8BHgEdwR8BH4EeARzBHEEdgR3BHYEcwRxBHAEbwRoBGMEYgRiBGMEZwRpBGgEZARiBGAEXwRdBFwEVQRRBFAEUQRXBFgEVgRUBFEEUARPBE4ETARJBEQEQARBBEYERARABD8EQwREBEMEQAQ/BD0EPAQ2BDEEMAQxBDIENgQ5BDcEMwQyBDAELwQtBC0EKwQkBCIEIQQjBCgEKgQpBCcEJAQiBCEEHwQaBBYEFgQXBB0EHwQdBBsEGQQYBBYEFgQUBA8ECwQKBAsEDAQRBBMEEgQQBA4EDAQKBAkECAQIBAIE/wP/AwAEAAQEBAYEBQQEBAEEAQT/A/oD9gP2A/cD9gP3A/sD/gP9A/sD+AP3A/YD9QPvA+sD6wPsA/MD9QP0A/ID8APvA+4D7QPrA+oD5QPjA+ID6QPsA+wD6QPoA+YD5APkA94D2wPbA90D3QPeA90D4gPkA+QD4QPfA90D3APbA9UD0wPSA9QD2gPYA9QD0wPXA9sD2gPYA9UD0wPOA8sDywPFA8oDzQPUA9YD1QPRA9ADzgPOA8wDzAPGA8IDwgPDA8oDzAPMA8kDyAPHA8cDxQPFA8QDvwO8A7wDvQPEA8UDxQPDA8ADvwO+A74DvQO4A7UDrwOzA7kDugO/A78DvwO8A7sDuQO0A7UDtwO4A7MDrwOvA68DtgO3A7UDtAOyA7IDsQOxA6sDqAOoA6oDrwOyA7EDsAOuA60DrAOsA6oDqgOkA6IDogOjA6kDrAOrA6kDpwOnA6YDpQOkA6QDngOcA5sDnQOeA6MDpQOlA6IDoQOgA58DmQOWA5YDmAOYA5kDnQOgA58DnQObA5oDmQOUA5ADkAORA5MDmAOaA5kDmAOVA5UDkwOTA5IDkgOMA4oDiQOLA5EDkwOSA5EDjwOOA40DjQOMA4wDhgODA4MDhQOKA40DjAOLA4kDiAOHA4cDgAN+A30DfwOFA4gDhwOAA4EDgwODA4IDgAOAA3oDeAN3A3IDdgN6A4ADgwOCA38DfgN8A3sDeQN5A3MDcQNwA3IDdwN6A3kDeAN2A3UDdAN0A3IDcgNsA2oDagNsA3EDdANzA3EDcQNvA28DbQNtA2YDZANdA2IDZwNpA20DbgNtA2sDaQNoA2EDXwNeA2UDZANhA2ADXwNlA2cDZgNjA2IDYQNhA18DWgNXA1cDWANZA1sDWgNfA2ADYANdA1wDWgNaA1kDUwNQA1ADVgNaA1sDWANXA1UDVQNUA1MDUgNNA0oDSwNLA1IDVANUA1MDUQNQA08DTgNIA0UDRANGA0cDSANMA08DTwNNA0sDSQNIA0IDPwM/A0EDQQNHA0kDSANIA0UDRANDA0IDQQNBAzsDOQM4AzoDPANBA0MDQgNAAz4DPQM8AzwDOgM1AzQDNAM1AzoDPQM8AzoDOAM4AzYDNgMxAy4DLgMvAzYDOAM3AzUDNAM0AzMDMgMxAzADKgMoAygDKQMsAysDMAMyAzIDLwMuAywDLAMsAysDKwMlAyIDIgMoAysDKwMqAygDKAMnAyYDJQMlAx8DHQMeAx8DJQMnAycDJAMjAyIDIQMiAyEDGwMYAxgDGQMbAyEDIwMiAyADHgMdAxwDFgMTAxUDGwMeAxgDFQMTAxkDHQMdAxoDGAMYAxcDFwMSAw8DDwMUAxMDEAMPAxUDGAMYAxUDFAMSAxIDEwMNAwoDCQMQAxMDEwMSAxADEAMOAw4DDQMNAwgDBQMGAwYDDQMPAw8DDgMMAwwDCgMKAwMDAQMCAwMDBQMEAwkDCwMLAwoDCAMHAwYDAAP/Av4CAAMAAwYDCAMHAwcDBQMEAwIDAgMBAwED/QL6AvMC8QL5AgADBgMHAwQDAgMAA/8C/wL+AvgC9QL2AvgC+QL+AgAD/wL9AvwC/AL7AvsC9ALyAvMC+QL9AvwC+wL6AvkC+QL3AvcC9gLxAvAC7wLxAvEC8gL4AvoC+gL3AvYC9gLwAu0C7ALzAvIC8ALuAvMC9gL3AvUC8wLxAvEC8ALwAvEC8ALrAugC6ALrAusC8QLyAvIC8gLwAu8C7gLoAuYC5gLoAugC7gLxAvAC7wLsAuwC7ALmAuMC4gLpAu4C7gLsAuoC6gLqAukC6QLnAucC6ALoAuMC3wLgAucC5QLjAuEC5wLrAuoC6QLmAuYC5gLlAuAC3gLdAuQC5wLnAuYC5ALkAuMC4wLjAuIC4gLcAtoC2wLhAuUC5ALjAuIC4QLhAuEC2wLYAtgC2gLcAtwC4QLjAuMC4gLgAt8C3QLYAtYC1gLYAtoC3wLhAuAC3wLeAt0C3ALbAtoC2wLbAtYC1ALUAtUC1QLbAt4C3QLcAtoC2QLaAtQC0QLSAtMC1ALUAtkC3ALbAtoC2QLXAtcC1QLQAs8CzgLVAtgC2ALXAtYC1QLVAtQC1ALSAtICzgLMAswC0wLWAtYC1ALSAtMC0gLSAs0CyQLKAtACzgLNAssC0QLVAtQC0gLPAs8C0ALPAs4CzwLOAskCxwLHAsgCyALOAtEC0ALPAs4CzQLMAsYCwwLEAsUCxwLNAs8CzgLMAssCywLJAsQCwgLBAsMCxQLKAswCywLKAskCyALHAscCxgLGAsYCwQK+Ar4CxALEAsECvwLGAsgCyALHAsUCxALDAsMCvgK7ArsCvQLDAsYCxgLEAsICwQLAAsECvwK/ArsCuAK4Ar8CwgLCAsECvwK/Ar0CvQK4ArUCtQK4ArgCuQK/AsACwAK/ArwCvAK6ArUCswKyArQCtgK7Ar0CvQK7AroCuQK4ArcCuAK3ArYCsAKuAq8CsAKxArcCuQK5ArgCtgK1ArUCrwKsAqwCrQKvArACtAK2ArUCswKzArECsAKxAqsCqAKpAq8CsgKzArECrwKvAq4CrgKuAqwCrAKoAqUCpQKqAq4CrwKtAqsCqwKqAqoCpQKhAqICqQKnAqUCpAKoAqwCrAKpAqgCpwKmAqYCoQKeAp4CpQKoAqMCnwKeAqQCqAKnAqUCpAKiAqICngKaApoCmgKbAqICpAKjAqICoAKfAp8CmQKWApYClwKZApoCngKgAqECngKcApwCmgKaApoCmQKUApICkQKYApcClAKSApgCmwKbApkClwKWApYCkAKNAo4CjgKQApYClwKXApYCkwKTApMCkQKRApECiwKIAokCigKQApMClAKRApACjwKOAo0CiAKFAoUChwKNAo8CkAKNAowCiwKKAokCiQKDAoECggKCAoQCigKLAosCigKHAoYChgKFAoQChQJ/AnwCfQJ+An8ChAKGAoYChQKEAoICgQJ8AngCeAJ6AnsCewKBAoICggKBAn4CfQJ9AnwCdgJ0AnQCdQJ8An4CfQJ8AnwCegJ5AnkCdwJ3AnICbwJvAnYCeQJ5AngCdQJ1AnUCdAJuAmwCbQJzAnECbwJtAnICdgJ1AnMCcQJwAm8CcAJpAmYCZwJpAm8CbAJqAmgCbQJwAm8CbQJsAmsCZQJjAmICXAJiAmcCbQJuAm0CagJoAmgCZgJlAmUCXwJdAl0CYAJlAmcCZwJlAmMCYwJiAmECYQJgAloCWQJaAloCYAJjAmICYAJfAl4CXQJdAlsCVgJUAk8CTAJUAloCYAJhAl8CXAJaAloCWgJYAlcCVwJRAk4CTwJQAlUCWQJXAlYCVQJVAlQCUwJOAkoCSgJMAlICVAJVAlQCUQJQAlACTgJOAk4CSAJFAkYCSAJOAlACUAJNAkwCTAJMAkoCSQJJAkMCQQJCAkICQwJJAkwCSwJJAkgCRgJFAkACPQI9Aj8CQQJAAkUCSAJGAkUCQwJDAkECQQI8AjgCOAI6AkACQgJCAkECPwI+Aj4CPAI8AjwCNwI0AjQCNgI7Aj4CPgI9AjoCOQI5AjgCNwI3AjMCLwIvAjECNwI5AjkCNwI1AjUCNQI0Ai4CKwIrAiwCMwI3AjUCLgIwAjECMgIxAjECLwIpAicCJwIhAiYCKwIxAjMCMgIvAi0CLQItAisCKgIlAiMCIgIkAioCLAIrAioCKQIoAicCJwIlAiUCIAIfAh4CHwImAicCJwImAiUCIwIiAiICIQIbAhkCFAIYAhwCHwIkAiUCIwIiAiACHgIZAhcCFgIcAhsCGAIWAhcCHgIfAh4CHQIcAhoCGQIZAhMCEAIRAhMCGAIbAhsCGAIXAhYCFwIVAhQCFAIQAgwCDAIOAhMCFgIWAhUCEwISAhICEgIQAhACCwIIAggCCgIRAhICEgIQAhACDgINAg0CBwIEAgQCBwIHAgcCDQIQAg8CDAILAgsCCQIDAgECAAICAgMCCgILAgoCCQIIAgYCBQIFAgQCAwL/Af0B/AH+Af8BBQIHAgYCBQIEAgICAQIBAgEC+wH4AfkB+QH/AQMCAwIAAv8B/gH/Af0B9wH1AfYB9gH8AQAC/gH8AfwB/AH6AfkB+QH5AfMB8AHrAeoB8QH2Af0B/wH8AfoB+AH4AfYB9QH1AfMB7gHsAe0B8wH2AfYB9QHzAfIB8gHyAfEB8AHrAeoB6QHqAfEB9AHzAfEB8AHwAe4B7QHtAecB5AHfAeUB6AHqAe8B8QHwAe4B7AHsAeUB4gHiAekB7AHnAeMB4wHoAesB6wHqAecB5gHnAecB4QHdAd4B5QHjAeAB3wHlAegB5wHmAeUB4wHiAeIB3gHaAdkB4AHlAeQB4gHhAeEB4AHfAd8B3wHZAdYB1wHZAd4B4QHhAeAB3gHdAdwB3QHWAdMB1AHWAdYB1gHcAd8B3gHcAdoB2gHZAdMB0AHRAdIB0wHZAdwB2gHYAdcB1wHVAdUB1AHVAc8BzAHNAc8BzwHUAdcB1wHVAdMB0wHTAdMB0QHLAckBygHLAcwB0QHUAdMB0QHQAdABzwHJAcYBxwHIAc4B0QHRAc8BzQHNAc0BywHKAcoBxgHDAcMBxQHHAcgBywHNAc0BzAHKAcgBwwHBAcABxgHFAcQBwgHHAcoBywHIAcYBxQHGAcYBxQHEAcQBvwG8AbwBvQG/AcQBxgHGAcUBwwHCAcIBvQG7AboBuwG8AcMBxAHDAcIBwQG/Ab4BuQG3AbYBvAHBAb0BuQG3Ab0BwAHBAb4BvAG8AbwBuwG1AbMBtAG5AbgBtgG1AbsBvQG9AbsBugG4AbgBuAGzAa8BrwG2AbsBuwG4AbYBtgG3AbUBtAG0AbUBsQGtAa0BtAG4AbcBtQG0AbQBswGyAa0BqwGsAawBrQGuAbQBtQG0AbMBsgGwAa8BqgGoAakBqQGqAbABswGyAbABrwGvAa8BrQGsAawBrQGnAaQBpQGnAakBrQGvAa8BrgGsAaoBqgGlAaMBogGjAaUBpgGqAawBrAGrAaoBqAGnAacBogGfAZ8BpgGqAasBqAGmAaYBpgGlAaQBpAGfAZ4BnQGeAaUBqAGnAaUBpAGkAaQBogGcAZoBmwGhAZ8BnQGdAaMBpQGkAaIBogGgAZ8BnwGgAaABngGZAZcBmAGaAZoBngGhAaIBnwGeAZ0BnQGZAZUBlAGWAZgBngGgAZ8BnQGdAZsBmgGUAZIBkwGUAZUBmwGeAZ0BmgGZAZkBmQGYAZcBlwGXAZMBjwGPAZYBlQGTAZEBlgGZAZoBlwGVAZUBlQGWAY8BjAGMAY8BlgGXAZYBlQGUAZMBkgGSAZIBkgGMAYkBigGRAZYBlAGSAZEBkQGSAZABigGHAYgBiQGKAYsBkQGUAZMBkAGPAY8BjwGIAYUBhQGIAYoBjgGQAZABjwGOAYwBiwGLAYsBjAGKAYUBgwGEAYQBhQGLAY4BjgGLAYoBiQGJAYUBgAGAAYIBhAGFAYkBiwGLAYoBiQGHAYYBhgGBAX8BfgGEAYgBiQGIAYUBhAGEAYUBhQGDAYIBfgF8AX0BgwGFAYYBhQGEAYMBggGCAX0BewF6AYABfwF+AX0BgQGEAYQBgwGCAYABfwF/AXsBeAF3AX0BgQF9AXoBeAF9AYEBggGBAX4BfQF9AXkBdgF1AXYBdwF+AYEBfwF9AXwBfAF8AXUBcgFyAXUBdwF7AX0BfQF8AXwBeQF4AXgBeAF5AXcBcgFwAXEBeAF1AXIBcQF4AXwBegF4AXcBdwFyAW4BbgFvAXEBcgF4AXkBeAF3AXYBdgF0AXMBcwFzAW8BawFrAXIBdgF3AXQBcgFyAXIBcwFsAWgBaQFsAW4BcgF0AXQBcwFyAXIBcAFvAW4BagFoAWcBaAFqAXABcwFyAW8BbgFuAW8BbQFsAWwBaAFmAWcBZwFnAW0BcAFwAW4BbAFrAWwBZwFjAWIBZAFmAWgBbQFuAW0BbAFrAWoBaQFoAWMBYQFiAWIBaAFrAWsBagFqAWcBZgFmAWYBZwFgAV0BXgFmAWoBaQFmAWUBZgFmAWYBXwFcAVwBZAFjAWABXgFkAWgBaAFnAWMBYgFiAWMBXgFaAVkBYAFlAWEBXQFbAWABZAFlAWMBYQFgAVsBWQFaAVQBWAFbAWMBZgFlAWEBXwFfAV8BXwFeAVgBVQFWAVgBXwFgAV8BXgFdAV4BXQFbAVoBWgFWAVQBVAFZAV0BXgFdAVwBWgFZAVkBWgFaAVUBUQFKAUkBUgFZAV4BXgFdAVwBWwFaAVgBVgFWAVcBUgFPAU4BUAFXAVoBWgFXAVYBVQFWAVYBUQFNAU0BTwFWAVkBWAFVAVQBVAFVAVQBUgFMAUoBTAFOAU8BUwFVAVUBVQFUAVMBUQFQAVABUQFMAUgBSAFKAUwBUgFVAVMBUQFQAVABUAFLAUcBRgFIAUoBTAFRAVIBUQFQAU8BTwFOAUwBRgFEAUUBSAFNAU8BTwFOAU0BTQFLAUoBSgFKAUYBRAFDAUQBSgFOAU4BTQFKAUkBSQFJAUkBSQFDAUABQAFDAUoBTQFLAUkBSAFIAUgBSAFBAT4BPgFBAUgBRgFCAUABRgFKAUoBSAFFAUQBPwE9AT4BOQE8AUABRwFKAUkBRwFEAUMBQwFDAUMBPgE6AToBPAFDAUYBRgFDAUEBQQFBAUEBQQE/AToBOAE5ATsBQgFDAUIBQQFAAUABQAE+AT0BOAE2ATEBNgE6ATsBQAFDAUIBQQE+ATwBNwE6AT0BPgE3ATQBNAE2AT0BQAE+ATwBOwE7ATsBOwE2ATIBMQE0ATsBPgE+ATsBOQE5ATkBOQE5ATcBMQEvATEBMwE5ATsBOgE4ATgBOAE4ATcBNQE1ATABLgEvATEBNgE4ATgBNwE2ATYBNAEzAS4BLAEtAS8BLwEvATQBOAE4ATYBNQEzATIBLQEqASsBLQEtATIBNQE1ATQBMwExATABLwEwATABKwEpASgBKQEwATMBMwEyAS8BLgEuAS4BLgEuASoBJgEmAScBLgEyATIBLwEtAS0BLQEtASgBJQEkASUBLAEwATABKQEpASsBLAEsASsBKwEmASIBIgEdASIBJwEuAS8BLQErASsBKgEqASkBJwEhAR8BIQEjASkBKgEqASgBKAEoASgBJwElASUBIAEeAR8BIQEmASgBKAEnASYBJgEmASQBIwEeARwBFgEcASEBIgEmASgBKAEnASUBIwEcARoBGwEiASEBHwEcARwBIgEmASUBJAEiASABIAEgARsBGQEZASABHQEaARkBIAEjASQBIAEeAR4BHgEfARoBFwEWARwBIAEhAR8BHgEeARwBGwEbARsBFwEVARYBFgEbAR8BHwEeAR0BHAEbARoBFAESARMBFQEXARYBGgEdAR4BHAEbARkBGAETAREBEQETARUBGQEbARsBGgEZARkBGAEWARUBFQERAQ8BEAESAREBFgEZARkBGAEXARcBFQEUARQBDwENAQ4BEAEUARcBFwEWARUBFQEUARIBDAEKAQsBDQEUARcBFQETARIBEgESARIBEgEQAQoBCAEJAQwBDQETARUBFAESARABEAEQAQsBCQEHAQ0BDAELAQoBEAETARIBDwEOAQ4BDgEOAQ4BDAEHAQUBBgEIAQkBCgENAQ8BDwEPAQ4BDQENAQgBAwEDAQUBBwENARABDwEMAQoBCgEKAQUBAgEDAQgBCwEHAQQBAwEKAQ0BDAEJAQgBCAEJAQkBAwEBAQABBgEFAQMBAgEIAQsBCgEIAQYBBgEHAQcBAQH/AP4ABAEIAQgBBwEGAQYBBAEDAQMBAwEEAf8A/QD8AAIBBgEGAQUBBAEEAQQBAgH8APoA+wD9AP8A/wADAQUBBQEEAQMBAgECAf0A+QD4APoA/AACAQUBBQECAQAB/wD/AP8A/wD/AP8A+QD2APcA+QD6AAABAwEDAQAB/gD9AP4A+QD2APYA9wD3APgA/gABAQEBAAH+APwA+wD7APYA9AD0APsA/wD+APwA+wD7APsA+wD6APkA8wDxAPIA9AD7AP4A/gD7APkA+QD5APkA9ADxAPIA9wD1APMA8wD5APwA/AD7APcA9gD2APcA9wD3APcA8gDuAO4A7wDxAPcA+gD6APcA9QD1APUA8ADuAO4A8ADwAPUA9wD4APcA9gD1APUA7gDqAOsA7QDvAPUA+AD4APUA8gDyAPIA8gDyAPIA8gDsAOkA6QDwAO8A7QDsAPIA9ADzAPIA8QDxAPEA8QDrAOcA5wDuAPIA8wDxAPAA8ADuAO0A7QDtAO4A6QDnAOgA7QDwAPAA7wDuAO4A7gDuAOgA5ADkAOYA6ADpAO4A8QDxAO4A7ADrAOsA5gDkAOQA5gDmAOsA7gDuAO0A7ADrAOsA6QDoAOgA6QDkAOIA4wDkAOYA6gDrAOsA6wDqAOkA6QDkAOAA3wDhAOMA5ADqAOwA7ADpAOcA5gDmAOYA4QDfAOAA5wDpAOgA5wDmAOYA5gDmAOYA5ADjAN4A3QDeAOQA6ADpAOYA5ADjAOQA5ADfANwA3QDkAOEA3gDdAOMA5wDnAOYA5ADiAOEA4QDhAOIA4gDiAOIA3QDZANkA3wDkAOQA4wDiAOIA4gDbANgA2ADaANwA4gDlAOUA4gDgAN8A3wDaANcA2ADaANsA4ADhAOEA4ADgAN8A3wDeAN4A3ADcANcA1QDWAN0A3ADaANcA3ADfAOAA3wDeAN0A2ADWANQA1QDWANcA3QDgAOAA3gDdANsA2QDZANkA2gDVANMA1ADaANwA3ADaANoA2gDaANoA1QDSANEA0gDUANoA3QDdANsA2gDYANcA1wDSANAAygDIANEA2ADcAN0A2wDaANkA2ADXANcA1wDVAM8AzQDOANAA0gDXANoA2gDYANYA1ADUAM8AzQDOAM8A0QDSANYA1wDXANYA1QDUANQA1ADPAMsAygDRANYA1gDVANQA1ADUANIA0ADQANEAzADKAMsA0gDWANQA0gDRANEA0QDRAMwAyQDKAM8AzQDLAMsA0QDUANUA0wDRANEAzwDOAMkAxwDIAM8A0wDOAMoAyADNANEA0gDQAM8AzwDPAMoAxgDFAMcAyQDPANIA0gDQAM8AzgDMAMsAywDGAMQAxQDHAM4A0QDPAM0AzADMAMwAzADLAMsAxgDEAMMAyQDNAM0AzADMAMsAywDLAMkAyADDAMEAwgDEAMYAxwDMAM8AzQDKAMkAyQDJAMkAyQDJAMQAwADAAMEAyADMAMwAygDJAMkAyQDHAMEAvgC/AMEAyADLAMsAygDJAMYAxQDFAMUAwAC+AL8AwQDCAMYAyADIAMcAxgDGAMYAxQDFAMUAvwC7ALwAvgDAAMYAyADIAMcAxgDEAMIAvQC7ALwAvgDAAMAAxgDIAMYAxADDAMIAwgDCAL0AuwC7AL0AwgDEAMQAwwDCAMIAwgDCAMEAwQC7ALgAuADAAMQAxADDAMIAwQDBAL8AuQC3ALgAugC8AL0AvQDCAMUAwwDAAL8AvwC/AL8AugC3ALgAugC+ALsAuQC4AL4AwgDCAMAAvwC/ALgAtQC1ALAAtQC6AMEAxADCAMAAvwC8ALsAuwC7ALYAtAC1ALcAvQDAAL4AvAC7ALsAuwC7ALsAuwC2ALQAswCzALoAvQC+ALwAuwC7ALsAugC6ALMAsACqALAAtgC4AL0AvwC+AL0AugC4ALIAtQC4ALoAtQCyALIAswC6ALsAuQC4ALgAuAC4ALgAsgCwALAAsQC2ALkAugC5ALgAtwC3ALcAtgC2AK8ArACtAK8AtgC5ALkAuAC3ALcAtQCzALMAswCvAK0ArgCvALEAtgC5ALcAtQC0ALQAtACvAKwArQCuALAAsQC0ALYAtgC1ALQAswCzAK4AqwCsAK4ArQCyALUAtQC0ALMAswCyALIAsgCyAKsAqACpAKsAsgC1ALUAswCyALIAsgCwAK4ArgCqAKgAqQCrALEAtAC0ALMAsACuAK4ArwCqAKcAqACqALEAtACzAKsArACuALAArwCvAK4AqQCnAKgAowCmAKkAsACzALIAsQCvAK8ArgCuAK0ApgCjAKQApgCtALAAsACvAK4ArQCtAKsAqgCqAKUApACkAKYArQCwALAArgCtAKsAqgCpAKoApQCjAJ0AogCnAKoArwCuAK0ArACrAKoApQCiAKMAqQCoAKYApACjAKkArQCtAKsAqgCpAKkAqQCkAKEAoAChAKIApACkAKoArQCsAKsAqQCpAKcApgCgAJ4AnwCmAKoAqgCpAKgApwCnAKUApACkAKAAngCfAKEApwCqAKoAqQCnAKUApACkAJ8AnQCeAKAAoQCiAKcAqgCqAKYApACjAKQAnwCcAJ0AnwCgAKYAqQCnAKQAowCjAKMAowCjAKMAngCcAJwAngCeAKIApQClAKUApACjAKMAowCiAJ0AmwCaAJsAoQClAKUApACiAKIAogCiAJwAmgCYAJoAoACkAKQAowCiAKEAoQChAKAAoACZAJYAlwCZAJsAoQCkAKQAogChAKEAoACZAJYAlgCdAJ0AmwCaAKAAowCjAKEAoACfAJ0AnACcAJ0AmACWAJcAmACfAKIAogCgAJ0AnACcAJwAnACXAJUAlgCYAJkAnwChAJ8AnQCcAJwAnACXAJQAlQCbAJ8AmwCXAJYAmwCdAJ4AnACbAJsAmwCbAJYAkwCUAJsAmACVAJQAmgCeAJ4AnQCbAJsAmwCaAJUAkgCRAJcAmwCcAJsAmgCaAJkAmQCZAJkAmQCUAJAAkACWAJsAmwCaAJkAmQCZAJkAkwCQAI8AkACSAJMAmQCcAJwAmgCZAJgAmACSAJAAjgCPAJEAlwCaAJoAmQCYAJcAlwCWAJYAlgCPAIwAjQCJAI4AkgCZAJwAmwCZAJcAlwCWAI8AiwCMAI4AkACRAJYAmQCZAJcAlgCVAJUAkwCNAIoAiwCTAJcAlwCWAJUAlACUAJQAkwCRAIsAiQCLAI0AjgCPAJQAlwCXAJYAlACTAI4AigCJAJAAjwCOAI0AkgCWAJYAlACTAJIAkgCQAI8AjwCQAIsAiQCJAIsAjQCSAJUAlQCTAJIAkACPAIoAhwCIAIoAjACRAJQAlACTAJEAkACOAIgAhgCHAI4AkgCSAJEAkACQAI8AjwCOAI4AjQCMAIwAiACGAIcAjQCMAIoAiQCPAJIAkgCPAI0AjACNAI0AiACFAIYAjQCQAJEAjwCOAI0AjACLAIoAiwCLAIcAhQCFAIwAkACQAI4AjQCNAIsAigCFAIMAgwCGAIcAiACNAJAAkACOAI0AjACKAIQAgQCCAIQAhgCMAI8AjgCNAIwAiwCLAIoAiACHAIgAgwCCAIIAhACFAIsAjQCNAIwAiwCKAIgAggB/AIAAggCEAIUAigCNAI0AiwCKAIkAiQCHAIEAfgB/AIcAiwCLAIoAiACIAIgAhwCHAIcAhwCAAH0AfgCFAIkAigCIAIcAhwCHAIcAgQB/AH8AhACCAIEAgACGAIoAigCIAIcAhgCGAIYAhgCFAIUAhACDAH4AfAB9AIQAiACIAIcAhgCFAIUAgAB9AHwAfQB+AIUAiACIAIYAhQCFAIQAfwB8AHwAfgCAAIQAhgCGAIUAhACDAIMAgwCCAIIAggB+AHsAfACCAH8AfAB7AIIAhQCGAIQAgwCCAH0AewB7AHwAfgB+AIIAhACEAIMAggCBAIEAgQCBAIAAfAB5AHoAgACEAIMAgAB/AIAAgACAAHsAeAB5AHsAfAB9AIIAhQCEAIEAfwB+AH4AegB3AHEAdgB8AH4AgwCEAIQAggCBAIAAfgB8AHwAfQB4AHYAdwB4AHoAfwCCAIIAgAB/AH8AfQB3AHQAdQB3AHkAegB/AIIAgQCAAH4AfgB9AH0AeABzAHMAegB/AH8AfgB9AHwAfAB8AHwAewB7AHcAdQBzAHkAfQB+AH0AfAB8AHwAewB2AHMAdAB7AHoAdwB2AHoAfQB9AHwAewB6AHoAegB1AHMAcwB6AH4AeQB1AHQAeQB8AHwAewB6AHoAegB1AHIAcgB0AHUAewB+AH0AfAB5AHgAdwByAHAAcQBzAHQAdQB6AH0AfQB7AHoAeQB5AHcAdgB2AHEAbwBwAHcAdgBzAHIAeAB7AHwAegB4AHgAdgBwAG4AbgBwAHIAeAB7AHsAeQB4AHcAdwB2AHYAdgBxAG0AbQBvAHYAeQB5AHgAdwB2AHYAdgBwAG4AbgBwAHcAeAB3AHYAdQB1AHUAdAB0AG8AbQBtAG8AcQB2AHkAeQB3AHQAcwBzAHMAcwBzAG4AbABtAG4AcAB1AHgAeAB2AHUAdAByAGwAagBrAG0AbwBvAHUAdwB3AHYAdABzAHMAcwBtAGsAagBrAHEAdQB1AHQAcwByAHIAcgBxAHEAbABqAGsAcQB1AHQAcQBwAHAAcQBxAGsAaQBpAHAAbwBtAGwAcgB1AHUAcwBwAG8AbwBvAGoAaABoAGoAcQBvAGwAawBxAHQAdAByAHEAbwBpAGcAZwBiAGcAbABzAHUAdAByAHEAcABvAG8AbwBpAGcAZgBnAG4AcQBxAHAAbwBuAG4AbgBuAG4AaQBmAGcAaQBvAHIAcABuAG0AbQBtAG0AbQBnAGUAXwBlAGoAbABxAHIAcgBwAG0AbABmAGkAbABtAGgAZQBlAGcAbQBwAHAAbgBtAG0AbQBsAGUAYgBiAGUAbABvAG8AbgBsAGwAbABrAGsAawBmAGQAZABmAGoAbQBtAGwAawBrAGsAagBqAGoAZQBjAGMAZQBmAGwAbgBuAG0AagBpAGgAYwBhAGIAZABlAGYAbABuAG4AbABrAGoAagBpAGQAYABgAGIAaQBsAGwAawBqAGkAaQBoAGgAaABjAGEAYQBjAGkAbABrAGgAZwBnAGcAZwBnAGcAYgBgAGEAYgBpAGsAawBqAGkAaABoAGYAYABdAF4AYQBnAGsAawBkAGYAaABpAGgAZwBmAGIAXwBgAFsAXgBhAGgAawBrAGkAZwBnAGYAZgBlAGAAXgBfAGAAZwBqAGkAaABlAGQAZABkAGQAZABfAF0AXgBgAGYAaQBpAGcAZgBmAGUAZQBkAF4AWgBUAFoAYABiAGcAaQBpAGcAZgBlAF8AXABdAGMAYgBgAF8AYABkAGYAZQBkAGMAYwBjAGMAXgBbAFwAXQBkAGcAZwBlAGQAZABjAGEAYABgAFsAWgBbAFwAYwBmAGYAZABjAGMAYgBiAGIAYQBdAFoAWwBbAGAAYwBkAGMAYgBiAGEAYQBcAFkAWgBcAF0AXgBjAGYAZQBkAGIAYABfAFoAWABYAFoAXABiAGQAZABjAGIAYQBgAGAAYABgAFsAWQBZAFkAWQBfAGIAYwBhAGAAYABgAF8AXwBaAFgAWABaAGAAYwBjAGEAYABgAF4AXQBXAFUAVgBYAF8AYgBiAGEAYABfAF8AXgBeAF4AWQBXAFEATwBWAFsAYgBkAGIAYQBgAF8AXgBdAF0AXQBYAFYAVgBdAGEAYQBfAF4AXQBcAFsAWwBbAFYAVQBVAFcAXgBhAGAAXwBeAF0AXQBcAFwAVwBVAE4AVABXAFkAXgBgAGAAXgBdAFwAVwBUAFQAWwBfAFoAVgBWAFwAXwBfAF0AXABcAFoAWQBUAFIAUwBaAFkAVwBWAFsAXwBfAF0AWwBbAFsAWwBVAFMAUwBaAFwAWwBaAFkAWQBaAFkAWQBZAFQAUgBTAFQAWwBeAF0AXABbAFoAWgBaAFQAUABQAFIAVABVAFoAXQBdAFwAWgBZAFkAVABRAFEAUwBVAFoAXQBdAFsAWgBYAFYAVgBWAFcAUgBQAFEAUgBUAFkAXABcAFoAWQBZAFgAWABXAFIAUABQAFEAUQBXAFoAWgBZAFgAVwBXAFcAUgBPAFAAVgBaAFsAWQBYAFcAVwBXAFYAVABPAE0ATgBQAFIAUgBYAFoAWgBZAFcAVwBRAE8ATwBVAFQAUgBRAFcAWgBaAFcAVABUAFQAVQBVAFQAVQBQAE4ATgBQAFEAVgBZAFkAWABWAFYAVQBQAE0ATgBOAE4AVABXAFgAVgBVAFUAVABPAEwATQBTAFcAUwBPAE4AVABYAFgAVgBVAFQAUwBSAEwASgBLAFIAUQBPAE4AVABXAFcAVgBUAFQAUwBTAE4ASwBMAFIAVgBWAFUAUgBRAFEAUQBRAFEAUQBNAEsASwBSAFYAVgBUAFMAUwBTAFIATQBKAEsATQBOAE0AUgBUAFUAVABSAFIAUQBMAEoASgBMAE0AUwBWAFUAVABTAFIAUQBRAFEAUQBRAEoARwBIAEoATABRAFQAVABTAFIAUQBRAEsASQBJAEsATABNAFIAVQBVAFMAUgBRAFAATgBIAEYARwBOAFMAUwBRAFAAUABQAE8ATwBPAE8ASgBIAEgATwBTAFMAUQBQAFAATgBNAEgARgBHAE4ATQBLAEoATwBTAFMAUQBQAE8ATwBPAE4ATgBOAEkARwBHAEkASgBOAFAAUABPAE8ATgBOAEkARgBGAEgASgBPAFIAUgBQAE8ATgBOAEgARgBGAEgASQBPAFAATwBOAE0ATQBNAEwATABMAEwASABFAEYATABLAEkASABNAFEAUQBPAE4ATQBNAE0ARwBDAEMARQBMAE8ATwBOAE0ATABMAEwASwBLAEYARABFAEsATwBPAE4ATQBMAEwATABGAEIAQgBEAEYARwBNAE8ATwBOAEwATABLAEYAQwBDAEUARwBNAE8ATwBNAEwASwBLAEoASgBIAEgAQwBBAEIARABGAEsATgBOAE0ASwBLAEoARQBCAEMARABGAEcATABOAE4ATABLAEoASgBIAEIAQABBAEgATABMAEsASgBJAEkASQBIAEgASABEAEEAQgBIAEwATABLAEoASQBJAEkAQwA/AD8ARgBFAEQAQwBJAEwATABLAEkASABIAEgAQwBAAEEARwBLAEcAQwBCAEgATABMAEoASQBHAEYAQQA/AD8AQQBDAEkASwBLAEoASABIAEcAQgA/AEAAQQBDAEQASQBMAEsASgBIAEcARwBFAEQARABAAD4APwBFAEQAQgBBAEcASgBKAEkARwBHAEIAPwA/AEEAQgBDAEgASgBKAEkARwBGAEQAQwBDAEQAPwA9AD4AQABGAEkASQBHAEYARgBGAEAAPQA+AD8AQQBHAEkASQBIAEYARgBFAEUAQwA9ADsAPAA+AEAARgBIAEgARwBGAEUARQBEAEQARAA/AD0APQA/AEAARgBIAEgARwBFAEUARAA/ADsAOgA8AD4APwBFAEgASABGAEUARABDAEMAPgA7ADwAPgBEAEcARwBFAEQARABDAEMAQwBCAD4AOwA6AEAARABFAEQAQwBDAEMAQgA9ADoAOwBCAEEAPwA+AEMARwBHAEUAQwBDAEMAQgA9ADoAOwBCAEYAQQA7ADoAQABEAEUAQwBCAEIAPQA7ADsANQA6AD4ARgBIAEcARQBDAEIAQgBBAEEAPAA5ADoAPABCAEUARQBCAEAAPwBAAEAAQABAADsAOQA6ADsAQQBEAEQAQwBCAEEAQQBAAEAAOwA5ADIAMQA6AEAARgBIAEYARABBAD8APwA+AD8APwA6ADgAOQA6AEAAQwBDAEEAQABAAEAAQAA6ADgAOAA6AEEARABDAEIAQQBAAEAAPwA/ADgANQA2ADgAOgBAAEMAQwBBAEAAPwA/AD8APgA+ADkANwA4ADkAOgBAAEMAQgBBAEAAPwA/ADkANwA3ADkAOQA5AD4AQQBCAEAAPwA+AD4APgA4ADYANgA4AD8AQgBBAEAAPwA+AD4APQA9AD0AOAA2ADYAOAA/AEEAQQBAAD0APAA8ADwAPAA8ADcANQA2ADcAPgBBAEAAPwA+AD0APQA9ADcANQA1ADcAPgBBAEEAOgA8AD4APwA+AD0APAA2ADMAMwAvADQAOQBAAEIAQQA/AD4APQA8ADwAPAA2ADQANQA2AD0AQAA/AD4APQA8ADwAPAA7ADsANgA0ADUANQA6AD0APgA9ADwAOwA7ADsAOwA1ADMALQAyADgAOgA/AEAAQAA+AD0APAA2ADgAOwA8ADcANAA0ADYAPAA/AD4APQA6ADkAOQA5ADQAMgAyADQAOwA+AD4APAA7ADsAOgA6ADoAOQA0ADIAMwA0ADsAPgA+ADwAOwA7ADoAOgA6ADkANAAxADAAMgA5ADwAPAA7ADoAOgA6ADkANAAxADIANAA1ADYAOwA+AD0APAA6ADoAOQA0ADEAMgAzADUAOwA9AD0APAA6ADoANwA2ADYANwAyADAAMQAzADkAPAA8ADoAOQA5ADkAOAA4ADgAMwAwADEAMwA5ADwAPAA6ADkAOQA4ADgAMwAwADEAMwA5ADoAOQA4ADgANwA3ADcANwA3ADIAMAAqACgAMQA3AD0APgA9ADsAOgA5ADgANwA3ADIALwAwADIAOAA7ADsAOQA4ADcANwA1ADQANAAwAC4ALwAxADcAOgA6ADkANwA3ADcANgA2ADEALgAoAC4AMwA1ADoAOwA7ADkAOAA3ADEALwAvADYANAAyADEAMgA2ADgAOAA2ADYANQA1ADUAMAAuAC4ANQA0ADEAMAA2ADkAOQA4ADYANgA1ADUAMAAtAC4ANQA4ADkANwA2ADYANQA1ADUANAAvACwAKwAtADQAOAA4ADYANQA1ADUANAAvACwALQAvADAAMQA2ADkAOQA3ADYANQA0AC8ALQAtAC8AMAA2ADkAOAA3ADYANQA0ADQAMgAxACwAKwAsAC4ALwA1ADcANwA2ADUANAA0ADMAMwAuACwALAAuADQANwA3ADUANAA0ADQAMwAuACsALAAuADQANwA3ADYANQA0ADIAMQAwADEALAArACsALQAuAC8ANAA3ADcANQA0ADMALgArACsAMgAxAC8ALgAzADcANwA1ADMAMwAzADIAMgAyAC0AKwArAC0ALgAvADQANQA0ADMAMgAyADIALAAqACoALAAuADMANgA2ADQAMwAyADIALAAqACoAMQA1ADAALAAsADIANQA1ADMAMgAyADIAMgAsACoAKgAxADAALAAqADAANAA0ADMAMQAxADEAMQAsACkAKQAwADQANAAzADEAMQAxADEAMAAwADAAKwApACkAMAA0ADQAMwAxADEAMQAxACsAKQApACsALQAsADAAMwAzADIAMQAwADAAKwAoACgAKgAsADEANAA0ADIAMQAwADAAMAAvAC8ALwAqACgAKQAqACsAMQA0ADQAMgAxADAAMAArACgAKAAqACwALAAwADIAMgAxADAALwAvAC8AKQAnACgALgAyADIAMQAwAC8ALwAvAC4ALgApACcAKAApADAAMwAyADEAMAAvAC8ALwApACcAJwAuAC0AKwAqAC8AMQAwAC8ALgAuAC4ALgAuAC4ALgApACYAJwAoACoALwAyADIAMQAvAC8ALgApACYAJwAoACoAMAAyADIAMAAvAC4ALgApACYAJgAoACoALwAyADIAMAAtACwALAAsACwALAAsACgAJQAmAC0AKwApACgALQAxADEAMAAuAC0ALQAtACgAJQAlACwAMAAwAC8ALgAtAC0ALQAsACwALAAnACUAJgAsADAAMAAvAC4ALAArACsAJgAkACQAJgAoACkALgAxADEALwAuAC0ALAAnACQAJQAmACgALgAwADAALwAtAC0ALAAsACwAKwAsACcAJAAlACYAKAAtADAAMAAuAC0ALQAsACUAIgAiACUAJwAnAC0AMAAvAC4ALAAsACsAKwAmACMAJAArAC8ALwAtACwAKwArACsAKwAqACoAJgAjACQAKwAuAC4ALQAsACwAKwArACYAIwAkACoAKQAnACYAKgAtAC0ALAArACoAKgAqACUAIwAjACoALgApACUAJAAqAC4ALgAsACsAKwArACYAIwAjACQAJgAsAC4ALgAtACsAKwAqACUAIgAjACQAJgAsAC4ALgAtACsAKwAqACgAJwAnACgAIwAhACIAKQAnACUAJAAqAC0ALQAsACoAKgAlACIAIgAkACUAJgArAC4ALQAsACoAKgApACkAKQApACQAIQAiACkALAAsACsAKgApACkAKQAkACEAIgAjACMAKAArACsAKgApACkAKAAoACgAIwAgACEAIwAkACoALAAsACsAKgApACkAKAAoACgAIwAhACEAIwAkACoALAAsACsAKQApACkAIwAhACEAIwAkACUAKgAtACwAKwApACcAJgAmACEAHwAgACIAKAArACsAKgAoACgAKAAnACcAJwAiACAAIAAnACsAKwApACgAKAAoACcAIgAfACAAJwAmACQAIgAoACsALAAqACgAKAAnACcAIgAfACAAJwAqACYAIgAhACYAKQApACcAJwAnACIAHwAgABoAHwAkACsALQAsACoAKAAnACcAJgAmACEAHwAfACEAJwAqACoAKAAnACcAJwAmACYAJgAhAB8AHwAmACoAKgAoACcAJwAnACYAJgAmACEAHgAYABUAHQAjACoALAArACkAKAAnACYAJQAlACUAIAAeAB4AIAAmACkAKQAnACYAJgAmACUAIAAeAB4AIAAnACoAKQAoACcAJgAmACUAJQAgAB0AHgAgACEAJwApACkAKAAnACYAJgAlACUAIwAdABsAHAAfACAAJgAoACgAJwAmACUAJQAgAB0AHQAfACEAIQAnACkAKQAnACYAJQAlACQAHwAdAB0AHwAlACgAKAAnACYAJQAlACQAJAAkAB8AHQAdAB8AJQAoACgAJwAlACUAJQAfAB0AHQAdAB4AHwAgACUAKAAoACYAJQAkACQAJAAeABwAHAAeACUAIwAgAB8AJAAoACgAJgAkACQAHwAcAB0AFwAcACEAKAAqACkAJwAlACQAJAAjACMAHgAcABwAHgAkACcAJwAlACQAJAAkACMAIwAjABwAGQAaABwAIwAmACYAJQAkACMAIwAjACIAHQAbABUAGgAfACIAJgAoACcAJgAkACMAHgAgACMAJAAfABwAHAAdACQAJgAmACQAIwAjACMAIwAdABsAGwAdACMAJgAmACUAJAAjACMAIgAiACIAHQAbABoAGwAhACUAJQAkACMAIgAiACIAIQAhABwAGgAbABwAIwAmACUAJAAjACIAIgAiABwAGgAaABwAHgAeACQAJgAmACQAIwAiACIAHQAaABoAHAAeACMAJgAmACQAIwAiACIAIQAhACEAHAAaABoAHAAiACUAJQAiACAAIAAgACAAIAAgABsAGQAaABwAIgAlACUAIwAiACIAIQAhABwAGQAZABsAIgAlACUAHgAgACIAIwAiACEAIQAcABkAGgAVABkAHgAlACcAJgAkACMAIgAhACEAIAAbABkAGgAbACIAJQAkACMAIgAhACEAIQAfAB4AGQAXABgAGgAhACQAJAAiACEAIQAgACAAIAAaABgAEgAXAB0AHwAkACUAJQAjACIAIQAbABgAGQAfAB4AHAAbABwAIgAkACQAIgAhACAAIAAgABsAGAAYABoAHAAcABwAIgAkACQAIgAhACAAIAAgABoAGAAYAB8AIQAhAB8AHwAfAB8AHwAeAB4AGQAXABgAGgAgACMAIwAhACAAIAAfAB8AGgAXABcAGQAbABwAIQAjACMAIgAgAB8AHwAaABcAGAAZABsAIQAjACMAIQAgAB8AHwAfAB4AHgAZABcAGAAZABsAIAAjACMAIQAgAB8AHwAfAB4AGQAVABUAFwAeACEAIQAgAB8AHwAeAB4AGQAWABcAGQAfACIAIgAgAB8AHwAeAB4AHgAdABgAFgAXABkAGgAgACIAIgAhAB8AHwAeABkAFgAXAB0AHAAaABkAHwAiACIAIAAfAB4AHgAeAB4AHgAYABYAFwAYAB8AIgAhACAAHwAfAB4AHgAcABYAFAAVABcAGQAfACEAIQAgAB8AHgAdABgAFQAWAB0AIQAcABgAFwAdACEAIQAfAB4AHQAeAB0AGAAVABYAHAAbABkAGAAeACEAIQAfAB4AHQAdAB0AGAAVABYAHAAgACAAHwAeAB0AHQAdAB0AHAAcABgAFQAWAB0AIAAgAB8AHgAdAB0AGwAVABMAFAAWABgAGQAeACEAIQAfAB4AHQAdABcAFQAVABcAGAAeACEAIAAfAB0AHQAcABwAHAAcABcAFQAVABAAFQAZACAAIgAhAB8AHgAdAB0AFwAUABUAFgAYABkAHgAgACAAHwAdABwAHAAcABcAFAAVABwAHwAgAB4AHQAcABwAHAAbABsAFgAUABMAFAAWABcAHAAfAB8AHgAdABwAFwAUABQAGwAaABcAFwAcAB8AHwAeABwAGwAbABsAGwAbABsAFgAUABQAFgAXABwAHwAfAB4AHQAcABwAFgATABQAFQAXAB0AHwAfAB4AHAAcABsAFgATABMAGgAeAB8AHQAcABwAGwAbABsAGgAaABsAGwAWABMAFAAaABkAFQAUABkAHQAeAB0AGwAbABsAGwAVABMAEwAaAB4AHgAcABsAGwAbABoAGgAaABoAFQATABMAGgAeAB4AHAAbABsAGwAaABUAEgATABUAFgAXABwAHwAfAB0AHAAbABoAFQATABMAFQAWABwAHwAeAB0AHAAbABoAGgAaABoAGgAVABMAEwAVABYAHAAeAB4AHQAcABsAGQATABAAEQATABUAFgAbAB4AHgAcABsAGgAaABkAFAASABIAGQAdAB0AHAAaABoAGgAZABkAGQAZABQAEgASABkAHQAdABsAGgAaABoAGQAUABEAEgAZABgAFgAVABoAHQAeABwAGgAaABoAGQAZABkAGQAZABkAFAARABIAGAAcAB0AGwAaABoAGgAVABIAEgAUABUAGwAeAB4AGgAYABgAGAATABAAEQATABQAGgAdAB0AGwAaABkAGQAYABgAGAAYABMAEQARABgAFwAUABMAGQAcAB0AGwAaABkAFAARABEAEwAUABUAGgAdAB0AGwAaABkAGAAYABgAGAATABEAEQAYABwAHAAaABkAGQAZABgAEwAQABEAEwAUABUAGgAdAB0AGwAaABkAGQATABEACgAPABUAFwAcAB4AHQAaABgAFwAXABcAFwAXABIAEAARABIAEwAZABsAGwAaABkAGAAYABMAEAAQABIAEwAUABkAHAAcABoAGQAYABcAFwASAA8AEAAXABsAGwAZABgAGAAYABcAFwAXABcAEgAQABAAFwAbABsAGQAYABgAGAAXABIADwAQABcAFgAUABMAGAAbABwAGgAYABgAGAAXABIAEAAQABcAGwAWABIAEQAYABsAGwAZABYAFQAWABEADwAPABEAEgAYABsAGwAZABgAFwAXABcAFgARAA8ADwARAExJU1QOAAAASU5GT0lUUksCAAAAMABfUE1YDQEAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuMS4yIj4KIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgIHhtbG5zOnhtcERNPSJodHRwOi8vbnMuYWRvYmUuY29tL3htcC8xLjAvRHluYW1pY01lZGlhLyIKICAgeG1wRE06Y29tcG9zZXI9IiIvPgogPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KAA==';

const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160];
const NOISE_FEEDBACK = 0x9;

class PSGChannelEmulator {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.currentNoiseFrequency = 0;
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 0;
        this.noiseNode = null;
        this.envelopeNode = this.audioContext.createGain();
        this.oscillator = this.audioContext.createOscillator();
        this.mixer = this.audioContext.createGain();
        this.noiseGainNode = this.audioContext.createGain();
        this.noiseGainNode.gain.value = 0;
        this.lowPassFilter = this.audioContext.createBiquadFilter();
        this.lowPassFilter.type = 'lowpass';
        this.lowPassFilter.frequency.value = 2500; // Adjust the cutoff frequency to control the softness of the noise
        this.lowPassFilter.Q.value = 2;
        this.lowPassFilter.connect(this.mixer);

        this.connectNoiseGain();
        this.mixer.connect(this.gainNode);

        this.connectOscillator();
        this.connectEnveloper();
        this.mixer.connect(this.gainNode);
    }

    connect(destination) {
        this.gainNode.connect(destination);
    }

    disconnect(destination) {
        this.gainNode.disconnect(destination);
    }

    connectNoiseGain() {
        this.noiseGainNode.connect(this.mixer);
    }

    connectOscillator() {
        this.oscillator.connect(this.mixer);
    }

    disconnectOscillator() {
        this.oscillator.disconnect();
    }

    connectEnveloper() {
        this.envelopeNode.connect(this.mixer);
    }

    disconnectEnveloper() {
        this.envelopeNode.disconnect();
    }

    setVolume(volume, time) {
        const amplitudeValues = [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375];
        const amplitudeIndex = Math.floor(volume * amplitudeValues.length / 16);
        const amplitude = amplitudeValues[amplitudeIndex];
        this.gainNode.gain.setValueAtTime(amplitude, time);
    }

    setToneFrequency(frequency, time, pitch_software = 0, pitch_hardware = 0) {
        const targetFrequency = frequency * (1 + (pitch_software + pitch_hardware) / 2048);
        // Set the frequency in the oscillator using an exponential ramp
        this.oscillator.frequency.exponentialRampToValueAtTime(targetFrequency, time + 0.01);
    }

    resetNote(time) {
        this.setVolume(0, time);
        this.oscillator.type = "sine"; // Set the oscillator type to sine wave
    };

    setWaveType(waveType, time) {
        const customWave = (real, imag) => {
            return this.audioContext.createPeriodicWave(
                new Float32Array(real),
                new Float32Array(imag)
            );
        };

        switch (waveType) {
            case 0: // Square wave (NoSoftNoHard)
                this.oscillator.type = "square";
                break;
            case 1: // Custom square wave (SoftOnly)
                this.oscillator.setPeriodicWave(customWave([0, 1], [0, 0]));
                break;
            case 2: // Custom square wave (HardOnly)
                this.oscillator.setPeriodicWave(customWave([0, 0], [0, 1]));
                break;
            case 3: // Custom square wave (SoftHard)
                this.oscillator.setPeriodicWave(customWave([0, 1], [0, 1]));
                break;
            default:
                console.error("Invalid wave type:", waveType);
        }
    }

    setNoise(noise, duration, time) {
        if (this.noiseNode) {
            this.noiseNode.stop();
            this.noiseNode.disconnect(this.lowPassFilter);
            this.noiseNode = null;
        }
        if (!noise) return;

        const noiseLevel = Math.max(1, Math.min(31, noise));
        const bufferSize = Math.round(PSGEmulator.PSG_FREQUENCY * duration);
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        let noisePeriod = NOISE_PERIODS[(noiseLevel >> 3) & 0x07];
        let shiftRegister = 0x4000;
        let avg = 0;
        let count = 0;
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (shiftRegister & 1) === 0 ? -1 : 1;

            // Update the shift register
            const feedback = ((shiftRegister & NOISE_FEEDBACK) ^ ((shiftRegister >> 1) & NOISE_FEEDBACK)) & 1;
            shiftRegister = ((shiftRegister >> 1) & 0x3fff) | (feedback << 14);

            if (i % noisePeriod === noisePeriod - 1) {
                const diff = output[i] - avg;
                const delta = diff / (count + 1);
                avg += delta;
                count++;
                noisePeriod = NOISE_PERIODS[(noiseLevel + Math.round(avg)) >> 3 & 0x07];
            }
        }

        // Apply the envelope
        const envelope = [
            0, 1, 2, 3, 4, 5, 6, 7,
            8, 9, 10, 11, 12, 13, 14, 15,
            14, 13, 12, 11, 10, 9, 8, 7,
            6, 5, 4, 3, 2, 1, 0, 0,
        ];
        const gainNode = this.envelopeNode.gain;
        gainNode.setValueAtTime(0, time);
        for (let i = 0; i < envelope.length; i++) {
            const timeValue = time + i / envelope.length * duration;
            const value = envelope[i] / 15 * noiseLevel;
            gainNode.linearRampToValueAtTime(value, timeValue);
        }
        gainNode.linearRampToValueAtTime(0, time + duration);

        // Resample the noise buffer to match the PSG frequency
        const resampledBuffer = this.resampleBuffer(noiseBuffer, this.audioContext.sampleRate);

        this.noiseNode = this.audioContext.createBufferSource();
        this.noiseNode.buffer = resampledBuffer;
        this.noiseNode.loop = true;

        // Connect the noise node to the low-pass filter and then to the mixer
        this.noiseNode.connect(this.lowPassFilter);
        this.noiseNode.start(time);
    }

    setNoiseFrequency(noise_divider, time) {
        if (this.noiseNode) {
            const noise_frequency = noise_divider ? PSGEmulator.PSG_FREQUENCY / (16 * (noise_divider + 1)) : 0;
            this.noiseNode.playbackRate.cancelScheduledValues(time);
            const now = this.audioContext.currentTime;
            const start = now + 0.001;
            this.noiseNode.play.playbackRate.setValueAtTime(this.currentNoiseFrequency, start);
            this.noiseNode.playbackRate.exponentialRampToValueAtTime(noise_frequency, start + 0.01);
            this.currentNoiseFrequency = noise_frequency;
        }
    }

    resampleBuffer(buffer, targetSampleRate) {
        const sourceSampleRate = buffer.sampleRate;
        const sourceChannelData = buffer.getChannelData(0);
        const sourceLength = sourceChannelData.length;
        const targetLength = Math.round(sourceLength * targetSampleRate / sourceSampleRate);
        const targetBuffer = this.audioContext.createBuffer(1, targetLength, targetSampleRate);
        const targetChannelData = targetBuffer.getChannelData(0);
        let sourceIndex = 0;
        for (let i = 0; i < targetLength; i++) {
            const sourceSampleIndex = sourceIndex | 0;
            const fraction = sourceIndex - sourceSampleIndex;
            // Linearly interpolate between the two nearest source samples
            const a = sourceChannelData[sourceSampleIndex];
            const b = sourceChannelData[Math.min(sourceSampleIndex + 1, sourceLength - 1)];
            targetChannelData[i] = a * (1 - fraction) + b * fraction;

            sourceIndex += sourceSampleRate / targetSampleRate;
        }

        return targetBuffer;
    }

    start() {
        this.oscillator.start();
        this.noiseNode?.start();
    };

    stop() {
        this.oscillator.stop();
        this.noiseNode?.stop();
    }

}

class PSGInstruction {
    constructor(data) {
        this.type = data.type;
        this.value = data.value;
        this.time = data.time;
        this.duration = data.duration;
    }
}

class PSGEmulator {
    constructor(audioContext) {
        this.audioContext = audioContext;
        this.channels = [new PSGChannelEmulator(audioContext), new PSGChannelEmulator(audioContext), new PSGChannelEmulator(audioContext)];
        this.connect(this.audioContext.destination);
        this.start();
    }

    playInstructions(instructions) {
        instructions.forEach(instruction => {
            const psgInstruction = new PSGInstruction(instruction);
            this.executePSGInstruction(psgInstruction);
        });
    }

    connect(destination) {
        this.channels.forEach(channel => {
            channel.connect(destination);
        });
    }

    disconnect(destination) {
        this.channels.forEach(channel => {
            channel.disconnect(destination);
        });
    }

    start() {
        this.channels.forEach(channel => {
            channel.start();
        });
    }

    stop() {
        this.channels.forEach(channel => {
            channel.stop();
        });
    }
}

class Instrument {
    constructor(instructions) {
        this.psgInstructions = instructions;
    }

    executePSGInstruction(psgInstruction, psgChannel, stepDuration, frequency, time) {
        psgChannel.setWaveType(psgInstruction.cellType, time);
        psgChannel.setVolume(psgInstruction.volume, time);

        if (psgInstruction.envelopeType && psgInstruction.cellType === PSGInstructionType.HardOnly || psgInstruction.cellType === PSGInstructionType.HardToSoft || psgInstruction.cellType === PSGInstructionType.HardAndSoft) {
            psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration * 0.8); // Adjust envelope timing
        }

        const pitchOffset = psgInstruction.pitch_software || 0;
        if (psgInstruction.noise) {
            psgChannel.setNoise(psgInstruction.noise, stepDuration, time);
            psgChannel.setNoiseFrequency(psgInstruction.noise, time); // Do not use pitch for noise frequency
        } else {
            psgChannel.setNoise(0, 0, time);
            psgChannel.setNoiseFrequency(0, time);
        }

        psgChannel.setToneFrequency(frequency, time, pitchOffset);

        // Implement sound generation logic based on the cell type
        switch (psgInstruction.cellType) {
            case PSGInstructionType.NoSoftNoHard:
                // Generate noise, stop sound, or handle special effects
                psgChannel.setWaveType(0, time);
                psgChannel.disconnectOscillator();
                break;
            case PSGInstructionType.SoftOnly:
                // Generate rectangular sound wave with volume, arpeggio, and pitch
                psgChannel.setWaveType(0, time);
                psgChannel.connectOscillator();
                break;
            case PSGInstructionType.SoftToHard:
                psgChannel.setWaveType(1, time);
                psgChannel.connectOscillator();
                break;
            case PSGInstructionType.HardOnly:
                // Generate hardware curve (sawtooth or triangle wave)
                psgChannel.setWaveType(2, time);
                psgChannel.connectOscillator();
                // psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
                break;
            case PSGInstructionType.HardToSoft:
                // Generate "still" result and desynchronize for interesting sounds
                psgChannel.setWaveType(3, time);
                psgChannel.connectOscillator();
                // psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
                break;
            case PSGInstructionType.HardAndSoft:
                // Generate autonomous software and hardware sounds
                psgChannel.setWaveType(4, time);
                psgChannel.connectOscillator();
                // psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
                break;
        }
    }

    play(psgChannel, duration, frequency, time) {
        const stepDuration = (duration / this.psgInstructions.length);
        [...this.psgInstructions].forEach((psgInstruction, step) => {
            const eventTime = time + (step + 0.01) * stepDuration; // Add a small delay to account for the exponential ramp
            setTimeout(() => this.executePSGInstruction(psgInstruction, psgChannel, stepDuration, frequency, eventTime), eventTime);
        });

        psgChannel.setVolume(0, time + duration + (0.01 * this.psgInstructions.length));
    }
}


PSGEmulator.PSG_FREQUENCY = 4000;

// const PSGInstruction_Type = {
//     Tone: (channel) => ({ type: "tone", channel }),
//     Volume: (channel) => ({ type: "volume", channel }),
//     Noise: (channel) => ({ type: "noise", channel }),
//     NoiseFrequency: (channel) => ({ type: "noise_frequency", channel }),
//     Envelope: (channel, envelopeType) => ({ type: "envelope", channel, envelopeType }),
//     WaveType: (channel) => ({ type: "wave_type", channel }),
// };

const PSGInstructionType = {
    NoSoftNoHard: 0,
    SoftOnly: 1,
    SoftToHard: 2,
    HardOnly: 3,
    HardToSoft: 4,
    HardAndSoft: 5
};

const PSGInstruction_EnvelopeType = {
    Sawtooth: 0,
    Sawtooth_Mirrored: 1,
    Triangle: 2,
    Triangle_Mirrored: 3,
};

const keySpikeSpec = Array.from({ length: 15 }, (_, index) => ({
    volume: 15 - index,
    noise: 0,
    pitch: 0,
    cellType: 1, // Use the InstrumentType enum here
}));


const instruments = [
    null, // Instrument 0 = No instrument
    new Instrument(keySpikeSpec),
    // new Instrument(bassdrumSpec),
];

const context = new AudioContext();

const frequentietabel = {
    'C': [16.35, 32.70, 65.41, 130.81, 261.63, 523.25, 1046.50, 2093.00, 4186.01],
    'C#': [17.32, 34.65, 69.30, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
    'D': [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.64],
    'D#': [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03],
    'E': [20.60, 41.20, 82.41, 164.81, 329.63, 659.26, 1318.51, 2637.02, 5274.04],
    'F': [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
    'F#': [23.12, 46.25, 92.50, 185.00, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
    'G': [24.50, 49.00, 98.00, 196.00, 392.00, 783.99, 1567.98, 3135.96, 6271.93],
    'G#': [25.96, 51.91, 103.83, 207.65, 415.30, 830.61, 1661.22, 3322.44, 6644.88],
    'A': [27.50, 55.00, 110.00, 220.00, 440.00, 880.00, 1760.00, 3520.00, 7040.00],
    'A#': [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
    'B': [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13],
};

function noot2frequentie(note, octave = 0) {
    if (frequentietabel.hasOwnProperty(note) && octave >= 0 && octave < frequentietabel[note].length) {
        return frequentietabel[note][octave];
    } else {
        throw new Error(`Invalid note or octave: ${note}, ${octave}`);
    }
}

// Definieer de toonladder en akkoorden
const toonladder = ["C", "D", "E", "F", "G", "A", "B"];
const akkoorden = {
    C: ["C", "E", "G"],
    Dm: ["D", "F", "A"],
    Em: ["E", "G", "B"],
    F: ["F", "A", "C"],
    G: ["G", "B", "D"],
    Am: ["A", "C", "E"],
    Bdim: ["B", "D", "F"],
};

// Definieer een akkoordprogressie
const akkoordprogressie = ["C", "Am", "F", "G"];

// Definieer de ritmische patronen
const ritmes = [
    [0.25, 0.25, 0.25, 0.25],
    [0.5, 0.5],
    [0.25, 0.25, 0.5],
    [0.5, 0.25, 0.25],
];

// Definieer de ritmische patronen voor de drums
const drumRitmes = [
    [1, 0, 1, 0, 1, 0, 1, 0], // Snaredrum
    [1, 0, 0, 0, 1, 0, 0, 0], // bassdrum
    [1, 0, 1, 0, 0, 0, 1, 0], // Hihat accenten
    // [1, 0, 1, 0, 1, 1, 1, 0], // Breakbeat
];

// Definieer het drumgeluid voor elk ritme
const drumgeluidenPerRitme = {
    snaredrum: [0, 1, 0, 1, 0, 1, 0, 1],
    bassdrum: [0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 1, 1, 1, 1, 1, 1, 1]
    // hihat: [1, 1, 1, 1, 1, 1, 1, 1]
};
const instrumentSamples = {};

// Definieer de parameters voor het genereren van noten en akkoorden
const lengte = 16; // Aantal maten
const tempo = 120; // Aantal beats per minuut
const stapgrootte = 2; // Stapgrootte in toonladder
const akkoordenPerMaat = 2; // Aantal akkoorden per maat
const ritme = ritmes[0]; // Kies een ritme uit de lijst
const drumRitme = drumRitmes[0]; // Kies een drumritme uit de lijst
// const drumgeluidenVoorRitme = drumgeluiden; // Kies de drumgeluiden voor het gekozen drumritme

async function loadEncodedSample(base64Sample) {
    // decodeer base64-string
    // const decodedData = window.Buffer.from(base64Sample, 'base64');
    const binary = atob(base64Sample);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const arrayBuffer = bytes.buffer;

    // Unzip het bestand
    // const inflatedData = zlib.inflateSync(decodedData);
    // const arrayBuffer = base64ToArrayBuffer(inflatedData);
    // const arrayBuffer = base64ToArrayBuffer(decodedData);
    return context.decodeAudioData(arrayBuffer);
}

function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function playSample(sample, tijd) {
    const drumSource = context.createBufferSource();
    drumSource.buffer = sample;
    drumSource.connect(context.destination);
    drumSource.start(tijd);
}

function speelDrum(drum) {
    let sample = null;

    switch (drum.type) {
        case 'snaredrum': sample = instrumentSamples['drumsample']; break;
        case 'bassdrum': sample = instrumentSamples['snaredrumsample']; break;
        case 'hihat': sample = instrumentSamples['hihatsample']; break;
        default: return;
    }

    playSample(sample, drum.tijd);
}

function speelNoot(noot, tijd) {
    const frequentie = noot2frequentie(noot.noot, noot.octaaf);
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = frequentie;
    gain.gain.setValueAtTime(noot.volume, tijd);
    gain.gain.exponentialRampToValueAtTime(0.01, tijd + noot.duur);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(tijd);
    osc.stop(tijd + noot.duur);
}

// Voeg de drums toe aan de notenlijst
let noten = [];
class SongGenerator {
    generateSong(noten) {
    }
}

class SongGeneratorLSystem extends SongGenerator {
    genereerLSystemString(axioma, regels, iteraties) {
        let result = axioma;
        for (let i = 0; i < iteraties; i++) {
            let nieuwResult = '';
            for (const teken of result) {
                nieuwResult += regels[teken] || teken;
            }
            result = nieuwResult;
        }
        return result;
    }

    generateSong(noten) {
        super.generateSong(noten);

        const lSystemRegels = {
            'A': 'AB',
            'B': 'A'
        };

        const lSystemDrumRegels = {
            'A': 'AB',
            'B': 'AC',
            'C': 'A'
        };
        // const lSystemDrumRegels = {
        //     'D': 'DB',
        //     'B': 'CD',
        //     'C': 'D'
        // };

        const drumRitmeRegels = {
            'A': [{ duur: 0.5, type: 'snaredrum' }],
            'B': [{ duur: 0.25, type: 'bassdrum' }],
            'C': [{ duur: 0.25, type: 'hihat' }]
        };

        const melodieRegels = {
            'A': ['C', 'E'],
            'B': ['G']
        };

        const lengte = 8; // Het aantal maten in het nummer
        const akkoordenPerMaat = 4; // Het aantal akkoorden per maat
        const drumNotenPerMaat = 8; // Het aantal drumnoten per maat
        const akkoordprogressie = ['C', 'G', 'Am', 'F']; // Een voorbeeld akkoordprogressie die je kunt aanpassen op basis van je wensen
        let huidigAkkoord; // een variabele om het huidige akkoord bij te houden terwijl je door de muziek loopt
        const aantalNoten = lengte * akkoordenPerMaat;
        const aantalDrumNoten = lengte * drumNotenPerMaat;

        const akkoordenlijst = []; // een lijst om de gebruikte akkoorden bij te houden
        let tijdMelodie = 0; // de huidige tijd in de muziek
        let tijdDrum = 0;

        const lSystemString = this.genereerLSystemString('A', lSystemRegels, 3);
        const lSystemDrumString = this.genereerLSystemString('A', lSystemDrumRegels, 3);

        const melodie = this.genereerMelodieEnRitme(lSystemString, melodieRegels, aantalNoten);
        const drumRitme = this.genereerDrumRitme(lSystemDrumString, drumRitmeRegels, aantalDrumNoten);

        for (let i = 0; i < lengte; i++) {
            for (let j = 0; j < melodie.length; j++) {
                if (j % akkoordenPerMaat === 0) {
                    huidigAkkoord = akkoordprogressie[i % akkoordprogressie.length];
                    akkoordenlijst.push(huidigAkkoord);
                }

                // Gebruik de L-System melodie
                const noot = melodie[j % melodie.length] ?? 'C';
                const octaaf = 4 + Math.floor(Math.random() * 2);
                const volume = Math.random();
                const duurNoot = (60 / tempo) * 1.5;

                noten.push({
                    noot: noot,
                    octaaf: octaaf,
                    tijd: tijdMelodie,
                    duur: duurNoot,
                    akkoord: huidigAkkoord,
                    volume: volume,
                });
                tijdMelodie += duurNoot;
            }

            for (let j = 0; j < drumRitme.length; j++) {
                // Gebruik de L-System ritme (drums)
                const ritmeInfo = drumRitme[j];
                const drumtype = ritmeInfo.type;
                const duurDrum = ritmeInfo.duur * (60 / tempo);

                if (drumtype) {
                    noten.push({
                        type: drumtype,
                        drum: true,
                        tijd: tijdDrum,
                        duur: duurDrum,
                    });
                }

                tijdDrum += duurDrum;
            }
        }
    }

    genereerMelodieEnRitme(lSystemString, melodieRegels, aantalNoten) {
        const melodie = [];
        for (const teken of lSystemString) {
            const melodieNoot = melodieRegels[teken];
            if (melodieNoot) {
                melodie.push(melodieNoot[Math.floor(Math.random() * melodieNoot.length)]);
            }
        }
        return melodie.slice(0, aantalNoten);
    }

    genereerDrumRitme(lSystemString, drumRitmeRegels, aantalDrumNoten) {
        const drumRitme = [];
        for (let i = 0; i < aantalDrumNoten; i++) {
            const teken = lSystemString[i % lSystemString.length];
            const ritmeInfo = drumRitmeRegels[teken];
            if (ritmeInfo) {
                drumRitme.push(ritmeInfo[Math.floor(Math.random() * ritmeInfo.length)]);
            }
        }
        return drumRitme;
    }


}

class SongGeneratorMarkov extends SongGenerator {
    constructor() {
        super();
    }

    generateSong(noten) {
        super.generateSong(noten);

        // Genereer 2D Markov-ketenmatrix voor toonladder
        markovKetenToonladder = this.genereerMarkovKetenMatrix(toonladder.length);

        // Genereer 3D Markov-ketenmatrix voor akkoorden
        markovKetenAkkoorden = {};

        for (const akkoord in akkoorden) {
            markovKetenAkkoorden[akkoord] = this.genereerMarkovKetenMatrix(akkoorden[akkoord].length);
        }

        this.generateDrums(noten);
        // Genereer de noten en akkoorden
        let akkoordenlijst = [];
        let huidigAkkoord;
        let tijd = 0;
        let vorigeNootIndex = Math.floor(Math.random() * toonladder.length);
        for (let i = 0; i < lengte; i++) {
            for (let j = 0; j < ritme.length; j++) {
                // Kies een akkoord op basis van de akkoordprogressie
                if (j % akkoordenPerMaat === 0) {
                    huidigAkkoord = akkoordprogressie[i % akkoordprogressie.length];
                    akkoordenlijst.push(huidigAkkoord);
                }

                // Kies een noot uit het huidige akkoord met behulp van Markov-ketens
                const huidigMarkovKeten = SongGeneratorMarkov.markovKetenAkkoorden[huidigAkkoord];
                let nootIndex;
                let willekeurig = Math.random();
                vorigeNootIndex = Math.min(vorigeNootIndex, huidigMarkovKeten.length - 1);

                for (nootIndex = 0; nootIndex < huidigMarkovKeten[vorigeNootIndex].length; nootIndex++) {
                    willekeurig -= huidigMarkovKeten[vorigeNootIndex][nootIndex];
                    if (willekeurig <= 0) {
                        break;
                    }
                }

                const noot = akkoorden[huidigAkkoord][nootIndex] ?? akkoorden[huidigAkkoord][Math.floor(Math.random() * akkoorden[huidigAkkoord].length)];

                const octaaf = 4 + Math.floor(Math.random() * 2);
                vorigeNootIndex = nootIndex;

                // Voeg de noot toe aan de lijst
                const volume = Math.random(); // Genereer een willekeurig volume tussen 0 en 1
                const duurVariatie = Math.random() * 1.5 + 1.5; // Genereer een willekeurige duur tussen 0.5 en 1.0
                const duur = ritme[j] * (60 / tempo) * duurVariatie;
                noten.push({ noot: noot, octaaf: octaaf, tijd: tijd, duur: duur, akkoord: huidigAkkoord, volume: volume });
                tijd += duur;
            }
        }
    }

    generateDrums(noten) {
        for (let i = 0; i < drumRitmes.length; i++) {
            const drumRitme = drumRitmes[i];
            for (let j = 0; j < drumRitme.length; j++) {
                const geluiden = Object.keys(drumgeluidenPerRitme);
                for (let k = 0; k < geluiden.length; k++) {
                    const drum = geluiden[k];
                    if (drumgeluidenPerRitme[drum][j] === 1) {
                        const t = (i * drumRitme.length + j) * (60 / tempo);
                        noten.push({
                            type: drumtype,
                            drum: true,
                            tijd: t,
                            duur: 0.1,
                        });
                    }
                }
            }
        }
    }

    // Functie om de Markov-ketenmatrix te genereren
    genereerMarkovKetenMatrix(lengte) {
        const matrix = [];

        // Genereer rijen
        for (let i = 0; i < lengte; i++) {
            const rij = [];
            let resterendeKans = 1;
            for (let j = 0; j < lengte - 1; j++) {
                const kans = Math.random() * resterendeKans;
                rij.push(kans);
                resterendeKans -= kans;
            }
            rij.push(resterendeKans);
            matrix.push(rij);
        }

        // Normaliseer kolommen
        for (let i = 0; i < lengte; i++) {
            let kolomSom = 0;
            for (let j = 0; j < lengte; j++) {
                kolomSom += matrix[j][i];
            }
            for (let j = 0; j < lengte; j++) {
                matrix[j][i] /= kolomSom;
            }
        }

        return matrix;
    }
}

const songGenerator = new SongGeneratorLSystem();
songGenerator.generateSong(noten);

noten.sort((a, b) => a.startTime - b.startTime);

(async () => {
    const drumsample = await loadEncodedSample(base64DrumSample);
    const snaredrumsample = await loadEncodedSample(base64SnareDrumSample);
    const hihatsample = await loadEncodedSample(base64HihatSample);
    instrumentSamples['drumsample'] = drumsample;
    instrumentSamples['snaredrumsample'] = snaredrumsample;
    instrumentSamples['hihatsample'] = hihatsample;
    const psg = new PSGEmulator(context);

    // Speel de noten af via Web Audio API;
    let t = context.currentTime;
    for (let i = 0; i < noten.length; i++) {
        const noot = noten[i];
        if (noot.drum) {
            speelDrum(noot);
            console.log('drum' + noot.tijd);
        } else {
            // speelNoot(noot, noot.tijd);
            instruments[1].play(psg.channels[0], noot.duur, noot2frequentie(noot.noot, noot.octaaf), noot.tijd);
            console.log('noot' + noot.tijd);
        }
        t += noot.duur;
        // console.log(`${noot.drum ? noot.type : 'noot'}: ${noten[i].noot}${noten[i].octaaf}|${noten[i].akkoord}|${noten[i].duur}`);
    }
})();