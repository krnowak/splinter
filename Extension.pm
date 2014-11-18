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

package Bugzilla::Extension::Splinter;
use strict;
use warnings;
use base qw(Bugzilla::Extension);

use Bugzilla::Extension::Splinter::Ops;

our $VERSION = '0.01';

# See the documentation of Bugzilla::Hook ("perldoc Bugzilla::Hook"
# in the bugzilla directory) for a list of all available hooks.
sub bug_format_comment {
    my ($self, $args) = @_;
    my $bug = $args->{'bug'};
    my $regexes = $args->{'regexes'};
    my $text = $args->{'text'};

    format_the_comment($bug, $regexes, $text);
}

sub config_add_panels {
    my ($self, $args) = @_;
    my $modules = $args->{'panel_modules'};

    add_panel($modules);
}

sub mailer_before_send {
    my ($self, $args) = @_;
    my $email = $args->{'email'};

    # Post-process bug mail to add review links to bug mail.
    # It would be nice to be able to hook in earlier in the
    # process when the email body is being formatted in the
    # style of the bug-format_comment link for HTML but this
    # is the only hook available as of Bugzilla-4.4.
    add_review_links_to_email($email);
}

sub page_before_template {
    my ($self, $args) = @_;
    my $page = $args->{'page_id'};
    my $vars = $args->{'vars'};

    maybe_setup_vars_for_page($page, $vars);
}

sub webservice {
    my ($self, $args) = @_;
    my $dispatches = $args->{'dispatch'};

    add_dispatch($dispatches);
}

__PACKAGE__->NAME;
