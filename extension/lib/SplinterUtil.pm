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
# The Original Code is the Splinter Bugzilla Extension.
#
# The Initial Developer of the Original Code is Red Hat, Inc.
# Portions created by Red Hat, Inc. are Copyright (C) 2009
# Red Hat Inc. All Rights Reserved.
#
# Contributor(s):
#   Owen Taylor <otaylor@fishsoup.net>

package extensions::splinter::lib::SplinterUtil;

use Bugzilla;
use Bugzilla::Util;

use base qw(Exporter);
@extensions::splinter::lib::SplinterUtil::EXPORT = qw(attachment_is_visible attachment_id_is_patch
                                                      get_review_url get_review_link);

# Checks if the current user can see an attachment
# Based on code from attachment.cgi
sub attachment_is_visible {
    my $attachment = shift;

    return (Bugzilla->user->can_see_bug($attachment->bug->id) &&
            (!$attachment->isprivate ||
             $user->id == $attachment->attacher->id ||
             $user->is_insider));
}

sub attachment_id_is_patch {
    my $attach_id = shift;

    my $attachment = new Bugzilla::Attachment($attach_id);

    # The check on attachment_is_visible here is to prevent a tiny
    # information leak where someone could check if a private
    # attachment was a patch by creating text that would get linkified
    # differently. Likely excess paranoia
    return (defined $attachment &&
            attachment_is_visible ($attachment) &&
            $attachment->ispatch);
}

sub get_review_url {
    my ($bug, $attach_id, $absolute) = @_;
    my $base = Bugzilla->params->{'splinter_base'};
    my $bug_id = $bug->id;

    if (defined $absolute && $absolute) {
	my $urlbase = correct_urlbase();
	$urlbase =~ s!/$!! if $base =~ "^/";
	$base = $urlbase . $base;
    }

    if ($base =~ /\?/) {
        return "$base&bug=$bug_id&attachment=$attach_id";
    } else {
        return "$base?bug=$bug_id&attachment=$attach_id";
    }
}

sub get_review_link {
    my ($bug, $attach_id, $link_text) = @_;
    return "<a href='" . html_quote(get_review_url($bug, $attach_id)) . "'>$link_text</a>";
}
