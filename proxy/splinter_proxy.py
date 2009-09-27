#!/usr/bin/python

import config
from BaseHTTPServer import HTTPServer
import httplib
import Cookie
from optparse import OptionParser
import os
from SimpleHTTPServer import SimpleHTTPRequestHandler
import socket
from SocketServer import ForkingMixIn
import time
import urlparse
import re
import sys
import xmlrpclib

# Restricting this isn't a security measure; these URLs are enough to
# to basically anything you could do with Bugzilla; it's just a way of
# keeping separate what we should proxy and what we should serve from
# files.
PROXIED_PATHS = [
    "/attachment.cgi",
    "/process_bug.cgi",
    "/show_bug.cgi"
]

def is_proxied(path):
    for p in PROXIED_PATHS:
        l = len(p)
        if (path.startswith(p) and
            (len(path) == l or (len(path) > l and path[l] == '?'))):
            return True
    return False

# Cookie values we'll send to Bugzilla if logged in
login_cookie_header = None

# Time we started the proxy server
start_time = time.time()

# Content for config.js
config_js_content = None

# This wraps up the pure-tuple old SplitResult into an object with attributes
# like the new version
class CompatSplitResult:
    def __init__(self, *args):
        (self.scheme, self.netloc, self.path, self.query, self.fragment) = args
        colon = self.netloc.find(':')
        if colon >= 0:
            self.hostname = self.netloc[0:colon]
            self.port = self.netloc[colon + 1:]
        else:
            self.hostname = self.netloc
            self.port = None

def urlsplit(url):
    tuple = urlparse.urlsplit(url)
    return CompatSplitResult(*tuple)

def port_from_scheme(scheme, override):
    if scheme =='http':
        if override:
            return override
        else:
            return 80
    elif scheme =='https':
        if override:
            return override
        else:
            return 443
    else:
        raise RuntimeError("Bad scheme %s" % scheme)

# Convert an URL we received from a client to all the information we'll
# need to proxy to the Bugzilla server - host, port, new path, etc.
def get_proxy_info(path):
    split = urlsplit(current_config['bugzilla_url'])
    if split.port:
        portstr = ":" + str(split.port)
    else:
        portstr = ""
    port = port_from_scheme(split.scheme, split.port)

    url = "%s://%s%s%s" % (split.scheme, split.hostname,
                           portstr, split.path + path)

    return split.scheme, split.hostname, port, split.path + path, url

# Without the mixin, HTTPServer is single-connection-at-a-time
class ProxyServer(HTTPServer, ForkingMixIn):
    pass

# Extend SimpleHTTPRequestHandler to proxy certain URLs to HTTP
# rather than serving from local files
class ProxyHandler(SimpleHTTPRequestHandler):
    # Send the response on to the client; called directly from do_proxied()
    # normally but from do_redirect() if there was a redirect
    def relay_response(self, response):
        self.send_response(response.status, response.reason)
        content = response.read()
        seen_expires = False
        for header, value in response.getheaders():
            # BaseHTTPRequestHandler sends the 'Server' and 'Date' headers
            # We are handling the "session" with Bugzilla ourselves, so we
            # don't want the browser getting Bugzilla's cookies
            #
            # Remove Transfer-Encoding since we end up converting chunked
            # Transfer-Encoding to unchunked.
            if header.lower() in ('date', 'server', 'set-cookie', 'transfer-encoding', 'content-length'):
                continue
            if header.lower() == 'expires':
                seen_expires = True
            self.send_header(header, value)
        if not seen_expires and self.command == 'GET':
            # Assume that attachments are immutable - give them an Expires of a month
            if self.path.startswith('/attachment.cgi?'):
                self.send_header('Expires', self.date_time_string(time.time() + 31*24*60*60))
            # If we are running anonymously, allow bug content to be cached for 5 minutes
            elif not ('bugzilla_login' in current_config and 'bugzilla_login' in current_config):
                self.send_header('Expires', self.date_time_string(time.time() + 5*60))
        self.send_header('content-length', len(content))
        self.end_headers()
        self.wfile.write(content)
        self.wfile.close()

    def do_proxied(self):
        proxy_scheme, proxy_hostname, proxy_port, proxy_path, proxy_url = get_proxy_info(self.path)
        if (proxy_scheme == 'http'):
            connection = httplib.HTTPConnection(proxy_hostname, proxy_port)
        else:
            connection = httplib.HTTPSConnection(proxy_hostname, proxy_port)

        self.log_message("Proxying to %s", proxy_url)

        connection.putrequest(self.command, proxy_path)
        content_length = -1;
        for header, value in self.headers.items():
            if header.lower() == 'content-length':
                content_length = long(value)
            # httplib.py will send an appropriate Host: header, we'll send
            # the cookies for our "session" with Bugzilla ourselves
            if not header.lower() in ('cookie', 'host', 'x-forwarded-host', 'x-forwarded-server'):
                connection.putheader(header, value)
        if login_cookie_header is not None:
            connection.putheader('Cookie', login_cookie_header)
        connection.endheaders()
        if content_length > 0:
            connection.send(self.rfile.read(content_length))

        response = connection.getresponse()

        if not self.maybe_redirect(response, [proxy_url]):
            self.relay_response(response)

        connection.close()

    def maybe_redirect(self, response, seen_urls):
        # Redirect status codes are a bit confusing; 302 (Found) by
        # tradition is handled like 303 (See Other) - a new request is
        # made with a method of GET without regard to the original
        # method
        #
        # See http://en.wikipedia.org/wiki/HTTP_302
        #
        # No need to support
        # 301 (Moved Permanently) 307 (Temporary Redirect)
        # at the moment.
        #
        # We need the 302 handling because Bugzilla (depending on the
        # attachment_base parameter) redirects attachment.cgi&action=view
        # to a different URL for security.
        if response.status in (302, 303):
            location = response.getheader('location')
            if location:
                if location in seen_urls or len(seen_urls) >= 10:
                    self.send_error(400, 'Circular redirection, or too many redirects')
                else:
                    seen_urls.append(location)
                    self.do_redirect(location, seen_urls)
                return True

        return False

    # Retry the request with a GET after a redirect
    def do_redirect(self, location, seen_urls):
        self.log_message("Redirecting to %s", location)
        split = urlsplit(location)
        port = port_from_scheme(split.scheme, split.port)

        if (split.scheme == 'http'):
            connection = httplib.HTTPConnection(split.hostname, split.port)
        else:
            connection = httplib.HTTPSConnection(split.hostname, split.port)

        relative = urlparse.urlunsplit((None, None, split.path, split.query, split.fragment))
        connection.putrequest('GET', relative)
        for header, value in self.headers.items():
            # We additionally exclude content-length since it would
            # be referring to the data sent with an original POST and
            # we're not sending that data with the redirected GET
            if not header.lower() in ('cookie', 'host',  'x-forwarded-host', 'x-forwarded-server', 'content-length'):
                connection.putheader(header, value)
        if login_cookie_header is not None:
            connection.putheader('Cookie', login_cookie_header)
        connection.endheaders()

        response = connection.getresponse()
        if not self.maybe_redirect(response, seen_urls):
            self.relay_response(response)

        connection.close()

    # Copy of date_time_string() in the Python-2.6 BaseHttpRequestHandler
    # Differs from the the Python-2.4 version in taking an optional time to format.
    def date_time_string(self, timestamp=None):
        """Return the current date and time formatted for a message header."""
        if timestamp is None:
            timestamp = time.time()
        year, month, day, hh, mm, ss, wd, y, z = time.gmtime(timestamp)
        s = "%s, %02d %3s %4d %02d:%02d:%02d GMT" % (
                self.weekdayname[wd],
                day, self.monthname[month], year,
                hh, mm, ss)
        return s

    def do_config_js(self):
        self.send_response(200, "OK")
        self.send_header("Content-type", "text/javascript")
        self.send_header("Content-Length", str(len(config_js_content)))
        self.send_header("Last-Modified", self.date_time_string(start_time))
        self.end_headers()

        if (self.command == 'GET'):
            self.wfile.write(config_js_content)

        self.wfile.close()

    # Overrides

    def version_string(self):
        return "splinter_proxy.py 0.1"

    def do_GET(self):
        if is_proxied(self.path):
            self.do_proxied()
        elif self.path == "/config.js":
            self.do_config_js()
        else:
            SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        if is_proxied(self.path):
            self.do_proxied()
        elif self.path == "/config.js":
            self.do_config_js()
        else:
            SimpleHTTPRequestHandler.do_HEAD(self)

    def do_POST(self):
        if is_proxied(self.path):
            self.do_proxied()
            return

        self.send_error(404, 'Not Found')

# We got a reply to our attempt to log in. If it was succesful
# it will contain a Set-Cookie
def check_login_headers(headers):
    # The Cookie class is really meant to be used server side; so it has
    # good support for parsing Cookie headers, and generating Set-Cookie
    # headers. We're abusing it here to do "client-side' processing
    # where we need to parse Set-Cookie headers and generate Cookie headers.
    global login_cookie_header
    login_cookie = None
    for header, value in headers.items():
        if header.lower() == "set-cookie":
            if login_cookie == None:
                login_cookie = Cookie.SimpleCookie()
            login_cookie.load(value)
    login_header = ""
    if login_cookie is None:
        return

    for key, morsel in login_cookie.iteritems():
        if login_cookie_header is None:
            login_cookie_header = ""
        else:
            login_cookie_header += "; "
        login_cookie_header += key + "=" + morsel.coded_value
        # attributes in the Cookie: header are represented as $Attribute
        # to distinguish them from cookie names, since it's:
        # Cookie: name=val; attr=val; attr=val; name=val; attr=val
        if 'path' in morsel and morsel['path'] != '':
            login_cookie_header += "; $Path=" + Cookie._quote(morsel['path'])
        if 'domain' in morsel and morsel['domain'] != '':
            login_cookie_header += "; $Domain=" + Cookie._quote(morsel['domain'])


# We need to hook in to the raw response received by xmlrpclib to get the
# cookie headers; we do this with a series of trivial subclasses - we
# subclass httplib.HTTP[S] to override getreply() and then a subclass
# of xmlrpclib.Transport to make it create the appropriate connection
# subclass.
class LoginTransport(xmlrpclib.Transport):
    def __init__(self, scheme, hostname, port):
        xmlrpclib.Transport.__init__(self)
        self.scheme = scheme
        self.hostname = hostname
        self.port = port

    def make_connection(self, host):
        if self.scheme == 'http':
            return LoginConnection(self.hostname, self.port)
        else:
            return LoginConnectionS(self.hostname, self.port)

class LoginConnection(httplib.HTTP):
    def getreply(self):
        errcode, errmsg, headers = httplib.HTTP.getreply(self)
        check_login_headers(headers)
        return errcode, errmsg, headers

class LoginConnectionS(httplib.HTTPS):
    def getreply(self):
        errcode, errmsg, headers = httplib.HTTPS.getreply(self)
        check_login_headers(headers)
        return errcode, errmsg, headers

# Try to log in; we log in once every time the proxy is started, and don't
# try to remember our cookies. Cookies will be deleted from the server
# after 30 days of non-use.
def login():
    proxy_scheme, proxy_hostname, proxy_port, proxy_path, proxy_url = get_proxy_info("/xmlrpc.cgi")
    transport = LoginTransport(proxy_scheme, proxy_hostname, proxy_port)
    xmlrpc = xmlrpclib.ServerProxy(proxy_url, transport)
    try:
        # 'remember: 0' basically just causes the server not to send an
        # Expires: parameter with the cookie, but it serves as a hint
        # to our intent if Bugzilla's login cookie handling chanes
        xmlrpc.User.login({ 'login': current_config['bugzilla_login'],
                            'password': current_config['bugzilla_password'],
                            'remember': 0 })
        print >>sys.stderr, "Successfully logged into %s" % current_config['bugzilla_url']
    except xmlrpclib.Fault, e:
        print >>sys.stderr, "Can't log in to %s: %s" % (current_config['bugzilla_url'],
                                                        e.faultString)
    except xmlrpclib.ProtocolError, e:
        print >>sys.stderr, "Can't log in to %s: %d %s" % (current_config['bugzilla_url'],
                                                           e.errcode,
                                                           e.errmsg)
    except (socket.error, socket.herror, socket.gaierror), e:
        print >>sys.stderr, "Can't log in to %s: %s" % (current_config['bugzilla_url'],
                                                        e.args[1])

def read_config_js():
    try:
        f = open("../web/config.js")
    except IOError:
        print >>sys.stderr, "web/config.js doesn't exist; you need to create it from config.js.example"
        sys.exit(1)

    content = f.read()
    f.close()

    content = content.replace('@@BUGZILLA_URL@@',  current_config['bugzilla_url'])
    if 'bugzilla_login' in current_config and 'bugzilla_login' in current_config:
        note = ''
    else:
        note = 'This is a read-only demo instance of Splinter; you will not be able to publish your reviews'
    content = content.replace('@@NOTE@@',  note)

    return content

def redirect_to_log(log_file):
    outf = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND)
    os.close(1)
    os.dup2(outf, 1)
    os.close(2)
    os.dup2(outf, 2)
    os.close(outf)

# Standard double-fork daemonization
def daemonize():
    global main_process

    pid = os.fork()
    if pid > 0:
        main_process = False
        sys.exit(0)

    os.setsid()

    devnullin = os.open("/dev/null", os.O_RDONLY)
    os.close(0)
    os.dup2(devnullin, 0)
    os.close(devnullin)

    pid = os.fork()
    if pid > 0:
        main_process = False
        sys.exit(0)

########################################

# SimpleHTTPRequestHandler serves files relative to the current working directory
# so chdir to our document root (../web)
script_path = os.path.realpath(os.path.abspath(sys.argv[0]))
top_dir = os.path.dirname(os.path.dirname(script_path))
os.chdir(os.path.join(top_dir, "web"))

parser = OptionParser()
parser.add_option("-d", "--daemonize", action='store_true',
                  help="run as a daemon")
parser.add_option("", "--pid-file",
                  help="location to write PID of daemon")
parser.add_option("-l", "--log", metavar="<log file>",
                  help="file to log to")

options, args = parser.parse_args()

if options.log:
    redirect_to_log(options.log)

if options.daemonize:
    daemonize()
    if options.pid_file:
        try:
            pid_file = open(options.pid_file, "w")
            pid_file.write("%d\n" % os.getpid())
            pid_file.close()
        except IOError, e:
            print >>sys.stderr, "Cannot write pid to '%s': %s" % (options.pid_file, e.args[1])

if len(args) == 0:
    config_name = config.default_config
elif len(args) == 1:
    config_name = args[1]
else:
    print >>sys.stderr, "Usage: splinter_proxy.py [--daemonize] [--log=<logfile>] [<config_name>]"
    sys.exit(1)

if not config_name in config.configs:
    print >>sys.stderr, "Usage: Configuration name '%s' is not defined in config.py" % config_name
    sys.exit(1)

current_config = config.configs[config_name]

config_js_content = read_config_js()

if 'bugzilla_login' in current_config and 'bugzilla_login' in current_config:
    if 'proxy_bind' in current_config and current_config['proxy_bind'] != '127.0.0.1':
        # anybody connecting to the proxy can do ABSOLUTELY ANYTHING
        # with your bugzilla account.
        print >>sys.stderr, "proxy_bind is '%s' not '127.0.0.1" % current_config['proxy_bind']
        print >>sys.stderr, "Refusing to log in with private login/password"
    else:
        login()

if login_cookie_header is None:
    print >>sys.stderr, "Proxying to %s anonymously" % (current_config['bugzilla_url'])

proxy_bind = '127.0.0.1'
proxy_port = 23080
if 'proxy_bind' in current_config:
    proxy_bind = current_config['proxy_bind']
if 'proxy_port' in current_config:
    proxy_port = current_config['proxy_port']

print >>sys.stderr, "Running as http://%s:%d/index.html" % (proxy_bind, proxy_port)

httpd = HTTPServer((proxy_bind, proxy_port), ProxyHandler)
httpd.serve_forever()
