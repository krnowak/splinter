/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

include('Utils');

// This is a reasonably accurate implementation of the XML-RPC specification, except
// for the data types that aren't implemented. Places where parsing isn't fully
// validating:
//
//  * Element children of elements that are supposed to have only text content
//     are ignored.
//  * Trailing junk on integers and doubles is ignored
//  * integer elements that are out of 32-bit range are accepted

function _appendValue(doc, parent, value) {
    var valueElement = doc.createElement('value');
    parent.appendChild(valueElement);

    var element;
    switch (typeof(value)) {
    case 'boolean':
        element = doc.createElement('boolean');
        element.appendChild(doc.createTextNode(value ? '1' : '0'));
        break;
    case 'object':
        if (value instanceof Date) {
            throw new Error("Date values not yet implemented");
        } else if (value instanceof Array) {
            throw new Error("Array values not yet implemented");
        } else {
            element = doc.createElement('struct');
            for (var i in value) {
                var memberElement = doc.createElement('member');
                var nameElement = doc.createElement('name');
                nameElement.appendChild(doc.createTextNode(i));
                memberElement.appendChild(nameElement);
                var vElement = doc.createElement('value');
                _appendValue(doc, vElement, value[i]);
                memberElement.appendChild(vElement);
                element.appendChild(memberElement);
            }
        }
        break;
    case 'number':
        if (Math.round(value) == value &&
            value >= -0x8000000 && value <= 0x7fffffff)
            element = doc.createElement('int');
        else
            element = doc.createElement('double');
        element.appendChild(doc.createTextNode(value.toString()));
        break;
    case 'string':
        element = doc.createElement('string');
        element.appendChild(doc.createTextNode(value));
        break;
    default:
        throw new Error("Don't know how to handle value of type: " + typeof(value));
    }

    valueElement.appendChild(element);
}

function _appendParam(doc, paramsElement, param) {
    var paramElement = doc.createElement('param');
    _appendValue(doc, paramElement, param);
    paramsElement.appendChild(paramElement);
}

function ParseError(message) {
    this.message = message;
}

ParseError.prototype = {
    toString: function() {
        return "ParseError: " + this.message;
    }
};

function _parseValue(valueElement) {
    var text;
    var value;

    if (valueElement.firstChild == null || valueElement.firstChild.nextChild != null)
        throw new ParseError("<value/> doesn't have a single child");

    var element = valueElement.firstChild;

    switch (element.tagName) {
    case 'boolean':
        text = Utils.strip(element.textContent);
        if (text == '0')
            value = false;
        else if (text == '1')
            value = true;
        else
            throw new ParseError("<boolean/> should be 0 or 1");
        break;
    case 'double':
        text = Utils.strip(element.textContent);
        value = parseFloat(text);
        if (isNaN(value))
            throw new ParseError("<double/> doesn't contain a floating point number");
        break;
    case 'int':
    case 'i4':
        text = Utils.strip(element.textContent);
        value = parseInt(text);
        if (isNaN(value))
            throw new ParseError("<i4/> doesn't contain an integer");
        break;
    case 'struct':
        value = new Object();
        var member = element.firstChild;
        while (member){
            if (member.tagName != 'member')
                throw new ParseError("<struct/> has childeren other than <member/>");

            var nameElement = member.firstChild;
            if (nameElement == null || nameElement.tagName != 'name')
                throw new ParseError("<member/> doesn't have <name/> as the first element");

            var name = nameElement.textContent;

            var valueElement = nameElement.nextSibling;
            if (valueElement == null || valueElement.tagName != 'value')
                throw new ParseError("<member/> doesn't have <value/> as the second element");

            value[name] = _parseValue(valueElement);

            if (valueElement.nextSibling != null)
                throw new ParseError("<member/> has too many children");

            member = member.nextSibling;
        }
        break;
    case 'string':
        value = Utils.strip(element.textContent);
        break;
    case 'array':
    case 'base64':
    case 'dateTime.iso8601':
        throw new ParseError("Support for <" + element.tagName + "/> not yet implemented");
    default:
        throw new ParseError("Unknown value element <" + element.tagName + "/>");
    }

    return value;
}

function _handleSuccess(options, xml) {
    try {
        var root = xml.documentElement;
        if (root.tagName != 'methodResponse')
            throw new ParseError("Root isn't <methodResponse/>");

        if (root.firstChild.tagName == 'params' &&
            root.firstChild.nextSibling == null) {

            var param = root.firstChild.firstChild;
            if (param == null ||
                param.tagName != 'param' ||
                param.nextSibling != null)
                throw new ParseError("<params/> element in response should have <param/> child");

            var value = param.firstChild;
            if (value == null ||
                value.tagName != 'value' ||
                value.nextSibling != null)
                throw new ParseError("<param/> element in response doesn't have a single value as child");

            options.success(_parseValue(value));

        } else if (root.firstChild.tagName == 'fault' &&
                   root.firstChild.nextSibling == null) {

            var value = root.firstChild.firstChild;
            if (value == null ||
                value.tagName != 'value' ||
                value.nextSibling != null)
                throw new ParseError("<fault/> element in response should have <value/> child");

            var struct = value.firstChild;
            if (struct == null ||
                struct.tagName != 'struct')
                throw new ParseError("<value/> element in <fault/> should have <struct/> child");

            var faultStruct = _parseValue(value);

            var faultCode = faultStruct.faultCode;
            var faultString = faultStruct.faultString;

            //  XMLRPC::Lite gives faultCodes like 'Client' at times,
            //  so we don't check for integer, though the spec says
            //  the faultCode should always be an integer
            if (faultCode == null || typeof(faultString) != 'string')
                throw new ParseError("fault structure should contain an [integer] faultCode and string faultString");

            options.fault(faultCode, faultString);

        } else {
            throw new ParseError("Bad content of <methodResponse/>");
        }

    } catch (e) {
        if (e instanceof ParseError)
            options.error(e.message);
        else
            throw e;
    }
}

function call(options) {
    var doc = document.implementation.createDocument(null, "methodCall", null);
    var methodNameElement = doc.createElement("methodName");
    methodNameElement.appendChild(doc.createTextNode(options.name));
    doc.documentElement.appendChild(methodNameElement);
    var paramsElement = doc.createElement("params");
    doc.documentElement.appendChild(paramsElement);

    if (options.params instanceof Array) {
        for (var i = 0; i < params.length; i++) {
            _appendParam(doc, paramsElement, options.params[i]);
        }
    } else if (options.params != null) {
        _appendParam(doc, paramsElement, options.params);
    }

    $.ajax({
               type: 'POST',
               url: options.url,
               ontentType: 'text/xml',
               dataType: 'xml',
               data: (new XMLSerializer()).serializeToString(doc),
               error: function(xmlHttpRequest, textStatus, errorThrown) {
                   options.error(textStatus);
               },
               success: function(xml) {
                   _handleSuccess(options, xml);
               }
           });
}
