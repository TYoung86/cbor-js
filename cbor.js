/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Patrick Gansterer <paroga@paroga.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

//noinspection ThisExpressionReferencesGlobalObjectJS
(function (global, undefined) {
  "use strict";
  //var POW_2_24 = 5.960464477539063e-8;
  var POW_2_32 = 4294967296;
  var POW_2_53 = 9007199254740992;

  var singleFloatView = new Float32Array(1);
  var singleIntView = new Uint32Array(singleFloatView.buffer);

  function decodeFloat16(value) {
    var exponent = (value & 0x7C00) >> 10,
      fraction = value & 0x03FF;
    return (value >> 15 ? -1 : 1) * (
        exponent ?
          (
            exponent === 0x1F ?
              fraction ? NaN : Infinity :
            Math.pow(2, exponent - 15) * (1 + fraction / 0x400)
          ) :
        6.103515625e-5 * (fraction / 0x400)
      );
  }

  function checkFloat32(value) {
    singleFloatView[0] = value;
    var xf = singleFloatView[0];
    // skip NaN check, should be encoded as float 16
    return xf === value ? singleIntView[0] : false;
  }

  function getFloat16(value) {
    singleFloatView[0] = value;
    var fbits = singleIntView[0];


    /* fast but dirty, causes test failures
    return (
     ((fbits>>16)&0x8000)|
     ((((fbits&0x7f800000)-0x38000000)>>13)&0x7c00)|
     ((fbits>>13)&0x03ff)
    );
    */


    var sign = ( fbits >> 16 ) & 0x8000;          // sign only
    var exponentAndMantissa = fbits & 0x7fffffff;
    var val = ( exponentAndMantissa ) + 0x1000; // rounded value

    if (val >= 0x47800000) {
      /* jshint laxbreak:true */
      return val < 0x7f800000
        ? sign | 0x7c00
        : sign | 0x7c00 | ( fbits & 0x007fffff ) >> 13;
      /* jshint laxbreak:false */
    }


    if (val >= 0x38800000) {             // remains normalized value
      return sign | val - 0x38000000 >> 13; // exp - 127 + 15
    }

    if (val < 0x33000000) {             // too small for subnormal
      return sign;                        // becomes +/-0
    }
    
    val = ( exponentAndMantissa ) >> 23;   // tmp exp for subnormal calc
    return sign | ( ( fbits & 0x7fffff | 0x800000 ) + // add subnormal bit
      ( 0x800000 >>> val - 102 )       // round depending on cut off
      >> 126 - val );                  // div by 2^(1-(exp-127+15)) and >> 13 | exp=0
  }

  function checkFloat16(value) {
    var data = getFloat16(value);
    var decoded = decodeFloat16(data);
    return decoded === value || isNaN(decoded) && isNaN(value) ? data : false;
  }

  function getByteLengthOfUtf8String(value) {
    var c = 0;
    for (var i = 0; i < value.length; ++i) {
      var charCode = value.charCodeAt(i);
      /* jshint laxbreak:true */
      //noinspection CommaExpressionJS
      c += charCode < 0x80
        ? 1
        : charCode < 0x800
          ? 2
          : charCode < 0xd800
            ? 3
            : (++i, 4);
      /* jshint laxbreak:false */
    }
    return c;
  }

  function accountForFloat(value) {
    /* jshint laxbreak:true */
    return checkFloat16(value) !== false
      ? 3
      : checkFloat32(value) !== false
        ? 5
        : 9;
    /* jshint laxbreak:false */
  }

  function accountForTypeAndLength(length) {
    /* jshint laxbreak:true */
    return length < 24
      ? 1
      : length < 0x100
        ? 2
        : length < 0x10000
          ? 3
          : length < 0x100000000
            ? 5
            : 9;
    /* jshint laxbreak:false */
  }

  function accountForUtf8String(value) {
    var c = getByteLengthOfUtf8String(value);
    return accountForTypeAndLength(c) + c;
  }

  function maybeIntKey(key) {
    var charCode = key.charCodeAt(0);
    var isNumKey = charCode >= 48 && charCode <= 57;
    for (var ki = 1; isNumKey && ki < key.length; ++ki) {
      charCode = key.charCodeAt(ki);
      isNumKey = charCode >= 48 && charCode <= 57;
    }
    if (isNumKey)
      key = parseInt(key, 10);
    return key;
  }

  function accountForObject(value) {
    var i, length, c = 0;
    if (Array.isArray(value)) {
      length = value.length;
      c += accountForTypeAndLength(length);
      for (i = 0; i < length; ++i)
        c += accountForItem(value[i]);
    } else if (value instanceof Uint8Array) {
      c += accountForTypeAndLength(value.length);
      c += value.length;
    } else {
      var keys = Object.keys(value);
      length = keys.length;
      c += accountForTypeAndLength(length);
      for (i = 0; i < length; ++i) {
        var key = maybeIntKey(keys[i]);
        c += accountForItem(key);
        c += accountForItem(value[key]);
      }
    }
    return c;
  }

  function accountForItem(value) {
    if (value === false || value === true || value === null || value === undefined)
      return 1;

    switch (typeof value) {
      case "number":
        if (isNaN(value))
          return 3;
        if (Math.floor(value) === value) {
          if (0 <= value && value <= POW_2_53)
            return accountForTypeAndLength(value);
          if (-POW_2_53 <= value && value < 0)
            return accountForTypeAndLength(-(value + 1));
        }
        return accountForFloat(value);

      case "string":
        return accountForUtf8String(value);
    }
    return accountForObject(value);
  }


  function encode(value/*, options*/) {
    //console.log("Beginning encoding...");
    var data;
    var encodeView;
    var offset = 0;


    /*
    function writeFloat16(value) {
      encodeView.setUint8(offset, 0xf9);
      encodeView.setUint16(offset+1, getFloat16(value));
      offset += 3;
    }
    function writeFloat32(value) {
      writeUint8(0xfa);
     encodeView.setFloat32(offset, value);
     offset += 4;
    }
    function writeFloat64(value) {
      encodeView.setUint8(offset, 0xfb);
      encodeView.setFloat64(offset+1, value);
      offset += 9;
    }
    */

    function writeFloat(value) {
      var f16 = checkFloat16(value);
      if (f16 !== false) {
        encodeView.setUint8(offset, 0xf9);
        encodeView.setUint16(offset+1, f16);
        offset += 3;
        return;
      }
      var f32 = checkFloat32(value);
      if (f32 !== false) {
        encodeView.setUint8(offset, 0xfa);
        encodeView.setUint32(offset+1, f32);
        offset += 5;
        return;
      }
      //writeUint8(0xfb);
      //writeFloat64(value);

      encodeView.setUint8(offset, 0xfb);
      encodeView.setFloat64(offset+1, value);
      offset += 9;
    }


    function writeUint8Array(value) {
      for (var i = 0; i < value.length; ++i)
        encodeView.setUint8(offset + i, value[i]);
      offset += value.length;
    }

    /*
    function writeUint8(value) {
      return encodeView.setUint8(offset++, value);
    }
    function writeUint16(value) {
      encodeView.setUint16(offset, value);
      offset += 2;
    }

    function writeUint32(value) {
      encodeView.setUint32(offset, value);
      offset += 4;
    }

    function writeUint64(value) {
      var low = value % POW_2_32;
      var high = (value - low) / POW_2_32;
      encodeView.setUint32(offset, high);
      encodeView.setUint32(offset + 4, low);
      offset += 8;
    }
    */

    function writeTypeAndLength(type, length) {
      var typeCode = type << 5;
      if (length < 24) {
        encodeView.setUint8(offset++, typeCode | length);
      } else if (length < 0x100) {
        encodeView.setUint8(offset, typeCode | 0x18);
        encodeView.setUint8(offset+1, length);
        offset += 2;
      } else if (length < 0x10000) {
        encodeView.setUint8(offset, typeCode | 0x19);
        encodeView.setUint16(offset+1, length);
        offset += 3;
      } else if (length < 0x100000000) {
        encodeView.setUint8(offset, typeCode | 0x1A);
        encodeView.setUint32(offset+1, length);
        offset += 5;
      } else {
        encodeView.setUint8(offset, typeCode | 0x1B);
        var low = length % POW_2_32;
        var high = (length - low) / POW_2_32;
        encodeView.setUint32(offset + 1, high);
        encodeView.setUint32(offset + 5, low);
        offset +=9;
      }
    }

    function writeUtf8String(value) {
      var utf8len = getByteLengthOfUtf8String(value);
      //console.log("Writing string "+value+" at offset "+offset+" in "+utf8len+" bytes");
      //if (value.length > utf8len)
      //  throw new Error("Incorrect string length accounting: Can not write less bytes than characters.");
      //if (value.length < utf8len)
      //  console.log("Writing "+ value.length + " chars in "+ utf8len +" bytes\nString: "+ value);
      writeTypeAndLength(3, utf8len);
      for (i = 0; i < value.length; ++i) {
        var charCode = value.charCodeAt(i);
        if (charCode < 0x80) {
          //console.log("Writing " + charCode.toString(16) + " in 1 byte");
          encodeView.setUint8(offset++, charCode);
        } else if (charCode < 0x800) {
          //console.log("Writing " + charCode.toString(16) + " in 2 bytes");
          encodeView.setUint8(offset, 0xc0 | charCode >> 6);
          encodeView.setUint8(offset+1, 0x80 | charCode & 0x3f);
          offset += 2;
        } else if (charCode < 0xd800) {
          //console.log("Writing " + charCode.toString(16) + " in 3 bytes");
          encodeView.setUint8(offset, 0xe0 | charCode >> 12);
          encodeView.setUint8(offset+1, 0x80 | (charCode >> 6) & 0x3f);
          encodeView.setUint8(offset+2, 0x80 | charCode & 0x3f);
          offset += 3;
        } else {
          var charCode2 = value.charCodeAt(++i);
          //console.log("Writing " + charCode.toString(16) + " and "+charCode2.toString(16)+ " in 4 bytes");
          charCode = (charCode & 0x3ff) << 10;
          charCode |= charCode2 & 0x3ff;
          charCode += 0x10000;

          encodeView.setUint8(offset, 0xf0 | charCode >> 18);
          encodeView.setUint8(offset+1, 0x80 | (charCode >> 12) & 0x3f);
          encodeView.setUint8(offset+2, 0x80 | (charCode >> 6) & 0x3f);
          encodeView.setUint8(offset+3, 0x80 | charCode & 0x3f);
          offset += 4;
        }
      }
      //if (charIndex != utf8len)
      //  throw new Error("Incorrect string length accounting: " +
      //    charIndex + " vs " + utf8len + ", difference of " + (utf8len - charIndex));
      //return writeUint8Array(utf8data);
    }

    function encodeItem(value) {
      var i;

      if (value === false) {
        encodeView.setUint8(offset++, 0xf4);
        return;
      }
      if (value === true) {
        encodeView.setUint8(offset++, 0xf5);
        return;
      }
      if (value === null) {
        encodeView.setUint8(offset++, 0xf6);
        return;
      }
      if (value === undefined) {
        encodeView.setUint8(offset++, 0xf7);
        return;
      }
      switch (typeof value) {
        case "number":
          if (isNaN(value)) {
            encodeView.setUint8(offset, 0xf9);
            encodeView.setUint16(offset + 1, getFloat16(value));
            offset += 3;
            return;
          }
          if (Math.floor(value) === value) {
            if (0 <= value && value <= POW_2_53)
              return writeTypeAndLength(0, value);
            if (-POW_2_53 <= value && value < 0)
              return writeTypeAndLength(1, -(value + 1));
          }
           /*
          if (value>>>0 === value)
            return writeTypeAndLength(0, value);
          if ((value|0) === value)
            return writeTypeAndLength(1, -(value + 1));
        */
          //writeUint8(0xfb);
          //return writeFloat64(value);
          return writeFloat(value);

        case "string":
          return writeUtf8String(value);

        default:
          var length;
          if (Array.isArray(value)) {
            length = value.length;
            writeTypeAndLength(4, length);
            for (i = 0; i < length; ++i)
              encodeItem(value[i]);
          } else if (value instanceof Uint8Array) {
            writeTypeAndLength(2, value.length);
            writeUint8Array(value);
          } else {
            var keys = Object.keys(value);
            length = keys.length;
            writeTypeAndLength(5, length);
            for (i = 0; i < length; ++i) {
              var key = maybeIntKey(keys[i]);
              encodeItem(key);
              encodeItem(value[key]);
            }
          }
      }
    }


    data = new ArrayBuffer(accountForItem(value));
    encodeView = new DataView(data);
    encodeItem(value);

    //console.log("Finished encoding...", data.byteLength);
    return data;
  }
/*
  var maybeStringDecoderLib = "require" in global ? require("string_decoder") : false;
  var utf8TextDecoder = "TextDecoder" in global ? new TextDecoder("utf-8") : false;
  var utf8StringDecoder = "StringDecoder" in global ? new StringDecoder("utf8") : maybeStringDecoderLib ? new maybeStringDecoderLib.StringDecoder("utf8") : false;

  function utf8DecodeStreamStringDecoder(ab) {
    utf8StringDecoder.write(Buffer.from(ab));
    return "";
  }

  function utf8DecodeStreamTextDecoder(ab) {
    return utf8TextDecoder.decode(ab, {stream: true});
  }

  var utf8DecodeStream = utf8TextDecoder ? utf8DecodeStreamTextDecoder : utf8StringDecoder ? utf8DecodeStreamStringDecoder : false;

  function utf8DecodeFinishStringDecoder(ab) {
    return utf8StringDecoder.end(Buffer.from(ab));
  }

  function utf8DecodeFinishTextDecoder(ab) {
    return utf8TextDecoder.decode(ab, {stream: false});
  }

  var utf8DecodeFinish = utf8TextDecoder ? utf8DecodeFinishTextDecoder : utf8StringDecoder ? utf8DecodeFinishStringDecoder : false;

  function utf8DecodeWholeStringDecoder(ab) {
    //return Buffer.from(ab).toString('utf8');
    utf8StringDecoder.end(Buffer.allocUnsafe(0));
    return utf8StringDecoder.end(Buffer.from(ab));
  }

  function utf8DecodeWholeTextDecoder(ab) {
    utf8TextDecoder.decode(new ArrayBuffer(0), {stream: false});
    return utf8TextDecoder.decode(ab, {stream: false});
  }

  var utf8DecodeWhole = utf8TextDecoder ? utf8DecodeWholeTextDecoder : utf8StringDecoder ? utf8DecodeWholeStringDecoder : false;

  function testStringDecoder() {
    var ab1 = new ArrayBuffer([32]);
    var ab2 = new ArrayBuffer([32,32]);
    return (
      (utf8DecodeStreamStringDecoder(ab1) + utf8DecodeFinishStringDecoder(ab2)) === "   " &&
      utf8DecodeWholeStringDecoder(ab2) === "  "
    );
  }
  function testTextDecoder() {
    var ab1 = new ArrayBuffer([32]);
    var ab2 = new ArrayBuffer([32,32]);
    return (
      (utf8DecodeTextStringDecoder(ab1) + utf8DecodeFinishTextDecoder(ab2)) === "   " &&
      utf8DecodeWholeTextDecoder(ab2) === "  "
    );
  }
  */

  function decode(data, tagger, simpleValue, options) {
    if (!data)
      throw new Error("No data was passed to decode.");
    //console.log("Beginning decoding...", data.byteLength);
    if (data.byteLength === 0)
      return undefined;
    var decodeView = new DataView(data);
    var offset = 0;
    // support for over-sized buffers
    var allowRemainingBytes = options && options.allowRemainingBytes || false;

    if (typeof tagger !== "function")
      tagger = function (value) {
        return value;
      };
    if (typeof simpleValue !== "function")
      simpleValue = function () {
        return undefined;
      };

    function commitRead(length, value) {
      offset += length;
      //console.log("read", value);
      return value;
    }

    function readArrayBuffer(length) {
      return commitRead(length, new Uint8Array(data, offset, length));
    }


    function readFloat16() {
      return decodeFloat16(readUint16());
    }

    function readFloat32() {
      return commitRead(4, decodeView.getFloat32(offset));
    }

    function readFloat64() {
      return commitRead(8, decodeView.getFloat64(offset));
    }

    function readUint8() {
      return commitRead(1, decodeView.getUint8(offset));
    }

    function readUint16() {
      return commitRead(2, decodeView.getUint16(offset));
    }

    function readUint32() {
      return commitRead(4, decodeView.getUint32(offset));
    }


    function readUint64() {
      return readUint32() * POW_2_32 + readUint32();
    }

    function readBreak() {
      if (decodeView.getUint8(offset) !== 0xff)
        return false;
      offset += 1;
      return true;
    }

    function readLength(additionalInformation) {
      //console.log("reading length for ...", additionalInformation);
      /* jshint laxbreak:true */
      var r = additionalInformation < 24
        ? additionalInformation
        : additionalInformation === 24
          ? readUint8()
          : additionalInformation === 25
            ? readUint16()
            : additionalInformation === 26
              ? readUint32()
              : additionalInformation === 27
                ? readUint64()
                : additionalInformation === 31
                  ? -1
                  : false;
      /* jshint laxbreak:false */
      if (r === false)
        throw new Error("Invalid length encoding");
      return r;
    }

    function readStringLength(majorType) {
      var initialByte = readUint8();
      if (initialByte === 0xff)
        return -1;
      var length = readLength(initialByte & 0x1f);
      if (length < 0 || (initialByte >> 5) !== majorType)
        throw new Error("Invalid indefinite length element");
      return length;
    }


    //function appendChars(newStr, length, stream) {
    function appendChars(newStr, length) {
      /*
      if (!cbor.options.useJsFallbackUtf8) {
        //console.log("Using native utf8 codec");
        var decoded;
        if (stream === true)
          decoded = utf8DecodeStream(readArrayBuffer(length));
        if (stream === false)
          decoded = utf8DecodeFinish(readArrayBuffer(length));
        else
          decoded = utf8DecodeWhole(readArrayBuffer(length));
        if (newStr.length === 0)
          return decoded;
        return newStr + decoded;
      }
      */
      //console.log("Using js utf8 codec");
      for (var i = 0; i < length; ++i) {
        var value = readUint8();
        var highBit = value & 0x80;
        if (highBit) {
          if (value < 0xe0) {
            value = (value & 0x1f) << 6
              | (readUint8() & 0x3f);
            length -= 1;
          } else if (value < 0xf0) {
            value = (value & 0x0f) << 12
              | (readUint8() & 0x3f) << 6
              | (readUint8() & 0x3f);
            length -= 2;
          } else {
            value = (value & 0x0f) << 18
              | (readUint8() & 0x3f) << 12
              | (readUint8() & 0x3f) << 6
              | (readUint8() & 0x3f);
            length -= 3;
          }
        }

        /*
        if (!cbor.options.useJsFallbackCodePt) {
          //console.log("Using native utf8 code point");
          newStr += String.fromCodePoint(value);
          return newStr;
        }
         */
        if (value < 0x10000) {
          //console.log("Using js utf8 code point");
          //newStr.push(value);
          newStr += String.fromCharCode(value);
        } else {
          value -= 0x10000;
          newStr += String.fromCharCode(
            (0xd800 | (value >> 10)),
            (0xdc00 | (value & 0x3ff)));
          //newStr.push(0xd800 | (value >> 10));
          //newStr.push(0xdc00 | (value & 0x3ff));
        }
      }
      return newStr;
    }

    function decodeItem() {
      //console.log("decoding item");

      var initialByte = readUint8();
      var majorType = initialByte >> 5;
      var additionalInformation = initialByte & 0x1f;
      var i;
      var length;
      if (majorType === 7) {
        //console.log("decoding float...", additionalInformation);
        switch (additionalInformation) {
          case 25:
            return readFloat16();
          case 26:
            return readFloat32();
          case 27:
            return readFloat64();
        }
      }

      length = readLength(additionalInformation);
      if (length < 0 && (majorType < 2 || 6 < majorType))
        throw new Error("Invalid length");

      switch (majorType) {
        default:
        //case 0:
          //console.log("read uint " + length)
          return length;
        case 1:
          //console.log("read int " + length)
          return -1 - length;
        case 2:
          if (length < 0) {
            var elements = [];
            var fullArrayLength = 0;
            while ((length = readStringLength(majorType)) >= 0) {
              fullArrayLength += length;
              elements.push(readArrayBuffer(length));
            }
            var fullArray = new Uint8Array(fullArrayLength);
            var fullArrayOffset = 0;
            for (i = 0; i < elements.length; ++i) {
              fullArray.set(elements[i], fullArrayOffset);
              fullArrayOffset += elements[i].length;
            }
            return fullArray;
          }
          return readArrayBuffer(length);
        case 3:
          //console.log("decoding string at "+offset+" 0x"+ initialByte.toString(16));
          var newStr = "";
          if (length < 0) {
            //console.log("indefinite length");
            while ((length = readStringLength(majorType)) >= 0) {
              //console.log("chunk of "+length+" bytes");
              //newStr = appendChars(newStr, length, true);
              newStr = appendChars(newStr, length);
            }
            //newStr = appendChars(newStr, 0, false);
          } else {
            //console.log("exactly "+length+" bytes");
            newStr = appendChars(newStr, length);
          }
          return newStr;
        case 4:
          var retArray;
          if (length < 0) {
            retArray = [];
            while (!readBreak())
              retArray.push(decodeItem());
          } else {
            retArray = new Array(length);
            for (i = 0; i < length; ++i)
              retArray[i] = decodeItem();
          }
          return retArray;
        case 5:
          var retObject = {};
          for (i = 0; i < length || length < 0 && !readBreak(); ++i) {
            retObject[decodeItem()] = decodeItem();
          }
          return retObject;
        case 6:
          return tagger(decodeItem(), length);
        case 7:
          switch (length) {
            case 20:
              return false;
            case 21:
              return true;
            case 22:
              return null;
            case 23:
              return undefined;
            default:
              return simpleValue(length);
          }
      }
      /*
      console.log("initial byte: "+initialByte);
      console.log("major type: "+majorType);
      console.log("additional information: "+additionalInformation);
      throw new Error("Unhandled identifier " + initialByte + " with major type code " + majorType);
      */
      // not possible
    }

    var ret = decodeItem();
    //console.log("First item is", ret);

    // In a keyless serialization, the recursion chain never happens and
    // stops parsing at the first element. This isn't meant to be a pretty
    // fix, but the least intrusive workaround without reworking everything.

    if (typeof ret !== "object" && offset !== data.byteLength) {
      var j = 0;
      var retP = {};
      retP[j++] = ret;

      //console.log("bytes remaining", data.byteLength - offset);
      while (offset !== data.byteLength)
        retP[j++] = decodeItem();

      return retP;
    }

    if (offset !== data.byteLength && !allowRemainingBytes)
      throw new Error((data.byteLength - offset) + " remaining bytes after end of encoding");
    //console.log("Decoded and returned", ret);
    return ret;
  }

  var cbor = {
    encode: encode, decode: decode, options: {
      /*
      useJsFallbackUtf8: !("TextDecoder" in global || "StringDecoder" in global),
      useJsFallbackCodePt: !("fromCodePoint" in String)
      */
    }/*, tests: [
      testStringDecoder,
      testTextDecoder
    ]*/
  };
  if (typeof define === "function" && define.amd)
    define("cbor/cbor", cbor);
  else if (!global.CBOR)
    global.CBOR = cbor;

})(this);
