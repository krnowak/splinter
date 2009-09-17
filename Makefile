CFLAGS = -g -O2 -Wall
CPPFLAGS := $(shell pkg-config --cflags glib-2.0 mozilla-js)
LIBS := $(shell pkg-config --libs glib-2.0 mozilla-js)

all: web/splinter.flat.js

jstest: jstest.o
	$(CC) -o jstest jstest.o $(LIBS)

JS_FILES =					\
	js/bug.js				\
	js/bugFromText.js			\
	js/patch.js				\
	js/review.js				\
	js/reviewStorage.js			\
	js/splinter.js				\
	js/testUtils.js				\
	js/utils.js


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

web/splinter.flat.js: $(JS_FILES) flattener.py
	python flattener.py js/splinter.js > $@ || rm -f $@

check: jstest
	./jstest $(TESTS)

clean:
	rm -f $(CLEAN_FILES)

.PHONY: check clean