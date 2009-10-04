/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/* This is a simple "lightboxed" modal dialog. The only reason I wrote it was
 * so that the the "Cancel" button for a review wouldn't put up a:
 *
 * 'Really discard your changes?' [ OK ] [ Cancel ]
 *
 * dialog with Cancel meaning the opposite thing as the first Cancel - that's
 * what you'd get with window.confirm(). Maybe it has other uses.
 *
 * Usage is:
 *
 *  var dialog = new Dialog(<prompt>, <button_label1>, <callback1>)
 *  dialog.show();
 *  dialog.focus(<button_label1>)
 */

function Dialog() {
    this._init.apply(this, arguments);
}

Dialog.prototype = {
    _init: function(prompt) {
        var q = $("<div id='modalContainer' style='display: none;'>"
                  + "<div id='modalBackground' style='display: none;'></div>"
                  + "<table>"
                  + "<tr><td>"
                  + "<div id='dialog'>"
                  + "<div id='dialogText'></div>"
                  + "<div id='dialogButtons'></div>"
                  + "<div class='clear'></div>"
                  + "</div>"
                  + "</td></tr>"
                  + "</table>"
                  + "</div>")
                      .find("#dialogText").text(prompt).end()
                      .appendTo(document.body);

        this.div = q.get(0);

        if (arguments.length % 2 != 1)
            throw new Error("Must be an even number of label/callback pairs");

        for (var i = 1; i < arguments.length; i += 2) {
            this.addButton(arguments[i], arguments[i + 1]);
        }

        var me = this;
        this._keypress = function(e) {
            if (e.keyCode == 27)
                me.destroy();
        };
        $("body").keypress(this._keypress);
    },

    addButton: function(label, callback) {
        var me = this;
        $("<input type='button' />")
            .val(label)
            .click(function() {
                       me.destroy();
                       callback();
                   })
            .appendTo($(this.div).find("#dialogButtons"));
    },

    destroy: function() {
        $(this.div).remove();
        $("body").unbind('keypress', this._keypress);
    },

    focus: function(label) {
        $(this.div).find('input[value=' + label + ']').focus();
    },

    show: function() {
        $(this.div).show();
        $(this.div).find("#modalBackground").fadeIn(250);
    }
};
