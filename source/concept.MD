```js
////////////////////////////////////////////////////////////////////////////////
// function dataRouter (route) {
//   return {
//     inbound: { // [PETKEYtoREALKEY] from actual inbound$'s || inbound$ + config
//     // e.g. petKey = '!footer#box!item/02'
//     //               => '!footer#box!/item/':'stuff/quux/'
//     // e.g. realKey = 'stuff/quux/'+'02'
//////////////////

// FLOW - inbound$
// e.g.
// 0. inbound$.write(writeChunk)
// - writeChunk = { type: dbMethod, key: petKey, value: maybeValue }
// 1. inbound$._write(chunk, enc, next):
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
            // ;{
            //   '/x/': '/bla/',
            //   '/p/': '/bla/',
            //   '/a/': '/bla/'
            // }
            // 4. db.put(realKey, TRACKER[value])
// 3. forAll _batch._batch/_put/_del/_... operations, function cb (error) {
  // NOTIFY OPERATION outbound: fromDB/MEM -> realKey2petKey

            // => publish to all interested outbound$'s

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

            // => do: outbound$.push(petKet, dataValue)
            var _OUTBOUND = {
              'stuff/quux/': [
                // notify about TRACKINGs
                // B:listener1, e.g.: !A!/a/b/c/ (=different readable)
                // C:listener2, e.g.: !A#B!/quuz/baz/3 (=different readable)
                "!test1#doobidoo1!/quux/", // e.g. outbound$A
                "!test1#doobidoo2!/baz/" // e.g. outbound$B
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
//  4. outbound$.push
    // @TODO: traverse and validate existance of all petKeys outbound$'s
    // @IDEA: ALL set realKeys should maybe go to outbound$'s ???
    // ALL outbound$'s have a config including a "prefix" and "baseKey"
    // -> in order to go to a specific outbound$, a realKey needs to be mapped
    //    to at least prefix+baseKey of that outbound$

/////////////////////////////////////////////////////////////////////////
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
```
