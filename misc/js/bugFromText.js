/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// DOM is not available in the non-Browser environment we use for test cases
// So we use E4X, which is supported by Spidermonkey. It's not supported
// by most browsers. This can't be in bug.js since it will cause parse-errors
// for non-E4X-supporting browsers

include('Bug');

function bugFromText(bugText) {
    var bug = new Bug.Bug();

    // We need to skip the XML and DOCTYPE declarations that E4X doesn't handle
    var xmlstart = bugtext.indexOf("<bugzilla");
    var bugzillaNode = new XML(bugtext.substring(xmlstart));
    var bugNode = bugzillaNode.bug;

    bug.id = parseInt(bugNode.bug_id);
    bug.token = bugNode.token;
    bug.shortDesc = Utils.strip(bugNode.short_desc);
    bug.creationDate = Bug.parseDate(bugNode.creation_ts);
    bug.reporterName = Utils.strip(bugNode.reporter).@name;
    bug.reporterEmail = Utils.strip(bugNode.reporter);
    var longDescNodes = bugNode.long_desc;
    for (var i = 0; i < longDescNodes.length(); i++) {
        var longDescNode = longDescNodes[i];
        var comment = new Bug.Comment(bug);

        comment.whoName = Utils.strip(longDescNode.who.@name);
        comment.whoEmail = Utils.strip(longDescNode.who);
        comment.date = Bug.parseDate(longDescNode.bug_when);
        comment.text = longDescNode.thetext;

        bug.comments.push(comment);
    }

    var attachmentNodes = bugNode.attachment;
    for (var i = 0; i < attachmentNodes.length(); i++) {
        var attachmentNode = attachmentNodes[i];
        var attachid = parseInt(attachmentNode.attachid);
        var attachment = new Bug.Attachment(bug, attachid);

        attachment.description = Utils.strip(attachmentNode.desc);
        attachment.filename = Utils.strip(attachmentNode.filename);
        attachment.date = Bug.parseDate(attachmentNode.date);
        attachment.status = Utils.strip(attachmentNode.status);
        if (attachment.status == "")
            attachment.status = null;
        attachment.token = Utils.strip(attachmentNode.token);
        if (attachment.token == "")
            attachment.token = null;
        attachment.isPatch = attachmentNode.@ispatch == "1";
        attachment.isObsolete = attachmentNode.@isobsolete == "1";
        attachment.isPrivate = attachmentNode.@isprivate == "1";

        bug.attachments.push(attachment);
    }
    return bug;
};

