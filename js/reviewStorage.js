/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
include('Review');

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

function LocalReviewStorage() {
    this._init();
}

LocalReviewStorage.available = function() {
    return 'localStorage' in window;
};

LocalReviewStorage.prototype = {
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

    saveDraft : function(bug, attachment, review) {
        var propertyName = this._reviewPropertyName(bug, attachment);

        this._updateOrCreateReviewInfo(bug, attachment, { isDraft: true });
        localStorage[propertyName] = "" + review;
    },

    draftPublished : function(bug, attachment) {
        var propertyName = this._reviewPropertyName(bug, attachment);

        this._updateOrCreateReviewInfo(bug, attachment, { isDraft: false });
        delete localStorage[propertyName];
    }
};
