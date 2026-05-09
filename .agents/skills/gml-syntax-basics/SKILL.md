---

name: gml-syntax-basics
description: Understand and work with GameMaker Language (GML), including its syntax differences from JavaScript, GML-specific language constructs, data accessors, keywords, constants, and formatting conventions.
---

Correctly interpret, generate, refactor, lint, format, and reason about GameMaker Language (GML) code.

GML is syntactically similar to JavaScript ES3, but differs significantly in semantics, runtime behavior, data structures, syntax rules, and language features.

Treat GML as a JavaScript-like language with the following important differences and extensions.

## Object Model & Types

* GML uses `self` instead of `this`
* GML calls objects "structs"
* GML calls numbers "reals"
* GML uses `pointer_null` instead of `null`
* GML uses lowercase `infinity` instead of `Infinity`

## Type & Instance Checks

GML uses specific, built-in functions for type checking instead of operators:

```gml
instanceof(value)
is_instanceof(value, SomeConstructor)
```

Instead of:

```js
typeof value
value instanceof SomeConstructor
```

## Variable Declarations

GML supports:

* `var`
* `global.`
* `globalvar` (DEPRECATED)
* `static`

GML does **NOT** support:

* `let`
* `const`

Example:

```gml
var my_value = 10;
global.global_score = 0;
static static_counter = 0;
```

## Constructor Functions ("Structs")

GML does not use ES6 classes. Instead, from version 2.3 and above, GML has constructor functions, which have the `constructor` keyword between the parameters and the body:

```gml
function MyStruct(_value) constructor {
    self.value = _value;
}
```

## Strings

GML strings must use double quotes only.

Valid:

```gml
var name = "Henry";
```

Invalid:

```gml
var name = 'Henry';
```

For string concatenation, use the `+` operator:

```gml
var full_name = "Henry" + " " + "Smith";
```

For string interpolation, use `$` at the start of the string, and `{}` for embedded expressions:

```gml
var last_name = "Smith";
var full_name = $"Henry {last_name}";
```

## Naming Rules

Identifiers:

* may contain alphanumeric characters and underscores
* must not begin with a number

Valid:

```gml
my_variable
_player2
```

Invalid:

```gml
2variable
my-variable
```

## Struct Accessors

```gml
my_struct[$ "field"]
my_struct.field
struct_get(my_struct, "field")
```

## ds_list Accessor

```gml
my_list[| 0]
```

## ds_map Accessor

```gml
my_map[? "name"]
```

## ds_grid Accessor

```gml
my_grid[# 5, 8]
```

## Array Accessors

```gml
my_array[0]
my_array[@ 0]

// 1D array
array_get(my_array, 0);
// 2D array
array_get(my_array[0], 0);
// 3D array
array_get(my_array[0][0], 0);
```

The array `@` accessor bypasses Copy-on-Write and performs in-place mutation on the original array. Using the `@` accessor bypasses the 'Copy on Write' behaviour and directly modifies the referenced array. This can be used to selectively disable 'Copy on Write' for specific statements while keeping the option enabled. This is not necessary if the setting 'Copy on Write' is disabled (which is the default and recommended option).

## Arrays, Strings, and Functions

Arrays, strings, and functions do NOT expose methods or properties via `.` accessors.

Use standalone functions instead.

Correct:

```gml
array_length(my_array)
string_length(my_string)
```

Incorrect:

```js
my_array.length
my_string.length
```

# Macros

GML supports compile-time macros using `#macro`.

Example:

```gml
#macro PLAYER_SPEED 4
```

Multi-line macros use trailing `\`:

```gml
#macro LONG_MACRO \
    "part1" + \
    "part2"
```

Macro references are expanded at compile time. Macros cannot end with a semicolon, but can be used in expressions with or without semicolons:

```gml
var speed = PLAYER_SPEED;
```

## Logical Operators

GML supports both symbolic and keyword forms.

## Operators

GML supports the following expression operators.

| Category | Operators | Notes |
|---|---|---|
| Assignment | `=` | Assignment. Legacy code may use `=` for comparison, but prefer `==` for equality. |
| Logical | `&&`, `\|\|`, `^^` | Boolean AND, OR, XOR. Keyword forms: `and`, `or`, `xor`. |
| Nullish | `??`, `??=` | Nullish means `undefined` or `pointer_null`. RHS of `??` only runs when needed. |
| Comparison | `<`, `<=`, `==`, `!=`, `>`, `>=` | Return boolean values. |
| Bitwise | `\|`, `&`, `^`, `<<`, `>>` | Bitwise OR, AND, XOR, shift left, shift right. |
| Bitwise assignment | `\|=`, `&=`, `^=` | Apply bitwise operation and assign result. |
| Arithmetic | `+`, `-`, `*`, `/` | Add, subtract, multiply, divide. |
| Arithmetic assignment | `+=`, `-=`, `*=`, `/=` | Apply arithmetic operation and assign result. |
| String concatenation | `+`, `+=` | Both operands must be strings unless explicitly converted. |
| Increment/decrement | `++`, `--` | Prefix and postfix forms differ. Avoid complex mixed expressions. |
| Division/modulo | `div`, `%`, `mod`, `%=` | `div` is integer division. `mod` and `%` are equivalent modulo operators. |
| Unary | `!`, `-`, `~` | Logical NOT, numeric negation, bitwise negation. Keyword form for `!` is `not`. |
| Conditional | `<condition> ? <expression1 (if true)> : <expression2 (if false)>` | Ternary conditional expression. Nested conditionals should be parenthesized. |

## Binary Literals

```gml
var _six = 0b0010 | 0b0100; // produces 0b0110, or 6
```

## Hexadecimal Literals

```gml
$abcd
0xabcd
```

## Documentation Comments

GML JSDoc-style comments use triple slash syntax:

```gml
/// @function scr_my_function
/// @param {real} value
/// @returns {real}
```

## Regions

Code-folding regions use:

```gml
#region My Region
#endregion
```

```gml
#region My Region
// ...many lines of code...
#endregion End of My Region
```

## Control Flow Keywords

* `if`
* `then`
* `else`
* `switch`
* `case`
* `default`
* `while`
* `do`
* `for`
* `repeat`
* `until`
* `break`
* `continue`
* `exit`
* `return`
* `begin`, `end` (legacy block delimiters, equivalent to braces)

## Struct & Function Keywords

* `function`
* `constructor`
* `new`
* `delete`
* `enum`

## Exception Handling Keywords

* `try`
* `catch`
* `finally`
* `throw`

## Miscellaneous Keywords

* `#macro`
* `#region`
* `#endregion`

## Boolean & Numeric Constants

* `true`
* `false`
* `pi`
* `NaN`
* `infinity`

## Variable Scope Keywords

* `global`
* `globalvar` (DEPRECATED)
* `static`
* `var`

## Instance & Scope Keywords

* `self`
* `other`
* `with`
* `noone`
* `all`

## Pointer & Undefined Values

* `undefined`
* `pointer_invalid`
* `pointer_null`