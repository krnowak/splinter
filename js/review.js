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

function Comment(file, location, type, comment) {
    this._init(file, location, type, comment);
}

Comment.prototype = {
    _init : function(file, location, type, comment) {
        this.file = file;
        this.type = type;
        this.location = location;
        this.comment = comment;
    },

    getHunk : function() {
        return this.file.patchFile.getHunk(this.location);
    },

    getInReplyTo : function() {
        var hunk = this.getHunk();
        var line = hunk.lines[this.location - hunk.location];
        for (var i = 0; i < line.reviewComments.length; i++) {
            var comment = line.reviewComments[0];
            if (comment === this)
                return null;
            if (comment.type == this.type)
                return comment;
        }

        return null;
    },

    remove : function() {
        var hunk = this.getHunk();
        var line = hunk.lines[this.location - hunk.location];
        _removeFromArray(this.file.comments, this);
        _removeFromArray(line.reviewComments, this);
    }
};

function _noNewLine(flags, flag) {
    return ((flags & flag) != 0) ? "\n\ No newline at end of file" : "";
}

function _lineInSegment(line) {
    return (line[2] & (Patch.ADDED | Patch.REMOVED | Patch.CHANGED)) != 0;
}

function _compareSegmentLines(a, b) {
    var op1 = a[0];
    var op2 = b[0];
     if (op1 == op2)
        return 0;
    else if (op1 == ' ')
        return -1;
    else if (op2 == ' ')
        return 1;
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

    addComment : function(location, type, comment) {
        var hunk = this.patchFile.getHunk(location);
        var line = hunk.lines[location - hunk.location];
        comment = new Comment(this, location, type, comment);
        if (line.reviewComments == null)
            line.reviewComments = [];
        line.reviewComments.push(comment);
        for (var i = 0; i <= this.comments.length; i++) {
            if (i == this.comments.length ||
                this.comments[i].location > location ||
                (this.comments[i].location == location && this.comments[i].type > type)) {
                this.comments.splice(i, 0, comment);
                break;
            } else if (this.comments[i].location == location &&
                       this.comments[i].type == type) {
                throw "Two comments at the same location";
            }
        }

        return comment;
    },

    getComment : function(location, type) {
        for (var i = 0; i < this.comments.length; i++)
            if (this.comments[i].location == location &&
                this.comments[i].type == type)
                return this.comments[i];

        return null;
    },

    toString : function() {
        var str = '::: ';
        str += this.patchFile.filename;
        str += '\n';
        var first = true;

        for (var i = 0; i < this.comments.length; i++) {
            if (first)
                first = false;
            else
                str += '\n';
            var comment = this.comments[i];
            var hunk = comment.getHunk();

            // Find the range of lines we might want to show. That's everything in the
            // same segment as the commented line, plus up two two lines of non-comment
            // diff before.

            var contextFirst = comment.location - hunk.location;
            if (_lineInSegment(hunk.lines[contextFirst])) {
                while (contextFirst > 0 && _lineInSegment(hunk.lines[contextFirst - 1]))
                    contextFirst--;
            }

            var j;
            for (j = 0; j < 2; j++)
                if (contextFirst > 0 && !_lineInSegment(hunk.lines[contextFirst - 1]))
                    contextFirst--;

            // Now get the diff lines (' ', '-', '+' for that range of lines)

            var patchOldStart = null;
            var patchNewStart = null;
            var patchOldLines = 0;
            var patchNewLines = 0;
            var unchangedLines = 0;
            var patchLines = [];

            function addOldLine(oldLine) {
                if (patchOldLines == 0)
                    patchOldStart = oldLine;
                patchOldLines++;
            }

            function addNewLine(newLine) {
                if (patchNewLines == 0)
                    patchNewStart = newLine;
                patchNewLines++;
            }

            hunk.iterate(function(loc, oldLine, oldText, newLine, newText, flags) {
                             if (loc >= hunk.location + contextFirst && loc <= comment.location) {
                                 if ((flags & (Patch.ADDED | Patch.REMOVED | Patch.CHANGED)) == 0) {
                                     patchLines.push(' ' + oldText + _noNewLine(flags, Patch.OLD_NONEWLINE | Patch.NEW_NONEWLINE));
                                     addOldLine(oldLine);
                                     addNewLine(newLine);
                                     unchangedLines++;
                                 } else {
                                     if ((comment.type == Patch.REMOVED || comment.type == Patch.CHANGED) && oldText != null) {
                                         patchLines.push('-' + oldText +_noNewLine(flags, Patch.OLD_NONEWLINE));
                                         addOldLine(oldLine);
                                     }
                                     if ((comment.type == Patch.ADDED || comment.type == Patch.CHANGED) && newText != null) {
                                         patchLines.push('+' + newText + _noNewLine(flags, Patch.NEW_NONEWLINE));
                                         addNewLine(newLine);
                                     }
                                 }
                             }
                         });

            // Sort them into global order ' ', '-', '+'
            patchLines.sort(_compareSegmentLines);

            // Completely blank context isn't useful so remove it
            while (patchLines[0].match(/^\s*$/)) {
                patchLines.shift();
                patchOldStart++;
                patchNewStart++;
                patchOldLines--;
                patchNewLines--;
                unchangedLines--;
            }

            if (comment.type == Patch.CHANGED) {
                // For a CHANGED comment, we have to show the the start of the hunk - but to save
                // in length we can trim unchanged context before it

                if (patchOldLines + patchNewLines - unchangedLines > 5) {
                    var toRemove = Math.min(unchangedLines, patchOldLines + patchNewLines - unchangedLines - 5);
                    patchLines.splice(0, toRemove);
                    patchOldStart += toRemove;
                    patchNewStart += toRemove;
                    patchOldLines -= toRemove;
                    patchNewLines -= toRemove;
                    unchangedLines -= toRemove;
                }

                str += '@@ -' + patchOldStart + ',' + patchOldLines + ' +' + patchNewStart + ',' + patchNewLines + ' @@\n';

                // We will use up to 8 lines more:
                //  4 old lines or 3 old lines and a "... <N> more ... " line
                //  4 new lines or 3 new lines and a "... <N> more ... " line

                var patchRemovals = patchOldLines - unchangedLines;
                var showPatchRemovals = patchRemovals > 4 ? 3 : patchRemovals;
                var patchAdditions = patchNewLines - unchangedLines;
                var showPatchAdditions = patchAdditions > 4 ? 3 : patchAdditions;

                j = 0;
                while (j < unchangedLines + showPatchRemovals) {
                    str += patchLines[j];
                    str += "\n";
                    j++;
                }
                if (showPatchRemovals < patchRemovals) {
                    str += "... ";
                    str += patchRemovals - showPatchRemovals;
                    str += " more ...\n";
                    j += patchRemovals - showPatchRemovals;
                }
                while (j < unchangedLines + patchRemovals + showPatchAdditions) {
                    str += patchLines[j];
                    str += "\n";
                    j++;
                }
                if (showPatchAdditions < patchAdditions) {
                    str += "... ";
                    str += patchAdditions - showPatchAdditions;
                    str += " more ...\n";
                    j += patchAdditions - showPatchAdditions;
                }
            } else {
                // We limit Patch.ADDED/Patch.REMOVED comments strictly to 3 lines after the header
                if (patchOldLines + patchNewLines - unchangedLines > 3) {
                    var toRemove =  patchOldLines + patchNewLines - unchangedLines - 3;
                    patchLines.splice(0, toRemove);
                    patchOldStart += toRemove;
                    patchNewStart += toRemove;
                    patchOldLines -= toRemove;
                    patchNewLines -= toRemove;
                }

                if (comment.type == Patch.REMOVED)
                    str += '@@ -' + patchOldStart + ',' + patchOldLines + ' @@\n';
                else
                    str += '@@ +' + patchNewStart + ',' + patchNewLines + ' @@\n';
                str += patchLines.join("\n");
                str += "\n";
            }
            str += "\n";
            str += comment.comment;
            str += "\n";
        }

        return str;
    }
};

function Review(patch, who, date) {
    this._init(patch, who, date);
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
const HUNK_RE = /^@@[ \t]+(?:-(\d+),(\d+)[ \t]+)?(?:\+(\d+),(\d+)[ \t]+)?@@.*\n((?:(?!@@|:::).*\n?)*)/mg;

Review.prototype = {
    _init : function(patch, who, date) {
        this.date = null;
        this.patch = patch;
        this.who = who;
        this.date = date;
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

                var oldStart, oldCount, newStart, newCount;
                if (m2[1] != null) {
                    oldStart = parseInt(m2[1]);
                    oldCount = parseInt(m2[2]);
                } else {
                    oldStart = oldCount = null;
                }

                if (m2[3] != null) {
                    newStart = parseInt(m2[3]);
                    newCount = parseInt(m2[4]);
                } else {
                    newStart = newCount = null;
                }

                var type;
                if (oldStart != null && newStart != null)
                    type = Patch.CHANGED;
                else if (oldStart != null)
                    type = Patch.REMOVED;
                else if (newStart != null)
                    type = Patch.ADDED;
                else
                    throw "Either old or new line numbers must be given";

                var oldLine = oldStart;
                var newLine = newStart;

                var rawlines = m2[5].split("\n");
                if (rawlines.length > 0 && rawlines[rawlines.length - 1].match('^/s+$'))
                    rawlines.pop(); // Remove trailing element from final \n

                var commentText = null;

                var lastSegmentOld = 0;
                var lastSegmentNew = 0;
                for (var i = 0; i < rawlines.length; i++) {
                    var line = rawlines[i];
                    var count = 1;
                    if (i < rawlines.length - 1 && rawlines[i + 1].match(/^... \d+\s+/)) {
                        var m3 = /^\.\.\.\s+(\d+)\s+/.exec(rawlines[i + 1]);
                        count += parseInt(m3[1]);
                        i += 1;
                    }
                    // The check for /^$/ is because if Bugzilla is line-wrapping it also
                    // strips completely whitespace lines
                    if (line.match(/^ /) || line.match(/^$/)) {
                        oldLine += count;
                        newLine += count;
                        lastSegmentOld = 0;
                        lastSegmentNew = 0;
                    } else if (line.match(/^-/)) {
                        oldLine += count;
                        lastSegmentOld += count;
                    } else if (line.match(/^\+/)) {
                        newLine += count;
                        lastSegmentNew += count;
                    } else if (line.match(/^\\/)) {
                        // '\ No newline at end of file' - ignore
                    } else {
                        // Ignore assumming it's a result of line-wrapping
                        // https://bugzilla.mozilla.org/show_bug.cgi?id=509152
                        console.log("WARNING: Bad content in hunk: " + line);
                    }

                    if ((oldStart == null || oldLine == oldStart + oldCount) &&
                        (newStart == null || newLine == newStart + newCount)) {
                        commentText = rawlines.slice(i + 1).join("\n");
                        break;
                    }
                }

                if (commentText == null) {
                    console.log("WARNING: No comment found in hunk");
                    commentText = "";
                }


                var location;
                if (type == Patch.CHANGED) {
                    if (lastSegmentOld >= lastSegmentNew)
                        oldLine--;
                    if (lastSegmentOld <= lastSegmentNew)
                        newLine--;
                    location = file.patchFile.getLocation(oldLine, newLine);
                } else if (type == Patch.REMOVED) {
                    oldLine--;
                    location = file.patchFile.getLocation(oldLine, null);
                } else if (type == Patch.ADDED) {
                    newLine--;
                    location = file.patchFile.getLocation(null, newLine);
                }
                file.addComment(location, type, Utils.strip(commentText));
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
