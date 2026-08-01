#macro AND &&
#macro OR ||
#macro NOT !
#macro XOR ^^

if (a && !b || c ^^ d) {
    result = true;
}
if (ready AND NOT done OR extra XOR flag) {
    finish();
}
if (!(a && b) || value != other) {
    keep();
}
