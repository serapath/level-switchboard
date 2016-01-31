'use strict'
var test      = require('tape')
var type      = require('component-type')

/******************************************************************************
  CUSTOM
******************************************************************************/
var populate  = require('./populate.js')

var memdb     = require('memdb')
var levelup   = require('levelup')
var leveljs   = require('level-js')
var reset     = require('reset-storage')
var writable  = require('readable-stream').Writable

/******************************************************************************
  HELPER
******************************************************************************/
var NAME = 'test.db'
reset.indexedDB("IDBWrapper-"+ NAME)
function noop () {}
function createTestWritable (name, fn) {
  var write$ = writable({ objectMode: true })
  write$._write = function (item, encoding, next) {
    fn(name, item, encoding)
    next()
  }
  return write$
}

/******************************************************************************
  MAIN
******************************************************************************/
var switchboard = require('..')

test('level-switchboard', function (t) {
  t.plan(1)
  // t.plan(2)
  // t.test('...with level-js', function leveljsTest (t) {

  //   levelup(NAME, { db: leveljs }, testSuite(t))
  // })
  t.test('...with memdb', function memdbTest (t) {
    memdb(NAME, testSuite(t))
  })
})

/******************************************************************************
  TESTS
******************************************************************************/
function testSuite (t) {
  return function tests (error, db) {

    t.test('nonsense', function (t) {
      // @TODO: refine or remove this test
      t.plan(3)
      // PREPARE
      var x = 1
      // TEST
      t.ok(x===1, 'yay')
      t.ok(x!==2, 'yay')
      t.doesNotThrow(function(){})
      // function logg (text) { return function (data) { console.log(text,': ',data) }}
      // db.on('put', logg('db:put'))
      // db.on('batch', logg('db:batch'))
      // DB.post({start:'',end:'~'},function (change){console.log('post DB')})
      // DB.on('put', logg('DB:put'))
      // DB.on('batch', logg('DB:batch'))
      // dbA.post({start:'',end:'~'},function (change){console.log('post dbA')})

      // dbA.put('/foobar/asdf', 'dbA:asdf')
      // DB.put('DB:asdf', 'DB:asdf')
      // db.put('db:asdf', 'db:asdf')
    })

    t.test('switchboard(db)', function (t) {
      t.plan(7)
      t.notOk(db.readable, 'db.readable does not exist yet')
      t.notOk(db.writable, 'db.writable does not exist yet')
      t.notOk(db.duplexable, 'db.duplexable does not exist yet')
      var dbt = switchboard(db)
      t.ok(db.readable, 'db.readable exists')
      t.ok(db.writable, 'db.writable exists')
      t.ok(db.duplexable, 'db.duplexable exists')
      t.ok(db === dbt, 'db === dbt')
    })

    t.test('db.writable(wrong query, no defaults)', function (t) {
      t.plan(4)
      var q1 = { gte: 'foobar/!', lte: 'foobar/~' }
      var q2 = { gt: 'foobar/!', lt: 'foobar/~' }
      var q3 = "{ gt: 'foobar/!', lt: 'foobar/~' }"
      function create_db_q1 () { return db.writable(q1) }
      function create_db_q2 () { return db.writable(q2) }
      function create_db_q3 () { return db.writable(q3) }
      function create_db_no () { return db.writable()   }
      t.throws(create_db_q1,'query={gte:"foobar/!",lte: "foobar/~"}')
      t.throws(create_db_q2,'query={gt:"foobar/!",lt: "foobar/~"}')
      t.throws(create_db_q3,'query="{gt:"foobar/!",lt: "foobar/~"}"')
      t.throws(create_db_no,'no query')
    })

    t.test('db.readable(wrong query, no defaults)', function (t) {
      t.plan(4)
      var q1 = { gte: 'foobar/!', lte: 'foobar/~' }
      var q2 = { gt: 'foobar/!', lt: 'foobar/~' }
      var q3 = "{ gt: 'foobar/!', lt: 'foobar/~' }"
      function create_db_q1 () { return db.readable(q1) }
      function create_db_q2 () { return db.readable(q2) }
      function create_db_q3 () { return db.readable(q3) }
      function create_db_no () { return db.readable()   }
      t.throws(create_db_q1,'query={gte:"foobar/!",lte: "foobar/~"}')
      t.throws(create_db_q2,'query={gt:"foobar/!",lt: "foobar/~"}')
      t.throws(create_db_q3,'query="{gt:"foobar/!",lt: "foobar/~"}"')
      t.throws(create_db_no,'no query')
    })

    t.test('db.duplexable(wrong query, no defaults)', function (t) {
      t.plan(4)
      var q1 = { gte: 'foobar/!', lte: 'foobar/~' }
      var q2 = { gt: 'foobar/!', lt: 'foobar/~' }
      var q3 = "{ gt: 'foobar/!', lt: 'foobar/~' }"
      function create_db_q1 () { return db.duplexable(q1) }
      function create_db_q2 () { return db.duplexable(q2) }
      function create_db_q3 () { return db.duplexable(q3) }
      function create_db_no () { return db.duplexable()   }
      t.throws(create_db_q1,'query={gte:"foobar/!",lte: "foobar/~"}')
      t.throws(create_db_q2,'query={gt:"foobar/!",lt: "foobar/~"}')
      t.throws(create_db_q3,'query="{gt:"foobar/!",lt: "foobar/~"}"')
      t.throws(create_db_no,'no query')
    })

    // @TODO: LESEZEICHEN

    t.test('writable$.write("a")//wrong format', function (t) {
      t.plan(1)
      db.on('route', function routing (route) {
        return {
          inbound: {},
          outbound: {
            'foobar/': { fromDB: 'data/foobar/' }
          }
        }[route.type][route.key]
      })
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeWrongFormat () { return state$.write('a') }
      t.throws(writeWrongFormat, 'write wrong format')
    })

    t.test('writable$.write({})//wrong format', function (t) {
      t.plan(1)
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeWrongFormat () { return state$.write({}) }
      t.throws(writeWrongFormat, 'write wrong format')
    })

    t.test('writable$.write(del)//outOfRange', function (t) {
      t.plan(1)
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeCorrectDelOps () {
        return state$.write({ type: 'del', key: 'asdf1' })
      }
      t.throws(writeCorrectDelOps, 'write a valid del operation')
    })

    t.test('writable$.write(put)//outOfRange', function (t) {
      t.plan(1)
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeCorrectPutOps () {
        return state$.write({ type: 'put', key: 'asdf2', value: 'foobar' })
      }
      t.throws(writeCorrectPutOps, 'write a valid put operation')
    })

    t.test('writable$.write(batch)//outOfRange', function (t) {
      t.plan(1)
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeCorrectBatchOps () {
        return state$.write([
          { type: 'del', key: 'asdf3' },
          { type: 'put', key: 'asd4', value: 'foobar' }
        ])
      }
      t.throws(writeCorrectBatchOps, 'write a valid batch operation')
    })

    t.test('writable$.write(del/put/batch)//valid', function (t) {
      t.plan(3)
      var query = { gte: 'foobar/!', lt: 'foobar/~' }
      var state$ = db.writable(query)
      function writeDelOps () {
        return state$.write({ type: 'del', key: 'foobar/a' })
      }
      function writePutOps () {
        return state$.write({ type: 'put', key: 'foobar/b', value: 'foobar' })
      }
      function writeBatchOps () {
        return state$.write([
          { type: 'del', key: 'foobar/bar' },
          { type: 'put', key: 'foobar/baz', value: 'quux' }
        ])
      }
      t.doesNotThrow(writeDelOps, 'write a valid del operation')
      t.doesNotThrow(writePutOps, 'write a valid put operation')
      t.doesNotThrow(writeBatchOps, 'write a valid batch operation')
      // db.put('a', 'b', function () {
      //   db.createReadStream().on('data', function (chunk) {
      //     throw chunk
      //   })
      // })
    })
    // t.test('db.readable(correct query, no defaults)', function (t) {
    //   t.plan(1)
    //   var write$ = createTestWritable('/')
    //   var query = { gte: 'foobar/!', lt: 'foobar/~' }
    //   var state$ = db.readable(query)
    //
    //   t.ok(true)
    // })
    //
    //
    // t.test('db.duplexable(correct query, no defaults)', function (t) {
    //   t.plan(1)
    //   var write$ = createTestWritable('/')
    //   var query = { gte: 'foobar/!', lt: 'foobar/~' }
    //   var state$ = db.duplexable(query)
    //
    //   t.ok(true)
    // })
  }
}

function LEGACY () {
      var write$ = createTestWritable('/')
  // TEST DATA
  var testChunkread = { type: 'put', value: 'blerg', key: '/foobar/01' }
  var testChunkwrite = [
    { type: 'put', value: 'blerg 02', key: '/foobar/02' },
    { type: 'del', key: '/foobar/03' }
  ]
  // TEST GENERATOR
  state$.push(testChunkread)
  // CHECK RECEIVING UPDATES
  state$.pipe(write$) // READ
  // CHECK SENDING UPDATES - instad of .pipe(state$)
  state$.write(testChunkwrite) // WRITE
  ///////////////////////////////////////////////////////////////////////////
  var write$1 = createTestWritable('/test1')
  var dbt1 = dbt.sublevel('test1')
  var state1$ = dbt1.duplexable('bar/')
  // TEST DATA
  var testChunk1read = { type: 'put', value: 'blerg', key: '/bar/01' }
  var testChunk1write = [
    { type: 'put', value: 'blerg 02', key: '/bar/02' },
    { type: 'del', key: '/bar/03' }
  ]
  // TEST GENERATOR
  state1$.push(testChunk1read)
  // CHECK RECEIVING UPDATES
  state1$.pipe(write$1) // READ
  // CHECK SENDING UPDATES - instad of .pipe(state$)
  state1$.write(testChunk1write) // WRITE
  ///////////////////////////////////////////////////////////////////////////
  var write$2 = createTestWritable('/test2')
  var dbt2 = dbt.sublevel('test2')
  var state2$ = dbt2.duplexable('baz/')
  // TEST DATA
  var testChunk2read = { type: 'put', value: 'blerg', key: '/baz/01' }
  var testChunk2write = [
    { type: 'put', value: 'blerg 02', key: '/baz/02' },
    { type: 'del', key: '/baz/03' }
  ]
  // TEST GENERATOR
  state2$.push(testChunk2read)
  // CHECK RECEIVING UPDATES
  state2$.pipe(write$2) // READ
  // CHECK SENDING UPDATES - instad of .pipe(state$)
  state2$.write(testChunk2write) // WRITE
  ///////////////////////////////////////////////////////////////////////////
  var write$3 = createTestWritable('/doobidoo1')
  var dbt3 = dbt1.sublevel('doobidoo1')
  var state3$ = dbt3.duplexable('quux/')
  // TEST DATA
  var testChunk3read = { type: 'put', value: 'blerg', key: '/quux/01' }
  var testChunk3write = [
    { type: 'put', value: 'blerg 02', key: '/quux/02' },
    { type: 'del', key: '/quux/03' }
  ]
  // TEST GENERATOR
  state3$.push(testChunk3read)
  // CHECK RECEIVING UPDATES
  state3$.pipe(write$3) // READ
  // CHECK SENDING UPDATES - instad of .pipe(state$)
  state3$.write(testChunk3write) // WRITE
  ///////////////////////////////////////////////////////////////////////////
  var write$4 = createTestWritable('/doobidoo2')
  var dbt4 = dbt2.sublevel('doobidoo2')
  var state4$ = dbt4.duplexable('beep/')
  // TEST DATA
  var testChunk4read = { type: 'put', value: 'blerg', key: '/beep/01' }
  var testChunk4write = [
    { type: 'put', value: 'blerg 02', key: '/beep/02' },
    { type: 'del', key: '/beep/03' }
  ]
  // TEST GENERATOR
  state4$.push(testChunk4read)
  // CHECK RECEIVING UPDATES
  state4$.pipe(write$4) // READ
  // CHECK SENDING UPDATES - instad of .pipe(state$)
  state4$.write(testChunk4write) // WRITE
  state4$.write(testChunk4write) // WRITE
  state4$.write(testChunk4write) // WRITE
  state4$.write(testChunk4write) // WRITE

  // @TODO: test some normal .put, .del, .... on all sublevels

  // var ops = [ // make from 'chunk'
  //   // defaults to  type:'put'
  //   // key' of null or undefined will callback(error)
  //   { type: 'del', key: 'father'/*, value: 'is ignored'*/ },
  //   // type:put, value of null or undefined will callback(error)
  //   { type: 'put', key: 'name', value: 'Yuri Irsenovich Kim' },
  //   { type: 'put', key: 'dob', value: '16 February 1941' },
  //   { type: 'put', key: 'spouse', value: 'Kim Young-sook' },
  //   { type: 'put', key: 'occupation', value: 'Clown' }
  // ]
  // state5$.write(ops)
  // state5$.on('error', function (err, meeeh) {
  //   if (err) return console.log('Ooops!', err)
  //   console.log('end batch: ', meeeh)
  // })


  // var generate = populate(md, 200)
  // generate(dbt, [
  //   { prefix: '/bar/',   interval:  5 },
  //   { prefix: '/foobar/', interval: 25 },
  //   { prefix: '/beep',    interval: 48 }
  // ])
  // generate(dbt1, [
  //   { prefix: '/baz/',  interval:  5 },
  //   { prefix: '/bar/',  interval: 25 },
  //   { prefix: 'dbt1',   interval: 48 }
  // ])
  // generate(dbt2, [
  //   { prefix: '/baz/',  interval:  5 },
  //   { prefix: '/bar/',  interval: 25 },
  //   { prefix: 'dbt2',   interval: 48 }
  // ])
  // generate(dbt3, [
  //   { prefix: '/quux/', interval:  5 },
  //   { prefix: '/beep/', interval: 25 },
  //   { prefix: '/dbt3',  interval: 48 }
  // ])
  // generate(dbt4, [
  //   { prefix: '/quux/', interval:  5 },
  //   { prefix: '/beep/', interval: 25 },
  //   { prefix: '/dbt4',  interval: 48 }
  // ])
}
