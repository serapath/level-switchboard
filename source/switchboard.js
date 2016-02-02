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
  // @TODO: maybe patch createReadStream too?

  // @TODO: DB.off('route') // return currently attached routing

  var x
  var _on = DB.on.bind(DB)
  DB.on = function on (event, callback, opts) {
    if (event === 'route') {
      if (x === undefined) x = opts && opts.allowRewire || false
      if (DATAROUTER.routing && x)
        throw new Error('@TODO re-wiring not supported')
      else if (DATAROUTER.routing) throw new Error('router was already set')
      else {
        // @TODO: validate DATAROUTER for meaningful answers to all known routes
        DATAROUTER.routing = callback
        DATAROUTER.bufferedRoutes.forEach(function (route) {
          // @TODO: process route - see: WIREUP
          // ACTIVE means the moment a "routing" is attached
          //  1. first set all the buffered routes
          //  2. second is to flush all buffered read/writes
        })
        DATAROUTER.bufferedRoutes = null
      }
    }
    else _on(event, callback)
  }

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
      if (config) { // comes from a inbound$
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
      // [REALKEYtoPETKEY] outbound$ + config
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
          READABLES[n.petBase].forEach(function (outbound$) {
            outbound$.push(chunk)
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

  var DATAROUTER = {
    bufferedRoutes: [],
    routing: undefined,
    readables: {},// @TODO: needed?
    outbound: {},// @TODO: needed?
    inbound: {},// @TODO: needed?
  }

  DB.duplexable = makeDuplexable
  DB.readable = makeReadable
  DB.writable = makeWritable

  return DB

  function makeDuplexable (query, defaults) {
    var db = this
    var config = validateQuery(db, arguments, translate, codec)
    var inbound$ = makeWritable.call({ config: config, db: db })
    var outbound$ = makeReadable.call({ config: config, db: db })
    var duplex$ = duplexify.obj(inbound$, outbound$)
    // @TODO: cleanup on duplex$ close (UNPUBLISH/UNSUBSCRIBE)
    duplex$.on('close', function () { console.log('DUPLEX$ close', duplex$) })
    duplex$.on('end', function () { console.log('DUPLEX$ end', duplex$) })
    duplex$.on('closing', function (){console.log('DUPLEX$ closing', duplex$)})
    duplex$.on('error', function () { console.log('DUPLEX$ error', duplex$) })
    // @TODO: How to handle errors in streams?
    return duplex$
  }
  function makeReadable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = validateQuery(db, arguments, translate, codec)

    var outbound$ = readable({ objectMode: true })
    outbound$._read = noop
    // @TODO: cleanup on outbound$ close (UNSUBSCRIBE)
    outbound$.on('close', function () { console.log('outbound$ close', outbound$) })
    outbound$.on('closing', function () { console.log('outbound$ closing', outbound$) })
    outbound$.on('end', function () { console.log('outbound$ end', outbound$) })
    outbound$.on('error', function () { console.log('outbound$ error', outbound$) })
    // @TODO: How to handle errors in streams?

    var outboundBuffer = [], first = true
    var _push = outbound$.push
    outbound$.push = function pushPatch (batch) {
      // @TODO[1]: test, if an initial value pushed to outbound$ will 100% guaranteed arive, if outbound$ itself is not wired up yet - otherwise check for stream events to notify when is the right moment
      batch = validateBatch(batch, config)
      if (DATAROUTER.routing && first) {
        first = false
        outboundBuffer.forEach(function (b) { _push.call(this, b) })
        outboundBuffer = []
        _push.call(this, batch)
      } else if (DATAROUTER.routing) {
        _push.call(this, batch)
      } else {
        bufferRead.push(batch)
      }
    }

    var prefix = config.prefix
    var baseKey = config.baseKey
    var routes = [{ type: 'outbound', key: prefix+baseKey }]
    routes = routes.concat(Object.keys(config.defaults).map(format))
    function format (petKey) {
      var defaultInitVal = config.defaults[petKey]
      return { type: 'outbound', key: petKey, defaultInitVal: defaultInitVal }
    }
    WIREUP(DATAROUTER, routes, outbound$)

    if (type(DATAROUTER.readables[prefix+baseKey]) !== 'array')
      DATAROUTER.readables[prefix+baseKey] = []
    DATAROUTER.readables[prefix+baseKey].push(outbound$)

    return outbound$
  }
  function makeWritable (query, defaults) {
    if (this.config) var db = this.db, config = this.config
    else var db = this, config = validateQuery(db, arguments, translate, codec)

    var inbound$ = writable({ objectMode: true })
    // @TODO: cleanup on inbound$ close UNPUBISH / UNSIBSCRIBE
    inbound$.on('close', function () {console.log('inbound$ close', inbound$) })
    inbound$.on('closing', function () {console.log('inbound$ closing', inbound$) })
    inbound$.on('end', function () {console.log('inbound$ end', inbound$) })
    inbound$.on('error', function () {console.log('inbound$ error', inbound$) })
    // @TODO: How to handle errors in streams?

    var inboundBuffer = [], first = true
    inbound$._write = function (batch, encoding, next) {
      batch = validateBatch(batch, config)
      if(batch.length) { // Hack to inform "batchPatch"
        var tmp = batch[0].type
        batch[0].type = { config: config, type: tmp }
      }
      if (DATAROUTER.routing && first) {
        first = false
        inboundBuffer.forEach(function (b) { db.batch(b, {}, noop) })
        inboundBuffer = []
        db.batch(batch, {}, next)
      } else if (DATAROUTER.routing) {
        db.batch(batch, {}, next)
      } else {
        inboundBuffer.push(batch)
        next()
      }
    }

    var prefix = config.prefix
    var baseKey = config.baseKey
    var routes = [{ type: 'inbound', key: prefix+baseKey }]
    routes.concat(Object.keys(config.defaults).map(function (petKey) {
      var defaultInitVal = config.defaults[petKey]
      return { type: 'inbound', key: petKey, defaultInitVal: defaultInitVal }
    }))
    WIREUP(DATAROUTER, routes, inbound$)
    return inbound$
  }
}
/******************************************************************************
  HELPER - WIREUP
******************************************************************************/
function WIREUP (DATAROUTER, routes, stream$) {
  // route = e.g.
  // { type:'inbound',key:'!header#box#searchbar!/term'[,defaultInitVal:''] }
  // { type:'outbound',key:'!header#box#searchbar!/term'[,defaultInitVal:''] }

  // =>

  // { fromDB/MEM: 'data/asdf/foobar/ '}
  // { fromDB: 'data/foobar/', setInitVal: undefined } // explicit wiring
  // { fromMEM: petKey, setInitVal: defaultInitVal } // default
  // { [toDB: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [toMEM: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [fromDB: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }
  // { [fromMEM: '/data/term'[, setInitVal: e.g. route.defaultInitVal]] }

  if (DATAROUTER.routing)
    routes.forEach(function (route) {
      // @TODO: cache all "routes" and if in the future "routing" is updated
      // update re-run all cached "routes" to update "wiring"'s
      var wiring = DATAROUTER.routing(route)

      var petKey = route.key, typ = route.type, val = route.defaultInitVal
      var w = type(wiring) === 'object' ? wiring : {}

      // NORMALIZE MAPPING
      function s (mapping) { return type(mapping) === 'string' }
      if (typ === 'outbound')
        if ('toDB' in w || 'toMEM' in w || 'fromDB' in w && 'fromMEM' in w)
          throw new Error('outbound routes only have "fromDB" xor "fromMEM"')
        else if (s(w.fromDB)) // outbound petkey2realkey
          // @TODO: publish initial default or db value to read
          // @TODO[1]: a outbound$ should receive the value from default/db/mem once set initially - because by the time the default or inbound$val was written, the outbound$ might not have existed yet - if there is no value, then, just wire it up, so later write-routes default or writes will update it
          /******************************************************************
            HELPER - streamOldData - @TODO
            // streamOldData(db, through$, config)
            // PUBLISH OLD
            // db.createReadStream(params)
            //   .pipe(through(function (row) {
            //     if (opts.objectMode) output.queue(row)
            //     else output.queue(JSON.stringify(row) + '\n')
            //   }))
          ******************************************************************/
          // function streamOldData (db, ts$, opts) {
          //   var read$  = db.createReadStream(opts)
          //   var write$ = writable({ objectMode: true })
          //   write$._write = function (item, encoding, next) {
          //     item.type = "put" // because a db readStream lacks the "type" attribute
          //     var isDifferent = stringify(item) !== ts$._cache
          //     if (isDifferent) {
          //       ts$._cache = stringify(item)
          //       // @TODO: maybe allow "interpretation"
          //       // item = ts$._interpretation(item)
          //       // @TODO: think about transform/read vs flush/write function too
          //       ts$.push(item)
          //     }
          //       next()
          //     }
          //     read$.on('end', function loaded() {
          //     ts$.emit("loaded") // @TODO: API documentation
          //     write$.emit("finish")
          //     read$.unpipe(write$)
          //   })
          //   read$.pipe(write$)
          // }
{
          console.log('@TODO: do stuff')
          // @TODO: ADD TO INTERNAL CACHE: DATASTREAM.xxx
          // @TODO: fill

          LESEZEICHEN

          DATAROUTER.outbound
          DATAROUTER.inbound
          DATAROUTER.readables
          // @TODO: before continue, first check how the structures
          // below will be used when inbound$ or outbound$ data comes in/out
          // thus:
          // -

          // USED IN
          // inbound$._write: db.batch(batch, {}, next)
          // and
          // outbound$.push(batch)

          var _DEFAULTS = { // js values => internally mapped to JSON
            '/bla/': 'foobar',
            '/bla/5': 'foobar yay',
          }
          var _INBOUND = { "!test1#doobidoo1!/quux/": 'stuff/quux/' }
          var _OUTBOUND = {
            // @TODO: maybe no petKey can be under multiple realKeys?
            'stuff/quux/': [
              "!test1#doobidoo1!/quux/", // e.g. outbound$A
              "!test1#doobidoo2!/baz/" // e.g. outbound$B
            ],
            // BY DEFAULT
            "!test1#doobidoo1!": [
              "!test1#doobidoo1!/quux/",
              "!test1#doobidoo2!/baz/"
            ],
            "!test1#doobidoo1!/quux/": [ "!test1#doobidoo1!/quux/" ],
            "!test1#doobidoo2!/baz/": [ "!test1#doobidoo2!/baz/" ]
          }
          // !IMPORTANT: if inbound-petkey === outbound-petkey
          //  => SET inbound->realKey =automatically=> realkey->outbound
          // OR
          //  => SET realkey->outbound =automatically=> inbound->realkey
          // BUT IF EXPLICITLY:
          //  => outbound-petkey === inbound-petkey, AND
          // => outbound->realkey1 + inbound->realkey2, then
          // => connection gets BROKEN on purpose
          // Setting a mapping explicitly will break that connection
          //
          // THINK: wiring related conflicting default values must THROW
          // => user resolves by explicit default wiring

          // @TODO: if wiring causes multiple default values for certain sink/sources
          // => then throw an error telling user to fix it by explicitly not set certain defaults. HINT: even component internal, e.g. .duplexable({'a':'x'}), .duplexable({'a':'y'}) must not work!
          //

          // @TODO: if DB already has a value stored, do not set a default value
            // if (type(val) !== 'undefined') db.get(key, populate)
            // function populate (doesntExist) { if (doesntExist) { db.put(key, val) } }
          // @IDEA: offer a FORCE option to overwrite db with defaults for setting the router
          //
}
        else if (s(w.fromMEM))
{

          console.log('@TODO: do stuff')

}
        else if ('fromDB' in w || 'fromMEM' in w)
          throw new Error('when set, fromDB/fromMEM must be a string')
        else w.fromMEM = petKey // default: petkey2petkey
      else if (typ === 'inbound')
        if ('fromDB' in w || 'fromMEM' in w || 'toDB' in w && 'toMEM' in w)
          throw new Error('inbound route only have "toDB" xor "toMEM"')
        else if (s(w.toDB)) // => inbound petkey2realkey


          console.log('@TODO: do stuff')


        else if (s(w.toMEM))


          console.log('@TODO: do stuff')


        else if ('toDB' in w || 'toMEM' in w)
          throw new Error('when set, toMEM/toDB must be a string')
        else w.toMEM = petKey // default: petkey2petkey
      else
        throw new Error('unsupported route type for' + JSON.stringify(route))

      // NORMALIZE DEFAULTS
      if((val === undefined) && ('setInitVal' in w))
        throw new Error('Cannot set initial value for a route that does not offer a default. If really needed, use "db.put(...)" instead')
      else if (val)
        if (!('setInitVal' in w)) wiring.setInitVal = val // use default
        else if (w.setInitVal === undefined) delete w.setInitVal // no default
        else if (legit(w.setInitVal)) { /* do nothing, all is good :-) */ }
        else throw new Error('given default has/contains unsupported type(s)')
    })
  else DATAROUTER.bufferedRoutes.concat(routes)
}
/******************************************************************************
  HELPER - validateQuery & getCommonBase
******************************************************************************/
function validateQuery (db, args, translate, codec) {
  var config = translate ?
    translate.apply(this, args) : { query: args[0]||{}, defaults: args[1] }
  // all default keys should be contained in the interval range
  var gte = config.query.gte
  var lt  = config.query.lt
  // @TODO: re-think  gte,lt , maybe into
  // { gte: '/foobar/!', lte: '/foobar/~' }
  // { gte: '/foobar',   lte: '/foobar'   }
  var defaults = config.defaults||{}
  if (type(gte) !== 'string' || type(lt) !== 'string')
    throw ArgumentDoesntFullfillRequirementsError ('query', conofig.query)
  function check (key) { return (gte<=key) && (key<lt) }
  Object.keys(defaults).forEach(function (key) {
    if (!check(key) && legit(defaults[key]))
      throw ChunkNotInRangeError(key, gte, lt)
  })
  config.check = check
  config.prefix = db.prefix ? codec.encode([db.prefix(),'']) : ''
  config.baseKey = getCommonBase(gte, lt)
  return config
}
function getCommonBase (str1, str2) {
  var use = str1.length > str2.length ? str2 : str1
  for (var idx=0, len=use.length, commonBase = ''; idx<len; idx++) {
    if (str1[idx] === str2[idx]) commonBase += str1[idx]
    else break
  }
  return commonBase
}
/******************************************************************************
  HELPER - noop
******************************************************************************/
function noop () {}
/******************************************************************************
  HELPER - validateBatch
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
  return batch
}
/******************************************************************************
  HELPER - legit
******************************************************************************/
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
