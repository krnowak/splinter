/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Bug');
include('Patch');
include('Review');
include('ReviewStorage');
include('XmlRpc');

var reviewStorage;
var attachmentId;
var theBug;
var theAttachment;
var thePatch;
var theReview;

var reviewers = {};

var updateHaveDraftTimeoutId;
var saveDraftTimeoutId;
var saveDraftNoticeTimeoutId;
var savingDraft = false;

var currentEditComment;

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

function haveDraft() {
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

    if (haveDraft())
        $("#haveDraftNotice").show();
    else
        $("#haveDraftNotice").hide();
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
    var colSpan = file.status == Patch.CHANGED ? 3 : 1;
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
        .find(".comment-text").text(comment.comment).end()
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

function onRowDblClick(e) {
    var file = $(this).data('patchFile');

    if (file.status == Patch.CHANGED) {
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
    } else {
        type = file.status;
    }

    insertCommentForRow(this, type);
}

function addPatchFile(file) {
    var fileDiv = $("<div class='file'></div>").appendTo("#files").get(0);
    file.div = fileDiv;

    $("<div class='file-label'><span></span></div/>")
        .find("span").text(file.filename).end()
        .appendTo(fileDiv);

    var q = $("<table class='file-table'>"
              + "</table>").appendTo(fileDiv);
    if (file.status != Patch.ADDED)
        q.append("<col class='old-column'></col>");
    if (file.status == Patch.CHANGED)
        q.append("<col class='middle-column'></col>");
    if (file.status != Patch.REMOVED)
        q.append("<col class='new-column'></col>");
    q.append("<tbody></tbody>");

    if (file.status == Patch.CHANGED)
        q.addClass("file-table-changed");

    var tbody = q.find("tbody").get(0);
    for (var i = 0; i  < file.hunks.length; i++) {
        var hunk = file.hunks[i];
        var hunkHeader = EL("tr", "hunk-header");
        tbody.appendChild(hunkHeader);
        var hunkCell = EL("td", "hunk-cell");
        hunkCell.appendChild(EL("div", "hunk-lines",
                                "Lines " + hunk.oldStart + "-" + (hunk.oldStart + hunk.oldCount - 1)));
        if (hunk.functionLine)
            hunkCell.appendChild(EL("div", "hunk-function-line", hunk.functionLine));
        hunkCell.colSpan = file.status == Patch.CHANGED ? 3 : 1;
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
                         } else if (file.status == Patch.CHANGED) {
                             tr.appendChild(EL("td", "old-line"));
                         }

                         if (file.status == Patch.CHANGED)
                             tr.appendChild(EL("td", "line-middle"));

                         if (newText != null) {
                             tr.appendChild(EL("td", "new-line " + newStyle,
                                               newText != "" ? newText : "\u00a0"));
                             newLine++;
                         } else if (file.status == Patch.CHANGED) {
                             tr.appendChild(EL("td", "new-line"));
                         }

                         $(tr).data('patchFile', file);
                         $(tr).data('patchLocation', loc);
                         $(tr).dblclick(onRowDblClick);

                         tbody.appendChild(tr);

                         if (line.reviewComments != null)
                             for (var k = 0; k < line.reviewComments.length; k++) {
                                 var commentArea = ensureCommentArea(tr);
                                 addCommentDisplay(commentArea, line.reviewComments[k]);
                             }
                     });
    }
}

function showOverview() {
    $("#bugInfo").show();
    $("#overview").show();
    $(".file").hide();
}

function showPatchFile(file) {
    $("#bugInfo").hide();
    $("#overview").hide();
    $(".file").hide();
    if (file.div)
        $(file.div).show();
    else
        addPatchFile(file);
}

function addNavigationLink(title, callback, selected) {
    if ($("#navigation").children().size() > 0)
        $("#navigation").append(" | ");

    var q = $("<a class='navigation-link' href='javascript:void(0)'></a")
        .text(title)
        .appendTo("#navigation")
        .click(function() {
                   if (!$(this).hasClass("navigation-link-selected")) {
                       $(".navigation-link").removeClass("navigation-link-selected");
                       $(this).addClass("navigation-link-selected");
                       callback();
                   }
               });

    if (selected)
        q.addClass("navigation-link-selected");
}

function addFileNavigationLink(file) {
    var basename = file.filename.replace(/.*\//, "");
    addNavigationLink(basename, function() {
        showPatchFile(file);
    });
}

var REVIEW_RE = /^\s*review\s+of\s+attachment\s+(\d+)\s*:\s*/i;

function start(xml) {
    var i;

    document.title = "Attachment " + theAttachment.id + " - " + theAttachment.description + " - Patch Review";

    $("#loading").hide();
    $("#attachmentInfo").show();
    $("#navigation").show();
    $("#overview").show();
    $("#files").show();

    $("#bugLink")
        .click(flushSaveDraft)
        .attr('href', newPageUrl(theBug.id));

    $("#subtitle").text("Attachment " + theAttachment.id + " - " + theAttachment.description);
    $("#information").text(Utils.formatDate(theAttachment.date));

    for (i = 0; i < configAttachmentStatuses.length; i++) {
        $("<option></option")
            .text(configAttachmentStatuses[i])
            .appendTo($("#attachmentStatus"));
    }

    if (theAttachment.status != null)
        $("#attachmentStatus").val(theAttachment.status);
    else
        $("#attachmentStatusSpan").hide();

    if (thePatch.intro)
        $("#patchIntro").text(thePatch.intro);
    else
        $("#patchIntro").hide();

    addNavigationLink("Overview", showOverview, true);
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

    $("#myComment")
        .val(theReview.intro)
        .keypress(function() {
                      queueSaveDraft();
                      queueUpdateHaveDraft();
                  });

    queueUpdateHaveDraft();

    $("#publishButton").click(publishReview);
}

function gotBug(xml) {
    theBug = Bug.Bug.fromDOM(xml);

    $("#bugInfo").show();
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
