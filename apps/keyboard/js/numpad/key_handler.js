'use strict';

(function(global) {

    function _fetch(url, then){
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';

        xhr.onload = function() {
            if (xhr.status !== 404 &&
                xhr.response &&
                xhr.response.byteLength) {
                then(xhr.response);
            } else {
                console.error("Numpad input: Failed to load " + url + " with status " + xhr.status + xhr.statusText);
            }
        };
        
        xhr.send();
    }
                            
                            
    var KeypadInput = function(){
        navigator.mozInputMethod.addEventListener('numpadkeypress', this);
    }

    /* helpers */
    function isWordChar(c){
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') 
            || (c.charCodeAt(0) > 255); // now considering all unicode chars as words.
    }
    
    function defWordBoundsFn(value, cursorPos){
        var i = cursorPos;
        while (i > 0 && isWordChar(value.charAt(i-1))) i--;
        return { start: i, end: cursorPos };
    }
        
    function NinetyLib() {
        var ninety, self = this;

        /* initialization */

        _fetch('js/imes/latin/dictionaries/en_us.dict', function(dictionary) {
            ninety = new Ninety(dictionary);
        });

        /* public interface implementation */

        this.findWords = function(value){
            if (ninety) {
                return ninety.findWords("", value.split(''));
            } else {
                return [];
            }
        }

        this.appendWord = function(value, key){
            if (ninety) {
                var keys = ninety.word2keys(value); // need to use this until 'prefix' feature is implemented for Ninety.findWords
                return self.findWords(keys + key)[0];
            }
        }

        this.getWordBounds = defWordBoundsFn;
    }
    
    function MultitapLib(){
        var self = this,
        TAP_TIMEOUT = 1500,
        keypad = {
            '1': '.,?!-1',
            '2': 'abcABC2',
            '3': 'defDEF3',
            '4': 'ghiGHI4',
            '5': 'jklJKL5',
            '6': 'mnoMNO6',
            '7': 'pqrsPQRS7',
            '8': 'tuvTUV8',
            '9': 'wxyzWXYZ9',
            '0': ' 0'
        },
        reverseKeypad = {}, 
        inTimeout = false;  

        for(var key in keypad){
            for(var c of keypad[key]){
                reverseKeypad[c] = key;
            }
        }
        
        function cancelTimer(){
            inTimeout = false;
        }
        
        /* public interface implementation */

        this.findWords = function(value){
            var c = value.charAt(value.length-1);
            return keypad[c]? keypad[c].split(''): [];
        }

        this.appendWord = function(value, key){
            var keys = keypad[key];
            if (!keys) {
                return false;
            }
            if (value.length > 0 && inTimeout) {
                clearTimeout(inTimeout);
                var lastChar = value.charAt(value.length - 1);
                if (reverseKeypad[value.charAt(value.length - 1)] === key){
                    // replace the previous character instead of adding a new one
                    inTimeout = setTimeout(cancelTimer, TAP_TIMEOUT);
                    var i = keys.indexOf(lastChar) + 1;
                    if (i >= keys.length) {
                        i = 0;
                    }
                    return value.substr(0, value.length - 1) + keys.charAt(i);
                }
            }
            // add the first option for the sequence to the end and start the timer
            inTimeout = setTimeout(cancelTimer, TAP_TIMEOUT);
            return value + keys.charAt(0);
        }

        this.getWordBounds = defWordBoundsFn;    
    }
    
    var matchers = [ new NinetyLib(), new MultitapLib() ];
    
    KeypadInput.prototype.handleEvent = function(evt) {
        switch (evt.type) {
            case 'numpadkeypress':
                var key = evt.detail.key;
                var bounds, word, result;
                
                var ctx = navigator.mozInputMethod.inputcontext;
                var text = ctx.textBeforeCursor;
                    
                for (var matcher of matchers) {
                    bounds = matcher.getWordBounds(text, text.length);
                    word = text.substr(bounds.start, bounds.end - bounds.start);
                    
                    result = matcher.appendWord(word, key);
                    if (result) {
                        ctx.replaceSurroundingText(result,-word.length,word.length);
                        //elem.selectionStart = elem.selectionEnd = bounds.start + result.length;
                        return;
                    }
                }
                break;
        }
    };

global.KeypadInput = new KeypadInput();

})(window);
