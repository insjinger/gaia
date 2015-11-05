var Ninety = (function() {
  'use strict';

  function Ninety(dictionary, keypadMap) {
    this.initDictionary(dictionary);
    this.keypadMap = keypadMap || Ninety.DEFAULT_KEYPAD_MAP;
    
    this.reverseKeypad = {};
    for(var key in this.keypadMap){
        for(var c of this.keypadMap[key]){
            this.reverseKeypad[c] = key;
        }
    }
  }

  Ninety.DEFAULT_KEYPAD_MAP = {
    '2': 'abcABC',
    '3': 'defDEF',
    '4': 'ghiGHI',
    '5': 'jklJKL',
    '6': 'mnoMNO',
    '7': 'pqrsPQRS',
    '8': 'tuvTUV',
    '9': 'wxyzWXYZ'
  };

  // How much do we boost the frequency of complete words
  Ninety.COMPLETE_WORD_BONUS = 2;

  Ninety.prototype.initDictionary = function(dictionary) {
    var file = new Uint8Array(dictionary);

    function uint32(offset) {
      return (file[offset] << 24) +
        (file[offset + 1] << 16) +
        (file[offset + 2] << 8) +
        file[offset + 3];
    }

    function uint16(offset) {
      return (file[offset] << 8) +
        file[offset + 1];
    }

    if (uint32(0) !== 0x46784F53 ||   // "FxOS"
        uint32(4) !== 0x44494354) {   // "DICT"
      throw new Error('Invalid dictionary file');
    }

    if (uint32(8) !== 1) {
      throw new Error('Unknown dictionary version');
    }

    // Read the maximum word length.
    // We add 1 because word predictions can delete characters, so the
    // user could type one extra character and we might still predict it.
    this.maxWordLength = file[12] + 1;

    // Skip the table of characters and frequencies.
    var numEntries = uint16(13);

    // The dictionary data begins right after the character table
    this.tree = new Uint8Array(dictionary, 15 + numEntries * 6);
  };

  //
  // This function unpacks binary data from the dictionary and returns
  // the nodes of the dictionary tree in expanded form as JS objects.
  // See gaia/dictionaries/xml2dict.py for the corresponding code that
  // serializes the nodes of the tree into this binary format. Full
  // documentation of the binary format is in that file.
  //
  Ninety.prototype.readNode = function(offset, node) {
    if (offset === -1) {
      throw Error('Assertion error: followed invalid pointer');
    }

    var firstbyte = this.tree[offset++];
    var haschar = firstbyte & 0x80;
    var bigchar = firstbyte & 0x40;
    var hasnext = firstbyte & 0x20;
    node.freq = (firstbyte & 0x1F) + 1;  // frequencies range from 1 to 32

    if (haschar) {
      node.ch = this.tree[offset++];
      if (bigchar) {
        node.ch = (node.ch << 8) + this.tree[offset++];
      }
    }
    else {
      node.ch = 0;
    }

    if (hasnext) {
      node.next =
        (this.tree[offset++] << 16) +
        (this.tree[offset++] << 8) +
        this.tree[offset++];
    }
    else {
      node.next = -1;
    }

    if (haschar) {
      node.center = offset;
    } else {
      node.center = -1;
    }

/*
    log("readNode:" +
        " haschar:" + haschar +
        " bigchar:" + bigchar +
        " hasnext:" + hasnext +
        " freq:" + node.freq +
        " char:" + node.ch +
        " next:" + node.next +
        " center:" + node.center);
*/
  };

  /*
   * Given a string prefix and an array of digits, return words or word
   * prefixes that match
   *
   * TODO:
   *
   * DONE give words that are complete a frequency bump up
   *
   * find high frequency completions for high-frequency prefixes?
   *   see what T9 does here
   *
   * Allow any punctuation characters that are not on any key
   *
   * add accents to the keypad map. Automate it so that case and
   *  variants are automatically added? Also make a list of unmapped
   *  characters that we'll add in for free
   *
   * measure perf
   *
   * add caching to improve performance especially when backspacing
   *
   * implement the prefix argument
   *
   * think about spelling correction. If the user wants to type "the"
   * but types 834 instead of 843, should they get "the", or get
   * "veg"? What does T9 do for common typos like this?
   */
  Ninety.prototype.findWords = function(prefix, digits) {
    // XXX: we're going to assume that prefix is the empty string right now
    // If not, we'll want to find the prefix in the tree and use that as the
    // root of the search, I think.

    // Start off with a list of one word, the empty string
    var words = [{
      pointer: 0,
      output: ""
    }];

    for(var digit of digits) {
      console.log("digit:", digit);
      // These are the characters that map to that keypad digit
      var keypadChars = this.keypadMap[digit];
      if (!keypadChars) {
        //throw new Error('Not a valid keypad digit: ' + digit);
        return [];
      }
      // For each input digit we loop through all of the words we've
      // got and see whether we can make any new, longer, words
      var newwords = [];
      var node = {}

      for(var word of words) {
        //console.log("word:", JSON.stringify(word));
        // Read the node that represents this word, then loop through
        // all of the letters that can follow it.
        for(var pointer = word.pointer; pointer !== -1; pointer = node.next) {
          this.readNode(pointer, node);

          // What is the character here?
          var char = String.fromCharCode(node.ch);

          // If that character is one of the characters associated with
          // this key of the keypad, then add it to the word
          if (keypadChars.indexOf(char) >= 0) {
            // console.log("Found a new word", word.output + char, node.freq);
            newwords.push({
              pointer: node.center,
              frequency: node.freq,
              output: word.output + char
            });
          }
        }
      }

      // replace the old list of words with the new one
      console.log("Ninety: had", words.length, "words, now have", newwords.length);
      words = newwords;

      // If at any point we have no candidate words, then we can
      // return early.
      if (words.length === 0) {
        return [];
      }
    }

    // Make another pass over the words and boost the frequency of
    // words that are complete, so that they get shown in preference
    // to prefixes
    for(var word of words) {
      var freq = this.isCompleteWord(word.pointer);
      if (freq > 0) {
        word.frequency = freq * Ninety.COMPLETE_WORD_BONUS;
        console.log("Ninety:", word.output, "is a complete word with frequency", freq);
      }
    }

    // After we've processed all the digits, sort the words by frequency
    // and return an array of just the strings
    return words.sort((a,b) => b.frequency - a.frequency).map(w => w.output);
  };

  // If the string at the specified pointer is a complete word, return the
  // frequency of that word. If it is not a valid word, return false
  Ninety.prototype.isCompleteWord = function(pointer) {
    var node = {};

    while(pointer !== -1) {
      this.readNode(pointer, node);
      if (node.ch === 0) {
        return node.freq;
      }
      pointer = node.next;
    }

    return false;
  };
  
  Ninety.prototype.word2keys = function(word){
    var key, result = "";
    for (var c of word) {
        key = this.reverseKeypad[c];
        if (key) result += key;
    }
    return result;
  }

  return Ninety;
}());
