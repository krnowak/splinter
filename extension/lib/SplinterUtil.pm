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
                                                      get_review_url get_review_link
                                                      add_review_links_to_email);

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

sub munge_create_attachment {
    my ($bug, $intro_text, $attach_id, $view_link) = @_;

    if (attachment_id_is_patch ($attach_id)) {
	return ("$intro_text" .
                " View: $view_link\015\012" .
                " Review: " . get_review_url($bug, $attach_id, 1) . "\015\012");
    } else {
	return ("$intro_text" .
                " --> ($view_link)");
    }
}

# This adds review links into a bug mail before we send it out.
# Since this is happening after newlines have been converted into
# RFC-2822 style \r\n, we need handle line ends carefully.
# (\015 and \012 are used because Perl \n is platform-dependent)
sub add_review_links_to_email {
    my $email = shift;

    my $body = $email->body;
    my $new_body = 0;

    my $bug;
    if ($email->header('Subject') =~ /^\[Bug\s+(\d+)\]/ &&
        Bugzilla->user->can_see_bug($1))
    {
	$bug = new Bugzilla::Bug($1);
    }

    return unless defined $bug;

    if ($body =~ /Review\s+of\s+attachment\s+\d+\s*:/) {
	$body =~ s~(Review\s+of\s+attachment\s+(\d+)\s*:)
                  ~"$1\015\012 --> (" . get_review_url($bug, $2, 1) . ")"
                  ~egx;
	$new_body = 1;
    }

    if ($body =~ /Created an attachment \(id=[0-9]+\)\015\012 --> /) {
	$body =~ s~(Created\ an\ attachment\ \(id=([0-9]+)\)\015\012)
                   \ -->\ \(([^\015\012]*)\)[^\015\012]*
                  ~munge_create_attachment($bug, $1, $2, $3)
                  ~egx;
	$new_body = 1;
    }

    $email->body_set($body) if $new_body;
}
