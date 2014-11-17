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
@extensions::splinter::lib::SplinterUtil::EXPORT = qw(attachment_is_visible);

# Checks if the current user can see an attachment
# Based on code from attachment.cgi
sub attachment_is_visible {
    my $attachment = shift;

    return (Bugzilla->user->can_see_bug($attachment->bug->id) &&
            (!$attachment->isprivate ||
             Bugzilla->user->id == $attachment->attacher->id ||
             Bugzilla->user->is_insider));
}
