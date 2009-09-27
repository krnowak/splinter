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

use strict;
use warnings;
use Bugzilla;
use Bugzilla::Template;

my $REVIEW_RE = qr/Review\s+of\s+attachment\s+(\d+)\s*:/;

my $bug = Bugzilla->hook_args->{'bug'};
my $regexes = Bugzilla->hook_args->{'regexes'};
my $text = Bugzilla->hook_args->{'text'};

if ($$text =~ $REVIEW_RE) {
    my $base = Bugzilla->params->{'splinter_base'};
    my $bug_id = $bug->id;
    if ($base =~ /\?/)
        my $review_link = "<a href='$base&bug=$bug_id&attachment=$1'>Review</a>";
    else
        my $review_link = "<a href='$base?bug=$bug_id&attachment=$1'>Review</a>";
    my $attach_link = Bugzilla::Template::get_attachment_link($1, "attachment $1");

    push(@$regexes, { match => $REVIEW_RE,
                      replace => "$review_link of $attach_link:"});
}
