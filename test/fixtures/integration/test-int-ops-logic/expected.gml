myCount = 10;
myCountAlt = myCount++;
myCountAlt2 = ++myCount;

myArray = [1, 2, 3, 4, 5];

// Fall state

op1 = true;
op2 = true;

op3 = false;
op4 = false;

op5 = 0;
op6 = 0;

op7 = true xor false;
op8 = true xor false;

op9 = 1;
op10 = 10 != 6;

n = max(0, point_distance(0, 1, 0, 100));

if (a == getValue() == true) {
    // TODO
}

myVal = h < 0 or h > 1;

myVal2 = 0.5 + 5;

myVal3 = a + b * c;

myVal4 = a + b + c;

myVal5 = (a + b) * c;

myVal6 = a and b or c;

myVal7 = a > b and c < d;

myVal8 = a - b - c;

myVal9 = a == b + c;

myVal10 = a + b * c;

myVal11 = (a and b or c and d);

myVal12 = x * y / z;

myVal13 = (3 - 2) ? "cool" : "not cool";

g = 0.8 - jump * ground * 20; // Gravity
acc = 1 + ground * 0.3; // Acceleration
#region

camDirX = -camMat[0] * c + camMat[8] * s;
camDirY = -camMat[1] * c + camMat[9] * s;
camDirZ = -camMat[2] * c + camMat[10] * s;

#endregion

/// @param value
/// @returns {any}
function halve(value) {
    return value / /* keep important comment */ 2;
}

pos = is_undefined(pos) ? -1 : 0;

if (enemyPos.x - x <= 0) {
    state = "idle";
}

if (is_undefined(myState)) {
    myState = "unknown";
}
