/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Bug');
include('Patch');
include('Review');

var attachmentId;
var theBug;
var theAttachment;
var thePatch;
var theReview;

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

function saveReview() {
    theReview.setIntro($("#myComment").val());

    var comment = "Review of attachment " + attachmentId + ":\n\n" + theReview;

    var newStatus = null;
    if (theAttachment.status && $("#attachmentStatus").val() != theAttachment.status) {
        newStatus = $("#attachmentStatus").val();
    }

    function success() {
        alert("Succesfully published the review.");
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


function saveComment(row, editorQuery, file, location) {
    var reviewFile = theReview.getFile(file.filename);
    var comment = reviewFile.getComment(location);

    var value = Utils.strip(editorQuery.find("textarea").val());
    if (value != "") {
        if (comment)
            comment.comment = value;
        else
            reviewFile.addComment(location, value);

        $("<tr class='my-comment'><td colSpan='3'>"
          + "<div></div>"
          + "</td></tr>")
            .find("div").text(value).end()
            .insertBefore(editorQuery)
            .dblclick(function() {
                          insertCommentEditor(row);
                      });
    } else {
        if (comment)
            comment.remove();
    }

    editorQuery.remove();
}

function insertCommentEditor(row) {
    var file = $(row).data('patchFile');
    var location = $(row).data('patchLocation');

    var insertAfter = row;
    while (insertAfter.nextSibling) {
        if (insertAfter.nextSibling.className == "comment-editor")
            return;
        if (insertAfter.nextSibling.className == "my-comment") {
            $(insertAfter.nextSibling).remove();
            if (!insertAfter.nextSibling)
                break;
        }
        if (insertAfter.nextSibling.className != "comment")
            break;
        insertAfter = insertAfter.nextSibling;
    }

    var reviewFile = theReview.getFile(file.filename);
    var comment = reviewFile.getComment(location);
    var editorRow = $("<tr class='comment-editor'><td colSpan='3'>"
                      + "<div>"
                      + "<textarea></textarea>"
                      + "</div>"
                      + "</td></tr>");
    editorRow.insertAfter(insertAfter);
    editorRow.find('textarea')
        .text(comment ? comment.comment : "")
        .blur(function() {
                  saveComment(row, editorRow, file, location);
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
                         else if ((flags & Patch.ADDED_LINE) != 0)
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
                         $(tr).dblclick(function() {
                                            insertCommentEditor(this);
                                        });

                         tbody.appendChild(tr);

                         if (line.reviewComments != null) {
                             for (var k = 0; k < line.reviewComments.length; k++) {
                                 var comment = line.reviewComments[k];

                                 $("<tr class='comment'><td colSpan='3'>"
                                   + "<div></div>"
                                   + "</td></tr>")
                                     .find("div").text(comment.comment).end()
                                     .appendTo(tbody);
                             }
                         }
                     });
    }
}

var REVIEW_RE = /^\s*review\s+of\s+attachment\s+(\d+)\s*:\s*/i;

function start(xml) {
    $("#loading").hide();
    $("#headers").show();
    $("#controls").show();
    $("#files").show();

    var i;

    for (i = 0; i < configAttachmentStatuses.length; i++) {
        $("<option></option")
            .text(configAttachmentStatuses[i])
            .appendTo($("#attachmentStatus"));
    }

    $("#bugId").text(theBug.id);
    $("#bugShortDesc").text(theBug.shortDesc);
    $("#bugReporter").text(theBug.getReporter());
    $("#bugCreationDate").text(Utils.formatDate(theBug.creationDate));

    for (i = 0; i < theBug.attachments.length; i++) {
        var attachment = theBug.attachments[i];
        if (attachment.id == attachmentId) {
            theAttachment = attachment;

            $("#attachmentId").text(attachment.id);
            $("#attachmentDesc").text(attachment.description);
            $("#attachmentDate").text(Utils.formatDate(attachment.date));
            if (attachment.status != null)
                $("#attachmentStatus").val(attachment.status);
            else
                $("#attachmentStatusSpan").hide();

            break;
        }
    }

    for (i = 0; i < theBug.comments.length; i++) {
        var comment = theBug.comments[i];
        var m = REVIEW_RE.exec(comment.text);

        if (m && parseInt(m[1]) == attachmentId) {
            var review = new Review.Review(thePatch);
            review.parse(comment.text.substr(m[0].length));

            $("<div class='review'>"
              + "<div class='review-inner'>"
              + "<div><span class='reviewer'></span> - <span class='review-date'></span></div>"
              + "<div class='review-intro'></div>"
              + "</div>"
              + "</div>")
                .find(".reviewer").text(comment.getWho()).end()
                .find(".review-date").text(Utils.formatDate(comment.date)).end()
                .find(".review-intro").text(review.intro? review.intro : "").end()
                .appendTo("#oldReviews");

        }
    }

    for (i = 0; i < thePatch.files.length; i++)
        addPatchFile(thePatch.files[i]);

    $("#saveButton").click(saveReview);
}

function gotBug(xml) {
    theBug = Bug.Bug.fromDOM(xml);

    if (theBug !== undefined && thePatch !== undefined)
        start();
}

function gotAttachment(text) {
    thePatch = new Patch.Patch(text);
    theReview = new Review.Review(thePatch);

    if (theBug !== undefined && thePatch !== undefined)
        start();
}

function init() {
    var params = getQueryParams();
    var bug_id;

   if (params.bug) {
        bug_id = parseInt(params.bug);
    }
    if (bug_id === undefined || isNaN(bug_id)) {
        alert("Must specify a valid bug ID");
        return;
    }

   if (params.attachment) {
        attachmentId = parseInt(params.attachment);
    }
    if (attachmentId === undefined || isNaN(attachmentId)) {
        alert("Must specify a valid attachment ID");
        return;
    }

    $.ajax({
               type: 'GET',
               dataType: 'xml',
               url: '/show_bug.cgi',
               data: {
                   id: bug_id,
                   ctype: 'xml',
                   excludefield: 'attachmentdata'
               },
               success: gotBug,
               error: function() {
                   displayError("Failed to retrieve bug");
               },
    });

    $.ajax({
               type: 'GET',
               dataType: 'text',
               url: '/attachment.cgi',
               data: {
                   id: attachmentId
               },
               success: gotAttachment,
               error: function(a, b, c) {
                   displayError("Failed to retrieve attachment");
               }
           });
}
