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
#   Bradley Baetz <bbaetz@acm.org>
#   Krzesimir Nowak <qdlacz@gmail.com>

package Bugzilla::Extension::Splinter::Ops;
use strict;
use warnings;

use base qw(Exporter);

our @EXPORT = qw(
    format_the_comment
    add_panel
    add_review_links_to_email
    maybe_get_statuses
    add_dispatch
);

use Bugzilla::Extension::Splinter::Util;

sub _attachment_id_is_patch {
    my ($attach_id) = @_;
    my $attachment = Bugzilla::Attachment->new($attach_id);

    # The check on attachment_is_visible here is to prevent a tiny
    # information leak where someone could check if a private
    # attachment was a patch by creating text that would get linkified
    # differently. Likely excess paranoia
    return (defined($attachment) &&
            attachment_is_visible($attachment) &&
            $attachment->ispatch());
}

sub _get_review_url {
    my ($bug, $attach_id, $absolute) = @_;
    my $base = Bugzilla->params()->{'splinter_base'};
    my $bug_id = $bug->id();

    if ($absolute) {
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

sub _get_review_link {
    my ($bug, $attach_id, $link_text) = @_;

    return "<a href='" . html_quote(_get_review_url($bug, $attach_id)) . "'>$link_text</a>";
}

sub format_the_comment {
    my ($bug, $regexes, $text) = @_;
    # TODO: This is probably used in more places. Avoid redundancy.
    my $REVIEW_RE = qr/Review\s+of\s+attachment\s+(\d+)\s*:/;

    # Add [review] link to the end of "Created attachment" comments
    #
    # We need to work around the way that the hook works, which is
    # intended to avoid overlapping matches, since we *want* an
    # overlapping match here (the normal handling of "Created
    # attachment"), so we add in dummy text and then replace in the
    # regular expression we return from the hook.
    ${$text} =~ s~((?:^Created\ |\b)attachment\s+(\d+)(\s\[details\])?)
                 ~(push(@$regexes, { match => qr/__REVIEW__$2/,
                                     replace => _get_review_link($bug, "$2", "[review]") })) &&
                  (_attachment_id_is_patch($2) ? "$1 __REVIEW__$2" : $1)
                 ~egmx;

    # And linkify "Review of attachment", this is less of a workaround since
    # there is no issue with overlap; note that there is an assumption that
    # there is only one match in the text we are linkifying, since they all
    # get the same link.
    if (${$text} =~ $REVIEW_RE) {
        my $attachment_id = $1;
        my $review_link = _get_review_link($bug, $attachment_id, "Review");
        my $attach_link = Bugzilla::Template::get_attachment_link($attachment_id, "attachment $attachment_id");

        push(@$regexes, { 'match' => $REVIEW_RE,
                          'replace' => "$review_link of $attach_link:"});
    }
}

sub add_panel {
    my ($modules) = @_;

    $modules->{'Splinter'} = "Bugzilla::Extension::Splinter::Params";
}

sub _munge_create_attachment {
    my ($bug, $intro_text, $attach_id, $view_link) = @_;

    if (_attachment_id_is_patch ($attach_id)) {
        return ("$intro_text" .
                " View: $view_link\015\012" .
                " Review: " . _get_review_url($bug, $attach_id, 1) . "\015\012");
    } else {
        return ("$intro_text" .
                " --> ($view_link)");
    }
}

# This adds review links into a bug mail before we send it out.  Since
# this is happening after newlines have been converted into RFC-2822
# style \r\n, we need handle line ends carefully.  (\015 and \012 are
# used because Perl \n is platform-dependent)
sub add_review_links_to_email {
    my ($email) = @_;
    my $body = $email->body();
    my $new_body = undef;
    my $bug = undef;

    if ($email->header('Subject') =~ /^\[Bug\s+(\d+)\]/)
    {
        my $bug_id = $1;

        if (Bugzilla->user()->can_see_bug($bug_id)) {
            $bug = Bugzilla::Bug->new($bug_id);
        }
    }

    return unless defined($bug);

    if ($body =~ /Review\s+of\s+attachment\s+\d+\s*:/) {
        $body =~ s~(Review\s+of\s+attachment\s+(\d+)\s*:)
                  ~"$1\015\012 --> (" . _get_review_url($bug, $2, 1) . ")"
                  ~egx;
        $new_body = 1;
    }

    # TODO: Figure out the email format.
    if ($body =~ /Created attachment [0-9]+\015\012 --> /) {
        $body =~ s~(Created\ attachment\ ([0-9]+)\015\012)
                   \ -->\ \(([^\015\012]*)\)[^\015\012]*
                  ~_munge_create_attachment($bug, $1, $2, $3)
                  ~egx;
        $new_body = 1;
    }

    $email->body_set($body) if $new_body;
}

sub maybe_get_statuses {
    my ($page, $vars) = @_;

    if ($page eq 'splinter.html') {
        # We do this in a way that is safe if the Bugzilla instance doesn't
        # have an attachments.status field (which is a bugzilla.gnome.org
        # addition)
        my $field_object = Bugzilla::Field->new({ name => 'attachments.status' });
        my @statuses = ();

        if ($field_object) {
            @statuses = map { $_->name } @{ $field_object->legal_values };
        }
        $vars->{'attachment_statuses'} = \@statuses;
    }
}

sub add_dispatch {
    my ($dispatches) = @_;

    $dispatches->{'Splinter'} = "Bugzilla::Extension::Splinter::WebService";
}

1;
