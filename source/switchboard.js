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
  // duplexable({gte: 'articles/', lt: 'articles/~\xff'}, {
  //   'articles/01': {},
  //   'articles/02': {},
  //   'articles/03': {},
  //   'articles/04': {}
  // })
  // duplexable({gte: 'title/', lt: 'title/!\x00'}, { 'title': 'My little shop' })

  if db.prefix() exists, arg: codec will be used to encode the prefix
  for every key used in db.put/del/get/batch() operations


  db.on('route', function dataRouter (route){
    console.log(route)
    // => { type: 'inbound', key: '!footer#box!/foobar' }
    // => { type: 'outbound', key: '!footer#box!/foobar' }
    return { toDB: 'data/foobar' }
  }, { allowRewire: true }) // @TODO: a force db overwrite option for defaults
******************************************************************************/
function switchboard (DB, translate, codec) {
  validateArgs(DB, translate, codec)

  var _DB = DB.db
  var _put = _DB._put.bind(_DB)
  var _del = _DB._del.bind(_DB)
  var _get = _DB._get.bind(_DB)
  var _batch = _DB._batch.bind(_DB)
  _DB._put = putPatch
  _DB._del = delPatch
  _DB._get = getPatch
  _DB._batch = batchPatch

  var x
  var _on = DB.on.bind(DB)
  DB.on = function on (event, callback, opts) {
    if (event === 'route') {
      if (x === undefined) x = opts && opts.allowRewire || false
      if (DATAROUTER.routing && x)
        throw new Error('@TODO re-wiring not supported')
      else if (DATAROUTER.routing) throw new Error('router was already set')
      else DATAROUTER.routing = callback
      // @TODO: validate DATAROUTER for meaningful answers to all known routes
    }
    else _on(event, callback)
  }
  // @TODO: maybe patch createReadStream too?
  /////////////////////////////////////////////////////////////////////////////
  var prefixer = /^!.*!/ // @TODO: use codec
  function getPatch (key, opts, cb) {
    // @TODO: translate "key" to "WIREUP" translated key
    // => to READ the correct value
    var prefix = (key.match(prefixer)||[])[0]
    return _get(key, opts, function callback (error, value) {
      console.log('[GET] <key> ', key, '<value> ', value)
      cb(error, value)
    })
  }
  function putPatch (key, value, opts, cb) {
    // @TODO: translate "key" to "WIREUP" translated key
    // => to WRITE the value to the correct path
    var prefix = (key.match(prefixer)||[])[0]
    return _put(key, value, opts, function callback (error) {
      console.log('[PUT] <key> ', key, '<value> ', value)
      cb(error)
      // @TODO: else publish({ type: 'put', key: key, value: value })
    })
  }
  function delPatch (key, opts, cb) {
    // @TODO: translate "key" to "WIREUP" translated key
    // => to DELETE the value at the correct path
    var prefix = (key.match(prefixer)||[])[0]
    return _del(key, opts, function callback (error) {
      console.log('[DEL] <key> ', key)
      cb(error)
      // @TODO: else publish({ type: 'del', key: key })
    })
  }
  function batchPatch (ops, opts, cb) {
    console.log('[BATCH] <key> ', ops)
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
    var ops2 = ops.map(function petKey2realKey (op) {
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
      cb(error)
      // @TODO: make it possible to log changes redo/undo/...
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
      /************************************************************************
        HELPER - Manage Trackerstreams
      ************************************************************************/
      // function batch (arr)      { arr.forEach(each) }
      // function put (key, val) { each({ type: 'put', key: key, value: val }) }
      // function del (key, val) { each({ type: 'del', key: key, value: val }) }
      // function each (item)  { TRACKERSTREAMS.forEach(function process (ts$) {
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
    })
  }
///////////////////////////////////////////////////////////////////////////////
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
///////////////////////////////////////////////////////////////////////////////

  var DATAROUTER = {
    routing: undefined
    readables: {},// @TODO: needed?
    outbound: {},// @TODO: needed?
    inbound: {}// @TODO: needed?
  }

  DB.duplexable = makeDuplexable
  DB.readable = makeReadable
  DB.writable = makeWritable

  return DB

  function makeDuplexable (query, defaults) {
    var db = this
    var config = translator(db, arguments, translate, codec)
    var write$ = makeWritable.call({ config: config, db: db })
    var read$ = makeReadable.call({ config: config, db: db })
    var duplex$ = duplexify.obj(write$, read$)
    duplex$.on('close', function () { console.log('DUPLEX$ close', duplex$) })
    duplex$.on('end', function () { console.log('DUPLEX$ end', duplex$) })
    duplex$.on('closing', function (){console.log('DUPLEX$ closing', duplex$)})
    duplex$.on('error', function () { console.log('DUPLEX$ error', duplex$) })
    // @TODO: How to handle errors in streams?
    // @TODO: cleanup on duplex$ close (UNPUBLISH/UNSUBSCRIBE)
    return duplex$
  }
  function makeReadable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = translator(db, arguments, translate, codec)

    var read$ = readable({ objectMode: true })
    read$._read = noop
    // @TODO: cleanup on read$ close (UNSUBSCRIBE)
    read$.on('close', function () { console.log('READ$ close', read$) })
    read$.on('closing', function () { console.log('READ$ closing', read$) })
    read$.on('end', function () { console.log('READ$ end', read$) })
    read$.on('error', function () { console.log('READ$ error', read$) })
    // @TODO: How to handle errors in streams?

    var bufferRead = [], first = true
    var _push = read$.push
    read$.push = function pushPatch (chunk) {
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
      // @TODO[1]: test, if an initial value pushed to read$ will
      // 100% guaranteed arive, if read$ itself is not wired up yet -
      // otherwise check for stream events to notify when is the right moment

      // @TODO: for write$ and read$, do WIREUP(route) events!

      // @TODO: maybe patch read$.push with a check(chunk)
      // @TODO: make sure read$ doesnt get key/values outside of scope of config
      if (DATAROUTER.routing && first) {
        first = false
        bufferRead.forEach(function (c) {
          _push.call(this, c)
        })
        _push.call(this, chunk)
      } else if (DATAROUTER.routing) {
        _push.call(this, chunk)
      } else {
        bufferRead.push(chunk)
      }
    //////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////
    }

    var prefix = config.prefix
    var baseKey = config.baseKey
    var defaults = config.defaults
    var route = { type: 'inbound', key: prefix+baseKey }
    WIREUP(DATAROUTER, route, defaults)

    // @TODO: publish initial default or db value to read

    // @TODO[1]: a read$ should receive the value from default/db/mem once set initially - because by the time the default or write$val was written, the read$ might not have existed yet - if it doesn't exist, just wire it up, so later write-routes default or writes will update it

    if (type(DATAROUTER.readables[prefix+baseKey]) !== 'array')
      DATAROUTER.readables[prefix+baseKey] = []
    DATAROUTER.readables[prefix+baseKey].push(read$)

    return read$
  }
  function makeWritable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = translator(db, arguments, translate, codec)

    var write$ = writable({ objectMode: true })
    // @TODO: cleanup on write$ close UNPUBISH / UNSIBSCRIBE
    write$.on('close', function () {console.log('WRITE$ close', write$) })
    write$.on('closing', function () {console.log('WRITE$ closing', write$) })
    write$.on('end', function () {console.log('WRITE$ end', write$) })
    write$.on('error', function () {console.log('WRITE$ error', write$) })
    // @TODO: How to handle errors in streams?

    var bufferWrite = [], first = true
    write$._write = function (batch, encoding, next) {
      //////////////////////////////////////////////////////////////////////
      //////////////////////////////////////////////////////////////////////
      batch = validateBatch(batch, config)
      // @TODO: maybe improve ._write method
      if (!DATAROUTER.routing) {
        bufferWrite.push(batch)
        next()
      } else if (DATAROUTER.routing && first) {
        first = false
        bufferWrite.forEach(function (b) {
          db.batch(b, {}, noop)
        })
        bufferWrite = null
        db.batch(batch, {}, next)
      } else db.batch(batch, {}, next)
      //////////////////////////////////////////////////////////////////////
      //////////////////////////////////////////////////////////////////////
    }

    var prefix = config.prefix
    var baseKey = config.baseKey
    var defaults = config.defaults
    var route = { type: 'outbound', key: prefix+baseKey }
    WIREUP(DATAROUTER, route, defaults)
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

////////////////////////////////////////////////////////////////////////////////
// function dataRouter (route) {
//   return {
//     inbound: { // [PETKEYtoREALKEY] from actual write$'s || write$ + config
//     // e.g. petKey = '!footer#box!item/02'
//     //               => '!footer#box!/item/':'stuff/quux/'
//     // e.g. realKey = 'stuff/quux/'+'02'
//////////////////
// PROCESS
//
// read$'s key === outbound sink, write$'s key === inbound source
// route = e.g.
// { type:'inbound', key:'!header#box#searchbar!/term'[, defaultInitVal:''] }
// { type:'outbound', key:'!header#box#searchbar!/term'[, defaultInitVal:''] }
// @XXX
// 1. WIREUP(DATAROUTER, route, defaults)
// ....
  //
  // @XXX from: EXAMPLE from db.on('route') sync? returns
  // 1a. DATAROUTER.routing(route) // => { fromDB/MEM: 'data/asdf/foobar/ '}
  // !IMPORTANT: if route didnt have defaultInitVal, a set wiring.setInitVal
  // will throw an Error. if wanted: set with db.put(...) instead
  // @TODO: think about passing "routes" instead of "route, defaults"
  // @TODO: should all "defaultRoutes in routes" have inbound/outbound? why?
  //
  // !IMPORTANT: if route doesnt specify a key-mapping, then it automatically
  // will map to itself. from/toMEM:petkey2petkey
  // !IMPORTANT: if inbound-petkey === outbound-petkey
  //  => SET inbound->realKey =automatically=> realkey->outbound
  // OR
  //  => SET realkey->outbound =automatically=> inbound->realkey
  // BUT IF EXPLICITLY:
  //  => outbount-petkey === inbound-petkey, AND
  // => outbound->realkey1 + inbound->realkey2, then
  // => connection gets BROKEN on purpose
  // Setting a mapping explicitly will break that connection
  //
  // THINK: wiring related conflicting default values must THROW
  // => user resolves by explicit default wiring
  //
  // wiring = e.g.
  // { fromDB: 'data/foobar/', setInitVal: undefined } // e.g. explicit wiring
  // { fromMEM: petKey, setInitVal: defaultInitVal } // defaultWiring
  //
  // @TODO: if wiring causes multiple default values for certain sink/sources
  // => then throw an error telling user to fix it by explicitly not set certain defaults. HINT: even component internal, e.g. .duplexable({'a':'x'}), .duplexable({'a':'y'}) must not work!
  //
  // @TODO: if DB already has a value stored, do not set a default value
    // if (type(val) !== 'undefined') db.get(key, populate)
    // function populate (doesntExist) { if (doesntExist) { db.put(key, val) } }
  // @IDEA: offer a FORCE option to overwrite db with defaults for setting the router
  //
  // { [toDB: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [toMEM: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [fromDB: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [fromMEM: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }

            // var _DEFAULTS = { // js values => internally mapped to JSON
            //   '/bla/': 'foobar',
            //   '/bla/5': 'foobar yay',
            // }

// -----------------------------------------------------------------------

// FLOW - write$
// e.g.
// 0. write$.write(writeChunk)
// - writeChunk = { type: dbMethod, key: petKey, value: maybeValue }
// 1. write$._write(chunk, enc, next):
// - check(writeChunk) // format & in writing range, else throw/errorHandling
// @IDEA: enable constraints on "value format"
// - buffer until dataRouter available, then db.batch WRITE
    // @TODO: when no write, but dataRouter available, flush!
// 2. db.batch(ops, {}, next) batchPach/delPatch/getPatch/putPatch()
  // @TODO: userSet or default routes exist, if not save to itself
  // SAVE DB WRITE OPERATION inbound: petKey2realKey-> toDB/MEM
            // key, e.g.:      !A#B#C!/foo/bar/baz/5
            // TRACKER[key]   = '/page/navbar/menu/notification'
            // tracker, e.g.:  !A#B#C!/foo/bar/baz/
            // TRACKER[query] = '/page/navbar/menu/'
            // var diff       =  TRACKER[key].slice(TRACKER[query].length)
            // var diff       = 'notification'
            // 2. var realQuery = INBOUND[TRACKER[query]]
            // 3. var realKey   = realQuery + diff
            {
              '/x/': '/bla/',
              '/b/': '/bla/',
              '/a/': '/bla/'
            }
            // 4. db.put(realKey, TRACKER[value])
// 3. forAll _batch._batch/_put/_del/_... operations, function cb (error) {
  // NOTIFY OPERATION outbound: fromDB/MEM -> realKey2petKey

            // => publish to all interested read$'s

                  //   for (var i = 0, l = trackingRange.length; i < l; i++) {
                  //     var r = trackingRange[i]
                  // @TODO: binary search for start and end keys
                  //     if (change.key >= r.start && change.key <= r.end) {
                  //       if (r.stream._objectMode) r.stream.queue(change)
                  //       else r.stream.queue(JSON.stringify(change) + '\n')
                  //     }
                  //   }

            // var _OUTBOUND = { // db.readable()
            //   '/bla/': ['/a/', '/b/'],
            //   '/bla/5': ['/p']
            // } // @TODO cache from/for DATAROUTER?

            // => do: read$.push(petKet, dataValue)
            var _OUTBOUND = {
              'stuff/quux/': [
                // notify about TRACKINGs
                // B:listener1, e.g.: !A!/a/b/c/ (=different readable)
                // C:listener2, e.g.: !A#B!/quuz/baz/3 (=different readable)
                "!test1#doobidoo1!/quux/", // e.g. read$A
                "!test1#doobidoo2!/baz/" // e.g. read$B
                // ... as necessary
                // reader$, { query: { gte:'', lt:'' }, prefix:'', baseKey:''}
                // READERS listen to petRanges which might or might not
                // get mapped to from targetKey by WIREUP
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
//  4. read$.push
    // @TODO: traverse and validate existance of all petKeys read$'s
    // @IDEA: ALL set realKeys should maybe go to read$'s ???
    // ALL read$'s have a config including a "prefix" and "baseKey"
    // -> in order to go to a specific read$, a realKey needs to be mapped
    //    to at least prefix+baseKey of that read$

/////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////
function WIREUP (DATAROUTER, route, defaults) {
  // @TODO: assert: defaults already checked for inrangenes

  var key = route.key
  var type = route.type

  var defaultWiring = {}
  defaultWiring[key] = { fromMEM: key }

  debugger;

  // @TODO: store "routes" until a DATAROUTER.routing has been set, then
  // start doing work, by also flushing buffered routes

  // @NOTE: ACTIVE means the moment a "routing" is attached
  //  1. first set all the buffered routes
  //  2. second is to flush all buffered read/writes

  if (DATAROUTER.routing) {
    // @TODO: think about whether subtracker and all the writable, readable and duplexable calls are forced to be SYNC and thus - a setTimout(...,0) can be trusted to executed guaranteed AFTER all stuff has been registered. Maybe collect changes for applying them in a setTimeout with custom interval
    var wiring = DATAROUTER.routing(route)
    // @IDEA: maybe "routing" itself can be a STREAM
    // function wiring2 (chunk, encoding, next) { this.push() }
  } else {
    console.log('No DATAROUTER set yet')
  }

  var _INBOUND = { "!test1#doobidoo1!/quux/": 'stuff/quux/' }
  var _OUTBOUND = {
    // @TODO: maybe no petKey can be under multiple realKeys?
    'stuff/quux/': [
      "!test1#doobidoo1!/quux/", // e.g. read$A
      "!test1#doobidoo2!/baz/" // e.g. read$B
    ],
    // BY DEFAULT
    "!test1#doobidoo1!": [
      "!test1#doobidoo1!/quux/",
      "!test1#doobidoo2!/baz/"
    ],
    "!test1#doobidoo1!/quux/": [ "!test1#doobidoo1!/quux/" ],
    "!test1#doobidoo2!/baz/": [ "!test1#doobidoo2!/baz/" ]
  }
}
/******************************************************************************
  HELPER - translator & inCommon
******************************************************************************/
function translator (db, args, translate, codec) {
  var config = translate ?
    translate.apply(this, args) : { query: args[0]||{}, defaults: args[1]||{} }
  // all default keys should be contained in the interval range
  var gte = config.query.gte
  var lt  = config.query.lt
  // @TODO: re-think  gte,lt , maybe into
  // { gte: '/foobar/!', lte: '/foobar/~' }
  // { gte: '/foobar',   lte: '/foobar'   }
  var defaults = config.defaults
  if (!gte || !lt)
    throw ArgumentDoesntFullfillRequirementsError ('query', conofig.query)
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
  HELPER - noop
******************************************************************************/
function noop () {}
/******************************************************************************
  HELPER - validateBatch & legit
******************************************************************************/
function validateBatch (batch, config) {
  batch = [].concat(batch)
  batch.forEach(function (chunk) {
    if (chunk.type && chunk.type.type) chunk.type = chunk.type.type
    // @TODO: add that batch can contain { type: 'customAction', ... }
    // ... potential feature inspired by REDUX ACTIONS
    // ... @TODO:  if custom actions are neccessary at all
    // @TODO: give each batch an "action name"?
    // @TODO: should have an action log maybe
    var type = chunk.type==='del'||(chunk.type==='put' && legit(chunk.value))
    if (!type) throw ArgumentDoesntFullfillRequirementsError('chunk', chunk)
    if (!config.check(chunk.key)) // all chunks should be in query range
      throw ChunkNotInRangeError(chunk.key, config.query.gte, config.query.lt)
  })
  if(batch.length) { // Hack to inform "batchPatch"
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
function validateArgs (db, translate, codec) {
  if (!db||!db.db||!db.db._put||!db.db._del||!db.db._get||!db.db._batch)
    throw NoRawLevelupInstanceError('switchboard')
  var methodName = db.duplexable && 'duplexable'
    || db.writable && 'writable'
    || db.readable && 'readable'
  if (methodName)
    throw MethodAlreadyUsedByAnotherExtensionError(methodName)
  if (translate && (type(translate) !== 'function'))
    throw ArgumentDoesntFullfillRequirementsError('translate', translate)
  var d = db.prefix && (type(db.prefix) !== 'function')
  if (d) throw ArgumentDoesntFullfillRequirementsError('db.prefix', db)
  var c = db.prefix &&
    (!codec || codec && (!codec.encode||type(codec.encode)!=='function'))
  if (c) throw ArgumentDoesntFullfillRequirementsError('codec', c)
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
  return new Error(err+' : '+
    'subtrack has already been initialized with this db OR db.'+
    methodname+' is already used by another extension')
}
function ArgumentDoesntFullfillRequirementsError (name, value) {
  var x = JSON.stringify(value)
  return new Error(err+' : given: "'+name+'", but has wrong format: '+ x)
}
function UnsupportedValueError (value) {
  return new Error(err+' : given: "'+value+'", is not supported')
}
