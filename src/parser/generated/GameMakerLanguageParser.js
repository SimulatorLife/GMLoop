// Generated from GameMakerLanguageParser.g4 by ANTLR 4.13.2
// jshint ignore: start
import antlr4 from 'antlr4';
import GameMakerLanguageParserListener from './GameMakerLanguageParserListener.js';
import GameMakerLanguageParserVisitor from './GameMakerLanguageParserVisitor.js';

const serializedATN = [4,1,114,765,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,
4,2,5,7,5,2,6,7,6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,
2,13,7,13,2,14,7,14,2,15,7,15,2,16,7,16,2,17,7,17,2,18,7,18,2,19,7,19,2,
20,7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,24,2,25,7,25,2,26,7,26,2,27,
7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,31,2,32,7,32,2,33,7,33,2,34,7,
34,2,35,7,35,2,36,7,36,2,37,7,37,2,38,7,38,2,39,7,39,2,40,7,40,2,41,7,41,
2,42,7,42,2,43,7,43,2,44,7,44,2,45,7,45,2,46,7,46,2,47,7,47,2,48,7,48,2,
49,7,49,2,50,7,50,2,51,7,51,2,52,7,52,2,53,7,53,2,54,7,54,2,55,7,55,2,56,
7,56,2,57,7,57,2,58,7,58,2,59,7,59,2,60,7,60,2,61,7,61,2,62,7,62,2,63,7,
63,2,64,7,64,2,65,7,65,2,66,7,66,2,67,7,67,2,68,7,68,2,69,7,69,2,70,7,70,
2,71,7,71,2,72,7,72,2,73,7,73,2,74,7,74,2,75,7,75,1,0,3,0,154,8,0,1,0,1,
0,1,1,4,1,159,8,1,11,1,12,1,160,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,
1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,
3,2,191,8,2,1,2,3,2,194,8,2,1,3,1,3,3,3,198,8,3,1,3,1,3,1,4,1,4,1,4,3,4,
205,8,4,1,4,1,4,1,4,3,4,210,8,4,1,5,1,5,1,5,1,5,1,5,1,5,1,5,1,5,1,5,1,5,
1,5,1,5,1,5,3,5,225,8,5,1,5,1,5,3,5,229,8,5,1,5,1,5,3,5,233,8,5,1,5,1,5,
1,5,1,5,1,5,1,5,3,5,241,8,5,1,6,1,6,1,6,1,6,1,7,1,7,1,7,1,7,1,8,1,8,1,9,
1,9,1,10,1,10,1,11,1,11,1,12,1,12,1,12,1,12,1,12,5,12,264,8,12,10,12,12,
12,267,9,12,1,12,1,12,1,13,4,13,272,8,13,11,13,12,13,273,1,14,1,14,1,14,
1,14,3,14,280,8,14,1,15,1,15,1,15,3,15,285,8,15,1,16,1,16,1,16,1,17,1,17,
1,17,1,17,3,17,294,8,17,1,17,3,17,297,8,17,1,18,1,18,1,18,3,18,302,8,18,
1,18,3,18,305,8,18,1,18,1,18,1,19,1,19,1,19,1,20,1,20,3,20,314,8,20,1,21,
1,21,1,21,1,22,1,22,1,23,1,23,1,23,1,23,1,24,1,24,1,24,1,24,5,24,329,8,24,
10,24,12,24,332,9,24,1,25,4,25,335,8,25,11,25,12,25,336,1,25,3,25,340,8,
25,1,26,1,26,1,26,3,26,345,8,26,1,27,1,27,1,27,1,27,5,27,351,8,27,10,27,
12,27,354,9,27,1,27,1,27,1,28,1,28,1,28,1,28,1,29,1,29,1,29,1,29,1,29,1,
29,1,29,1,29,1,29,3,29,371,8,29,1,30,1,30,5,30,375,8,30,10,30,12,30,378,
9,30,1,30,3,30,381,8,30,1,31,1,31,1,31,1,31,1,31,1,31,1,31,3,31,390,8,31,
1,32,1,32,1,32,1,32,1,32,1,32,3,32,398,8,32,1,33,1,33,1,33,5,33,403,8,33,
10,33,12,33,406,9,33,1,34,1,34,1,34,3,34,411,8,34,1,35,1,35,1,35,1,35,1,
35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,3,35,425,8,35,1,35,1,35,1,35,3,35,
430,8,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,
1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,
35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,1,35,
5,35,474,8,35,10,35,12,35,477,9,35,1,36,1,36,1,36,1,36,1,36,1,36,5,36,485,
8,36,10,36,12,36,488,9,36,1,37,1,37,1,37,1,37,1,37,1,37,1,37,5,37,497,8,
37,10,37,12,37,500,9,37,1,38,1,38,1,38,1,38,3,38,506,8,38,1,38,1,38,3,38,
510,8,38,1,39,1,39,1,39,1,40,1,40,1,40,1,41,1,41,3,41,520,8,41,1,42,1,42,
1,43,1,43,1,43,1,43,3,43,528,8,43,1,43,3,43,531,8,43,1,43,3,43,534,8,43,
1,44,1,44,1,44,1,44,5,44,540,8,44,10,44,12,44,543,9,44,1,44,1,44,1,44,1,
44,1,44,5,44,550,8,44,10,44,12,44,553,9,44,1,44,3,44,556,8,44,1,45,1,45,
1,45,3,45,561,8,45,1,46,1,46,1,47,1,47,1,48,1,48,1,48,1,48,1,48,1,48,1,48,
1,48,1,48,1,48,1,48,1,48,3,48,579,8,48,1,49,1,49,5,49,583,8,49,10,49,12,
49,586,9,49,1,49,1,49,1,50,1,50,1,50,1,50,1,50,3,50,595,8,50,1,51,1,51,1,
51,1,51,1,52,5,52,602,8,52,10,52,12,52,605,9,52,1,52,3,52,608,8,52,1,52,
4,52,611,8,52,11,52,12,52,612,1,52,5,52,616,8,52,10,52,12,52,619,9,52,1,
52,3,52,622,8,52,1,53,1,53,1,53,3,53,627,8,53,1,53,5,53,630,8,53,10,53,12,
53,633,9,53,1,53,3,53,636,8,53,3,53,638,8,53,1,53,1,53,1,54,1,54,1,54,3,
54,645,8,54,1,55,1,55,1,55,1,55,1,56,1,56,1,56,1,56,1,56,3,56,656,8,56,1,
57,1,57,3,57,660,8,57,1,57,1,57,3,57,664,8,57,1,57,1,57,1,58,1,58,1,58,3,
58,671,8,58,1,58,1,58,1,59,1,59,1,59,1,59,5,59,679,8,59,10,59,12,59,682,
9,59,1,59,3,59,685,8,59,3,59,687,8,59,1,59,1,59,1,60,1,60,1,60,3,60,694,
8,60,1,61,1,61,3,61,698,8,61,1,62,1,62,1,62,1,62,3,62,704,8,62,1,62,1,62,
1,63,1,63,3,63,710,8,63,1,63,5,63,713,8,63,10,63,12,63,716,9,63,1,63,3,63,
719,8,63,1,64,1,64,1,64,3,64,724,8,64,1,65,1,65,1,65,3,65,729,8,65,1,66,
1,66,1,66,4,66,734,8,66,11,66,12,66,735,1,66,1,66,1,67,1,67,1,67,1,67,1,
68,1,68,3,68,746,8,68,1,68,1,68,1,69,1,69,1,69,1,70,1,70,1,71,1,71,1,72,
1,72,1,73,1,73,1,74,1,74,1,75,1,75,1,75,0,3,70,72,74,76,0,2,4,6,8,10,12,
14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,44,46,48,50,52,54,56,58,60,
62,64,66,68,70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100,102,104,106,
108,110,112,114,116,118,120,122,124,126,128,130,132,134,136,138,140,142,
144,146,148,150,0,14,1,0,28,31,1,0,24,25,1,0,36,37,2,0,19,19,42,43,1,0,38,
41,1,0,22,23,1,0,3,8,3,0,19,19,35,35,50,59,1,1,108,108,1,1,111,111,1,0,101,
102,2,0,12,12,15,15,2,0,14,14,16,16,4,0,3,97,99,99,103,106,112,114,836,0,
153,1,0,0,0,2,158,1,0,0,0,4,190,1,0,0,0,6,195,1,0,0,0,8,201,1,0,0,0,10,240,
1,0,0,0,12,242,1,0,0,0,14,246,1,0,0,0,16,250,1,0,0,0,18,252,1,0,0,0,20,254,
1,0,0,0,22,256,1,0,0,0,24,258,1,0,0,0,26,271,1,0,0,0,28,275,1,0,0,0,30,281,
1,0,0,0,32,286,1,0,0,0,34,289,1,0,0,0,36,298,1,0,0,0,38,308,1,0,0,0,40,311,
1,0,0,0,42,315,1,0,0,0,44,318,1,0,0,0,46,320,1,0,0,0,48,324,1,0,0,0,50,339,
1,0,0,0,52,341,1,0,0,0,54,346,1,0,0,0,56,357,1,0,0,0,58,370,1,0,0,0,60,372,
1,0,0,0,62,389,1,0,0,0,64,397,1,0,0,0,66,399,1,0,0,0,68,410,1,0,0,0,70,429,
1,0,0,0,72,478,1,0,0,0,74,489,1,0,0,0,76,509,1,0,0,0,78,511,1,0,0,0,80,514,
1,0,0,0,82,519,1,0,0,0,84,521,1,0,0,0,86,533,1,0,0,0,88,555,1,0,0,0,90,560,
1,0,0,0,92,562,1,0,0,0,94,564,1,0,0,0,96,578,1,0,0,0,98,580,1,0,0,0,100,
594,1,0,0,0,102,596,1,0,0,0,104,603,1,0,0,0,106,623,1,0,0,0,108,644,1,0,
0,0,110,646,1,0,0,0,112,655,1,0,0,0,114,657,1,0,0,0,116,670,1,0,0,0,118,
674,1,0,0,0,120,690,1,0,0,0,122,697,1,0,0,0,124,699,1,0,0,0,126,707,1,0,
0,0,128,723,1,0,0,0,130,725,1,0,0,0,132,730,1,0,0,0,134,739,1,0,0,0,136,
743,1,0,0,0,138,749,1,0,0,0,140,752,1,0,0,0,142,754,1,0,0,0,144,756,1,0,
0,0,146,758,1,0,0,0,148,760,1,0,0,0,150,762,1,0,0,0,152,154,3,2,1,0,153,
152,1,0,0,0,153,154,1,0,0,0,154,155,1,0,0,0,155,156,5,0,0,1,156,1,1,0,0,
0,157,159,3,4,2,0,158,157,1,0,0,0,159,160,1,0,0,0,160,158,1,0,0,0,160,161,
1,0,0,0,161,3,1,0,0,0,162,191,3,6,3,0,163,191,3,22,11,0,164,191,3,8,4,0,
165,191,3,48,24,0,166,191,3,10,5,0,167,191,3,16,8,0,168,191,3,18,9,0,169,
191,3,40,20,0,170,191,3,12,6,0,171,191,3,14,7,0,172,191,3,34,17,0,173,191,
3,32,16,0,174,191,3,20,10,0,175,191,3,132,66,0,176,191,3,134,67,0,177,191,
3,136,68,0,178,191,3,124,62,0,179,191,3,54,27,0,180,191,3,74,37,0,181,182,
4,2,0,0,182,191,3,46,23,0,183,184,4,2,1,0,184,191,3,82,41,0,185,191,3,72,
36,0,186,191,3,114,57,0,187,191,3,42,21,0,188,191,3,44,22,0,189,191,3,138,
69,0,190,162,1,0,0,0,190,163,1,0,0,0,190,164,1,0,0,0,190,165,1,0,0,0,190,
166,1,0,0,0,190,167,1,0,0,0,190,168,1,0,0,0,190,169,1,0,0,0,190,170,1,0,
0,0,190,171,1,0,0,0,190,172,1,0,0,0,190,173,1,0,0,0,190,174,1,0,0,0,190,
175,1,0,0,0,190,176,1,0,0,0,190,177,1,0,0,0,190,178,1,0,0,0,190,179,1,0,
0,0,190,180,1,0,0,0,190,181,1,0,0,0,190,183,1,0,0,0,190,185,1,0,0,0,190,
186,1,0,0,0,190,187,1,0,0,0,190,188,1,0,0,0,190,189,1,0,0,0,191,193,1,0,
0,0,192,194,3,148,74,0,193,192,1,0,0,0,193,194,1,0,0,0,194,5,1,0,0,0,195,
197,3,144,72,0,196,198,3,2,1,0,197,196,1,0,0,0,197,198,1,0,0,0,198,199,1,
0,0,0,199,200,3,146,73,0,200,7,1,0,0,0,201,202,5,90,0,0,202,204,3,70,35,
0,203,205,5,91,0,0,204,203,1,0,0,0,204,205,1,0,0,0,205,206,1,0,0,0,206,209,
3,4,2,0,207,208,5,74,0,0,208,210,3,4,2,0,209,207,1,0,0,0,209,210,1,0,0,0,
210,9,1,0,0,0,211,212,5,72,0,0,212,213,3,4,2,0,213,214,5,85,0,0,214,215,
3,70,35,0,215,241,1,0,0,0,216,217,5,84,0,0,217,218,3,70,35,0,218,219,3,4,
2,0,219,241,1,0,0,0,220,221,5,82,0,0,221,224,5,10,0,0,222,225,3,48,24,0,
223,225,3,46,23,0,224,222,1,0,0,0,224,223,1,0,0,0,224,225,1,0,0,0,225,226,
1,0,0,0,226,228,5,17,0,0,227,229,3,70,35,0,228,227,1,0,0,0,228,229,1,0,0,
0,229,230,1,0,0,0,230,232,5,17,0,0,231,233,3,4,2,0,232,231,1,0,0,0,232,233,
1,0,0,0,233,234,1,0,0,0,234,235,5,11,0,0,235,241,3,4,2,0,236,237,5,86,0,
0,237,238,3,70,35,0,238,239,3,4,2,0,239,241,1,0,0,0,240,211,1,0,0,0,240,
216,1,0,0,0,240,220,1,0,0,0,240,236,1,0,0,0,241,11,1,0,0,0,242,243,5,88,
0,0,243,244,3,70,35,0,244,245,3,4,2,0,245,13,1,0,0,0,246,247,5,83,0,0,247,
248,3,70,35,0,248,249,3,24,12,0,249,15,1,0,0,0,250,251,5,81,0,0,251,17,1,
0,0,0,252,253,5,70,0,0,253,19,1,0,0,0,254,255,5,71,0,0,255,21,1,0,0,0,256,
257,5,17,0,0,257,23,1,0,0,0,258,265,3,144,72,0,259,264,3,28,14,0,260,264,
3,30,15,0,261,264,3,136,68,0,262,264,3,132,66,0,263,259,1,0,0,0,263,260,
1,0,0,0,263,261,1,0,0,0,263,262,1,0,0,0,264,267,1,0,0,0,265,263,1,0,0,0,
265,266,1,0,0,0,266,268,1,0,0,0,267,265,1,0,0,0,268,269,3,146,73,0,269,25,
1,0,0,0,270,272,3,28,14,0,271,270,1,0,0,0,272,273,1,0,0,0,273,271,1,0,0,
0,273,274,1,0,0,0,274,27,1,0,0,0,275,276,5,73,0,0,276,277,3,70,35,0,277,
279,5,20,0,0,278,280,3,2,1,0,279,278,1,0,0,0,279,280,1,0,0,0,280,29,1,0,
0,0,281,282,5,89,0,0,282,284,5,20,0,0,283,285,3,2,1,0,284,283,1,0,0,0,284,
285,1,0,0,0,285,31,1,0,0,0,286,287,5,92,0,0,287,288,3,70,35,0,288,33,1,0,
0,0,289,290,5,94,0,0,290,296,3,4,2,0,291,293,3,36,18,0,292,294,3,38,19,0,
293,292,1,0,0,0,293,294,1,0,0,0,294,297,1,0,0,0,295,297,3,38,19,0,296,291,
1,0,0,0,296,295,1,0,0,0,297,35,1,0,0,0,298,304,5,78,0,0,299,301,5,10,0,0,
300,302,3,122,61,0,301,300,1,0,0,0,301,302,1,0,0,0,302,303,1,0,0,0,303,305,
5,11,0,0,304,299,1,0,0,0,304,305,1,0,0,0,305,306,1,0,0,0,306,307,3,4,2,0,
307,37,1,0,0,0,308,309,5,79,0,0,309,310,3,4,2,0,310,39,1,0,0,0,311,313,5,
80,0,0,312,314,3,70,35,0,313,312,1,0,0,0,313,314,1,0,0,0,314,41,1,0,0,0,
315,316,5,93,0,0,316,317,3,70,35,0,317,43,1,0,0,0,318,319,3,96,48,0,319,
45,1,0,0,0,320,321,3,60,30,0,321,322,3,94,47,0,322,323,3,68,34,0,323,47,
1,0,0,0,324,325,3,50,25,0,325,330,3,52,26,0,326,327,5,18,0,0,327,329,3,52,
26,0,328,326,1,0,0,0,329,332,1,0,0,0,330,328,1,0,0,0,330,331,1,0,0,0,331,
49,1,0,0,0,332,330,1,0,0,0,333,335,5,76,0,0,334,333,1,0,0,0,335,336,1,0,
0,0,336,334,1,0,0,0,336,337,1,0,0,0,337,340,1,0,0,0,338,340,5,97,0,0,339,
334,1,0,0,0,339,338,1,0,0,0,340,51,1,0,0,0,341,344,3,122,61,0,342,343,5,
19,0,0,343,345,3,68,34,0,344,342,1,0,0,0,344,345,1,0,0,0,345,53,1,0,0,0,
346,347,5,77,0,0,347,352,3,122,61,0,348,349,5,18,0,0,349,351,3,122,61,0,
350,348,1,0,0,0,351,354,1,0,0,0,352,350,1,0,0,0,352,353,1,0,0,0,353,355,
1,0,0,0,354,352,1,0,0,0,355,356,5,17,0,0,356,55,1,0,0,0,357,358,5,75,0,0,
358,359,3,122,61,0,359,360,3,86,43,0,360,57,1,0,0,0,361,371,3,122,61,0,362,
371,3,56,28,0,363,364,5,21,0,0,364,371,3,122,61,0,365,366,5,10,0,0,366,367,
3,70,35,0,367,368,5,11,0,0,368,371,1,0,0,0,369,371,3,106,53,0,370,361,1,
0,0,0,370,362,1,0,0,0,370,363,1,0,0,0,370,365,1,0,0,0,370,369,1,0,0,0,371,
59,1,0,0,0,372,380,3,58,29,0,373,375,3,62,31,0,374,373,1,0,0,0,375,378,1,
0,0,0,376,374,1,0,0,0,376,377,1,0,0,0,377,379,1,0,0,0,378,376,1,0,0,0,379,
381,3,64,32,0,380,376,1,0,0,0,380,381,1,0,0,0,381,61,1,0,0,0,382,383,3,84,
42,0,383,384,3,66,33,0,384,385,5,9,0,0,385,390,1,0,0,0,386,387,5,21,0,0,
387,390,3,122,61,0,388,390,3,86,43,0,389,382,1,0,0,0,389,386,1,0,0,0,389,
388,1,0,0,0,390,63,1,0,0,0,391,392,3,84,42,0,392,393,3,66,33,0,393,394,5,
9,0,0,394,398,1,0,0,0,395,396,5,21,0,0,396,398,3,122,61,0,397,391,1,0,0,
0,397,395,1,0,0,0,398,65,1,0,0,0,399,404,3,70,35,0,400,401,5,18,0,0,401,
403,3,70,35,0,402,400,1,0,0,0,403,406,1,0,0,0,404,402,1,0,0,0,404,405,1,
0,0,0,405,67,1,0,0,0,406,404,1,0,0,0,407,411,3,46,23,0,408,411,3,70,35,0,
409,411,3,114,57,0,410,407,1,0,0,0,410,408,1,0,0,0,410,409,1,0,0,0,411,69,
1,0,0,0,412,413,6,35,-1,0,413,430,3,72,36,0,414,415,5,24,0,0,415,430,3,70,
35,21,416,417,5,25,0,0,417,430,3,70,35,20,418,419,5,26,0,0,419,430,3,70,
35,19,420,421,5,27,0,0,421,430,3,70,35,18,422,425,3,78,39,0,423,425,3,80,
40,0,424,422,1,0,0,0,424,423,1,0,0,0,425,430,1,0,0,0,426,430,3,60,30,0,427,
430,3,114,57,0,428,430,3,96,48,0,429,412,1,0,0,0,429,414,1,0,0,0,429,416,
1,0,0,0,429,418,1,0,0,0,429,420,1,0,0,0,429,424,1,0,0,0,429,426,1,0,0,0,
429,427,1,0,0,0,429,428,1,0,0,0,430,475,1,0,0,0,431,432,10,17,0,0,432,433,
7,0,0,0,433,474,3,70,35,18,434,435,10,16,0,0,435,436,7,1,0,0,436,474,3,70,
35,17,437,438,10,15,0,0,438,439,7,2,0,0,439,474,3,70,35,16,440,441,10,14,
0,0,441,442,5,44,0,0,442,474,3,70,35,15,443,444,10,13,0,0,444,445,5,45,0,
0,445,474,3,70,35,14,446,447,10,12,0,0,447,448,5,46,0,0,448,474,3,70,35,
13,449,450,10,11,0,0,450,451,7,3,0,0,451,474,3,70,35,12,452,453,10,10,0,
0,453,454,7,4,0,0,454,474,3,70,35,11,455,456,10,9,0,0,456,457,5,34,0,0,457,
474,3,70,35,9,458,459,10,8,0,0,459,460,5,47,0,0,460,474,3,70,35,9,461,462,
10,7,0,0,462,463,5,48,0,0,463,474,3,70,35,8,464,465,10,6,0,0,465,466,5,49,
0,0,466,474,3,70,35,7,467,468,10,4,0,0,468,469,5,33,0,0,469,470,3,70,35,
0,470,471,5,20,0,0,471,472,3,70,35,4,472,474,1,0,0,0,473,431,1,0,0,0,473,
434,1,0,0,0,473,437,1,0,0,0,473,440,1,0,0,0,473,443,1,0,0,0,473,446,1,0,
0,0,473,449,1,0,0,0,473,452,1,0,0,0,473,455,1,0,0,0,473,458,1,0,0,0,473,
461,1,0,0,0,473,464,1,0,0,0,473,467,1,0,0,0,474,477,1,0,0,0,475,473,1,0,
0,0,475,476,1,0,0,0,476,71,1,0,0,0,477,475,1,0,0,0,478,479,6,36,-1,0,479,
480,3,76,38,0,480,481,3,86,43,0,481,486,1,0,0,0,482,483,10,1,0,0,483,485,
3,86,43,0,484,482,1,0,0,0,485,488,1,0,0,0,486,484,1,0,0,0,486,487,1,0,0,
0,487,73,1,0,0,0,488,486,1,0,0,0,489,490,6,37,-1,0,490,491,5,21,0,0,491,
492,3,122,61,0,492,493,3,86,43,0,493,498,1,0,0,0,494,495,10,1,0,0,495,497,
3,86,43,0,496,494,1,0,0,0,497,500,1,0,0,0,498,496,1,0,0,0,498,499,1,0,0,
0,499,75,1,0,0,0,500,498,1,0,0,0,501,510,3,60,30,0,502,505,5,10,0,0,503,
506,3,114,57,0,504,506,3,76,38,0,505,503,1,0,0,0,505,504,1,0,0,0,506,507,
1,0,0,0,507,508,5,11,0,0,508,510,1,0,0,0,509,501,1,0,0,0,509,502,1,0,0,0,
510,77,1,0,0,0,511,512,7,5,0,0,512,513,3,60,30,0,513,79,1,0,0,0,514,515,
3,60,30,0,515,516,7,5,0,0,516,81,1,0,0,0,517,520,3,80,40,0,518,520,3,78,
39,0,519,517,1,0,0,0,519,518,1,0,0,0,520,83,1,0,0,0,521,522,7,6,0,0,522,
85,1,0,0,0,523,524,5,10,0,0,524,534,5,11,0,0,525,527,5,10,0,0,526,528,3,
88,44,0,527,526,1,0,0,0,527,528,1,0,0,0,528,530,1,0,0,0,529,531,3,92,46,
0,530,529,1,0,0,0,530,531,1,0,0,0,531,532,1,0,0,0,532,534,5,11,0,0,533,523,
1,0,0,0,533,525,1,0,0,0,534,87,1,0,0,0,535,536,5,18,0,0,536,541,3,90,45,
0,537,538,5,18,0,0,538,540,3,90,45,0,539,537,1,0,0,0,540,543,1,0,0,0,541,
539,1,0,0,0,541,542,1,0,0,0,542,556,1,0,0,0,543,541,1,0,0,0,544,545,3,90,
45,0,545,546,5,18,0,0,546,551,3,90,45,0,547,548,5,18,0,0,548,550,3,90,45,
0,549,547,1,0,0,0,550,553,1,0,0,0,551,549,1,0,0,0,551,552,1,0,0,0,552,556,
1,0,0,0,553,551,1,0,0,0,554,556,3,90,45,0,555,535,1,0,0,0,555,544,1,0,0,
0,555,554,1,0,0,0,556,89,1,0,0,0,557,561,3,68,34,0,558,561,5,63,0,0,559,
561,1,0,0,0,560,557,1,0,0,0,560,558,1,0,0,0,560,559,1,0,0,0,561,91,1,0,0,
0,562,563,5,18,0,0,563,93,1,0,0,0,564,565,7,7,0,0,565,95,1,0,0,0,566,579,
5,63,0,0,567,579,5,64,0,0,568,579,5,65,0,0,569,579,5,104,0,0,570,579,5,106,
0,0,571,579,3,98,49,0,572,579,5,69,0,0,573,579,5,68,0,0,574,579,5,67,0,0,
575,579,5,66,0,0,576,579,3,102,51,0,577,579,3,106,53,0,578,566,1,0,0,0,578,
567,1,0,0,0,578,568,1,0,0,0,578,569,1,0,0,0,578,570,1,0,0,0,578,571,1,0,
0,0,578,572,1,0,0,0,578,573,1,0,0,0,578,574,1,0,0,0,578,575,1,0,0,0,578,
576,1,0,0,0,578,577,1,0,0,0,579,97,1,0,0,0,580,584,5,105,0,0,581,583,3,100,
50,0,582,581,1,0,0,0,583,586,1,0,0,0,584,582,1,0,0,0,584,585,1,0,0,0,585,
587,1,0,0,0,586,584,1,0,0,0,587,588,5,112,0,0,588,99,1,0,0,0,589,595,5,114,
0,0,590,591,5,113,0,0,591,592,3,70,35,0,592,593,5,13,0,0,593,595,1,0,0,0,
594,589,1,0,0,0,594,590,1,0,0,0,595,101,1,0,0,0,596,597,5,3,0,0,597,598,
3,104,52,0,598,599,5,9,0,0,599,103,1,0,0,0,600,602,5,18,0,0,601,600,1,0,
0,0,602,605,1,0,0,0,603,601,1,0,0,0,603,604,1,0,0,0,604,607,1,0,0,0,605,
603,1,0,0,0,606,608,3,68,34,0,607,606,1,0,0,0,607,608,1,0,0,0,608,617,1,
0,0,0,609,611,5,18,0,0,610,609,1,0,0,0,611,612,1,0,0,0,612,610,1,0,0,0,612,
613,1,0,0,0,613,614,1,0,0,0,614,616,3,68,34,0,615,610,1,0,0,0,616,619,1,
0,0,0,617,615,1,0,0,0,617,618,1,0,0,0,618,621,1,0,0,0,619,617,1,0,0,0,620,
622,5,18,0,0,621,620,1,0,0,0,621,622,1,0,0,0,622,105,1,0,0,0,623,637,3,144,
72,0,624,631,3,108,54,0,625,627,5,18,0,0,626,625,1,0,0,0,626,627,1,0,0,0,
627,628,1,0,0,0,628,630,3,108,54,0,629,626,1,0,0,0,630,633,1,0,0,0,631,629,
1,0,0,0,631,632,1,0,0,0,632,635,1,0,0,0,633,631,1,0,0,0,634,636,5,18,0,0,
635,634,1,0,0,0,635,636,1,0,0,0,636,638,1,0,0,0,637,624,1,0,0,0,637,638,
1,0,0,0,638,639,1,0,0,0,639,640,3,146,73,0,640,107,1,0,0,0,641,645,3,110,
55,0,642,645,3,136,68,0,643,645,3,132,66,0,644,641,1,0,0,0,644,642,1,0,0,
0,644,643,1,0,0,0,645,109,1,0,0,0,646,647,3,112,56,0,647,648,5,20,0,0,648,
649,3,68,34,0,649,111,1,0,0,0,650,656,5,103,0,0,651,656,3,140,70,0,652,656,
3,142,71,0,653,656,5,104,0,0,654,656,5,106,0,0,655,650,1,0,0,0,655,651,1,
0,0,0,655,652,1,0,0,0,655,653,1,0,0,0,655,654,1,0,0,0,656,113,1,0,0,0,657,
659,5,87,0,0,658,660,5,103,0,0,659,658,1,0,0,0,659,660,1,0,0,0,660,661,1,
0,0,0,661,663,3,118,59,0,662,664,3,116,58,0,663,662,1,0,0,0,663,664,1,0,
0,0,664,665,1,0,0,0,665,666,3,6,3,0,666,115,1,0,0,0,667,668,5,20,0,0,668,
669,5,103,0,0,669,671,3,86,43,0,670,667,1,0,0,0,670,671,1,0,0,0,671,672,
1,0,0,0,672,673,5,96,0,0,673,117,1,0,0,0,674,686,5,10,0,0,675,680,3,120,
60,0,676,677,5,18,0,0,677,679,3,120,60,0,678,676,1,0,0,0,679,682,1,0,0,0,
680,678,1,0,0,0,680,681,1,0,0,0,681,684,1,0,0,0,682,680,1,0,0,0,683,685,
5,18,0,0,684,683,1,0,0,0,684,685,1,0,0,0,685,687,1,0,0,0,686,675,1,0,0,0,
686,687,1,0,0,0,687,688,1,0,0,0,688,689,5,11,0,0,689,119,1,0,0,0,690,693,
3,122,61,0,691,692,5,19,0,0,692,694,3,68,34,0,693,691,1,0,0,0,693,694,1,
0,0,0,694,121,1,0,0,0,695,698,5,103,0,0,696,698,3,140,70,0,697,695,1,0,0,
0,697,696,1,0,0,0,698,123,1,0,0,0,699,700,5,95,0,0,700,701,3,122,61,0,701,
703,3,144,72,0,702,704,3,126,63,0,703,702,1,0,0,0,703,704,1,0,0,0,704,705,
1,0,0,0,705,706,3,146,73,0,706,125,1,0,0,0,707,714,3,128,64,0,708,710,5,
18,0,0,709,708,1,0,0,0,709,710,1,0,0,0,710,711,1,0,0,0,711,713,3,128,64,
0,712,709,1,0,0,0,713,716,1,0,0,0,714,712,1,0,0,0,714,715,1,0,0,0,715,718,
1,0,0,0,716,714,1,0,0,0,717,719,5,18,0,0,718,717,1,0,0,0,718,719,1,0,0,0,
719,127,1,0,0,0,720,724,3,130,65,0,721,724,3,136,68,0,722,724,3,132,66,0,
723,720,1,0,0,0,723,721,1,0,0,0,723,722,1,0,0,0,724,129,1,0,0,0,725,728,
3,122,61,0,726,727,5,19,0,0,727,729,3,70,35,0,728,726,1,0,0,0,728,729,1,
0,0,0,729,131,1,0,0,0,730,731,5,98,0,0,731,733,3,122,61,0,732,734,3,150,
75,0,733,732,1,0,0,0,734,735,1,0,0,0,735,733,1,0,0,0,735,736,1,0,0,0,736,
737,1,0,0,0,737,738,7,8,0,0,738,133,1,0,0,0,739,740,5,100,0,0,740,741,5,
110,0,0,741,742,7,9,0,0,742,135,1,0,0,0,743,745,7,10,0,0,744,746,5,110,0,
0,745,744,1,0,0,0,745,746,1,0,0,0,746,747,1,0,0,0,747,748,7,9,0,0,748,137,
1,0,0,0,749,750,3,122,61,0,750,751,4,69,17,0,751,139,1,0,0,0,752,753,5,96,
0,0,753,141,1,0,0,0,754,755,5,64,0,0,755,143,1,0,0,0,756,757,7,11,0,0,757,
145,1,0,0,0,758,759,7,12,0,0,759,147,1,0,0,0,760,761,5,17,0,0,761,149,1,
0,0,0,762,763,7,13,0,0,763,151,1,0,0,0,79,153,160,190,193,197,204,209,224,
228,232,240,263,265,273,279,284,293,296,301,304,313,330,336,339,344,352,
370,376,380,389,397,404,410,424,429,473,475,486,498,505,509,519,527,530,
533,541,551,555,560,578,584,594,603,607,612,617,621,626,631,635,637,644,
655,659,663,670,680,684,686,693,697,703,709,714,718,723,728,735,745];


const atn = new antlr4.atn.ATNDeserializer().deserialize(serializedATN);

const decisionsToDFA = atn.decisionToState.map( (ds, index) => new antlr4.dfa.DFA(ds, index) );

const sharedContextCache = new antlr4.atn.PredictionContextCache();

export default class GameMakerLanguageParser extends antlr4.Parser {

    static grammarFileName = "GameMakerLanguageParser.g4";
    static literalNames = [ null, null, null, "'['", "'[|'", "'[?'", "'[#'", 
                            "'[@'", "'[$'", "']'", "'('", "')'", null, null, 
                            "'}'", "'begin'", "'end'", "';'", "','", null, 
                            "':'", "'.'", "'++'", "'--'", "'+'", "'-'", 
                            "'~'", null, "'*'", "'/'", "'div'", null, "'**'", 
                            "'?'", "'??'", "'??='", "'>>'", "'<<'", "'<'", 
                            "'>'", "'<='", "'>='", null, null, "'&'", "'^'", 
                            "'|'", null, null, null, "'*='", "'/='", "'+='", 
                            "'-='", "'%='", "'<<='", "'>>='", "'&='", "'^='", 
                            "'|='", "'#'", "'$'", "'@'", "'undefined'", 
                            "'noone'", null, null, null, null, null, "'break'", 
                            "'exit'", "'do'", "'case'", "'else'", "'new'", 
                            "'var'", "'globalvar'", "'catch'", "'finally'", 
                            "'return'", "'continue'", "'for'", "'switch'", 
                            "'while'", "'until'", "'repeat'", "'function'", 
                            "'with'", "'default'", "'if'", "'then'", "'throw'", 
                            "'delete'", "'try'", "'enum'", "'constructor'", 
                            "'static'", "'#macro'", "'\\'", "'#define'", 
                            "'#region'", "'#endregion'" ];
    static symbolicNames = [ null, "MultiLineComment", "SingleLineComment", 
                             "OpenBracket", "ListAccessor", "MapAccessor", 
                             "GridAccessor", "ArrayAccessor", "StructAccessor", 
                             "CloseBracket", "OpenParen", "CloseParen", 
                             "OpenBrace", "TemplateStringEndExpression", 
                             "CloseBrace", "Begin", "End", "SemiColon", 
                             "Comma", "Assign", "Colon", "Dot", "PlusPlus", 
                             "MinusMinus", "Plus", "Minus", "BitNot", "Not", 
                             "Multiply", "Divide", "IntegerDivide", "Modulo", 
                             "Power", "QuestionMark", "NullCoalesce", "NullCoalescingAssign", 
                             "RightShiftArithmetic", "LeftShiftArithmetic", 
                             "LessThan", "MoreThan", "LessThanEquals", "GreaterThanEquals", 
                             "Equals", "NotEquals", "BitAnd", "BitXOr", 
                             "BitOr", "And", "Or", "Xor", "MultiplyAssign", 
                             "DivideAssign", "PlusAssign", "MinusAssign", 
                             "ModulusAssign", "LeftShiftArithmeticAssign", 
                             "RightShiftArithmeticAssign", "BitAndAssign", 
                             "BitXorAssign", "BitOrAssign", "NumberSign", 
                             "DollarSign", "AtSign", "UndefinedLiteral", 
                             "NoOneLiteral", "BooleanLiteral", "IntegerLiteral", 
                             "DecimalLiteral", "BinaryLiteral", "HexIntegerLiteral", 
                             "Break", "Exit", "Do", "Case", "Else", "New", 
                             "Var", "GlobalVar", "Catch", "Finally", "Return", 
                             "Continue", "For", "Switch", "While", "Until", 
                             "Repeat", "Function_", "With", "Default", "If", 
                             "Then", "Throw", "Delete", "Try", "Enum", "Constructor", 
                             "Static", "Macro", "EscapedNewLine", "Define", 
                             "Region", "EndRegion", "Identifier", "StringLiteral", 
                             "TemplateStringStart", "VerbatimStringLiteral", 
                             "WhiteSpaces", "LineTerminator", "UnexpectedCharacter", 
                             "RegionCharacters", "RegionEOL", "TemplateStringEnd", 
                             "TemplateStringStartExpression", "TemplateStringText" ];
    static ruleNames = [ "program", "statementList", "statement", "block", 
                         "ifStatement", "iterationStatement", "withStatement", 
                         "switchStatement", "continueStatement", "breakStatement", 
                         "exitStatement", "emptyStatement", "caseBlock", 
                         "caseClauses", "caseClause", "defaultClause", "throwStatement", 
                         "tryStatement", "catchProduction", "finallyProduction", 
                         "returnStatement", "deleteStatement", "literalStatement", 
                         "assignmentExpression", "variableDeclarationList", 
                         "varModifier", "variableDeclaration", "globalVarStatement", 
                         "newExpression", "lValueStartExpression", "lValueExpression", 
                         "lValueChainOperator", "lValueFinalOperator", "expressionSequence", 
                         "expressionOrFunction", "expression", "callStatement", 
                         "implicitCallStatement", "callableExpression", 
                         "preIncDecExpression", "postIncDecExpression", 
                         "incDecStatement", "accessor", "arguments", "argumentList", 
                         "argument", "trailingComma", "assignmentOperator", 
                         "literal", "templateStringLiteral", "templateStringAtom", 
                         "arrayLiteral", "elementList", "structLiteral", 
                         "structItem", "propertyAssignment", "propertyIdentifier", 
                         "functionDeclaration", "constructorClause", "parameterList", 
                         "parameterArgument", "identifier", "enumeratorDeclaration", 
                         "enumeratorList", "enumeratorItem", "enumerator", 
                         "macroStatement", "defineStatement", "regionStatement", 
                         "identifierStatement", "softKeyword", "propertySoftKeyword", 
                         "openBlock", "closeBlock", "eos", "macroToken" ];

    constructor(input) {
        super(input);
        this._interp = new antlr4.atn.ParserATNSimulator(this, atn, decisionsToDFA, sharedContextCache);
        this.ruleNames = GameMakerLanguageParser.ruleNames;
        this.literalNames = GameMakerLanguageParser.literalNames;
        this.symbolicNames = GameMakerLanguageParser.symbolicNames;

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

    sempred(localctx, ruleIndex, predIndex) {
    	switch(ruleIndex) {
    	case 2:
    	    		return this.statement_sempred(localctx, predIndex);
    	case 35:
    	    		return this.expression_sempred(localctx, predIndex);
    	case 36:
    	    		return this.callStatement_sempred(localctx, predIndex);
    	case 37:
    	    		return this.implicitCallStatement_sempred(localctx, predIndex);
    	case 69:
    	    		return this.identifierStatement_sempred(localctx, predIndex);
        default:
            throw "No predicate with index:" + ruleIndex;
       }
    }

    statement_sempred(localctx, predIndex) {
    	switch(predIndex) {
    		case 0:
    			return this.isLikelyAssignmentStatement();
    		case 1:
    			return this.isLikelyIncDecStatement();
    		default:
    			throw "No predicate with index:" + predIndex;
    	}
    };

    expression_sempred(localctx, predIndex) {
    	switch(predIndex) {
    		case 2:
    			return this.precpred(this._ctx, 17);
    		case 3:
    			return this.precpred(this._ctx, 16);
    		case 4:
    			return this.precpred(this._ctx, 15);
    		case 5:
    			return this.precpred(this._ctx, 14);
    		case 6:
    			return this.precpred(this._ctx, 13);
    		case 7:
    			return this.precpred(this._ctx, 12);
    		case 8:
    			return this.precpred(this._ctx, 11);
    		case 9:
    			return this.precpred(this._ctx, 10);
    		case 10:
    			return this.precpred(this._ctx, 9);
    		case 11:
    			return this.precpred(this._ctx, 8);
    		case 12:
    			return this.precpred(this._ctx, 7);
    		case 13:
    			return this.precpred(this._ctx, 6);
    		case 14:
    			return this.precpred(this._ctx, 4);
    		default:
    			throw "No predicate with index:" + predIndex;
    	}
    };

    callStatement_sempred(localctx, predIndex) {
    	switch(predIndex) {
    		case 15:
    			return this.precpred(this._ctx, 1);
    		default:
    			throw "No predicate with index:" + predIndex;
    	}
    };

    implicitCallStatement_sempred(localctx, predIndex) {
    	switch(predIndex) {
    		case 16:
    			return this.precpred(this._ctx, 1);
    		default:
    			throw "No predicate with index:" + predIndex;
    	}
    };

    identifierStatement_sempred(localctx, predIndex) {
    	switch(predIndex) {
    		case 17:
    			return this._input.LA(1) !== GameMakerLanguageParser.Dot;
    		default:
    			throw "No predicate with index:" + predIndex;
    	}
    };




	program() {
	    let localctx = new ProgramContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 0, GameMakerLanguageParser.RULE_program);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 153;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,0,this._ctx);
	        if(la_===1) {
	            this.state = 152;
	            this.statementList();

	        }
	        this.state = 155;
	        this.match(GameMakerLanguageParser.EOF);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	statementList() {
	    let localctx = new StatementListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 2, GameMakerLanguageParser.RULE_statementList);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 158; 
	        this._errHandler.sync(this);
	        var _alt = 1;
	        do {
	        	switch (_alt) {
	        	case 1:
	        		this.state = 157;
	        		this.statement();
	        		break;
	        	default:
	        		throw new antlr4.error.NoViableAltException(this);
	        	}
	        	this.state = 160; 
	        	this._errHandler.sync(this);
	        	_alt = this._interp.adaptivePredict(this._input,1, this._ctx);
	        } while ( _alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER );
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	statement() {
	    let localctx = new StatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 4, GameMakerLanguageParser.RULE_statement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 190;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,2,this._ctx);
	        switch(la_) {
	        case 1:
	            this.state = 162;
	            this.block();
	            break;

	        case 2:
	            this.state = 163;
	            this.emptyStatement();
	            break;

	        case 3:
	            this.state = 164;
	            this.ifStatement();
	            break;

	        case 4:
	            this.state = 165;
	            this.variableDeclarationList();
	            break;

	        case 5:
	            this.state = 166;
	            this.iterationStatement();
	            break;

	        case 6:
	            this.state = 167;
	            this.continueStatement();
	            break;

	        case 7:
	            this.state = 168;
	            this.breakStatement();
	            break;

	        case 8:
	            this.state = 169;
	            this.returnStatement();
	            break;

	        case 9:
	            this.state = 170;
	            this.withStatement();
	            break;

	        case 10:
	            this.state = 171;
	            this.switchStatement();
	            break;

	        case 11:
	            this.state = 172;
	            this.tryStatement();
	            break;

	        case 12:
	            this.state = 173;
	            this.throwStatement();
	            break;

	        case 13:
	            this.state = 174;
	            this.exitStatement();
	            break;

	        case 14:
	            this.state = 175;
	            this.macroStatement();
	            break;

	        case 15:
	            this.state = 176;
	            this.defineStatement();
	            break;

	        case 16:
	            this.state = 177;
	            this.regionStatement();
	            break;

	        case 17:
	            this.state = 178;
	            this.enumeratorDeclaration();
	            break;

	        case 18:
	            this.state = 179;
	            this.globalVarStatement();
	            break;

	        case 19:
	            this.state = 180;
	            this.implicitCallStatement(0);
	            break;

	        case 20:
	            this.state = 181;
	            if (!( this.isLikelyAssignmentStatement())) {
	                throw new antlr4.error.FailedPredicateException(this, "this.isLikelyAssignmentStatement()");
	            }
	            this.state = 182;
	            this.assignmentExpression();
	            break;

	        case 21:
	            this.state = 183;
	            if (!( this.isLikelyIncDecStatement())) {
	                throw new antlr4.error.FailedPredicateException(this, "this.isLikelyIncDecStatement()");
	            }
	            this.state = 184;
	            this.incDecStatement();
	            break;

	        case 22:
	            this.state = 185;
	            this.callStatement(0);
	            break;

	        case 23:
	            this.state = 186;
	            this.functionDeclaration();
	            break;

	        case 24:
	            this.state = 187;
	            this.deleteStatement();
	            break;

	        case 25:
	            this.state = 188;
	            this.literalStatement();
	            break;

	        case 26:
	            this.state = 189;
	            this.identifierStatement();
	            break;

	        }
	        this.state = 193;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,3,this._ctx);
	        if(la_===1) {
	            this.state = 192;
	            this.eos();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	block() {
	    let localctx = new BlockContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 6, GameMakerLanguageParser.RULE_block);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 195;
	        this.openBlock();
	        this.state = 197;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,4,this._ctx);
	        if(la_===1) {
	            this.state = 196;
	            this.statementList();

	        }
	        this.state = 199;
	        this.closeBlock();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	ifStatement() {
	    let localctx = new IfStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 8, GameMakerLanguageParser.RULE_ifStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 201;
	        this.match(GameMakerLanguageParser.If);
	        this.state = 202;
	        this.expression(0);
	        this.state = 204;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,5,this._ctx);
	        if(la_===1) {
	            this.state = 203;
	            this.match(GameMakerLanguageParser.Then);

	        }
	        this.state = 206;
	        this.statement();
	        this.state = 209;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,6,this._ctx);
	        if(la_===1) {
	            this.state = 207;
	            this.match(GameMakerLanguageParser.Else);
	            this.state = 208;
	            this.statement();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	iterationStatement() {
	    let localctx = new IterationStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 10, GameMakerLanguageParser.RULE_iterationStatement);
	    var _la = 0;
	    try {
	        this.state = 240;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 72:
	            localctx = new DoStatementContext(this, localctx);
	            this.enterOuterAlt(localctx, 1);
	            this.state = 211;
	            this.match(GameMakerLanguageParser.Do);
	            this.state = 212;
	            this.statement();
	            this.state = 213;
	            this.match(GameMakerLanguageParser.Until);
	            this.state = 214;
	            this.expression(0);
	            break;
	        case 84:
	            localctx = new WhileStatementContext(this, localctx);
	            this.enterOuterAlt(localctx, 2);
	            this.state = 216;
	            this.match(GameMakerLanguageParser.While);
	            this.state = 217;
	            this.expression(0);
	            this.state = 218;
	            this.statement();
	            break;
	        case 82:
	            localctx = new ForStatementContext(this, localctx);
	            this.enterOuterAlt(localctx, 3);
	            this.state = 220;
	            this.match(GameMakerLanguageParser.For);
	            this.state = 221;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 224;
	            this._errHandler.sync(this);
	            switch (this._input.LA(1)) {
	            case 76:
	            case 97:
	            	this.state = 222;
	            	this.variableDeclarationList();
	            	break;
	            case 10:
	            case 12:
	            case 15:
	            case 21:
	            case 75:
	            case 96:
	            case 103:
	            	this.state = 223;
	            	this.assignmentExpression();
	            	break;
	            case 17:
	            	break;
	            default:
	            	break;
	            }
	            this.state = 226;
	            this.match(GameMakerLanguageParser.SemiColon);
	            this.state = 228;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            if((((_la) & ~0x1f) === 0 && ((1 << _la) & 266376200) !== 0) || ((((_la - 63)) & ~0x1f) === 0 && ((1 << (_la - 63)) & 16781439) !== 0) || ((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 1921) !== 0)) {
	                this.state = 227;
	                this.expression(0);
	            }

	            this.state = 230;
	            this.match(GameMakerLanguageParser.SemiColon);
	            this.state = 232;
	            this._errHandler.sync(this);
	            var la_ = this._interp.adaptivePredict(this._input,9,this._ctx);
	            if(la_===1) {
	                this.state = 231;
	                this.statement();

	            }
	            this.state = 234;
	            this.match(GameMakerLanguageParser.CloseParen);
	            this.state = 235;
	            this.statement();
	            break;
	        case 86:
	            localctx = new RepeatStatementContext(this, localctx);
	            this.enterOuterAlt(localctx, 4);
	            this.state = 236;
	            this.match(GameMakerLanguageParser.Repeat);
	            this.state = 237;
	            this.expression(0);
	            this.state = 238;
	            this.statement();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	withStatement() {
	    let localctx = new WithStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 12, GameMakerLanguageParser.RULE_withStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 242;
	        this.match(GameMakerLanguageParser.With);
	        this.state = 243;
	        this.expression(0);
	        this.state = 244;
	        this.statement();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	switchStatement() {
	    let localctx = new SwitchStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 14, GameMakerLanguageParser.RULE_switchStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 246;
	        this.match(GameMakerLanguageParser.Switch);
	        this.state = 247;
	        this.expression(0);
	        this.state = 248;
	        this.caseBlock();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	continueStatement() {
	    let localctx = new ContinueStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 16, GameMakerLanguageParser.RULE_continueStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 250;
	        this.match(GameMakerLanguageParser.Continue);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	breakStatement() {
	    let localctx = new BreakStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 18, GameMakerLanguageParser.RULE_breakStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 252;
	        this.match(GameMakerLanguageParser.Break);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	exitStatement() {
	    let localctx = new ExitStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 20, GameMakerLanguageParser.RULE_exitStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 254;
	        this.match(GameMakerLanguageParser.Exit);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	emptyStatement() {
	    let localctx = new EmptyStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 22, GameMakerLanguageParser.RULE_emptyStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 256;
	        this.match(GameMakerLanguageParser.SemiColon);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	caseBlock() {
	    let localctx = new CaseBlockContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 24, GameMakerLanguageParser.RULE_caseBlock);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 258;
	        this.openBlock();
	        this.state = 265;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        while(((((_la - 73)) & ~0x1f) === 0 && ((1 << (_la - 73)) & 838926337) !== 0)) {
	            this.state = 263;
	            this._errHandler.sync(this);
	            switch(this._input.LA(1)) {
	            case 73:
	                this.state = 259;
	                this.caseClause();
	                break;
	            case 89:
	                this.state = 260;
	                this.defaultClause();
	                break;
	            case 101:
	            case 102:
	                this.state = 261;
	                this.regionStatement();
	                break;
	            case 98:
	                this.state = 262;
	                this.macroStatement();
	                break;
	            default:
	                throw new antlr4.error.NoViableAltException(this);
	            }
	            this.state = 267;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        }
	        this.state = 268;
	        this.closeBlock();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	caseClauses() {
	    let localctx = new CaseClausesContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 26, GameMakerLanguageParser.RULE_caseClauses);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 271; 
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        do {
	            this.state = 270;
	            this.caseClause();
	            this.state = 273; 
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        } while(_la===73);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	caseClause() {
	    let localctx = new CaseClauseContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 28, GameMakerLanguageParser.RULE_caseClause);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 275;
	        this.match(GameMakerLanguageParser.Case);
	        this.state = 276;
	        this.expression(0);
	        this.state = 277;
	        this.match(GameMakerLanguageParser.Colon);
	        this.state = 279;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,14,this._ctx);
	        if(la_===1) {
	            this.state = 278;
	            this.statementList();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	defaultClause() {
	    let localctx = new DefaultClauseContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 30, GameMakerLanguageParser.RULE_defaultClause);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 281;
	        this.match(GameMakerLanguageParser.Default);
	        this.state = 282;
	        this.match(GameMakerLanguageParser.Colon);
	        this.state = 284;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,15,this._ctx);
	        if(la_===1) {
	            this.state = 283;
	            this.statementList();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	throwStatement() {
	    let localctx = new ThrowStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 32, GameMakerLanguageParser.RULE_throwStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 286;
	        this.match(GameMakerLanguageParser.Throw);
	        this.state = 287;
	        this.expression(0);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	tryStatement() {
	    let localctx = new TryStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 34, GameMakerLanguageParser.RULE_tryStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 289;
	        this.match(GameMakerLanguageParser.Try);
	        this.state = 290;
	        this.statement();
	        this.state = 296;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 78:
	            this.state = 291;
	            this.catchProduction();
	            this.state = 293;
	            this._errHandler.sync(this);
	            var la_ = this._interp.adaptivePredict(this._input,16,this._ctx);
	            if(la_===1) {
	                this.state = 292;
	                this.finallyProduction();

	            }
	            break;
	        case 79:
	            this.state = 295;
	            this.finallyProduction();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	catchProduction() {
	    let localctx = new CatchProductionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 36, GameMakerLanguageParser.RULE_catchProduction);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 298;
	        this.match(GameMakerLanguageParser.Catch);
	        this.state = 304;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,19,this._ctx);
	        if(la_===1) {
	            this.state = 299;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 301;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            if(_la===96 || _la===103) {
	                this.state = 300;
	                this.identifier();
	            }

	            this.state = 303;
	            this.match(GameMakerLanguageParser.CloseParen);

	        }
	        this.state = 306;
	        this.statement();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	finallyProduction() {
	    let localctx = new FinallyProductionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 38, GameMakerLanguageParser.RULE_finallyProduction);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 308;
	        this.match(GameMakerLanguageParser.Finally);
	        this.state = 309;
	        this.statement();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	returnStatement() {
	    let localctx = new ReturnStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 40, GameMakerLanguageParser.RULE_returnStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 311;
	        this.match(GameMakerLanguageParser.Return);
	        this.state = 313;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,20,this._ctx);
	        if(la_===1) {
	            this.state = 312;
	            this.expression(0);

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	deleteStatement() {
	    let localctx = new DeleteStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 42, GameMakerLanguageParser.RULE_deleteStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 315;
	        this.match(GameMakerLanguageParser.Delete);
	        this.state = 316;
	        this.expression(0);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	literalStatement() {
	    let localctx = new LiteralStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 44, GameMakerLanguageParser.RULE_literalStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 318;
	        this.literal();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	assignmentExpression() {
	    let localctx = new AssignmentExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 46, GameMakerLanguageParser.RULE_assignmentExpression);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 320;
	        this.lValueExpression();
	        this.state = 321;
	        this.assignmentOperator();
	        this.state = 322;
	        this.expressionOrFunction();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	variableDeclarationList() {
	    let localctx = new VariableDeclarationListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 48, GameMakerLanguageParser.RULE_variableDeclarationList);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 324;
	        this.varModifier();
	        this.state = 325;
	        this.variableDeclaration();
	        this.state = 330;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,21,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                this.state = 326;
	                this.match(GameMakerLanguageParser.Comma);
	                this.state = 327;
	                this.variableDeclaration(); 
	            }
	            this.state = 332;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,21,this._ctx);
	        }

	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	varModifier() {
	    let localctx = new VarModifierContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 50, GameMakerLanguageParser.RULE_varModifier);
	    var _la = 0;
	    try {
	        this.state = 339;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 76:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 334; 
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            do {
	                this.state = 333;
	                this.match(GameMakerLanguageParser.Var);
	                this.state = 336; 
	                this._errHandler.sync(this);
	                _la = this._input.LA(1);
	            } while(_la===76);
	            break;
	        case 97:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 338;
	            this.match(GameMakerLanguageParser.Static);
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	variableDeclaration() {
	    let localctx = new VariableDeclarationContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 52, GameMakerLanguageParser.RULE_variableDeclaration);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 341;
	        this.identifier();
	        this.state = 344;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,24,this._ctx);
	        if(la_===1) {
	            this.state = 342;
	            this.match(GameMakerLanguageParser.Assign);
	            this.state = 343;
	            this.expressionOrFunction();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	globalVarStatement() {
	    let localctx = new GlobalVarStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 54, GameMakerLanguageParser.RULE_globalVarStatement);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 346;
	        this.match(GameMakerLanguageParser.GlobalVar);
	        this.state = 347;
	        this.identifier();
	        this.state = 352;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        while(_la===18) {
	            this.state = 348;
	            this.match(GameMakerLanguageParser.Comma);
	            this.state = 349;
	            this.identifier();
	            this.state = 354;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        }
	        this.state = 355;
	        this.match(GameMakerLanguageParser.SemiColon);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	newExpression() {
	    let localctx = new NewExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 56, GameMakerLanguageParser.RULE_newExpression);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 357;
	        this.match(GameMakerLanguageParser.New);
	        this.state = 358;
	        this.identifier();
	        this.state = 359;
	        this.arguments();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	lValueStartExpression() {
	    let localctx = new LValueStartExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 58, GameMakerLanguageParser.RULE_lValueStartExpression);
	    try {
	        this.state = 370;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 96:
	        case 103:
	            localctx = new IdentifierLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 1);
	            this.state = 361;
	            this.identifier();
	            break;
	        case 75:
	            localctx = new NewLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 2);
	            this.state = 362;
	            this.newExpression();
	            break;
	        case 21:
	            localctx = new ImplicitMemberDotLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 3);
	            this.state = 363;
	            this.match(GameMakerLanguageParser.Dot);
	            this.state = 364;
	            this.identifier();
	            break;
	        case 10:
	            localctx = new ParenthesizedLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 4);
	            this.state = 365;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 366;
	            this.expression(0);
	            this.state = 367;
	            this.match(GameMakerLanguageParser.CloseParen);
	            break;
	        case 12:
	        case 15:
	            localctx = new StructLiteralLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 5);
	            this.state = 369;
	            this.structLiteral();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	lValueExpression() {
	    let localctx = new LValueExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 60, GameMakerLanguageParser.RULE_lValueExpression);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 372;
	        this.lValueStartExpression();
	        this.state = 380;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,28,this._ctx);
	        if(la_===1) {
	            this.state = 376;
	            this._errHandler.sync(this);
	            var _alt = this._interp.adaptivePredict(this._input,27,this._ctx)
	            while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	                if(_alt===1) {
	                    this.state = 373;
	                    this.lValueChainOperator(); 
	                }
	                this.state = 378;
	                this._errHandler.sync(this);
	                _alt = this._interp.adaptivePredict(this._input,27,this._ctx);
	            }

	            this.state = 379;
	            this.lValueFinalOperator();

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	lValueChainOperator() {
	    let localctx = new LValueChainOperatorContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 62, GameMakerLanguageParser.RULE_lValueChainOperator);
	    try {
	        this.state = 389;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 3:
	        case 4:
	        case 5:
	        case 6:
	        case 7:
	        case 8:
	            localctx = new MemberIndexLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 1);
	            this.state = 382;
	            this.accessor();
	            this.state = 383;
	            this.expressionSequence();
	            this.state = 384;
	            this.match(GameMakerLanguageParser.CloseBracket);
	            break;
	        case 21:
	            localctx = new MemberDotLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 2);
	            this.state = 386;
	            this.match(GameMakerLanguageParser.Dot);
	            this.state = 387;
	            this.identifier();
	            break;
	        case 10:
	            localctx = new CallLValueContext(this, localctx);
	            this.enterOuterAlt(localctx, 3);
	            this.state = 388;
	            this.arguments();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	lValueFinalOperator() {
	    let localctx = new LValueFinalOperatorContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 64, GameMakerLanguageParser.RULE_lValueFinalOperator);
	    try {
	        this.state = 397;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 3:
	        case 4:
	        case 5:
	        case 6:
	        case 7:
	        case 8:
	            localctx = new MemberIndexLValueFinalContext(this, localctx);
	            this.enterOuterAlt(localctx, 1);
	            this.state = 391;
	            this.accessor();
	            this.state = 392;
	            this.expressionSequence();
	            this.state = 393;
	            this.match(GameMakerLanguageParser.CloseBracket);
	            break;
	        case 21:
	            localctx = new MemberDotLValueFinalContext(this, localctx);
	            this.enterOuterAlt(localctx, 2);
	            this.state = 395;
	            this.match(GameMakerLanguageParser.Dot);
	            this.state = 396;
	            this.identifier();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	expressionSequence() {
	    let localctx = new ExpressionSequenceContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 66, GameMakerLanguageParser.RULE_expressionSequence);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 399;
	        this.expression(0);
	        this.state = 404;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        while(_la===18) {
	            this.state = 400;
	            this.match(GameMakerLanguageParser.Comma);
	            this.state = 401;
	            this.expression(0);
	            this.state = 406;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	expressionOrFunction() {
	    let localctx = new ExpressionOrFunctionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 68, GameMakerLanguageParser.RULE_expressionOrFunction);
	    try {
	        this.state = 410;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,32,this._ctx);
	        switch(la_) {
	        case 1:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 407;
	            this.assignmentExpression();
	            break;

	        case 2:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 408;
	            this.expression(0);
	            break;

	        case 3:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 409;
	            this.functionDeclaration();
	            break;

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}


	expression(_p) {
		if(_p===undefined) {
		    _p = 0;
		}
	    const _parentctx = this._ctx;
	    const _parentState = this.state;
	    let localctx = new ExpressionContext(this, this._ctx, _parentState);
	    let _prevctx = localctx;
	    const _startState = 70;
	    this.enterRecursionRule(localctx, 70, GameMakerLanguageParser.RULE_expression, _p);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 429;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,34,this._ctx);
	        switch(la_) {
	        case 1:
	            localctx = new CallExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;

	            this.state = 413;
	            this.callStatement(0);
	            break;

	        case 2:
	            localctx = new UnaryPlusExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 414;
	            this.match(GameMakerLanguageParser.Plus);
	            this.state = 415;
	            this.expression(21);
	            break;

	        case 3:
	            localctx = new UnaryMinusExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 416;
	            this.match(GameMakerLanguageParser.Minus);
	            this.state = 417;
	            this.expression(20);
	            break;

	        case 4:
	            localctx = new BitNotExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 418;
	            this.match(GameMakerLanguageParser.BitNot);
	            this.state = 419;
	            this.expression(19);
	            break;

	        case 5:
	            localctx = new NotExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 420;
	            this.match(GameMakerLanguageParser.Not);
	            this.state = 421;
	            this.expression(18);
	            break;

	        case 6:
	            localctx = new IncDecExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 424;
	            this._errHandler.sync(this);
	            switch(this._input.LA(1)) {
	            case 22:
	            case 23:
	                this.state = 422;
	                this.preIncDecExpression();
	                break;
	            case 10:
	            case 12:
	            case 15:
	            case 21:
	            case 75:
	            case 96:
	            case 103:
	                this.state = 423;
	                this.postIncDecExpression();
	                break;
	            default:
	                throw new antlr4.error.NoViableAltException(this);
	            }
	            break;

	        case 7:
	            localctx = new VariableExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 426;
	            this.lValueExpression();
	            break;

	        case 8:
	            localctx = new FunctionExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 427;
	            this.functionDeclaration();
	            break;

	        case 9:
	            localctx = new LiteralExpressionContext(this, localctx);
	            this._ctx = localctx;
	            _prevctx = localctx;
	            this.state = 428;
	            this.literal();
	            break;

	        }
	        this._ctx.stop = this._input.LT(-1);
	        this.state = 475;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,36,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                if(this._parseListeners!==null) {
	                    this.triggerExitRuleEvent();
	                }
	                _prevctx = localctx;
	                this.state = 473;
	                this._errHandler.sync(this);
	                var la_ = this._interp.adaptivePredict(this._input,35,this._ctx);
	                switch(la_) {
	                case 1:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 431;
	                    if (!( this.precpred(this._ctx, 17))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 17)");
	                    }
	                    this.state = 432;
	                    _la = this._input.LA(1);
	                    if(!((((_la) & ~0x1f) === 0 && ((1 << _la) & 4026531840) !== 0))) {
	                    this._errHandler.recoverInline(this);
	                    }
	                    else {
	                    	this._errHandler.reportMatch(this);
	                        this.consume();
	                    }
	                    this.state = 433;
	                    this.expression(18);
	                    break;

	                case 2:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 434;
	                    if (!( this.precpred(this._ctx, 16))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 16)");
	                    }
	                    this.state = 435;
	                    _la = this._input.LA(1);
	                    if(!(_la===24 || _la===25)) {
	                    this._errHandler.recoverInline(this);
	                    }
	                    else {
	                    	this._errHandler.reportMatch(this);
	                        this.consume();
	                    }
	                    this.state = 436;
	                    this.expression(17);
	                    break;

	                case 3:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 437;
	                    if (!( this.precpred(this._ctx, 15))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 15)");
	                    }
	                    this.state = 438;
	                    _la = this._input.LA(1);
	                    if(!(_la===36 || _la===37)) {
	                    this._errHandler.recoverInline(this);
	                    }
	                    else {
	                    	this._errHandler.reportMatch(this);
	                        this.consume();
	                    }
	                    this.state = 439;
	                    this.expression(16);
	                    break;

	                case 4:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 440;
	                    if (!( this.precpred(this._ctx, 14))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 14)");
	                    }
	                    this.state = 441;
	                    this.match(GameMakerLanguageParser.BitAnd);
	                    this.state = 442;
	                    this.expression(15);
	                    break;

	                case 5:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 443;
	                    if (!( this.precpred(this._ctx, 13))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 13)");
	                    }
	                    this.state = 444;
	                    this.match(GameMakerLanguageParser.BitXOr);
	                    this.state = 445;
	                    this.expression(14);
	                    break;

	                case 6:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 446;
	                    if (!( this.precpred(this._ctx, 12))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 12)");
	                    }
	                    this.state = 447;
	                    this.match(GameMakerLanguageParser.BitOr);
	                    this.state = 448;
	                    this.expression(13);
	                    break;

	                case 7:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 449;
	                    if (!( this.precpred(this._ctx, 11))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 11)");
	                    }
	                    this.state = 450;
	                    _la = this._input.LA(1);
	                    if(!(((((_la - 19)) & ~0x1f) === 0 && ((1 << (_la - 19)) & 25165825) !== 0))) {
	                    this._errHandler.recoverInline(this);
	                    }
	                    else {
	                    	this._errHandler.reportMatch(this);
	                        this.consume();
	                    }
	                    this.state = 451;
	                    this.expression(12);
	                    break;

	                case 8:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 452;
	                    if (!( this.precpred(this._ctx, 10))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 10)");
	                    }
	                    this.state = 453;
	                    _la = this._input.LA(1);
	                    if(!(((((_la - 38)) & ~0x1f) === 0 && ((1 << (_la - 38)) & 15) !== 0))) {
	                    this._errHandler.recoverInline(this);
	                    }
	                    else {
	                    	this._errHandler.reportMatch(this);
	                        this.consume();
	                    }
	                    this.state = 454;
	                    this.expression(11);
	                    break;

	                case 9:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 455;
	                    if (!( this.precpred(this._ctx, 9))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 9)");
	                    }
	                    this.state = 456;
	                    this.match(GameMakerLanguageParser.NullCoalesce);
	                    this.state = 457;
	                    this.expression(9);
	                    break;

	                case 10:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 458;
	                    if (!( this.precpred(this._ctx, 8))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 8)");
	                    }
	                    this.state = 459;
	                    this.match(GameMakerLanguageParser.And);
	                    this.state = 460;
	                    this.expression(9);
	                    break;

	                case 11:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 461;
	                    if (!( this.precpred(this._ctx, 7))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 7)");
	                    }
	                    this.state = 462;
	                    this.match(GameMakerLanguageParser.Or);
	                    this.state = 463;
	                    this.expression(8);
	                    break;

	                case 12:
	                    localctx = new BinaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 464;
	                    if (!( this.precpred(this._ctx, 6))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 6)");
	                    }
	                    this.state = 465;
	                    this.match(GameMakerLanguageParser.Xor);
	                    this.state = 466;
	                    this.expression(7);
	                    break;

	                case 13:
	                    localctx = new TernaryExpressionContext(this, new ExpressionContext(this, _parentctx, _parentState));
	                    this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_expression);
	                    this.state = 467;
	                    if (!( this.precpred(this._ctx, 4))) {
	                        throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 4)");
	                    }
	                    this.state = 468;
	                    this.match(GameMakerLanguageParser.QuestionMark);
	                    this.state = 469;
	                    this.expression(0);
	                    this.state = 470;
	                    this.match(GameMakerLanguageParser.Colon);
	                    this.state = 471;
	                    this.expression(4);
	                    break;

	                } 
	            }
	            this.state = 477;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,36,this._ctx);
	        }

	    } catch( error) {
	        if(error instanceof antlr4.error.RecognitionException) {
		        localctx.exception = error;
		        this._errHandler.reportError(this, error);
		        this._errHandler.recover(this, error);
		    } else {
		    	throw error;
		    }
	    } finally {
	        this.unrollRecursionContexts(_parentctx)
	    }
	    return localctx;
	}


	callStatement(_p) {
		if(_p===undefined) {
		    _p = 0;
		}
	    const _parentctx = this._ctx;
	    const _parentState = this.state;
	    let localctx = new CallStatementContext(this, this._ctx, _parentState);
	    let _prevctx = localctx;
	    const _startState = 72;
	    this.enterRecursionRule(localctx, 72, GameMakerLanguageParser.RULE_callStatement, _p);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 479;
	        this.callableExpression();
	        this.state = 480;
	        this.arguments();
	        this._ctx.stop = this._input.LT(-1);
	        this.state = 486;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,37,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                if(this._parseListeners!==null) {
	                    this.triggerExitRuleEvent();
	                }
	                _prevctx = localctx;
	                localctx = new CallStatementContext(this, _parentctx, _parentState);
	                this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_callStatement);
	                this.state = 482;
	                if (!( this.precpred(this._ctx, 1))) {
	                    throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 1)");
	                }
	                this.state = 483;
	                this.arguments(); 
	            }
	            this.state = 488;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,37,this._ctx);
	        }

	    } catch( error) {
	        if(error instanceof antlr4.error.RecognitionException) {
		        localctx.exception = error;
		        this._errHandler.reportError(this, error);
		        this._errHandler.recover(this, error);
		    } else {
		    	throw error;
		    }
	    } finally {
	        this.unrollRecursionContexts(_parentctx)
	    }
	    return localctx;
	}


	implicitCallStatement(_p) {
		if(_p===undefined) {
		    _p = 0;
		}
	    const _parentctx = this._ctx;
	    const _parentState = this.state;
	    let localctx = new ImplicitCallStatementContext(this, this._ctx, _parentState);
	    let _prevctx = localctx;
	    const _startState = 74;
	    this.enterRecursionRule(localctx, 74, GameMakerLanguageParser.RULE_implicitCallStatement, _p);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 490;
	        this.match(GameMakerLanguageParser.Dot);
	        this.state = 491;
	        this.identifier();
	        this.state = 492;
	        this.arguments();
	        this._ctx.stop = this._input.LT(-1);
	        this.state = 498;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,38,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                if(this._parseListeners!==null) {
	                    this.triggerExitRuleEvent();
	                }
	                _prevctx = localctx;
	                localctx = new ImplicitCallStatementContext(this, _parentctx, _parentState);
	                this.pushNewRecursionContext(localctx, _startState, GameMakerLanguageParser.RULE_implicitCallStatement);
	                this.state = 494;
	                if (!( this.precpred(this._ctx, 1))) {
	                    throw new antlr4.error.FailedPredicateException(this, "this.precpred(this._ctx, 1)");
	                }
	                this.state = 495;
	                this.arguments(); 
	            }
	            this.state = 500;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,38,this._ctx);
	        }

	    } catch( error) {
	        if(error instanceof antlr4.error.RecognitionException) {
		        localctx.exception = error;
		        this._errHandler.reportError(this, error);
		        this._errHandler.recover(this, error);
		    } else {
		    	throw error;
		    }
	    } finally {
	        this.unrollRecursionContexts(_parentctx)
	    }
	    return localctx;
	}



	callableExpression() {
	    let localctx = new CallableExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 76, GameMakerLanguageParser.RULE_callableExpression);
	    try {
	        this.state = 509;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,40,this._ctx);
	        switch(la_) {
	        case 1:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 501;
	            this.lValueExpression();
	            break;

	        case 2:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 502;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 505;
	            this._errHandler.sync(this);
	            switch(this._input.LA(1)) {
	            case 87:
	                this.state = 503;
	                this.functionDeclaration();
	                break;
	            case 10:
	            case 12:
	            case 15:
	            case 21:
	            case 75:
	            case 96:
	            case 103:
	                this.state = 504;
	                this.callableExpression();
	                break;
	            default:
	                throw new antlr4.error.NoViableAltException(this);
	            }
	            this.state = 507;
	            this.match(GameMakerLanguageParser.CloseParen);
	            break;

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	preIncDecExpression() {
	    let localctx = new PreIncDecExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 78, GameMakerLanguageParser.RULE_preIncDecExpression);
	    var _la = 0;
	    try {
	        localctx = new PreIncDecStatementContext(this, localctx);
	        this.enterOuterAlt(localctx, 1);
	        this.state = 511;
	        _la = this._input.LA(1);
	        if(!(_la===22 || _la===23)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	        this.state = 512;
	        this.lValueExpression();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	postIncDecExpression() {
	    let localctx = new PostIncDecExpressionContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 80, GameMakerLanguageParser.RULE_postIncDecExpression);
	    var _la = 0;
	    try {
	        localctx = new PostIncDecStatementContext(this, localctx);
	        this.enterOuterAlt(localctx, 1);
	        this.state = 514;
	        this.lValueExpression();
	        this.state = 515;
	        _la = this._input.LA(1);
	        if(!(_la===22 || _la===23)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	incDecStatement() {
	    let localctx = new IncDecStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 82, GameMakerLanguageParser.RULE_incDecStatement);
	    try {
	        this.state = 519;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 10:
	        case 12:
	        case 15:
	        case 21:
	        case 75:
	        case 96:
	        case 103:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 517;
	            this.postIncDecExpression();
	            break;
	        case 22:
	        case 23:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 518;
	            this.preIncDecExpression();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	accessor() {
	    let localctx = new AccessorContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 84, GameMakerLanguageParser.RULE_accessor);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 521;
	        _la = this._input.LA(1);
	        if(!((((_la) & ~0x1f) === 0 && ((1 << _la) & 504) !== 0))) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	arguments() {
	    let localctx = new ArgumentsContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 86, GameMakerLanguageParser.RULE_arguments);
	    var _la = 0;
	    try {
	        this.state = 533;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,44,this._ctx);
	        switch(la_) {
	        case 1:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 523;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 524;
	            this.match(GameMakerLanguageParser.CloseParen);
	            break;

	        case 2:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 525;
	            this.match(GameMakerLanguageParser.OpenParen);
	            this.state = 527;
	            this._errHandler.sync(this);
	            var la_ = this._interp.adaptivePredict(this._input,42,this._ctx);
	            if(la_===1) {
	                this.state = 526;
	                this.argumentList();

	            }
	            this.state = 530;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            if(_la===18) {
	                this.state = 529;
	                this.trailingComma();
	            }

	            this.state = 532;
	            this.match(GameMakerLanguageParser.CloseParen);
	            break;

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	argumentList() {
	    let localctx = new ArgumentListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 88, GameMakerLanguageParser.RULE_argumentList);
	    try {
	        this.state = 555;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,47,this._ctx);
	        switch(la_) {
	        case 1:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 535;
	            this.match(GameMakerLanguageParser.Comma);
	            this.state = 536;
	            this.argument();
	            this.state = 541;
	            this._errHandler.sync(this);
	            var _alt = this._interp.adaptivePredict(this._input,45,this._ctx)
	            while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	                if(_alt===1) {
	                    this.state = 537;
	                    this.match(GameMakerLanguageParser.Comma);
	                    this.state = 538;
	                    this.argument(); 
	                }
	                this.state = 543;
	                this._errHandler.sync(this);
	                _alt = this._interp.adaptivePredict(this._input,45,this._ctx);
	            }

	            break;

	        case 2:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 544;
	            this.argument();
	            this.state = 545;
	            this.match(GameMakerLanguageParser.Comma);
	            this.state = 546;
	            this.argument();
	            this.state = 551;
	            this._errHandler.sync(this);
	            var _alt = this._interp.adaptivePredict(this._input,46,this._ctx)
	            while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	                if(_alt===1) {
	                    this.state = 547;
	                    this.match(GameMakerLanguageParser.Comma);
	                    this.state = 548;
	                    this.argument(); 
	                }
	                this.state = 553;
	                this._errHandler.sync(this);
	                _alt = this._interp.adaptivePredict(this._input,46,this._ctx);
	            }

	            break;

	        case 3:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 554;
	            this.argument();
	            break;

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	argument() {
	    let localctx = new ArgumentContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 90, GameMakerLanguageParser.RULE_argument);
	    try {
	        this.state = 560;
	        this._errHandler.sync(this);
	        var la_ = this._interp.adaptivePredict(this._input,48,this._ctx);
	        switch(la_) {
	        case 1:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 557;
	            this.expressionOrFunction();
	            break;

	        case 2:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 558;
	            this.match(GameMakerLanguageParser.UndefinedLiteral);
	            break;

	        case 3:
	            this.enterOuterAlt(localctx, 3);

	            break;

	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	trailingComma() {
	    let localctx = new TrailingCommaContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 92, GameMakerLanguageParser.RULE_trailingComma);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 562;
	        this.match(GameMakerLanguageParser.Comma);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	assignmentOperator() {
	    let localctx = new AssignmentOperatorContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 94, GameMakerLanguageParser.RULE_assignmentOperator);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 564;
	        _la = this._input.LA(1);
	        if(!(_la===19 || ((((_la - 35)) & ~0x1f) === 0 && ((1 << (_la - 35)) & 33521665) !== 0))) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	literal() {
	    let localctx = new LiteralContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 96, GameMakerLanguageParser.RULE_literal);
	    try {
	        this.state = 578;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 63:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 566;
	            this.match(GameMakerLanguageParser.UndefinedLiteral);
	            break;
	        case 64:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 567;
	            this.match(GameMakerLanguageParser.NoOneLiteral);
	            break;
	        case 65:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 568;
	            this.match(GameMakerLanguageParser.BooleanLiteral);
	            break;
	        case 104:
	            this.enterOuterAlt(localctx, 4);
	            this.state = 569;
	            this.match(GameMakerLanguageParser.StringLiteral);
	            break;
	        case 106:
	            this.enterOuterAlt(localctx, 5);
	            this.state = 570;
	            this.match(GameMakerLanguageParser.VerbatimStringLiteral);
	            break;
	        case 105:
	            this.enterOuterAlt(localctx, 6);
	            this.state = 571;
	            this.templateStringLiteral();
	            break;
	        case 69:
	            this.enterOuterAlt(localctx, 7);
	            this.state = 572;
	            this.match(GameMakerLanguageParser.HexIntegerLiteral);
	            break;
	        case 68:
	            this.enterOuterAlt(localctx, 8);
	            this.state = 573;
	            this.match(GameMakerLanguageParser.BinaryLiteral);
	            break;
	        case 67:
	            this.enterOuterAlt(localctx, 9);
	            this.state = 574;
	            this.match(GameMakerLanguageParser.DecimalLiteral);
	            break;
	        case 66:
	            this.enterOuterAlt(localctx, 10);
	            this.state = 575;
	            this.match(GameMakerLanguageParser.IntegerLiteral);
	            break;
	        case 3:
	            this.enterOuterAlt(localctx, 11);
	            this.state = 576;
	            this.arrayLiteral();
	            break;
	        case 12:
	        case 15:
	            this.enterOuterAlt(localctx, 12);
	            this.state = 577;
	            this.structLiteral();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	templateStringLiteral() {
	    let localctx = new TemplateStringLiteralContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 98, GameMakerLanguageParser.RULE_templateStringLiteral);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 580;
	        this.match(GameMakerLanguageParser.TemplateStringStart);
	        this.state = 584;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        while(_la===113 || _la===114) {
	            this.state = 581;
	            this.templateStringAtom();
	            this.state = 586;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        }
	        this.state = 587;
	        this.match(GameMakerLanguageParser.TemplateStringEnd);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	templateStringAtom() {
	    let localctx = new TemplateStringAtomContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 100, GameMakerLanguageParser.RULE_templateStringAtom);
	    try {
	        this.state = 594;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 114:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 589;
	            this.match(GameMakerLanguageParser.TemplateStringText);
	            break;
	        case 113:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 590;
	            this.match(GameMakerLanguageParser.TemplateStringStartExpression);
	            this.state = 591;
	            this.expression(0);
	            this.state = 592;
	            this.match(GameMakerLanguageParser.TemplateStringEndExpression);
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	arrayLiteral() {
	    let localctx = new ArrayLiteralContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 102, GameMakerLanguageParser.RULE_arrayLiteral);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 596;
	        this.match(GameMakerLanguageParser.OpenBracket);
	        this.state = 597;
	        this.elementList();
	        this.state = 598;
	        this.match(GameMakerLanguageParser.CloseBracket);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	elementList() {
	    let localctx = new ElementListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 104, GameMakerLanguageParser.RULE_elementList);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 603;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,52,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                this.state = 600;
	                this.match(GameMakerLanguageParser.Comma); 
	            }
	            this.state = 605;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,52,this._ctx);
	        }

	        this.state = 607;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if((((_la) & ~0x1f) === 0 && ((1 << _la) & 266376200) !== 0) || ((((_la - 63)) & ~0x1f) === 0 && ((1 << (_la - 63)) & 16781439) !== 0) || ((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 1921) !== 0)) {
	            this.state = 606;
	            this.expressionOrFunction();
	        }

	        this.state = 617;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,55,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                this.state = 610; 
	                this._errHandler.sync(this);
	                _la = this._input.LA(1);
	                do {
	                    this.state = 609;
	                    this.match(GameMakerLanguageParser.Comma);
	                    this.state = 612; 
	                    this._errHandler.sync(this);
	                    _la = this._input.LA(1);
	                } while(_la===18);
	                this.state = 614;
	                this.expressionOrFunction(); 
	            }
	            this.state = 619;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,55,this._ctx);
	        }

	        this.state = 621;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===18) {
	            this.state = 620;
	            this.match(GameMakerLanguageParser.Comma);
	        }

	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	structLiteral() {
	    let localctx = new StructLiteralContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 106, GameMakerLanguageParser.RULE_structLiteral);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 623;
	        this.openBlock();
	        this.state = 637;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===64 || ((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 1509) !== 0)) {
	            this.state = 624;
	            this.structItem();
	            this.state = 631;
	            this._errHandler.sync(this);
	            var _alt = this._interp.adaptivePredict(this._input,58,this._ctx)
	            while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	                if(_alt===1) {
	                    this.state = 626;
	                    this._errHandler.sync(this);
	                    _la = this._input.LA(1);
	                    if(_la===18) {
	                        this.state = 625;
	                        this.match(GameMakerLanguageParser.Comma);
	                    }

	                    this.state = 628;
	                    this.structItem(); 
	                }
	                this.state = 633;
	                this._errHandler.sync(this);
	                _alt = this._interp.adaptivePredict(this._input,58,this._ctx);
	            }

	            this.state = 635;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            if(_la===18) {
	                this.state = 634;
	                this.match(GameMakerLanguageParser.Comma);
	            }

	        }

	        this.state = 639;
	        this.closeBlock();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	structItem() {
	    let localctx = new StructItemContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 108, GameMakerLanguageParser.RULE_structItem);
	    try {
	        this.state = 644;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 64:
	        case 96:
	        case 103:
	        case 104:
	        case 106:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 641;
	            this.propertyAssignment();
	            break;
	        case 101:
	        case 102:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 642;
	            this.regionStatement();
	            break;
	        case 98:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 643;
	            this.macroStatement();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	propertyAssignment() {
	    let localctx = new PropertyAssignmentContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 110, GameMakerLanguageParser.RULE_propertyAssignment);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 646;
	        this.propertyIdentifier();
	        this.state = 647;
	        this.match(GameMakerLanguageParser.Colon);
	        this.state = 648;
	        this.expressionOrFunction();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	propertyIdentifier() {
	    let localctx = new PropertyIdentifierContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 112, GameMakerLanguageParser.RULE_propertyIdentifier);
	    try {
	        this.state = 655;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 103:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 650;
	            this.match(GameMakerLanguageParser.Identifier);
	            break;
	        case 96:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 651;
	            this.softKeyword();
	            break;
	        case 64:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 652;
	            this.propertySoftKeyword();
	            break;
	        case 104:
	            this.enterOuterAlt(localctx, 4);
	            this.state = 653;
	            this.match(GameMakerLanguageParser.StringLiteral);
	            break;
	        case 106:
	            this.enterOuterAlt(localctx, 5);
	            this.state = 654;
	            this.match(GameMakerLanguageParser.VerbatimStringLiteral);
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	functionDeclaration() {
	    let localctx = new FunctionDeclarationContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 114, GameMakerLanguageParser.RULE_functionDeclaration);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 657;
	        this.match(GameMakerLanguageParser.Function_);
	        this.state = 659;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===103) {
	            this.state = 658;
	            this.match(GameMakerLanguageParser.Identifier);
	        }

	        this.state = 661;
	        this.parameterList();
	        this.state = 663;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===20 || _la===96) {
	            this.state = 662;
	            this.constructorClause();
	        }

	        this.state = 665;
	        this.block();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	constructorClause() {
	    let localctx = new ConstructorClauseContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 116, GameMakerLanguageParser.RULE_constructorClause);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 670;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===20) {
	            this.state = 667;
	            this.match(GameMakerLanguageParser.Colon);
	            this.state = 668;
	            this.match(GameMakerLanguageParser.Identifier);
	            this.state = 669;
	            this.arguments();
	        }

	        this.state = 672;
	        this.match(GameMakerLanguageParser.Constructor);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	parameterList() {
	    let localctx = new ParameterListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 118, GameMakerLanguageParser.RULE_parameterList);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 674;
	        this.match(GameMakerLanguageParser.OpenParen);
	        this.state = 686;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===96 || _la===103) {
	            this.state = 675;
	            this.parameterArgument();
	            this.state = 680;
	            this._errHandler.sync(this);
	            var _alt = this._interp.adaptivePredict(this._input,66,this._ctx)
	            while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	                if(_alt===1) {
	                    this.state = 676;
	                    this.match(GameMakerLanguageParser.Comma);
	                    this.state = 677;
	                    this.parameterArgument(); 
	                }
	                this.state = 682;
	                this._errHandler.sync(this);
	                _alt = this._interp.adaptivePredict(this._input,66,this._ctx);
	            }

	            this.state = 684;
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	            if(_la===18) {
	                this.state = 683;
	                this.match(GameMakerLanguageParser.Comma);
	            }

	        }

	        this.state = 688;
	        this.match(GameMakerLanguageParser.CloseParen);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	parameterArgument() {
	    let localctx = new ParameterArgumentContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 120, GameMakerLanguageParser.RULE_parameterArgument);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 690;
	        this.identifier();
	        this.state = 693;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===19) {
	            this.state = 691;
	            this.match(GameMakerLanguageParser.Assign);
	            this.state = 692;
	            this.expressionOrFunction();
	        }

	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	identifier() {
	    let localctx = new IdentifierContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 122, GameMakerLanguageParser.RULE_identifier);
	    try {
	        this.state = 697;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 103:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 695;
	            this.match(GameMakerLanguageParser.Identifier);
	            break;
	        case 96:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 696;
	            this.softKeyword();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	enumeratorDeclaration() {
	    let localctx = new EnumeratorDeclarationContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 124, GameMakerLanguageParser.RULE_enumeratorDeclaration);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 699;
	        this.match(GameMakerLanguageParser.Enum);
	        this.state = 700;
	        this.identifier();
	        this.state = 701;
	        this.openBlock();
	        this.state = 703;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 229) !== 0)) {
	            this.state = 702;
	            this.enumeratorList();
	        }

	        this.state = 705;
	        this.closeBlock();
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	enumeratorList() {
	    let localctx = new EnumeratorListContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 126, GameMakerLanguageParser.RULE_enumeratorList);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 707;
	        this.enumeratorItem();
	        this.state = 714;
	        this._errHandler.sync(this);
	        var _alt = this._interp.adaptivePredict(this._input,73,this._ctx)
	        while(_alt!=2 && _alt!=antlr4.atn.ATN.INVALID_ALT_NUMBER) {
	            if(_alt===1) {
	                this.state = 709;
	                this._errHandler.sync(this);
	                _la = this._input.LA(1);
	                if(_la===18) {
	                    this.state = 708;
	                    this.match(GameMakerLanguageParser.Comma);
	                }

	                this.state = 711;
	                this.enumeratorItem(); 
	            }
	            this.state = 716;
	            this._errHandler.sync(this);
	            _alt = this._interp.adaptivePredict(this._input,73,this._ctx);
	        }

	        this.state = 718;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===18) {
	            this.state = 717;
	            this.match(GameMakerLanguageParser.Comma);
	        }

	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	enumeratorItem() {
	    let localctx = new EnumeratorItemContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 128, GameMakerLanguageParser.RULE_enumeratorItem);
	    try {
	        this.state = 723;
	        this._errHandler.sync(this);
	        switch(this._input.LA(1)) {
	        case 96:
	        case 103:
	            this.enterOuterAlt(localctx, 1);
	            this.state = 720;
	            this.enumerator();
	            break;
	        case 101:
	        case 102:
	            this.enterOuterAlt(localctx, 2);
	            this.state = 721;
	            this.regionStatement();
	            break;
	        case 98:
	            this.enterOuterAlt(localctx, 3);
	            this.state = 722;
	            this.macroStatement();
	            break;
	        default:
	            throw new antlr4.error.NoViableAltException(this);
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	enumerator() {
	    let localctx = new EnumeratorContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 130, GameMakerLanguageParser.RULE_enumerator);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 725;
	        this.identifier();
	        this.state = 728;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===19) {
	            this.state = 726;
	            this.match(GameMakerLanguageParser.Assign);
	            this.state = 727;
	            this.expression(0);
	        }

	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	macroStatement() {
	    let localctx = new MacroStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 132, GameMakerLanguageParser.RULE_macroStatement);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 730;
	        this.match(GameMakerLanguageParser.Macro);
	        this.state = 731;
	        this.identifier();
	        this.state = 733; 
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        do {
	            this.state = 732;
	            this.macroToken();
	            this.state = 735; 
	            this._errHandler.sync(this);
	            _la = this._input.LA(1);
	        } while((((_la) & ~0x1f) === 0 && ((1 << _la) & 4294967288) !== 0) || ((((_la - 32)) & ~0x1f) === 0 && ((1 << (_la - 32)) & 4294967295) !== 0) || ((((_la - 64)) & ~0x1f) === 0 && ((1 << (_la - 64)) & 4294967295) !== 0) || ((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 460683) !== 0));
	        this.state = 737;
	        _la = this._input.LA(1);
	        if(!(_la===-1 || _la===108)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	defineStatement() {
	    let localctx = new DefineStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 134, GameMakerLanguageParser.RULE_defineStatement);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 739;
	        this.match(GameMakerLanguageParser.Define);
	        this.state = 740;
	        this.match(GameMakerLanguageParser.RegionCharacters);
	        this.state = 741;
	        _la = this._input.LA(1);
	        if(!(_la===-1 || _la===111)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	regionStatement() {
	    let localctx = new RegionStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 136, GameMakerLanguageParser.RULE_regionStatement);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 743;
	        _la = this._input.LA(1);
	        if(!(_la===101 || _la===102)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	        this.state = 745;
	        this._errHandler.sync(this);
	        _la = this._input.LA(1);
	        if(_la===110) {
	            this.state = 744;
	            this.match(GameMakerLanguageParser.RegionCharacters);
	        }

	        this.state = 747;
	        _la = this._input.LA(1);
	        if(!(_la===-1 || _la===111)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	identifierStatement() {
	    let localctx = new IdentifierStatementContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 138, GameMakerLanguageParser.RULE_identifierStatement);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 749;
	        this.identifier();
	        this.state = 750;
	        if (!( this._input.LA(1) !== GameMakerLanguageParser.Dot)) {
	            throw new antlr4.error.FailedPredicateException(this, "this._input.LA(1) !== GameMakerLanguageParser.Dot");
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	softKeyword() {
	    let localctx = new SoftKeywordContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 140, GameMakerLanguageParser.RULE_softKeyword);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 752;
	        this.match(GameMakerLanguageParser.Constructor);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	propertySoftKeyword() {
	    let localctx = new PropertySoftKeywordContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 142, GameMakerLanguageParser.RULE_propertySoftKeyword);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 754;
	        this.match(GameMakerLanguageParser.NoOneLiteral);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	openBlock() {
	    let localctx = new OpenBlockContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 144, GameMakerLanguageParser.RULE_openBlock);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 756;
	        _la = this._input.LA(1);
	        if(!(_la===12 || _la===15)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	closeBlock() {
	    let localctx = new CloseBlockContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 146, GameMakerLanguageParser.RULE_closeBlock);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 758;
	        _la = this._input.LA(1);
	        if(!(_la===14 || _la===16)) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	eos() {
	    let localctx = new EosContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 148, GameMakerLanguageParser.RULE_eos);
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 760;
	        this.match(GameMakerLanguageParser.SemiColon);
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}



	macroToken() {
	    let localctx = new MacroTokenContext(this, this._ctx, this.state);
	    this.enterRule(localctx, 150, GameMakerLanguageParser.RULE_macroToken);
	    var _la = 0;
	    try {
	        this.enterOuterAlt(localctx, 1);
	        this.state = 762;
	        _la = this._input.LA(1);
	        if(!((((_la) & ~0x1f) === 0 && ((1 << _la) & 4294967288) !== 0) || ((((_la - 32)) & ~0x1f) === 0 && ((1 << (_la - 32)) & 4294967295) !== 0) || ((((_la - 64)) & ~0x1f) === 0 && ((1 << (_la - 64)) & 4294967295) !== 0) || ((((_la - 96)) & ~0x1f) === 0 && ((1 << (_la - 96)) & 460683) !== 0))) {
	        this._errHandler.recoverInline(this);
	        }
	        else {
	        	this._errHandler.reportMatch(this);
	            this.consume();
	        }
	    } catch (re) {
	    	if(re instanceof antlr4.error.RecognitionException) {
		        localctx.exception = re;
		        this._errHandler.reportError(this, re);
		        this._errHandler.recover(this, re);
		    } else {
		    	throw re;
		    }
	    } finally {
	        this.exitRule();
	    }
	    return localctx;
	}


}

GameMakerLanguageParser.EOF = antlr4.Token.EOF;
GameMakerLanguageParser.MultiLineComment = 1;
GameMakerLanguageParser.SingleLineComment = 2;
GameMakerLanguageParser.OpenBracket = 3;
GameMakerLanguageParser.ListAccessor = 4;
GameMakerLanguageParser.MapAccessor = 5;
GameMakerLanguageParser.GridAccessor = 6;
GameMakerLanguageParser.ArrayAccessor = 7;
GameMakerLanguageParser.StructAccessor = 8;
GameMakerLanguageParser.CloseBracket = 9;
GameMakerLanguageParser.OpenParen = 10;
GameMakerLanguageParser.CloseParen = 11;
GameMakerLanguageParser.OpenBrace = 12;
GameMakerLanguageParser.TemplateStringEndExpression = 13;
GameMakerLanguageParser.CloseBrace = 14;
GameMakerLanguageParser.Begin = 15;
GameMakerLanguageParser.End = 16;
GameMakerLanguageParser.SemiColon = 17;
GameMakerLanguageParser.Comma = 18;
GameMakerLanguageParser.Assign = 19;
GameMakerLanguageParser.Colon = 20;
GameMakerLanguageParser.Dot = 21;
GameMakerLanguageParser.PlusPlus = 22;
GameMakerLanguageParser.MinusMinus = 23;
GameMakerLanguageParser.Plus = 24;
GameMakerLanguageParser.Minus = 25;
GameMakerLanguageParser.BitNot = 26;
GameMakerLanguageParser.Not = 27;
GameMakerLanguageParser.Multiply = 28;
GameMakerLanguageParser.Divide = 29;
GameMakerLanguageParser.IntegerDivide = 30;
GameMakerLanguageParser.Modulo = 31;
GameMakerLanguageParser.Power = 32;
GameMakerLanguageParser.QuestionMark = 33;
GameMakerLanguageParser.NullCoalesce = 34;
GameMakerLanguageParser.NullCoalescingAssign = 35;
GameMakerLanguageParser.RightShiftArithmetic = 36;
GameMakerLanguageParser.LeftShiftArithmetic = 37;
GameMakerLanguageParser.LessThan = 38;
GameMakerLanguageParser.MoreThan = 39;
GameMakerLanguageParser.LessThanEquals = 40;
GameMakerLanguageParser.GreaterThanEquals = 41;
GameMakerLanguageParser.Equals = 42;
GameMakerLanguageParser.NotEquals = 43;
GameMakerLanguageParser.BitAnd = 44;
GameMakerLanguageParser.BitXOr = 45;
GameMakerLanguageParser.BitOr = 46;
GameMakerLanguageParser.And = 47;
GameMakerLanguageParser.Or = 48;
GameMakerLanguageParser.Xor = 49;
GameMakerLanguageParser.MultiplyAssign = 50;
GameMakerLanguageParser.DivideAssign = 51;
GameMakerLanguageParser.PlusAssign = 52;
GameMakerLanguageParser.MinusAssign = 53;
GameMakerLanguageParser.ModulusAssign = 54;
GameMakerLanguageParser.LeftShiftArithmeticAssign = 55;
GameMakerLanguageParser.RightShiftArithmeticAssign = 56;
GameMakerLanguageParser.BitAndAssign = 57;
GameMakerLanguageParser.BitXorAssign = 58;
GameMakerLanguageParser.BitOrAssign = 59;
GameMakerLanguageParser.NumberSign = 60;
GameMakerLanguageParser.DollarSign = 61;
GameMakerLanguageParser.AtSign = 62;
GameMakerLanguageParser.UndefinedLiteral = 63;
GameMakerLanguageParser.NoOneLiteral = 64;
GameMakerLanguageParser.BooleanLiteral = 65;
GameMakerLanguageParser.IntegerLiteral = 66;
GameMakerLanguageParser.DecimalLiteral = 67;
GameMakerLanguageParser.BinaryLiteral = 68;
GameMakerLanguageParser.HexIntegerLiteral = 69;
GameMakerLanguageParser.Break = 70;
GameMakerLanguageParser.Exit = 71;
GameMakerLanguageParser.Do = 72;
GameMakerLanguageParser.Case = 73;
GameMakerLanguageParser.Else = 74;
GameMakerLanguageParser.New = 75;
GameMakerLanguageParser.Var = 76;
GameMakerLanguageParser.GlobalVar = 77;
GameMakerLanguageParser.Catch = 78;
GameMakerLanguageParser.Finally = 79;
GameMakerLanguageParser.Return = 80;
GameMakerLanguageParser.Continue = 81;
GameMakerLanguageParser.For = 82;
GameMakerLanguageParser.Switch = 83;
GameMakerLanguageParser.While = 84;
GameMakerLanguageParser.Until = 85;
GameMakerLanguageParser.Repeat = 86;
GameMakerLanguageParser.Function_ = 87;
GameMakerLanguageParser.With = 88;
GameMakerLanguageParser.Default = 89;
GameMakerLanguageParser.If = 90;
GameMakerLanguageParser.Then = 91;
GameMakerLanguageParser.Throw = 92;
GameMakerLanguageParser.Delete = 93;
GameMakerLanguageParser.Try = 94;
GameMakerLanguageParser.Enum = 95;
GameMakerLanguageParser.Constructor = 96;
GameMakerLanguageParser.Static = 97;
GameMakerLanguageParser.Macro = 98;
GameMakerLanguageParser.EscapedNewLine = 99;
GameMakerLanguageParser.Define = 100;
GameMakerLanguageParser.Region = 101;
GameMakerLanguageParser.EndRegion = 102;
GameMakerLanguageParser.Identifier = 103;
GameMakerLanguageParser.StringLiteral = 104;
GameMakerLanguageParser.TemplateStringStart = 105;
GameMakerLanguageParser.VerbatimStringLiteral = 106;
GameMakerLanguageParser.WhiteSpaces = 107;
GameMakerLanguageParser.LineTerminator = 108;
GameMakerLanguageParser.UnexpectedCharacter = 109;
GameMakerLanguageParser.RegionCharacters = 110;
GameMakerLanguageParser.RegionEOL = 111;
GameMakerLanguageParser.TemplateStringEnd = 112;
GameMakerLanguageParser.TemplateStringStartExpression = 113;
GameMakerLanguageParser.TemplateStringText = 114;

GameMakerLanguageParser.RULE_program = 0;
GameMakerLanguageParser.RULE_statementList = 1;
GameMakerLanguageParser.RULE_statement = 2;
GameMakerLanguageParser.RULE_block = 3;
GameMakerLanguageParser.RULE_ifStatement = 4;
GameMakerLanguageParser.RULE_iterationStatement = 5;
GameMakerLanguageParser.RULE_withStatement = 6;
GameMakerLanguageParser.RULE_switchStatement = 7;
GameMakerLanguageParser.RULE_continueStatement = 8;
GameMakerLanguageParser.RULE_breakStatement = 9;
GameMakerLanguageParser.RULE_exitStatement = 10;
GameMakerLanguageParser.RULE_emptyStatement = 11;
GameMakerLanguageParser.RULE_caseBlock = 12;
GameMakerLanguageParser.RULE_caseClauses = 13;
GameMakerLanguageParser.RULE_caseClause = 14;
GameMakerLanguageParser.RULE_defaultClause = 15;
GameMakerLanguageParser.RULE_throwStatement = 16;
GameMakerLanguageParser.RULE_tryStatement = 17;
GameMakerLanguageParser.RULE_catchProduction = 18;
GameMakerLanguageParser.RULE_finallyProduction = 19;
GameMakerLanguageParser.RULE_returnStatement = 20;
GameMakerLanguageParser.RULE_deleteStatement = 21;
GameMakerLanguageParser.RULE_literalStatement = 22;
GameMakerLanguageParser.RULE_assignmentExpression = 23;
GameMakerLanguageParser.RULE_variableDeclarationList = 24;
GameMakerLanguageParser.RULE_varModifier = 25;
GameMakerLanguageParser.RULE_variableDeclaration = 26;
GameMakerLanguageParser.RULE_globalVarStatement = 27;
GameMakerLanguageParser.RULE_newExpression = 28;
GameMakerLanguageParser.RULE_lValueStartExpression = 29;
GameMakerLanguageParser.RULE_lValueExpression = 30;
GameMakerLanguageParser.RULE_lValueChainOperator = 31;
GameMakerLanguageParser.RULE_lValueFinalOperator = 32;
GameMakerLanguageParser.RULE_expressionSequence = 33;
GameMakerLanguageParser.RULE_expressionOrFunction = 34;
GameMakerLanguageParser.RULE_expression = 35;
GameMakerLanguageParser.RULE_callStatement = 36;
GameMakerLanguageParser.RULE_implicitCallStatement = 37;
GameMakerLanguageParser.RULE_callableExpression = 38;
GameMakerLanguageParser.RULE_preIncDecExpression = 39;
GameMakerLanguageParser.RULE_postIncDecExpression = 40;
GameMakerLanguageParser.RULE_incDecStatement = 41;
GameMakerLanguageParser.RULE_accessor = 42;
GameMakerLanguageParser.RULE_arguments = 43;
GameMakerLanguageParser.RULE_argumentList = 44;
GameMakerLanguageParser.RULE_argument = 45;
GameMakerLanguageParser.RULE_trailingComma = 46;
GameMakerLanguageParser.RULE_assignmentOperator = 47;
GameMakerLanguageParser.RULE_literal = 48;
GameMakerLanguageParser.RULE_templateStringLiteral = 49;
GameMakerLanguageParser.RULE_templateStringAtom = 50;
GameMakerLanguageParser.RULE_arrayLiteral = 51;
GameMakerLanguageParser.RULE_elementList = 52;
GameMakerLanguageParser.RULE_structLiteral = 53;
GameMakerLanguageParser.RULE_structItem = 54;
GameMakerLanguageParser.RULE_propertyAssignment = 55;
GameMakerLanguageParser.RULE_propertyIdentifier = 56;
GameMakerLanguageParser.RULE_functionDeclaration = 57;
GameMakerLanguageParser.RULE_constructorClause = 58;
GameMakerLanguageParser.RULE_parameterList = 59;
GameMakerLanguageParser.RULE_parameterArgument = 60;
GameMakerLanguageParser.RULE_identifier = 61;
GameMakerLanguageParser.RULE_enumeratorDeclaration = 62;
GameMakerLanguageParser.RULE_enumeratorList = 63;
GameMakerLanguageParser.RULE_enumeratorItem = 64;
GameMakerLanguageParser.RULE_enumerator = 65;
GameMakerLanguageParser.RULE_macroStatement = 66;
GameMakerLanguageParser.RULE_defineStatement = 67;
GameMakerLanguageParser.RULE_regionStatement = 68;
GameMakerLanguageParser.RULE_identifierStatement = 69;
GameMakerLanguageParser.RULE_softKeyword = 70;
GameMakerLanguageParser.RULE_propertySoftKeyword = 71;
GameMakerLanguageParser.RULE_openBlock = 72;
GameMakerLanguageParser.RULE_closeBlock = 73;
GameMakerLanguageParser.RULE_eos = 74;
GameMakerLanguageParser.RULE_macroToken = 75;

class ProgramContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_program;
    }

	EOF() {
	    return this.getToken(GameMakerLanguageParser.EOF, 0);
	};

	statementList() {
	    return this.getTypedRuleContext(StatementListContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterProgram(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitProgram(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitProgram(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class StatementListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_statementList;
    }

	statement = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(StatementContext);
	    } else {
	        return this.getTypedRuleContext(StatementContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterStatementList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitStatementList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitStatementList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class StatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_statement;
    }

	block() {
	    return this.getTypedRuleContext(BlockContext,0);
	};

	emptyStatement() {
	    return this.getTypedRuleContext(EmptyStatementContext,0);
	};

	ifStatement() {
	    return this.getTypedRuleContext(IfStatementContext,0);
	};

	variableDeclarationList() {
	    return this.getTypedRuleContext(VariableDeclarationListContext,0);
	};

	iterationStatement() {
	    return this.getTypedRuleContext(IterationStatementContext,0);
	};

	continueStatement() {
	    return this.getTypedRuleContext(ContinueStatementContext,0);
	};

	breakStatement() {
	    return this.getTypedRuleContext(BreakStatementContext,0);
	};

	returnStatement() {
	    return this.getTypedRuleContext(ReturnStatementContext,0);
	};

	withStatement() {
	    return this.getTypedRuleContext(WithStatementContext,0);
	};

	switchStatement() {
	    return this.getTypedRuleContext(SwitchStatementContext,0);
	};

	tryStatement() {
	    return this.getTypedRuleContext(TryStatementContext,0);
	};

	throwStatement() {
	    return this.getTypedRuleContext(ThrowStatementContext,0);
	};

	exitStatement() {
	    return this.getTypedRuleContext(ExitStatementContext,0);
	};

	macroStatement() {
	    return this.getTypedRuleContext(MacroStatementContext,0);
	};

	defineStatement() {
	    return this.getTypedRuleContext(DefineStatementContext,0);
	};

	regionStatement() {
	    return this.getTypedRuleContext(RegionStatementContext,0);
	};

	enumeratorDeclaration() {
	    return this.getTypedRuleContext(EnumeratorDeclarationContext,0);
	};

	globalVarStatement() {
	    return this.getTypedRuleContext(GlobalVarStatementContext,0);
	};

	implicitCallStatement() {
	    return this.getTypedRuleContext(ImplicitCallStatementContext,0);
	};

	assignmentExpression() {
	    return this.getTypedRuleContext(AssignmentExpressionContext,0);
	};

	incDecStatement() {
	    return this.getTypedRuleContext(IncDecStatementContext,0);
	};

	callStatement() {
	    return this.getTypedRuleContext(CallStatementContext,0);
	};

	functionDeclaration() {
	    return this.getTypedRuleContext(FunctionDeclarationContext,0);
	};

	deleteStatement() {
	    return this.getTypedRuleContext(DeleteStatementContext,0);
	};

	literalStatement() {
	    return this.getTypedRuleContext(LiteralStatementContext,0);
	};

	identifierStatement() {
	    return this.getTypedRuleContext(IdentifierStatementContext,0);
	};

	eos() {
	    return this.getTypedRuleContext(EosContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class BlockContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_block;
    }

	openBlock() {
	    return this.getTypedRuleContext(OpenBlockContext,0);
	};

	closeBlock() {
	    return this.getTypedRuleContext(CloseBlockContext,0);
	};

	statementList() {
	    return this.getTypedRuleContext(StatementListContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterBlock(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitBlock(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitBlock(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class IfStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_ifStatement;
    }

	If() {
	    return this.getToken(GameMakerLanguageParser.If, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	statement = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(StatementContext);
	    } else {
	        return this.getTypedRuleContext(StatementContext,i);
	    }
	};

	Then() {
	    return this.getToken(GameMakerLanguageParser.Then, 0);
	};

	Else() {
	    return this.getToken(GameMakerLanguageParser.Else, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIfStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIfStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIfStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class IterationStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_iterationStatement;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class DoStatementContext extends IterationStatementContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Do() {
	    return this.getToken(GameMakerLanguageParser.Do, 0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	Until() {
	    return this.getToken(GameMakerLanguageParser.Until, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterDoStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitDoStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitDoStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.DoStatementContext = DoStatementContext;

class WhileStatementContext extends IterationStatementContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	While() {
	    return this.getToken(GameMakerLanguageParser.While, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterWhileStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitWhileStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitWhileStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.WhileStatementContext = WhileStatementContext;

class ForStatementContext extends IterationStatementContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	For() {
	    return this.getToken(GameMakerLanguageParser.For, 0);
	};

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	SemiColon = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.SemiColon);
	    } else {
	        return this.getToken(GameMakerLanguageParser.SemiColon, i);
	    }
	};


	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	statement = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(StatementContext);
	    } else {
	        return this.getTypedRuleContext(StatementContext,i);
	    }
	};

	variableDeclarationList() {
	    return this.getTypedRuleContext(VariableDeclarationListContext,0);
	};

	assignmentExpression() {
	    return this.getTypedRuleContext(AssignmentExpressionContext,0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterForStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitForStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitForStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.ForStatementContext = ForStatementContext;

class RepeatStatementContext extends IterationStatementContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Repeat() {
	    return this.getToken(GameMakerLanguageParser.Repeat, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterRepeatStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitRepeatStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitRepeatStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.RepeatStatementContext = RepeatStatementContext;

class WithStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_withStatement;
    }

	With() {
	    return this.getToken(GameMakerLanguageParser.With, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterWithStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitWithStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitWithStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class SwitchStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_switchStatement;
    }

	Switch() {
	    return this.getToken(GameMakerLanguageParser.Switch, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	caseBlock() {
	    return this.getTypedRuleContext(CaseBlockContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterSwitchStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitSwitchStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitSwitchStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ContinueStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_continueStatement;
    }

	Continue() {
	    return this.getToken(GameMakerLanguageParser.Continue, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterContinueStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitContinueStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitContinueStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class BreakStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_breakStatement;
    }

	Break() {
	    return this.getToken(GameMakerLanguageParser.Break, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterBreakStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitBreakStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitBreakStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ExitStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_exitStatement;
    }

	Exit() {
	    return this.getToken(GameMakerLanguageParser.Exit, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterExitStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitExitStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitExitStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EmptyStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_emptyStatement;
    }

	SemiColon() {
	    return this.getToken(GameMakerLanguageParser.SemiColon, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEmptyStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEmptyStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEmptyStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CaseBlockContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_caseBlock;
    }

	openBlock() {
	    return this.getTypedRuleContext(OpenBlockContext,0);
	};

	closeBlock() {
	    return this.getTypedRuleContext(CloseBlockContext,0);
	};

	caseClause = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(CaseClauseContext);
	    } else {
	        return this.getTypedRuleContext(CaseClauseContext,i);
	    }
	};

	defaultClause = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(DefaultClauseContext);
	    } else {
	        return this.getTypedRuleContext(DefaultClauseContext,i);
	    }
	};

	regionStatement = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(RegionStatementContext);
	    } else {
	        return this.getTypedRuleContext(RegionStatementContext,i);
	    }
	};

	macroStatement = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(MacroStatementContext);
	    } else {
	        return this.getTypedRuleContext(MacroStatementContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCaseBlock(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCaseBlock(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCaseBlock(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CaseClausesContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_caseClauses;
    }

	caseClause = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(CaseClauseContext);
	    } else {
	        return this.getTypedRuleContext(CaseClauseContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCaseClauses(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCaseClauses(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCaseClauses(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CaseClauseContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_caseClause;
    }

	Case() {
	    return this.getToken(GameMakerLanguageParser.Case, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	statementList() {
	    return this.getTypedRuleContext(StatementListContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCaseClause(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCaseClause(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCaseClause(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class DefaultClauseContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_defaultClause;
    }

	Default() {
	    return this.getToken(GameMakerLanguageParser.Default, 0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	statementList() {
	    return this.getTypedRuleContext(StatementListContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterDefaultClause(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitDefaultClause(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitDefaultClause(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ThrowStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_throwStatement;
    }

	Throw() {
	    return this.getToken(GameMakerLanguageParser.Throw, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterThrowStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitThrowStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitThrowStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class TryStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_tryStatement;
    }

	Try() {
	    return this.getToken(GameMakerLanguageParser.Try, 0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	catchProduction() {
	    return this.getTypedRuleContext(CatchProductionContext,0);
	};

	finallyProduction() {
	    return this.getTypedRuleContext(FinallyProductionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterTryStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitTryStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitTryStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CatchProductionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_catchProduction;
    }

	Catch() {
	    return this.getToken(GameMakerLanguageParser.Catch, 0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCatchProduction(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCatchProduction(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCatchProduction(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class FinallyProductionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_finallyProduction;
    }

	Finally() {
	    return this.getToken(GameMakerLanguageParser.Finally, 0);
	};

	statement() {
	    return this.getTypedRuleContext(StatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterFinallyProduction(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitFinallyProduction(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitFinallyProduction(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ReturnStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_returnStatement;
    }

	Return() {
	    return this.getToken(GameMakerLanguageParser.Return, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterReturnStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitReturnStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitReturnStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class DeleteStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_deleteStatement;
    }

	Delete() {
	    return this.getToken(GameMakerLanguageParser.Delete, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterDeleteStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitDeleteStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitDeleteStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class LiteralStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_literalStatement;
    }

	literal() {
	    return this.getTypedRuleContext(LiteralContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterLiteralStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitLiteralStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitLiteralStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class AssignmentExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_assignmentExpression;
    }

	lValueExpression() {
	    return this.getTypedRuleContext(LValueExpressionContext,0);
	};

	assignmentOperator() {
	    return this.getTypedRuleContext(AssignmentOperatorContext,0);
	};

	expressionOrFunction() {
	    return this.getTypedRuleContext(ExpressionOrFunctionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterAssignmentExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitAssignmentExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitAssignmentExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class VariableDeclarationListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_variableDeclarationList;
    }

	varModifier() {
	    return this.getTypedRuleContext(VarModifierContext,0);
	};

	variableDeclaration = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(VariableDeclarationContext);
	    } else {
	        return this.getTypedRuleContext(VariableDeclarationContext,i);
	    }
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterVariableDeclarationList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitVariableDeclarationList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitVariableDeclarationList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class VarModifierContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_varModifier;
    }

	Var = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Var);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Var, i);
	    }
	};


	Static() {
	    return this.getToken(GameMakerLanguageParser.Static, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterVarModifier(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitVarModifier(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitVarModifier(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class VariableDeclarationContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_variableDeclaration;
    }

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	expressionOrFunction() {
	    return this.getTypedRuleContext(ExpressionOrFunctionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterVariableDeclaration(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitVariableDeclaration(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitVariableDeclaration(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class GlobalVarStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_globalVarStatement;
    }

	GlobalVar() {
	    return this.getToken(GameMakerLanguageParser.GlobalVar, 0);
	};

	identifier = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(IdentifierContext);
	    } else {
	        return this.getTypedRuleContext(IdentifierContext,i);
	    }
	};

	SemiColon() {
	    return this.getToken(GameMakerLanguageParser.SemiColon, 0);
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterGlobalVarStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitGlobalVarStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitGlobalVarStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class NewExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_newExpression;
    }

	New() {
	    return this.getToken(GameMakerLanguageParser.New, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	arguments() {
	    return this.getTypedRuleContext(ArgumentsContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterNewExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitNewExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitNewExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class LValueStartExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_lValueStartExpression;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class ImplicitMemberDotLValueContext extends LValueStartExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Dot() {
	    return this.getToken(GameMakerLanguageParser.Dot, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterImplicitMemberDotLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitImplicitMemberDotLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitImplicitMemberDotLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.ImplicitMemberDotLValueContext = ImplicitMemberDotLValueContext;

class NewLValueContext extends LValueStartExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	newExpression() {
	    return this.getTypedRuleContext(NewExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterNewLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitNewLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitNewLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.NewLValueContext = NewLValueContext;

class ParenthesizedLValueContext extends LValueStartExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterParenthesizedLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitParenthesizedLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitParenthesizedLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.ParenthesizedLValueContext = ParenthesizedLValueContext;

class StructLiteralLValueContext extends LValueStartExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	structLiteral() {
	    return this.getTypedRuleContext(StructLiteralContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterStructLiteralLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitStructLiteralLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitStructLiteralLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.StructLiteralLValueContext = StructLiteralLValueContext;

class IdentifierLValueContext extends LValueStartExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIdentifierLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIdentifierLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIdentifierLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.IdentifierLValueContext = IdentifierLValueContext;

class LValueExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_lValueExpression;
    }

	lValueStartExpression() {
	    return this.getTypedRuleContext(LValueStartExpressionContext,0);
	};

	lValueFinalOperator() {
	    return this.getTypedRuleContext(LValueFinalOperatorContext,0);
	};

	lValueChainOperator = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(LValueChainOperatorContext);
	    } else {
	        return this.getTypedRuleContext(LValueChainOperatorContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterLValueExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitLValueExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitLValueExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class LValueChainOperatorContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_lValueChainOperator;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class MemberDotLValueContext extends LValueChainOperatorContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Dot() {
	    return this.getToken(GameMakerLanguageParser.Dot, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMemberDotLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMemberDotLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMemberDotLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.MemberDotLValueContext = MemberDotLValueContext;

class CallLValueContext extends LValueChainOperatorContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	arguments() {
	    return this.getTypedRuleContext(ArgumentsContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCallLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCallLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCallLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.CallLValueContext = CallLValueContext;

class MemberIndexLValueContext extends LValueChainOperatorContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	accessor() {
	    return this.getTypedRuleContext(AccessorContext,0);
	};

	expressionSequence() {
	    return this.getTypedRuleContext(ExpressionSequenceContext,0);
	};

	CloseBracket() {
	    return this.getToken(GameMakerLanguageParser.CloseBracket, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMemberIndexLValue(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMemberIndexLValue(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMemberIndexLValue(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.MemberIndexLValueContext = MemberIndexLValueContext;

class LValueFinalOperatorContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_lValueFinalOperator;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class MemberDotLValueFinalContext extends LValueFinalOperatorContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Dot() {
	    return this.getToken(GameMakerLanguageParser.Dot, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMemberDotLValueFinal(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMemberDotLValueFinal(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMemberDotLValueFinal(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.MemberDotLValueFinalContext = MemberDotLValueFinalContext;

class MemberIndexLValueFinalContext extends LValueFinalOperatorContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	accessor() {
	    return this.getTypedRuleContext(AccessorContext,0);
	};

	expressionSequence() {
	    return this.getTypedRuleContext(ExpressionSequenceContext,0);
	};

	CloseBracket() {
	    return this.getToken(GameMakerLanguageParser.CloseBracket, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMemberIndexLValueFinal(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMemberIndexLValueFinal(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMemberIndexLValueFinal(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.MemberIndexLValueFinalContext = MemberIndexLValueFinalContext;

class ExpressionSequenceContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_expressionSequence;
    }

	expression = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ExpressionContext);
	    } else {
	        return this.getTypedRuleContext(ExpressionContext,i);
	    }
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterExpressionSequence(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitExpressionSequence(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitExpressionSequence(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ExpressionOrFunctionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_expressionOrFunction;
    }

	assignmentExpression() {
	    return this.getTypedRuleContext(AssignmentExpressionContext,0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	functionDeclaration() {
	    return this.getTypedRuleContext(FunctionDeclarationContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterExpressionOrFunction(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitExpressionOrFunction(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitExpressionOrFunction(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_expression;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class TernaryExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	expression = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ExpressionContext);
	    } else {
	        return this.getTypedRuleContext(ExpressionContext,i);
	    }
	};

	QuestionMark() {
	    return this.getToken(GameMakerLanguageParser.QuestionMark, 0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterTernaryExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitTernaryExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitTernaryExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.TernaryExpressionContext = TernaryExpressionContext;

class FunctionExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	functionDeclaration() {
	    return this.getTypedRuleContext(FunctionDeclarationContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterFunctionExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitFunctionExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitFunctionExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.FunctionExpressionContext = FunctionExpressionContext;

class UnaryMinusExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Minus() {
	    return this.getToken(GameMakerLanguageParser.Minus, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterUnaryMinusExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitUnaryMinusExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitUnaryMinusExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.UnaryMinusExpressionContext = UnaryMinusExpressionContext;

class BitNotExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	BitNot() {
	    return this.getToken(GameMakerLanguageParser.BitNot, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterBitNotExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitBitNotExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitBitNotExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.BitNotExpressionContext = BitNotExpressionContext;

class BinaryExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	expression = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ExpressionContext);
	    } else {
	        return this.getTypedRuleContext(ExpressionContext,i);
	    }
	};

	Multiply() {
	    return this.getToken(GameMakerLanguageParser.Multiply, 0);
	};

	Divide() {
	    return this.getToken(GameMakerLanguageParser.Divide, 0);
	};

	IntegerDivide() {
	    return this.getToken(GameMakerLanguageParser.IntegerDivide, 0);
	};

	Modulo() {
	    return this.getToken(GameMakerLanguageParser.Modulo, 0);
	};

	Plus() {
	    return this.getToken(GameMakerLanguageParser.Plus, 0);
	};

	Minus() {
	    return this.getToken(GameMakerLanguageParser.Minus, 0);
	};

	LeftShiftArithmetic() {
	    return this.getToken(GameMakerLanguageParser.LeftShiftArithmetic, 0);
	};

	RightShiftArithmetic() {
	    return this.getToken(GameMakerLanguageParser.RightShiftArithmetic, 0);
	};

	BitAnd() {
	    return this.getToken(GameMakerLanguageParser.BitAnd, 0);
	};

	BitXOr() {
	    return this.getToken(GameMakerLanguageParser.BitXOr, 0);
	};

	BitOr() {
	    return this.getToken(GameMakerLanguageParser.BitOr, 0);
	};

	Equals() {
	    return this.getToken(GameMakerLanguageParser.Equals, 0);
	};

	NotEquals() {
	    return this.getToken(GameMakerLanguageParser.NotEquals, 0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	LessThan() {
	    return this.getToken(GameMakerLanguageParser.LessThan, 0);
	};

	MoreThan() {
	    return this.getToken(GameMakerLanguageParser.MoreThan, 0);
	};

	LessThanEquals() {
	    return this.getToken(GameMakerLanguageParser.LessThanEquals, 0);
	};

	GreaterThanEquals() {
	    return this.getToken(GameMakerLanguageParser.GreaterThanEquals, 0);
	};

	NullCoalesce() {
	    return this.getToken(GameMakerLanguageParser.NullCoalesce, 0);
	};

	And() {
	    return this.getToken(GameMakerLanguageParser.And, 0);
	};

	Or() {
	    return this.getToken(GameMakerLanguageParser.Or, 0);
	};

	Xor() {
	    return this.getToken(GameMakerLanguageParser.Xor, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterBinaryExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitBinaryExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitBinaryExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.BinaryExpressionContext = BinaryExpressionContext;

class LiteralExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	literal() {
	    return this.getTypedRuleContext(LiteralContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterLiteralExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitLiteralExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitLiteralExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.LiteralExpressionContext = LiteralExpressionContext;

class UnaryPlusExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Plus() {
	    return this.getToken(GameMakerLanguageParser.Plus, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterUnaryPlusExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitUnaryPlusExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitUnaryPlusExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.UnaryPlusExpressionContext = UnaryPlusExpressionContext;

class NotExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	Not() {
	    return this.getToken(GameMakerLanguageParser.Not, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterNotExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitNotExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitNotExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.NotExpressionContext = NotExpressionContext;

class VariableExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	lValueExpression() {
	    return this.getTypedRuleContext(LValueExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterVariableExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitVariableExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitVariableExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.VariableExpressionContext = VariableExpressionContext;

class IncDecExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	preIncDecExpression() {
	    return this.getTypedRuleContext(PreIncDecExpressionContext,0);
	};

	postIncDecExpression() {
	    return this.getTypedRuleContext(PostIncDecExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIncDecExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIncDecExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIncDecExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.IncDecExpressionContext = IncDecExpressionContext;

class CallExpressionContext extends ExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	callStatement() {
	    return this.getTypedRuleContext(CallStatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCallExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCallExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCallExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.CallExpressionContext = CallExpressionContext;

class CallStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_callStatement;
    }

	callableExpression() {
	    return this.getTypedRuleContext(CallableExpressionContext,0);
	};

	arguments() {
	    return this.getTypedRuleContext(ArgumentsContext,0);
	};

	callStatement() {
	    return this.getTypedRuleContext(CallStatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCallStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCallStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCallStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ImplicitCallStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_implicitCallStatement;
    }

	Dot() {
	    return this.getToken(GameMakerLanguageParser.Dot, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	arguments() {
	    return this.getTypedRuleContext(ArgumentsContext,0);
	};

	implicitCallStatement() {
	    return this.getTypedRuleContext(ImplicitCallStatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterImplicitCallStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitImplicitCallStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitImplicitCallStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CallableExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_callableExpression;
    }

	lValueExpression() {
	    return this.getTypedRuleContext(LValueExpressionContext,0);
	};

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	functionDeclaration() {
	    return this.getTypedRuleContext(FunctionDeclarationContext,0);
	};

	callableExpression() {
	    return this.getTypedRuleContext(CallableExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCallableExpression(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCallableExpression(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCallableExpression(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class PreIncDecExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_preIncDecExpression;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class PreIncDecStatementContext extends PreIncDecExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	lValueExpression() {
	    return this.getTypedRuleContext(LValueExpressionContext,0);
	};

	PlusPlus() {
	    return this.getToken(GameMakerLanguageParser.PlusPlus, 0);
	};

	MinusMinus() {
	    return this.getToken(GameMakerLanguageParser.MinusMinus, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterPreIncDecStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitPreIncDecStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitPreIncDecStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.PreIncDecStatementContext = PreIncDecStatementContext;

class PostIncDecExpressionContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_postIncDecExpression;
    }


	 
		copyFrom(ctx) {
			super.copyFrom(ctx);
		}

}


class PostIncDecStatementContext extends PostIncDecExpressionContext {

    constructor(parser, ctx) {
        super(parser);
        super.copyFrom(ctx);
    }

	lValueExpression() {
	    return this.getTypedRuleContext(LValueExpressionContext,0);
	};

	PlusPlus() {
	    return this.getToken(GameMakerLanguageParser.PlusPlus, 0);
	};

	MinusMinus() {
	    return this.getToken(GameMakerLanguageParser.MinusMinus, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterPostIncDecStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitPostIncDecStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitPostIncDecStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}

GameMakerLanguageParser.PostIncDecStatementContext = PostIncDecStatementContext;

class IncDecStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_incDecStatement;
    }

	postIncDecExpression() {
	    return this.getTypedRuleContext(PostIncDecExpressionContext,0);
	};

	preIncDecExpression() {
	    return this.getTypedRuleContext(PreIncDecExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIncDecStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIncDecStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIncDecStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class AccessorContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_accessor;
    }

	OpenBracket() {
	    return this.getToken(GameMakerLanguageParser.OpenBracket, 0);
	};

	ListAccessor() {
	    return this.getToken(GameMakerLanguageParser.ListAccessor, 0);
	};

	MapAccessor() {
	    return this.getToken(GameMakerLanguageParser.MapAccessor, 0);
	};

	GridAccessor() {
	    return this.getToken(GameMakerLanguageParser.GridAccessor, 0);
	};

	ArrayAccessor() {
	    return this.getToken(GameMakerLanguageParser.ArrayAccessor, 0);
	};

	StructAccessor() {
	    return this.getToken(GameMakerLanguageParser.StructAccessor, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterAccessor(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitAccessor(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitAccessor(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ArgumentsContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_arguments;
    }

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	argumentList() {
	    return this.getTypedRuleContext(ArgumentListContext,0);
	};

	trailingComma() {
	    return this.getTypedRuleContext(TrailingCommaContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterArguments(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitArguments(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitArguments(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ArgumentListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_argumentList;
    }

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	argument = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ArgumentContext);
	    } else {
	        return this.getTypedRuleContext(ArgumentContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterArgumentList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitArgumentList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitArgumentList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ArgumentContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_argument;
    }

	expressionOrFunction() {
	    return this.getTypedRuleContext(ExpressionOrFunctionContext,0);
	};

	UndefinedLiteral() {
	    return this.getToken(GameMakerLanguageParser.UndefinedLiteral, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterArgument(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitArgument(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitArgument(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class TrailingCommaContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_trailingComma;
    }

	Comma() {
	    return this.getToken(GameMakerLanguageParser.Comma, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterTrailingComma(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitTrailingComma(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitTrailingComma(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class AssignmentOperatorContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_assignmentOperator;
    }

	MultiplyAssign() {
	    return this.getToken(GameMakerLanguageParser.MultiplyAssign, 0);
	};

	DivideAssign() {
	    return this.getToken(GameMakerLanguageParser.DivideAssign, 0);
	};

	ModulusAssign() {
	    return this.getToken(GameMakerLanguageParser.ModulusAssign, 0);
	};

	PlusAssign() {
	    return this.getToken(GameMakerLanguageParser.PlusAssign, 0);
	};

	MinusAssign() {
	    return this.getToken(GameMakerLanguageParser.MinusAssign, 0);
	};

	LeftShiftArithmeticAssign() {
	    return this.getToken(GameMakerLanguageParser.LeftShiftArithmeticAssign, 0);
	};

	RightShiftArithmeticAssign() {
	    return this.getToken(GameMakerLanguageParser.RightShiftArithmeticAssign, 0);
	};

	BitAndAssign() {
	    return this.getToken(GameMakerLanguageParser.BitAndAssign, 0);
	};

	BitXorAssign() {
	    return this.getToken(GameMakerLanguageParser.BitXorAssign, 0);
	};

	BitOrAssign() {
	    return this.getToken(GameMakerLanguageParser.BitOrAssign, 0);
	};

	NullCoalescingAssign() {
	    return this.getToken(GameMakerLanguageParser.NullCoalescingAssign, 0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterAssignmentOperator(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitAssignmentOperator(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitAssignmentOperator(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class LiteralContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_literal;
    }

	UndefinedLiteral() {
	    return this.getToken(GameMakerLanguageParser.UndefinedLiteral, 0);
	};

	NoOneLiteral() {
	    return this.getToken(GameMakerLanguageParser.NoOneLiteral, 0);
	};

	BooleanLiteral() {
	    return this.getToken(GameMakerLanguageParser.BooleanLiteral, 0);
	};

	StringLiteral() {
	    return this.getToken(GameMakerLanguageParser.StringLiteral, 0);
	};

	VerbatimStringLiteral() {
	    return this.getToken(GameMakerLanguageParser.VerbatimStringLiteral, 0);
	};

	templateStringLiteral() {
	    return this.getTypedRuleContext(TemplateStringLiteralContext,0);
	};

	HexIntegerLiteral() {
	    return this.getToken(GameMakerLanguageParser.HexIntegerLiteral, 0);
	};

	BinaryLiteral() {
	    return this.getToken(GameMakerLanguageParser.BinaryLiteral, 0);
	};

	DecimalLiteral() {
	    return this.getToken(GameMakerLanguageParser.DecimalLiteral, 0);
	};

	IntegerLiteral() {
	    return this.getToken(GameMakerLanguageParser.IntegerLiteral, 0);
	};

	arrayLiteral() {
	    return this.getTypedRuleContext(ArrayLiteralContext,0);
	};

	structLiteral() {
	    return this.getTypedRuleContext(StructLiteralContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterLiteral(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitLiteral(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitLiteral(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class TemplateStringLiteralContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_templateStringLiteral;
    }

	TemplateStringStart() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringStart, 0);
	};

	TemplateStringEnd() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringEnd, 0);
	};

	templateStringAtom = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(TemplateStringAtomContext);
	    } else {
	        return this.getTypedRuleContext(TemplateStringAtomContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterTemplateStringLiteral(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitTemplateStringLiteral(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitTemplateStringLiteral(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class TemplateStringAtomContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_templateStringAtom;
    }

	TemplateStringText() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringText, 0);
	};

	TemplateStringStartExpression() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringStartExpression, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	TemplateStringEndExpression() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringEndExpression, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterTemplateStringAtom(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitTemplateStringAtom(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitTemplateStringAtom(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ArrayLiteralContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_arrayLiteral;
    }

	OpenBracket() {
	    return this.getToken(GameMakerLanguageParser.OpenBracket, 0);
	};

	elementList() {
	    return this.getTypedRuleContext(ElementListContext,0);
	};

	CloseBracket() {
	    return this.getToken(GameMakerLanguageParser.CloseBracket, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterArrayLiteral(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitArrayLiteral(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitArrayLiteral(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ElementListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_elementList;
    }

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	expressionOrFunction = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ExpressionOrFunctionContext);
	    } else {
	        return this.getTypedRuleContext(ExpressionOrFunctionContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterElementList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitElementList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitElementList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class StructLiteralContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_structLiteral;
    }

	openBlock() {
	    return this.getTypedRuleContext(OpenBlockContext,0);
	};

	closeBlock() {
	    return this.getTypedRuleContext(CloseBlockContext,0);
	};

	structItem = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(StructItemContext);
	    } else {
	        return this.getTypedRuleContext(StructItemContext,i);
	    }
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterStructLiteral(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitStructLiteral(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitStructLiteral(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class StructItemContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_structItem;
    }

	propertyAssignment() {
	    return this.getTypedRuleContext(PropertyAssignmentContext,0);
	};

	regionStatement() {
	    return this.getTypedRuleContext(RegionStatementContext,0);
	};

	macroStatement() {
	    return this.getTypedRuleContext(MacroStatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterStructItem(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitStructItem(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitStructItem(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class PropertyAssignmentContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_propertyAssignment;
    }

	propertyIdentifier() {
	    return this.getTypedRuleContext(PropertyIdentifierContext,0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	expressionOrFunction() {
	    return this.getTypedRuleContext(ExpressionOrFunctionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterPropertyAssignment(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitPropertyAssignment(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitPropertyAssignment(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class PropertyIdentifierContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_propertyIdentifier;
    }

	Identifier() {
	    return this.getToken(GameMakerLanguageParser.Identifier, 0);
	};

	softKeyword() {
	    return this.getTypedRuleContext(SoftKeywordContext,0);
	};

	propertySoftKeyword() {
	    return this.getTypedRuleContext(PropertySoftKeywordContext,0);
	};

	StringLiteral() {
	    return this.getToken(GameMakerLanguageParser.StringLiteral, 0);
	};

	VerbatimStringLiteral() {
	    return this.getToken(GameMakerLanguageParser.VerbatimStringLiteral, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterPropertyIdentifier(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitPropertyIdentifier(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitPropertyIdentifier(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class FunctionDeclarationContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_functionDeclaration;
    }

	Function_() {
	    return this.getToken(GameMakerLanguageParser.Function_, 0);
	};

	parameterList() {
	    return this.getTypedRuleContext(ParameterListContext,0);
	};

	block() {
	    return this.getTypedRuleContext(BlockContext,0);
	};

	Identifier() {
	    return this.getToken(GameMakerLanguageParser.Identifier, 0);
	};

	constructorClause() {
	    return this.getTypedRuleContext(ConstructorClauseContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterFunctionDeclaration(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitFunctionDeclaration(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitFunctionDeclaration(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ConstructorClauseContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_constructorClause;
    }

	Constructor() {
	    return this.getToken(GameMakerLanguageParser.Constructor, 0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	Identifier() {
	    return this.getToken(GameMakerLanguageParser.Identifier, 0);
	};

	arguments() {
	    return this.getTypedRuleContext(ArgumentsContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterConstructorClause(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitConstructorClause(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitConstructorClause(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ParameterListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_parameterList;
    }

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	parameterArgument = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(ParameterArgumentContext);
	    } else {
	        return this.getTypedRuleContext(ParameterArgumentContext,i);
	    }
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterParameterList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitParameterList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitParameterList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class ParameterArgumentContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_parameterArgument;
    }

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	expressionOrFunction() {
	    return this.getTypedRuleContext(ExpressionOrFunctionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterParameterArgument(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitParameterArgument(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitParameterArgument(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class IdentifierContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_identifier;
    }

	Identifier() {
	    return this.getToken(GameMakerLanguageParser.Identifier, 0);
	};

	softKeyword() {
	    return this.getTypedRuleContext(SoftKeywordContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIdentifier(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIdentifier(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIdentifier(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EnumeratorDeclarationContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_enumeratorDeclaration;
    }

	Enum() {
	    return this.getToken(GameMakerLanguageParser.Enum, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	openBlock() {
	    return this.getTypedRuleContext(OpenBlockContext,0);
	};

	closeBlock() {
	    return this.getTypedRuleContext(CloseBlockContext,0);
	};

	enumeratorList() {
	    return this.getTypedRuleContext(EnumeratorListContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEnumeratorDeclaration(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEnumeratorDeclaration(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEnumeratorDeclaration(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EnumeratorListContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_enumeratorList;
    }

	enumeratorItem = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(EnumeratorItemContext);
	    } else {
	        return this.getTypedRuleContext(EnumeratorItemContext,i);
	    }
	};

	Comma = function(i) {
		if(i===undefined) {
			i = null;
		}
	    if(i===null) {
	        return this.getTokens(GameMakerLanguageParser.Comma);
	    } else {
	        return this.getToken(GameMakerLanguageParser.Comma, i);
	    }
	};


	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEnumeratorList(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEnumeratorList(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEnumeratorList(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EnumeratorItemContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_enumeratorItem;
    }

	enumerator() {
	    return this.getTypedRuleContext(EnumeratorContext,0);
	};

	regionStatement() {
	    return this.getTypedRuleContext(RegionStatementContext,0);
	};

	macroStatement() {
	    return this.getTypedRuleContext(MacroStatementContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEnumeratorItem(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEnumeratorItem(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEnumeratorItem(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EnumeratorContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_enumerator;
    }

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	expression() {
	    return this.getTypedRuleContext(ExpressionContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEnumerator(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEnumerator(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEnumerator(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class MacroStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_macroStatement;
    }

	Macro() {
	    return this.getToken(GameMakerLanguageParser.Macro, 0);
	};

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	LineTerminator() {
	    return this.getToken(GameMakerLanguageParser.LineTerminator, 0);
	};

	EOF() {
	    return this.getToken(GameMakerLanguageParser.EOF, 0);
	};

	macroToken = function(i) {
	    if(i===undefined) {
	        i = null;
	    }
	    if(i===null) {
	        return this.getTypedRuleContexts(MacroTokenContext);
	    } else {
	        return this.getTypedRuleContext(MacroTokenContext,i);
	    }
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMacroStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMacroStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMacroStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class DefineStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_defineStatement;
    }

	Define() {
	    return this.getToken(GameMakerLanguageParser.Define, 0);
	};

	RegionCharacters() {
	    return this.getToken(GameMakerLanguageParser.RegionCharacters, 0);
	};

	RegionEOL() {
	    return this.getToken(GameMakerLanguageParser.RegionEOL, 0);
	};

	EOF() {
	    return this.getToken(GameMakerLanguageParser.EOF, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterDefineStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitDefineStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitDefineStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class RegionStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_regionStatement;
    }

	Region() {
	    return this.getToken(GameMakerLanguageParser.Region, 0);
	};

	EndRegion() {
	    return this.getToken(GameMakerLanguageParser.EndRegion, 0);
	};

	RegionEOL() {
	    return this.getToken(GameMakerLanguageParser.RegionEOL, 0);
	};

	EOF() {
	    return this.getToken(GameMakerLanguageParser.EOF, 0);
	};

	RegionCharacters() {
	    return this.getToken(GameMakerLanguageParser.RegionCharacters, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterRegionStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitRegionStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitRegionStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class IdentifierStatementContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_identifierStatement;
    }

	identifier() {
	    return this.getTypedRuleContext(IdentifierContext,0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterIdentifierStatement(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitIdentifierStatement(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitIdentifierStatement(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class SoftKeywordContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_softKeyword;
    }

	Constructor() {
	    return this.getToken(GameMakerLanguageParser.Constructor, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterSoftKeyword(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitSoftKeyword(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitSoftKeyword(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class PropertySoftKeywordContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_propertySoftKeyword;
    }

	NoOneLiteral() {
	    return this.getToken(GameMakerLanguageParser.NoOneLiteral, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterPropertySoftKeyword(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitPropertySoftKeyword(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitPropertySoftKeyword(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class OpenBlockContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_openBlock;
    }

	OpenBrace() {
	    return this.getToken(GameMakerLanguageParser.OpenBrace, 0);
	};

	Begin() {
	    return this.getToken(GameMakerLanguageParser.Begin, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterOpenBlock(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitOpenBlock(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitOpenBlock(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class CloseBlockContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_closeBlock;
    }

	CloseBrace() {
	    return this.getToken(GameMakerLanguageParser.CloseBrace, 0);
	};

	End() {
	    return this.getToken(GameMakerLanguageParser.End, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterCloseBlock(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitCloseBlock(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitCloseBlock(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class EosContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_eos;
    }

	SemiColon() {
	    return this.getToken(GameMakerLanguageParser.SemiColon, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterEos(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitEos(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitEos(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}



class MacroTokenContext extends antlr4.ParserRuleContext {

    constructor(parser, parent, invokingState) {
        if(parent===undefined) {
            parent = null;
        }
        if(invokingState===undefined || invokingState===null) {
            invokingState = -1;
        }
        super(parent, invokingState);
        this.parser = parser;
        this.ruleIndex = GameMakerLanguageParser.RULE_macroToken;
    }

	EscapedNewLine() {
	    return this.getToken(GameMakerLanguageParser.EscapedNewLine, 0);
	};

	OpenBracket() {
	    return this.getToken(GameMakerLanguageParser.OpenBracket, 0);
	};

	CloseBracket() {
	    return this.getToken(GameMakerLanguageParser.CloseBracket, 0);
	};

	OpenParen() {
	    return this.getToken(GameMakerLanguageParser.OpenParen, 0);
	};

	CloseParen() {
	    return this.getToken(GameMakerLanguageParser.CloseParen, 0);
	};

	OpenBrace() {
	    return this.getToken(GameMakerLanguageParser.OpenBrace, 0);
	};

	CloseBrace() {
	    return this.getToken(GameMakerLanguageParser.CloseBrace, 0);
	};

	Begin() {
	    return this.getToken(GameMakerLanguageParser.Begin, 0);
	};

	End() {
	    return this.getToken(GameMakerLanguageParser.End, 0);
	};

	SemiColon() {
	    return this.getToken(GameMakerLanguageParser.SemiColon, 0);
	};

	Comma() {
	    return this.getToken(GameMakerLanguageParser.Comma, 0);
	};

	Assign() {
	    return this.getToken(GameMakerLanguageParser.Assign, 0);
	};

	Colon() {
	    return this.getToken(GameMakerLanguageParser.Colon, 0);
	};

	Dot() {
	    return this.getToken(GameMakerLanguageParser.Dot, 0);
	};

	PlusPlus() {
	    return this.getToken(GameMakerLanguageParser.PlusPlus, 0);
	};

	MinusMinus() {
	    return this.getToken(GameMakerLanguageParser.MinusMinus, 0);
	};

	Plus() {
	    return this.getToken(GameMakerLanguageParser.Plus, 0);
	};

	Minus() {
	    return this.getToken(GameMakerLanguageParser.Minus, 0);
	};

	BitNot() {
	    return this.getToken(GameMakerLanguageParser.BitNot, 0);
	};

	Not() {
	    return this.getToken(GameMakerLanguageParser.Not, 0);
	};

	Multiply() {
	    return this.getToken(GameMakerLanguageParser.Multiply, 0);
	};

	Divide() {
	    return this.getToken(GameMakerLanguageParser.Divide, 0);
	};

	IntegerDivide() {
	    return this.getToken(GameMakerLanguageParser.IntegerDivide, 0);
	};

	Modulo() {
	    return this.getToken(GameMakerLanguageParser.Modulo, 0);
	};

	Power() {
	    return this.getToken(GameMakerLanguageParser.Power, 0);
	};

	QuestionMark() {
	    return this.getToken(GameMakerLanguageParser.QuestionMark, 0);
	};

	NullCoalesce() {
	    return this.getToken(GameMakerLanguageParser.NullCoalesce, 0);
	};

	NullCoalescingAssign() {
	    return this.getToken(GameMakerLanguageParser.NullCoalescingAssign, 0);
	};

	RightShiftArithmetic() {
	    return this.getToken(GameMakerLanguageParser.RightShiftArithmetic, 0);
	};

	LeftShiftArithmetic() {
	    return this.getToken(GameMakerLanguageParser.LeftShiftArithmetic, 0);
	};

	LessThan() {
	    return this.getToken(GameMakerLanguageParser.LessThan, 0);
	};

	MoreThan() {
	    return this.getToken(GameMakerLanguageParser.MoreThan, 0);
	};

	LessThanEquals() {
	    return this.getToken(GameMakerLanguageParser.LessThanEquals, 0);
	};

	GreaterThanEquals() {
	    return this.getToken(GameMakerLanguageParser.GreaterThanEquals, 0);
	};

	Equals() {
	    return this.getToken(GameMakerLanguageParser.Equals, 0);
	};

	NotEquals() {
	    return this.getToken(GameMakerLanguageParser.NotEquals, 0);
	};

	BitAnd() {
	    return this.getToken(GameMakerLanguageParser.BitAnd, 0);
	};

	BitXOr() {
	    return this.getToken(GameMakerLanguageParser.BitXOr, 0);
	};

	BitOr() {
	    return this.getToken(GameMakerLanguageParser.BitOr, 0);
	};

	And() {
	    return this.getToken(GameMakerLanguageParser.And, 0);
	};

	Or() {
	    return this.getToken(GameMakerLanguageParser.Or, 0);
	};

	Xor() {
	    return this.getToken(GameMakerLanguageParser.Xor, 0);
	};

	MultiplyAssign() {
	    return this.getToken(GameMakerLanguageParser.MultiplyAssign, 0);
	};

	DivideAssign() {
	    return this.getToken(GameMakerLanguageParser.DivideAssign, 0);
	};

	PlusAssign() {
	    return this.getToken(GameMakerLanguageParser.PlusAssign, 0);
	};

	MinusAssign() {
	    return this.getToken(GameMakerLanguageParser.MinusAssign, 0);
	};

	ModulusAssign() {
	    return this.getToken(GameMakerLanguageParser.ModulusAssign, 0);
	};

	LeftShiftArithmeticAssign() {
	    return this.getToken(GameMakerLanguageParser.LeftShiftArithmeticAssign, 0);
	};

	RightShiftArithmeticAssign() {
	    return this.getToken(GameMakerLanguageParser.RightShiftArithmeticAssign, 0);
	};

	BitAndAssign() {
	    return this.getToken(GameMakerLanguageParser.BitAndAssign, 0);
	};

	BitXorAssign() {
	    return this.getToken(GameMakerLanguageParser.BitXorAssign, 0);
	};

	BitOrAssign() {
	    return this.getToken(GameMakerLanguageParser.BitOrAssign, 0);
	};

	NumberSign() {
	    return this.getToken(GameMakerLanguageParser.NumberSign, 0);
	};

	DollarSign() {
	    return this.getToken(GameMakerLanguageParser.DollarSign, 0);
	};

	AtSign() {
	    return this.getToken(GameMakerLanguageParser.AtSign, 0);
	};

	UndefinedLiteral() {
	    return this.getToken(GameMakerLanguageParser.UndefinedLiteral, 0);
	};

	NoOneLiteral() {
	    return this.getToken(GameMakerLanguageParser.NoOneLiteral, 0);
	};

	BooleanLiteral() {
	    return this.getToken(GameMakerLanguageParser.BooleanLiteral, 0);
	};

	IntegerLiteral() {
	    return this.getToken(GameMakerLanguageParser.IntegerLiteral, 0);
	};

	DecimalLiteral() {
	    return this.getToken(GameMakerLanguageParser.DecimalLiteral, 0);
	};

	BinaryLiteral() {
	    return this.getToken(GameMakerLanguageParser.BinaryLiteral, 0);
	};

	HexIntegerLiteral() {
	    return this.getToken(GameMakerLanguageParser.HexIntegerLiteral, 0);
	};

	Break() {
	    return this.getToken(GameMakerLanguageParser.Break, 0);
	};

	Exit() {
	    return this.getToken(GameMakerLanguageParser.Exit, 0);
	};

	Do() {
	    return this.getToken(GameMakerLanguageParser.Do, 0);
	};

	Case() {
	    return this.getToken(GameMakerLanguageParser.Case, 0);
	};

	Else() {
	    return this.getToken(GameMakerLanguageParser.Else, 0);
	};

	New() {
	    return this.getToken(GameMakerLanguageParser.New, 0);
	};

	Var() {
	    return this.getToken(GameMakerLanguageParser.Var, 0);
	};

	GlobalVar() {
	    return this.getToken(GameMakerLanguageParser.GlobalVar, 0);
	};

	Catch() {
	    return this.getToken(GameMakerLanguageParser.Catch, 0);
	};

	Finally() {
	    return this.getToken(GameMakerLanguageParser.Finally, 0);
	};

	Return() {
	    return this.getToken(GameMakerLanguageParser.Return, 0);
	};

	Continue() {
	    return this.getToken(GameMakerLanguageParser.Continue, 0);
	};

	For() {
	    return this.getToken(GameMakerLanguageParser.For, 0);
	};

	Switch() {
	    return this.getToken(GameMakerLanguageParser.Switch, 0);
	};

	While() {
	    return this.getToken(GameMakerLanguageParser.While, 0);
	};

	Until() {
	    return this.getToken(GameMakerLanguageParser.Until, 0);
	};

	Repeat() {
	    return this.getToken(GameMakerLanguageParser.Repeat, 0);
	};

	Function_() {
	    return this.getToken(GameMakerLanguageParser.Function_, 0);
	};

	With() {
	    return this.getToken(GameMakerLanguageParser.With, 0);
	};

	Default() {
	    return this.getToken(GameMakerLanguageParser.Default, 0);
	};

	If() {
	    return this.getToken(GameMakerLanguageParser.If, 0);
	};

	Then() {
	    return this.getToken(GameMakerLanguageParser.Then, 0);
	};

	Throw() {
	    return this.getToken(GameMakerLanguageParser.Throw, 0);
	};

	Delete() {
	    return this.getToken(GameMakerLanguageParser.Delete, 0);
	};

	Try() {
	    return this.getToken(GameMakerLanguageParser.Try, 0);
	};

	Enum() {
	    return this.getToken(GameMakerLanguageParser.Enum, 0);
	};

	Constructor() {
	    return this.getToken(GameMakerLanguageParser.Constructor, 0);
	};

	Static() {
	    return this.getToken(GameMakerLanguageParser.Static, 0);
	};

	Identifier() {
	    return this.getToken(GameMakerLanguageParser.Identifier, 0);
	};

	StringLiteral() {
	    return this.getToken(GameMakerLanguageParser.StringLiteral, 0);
	};

	VerbatimStringLiteral() {
	    return this.getToken(GameMakerLanguageParser.VerbatimStringLiteral, 0);
	};

	TemplateStringStart() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringStart, 0);
	};

	TemplateStringEnd() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringEnd, 0);
	};

	TemplateStringText() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringText, 0);
	};

	TemplateStringStartExpression() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringStartExpression, 0);
	};

	TemplateStringEndExpression() {
	    return this.getToken(GameMakerLanguageParser.TemplateStringEndExpression, 0);
	};

	ListAccessor() {
	    return this.getToken(GameMakerLanguageParser.ListAccessor, 0);
	};

	MapAccessor() {
	    return this.getToken(GameMakerLanguageParser.MapAccessor, 0);
	};

	GridAccessor() {
	    return this.getToken(GameMakerLanguageParser.GridAccessor, 0);
	};

	ArrayAccessor() {
	    return this.getToken(GameMakerLanguageParser.ArrayAccessor, 0);
	};

	StructAccessor() {
	    return this.getToken(GameMakerLanguageParser.StructAccessor, 0);
	};

	enterRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.enterMacroToken(this);
		}
	}

	exitRule(listener) {
	    if(listener instanceof GameMakerLanguageParserListener ) {
	        listener.exitMacroToken(this);
		}
	}

	accept(visitor) {
	    if ( visitor instanceof GameMakerLanguageParserVisitor ) {
	        return visitor.visitMacroToken(this);
	    } else {
	        return visitor.visitChildren(this);
	    }
	}


}




GameMakerLanguageParser.ProgramContext = ProgramContext; 
GameMakerLanguageParser.StatementListContext = StatementListContext; 
GameMakerLanguageParser.StatementContext = StatementContext; 
GameMakerLanguageParser.BlockContext = BlockContext; 
GameMakerLanguageParser.IfStatementContext = IfStatementContext; 
GameMakerLanguageParser.IterationStatementContext = IterationStatementContext; 
GameMakerLanguageParser.WithStatementContext = WithStatementContext; 
GameMakerLanguageParser.SwitchStatementContext = SwitchStatementContext; 
GameMakerLanguageParser.ContinueStatementContext = ContinueStatementContext; 
GameMakerLanguageParser.BreakStatementContext = BreakStatementContext; 
GameMakerLanguageParser.ExitStatementContext = ExitStatementContext; 
GameMakerLanguageParser.EmptyStatementContext = EmptyStatementContext; 
GameMakerLanguageParser.CaseBlockContext = CaseBlockContext; 
GameMakerLanguageParser.CaseClausesContext = CaseClausesContext; 
GameMakerLanguageParser.CaseClauseContext = CaseClauseContext; 
GameMakerLanguageParser.DefaultClauseContext = DefaultClauseContext; 
GameMakerLanguageParser.ThrowStatementContext = ThrowStatementContext; 
GameMakerLanguageParser.TryStatementContext = TryStatementContext; 
GameMakerLanguageParser.CatchProductionContext = CatchProductionContext; 
GameMakerLanguageParser.FinallyProductionContext = FinallyProductionContext; 
GameMakerLanguageParser.ReturnStatementContext = ReturnStatementContext; 
GameMakerLanguageParser.DeleteStatementContext = DeleteStatementContext; 
GameMakerLanguageParser.LiteralStatementContext = LiteralStatementContext; 
GameMakerLanguageParser.AssignmentExpressionContext = AssignmentExpressionContext; 
GameMakerLanguageParser.VariableDeclarationListContext = VariableDeclarationListContext; 
GameMakerLanguageParser.VarModifierContext = VarModifierContext; 
GameMakerLanguageParser.VariableDeclarationContext = VariableDeclarationContext; 
GameMakerLanguageParser.GlobalVarStatementContext = GlobalVarStatementContext; 
GameMakerLanguageParser.NewExpressionContext = NewExpressionContext; 
GameMakerLanguageParser.LValueStartExpressionContext = LValueStartExpressionContext; 
GameMakerLanguageParser.LValueExpressionContext = LValueExpressionContext; 
GameMakerLanguageParser.LValueChainOperatorContext = LValueChainOperatorContext; 
GameMakerLanguageParser.LValueFinalOperatorContext = LValueFinalOperatorContext; 
GameMakerLanguageParser.ExpressionSequenceContext = ExpressionSequenceContext; 
GameMakerLanguageParser.ExpressionOrFunctionContext = ExpressionOrFunctionContext; 
GameMakerLanguageParser.ExpressionContext = ExpressionContext; 
GameMakerLanguageParser.CallStatementContext = CallStatementContext; 
GameMakerLanguageParser.ImplicitCallStatementContext = ImplicitCallStatementContext; 
GameMakerLanguageParser.CallableExpressionContext = CallableExpressionContext; 
GameMakerLanguageParser.PreIncDecExpressionContext = PreIncDecExpressionContext; 
GameMakerLanguageParser.PostIncDecExpressionContext = PostIncDecExpressionContext; 
GameMakerLanguageParser.IncDecStatementContext = IncDecStatementContext; 
GameMakerLanguageParser.AccessorContext = AccessorContext; 
GameMakerLanguageParser.ArgumentsContext = ArgumentsContext; 
GameMakerLanguageParser.ArgumentListContext = ArgumentListContext; 
GameMakerLanguageParser.ArgumentContext = ArgumentContext; 
GameMakerLanguageParser.TrailingCommaContext = TrailingCommaContext; 
GameMakerLanguageParser.AssignmentOperatorContext = AssignmentOperatorContext; 
GameMakerLanguageParser.LiteralContext = LiteralContext; 
GameMakerLanguageParser.TemplateStringLiteralContext = TemplateStringLiteralContext; 
GameMakerLanguageParser.TemplateStringAtomContext = TemplateStringAtomContext; 
GameMakerLanguageParser.ArrayLiteralContext = ArrayLiteralContext; 
GameMakerLanguageParser.ElementListContext = ElementListContext; 
GameMakerLanguageParser.StructLiteralContext = StructLiteralContext; 
GameMakerLanguageParser.StructItemContext = StructItemContext; 
GameMakerLanguageParser.PropertyAssignmentContext = PropertyAssignmentContext; 
GameMakerLanguageParser.PropertyIdentifierContext = PropertyIdentifierContext; 
GameMakerLanguageParser.FunctionDeclarationContext = FunctionDeclarationContext; 
GameMakerLanguageParser.ConstructorClauseContext = ConstructorClauseContext; 
GameMakerLanguageParser.ParameterListContext = ParameterListContext; 
GameMakerLanguageParser.ParameterArgumentContext = ParameterArgumentContext; 
GameMakerLanguageParser.IdentifierContext = IdentifierContext; 
GameMakerLanguageParser.EnumeratorDeclarationContext = EnumeratorDeclarationContext; 
GameMakerLanguageParser.EnumeratorListContext = EnumeratorListContext; 
GameMakerLanguageParser.EnumeratorItemContext = EnumeratorItemContext; 
GameMakerLanguageParser.EnumeratorContext = EnumeratorContext; 
GameMakerLanguageParser.MacroStatementContext = MacroStatementContext; 
GameMakerLanguageParser.DefineStatementContext = DefineStatementContext; 
GameMakerLanguageParser.RegionStatementContext = RegionStatementContext; 
GameMakerLanguageParser.IdentifierStatementContext = IdentifierStatementContext; 
GameMakerLanguageParser.SoftKeywordContext = SoftKeywordContext; 
GameMakerLanguageParser.PropertySoftKeywordContext = PropertySoftKeywordContext; 
GameMakerLanguageParser.OpenBlockContext = OpenBlockContext; 
GameMakerLanguageParser.CloseBlockContext = CloseBlockContext; 
GameMakerLanguageParser.EosContext = EosContext; 
GameMakerLanguageParser.MacroTokenContext = MacroTokenContext; 
