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

use extensions::splinter::lib::SplinterUtil;

my $bug = Bugzilla->hook_args->{'bug'};
my $regexes = Bugzilla->hook_args->{'regexes'};
my $text = Bugzilla->hook_args->{'text'};

# Add [review] link to the end of "Created an attachment" comments
#
# We need to work around the way that the hook works, which is intended
# to avoid overlapping matches, since we *want* an overlapping match
# here (the normal handling of "Created an attachment"), so we add in
# dummy text and then replace in the regular expression we return from
# the hook.
$$text =~ s~((?:^Created\ an\ |\b)attachment\s*\(id=(\d+)\)(\s\[edit\])?)
           ~(push(@$regexes, { match => qr/__REVIEW__$2/,
                               replace => get_review_link($bug, "$2", "[review]") })) &&
            (attachment_id_is_patch($2) ? "$1 __REVIEW__$2" : $1)
           ~egmx;

# And linkify "Review of attachment", this is less of a workaround since
# there is no issue with overlap; note that there is an assumption that
# there is only one match in the text we are linkifying, since they all
# get the same link.
my $REVIEW_RE = qr/Review\s+of\s+attachment\s+(\d+)\s*:/;

if ($$text =~ $REVIEW_RE) {
    my $review_link = get_review_link($bug, $1, "Review");
    my $attach_link = Bugzilla::Template::get_attachment_link($1, "attachment $1");

    push(@$regexes, { match => $REVIEW_RE,
                      replace => "$review_link of $attach_link:"});
}
