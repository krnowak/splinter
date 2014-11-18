/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Utils');

// Until 2009-04, Bugzilla would use symbolic abbrevations for timezones in the XML output.
// Afterwords it was switched to a UTC offset. We handle some of the more likely to be
// encountered symbolic timezeones. Anything else is just handled as if it was UTC.
// See: https://bugzilla.mozilla.org/show_bug.cgi?id=487865
const TIMEZONES = {
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

function parseDate(d) {
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
        if (m[7] in TIMEZONES)
            tzoffset = TIMEZONES[m[7]];
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
}

function _formatWho(name, email) {
    if (name && email)
        return name + " <" + email + ">";
    else if (name)
        return name;
    else
        return email;
}

function Attachment(bug, id) {
    this._init(bug, id);
}

Attachment.prototype = {
    _init : function(bug, id) {
        this.bug = bug;
        this.id = id;
    }
};

function Comment(bug) {
    this._init(bug);
}

Comment.prototype = {
    _init : function(bug) {
        this.bug = bug;
    },

    getWho : function() {
        return _formatWho(this.whoName, this.whoEmail);
    }
};

function Bug() {
    this._init();
}

Bug.prototype = {
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
        return _formatWho(this.reporterName, this.reporterEmail);
    }
};

// In the browser environment we use JQuery to parse the DOM tree
// for the XML document for the bug
Bug.fromDOM = function(xml) {
    var bug = new Bug();

    $(xml).children('bugzilla').children('bug').each(function() {
        bug.id = parseInt($(this).children('bug_id').text());
        bug.token = $(this).children('token').text();
        bug.shortDesc = Utils.strip($(this).children('short_desc').text());
        bug.creationDate = parseDate($(this).children('creation_ts').text());

        $(this).children('reporter').each(function() {
            bug.reporterEmail = Utils.strip($(this).text());
            bug.reporterName = Utils.strip($(this).attr('name'));
        });
        $(this).children('long_desc').each(function() {
            var comment = new Comment(bug);

            $(this).children('who').each(function() {
                comment.whoEmail = Utils.strip($(this).text());
                comment.whoName = Utils.strip($(this).attr('name'));
            });
            comment.date = parseDate($(this).children('bug_when').text());
            comment.text = $(this).children('thetext').text();

            bug.comments.push(comment);
        });
        $(this).children('attachment').each(function() {
            var attachid = parseInt($(this).children('attachid').text());
            var attachment = new Attachment(bug, attachid);

            attachment.description = Utils.strip($(this).children('desc').text());
            attachment.filename = Utils.strip($(this).children('filename').text());
            attachment.date = parseDate($(this).children('date').text());
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
