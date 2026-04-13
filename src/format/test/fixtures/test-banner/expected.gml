// @description Top of file description comment

// /--------------------------------------------------------------
// / CONSTANT OFFSETS
// /--------------------------------------------------------------

/// --------------------------------------------------------------
/// OTHER OFFSETS  (relative to the start of the buffer)
/// --------------------------------------------------------------

//////// Banner comment
var value = 1;

// Comment
var message = "ready";
////////////////////////////////////////
//-------------------Move camera-----------------------//
////////////////////////////////////
camUpdateTimer += timeStep;
if (camUpdateTimer >= 1 or fps < 70) { // Only update the mouse movement every 1/60th second
    var mousedx = window_mouse_get_x() - window_get_width() / 2;
    var mousedy = window_mouse_get_y() - window_get_height() / 2;
    window_mouse_set(window_get_width() / 2, window_get_height() / 2);
    camUpdateTimer = 0;
    camYaw += mousedx * 0.1;
    camPitch = clamp(camPitch - mousedy * 0.1, -80, -2);
}
/*////////////////////////////////////////////////////////////////
    Orthogonalize the P2 direction to the vector from P1 to P3
*/////////////////////////////////////////////////////////////////

/*////////////////////////////////////////////////////////////////////////////////////////////////////////
    The idea behind the algorithm is to imagine a sphere placed at P1 with radius of the first bone, and
    another sphere at P3 with the radius of the second bone. The intersection between these spheres is a
    circle representing all the possible placements of P2.
    The first step is to find the middle point of this circle, and the radius of this intersection circle
*/////////////////////////////////////////////////////////////////////////////////////////////////////////
var p1_p3sqr = p1_p3 * p1_p3;
var p2_p3sqr = length2 * length2;
var p1_p2sqr = length1 * length1;
var intersectionRadius = sqrt(p2_p3sqr - sqr(p1_p2sqr - p2_p3sqr - p1_p3sqr) / (4 * p1_p3sqr));
var l = sqrt(p1_p2sqr - intersectionRadius * intersectionRadius) / p1_p3;

///--------------------------------------------------------------
/// eAIState
///--------------------------------------------------------------

///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////// Fall state //////////////////////////////////////////////////////

//////////////////////////////////////
//CAMERA SETTINGS/////////////////////
//////////////////////////////////////
