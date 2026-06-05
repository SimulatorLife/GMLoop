lexer grammar GameMakerLanguageLexer;

channels { ERROR }

@lexer::members {
    this.ignoreNewline = true;
    this.lastTokenType = null;
    this.templateDepth = 0;
    GameMakerLanguageLexer.prototype.nextToken = function() {
        var next = antlr4.Lexer.prototype.nextToken.call(this);
        if (next.channel === antlr4.Token.DEFAULT_CHANNEL) {
            this.lastTokenType = next.type;
        }
        return next;
    }
}

MultiLineComment:               '/*' .*? ('*/' | EOF)     -> channel(HIDDEN);
SingleLineComment:              '//' ~[\r\n\u2028\u2029]* -> channel(HIDDEN);

OpenBracket: '[';
ListAccessor: '[|';
MapAccessor: '[?';
GridAccessor: '[#';
ArrayAccessor: '[@';
StructAccessor: '[$';
CloseBracket:                   ']';

OpenParen:                      '(';
CloseParen:                     ')';
OpenBrace:                      '{';
TemplateStringEndExpression:    '}' {this.templateDepth > 0}? -> popMode;
CloseBrace:                     '}';
Begin:                          'begin';
End:                            'end';
SemiColon:                      ';';
Comma:                          ',';
Assign:                         '=' | ':=';
Colon:                          ':';
Dot:                            '.';
PlusPlus:                       '++';
MinusMinus:                     '--';
Plus:                           '+';
Minus:                          '-';
BitNot:                         '~';
Not:                            '!' | 'not';
Multiply:                       '*';
Divide:                         '/';
IntegerDivide:                  'div';
Modulo:                         '%' | 'mod';
Power:                          '**';
QuestionMark:                   '?';
NullCoalesce:                   '??';
NullCoalescingAssign:           '??=';
RightShiftArithmetic:           '>>';
LeftShiftArithmetic:            '<<';
LessThan:                       '<';
MoreThan:                       '>';
LessThanEquals:                 '<=';
GreaterThanEquals:              '>=';
Equals:                         '==' | '=';
NotEquals:                      '!=' | '<>';
BitAnd:                         '&';
BitXOr:                         '^';
BitOr:                          '|';
And:                            '&&' | 'and';
Or:                             '||' | 'or';
Xor:                            '^^' | 'xor';
MultiplyAssign:                 '*=';
DivideAssign:                   '/=';
PlusAssign:                     '+=';
MinusAssign:                    '-=';
ModulusAssign:                  '%=';
LeftShiftArithmeticAssign:      '<<=';
RightShiftArithmeticAssign:     '>>=';
BitAndAssign:                   '&=';
BitXorAssign:                   '^=';
BitOrAssign:                    '|=';
NumberSign:                     '#';
DollarSign:                     '$';
AtSign:                         '@';

/// Null Literals

UndefinedLiteral:               'undefined';
NoOneLiteral:                   'noone';

/// Boolean Literals

BooleanLiteral:                 'true' | 'false';

/// Numeric Literals

IntegerLiteral:                 DecimalIntegerLiteral;

DecimalLiteral: (DecimalIntegerLiteral? '.' [0-9]+) | (DecimalIntegerLiteral '.');

BinaryLiteral:                  '0b' ('_'* [01])+;
HexIntegerLiteral:              HexLiteralPrefix [0-9a-fA-F] HexDigit*;

/// Keywords

Break:                          'break';
Exit:                           'exit';
Do:                             'do';
Case:                           'case';
Else:                           'else';
New:                            'new';
Var:                            'var';
GlobalVar:                      'globalvar';
Catch:                          'catch';
Finally:                        'finally';
Return:                         'return';
Continue:                       'continue';
For:                            'for';
Switch:                         'switch';
While:                          'while';
Until:                          'until';
Repeat:                         'repeat';
Function_:                      'function';
With:                           'with';
Default:                        'default';
If:                             'if';
Then:                           'then';
Throw:                          'throw';
Delete:                         'delete';
Try:                            'try';
Enum:                           'enum';
Constructor:                    'constructor';
Static:                         'static';

Macro: '#macro' {this.ignoreNewline = false};
EscapedNewLine: '\\';

Define: '#define' -> pushMode(REGION_NAME);  // Legacy #define directives are normalised later to #macro/#region or dropped entirely
Region: '#region' -> pushMode(REGION_NAME);
EndRegion: '#endregion' -> pushMode(REGION_NAME);

/// Identifier Names and Identifiers

Identifier
    : IdentifierStart IdentifierPart*
    ;

/// String Literals

StringLiteral: '"' StringCharacter* '"';

TemplateStringStart
    : '$"' {this.templateDepth++} -> pushMode(TEMPLATE_STRING)
    ;

VerbatimStringLiteral
    : '@"' (~'"' | '""')* '"'
    | '@\'' (~'\'' | '\'\'')* '\''
    ;

/// Misc

WhiteSpaces
    : [\t\u000B\u000C\u0020\u00A0]+ -> channel(HIDDEN)
    ;

LineTerminator
    : [\r\n\u2028\u2029] {
        if (this.ignoreNewline) {
            this._channel = 1;
        }
        if (this.lastTokenType == GameMakerLanguageLexer.EscapedNewLine) {
            this._channel = 1;
        } else {
            this.ignoreNewline = true;
        }
    }
    ;

UnexpectedCharacter
    : . -> channel(ERROR)
    ;

/// Fragment rules

fragment IdentifierStart
    : [\p{L}] | '_'
    ;

fragment IdentifierPart
    : IdentifierStart
    | [\p{Mn}]
    | [\p{Nd}]
    | [\p{Pc}]
    ;

fragment StringCharacter
    : ~["\\\r\n]
    | '\\' SingleEscapeCharacter
    | '\\' ~[\r\n]
    ;

fragment HexLiteralPrefix
    : '0x' | '$' | '#'
    ;

fragment HexDigit
    : [_0-9a-fA-F]
    ;

fragment SingleEscapeCharacter
    : ['"\\bfnrtvBFNRTV]
    ;

fragment DecimalIntegerLiteral
    : '0' [0-9_]*
    | [1-9] [0-9_]*
    ;

mode REGION_NAME;

RegionCharacters
    : ~[\r\n\u2028\u2029]+
    ;

RegionEOL
    : [\r\n\u2028\u2029] -> popMode
    ;

mode TEMPLATE_STRING;

TemplateStringEnd: '"' {this.templateDepth--} -> popMode;
TemplateStringStartExpression: '{' -> pushMode(DEFAULT_MODE);
TemplateStringText
    : (~('{' | '\\' | '"'))+
    | '\\' SingleEscapeCharacter
    | '\\' .
    ;
