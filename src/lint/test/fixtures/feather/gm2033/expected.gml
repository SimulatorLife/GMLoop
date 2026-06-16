// GM2033: The function 'file_find_next' cannot be called outside of a file_find_first()/file_find_close() block

fnames = [];

var _fname = file_find_first("*.txt", fa_none);

while (_fname != "")
{
    array_push(fnames, _fname);
    _fname = file_find_next();
}

file_find_close();

file_find_next();
