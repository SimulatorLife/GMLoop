parser grammar GameMakerLanguageParser;

options {tokenVocab=GameMakerLanguageLexer;}

@parser::members {
    this.isAssignmentOperatorToken = function (tokenType) {
        return tokenType === GameMakerLanguageParser.MultiplyAssign
            || tokenType === GameMakerLanguageParser.DivideAssign
            || tokenType === GameMakerLanguageParser.ModulusAssign
            || tokenType === GameMakerLanguageParser.PlusAssign
            || tokenType === GameMakerLanguageParser.MinusAssign
            || tokenType === GameMakerLanguageParser.LeftShiftArithmeticAssign
            || tokenType === GameMakerLanguageParser.RightShiftArithmeticAssign
            || tokenType === GameMakerLanguageParser.BitAndAssign
            || tokenType === GameMakerLanguageParser.BitXorAssign
            || tokenType === GameMakerLanguageParser.BitOrAssign
            || tokenType === GameMakerLanguageParser.NullCoalescingAssign
            || tokenType === GameMakerLanguageParser.Assign;
    };

    this.isLikelyAssignmentStatement = function () {
        let lookahead = 1;
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;

        while (lookahead < 2048) {
            const token = this._input.LT(lookahead);
            if (!token) {
                return false;
            }

            const tokenType = token.type;

            if (
                tokenType === GameMakerLanguageParser.EOF
                || tokenType === GameMakerLanguageParser.SemiColon
                || (tokenType === GameMakerLanguageParser.CloseParen
                    && parenDepth === 0
                    && bracketDepth === 0
                    && braceDepth === 0)
            ) {
                return false;
            }

            if (tokenType === GameMakerLanguageParser.OpenParen) {
                parenDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseParen) {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (
                tokenType === GameMakerLanguageParser.OpenBracket
                || tokenType === GameMakerLanguageParser.ListAccessor
                || tokenType === GameMakerLanguageParser.MapAccessor
                || tokenType === GameMakerLanguageParser.GridAccessor
                || tokenType === GameMakerLanguageParser.ArrayAccessor
                || tokenType === GameMakerLanguageParser.StructAccessor
            ) {
                bracketDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseBracket) {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (tokenType === GameMakerLanguageParser.OpenBrace || tokenType === GameMakerLanguageParser.Begin) {
                braceDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseBrace || tokenType === GameMakerLanguageParser.End) {
                braceDepth = Math.max(0, braceDepth - 1);
            }

            if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && this.isAssignmentOperatorToken(tokenType)) {
                return true;
            }

            lookahead += 1;
        }

        return false;
    };

    this.isLikelyIncDecStatement = function () {
        if (
            this._input.LA(1) === GameMakerLanguageParser.PlusPlus
            || this._input.LA(1) === GameMakerLanguageParser.MinusMinus
        ) {
            return true;
        }

        let lookahead = 1;
        let parenDepth = 0;
        let bracketDepth = 0;
        let braceDepth = 0;
        let lastTopLevelTokenType = null;

        while (lookahead < 2048) {
            const token = this._input.LT(lookahead);
            if (!token) {
                return false;
            }

            const tokenType = token.type;

            if (
                tokenType === GameMakerLanguageParser.EOF
                || tokenType === GameMakerLanguageParser.SemiColon
                || (tokenType === GameMakerLanguageParser.CloseParen
                    && parenDepth === 0
                    && bracketDepth === 0
                    && braceDepth === 0)
            ) {
                return (
                    lastTopLevelTokenType === GameMakerLanguageParser.PlusPlus
                    || lastTopLevelTokenType === GameMakerLanguageParser.MinusMinus
                );
            }

            if (tokenType === GameMakerLanguageParser.OpenParen) {
                parenDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseParen) {
                parenDepth = Math.max(0, parenDepth - 1);
            } else if (
                tokenType === GameMakerLanguageParser.OpenBracket
                || tokenType === GameMakerLanguageParser.ListAccessor
                || tokenType === GameMakerLanguageParser.MapAccessor
                || tokenType === GameMakerLanguageParser.GridAccessor
                || tokenType === GameMakerLanguageParser.ArrayAccessor
                || tokenType === GameMakerLanguageParser.StructAccessor
            ) {
                bracketDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseBracket) {
                bracketDepth = Math.max(0, bracketDepth - 1);
            } else if (tokenType === GameMakerLanguageParser.OpenBrace || tokenType === GameMakerLanguageParser.Begin) {
                braceDepth += 1;
            } else if (tokenType === GameMakerLanguageParser.CloseBrace || tokenType === GameMakerLanguageParser.End) {
                braceDepth = Math.max(0, braceDepth - 1);
            }

            if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                if (
                    tokenType === GameMakerLanguageParser.PlusPlus
                    || tokenType === GameMakerLanguageParser.MinusMinus
                ) {
                    // Treat the first top-level postfix ++/-- as the end of an
                    // inc/dec statement candidate. Without this guard, optional
                    // semicolon parsing can scan into subsequent statements and
                    // incorrectly reject lines like:
                    //   myCount--
                    //   myCount++
                    return true;
                }

                lastTopLevelTokenType = tokenType;
            }

            lookahead += 1;
        }

        return false;
    };
}

program
    : statementList? EOF
    ;

statementList
    : statement+
    ;

statement
    : (block
    | emptyStatement
    | ifStatement
    | variableDeclarationList
    | iterationStatement
    | continueStatement
    | breakStatement
    | returnStatement
    | withStatement
    | switchStatement
    | tryStatement
    | throwStatement
    | exitStatement
    | macroStatement
    | defineStatement
    | regionStatement
    | enumeratorDeclaration
    | globalVarStatement
    | implicitCallStatement
    | {this.isLikelyAssignmentStatement()}? assignmentExpression
    | {this.isLikelyIncDecStatement()}? incDecStatement
    | callStatement
    | functionDeclaration
    | deleteStatement
    | literalStatement
    | identifierStatement
    ) eos?
    ;

block
    : openBlock statementList? closeBlock
    ;

ifStatement
    : If expression Then? statement (Else statement)?
    ;

iterationStatement
    : Do statement Until expression # DoStatement
    | While expression statement # WhileStatement
    | For OpenParen
        (variableDeclarationList | assignmentExpression)? SemiColon
        expression? SemiColon
        statement?
    CloseParen statement # ForStatement
    | Repeat expression statement # RepeatStatement
    ;

withStatement
    : With expression statement
    ;

switchStatement
    : Switch expression caseBlock
    ;

continueStatement
    : Continue
    ;

breakStatement
    : Break
    ;

exitStatement
    : Exit
    ;

emptyStatement
    : SemiColon
    ;

caseBlock
    : openBlock (caseClause | defaultClause | regionStatement | macroStatement)* closeBlock
    ;

caseClauses
    : caseClause+
    ;

caseClause
    : Case expression Colon statementList?
    ;

defaultClause
    : Default Colon statementList?
    ;

throwStatement
    : Throw expression
    ;

tryStatement
    : Try statement (catchProduction finallyProduction? | finallyProduction)
    ;

catchProduction
    : Catch (OpenParen identifier? CloseParen)? statement
    ;

finallyProduction
    : Finally statement
    ;

returnStatement
    : Return expression?
    ;

deleteStatement
    : Delete expression
    ;

literalStatement
    : literal
    ;

assignmentExpression
    : lValueExpression assignmentOperator expressionOrFunction
    ;

variableDeclarationList
    : varModifier variableDeclaration (Comma variableDeclaration)*
    ;

varModifier
    : Var+
    | Static
    ;

variableDeclaration
    : identifier (Assign expressionOrFunction)?
    ;

globalVarStatement
    : GlobalVar identifier (Comma identifier)* SemiColon
    ;

newExpression
    : New identifier arguments
    ;

lValueStartExpression
    : identifier # IdentifierLValue
    | newExpression # NewLValue
    | Dot identifier # ImplicitMemberDotLValue
    | OpenParen expression CloseParen # ParenthesizedLValue
    | structLiteral # StructLiteralLValue
    ;

lValueExpression
    : lValueStartExpression (lValueChainOperator* lValueFinalOperator)?
    ;

lValueChainOperator
    : accessor expressionSequence CloseBracket # MemberIndexLValue
    | Dot identifier # MemberDotLValue
    | arguments # CallLValue
    ;

lValueFinalOperator
    : accessor expressionSequence CloseBracket # MemberIndexLValueFinal
    | Dot identifier # MemberDotLValueFinal
    ;

expressionSequence
    : expression (Comma expression)*
    ;

expressionOrFunction
    : assignmentExpression
    | expression
    | functionDeclaration
    ;

expression
    : callStatement # CallExpression
    | <assoc=right> Plus expression # UnaryPlusExpression
    | <assoc=right> Minus expression # UnaryMinusExpression
    | <assoc=right> BitNot expression # BitNotExpression
    | <assoc=right> Not expression # NotExpression
    | expression (Multiply | Divide | IntegerDivide | Modulo) expression # BinaryExpression
    | expression (Plus | Minus) expression # BinaryExpression
    | expression (LeftShiftArithmetic | RightShiftArithmetic) expression # BinaryExpression
    | expression BitAnd expression # BinaryExpression
    | expression BitXOr expression # BinaryExpression
    | expression BitOr expression # BinaryExpression
    | expression (Equals | NotEquals | Assign) expression # BinaryExpression
    | expression (LessThan | MoreThan | LessThanEquals | GreaterThanEquals) expression # BinaryExpression
    | <assoc=right> expression NullCoalesce expression # BinaryExpression
    | expression And expression # BinaryExpression
    | expression Or expression # BinaryExpression
    | expression Xor expression # BinaryExpression
    | ( preIncDecExpression | postIncDecExpression ) # IncDecExpression
    | <assoc=right> expression QuestionMark expression Colon expression # TernaryExpression
    | lValueExpression # VariableExpression
    | functionDeclaration # FunctionExpression
    | literal # LiteralExpression
    ;

callStatement
    : callableExpression arguments
    | callStatement arguments
    ;

    implicitCallStatement
        : Dot identifier arguments
        | implicitCallStatement arguments
        ;

callableExpression
    : lValueExpression
    | OpenParen (functionDeclaration | callableExpression) CloseParen
    ;

preIncDecExpression
    : (PlusPlus | MinusMinus) lValueExpression # PreIncDecStatement
    ;

postIncDecExpression
    : lValueExpression (PlusPlus | MinusMinus) # PostIncDecStatement
    ;

incDecStatement
    : postIncDecExpression
    | preIncDecExpression
    ;

accessor
    : OpenBracket
    | ListAccessor
    | MapAccessor
    | GridAccessor
    | ArrayAccessor
    | StructAccessor
    ;

arguments
    : OpenParen CloseParen
    | OpenParen argumentList? trailingComma? CloseParen
    ;

argumentList
    : Comma argument (Comma argument)*
    | argument Comma argument (Comma argument)*
    | argument
    ;

argument
    : expressionOrFunction
    | UndefinedLiteral
    | /* empty, to represent a missing argument */
    ;

trailingComma
    : Comma
    ;

assignmentOperator
    : MultiplyAssign
    | DivideAssign
    | ModulusAssign
    | PlusAssign
    | MinusAssign
    | LeftShiftArithmeticAssign
    | RightShiftArithmeticAssign
    | BitAndAssign
    | BitXorAssign
    | BitOrAssign
    | NullCoalescingAssign
    | Assign
    ;

literal
    : UndefinedLiteral
    | NoOneLiteral
    | BooleanLiteral
    | StringLiteral
    | VerbatimStringLiteral
    | templateStringLiteral
    | HexIntegerLiteral
    | BinaryLiteral
    | DecimalLiteral
    | IntegerLiteral
    | arrayLiteral
    | structLiteral
    ;

templateStringLiteral
    : TemplateStringStart templateStringAtom* TemplateStringEnd
    ;

templateStringAtom
    : TemplateStringText
    | TemplateStringStartExpression expression TemplateStringEndExpression
    ;

arrayLiteral
    : OpenBracket elementList CloseBracket
    ;

elementList
    : Comma* expressionOrFunction? (Comma+ expressionOrFunction)* Comma? // Yes, everything is optional
    ;

structLiteral
    : openBlock (structItem (Comma? structItem)* Comma?)? closeBlock
    ;

structItem
    : propertyAssignment
    | regionStatement
    | macroStatement
    ;

propertyAssignment
    : propertyIdentifier Colon expressionOrFunction
    ;

propertyIdentifier
    : Identifier
    | softKeyword
    | propertySoftKeyword
    | StringLiteral
    | VerbatimStringLiteral
    ;

functionDeclaration
    : Function_ Identifier? parameterList constructorClause? block
    ;

constructorClause
    : (Colon Identifier arguments)? Constructor
    ;

parameterList
    : OpenParen (parameterArgument (Comma parameterArgument)* Comma?)? CloseParen
    ;

parameterArgument
    : identifier (Assign expressionOrFunction)?
    ;

identifier
    : Identifier | softKeyword
    ;

enumeratorDeclaration
    : Enum identifier openBlock (enumeratorList)? closeBlock
    ;

enumeratorList
    : enumeratorItem (Comma? enumeratorItem)* Comma?
    ;

enumeratorItem
    : enumerator
    | regionStatement
    | macroStatement
    ;

enumerator
    : identifier (Assign expression)?
    ;

macroStatement
    : Macro identifier macroToken+ (LineTerminator | EOF)
    ;

defineStatement
    : Define RegionCharacters (RegionEOL | EOF)
    ;

regionStatement
    : (Region | EndRegion) RegionCharacters? (RegionEOL | EOF)
    ;

// handles macros used as statements
identifierStatement
    : identifier {this._input.LA(1) !== GameMakerLanguageParser.Dot}?
    ;

softKeyword
    : Constructor
    ;

propertySoftKeyword
    : NoOneLiteral
    ;

openBlock
    : OpenBrace | Begin
    ;

closeBlock
    : CloseBrace | End
    ;

eos
    : SemiColon
    ;

// every token except:
// WhiteSpaces, LineTerminator, Define, Macro, Region, EndRegion, UnexpectedCharacter
// includes EscapedNewLine
macroToken
    : EscapedNewLine | OpenBracket | CloseBracket | OpenParen | CloseParen
    | OpenBrace | CloseBrace | Begin | End | SemiColon | Comma | Assign | Colon
    | Dot | PlusPlus | MinusMinus | Plus | Minus | BitNot | Not | Multiply | Divide
    | IntegerDivide | Modulo | Power | QuestionMark | NullCoalesce
    | NullCoalescingAssign | RightShiftArithmetic | LeftShiftArithmetic
    | LessThan | MoreThan | LessThanEquals | GreaterThanEquals | Equals | NotEquals
    | BitAnd | BitXOr | BitOr | And | Or | Xor | MultiplyAssign | DivideAssign | PlusAssign
    | MinusAssign | ModulusAssign | LeftShiftArithmeticAssign | RightShiftArithmeticAssign
    | BitAndAssign | BitXorAssign | BitOrAssign | NumberSign | DollarSign | AtSign
    | UndefinedLiteral | NoOneLiteral | BooleanLiteral | IntegerLiteral | DecimalLiteral
    | BinaryLiteral | HexIntegerLiteral | Break | Exit | Do | Case | Else | New
    | Var | GlobalVar | Catch | Finally | Return | Continue | For | Switch | While
    | Until | Repeat | Function_ | With | Default | If | Then | Throw | Delete
    | Try | Enum | Constructor | Static | Identifier | StringLiteral | VerbatimStringLiteral
    | TemplateStringStart | TemplateStringEnd | TemplateStringText | TemplateStringStartExpression
    | TemplateStringEndExpression | OpenBracket | ListAccessor | MapAccessor | GridAccessor | ArrayAccessor
    | StructAccessor
    ;
