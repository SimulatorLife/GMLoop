#macro CM_OCTREE_SIZE              octree[@ 3]

function cm_octree_add(octree, object) {
    if (object == 1) {
        var oct_size = CM_OCTREE_SIZE;
        CM_OCTREE_SIZE = 2 * oct_size;
    }
}
