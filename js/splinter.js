/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Bug');
include('Patch');
include('Review');
include('ReviewStorage');

var reviewStorage;
var attachmentId;
var theBug;
var theAttachment;
var thePatch;
var theReview;

var reviewers = {};

var saveDraftTimeoutId;
var saveDraftNoticeTimeoutId;
var savingDraft = false;

const ADD_COMMENT_SUCCESS = /<title>\s*Bug[\S\s]*processed\s*<\/title>/;
const UPDATE_ATTACHMENT_SUCCESS = /<title>\s*Changes\s+Submitted/;

function displayError(msg) {
    $("<p></p>")
        .text(msg)
        .appendTo("#error");
    $("#error").show();
    $("#loading").hide();
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
    theReview.setIntro($("#myComment").val());

    var comment = "Review of attachment " + attachmentId + ":\n\n" + theReview;

    var newStatus = null;
    if (theAttachment.status && $("#attachmentStatus").val() != theAttachment.status) {
        newStatus = $("#attachmentStatus").val();
    }

    function success() {
        alert("Succesfully published the review.");
        if (reviewStorage)
            reviewStorage.draftPublished(theBug, theAttachment);
    }

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

function hideSaveDraftNotice() {
    saveDraftNoticeTimeoutId = null;
    $("#saveDraftNotice").hide();
}

function saveDraft() {
    theReview.setIntro($("#myComment").val());

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

    reviewStorage.saveDraft(theBug, theAttachment, theReview);

    savingDraft = false;
    $("#saveDraftNotice")
        .text("Saved Draft");
}

function queueSaveDraft() {
    if (saveDraftTimeoutId == null)
        saveDraftTimeoutId = setTimeout(saveDraft, 10000);
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
    if (!row.nextSibling || row.nextSibling.className != "comment-area")
        $("<tr class='comment-area'><td colSpan='3'>"
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

function addCommentDisplay(row, comment) {
    var commentArea = ensureCommentArea(row);
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
        .find(".comment-text").text(comment.comment).end()
        .addClass(getTypeClass(comment.type))
        .addClass(getReviewerClass(review))
        .appendTo(commentArea)
        .dblclick(function() {
                      insertCommentEditor(row, comment.type);
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
}

function saveComment(row, file, location, type) {
    var commentArea = ensureCommentArea(row);
    var reviewFile = theReview.getFile(file.filename);
    var comment = reviewFile.getComment(location, type);

    var value = Utils.strip($(commentArea).find("textarea").val());
    if (value != "") {
        if (comment)
            comment.comment = value;
        else
            comment = reviewFile.addComment(location, type, value);

        addCommentDisplay(row, comment);
    } else {
        if (comment)
            comment.remove();
    }

    if (reviewFile.comments.length == 0) {
        $(commentArea).parent().remove();
    } else {
        $(commentArea).find(".comment-editor").remove();
    }

    saveDraft();
}

function insertCommentEditor(clickRow, clickType) {
    var file = $(clickRow).data('patchFile');
    var clickLocation = $(clickRow).data('patchLocation');

    var row = clickRow;
    var location = clickLocation;
    var type = clickType;

    var reviewFile = theReview.getFile(file.filename);
    var comment = reviewFile.getComment(location, type);

    var commentArea = ensureCommentArea(row);

    var typeClass = getTypeClass(type);
    var separatorClass = getSeparatorClass(type);

    if (comment) {
        if (separatorClass)
            $(commentArea).find(".reviewer-0." + separatorClass).remove();
        $(commentArea).find(".reviewer-0." + typeClass).remove();
    }

    if (separatorClass)
        $("<div class='comment-editor'></div>")
            .addClass(separatorClass)
            .appendTo(commentArea);
    $("<div class='comment-editor'><textarea></textarea></div>")
        .addClass(typeClass)
        .appendTo(commentArea)
        .find('textarea')
            .val(comment ? comment.comment : "")
            .blur(function() {
                      saveComment(row, file, location, type);
                  })
            .each(function() { this.focus(); });
}

function EL(element, cls, text) {
    var e = document.createElement(element);
    if (text != null)
        e.appendChild(document.createTextNode(text));
    if (cls)
        e.className = cls;

    return e;
}

function addPatchFile(file) {
    var fileDiv = $("<div></div>").appendTo("#files");

    $("<div class='file-label'><span></span></div/>")
        .find("span").text(file.filename).end()
        .appendTo(fileDiv);

    tbody = $(fileDiv).append("<table class='file-table'>"
                              + "<col class='old-column'></col>"
                              + "<col class='middle-column'></col>"
                              + "<col class='new-column'></col>"
                              + "<tbody></tbody>"
                              + "</table>").find("tbody").get(0);
    for (var i = 0; i  < file.hunks.length; i++) {
        var hunk = file.hunks[i];
        var hunkHeader = EL("tr", "hunk-header");
        tbody.appendChild(hunkHeader);
        var hunkCell = EL("td", "hunk-cell",
                          "Lines " + hunk.oldStart + "-" + (hunk.oldStart + hunk.oldCount - 1));
        hunkCell.colSpan = 3;
        hunkHeader.appendChild(hunkCell);

        hunk.iterate(function(loc, oldLine, oldText, newLine, newText, flags, line) {
                         var tr = document.createElement("tr");

                         var oldStyle = "";
                         var newStyle = "";
                         if ((flags & Patch.CHANGED) != 0)
                             oldStyle = newStyle = "changed-line";
                         else if ((flags & Patch.REMOVED) != 0)
                             oldStyle = "removed-line";
                         else if ((flags & Patch.ADDED) != 0)
                             newStyle = "added-line";

                         if (oldText != null) {
                             tr.appendChild(EL("td", "old-line " + oldStyle,
                                               oldText != "" ? oldText : "\u00a0"));
                             oldLine++;
                         } else {
                             tr.appendChild(EL("td", "old-line"));
                         }

                         tr.appendChild(EL("td", "line-middle"));

                         if (newText != null) {
                             tr.appendChild(EL("td", "new-line " + newStyle,
                                               newText != "" ? newText : "\u00a0"));
                             newLine++;
                         } else {
                             tr.appendChild(EL("td", "new-line"));
                         }

                         $(tr).data('patchFile', file);
                         $(tr).data('patchLocation', loc);
                         $(tr).dblclick(function(e) {
                                            var leftX = this.offsetLeft;
                                            var parent = this.offsetParent;
                                            while (parent != document.body) {
                                                leftX += parent.offsetLeft;
                                                parent = parent.offsetParent;
                                            }
                                            var delta = e.pageX - (leftX + this.offsetWidth/2);
                                            var type;
                                            if (delta < - 20)
                                                type = Patch.REMOVED;
                                            else if (delta < 20)
                                                type = Patch.CHANGED;
                                            else
                                                type = Patch.ADDED;
                                            insertCommentEditor(this, type);
                                        });

                         tbody.appendChild(tr);

                         if (line.reviewComments != null)
                             for (var k = 0; k < line.reviewComments.length; k++)
                                 addCommentDisplay(tr, line.reviewComments[k]);
                     });
    }
}

var REVIEW_RE = /^\s*review\s+of\s+attachment\s+(\d+)\s*:\s*/i;

function start(xml) {
    if (reviewStorage)
        theReview = reviewStorage.loadDraft(theBug, theAttachment, thePatch);
    if (!theReview)
        theReview = new Review.Review(thePatch);

    document.title = "Attachment " + theAttachment.id + " - " + theAttachment.description + " - Patch Review";

    $("#loading").hide();
    $("#attachmentInfo").show();
    $("#controls").show();
    $("#files").show();

    $("#bugLink").attr('href', newPageUrl(theBug.id));

    $("#attachmentId").text(theAttachment.id);
    $("#attachmentDesc").text(theAttachment.description);
    $("#attachmentDate").text(Utils.formatDate(theAttachment.date));
    if (theAttachment.status != null)
        $("#attachmentStatus").val(theAttachment.status);
    else
        $("#attachmentStatusSpan").hide();

    var i;

    for (i = 0; i < configAttachmentStatuses.length; i++) {
        $("<option></option")
            .text(configAttachmentStatuses[i])
            .appendTo($("#attachmentStatus"));
    }

    if (thePatch.intro)
        $("#patchIntro").text(thePatch.intro);
    else
        $("#patchIntro").hide();

    $("#myComment")
        .val(theReview.intro)
        .keypress(queueSaveDraft);

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

            $("<div class='review'>"
              + "<div class='reviewer-box'>"
              + "<div class='reviewer'></div><div class='review-date'></div>"
              + "<div class='review-info-bottom'></div>"
              + "<div class='review-intro'></div>"
              + "</div>"
              + "</div>")
                .addClass(getReviewerClass(review))
                .find(".reviewer").text(review.who).end()
                .find(".review-date").text(Utils.formatDate(review.date)).end()
                .find(".review-intro").text(review.intro? review.intro : "").end()
                .appendTo("#oldReviews");

        }
    }

    for (i = 0; i < thePatch.files.length; i++)
        addPatchFile(thePatch.files[i]);

    $("#publishButton").click(publishReview);
}

function gotBug(xml) {
    theBug = Bug.Bug.fromDOM(xml);

    $("#headers").show();
    showNote();

    $("#bugId").text(theBug.id);
    $("#bugShortDesc").text(theBug.shortDesc);
    $("#bugReporter").text(theBug.getReporter());
    $("#bugCreationDate").text(Utils.formatDate(theBug.creationDate));

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
    var newUrl = "/index.html";
    if (newBugId != null) {
        newUrl += "?bug=" + escape("" + newBugId);
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
    $("#loading").hide();
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
    document.title = "Bug " + theBug.id + " - " + theBug.shortDesc + " - Patch Review";
    $("#originalBugLink").attr('href', configBugzillaUrl + "/show_bug.cgi?id=" + theBug.id);

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

    $("#loading").hide();
    $("#chooseAttachment").show();
}

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
