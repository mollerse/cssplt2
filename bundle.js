(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
(function (Buffer){


var slides = Buffer("PHN0eWxlPgoKICAqIHsKICAgIGJveC1zaXppbmc6IGJvcmRlci1ib3g7CiAgfQoKICAubGlnaHQgewogICAgYmFja2dyb3VuZDogI2U0ZWJlZTsKICAgIGNvbG9yOiAjMWMyMDJiOwogIH0KCiAgLmVtcGhhc2lzIHsKICAgIGJhY2tncm91bmQ6ICNmYjU0NGQ7CiAgICBjb2xvcjogI2ZmZjsKICB9CgogIC5lbXBoYXNpcyBoMSwKICAuZW1waGFzaXMgaDIsCiAgLmVtcGhhc2lzIGgzLAogIC5lbXBoYXNpcyBoNCB7CiAgICBjb2xvcjogIzFjMjAyYjsKICB9CgogIC5saWdodCBoMSwKICAubGlnaHQgaDIsCiAgLmxpZ2h0IGgzLAogIC5saWdodCBoNCB7CiAgICBjb2xvcjogIzFjMjAyYjsKICB9CgogIC5kYXJrIHsKICAgIGJhY2tncm91bmQ6ICMxYzIwMmI7CiAgfQoKICAucmV2ZWFsIC5zdWJ0aXRsZSB7CiAgICBmb250LWZhbWlseTogJ0phYXBva2tpLXJlZ3VsYXInLCBzYW5zLXNlcmlmOwogIH0KCiAgLnNsaWRlcz5zZWN0aW9uIHsKICAgIHBhZGRpbmc6IDElICFpbXBvcnRhbnQ7CiAgfQoKICAubWlkdGVuIHsKICAgIGhlaWdodDogMTAwJTsKICAgIGRpc3BsYXk6IGZsZXggIWltcG9ydGFudDsKICAgIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47CiAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsKICB9CgogIC5taWR0ZW4gPiAqIHsKICAgIHRleHQtYWxpZ246IGNlbnRlciAhaW1wb3J0YW50OwogIH0KCiAgaDEsIGgyLCBoMywgaDQgewogICAgdGV4dC1hbGlnbjogbGVmdDsKICB9CgogIC5yZXZlYWwgcCB7CiAgICBmb250LXNpemU6IDE1MCU7CiAgICB0ZXh0LWFsaWduOiBsZWZ0OwogIH0KICBzcGFuLnV0aGV2IHsKICAgIGNvbG9yOiAjZmI1NDRkOwogIH0KCiAgaW1nIHsKICAgIGJvcmRlcjogbm9uZSAhaW1wb3J0YW50OwogICAgYmFja2dyb3VuZDogaW5oZXJpdCAhaW1wb3J0YW50OwogICAgYm94LXNoYWRvdzogbm9uZSAhaW1wb3J0YW50OwogIH0KCiAgLnN0cmlrZS52aXNpYmxlOm5vdCguY3VycmVudC1mcmFnbWVudCkgewogICAgdGV4dC1kZWNvcmF0aW9uOiBsaW5lLXRocm91Z2g7CiAgfQoKICBjb2RlOmFmdGVyIHsKICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTsKICAgIGRpc3BsYXk6IGJsb2NrOwogICAgY29sb3I6IHdoaXRlOwogICAgdG9wOiAydmg7CiAgICByaWdodDogMC41dnc7CiAgICB0ZXh0LWFsaWduOiByaWdodDsKICAgIGZvbnQtc2l6ZTogMTUwJTsKICAgIGZvbnQtZmFtaWx5OiAnSmFhcG9ra2ktcmVndWxhcicsIHNhbnMtc2VyaWY7CiAgfQoKICBjb2RlLmNzczphZnRlciB7CiAgICBjb250ZW50OiAiQ1NTIjsKICB9CgogIGNvZGUuaHRtbDphZnRlciB7CiAgICBjb250ZW50OiAiSFRNTCI7CiAgfQoKICBjb2RlLmphdmFzY3JpcHQ6YWZ0ZXIgewogICAgY29udGVudDogIkpTIjsKICB9CgogIC5iaWcgewogICAgZm9udC1zaXplOiA5dmggIWltcG9ydGFudDsKICB9CgogIHByZSB7CiAgICBtaW4taGVpZ2h0OiAxNXZoICFpbXBvcnRhbnQ7CiAgICBkaXNwbGF5OiBmbGV4ICFpbXBvcnRhbnQ7CiAgICBiYWNrZ3JvdW5kOiBibGFjazsKICB9CgogIGNvZGUgewogICAgbWFyZ2luOiBhdXRvIDAgIWltcG9ydGFudDsKICB9Cgo8L3N0eWxlPgoKPHNlY3Rpb24gY2xhc3M9Im1pZHRlbiI+CiAgPGgyPkNTUzwvaDI+CiAgPGgzPiZtZGFzaDs8L2gzPgogIDxoMj5FdCBwcm9ncmFtbWVyaW5ncy10ZW9yZXRpc2sgc2tyw6VibGlrazwvaDI+CiAgPGg3PlN0aWFuIFZldW0gTcO4bGxlcnNlbiAvIEBtb2xsZXJzZTwvaDc+CiAgPGg3PkJFS0s8L2g3PgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEhlaSwgamVnIGhldGVyIFN0aWFuIG9nIGplZyBza2FsIGdpIGRlcmUgZXQgc2tyw6VibGlrayBww6UgQ1NTIGZyYSBlbgpwcm9ncmFtbWVyaW5nc3Rlb3JldGlzayBzeW5zdmlua2VsLgogICAgPC9wPgogICAgPHA+CiAgICAgIFZpIHNpZXIgb2Z0ZSBhdCBDU1MgaWtrZSBlciBldCBwcm9ncmFtbWVyaW5nc3Byw6VrLCBtZW4gbGlrZXZlbCBicnVrZXIgdmkgZGV0IHRpbCDDpQpsw7hzZSBkZW4gc2FtbWUgdHlwZW4gcHJvYmxlbWVyIHNvbSB2aSBicnVrZXIgcHJvZ3JhbW1lcmluZ3NwcsOlayB0aWwuIERlcmZvciBlcgpkZXQgbnl0dGlnIMOlIHNlIHDDpSBtZWthbmlzbWVuZSBpIENTUyBww6UgZXQgbWVyIHRlb3JldGlzayBuaXbDpSBvZyBzZSBodmEgdmkga2FuCnRhIG1lZCBvc3MgYXYgbMOmcmRvbSBmcmEgcHJvZ3JhbW1lcmluZ3NwcsOlay4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIj4KICA8aDI+S09NUE9TSVNKT048L2gyPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEhvdmVkIHRlbWFldCBpIGRhZyBlciBrb21wb3Npc2pvbi4gRGVuIGthbnNramUgbWVzdCBmdW5kYW1lbnRhbGUgZGVsZW4gYXYgcHJvZ3JhbW1lcmluZwogICAgPC9wPgogICAgPHA+CiAgICAgIEkgZGFnIHNrYWwgdmkgc2UgbGl0dCBww6Uga29tcG9zaXNqb24uIERlbiBrYW5za2plIG1lc3QgZnVuZGFtZW50YWxlIGRlbGVuIGF2CnByb2dyYW1tZXJpbmcgc29tIGfDpXIgaWdqZW4gcMOlIHR2ZXJzIGF2IGFsbGUgcHJvZ3JhbW1lcmluZ3NwcsOlay4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbiBjbGFzcz0ibWlkdGVuIGxpZ2h0IiBkYXRhLWJhY2tncm91bmQ9IiNlNGViZWUiPgogIDxwPktvbXBvc2lzam9uIGVyIMOlIHNldHRlIHNhbW1lbiA8c3BhbiBjbGFzcz0idXRoZXYiPmzDuHNuaW5nZXI8L3NwYW4+IHDDpSA8c3BhbiBjbGFzcz0idXRoZXYiPmVua2xlcmU8L3NwYW4+IGRlbHByb2JsZW1lciBmb3Igw6UgbMO4c2UgZXQgbWVyIDxzcGFuIGNsYXNzPSJ1dGhldiI+a29tcGxla3N0PC9zcGFuPiBwcm9ibGVtLjwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBIb3ZlZHRlbWFldCBpIGRhZyBlciBrb21wb3Npc2pvbi4gRGVuIGthbnNramUgbWVzdCBmdW5kYW1lbnRhbGUgZGVsZW4gYXYKcHJvZ3JhbW1lcmluZyBzbGlrIHZpIGtqZW5uZXIgZGV0LiBLb21wb3Npc2pvbiBkYW5uZXIgZ3J1bm5sYWdldCBmb3IgZGV0CmFyYmVpZGV0IHZpIGdqw7hyIHNvbSB1dHZpa2xlcmUuIE11bGlnaGV0ZW4gdGlsIMOlIGt1bm5lIGJyeXRlIG5lZCBrb21wbGVrc2UKcHJvYmxlbWVyIG9nIGJ5Z2dlIHDDpSB0aWRsaWdlcmUgbMO4c3RlIHByb2JsZW1lciBlciBoZWx0IGVzc2Vuc2llbGwuIFV0ZW4gZGVubmUKbXVsaWdoZXRlbiBlciBkZXQgaWtrZSB2w6ZydCBtdWxpZyDDpSBhbmdyaXBlIHByb2JsZW1lciB1dGVuIMOlIHRpbCBlbiBodmVyIHRpZCB0YQppbm4gb3ZlciBzZWcgaGVsZSBrb21wbGVrc2l0ZXRlbiB0aWwgcHJvYmxlbWV0LiBEZXR0ZSBlciBub2UgdmkgdmV0IGlra2UKc2thbGVyZXIgc8OmcmxpZyBicmEgbsOlciBrb21wbGVrc2l0ZXRlbiBlbGxlciBvbWZhbmdldCB0aWwgZXQgcHJvYmxlbSBibGlyIHN0b3J0LgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMj5Lb21wb3Npc2pvbjwvaDI+CiAgPHA+CiAgICA8Y29kZT55ID0geCAqIHggKyAxPC9jb2RlPgogIDwvcD4KICA8ZGl2IGNsYXNzPSJiaWciPgogICAgPHByZSBjbGFzcz0iZnJhZ21lbnQiPjxjb2RlIGNsYXNzPSJqYXZhc2NyaXB0Ij5mdW5jdGlvbiBmKHgpIHsgcmV0dXJuIHggKyAxOyB9CmZ1bmN0aW9uIGcoeCkgeyByZXR1cm4geCAqIHg7IH08L2NvZGU+PC9wcmU+CiAgICA8cHJlIGNsYXNzPSJmcmFnbWVudCI+PGNvZGUgY2xhc3M9ImphdmFzY3JpcHQiPnZhciB5ID0gZihnKDIpKTsgLy89PiA1PC9jb2RlPjwvcHJlPgogIDwvZGl2PgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEtvbXBvc2lzam9uIGkgc2luIG1lc3QgZ3J1bm5sZWdnZW5kZSBmb3JtIHN0YW1tZXIgZnJhIG1hdGVtYXRpa2tlbiBvZyBtw6V0ZW4Ka29tcGxla3NlIHJlZ25lc3R5a2tlciBrYW4gYnJ5dGVzIG9wcCBvZyBsw7hzZXMgaHZlciBmb3Igc2VnIGbDuHIgZGVuIGVuZGVsaWdlCmzDuHNuaW5nZW4gcHJlc2VudGVyZXIgc2VnIHZlZCDDpSBzZXR0ZSBzYW1tZW4gZGVsbMO4c25pbmdlbmUuCiAgICA8L3A+CjwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMj5Lb21wb3Npc2pvbiBpIENTUzwvaDI+CiAgPGRpdiBjbGFzcz0iYmlnIj4KICAgIDxwcmU+PGNvZGU+LmJ0biB7CiAgY29sb3I6IHJlZDsKICBiYWNrZ3JvdW5kOiBzaWx2ZXI7CiAgZGlzcGxheTogaW5saW5lLWJsb2NrOwp9PC9wcmU+PC9jb2RlPgogIDxwcmUgY2xhc3M9ImZyYWdtZW50Ij48Y29kZT4uc2lkZWJhciAuYnRuIHsKICBjb2xvcjogYmxhY2s7CiAgYmFja2dyb3VuZDogcmVkOwp9PC9jb2RlPjwvcHJlPgo8cHJlIGNsYXNzPSJmcmFnbWVudCI+PGNvZGUgY2xhc3M9Imh0bWwiPjxkaXYgY2xhc3M9InNpZGViYXIiPgogIDxidXR0b24gY2xhc3M9ImJ0biI+UHJlc3NtZTwvYnV0dG9uPgo8L2Rpdj48L2NvZGU+PC9wcmU+CiAgPC9kaXY+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgU2VsdiBvbSB2aSBvZnRlIGlra2Ugc2VyIHDDpSBDU1Mgc29tIGV0IHByb2dyYW1tZXJpbmdzcHLDpWsgc8OlIGFuZ3JpcGVyIHZpIG9mdGUKcHJvYmxlbWVuZSB2aSBibGlyIG3DuHR0IG1lZCB2ZWQgw6UgYmVueXR0ZSB0YWt0aWtrZXIgdmkga2plbm5lciBnb2R0IGZyYSBhbmRyZQprb250ZWtzdGVyLgogICAgPC9wPgogICAgPHA+CiAgICAgIEhlciBoYXIgdmkgbGFnZXQgb3NzIGVuIGzDuHNuaW5nIHDDpSBodm9yZGFuIGJ1dHRvbnMgc2thbCBzZSB1dC4gT2cgc8OlIGxhZ2VyIHZpCm9zcyBlbiBsw7hzbmluZyBww6UgZXQgc3Blc2lhbHRpbGZlbGxlIGF2IGJ1dHRvbnMgc29tIGVrc2lzdGVyZXIgaSBzaWRlYmFycyB2ZWQgw6UKYnlnZ2UgcMOlIGzDuHNuaW5nZW4gZm9yIGdlbmVyZWxsZSBidXR0b25zLgogICAgPC9wPgogICAgPHA+CiAgICAgIFPDpSBrYW4gdmkgYmVueXR0ZSBvc3MgYXYgZGVuIGzDuHNuaW5nZW4gcMOlIGRlbm5lIGJpdGVuIG1lZCBtYXJrdXAuIERldHRlIGVyIGVuCmdhbnNrZSB2YW5saWcgbcOldGUgw6UgYW5ncmlwZSBDU1MtcHJvYmxlbWVyIHDDpS4KICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDI+S29tcG9zaXNqb24gaSBDU1M8L2gyPgogIDxwcmU+PGNvZGUgY2xhc3M9ImRpc3BsYXktbGFuZyBjc3MiPi5zaWRlYmFyIC5oZWFkZXIgewogIGZvbnQtd2VpZ2h0OiA3MDA7CiAgdGV4dC1kZWNvcmF0aW9uOiB1bmRlcmxpbmU7Cn0KLm5ld3MtaXRlbSBoMiB7CiAgY29sb3I6IGJsdWU7Cn08L2NvZGU+PC9wcmU+CiAgPHByZSBjbGFzcz0iZnJhZ21lbnQiPjxjb2RlIGNsYXNzPSJkaXNwbGF5LWxhbmcgaHRtbCI+PGRpdiBjbGFzcz0ic2lkZWJhciI+CgogIDxoMSBjbGFzcz0iaGVhZGVyIj5TaWRlYmFyPC9oMT4KCiAgPGRpdiBjbGFzcz0ibmV3cy1pdGVtIj4KCiAgICA8aDIgY2xhc3M9ImhlYWRlciI+TmV3czwvaDI+CiAgICA8cD5UaGVyZSB3ZXJlIG5ld3MuPC9wPgoKICA8L2Rpdj4KPC9kaXY+PC9jb2RlPjwvcHJlPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFZpIHNlciBww6UgZXQgbGl0dCBtZXIga29tcGxla3N0IGVrc2VtcGVsLiBEZXR0ZSBlciBlbiBnYW5za2UgdXNreWxkaWcgYml0IG1lZApDU1MuIFZpIMO4bnNrZXIgb3NzIGZlaXRlIGhlYWRlcnMgbWVkIHVuZGVyc3RyZWtlci4gT2cgaSBzaWRlYmFycyDDuG5za2VyIHZpIG9zcwpibMOlIGgyZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgTsOlciB2aSBhbnZlbmRlciBkaXNzZSBjc3MtcmVnbGVuZSBww6UgbWFya3VwIHNvbSBzZXIgc2xpayB1dCBmw6VyIHZpIGV0IHJlc3VsdGF0CnNvbSBrYW5za2plIGlra2UgdmFyIGhlbHQgdGlsdGVua3QuIERlbiBpbm5lcnN0ZSBoMidlbiBpIG5ld3MtaXRlbS1kaXYnZW4gaGFyCmbDpXR0IGRldCBzYW1tZSB1dHNlZW5kZSBzb20gZGVuIHl0dGVyc3RlIGhlYWRlcmVuLgogICAgPC9wPgogICAgPHA+CiAgICAgIERldHRlIGVyIGlra2UgZXQgaGVsdCB1dmFubGlnIHByb2JsZW0gaSBDU1MuIEVuIGRlbCBhdiBtYXJrdXBlbiBnaXIgbWF0Y2ggcMOlIHRvCnVsaWtlIENTUy1yZWdsZXIgb2cgdmkgZsOlciBlbiB1w7huc2tldCBlZmZla3QgdmVkIGF0IHN0aWxlbmUgZnJhIGJlZ2dlIHJlZ2xlbmUKYmxpciBzYXR0IHDDpSBlbGVtZW50ZXQuIFZpIGhhciBuw6Uga29tcG9uZXJ0IHRvIGzDuHNuaW5nZXIgZnJhIENTUywgdXRlbiDDpQplZ2VudGxpZyBtZW5lIGRldCEKICAgIDwvcD4KICA8L2FzaWRlPgo8L3NlY3Rpb24+Cgo8c2VjdGlvbj4KICA8aDI+TMO4c25pbmc/PC9oMj4KICA8cD4KICAgIFZpIHRyZW5nZXIgw6Uga29udHJvbGxlcmUgZWZmZWt0ZW4gYXYgZW4gQ1NTLXJlZ2VsLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBWaSDDuG5za2VyIGlra2UgYXQgc3RpbGVuZSBmcmEgZGVuIGbDuHJzdGUgcmVnZWxlbiBza2FsIHDDpXZpcmtlIGVmZmVrdGVuIGF2IGRlbgphbmRyZSByZWdlbGVuLiBEZXQgdmkgdHJlbmdlciBlciBlbiBtw6V0ZSDDpSBrb250cm9sbGVyZSBlZmZla3RlbiBuw6VyIHZpCmtvbXBvbmVyZXIgbMO4c25pbmdlciB2ZWQgw6UgbMO4c2UgZGVscHJvYmxlbWVyLgogICAgPC9wPgogICAgPHA+CiAgICAgIEhhZGRlIENTUyB2w6ZydCBzb20gYW5kcmUgcHJvZ3JhbW1lcmluZ3NwcsOlayBoYWRkZSB2aSBrdW5uZXQgYmVncmVuc2Ugc2NvcGV0IHRpbAplbiBhdiByZWdsZW5lLiBWaSBrdW5uZSBzYWd0IGF0IGRlbm5lIHJlZ2VsZW4ga3VuIGdqZWxkZXIgZm9yIGRlbm5lIGF2Z3JlbnNhCmJpdGVuIG1lZCBtYXJrdXAsIG1lbiBkZW4gbXVsaWdoZXRlbiBoYXIgdmkgaWtrZSBwZXIgaSBkYWcuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKICA8c2VjdGlvbj4KICAgIDxoMj5Mw7hzbmluZz88L2gyPgogICAgPHByZSBjbGFzcz0iZnJhZ21lbnQiPjxjb2RlIGNsYXNzPSJkaXNwbGF5LWxhbmcgY3NzIj4uc2lkZWJhciAuaGVhZGVyIHsKICBmb250LXdlaWdodDogNzAwOwogIHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOwp9Ci5uZXdzLWl0ZW0gaDIgewogIGZvbnQtd2VpZ2h0OiBub3JtYWw7CiAgdGV4dC1kZWNvcmF0aW9uOiBub25lOwogIGNvbG9yOiBibHVlOwp9PC9jb2RlPjwvcHJlPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEFsbGUgQ1NTLXJlZ2xlciBla3Npc3RlcmVyIGkgcHJha3NpcyBpIHNhbW1lIG5hbWVzcGFjZSwgb2cgaSBlbiB5dHRlcnN0ZQprb25zZWt2ZW5zIGVyIGVmZmVrdGVuIGF2IGVuIENTUy1yZWdlbCBhdmhlbmdpZyBhdiBhbGxlIGRlIGFuZHJlIENTUy1yZWdsZW5lIHNvbQplciBkZWZpbmVydCBww6UgZW4gc2lkZS4gSSBkZXR0ZSBla3NlbXBlbGV0IHNlciB2aSBlZmZla3RlbiBhdiBkZXR0ZSwgZGEgcmVnZWxlbgpmb3IgaDJlciBpIG5ld3MtaXRlbXMgYmxpciBww6V2aXJrZXQgYXYgZW4gYW5uZW4gcmVnZWwuCiAgICA8L3A+CiAgICA8cD4KICAgICAgVmkga2FuIGZpa3NlIGRldHRlIHZlZCDDpSB2w6ZyZSBla3NwbGlzaXR0ZSBtZWQgc3RpbGVuZSB2aSDDuG5za2VyIMOlIHNldHRlLAptZW4gZGV0dGUgdmlsIGZvcnRzYXR0IGlra2UgZ2kgb3NzIGRlbiBlZmZla3RlbiB2aSDDuG5za2VyLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMj5Mw7hzbmluZz88L2gyPgogIDxwcmUgY2xhc3M9ImZyYWdtZW50Ij48Y29kZSBjbGFzcz0iZGlzcGxheS1sYW5nIGNzcyI+LnNpZGViYXIgLmhlYWRlciB7CiAgZm9udC13ZWlnaHQ6IDcwMDsKICB0ZXh0LWRlY29yYXRpb246IHVuZGVybGluZTsKfQoubmV3cy1pdGVtIC5oZWFkZXIgewogIGZvbnQtd2VpZ2h0OiBub3JtYWw7CiAgdGV4dC1kZWNvcmF0aW9uOiBub25lOwogIGNvbG9yOiBibHVlOwp9PC9jb2RlPjwvcHJlPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIFZpIGVyIG7DuGR0IHRpbCDDpSBiZW55dHRlIG9zcyBhdiBkZW4gbWVrYW5pc21lbiB2aSBmYWt0aXNrIGhhciBmb3Igw6Uga29udHJvbGxlcmUKZWZmZWt0ZW4gYXYga29tcG9zaXNqb24sIHNvbSBlciBzcGVzaWZpc2l0ZXQuIFZpIGthbiBrYXN0ZSBzw6UgbWFuZ2UKcHJlcHJvc2Vzc29yZXIgcMOlIENTUyBzb20gdmkgdmlsLCBtZW4gZGVubmUgZnVuZGFtZW50YWxlIGVnZW5za2FwZW4gdmlsIGlra2UKZW5kcmUgc2VnLgogICAgPC9wPgogICAgPHA+CiAgICAgIERldHRlIGVrc2VtcGVsZXQgZXIga29uc3RydWVydCwgbWVuIGRldCBpbGx1c3RyZXJlciBlbiB2aWt0aWcgZWdlbnNrYXAgbWVkIENTUy4KVmkga2FuIGlra2UgbMO4c2UgcHJvYmxlbWVyIG1lZCBDU1MgdmVkIMOlIGFuZ3JpcGUgcHJvYmxlbWV0IG1lZCBkZSBzYW1tZQp0ZWtuaWtrZW5lIHNvbSBmdW5nZXJlciBpIGFuZHJlIHByb2dyYW1tZXJpbmdzcHLDpWsuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9Im1pZHRlbiBlbXBoYXNpcyIgZGF0YS1iYWNrZ3JvdW5kPSIjZmI1NDRkIj4KICA8aDM+Q1NTIG9wcGZ5bGxlciBpa2tlIGZvcnV0c2V0bmluZ2VuZSBmb3Iga29tcG9zaXNqb24gc29tIHByb2JsZW1sw7hzbmluZ3N0cmF0ZWdpLjwvaDM+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgRGVuIGZ1bmRhbWVudGFsZSBmb3J1dHNldG5pbmdlbiBmb3IgYXQga29tcG9zaXNqb24gc2thbCBmdW5nZXJlIHNvbSBzdHJhdGVnaSBmb3IKcHJvYmxlbWzDuHNuaW5nIGVyIGlra2Ugb3BwZnlsdCBhdiBDU1MuIFZpIGthbiBpa2tlIGRlbGUgb3BwIGV0IHByb2JsZW0gaSBtaW5kcmUKcHJvYmxlbWVyIHV0ZW4gw6UgYWxsdGlkIGhhIGhlbGUgcHJvYmxlbWV0IGkgaG9kZXQgdGlsIGVuIGh2ZXIgdGlkLiBKbyBtZXIKa29tcGxla3MgcHJvYmxlbWV0IGVyIGpvIHZhbnNrbGlnZXJlIGJsaXIgZGV0IMOlIGhvbGRlIGkgaG9kZXQuIEh2aXMgdmkgYW5ncmlwZXIKcHJvYmxlbWVyIGkgQ1NTIHV0ZW4gw6UgZXJramVubmUgZGUgZmFrdGlza2UgZm9yaG9sZCB2aWwgdmkgaWtrZSB2w6ZyZSBpc3RhbmQgdGlsIMOlCnV0dmlrbGUgbMO4c25pbmdlciBlZmZla3RpdnQuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24+CiAgPGgyPkVyIENTUyBow6VwbMO4c3Q/PC9oMj4KICA8cD4KICAgIFZpIGhhciB0byByZXRuaW5nZXIgdmkga2FuIHZlbGdlOgogIDwvcD4KICA8YnI+CiAgPHAgY2xhc3M9ImZyYWdtZW50Ij4KICAgIDEpIFNsdXR0ZSBtZWQga29tcG9zaXNqb24uCiAgPC9wPgogIDxicj4KICA8cCBjbGFzcz0iZnJhZ21lbnQiPgogICAgMikgRWxpbWluZXJlIHXDuG5za2VkZSBlZmZla3RlciBmcmEga29tcG9zaXNqb24uCiAgPC9wPgogIDxhc2lkZSBjbGFzcz0ibm90ZXMiPgogICAgPHA+CiAgICAgIEVyIENTUyBow6VwbMO4c3Qgb2cgaGVsdCB1ZWduYSB0aWwgw6UgbMO4c2UgZGUgcHJvYmxlbWVuZSB2aSDDuG5za2VyIMOlIGzDuHNlPyBJa2tlCm7DuGR2ZW5kaWd2aXMsIG1lbiB2aSBlciBuw7hkdCB0aWwgw6UgYW5ncmlwZSBwcm9ibGVtZXIgcMOlIGVuIGFubmVuIG3DpXRlLiBMYSBvc3Mgc2UKcMOlIHRvIG11bGlnZSByZXRuaW5nZXIuCiAgICA8L3A+CiAgICA8cD4KICAgICAgVmkga2FuIHNsdXR0ZSDDpSBrb21wb25lcmUgQ1NTIHJlZ2xlci4gRGV0IHZpbCBzaSBhdCB2aSBoZWxsZXIgbGFnZXIKcmVnbGVyIHNvbSBrdW4gdHJlZmZlciBha2t1cmF0IGRlIGVsZW1lbnRlbmUgdmkgw7huc2tlciBnamVubm9tIGZla3MgdW5pa2UgZWxsZXIKbmVzdGVuIHVuaWtlIHNlbGVjdG9yZXIgc29tIGlubmVob2xkZXIgYWxsZSBhdHRyaWJ1dHRlciBzb20gc2thbCBzZXR0ZXMgZm9yIGRldAplbGVtZW50ZXQuCiAgICA8L3A+CiAgICA8cD4KICAgICAgRWxsZXIgdmkgZm9yc8O4a2VyIMOlIGVsaW1pbmVyZSB1w7huc2tlZGUgZWZmZWt0ZXIgdmVkIGtvbXBvc2lzam9uIGdqZW5ub20gw6UgYmVncmVuc2UKZWZmZWt0ZW4gYXYgaHZlciByZWdlbCBzbGlrIGF0IG7DpXIgZmxlcmUgcmVnbGVyIG1hdGNoZXIgc2FtbWUgZWxlbWVudCB2aWwgaWtrZQpyZWdsZW5lIHDDpXZpcmtlIGh2ZXJhbmRyZS4gTWVkIGFuZHJlIG9yZCwgdmkgaGFyIGlra2UgbGVuZ3JlIGhhciBsb3YgdGlsIMOlCm92ZXJza3JpdmUgZW4gc3RpbCBmcmEgZW4gYW5uZW4gcmVnZWwgc2VsdiBvbSBkdSBoYXIgaMO4eWVyZSBzcGVzaWZpc2l0ZXQuClRhdHQgdGlsIGRldCBla3N0cmVtZSB2aWwgZGV0dGUgc2kgYXQgZHUga3VuIGthbiBzZXR0ZSBlbiBhdHRyaWJ1dHQgcGVyIHJlZ2VsLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uPgogIDxoMj5EZXQgZXIgaMOlcDwvaDI+CiAgPHA+CiAgICBWaSBtw6Ugam9iYmUgcMOlIENTUycgcHJlbWlzc2VyLgogIDwvcD4KICA8YXNpZGUgY2xhc3M9Im5vdGVzIj4KICAgIDxwPgogICAgICBEZXQgZXIgaMOlcC4gVmkgdHJlbmdlciBrYW5za2plIGlra2Ugw6UgdGEgbm9lbiBhdiBkZSB0byByZXRuaW5nZW5lIHRpbCBzaW5lCmVrc3RyZW1lciwgbWVuIHZpIGthbiBsYSBkZSBkYW5uZSBldCBncnVubmxhZyBmb3IgaHZvcmRhbiB2aSB2dXJkZXJlcgpzdHJ1a3R1cmVyaW5nZW4gYXYgbMO4c25pbmdlciBww6Uga29tcGxla3NlIHByb2JsZW1lciBtZWQgQ1NTLgogICAgPC9wPgogICAgPHA+CiAgICAgIEFsdCBldHRlciBodmlsa2VuIGdyYWQgYXYga29tcGxla3NpdGV0IHZpIGVyIG3DuHR0IG1lZCBrYW4gdmkgdGEgbWVkIG9zcwplbGVtZW50ZXIgZnJhIGVuIGVsbGVyIGJlZ2dlIHJldG5pbmdlbmUgb2cgYW5ncmlwZSBwcm9ibGVtZW5lIHDDpSBDU1MnIHByZW1pc3Nlci4KVmkgYmxpciBpIHN0YW5kIHRpbCDDpSBpZGVudGlmaXNlcmUgbsOlciBsw7hzbmluZ2VuZSB2w6VyZSB0cmVuZ2VyIGVuCm9tc3RydWt0dXJlcmluZywgZnJlbWZvciDDpSBvZnJlIGdvZHQgaMOlbmR0dmVyay4gT2cgdmkgYmxpciBpIHN0YW5kIHRpbCDDpQp2dXJkZXJlIGh2b3J2aWR0IGVuIGZvcmVzbMOldHQgbMO4c25pbmcgdmlsIGt1bm5lIGZ1bmdlcmUgZm9yIHByb2JsZW1ldCB2aSBoYXIuCiAgICA8L3A+CiAgPC9hc2lkZT4KPC9zZWN0aW9uPgoKPHNlY3Rpb24gY2xhc3M9Im1pZHRlbiBsaWdodCIgZGF0YS1iYWNrZ3JvdW5kPSIjMWMyMDJiIj4KICA8aDI+PHNwYW4gY2xhc3M9InV0aGV2Ij5Gb3JzdMOlZWxzZTwvc3Bhbj4gZm9yIENTUycgYmVncmVuc25pbmdlciBoamVscGVyIG9zcyB0aWwgw6UgdGEgZGUgPHNwYW4gY2xhc3M9InV0aGV2Ij5yaWt0aWdlPC9zcGFuPiB2YWxnZW5lLjwvaDI+CiAgPGFzaWRlIGNsYXNzPSJub3RlcyI+CiAgICA8cD4KICAgICAgTsOlciB2aSBmb3JzdMOlciBodmlsa2UgYmVncmVuc25pbmdlciBDU1MgaGFyIG9nIGh2b3JkYW4gZGUgcMOldmlya2VyIGRlIGzDuHNuaW5nZW5lCnZpIGxhZ2VyIGJsaXIgdmkgaSBzdGFuZCB0aWwgw6UgdGEgZGUgcmV0dGUgdmFsZ2VuZSBmb3IgaHZvcmRhbiB2aSB1dGZvcm1lcgpsw7hzbmluZ2VyLgogICAgPC9wPgogIDwvYXNpZGU+Cjwvc2VjdGlvbj4KCjxzZWN0aW9uIGNsYXNzPSJtaWR0ZW4iPgogIDxoMT5UQUtLIEZPUiBNRUc8L2gxPgogIDxwPlN0aWFuIFZldW0gTcO4bGxlcnNlbiAvIEBtb2xsZXJzZTwvcD4KICA8cD5CRUtLPC9wPgo8L3NlY3Rpb24+Cg==","base64");
var title = 'CSS - Et programmerings-teoretisk skråblikk';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;

}).call(this,require("buffer").Buffer)
},{"buffer":1}]},{},[5]);
