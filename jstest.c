/* -*- mode: C; c-basic-offset: 4; indent-tabs-mode: nil; -*- */
#include "jsapi.h"
#include <glib.h>
#include <locale.h>
#include <string.h>

/* The class of the global object. */
static JSClass global_class = {
    "global", JSCLASS_GLOBAL_FLAGS,
    JS_PropertyStub, JS_PropertyStub, JS_PropertyStub, JS_PropertyStub,
    JS_EnumerateStub, JS_ResolveStub, JS_ConvertStub, JS_FinalizeStub,
    JSCLASS_NO_OPTIONAL_MEMBERS
};

/* The class of module objects. */
static JSClass module_class = {
    "module", JSCLASS_GLOBAL_FLAGS,
    JS_PropertyStub, JS_PropertyStub, JS_PropertyStub, JS_PropertyStub,
    JS_EnumerateStub, JS_ResolveStub, JS_ConvertStub, JS_FinalizeStub,
    JSCLASS_NO_OPTIONAL_MEMBERS
};

/* The error reporter callback. */
static void
reportError(JSContext *cx, const char *message, JSErrorReport *report)
{
    /* Exceptions will be caught when they get thrown to the toplevel */
    if (report->flags & JSREPORT_EXCEPTION)
        return;

    g_warning("%s:%u:%s",
              report->filename ? report->filename : "<no filename>",
              (unsigned int) report->lineno,
              message);
}

static JSObject *
get_modules_map(JSContext *cx)
{
    jsval value;

    JS_GetProperty(cx, JS_GetGlobalObject(cx), "loaded_modules", &value);

    return JSVAL_TO_OBJECT(value);
}

static JSBool
find_module(JSContext *cx, const char *module_name, JSObject **module_out)
{
    jsval value;

    if (!JS_GetProperty(cx, get_modules_map(cx), module_name, &value))
        return JS_FALSE;

    if (value == JSVAL_VOID) {
        *module_out = NULL;
        return JS_TRUE;
    }

    if (!JSVAL_IS_OBJECT(value)) {
        JS_ReportError(cx, "loaded module '%s' is not an object!", module_name);
        return JS_FALSE;
    }

    *module_out = JSVAL_TO_OBJECT(value);

    return JS_TRUE;
}

static JSBool
load_module(JSContext *cx, const char *module_name, JSObject **module_out)
{
    char *lower_name = NULL;
    char *file_name = NULL;
    char *file_path = NULL;
    char *src = NULL;
    gsize length;
    GError *error = NULL;
    JSObject *module;
    jsval dummy;

    lower_name = g_strdup(module_name);
    lower_name[0] = g_ascii_tolower(lower_name[0]);
    file_name = g_strconcat(lower_name, ".js", NULL);
    file_path = g_build_filename("js", file_name, NULL);

    if (!g_file_get_contents(file_path, &src, &length, &error)) {
        JS_ReportError(cx, "%s", error->message);
        g_error_free(error);
        goto out;
    }

    /* Create the module object. */
    module = JS_NewObject(cx, &module_class, JS_GetGlobalObject(cx), NULL);
    if (module == NULL)
        goto out;

    /* Define first to allow recursive imports */
    JS_DefineProperty(cx, get_modules_map(cx), module_name,
                      OBJECT_TO_JSVAL(module), NULL, NULL,
                      JSPROP_PERMANENT | JSPROP_READONLY);

    if (!JS_EvaluateScript(cx, module, src, length, file_name, 0, &dummy)) {
        module = NULL;
        goto out;
    }

 out:
    g_free(src);
    g_free(lower_name);
    g_free(file_name);
    g_free(file_path);

    *module_out = module;

    return module != NULL;
}

static JSBool
fn_include(JSContext *cx, JSObject *obj, uintN argc, jsval *argv, jsval *rval)
{
    const char *module_name;
    JSObject *module = NULL;

    *rval = JSVAL_VOID;

    if (!JS_ConvertArguments(cx, argc, argv, "s", &module_name))
        goto out;

    if (strchr(module_name, '/') != NULL ||
        strchr(module_name, '\\') != 0 ||
        strchr(module_name, '.') != 0)
    {
        JS_ReportError(cx,"'%s' is not a valid module name", module_name);
        goto out;
    }

    if (!find_module (cx, module_name, &module))
        goto out;

    if (module != NULL) /* Found */
        goto out;

    if (!load_module (cx, module_name, &module))
        goto out;

 out:
    if (module != NULL)
        JS_DefineProperty(cx, obj, module_name,
                          OBJECT_TO_JSVAL(module), NULL, NULL,
                          JSPROP_PERMANENT | JSPROP_READONLY);

    return module != NULL;
}

JSBool fn_load(JSContext *cx, JSObject *obj, uintN argc, jsval *argv, jsval *rval)
{
    const char *filename;
    char *contents = NULL;
    gsize length;
    JSBool result = JS_FALSE;
    GError *error = NULL;
    JSString *jsstr;

    if (!JS_ConvertArguments(cx, argc, argv, "s", &filename))
        goto out;

    if (!g_file_get_contents(filename, &contents, &length, &error)) {
        JS_ReportError(cx, "%s", error->message);
        g_error_free(error);
        goto out;
    }

    if (!g_utf8_validate(contents, length, NULL)) {
        JS_ReportError(cx, "Contents of '%s' are not valid UTF-8", filename);
        g_error_free(error);
        goto out;
    }

    jsstr = JS_NewStringCopyN(cx, contents, length);
    if (!rval)
        goto out;

    *rval = STRING_TO_JSVAL(jsstr);

    result = JS_TRUE;

 out:
    g_free(contents);

    return result;
}

JSBool fn_log(JSContext *cx, JSObject *obj, uintN argc, jsval *argv, jsval *rval)
{
    GString *str = g_string_new(NULL);
    uintN i;
    JSBool result = JS_FALSE;

    *rval = JSVAL_VOID;

    for (i = 0; i < argc; i++) {
        JSString *jsstr = JS_ValueToString(cx, argv[i]);
        if (!jsstr)
            goto out;

        if (i != 0)
            g_string_append_c(str, ' ');

        g_string_append(str, JS_GetStringBytes(jsstr));
    }

    g_printerr("%s\n", str->str);
    result = JS_TRUE;

 out:
    g_string_free(str, TRUE);

    return result;
}

static JSFunctionSpec global_functions[] = {
    JS_FS("include", fn_include, 1, 0, 0),
    JS_FS("load", fn_load, 1, 0, 0),
    JS_FS("log", fn_log, 0, 0, 0),
    JS_FS_END
};

static JSBool
get_string_property(JSContext *cx, JSObject *obj, const char *property, char **out)
{
    jsval value;
    JSString *jsstr;

    if (!JS_GetProperty(cx, obj, property, &value))
        return JS_FALSE;

    if (JSVAL_IS_VOID(value) || JSVAL_IS_NULL(value))
        return JS_FALSE;

    jsstr = JS_ValueToString(cx, value);
    *out = g_strdup(JS_GetStringBytes(jsstr));

    return JS_TRUE;
}

static gboolean
process_jst(const char *filename,
            const char *str,
            size_t      len,
            char      **new_str,
            size_t     *new_len)
{
    /* a '.jst" file is a '.js' file with a here document syntax of
     *   <<<\s*\n[text]>>>
     * it's very useful for test cases involving long strings.
     */
    const char *p = str;
    const char *end = str + len;
    gboolean in_string = FALSE;
    GString *result = g_string_new (NULL);
    gboolean success = FALSE;
    int line = 1;
    int str_start_line = 0;
    int str_newlines = 0;

    for (p = str; p < end; p++) {
        if (*p == '\n')
            line++;
        if (in_string) {
            if (p + 3 <= end && p[0] == '<' && p[1] == '<' && p[2] == '<') {
                /* Better to catch missing closes */
                g_warning ("%s:%d: nested <<< not allowed", filename, line);
                goto out;
            } else if (p + 3 <= end && p[0] == '>' && p[1] == '>' && p[2] == '>') {
                int i;

                p += 2;
                in_string = FALSE;
                g_string_append_c(result, '\'');

                /* Compensate, so that the line numbers end up right */
                for (i = 0; i < str_newlines; i++)
                    g_string_append_c(result, '\n');
            } else {
                switch (*p) {
                case '\'':
                    g_string_append (result, "\\'");
                    break;
                case '\n':
                    g_string_append (result, "\\n");
                    str_newlines++;
                    break;
                case '\\':
                    g_string_append (result, "\\\\");
                    break;
                default:
                    g_string_append_c (result, *p);
                    break;
                }
            }
        } else {
            if (p + 3 <= end && p[0] == '<' && p[1] == '<' && p[2] == '<') {
                str_start_line = line;
                p += 3;
                /* Skip whitespace before up to a newline */
                while (p < end && *p != '\n') {
                    if (!g_ascii_isspace(*p)) {
                        g_warning ("%s:%d: <<< has trailing text on the same line", filename, str_start_line);
                        goto out;
                    }
                    p++;
                }

                if (p == end) {
                    g_warning ("%s:%d: <<< not closed", filename, str_start_line);
                    goto out;
                }

                /* Skipping \n */
                line++;
                str_newlines = 1;

                g_string_append_c(result, '\'');
                in_string = TRUE;
            } else {
                g_string_append_c(result, *p);
            }
        }
    }

    if (in_string) {
        g_warning ("%s:%d: <<< not closed", filename, str_start_line);
        goto out;
    }

    success = TRUE;

 out:
    if (success) {
        *new_len = result->len;
        *new_str = g_string_free (result, FALSE);
    } else {
        g_string_free (result, TRUE);
    }

    return success;
}

int main(int argc, const char *argv[])
{
    /* JS variables. */
    JSRuntime *rt;
    JSContext *cx;
    JSObject  *global;
    JSObject  *loaded_modules;
    int i;

    setlocale (LC_ALL, "");

    JS_SetCStringsAreUTF8();

    /* Create a JS runtime. */
    rt = JS_NewRuntime(8L * 1024L * 1024L);
    if (rt == NULL)
        return 1;

    for (i = 1; i < argc; i++) {
        GError *error = NULL;
        char *src;
        gsize length;
        jsval rval;

        /* Create a context. */
        cx = JS_NewContext(rt, 8192);
        if (cx == NULL)
            return 1;
        JS_SetOptions(cx,
                      JSOPTION_VAROBJFIX |
                      JSOPTION_DONT_REPORT_UNCAUGHT |
                      JSOPTION_STRICT);
        JS_SetVersion(cx, JSVERSION_LATEST);
        JS_SetErrorReporter(cx, reportError);

        /* Create the global object. */
        global = JS_NewObject(cx, &global_class, NULL, NULL);
        if (global == NULL)
            return 1;

        /* Populate the global object with the standard globals,
           like Object and Array. */
        if (!JS_InitStandardClasses(cx, global))
            return 1;

        if (!JS_DefineFunctions(cx, global, global_functions))
            return 1;

        if (!g_file_get_contents(argv[i], &src, &length, &error)) {
            g_printerr("%s\n", error->message);
            return 1;
        }

        if (g_str_has_suffix (argv[i], ".jst")) {
            char *new_src;
            gsize new_length;
            if (!process_jst(argv[i], src, length, &new_src, &new_length)) {
                g_free (src);
                continue;
            }
            g_free (src);
            src = new_src;
            length = new_length;
        }

        /* Object to hold loaded modules */
        loaded_modules = JS_NewObject(cx, NULL, NULL, NULL);
        JS_DefineProperty(cx, global, "loaded_modules",
                          OBJECT_TO_JSVAL(loaded_modules), NULL, NULL,
                          JSPROP_PERMANENT | JSPROP_READONLY);

        if (!JS_EvaluateScript(cx, global, src, length, argv[i], 0, &rval)) {
            if (JS_IsExceptionPending(cx)) {
                jsval exception_val;
                JSObject *exception;
                char *stack, *filename, *lineNumber, *message;

                JS_AddRoot(cx, &exception_val);
                JS_GetPendingException(cx, &exception_val);
                JS_ClearPendingException(cx);

                if (JSVAL_IS_OBJECT (exception_val)) {
                    exception = JSVAL_TO_OBJECT(exception_val);

                    if (!get_string_property(cx, exception, "stack", &stack))
                        stack = NULL;
                    if (!get_string_property(cx, exception, "filename", &filename))
                        filename = NULL;
                    if (!get_string_property(cx, exception, "lineNumber", &lineNumber))
                        lineNumber = NULL;
                    if (!get_string_property(cx, exception, "message", &message))
                        message = g_strdup("");

                    if (filename)
                        g_printerr("%s:", filename);
                    if (lineNumber)
                        g_printerr("%s:", lineNumber);
                    g_printerr("%s\n", message);

                    if (stack != NULL)
                        g_printerr("%s", stack);

                    g_free(stack);
                    g_free(filename);
                    g_free(lineNumber);
                    g_free(message);
                } else {
                    JSString *jsstr = JS_ValueToString(cx, exception_val);
                    g_printerr("Exception: %s\n", JS_GetStringBytes(jsstr));

                }

                JS_RemoveRoot(cx, &exception_val);
            }
        }
        g_free(src);

        /* Cleanup. */
        JS_DestroyContext(cx);
    }

    JS_DestroyRuntime(rt);
    JS_ShutDown();
    return 0;
}
