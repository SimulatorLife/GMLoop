var str = "SMF demo 2: Interpolating between animations:\n" +
	"FPS: " + string(fps) + ", FPS_real: " + string(fps_real) + "\n" +
	"This shows how a basic animated model can be drawn, and how to interpolate smoothly between animations\n" +
	"Press E to enable sample interpolation.\n" +
	"Interpolation: " + (global.enableInterpolation ? "Enabled" : "Disabled") + "\n" + 
	"Controls: Mouse, WASD, Shift, Space\n" +
	"Press 1 through 6 to switch rooms";;

var _b = $"This is a string split across multiple {
lines
} with {interpolation
 } in between.";

var _c = $"This is a really long string that is being used to test the limits of the parser's ability to handle long strings without any issues or problems arising from the length of the string itself. It includes various characters, numbers like 1234567890, and symbols !@#$%^&*() to ensure that everything is parsed correctly and nothing is missed or misinterpreted by the parser during its operation.";

var str = $"FPS: {fps}\n";
