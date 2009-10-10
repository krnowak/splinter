#!/usr/bin/python

import os
import re
import sys

CONTINUATION = r".*\n(?:^[ \t].*\n|\n)*"

RE = re.compile(
r"""
\s*
(?:^
include\s*\(\s*\'([^\']+)\'\s*\)\s*; |
(?:function\s+(\w+)\s*           (\(.*;|%(c)s^\})) |
(?:(\w+)\.(\w+(?:\.\w+)*)\s*=\s* (.*;|%(c)s^[\]\}];)) |
(?:(?:const|let|var)\s+(\w+)     (.*;|%(c)s^[\]\}];)) |
/\*(?:[^*]+|\*[^/])*\*/ |
//.*
[ \t]*\n)
""" % { 'c' : CONTINUATION },
re.VERBOSE | re.MULTILINE)

NONBLANK_RE = re.compile("\S")

NAME_RE = re.compile("(?<![\w\.])\w+(?!\w)")

def moduleToFilename(module_name):
    base_name = module_name[0].lower() + module_name[1:] + ".js"
    return os.path.join("js", base_name)

class Flattener(object):
    def __init__(self, outf):
        self.outf = outf
        self.flattened_modules = set()

    def output_prologue(self):
        self.outf.write("""\
// Splinter - patch review add-on for Bugzilla
// By Owen Taylor <otaylor@fishsoup.net>
// Copyright 2009, Red Hat, Inc.
// Licensed under MPL 1.1 or later, or GPL 2 or later
// http://git.fishsoup.net/cgit/splinter

if (!console) {
    var console = {};
    console.log = function() {};
}
""");

    def flatten(self, filename, namespace=None):
        locals = {}
        f = open(filename)
        contents = f.read()

        def error(pos):
            m = NONBLANK_RE.search(contents, pos)
            leading = contents[0:m.start()]
            line = 1 + leading.count("\n")
            print >>sys.stderr, "%s: %d: Unparseable content\n" % (filename, line)
            sys.exit(1)

        def add_local(name):
            locals[name] = namespace + "." + name

        def substitute_name(m):
            name = m.group(0)
            if name in locals:
                return locals[name]
            else:
                return name

        def substitute_locals(str):
            return NAME_RE.sub(substitute_name, str)

        last_end = 0
        for m in RE.finditer(contents):
            if m.start() != last_end:
                error(last_end)

            if m.group(1) is not None:
                module_name = m.group(1)
                if not module_name in self.flattened_modules:
                    self.flattened_modules.add(module_name)
                    print >>self.outf, "var %s = {};" % module_name
                    self.flatten(moduleToFilename(module_name), module_name)
            elif m.group(2) is not None:
                if namespace is None:
                    print >>self.outf, "function %s%s" % (m.group(2), m.group(3))
                else:
                    add_local(m.group(2))
                    print >>self.outf, "%s.%s = function%s;" % (namespace, m.group(2), substitute_locals(m.group(3)))
            elif m.group(4) is not None:
                if m.group(4) == "jQuery" or namespace is None:
                    print >>self.outf, "%s.%s = %s" % (m.group(4), m.group(5), m.group(6))
                else:
                    print >>self.outf, "%s.%s.%s = %s" % (namespace, m.group(4), m.group(5), substitute_locals(m.group(6)))
            elif m.group(7) is not None:
                if namespace is None:
                    print >>self.outf, "var %s%s" % (m.group(7), m.group(8))
                else:
                    add_local(m.group(7))
                    print >>self.outf, "%s.%s%s" % (namespace, m.group(7), substitute_locals(m.group(8)))

            last_end = m.end()

        m = NONBLANK_RE.search(contents, last_end)
        if m:
            error(last_end)

if __name__ == '__main__':
    flattener = Flattener(sys.stdout)
    flattener.output_prologue()
    for filename in sys.argv[1:]:
        flattener.flatten(filename)
