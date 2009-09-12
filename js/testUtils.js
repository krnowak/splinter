/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Utils');

function assertEquals(expected, value) {
    if (expected != value) {
        throw new Error("Assertion failed: expected '" + expected + "' got '" + value + "'");
    }
}

function assertDateEquals(expected, value) {
    if ((expected != null ? expected.getTime() : null) !=
        (value != null ? value.getTime() : null)) {
        throw new Error("Assertion failed: expected '" + expected + "' got '" + value + "'");
    }
}

const PAD = '                                                                                ';
function lalign(str, len) {
    if (str.length <= len)
        return str + PAD.substr(0, len - str.length);
    else
        return str.substr(0, len);
}

function ralign(str, len) {
    if (str.length <= len)
        return PAD.substr(0, len - str.length) + str;
    else
        return str.substr(str.length - len);
}

function table(template, data) {
    var i, j, row;

    let ncols = template.length;

    let widths = new Array(ncols);
    for (j = 0; j < ncols; j++)
        widths[j] = 0;

    for (i = 0; i < data.length; i++) {
        row = data[i];
        for (j = 0; j < ncols; j++) {
            widths[j] = Math.max(widths[j], ("" + row[j]).length);
        }
    }

    var result = '';
    for (i = 0; i < data.length; i++) {
        row = data[i];
        var line = '';
        for (j = 0; j < ncols; j++) {
            if (template[j] == 'l') {
                line += lalign("" + row[j], widths[j]);
            } else {
                line += ralign("" + row[j], widths[j]);
            }
            if (j < ncols - 1)
                line += ' ';
        }
        result += Utils.rstrip(line) + '\n';
    }

    return result;
}
