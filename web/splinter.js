/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Splinter - patch review add-on for Bugzilla
// By Owen Taylor <otaylor@fishsoup.net>
// Copyright 2009, Red Hat, Inc.
// Licensed under MPL 1.1 or later, or GPL 2 or later
// http://git.fishsoup.net/cgit/splinter

if (!console) {
    var console = {};
    console.log = function() {};
}

//
// MODULE: Utils
//

var Utils = {};

Utils.assert = function(condition) {
    if (!condition)
        throw new Error("Assertion failed");
};

Utils.assertNotReached = function() {
    throw new Error("Assertion failed: should not be reached");
};

Utils.strip = function(string) {
    return /^\s*([\s\S]*?)\s*$/.exec(string)[1];
};

Utils.lstrip = function(string) {
    return /^\s*([\s\S]*)$/.exec(string)[1];
};

Utils.rstrip = function(string) {
    return /^([\s\S]*?)\s*$/.exec(string)[1];
};

Utils.formatDate = function(date, now) {
    if (now == null)
        now = new Date();
    var daysAgo = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
    if (daysAgo < 0 && now.getDate() != date.getDate())
        return date.toLocaleDateString();
    else if (daysAgo < 1 && now.getDate() == date.getDate())
        return date.toLocaleTimeString();
    else if (daysAgo < 7 && now.getDay() != date.getDay())
        return ['Sun', 'Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()] + " " + date.toLocaleTimeString();
    else
        return date.toLocaleDateString();
};

//
// MODULE: Bug
//

var Bug = {};

// Until 2009-04, Bugzilla would use symbolic abbrevations for timezones in the XML output.
// Afterwords it was switched to a UTC offset. We handle some of the more likely to be
// encountered symbolic timezeones. Anything else is just handled as if it was UTC.
// See: https://bugzilla.mozilla.org/show_bug.cgi?id=487865
Bug.TIMEZONES = {
    CEST: 200,
    CET:  100,
    BST:  100,
    GMT:  000,
    UTC:  000,
    EDT: -400,
    EST: -500,
    CDT: -500,
    CST: -600,
    MDT: -600,
    MST: -700,
    PDT: -700,
    PST: -800
};

Bug.parseDate = function(d) {
    var m = /^\s*(\d+)-(\d+)-(\d+)\s+(\d+):(\d+)(?::(\d+))?\s+(?:([A-Z]{3,})|([-+]\d{3,}))\s*$/.exec(d);
    if (!m)
        return null;

    var year = parseInt(m[1], 10);
    var month = parseInt(m[2] - 1, 10);
    var day = parseInt(m[3], 10);
    var hour = parseInt(m[4], 10);
    var minute = parseInt(m[5], 10);
    var second = m[6] ? parseInt(m[6], 10) : 0;

    var tzoffset = 0;
    if (m[7]) {
        if (m[7] in Bug.TIMEZONES)
            tzoffset = Bug.TIMEZONES[m[7]];
    } else {
        tzoffset = parseInt(m[8], 10);
    }

    var unadjustedDate = new Date(Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]));

    // 430 => 4:30. Easier to do this computation for only positive offsets
    var sign = tzoffset < 0 ? -1 : 1;
    tzoffset *= sign;
    var adjustmentHours = Math.floor(tzoffset/100);
    var adjustmentMinutes = tzoffset - adjustmentHours * 100;

    return new Date(unadjustedDate.getTime() -
                    sign * adjustmentHours * 3600000 -
                    sign * adjustmentMinutes * 60000);
};

Bug._formatWho = function(name, email) {
    if (name && email)
        return name + " <" + email + ">";
    else if (name)
        return name;
    else
        return email;
};

Bug.Attachment = function(bug, id) {
    this._init(bug, id);
};

Bug.Attachment.prototype = {
    _init : function(bug, id) {
        this.bug = bug;
        this.id = id;
    }
};

Bug.Comment = function(bug) {
    this._init(bug);
};

Bug.Comment.prototype = {
    _init : function(bug) {
        this.bug = bug;
    },

    getWho : function() {
        return Bug._formatWho(this.whoName, this.whoEmail);
    }
};

Bug.Bug = function() {
    this._init();
};

Bug.Bug.prototype = {
    _init : function() {
        this.attachments = [];
        this.comments = [];
    },

    getAttachment : function(attachmentId) {
        for (i = 0; i < this.attachments.length; i++) {
            var attachment = theBug.attachments[i];
            if (attachment.id == attachmentId)
                return attachment;
            }

        return null;
    },

    getReporter : function() {
        return Bug._formatWho(this.reporterName, this.reporterEmail);
    }
};

// In the browser environment we use JQuery to parse the DOM tree
// for the XML document for the bug
Bug.Bug.fromDOM = function(xml) {
    var bug = new Bug.Bug();

    $(xml).children('bugzilla').children('bug').each(function() {
        bug.id = parseInt($(this).children('bug_id').text());
        bug.token = $(this).children('token').text();
        bug.shortDesc = Utils.strip($(this).children('short_desc').text());
        bug.creationDate = Bug.parseDate($(this).children('creation_ts').text());

        $(this).children('reporter').each(function() {
            bug.reporterEmail = Utils.strip($(this).text());
            bug.reporterName = Utils.strip($(this).attr('name'));
        });
        $(this).children('long_desc').each(function() {
            var comment = new Bug.Comment(bug);

            $(this).children('who').each(function() {
                comment.whoEmail = Utils.strip($(this).text());
                comment.whoName = Utils.strip($(this).attr('name'));
            });
            comment.date = Bug.parseDate($(this).children('bug_when').text());
            comment.text = $(this).children('thetext').text();

            bug.comments.push(comment);
        });
        $(this).children('attachment').each(function() {
            var attachid = parseInt($(this).children('attachid').text());
            var attachment = new Bug.Attachment(bug, attachid);

            attachment.description = Utils.strip($(this).children('desc').text());
            attachment.filename = Utils.strip($(this).children('filename').text());
            attachment.date = Bug.parseDate($(this).children('date').text());
            attachment.status = Utils.strip($(this).children('status').text());
            if (attachment.status == "")
                attachment.status = null;
            attachment.token = Utils.strip($(this).children('token').text());
            if (attachment.token == "")
                attachment.token = null;
            attachment.isPatch = $(this).attr('ispatch') == "1";
            attachment.isObsolete = $(this).attr('isobsolete') == "1";
            attachment.isPrivate = $(this).attr('isprivate') == "1";

            bug.attachments.push(attachment);
        });
    });

    return bug;
};

//
// MODULE: Dialog
//

var Dialog = {};

/* This is a simple "lightboxed" modal dialog. The only reason I wrote it was
 * so that the the "Cancel" button for a review wouldn't put up a:
 *
 * 'Really discard your changes?' [ OK ] [ Cancel ]
 *
 * dialog with Cancel meaning the opposite thing as the first Cancel - that's
 * what you'd get with window.confirm(). Maybe it has other uses.
 *
 * Usage is:
 *
 *  var dialog = new Dialog(<prompt>, <button_label1>, <callback1>)
 *  dialog.show();
 *  dialog.focus(<button_label1>)
 */

Dialog.Dialog = function() {
    this._init.apply(this, arguments);
};

Dialog.Dialog.prototype = {
    _init: function(prompt) {
        var q = $("<div id='modalContainer' style='display: none;'>"
                  + "<div id='modalBackground' style='display: none;'></div>"
                  + "<table>"
                  + "<tr><td>"
                  + "<div id='dialog'>"
                  + "<div id='dialogText'></div>"
                  + "<div id='dialogButtons'></div>"
                  + "<div class='clear'></div>"
                  + "</div>"
                  + "</td></tr>"
                  + "</table>"
                  + "</div>")
                      .find("#dialogText").text(prompt).end()
                      .appendTo(document.body);

        this.div = q.get(0);

        if (arguments.length % 2 != 1)
            throw new Error("Must be an even number of label/callback pairs");

        for (var i = 1; i < arguments.length; i += 2) {
            this.addButton(arguments[i], arguments[i + 1]);
        }

        var me = this;
        this._keypress = function(e) {
            if (e.keyCode == 27)
                me.destroy();
        };
        $("body").keypress(this._keypress);
    },

    addButton: function(label, callback) {
        var me = this;
        $("<input type='button' />")
            .val(label)
            .click(function() {
                       me.destroy();
                       callback();
                   })
            .appendTo($(this.div).find("#dialogButtons"));
    },

    destroy: function() {
        $(this.div).remove();
        $("body").unbind('keypress', this._keypress);
    },

    focus: function(label) {
        $(this.div).find('input[value=' + label + ']').focus();
    },

    show: function() {
        $(this.div).show();
        $(this.div).find("#modalBackground").fadeIn(250);
    }
};

//
// MODULE: Patch
//

var Patch = {};

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
Patch.ADDED         = 1 << 0; // Part of a pure addition segment
Patch.REMOVED       = 1 << 1; // Part of a pure removal segment
Patch.CHANGED       = 1 << 2; // Part of some other segmnet
Patch.NEW_NONEWLINE = 1 << 3; // Old line doesn't end with \n
Patch.OLD_NONEWLINE = 1 << 4; // New line doesn't end with \n

Patch.Hunk = function(oldStart, oldCount, newStart, newCount, functionLine, text) {
    this._init(oldStart, oldCount, newStart, newCount, functionLine, text);
};

Patch.Hunk.prototype = {
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
        // unchanged lines. We make the classification of Patch.ADDED/Patch.REMOVED/Patch.CHANGED
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
                        lines[j][2] &= ~(Patch.ADDED | Patch.REMOVED);
                        lines[j][2] |= Patch.CHANGED;
                    }
                }

                currentStart = -1;
                currentOldCount = 0;
                currentNewCount = 0;
            }
        }

        for (var i = 0; i < rawlines.length; i++) {
            var line = rawlines[i];
            var op = line.substr(0, 1);
            var strippedLine = line.substring(1);
            var noNewLine = 0;
            if (i + 1 < rawlines.length && rawlines[i + 1].substr(0, 1) == '\\') {
                noNewLine = op == '-' ? Patch.OLD_NONEWLINE : Patch.NEW_NONEWLINE;
            }

            if (op == ' ') {
                endSegment();
                totalOld++;
                totalNew++;
                lines.push([strippedLine, strippedLine, 0]);
            } else if (op == '-') {
                totalOld++;
                startSegment();
                lines.push([strippedLine, null, Patch.REMOVED | noNewLine]);
                currentOldCount++;
            } else if (op == '+') {
                totalNew++;
                startSegment();
                if (currentStart + currentNewCount >= lines.length) {
                    lines.push([null, strippedLine, Patch.ADDED | noNewLine]);
                } else {
                    lines[currentStart + currentNewCount][1] = strippedLine;
                    lines[currentStart + currentNewCount][2] |= Patch.ADDED | noNewLine;
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
            lines[lines.length - 1][0].substr(0, 1) == '-')
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

Patch.File = function(filename, status, hunks) {
    this._init(filename, status, hunks);
};

Patch.File.prototype = {
    _init : function(filename, status, hunks) {
        this.filename = filename;
        this.status = status;
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
            if (newLine != null && hunk.newStart > newLine)
                continue;

            if ((oldLine != null && oldLine < hunk.oldStart + hunk.oldCount) ||
                (newLine != null && newLine < hunk.newStart + hunk.newCount)) {
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
        return "Patch.File(" + this.filename + ")";
    }
};

Patch._cleanIntro = function(intro) {
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
};

// Matches the start unified diffs for a file as produced by different version control tools
Patch.FILE_START_RE = /^(?:(?:Index|index|===|RCS|diff).*\n)*---[ \t]*(\S+).*\n\+\+\+[ \t]*(\S+).*\n(?=@@)/mg;

// Hunk start: @@ -23,12 +30,11 @@
// Followed by: lines beginning with [ +\-]
Patch.HUNK_RE = /^@@[ \t]+-(\d+),(\d+)[ \t]+\+(\d+),(\d+)[ \t]+@@(.*)\n((?:[ +\\-].*\n)*)/mg;

Patch.Patch = function(text) {
    this._init(text);
};

Patch.Patch.prototype = {
    // cf. parsing in Review.Review.parse()
    _init : function(text) {
        // Canonicalize newlines to simplify the following
        if (/\r/.test(text))
            text = text.replace(/(\r\n|\r|\n)/g, "\n");

        this.files = [];

        var m = Patch.FILE_START_RE.exec(text);
        if (m != null)
            this.intro = Patch._cleanIntro(text.substring(0, m.index));
        else
            throw "Not a patch";

        while (m != null) {
            // git and hg show a diff between a/foo/bar.c and b/foo/bar.c
            // or between a/foo/bar.c and /dev/null for removals and the
            // reverse for additions.
            var filename;
            var status = undefined;

            if (/^a\//.test(m[1]) && /^b\//.test(m[2])) {
                filename = m[1].substring(2);
                status = Patch.CHANGED;
            } else if (/^a\//.test(m[1]) && /^\/dev\/null/.test(m[2])) {
                filename = m[1].substring(2);
                status = Patch.REMOVED;
            } else if (/^\/dev\/null/.test(m[1]) && /^b\//.test(m[2])) {
                filename = m[2].substring(2);
                status = Patch.ADDED;
            } else {
                filename = m[1];
            }

            var hunks = [];
            var pos = Patch.FILE_START_RE.lastIndex;
            while (true) {
                Patch.HUNK_RE.lastIndex = pos;
                var m2 = Patch.HUNK_RE.exec(text);
                if (m2 == null || m2.index != pos)
                    break;

                pos = Patch.HUNK_RE.lastIndex;
                var oldStart = parseInt(m2[1]);
                var oldCount = parseInt(m2[2]);
                var newStart = parseInt(m2[3]);
                var newCount = parseInt(m2[4]);

                hunks.push(new Patch.Hunk(oldStart, oldCount, newStart, newCount, m2[5], m2[6]));
            }

            if (status === undefined) {
                // For non-Hg/Git we use assume patch was generated non-zero context
                // and just look at the patch to detect added/removed. Bzr actually
                // says added/removed in the diff, but SVN/CVS don't
                if (hunks.length == 1 && hunks[0].oldCount == 0)
                    status = Patch.ADDED;
                else if (hunks.length == 1 && hunks[0].newCount == 0)
                    status = Patch.REMOVED;
                else
                    status = Patch.CHANGED;
            }

            this.files.push(new Patch.File(filename, status, hunks));

            Patch.FILE_START_RE.lastIndex = pos;
            m = Patch.FILE_START_RE.exec(text);
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

//
// MODULE: Review
//

var Review = {};

Review._removeFromArray = function(a, element) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] === element) {
            a.splice(i, 1);
            return;
        }
    }
};

Review.Comment = function(file, location, type, comment) {
    this._init(file, location, type, comment);
};

Review.Comment.prototype = {
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
        Review._removeFromArray(this.file.comments, this);
        Review._removeFromArray(line.reviewComments, this);
    }
};

Review._noNewLine = function(flags, flag) {
    return ((flags & flag) != 0) ? "\n\ No newline at end of file" : "";
};

Review._lineInSegment = function(line) {
    return (line[2] & (Patch.ADDED | Patch.REMOVED | Patch.CHANGED)) != 0;
};

Review._compareSegmentLines = function(a, b) {
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
};

Review.File = function(review, patchFile) {
    this._init(review, patchFile);
};

Review.File.prototype = {
    _init : function(review, patchFile) {
        this.review = review;
        this.patchFile = patchFile;
        this.comments = [];
    },

    addComment : function(location, type, comment) {
        var hunk = this.patchFile.getHunk(location);
        var line = hunk.lines[location - hunk.location];
        comment = new Review.Comment(this, location, type, comment);
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
            if (Review._lineInSegment(hunk.lines[contextFirst])) {
                while (contextFirst > 0 && Review._lineInSegment(hunk.lines[contextFirst - 1]))
                    contextFirst--;
            }

            var j;
            for (j = 0; j < 2; j++)
                if (contextFirst > 0 && !Review._lineInSegment(hunk.lines[contextFirst - 1]))
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
                                     patchLines.push(' ' + oldText + Review._noNewLine(flags, Patch.OLD_NONEWLINE | Patch.NEW_NONEWLINE));
                                     addOldLine(oldLine);
                                     addNewLine(newLine);
                                     unchangedLines++;
                                 } else {
                                     if ((comment.type == Patch.REMOVED || comment.type == Patch.CHANGED) && oldText != null) {
                                         patchLines.push('-' + oldText +Review._noNewLine(flags, Patch.OLD_NONEWLINE));
                                         addOldLine(oldLine);
                                     }
                                     if ((comment.type == Patch.ADDED || comment.type == Patch.CHANGED) && newText != null) {
                                         patchLines.push('+' + newText + Review._noNewLine(flags, Patch.NEW_NONEWLINE));
                                         addNewLine(newLine);
                                     }
                                 }
                             }
                         });

            // Sort them into global order ' ', '-', '+'
            patchLines.sort(Review._compareSegmentLines);

            // Completely blank context isn't useful so remove it; however if we are commenting
            // on blank lines at the start of a segment, we have to leave something or things break
            while (patchLines.length > 1 && patchLines[0].match(/^\s*$/)) {
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

Review.Review = function(patch, who, date) {
    this._init(patch, who, date);
};

// Indicates start of review comments about a file
// ::: foo/bar.c
Review.FILE_START_RE = /^:::[ \t]+(\S+)[ \t]*\n/mg;


// This is like Patch.HUNK_RE for the starting line, but differs in that it
// includes trailing lines that are not patch lines up to the next hunk or file
// (the trailing lines will be split out as the coment.)
//
// Hunk start: @@ -23,12 +30,11 @@
// Followed by: lines that don't start with @@ or :::
Review.HUNK_RE = /^@@[ \t]+(?:-(\d+),(\d+)[ \t]+)?(?:\+(\d+),(\d+)[ \t]+)?@@.*\n((?:(?!@@|:::).*\n?)*)/mg;

Review.Review.prototype = {
    _init : function(patch, who, date) {
        this.date = null;
        this.patch = patch;
        this.who = who;
        this.date = date;
        this.intro = null;
        this.files = [];

        for (var i = 0; i < patch.files.length; i++) {
            this.files.push(new Review.File(this, patch.files[i]));
        }
    },

    // cf. parsing in Patch.Patch._init()
    parse : function(text) {
	Review.FILE_START_RE.lastIndex = 0;
        var m = Review.FILE_START_RE.exec(text);

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
                throw "Review.Review refers to filename '" + filename + "' not in reviewed Patch.";

            var pos = Review.FILE_START_RE.lastIndex;

            while (true) {
                Review.HUNK_RE.lastIndex = pos;
                var m2 = Review.HUNK_RE.exec(text);
                if (m2 == null || m2.index != pos)
                    break;

                pos = Review.HUNK_RE.lastIndex;

                var oldStart, oldCount, newStart, newCount;
                if (m2[1]) {
                    oldStart = parseInt(m2[1]);
                    oldCount = parseInt(m2[2]);
                } else {
                    oldStart = oldCount = null;
                }

                if (m2[3]) {
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

            Review.FILE_START_RE.lastIndex = pos;
            m = Review.FILE_START_RE.exec(text);
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

//
// MODULE: ReviewStorage
//

var ReviewStorage = {};

/* The ReviewStorage 'interface' has the following methods:
 *
 *  listReviews()
 *    Returns an array of objects with the following properties:
 *      bugId
 *      bugShortDesc
 *      attachmentId
 *      attachmentDescription
 *      creationTime
 *      modificationTime
 *      isDraft
 *  loadDraft(bug, attachment, patch)
 *  saveDraft(bug, attachment, review)
 *  draftPublished(bug, attachment)
 */

ReviewStorage.LocalReviewStorage = function() {
    this._init();
};

ReviewStorage.LocalReviewStorage.available = function() {
    // The try is a workaround for
    //   https://bugzilla.mozilla.org/show_bug.cgi?id=517778
    // where if cookies are disabled or set to ask, then the first attempt
    // to access the localStorage property throws a security error.
    try {
        return 'localStorage' in window && window.localStorage != null;
    } catch (e) {
        return false;
    }
};

ReviewStorage.LocalReviewStorage.prototype = {
    _init : function() {
        var reviewInfosText = localStorage.splinterReviews;
        if (reviewInfosText == null)
            this._reviewInfos = [];
        else
            this._reviewInfos = JSON.parse(reviewInfosText);
    },

    listReviews : function() {
        return this._reviewInfos;
    },

    _reviewPropertyName : function(bug, attachment) {
        return 'splinterReview_' + bug.id + '_' + attachment.id;
    },

    loadDraft : function(bug, attachment, patch) {
        var propertyName = this._reviewPropertyName(bug, attachment);
        var reviewText = localStorage[propertyName];
        if (reviewText != null) {
            var review = new Review.Review(patch);
            review.parse(reviewText);
            return review;
        } else {
            return null;
        }
    },

    _findReview : function(bug, attachment) {
        for (var i = 0 ; i < this._reviewInfos.length; i++)
            if (this._reviewInfos[i].bugId == bug.id && this._reviewInfos[i].attachmentId == attachment.id)
                return i;

        return -1;
    },

    _updateOrCreateReviewInfo : function(bug, attachment, props) {
        var reviewIndex = this._findReview(bug, attachment);
        var reviewInfo;

        var nowTime = Date.now();
        if (reviewIndex >= 0) {
            reviewInfo = this._reviewInfos[reviewIndex];
            this._reviewInfos.splice(reviewIndex, 1);
        } else {
            reviewInfo = {
                bugId: bug.id,
                bugShortDesc: bug.shortDesc,
                attachmentId: attachment.id,
                attachmentDescription: attachment.description,
                creationTime: nowTime
            };
        }

        reviewInfo.modificationTime = nowTime;
        for (var prop in props)
            reviewInfo[prop] = props[prop];

        this._reviewInfos.push(reviewInfo);
        localStorage.splinterReviews = JSON.stringify(this._reviewInfos);
    },

    _deleteReviewInfo : function(bug, attachment) {
        var reviewIndex = this._findReview(bug, attachment);
        if (reviewIndex >= 0) {
            this._reviewInfos.splice(reviewIndex, 1);
            localStorage.splinterReviews = JSON.stringify(this._reviewInfos);
        }
    },

    saveDraft : function(bug, attachment, review) {
        var propertyName = this._reviewPropertyName(bug, attachment);

        this._updateOrCreateReviewInfo(bug, attachment, { isDraft: true });
        localStorage[propertyName] = "" + review;
    },

    deleteDraft : function(bug, attachment, review) {
        var propertyName = this._reviewPropertyName(bug, attachment);

        this._deleteReviewInfo(bug, attachment);
        delete localStorage[propertyName];
    },

    draftPublished : function(bug, attachment) {
        var propertyName = this._reviewPropertyName(bug, attachment);

        this._updateOrCreateReviewInfo(bug, attachment, { isDraft: false });
        delete localStorage[propertyName];
    }
};

//
// MODULE: XmlRpc
//

var XmlRpc = {};

// This is a reasonably accurate implementation of the XML-RPC specification, except
// for the data types that aren't implemented. Places where parsing isn't fully
// validating:
//
//  * Element children of elements that are supposed to have only text content
//     are ignored.
//  * Trailing junk on integers and doubles is ignored
//  * integer elements that are out of 32-bit range are accepted

XmlRpc._appendValue = function(doc, parent, value) {
    var valueElement = doc.createElement('value');
    parent.appendChild(valueElement);

    var element;
    switch (typeof(value)) {
    case 'boolean':
        element = doc.createElement('boolean');
        element.appendChild(doc.createTextNode(value ? '1' : '0'));
        break;
    case 'object':
        if (value instanceof Date) {
            throw new Error("Date values not yet implemented");
        } else if (value instanceof Array) {
            throw new Error("Array values not yet implemented");
        } else {
            element = doc.createElement('struct');
            for (var i in value) {
                var memberElement = doc.createElement('member');
                var nameElement = doc.createElement('name');
                nameElement.appendChild(doc.createTextNode(i));
                memberElement.appendChild(nameElement);
                var vElement = doc.createElement('value');
                XmlRpc._appendValue(doc, vElement, value[i]);
                memberElement.appendChild(vElement);
                element.appendChild(memberElement);
            }
        }
        break;
    case 'number':
        if (Math.round(value) == value &&
            value >= -0x8000000 && value <= 0x7fffffff)
            element = doc.createElement('int');
        else
            element = doc.createElement('double');
        element.appendChild(doc.createTextNode(value.toString()));
        break;
    case 'string':
        element = doc.createElement('string');
        element.appendChild(doc.createTextNode(value));
        break;
    default:
        throw new Error("Don't know how to handle value of type: " + typeof(value));
    }

    valueElement.appendChild(element);
};

XmlRpc._appendParam = function(doc, paramsElement, param) {
    var paramElement = doc.createElement('param');
    XmlRpc._appendValue(doc, paramElement, param);
    paramsElement.appendChild(paramElement);
};

XmlRpc.ParseError = function(message) {
    this.message = message;
};

XmlRpc.ParseError.prototype = {
    toString: function() {
        return "XmlRpc.ParseError: " + this.message;
    }
};

XmlRpc._parseValue = function(valueElement) {
    var text;
    var value;

    if (valueElement.firstChild == null || valueElement.firstChild.nextChild != null)
        throw new XmlRpc.ParseError("<value/> doesn't have a single child");

    var element = valueElement.firstChild;

    switch (element.tagName) {
    case 'boolean':
        text = Utils.strip(element.textContent);
        if (text == '0')
            value = false;
        else if (text == '1')
            value = true;
        else
            throw new XmlRpc.ParseError("<boolean/> should be 0 or 1");
        break;
    case 'double':
        text = Utils.strip(element.textContent);
        value = parseFloat(text);
        if (isNaN(value))
            throw new XmlRpc.ParseError("<double/> doesn't contain a floating point number");
        break;
    case 'int':
    case 'i4':
        text = Utils.strip(element.textContent);
        value = parseInt(text);
        if (isNaN(value))
            throw new XmlRpc.ParseError("<i4/> doesn't contain an integer");
        break;
    case 'struct':
        value = new Object();
        var member = element.firstChild;
        while (member){
            if (member.tagName != 'member')
                throw new XmlRpc.ParseError("<struct/> has childeren other than <member/>");

            var nameElement = member.firstChild;
            if (nameElement == null || nameElement.tagName != 'name')
                throw new XmlRpc.ParseError("<member/> doesn't have <name/> as the first element");

            var name = nameElement.textContent;

            var valueElement = nameElement.nextSibling;
            if (valueElement == null || valueElement.tagName != 'value')
                throw new XmlRpc.ParseError("<member/> doesn't have <value/> as the second element");

            value[name] = XmlRpc._parseValue(valueElement);

            if (valueElement.nextSibling != null)
                throw new XmlRpc.ParseError("<member/> has too many children");

            member = member.nextSibling;
        }
        break;
    case 'string':
        value = Utils.strip(element.textContent);
        break;
    case 'array':
    case 'base64':
    case 'dateTime.iso8601':
        throw new XmlRpc.ParseError("Support for <" + element.tagName + "/> not yet implemented");
    default:
        throw new XmlRpc.ParseError("Unknown value element <" + element.tagName + "/>");
    }

    return value;
};

XmlRpc._handleSuccess = function(options, xml) {
    try {
        var root = xml.documentElement;
        if (root.tagName != 'methodResponse')
            throw new XmlRpc.ParseError("Root isn't <methodResponse/>");

        if (root.firstChild.tagName == 'params' &&
            root.firstChild.nextSibling == null) {

            var param = root.firstChild.firstChild;
            if (param == null ||
                param.tagName != 'param' ||
                param.nextSibling != null)
                throw new XmlRpc.ParseError("<params/> element in response should have <param/> child");

            var value = param.firstChild;
            if (value == null ||
                value.tagName != 'value' ||
                value.nextSibling != null)
                throw new XmlRpc.ParseError("<param/> element in response doesn't have a single value as child");

            options.success(XmlRpc._parseValue(value));

        } else if (root.firstChild.tagName == 'fault' &&
                   root.firstChild.nextSibling == null) {

            var value = root.firstChild.firstChild;
            if (value == null ||
                value.tagName != 'value' ||
                value.nextSibling != null)
                throw new XmlRpc.ParseError("<fault/> element in response should have <value/> child");

            var struct = value.firstChild;
            if (struct == null ||
                struct.tagName != 'struct')
                throw new XmlRpc.ParseError("<value/> element in <fault/> should have <struct/> child");

            var faultStruct = XmlRpc._parseValue(value);

            var faultCode = faultStruct.faultCode;
            var faultString = faultStruct.faultString;

            //  XMLRPC::Lite gives faultCodes like 'Client' at times,
            //  so we don't check for integer, though the spec says
            //  the faultCode should always be an integer
            if (faultCode == null || typeof(faultString) != 'string')
                throw new XmlRpc.ParseError("fault structure should contain an [integer] faultCode and string faultString");

            options.fault(faultCode, faultString);

        } else {
            throw new XmlRpc.ParseError("Bad content of <methodResponse/>");
        }

    } catch (e) {
        if (e instanceof XmlRpc.ParseError)
            options.error(e.message);
        else
            throw e;
    }
};

XmlRpc.call = function(options) {
    var doc = document.implementation.createDocument(null, "methodCall", null);
    var methodNameElement = doc.createElement("methodName");
    methodNameElement.appendChild(doc.createTextNode(options.name));
    doc.documentElement.appendChild(methodNameElement);
    var paramsElement = doc.createElement("params");
    doc.documentElement.appendChild(paramsElement);

    if (options.params instanceof Array) {
        for (var i = 0; i < params.length; i++) {
            XmlRpc._appendParam(doc, paramsElement, options.params[i]);
        }
    } else if (options.params != null) {
        XmlRpc._appendParam(doc, paramsElement, options.params);
    }

    $.ajax({
               type: 'POST',
               url: options.url,
               contentType: 'text/xml',
               dataType: 'xml',
               data: (new XMLSerializer()).serializeToString(doc),
               error: function(xmlHttpRequest, textStatus, errorThrown) {
                   options.error(textStatus);
               },
               success: function(xml) {
                   XmlRpc._handleSuccess(options, xml);
               }
           });
};

//
// MODULE: Main
//

var reviewStorage;
var attachmentId;
var theBug;
var theAttachment;
var thePatch;
var theReview;

var reviewers = {};

var navigationLinks = {};

var updateHaveDraftTimeoutId;
var saveDraftTimeoutId;
var saveDraftNoticeTimeoutId;
var savingDraft = false;

var currentEditComment;

var ADD_COMMENT_SUCCESS = /<title>\s*Bug[\S\s]*processed\s*<\/title>/;
var UPDATE_ATTACHMENT_SUCCESS = /<title>\s*Changes\s+Submitted/;

function doneLoading() {
    $("#loading").hide();
    $("#helpLink").attr("href", configHelp);
    $("#credits").show();
}

function displayError(msg) {
    $("<p></p>")
        .text(msg)
        .appendTo("#error");
    $("#error").show();
    doneLoading();
}

function updateAttachmentStatus(attachment, newStatus, success, failure) {
    var data = {
        action: 'update',
        id: attachment.id,
        description: attachment.description,
        filename: attachment.filename,
        ispatch: attachment.isPatch ? 1 : 0,
        isobsolete: attachment.isObsolete ? 1 : 0,
        isprivate: attachment.isPrivate ? 1 : 0,
        'attachments.status': newStatus
    };

    if (attachment.token)
        data.token = attachment.token;

    $.ajax({
               data: data,
               dataType: 'text',
               error: function(xmlHttpRequest, textStatus, errorThrown) {
                   failure();
               },
               success: function(data, textStatus) {
                   if (data.search(UPDATE_ATTACHMENT_SUCCESS) != -1) {
                       success();
                   } else {
                       failure();
                   }
               },
               type: 'POST',
               url: "/attachment.cgi"
           });
}

function addComment(bug, comment, success, failure) {
    var data = {
        id: bug.id,
        comment: comment
    };

    if (bug.token)
        data.token = bug.token;

    $.ajax({
               data: data,
               dataType: 'text',
               error: function(xmlHttpRequest, textStatus, errorThrown) {
                   failure();
               },
               success: function(data, textStatus) {
                   if (data.search(ADD_COMMENT_SUCCESS) != -1) {
                       success();
                   } else {
                       failure();
                   }
               },
               type: 'POST',
               url: "/process_bug.cgi"
           });
}

function publishReview() {
    saveComment();
    theReview.setIntro($("#myComment").val());

    var newStatus = null;
    if (theAttachment.status && $("#attachmentStatus").val() != theAttachment.status) {
        newStatus = $("#attachmentStatus").val();
    }

    function success() {
        if (reviewStorage)
            reviewStorage.draftPublished(theBug, theAttachment);
        document.location = newPageUrl(theBug.id);
    }

    if (configHaveExtension) {
        var params = {
            attachment_id: theAttachment.id,
            review: theReview.toString()
        };

        if (newStatus != null)
            params['attachment_status'] = newStatus;

        XmlRpc.call({
                        url: '/xmlrpc.cgi',
                        name: 'Splinter.publish_review',
                        params: params,
                        error: function(message) {
                            displayError("Failed to publish review: " + message);
                        },
                        fault: function(faultCode, faultString) {
                            displayError("Failed to publish review: " + faultString);
                        },
                        success: function(result) {
                            success();
                        }
                    });
    } else {
        var comment = "Review of attachment " + attachmentId + ":\n\n" + theReview;
        addComment(theBug, comment,
                   function(detail) {
                       if (newStatus)
                           updateAttachmentStatus(theAttachment, newStatus,
                                                  success,
                                                  function() {
                                                      displayError("Published review; patch status could not be updated.");
                                                  });
                       else
                           success();
                   },
                   function(detail) {
                       displayError("Failed to publish review.");
                   });
    }
}

function doDiscardReview() {
    if (theAttachment.status)
        $("#attachmentStatus").val(theAttachment.status);

    $("#myComment").val("");
    $("#emptyCommentNotice").show();

    for (var i = 0; i  < theReview.files.length; i++) {
        while (theReview.files[i].comments.length > 0)
            theReview.files[i].comments[0].remove();
    }
    updateMyPatchComments();

    updateHaveDraft();
    saveDraft();
}

function discardReview() {
    var dialog = new Dialog.Dialog("Really discard your changes?",
                                   'Continue', function() {},
                                   'Discard', doDiscardReview);
    dialog.show();
    dialog.focus('Continue');
}

function haveDraft() {
    if (theAttachment.status && $("#attachmentStatus").val() != theAttachment.status)
        return true;

    if ($("#myComment").val().search(/\S/) >= 0)
        return true;

    for (var i = 0; i  < theReview.files.length; i++) {
        if (theReview.files[i].comments.length > 0)
            return true;
    }

    return false;
}

function updateHaveDraft() {
    clearTimeout(updateHaveDraftTimeoutId);
    updateHaveDraftTimeoutId = null;

    if (haveDraft()) {
        $("#publishButton").removeAttr('disabled');
        $("#cancelButton").removeAttr('disabled');
        $("#haveDraftNotice").show();
    } else {
        $("#publishButton").attr('disabled', 1);
        $("#cancelButton").attr('disabled', 1);
        $("#haveDraftNotice").hide();
    }
}

function queueUpdateHaveDraft() {
    if (updateHaveDraftTimeoutId == null)
        updateHaveDraftTimeoutId = setTimeout(updateHaveDraft, 0);
}

function hideSaveDraftNotice() {
    clearTimeout(saveDraftNoticeTimeoutId);
    saveDraftNoticeTimeoutId = null;
    $("#saveDraftNotice").hide();
}

function saveDraft() {
    if (reviewStorage == null)
        return;

    clearTimeout(saveDraftTimeoutId);
    saveDraftTimeoutId = null;

    savingDraft = true;
    $("#saveDraftNotice")
        .text("Saving Draft...")
        .show();
    clearTimeout(saveDraftNoticeTimeoutId);
    setTimeout(hideSaveDraftNotice, 3000);

    if (currentEditComment) {
        currentEditComment.comment = Utils.strip($("#commentEditor textarea").val());
        // Messy, we don't want the empty comment in the saved draft, so remove it and
        // then add it back.
        if (!currentEditComment.comment)
            currentEditComment.remove();
    }

    theReview.setIntro($("#myComment").val());

    var draftSaved = false;
    if (haveDraft()) {
        reviewStorage.saveDraft(theBug, theAttachment, theReview);
        draftSaved = true;
    } else {
        reviewStorage.deleteDraft(theBug, theAttachment, theReview);
    }

    if (currentEditComment && !currentEditComment.comment) {
        currentEditComment = currentEditComment.file.addComment(currentEditComment.location,
                                                                currentEditComment.type,
                                                                "");
    }

    savingDraft = false;
    if (draftSaved)
        $("#saveDraftNotice")
            .text("Saved Draft");
    else
        hideSaveDraftNotice();
}

function queueSaveDraft() {
    if (saveDraftTimeoutId == null)
        saveDraftTimeoutId = setTimeout(saveDraft, 10000);
}

function flushSaveDraft() {
    if (saveDraftTimeoutId != null)
        saveDraft();
}

function getQueryParams() {
    var query = window.location.search.substring(1);
    if (query == null || query == "")
        return {};

    var components = query.split(/&/);

    var params = {};
    var i;
    for (i = 0; i < components.length; i++) {
        var component = components[i];
        var m = component.match(/([^=]+)=(.*)/);
        if (m)
            params[m[1]] = decodeURIComponent(m[2]);
    }

    return params;
}

function ensureCommentArea(row) {
    var file = $(row).data('patchFile');
    var colSpan = file.status == Patch.CHANGED ? 5 : 2;
    if (!row.nextSibling || row.nextSibling.className != "comment-area")
        $("<tr class='comment-area'><td colSpan='" + colSpan + "'>"
          + "</td></tr>")
            .insertAfter(row);

    return row.nextSibling.firstChild;
}

function getTypeClass(type) {
    switch (type) {
    case Patch.ADDED:
        return "comment-added";
    case Patch.REMOVED:
        return "comment-removed";
    case Patch.CHANGED:
        return "comment-changed";
    }

    return null;
}

function getSeparatorClass(type) {
    switch (type) {
    case Patch.ADDED:
        return "comment-separator-added";
    case Patch.REMOVED:
        return "comment-separator-removed";
    }

    return null;
}

function getReviewerClass(review) {
    var reviewerIndex;
    if (review == theReview)
        reviewerIndex = 0;
    else
        reviewerIndex = (reviewers[review.who] - 1) % 5 + 1;

    return "reviewer-" + reviewerIndex;
}

function addCommentDisplay(commentArea, comment) {
    var review = comment.file.review;

    var separatorClass = getSeparatorClass(comment.type);
    if (separatorClass)
        $("<div></div>")
            .addClass(separatorClass)
            .addClass(getReviewerClass(review))
            .appendTo(commentArea);

    var q = $("<div class='comment'>"
      + "<div class='comment-frame'>"
      + "<div class='reviewer-box'>"
      + "<div class='comment-text'></div>"
      + "</div>"
      + "</div>"
      + "</div>")
        .find(".comment-text").preWrapLines(comment.comment).end()
        .addClass(getTypeClass(comment.type))
        .addClass(getReviewerClass(review))
        .appendTo(commentArea)
        .dblclick(function() {
                      saveComment();
                      insertCommentEditor(commentArea,
                                          comment.file.patchFile, comment.location, comment.type);
                  });

    if (review != theReview) {
        $("<div class='review-info'>"
          + "<div class='reviewer'></div><div class='review-date'></div>"
          + "<div class='review-info-bottom'></div>"
          + "</div>")
            .find(".reviewer").text(review.who).end()
            .find(".review-date").text(Utils.formatDate(review.date)).end()
            .appendTo(q.find(".reviewer-box"));
    }

    comment.div = q.get(0);
}

function saveComment() {
    var comment = currentEditComment;
    if (!comment)
        return;

    var commentEditor = $("#commentEditor").get(0);
    var commentArea = commentEditor.parentNode;
    var reviewFile = comment.file;

    var hunk = comment.getHunk();
    var line = hunk.lines[comment.location - hunk.location];

    var value = Utils.strip($(commentEditor).find("textarea").val());
    if (value != "") {
        comment.comment = value;
        addCommentDisplay(commentArea, comment);
    } else {
        comment.remove();
    }

    if (line.reviewComments.length > 0) {
        $("#commentEditor").remove();
        $("#commentEditorSeparator").remove();
    } else {
        $(commentArea).parent().remove();
    }

    currentEditComment = null;
    saveDraft();
    queueUpdateHaveDraft();
}

function cancelComment(previousText) {
    $("#commentEditor textarea").val(previousText);
    saveComment();
}

function deleteComment() {
    $("#commentEditor textarea").val("");
    saveComment();
}

function insertCommentEditor(commentArea, file, location, type) {
    saveComment();

    var reviewFile = theReview.getFile(file.filename);
    var comment = reviewFile.getComment(location, type);
    if (!comment) {
        comment = reviewFile.addComment(location, type, "");
        queueUpdateHaveDraft();
    }

    var previousText = comment.comment;

    var typeClass = getTypeClass(type);
    var separatorClass = getSeparatorClass(type);

    if (separatorClass)
        $(commentArea).find(".reviewer-0." + separatorClass).remove();
    $(commentArea).find(".reviewer-0." + typeClass).remove();

    if (separatorClass)
        $("<div class='commentEditorSeparator'></div>")
            .addClass(separatorClass)
            .appendTo(commentArea);
    $("<div id='commentEditor'>"
      + "<div id='commentEditorInner'>"
      + "<div id='commentTextFrame'>"
      + "<textarea></textarea>"
      + "</div>"
      + "<div id='commentEditorLeftButtons'>"
      + "<input id='commentCancel' type='button' value='Cancel' />"
      + "</div>"
      + "<div id='commentEditorRightButtons'>"
      + "<input id='commentSave' type='button'value='Save' />"
      + "</div>"
      + "<div class='clear'></div>"
      + "</div>"
      + "</div>")
        .addClass(typeClass)
        .find("#commentSave").click(saveComment).end()
        .find("#commentCancel").click(function() {
                                          cancelComment(previousText);
                                      }).end()
        .appendTo(commentArea)
        .find('textarea')
            .val(previousText)
            .keypress(function(e) {
                          if (e.which == 13 && e.ctrlKey)
                              saveComment();
                          else
                              queueSaveDraft();
                      })
            .focus(function() {
                       $("#commentEditor").addClass('focused');
                   })
            .blur(function() {
                      $("#commentEditor").removeClass('focused');
                  })
            .each(function() { this.focus(); });

    if (previousText)
        $("<input id='commentDelete' type='button' value='Delete' />")
            .click(deleteComment)
            .appendTo($("#commentEditorLeftButtons"));

    currentEditComment = comment;
}

function insertCommentForRow(clickRow, clickType) {
    var file = $(clickRow).data('patchFile');
    var clickLocation = $(clickRow).data('patchLocation');

    var row = clickRow;
    var location = clickLocation;
    var type = clickType;

    saveComment();
    var commentArea = ensureCommentArea(row);
    insertCommentEditor(commentArea, file, location, type);
}

function EL(element, cls, text) {
    var e = document.createElement(element);
    if (text != null)
        e.appendChild(document.createTextNode(text));
    if (cls)
        e.className = cls;

    return e;
}

function getElementPosition(element) {
    var left = element.offsetLeft;
    var top = element.offsetTop;
    var parent = element.offsetParent;
    while (parent && parent != document.body) {
        left += parent.offsetLeft;
        top += parent.offsetTop;
        parent = parent.offsetParent;
    }

    return [left, top];
}

function scrollToElement(element) {
    var windowHeight;
    if ('innerHeight' in window) // Not IE
        windowHeight = window.innerHeight;
    else // IE
        windowHeight = document.documentElement.clientHeight;
    var pos = getElementPosition(element);
    var yCenter = pos[1] + element.offsetHeight / 2;
    window.scrollTo(0, yCenter - windowHeight / 2);
}

function onRowDblClick(e) {
    var file = $(this).data('patchFile');

    if (file.status == Patch.CHANGED) {
        var pos = getElementPosition(this);
        var delta = e.pageX - (pos[0] + this.offsetWidth/2);
        var type;
        if (delta < - 20)
        type = Patch.REMOVED;
        else if (delta < 20)
        type = Patch.CHANGED;
        else
            type = Patch.ADDED;
    } else {
        type = file.status;
    }

    insertCommentForRow(this, type);
}

function appendPatchTable(type, maxLine, parentDiv) {
    var q = $("<table class='file-table'><colgroup></colgroup>"
              + "</table>").appendTo(parentDiv);
    var colQ = q.find("colgroup");
    if (type != Patch.ADDED) {
        colQ.append("<col class='line-number-column' span='1'></col>");
        colQ.append("<col class='old-column' span='1'></col>");
    }
    if (type == Patch.CHANGED) {
        colQ.append("<col class='middle-column' span='1'></col>");
    }
    if (type != Patch.REMOVED) {
        colQ.append("<col class='line-number-column' span='1'></col>");
        colQ.append("<col class='new-column' span='1'></col");
    }

    if (type == Patch.CHANGED)
        q.addClass("file-table-changed");

    if (maxLine >= 1000)
        q.addClass("file-table-wide-numbers");

    q.append("<tbody></tbody>");
    return q.find("tbody").get(0);
}

function appendPatchHunk(file, hunk, tableType, includeComments, clickable, tbody, filter) {
    hunk.iterate(function(loc, oldLine, oldText, newLine, newText, flags, line) {
                     if (filter && !filter(loc))
                         return;

                     var tr = document.createElement("tr");

                     var oldStyle = "";
                     var newStyle = "";
                     if ((flags & Patch.CHANGED) != 0)
                         oldStyle = newStyle = "changed-line";
                     else if ((flags & Patch.REMOVED) != 0)
                         oldStyle = "removed-line";
                     else if ((flags & Patch.ADDED) != 0)
                         newStyle = "added-line";

                     if (tableType != Patch.ADDED) {
                         if (oldText != null) {
                             tr.appendChild(EL("td", "line-number", oldLine.toString()));
                             tr.appendChild(EL("td", "old-line " + oldStyle,
                                               oldText != "" ? oldText : "\u00a0"));
                             oldLine++;
                         } else {
                             tr.appendChild(EL("td", "line-number"));
                             tr.appendChild(EL("td", "old-line"));
                         }
                     }

                     if (tableType == Patch.CHANGED)
                         tr.appendChild(EL("td", "line-middle"));

                     if (tableType != Patch.REMOVED) {
                         if (newText != null) {
                             tr.appendChild(EL("td", "line-number", newLine.toString()));
                             tr.appendChild(EL("td", "new-line " + newStyle,
                                               newText != "" ? newText : "\u00a0"));
                             newLine++;
                         } else if (tableType == Patch.CHANGED) {
                             tr.appendChild(EL("td", "line-number"));
                             tr.appendChild(EL("td", "new-line"));
                         }
                     }

                     if (clickable){
                         $(tr).data('patchFile', file);
                         $(tr).data('patchLocation', loc);
                         $(tr).dblclick(onRowDblClick);
                     }

                     tbody.appendChild(tr);

                     if (includeComments && line.reviewComments != null)
                         for (var k = 0; k < line.reviewComments.length; k++) {
                             var commentArea = ensureCommentArea(tr);
                             addCommentDisplay(commentArea, line.reviewComments[k]);
                         }
                 });
}

function addPatchFile(file) {
    var fileDiv = $("<div class='file'></div>").appendTo("#files").get(0);
    file.div = fileDiv;

    var statusString;
    switch (file.status) {
    case Patch.ADDED:
        statusString = " (new file)";
	break;
    case Patch.REMOVED:
        statusString = " (removed)";
	break;
    case Patch.CHANGED:
        statusString = "";
	break;
    }

    $("<div class='file-label'>"
      + "<span class='file-label-name'></span>"
      + "<span class='file-label-status'></span>"
      + "</div/>")
        .find(".file-label-name").text(file.filename).end()
        .find(".file-label-status").text(statusString).end()
        .appendTo(fileDiv);

    var lastHunk = file.hunks[file.hunks.length -1];
    var lastLine = Math.max(lastHunk.oldStart + lastHunk.oldCount- 1,
                            lastHunk.newStart + lastHunk.newCount- 1);

    var tbody = appendPatchTable(file.status, lastLine, fileDiv);

    for (var i = 0; i  < file.hunks.length; i++) {
        var hunk = file.hunks[i];
        if (hunk.oldStart > 1) {
            var hunkHeader = EL("tr", "hunk-header");
            tbody.appendChild(hunkHeader);
            hunkHeader.appendChild(EL("td")); // line number column
            var hunkCell = EL("td", "hunk-cell",
                              hunk.functionLine ? hunk.functionLine : "\u00a0");
            hunkCell.colSpan = file.status == Patch.CHANGED ? 4 : 1;
            hunkHeader.appendChild(hunkCell);
        }

        appendPatchHunk(file, hunk, file.status, true, true, tbody);
    }
}

function appendReviewComment(comment, parentDiv) {
    var commentDiv = EL("div", "review-patch-comment");
    $(commentDiv).click(function() {
                            showPatchFile(comment.file.patchFile);
                            if (comment.file.review == theReview) {
                                // Immediately start editing the comment again
                                var commentArea = $(comment.div).parents(".comment-area").find("td").get(0);
                                insertCommentEditor(commentArea,
                                                    comment.file.patchFile, comment.location, comment.type);
                                scrollToElement($("#commentEditor").get(0));
                            } else {
                                // Just scroll to the comment, don't start a reply yet
                                scrollToElement(comment.div);
                            }
                        });

    var inReplyTo = comment.getInReplyTo();
    if (inReplyTo) {
        $("<div>"
          + "<div class='reviewer-box'>"
          + "</div>"
          + "</div>")
            .addClass(getReviewerClass(inReplyTo.file.review))
            .find(".reviewer-box").preWrapLines(inReplyTo.comment).end()
            .appendTo(commentDiv);

        $("<div class='review-patch-comment-text'></div>")
            .preWrapLines(comment.comment)
            .appendTo(commentDiv);
    } else {
        var hunk = comment.getHunk();

        var lastLine = Math.max(hunk.oldStart + hunk.oldCount- 1,
                                hunk.newStart + hunk.newCount- 1);
        var tbody = appendPatchTable(comment.type, lastLine, commentDiv);

        appendPatchHunk(comment.file.patchFile, hunk, comment.type, false, false, tbody,
                        function(loc) {
                            return (loc <= comment.location && comment.location - loc < 3);
                        });
        $("<tr>"
          + "<td></td>"
          + "<td class='review-patch-comment-text'></td>"
          + "</tr>")
            .find('.review-patch-comment-text').preWrapLines(comment.comment).end()
            .appendTo(tbody);
    }

    parentDiv.appendChild(commentDiv);
}

function appendReviewComments(review, parentDiv) {
    for (var i = 0; i < review.files.length; i++) {
        var file = review.files[i];

        if (file.comments.length == 0)
            continue;

        parentDiv.appendChild(EL("div", "review-patch-file", file.patchFile.filename));
        var firstComment = true;
        for (var j = 0; j < file.comments.length; j++) {
            if (firstComment)
                firstComment = false;
            else
                parentDiv.appendChild(EL("div", "review-patch-comment-separator"));

            appendReviewComment(file.comments[j], parentDiv);
        }
    }
}

function updateMyPatchComments() {
    appendReviewComments(theReview, $("#myPatchComments").empty().get(0));
    if ($("#myPatchComments").children().size() > 0)
        $("#myPatchComments").show();
    else
        $("#myPatchComments").hide();
}

function selectNavigationLink(identifier) {
    $(".navigation-link").removeClass("navigation-link-selected");
    $(navigationLinks[identifier]).addClass("navigation-link-selected");
}

function addNavigationLink(identifier, title, callback, selected) {
    if ($("#navigation").children().size() > 0)
        $("#navigation").append(" | ");

    var q = $("<a class='navigation-link' href='javascript:void(0)'></a>")
        .text(title)
        .appendTo("#navigation")
        .click(function() {
                   if (!$(this).hasClass("navigation-link-selected")) {
                       callback();
                   }
               });

    if (selected)
        q.addClass("navigation-link-selected");

    navigationLinks[identifier] = q.get(0);
}

function showOverview() {
    selectNavigationLink('__OVERVIEW__');
    $("#overview").show();
    $(".file").hide();
    updateMyPatchComments();
}

function addOverviewNavigationLink() {
    addNavigationLink('__OVERVIEW__', "Overview", showOverview, true);
}

function showPatchFile(file) {
    selectNavigationLink(file.filename);
    $("#overview").hide();
    $(".file").hide();
    if (file.div)
        $(file.div).show();
    else
        addPatchFile(file);
}

function addFileNavigationLink(file) {
    var basename = file.filename.replace(/.*\//, "");
    addNavigationLink(file.filename, basename, function() {
        showPatchFile(file);
    });
}

var REVIEW_RE = /^\s*review\s+of\s+attachment\s+(\d+)\s*:\s*/i;

function start(xml) {
    var i;

    document.title = "Attachment " + theAttachment.id + " - " + theAttachment.description + " - Patch Review";

    doneLoading();
    $("#attachmentInfo").show();
    $("#navigation").show();
    $("#overview").show();
    $("#files").show();

    $("#subtitle").text("Attachment " + theAttachment.id + " - " + theAttachment.description);
    $("<a></a>")
        .text("Bug " + theBug.id)
        .attr('href', newPageUrl(theBug.id))
        .attr('title', theBug.shortDesc)
        .click(flushSaveDraft)
        .appendTo("#information");

    for (i = 0; i < configAttachmentStatuses.length; i++) {
        $("<option></option") .text(configAttachmentStatuses[i])
        .appendTo($("#attachmentStatus")); }

    if (theAttachment.status != null)
        $("#attachmentStatus")
            .val(theAttachment.status)
            .change(queueUpdateHaveDraft);
    else
        $("#attachmentStatusSpan").hide();

    if (thePatch.intro)
        $("#patchIntro").preWrapLines(thePatch.intro);
    else
        $("#patchIntro").hide();

    addOverviewNavigationLink();
    for (i = 0; i < thePatch.files.length; i++)
        addFileNavigationLink(thePatch.files[i]);

    $("<div id='haveDraftNotice'style='display: none;'>Draft</div>"
      + "<div class='clear'></div>").appendTo("#navigation");

    var numReviewers = 0;
    for (i = 0; i < theBug.comments.length; i++) {
        var comment = theBug.comments[i];
        var m = REVIEW_RE.exec(comment.text);

        if (m && parseInt(m[1]) == attachmentId) {
            var review = new Review.Review(thePatch, comment.getWho(), comment.date);
            review.parse(comment.text.substr(m[0].length));

            var reviewerIndex;
            if (review.who in reviewers)
                reviewerIndex = reviewers[review.who];
            else {
                reviewerIndex = ++numReviewers;
                reviewers[review.who] = reviewerIndex;
            }

            var q = $("<div class='review'>"
              + "<div class='reviewer-box'>"
              + "<div class='reviewer'></div><div class='review-date'></div>"
              + "<div class='review-info-bottom'></div>"
              + "<div class='review-intro'></div>"
              + "</div>"
              + "</div>")
                .addClass(getReviewerClass(review))
                .find(".reviewer").text(review.who).end()
                .find(".review-date").text(Utils.formatDate(review.date)).end()
                .find(".review-intro").preWrapLines(review.intro? review.intro : "").end()
                .appendTo("#oldReviews");

            $("#oldReviews").show();

            appendReviewComments(review, q.find('.reviewer-box').get(0));
        }
    }

    // We load the saved draft or create a new reeview *after* inserting the existing reviews
    // so that the ordering comes out right.

    if (reviewStorage) {
        theReview = reviewStorage.loadDraft(theBug, theAttachment, thePatch);
        if (theReview) {
            var storedReviews = reviewStorage.listReviews();
            $("#restored").show();
            for (i = 0; i < storedReviews.length; i++) {
                if (storedReviews[i].bugId == theBug.id &&
                    storedReviews[i].attachmentId == theAttachment.id)
                    $("#restoredLastModified").text(Utils.formatDate(new Date(storedReviews[i].modificationTime)));
            }
        }
    }

    if (!theReview)
        theReview = new Review.Review(thePatch);

    if (theReview.intro)
        $("#emptyCommentNotice").hide();

    $("#myComment")
        .val(theReview.intro ? theReview.intro : "")
        .focus(function() {
                   $("#emptyCommentNotice").hide();
               })
        .blur(function() {
                  if ($(this).val().search(/\S/) < 0)
                      $("#emptyCommentNotice").show();
              })
        .keypress(function() {
                      queueSaveDraft();
                      queueUpdateHaveDraft();
                  });

    updateMyPatchComments();

    queueUpdateHaveDraft();

    $("#publishButton").click(publishReview);
    $("#cancelButton").click(discardReview);
}

function gotBug(xml) {
    theBug = Bug.Bug.fromDOM(xml);

    showNote();

    if (attachmentId != null) {
        theAttachment = theBug.getAttachment(attachmentId);
        if (theAttachment == null)
            displayError("Attachment " + attachmentId + " is not an attachment to bug " + theBug.id);
        else if (!theAttachment.isPatch) {
            displayError("Attachment " + attachmentId + " is not a patch");
            theAttachment = null;
        }
    }

    if (theAttachment == null)
        showChooseAttachment();
    else if (thePatch != null)
        start();
}

function gotAttachment(text) {
    thePatch = new Patch.Patch(text);
    if (theAttachment != null)
        start();
}

function isDigits(str) {
    return str.match(/^[0-9]+$/);
}

function newPageUrl(newBugId, newAttachmentId) {
    var newUrl = configBase;
    if (newBugId != null) {
        newUrl += (newUrl.indexOf("?") < 0) ? "?" : "&";
        newUrl += "bug=" + escape("" + newBugId);
        if (newAttachmentId != null)
            newUrl += "&attachment=" + escape("" + newAttachmentId);
    }

    return newUrl;
}

function showNote() {
    if (configNote)
        $("#note")
            .text(configNote)
            .show();
}

function showEnterBug() {
    showNote();

    $("#enterBugGo").click(function() {
                               var newBugId = Utils.strip($("#enterBugInput").val());
                               document.location = newPageUrl(newBugId);
                           });
    doneLoading();
    $("#enterBug").show();

    if (!reviewStorage)
        return;

    var storedReviews = reviewStorage.listReviews();
    if (storedReviews.length == 0)
        return;

    $("#chooseReview").show();

    for (var i = storedReviews.length - 1; i >= 0; i--) {
        var reviewInfo = storedReviews[i];
        var href = newPageUrl(reviewInfo.bugId, reviewInfo.attachmentId);
        var modificationDate = Utils.formatDate(new Date(reviewInfo.modificationTime));

        var extra = reviewInfo.isDraft ? "(draft)" : "";

        $("<tr>"
          + "<td class='review-bug'>Bug <span></span></td>"
          + "<td class='review-attachment'><a></a></td>"
          + "<td class='review-desc'><a></a></td>"
          + "<td class='review-modification'></td>"
          + "<td class='review-extra'></td>"
          + "</tr>")
            .addClass(reviewInfo.isDraft ? "review-draft" : "")
            .find(".review-bug span").text(reviewInfo.bugId).end()
            .find(".review-attachment a")
                .attr("href", href)
                .text("Attachment " + reviewInfo.attachmentId).end()
            .find(".review-desc a")
                .attr("href", href)
                .text(reviewInfo.attachmentDescription).end()
            .find(".review-modification").text(modificationDate).end()
            .find(".review-extra").text(extra).end()
            .appendTo("#chooseReview tbody");
    }
}

function showChooseAttachment() {
    $("#bugId").text(theBug.id);
    $("#bugShortDesc").text(theBug.shortDesc);
    $("#bugReporter").text(theBug.getReporter());
    $("#bugCreationDate").text(Utils.formatDate(theBug.creationDate));

    $("#bugInfo").show();

    document.title = "Bug " + theBug.id + " - " + theBug.shortDesc + " - Patch Review";
    $("#originalBugLink").attr('href', configBugzillaUrl + "show_bug.cgi?id=" + theBug.id);

    $("#allReviewsLink").attr('href', configBase);

    var drafts = {};
    var published = {};
    if (reviewStorage) {
        var storedReviews = reviewStorage.listReviews();
        for (var j = 0; j < storedReviews.length; j++) {
            var reviewInfo = storedReviews[j];
            if (reviewInfo.bugId == theBug.id) {
                if (reviewInfo.isDraft)
                    drafts[reviewInfo.attachmentId] = 1;
                else
                    published[reviewInfo.attachmentId] = 1;
            }
        }
    }

    for (var i = 0; i < theBug.attachments.length; i++) {
        var attachment = theBug.attachments[i];

        if (!attachment.isPatch)
            continue;

        var href = newPageUrl(theBug.id, attachment.id);

        var date = Utils.formatDate(attachment.date);
        var status = (attachment.status && attachment.status != 'none') ? attachment.status : '';

        var obsoleteClass = attachment.isObsolete ? "attachment-obsolete" : '';
        var draftClass = attachment.id in drafts ? "attachment-draft" : '';

        var extra = '';
        if (attachment.id in drafts)
            extra = '(draft)';
        else if (attachment.id in published)
            extra = '(published)';

        $("<tr>"
          + "<td class='attachment-id'><a></a></td>"
          + "<td class='attachment-desc'><a></a></td>"
          + "<td class='attachment-date'></td>"
          + "<td class='attachment-status'></td>"
          + "<td class='attachment-extra'></td>"
          + "</tr>")
            .addClass(obsoleteClass)
            .addClass(draftClass)
            .find(".attachment-id a")
                .attr("href", href)
                .text(attachment.id).end()
            .find(".attachment-desc a")
                .attr("href", href)
                .text(attachment.description).end()
            .find(".attachment-date").text(date).end()
            .find(".attachment-status").text(status).end()
            .find(".attachment-extra").text(extra).end()
            .appendTo("#chooseAttachment tbody");
    }

    doneLoading();
    $("#chooseAttachment").show();
}


// This is basically a workaround for IE which doesn't treat \n as a
// line-break in white-space: pre, but only \r\n; we could normalize
// line endings, but we take an alternate approach of just putting
// each line into a separate div. We omit a trailing empty line
// after the last line break.
var LINE_RE = /(?!$)([^\r\n]*)(?:\r\n|\r|\n|$)/g;

jQuery.fn.preWrapLines = function(text) {
    return this.each(function() {
        while ((m = LINE_RE.exec(text)) != null) {
            var div = document.createElement("div");
            div.className = "pre-wrap";
            div.appendChild(document.createTextNode(m[1].length == 0 ? " " : m[1]));
            this.appendChild(div);
        }
    });
};

function init() {
    var params = getQueryParams();
    var bugId;

    if (ReviewStorage.LocalReviewStorage.available())
        reviewStorage = new ReviewStorage.LocalReviewStorage();

    if (params.bug)
        bugId = isDigits(params.bug) ? parseInt(params.bug) : NaN;

    if (bugId === undefined || isNaN(bugId)) {
        if (bugId !== undefined)
            displayError("Bug ID '" + params.bug + "' is not valid");
        showEnterBug();
        return;
    } else {
        $.ajax({
                   type: 'GET',
                   dataType: 'xml',
                   url: '/show_bug.cgi',
                   data: {
                       id: bugId,
                       ctype: 'xml',
                       excludefield: 'attachmentdata'
                   },
                   success: gotBug,
                   error: function() {
                       displayError("Failed to retrieve bug " + bugId);
                       showEnterBug();
                   }
               });
    }

    if (params.attachment) {
        attachmentId = isDigits(params.attachment) ? parseInt(params.attachment) : NaN;
    }
    if (attachmentId === undefined || isNaN(attachmentId)) {
        if (attachmentId !== undefined) {
            displayError("Attachment ID '" + params.bug + "' is not valid");
            attachmentId = undefined;
        }
    } else {
        $.ajax({
                   type: 'GET',
                   dataType: 'text',
                   url: '/attachment.cgi',
                   data: {
                       id: attachmentId
                   },
                   success: gotAttachment,
                   error: function(a, b, c) {
                       displayError("Failed to retrieve attachment " + attachmentId);
                   }
               });
    }
}
