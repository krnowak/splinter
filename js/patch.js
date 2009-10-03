/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Utils');

// A patch is stored as:
// Patch ::= File *
// File ::= Hunk *
// Hunk ::= Line *
//
// The lines of a hunk are the lines of the two-column display of the hunk
// So, e.g., the unified diff hunk:
//
// @@ -4,8 +4,7
//  import time
// -from gettext import ngettext
//  from threading import Thread
// +
//  import gobject
//  import gtk
// -import gc
// -import sys
// +from gettext import ngettext
//
// Is represented as:
//
//    4 import time                      4 import time
// -  5 from gettext import ngettext
//    6 from threading import Thread     5 from threading import Thread
//                                     + 6
//    7 import gobject                   7 import gobject
//    8 import gtk                       8 import gtk
// !  9 import gc                      ! 9 from gettext import ngettext
// ! 10 import sys                     !
//   11                                 10
//
// Conceptually the hunk is made up of context lines - lines that are unchanged
// by the patch and "segments" - series of lines that are changed by the patch
// Each line is stored as an array:
//
//  [old_text, new_text, flags]
//
// old_text or new_text can be null (but not both). Flags are:
const ADDED         = 1 << 0; // Part of a pure addition segment
const REMOVED       = 1 << 1; // Part of a pure removal segment
const CHANGED       = 1 << 2; // Part of some other segmnet
const NEW_NONEWLINE = 1 << 3; // Old line doesn't end with \n
const OLD_NONEWLINE = 1 << 4; // New line doesn't end with \n

function Hunk(oldStart, oldCount, newStart, newCount, functionLine, text) {
    this._init(oldStart, oldCount, newStart, newCount, functionLine, text);
}

Hunk.prototype = {
    _init : function(oldStart, oldCount, newStart, newCount, functionLine, text) {
        var rawlines = text.split("\n");
        if (rawlines.length > 0 && Utils.strip(rawlines[rawlines.length - 1]) == "")
            rawlines.pop(); // Remove trailing element from final \n

        this.oldStart = oldStart;
        this.oldCount = oldCount;
        this.newStart = newStart;
        this.newCount = newCount;
        this.functionLine = Utils.strip(functionLine);
        this.comment = null;

        var lines = [];
        var totalOld = 0;
        var totalNew = 0;

        var currentStart = -1;
        var currentOldCount = 0;
        var currentNewCount = 0;

        // A segment is a series of lines added/removed/changed with no intervening
        // unchanged lines. We make the classification of ADDED/REMOVED/CHANGED
        // in the flags for the entire segment
        function startSegment() {
            if (currentStart < 0) {
                currentStart = lines.length;
            }
        }

        function endSegment() {
            if (currentStart >= 0) {
                if (currentOldCount > 0 && currentNewCount > 0) {
                    for (var j = currentStart; j < lines.length; j++) {
                        lines[j][2] &= ~(ADDED | REMOVED);
                        lines[j][2] |= CHANGED;
                    }
                }

                currentStart = -1;
                currentOldCount = 0;
                currentNewCount = 0;
            }
        }

        for (var i = 0; i < rawlines.length; i++) {
            var line = rawlines[i];
            var op = line[0];
            var strippedLine = line.substring(1);
            var noNewLine = 0;
            if (i + 1 < rawlines.length && rawlines[i + 1].substr(0, 1) == '\\') {
                noNewLine = op == '-' ? OLD_NONEWLINE : NEW_NONEWLINE;
            }

            if (op == ' ') {
                endSegment();
                totalOld++;
                totalNew++;
                lines.push([strippedLine, strippedLine, 0]);
            } else if (op == '-') {
                totalOld++;
                startSegment();
                lines.push([strippedLine, null, REMOVED | noNewLine]);
                currentOldCount++;
            } else if (op == '+') {
                totalNew++;
                startSegment();
                if (currentStart + currentNewCount >= lines.length) {
                    lines.push([null, strippedLine, ADDED | noNewLine]);
                } else {
                    lines[currentStart + currentNewCount][1] = strippedLine;
                    lines[currentStart + currentNewCount][2] |= ADDED | noNewLine;
                }
                currentNewCount++;
            } else if (op == '\\') {
                // Handled with preceding line
            } else {
                // Junk in the patch - hope the patch got line wrapped and just ignoring
                // it produces something meaningful. (For a patch displayer, anyways.
                // would be bad for applying the patch.)
                // Utils.assertNotReached();
            }
        }

        // git mail-formatted patches end with --\n<git version> like a signature
        // This is troublesome since it looks like a subtraction at the end
        // of last hunk of the last file. Handle this specifically rather than
        // generically stripping excess lines to be kind to hand-edited patches
        if (totalOld > oldCount &&
            lines[lines.length - 1][1] == null &&
            lines[lines.length - 1][0][0] == '-')
        {
            lines.pop();
            currentOldCount--;
            if (currentOldCount == 0 && currentNewCount == 0)
                currentStart = -1;
        }

        endSegment();

        this.lines = lines;
    },

    iterate : function(cb) {
        var oldLine = this.oldStart;
        var newLine = this.newStart;
        for (var i = 0; i < this.lines.length; i++) {
            var line = this.lines[i];
            cb(this.location + i, oldLine, line[0], newLine, line[1], line[2], line);
            if (line[0] != null)
                oldLine++;
            if (line[1] != null)
                newLine++;
        }
    }
};

function File(filename, hunks) {
    this._init(filename, hunks);
}

File.prototype = {
    _init : function(filename, hunks) {
        this.filename = filename;
        this.hunks = hunks;

        var l = 0;
        for (var i = 0; i < this.hunks.length; i++) {
            var hunk = this.hunks[i];
            hunk.location = l;
            l += hunk.lines.length;
        }
    },

    // A "location" is just a linear index into the lines of the patch in this file
    getLocation : function(oldLine, newLine) {
        for (var i = 0; i < this.hunks.length; i++) {
            var hunk = this.hunks[i];
            if (oldLine != null && hunk.oldStart > oldLine)
                continue;
            if (newLine != null && hunk.oldStart > newLine)
                continue;

            if ((oldLine != null && oldLine < hunk.oldStart + hunk.oldCount) ||
                newLine != null && newLine < hunk.newStart + hunk.newCount) {
                var location = -1;
                hunk.iterate(function(loc, oldl, oldText, newl, newText, flags) {
                                 if ((oldLine == null || oldl == oldLine) &&
                                     (newLine == null || newl == newLine))
                                     location = loc;
                             });

                if (location != -1)
                    return location;
            }
        }

        throw "Bad oldLine,newLine: " + oldLine + "," + newLine;
    },

    getHunk : function(location) {
        for (var i = 0; i < this.hunks.length; i++) {
            var hunk = this.hunks[i];
            if (location >= hunk.location && location < hunk.location + hunk.lines.length)
                return hunk;
        }

        throw "Bad location: " + location;
    },

    toString : function() {
        return "File(" + this.filename + ")";
    }
};

function _cleanIntro(intro) {
    var m;

    intro = Utils.strip(intro);

    // Git: remove leading 'From <commit_id> <date'
    m = /^From\s+[a-f0-9]{40}.*\n/.exec(intro);
    if (m)
        intro = intro.substr(m.index + m[0].length);

    // Git: remove 'diff --stat' output from the end
    m = /^---\n(?:^\s.*\n)+\s+\d+\s+files changed.*\n?(?!.)/m.exec(intro);
    if (m)
        intro = intro.substr(0, m.index);

    return intro;
}

// Matches the start unified diffs for a file as produced by different version control tools
const FILE_START_RE = /^(?:(?:Index|index|===|RCS|diff).*\n)*---[ \t]*(\S+).*\n\+\+\+[ \t]*(\S+).*\n(?=@@)/mg;

// Hunk start: @@ -23,12 +30,11 @@
// Followed by: lines beginning with [ +\-]
const HUNK_RE = /^@@[ \t]+-(\d+),(\d+)[ \t]+\+(\d+),(\d+)[ \t]+@@(.*)\n((?:[ +\\-].*\n)*)/mg;

function Patch(text) {
    this._init(text);
}

Patch.prototype = {
    // cf. parsing in Review.Review.parse()
    _init : function(text) {
        // Canonicalize newlines to simplify the following
        if (/\r/.test(text))
            text = text.replace(/(\r\n|\r|\n)/g, "\n");

        this.files = [];

        var m = FILE_START_RE.exec(text);
        if (m != null)
            this.intro = _cleanIntro(text.substring(0, m.index));
        else
            throw "Not a patch";

        while (m != null) {
            // git and hg show a diff between a/foo/bar.c and b/foo/bar.c
            // or between a/foo/bar.c and /dev/null for removals and the
            // reverse for additions.
            var filename;
            if (/^a\//.test(m[1]) &&
                (/^b\//.test(m[2]) || /^\/dev\/null/.test(m[2]))) {
                filename = m[1].substring(2);
            } else if (/^\/dev\/null/.test(m[1]) && /^b\//.test(m[2])) {
                filename = m[2].substring(2);
            } else {
                filename = m[1];
            }

            var hunks = [];
            var pos = FILE_START_RE.lastIndex;
            while (true) {
                HUNK_RE.lastIndex = pos;
                var m2 = HUNK_RE.exec(text);
                if (m2 == null || m2.index != pos)
                    break;

                pos = HUNK_RE.lastIndex;
                var oldStart = parseInt(m2[1]);
                var oldCount = parseInt(m2[2]);
                var newStart = parseInt(m2[3]);
                var newCount = parseInt(m2[4]);

                hunks.push(new Hunk(oldStart, oldCount, newStart, newCount, m2[5], m2[6]));
            }

            this.files.push(new File(filename, hunks));

            FILE_START_RE.lastIndex = pos;
            m = FILE_START_RE.exec(text);
        }
    },

    getFile : function(filename) {
        for (var i = 0; i < this.files.length; i++) {
            if (this.files[i].filename == filename)
                return this.files[i];
        }

        return null;
    }
};
