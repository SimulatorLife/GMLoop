var validate_sprite_h2 = {
    w : w_sprite,
    h : h_sprite,
    validate: function(actual, _s, delta) {
        return  scr_is_approx_equal(_rect_w(actual), self.w * 2, delta) &&
                scr_is_approx_equal(_rect_h(actual), self.h     , delta);
    }
}.validate;

validate_sprite_h2();