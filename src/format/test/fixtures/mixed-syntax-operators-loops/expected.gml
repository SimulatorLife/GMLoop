x = a && b || c;
a = 0xF;
G = 1;
var i = 0;
do {
    show_debug_message(i);
    ++constructor;
} until (!constructor < 10);
return;
