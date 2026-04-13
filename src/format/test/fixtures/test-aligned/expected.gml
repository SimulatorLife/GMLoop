/// @description Insert description here
// You can write your code in this editor
foo = 1;
longerName = 22;
show_debug_message("done");
value = compute();

// Comment separating assignments
foo2 = 12;
thisIsAReallyLongName2 = 23;
variable3 = 34;
show_debug_message("done again");
value2 = compute();

// Values for passing into shader
precalculated_0 = new Vector4();
precalculated_1 = new Vector4();
precalculated_2 = 0;
precalculated_0.y = 1 + sin(time) * sin(0.5 * time) * (1.5 + sin(0.05 * time) * 0.5) * 0.5;
precalculated_1.z = sin(time);
precalculated_1.w = time * 0.2;
global.modSphere = vbuff_load_obj("AnimEditor/Geosphere.obj");
global.modCube = vbuff_load_obj("AnimEditor/Cube.obj");
global.modUnitarrows = vbuff_load_obj("AnimEditor/UnitDimensionArrows.obj");
global.modArrow = vbuff_load_obj("AnimEditor/RotateXArrow.obj");
modArrow2 = vbuff_load_obj("AnimEditor/RotateYArrow.obj");
modArrow3 = vbuff_load_obj("AnimEditor/RotateZArrow.obj");
global.modWall = mod_create_wall();

if (edtSMFSel >= 0) {
    model = edtSMFArray[edtSMFSel];
    var mBuff = model.mBuff;
    var vBuff = model.vBuff;
    var vis = model.vis;
    var texPack = model.texPack;
    var wire = model.Wire;
    var selList = model.SelModelList;
    var selNode = model.SelNode;
    var animArray = model.animations;
    var selAnim = model.SelAnim;
    var selKeyframe = model.SelKeyframe;
    var rig = model.rig;
}

for (var i = 0; i < armNum; i++) {
    var a = i / (armNum * 4 * pi);
    armPos[i] = [x + 150 * cos(a), y + 150 * sin(a), 0];
    armMoving[i] = -1;
    armSpeed[i] = 0.1;
    armPrevPos[i] = armPos[i];
    armOvershoot[i] = [0, 0];
}

var dsin_lp = dsin(pdir_l + leg_spread),
    dsin_lm = dsin(pdir_l - leg_spread),
    dsin_rp = dsin(pdir_r + leg_spread),
    dsin_rm = dsin(pdir_r - leg_spread),
    dcos_lp = dcos(pdir_l + leg_spread),
    dcos_lm = dcos(pdir_l - leg_spread),
    dcos_rp = dcos(pdir_r + leg_spread),
    dcos_rm = dcos(pdir_r - leg_spread),
    dcosl = dcos(pdir_l),
    dsinl = dsin(pdir_l),
    dcosr = dcos(pdir_r),
    dsinr = dsin(pdir_r);
