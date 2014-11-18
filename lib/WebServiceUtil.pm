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

package Bugzilla::Extension::Splinter::WebServiceUtil;

use Bugzilla;
use Bugzilla::Util;

use base qw(Exporter);
our @EXPORT = qw(check_can_access);

use Bugzilla::Extension::Splinter::Util;

# Make sure the current user has access to the specified attachment;
# Based on cut-and-paste from attachment.cgi
sub check_can_access {
    my ($attachment) = @_;

    if (!attachment_is_visible($attachment))
    {
        ThrowUserError('auth_failure', {action => 'access',
                                        object => 'attachment'});
    }

    return 1;
}

1;
