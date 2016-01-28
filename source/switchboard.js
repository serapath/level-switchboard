'use strict'
var type = require('component-type')
var readable = require('readable-stream').Readable
var writable = require('readable-stream').Writable
var duplexify = require('duplexify')
var stringify = require('json-stable-stringify')
var deepequal = require('deep-equal')

module.exports = switchboard
/******************************************************************************
  MAIN
  // @TODO: put it into the README.md
  # CONCEPT
  ## `level-subtracker` & 'level-switchboard'
  1. patches `db` to listen for all changes to the underlying database
  * adds db.sublevel = subtrack for creating a database partition
  * adds db.track to track a certain value or range in the database or partition
  var values = [ // works for
    [['foobar'], 'array'],
    [{}, 'object'],
    [null, 'null'],
    ["hey", 'string'],
    [true, 'boolean'],
    [false, 'boolean'],
    [12, 'number'],
    [[], 'array']
  ]
  API:
  // duplexable({gte: 'articles/', lt: 'articles/~'}, {
  //   'articles/01': {},
  //   'articles/02': {},
  //   'articles/03': {},
  //   'articles/04': {}
  // })
  // duplexable({gte: 'title/', lt: 'title/!'}, { 'title': 'My little shop' })

  if db.prefix() exists, arg: codec will be used to encode the prefix
  for every key used in db.put/del/get/batch() operations

******************************************************************************/
function switchboard (db, translate, codec) {
  validateArgs(db, translate)
  var DB = db.db
  var _put = DB._put.bind(DB)
  var _del = DB._del.bind(DB)
  var _get = DB._get.bind(DB)
  var _batch = DB._batch.bind(DB)
  DB._put = putPatch
  DB._del = delPatch
  DB._get = getPatch
  DB._batch = batchPatch
  // @TODO: maybe patch createReadStream too?
  /*****************************************************************************
    HELPER - Manage Trackerstreams
  *****************************************************************************/
  // function batch (arr)      { arr.forEach(each) }
  // function put   (key, val) { each({ type: 'put', key: key, value: val }) }
  // function del   (key, val) { each({ type: 'del', key: key, value: val }) }
  // function each  (item)     { TRACKERSTREAMS.forEach(function process (ts$) {
  //   var scope = ts$._checkScope(String(item.key))
  //   if (scope) { publish(ts$, item) }
  // })}
  // function publish (ts$, item) {
  //   var isDifferent = stringify(item) !== stringify(ts$._cache)
  //   if (isDifferent) {
  //     ts$._cache = item
  //     item = ts$._interpretation(item)
  //     ts$.push(item)
  //   }
  // }
  // COPY FROM LEVEL-TRACKER
  // https://github.com/dominictarr/level-hooks/blob/master/index.js
  /////////////////////////////////////////////////////////////////////////////
  var prefixer = /^!.*!/
  function getPatch (key, opts, cb) {
    // @TODO: translate "key" to "wireup" translated key
    // => to READ the correct value
    var prefix = (key.match(prefixer)||[])[0]
    return _get(key, opts, function callback (error, value) {
      console.log('[GET] <key> ', key, '<value> ', value)
      cb(error, value)
    })
  }
  function putPatch (key, value, opts, cb) {
    // @TODO: translate "key" to "wireup" translated key
    // => to WRITE the value to the correct path
    var prefix = (key.match(prefixer)||[])[0]
    return _put(key, value, opts, function callback (error) {
      console.log('[PUT] <key> ', key, '<value> ', value)
      if (error) cb(error)
      else publish({ type: 'put', key: key, value: value })
    })
  }
  function delPatch (key, opts, cb) {
    // @TODO: translate "key" to "wireup" translated key
    // => to WRITE delete the value at the correct path
    var prefix = (key.match(prefixer)||[])[0]
    return _del(key, opts, function callback (error) {
      console.log('[DEL] <key> ', key)
      if (error) cb(error)
      else publish({ type: 'del', key: key })
    })
  }
  function batchPatch (ops, opts, cb) {
    if (ops.length) {
      var config = ops[0].type.config
      var type = ops[0].type.type
      ops[0].type = type ? type : ops[0].type
      if (config) { // comes from a write$
        var prefix = config.prefix
        var check = config.check
        var baseKey = config.baseKey
      } else {
        var prefix = (ops[0].key.match(prefixer)||[])[0]
      }
    }
    //---------------------------------------------------------------
    // ==> WRITE: its all DEL or PUT operations !!!!
    // 1. given: prefix   - e.g. "!test1#doobidoo1!"
    // 2. given: baseKey  - e.g. "/quux/"
    // 3. given: key      - e.g. "!test1#doobidoo1!/quux/02"
    // INBOUND request do do something
    var petBase = prefix+baseKey
    ops = ops.map(function petKey2realKey (op) {
      var petKey = op.key
      // e.g. petKey = !test1#doobidoo1!/quux/02
      var realKey = INBOUND[petKey] // maybe from a "default"
      // e.g. realKey = stuff/quux/02
      if (!realKey) { // or maybe not
        var realBase = INBOUND[petBase]
        // e.g. realBase = 'stuff/quux/'
        if (realBase) {
          var start = petBase.length
          var end = petKey.length - start
          var key = petKey.substr(start, end)
          // e.g. key = 02
          realKey = realBase + key
          // e.g. stuff/quux/02
        } else {
          realKey = petKey
        }
      }
      return op.type === 'del' ?
        { key: realKey, type: 'del' }
        : { key: realKey, type: 'put', value: op.value }
    })

    return _batch(ops, opts, function callback (error) {
      if (error) cb(error)
      // @TODO: give each batch an "action name"?
      // @TODO: make it possible to log changes redo/undo/...
      // @TODO: should have an action log maybe
      // console.log('<write origin="'+ (config ? config.prefix:'') +'" >') // @XXX: temporarily commented out until removed for real
      // console.log('  [BATCH] <ops> ', ops) // @XXX: temporarily commented out until removed for real
      // console.log('</write>') // @XXX: temporarily commented out until removed for real
      // console.log('WROTE DO DB: ', ops.map(function(o){return o.key})) // @XXX: temporarily commented out until removed for real
      // [REALKEYtoPETKEY] read$ + config
      // offers:
      //  '!footer#box!/item/'
      //  '!footer#head!/list/'
      //  ....
      // have:
      //  'stuff/quux/02'
      var notifications = []
      ops.forEach(function realKey2petKeys (op) {
        var realKey = op.key
        for (var i=0, len=realKey.length; i<=len; i++) {
          var realBase = realKey.substr(0, len-i)
          var key = realKey.substr(len-i)
          var petBases = OUTBOUND[realBase]
          if (petBases) {
            petBases.forEach(function (petBase) {
              notifications.push(op.type === 'del' ?
                { key: key, petBase: petBase , type: 'del' }
                : { key: key, petBase: petBase , type: 'put', value: op.value }
              )
            })
          }
        }
        return ops
      })

      // @TODO: map
      //  'stuff/': '!foogter#head!/list/'
      //  'stuff/quux': '!foogter#head!/list/'

      // 1. write translation was:
      // e.g."!test1#doobidoo1!/quux/": 'stuff/quux/'
      // petBase || petKey // defaults => realBase || realKey // defaults

      // realKey = petKey
      // realKey = INBOUND[petKey]
      // realKey = INBOUND[petBase] + petKey.substr(start, end)

      // e.g. realKey = stuff/quux/02

      // 2. read translation should be:
      // petKey = realKey
      // petKey = OUTBOUND[realKey]

      // console.log('NOTIFY') // @XXX: temporarily commented out until removed for real
      notifications.forEach(function (n) {
        var chunk = n.type === 'del' ?
         { type: n.type, key: n.petBase + n.key }
         : { type: n.type, key: n.petBase + n.key, value: n.value }
        // console.log(n) // @XXX: temporarily commented out until removed for real
        // console.log(chunk) // @XXX: temporarily commented out until removed for real
        // @TODO: VERIFY: no read ops can come through, where
        // petKey is not in listener range
        try {
          READABLES[n.petBase].forEach(function (read$) {
            read$.push(chunk)
          })
        } catch (e) {
          console.error('This error should not occur!')
          console.error('Because OUTBOUND is supposed to be validated')
          // @TODO: remove this try-catch as soon as OUTBOUND is validated
          console.error(n)
          console.error(chunk)
        }
      })

    })
  }
  /*****************************************************************************
    HELPER - streamOldData - @TODO
  *****************************************************************************/
  // streamOldData(db, through$, config)
  // PUBLISH OLD
    // db.createReadStream(params)
    //   .pipe(through(function (row) {
    //     if (opts.objectMode) output.queue(row)
    //     else output.queue(JSON.stringify(row) + '\n')
    //   }))
  function streamOldData (db, ts$, opts) {
    var read$  = db.createReadStream(opts)
    var write$ = writable({ objectMode: true })
    write$._write = function (item, encoding, next) {
      item.type = "put" // because a db readStream lacks the "type" attribute
      var isDifferent = stringify(item) !== ts$._cache
      if (isDifferent) {
        ts$._cache = stringify(item)
        // @TODO: maybe allow "interpretation"
        // item = ts$._interpretation(item)
        // @TODO: think about transform/read vs flush/write function too
        ts$.push(item)
      }
      next()
    }
    read$.on('end', function loaded() {
      ts$.emit("loaded") // @TODO: API documentation
      write$.emit("finish")
      read$.unpipe(write$)
    })
    read$.pipe(write$)
  }
  //////////////////////////////////////////////////////////////////////////////

  db.wireup = wireup
  db.readable = makeReadable
  db.writable = makeWritable
  db.duplexable = makeDuplexable

  var READABLES = {}
  var OUTBOUND = {}
  var INBOUND = {}
  var DEFAULTS = {}

  return db

  function wireup (wiring) {
    //@TODO: think about whether subtracker and all the writable, readable and duplexable calls are forced to be SYNC and thus - a setTimout(...,0) can be trusted to executed guaranteed AFTER all stuff has been registered
    // maybe collect changes for applying them in a setTimeout with custom interval


    ////////////////////////////////////////////////////////////////
    // e.g.
    var INBOUND = { // PETKEYtoREALKEY from actual write$'s
    // @TODO: traverse and validate existance of all petKeys write$'s
      // ALL written petKeys come from write$'s
      // ALL write$'s have a config including a "prefix" and "baseKey"
      // from EVERY petKey it's possible to extract "prefix+baseKey"
      // USER can make mappings from "defaults" and "prefix+baseKey" to realKeys
      "!test1#doobidoo1!/quux/": 'stuff/quux/'
      // @TODO: even if defaults do not get written
      // @TODO: => offer them as router translation options
      // [PETKEYtoREALKEY] write$ + config
      // e.g. petKey = '!footer#box!item/02'
      //               => '!footer#box!/item/':'stuff/quux/'
      // e.g. realKey = 'stuff/quux/'+'02'
    }
    ////////////////////////////////////////////////////////////////
    ////////////////////////////////////////////////////////////////
    // e.g.

    // @TODO: traverse and validate existance of all petKeys read$'s
    var OUTBOUND = { // REALKEYtoPETKEY to actual read$'s
    // ALL realKeys should maybe go to read$'s
    // ALL read$'s have a config including a "prefix" and "baseKey"
    // -> in order to go to a specific read$, a realKey needs to be mapped
    //    to at least prefix+baseKey of that read$
      'stuff/quux/': [
        // notify about TRACKINGs
        // B:listener1, e.g.: !A!/a/b/c/ (=different readable)
        // C:listener2, e.g.: !A#B!/quuz/baz/3 (=different readable)
        "!test1#doobidoo1!/quux/", // e.g. read$A
        "!test1#doobidoo2!/baz/" // e.g. read$B
        // ... as necessary
        // reader$, { query: { gte:'', lt:'' }, prefix:'', baseKey:''}
        // READERS listen to petRanges which might or might not
        // get mapped to from targetKey by wireup
        // SO: If a petRange means listening to targetKey
        // depends on whether its mapped to it or not
        // thus: a translation from
      ],
      // BY DEFAULT
      "!test1#doobidoo1!": [
        "!test1#doobidoo1!/quux/",
        "!test1#doobidoo2!/baz/"
      ],
      "!test1#doobidoo1!/quux/": [
        // if there is no pet2real mapping for write
        // it was written as !test1#doobidoo2!/baz/
        // so a lookup real2pet will by default return
        // !test1#doobidoo2!/baz/ too
        "!test1#doobidoo1!/quux/"
      ],
      "!test1#doobidoo2!/baz/": [
        // if there is no pet2real mapping for write
        // it was written as !test1#doobidoo2!/baz/
        // so a lookup real2pet will by default return
        // !test1#doobidoo2!/baz/ too
        "!test1#doobidoo2!/baz/"
      ]
    }
    ////////////////////////////////////////////////////////////////
    // var INBOUND = { // db.recorder() === db.writable()
    //   // 0a. Each TRACKER has a check() or "listening range"
    //   // 0b. Many trackers result in array of check() or "listening ranges"
    //   // 1. => action comes from a specific TRACKER and has a KEY
    //   // e.g.
    //   // @TODO: when _put/_del/_get/_batch, check WIRING of TRACKER source
    //   // key, e.g.:      !A#B#C!/foo/bar/baz/5
    //   // TRACKER[key]   = '/page/navbar/menu/notification'
    //   // tracker, e.g.:  !A#B#C!/foo/bar/baz/
    //   // TRACKER[query] = '/page/navbar/menu/'
    //   // var diff       =  TRACKER[key].slice(TRACKER[query].length)
    //   // var diff       = 'notification'
    //   // 2. var realQuery = INBOUND[TRACKER[query]]
    //   // 3. var realKey   = realQuery + diff
    //   '/x/': '/bla/',
    //   '/b/': '/bla/',
    //   '/a/': '/bla/'
    //   // 4. db.put(realKey, TRACKER[value])
    // }
    // var OUTBOUND = { // db.speakerbox() === db.readable()
    //   '/bla/': ['/a/', '/b/'],
    //   '/bla/5': ['/p']
    // }
    // //   => tracker -> relevant listening ranges
    // //   => key -> relevant listening ranges
    // // db.telephone() === db.duplexable()
    // var DEFAULTS = { // js values => internally mapped to JSON
    //   '/bla/': 'foobar',
    //   '/bla/5': 'foobar yay',
    // }
    /////////////////////////////////////////////////////////////////////////


    wiring(INBOUND, OUTBOUND, DEFAULTS, activate)

    // @TODO: SUBSCRIBE read$ means
    // 1. config.defaults have to be eventually written to the db if wireup() says so || in order to determine where: needs mapping!
    // ==> var targetKey = INBOUND[defaultKey]
    // 2. wireup() also needs to say what "data keys" map to which "view keys"
    // + on(dataKey) => read$.push(viewKey+dataValue)


    // add to subscribers to publish to
    // PUBLISH - to all interested read$'s
      //   for (var i = 0, l = trackingRange.length; i < l; i++) {
      //     var r = trackingRange[i]
      // @TODO: binary search for start and end keys
      //     if (change.key >= r.start && change.key <= r.end) {
      //       if (r.stream._objectMode) r.stream.queue(change)
      //       else r.stream.queue(JSON.stringify(change) + '\n')
      //     }
      //   }
      var w = JSON.stringify(config.prefix+config.baseKey)
      var x = JSON.stringify(config.query)
      var y = JSON.stringify(config.defaults)
      var z = config.check
      console.log('<Readable key="'+w+'" query="'+x+'" defaults="'+y+'" check="'+z+'"/>')

    // @TODO: PUBLISH from write$ means
      // 1. store defaults PREFIXED in DEFAULTS to wait for the wireup call
      // 2. WIREUP: map VIEW PREFIXES + common(gte/lt) part of ranges to namespace
      // add to inbound
      var w = JSON.stringify(config.prefix+config.baseKey)
      var x = JSON.stringify(config.query)
      var y = JSON.stringify(config.defaults)
      var z = config.check
      console.log('<Writable key="'+w+'" query="'+x+'" defaults="'+y+'" check="'+z+'"/>')
    function wiring (inbound, outbound, defaults, activate) {

    } // VS.
    function wiring (chunk, encoding, next) {
      // var chunk = { type: 'inbound', value: write$ }
      // var chunk = { type: 'outbound', value: read$ }
      // var stream$ = read$ || write$
      // config = {
      //   query: {
      //     gte,
      //     lt
      //   },
      //   defaults: { },
      //   check: fn,
      //   key:
      this.push()
    }
    //console.log('@TODO(_validate): what if many components are "wired up and give different default values into the db? what should happen?"')
    // @TODO: make sure read$ doesnt get key/values outside of scope of config
    // @TODO: populate "defaults" if wanted
    // if (typeof val !== 'undefined') db.get(key, populate)
    // function populate (doesntExist) { if (doesntExist) { db.put(key, val) } }
    var defaultsBatch = {}
    //activate(defaultsBatch) // populate db with default values
  }
  /////////////////////////////////////////////////////////////////////////////
  function makeDuplexable (query, defaults) {
    var db = this
    var config = translator(db, arguments, translate, codec)
    var write$ = makeWritable.call({ config: config, db: db })
    var read$ = makeReadable.call({ config: config, db: db })
    var duplex$ = duplexify.obj(write$, read$)
    // @TODO: cleanup on duplex$ close (UNPUBLISH/UNSUBSCRIBE)
    return duplex$
  }
  function makeReadable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = translator(db, arguments, translate, codec)
    var read$ = readable({ objectMode: true })
    read$._read = function noop () {}
    // @TODO: How to handle errors in streams?
    // @TODO: cleanup on read$ close (UNSUBSCRIBE)
    read$.on('close', function () { console.log('READ$ close', read$) })
    read$.on('end', function () { console.log('READ$ end', read$) })
    read$.on('closing', function () { console.log('READ$ closing', read$) })
    read$.on('error', function () { console.log('READ$ error', read$) })
    var prefix = config.prefix
    var baseKey = config.baseKey
    if (type(READABLES[prefix+baseKey]) !== 'array')
      READABLES[prefix+baseKey] = []
    // @TODO: UNSUBSCRIBE
    // @TODO: maybe patch read$.push with a check(chunk)
    READABLES[prefix+baseKey].push(read$)
    return read$
  }
  function makeWritable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = translator(db, arguments, translate, codec)
    var write$ = writable({ objectMode: true })
    write$._write = function (batch, encoding, next) {
      batch = validateBatch(batch, config)
      db.batch(batch, {}, next)
    }
    // @TODO: How to handle errors in streams?
    // @TODO: cleanup on write$ close (UNPUBLISH)
    // @TODO: UNSUBSCRIBE
    write$.on('close', function () { console.log('WRITE$ close', write$) })
    write$.on('end', function () { console.log('WRITE$ end', write$) })
    write$.on('closing', function () { console.log('WRITE$ closing', write$) })
    write$.on('error', function () { console.log('WRITE$ error', write$) })
    return write$
  }
  /////////////////////////////////////////////////
// HELPERS
  // function removeKey (key) {
  //   var xs = trackingKeys[key]
  //   if (!xs) return
  //   var ix = xs.indexOf(output)
  //   if (ix >= 0) xs.splice(ix, 1)
  //   if (ix.length === 0) delete trackingKeys[key]
  // }
  // function removeRange (r) {
  //   var ix = trackingRange.indexOf(r)
  //   if (ix >= 0) trackingRange.splice(ix, 1)
  // }
  // function findRange (rf) {
  //   for (var i = 0; i < trackingRange.length; i++) {
  //     var r = trackingRange[i]
  //     if (rf[0] == r.start && rf[1] === r.end && rf[2] === r.since) return r
  //   }
  // }
// INIT
  // var through = require('through')
  // var output = through(write, end)
  // output._objectMode = opts.objectMode
// function END () {}
  // function end () {
  //   output.queue(null)
  // }
// UNSUBSCRIBE - single key
  // else if (row && typeof row === 'object' && row.rm
  // && typeof row.rm === 'string') {
  //   removeKey(row.rm)
  // }
// UNSUBSCRIBE - range
  // else if (row && typeof row === 'object' && row.rm
  // && Array.isArray(row.rm)) {
  //   removeRange(findRange(row.rm))
  // }
  //////////////////////////////////////////////////////////////////////////////
}
/******************************************************************************
  HELPER - translator & inCommon
******************************************************************************/
function translator (db, args, translate, codec) {
  var config = translate ?
    translate.apply(this, args) : { query: args[0], defaults: args[1] }
  // all default keys should be contained in the interval range
  var gte = config.query.gte
  var lt  = config.query.lt
  function check (key) { return (gte<=key) && (key<lt) }
  Object.keys(config.defaults).forEach(function (key) {
    if (!check(key)) throw ChunkNotInRangeError(key, gte, lt)
  })
  config.check = check
  config.prefix = db.prefix ? codec.encode([db.prefix(),'']) : ''
  config.baseKey = inCommon(gte, lt)
  return config
}
function inCommon (str1, str2) {
  var use = str1.length > str2.length ? str2 : str1
  for (var idx=0, len=use.length, common = ''; idx<len; idx++) {
    if (str1[idx] === str2[idx]) common += str1[idx]
    else break
  }
  return common
}
/******************************************************************************
  HELPER - validateBatch & legit
******************************************************************************/
function validateBatch (batch, config) {
  batch = [].concat(batch)
  batch.forEach(function (chunk) {
    if (chunk.type && chunk.type.type) chunk.type = chunk.type.type
    var type = chunk.type==='del'||(chunk.type==='put' && legit(chunk.value))
    if (!type) throw ArgumentDoesntFullfillRequirementsError('chunk', chunk)
    if (!config.check(chunk.key)) // all chunks should be in query range
      throw ChunkNotInRangeError(key, config.query.gte, config.query.lt)
  })
  if(batch.length) { // @TODO: Hack to inform "batchPatch"
    var tmp = batch[0].type
    batch[0].type = { config: config, type: tmp }
  }
  return batch
}
function legit (value) {
  var isSupported = {
    'array': true,
    'object': true,
    'null': true,
    'string': true,
    'boolean': true,
    'number': true,
  }[type(value)]
  if (!isSupported) throw UnsupportedValueError(value)
  var val = JSON.parse(stringify(value))
  if (!deepequal(value, val)) throw UnsupportedValueError(value)
  return true
}
/******************************************************************************
  HELPER - validateArgs
******************************************************************************/
function validateArgs (db, translate) {
  if (!db||!db.db||!db.db._put||!db.db._del||!db.db._get||!db.db._batch)
    throw NoRawLevelupInstanceError('switchboard')
  var counter = 4
  if (db.wireup) {
    counter++
    if (db.wireup !== wireup)
      throw MethodAlreadyUsedByAnotherExtensionError('wireup')
  }
  if (db.writable) {
    counter++
    if (db.writable !== writable)
      throw MethodAlreadyUsedByAnotherExtensionError('writable')
  }
  if (db.readable) {
    counter++
    if (db.readable !== readable)
      throw MethodAlreadyUsedByAnotherExtensionError('readable')
  }
  if (db.duplexable) {
    counter++
    if (db.duplexable !== duplexable)
      throw MethodAlreadyUsedByAnotherExtensionError('duplexable')
  }
  if (counter !== 0 && counter !== 4)
    throw BrokenInitializationError('switchboard')

  if (translate && (typeof translate !== 'function'))
    throw ArgumentDoesntFullfillRequirementsError('translate', translate)
}
/******************************************************************************
  HELPER - Errors
******************************************************************************/
var err = '(╯°□°)╯︵ ┻━┻'
function ChunkNotInRangeError (key, gte, lt) {
  return new Error(err+' : '+key+' is not in query range ['+gte+','+lt+')')
}
function NoRawLevelupInstanceError (modulename) {
  return new Error(err+' : '+modulename+' needs a raw levelup instance')
}
function MethodAlreadyUsedByAnotherExtensionError (methodname) {
  return new Error(err+' : `db.'+methodname+'` already used by an extension')
}
function BrokenInitializationError (modulename) {
  return new Error(err+' : already initialized '+modulename+', but broken')
}
function ArgumentDoesntFullfillRequirementsError (name) {
  return new Error(err+' : given: "'+name+'", but has wrong format')
}
function UnsupportedValueError (value) {
  return new Error(err+' : given: "'+value+'", is not supported')
}
function wtfError () {
  return new Error(err+' : something weired happened - pls post an issue')
}
