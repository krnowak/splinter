# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# The contents of this file are subject to the Mozilla Public
# License Version 1.1 (the "License"); you may not use this file
# except in compliance with the License. You may obtain a copy of
# the License at http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS
# IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
# implied. See the License for the specific language governing
# rights and limitations under the License.
#
# The Original Code is the Bugzilla Bug Tracking System.
#
# Contributor(s):  Frédéric Buclin <LpSolit@gmail.com>
#                  Max Kanat-Alexander <mkanat@bugzilla.org>
#                  Owen Taylor <otaylor@fishsoup.net>

package Bugzilla::Extension::Splinter::WebService;
use strict;
use warnings;

use Bugzilla;
use Bugzilla::Attachment;
use Bugzilla::BugMail;
use Bugzilla::Constants;
use Bugzilla::Field;
use Bugzilla::Util qw(trim);

use Bugzilla::Extension::Splinter::WebServiceUtil;

use base qw(Bugzilla::WebService);

# The idea of this method is to be able to
#
#  - Add a comment with says "Review of attachment <id>:" rather than
#    "From update of attachment"
#
# and:
#
#  - Update the attachment status (in the future flags as well)
#
# While sending out only a single mail as the result. If we did one post
# to processs_bug.cgi and one to attachment.cgi, we'd get two mails.
#
# Based upon WebServer::Bug::add_comment() and attachment.cgi
sub publish_review {
    my ($self, $params) = @_;

    # The user must login in order to publish a review
    Bugzilla->login(LOGIN_REQUIRED);

    # Check parameters
    defined $params->{attachment_id}
        || ThrowCodeError('param_required', { param => 'attachment_id' });
    my $review = $params->{review};
    (defined $review && trim($review) ne '')
        || ThrowCodeError('param_required', { param => 'review' });

    my $attachment_status = $params->{attachment_status};
    if (defined $attachment_status) {
        my $field_object = new Bugzilla::Field({ name => 'attachments.status' });
        my $legal_values = [map { $_->name } @{ $field_object->legal_values }];
        check_field('attachments.status', $attachment_status, $legal_values);
    }

    my $attachment = new Bugzilla::Attachment($params->{attachment_id});
    defined $attachment
        || ThrowUserError("invalid_attach_id",
                          { attach_id => $params->{attachment_id} });

    # Publishing a review of an attachment you can't access doesn't leak
    # information about that attachment, but it seems like bad policy to
    # allow it.
    check_can_access($attachment);

    my $bug = new Bugzilla::Bug($attachment->bug_id);

    Bugzilla->user->can_edit_product($bug->product_id)
        || ThrowUserError("product_edit_denied", {product => $bug->product});

    # This is a "magic string" used to identify review comments
    my $comment = "Review of attachment " . $attachment->id . ":\n\n" . $review;

    my $dbh = Bugzilla->dbh;

    # Figure out when the changes were made.
    my ($timestamp) = $dbh->selectrow_array("SELECT NOW()");

    # Append review comment
    $bug->add_comment($comment);

    $dbh->bz_start_transaction();

    if (defined $attachment_status && $attachment->status ne $attachment_status) {
        # Note that this file needs to load properly even if the installation
        # doesn't have attachment statuses (a bugzilla.gnome.org addition), so,
        # for example, we wouldn't want an explicit 'use Bugzilla::AttachmentStatus'

        # Update the attachment record in the database.
        $dbh->do("UPDATE  attachments
                  SET     status      = ?,
                          modification_time = ?
                  WHERE   attach_id   = ?",
                  undef, ($attachment_status, $timestamp, $attachment->id));

        my $updated_attachment = new Bugzilla::Attachment($attachment->id);

        if ($attachment->status ne $updated_attachment->status) {
            my $fieldid = get_field_id('attachments.status');
            $dbh->do('INSERT INTO bugs_activity (bug_id, attach_id, who, bug_when,
                                               fieldid, removed, added)
                           VALUES (?, ?, ?, ?, ?, ?, ?)',
                     undef, ($bug->id, $attachment->id, Bugzilla->user->id,
                             $timestamp, $fieldid,
                             $attachment->status, $updated_attachment->status));

            # Adding the comment will update the bug's delta_ts, so we don't need to do it here
        }
    }

    # This actually adds the comment
    $bug->update();

    $dbh->bz_commit_transaction();

    # Send mail.
    Bugzilla::BugMail::Send($bug->bug_id, { changer => Bugzilla->user() });

    # Nothing very interesting to return on success, so just return an empty structure
    return {};
}

1;
