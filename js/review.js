/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Patch');
include('Utils');

function _removeFromArray(a, element) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] === element) {
            a.splice(i, 1);
            return;
        }
    }
}

function Comment(file, location, comment) {
    this._init(file, location, comment);
}

Comment.prototype = {
    _init : function(file, location, comment) {
        this.file = file;
        this.location = location;
        this.comment = comment;
    },

    remove : function() {
        var hunk = this.file.patchFile.getHunk(this.location);
        var line = hunk.lines[this.location - hunk.location];
        _removeFromArray(this.file.comments, this);
        _removeFromArray(line.reviewComments, this);
    }
};

function _noNewLine(flags, flag) {
    return ((flags & flag) != 0) ? "\n\ No newline at end of file" : "";
}

function _compareSegmentLines(a, b) {
    var op1 = a.substr(0, 1);
    var op2 = b.substr(0, 1);
    if (op1 == op2)
        return 0;
    else
        return op1 == '-' ? -1 : 1;
}

function File(review, patchFile) {
    this._init(review, patchFile);
}

File.prototype = {
    _init : function(review, patchFile) {
        this.review = review;
        this.patchFile = patchFile;
        this.comments = [];
    },

    addComment : function(location, comment) {
        var hunk = this.patchFile.getHunk(location);
        var line = hunk.lines[location - hunk.location];
        comment = new Comment(this, location, comment);
        if (line.reviewComments == null)
            line.reviewComments = [];
        line.reviewComments.push(comment);
        for (var i = 0; i <= this.comments.length; i++) {
            if (i == this.comments.length || this.comments[i].location > location) {
                this.comments.splice(i, 0, comment);
                break;
            } else if (this.comments[i].location == location) {
                throw "Two comments at the same location";
                break;
            }
        }
    },

    getComment : function(location, comment) {
        for (var i = 0; i < this.comments.length; i++)
            if (this.comments[i].location == location)
                return this.comments[i];

        return null;
    },

    toString : function() {
        var str = '::: ';
        str += this.patchFile.filename;
        str += '\n';
        var first = true;

        var lastCommentLocation = 0;
        for (var i = 0; i < this.comments.length; i++) {
            if (first)
                first = false;
            else
                str += '\n';
            var comment = this.comments[i];
            var hunk = this.patchFile.getHunk(comment.location);
            var context = Math.min(comment.location - lastCommentLocation - 1,
                                   comment.location - hunk.location,
                                   2);

            var patchOldStart, patchNewStart;
            var patchOldLines = 0;
            var patchNewLines = 0;
            var patchLines = [];

            hunk.iterate(function(loc, oldLine, oldText, newLine, newText, flags) {
                             if (loc == comment.location - context) {
                                 patchOldStart = oldLine;
                                 patchNewStart = newLine;
                             }

                             if (loc >= comment.location - context && loc <= comment.location) {
                                 if (oldText != null)
                                     patchOldLines++;
                                 if (newText != null)
                                     patchNewLines++;
                                 if ((flags & (Patch.ADDED | Patch.REMOVED | Patch.CHANGED)) != 0) {
                                     if (oldText != null)
                                         patchLines.push('-' + oldText +_noNewLine(flags, Patch.OLD_NONEWLINE));
                                     if (newText != null)
                                         patchLines.push('+' + newText + _noNewLine(flags, Patch.NEW_NONEWLINE));
                                 } else {
                                     patchLines.push(' ' + oldText + _noNewLine(flags, Patch.OLD_NONEWLINE | Patch.NEW_NONEWLINE));
                                 }
                             }
                         });

            var segStart = 0;
            for (var k = 0; k <= patchLines.length; k++) {
                if (k == patchLines.length || patchLines[k].substr(0, 1) == ' ') {
                    if (segStart < k) {
                        var segmentLines = patchLines.slice(segStart, k);
                        segmentLines.sort(_compareSegmentLines);
                        for (var l = 0; l < segmentLines.length; l++)
                            patchLines[segStart + l] = segmentLines[l];
                    }
                    segStart = k + 1;
                }
            }

            while (Utils.strip(patchLines[0]) == '') {
                patchLines.shift();
                patchOldStart++;
                patchNewStart++;
                patchOldLines--;
                patchNewLines--;
            }

            str += '@@ -' + patchOldStart + ',' + patchOldLines + ' +' + patchNewStart + ',' + patchNewLines + ' @@\n';
            str += patchLines.join("\n");
            str += "\n\n";
            str += comment.comment;
            str += "\n";

            lastCommentLocation = comment.location;
        }

        return str;
    }
};

function Review(patch) {
    this._init(patch);
}

// Indicates start of review comments about a file
// ::: foo/bar.c
const FILE_START_RE = /^:::[ \t]+(\S+)[ \t]*\n/mg;


// This is like Patch.HUNK_RE for the starting line, but differs in that it
// includes trailing lines that are not patch lines up to the next hunk or file
// (the trailing lines will be split out as the coment.)
//
// Hunk start: @@ -23,12 +30,11 @@
// Followed by: lines that don't start with @@ or :::
const HUNK_RE = /^@@[ \t]+-(\d+),(\d+)[ \t]+\+(\d+),(\d+)[ \t]+@@.*\n((?:(?!@@|:::).*\n?)*)/mg;

Review.prototype = {
    _init : function(patch) {
        this.date = null;
        this.patch = patch;
        this.intro = null;
        this.files = [];

        for (var i = 0; i < patch.files.length; i++) {
            this.files.push(new File(this, patch.files[i]));
        }
    },

    // cf. parsing in Patch.Patch._init()
    parse : function(text) {
	FILE_START_RE.lastIndex = 0;
        var m = FILE_START_RE.exec(text);

        var intro;
        if (m != null) {
            this.setIntro(text.substr(0, m.index));
        } else{
            this.setIntro(text);
            return;
        }

        while (m != null) {
            var filename = m[1];
            var file = this.getFile(filename);
            if (file == null)
                throw "Review refers to filename '" + filename + "' not in reviewed Patch.";

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

                var hunk = new Patch.Hunk(oldStart, oldCount, newStart, newCount, m2[5], true);

                var location = file.patchFile.getLocation(hunk.oldStart + hunk.oldCount - 1,
                                                          hunk.newStart + hunk.newCount - 1);
                file.addComment(location, Utils.strip(hunk.comment));
            }

            FILE_START_RE.lastIndex = pos;
            m = FILE_START_RE.exec(text);
        }
    },

    setIntro : function(intro) {
        intro = Utils.strip(intro);
        this.intro = intro != "" ? intro : null;
    },

    getFile : function(filename) {
        for (var i = 0; i < this.files.length; i++) {
            if (this.files[i].patchFile.filename == filename)
                return this.files[i];
        }

        return null;
    },

    // Making toString() serialize to our seriaization format is maybe a bit sketchy
    // But the serialization format is designed to be human readable so it works
    // pretty well.
    toString : function() {
        var str = '';
        if (this.intro != null) {
            str += Utils.strip(this.intro);
            str += '\n';
        }

	var first = this.intro == null;
        for (var i = 0; i < this.files.length; i++) {
            var file = this.files[i];
            if (file.comments.length > 0) {
		if (first)
                    first = false;
		else
                    str += '\n';
                str += file.toString();
            }
        }

        return str;
    }
};
