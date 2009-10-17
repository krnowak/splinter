CFLAGS = -g -O2 -Wall
CPPFLAGS := $(shell pkg-config --cflags glib-2.0 mozilla-js)
LIBS := $(shell pkg-config --libs glib-2.0 mozilla-js)

all: web/splinter.flat.js web/index.html

jstest: jstest.o
	$(CC) -o jstest jstest.o $(LIBS)

JS_FILES =					\
	js/bug.js				\
	js/bugFromText.js			\
	js/dialog.js				\
	js/patch.js				\
	js/review.js				\
	js/reviewStorage.js			\
	js/splinter.js				\
	js/testUtils.js				\
	js/utils.js				\
	js/xmlRpc.js


TESTS =						\
	tests/bug.jst				\
	tests/patch.jst				\
	tests/review.jst			\
	tests/testUtils.jst			\
	tests/utils.jst

CLEAN_FILES =					\
	*.o					\
	jstest					\
	web/splinter.flat.js

WEB_FILES =					\
	web/help.html				\
	web/index.html				\
	web/jquery.min.js			\
	web/splinter.css			\
	web/splinter.flat.js

EXTENSION_FILES =							\
	extension/code/bug-format_comment.pl				\
	extension/code/config-add_panels.pl				\
	extension/code/page-before_template.pl				\
	extension/code/webservice.pl					\
	extension/info.pl						\
	extension/lib/ConfigSplinter.pm					\
	extension/lib/SplinterUtil.pm					\
	extension/lib/WSSplinter.pm					\
	extension/template/en/attachment/list-action.html.tmpl		\
	extension/template/en/default/admin/params/splinter.html.tmpl	\
	extension/template/en/default/pages/splinter.html.tmpl

web/splinter.flat.js: $(JS_FILES) flattener.py
	python flattener.py js/splinter.js > $@ || rm -f $@

define SUBSTITUTE_BODY
perl -ne 'BEGIN {				\
    local $$/;					\
    open F, "web/index.html.body";		\
    $$body = <F>;				\
    close(F);					\
}						\
						\
if (/\@\@BODY\@\@/) {				\
    print $$body;				\
} else {					\
    print;					\
}'
endef

extension/template/en/default/pages/splinter.html.tmpl: extension/template/en/default/pages/splinter.html.tmpl.in web/index.html.body
	$(SUBSTITUTE_BODY) $< > $@ || rm $@

web/index.html: web/index.html.in web/index.html.body
	$(SUBSTITUTE_BODY) $< > $@ || rm $@

install: $(WEB_FILES) $(EXTENSION_FILES)
	@BUGZILLA_ROOT="$(BUGZILLA_ROOT)";											\
	BUGZILLA_ROOT=$${BUGZILLA_ROOT:-`git config splinter.bugzilla-root`} ;							\
	[ "$$BUGZILLA_ROOT" = "" ] && echo >&2 "Usage: make install BUGZILLA_ROOT=<path to bugzilla>" && exit 1 ;		\
	webservergroup=`sed -n '{ s/$$webservergroup *= *'[\'\"]'\(.*\)'[\'\"]' *; */\1/ p }' $$BUGZILLA_ROOT/localconfig` ;	\
	[ "$$webservergroup" = "" ] && echo >&2 "Can't find webservergroup in $$BUGZILLA_ROOT/localconfig" && exit 1 ;		\
	echo "Removing old install" ;												\
	rm -rf $$BUGZILLA_ROOT/extensions/splinter ;										\
	ensuredir() {														\
		if [ -d `dirname $$1` ] ; then : ; else										\
			ensuredir `dirname $$1` ;										\
			install -g $$webservergroup -m 0750 -d `dirname $$1` || exit 1 ;					\
		fi														\
	} ;															\
	installone() {														\
		d=`dirname $$2` ;												\
		echo "Installing $$1 => $$d" ;											\
		ensuredir $$2 ;													\
		install -g $$webservergroup -m 0640 $$1 $$2 || exit 1 ;								\
	} ;															\
	for i in $(EXTENSION_FILES) ; do											\
		installone $$i $$BUGZILLA_ROOT/extensions/splinter/$${i#extension/} ;						\
	done ;															\
	for i in $(WEB_FILES) ; do												\
		installone $$i $$BUGZILLA_ROOT/extensions/splinter/$$i ;							\
	done

check: jstest
	./jstest $(TESTS)

clean:
	rm -f $(CLEAN_FILES)

.PHONY: check clean