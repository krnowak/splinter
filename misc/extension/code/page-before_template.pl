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

my $REVIEW_RE = qr/Review\s+of\s+attachment\s+(\d+)\s*:/;

my $page_id = Bugzilla->hook_args->{'page_id'};
my $vars = Bugzilla->hook_args->{'vars'};

if ($page_id eq "splinter.html") {
    # We do this in a way that is safe if the Bugzilla instance doesn't
    # have an attachments.status field (which is a bugzilla.gnome.org
    # addition)
    my $field_object = new Bugzilla::Field({ name => 'attachments.status' });
    my $statuses;
    if ($field_object) {
        $statuses = [map { $_->name } @{ $field_object->legal_values }];
    } else {
        $statuses = [];
    }
    $vars->{'attachment_statuses'} = $statuses;
}
