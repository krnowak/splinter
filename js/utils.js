/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

function assert(condition) {
    if (!condition)
        throw new Error("Assertion failed");
}

function assertNotReached() {
    if (expected != value) {
        throw new Error("Assertion failed: should not be reached");
    }
}

function strip(string) {
    return /^\s*([\s\S]*?)\s*$/.exec(string)[1];
}

function lstrip(string) {
    return /^\s*([\s\S]*)$/.exec(string)[1];
}

function rstrip(string) {
    return /^([\s\S]*?)\s*$/.exec(string)[1];
}

function formatDate(date, now) {
    if (now == null)
        now = new Date();
    var daysAgo = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
    if (daysAgo < 0 && now.getDate() != date.getDate())
        return date.toLocaleDateString();
    else if (daysAgo < 1 && now.getDate() == date.getDate())
        return date.toLocaleTimeString();
    else if (daysAgo < 7 && now.getDay() != date.getDay())
        return ['Sun', 'Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()] + " " + date.toLocaleTimeString();
    else
        return date.toLocaleDateString();
}
