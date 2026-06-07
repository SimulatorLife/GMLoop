#macro FOO_SIMPLE 1;
#macro BAR_SIMPLE (value + 1);

var answer_simple = FOO_SIMPLE + BAR_SIMPLE;

#macro FOO(value) (value + 1); // increments input
#macro BAR script_call();/* block comment ; sentinel */
#macro BAZ array_pop(stack); /* multi-line
    comment with ; inside */
#macro KEEP value;value // ensure this macro still retains its inline semicolon usage

var total = FOO(2) + BAR + BAZ + KEEP;

#macro MULTILINE_CONTINUED statement1();\
                           statement2();\
                           statement3();

