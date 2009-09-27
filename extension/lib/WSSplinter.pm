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

package extensions::splinter::lib::WSSplinter;
use strict;
use warnings;

use Bugzilla;

use base qw(Bugzilla::WebService);

sub info {
    my $user = Bugzilla->login;

    my $results = {
	version => 1
    };

    if ($user->login ne '') {
	$results->{'logged_in'} = 1;
	$results->{'login'} = $user->login;
	$results->{'name'} = $user->name;
    } else {
	$results->{'logged_in'} = 0;
    }

    return $results;
}

1;
