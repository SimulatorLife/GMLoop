for (var i = 0; i < amount; i += 1) {
    do_something();
}

for (count = 0; count < 3; ++count) {
    show_debug_message("done");
}

for (var step = 0; step < compute_limit(); step = step + 1) {

    trigger();

}

for (var j = 0; j < compute_half_limit(); j += 2) {trigger();

}

var v = 0;
for (k = v; k < amount; k++) {
    do_something_alt(v);
    v += 1;
}

for (var index = 0; index < array_length(items); index++) {
    sum += array_length(items);
}
